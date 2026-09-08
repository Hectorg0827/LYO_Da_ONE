import SwiftUI
import AVFoundation

// MARK: - Placeholder Types (these should be defined in actual models)

enum MessageType {
    case course, quiz, explanation, error, text
}

struct SpecialContent {
    var type: String
}

struct CourseProposal {
    var title: String
    var description: String
    var estimatedDuration: String
    var level: String
    var objectives: [String]
}

struct QuickExplainer {
    var title: String
    var content: String
    var estimatedReadTime: String
    var keyPoints: [String]
}

// Note: CodeBlock is defined in MultiAgentCourseModels.swift
// No local placeholder needed

struct QuizPreview {
    var questionCount: Int
    var topic: String
    var estimatedTime: String
}

struct ImageContent {
    var url: String
    var caption: String?
    var description: String
}

extension LyoMessage {
    var messageType: MessageType {
        if let _ = courseProposal {
            return .course
        }
        if let _ = quickExplainer {
            return .quiz
        }
        return .text
    }
    
    var specialContent: SpecialContent? {
        return nil // Placeholder - implement based on actual model
    }
}

// MARK: - Enhanced Message Bubble with Full Accessibility

struct AccessibleMessageBubbleView: View {
    let message: LyoMessage
    @EnvironmentObject var orchestrator: LyoOrchestrator

    @State private var isVoiceOverRunning = UIAccessibility.isVoiceOverRunning
    @State private var prefersReducedMotion = UIAccessibility.isReduceMotionEnabled
    @State private var prefersSmallerText = UIAccessibility.isBoldTextEnabled
    @State private var prefersHighContrast = UIAccessibility.isDarkerSystemColorsEnabled

    var accessibleContent: String {
        var content = message.content

        if message.isFromUser {
            content = "You said: \(content)"
        } else {
            content = "Lyo replied: \(content)"

            // Add context information for screen readers
            if let context = orchestrator.activeContext {
                content += ". Context: learning about \(context.topic)."
            }
        }

        return content
    }

    var accessibilityHint: String {
        switch message.messageType {
        case .course:
            return "This message includes course creation options. Swipe right to explore actions."
        case .quiz:
            return "This message includes quiz options. Double tap to start quiz."
        case .explanation:
            return "This is an explanation. Swipe right for follow-up questions."
        case .error:
            return "This is an error message with recovery options."
        default:
            if let actions = message.actions, !actions.isEmpty {
                return "This message has \(actions.count) action\(actions.count == 1 ? "" : "s"). Swipe right to explore."
            } else {
                return "This is a response from Lyo."
            }
        }
    }

    var body: some View {
        VStack(alignment: message.isFromUser ? .trailing : .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                if !message.isFromUser {
                    AccessibleLyoAvatarSmall()
                        .accessibilityLabel("Lyo")
                        .accessibilityHidden(isVoiceOverRunning) // Avoid redundancy
                }

                VStack(alignment: message.isFromUser ? .trailing : .leading, spacing: 12) {
                    // Main message content
                    MessageContentView(
                        content: message.content,
                        isFromUser: message.isFromUser,
                        messageType: message.messageType,
                        prefersHighContrast: prefersHighContrast,
                        prefersSmallerText: prefersSmallerText
                    )
                    .accessibilityLabel(accessibleContent)
                    .accessibilityHint(accessibilityHint)
                    .accessibilityAddTraits(message.isFromUser ? [] : [.updatesFrequently])

                    // Action buttons with enhanced accessibility
                    if let actions = message.actions, !actions.isEmpty {
                        AccessibleActionButtonsView(
                            actions: actions,
                            isFromUser: message.isFromUser
                        )
                    }

                    // Special content based on message type
                    if let specialContent = message.specialContent {
                        AccessibleSpecialContentView(
                            content: specialContent,
                            messageType: message.messageType
                        )
                    }
                }

                if message.isFromUser {
                    Spacer(minLength: 60)
                }
            }

            // Timestamp with accessibility support
            HStack {
                if message.isFromUser { Spacer() }

                Text(message.timestamp, style: .time)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .accessibilityLabel("Sent at \(message.timestamp.formatted(date: .omitted, time: .shortened))")

                if !message.isFromUser { Spacer() }
            }
        }
        .padding(.horizontal)
        .onAppear {
            setupAccessibilityNotifications()
        }
        .onChange(of: UIAccessibility.isVoiceOverRunning) { _, newValue in
            isVoiceOverRunning = newValue
        }
        .onChange(of: UIAccessibility.isReduceMotionEnabled) { _, newValue in
            prefersReducedMotion = newValue
        }
        .onChange(of: UIAccessibility.isBoldTextEnabled) { _, newValue in
            prefersSmallerText = newValue
        }
        .onChange(of: UIAccessibility.isDarkerSystemColorsEnabled) { _, newValue in
            prefersHighContrast = newValue
        }
    }

    private func setupAccessibilityNotifications() {
        // Announce new messages for VoiceOver users
        if !message.isFromUser && isVoiceOverRunning {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                UIAccessibility.post(
                    notification: .announcement,
                    argument: "New message from Lyo: \(message.content)"
                )
            }
        }
    }
}

