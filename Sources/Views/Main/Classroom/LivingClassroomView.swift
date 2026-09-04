import SwiftUI

// MARK: - Agent Model

/// Represents one of the multi-agent personas in the AI classroom
struct ClassroomAgent: Identifiable {
    let id: String
    let name: String
    let role: String
    let icon: String
    let accentColor: Color
    let gradientColors: [Color]

    static let professor = ClassroomAgent(
        id: "prof",
        name: "Lyo",
        role: "Lead Instructor",
        icon: "brain.head.profile",
        accentColor: Color(hexString: "E09545"),
        gradientColors: [Color(hexString: "E09545"), Color(hexString: "B87333")]
    )

    static let critic = ClassroomAgent(
        id: "critic",
        name: "Critic",
        role: "Devil's Advocate",
        icon: "eye.trianglebadge.exclamationmark",
        accentColor: Color(hexString: "7AB3E0"),
        gradientColors: [Color(hexString: "7AB3E0"), Color(hexString: "5B93C0")]
    )

    static let student = ClassroomAgent(
        id: "student",
        name: "Student",
        role: "Curious Learner",
        icon: "person.crop.circle.badge.questionmark",
        accentColor: Color(hexString: "7EC8A0"),
        gradientColors: [Color(hexString: "7EC8A0"), Color(hexString: "5EA880")]
    )

    static let allAgents: [ClassroomAgent] = [professor, critic, student]
}

// MARK: - Bottom Tab Model

enum ClassroomBottomTab: String, CaseIterable, Identifiable {
    case outline = "Outline"
    case materials = "Materials"
    case notes = "Notes"
    case quiz = "Quiz"
    case discussion = "Discussion"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .outline: return "list.number"
        case .materials: return "book.closed"
        case .notes: return "note.text"
        case .quiz: return "checkmark.square"
        case .discussion: return "bubble.left.and.bubble.right"
        }
    }
}

// MARK: - Local Classroom Interaction Models

private struct ClassroomQuickHelp: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let icon: String
    let accent: Color
}

private struct ClassroomLocalQuestion: Identifiable {
    let id = UUID()
    let question: String
    let response: String
    let context: String
    let timestamp: Date
}

private struct ClassroomLocalNote: Identifiable {
    enum Kind {
        case note
        case highlight
        case saved

        var icon: String {
            switch self {
            case .note: return "note.text"
            case .highlight: return "highlighter"
            case .saved: return "bookmark.fill"
            }
        }

        var label: String {
            switch self {
            case .note: return "Note"
            case .highlight: return "Highlight"
            case .saved: return "Saved"
            }
        }

        var accent: Color {
            switch self {
            case .note: return Color(hexString: "7AB3E0")
            case .highlight: return Color(hexString: "F59E0B")
            case .saved: return Color(hexString: "7EC8A0")
            }
        }
    }

    let id = UUID()
    let kind: Kind
    let title: String
    let body: String
    let timestamp: Date
}

// MARK: - Session Timer

/// Tracks elapsed time for the live classroom session
final class ClassroomTimer: ObservableObject {
    @Published var elapsed: TimeInterval = 0
    private var timer: Timer?
    let duration: TimeInterval

    init(duration: TimeInterval = 300) {
        self.duration = duration
    }

    func start() {
        timer?.invalidate()
        elapsed = 0
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.elapsed += 1
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    var formattedElapsed: String {
        let m = Int(elapsed) / 60
        let s = Int(elapsed) % 60
        return String(format: "%02d:%02d", m, s)
    }

    var formattedDuration: String {
        let m = Int(duration) / 60
        let s = Int(duration) % 60
        return String(format: "%02d:%02d", m, s)
    }

    var progress: Double {
        min(elapsed / max(duration, 1), 1.0)
    }

    deinit { timer?.invalidate() }
}

// MARK: - Living Classroom View

/// Multi-agent AI Classroom with an interactive whiteboard as the central element.
/// Inspired by professional live-studio UIs: top bar, left agent panel with Lyo mascot,
/// central whiteboard for SDUI content, right toolbar, and tabbed bottom panel.
struct LivingClassroomView: View {
    let courseId: String
    let courseTitle: String

    @StateObject private var service = LivingClassroomService()
    @StateObject private var sessionTimer = ClassroomTimer(duration: 300)
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var uiStackStore: UIStackStore
    @EnvironmentObject var uiState: AppUIState

    @State private var selectedBottomTab: ClassroomBottomTab = .outline
    @State private var activeAgent: ClassroomAgent? = .professor
    @State private var showTranscript = false
    @State private var narrationText: String? = nil
    @State private var narrationAgent: ClassroomAgent? = nil
    @State private var quizSelections: [String: String] = [:]
    @State private var userInput: String = ""
    @State private var recapDismissed = false
    @StateObject private var tts = TextToSpeechService.shared
    @StateObject private var voiceInput = VoiceInputService.shared
    @State private var isBottomExpanded: Bool = false
    @State private var lyoSpeaking: Bool = false
    @State private var showAskSheet: Bool = false
    @State private var askContextStep: ActiveLessonView.LessonStep? = nil
    @State private var quickHelp: ClassroomQuickHelp? = nil
    @State private var localQuestions: [ClassroomLocalQuestion] = []
    @State private var localNotes: [ClassroomLocalNote] = []
    @State private var highlightedMomentIds: Set<String> = []
    @State private var savedMomentIds: Set<String> = []
    @FocusState private var inputFieldFocused: Bool

    @State private var narrationWork: DispatchWorkItem? = nil
    @State private var continueFallbackTask: Task<Void, Never>? = nil
    // Active-lesson narration follows the step on screen. Each step is read
    // aloud once; stepping back through history never re-reads it.
    @State private var narratedStepIds: Set<String> = []

    // Sprint 3 — minimalist 4-zone shell (Stage / Pulse / ActionBar / Drawer).
    // Default ON; persisted so power users who flip to expert mode keep it.
    @AppStorage("classroom.minimalMode") private var minimalMode: Bool = true
    @State private var showDrawer: Bool = false

    // Sprint 21 — Cinematic active-lesson layout (TeacherCard + supporting block
    // + key-term strip + bottom dock). Highest-priority layout; falls back to
    // `minimalLayout` if disabled.
    @AppStorage("classroom.activeLessonMode") private var activeLessonMode: Bool = true

    // Sprint 10 — debounce Continue. WebSocket sendUserAction is fire-and-
    // forget; without a cooldown a fast double-tap would skip two cards.
    @State private var lastAdvanceAt: Date? = nil
    private let advanceCooldown: TimeInterval = 0.6
    private let liveContinuationTimeoutNanoseconds: UInt64 = 15_000_000_000

    // Design tokens
    private let bgDeep = Color(hexString: "080C14")
    private let bgPanel = Color(hexString: "0F1520")
    private let bgSurface = Color(hexString: "16202E")
    private let borderColor = Color.white.opacity(0.08)
    private let accentBlue = Color(hexString: "3B82F6")
    private let liveRed = Color(hexString: "EF4444")

