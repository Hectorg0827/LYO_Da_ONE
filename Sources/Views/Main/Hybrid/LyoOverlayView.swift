import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers

struct LyoOverlayView: View {
    @Binding var isPresented: Bool
    var startFrame: CGRect // The frame of the tab bar button
    
    @EnvironmentObject var viewModel: LyoAIViewModel
    @EnvironmentObject var rootViewModel: RootViewModel
    @ObservedObject var conversationManager = ConversationManager.shared
    @StateObject var notebookStore = NotebookStore()
    @State private var showNotesSheet = false
    
    @State private var animationState: AnimationState = .initial
    @State private var isThinking = false
    @State private var showVoiceSheet = false
    @State private var showGreeting = false
    @State private var showHistory = false
    @State private var selectedMode: ChatMode = .chat
    @State private var greetingMessageIndex = Int.random(in: 0..<6)
    @State private var avatarFloatOffset: CGFloat = 0
    @State private var thinkingRotation: Double = 0
    
    // Rotating motivational messages
    private let motivationalMessages = [
        "What would you like to learn today?",
        "Ready to embark on a learning journey?",
        "What's on your mind?",
        "Let's explore something new together!",
        "What skill shall we master today?",
        "I'm here to help you grow!"
    ]
    
    // User's first name
    private var userFirstName: String {
        if let name = rootViewModel.currentUser?.name {
            return name.components(separatedBy: " ").first ?? name
        }
        return "there"
    }
    
    enum AnimationState {
        case initial // At tab bar position
        case active // Center screen
        case chatting // Small in chat
    }

    private var hasAssistantPlaceholderBubble: Bool {
        viewModel.messages.contains { message in
            guard !message.isFromUser else { return false }
            guard let contentTypes = message.contentTypes else { return false }

            return contentTypes.contains { contentType in
                switch contentType {
                case .processing:
                    return true
                default:
                    return false
                }
            }
        }
    }

    // ChatMessage struct removed, using LyoMessage from ViewModel
    
    var body: some View {
        overlayContent
    }

    private var overlayContent: some View {
        GeometryReader { geometry in
            ZStack {
                overlayBackground
                mainContentStack
                avatarLayer(geometry: geometry)
                widgetLayer
                a2aLayer
                headerBarLayer
            }
        }
        .onAppear {
            greetingMessageIndex = Int.random(in: 0..<motivationalMessages.count)
            if !viewModel.messages.isEmpty {
                animationState = .chatting
            } else {
                withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
                    animationState = .active
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                withAnimation(.easeInOut(duration: 0.5)) { showGreeting = true }
            }
            withAnimation(.easeInOut(duration: 2.5).repeatForever(autoreverses: true)) {
                avatarFloatOffset = 10
            }
            withAnimation(.linear(duration: 1.0).repeatForever(autoreverses: false)) {
                thinkingRotation = 360
            }
            if let convId = conversationManager.currentConversation?.id {
                notebookStore.activateConversation(convId)
            }
        }
        .sheet(isPresented: $showHistory) {
            ChatHistoryView(
                onSelectConversation: { conversation in loadConversation(conversation) },
                onNewChat: { createNewChat() }
            )
        }
        .sheet(isPresented: $showVoiceSheet) {
            VoiceSessionBottomSheet(viewModel: viewModel)
        }
        .onChange(of: viewModel.isVoiceActive) { _, newValue in
            if newValue { showVoiceSheet = true }
        }
        .sheet(isPresented: $showNotesSheet) {
            ChatNotesSheetView(
                store: notebookStore,
                isPresented: $showNotesSheet,
                onExplainFurther: { note in
                    showNotesSheet = false
                    viewModel.inputText = "Explain this further: \(note.text)"
                    submitText()
                },
                onBranchToNewChat: { note in
                    showNotesSheet = false
                    branchToNewChat(seedText: note.text)
                }
            )
        }
        .onChange(of: conversationManager.currentConversation?.id) { _, newId in
            if let id = newId { notebookStore.activateConversation(id) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .dismissLyoOverlay)) { _ in
            self.close()
        }
    }

    private var overlayBackground: some View {
        Group {
            if animationState != .initial {
                ZStack {
                    // Dark underlay for better text contrast
                    Color.black.opacity(0.75).ignoresSafeArea()
                    
                    Rectangle()
                        .fill(.ultraThinMaterial)
                        .ignoresSafeArea()
                }
                .onTapGesture {
                    if animationState == .active { close() }
                }
            }
        }
    }