// MARK: - Message Content View

struct MessageContentView: View {
    let content: String
    let isFromUser: Bool
    let messageType: MessageType
    let prefersHighContrast: Bool
    let prefersSmallerText: Bool

    private var backgroundColor: Color {
        if prefersHighContrast {
            return isFromUser ? .white : .black
        } else {
            return isFromUser
                ? Color(hex: "3B82F6")
                : Color.white.opacity(0.1)
        }
    }

    private var textColor: Color {
        if prefersHighContrast {
            return isFromUser ? .black : .white
        } else {
            return .white
        }
    }

    private var fontSize: CGFloat {
        let baseSize: CGFloat = 16
        return prefersSmallerText ? baseSize + 2 : baseSize
    }

    var body: some View {
        Text(content)
            .font(.system(size: fontSize, weight: .regular, design: .default))
            .foregroundColor(textColor)
            .padding(.vertical, 12)
            .padding(.horizontal, 16)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(backgroundColor)
                    .shadow(
                        color: prefersHighContrast ? .clear : .black.opacity(0.1),
                        radius: 4,
                        x: 0,
                        y: 2
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(
                        prefersHighContrast ? (isFromUser ? .black : .white) : .clear,
                        lineWidth: prefersHighContrast ? 2 : 0
                    )
            )
    }
}

// MARK: - Accessible Action Buttons

struct AccessibleActionButtonsView: View {
    let actions: [MessageAction]
    let isFromUser: Bool

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 8) {
            ForEach(actions) { action in
                AccessibleActionButton(action: action)
            }
        }
    }
}

struct AccessibleActionButton: View {
    let action: MessageAction
    @State private var isPressed = false

    // Accessibility states
    @State private var prefersHighContrast = UIAccessibility.isDarkerSystemColorsEnabled
    @State private var prefersLargerText = UIAccessibility.isBoldTextEnabled

    private var backgroundColor: Color {
        if prefersHighContrast {
            return .white
        } else {
            // Default primary style since MessageAction doesn't have style property
            return Color(hex: "3B82F6")
        }
    }

    private var textColor: Color {
        if prefersHighContrast {
            return .black
        } else {
            return .white
        }
    }