    var body: some View {
        ZStack {
            // Full-bleed dark background
            bgDeep.ignoresSafeArea()

            if activeLessonMode {
                activeLessonLayout
            } else if minimalMode {
                minimalLayout
            } else {
                expertLayout
            }

            // Voice tutoring chip — toggle listen-along narration; pulses
            // while Lyo is speaking.
            VStack {
                HStack {
                    Spacer()
                    voiceModeChip
                        .padding(.trailing, 16)
                        .padding(.top, 54)
                }
                Spacer()
            }
            .zIndex(99)

            // Narration overlay
            if let text = narrationText, let agent = narrationAgent {
                classroomNarration(text: text, agent: agent)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(100)
            }

            // Ask sheet overlay
            if showAskSheet {
                askOverlay
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
                    .zIndex(101)
            }

            if let quickHelp {
                quickHelpOverlay(quickHelp)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(103)
            }

            // Sprint 18 — Reconnect banner. Surfaces when the WebSocket drops
            // so the user is never left staring at a frozen, blank classroom.
            if !service.isConnected, service.error != nil {
                VStack {
                    reconnectBanner
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                    Spacer()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .zIndex(102)
            }

            // Lesson complete — celebration + shareable recap card. Every
            // finished lesson becomes a share moment (clips ↔ classroom flywheel).
            if service.lessonComplete, !recapDismissed {
                let recap = service.lessonRecap()
                LessonCompletionOverlay(
                    topic: recap.topic.isEmpty ? courseTitle : recap.topic,
                    points: recap.points,
                    quizQuestions: service.challengeQuestions(),
                    onKeepGoing: {
                        recapDismissed = true
                        // Victory lap: one challenge question over everything covered.
                        service.sendUserAction(
                            actionIntent: "user_message",
                            componentId: "recap_challenge",
                            actionData: [
                                "message":
                                    "Give me one challenge question that ties together everything we covered today."
                            ]
                        )
                    },
                    onDone: { dismiss() }
                )
                .transition(.opacity)
                .zIndex(104)
            }
        }
        .preferredColorScheme(.dark)
        .navigationBarHidden(true)
        .statusBar(hidden: true)
        .persistentSystemOverlays(.hidden) // Hide home indicator — Netflix/YouTube-style full-bleed classroom
        .task {
            // In the active-lesson layout the view speaks the visible step
            // (see narrateStep), so the service must not also read every
            // component as it reveals — that is what let the voice run
            // ahead of the card the learner was looking at.
            service.narratesRevealedComponents = !activeLessonMode
            service.connect(
                sessionId: courseId,
                courseId: courseId,
                topic: courseTitle
            )
            sessionTimer.start()
        }
        .onDisappear {
            narrationWork?.cancel()
            continueFallbackTask?.cancel()
            if voiceInput.isRecording { voiceInput.stopRecording() }
            service.disconnect()
            sessionTimer.stop()

            // Restore orientation freedom — this is the actual pushed screen
            // (ActiveLessonView is a child with no independent lifecycle hook
            // into AppDelegate), so the lock/unlock pair lives here. Every
            // `.landscape` lock below is matched by this `.all` on disappear
            // so the app can never get stranded in forced landscape.
            AppDelegate.orientationLock = .all
        }
        .onAppear {
            uiStackStore.upsertCourse(
                courseId: courseId,
                title: courseTitle,
                subtitle: "AI Classroom"
            )

            // Netflix/YouTube-style classroom: default to landscape
            // full-screen, matching the web classroom's behavior.
            AppDelegate.orientationLock = .landscape
            if UIDevice.current.orientation != .landscapeLeft && UIDevice.current.orientation != .landscapeRight {
                UIDevice.current.setValue(UIInterfaceOrientation.landscapeRight.rawValue, forKey: "orientation")
            }
        }
        .onChange(of: service.renderedComponents.count) { _, _ in
            handleNewComponent()
        }
        .onChange(of: service.sceneRevision) { _, _ in
            continueFallbackTask?.cancel()
        }
        .onChange(of: service.renderedComponents.isEmpty) { _, isEmpty in
            // A new server scene clears the board; its steps are fresh lines.
            if isEmpty { narratedStepIds.removeAll() }
        }
        .onChange(of: activeLessonMode) { _, isActive in
            service.narratesRevealedComponents = !isActive
        }
        .onReceive(NotificationCenter.default.publisher(for: .classroomAdvance)) { _ in
            // Sprint 5 — minimalist Continue button posts .classroomAdvance.
            // Forward to the WebSocket so the backend advances the lesson.
            let revision = service.sceneRevision
            service.sendUserAction(actionIntent: "continue", componentId: "classroom_continue")
            scheduleContinueFallback(from: revision)
            LyoAnalyticsManager.shared.trackEvent(
                "classroom_advance_tapped",
                parameters: [
                    "courseId": courseId,
                    "card_count": service.renderedComponents.count,
                ])
        }
        .onChange(of: showDrawer) { _, isOpen in
            // Sprint 9 — drawer-aware narration. The narration overlay sits in
            // the bottom half and would fight the sheet for real estate.
            // When the drawer opens, dismiss any active narration; new ones
            // are suppressed inside showNarration() while showDrawer is true.
            if isOpen {
                dismissNarration()
                LyoAnalyticsManager.shared.trackEvent(
                    "classroom_drawer_opened",
                    parameters: [
                        "courseId": courseId,
                        "narration_was_active": narrationText != nil
                    ])
            }
        }
        .sheet(isPresented: $showTranscript) {
            TranscriptSheet(
                transcript: service.renderedComponents
                    .filter { $0.type == .teacherMessage || $0.type == .studentPrompt }
                    .map { TranscriptMessage(isUser: $0.type == .studentPrompt, text: $0.content) }
            )
        }
        .sheet(isPresented: $showDrawer) {
            classroomDrawerSheet
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(bgPanel)
                .preferredColorScheme(.dark)
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - SPRINT 3 — MINIMAL 4-ZONE SHELL (Stage / Pulse / ActionBar / Drawer)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Sprint 21 — Cinematic active-lesson layout.
    ///
    /// Premium calm shell, lesson-as-hero. Maps the WebSocket component
    /// stream into discrete `LessonStep`s and renders one at a time with
    /// progressive disclosure. Continue advances to the next step locally,
    /// or — once at the last step — fires the `continue` user action so the
    /// backend generates the next scene.
    private var activeLessonLayout: some View {
        let steps = ActiveLessonAdapter.steps(from: service.renderedComponents)
        return ActiveLessonView(
            header: .init(
                title: courseTitle,
                subtitle: lessonSubtitle(stepCount: steps.count)
            ),
            steps: steps,
            onAdvance: { step in handleAdvance(step, isLast: step.id == steps.last?.id) },
            onAskLyo: { step in openAskOverlay(for: step) },
            onExplainEasier: { step in explainStepEasier(step) },
            onQuizAnswer: { component, option in
                service.sendUserAction(
                    actionIntent: component.actionIntent ?? "submit_answer",
                    componentId: component.id,
                    actionData: [
                        "selected_option_id": option.id,
                        "selected_option_label": option.label,
                    ]
                )
            },
            onTransferSubmit: { component, response in
                service.sendUserAction(
                    actionIntent: component.actionIntent ?? "submit_transfer",
                    componentId: component.id,
                    actionData: ["response": response]
                )
            },
            onHint: { component in
                service.sendUserAction(
                    actionIntent: "request_hint",
                    componentId: component.id,
                    actionData: ["hint_level": "nudge"]
                )
            },
            onSkip: { component in
                service.sendUserAction(
                    actionIntent: "skip_question",
                    componentId: component.id,
                    actionData: ["reason": "unsure"]
                )
            },
            onPromptAnswer: { step, response in
                // Route through the same "user_message" path chat uses, so
                // the backend's hesitation detection and learner_signal
                // handling apply here too — a mid-lesson checkpoint answer
                // is a real message, not a decorative tap.
                service.sendUserAction(
                    actionIntent: "user_message",
                    componentId: step.id,
                    actionData: ["message": response]
                )
            },
            onBack: { dismiss() },
            onMenu: { withAnimation { showDrawer.toggle() } },
            onMic: { openAskOverlay(for: nil) },
            onTools: { withAnimation { showDrawer.toggle() } },
            captionProgress: tts.lineProgress,
            isNarrating: tts.isSpeaking,
            waitingForScene: service.isGenerating,
            hasQueuedSteps: service.hasQueuedComponents,
            languageCode: sceneLanguageCode,
            onStepShown: { step in narrateStep(step) },
            onSkipNarration: {
                service.bargeIn()
                LyoAnalyticsManager.shared.trackEvent(
                    "classroom_narration_skipped",
                    parameters: ["courseId": courseId])
            }
        )
        .id(service.sceneRevision)
    }

    /// Language the current scene is being taught in, from the most recent
    /// teacher line; falls back to auto-detection.
    private var sceneLanguageCode: String? {
        service.renderedComponents.last(where: { $0.languageCode != nil })?.languageCode
    }

    /// Reads the step that just came on screen aloud, tagged with the step
    /// id so `TextToSpeechService.lineProgress` can drive the caption on the
    /// dialogue card word by word. The learner's own lines are never voiced.
    private func narrateStep(_ step: ActiveLessonView.LessonStep) {
        guard service.voiceModeEnabled else { return }
        guard step.speakerName != "You" else { return }
        guard !narratedStepIds.contains(step.id) else { return }
        narratedStepIds.insert(step.id)
        let trimmed = step.teachingText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("["), !trimmed.hasPrefix("{") else { return }
        tts.speak(text: trimmed, language: sceneLanguageCode ?? "auto", lineId: step.id)
    }

    private func lessonSubtitle(stepCount: Int) -> String {
        // Best-effort subtitle. Once the backend exposes lesson_index /
        // total_lessons in the scene metadata, this can read those directly.
        if stepCount > 0 {
            return "\(stepCount) step\(stepCount == 1 ? "" : "s") in this scene"
        }
        return "Live lesson"
    }

    private func handleAdvance(_ step: ActiveLessonView.LessonStep, isLast: Bool) {
        // Cooldown so a fast double-tap does not double-advance.
        let now = Date()
        if let last = lastAdvanceAt, now.timeIntervalSince(last) < advanceCooldown {
            return
        }
        lastAdvanceAt = now

        if isLast {
            if service.hasQueuedComponents {
                if let queuedCTA = service.nextQueuedComponent, queuedCTA.type == .ctaButton {
                    service.revealNextComponent()
                    let queuedActionData = queuedCTA.actionPayload?.reduce(into: [String: Any]()) { result, item in
                        result[item.key] = item.value
                    }

                    let sent = service.sendUserAction(
                        actionIntent: queuedCTA.actionIntent ?? step.primaryActionIntent ?? "continue",
                        componentId: queuedCTA.id,
                        actionData: queuedActionData
                    )
                    if sent {
                        service.isGenerating = true
                        service.statusText = "Preparing the next part…"
                    }
                    scheduleContinueFallback(from: service.sceneRevision)
                    return
                }

                service.revealNextComponent()
                return
            }

            let actionData = step.primaryActionPayload?.reduce(into: [String: Any]()) { result, item in
                result[item.key] = item.value
            }

            // Ask the backend for the next scene using the scene-provided CTA
            // metadata when available.
            let sent = service.sendUserAction(
                actionIntent: step.primaryActionIntent ?? "continue",
                componentId: step.primaryActionComponentId ?? "classroom_continue",
                actionData: actionData
            )
            if sent {
                // The transport rail reads this as "waiting for the scene"
                // so Continue cannot be fired twice while the server works.
                service.isGenerating = true
                service.statusText = "Preparing the next part…"
            }
            scheduleContinueFallback(from: service.sceneRevision)
        }
        // Non-last advances are handled inside ActiveLessonView local state.
    }

    private func scheduleContinueFallback(from revision: Int) {
        continueFallbackTask?.cancel()
        continueFallbackTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: liveContinuationTimeoutNanoseconds)
            guard !Task.isCancelled else { return }
            guard service.sceneRevision == revision else { return }
            guard !service.hasQueuedComponents else { return }

            guard !service.isConnected || service.error != nil else {
                Log.classroom.warning(
                    "Classroom live continuation still pending; suppressing local fallback while WebSocket is connected"
                )
                // Give the transport rail its Continue back so the learner
                // can retry instead of staring at "Preparing…" forever.
                service.isGenerating = false
                service.statusText = nil
                LyoAnalyticsManager.shared.trackEvent(
                    "classroom_live_continuation_pending",
                    parameters: [
                        "courseId": courseId,
                        "courseTitle": courseTitle,
                        "revision": revision,
                    ])
                return
            }

            service.isGenerating = false
            service.statusText = nil
            service.error = URLError(.timedOut)
            LyoAnalyticsManager.shared.trackEvent(
                "classroom_live_continuation_timed_out",
                parameters: [
                    "courseId": courseId,
                    "courseTitle": courseTitle,
                    "revision": revision,
                ])
        }
    }

    /// New minimalist layout: one focused stage + slim pulse strip + 3-button
    /// action bar. All non-essential chrome (agent rail, tools, tabs, transcript)
    /// lives behind the swipe-up drawer.
    private var minimalLayout: some View {
        VStack(spacing: 0) {
            classroomPulseStrip
            whiteboardArea
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            classroomMinimalActionBar
        }
    }

    /// Legacy expert layout — preserved unchanged so power users can opt back in.
    private var expertLayout: some View {
        VStack(spacing: 0) {
            classroomTopBar
            HStack(spacing: 0) {
                agentPanel
                    .frame(width: 80)
                whiteboardArea
                rightToolbar
                    .frame(width: 44)
            }
            .frame(maxHeight: .infinity)
            bottomPanel
        }
    }

    /// Pulse strip — single thin row showing close, active agent, title,
    /// progress, and a drawer toggle. Replaces the full top bar in minimal mode.
    private var classroomPulseStrip: some View {
        HStack(spacing: 10) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.7))
                    .frame(width: 32, height: 32)
                    .background(bgSurface.opacity(0.6))
                    .clipShape(Circle())
            }
            .accessibilityLabel("Close classroom")

