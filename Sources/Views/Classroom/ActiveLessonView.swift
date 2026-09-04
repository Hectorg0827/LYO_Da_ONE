import SwiftUI

/// Active Lesson screen.
///
/// Redesigned to be a premium, alive, swipe-based living AI classroom experience.
/// Implements:
/// 1. Swipe-based scene navigation (left/right gestures) with interactive lock logic.
/// 2. Lyo Board (navy/charcoal smart board) with progressive reveals and instant tap completion.
/// 3. Living Stage with standalone PNG classmate/teacher avatars and activity status tags.
/// 4. Balanced Dialogue Card supporting short explanations and interactive prompts.
/// 5. Bottom Lyo Dock containing helper lens transformations (Explain Easier, Visualize, etc.) and Lesson Map.
@MainActor
struct ActiveLessonView: View {

    // MARK: - Inputs

    let header: HeaderModel
    let steps: [LessonStep]
    var onAdvance: (LessonStep) -> Void = { _ in }
    var onAskLyo: (LessonStep) -> Void = { _ in }
    var onExplainEasier: (LessonStep) -> Void = { _ in }
    var onQuizAnswer: (SDUIComponent, SDUIQuizOption) -> Bool = { _, _ in false }
    var onTransferSubmit: (SDUIComponent, String) -> Bool = { _, _ in false }
    var onHint: (SDUIComponent) -> Bool = { _ in false }
    var onSkip: (SDUIComponent) -> Bool = { _ in false }
    /// Fired when the learner answers a `user_prompt` checkpoint — either by
    /// tapping one of its options or by submitting an open response. This is
    /// what makes a mid-lesson question a real, backend-visible exchange
    /// instead of a line of text the learner just swipes past.
    var onPromptAnswer: (LessonStep, String) -> Void = { _, _ in }
    var onBack: () -> Void = {}
    var onMenu: () -> Void = {}
    var onMic: () -> Void = {}
    var onTools: () -> Void = {}

    /// Live word progress for the line being spoken. When it belongs to the
    /// step on screen, the dialogue card reveals words in step with the
    /// audio; otherwise the card shows the full text.
    var captionProgress: SpokenLineProgress? = nil
    /// True while narration is actually playing (drives the Skip control).
    var isNarrating: Bool = false
    /// True while the backend is generating the next scene.
    var waitingForScene: Bool = false
    /// True while the scene still has components the lesson has not
    /// revealed yet, so the last visible step is not really the last.
    var hasQueuedSteps: Bool = false
    /// Language of the current scene, used for transport labels.
    var languageCode: String? = nil
    /// Fired whenever a step becomes the one on screen — the parent owns
    /// narration, so this is what makes the voice follow the visible step.
    var onStepShown: (LessonStep) -> Void = { _ in }
    /// Learner tapped Skip while narration was playing.
    var onSkipNarration: () -> Void = {}

    // MARK: - Models

    struct HeaderModel {
        let title: String
        let subtitle: String // E.g., "Lesson 1 of 6"
    }

    struct LessonStep: Identifiable {
        let id: String
        let teachingText: String
        let supporting: SupportingBlock?
        let keyTerm: KeyTerm?
        let primaryActionLabel: String
        var primaryActionIntent: String? = nil
        var primaryActionComponentId: String? = nil
        var primaryActionPayload: [String: String]? = nil

        // Multi-agent properties
        var speakerName: String = "Teacher"
        var speakerBadge: String = "AI Teacher ✨"
        var speakerImageName: String? = nil

        // A `user_prompt` checkpoint from the director script. Exactly one
        // of these is set when the Teacher is genuinely waiting on a
        // response (as opposed to a plain speech line the learner just
        // reads and continues past).
        var promptOptions: [String]? = nil
        var requiresOpenResponse: Bool = false

        enum SupportingBlock {
            case comparison(ConceptComparisonModel)
            case lessonBlock(LiveLessonBlock)
            case classroomQuiz(SDUIComponent)
            case classroomInput(SDUIComponent)
        }

        struct KeyTerm {
            let term: String
            let definition: String
            var expandedDetail: String? = nil
        }
    }

    struct ConceptComparisonModel {
        let title: String
        let leftHeading: String
        let leftBullets: [String]
        let rightHeading: String
        let rightBullets: [String]
        let takeaway: String?
    }

    // MARK: - State

    @State private var currentIndex: Int = 0
    @State private var quizSelections: [String: String] = [:]
    @State private var submittedTransferIds: Set<String> = []
    @State private var skippedInteractionIds: Set<String> = []
    @State private var reflectionText: String = ""
    // Keyed by LessonStep.id — the learner's answer to a user_prompt
    // checkpoint (tapped option or typed/spoken open response), separate
    // from quizSelections so a step id can never collide with a quiz
    // component id.
    @State private var promptResponses: [String: String] = [:]
    @State private var showLessonMap = false
    @State private var showLyoLens = false
    @State private var activeLensTab = "Ask"
    @State private var boardAnimateState: CGFloat = 0.0 // Progressive reveal factor
    @State private var showSwipeNudge = false
    @State private var shakeOffset: CGFloat = 0.0
    @State private var isBoardTappedToComplete = false
    // The learner asked to move past the last visible step while more were
    // still queued: advance as soon as the next one is revealed.
    @State private var advanceWhenNextStepArrives = false