    var body: some View {
        Button {
            // Handle action via NotificationCenter or similar
            NotificationCenter.default.post(
                name: NSNotification.Name("MessageAction"),
                object: nil,
                userInfo: ["action": action]
            )
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "star.fill")
                    .font(.system(
                        size: prefersLargerText ? 16 : 14,
                        weight: .semibold
                    ))

                Text(action.label)
                    .font(.system(
                        size: prefersLargerText ? 16 : 14,
                        weight: .semibold
                    ))

                Spacer()
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 16)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(backgroundColor)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(
                                prefersHighContrast ? .black : .clear,
                                lineWidth: prefersHighContrast ? 2 : 0
                            )
                    )
            )
            .foregroundColor(textColor)
            .scaleEffect(isPressed ? 0.95 : 1.0)
        }
        .buttonStyle(PlainButtonStyle())
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    withAnimation(.spring(response: 0.1, dampingFraction: 0.6)) {
                        isPressed = true
                    }
                }
                .onEnded { _ in
                    withAnimation(.spring(response: 0.1, dampingFraction: 0.6)) {
                        isPressed = false
                    }
                }
        )
        .accessibilityLabel(action.label)
        .accessibilityHint("Activate to \(action.label)")
        .accessibilityAddTraits([.isButton])
        .onAppear {
            setupAccessibilityObservers()
        }
    }

    private func setupAccessibilityObservers() {
        NotificationCenter.default.addObserver(
            forName: UIAccessibility.darkerSystemColorsStatusDidChangeNotification,
            object: nil,
            queue: .main
        ) { _ in
            prefersHighContrast = UIAccessibility.isDarkerSystemColorsEnabled
        }

        NotificationCenter.default.addObserver(
            forName: UIAccessibility.boldTextStatusDidChangeNotification,
            object: nil,
            queue: .main
        ) { _ in
            prefersLargerText = UIAccessibility.isBoldTextEnabled
        }
    }
}

// MARK: - Special Content View

struct AccessibleSpecialContentView: View {
    let content: SpecialContent
    let messageType: MessageType

    var body: some View {
        // SpecialContent is a simple struct, not an enum
        // This view is a placeholder for accessibility previews
        Text("Special content: \(content.type)")
            .accessibilityLabel("Special \(content.type) content")
    }
}

// MARK: - Accessible Course Proposal

struct AccessibleCourseProposalView: View {
    let proposal: CourseProposal

    var accessibleDescription: String {
        var description = "Course proposal: \(proposal.title). "
        description += "Duration: \(proposal.estimatedDuration). "
        description += "Difficulty: \(proposal.level). "

        if !proposal.objectives.isEmpty {
            description += "Learning objectives: \(proposal.objectives.joined(separator: ", ")). "
        }

        description += "Double tap to create this course."

        return description
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(proposal.title)
                .font(.headline.bold())
                .foregroundColor(.white)
            
            Text("\(proposal.level) • \(proposal.estimatedDuration)")
                .font(.caption)
                .foregroundColor(.white.opacity(0.7))
            
            // Simplified for accessibility
            Text("Learning objectives: \(proposal.objectives.count) items")
                .font(.caption)
                .foregroundColor(.white.opacity(0.8))
        }
        .padding()
        .background(Color.blue.opacity(0.2))
        .cornerRadius(12)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibleDescription)
    }
}

// MARK: - Accessible Quick Explainer

struct AccessibleQuickExplainerView: View {
    let explainer: QuickExplainer

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "lightbulb.fill")
                    .font(.title2)
                    .foregroundColor(.yellow)
                    .accessibilityHidden(true)

                VStack(alignment: .leading) {
                    Text("Quick Explainer")
                        .font(.headline.bold())
                        .foregroundColor(.white)

                    Text("\(explainer.estimatedReadTime) min read")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                }

                Spacer()
            }

            ForEach(explainer.keyPoints.indices, id: \.self) { index in
                HStack(alignment: .top, spacing: 8) {
                    Text("\(index + 1).")
                        .font(.caption.bold())
                        .foregroundColor(.yellow)

                    Text(explainer.keyPoints[index])
                        .font(.body)
                        .foregroundColor(.white)
                }
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(.yellow.opacity(0.3), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Quick explainer with \(explainer.keyPoints.count) key points. \(explainer.estimatedReadTime) minutes to read.")
    }
}

// MARK: - Accessible Code Block

struct AccessibleCodeBlockView: View {
    let code: CodeBlock

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(code.language.uppercased())
                .font(.caption.bold())
                .foregroundColor(.green)
            
            Text(String(code.code.prefix(100)) + (code.code.count > 100 ? "..." : ""))
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(.white.opacity(0.8))
                .lineLimit(3)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .stroke(.green.opacity(0.3), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(code.language) code block")
    }
}