    private var mainContentStack: some View {
        VStack(spacing: 0) {
            if animationState == .chatting {
                chatMessagesView
            } else {
                greetingAreaView
            }
            suggestionsRow
            inputBarRow
        }
    }

    private var chatMessagesView: some View {
        ScrollViewReader { proxy in
            chatScrollContent
                .onChange(of: viewModel.messages) { _, newMessages in
                    if let lastId = newMessages.last?.id {
                        withAnimation { proxy.scrollTo(lastId, anchor: .bottom) }
                    }
                }
                .onChange(of: isThinking) { _, thinking in
                    if thinking { withAnimation { proxy.scrollTo("thinking", anchor: .bottom) } }
                    else { HapticManager.shared.light() }
                }
        }
    }

    private var chatScrollContent: some View {
        ScrollView {
            VStack(spacing: 24) {
                ForEach(viewModel.messages) { message in
                    messageBubble(for: message)
                }
                if isThinking && !hasAssistantPlaceholderBubble {
                    LyoThinkingView()
                        .id("thinking")
                        .padding(.leading, 12)
                }
            }
            .padding(.top, 60)
            .padding(.bottom, 20)
        }
    }

    @ViewBuilder
    private func messageBubble(for message: LyoMessage) -> some View {
        EnhancedMessageBubble(
            message: MultimodalMessage(from: message),
            onTTSToggle: nil,
            onQuizAnswer: { index in
                // Notify the AI of the user's selected option index
                viewModel.inputText = "I selected option \(index + 1) in the quiz."
                submitText()
            },
            onCourseOpen: { id in
                NotificationCenter.default.post(
                    name: Notification.Name("openClassroom"),
                    object: nil,
                    userInfo: ["courseId": id, "topic": id, "courseTitle": id, "lessonId": "intro_1", "lessonTitle": "Introduction", "shouldGenerateCourse": false]
                )
            },
            onTopicSelect: nil,
            onModuleSelect: { module in
                // Directly launch the classroom with the selected module topic!
                NotificationCenter.default.post(
                    name: Notification.Name("openClassroom"),
                    object: nil,
                    userInfo: [
                        "courseId": UUID().uuidString,
                        "topic": module.title,
                        "courseTitle": module.title,
                        "lessonId": "intro_1",
                        "lessonTitle": "Introduction",
                        "shouldGenerateCourse": true
                    ]
                )
            },
            onSuggestionSelect: { suggestion in
                viewModel.inputText = suggestion
                submitText()
            },
            onSuggestedAction: { card in
                handleSuggestedAction(card)
            },
            highlights: notebookStore.highlights(for: message.id),
            onTextSelectionAction: { action in
                handleTextSelectionAction(action, messageId: message.id, isFromUser: message.isFromUser)
            },
            onSmartQuizAnswer: { blockId, index in
                viewModel.answerSmartQuizCheck(messageId: message.id, blockId: blockId, selectedIndex: index)
            }
        )
        .id(message.id)
    }