    // Netflix/YouTube-style chrome auto-hide — mirrors the web classroom's
    // `chromeVisible`/`resetHideTimer` (see web/src/app/(main)/classroom/page.tsx).
    // Everything except the board, the dialogue card, and the Teacher's
    // portrait hides itself after 3s of no interaction; a tap on the
    // background brings it back.
    @State private var chromeVisible: Bool = true
    @State private var chromeHideTask: Task<Void, Never>? = nil

    /// Restarts the 3s auto-hide countdown and makes chrome visible right
    /// away. Refuses to schedule a hide while the current step still needs
    /// an answer — `requiresInteraction && !isInteractionCompleted` is the
    /// same checkpoint signal `goToNextScene()` already uses to lock swipe
    /// navigation, reused here so a quiz/prompt never gets hidden mid-task.
    private func resetChromeTimer() {
        chromeHideTask?.cancel()
        withAnimation(.easeOut(duration: 0.2)) {
            chromeVisible = true
        }
        guard !(requiresInteraction && !isInteractionCompleted) else { return }
        chromeHideTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.2)) {
                chromeVisible = false
            }
        }
    }

    /// Tap-to-toggle, YouTube-style: if chrome is already up, a tap hides
    /// it immediately; otherwise it brings chrome back and restarts the
    /// countdown.
    private func toggleChrome() {
        if chromeVisible {
            chromeHideTask?.cancel()
            withAnimation(.easeOut(duration: 0.2)) {
                chromeVisible = false
            }
        } else {
            resetChromeTimer()
        }
    }

    private var currentStep: LessonStep? {
        steps.indices.contains(currentIndex) ? steps[currentIndex] : nil
    }

    private var progress: Double {
        guard !steps.isEmpty else { return 0 }
        return Double(currentIndex + 1) / Double(steps.count)
    }

    private var requiresInteraction: Bool {
        guard let step = currentStep else { return false }
        if case .classroomQuiz = step.supporting {
            return true
        }
        if case .classroomInput = step.supporting {
            return true
        }
        if step.promptOptions?.isEmpty == false || step.requiresOpenResponse {
            return true
        }
        return false
    }

    private var isInteractionCompleted: Bool {
        guard let step = currentStep else { return true }
        if case .classroomQuiz(let component) = step.supporting {
            return quizSelections[component.id] != nil
                || skippedInteractionIds.contains(component.id)
        }
        if case .classroomInput(let component) = step.supporting {
            return submittedTransferIds.contains(component.id)
                || skippedInteractionIds.contains(component.id)
        }
        if step.promptOptions?.isEmpty == false || step.requiresOpenResponse {
            return promptResponses[step.id] != nil
        }
        return true
    }

    private var transport: ClassroomTransportState {
        ClassroomTransportState(
            currentIndex: currentIndex,
            stepCount: steps.count,
            isNarrating: isNarrating,
            requiresInteraction: requiresInteraction,
            interactionCompleted: isInteractionCompleted,
            waitingForScene: waitingForScene,
            hasQueuedSteps: hasQueuedSteps
        )
    }

    /// Words of the current step's line that the voice has reached, or
    /// `nil` when the caption should simply show everything (voice off,
    /// line finished, or progress belongs to a different step).
    private func revealedWordCount(for step: LessonStep) -> Int? {
        guard let progress = captionProgress,
              progress.lineId == step.id,
              !progress.finished
        else { return nil }
        let total = SpokenCaptionTiming.words(in: step.teachingText).count
        return SpokenCaptionTiming.revealedWordCount(
            fraction: progress.revealedFraction,
            totalWords: total
        )
    }

    private var teacherIndex: Int {
        let hash = abs(header.title.hashValue)
        return (hash % 4) + 1
    }

    private var actualTeacherName: String {
        "Lyo"
    }

    // MARK: - Body

    var body: some View {
        ZStack {
            ClassroomTokens.backgroundGradient
                .ignoresSafeArea()

            ClassroomTokens.ambientGlow
                .frame(width: 480, height: 480)
                .offset(y: -120)
                .allowsHitTesting(false)

            // Falling floating dust particles for immersive learning environment
            ClassroomFloatingParticlesView()

            // Tap-to-toggle chrome, YouTube-style — scoped to the background
            // layers only (this invisible catcher sits behind everything in
            // the ZStack) so it never fights LyoBoardView's own tap gesture
            // or the root DragGesture's swipe-to-advance.
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { toggleChrome() }

            VStack(spacing: 0) {
                // ZONE 1: Top Header — chrome, auto-hides
                if chromeVisible {
                    ClassroomHeaderView(
                        courseTitle: header.title,
                        currentSceneText: "Warm-Up • Scene \(currentIndex + 1) of \(steps.count)",
                        progress: progress,
                        onBack: onBack,
                        onMapTap: {
                            HapticManager.shared.playQuizSelection()
                            showLessonMap = true
                            resetChromeTimer()
                        }
                    )
                    .padding(.horizontal, ClassroomTokens.pagePadding)
                    .padding(.top, 8)
                    .transition(.opacity)
                }

                if let step = currentStep {
                    VStack(spacing: 12) {
                        // ZONE 2: Classroom Stage & Avatars.
                        // The Teacher's own portrait/status is permanent —
                        // per the product decision that both the Teacher's
                        // illustrated avatar and Lyo stay on screen at all
                        // times. Only the classmate row hides with the rest
                        // of the chrome.
                        HStack(spacing: 12) {
                            ClassroomTeacherStage(
                                activeSpeaker: step.speakerName,
                                teacherImageName: step.speakerImageName ?? "lyo_teacher_\(teacherIndex)",
                                teacherName: step.speakerName == "Teacher" ? actualTeacherName : step.speakerName
                            )

                            Spacer()

                            if chromeVisible {
                                HStack(spacing: -10) {
                                    ClassmateAvatarStage(name: "Maya", imageName: "student_genius", activeSpeaker: step.speakerName, status: "curious")
                                    ClassmateAvatarStage(name: "Sam", imageName: "student_clever", activeSpeaker: step.speakerName, status: "thinking")
                                    ClassmateAvatarStage(name: "Rio", imageName: "student_funny", activeSpeaker: step.speakerName, status: "grinning")
                                    ClassmateAvatarStage(name: "Zara", imageName: "student_dumb", activeSpeaker: step.speakerName, status: "confused")
                                }
                                .transition(.opacity)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.white.opacity(0.02), in: RoundedRectangle(cornerRadius: 16))
                        .padding(.horizontal, ClassroomTokens.pagePadding)
                        .frame(height: 70)

                        // ZONE 3: Lyo Board (Interactive centerpiece) — permanent
                        LyoBoardView(
                            step: step,
                            quizSelections: quizSelections,
                            promptResponses: promptResponses,
                            reflectionText: $reflectionText,
                            isTappedToComplete: $isBoardTappedToComplete,
                            interactionCompleted: isInteractionCompleted,
                            onOptionSelected: { component, option in
                                guard onQuizAnswer(component, option) else { return false }
                                quizSelections[component.id] = option.id
                                return true
                            },
                            onTransferSubmit: { component, response in
                                guard onTransferSubmit(component, response) else { return false }
                                submittedTransferIds.insert(component.id)
                                return true
                            },
                            onHint: { component in
                                onHint(component)
                            },
                            onSkip: { component in
                                guard onSkip(component) else { return false }
                                skippedInteractionIds.insert(component.id)
                                return true
                            },
                            onPromptSubmit: { response in
                                let trimmed = response.trimmingCharacters(in: .whitespacesAndNewlines)
                                guard !trimmed.isEmpty else { return }
                                promptResponses[step.id] = trimmed
                                reflectionText = ""
                                onPromptAnswer(step, trimmed)
                            }
                        )
                        .offset(x: shakeOffset)
                        .padding(.horizontal, ClassroomTokens.pagePadding)
                        .onTapGesture {
                            withAnimation(.easeOut(duration: 0.2)) {
                                isBoardTappedToComplete = true
                            }
                            resetChromeTimer()
                        }

                        // ZONE 4: Dialogue Card — permanent (the "teacher bubble")
                        ClassroomDialogueCard(
                            speakerName: step.speakerName == "Teacher" ? actualTeacherName : step.speakerName,
                            speakerBadge: step.speakerBadge,
                            text: step.teachingText,
                            speakerImageName: step.speakerImageName ?? "lyo_teacher_\(teacherIndex)",
                            revealedWordCount: revealedWordCount(for: step)
                        )
                        .padding(.horizontal, ClassroomTokens.pagePadding)

                        Spacer()
                    }
                    .id(step.id)
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .move(edge: .trailing)),
                        removal: .opacity.combined(with: .move(edge: .leading))
                    ))
                } else {
                    Spacer()
                    VStack(spacing: 12) {
                        ProgressView().tint(ClassroomTokens.accent)
                        Text("Preparing your classroom...")
                            .font(.system(size: 14, weight: .regular))
                            .foregroundStyle(ClassroomTokens.textTertiary)
                    }
                    Spacer()
                }

                // Transport rail — permanent. Previous / Skip / Next /
                // Continue are derived from the real lesson state (see
                // ClassroomTransportState), so the learner always has a
                // visible way forward and back instead of a hidden swipe.
                if !steps.isEmpty {
                    transportRail
                        .padding(.horizontal, ClassroomTokens.pagePadding)
                        .padding(.top, 6)
                }

                if showSwipeNudge {
                    Text("Choose an answer to continue")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.red.opacity(0.85))
                        .transition(.opacity.combined(with: .scale))
                        .padding(.top, 6)
                }

                // Scene dots — chrome, auto-hides
                if chromeVisible {
                    HStack(spacing: 6) {
                        ForEach(0..<steps.count, id: \.self) { idx in
                            Circle()
                                .fill(idx == currentIndex ? ClassroomTokens.accent : Color.white.opacity(0.15))
                                .frame(width: idx == currentIndex ? 8 : 6, height: idx == currentIndex ? 8 : 6)
                                .animation(.spring(), value: currentIndex)
                        }
                    }
                    .padding(.vertical, 8)
                    .transition(.opacity)

                    // ZONE 5: Bottom Dock (Sleek Lens Toolbar) — chrome, auto-hides
                    LyoLensDock(
                        onLensTap: { tab in
                            HapticManager.shared.playQuizSelection()
                            activeLensTab = tab
                            showLyoLens = true
                            resetChromeTimer()
                        },
                        onMicTap: {
                            onMic()
                            resetChromeTimer()
                        }
                    )
                    .padding(.horizontal, ClassroomTokens.pagePadding)
                    .padding(.bottom, 12)
                    .transition(.opacity)
                }
            }
        }
        .preferredColorScheme(.dark)
        .persistentSystemOverlays(.hidden)
        .onAppear {
            resetChromeTimer()
            if let step = currentStep { onStepShown(step) }
        }
        .onChange(of: currentStep?.id) { _, _ in
            if let step = currentStep { onStepShown(step) }
        }
        .onChange(of: currentIndex) { _, _ in resetChromeTimer() }
        .onChange(of: steps.count) { _, count in
            guard advanceWhenNextStepArrives, currentIndex < count - 1 else { return }
            advanceWhenNextStepArrives = false
            withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
                currentIndex += 1
                isBoardTappedToComplete = false
            }
        }
        .onChange(of: quizSelections) { _, _ in resetChromeTimer() }
        .onChange(of: promptResponses) { _, _ in resetChromeTimer() }
        .gesture(
            DragGesture()
                .onEnded { gesture in
                    let horizontalAmount = gesture.translation.width
                    if horizontalAmount < -60 {
                        // Swipe left = Next
                        goToNextScene()
                    } else if horizontalAmount > 60 {
                        // Swipe right = Previous
                        goToPreviousScene()
                    }
                }
        )
        .sheet(isPresented: $showLessonMap) {
            LessonMapSheet(steps: steps, currentIndex: currentIndex) { targetIdx in
                withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
                    currentIndex = targetIdx
                    isBoardTappedToComplete = false
                }
            }
        }
        .sheet(isPresented: $showLyoLens) {
            LyoLensSheet(activeTab: $activeLensTab, step: currentStep, onAction: { intent in
                if let step = currentStep {
                    if intent == "explain" {
                        onExplainEasier(step)
                    } else if intent == "visual" {
                        onAskLyo(step) // trigger visual/graph explain
                    } else {
                        onAskLyo(step)
                    }
                }
            })
        }
    }

    // MARK: - Transport Rail

    private var transportRail: some View {
        let state = transport
        return HStack(spacing: 8) {
            Group {
                if state.canGoPrevious {
                    transportButton(
                        title: ClassroomTransportState.previousLabel(languageCode: languageCode),
                        systemImage: "chevron.left",
                        imageLeading: true,
                        emphasized: false,
                        accessibilityHint: "Go back to the previous lesson step"
                    ) {
                        goToPreviousScene()
                        resetChromeTimer()
                    }
                }
            }
            .frame(width: 112, alignment: .leading)

            Spacer(minLength: 0)

            Text(state.positionLabel)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .tracking(1.2)
                .foregroundStyle(ClassroomTokens.textTertiary)
                .accessibilityLabel("Step \(state.positionLabel.replacingOccurrences(of: "/", with: " of "))")

            Spacer(minLength: 0)

            Group {
                switch state.forward {
                case .skip:
                    transportButton(
                        title: ClassroomTransportState.skipLabel(languageCode: languageCode),
                        systemImage: "forward.fill",
                        imageLeading: false,
                        emphasized: false,
                        accessibilityHint: "Skip the explanation currently playing"
                    ) {
                        onSkipNarration()
                        resetChromeTimer()
                    }
                case .next:
                    transportButton(
                        title: ClassroomTransportState.nextLabel(languageCode: languageCode),
                        systemImage: "chevron.right",
                        imageLeading: false,
                        emphasized: false,
                        accessibilityHint: "Go to the next lesson step"
                    ) {
                        goToNextScene()
                        resetChromeTimer()
                    }
                case .continue:
                    transportButton(
                        title: ClassroomTransportState.continueLabel(languageCode: languageCode),
                        systemImage: "chevron.right",
                        imageLeading: false,
                        emphasized: true,
                        accessibilityHint: "Continue the lesson"
                    ) {
                        goToNextScene()
                        resetChromeTimer()
                    }
                case .waiting:
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(ClassroomTokens.accent)
                        Text(ClassroomTransportState.waitingLabel(languageCode: languageCode))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(ClassroomTokens.textTertiary)
                    }
                case .none:
                    EmptyView()
                }
            }
            .frame(width: 112, alignment: .trailing)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.white.opacity(0.04), in: Capsule())
        .overlay(Capsule().stroke(ClassroomTokens.glassBorder, lineWidth: 1))
        .animation(.easeOut(duration: 0.2), value: state)
    }

    private func transportButton(
        title: String,
        systemImage: String,
        imageLeading: Bool,
        emphasized: Bool,
        accessibilityHint: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if imageLeading {
                    Image(systemName: systemImage)
                        .font(.system(size: 10, weight: .bold))
                }
                Text(title)
                    .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                if !imageLeading {
                    Image(systemName: systemImage)
                        .font(.system(size: 10, weight: .bold))
                }
            }
            .foregroundStyle(emphasized ? ClassroomTokens.accent : Color.white.opacity(0.72))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                (emphasized ? ClassroomTokens.accent.opacity(0.14) : Color.white.opacity(0.05)),
                in: Capsule()
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityHint(accessibilityHint)
    }

    // MARK: - Navigation Gestures

    private func goToNextScene() {
        guard let step = currentStep else { return }

        // Swipe locked if answer is required but not selected
        if requiresInteraction && !isInteractionCompleted {
            triggerShakeNudge()
            return
        }

        let feedback = UIImpactFeedbackGenerator(style: .medium)
        feedback.impactOccurred()

        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
            if currentIndex < steps.count - 1 {
                onAdvance(step)
                currentIndex += 1
                isBoardTappedToComplete = false
            } else {
                // Last visible step: the parent either reveals the next
                // queued component (then we move to it as it lands) or asks
                // the backend for the next scene.
                advanceWhenNextStepArrives = hasQueuedSteps
                onAdvance(step)
            }
        }
    }

    private func goToPreviousScene() {
        let feedback = UIImpactFeedbackGenerator(style: .light)
        feedback.impactOccurred()

        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
            if currentIndex > 0 {
                currentIndex -= 1
                isBoardTappedToComplete = false
            }
        }
    }

    private func triggerShakeNudge() {
        HapticManager.shared.playQuizSelection()
        withAnimation(.default) {
            showSwipeNudge = true
        }
        // Shake sequence
        for tick in 0...5 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(tick) * 0.08) {
                withAnimation(.spring(response: 0.1, dampingFraction: 0.3)) {
                    if tick == 5 {
                        shakeOffset = 0
                    } else {
                        shakeOffset = tick % 2 == 0 ? -12 : 12
                    }
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
            withAnimation {
                showSwipeNudge = false
            }
        }
    }
}

