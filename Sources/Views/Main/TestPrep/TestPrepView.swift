import SwiftUI

// MARK: - Test Prep
//
// "I have a test on Friday. How ready am I, and what should I do first?"
//
// The server has been able to answer that for a while. Nothing on iOS asked —
// and until now no iOS learner could even create the plan it answers about,
// because a plan is built by a conversation (`intake/turn` until the server
// says it has enough, then `plans/generate`) and nothing on this platform ran
// that conversation.
//
// What this screen will not do is as deliberate as what it does:
//
//   - It never renders a readiness of 0 as "0% ready". A new plan has nothing
//     assessed, and saying "0%" to someone who has not been asked anything is
//     a claim about them that nothing measured.
//   - It sends no score when a session is finished. The server derives one
//     from evidence it recorded itself and replies with what it found; this
//     reports that reply, including "nothing here was graded".
//   - It never reports a failed request as a fact about the learner's day.
//
// The decisions behind all of that live in `TestPrepState` and
// `TestPrepPresentation`, where tests can reach them. This file renders them.

struct TestPrepView: View {
    @StateObject private var model = TestPrepViewModel()
    @EnvironmentObject private var uiStackStore: UIStackStore
    @EnvironmentObject private var uiState: AppUIState

    @State private var draft = ""
    @State private var classroomEntry: ClassroomEntry?

    /// A session the learner tapped, on its way to the Classroom.
    private struct ClassroomEntry: Identifiable {
        let id: String
        let courseId: String
        let title: String
        let durationMinutes: Int?
    }

