import Combine
import Foundation
import SwiftUI
import os

@MainActor
class LivingClassroomService: ObservableObject {
    @Published var currentScene: SDUIScene?
    @Published var renderedComponents: [SDUIComponent] = []
    @Published var hasQueuedComponents: Bool = false
    @Published var isConnected: Bool = false
    @Published var error: Error?
    @Published private(set) var sceneRevision: Int = 0

    // MARK: - Shared lesson state

    /// True while the server is preparing the next scene.
    @Published var isGenerating: Bool = false
    /// True once a scene has finished revealing and the learner can advance.
    @Published var canContinue: Bool = false
    /// True when the full curriculum has been delivered.
    @Published var lessonComplete: Bool = false
    /// Short status string for the UI (e.g. "Designing your lesson…").
    @Published var statusText: String?

    private var componentQueue: [SDUIComponent] = []

    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var isConnecting: Bool = false
    private var sessionId: String = ""
    private var courseId: String = ""
    private var lessonId: String?
    private var requestedLanguage: String = "auto"
    private var connectedSessionId: String = ""
    private let logger = Logger(subsystem: "com.lyo.app", category: "LivingClassroomService")

    // MARK: - Lesson identity

    private var topic: String = ""

    // MARK: Voice tutoring
    /// When on, teacher messages are spoken aloud as they reveal, making the
    /// lesson a listen-along. Persisted across sessions.
    @Published var voiceModeEnabled: Bool = {
        let defaults = UserDefaults.standard
        guard defaults.object(forKey: "classroom_voice_mode") != nil else { return true }
        return defaults.bool(forKey: "classroom_voice_mode")
    }() {
        didSet {
            UserDefaults.standard.set(voiceModeEnabled, forKey: "classroom_voice_mode")
            if !voiceModeEnabled { TextToSpeechService.shared.stop() }
        }
    }

    /// Speaks a component if voice mode is on and the content is spoken-style
    /// prose (backend teacher messages can carry JSON director turns — those
    /// are skipped rather than read aloud).
    private func narrateIfEnabled(_ component: SDUIComponent) {
        guard voiceModeEnabled,
            component.type == .teacherMessage,
            !component.content.isEmpty
        else { return }
        let trimmed = component.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.hasPrefix("["), !trimmed.hasPrefix("{") else { return }
        TextToSpeechService.shared.enqueue(
            trimmed,
            language: component.languageCode ?? "auto"
        )
    }

    /// Barge-in: the learner started talking — stop talking over them.
    func bargeIn() {
        TextToSpeechService.shared.stop()
    }

    deinit {
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        urlSession?.invalidateAndCancel()
    }

    private func normalizedSessionId(from rawSessionId: String) -> String {
        rawSessionId.hasPrefix("GENERATE:")
            ? String(rawSessionId.dropFirst("GENERATE:".count))
            : rawSessionId
    }