// MARK: - Zone 1: Classroom Header

@MainActor
struct ClassroomHeaderView: View {
    let courseTitle: String
    let currentSceneText: String
    let progress: Double
    var onBack: () -> Void
    var onMapTap: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white.opacity(0.8))
                        .frame(width: 36, height: 36)
                        .background(Color.white.opacity(0.06), in: Circle())
                }

                Spacer()

                VStack(spacing: 2) {
                    Text(courseTitle)
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(ClassroomTokens.textPrimary)
                        .lineLimit(1)
                    Text(currentSceneText)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(ClassroomTokens.accent)
                }

                Spacer()

                Button(action: onMapTap) {
                    Image(systemName: "map.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(ClassroomTokens.accent)
                        .frame(width: 36, height: 36)
                        .background(ClassroomTokens.accent.opacity(0.12), in: Circle())
                }
            }

            // High contrast elegant progress line
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.white.opacity(0.08))
                        .frame(height: 5)
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [ClassroomTokens.accent, ClassroomTokens.accentDeep],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: geo.size.width * CGFloat(progress), height: 5)
                        .shadow(color: ClassroomTokens.accentGlow.opacity(0.4), radius: 3)
                }
            }
            .frame(height: 5)
        }
    }
}

// MARK: - Zone 2: Living Stage View