    private var greetingAreaView: some View {
        VStack {
            Spacer()
            if animationState == .active && showGreeting {
                VStack(spacing: 16) {
                    Text("Hello, \(userFirstName)!")
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                        .foregroundStyle(LinearGradient(colors: [.white, Color(hex: "FF8C00")], startPoint: .leading, endPoint: .trailing))
                        .multilineTextAlignment(.center)
                        .transition(.opacity.combined(with: .scale(scale: 0.9)))
                    Text(motivationalMessages[greetingMessageIndex])
                        .font(.system(size: 18, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))
                        .multilineTextAlignment(.center)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
                .padding(.horizontal, 40)
                .padding(.bottom, 250)
            }
            Spacer()
        }
    }

    private var suggestionsRow: some View {
        Group {
            if animationState == .active && !viewModel.suggestions.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(viewModel.suggestions) { chip in
                            LyoSuggestionChip(text: chip.text) {
                                viewModel.inputText = chip.text
                                submitText()
                            }
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.bottom, 4)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    private var inputBarRow: some View {
        Group {
            if animationState != .initial {
                HybridInputBar(
                    text: $viewModel.inputText,
                    isListening: Binding(
                        get: { viewModel.isVoiceActive },
                        set: { active in
                            if active { viewModel.startListening() } else { viewModel.stopListening() }
                        }
                    ),
                    selectedMode: $selectedMode,
                    isThinking: isThinking,
                    onSubmit: { submitText() }
                )
                .padding(.bottom, 0)
                .transition(.move(edge: .bottom))
            }
        }
    }

    @ViewBuilder
    private func avatarLayer(geometry: GeometryProxy) -> some View {
        if animationState == .active {
            ZStack {
                Circle()
                    .fill(RadialGradient(
                        colors: [Color(hex: "FF8C00").opacity(0.5), Color(hex: "FF8C00").opacity(0.1), Color.clear],
                        center: .center, startRadius: 0, endRadius: 140
                    ))
                    .frame(width: 280, height: 280)
                    .blur(radius: 25)
                if viewModel.isLiveMode && !viewModel.lastLiveTranscript.isEmpty {
                    VStack {
                        Spacer().frame(height: 320)
                        Text(viewModel.lastLiveTranscript)
                            .font(.system(size: 18, weight: .medium, design: .rounded))
                            .foregroundColor(.white)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                            .background(.ultraThinMaterial)
                            .cornerRadius(20)
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                            .id(viewModel.lastLiveTranscript)
                    }
                }
                LyoAvatarView(
                    size: 200,
                    isListening: viewModel.isVoiceActive || viewModel.isLiveMode,
                    isThinking: viewModel.isAIThinking || viewModel.isLiveMode,
                    isLiveMode: viewModel.isLiveMode,
                    isSpeaking: viewModel.isAISpeaking,
                    userLevel: viewModel.userLiveAudioLevel,
                    aiLevel: viewModel.aiLiveAudioLevel
                )
            }
            .position(x: geometry.size.width / 2, y: geometry.size.height / 2 - 50 + avatarFloatOffset)
            .transition(.opacity.combined(with: .scale))
        } else if animationState == .initial {
            LyoAvatarView(size: 60, isListening: false, isThinking: false, isLiveMode: false, isSpeaking: false)
                .position(x: startFrame.midX, y: startFrame.midY)
        }
    }

    private var widgetLayer: some View {
        Group {
            if let widget = viewModel.activeLiveWidget {
                LiveStageWidgetView(widget: widget)
                    .transition(.asymmetric(
                        insertion: .move(edge: .top).combined(with: .opacity),
                        removal: .move(edge: .bottom).combined(with: .opacity)
                    ))
                    .offset(y: animationState == .active ? -220 : -120)
                    .zIndex(150)
                    .onTapGesture { withAnimation { viewModel.activeLiveWidget = nil } }
            }
        }
    }

    private var a2aLayer: some View {
        Group {
            if viewModel.showA2AProgressView {
                ZStack {
                    Color.black.opacity(0.4).ignoresSafeArea()
                    A2AProgressView().padding(.horizontal, 24).shadow(radius: 20)
                }
                .transition(.opacity)
                .zIndex(200)
            }
        }
    }

    private var headerBarLayer: some View {
        Group {
            if animationState != .initial {
                VStack {
                    HStack(spacing: 16) {
                        Button(action: { showHistory = true }) {
                            Image(systemName: "list.bullet")
                                .font(.title3)
                                .foregroundColor(.white.opacity(0.8))
                                .frame(width: 40, height: 40)
                                .background(Color.white.opacity(0.1))
                                .clipShape(Circle())
                        }
                        Spacer()
                        NotebookIconButton(store: notebookStore, showSheet: $showNotesSheet)
                        Button(action: createNewChat) {
                            Image(systemName: "square.and.pencil")
                                .font(.title3)
                                .foregroundColor(.white.opacity(0.8))
                                .frame(width: 40, height: 40)
                                .background(Color.white.opacity(0.1))
                                .clipShape(Circle())
                        }
                        Button(action: close) {
                            Image(systemName: "xmark")
                                .font(.body.weight(.semibold))
                                .foregroundColor(.white.opacity(0.8))
                                .frame(width: 40, height: 40)
                                .background(Color.white.opacity(0.1))
                                .clipShape(Circle())
                        }
                    }
                    .padding(.horizontal)
                    .padding(.top, 8)
                    Spacer()
                }
            }
        }
    }

    private var greetingText: String {
        return "Hello, \(userFirstName)!"
    }
    
    private func close() {
        withAnimation(.spring(response: 0.6, dampingFraction: 0.7)) {
            animationState = .initial
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            isPresented = false
        }
    }
    
    private func createNewChat() {
        let conversation = conversationManager.createNewConversation()
        notebookStore.activateConversation(conversation.id)
        viewModel.messages.removeAll()
        // Add personalized welcome message
        let welcomeMessage = "Hello, \(userFirstName)! I'm Lyo, your AI learning assistant. \(motivationalMessages.randomElement() ?? "What would you like to learn today?")"
        viewModel.messages.append(LyoMessage(
            id: UUID().uuidString,
            content: welcomeMessage,
            isFromUser: false,
            timestamp: Date()
        ))
        HapticManager.shared.playSuccess()
    }
    
    private func loadConversation(_ conversation: SavedConversation) {
        // Clear current messages and load from saved conversation
        viewModel.messages.removeAll()
        notebookStore.activateConversation(conversation.id)
        for message in conversation.messages {
            var lyoMsg = LyoMessage(
                id: message.id,
                content: message.content,
                isFromUser: message.role == .user,
                timestamp: message.timestamp
            )
            lyoMsg.contentTypes = message.contentTypes
            viewModel.messages.append(lyoMsg)
        }
        conversationManager.loadConversation(conversation)
        withAnimation {
            animationState = .chatting
        }
    }
    
    // MARK: - Text Selection Actions
    
    private func handleTextSelectionAction(_ action: TextSelectionAction, messageId: String, isFromUser: Bool) {
        switch action {
        case .copy(let text):
            UIPasteboard.general.string = text
            HapticManager.shared.playLightImpact()
            
        case .note(let selectedText, _):
            let context = isFromUser ? "My Question" : "Lyo's Explanation"
            notebookStore.saveNote(
                text: selectedText,
                messageId: messageId,
                sourceContext: context
            )
            HapticManager.shared.playSuccess()
            
        case .highlight(let selectedText, let range):
            notebookStore.saveHighlight(
                text: selectedText,
                range: range,
                messageId: messageId
            )
            HapticManager.shared.playMediumImpact()
            
        case .explain(let text):
            viewModel.inputText = "Explain this: \(text)"
            submitText()
        }
    }
    
    private func branchToNewChat(seedText: String) {
        let conversation = conversationManager.createNewConversation()
        notebookStore.activateConversation(conversation.id)
        viewModel.messages.removeAll()
        
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            viewModel.inputText = "Let's explore this topic: \(seedText)"
            submitText()
        }
    }
    
    /// Stage A — primary tap on a SuggestedActionCard (under Lyo's reply).
    ///
    /// `.guidedLesson` opens the classroom on the card's topic.
    /// `.studyPlan` posts the plan request back into the chat so Lyo can
    /// build the plan inline (no persistence yet — that's Stage B).
    private func handleSuggestedAction(_ card: SuggestedActionCard) {
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()

        switch card.kind {
        case .guidedLesson:
            // card.title is always a CTA/question ("Open a guided lesson on this topic?")
            // — never use it as a topic. If the card was built before the user named a
            // topic (payload.topic/subject nil), fall back to the latest user message
            // with conversational preamble stripped so the backend sees a clean subject.
            let lastUserMessage = viewModel.messages.last(where: { $0.isFromUser })?.content
            let fallbackUserText = lastUserMessage.map {
                Self.stripTopicPreamble($0.trimmingCharacters(in: .whitespacesAndNewlines))
            }
            let resolvedTopic = (card.payload.topic ?? card.payload.subject ?? fallbackUserText)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard let topic = resolvedTopic, !topic.isEmpty else {
                // No grounded topic — ask instead of opening a classroom with garbage.
                viewModel.inputText = "What topic should the guided lesson cover?"
                return
            }
            NotificationCenter.default.post(
                name: Notification.Name("openClassroom"),
                object: nil,
                userInfo: [
                    "courseId": "GENERATE:\(topic)",
                    "topic": topic,
                    "courseTitle": topic,
                    "lessonId": "intro_1",
                    "lessonTitle": "Introduction",
                    "shouldGenerateCourse": true,
                ]
            )

        case .studyPlan:
            // The plan lives in this chat thread and nowhere else.
            //
            // There used to be a fire-and-forget call here claiming to
            // "persist the plan to backend so it survives app restart". It
            // did not. It POSTed to /api/v1/me/study_plans, a path the server
            // registers for GET only, so every call was a 405 — and `try?`
            // swallowed it, so nothing ever surfaced. The rest of
            // StudyPlanService was worse than unused: its model could not
            // decode what the server sends (`id` is a UUID string, not an
            // Int, and `subject`/`topics`/`daily_breakdown` do not exist on
            // StudyPlanRead at all), so had anything called it, it would have
            // thrown on the first response.
            //
            // The server does build durable plans, through a conversational
            // intake — POST /me/study_plans/intake/turn, then
            // /plans/generate — which produces a TestProfile, a StudyPlan and
            // its StudySessions. Wiring iOS to that is a real feature and is
            // not done. Leaving a call that looks like persistence in its
            // place is worse than the gap, because it hides the gap.
            //
            // See docs/CLASSROOM_ARCHITECTURE.md §7.4.

            // Re-prompt Lyo with a structured planning request so the AI builds
            // the plan inline. The chat thread becomes the plan thread.
            var prompt = "Please build a study plan"
            if let subject = card.payload.subject { prompt += " for my \(subject)" }
            if let deadline = card.payload.deadline { prompt += " for the \(deadline) test" }
            if !card.payload.topics.isEmpty {
                prompt += ". The topics are: " + card.payload.topics.joined(separator: ", ")
            }
            prompt += ". Show the daily breakdown and what I should do today."
            viewModel.inputText = prompt
            submitText()
        }
    }

    /// Strip conversational preamble from a user message so it can serve as a topic.
    /// "Create a course on pre calculus" → "pre calculus".
    /// Returns the original string if no known preamble matches.
    private static func stripTopicPreamble(_ text: String) -> String {
        let lower = text.lowercased()
        let preambles = [
            "create a course on ", "create a course about ", "create a course for me on ",
            "make a course on ", "make a course about ",
            "build a course on ", "build a course about ",
            "teach me about ", "teach me ",
            "i want to learn about ", "i want to learn ",
            "i'd like to learn about ", "i'd like to learn ",
            "help me learn about ", "help me learn ",
            "start a class on ", "start a class about ",
            "open a guided lesson on ", "open a guided lesson about ",
            "give me a lesson on ", "give me a lesson about ",
            "show me ", "explain "
        ]
        for prefix in preambles where lower.hasPrefix(prefix) {
            let stripped = String(text.dropFirst(prefix.count))
                .trimmingCharacters(in: CharacterSet(charactersIn: " .?!,;:"))
            if !stripped.isEmpty { return stripped }
        }
        return text
    }

    private func submitText() {
        guard !viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !viewModel.attachments.isEmpty else { return }
        
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
        
        // Trigger thinking animation and transition to chatting state
        withAnimation {
            isThinking = true
            showGreeting = false
            // Transition to chatting state immediately when sending
            if animationState == .active {
                animationState = .chatting
            }
        }
        
        Task {
            await viewModel.sendMessage(mode: selectedMode.rawValue)
            
            await MainActor.run {
                withAnimation {
                    isThinking = false
                }
                
                // Haptic: Response Received
                let responseGenerator = UINotificationFeedbackGenerator()
                responseGenerator.notificationOccurred(.success)
            }
        }
    }
}

// MARK: - Chat Mode Enum
enum ChatMode: String, CaseIterable {
    case chat = "Chat"
    case study = "Study"
    case course = "Course"
    case quiz = "Quiz"
    case tutor = "Tutor"
    
    var icon: String {
        switch self {
        case .chat: return "bubble.left.fill"
        case .study: return "book.fill"
        case .course: return "graduationcap.fill"
        case .quiz: return "checkmark.circle.fill"
        case .tutor: return "person.fill.questionmark"
        }
    }
}

// MARK: - Thinking Bubble


struct LyoSuggestionChip: View {
    let text: String
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            Text(text)
                .foregroundColor(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.1))
                .cornerRadius(20)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(Color.white.opacity(0.2), lineWidth: 1)
                )
        }
    }
}