    /// Connects to the real-time Server-Driven UI WebSockets.
    /// - Parameters:
    ///   - sessionId: The classroom session / course identifier.
    ///   - topic: Human-readable lesson topic sent to the shared backend.
    func connect(
        sessionId: String,
        courseId: String? = nil,
        lessonId: String? = nil,
        topic: String? = nil,
        language: String = "auto",
        durationMinutes: Int? = nil
    ) {
        self.topic = (topic?.isEmpty == false ? topic! : sessionId)

        guard webSocketTask == nil, !isConnecting else {
            logger.info(
                "WebSocket is already connecting or connected. Ignoring duplicate connect request.")
            return
        }

        isConnecting = true
        self.sessionId = sessionId
        self.courseId = courseId ?? sessionId
        self.lessonId = lessonId
        self.requestedLanguage = language
        self.isGenerating = true
        self.statusText = "Connecting to your live classroom…"

        Task {
            do {
                // Use Lyo JWT access token (what the backend expects).
                // If the access token is absent, try refreshing via stored refresh token,
                // then try exchanging the Firebase token for a Lyo JWT.
                let token: String
                if let lyoToken = await TokenManager.shared.getToken() {
                    token = lyoToken
                } else if await TokenManager.shared.getRefreshToken() != nil,
                          let freshToken = try? await DefaultAuthRepository().refreshToken() {
                    token = freshToken
                    self.logger.info("Obtained fresh Lyo JWT via refresh token")
                } else if let fbToken = try? await FirebaseAuthManager.refreshToken(),
                          (try? await LyoRepository.shared.loginWithGoogle(idToken: fbToken)) != nil,
                          let freshToken = await TokenManager.shared.getToken() {
                    token = freshToken
                    self.logger.info("Re-exchanged Firebase token for Lyo JWT")
                } else {
                    throw URLError(.userAuthenticationRequired)
                }

                // Formulate WebSocket URL from the base API URL
                let baseUrlString = AppConfig.baseURL
                let wsBaseString =
                    baseUrlString
                    .replacingOccurrences(of: "https://", with: "wss://")
                    .replacingOccurrences(of: "http://", with: "ws://")

                // Strip "GENERATE:" prefix — pass just the topic as the session_id
                let resolvedSessionId = self.normalizedSessionId(from: sessionId)
                self.connectedSessionId = resolvedSessionId

                // Topic: use passed topic, fall back to session_id itself
                let resolvedTopic = topic ?? resolvedSessionId
                guard var urlComponents = URLComponents(
                    string: "\(wsBaseString)/api/v1/classroom/ws/connect"
                ) else {
                    self.logger.error("Invalid WebSocket URL")
                    throw URLError(.badURL)
                }
                urlComponents.queryItems = [
                    URLQueryItem(name: "session_id", value: resolvedSessionId),
                    URLQueryItem(name: "course_id", value: self.courseId),
                    URLQueryItem(name: "client_contract_version", value: "2"),
                    URLQueryItem(name: "token", value: token),
                    URLQueryItem(name: "topic", value: resolvedTopic),
                    URLQueryItem(name: "language", value: language),
                    URLQueryItem(name: "mode", value: "solo"),
                    // The Director plans a lesson to fit this. A scheduled
                    // study session carries its own length, and sending 10 for
                    // a 45-minute slot has the server plan a quarter of the
                    // work the learner was told to expect. Clamped to the
                    // range the backend accepts.
                    URLQueryItem(
                        name: "duration_minutes",
                        value: String(min(max(durationMinutes ?? 10, 3), 60))
                    ),
                ]
                if let lessonId = self.lessonId, !lessonId.isEmpty {
                    urlComponents.queryItems?.append(
                        URLQueryItem(name: "lesson_id", value: lessonId)
                    )
                }
                guard let url = urlComponents.url else {
                    self.logger.error("Invalid WebSocket URL components")
                    throw URLError(.badURL)
                }

                self.logger.info("Connecting to WebSocket: \(url.absoluteString)")

                let session = URLSession(configuration: .default)
                self.urlSession = session

                // Send the token both as a query param (required) and as a header for
                // backends that also honor Authorization.
                var request = URLRequest(url: url)
                request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

                self.webSocketTask = session.webSocketTask(with: request)
                self.webSocketTask?.resume()
                self.isConnected = true
                self.isConnecting = false
                self.error = nil

                self.receiveMessages()
            } catch {
                self.logger.error("Failed to connect: \(error.localizedDescription)")
                self.isConnected = false
                self.isConnecting = false
                self.webSocketTask = nil
                self.isGenerating = false
                self.statusText = nil
                self.error = error
            }
        }
    }

    /// Gracefully closes the connection
    func disconnect() {
        TextToSpeechService.shared.stop()
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        isConnected = false
        isConnecting = false
        connectedSessionId = ""
        logger.info("Disconnected from WebSocket")
    }

    /// Re-establishes the WebSocket using the previously stored sessionId. Used by the UI's reconnect banner.
    func reconnect() {
        guard !sessionId.isEmpty else {
            logger.warning("Cannot reconnect — no sessionId stored")
            return
        }
        logger.info("\u{1F501} Reconnecting WebSocket for session \(self.sessionId)")
        // Clear any half-open task before reconnecting.
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        isConnecting = false
        error = nil
        connect(
            sessionId: sessionId,
            courseId: courseId,
            lessonId: lessonId,
            topic: topic,
            language: requestedLanguage
        )
    }