/// Just the Teacher's own portrait/status — permanent, never hides with the
/// rest of the chrome (the classmate row that used to live alongside it in
/// `ClassroomStageView` is now composed separately in `ActiveLessonView.body`
/// so it can hide independently as chrome auto-hides).
@MainActor
struct ClassroomTeacherStage: View {
    let activeSpeaker: String
    let teacherImageName: String
    let teacherName: String

    var body: some View {
        HStack(spacing: 8) {
            Image(teacherImageName)
                .resizable()
                .scaledToFit()
                .frame(height: 54)
                .shadow(color: ClassroomTokens.accentGlow.opacity(activeSpeaker == "Teacher" ? 0.6 : 0.0), radius: 10)
                .scaleEffect(activeSpeaker == "Teacher" ? 1.08 : 0.95)
                .animation(.spring(), value: activeSpeaker)

            VStack(alignment: .leading, spacing: 2) {
                Text(teacherName)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text(activeSpeaker == "Teacher" ? "explaining live" : "observing class")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(activeSpeaker == "Teacher" ? ClassroomTokens.accent : ClassroomTokens.textTertiary)
            }
        }
    }
}

@MainActor
struct ClassmateAvatarStage: View {
    let name: String
    let imageName: String
    let activeSpeaker: String
    let status: String