            // Active agent dot
            Circle()
                .fill((activeAgent ?? .professor).accentColor)
                .frame(width: 8, height: 8)
                .overlay(
                    Circle()
                        .stroke(.white.opacity(0.25), lineWidth: 1)
                )
                .shadow(
                    color: (activeAgent ?? .professor).accentColor.opacity(0.6),
                    radius: 4)

            VStack(alignment: .leading, spacing: 2) {
                Text(courseTitle)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text(pulseSubtitle)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white.opacity(0.5))
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            Text(sessionTimer.formattedElapsed)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(.white.opacity(0.55))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(
            bgPanel.opacity(0.92)
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundStyle(borderColor),
                    alignment: .bottom
                )
        )
    }

    private var pulseSubtitle: String {
        let agentName = (activeAgent ?? .professor).name
        let count = service.renderedComponents.count
        if count == 0 { return "\(agentName) • Preparing…" }
        return "\(agentName) • \(count) cards"
    }

    /// Minimal 3-button action bar — the only persistent surface besides the
    /// stage. Continue advances the lesson; Ask opens the existing askOverlay;
    /// More opens the drawer with everything else.
    private var classroomMinimalActionBar: some View {
        HStack(spacing: 10) {
            Button {
                requestAdvance()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.right")
                        .font(.system(size: 13, weight: .bold))
                    Text("Continue")
                        .font(.system(size: 13, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(
                    LinearGradient(
                        colors: [Color(hexString: "3B82F6"), Color(hexString: "6366F1")],
                        startPoint: .leading, endPoint: .trailing
                    )
                )
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .shadow(color: accentBlue.opacity(0.35), radius: 8, y: 2)
                .opacity(isAdvanceCoolingDown ? 0.55 : 1.0)
            }
            .disabled(isAdvanceCoolingDown)
            .accessibilityLabel("Continue")
            .accessibilityHint(isAdvanceCoolingDown ? "Advancing\u{2026}" : "Advance to the next card")

            Button {
                openAskOverlay(for: nil)
            } label: {
                Image(systemName: "mic.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.9))
                    .frame(width: 48, height: 48)
                    .background(bgSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(borderColor, lineWidth: 1)
                    )
            }
            .accessibilityLabel("Ask Lyo")

            Button {
                HapticManager.shared.playLightImpact()
                showDrawer = true
            } label: {
                Image(systemName: "square.grid.2x2")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.9))
                    .frame(width: 48, height: 48)
                    .background(bgSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(borderColor, lineWidth: 1)
                    )
            }
            .accessibilityLabel("More tools")
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .background(
            bgPanel.opacity(0.92)
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundStyle(borderColor),
                    alignment: .top
                )
        )
    }

    /// Drawer sheet — hosts everything that used to be permanently visible:
    /// outline / notes / quiz / discussion tabs, plus a tools row and the
    /// minimal/expert mode toggle.
    private var classroomDrawerSheet: some View {
        VStack(spacing: 0) {
            // Tab strip — reuse existing
            bottomTabBar

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    bottomExpandedContent
                        .frame(minHeight: 200)

                    Divider().background(borderColor)

                    Text("Tools")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white.opacity(0.45))
                        .textCase(.uppercase)
                        .padding(.horizontal, 14)

                    HStack(spacing: 10) {
                        drawerToolButton(icon: "pencil.tip", label: "Annotate") {
                            createAnnotationFromCurrentMoment()
                        }
                        drawerToolButton(
                            icon: "highlighter",
                            label: "Highlight",
                            isActive: isCurrentMomentHighlighted
                        ) {
                            highlightCurrentMoment()
                        }
                        drawerToolButton(
                            icon: "bookmark.fill",
                            label: "Save",
                            isActive: isCurrentMomentSaved
                        ) {
                            saveCurrentMoment()
                        }
                        drawerTranscriptButton {
                            showDrawer = false
                            showTranscript = true
                        }
                    }
                    .padding(.horizontal, 14)

                    Divider().background(borderColor)

                    Toggle(isOn: $minimalMode) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Minimalist mode")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.white)
                            Text("Hide chrome — focus on the lesson")
                                .font(.system(size: 11))
                                .foregroundStyle(.white.opacity(0.5))
                        }
                    }
                    .tint(accentBlue)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 24)
                }
                .padding(.top, 12)
            }
        }
    }

    private func drawerToolButton(
        icon: String,
        label: String,
        isActive: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            HapticManager.shared.playLightImpact()
            action()
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .medium))
                Text(label)
                    .font(.system(size: 10, weight: .medium))
            }
            .foregroundStyle(isActive ? .white : .white.opacity(0.75))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(isActive ? accentBlue.opacity(0.8) : bgSurface)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(isActive ? accentBlue.opacity(0.7) : borderColor, lineWidth: 1)
            )
        }
        .accessibilityLabel(label)
    }

    private func drawerTranscriptButton(action: @escaping () -> Void) -> some View {
        Button {
            HapticManager.shared.playLightImpact()
            action()
        } label: {
            VStack(spacing: 4) {
                Image(systemName: "doc.text")
                    .font(.system(size: 16, weight: .medium))
                Text("Transcript")
                    .font(.system(size: 10, weight: .medium))
            }
            .foregroundStyle(.white.opacity(0.75))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(bgSurface)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(borderColor, lineWidth: 1)
            )
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - TOP BAR
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private var classroomTopBar: some View {
        HStack(spacing: 12) {
            // Logo + Title
            HStack(spacing: 8) {
                // Small Lyo icon
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [Color(hexString: "8B5CF6"), Color(hexString: "6366F1")],
                                startPoint: .topLeading, endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 26, height: 26)

                    Text("L")
                        .font(.system(size: 14, weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                }

                Text(courseTitle)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }

            // LIVE STUDIO badge
            HStack(spacing: 6) {
                Text("LIVE STUDIO")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white.opacity(0.6))
                    .tracking(0.5)

                Circle()
                    .fill(service.isConnected ? Color.green : Color.white.opacity(0.3))
                    .frame(width: 5, height: 5)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(bgSurface)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(borderColor, lineWidth: 1))

            // Timer
            HStack(spacing: 4) {
                Text(sessionTimer.formattedElapsed)
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .foregroundStyle(.white.opacity(0.7))

                Text("/")
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.3))

                Text(sessionTimer.formattedDuration)
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .foregroundStyle(.white.opacity(0.4))
            }

            // LIVE pill
            liveIndicator

            Spacer()

            // Status icons
            HStack(spacing: 12) {
                // Signal
                Image(systemName: "wifi")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(service.isConnected ? .green : .red)

                // Mic
                Image(systemName: "mic.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.5))

                // Chat
                Button {
                    HapticManager.shared.playSelection()
                    showTranscript = true
                } label: {
                    Image(systemName: "bubble.left.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.5))
                }

                // Notifications
                Image(systemName: "bell.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.5))
            }

            // Exit button
            Button {
                HapticManager.shared.playLightImpact()
                dismiss()
            } label: {
                Text("Exit")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.7))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(bgSurface)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(borderColor, lineWidth: 1))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(
            bgPanel
                .overlay(
                    Rectangle()
                        .fill(
                            LinearGradient(
                                colors: [Color.white.opacity(0.03), Color.clear],
                                startPoint: .top, endPoint: .bottom
                            )
                        )
                )
                .shadow(color: .black.opacity(0.3), radius: 8, y: 4)
        )
    }

    private var liveIndicator: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(liveRed)
                .frame(width: 7, height: 7)
                .overlay(
                    Circle()
                        .fill(liveRed.opacity(0.5))
                        .frame(width: 14, height: 14)
                        .opacity(service.isConnected ? 1 : 0)
                        .scaleEffect(service.isConnected ? 1.0 : 0.5)
                        .animation(
                            .easeInOut(duration: 1.0).repeatForever(autoreverses: true),
                            value: service.isConnected)
                )

            Text("LIVE")
                .font(.system(size: 10, weight: .heavy))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(liveRed.opacity(0.85))
        .clipShape(Capsule())
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - LEFT AGENT PANEL
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private var agentPanel: some View {
        VStack(spacing: 6) {
            // Lyo mascot (lead teacher) — the orb
            lyoMascotView
                .padding(.top, 10)

            // Separator
            Rectangle()
                .fill(borderColor)
                .frame(height: 1)
                .padding(.horizontal, 12)

            // Other agents
            ForEach([ClassroomAgent.critic, ClassroomAgent.student]) { agent in
                agentTile(agent)
            }

            Spacer()

            // Mic toggle
            Button {
                HapticManager.shared.playSelection()
            } label: {
                Image(systemName: "mic.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.4))
                    .frame(width: 36, height: 36)
                    .background(bgSurface)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(borderColor, lineWidth: 1))
            }

            // Quick dots indicator
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(Color.white.opacity(0.25))
                        .frame(width: 4, height: 4)
                }
            }
            .padding(.bottom, 8)
        }
        .background(
            bgPanel
                .overlay(
                    Rectangle()
                        .frame(width: 1)
                        .foregroundStyle(borderColor),
                    alignment: .trailing
                )
        )
    }

    /// Lyo mascot: animated orb as the lead instructor
    private var lyoMascotView: some View {
        VStack(spacing: 6) {
            ZStack {
                // Active speaking glow ring
                if lyoSpeaking {
                    Circle()
                        .stroke(
                            LinearGradient(
                                colors: [Color(hexString: "E09545"), Color(hexString: "F59E0B")],
                                startPoint: .topLeading, endPoint: .bottomTrailing
                            ),
                            lineWidth: 2.5
                        )
                        .frame(width: 62, height: 62)
                        .scaleEffect(lyoSpeaking ? 1.15 : 1.0)
                        .opacity(lyoSpeaking ? 0.8 : 0)
                        .animation(
                            .easeInOut(duration: 1.0).repeatForever(autoreverses: true),
                            value: lyoSpeaking)
                }

                AnimatedLioOrb(
                    size: 54,
                    isSpeaking: lyoSpeaking,
                    primaryColor: Color(hexString: "8B5CF6"),
                    secondaryColor: Color(hexString: "6366F1")
                )
            }

            Text("Lyo")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(Color(hexString: "E09545"))
        }
        .onTapGesture {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                activeAgent = .professor
            }
            HapticManager.shared.playSelection()
        }
    }

    private func agentTile(_ agent: ClassroomAgent) -> some View {
        let isActive = activeAgent?.id == agent.id
        let speaking = isSpeaking(agent)

        return VStack(spacing: 4) {
            ZStack {
                if speaking {
                    Circle()
                        .stroke(agent.accentColor.opacity(0.5), lineWidth: 2)
                        .frame(width: 48, height: 48)
                        .scaleEffect(speaking ? 1.15 : 1.0)
                        .opacity(speaking ? 0.7 : 0)
                        .animation(
                            .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
                            value: speaking)
                }

                Circle()
                    .fill(
                        LinearGradient(
                            colors: isActive
                                ? agent.gradientColors : [bgSurface, bgSurface.opacity(0.8)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 42, height: 42)
                    .overlay(
                        Circle().stroke(
                            isActive ? agent.accentColor.opacity(0.6) : borderColor,
                            lineWidth: isActive ? 2 : 1
                        )
                    )

                Image(systemName: agent.icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(isActive ? .white : .white.opacity(0.4))
            }
            .shadow(color: isActive ? agent.accentColor.opacity(0.25) : .clear, radius: 6)

            Text(agent.name)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(isActive ? agent.accentColor : .white.opacity(0.4))
        }
        .padding(.vertical, 4)
        .onTapGesture {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                activeAgent = agent
            }
            HapticManager.shared.playSelection()
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - CENTRAL WHITEBOARD
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private var whiteboardArea: some View {
        VStack(spacing: 0) {
            // Whiteboard title bar
            if let scene = service.currentScene {
                whiteboardHeader(sceneType: scene.sceneType)
            }

            // The whiteboard canvas
            ZStack {
                // Whiteboard background — slight warm off-white with grid
                RoundedRectangle(cornerRadius: 4)
                    .fill(
                        LinearGradient(
                            colors: [Color(hexString: "F8F9FA"), Color(hexString: "EEF0F2")],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
                    .overlay(
                        whiteboardGrid
                            .opacity(0.15)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(Color.black.opacity(0.15), lineWidth: 1)
                    )
                    .shadow(color: .black.opacity(0.4), radius: 16, y: 4)

                // SDUI Content rendered on the whiteboard
                whiteboardContent
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
        }
        .background(
            // Faint gradient behind the whiteboard (studio lighting feel)
            LinearGradient(
                colors: [bgDeep, Color(hexString: "0C111B")],
                startPoint: .top, endPoint: .bottom
            )
        )
    }

    private func whiteboardHeader(sceneType: String) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(accentBlue)
                .frame(width: 6, height: 6)

            Text(sceneType.replacingOccurrences(of: "_", with: " ").capitalized)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.7))

            Spacer()

            // Component count
            Text("\(service.renderedComponents.count) items")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.white.opacity(0.35))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    /// Grid pattern overlay for the whiteboard
    private var whiteboardGrid: some View {
        Canvas { context, size in
            let spacing: CGFloat = 24
            let color = Color.gray.opacity(0.3)

            // Vertical lines
            var x: CGFloat = spacing
            while x < size.width {
                var path = Path()
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: size.height))
                context.stroke(path, with: .color(color), lineWidth: 0.5)
                x += spacing
            }

            // Horizontal lines
            var y: CGFloat = spacing
            while y < size.height {
                var path = Path()
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
                context.stroke(path, with: .color(color), lineWidth: 0.5)
                y += spacing
            }
        }
    }

    /// Main SDUI content rendered on the whiteboard surface
    private var whiteboardContent: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 14) {
                    if service.renderedComponents.isEmpty {
                        whiteboardLoadingState
                    } else {
                        ForEach(service.renderedComponents) { component in
                            WhiteboardComponentRenderer(
                                component: component,
                                quizSelections: $quizSelections,
                                onAction: { intent, componentId, data in
                                    service.sendUserAction(
                                        actionIntent: intent,
                                        componentId: componentId,
                                        actionData: data
                                    )
                                }
                            )
                            .id(component.id)
                            .transition(
                                .asymmetric(
                                    insertion: .scale(scale: 0.96).combined(with: .opacity),
                                    removal: .opacity
                                ))
                        }
                    }
                }
                .padding(16)
                .onChange(of: service.renderedComponents.count) { _, _ in
                    if let lastId = service.renderedComponents.last?.id {
                        withAnimation(.easeOut(duration: 0.3)) {
                            proxy.scrollTo(lastId, anchor: .bottom)
                        }
                    }
                }
            }
        }
    }

    /// Loading placeholder on the whiteboard
    private var whiteboardLoadingState: some View {
        VStack(spacing: 20) {
            Spacer().frame(height: 40)

            AnimatedLioOrb(
                size: 60,
                isSpeaking: true,
                primaryColor: Color(hexString: "8B5CF6"),
                secondaryColor: Color(hexString: "6366F1")
            )

            VStack(spacing: 6) {
                Text("Preparing your lesson…")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(hexString: "374151"))

                Text("Lyo is generating your personalized content")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color(hexString: "9CA3AF"))
            }

            // Animated skeleton lines
            VStack(alignment: .leading, spacing: 8) {
                ForEach(0..<3, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color(hexString: "E5E7EB"))
                        .frame(width: CGFloat.random(in: 120...200), height: 10)
                        .shimmer()
                }
            }
            .padding(.top, 8)

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - RIGHT TOOLBAR
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private var rightToolbar: some View {
        VStack(spacing: 10) {
            Spacer().frame(height: 8)

            toolbarIcon("pencil.tip", tooltip: "Annotate")
            toolbarIcon("eraser", tooltip: "Eraser")
            toolbarIcon("highlighter", tooltip: "Highlight")
            toolbarIcon("checkmark.rectangle", tooltip: "Check")
            toolbarIcon("doc.on.clipboard", tooltip: "Copy")
            toolbarIcon("square.and.pencil", tooltip: "Edit")
            toolbarIcon("phone", tooltip: "Audio")

            Spacer()
        }
        .background(
            bgPanel
                .overlay(
                    Rectangle()
                        .frame(width: 1)
                        .foregroundStyle(borderColor),
                    alignment: .leading
                )
        )
    }

    private func toolbarIcon(_ systemName: String, tooltip: String) -> some View {
        Button {
            HapticManager.shared.playLightImpact()
            handleToolbarAction(tooltip)
        } label: {
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.white.opacity(0.45))
                .frame(width: 32, height: 32)
                .background(bgSurface.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(borderColor, lineWidth: 1)
                )
        }
        .accessibilityLabel(tooltip)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - BOTTOM PANEL
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private var bottomPanel: some View {
        VStack(spacing: 0) {
            // Tab bar
            bottomTabBar

            // Expandable content area
            if isBottomExpanded {
                bottomExpandedContent
                    .frame(height: 160)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            // Action buttons row
            bottomActionBar
        }
        .background(
            bgPanel
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundStyle(borderColor),
                    alignment: .top
                )
                .shadow(color: .black.opacity(0.3), radius: 12, y: -4)
        )
    }

    private var bottomTabBar: some View {
        HStack(spacing: 0) {
            ForEach(ClassroomBottomTab.allCases) { tab in
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        if selectedBottomTab == tab {
                            isBottomExpanded.toggle()
                        } else {
                            selectedBottomTab = tab
                            isBottomExpanded = true
                        }
                    }
                    HapticManager.shared.playSelection()
                } label: {
                    VStack(spacing: 2) {
                        Text(tab.rawValue)
                            .font(
                                .system(
                                    size: 11, weight: selectedBottomTab == tab ? .bold : .medium)
                            )
                            .foregroundStyle(
                                selectedBottomTab == tab
                                    ? .white
                                    : .white.opacity(0.45)
                            )

                        // Active indicator
                        if selectedBottomTab == tab && isBottomExpanded {
                            Capsule()
                                .fill(accentBlue)
                                .frame(width: 20, height: 2)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
            }

            // Overflow
            Button {
                HapticManager.shared.playLightImpact()
                showDrawer = false
                showTranscript = true
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white.opacity(0.35))
                    .frame(width: 32, height: 32)
            }
        }
        .padding(.horizontal, 8)
        .background(bgPanel)
    }

    @ViewBuilder
    private var bottomExpandedContent: some View {
        switch selectedBottomTab {
        case .outline:
            outlineContent
        case .materials:
            materialsContent
        case .notes:
            notesContent
        case .quiz:
            quizContent
        case .discussion:
            discussionContent
        }
    }

    private var outlineContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                if service.currentScene != nil {
                    ForEach(Array(service.renderedComponents.enumerated()), id: \.element.id) {
                        index, component in
                        HStack(spacing: 8) {
                            Text("\(index + 1).")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(.white.opacity(0.5))
                                .frame(width: 22, alignment: .trailing)

                            Text(
                                component.content.prefix(60)
                                    + (component.content.count > 60 ? "…" : "")
                            )
                            .font(
                                .system(
                                    size: 13,
                                    weight: component.type == .teacherMessage ? .semibold : .regular
                                )
                            )
                            .foregroundStyle(.white.opacity(0.8))
                            .lineLimit(1)

                            Spacer()
                        }
                    }
                } else {
                    Text("Outline will populate as the lesson progresses")
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.4))
                }
            }
            .padding(12)
        }
    }

    private var materialsContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                drawerInfoRow(
                    icon: "book.closed",
                    title: "Current lesson",
                    body: courseTitle
                )

                drawerInfoRow(
                    icon: "text.quote",
                    title: "Current focus",
                    body: currentMomentText
                )

                HStack(spacing: 8) {
                    compactDrawerAction(title: "Study Notes", icon: "note.text") {
                        createAnnotationFromCurrentMoment()
                    }
                    compactDrawerAction(title: "Quick Check", icon: "checkmark.square") {
                        startQuickCheck()
                    }
                }
            }
            .padding(12)
        }
    }

    private var notesContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                let noteComponents = service.renderedComponents.filter {
                    $0.type == .textBlock || $0.type == .codeBlock
                }
                if localNotes.isEmpty && noteComponents.isEmpty {
                    placeholderContent("Notes & code blocks will appear here", icon: "note.text")
                } else {
                    ForEach(localNotes) { note in
                        localNoteRow(note)
                    }

                    ForEach(noteComponents) { comp in
                        Text(comp.content)
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.8))
                            .padding(8)
                            .background(bgSurface)
                            .cornerRadius(8)
                    }
                }
            }
            .padding(12)
        }
    }

    private var quizContent: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                let quizComponents = service.renderedComponents.filter { $0.type == .quizCard }
                if quizComponents.isEmpty {
                    VStack(spacing: 10) {
                        placeholderContent(
                            "No quiz in this scene yet", icon: "checkmark.square")

                        compactDrawerAction(title: "Create Quick Check", icon: "sparkles") {
                            startQuickCheck()
                        }
                    }
                } else {
                    ForEach(quizComponents) { comp in
                        Text(comp.question ?? comp.content)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.white.opacity(0.8))
                            .padding(8)
                            .background(bgSurface)
                            .cornerRadius(8)
                    }
                }
            }
            .padding(12)
        }
    }

    private var discussionContent: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                let messages = service.renderedComponents.filter {
                    $0.type == .teacherMessage || $0.type == .studentPrompt
                }
                if messages.isEmpty && localQuestions.isEmpty {
                    placeholderContent(
                        "Discussion threads will appear here", icon: "bubble.left.and.bubble.right")
                } else {
                    ForEach(localQuestions) { item in
                        localQuestionRow(item)
                    }

                    ForEach(messages) { msg in
                        HStack(alignment: .top, spacing: 8) {
                            Circle()
                                .fill(
                                    msg.type == .teacherMessage
                                        ? Color(hexString: "E09545").opacity(0.6)
                                        : Color(hexString: "7EC8A0").opacity(0.6)
                                )
                                .frame(width: 20, height: 20)
                                .overlay(
                                    Text(msg.type == .teacherMessage ? "L" : "U")
                                        .font(.system(size: 9, weight: .bold))
                                        .foregroundStyle(.white)
                                )

                            Text(msg.content)
                                .font(.system(size: 12))
                                .foregroundStyle(.white.opacity(0.8))
                                .lineLimit(2)
                        }
                    }
                }
            }
            .padding(12)
        }
    }

    private func placeholderContent(_ text: String, icon: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 24))
                .foregroundStyle(.white.opacity(0.15))
            Text(text)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.3))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func drawerInfoRow(icon: String, title: String, body: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(accentBlue)
                .frame(width: 24, height: 24)
                .background(accentBlue.opacity(0.14))
                .clipShape(RoundedRectangle(cornerRadius: 7))

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white.opacity(0.85))
                Text(body)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.58))
                    .lineLimit(4)
            }

            Spacer(minLength: 0)
        }
        .padding(10)
        .background(bgSurface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(borderColor, lineWidth: 1))
    }

    private func compactDrawerAction(
        title: String,
        icon: String,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            HapticManager.shared.playLightImpact()
            action()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background(accentBlue.opacity(0.75))
            .clipShape(RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    private func localNoteRow(_ note: ClassroomLocalNote) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: note.kind.icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(note.kind.accent)
                .frame(width: 24, height: 24)
                .background(note.kind.accent.opacity(0.14))
                .clipShape(RoundedRectangle(cornerRadius: 7))

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(note.title)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white.opacity(0.86))
                    Text(note.kind.label)
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(note.kind.accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(note.kind.accent.opacity(0.14))
                        .clipShape(Capsule())
                }

                Text(note.body)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.66))
                    .lineLimit(4)

                Text(shortTime(note.timestamp))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white.opacity(0.35))
            }

            Spacer(minLength: 0)
        }
        .padding(10)
        .background(bgSurface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func localQuestionRow(_ item: ClassroomLocalQuestion) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Circle()
                    .fill(Color(hexString: "7EC8A0").opacity(0.7))
                    .frame(width: 20, height: 20)
                    .overlay(
                        Text("U")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.white)
                    )
                Text(item.question)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.85))
            }

            HStack(alignment: .top, spacing: 8) {
                Circle()
                    .fill(Color(hexString: "E09545").opacity(0.72))
                    .frame(width: 20, height: 20)
                    .overlay(
                        Text("L")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.white)
                    )
                Text(item.response)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.68))
                    .lineLimit(5)
            }
        }
        .padding(10)
        .background(bgSurface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    /// Bottom action bar: Ask, Annotate, Compare, Save
    private var bottomActionBar: some View {
        HStack(spacing: 12) {
            // Ask button (primary)
            Button {
                openAskOverlay(for: nil)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 12, weight: .semibold))
                    Text("Ask")
                        .font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(
                    LinearGradient(
                        colors: [Color(hexString: "3B82F6"), Color(hexString: "6366F1")],
                        startPoint: .leading, endPoint: .trailing
                    )
                )
                .clipShape(Capsule())
                .shadow(color: accentBlue.opacity(0.3), radius: 6, y: 2)
            }

            actionButton(icon: "pencil.tip", label: "Annotate") {
                createAnnotationFromCurrentMoment()
            }
            actionButton(icon: "rectangle.on.rectangle", label: "Compare") {
                askForComparison()
            }
            actionButton(icon: "bookmark.fill", label: "Save") {
                saveCurrentMoment()
            }

            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    private func actionButton(
        icon: String,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            HapticManager.shared.playLightImpact()
            action()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))
                Text(label)
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundStyle(.white.opacity(0.55))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(bgSurface)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(borderColor, lineWidth: 1))
        }
        .accessibilityLabel(label)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - RECONNECT BANNER
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// Shown when the WebSocket has dropped. Gives the user a clear, tappable
    /// recovery path so the classroom never silently freezes.
    private var reconnectBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(liveRed)
            VStack(alignment: .leading, spacing: 2) {
                Text("Classroom disconnected")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                Text("Tap to reconnect and continue.")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.7))
            }
            Spacer(minLength: 8)
            Button {
                service.reconnect()
            } label: {
                Text("Reconnect")
                    .font(.system(size: 13, weight: .semibold))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(
                        Capsule().fill(accentBlue)
                    )
                    .foregroundStyle(.white)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Reconnect to classroom")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(bgPanel.opacity(0.95))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(liveRed.opacity(0.6), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.4), radius: 10, x: 0, y: 4)
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - ASK OVERLAY
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private func quickHelpOverlay(_ help: ClassroomQuickHelp) -> some View {
        VStack {
            Spacer()

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: help.icon)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(help.accent)
                        .clipShape(Circle())

                    Text(help.title)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)

                    Spacer()

                    Button {
                        withAnimation(.easeOut(duration: 0.2)) {
                            quickHelp = nil
                        }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white.opacity(0.55))
                            .frame(width: 24, height: 24)
                            .background(Color.white.opacity(0.08))
                            .clipShape(Circle())
                    }
                }

                Text(help.message)
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.84))
                    .lineLimit(8)

                HStack(spacing: 8) {
                    Button {
                        openAskOverlay(for: nil)
                    } label: {
                        Label("Ask follow-up", systemImage: "bubble.left")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(accentBlue.opacity(0.8))
                            .clipShape(Capsule())
                    }

                    Button {
                        startQuickCheck()
                    } label: {
                        Label("Quiz me", systemImage: "checkmark.square")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.78))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(Color.white.opacity(0.08))
                            .clipShape(Capsule())
                    }
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(bgPanel.opacity(0.96))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(help.accent.opacity(0.35), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.4), radius: 16, y: 8)
            .padding(.horizontal, 18)
            .padding(.bottom, activeLessonMode ? 98 : 80)
        }
    }

    private func askSuggestionButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button {
            HapticManager.shared.playSelection()
            action()
        } label: {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(0.78))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.08))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    /// Floating toggle for listen-along narration. Pulses while speaking.
    private var voiceModeChip: some View {
        Button {
            HapticManager.shared.light()
            service.voiceModeEnabled.toggle()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: service.voiceModeEnabled
                    ? (tts.isSpeaking ? "waveform" : "speaker.wave.2.fill")
                    : "speaker.slash")
                    .font(.system(size: 12, weight: .semibold))
                    .symbolEffect(.variableColor.iterative, isActive: tts.isSpeaking)
                Text(service.voiceModeEnabled ? "Voice on" : "Voice off")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
            }
            .foregroundStyle(service.voiceModeEnabled ? Color(hexString: "A78BFA") : .white.opacity(0.45))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Capsule().fill(Color.black.opacity(0.45)))
            .overlay(
                Capsule().stroke(
                    service.voiceModeEnabled ? Color(hexString: "8B5CF6").opacity(0.5) : Color.white.opacity(0.15),
                    lineWidth: 1
                )
            )
        }
    }

    private var askOverlay: some View {
        ZStack {
            Color.black.opacity(0.5)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        showAskSheet = false
                    }
                }

            VStack(spacing: 16) {
                // Ask header
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(askContextStep == nil ? "Ask the Classroom" : "Ask about this step")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)

                        if let context = askContextStep?.teachingText {
                            Text(context)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(.white.opacity(0.5))
                                .lineLimit(2)
                        }
                    }
                    Spacer()
                    Button {
                        userInput = ""
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                            showAskSheet = false
                        }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white.opacity(0.5))
                            .frame(width: 28, height: 28)
                            .background(Color.white.opacity(0.1))
                            .clipShape(Circle())
                    }
                }

                HStack(spacing: 8) {
                    askSuggestionButton("Explain this") {
                        if let step = askContextStep {
                            explainStepEasier(step)
                            showAskSheet = false
                        } else {
                            explainCurrentMoment()
                        }
                    }
                    askSuggestionButton("Quiz me") {
                        startQuickCheck()
                        showAskSheet = false
                    }
                    askSuggestionButton("Example") {
                        userInput = "Give me a concrete example for this."
                    }
                }

                // Text input + voice dictation
                HStack(spacing: 10) {
                    Image(systemName: "pencil.line")
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.4))

                    TextField(
                        askContextStep == nil
                            ? "Type or speak your question…"
                            : "Ask Lyo about this moment…",
                        text: $userInput
                    )
                        .font(.system(size: 14, weight: .regular, design: .rounded))
                        .foregroundStyle(.white)
                        .focused($inputFieldFocused)
                        .onSubmit { sendMessage() }

                    // Dictate: barge-in (Lyo stops talking), live transcript
                    // streams into the field, tap again to finish.
                    Button {
                        if voiceInput.isRecording {
                            voiceInput.stopRecording()
                            if !voiceInput.transcript.isEmpty {
                                userInput = voiceInput.transcript
                                voiceInput.transcript = ""
                            }
                        } else {
                            service.bargeIn()
                            Task { try? await voiceInput.startRecording() }
                        }
                    } label: {
                        Image(systemName: voiceInput.isRecording ? "mic.fill" : "mic")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(voiceInput.isRecording ? Color.red : .white.opacity(0.6))
                            .frame(width: 30, height: 30)
                            .background(
                                Circle().fill(voiceInput.isRecording ? Color.red.opacity(0.18) : Color.white.opacity(0.08))
                            )
                            .scaleEffect(voiceInput.isRecording ? 1.0 + CGFloat(voiceInput.audioLevel) * 0.3 : 1.0)
                            .animation(.easeOut(duration: 0.12), value: voiceInput.audioLevel)
                    }
                }
                .onChange(of: voiceInput.transcript) { _, newValue in
                    if voiceInput.isRecording, !newValue.isEmpty {
                        userInput = newValue
                    }
                }
                .padding(14)
                .background(bgSurface)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(accentBlue.opacity(0.3), lineWidth: 1)
                )

                // Send
                Button {
                    sendMessage()
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        showAskSheet = false
                    }
                } label: {
                    HStack {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 13, weight: .semibold))
                        Text("Send")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(
                        LinearGradient(
                            colors: [accentBlue, Color(hexString: "6366F1")],
                            startPoint: .leading, endPoint: .trailing
                        )
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(userInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(
                    userInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.5 : 1.0)
            }
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: 20)
                    .fill(bgPanel)
                    .overlay(
                        RoundedRectangle(cornerRadius: 20)
                            .stroke(borderColor, lineWidth: 1)
                    )
            )
            .padding(.horizontal, 40)
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - NARRATION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private func classroomNarration(text: String, agent: ClassroomAgent) -> some View {
        VStack {
            Spacer()

            HStack(alignment: .top, spacing: 12) {
                // Lyo orb or agent avatar
                if agent.id == "prof" {
                    AnimatedLioOrb(
                        size: 32,
                        isSpeaking: true,
                        primaryColor: Color(hexString: "8B5CF6"),
                        secondaryColor: Color(hexString: "6366F1")
                    )
                } else {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: agent.gradientColors,
                                startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                        .frame(width: 32, height: 32)
                        .overlay(
                            Image(systemName: agent.icon)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(.white)
                        )
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(agent.name)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(agent.accentColor)

                    Text(text)
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.9))
                        .lineLimit(3)
                }

                Spacer()

                Button {
                    dismissNarration()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white.opacity(0.4))
                        .frame(width: 22, height: 22)
                        .background(Color.white.opacity(0.08))
                        .clipShape(Circle())
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(.ultraThickMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .fill(
                                LinearGradient(
                                    colors: [agent.accentColor.opacity(0.12), Color.clear],
                                    startPoint: .leading, endPoint: .trailing
                                )
                            )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(agent.accentColor.opacity(0.25), lineWidth: 1)
                    )
            )
            .padding(.horizontal, 90)  // Clear of left/right panels
            .padding(.bottom, 80)
        }
        .onTapGesture { dismissNarration() }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARK: - HELPERS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    private var latestLessonStep: ActiveLessonView.LessonStep? {
        ActiveLessonAdapter.steps(from: service.renderedComponents).last
    }

    private var currentMomentId: String {
        latestLessonStep?.id
            ?? service.renderedComponents.last(where: { $0.type == .teacherMessage })?.id
            ?? service.currentScene?.id
            ?? courseId
    }

    private var currentMomentText: String {
        if let text = latestLessonStep?.teachingText, !text.isEmpty {
            return compactText(text, limit: 220)
        }

        if let text = service.renderedComponents.last(where: { $0.type == .teacherMessage })?.content,
           !text.isEmpty {
            return compactText(text, limit: 220)
        }

        return "We are working on \(courseTitle)."
    }

    private var isCurrentMomentHighlighted: Bool {
        highlightedMomentIds.contains(currentMomentId)
    }

    private var isCurrentMomentSaved: Bool {
        savedMomentIds.contains(currentMomentId)
    }

    private func openAskOverlay(for step: ActiveLessonView.LessonStep?) {
        HapticManager.shared.playMediumImpact()
        askContextStep = step
        userInput = ""
        quickHelp = nil
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
            showAskSheet = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            inputFieldFocused = true
        }
    }

    private func explainStepEasier(_ step: ActiveLessonView.LessonStep) {
        HapticManager.shared.playSelection()
        quickHelp = ClassroomQuickHelp(
            title: isSpanishClassroom ? "Ayuda solicitada" : "Help requested",
            message: isSpanishClassroom
                ? "Lyo pausó la lección y explicará esta idea de otra manera."
                : "Lyo paused the lesson and will explain this idea another way.",
            icon: "wand.and.stars",
            accent: Color(hexString: "8B5CF6")
        )
        service.sendUserAction(
            actionIntent: "request_hint",
            componentId: step.id,
            actionData: [
                "hint_level": "principle"
            ]
        )
        LyoAnalyticsManager.shared.trackEvent(
            "classroom_explain_easier_tapped",
            parameters: ["courseId": courseId, "stepId": step.id]
        )
    }

    private func explainCurrentMoment() {
        if let step = latestLessonStep {
            explainStepEasier(step)
            return
        }

        quickHelp = ClassroomQuickHelp(
            title: isSpanishClassroom ? "Ayuda solicitada" : "Help requested",
            message: isSpanishClassroom
                ? "Lyo pausó la lección y explicará esta idea de otra manera."
                : "Lyo paused the lesson and will explain this idea another way.",
            icon: "wand.and.stars",
            accent: Color(hexString: "8B5CF6")
        )
        service.sendUserAction(
            actionIntent: "request_hint",
            componentId: currentMomentId,
            actionData: ["hint_level": "principle"]
        )
    }

    private func askForComparison() {
        quickHelp = ClassroomQuickHelp(
            title: isSpanishClassroom ? "Ejemplo solicitado" : "Example requested",
            message: isSpanishClassroom
                ? "Lyo pausó la lección y está preparando una comparación."
                : "Lyo paused the lesson and is preparing a comparison.",
            icon: "rectangle.on.rectangle",
            accent: Color(hexString: "7AB3E0")
        )
        service.sendUserAction(
            actionIntent: "request_example",
            componentId: currentMomentId,
            actionData: ["example_type": "comparison"]
        )
    }

    private func createAnnotationFromCurrentMoment() {
        let note = ClassroomLocalNote(
            kind: .note,
            title: "Classroom note",
            body: currentMomentText,
            timestamp: Date()
        )
        localNotes.insert(note, at: 0)
        selectedBottomTab = .notes
        isBottomExpanded = true
        quickHelp = ClassroomQuickHelp(
            title: "Note added",
            message: "Saved this classroom moment to Notes so you can review it from the drawer.",
            icon: "note.text",
            accent: Color(hexString: "7AB3E0")
        )
        LyoAnalyticsManager.shared.trackEvent(
            "classroom_note_created",
            parameters: ["courseId": courseId, "momentId": currentMomentId]
        )
    }

    private func highlightCurrentMoment() {
        let id = currentMomentId
        guard !highlightedMomentIds.contains(id) else {
            quickHelp = ClassroomQuickHelp(
                title: "Already highlighted",
                message: "This moment is already marked as important in your Notes tab.",
                icon: "highlighter",
                accent: Color(hexString: "F59E0B")
            )
            return
        }

        highlightedMomentIds.insert(id)
        localNotes.insert(
            ClassroomLocalNote(
                kind: .highlight,
                title: "Key highlight",
                body: currentMomentText,
                timestamp: Date()
            ),
            at: 0
        )
        selectedBottomTab = .notes
        isBottomExpanded = true
        quickHelp = ClassroomQuickHelp(
            title: "Highlighted",
            message: "Marked this as a key idea. It now appears in Notes with a highlight label.",
            icon: "highlighter",
            accent: Color(hexString: "F59E0B")
        )
    }

    private func saveCurrentMoment() {
        let id = currentMomentId
        savedMomentIds.insert(id)
        uiStackStore.upsertCourse(
            courseId: courseId,
            title: courseTitle,
            subtitle: "Saved from AI Classroom",
            progress: min(0.95, max(0.1, Double(max(service.sceneRevision, 1)) / 10.0))
        )

        if !localNotes.contains(where: { $0.kind.label == ClassroomLocalNote.Kind.saved.label && $0.body == currentMomentText }) {
            localNotes.insert(
                ClassroomLocalNote(
                    kind: .saved,
                    title: "Saved moment",
                    body: currentMomentText,
                    timestamp: Date()
                ),
                at: 0
            )
        }

        quickHelp = ClassroomQuickHelp(
            title: "Saved to your stack",
            message: "This classroom and the current moment were saved so you can resume and review later.",
            icon: "bookmark.fill",
            accent: Color(hexString: "7EC8A0")
        )
        LyoAnalyticsManager.shared.trackEvent(
            "classroom_moment_saved",
            parameters: ["courseId": courseId, "momentId": id]
        )
    }

    private func startQuickCheck() {
        quickHelp = nil
        showDrawer = false
        showAskSheet = false
        service.sendUserAction(
            actionIntent: "continue",
            componentId: currentMomentId,
            actionData: [
                "mode": "quick_check",
                "topic": courseTitle,
                "context": currentMomentText,
            ]
        )
        LyoAnalyticsManager.shared.trackEvent(
            "classroom_quick_check_started",
            parameters: ["courseId": courseId, "momentId": currentMomentId]
        )
    }

    private func handleToolbarAction(_ tooltip: String) {
        switch tooltip {
        case "Annotate", "Edit":
            createAnnotationFromCurrentMoment()
        case "Eraser":
            highlightedMomentIds.removeAll()
            quickHelp = ClassroomQuickHelp(
                title: "Highlights cleared",
                message: "Current highlight marks were cleared. Your saved notes stay in the Notes tab.",
                icon: "eraser",
                accent: Color(hexString: "7AB3E0")
            )
        case "Highlight":
            highlightCurrentMoment()
        case "Check":
            startQuickCheck()
        case "Copy":
            showTranscript = true
        case "Audio":
            openAskOverlay(for: nil)
        default:
            break
        }
    }

    private func sendMessage() {
        let trimmed = userInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        HapticManager.shared.playMessageSent()

        let context = askContextStep?.teachingText ?? currentMomentText
        let contextId = askContextStep?.id ?? currentMomentId
        selectedBottomTab = .discussion

        service.sendUserAction(
            actionIntent: "ask_question",
            componentId: contextId,
            actionData: [
                "message": trimmed,
                "context": context,
                "course_title": courseTitle,
            ]
        )
        uiStackStore.upsertTutor(
            courseId: courseId,
            lessonId: contextId,
            courseTitle: courseTitle,
            lessonTitle: "AI Classroom",
            lastQuestion: trimmed
        )
        quickHelp = ClassroomQuickHelp(
            title: isSpanishClassroom ? "Pregunta enviada" : "Question sent",
            message: isSpanishClassroom
                ? "Lyo pausó la lección y está preparando una respuesta."
                : "Lyo paused the lesson and is preparing a response.",
            icon: "paperplane.fill",
            accent: accentBlue
        )
        LyoAnalyticsManager.shared.trackEvent(
            "classroom_ask_lyo_sent",
            parameters: ["courseId": courseId, "contextId": contextId]
        )

        userInput = ""
        askContextStep = nil
        inputFieldFocused = false
    }

    private func compactText(_ text: String, limit: Int) -> String {
        let collapsed = text
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard collapsed.count > limit else { return collapsed }
        let index = collapsed.index(collapsed.startIndex, offsetBy: limit)
        return String(collapsed[..<index]).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }

    private var isSpanishClassroom: Bool {
        service.renderedComponents
            .compactMap(\.languageCode)
            .last?
            .lowercased()
            .hasPrefix("es") == true
    }

    private func shortTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        return formatter.string(from: date)
    }

    private func handleNewComponent() {
        guard let last = service.renderedComponents.last else { return }
        if last.type == .teacherMessage {
            let agent = agentForComponent(last)
            lyoSpeaking = agent.id == "prof"
            // Active-lesson mode: the dialogue card is the caption and it
            // follows the voice. A second floating copy of the same line
            // (or of the raw director script) only crowded the card.
            if !activeLessonMode {
                showNarration(text: last.content, agent: agent)
            }
            HapticManager.shared.playMessageReceived()

            // Auto-stop speaking after delay
            DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                withAnimation { lyoSpeaking = false }
            }
        }
        if last.type == .quizCard {
            HapticManager.shared.playQuizSelection()
        }
    }

    // MARK: - Sprint 10 — debounced advance

    /// True while the Continue button should be visually disabled.
    private var isAdvanceCoolingDown: Bool {
        guard let t = lastAdvanceAt else { return false }
        return Date().timeIntervalSince(t) < advanceCooldown
    }

    /// Posts `.classroomAdvance` exactly once per cooldown window. The
    /// notification handler does the actual `sendUserAction` + analytics work,
    /// so any subscriber (this view or a future Live overlay) goes through
    /// the same code path.
    private func requestAdvance() {
        if isAdvanceCoolingDown {
            LyoAnalyticsManager.shared.trackEvent(
                "classroom_advance_debounced",
                parameters: ["courseId": courseId])
            return
        }
        lastAdvanceAt = Date()
        HapticManager.shared.playMediumImpact()

        if service.hasQueuedComponents {
            service.revealNextComponent()
        } else {
            NotificationCenter.default.post(name: .classroomAdvance, object: nil)
        }
    }

    private func agentForComponent(_ component: SDUIComponent) -> ClassroomAgent {
        if let emotion = component.emotion?.lowercased() {
            if emotion.contains("critic") || emotion.contains("challenge") { return .critic }
            if emotion.contains("curious") || emotion.contains("question") { return .student }
        }
        return .professor
    }

    private func isSpeaking(_ agent: ClassroomAgent) -> Bool {
        guard let last = service.renderedComponents.last,
            last.type == .teacherMessage
        else { return false }
        return agentForComponent(last).id == agent.id
    }

    private func showNarration(text: String, agent: ClassroomAgent) {
        // Sprint 9 — don't compete with the drawer sheet.
        guard !showDrawer else { return }
        narrationWork?.cancel()
        withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
            narrationText = text
            narrationAgent = agent
        }
        let work = DispatchWorkItem { [self] in dismissNarration() }
        narrationWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: work)
    }

    private func dismissNarration() {
        narrationWork?.cancel()
        withAnimation(.easeOut(duration: 0.3)) {
            narrationText = nil
            narrationAgent = nil
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MARK: - WHITEBOARD COMPONENT RENDERER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Renders SDUI components styled for the whiteboard surface (light background).
struct WhiteboardComponentRenderer: View {
    let component: SDUIComponent
    @Binding var quizSelections: [String: String]
    var onAction: ((String, String, [String: Any]?) -> Void)?
    @State private var transferResponse = ""

    private let textDark = Color(hexString: "1F2937")
    private let textMedium = Color(hexString: "4B5563")
    private let textLight = Color(hexString: "9CA3AF")
    private let accentBlue = Color(hexString: "3B82F6")
    private let cardBg = Color(hexString: "FFFFFF")
    private let cardBorder = Color(hexString: "E5E7EB")

    var body: some View {
        switch component.type {
        case .teacherMessage: teacherMessageView
        case .studentPrompt: studentPromptView
        case .quizCard: quizCardView
        case .ctaButton: ctaButtonView
        case .textBlock: textBlockView
        case .codeBlock: codeBlockView
        case .progressBar: progressBarView
        case .exampleBlock: exampleBlockView
        case .inputField: inputFieldView
        case .lessonBlock: lessonBlockView
        default: fallbackView
        }
    }

    private var exampleBlockView: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(component.title ?? "Worked example")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(accentBlue)
            Text(component.content)
                .font(.system(size: 15, weight: .medium, design: .rounded))
                .foregroundStyle(textDark)
        }
        .padding(14)
        .background(cardBg, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(cardBorder, lineWidth: 1)
        )
    }

    private var inputFieldView: some View {
        let minimum = max(component.minWords ?? 6, 1)
        let wordCount = transferResponse.split(whereSeparator: \.isWhitespace).count
        let isSpanish = component.languageCode?.lowercased().hasPrefix("es") == true
        return VStack(alignment: .leading, spacing: 10) {
            Text(component.question ?? component.content)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(textDark)
            TextEditor(text: $transferResponse)
                .font(.system(size: 14, weight: .medium))
                .frame(minHeight: 90)
                .padding(8)
                .background(Color.gray.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
            HStack {
                Text(
                    isSpanish
                        ? "\(wordCount)/\(minimum) palabras"
                        : "\(wordCount)/\(minimum) words"
                )
                    .font(.caption)
                    .foregroundStyle(textLight)
                Spacer()
                Button(isSpanish ? "Enviar" : "Submit") {
                    onAction?(
                        component.actionIntent ?? "submit_transfer",
                        component.id,
                        ["response": transferResponse]
                    )
                }
                .buttonStyle(.borderedProminent)
                .disabled(wordCount < minimum)
            }
            checkpointSupportActions
        }
    }

    private var checkpointSupportActions: some View {
        let isSpanish = component.languageCode?.lowercased().hasPrefix("es") == true
        return HStack(spacing: 12) {
            Button {
                onAction?("request_hint", component.id, ["hint_level": "nudge"])
            } label: {
                Label(
                    isSpanish ? "Pedir ayuda" : "Ask for help",
                    systemImage: "lightbulb"
                )
            }
            .buttonStyle(.bordered)

            Button(isSpanish ? "Omitir por ahora" : "Skip for now") {
                onAction?("skip_question", component.id, ["reason": "unsure"])
            }
            .buttonStyle(.plain)
            .foregroundStyle(textLight)
        }
        .font(.system(size: 12, weight: .semibold, design: .rounded))
    }

    /// Pass-through to the rich BlockRendererView for diagrams, math, charts,
    /// flashcards, callouts, hooks, and the rest of the LiveLessonBlock palette.
    @ViewBuilder
    private var lessonBlockView: some View {
        if let block = component.lessonBlock {
            BlockRendererView(
                block: block,
                onQuizAnswer: { idx in
                    onAction?(
                        "submit_answer",
                        component.id,
                        ["selected_index": idx]
                    )
                },
                onAction: { actionString in
                    onAction?("ask_question", component.id, ["text": actionString])
                }
            )
        } else {
            fallbackView
        }
    }

    // Teacher message — Premium glassmorphic note
    private var teacherMessageView: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                // Lyo indicator dot with glow
                ZStack {
                    Circle()
                        .fill(Color(hexString: "8B5CF6").opacity(0.3))
                        .frame(width: 32, height: 32)
                        .blur(radius: 4)

                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [Color(hexString: "8B5CF6"), Color(hexString: "6366F1")],
                                startPoint: .topLeading, endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 24, height: 24)
                        .overlay(
                            Text("L")
                                .font(.system(size: 11, weight: .black, design: .rounded))
                                .foregroundStyle(.white)
                        )
                }

                Text("Lyo")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hexString: "7C3AED"))
            }

            Text(component.content)
                .font(.system(size: 15, weight: .medium, design: .rounded))
                .foregroundStyle(textDark)
                .lineSpacing(6)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(.ultraThinMaterial)
                .background(Color(hexString: "F5F3FF").opacity(0.85))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(
                            LinearGradient(
                                colors: [Color.white.opacity(0.8), Color.white.opacity(0.2)],
                                startPoint: .topLeading, endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                )
        )
        .shadow(color: Color(hexString: "8B5CF6").opacity(0.15), radius: 10, y: 5)
    }

    // Student prompt
    private var studentPromptView: some View {
        HStack(alignment: .top, spacing: 10) {
            Spacer()

            VStack(alignment: .trailing, spacing: 6) {
                Text(component.studentName ?? "You")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(hexString: "059669"))

                Text(component.content)
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(textDark)
                    .multilineTextAlignment(.trailing)
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(.ultraThinMaterial)
                    .background(Color(hexString: "ECFDF5").opacity(0.85))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(
                                LinearGradient(
                                    colors: [Color.white.opacity(0.8), Color.white.opacity(0.2)],
                                    startPoint: .topLeading, endPoint: .bottomTrailing
                                ),
                                lineWidth: 1
                            )
                    )
            )
            .shadow(color: Color(hexString: "059669").opacity(0.1), radius: 8, y: 4)
        }
    }

    // Quiz card
    private var quizCardView: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Question
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(Color(hexString: "F59E0B").opacity(0.2))
                        .frame(width: 32, height: 32)
                    Image(systemName: "questionmark")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Color(hexString: "D97706"))
                }

                Text(component.question ?? component.content)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(textDark)
            }

            // Options
            if let options = component.options {
                ForEach(options) { option in
                    let isSelected = quizSelections[component.id] == option.id

                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                            quizSelections[component.id] = option.id
                        }
                        HapticManager.shared.playQuizSelection()
                        onAction?(
                            "submit_answer", component.id,
                            [
                                "selected_option_id": option.id,
                                "selected_option_label": option.label,
                            ])
                    } label: {
                        HStack(spacing: 12) {
                            Circle()
                                .fill(isSelected ? accentBlue : Color.clear)
                                .frame(width: 22, height: 22)
                                .overlay(
                                    Circle().stroke(
                                        isSelected ? accentBlue : Color(hexString: "D1D5DB"),
                                        lineWidth: 1.5)
                                )
                                .overlay(
                                    isSelected
                                        ? Image(systemName: "checkmark")
                                            .font(.system(size: 10, weight: .bold))
                                            .foregroundStyle(.white)
                                            .scaleEffect(isSelected ? 1 : 0)
                                        : nil
                                )

                            Text(option.label)
                                .font(.system(size: 15, weight: isSelected ? .bold : .medium, design: .rounded))
                                .foregroundStyle(isSelected ? accentBlue : textMedium)

                            Spacer()
                        }
                        .padding(14)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(isSelected ? accentBlue.opacity(0.08) : cardBg)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(
                                            isSelected ? accentBlue.opacity(0.4) : cardBorder,
                                            lineWidth: isSelected ? 2 : 1)
                                )
                        )
                        .scaleEffect(isSelected ? 1.02 : 1.0)
                    }
                    .buttonStyle(.plain)
                }
            }
            checkpointSupportActions
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(.ultraThinMaterial)
                .background(Color(hexString: "FFFBEB").opacity(0.85))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(
                            LinearGradient(
                                colors: [Color.white.opacity(0.9), Color.white.opacity(0.3)],
                                startPoint: .topLeading, endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                )
        )
        .shadow(color: Color(hexString: "F59E0B").opacity(0.1), radius: 10, y: 5)
    }

    // CTA button
    private var ctaButtonView: some View {
        Button {
            HapticManager.shared.playMediumImpact()
            onAction?(component.actionIntent ?? "cta_tap", component.id, nil)
        } label: {
            HStack(spacing: 8) {
                if let intent = component.actionIntent, intent.contains("next") {
                    Image(systemName: "arrow.right.circle.fill")
                        .font(.system(size: 16, weight: .bold))
                }

                Text(component.content)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                LinearGradient(
                    colors: [Color(hexString: "4F46E5"), Color(hexString: "7C3AED")],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
            )
            .clipShape(Capsule())
            .shadow(color: Color(hexString: "4F46E5").opacity(0.4), radius: 12, y: 6)
            .overlay(
                Capsule()
                    .stroke(Color.white.opacity(0.2), lineWidth: 1)
            )
        }
        .buttonStyle(PlainButtonStyle())
    }

    // Text block
    private var textBlockView: some View {
        Text(component.content)
            .font(.system(size: 14))
            .foregroundStyle(textDark)
            .lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(cardBg)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(cardBorder, lineWidth: 1)
                    )
            )
    }

    // Code block
    private var codeBlockView: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Code header
            HStack {
                Circle().fill(Color(hexString: "EF4444")).frame(width: 8, height: 8)
                Circle().fill(Color(hexString: "F59E0B")).frame(width: 8, height: 8)
                Circle().fill(Color(hexString: "22C55E")).frame(width: 8, height: 8)
                Spacer()
                Text("Code")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Color(hexString: "6B7280"))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color(hexString: "F3F4F6"))

            Text(component.content)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(Color(hexString: "1F2937"))
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color(hexString: "F9FAFB"))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(cardBorder, lineWidth: 1)
        )
    }

    // Progress bar
    private var progressBarView: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(component.content)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(textMedium)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color(hexString: "E5E7EB"))

                    RoundedRectangle(cornerRadius: 4)
                        .fill(
                            LinearGradient(
                                colors: [accentBlue, Color(hexString: "6366F1")],
                                startPoint: .leading, endPoint: .trailing
                            )
                        )
                        .frame(width: geo.size.width * 0.65)
                }
            }
            .frame(height: 6)
        }
        .padding(12)
    }

    // Fallback
    private var fallbackView: some View {
        Text(component.content)
            .font(.system(size: 13))
            .foregroundStyle(textLight)
            .padding(10)
    }
}