    /// Sends a user action (e.g. button tap) back to the authoritative backend.
    /// Returns false when the action cannot even be queued, so the UI can leave
    /// a checkpoint editable instead of inventing offline progress.
    @discardableResult
    func sendUserAction(
        actionIntent: String,
        componentId: String,
        actionData: [String: Any]? = nil
    ) -> Bool {
        // Any learner action owns the floor immediately and invalidates speech
        // from the previous scene. The backend is the only teaching and
        // assessment authority for the live classroom.
        bargeIn()

        guard isConnected, let task = webSocketTask else {
            logger.warning("WebSocket not connected — learner action was not sent")
            isGenerating = false
            statusText = nil
            error = URLError(.notConnectedToInternet)
            return false
        }

        let outboundSessionId = connectedSessionId.isEmpty
            ? normalizedSessionId(from: sessionId)
            : connectedSessionId

        var payload: [String: Any] = [
            "event_type": "user_action",
            "session_id": outboundSessionId,
            "action_intent": actionIntent,
            "component_id": componentId,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        if let actionData = actionData {
            payload["answer_data"] = actionData
        }

        let data: Data
        do {
            data = try JSONSerialization.data(withJSONObject: payload)
        } catch {
            logger.error("Failed to serialize user action payload: \(error.localizedDescription)")
            isGenerating = false
            statusText = nil
            self.error = error
            return false
        }
        // JSONSerialization emits UTF-8 JSON bytes by contract.
        let jsonString = String(decoding: data, as: UTF8.self)

        task.send(.string(jsonString)) { [weak self] error in
            Task { @MainActor in
                if let error = error {
                    self?.logger.error("Failed to send user action: \(error.localizedDescription)")
                    self?.isGenerating = false
                    self?.statusText = nil
                    self?.error = error
                    // Rebuild the active lesson with the same server scene so
                    // any optimistic answer/skip becomes retryable.
                    self?.sceneRevision += 1
                } else {
                    self?.logger.info("📤 Sent user action: \(actionIntent)")
                }
            }
        }
        return true
    }

    var nextQueuedComponent: SDUIComponent? {
        componentQueue.first
    }

    /// Constantly listens for incoming WebSocket messages
    private func receiveMessages() {
        guard let task = webSocketTask else { return }

        task.receive { [weak self] result in
            guard let self = self else { return }

            Task { @MainActor in
                switch result {
                case .success(let message):
                    switch message {
                    case .string(let text):
                        self.logger.debug("Received message: \(text)")
                        self.handleWebSocketMessage(text)
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8) {
                            self.handleWebSocketMessage(text)
                        }
                    @unknown default:
                        self.logger.warning("Received unknown WebSocket message type")
                    }

                    // Continue listening
                    self.receiveMessages()

                case .failure(let error):
                    self.logger.error("WebSocket receiving error: \(error.localizedDescription)")
                    self.isConnected = false
                    self.isConnecting = false
                    self.webSocketTask = nil
                    self.isGenerating = false
                    self.statusText = nil
                    self.error = error
                }
            }
        }
    }