    var isActive: Bool {
        activeSpeaker == name
    }

    var body: some View {
        VStack(spacing: 2) {
            Image(imageName)
                .resizable()
                .scaledToFit()
                .frame(height: 42)
                .shadow(color: ClassroomTokens.accentGlow.opacity(isActive ? 0.6 : 0.0), radius: 6)
                .scaleEffect(isActive ? 1.15 : 0.95)
                .animation(.spring(), value: activeSpeaker)
            
            if isActive {
                Text("\(name) speaks")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(ClassroomTokens.accent)
                    .padding(.horizontal, 4)
                    .background(Color.black.opacity(0.4), in: Capsule())
            }
        }
    }
}

// MARK: - Zone 3: Lyo Board View

@MainActor
struct LyoBoardView: View {
    let step: ActiveLessonView.LessonStep
    let quizSelections: [String: String]
    let promptResponses: [String: String]
    @Binding var reflectionText: String
    @Binding var isTappedToComplete: Bool
    let interactionCompleted: Bool
    var onOptionSelected: (SDUIComponent, SDUIQuizOption) -> Bool
    var onTransferSubmit: (SDUIComponent, String) -> Bool
    var onHint: (SDUIComponent) -> Bool
    var onSkip: (SDUIComponent) -> Bool
    var onPromptSubmit: (String) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Neon top ambient glowing label
            HStack {
                Circle()
                    .fill(ClassroomTokens.accent)
                    .frame(width: 6, height: 6)
                Text("LYO BOARD")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ClassroomTokens.accent)
                Spacer()
            }

            if let options = step.promptOptions, !options.isEmpty {
                promptOptionsContent(options)
            } else if step.requiresOpenResponse {
                openResponseContent()
            } else {
                switch step.supporting {
                case .classroomQuiz(let component):
                    quizContent(component)

                case .classroomInput(let component):
                    transferContent(component)

                case .comparison(let model):
                    comparisonContent(model)

                case .lessonBlock(let block):
                    BlockRendererView(block: block)
                        .padding(4)

                case .none:
                    defaultExplanationContent()
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color(hex: "0D0E23").opacity(0.92))
                .shadow(color: ClassroomTokens.accentGlow.opacity(0.12), radius: 15)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(ClassroomTokens.glassBorder, lineWidth: 1)
        )
    }

    private func defaultExplanationContent() -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Lesson Focus")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(ClassroomTokens.textSecondary)

            Text(step.teachingText)
                .font(.system(size: 16, weight: .regular))
                .foregroundStyle(ClassroomTokens.textPrimary)
                .lineSpacing(5)
                .opacity(isTappedToComplete ? 1.0 : 0.9)
                .animation(.easeOut, value: isTappedToComplete)
        }
    }

    /// A `user_prompt` checkpoint with real, question-specific tap options.
    /// Renders as a wrapping row of chips rather than a fixed yes/no pair —
    /// the shape (two chips, or five) is whatever the Teacher's actual
    /// options for THIS question are, so a binary check and a genuine
    /// multiple-choice check both read naturally instead of looking like
    /// the same generic control every time.
    private func promptOptionsContent(_ options: [String]) -> some View {
        let selected = promptResponses[step.id]
        return VStack(alignment: .leading, spacing: 12) {
            Text("Quick Check")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(ClassroomTokens.accent)

            Text(step.teachingText)
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(ClassroomTokens.textPrimary)

            PromptChipFlow(
                options: options,
                selected: selected,
                onSelect: { option in onPromptSubmit(option) }
            )
        }
    }

    /// A `user_prompt` checkpoint that expects an actual explanation,
    /// example, or opinion — not a tap. Includes a low-friction "I'm not
    /// sure" escape hatch so a stuck learner can ask for help instead of
    /// being pushed to invent an answer.
    private func openResponseContent() -> some View {
        let submitted = promptResponses[step.id]
        return VStack(alignment: .leading, spacing: 12) {
            Text("Your Turn")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(ClassroomTokens.accent)

            Text(step.teachingText)
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(ClassroomTokens.textPrimary)

            if let submitted {
                Text(submitted)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(ClassroomTokens.textSecondary)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.06), lineWidth: 1))
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    TextField("Explain it in your own words…", text: $reflectionText, axis: .vertical)
                        .font(.system(size: 14))
                        .foregroundStyle(ClassroomTokens.textPrimary)
                        .lineLimit(1...4)
                        .padding(12)
                        .background(Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.1), lineWidth: 1))

                    HStack(spacing: 10) {
                        Button {
                            onPromptSubmit("I'm not sure")
                        } label: {
                            Text("I'm not sure")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(ClassroomTokens.textSecondary)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(Color.white.opacity(0.05), in: Capsule())
                        }

                        Spacer()

                        Button {
                            onPromptSubmit(reflectionText)
                        } label: {
                            Text("Send")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(.black)
                                .padding(.horizontal, 18)
                                .padding(.vertical, 8)
                                .background(ClassroomTokens.accent, in: Capsule())
                        }
                        .disabled(reflectionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
    }

    private func quizContent(_ component: SDUIComponent) -> some View {
        let questionText = component.question?.isEmpty == false ? component.question! : component.content
        return VStack(alignment: .leading, spacing: 12) {
            Text("Concept Check")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(ClassroomTokens.accent)

            Text(questionText)
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(ClassroomTokens.textPrimary)

            if let options = component.options {
                VStack(spacing: 8) {
                    ForEach(options) { option in
                        let selected = quizSelections[component.id] == option.id
                        Button {
                            _ = onOptionSelected(component, option)
                        } label: {
                            HStack {
                                Circle()
                                    .fill(selected ? ClassroomTokens.accent : Color.white.opacity(0.08))
                                    .frame(width: 18, height: 18)
                                    .overlay(Circle().stroke(selected ? ClassroomTokens.accent : Color.white.opacity(0.2), lineWidth: 1))
                                Text(option.label)
                                    .font(.system(size: 14, weight: selected ? .bold : .medium))
                                    .foregroundStyle(ClassroomTokens.textPrimary)
                                Spacer()
                            }
                            .padding(12)
                            .background(selected ? ClassroomTokens.accent.opacity(0.12) : Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(selected ? ClassroomTokens.accent : Color.white.opacity(0.06), lineWidth: 1))
                        }
                        .disabled(interactionCompleted)
                    }
                }
            }
            checkpointSupportActions(component)
        }
    }

    private func transferContent(_ component: SDUIComponent) -> some View {
        let minimum = max(component.minWords ?? 6, 1)
        let wordCount = reflectionText
            .split(whereSeparator: \.isWhitespace)
            .count
        let isSpanish = component.languageCode?.lowercased().hasPrefix("es") == true
        return VStack(alignment: .leading, spacing: 12) {
            Text(isSpanish ? "Comprobación de aplicación" : "Application Check")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(ClassroomTokens.accent)

            Text(component.question ?? component.content)
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(ClassroomTokens.textPrimary)

            TextEditor(text: $reflectionText)
                .font(.system(size: 14, weight: .medium, design: .rounded))
                .foregroundStyle(ClassroomTokens.textPrimary)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 90)
                .padding(10)
                .background(
                    Color.white.opacity(0.05),
                    in: RoundedRectangle(cornerRadius: 12)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
                .disabled(interactionCompleted)

            HStack {
                Text(
                    isSpanish
                        ? "\(wordCount)/\(minimum) palabras como mínimo"
                        : "\(wordCount)/\(minimum) words minimum"
                )
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(ClassroomTokens.textTertiary)
                Spacer()
                Button(isSpanish ? "Enviar" : "Submit") {
                    let response = reflectionText.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    )
                    _ = onTransferSubmit(component, response)
                }
                .buttonStyle(.borderedProminent)
                .tint(ClassroomTokens.accent)
                .disabled(wordCount < minimum || interactionCompleted)
            }
            checkpointSupportActions(component)
        }
    }

    private func checkpointSupportActions(_ component: SDUIComponent) -> some View {
        let isSpanish = component.languageCode?.lowercased().hasPrefix("es") == true
        return HStack(spacing: 10) {
            Button {
                _ = onHint(component)
            } label: {
                Label(
                    isSpanish ? "Pedir ayuda" : "Ask for help",
                    systemImage: "lightbulb"
                )
            }
            .buttonStyle(.bordered)

            Button {
                _ = onSkip(component)
            } label: {
                Text(isSpanish ? "Omitir por ahora" : "Skip for now")
            }
            .buttonStyle(.plain)
            .foregroundStyle(ClassroomTokens.textTertiary)
        }
        .font(.system(size: 12, weight: .semibold, design: .rounded))
        .disabled(interactionCompleted)
        .opacity(interactionCompleted ? 0.55 : 1)
    }

    private func comparisonContent(_ model: ActiveLessonView.ConceptComparisonModel) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.title)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(ClassroomTokens.textPrimary)

            HStack(alignment: .top, spacing: 12) {
                // Left Column
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.leftHeading)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(ClassroomTokens.accent)
                    ForEach(model.leftBullets, id: \.self) { bullet in
                        HStack(alignment: .top, spacing: 4) {
                            Text("•").foregroundStyle(ClassroomTokens.accent)
                            Text(bullet).font(.system(size: 12)).foregroundStyle(ClassroomTokens.textSecondary)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                // Divider line
                Rectangle()
                    .fill(Color.white.opacity(0.12))
                    .frame(width: 1)
                    .frame(maxHeight: 120)

                // Right Column
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.rightHeading)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(ClassroomTokens.accent)
                    ForEach(model.rightBullets, id: \.self) { bullet in
                        HStack(alignment: .top, spacing: 4) {
                            Text("•").foregroundStyle(ClassroomTokens.accent)
                            Text(bullet).font(.system(size: 12)).foregroundStyle(ClassroomTokens.textSecondary)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

// MARK: - Prompt Chips (dynamic multiple-choice, not a fixed yes/no pair)

/// Renders a `user_prompt` turn's options as a wrapping row of chips. The
/// same component naturally reads as a simple binary check when there are
/// two options and as a real multiple-choice check when there are more —
/// the visual shape follows whatever the Teacher actually asked, instead of
/// every checkpoint looking like the same generic yes/no control.
@MainActor
private struct PromptChipFlow: View {
    let options: [String]
    let selected: String?
    let onSelect: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(options, id: \.self) { option in
                let isSelected = selected == option
                Button {
                    onSelect(option)
                } label: {
                    Text(option)
                        .font(.system(size: 14, weight: isSelected ? .bold : .medium))
                        .foregroundStyle(isSelected ? Color.black : ClassroomTokens.textPrimary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(
                            Capsule().fill(isSelected ? ClassroomTokens.accent : Color.white.opacity(0.06))
                        )
                        .overlay(
                            Capsule().stroke(isSelected ? ClassroomTokens.accent : Color.white.opacity(0.14), lineWidth: 1)
                        )
                }
                .disabled(selected != nil)
            }
        }
    }
}

// MARK: - Zone 4: Dialogue Card View

@MainActor
struct ClassroomDialogueCard: View {
    let speakerName: String
    let speakerBadge: String
    let text: String
    let speakerImageName: String
    /// When set, only this many leading words read as "spoken"; the rest of
    /// the line stays dimmed until the voice reaches it. `nil` shows the
    /// whole line at full strength.
    var revealedWordCount: Int? = nil

    /// The line as a single `Text`, with words the voice has not reached
    /// yet dimmed. Keeping every word in the layout means the card never
    /// jumps in height while narration plays.
    private var captionText: Text {
        guard let revealedWordCount else {
            return Text(text).foregroundStyle(ClassroomTokens.textSecondary)
        }
        let words = SpokenCaptionTiming.words(in: text)
        guard !words.isEmpty else {
            return Text(text).foregroundStyle(ClassroomTokens.textSecondary)
        }
        let splitAt = max(0, min(revealedWordCount, words.count))
        let spoken = words[..<splitAt].joined(separator: " ")
        let pending = words[splitAt...].joined(separator: " ")
        var composed = Text(spoken).foregroundStyle(ClassroomTokens.textSecondary)
        if !pending.isEmpty {
            let separator = spoken.isEmpty ? "" : " "
            composed = composed + Text(separator + pending).foregroundStyle(ClassroomTokens.textPrimary.opacity(0.28))
        }
        return composed
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(speakerImageName)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 24, height: 24)
                    .background(Color.white.opacity(0.1), in: Circle())

                Text(speakerName)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(ClassroomTokens.textPrimary)

                Text(speakerBadge)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(ClassroomTokens.accent)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(ClassroomTokens.accent.opacity(0.15), in: Capsule())
                Spacer()
            }

            captionText
                .font(.system(size: 14, weight: .regular))
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .animation(.linear(duration: 0.08), value: revealedWordCount)
                .accessibilityLabel(text)
        }
        .padding(14)
        .classroomGlassCard()
    }
}