    var body: some View {
        ZStack {
            DesignTokens.Colors.background.ignoresSafeArea()

            if model.state.loading {
                ProgressView()
                    .tint(DesignTokens.Colors.accent)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                        switch model.state.stage {
                        case .intake: intake
                        case .plan: plan
                        }
                    }
                    .padding(DesignTokens.Spacing.md)
                }
            }
        }
        .navigationTitle("Test prep")
        .task { await model.load() }
        .fullScreenCover(item: $classroomEntry) { entry in
            LivingClassroomView(
                courseId: entry.courseId,
                courseTitle: entry.title,
                durationMinutes: entry.durationMinutes
            )
                .environmentObject(uiStackStore)
                .environmentObject(uiState)
        }
    }

    // MARK: Intake

    private var intake: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.md) {
            Text("What are you studying for?")
                .font(DesignTokens.Typography.displaySmall)
                .foregroundColor(DesignTokens.Colors.textPrimary)

            Text("Tell me the subject and when the test is, and I'll build you a plan.")
                .font(DesignTokens.Typography.bodyMedium)
                .foregroundColor(DesignTokens.Colors.textSecondary)

            // A failed plan list is said here, on the screen it sent them to.
            // Silently showing intake to someone who already has a plan is how
            // a learner ends up with two.
            // Not a warning beside a live composer. Starting intake here ends
            // in `plans/generate`, which creates a plan unconditionally — so a
            // learner who already has one would come out with a second,
            // because a request happened to fail. The way forward is to find
            // out, not to guess.
            if model.state.planLoadFailed {
                noticeBox("I could not check whether you already have a plan. "
                          + "Let me try again before we start a new one.")
                Button("Try again") {
                    Task { await model.load() }
                }
                .font(DesignTokens.Typography.labelLarge)
                .foregroundColor(DesignTokens.Colors.accent)
            }

            ForEach(model.transcript) { line in
                intakeLine(line)
            }

            if let error = model.intakeError {
                noticeBox(error)
            }

            HStack(spacing: DesignTokens.Spacing.xs) {
                TextField("e.g. Biology GCSE on the 25th", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(DesignTokens.Typography.bodyMedium)
                    .foregroundColor(DesignTokens.Colors.textPrimary)
                    .padding(DesignTokens.Spacing.sm)
                    .background(DesignTokens.Colors.surface)
                    .cornerRadius(DesignTokens.Radius.md)
                    .disabled(model.intakeBusy || !model.state.canStartIntake)

                Button {
                    let message = draft
                    draft = ""
                    Task { await model.sendIntake(message) }
                } label: {
                    if model.intakeBusy {
                        ProgressView().tint(DesignTokens.Colors.textPrimary)
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 28))
                    }
                }
                .foregroundColor(DesignTokens.Colors.accent)
                .disabled(model.intakeBusy
                          || !model.state.canStartIntake
                          || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func intakeLine(_ line: IntakeLine) -> some View {
        HStack {
            if line.speaker == .learner { Spacer(minLength: DesignTokens.Spacing.xl) }
            Text(line.text)
                .font(DesignTokens.Typography.bodyMedium)
                .foregroundColor(DesignTokens.Colors.textPrimary)
                .padding(DesignTokens.Spacing.sm)
                .background(line.speaker == .learner
                            ? DesignTokens.Colors.accent.opacity(0.25)
                            : DesignTokens.Colors.surface)
                .cornerRadius(DesignTokens.Radius.md)
            if line.speaker == .coach { Spacer(minLength: DesignTokens.Spacing.xl) }
        }
    }

    // MARK: Plan

    private var plan: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
            if let stale = model.state.staleWarning {
                noticeBox(stale)
            }
            readinessCard
            focusCard
            todaySection
        }
    }

    private var readinessCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            if let readiness = model.state.readiness {
                Text(readiness.subject)
                    .font(DesignTokens.Typography.titleMedium)
                    .foregroundColor(DesignTokens.Colors.textPrimary)

                if let days = TestPrepPresentation.daysLabel(readiness.daysRemaining) {
                    Text(days)
                        .font(DesignTokens.Typography.labelMedium)
                        .foregroundColor(DesignTokens.Colors.textSecondary)
                }
            }

            if let note = model.state.readinessNote {
                Text(note)
                    .font(DesignTokens.Typography.bodySmall)
                    .foregroundColor(DesignTokens.Colors.textTertiary)
            }

            switch TestPrepPresentation.readinessHeadline(model.state.readiness) {
            case .measured(let percent):
                Text("\(percent)% ready")
                    .font(DesignTokens.Typography.displayMedium)
                    .foregroundColor(DesignTokens.Colors.accent)
            case .notStarted:
                // Not "0% ready". Nothing has asked this learner anything yet.
                Text("You haven't started yet")
                    .font(DesignTokens.Typography.titleLarge)
                    .foregroundColor(DesignTokens.Colors.textPrimary)
                Text("Finish a session and this will start filling in.")
                    .font(DesignTokens.Typography.bodySmall)
                    .foregroundColor(DesignTokens.Colors.textSecondary)
            case .unknown:
                Text("No readiness to report yet")
                    .font(DesignTokens.Typography.titleLarge)
                    .foregroundColor(DesignTokens.Colors.textPrimary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(DesignTokens.Spacing.md)
        .background(DesignTokens.Colors.surface)
        .cornerRadius(DesignTokens.Radius.lg)
    }

    @ViewBuilder
    private var focusCard: some View {
        let focus = model.state.readiness?.focusNext ?? []
        if !focus.isEmpty {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                Text("Worth your next hour")
                    .font(DesignTokens.Typography.titleSmall)
                    .foregroundColor(DesignTokens.Colors.textPrimary)
                ForEach(focus, id: \.self) { topic in
                    Text("• \(topic)")
                        .font(DesignTokens.Typography.bodyMedium)
                        .foregroundColor(DesignTokens.Colors.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(DesignTokens.Spacing.md)
            .background(DesignTokens.Colors.surface)
            .cornerRadius(DesignTokens.Radius.lg)
        }
    }

    private var todaySection: some View {
        let open = TestPrepPresentation.openSessions(model.state.sessions)
        let copy = model.state.todayCopy(openCount: open.count)

        return VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            Text("Today")
                .font(DesignTokens.Typography.titleSmall)
                .foregroundColor(DesignTokens.Colors.textPrimary)

            if let notice = model.state.notice {
                noticeBox(notice)
            }
            if let note = copy.note {
                noticeBox(note)
            }
            if let empty = copy.emptyMessage {
                Text(empty)
                    .font(DesignTokens.Typography.bodyMedium)
                    .foregroundColor(DesignTokens.Colors.textSecondary)
            }

            ForEach(open) { session in
                sessionRow(session)
            }
        }
    }

    private func sessionRow(_ session: PlannedSession) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            Text(session.topic)
                .font(DesignTokens.Typography.bodyLarge)
                .foregroundColor(DesignTokens.Colors.textPrimary)

            HStack(spacing: DesignTokens.Spacing.xs) {
                Text("\(session.sessionType.capitalized) · \(session.durationMinutes) min")
                    .font(DesignTokens.Typography.labelSmall)
                    .foregroundColor(DesignTokens.Colors.textSecondary)

                // Matched on concept id, which the server puts on both the
                // session and the readiness row so neither side re-derives it.
                if let standing = TestPrepPresentation.standing(
                    forSession: session, in: model.state.readiness
                ) {
                    switch TestPrepPresentation.topicStanding(standing) {
                    case .measured(let percent):
                        Text("· \(percent)% so far")
                            .font(DesignTokens.Typography.labelSmall)
                            .foregroundColor(DesignTokens.Colors.textSecondary)
                    case .notStarted:
                        Text("· not started")
                            .font(DesignTokens.Typography.labelSmall)
                            .foregroundColor(DesignTokens.Colors.textTertiary)
                    case .unknown:
                        EmptyView()
                    }
                }
            }

            HStack(spacing: DesignTokens.Spacing.sm) {
                // A session with no topic has nowhere to go: the Classroom
                // needs something to teach, so the row renders without the
                // button rather than opening an empty one.
                if let entry = TestPrepPresentation.classroomEntry(for: session) {
                    Button("Start") {
                        classroomEntry = ClassroomEntry(
                            id: session.id,
                            courseId: entry.courseId,
                            title: entry.title,
                            durationMinutes: entry.durationMinutes
                        )
                    }
                    .font(DesignTokens.Typography.labelLarge)
                    .foregroundColor(DesignTokens.Colors.accent)
                }

                Button("Done") {
                    Task { await model.finish(session: session) }
                }
                .font(DesignTokens.Typography.labelLarge)
                .foregroundColor(DesignTokens.Colors.textSecondary)
                .disabled(model.state.finishing != nil)

                if model.state.finishing == session.id {
                    ProgressView().tint(DesignTokens.Colors.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(DesignTokens.Spacing.md)
        .background(DesignTokens.Colors.surface)
        .cornerRadius(DesignTokens.Radius.lg)
    }

    // MARK: -

    private func noticeBox(_ text: String) -> some View {
        Text(text)
            .font(DesignTokens.Typography.bodySmall)
            .foregroundColor(DesignTokens.Colors.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(DesignTokens.Spacing.sm)
            .background(DesignTokens.Colors.surfaceElevated)
            .cornerRadius(DesignTokens.Radius.md)
    }
}