// MARK: - Small Lyo Avatar for Messages

struct AccessibleLyoAvatarSmall: View {
    @State private var prefersHighContrast = UIAccessibility.isDarkerSystemColorsEnabled

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: prefersHighContrast
                            ? [.white, .gray]
                            : [Color(hex: "FFB74D"), Color(hex: "FF8C00")],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 32, height: 32)
                .shadow(
                    color: prefersHighContrast ? .clear : Color(hex: "FF8C00").opacity(0.3),
                    radius: 4,
                    x: 0,
                    y: 2
                )

            Group {
                if let avatarImage = UIImage(named: "LyoAvatar") {
                    Image(uiImage: avatarImage)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 28, height: 28)
                } else {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 16))
                        .foregroundColor(prefersHighContrast ? .black : .white)
                }
            }
        }
        .onAppear {
            setupAccessibilityObserver()
        }
    }

    private func setupAccessibilityObserver() {
        NotificationCenter.default.addObserver(
            forName: UIAccessibility.darkerSystemColorsStatusDidChangeNotification,
            object: nil,
            queue: .main
        ) { _ in
            prefersHighContrast = UIAccessibility.isDarkerSystemColorsEnabled
        }
    }
}

// MARK: - Enhanced Discover View

struct AccessibleDiscoverView: View {
    @EnvironmentObject var orchestrator: LyoOrchestrator
    @State private var currentTopic: String?
    @State private var aiSuggestedClips: [DiscoverClip] = []

    // Accessibility states
    @State private var isVoiceOverRunning = UIAccessibility.isVoiceOverRunning
    @State private var prefersReducedMotion = UIAccessibility.isReduceMotionEnabled

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                // AI-Suggested Content Section
                if !aiSuggestedClips.isEmpty {
                    AccessibleAISuggestedSection(clips: aiSuggestedClips)
                        .accessibilityElement(children: .contain)
                        .accessibilityLabel("AI recommended content")
                }

                // Regular clips
                ForEach(clips) { clip in
                    AccessibleClipView(clip: clip)
                        .overlay(alignment: .bottomTrailing) {
                            // AI Ask Button (like YouTube Gemini)
                            AccessibleLyoAskButton(clip: clip) {
                                askLyoAboutClip(clip)
                            }
                        }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Discover content feed")
        .accessibilityHint("Scroll to browse learning videos and content")
        .onReceive(orchestrator.$activeContext) { context in
            if let topic = context?.topic {
                loadRelatedClips(topic: topic)
            }
        }
        .onAppear {
            setupAccessibilityObservers()
        }
    }

    private func askLyoAboutClip(_ clip: DiscoverClip) {
        let context = LearningContext(
            topic: clip.subject,
            learningLevel: .intermediate,
            contentType: .video,
            source: .discover,
            timestamp: Date(),
            clipId: clip.id.uuidString,
            complexity: .moderate
        )

        Task {
            await orchestrator.processUserMessage(
                "Tell me more about this video content",
                currentContext: context
            )
        }

        // Announce for VoiceOver
        if isVoiceOverRunning {
            UIAccessibility.post(
                notification: .announcement,
                argument: "Asking Lyo about \(clip.title)"
            )
        }
    }

    // Placeholder implementations
    private var clips: [DiscoverClip] { [] }
    private func loadRelatedClips(topic: String) {}
    private func setupAccessibilityObservers() {}
}

// MARK: - Accessible Clip View

struct AccessibleClipView: View {
    let clip: DiscoverClip

    var accessibilityDescription: String {
        var description = "Video: \(clip.title)"
        description += ". By \(clip.creator)"
        description += ". Duration: \(clip.duration)"
        description += ". Subject: \(clip.subject)"
        description += ". \(clip.viewCount) views"
        return description
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Video thumbnail with accessibility image
            LyoImage(url: URL(string: clip.thumbnailURL)) { image in
                image
                    .resizable()
                    .aspectRatio(16/9, contentMode: .fill)
            } placeholder: {
                Rectangle()
                    .fill(.gray.opacity(0.3))
                    .aspectRatio(16/9, contentMode: .fill)
                    .overlay(
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle())
                    )
            }
            .clipped()
            .cornerRadius(12)
            .accessibilityLabel("Video thumbnail for \(clip.title)")