// MARK: - Zone 5: Bottom Dock View

@MainActor
struct LyoLensDock: View {
    var onLensTap: (String) -> Void
    var onMicTap: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // Mic icon
            Button(action: onMicTap) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(ClassroomTokens.accentDeep, in: Circle())
            }

            // Quick lens buttons
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    LensButton(label: "Ask Lyo", icon: "sparkles") { onLensTap("Ask") }
                    LensButton(label: "Explain Easier", icon: "wand.and.stars") { onLensTap("Explain") }
                    LensButton(label: "Visualize", icon: "chart.bar.fill") { onLensTap("Visualize") }
                    LensButton(label: "Quiz Me", icon: "checkmark.seal.fill") { onLensTap("Quiz") }
                    LensButton(label: "Notes", icon: "note.text") { onLensTap("Notes") }
                }
            }
        }
        .padding(10)
        .background(Color.white.opacity(0.03))
        .background(.ultraThinMaterial)
        .cornerRadius(24)
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(ClassroomTokens.glassBorder, lineWidth: 1))
    }
}

@MainActor
struct LensButton: View {
    let label: String
    let icon: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                Text(label)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color.white.opacity(0.06), in: Capsule())
        }
    }
}

// MARK: - Overlay: Lesson Map Sheet

@MainActor
struct LessonMapSheet: View {
    let steps: [ActiveLessonView.LessonStep]
    let currentIndex: Int
    var onJump: (Int) -> Void
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            ZStack {
                Color(hex: "0A0B1F").ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Today's Course roadmap")
                            .font(.system(size: 20, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .padding(.top, 10)

                        ForEach(0..<steps.count, id: \.self) { idx in
                            let step = steps[idx]
                            Button {
                                onJump(idx)
                                dismiss()
                            } label: {
                                HStack(spacing: 16) {
                                    // Bullet status indicator
                                    ZStack {
                                        if idx < currentIndex {
                                            Circle()
                                                .fill(ClassroomTokens.accent)
                                                .frame(width: 28, height: 28)
                                            Image(systemName: "checkmark")
                                                .font(.system(size: 12, weight: .bold))
                                                .foregroundStyle(.white)
                                        } else if idx == currentIndex {
                                            Circle()
                                                .stroke(ClassroomTokens.accent, lineWidth: 2)
                                                .frame(width: 28, height: 28)
                                            Circle()
                                                .fill(ClassroomTokens.accent)
                                                .frame(width: 12, height: 12)
                                        } else {
                                            Circle()
                                                .fill(Color.white.opacity(0.12))
                                                .frame(width: 28, height: 28)
                                        }
                                    }

                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("Scene \(idx + 1)")
                                            .font(.system(size: 12, weight: .bold))
                                            .foregroundStyle(idx == currentIndex ? ClassroomTokens.accent : .secondary)
                                        Text(step.teachingText)
                                            .font(.system(size: 14, weight: .semibold))
                                            .foregroundStyle(idx == currentIndex ? .white : .white.opacity(0.6))
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                }
                                .padding(12)
                                .background(idx == currentIndex ? Color.white.opacity(0.05) : Color.clear, in: RoundedRectangle(cornerRadius: 14))
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                }
            }
            .navigationTitle("Lesson Outline")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Overlay: Lyo Lens Sheet

@MainActor
struct LyoLensSheet: View {
    @Binding var activeTab: String
    let step: ActiveLessonView.LessonStep?
    var onAction: (String) -> Void
    @Environment(\.dismiss) var dismiss

    var body: some View {
        ZStack {
            Color(hex: "0A0B1F").ignoresSafeArea()

            VStack(spacing: 20) {
                // Header
                HStack {
                    Image("LyoThinking")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 42, height: 42)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Lyo Lens")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                        Text("Ask me to clarify, summarize, or quiz you")
                            .font(.system(size: 12))
                            .foregroundStyle(ClassroomTokens.textSecondary)
                    }
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(.white.opacity(0.4))
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)

                // Main options grid
                ScrollView {
                    VStack(spacing: 14) {
                        LensOptionCard(title: "Explain Easier", subtitle: "Break this scene down into simpler, friendly terminology.", icon: "wand.and.stars") {
                            onAction("explain")
                            dismiss()
                        }
                        LensOptionCard(title: "Visualize Scene", subtitle: "Transform text descriptions into custom vector graph charts.", icon: "chart.bar.fill") {
                            onAction("visual")
                            dismiss()
                        }
                        LensOptionCard(title: "Mini Quiz Me", subtitle: "Test your comprehension right now on this core fact.", icon: "checkmark.seal.fill") {
                            onAction("quiz")
                            dismiss()
                        }
                        LensOptionCard(title: "Save to notes", subtitle: "Pin this smart board to your memory cards notebook.", icon: "note.text") {
                            onAction("notes")
                            dismiss()
                        }
                    }
                    .padding(.horizontal, 20)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

@MainActor
struct LensOptionCard: View {
    let title: String
    let subtitle: String
    let icon: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundStyle(ClassroomTokens.accent)
                    .frame(width: 44, height: 44)
                    .background(ClassroomTokens.accent.opacity(0.12), in: Circle())

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(ClassroomTokens.textSecondary)
                        .lineLimit(2)
                }
                Spacer()
            }
            .padding(14)
            .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(ClassroomTokens.glassBorder, lineWidth: 1))
        }
    }
}

// MARK: - Animated Floating Particles View

@MainActor
struct ClassroomFloatingParticlesView: View {
    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let time = timeline.date.timeIntervalSinceReferenceDate
                for i in 0..<15 {
                    let seed = Double(i)
                    let x = size.width * CGFloat(abs(sin(seed + time * 0.1)))
                    let y = size.height * CGFloat(abs(cos(seed * 2 + time * 0.08)))
                    let radius = CGFloat(2 + sin(seed + time) * 1)
                    let rect = CGRect(x: x, y: y, width: radius, height: radius)
                    context.fill(Path(ellipseIn: rect), with: .color(ClassroomTokens.accent.opacity(0.12)))
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