struct HybridInputBar: View {
    @Binding var text: String
    @Binding var isListening: Bool
    @Binding var selectedMode: ChatMode
    var isThinking: Bool // Passed from parent
    var onSubmit: () -> Void
    
    @EnvironmentObject var viewModel: LyoAIViewModel
    @StateObject var audioService = AudioPlaybackService.shared
    @StateObject private var mediaService = MediaPickerService.shared
    
    @State private var showModeSelector = false
    @State private var showAttachmentMenu = false
    @State private var showPhotoPicker = false
    @State private var showDocumentPicker = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var isUploading = false
    @State private var attachmentError: String?
    @State private var gradientRotation = 0.0
    
    var isSpeaking: Bool { audioService.isPlaying }
    
    // Gradient colors for animations
    private let thinkingColors = [Color(hex: "6366F1"), Color(hex: "8B5CF6"), Color(hex: "EC4899")]
    private let respondingColors = [Color(hex: "10B981"), Color(hex: "34D399"), Color(hex: "6EE7B7")]
    private let idleColors = [Color.white.opacity(0.2), Color.white.opacity(0.1)]

    private var canSend: Bool {
        (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !mediaService.selectedMedia.isEmpty)
            && !isThinking
            && !isUploading
            && !mediaService.isLoading
    }
    