    /// Parses the JSON payload and routes events for SDUI streaming
    private func handleWebSocketMessage(_ message: String) {
        guard let data = message.data(using: .utf8) else { return }

        do {
            let decoder = JSONDecoder()
            // The top level wrapper maps to WebSocketEnvelope to get the type and session
            let envelope = try decoder.decode(WebSocketEnvelope.self, from: data)
            if let serverSessionId = envelope.sessionId, !serverSessionId.isEmpty {
                let normalized = normalizedSessionId(from: serverSessionId)
                if connectedSessionId != normalized {
                    connectedSessionId = normalized
                    logger.info("Using backend classroom session id: \(normalized)")
                }
            }

            Task { @MainActor in
                switch envelope.type {
                case "scene_stream", "scene_start", "SCENE_START":
                    // Backend may send scene at root["scene"] or nested under root["data"]["scene"]
                    if let rootObj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        let sceneDict =
                            (rootObj["scene"] as? [String: Any])
                            ?? (rootObj["data"] as? [String: Any]).flatMap { $0["scene"] as? [String: Any] }
                        if let sceneDict = sceneDict,
                           let sceneData = try? JSONSerialization.data(withJSONObject: sceneDict),
                           let scene = try? decoder.decode(SDUIScene.self, from: sceneData)
                        {
                            self.startSceneRender(scene)
                        } else {
                            self.logger.warning("scene_start: could not extract scene from message")
                        }
                    }

                case "component_stream", "component_render", "COMPONENT_RENDER":
                    // For component streams, decode the `component` portion (backend sends "data": {} empty)
                    if let rootObj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                    {
                        let componentObj =
                            (rootObj["component"] as? [String: Any])
                            ?? (rootObj["data"] as? [String: Any]).flatMap({ $0.isEmpty ? nil : $0 }
                            ) ?? rootObj
                        if let componentData = try? JSONSerialization.data(
                            withJSONObject: componentObj)
                        {
                            do {
                                let component = try decoder.decode(
                                    SDUIComponent.self, from: componentData)
                                self.renderComponent(component)
                            } catch {
                                self.logger.error(
                                    "❌ Failed to decode component: \(error.localizedDescription)")
                                if let raw = String(data: componentData, encoding: .utf8) {
                                    self.logger.error("Raw component JSON: \(raw)")
                                }
                            }
                        }
                    }

                case "scene_complete", "SCENE_COMPLETE":
                    self.completeSceneRender()

                case "system_state":
                    self.logger.info(
                        "Received system_state message - fully connected to Live Classroom stream")

                case "control":
                    self.logger.info("Received control message")
                case "error":
                    self.logger.error("Received server error stream event")
                default:
                    self.logger.warning("Unknown message type: \(envelope.type)")
                }
            }
        } catch {
            logger.error("Failed to decode WebSocket message: \(error.localizedDescription)")
            logger.error("Raw message: \(message)")
        }
    }

    // MARK: - Handlers

    private func startSceneRender(_ scene: SDUIScene) {
        // A new scene invalidates any queued or playing narration.
        TextToSpeechService.shared.stop()
        self.sceneRevision += 1
        self.currentScene = scene

        self.renderedComponents = []
        self.componentQueue = scene.components
        self.hasQueuedComponents = !self.componentQueue.isEmpty
        self.isGenerating = false
        self.canContinue = false
        self.statusText = nil

        logger.info(
            "Started rendering scene: \(scene.sceneType) [\(scene.id)] with \(scene.components.count) components"
        )

        // Auto-reveal the first chunk (staggered, teacher-paced)
        revealNextComponent()
    }

    private func renderComponent(_ component: SDUIComponent) {
        // If it's already on screen, update it seamlessly
        if let index = self.renderedComponents.firstIndex(where: { $0.id == component.id }) {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                self.renderedComponents[index] = component
            }
            logger.info("Updated visible component: \(component.type.rawValue) - \(component.id)")
        }
        // If it's still in the queue, update its data so it's ready when revealed
        else if let index = self.componentQueue.firstIndex(where: { $0.id == component.id }) {
            self.componentQueue[index] = component
            logger.info("Updated queued component: \(component.type.rawValue) - \(component.id)")
        }
        // If it's completely new, add it to the queue
        else {
            self.componentQueue.append(component)
            self.hasQueuedComponents = true
            logger.info("Queued new component: \(component.type.rawValue) - \(component.id)")

            if self.renderedComponents.isEmpty {
                revealNextComponent()
            }
        }
    }

    /// Pulls the next component from the queue and displays it.
    /// Manages the auto-pacing simulation of a "teacher teaching".
    func revealNextComponent() {
        guard !componentQueue.isEmpty else { return }

        let component = componentQueue.removeFirst()
        self.hasQueuedComponents = !componentQueue.isEmpty

        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            self.renderedComponents.append(component)
        }

        // Voice tutoring: read teacher messages aloud as they reveal.
        narrateIfEnabled(component)

        if component.type == .ctaButton {
            canContinue = true
        } else if component.type == .quizCard || component.type == .inputField {
            canContinue = false
            // A real learner checkpoint is a hard boundary. The next component
            // cannot appear until their answer produces a new server scene.
            return
        }

        // Reveal the complete teaching beat, including its checkpoint. Once an
        // interactive component is visible, no timer advances the lesson.
        if !componentQueue.isEmpty {
            let nextComponent = componentQueue[0]
            let charCount = max(component.content.count, 20)
            let delay = component.type == .teacherMessage
                ? min(max(Double(charCount) * 0.035, 0.8), 2.0)
                : 0.35

            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                if self.hasQueuedComponents && self.componentQueue.first?.id == nextComponent.id {
                    self.revealNextComponent()
                }
            }
        }
    }

    private func completeSceneRender() {
        logger.info("Completed rendering scene")
        isGenerating = false
    }

    func requestNextScene() {
        guard !isGenerating, !lessonComplete else { return }
        canContinue = false
        isGenerating = true
        statusText = "Preparing the next part…"

        sendUserAction(actionIntent: "continue", componentId: "continue")
    }

    /// The session's checkpoint questions, packaged for a friend challenge.
    /// Intervention cards are excluded; the correct answer is recovered from
    /// the component's action payload.
    func challengeQuestions() -> [ChallengeQuestion] {
        renderedComponents.compactMap { component in
            guard component.type == .quizCard,
                component.actionIntent != "intervention_choice",
                let options = component.options, options.count >= 2
            else { return nil }
            let questionText = component.question ?? component.content
            guard !questionText.isEmpty else { return nil }
            let answerId = component.actionPayload?["answer_option_id"]
            let answerIndex = options.firstIndex(where: { $0.id == answerId }) ?? 0
            return ChallengeQuestion(
                question: questionText,
                options: options.map(\.label),
                answerIndex: answerIndex
            )
        }
    }

    /// Data for the shareable end-of-lesson recap card, derived only from the
    /// same server-authored components every platform received.
    func lessonRecap() -> (topic: String, points: [String]) {
        let points = renderedComponents
            .filter { $0.type == .teacherMessage || $0.type == .textBlock }
            .map { String($0.content.prefix(120)) }
        return (topic: topic, points: Array(points.suffix(4)))
    }
}