            // Content info
            VStack(alignment: .leading, spacing: 8) {
                Text(clip.title)
                    .font(.headline)
                    .foregroundColor(.white)
                    .lineLimit(2)

                HStack {
                    Text(clip.creator)
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))

                    Spacer()

                    Text(clip.duration)
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                }

                HStack {
                    Text(clip.subject)
                        .font(.caption2)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.blue.opacity(0.2))
                        .foregroundColor(.blue)
                        .cornerRadius(8)

                    Spacer()

                    Text("\(clip.viewCount) views")
                        .font(.caption2)
                        .foregroundColor(.white.opacity(0.6))
                }
            }
            .padding(.horizontal, 12)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityDescription)
        .accessibilityAddTraits([.isButton])
        .accessibilityHint("Double tap to play video")
    }
}

// MARK: - Accessible AI Ask Button

struct AccessibleLyoAskButton: View {
    let clip: DiscoverClip
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 6) {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 14, weight: .semibold))

                Text("Ask Lyo")
                    .font(.caption.bold())
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 12)
            .background(
                Capsule()
                    .fill(Color(hex: "FF8C00"))
                    .shadow(color: .black.opacity(0.2), radius: 4, x: 0, y: 2)
            )
            .foregroundColor(.white)
        }
        .padding([.bottom, .trailing], 12)
        .accessibilityLabel("Ask Lyo about \(clip.title)")
        .accessibilityHint("Double tap to ask LYO about this video content")
        .accessibilityAddTraits([.isButton])
    }
}

// MARK: - Supporting Models (Local placeholders for accessibility previews only)
// Note: These are local types to avoid conflicts with actual model definitions

enum AccessibilityMessageType {
    case text, course, quiz, explanation, error
}

enum AccessibilitySpecialContent {
    case courseProposal(AccessibilityCourseProposal)
    case quickExplainer(AccessibilityQuickExplainer)
    case quiz(AccessibilityQuizPreview)
    case codeBlock(language: String, content: String)
    case imageContent(url: String, description: String)
}

struct AccessibilityCourseProposal {
    let title: String
    let level: String
    let estimatedDuration: String
    let objectives: [String]
    let onAccept: () -> Void
}

struct AccessibilityQuickExplainer {
    let keyPoints: [String]
    let estimatedReadTime: Int
}

struct AccessibilityQuizPreview {
    let questionCount: Int
    let estimatedTime: String
}

struct DiscoverClip: Identifiable {
    let id = UUID()
    let title: String
    let creator: String
    let duration: String
    let subject: String
    let viewCount: String
    let thumbnailURL: String
}

struct AccessibleAISuggestedSection: View {
    let clips: [DiscoverClip]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "sparkles")
                    .foregroundColor(.yellow)
                Text("Recommended for You")
                    .font(.headline.bold())
                    .foregroundColor(.white)
                Spacer()
            }
            .padding(.horizontal)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(clips) { clip in
                        AccessibleClipView(clip: clip)
                            .frame(width: 280)
                    }
                }
                .padding(.horizontal)
            }
        }
        .padding(.vertical)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("AI recommended videos section")
    }
}

// Placeholder for AccessibleQuizPreviewView
struct AccessibleQuizPreviewView: View {
    let quiz: QuizPreview

    var body: some View {
        Text("Quiz with \(quiz.questionCount) questions")
            .accessibilityLabel("Quiz preview: \(quiz.questionCount) questions, estimated time \(quiz.estimatedTime)")
    }
}

// Placeholder for AccessibleImageContentView
struct AccessibleImageContentView: View {
    let image: ImageContent

    var body: some View {
        AsyncImage(url: URL(string: image.url)) { image in
            image.resizable().aspectRatio(contentMode: .fit)
        } placeholder: {
            ProgressView()
        }
        .accessibilityLabel(image.description)
    }
}