    var body: some View {
        ZStack {
            // Island Container
            VStack(spacing: 0) {
                if !mediaService.selectedMedia.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(mediaService.selectedMedia) { media in
                                MediaPreviewChip(media: media) {
                                    mediaService.removeMedia(media)
                                }
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 10)
                    }
                }

                if let attachmentError {
                    Text(attachmentError)
                        .font(.caption2)
                        .foregroundColor(.red.opacity(0.9))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.top, 6)
                        .accessibilityLabel("Attachment error: \(attachmentError)")
                }

                // Top Line: Text Input
                TextField("Message Lyo...", text: $text, axis: .vertical)
                    .lineLimit(1...3) // Dynamic height, max 3 lines
                    .foregroundColor(.white)
                    .font(.system(size: 16))
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 8)
                    .submitLabel(.send)
                    .onSubmit {
                        submitAction()
                    }
                
                // Bottom Line: Selectors & Actions
                HStack(spacing: 12) {
                    // LEFT: Add & Mode
                    HStack(spacing: 8) {
                        // Add Button
                        Button(action: { showAttachmentMenu = true }) {
                            Image(systemName: (isUploading || mediaService.isLoading) ? "arrow.triangle.2.circlepath" : "plus")
                                .font(.system(size: 18, weight: .light))
                                .foregroundColor(.white.opacity(0.8))
                                .frame(width: 32, height: 32)
                                .background(Color.white.opacity(0.1))
                                .clipShape(Circle())
                                .rotationEffect(.degrees((isUploading || mediaService.isLoading) ? 360 : 0))
                                .animation(
                                    (isUploading || mediaService.isLoading)
                                        ? .linear(duration: 1).repeatForever(autoreverses: false)
                                        : .default,
                                    value: isUploading || mediaService.isLoading
                                )
                        }
                        .disabled(
                            isThinking || isUploading || mediaService.isLoading
                                || mediaService.selectedMedia.count >= mediaService.maxAttachmentCount
                        )
                        .accessibilityLabel("Attach an image or document")
                        
                        // Mode Button
                        Button(action: { showModeSelector = true }) {
                            HStack(spacing: 4) {
                                Image(systemName: selectedMode.icon)
                                    .font(.system(size: 12))
                                Text(selectedMode.rawValue)
                                    .font(.system(size: 12, weight: .medium))
                            }
                            .foregroundColor(.white.opacity(0.9))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.white.opacity(0.1))
                            .clipShape(Capsule())
                        }
                    }
                    
                    Spacer()
                    
                    // RIGHT: Mic, Live, Send
                    HStack(spacing: 8) {
                        if canSend {
                            // Send Button
                            Button(action: submitAction) {
                                Image(systemName: "arrow.up")
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundColor(.black)
                                    .frame(width: 32, height: 32)
                                    .background(Color.white)
                                    .clipShape(Circle())
                            }
                            .disabled(!canSend)
                            .transition(.scale.combined(with: .opacity))
                        } else {
                            // Mic (TTS)
                            Button(action: { isListening.toggle() }) {
                                Image(systemName: isListening ? "waveform" : "mic")
                                    .font(.system(size: 18))
                                    .foregroundColor(.white.opacity(0.9))
                                    .frame(width: 32, height: 32)
                            }
                            
                            // Live Mode
                            Button(action: { viewModel.toggleLiveMode() }) {
                                Image(systemName: viewModel.isLiveMode ? "waveform" : "video")
                                    .font(.system(size: 18))
                                    .foregroundColor(viewModel.isLiveMode ? Color(hex: "FF8C00") : .white.opacity(0.9))
                                    .frame(width: 32, height: 32)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
            .background(Color.black) // Island Background
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .overlay(
                RoundedRectangle(cornerRadius: 24)
                    .stroke(
                        AngularGradient(
                            colors: viewModel.isAIThinking ? thinkingColors : (viewModel.isAISpeaking ? respondingColors : idleColors),
                            center: .center,
                            angle: .degrees(gradientRotation)
                        ),
                        lineWidth: 1.5
                    )
            )
            .shadow(color: viewModel.isAIThinking ? thinkingColors[0].opacity(0.4) : (viewModel.isAISpeaking ? respondingColors[0].opacity(0.4) : Color.black.opacity(0.3)), radius: (viewModel.isAIThinking || viewModel.isAISpeaking) ? 15 : 10)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10) // Lift slightly
        .onAppear {
            withAnimation(.linear(duration: 3).repeatForever(autoreverses: false)) {
                gradientRotation = 360
            }
        }
        .confirmationDialog("Add to chat", isPresented: $showAttachmentMenu) {
            Button("Photo Library") { showPhotoPicker = true }
            Button("Files") { showDocumentPicker = true }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Attach up to four images, PDFs, or text documents.")
        }
        .photosPicker(
            isPresented: $showPhotoPicker,
            selection: $photoItems,
            maxSelectionCount: max(1, mediaService.maxAttachmentCount - mediaService.selectedMedia.count),
            matching: .images
        )
        .onChange(of: photoItems) { _, newItems in
            guard !newItems.isEmpty else { return }
            Task { @MainActor in
                attachmentError = nil
                await mediaService.processPhotoPickerItems(newItems)
                if let error = mediaService.error {
                    attachmentError = error.localizedDescription
                }
                photoItems = []
            }
        }
        .fileImporter(
            isPresented: $showDocumentPicker,
            allowedContentTypes: mediaService.supportedDocTypes,
            allowsMultipleSelection: true
        ) { result in
            Task { @MainActor in
                attachmentError = nil
                do {
                    let urls = try result.get()
                    let remaining = max(
                        0, mediaService.maxAttachmentCount - mediaService.selectedMedia.count
                    )
                    for url in urls.prefix(remaining) {
                        _ = try await mediaService.processDocumentURL(url)
                    }
                    if urls.count > remaining {
                        attachmentError = "You can attach up to four files."
                    }
                } catch {
                    attachmentError = error.localizedDescription
                }
            }
        }
        .confirmationDialog("Select Mode", isPresented: $showModeSelector) {
            ForEach(ChatMode.allCases, id: \.self) { mode in
                Button {
                    selectedMode = mode
                } label: {
                    Label(mode.rawValue, systemImage: mode.icon)
                }
            }
        }
    }
    
    private func submitAction() {
        guard canSend else { return }
        // Close keyboard
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)

        guard !mediaService.selectedMedia.isEmpty else {
            onSubmit()
            return
        }

        Task { @MainActor in
            isUploading = true
            attachmentError = nil
            do {
                var uploaded: [MessageAttachment] = []
                for media in mediaService.selectedMedia {
                    uploaded.append(try await mediaService.uploadMedia(media))
                }
                uploaded.forEach { attachment in
                    viewModel.addAttachment(attachment)
                }
                mediaService.clearSelection()
                isUploading = false
                onSubmit()
            } catch {
                attachmentError = error.localizedDescription
                isUploading = false
                HapticManager.shared.playError()
            }
        }
    }
}



// Helper Shape (since iOS 16 doesn't fully expose UnevenRoundedRectangle in all contexts without check)
struct CustomRoundedCorner: Shape {
    var radius: CGFloat = .infinity
    var corners: UIRectCorner = .allCorners

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

// MARK: - Attachment Picker Sheet

struct AttachmentPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationStack {
            List {
                Button {
                    // Camera action
                    dismiss()
                } label: {
                    Label("Camera", systemImage: "camera.fill")
                }
                
                Button {
                    // Photo library action
                    dismiss()
                } label: {
                    Label("Photo Library", systemImage: "photo.on.rectangle")
                }
                
                Button {
                    // Document action
                    dismiss()
                } label: {
                    Label("Document", systemImage: "doc.fill")
                }
                
                Button {
                    // Link action
                    dismiss()
                } label: {
                    Label("Paste Link", systemImage: "link")
                }
            }
            .navigationTitle("Add Attachment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.height(280)])
    }
}
