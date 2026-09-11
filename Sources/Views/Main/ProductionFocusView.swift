import SwiftUI

/// Production Focus surface.
///
/// This view intentionally renders only values backed by the authenticated user,
/// the persisted course-session stack, and the personalization service. It does
/// not synthesize daily XP, durations, social activity, or recommended courses.
struct FocusView: View {
    @EnvironmentObject private var rootViewModel: RootViewModel
    @EnvironmentObject private var uiState: AppUIState
    @EnvironmentObject private var uiStackStore: UIStackStore

    @State private var isRefreshing = false

    private var user: User? { rootViewModel.currentUser }

    private var activeCourses: [UIStackItem] {
        uiStackStore.items
            .filter {
                $0.type == .course &&
                !($0.courseId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
            }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    private var nextCourse: UIStackItem? {
        activeCourses.first { ($0.progress ?? 0) < 1 } ?? activeCourses.first
    }

    var body: some View {
        NavigationStack {
            ZStack {
                focusBackground
                    .ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    LazyVStack(alignment: .leading, spacing: 24) {
                        greeting
                        profileMetrics
                        testPrepSection
                        WeeklyQuestBanner()
                        continueLearningSection
                        recentLearningSection
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, 130)
                }
                .refreshable {
                    await refresh()
                }

                if isRefreshing {
                    VStack {
                        ProgressView()
                            .tint(.white)
                            .padding(12)
                            .background(.ultraThinMaterial, in: Circle())
                            .padding(.top, 8)
                        Spacer()
                    }
                    .transition(.opacity)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .task {
                await refresh()
            }
        }
    }

    private var focusBackground: some View {
        ZStack {
            LinearGradient(
                colors: [Color(hex: "050810"), Color(hex: "0A1020"), Color(hex: "0D0F18")],
                startPoint: .top,
                endPoint: .bottom
            )

            RadialGradient(
                colors: [Color(hex: "7C3AED").opacity(0.24), .clear],
                center: .topTrailing,
                startRadius: 30,
                endRadius: 420
            )

            RadialGradient(
                colors: [Color(hex: "0EA5E9").opacity(0.13), .clear],
                center: .bottomLeading,
                startRadius: 40,
                endRadius: 380
            )
        }
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(timeBasedGreeting)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white.opacity(0.68))

            Text(displayName)
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.72)

            Text(learningStatusText)
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.62))
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var profileMetrics: some View {
        if let user {
            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                spacing: 12
            ) {
                FocusMetricTile(
                    title: "Total XP",
                    value: user.xp.formatted(),
                    icon: "sparkles",
                    accent: Color(hex: "FBBF24")
                )
                FocusMetricTile(
                    title: "Streak",
                    value: "\(user.streak) days",
                    icon: "flame.fill",
                    accent: Color(hex: "F97316")
                )
                FocusMetricTile(
                    title: "Lessons completed",
                    value: user.totalLessonsCompleted.formatted(),
                    icon: "checkmark.seal.fill",
                    accent: Color(hex: "22C55E")
                )
                FocusMetricTile(
                    title: "Level",
                    value: user.level.formatted(),
                    icon: "chart.bar.fill",
                    accent: Color(hex: "8B5CF6")
                )
            }
        } else {
            FocusNoticeCard(
                icon: "person.crop.circle.badge.exclamationmark",
                title: "Profile data unavailable",
                message: "Pull to refresh your account data. No learner totals are being estimated."
            )
        }
    }

    /// The way in to Test Prep.
    ///
    /// Until this existed, no iOS learner could create a study plan at all:
    /// a plan is built by a conversation with the server (`intake/turn` until
    /// it says it has enough, then `plans/generate`), and nothing on this
    /// platform ran it. The readiness, today's-sessions and stats endpoints
    /// were live the whole time with no possible data behind them.
    private var testPrepSection: some View {
        VStack(alignment: .leading, spacing: 13) {
            FocusSectionHeader(
                title: "Have a test coming up?",
                subtitle: "Tell me what and when, and I'll plan it with you"
            )

            NavigationLink {
                TestPrepView()
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.system(size: 22))
                        .foregroundStyle(DesignTokens.Colors.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Test prep")
                            .font(.headline)
                            .foregroundStyle(.white)
                        Text("See how ready you are, and what to do first")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.52))
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.35))
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens test prep, where you can build a study plan")
        }
    }

    private var continueLearningSection: some View {
        VStack(alignment: .leading, spacing: 13) {
            FocusSectionHeader(title: "Continue learning", subtitle: "Your most recent active session")

            if let nextCourse {
                Button {
                    openCourse(nextCourse)
                } label: {
                    FocusPrimaryCourseCard(item: nextCourse)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens this course in the classroom")
            } else {
                FocusEmptyLearningCard {
                    uiState.isLioChatPresented = true
                }
            }
        }
    }

    @ViewBuilder
    private var recentLearningSection: some View {
        if activeCourses.count > 1 {
            VStack(alignment: .leading, spacing: 13) {
                FocusSectionHeader(title: "Recent learning", subtitle: "Saved sessions from your stack")

                VStack(spacing: 10) {
                    ForEach(Array(activeCourses.dropFirst().prefix(5))) { item in
                        Button {
                            openCourse(item)
                        } label: {
                            FocusCompactCourseRow(item: item)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var displayName: String {
        let trimmed = user?.name.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return "Learner" }
        return trimmed.split(separator: " ").first.map(String.init) ?? trimmed
    }

    private var timeBasedGreeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12: return "Good morning"
        case 12..<17: return "Good afternoon"
        case 17..<22: return "Good evening"
        default: return "Welcome back"
        }
    }

    private var learningStatusText: String {
        guard let user else {
            return "Your learning summary will appear when your profile loads."
        }
        if user.streak > 0 {
            return "Your current learning streak is \(user.streak) days."
        }
        if nextCourse != nil {
            return "Resume a saved session to begin your learning streak."
        }
        return "Start a lesson with Lyo to build your learning plan."
    }

    @MainActor
    private func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        async let profileRefresh: Void = rootViewModel.refreshUserData()
        async let recommendationRefresh: Void = uiStackStore.refreshDueReviews()
        _ = await (profileRefresh, recommendationRefresh)
    }

    private func openCourse(_ item: UIStackItem) {
        guard let courseId = item.courseId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !courseId.isEmpty else {
            return
        }

        var userInfo: [AnyHashable: Any] = [
            "courseId": courseId,
            "courseTitle": item.title,
            "lessonTitle": item.subtitle ?? item.title,
            "shouldGenerateCourse": courseId.hasPrefix("GENERATE:")
        ]

        if let lessonId = item.lessonId, !lessonId.isEmpty {
            userInfo["lessonId"] = lessonId
        }
        if courseId.hasPrefix("GENERATE:") {
            userInfo["topic"] = String(courseId.dropFirst("GENERATE:".count))
        }

        HapticManager.shared.medium()
        NotificationCenter.default.post(
            name: .openClassroom,
            object: nil,
            userInfo: userInfo
        )
    }
}

private struct FocusSectionHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.title3.bold())
                .foregroundStyle(.white)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.52))
        }
    }
}

private struct FocusMetricTile: View {
    let title: String
    let value: String
    let icon: String
    let accent: Color

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.headline)
                .foregroundStyle(accent)
                .frame(width: 38, height: 38)
                .background(accent.opacity(0.13), in: RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.54))
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct FocusPrimaryCourseCard: View {
    let item: UIStackItem

    private var progress: Double? {
        item.progress.map { max(0, min($0, 1)) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "graduationcap.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 52, height: 52)
                    .background(
                        LinearGradient(
                            colors: [Color(hex: "7C3AED"), Color(hex: "2563EB")],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        in: RoundedRectangle(cornerRadius: 16)
                    )

                VStack(alignment: .leading, spacing: 5) {
                    Text(item.title)
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.leading)
                    if let subtitle = item.subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.62))
                            .lineLimit(2)
                    }
                }

                Spacer(minLength: 8)

                Image(systemName: "play.circle.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(.white)
            }

            if let progress {
                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text("Progress")
                        Spacer()
                        Text("\(Int(progress * 100))%")
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.66))

                    ProgressView(value: progress)
                        .tint(Color(hex: "60A5FA"))
                }
            }

            HStack(spacing: 6) {
                Image(systemName: "clock.arrow.circlepath")
                Text(item.updatedAt, style: .relative)
                Text("ago")
            }
            .font(.caption2)
            .foregroundStyle(.white.opacity(0.46))
        }
        .padding(20)
        .background(
            LinearGradient(
                colors: [Color(hex: "312E81").opacity(0.58), Color.white.opacity(0.055)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 24)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 24)
                .stroke(Color.white.opacity(0.11), lineWidth: 1)
        }
    }
}

private struct FocusCompactCourseRow: View {
    let item: UIStackItem

    var body: some View {
        HStack(spacing: 13) {
            Image(systemName: "book.closed.fill")
                .foregroundStyle(Color(hex: "A78BFA"))
                .frame(width: 38, height: 38)
                .background(Color(hex: "A78BFA").opacity(0.12), in: RoundedRectangle(cornerRadius: 11))

            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                if let subtitle = item.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.54))
                        .lineLimit(1)
                }
            }

            Spacer()

            if let progress = item.progress {
                Text("\(Int(max(0, min(progress, 1)) * 100))%")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white.opacity(0.7))
            }

            Image(systemName: "chevron.right")
                .font(.caption.bold())
                .foregroundStyle(.white.opacity(0.36))
        }
        .padding(14)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.white.opacity(0.07), lineWidth: 1)
        }
    }
}

private struct FocusEmptyLearningCard: View {
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack(spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.title2)
                    .foregroundStyle(Color(hex: "A78BFA"))
                VStack(alignment: .leading, spacing: 3) {
                    Text("No active learning session")
                        .font(.headline)
                        .foregroundStyle(.white)
                    Text("Ask Lyo to create a course or learning plan. Nothing is being filled with sample content.")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.58))
                }
            }

            Button(action: action) {
                Label("Plan with Lyo", systemImage: "message.fill")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 11)
                    .background(Color(hex: "7C3AED"), in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 22))
        .overlay {
            RoundedRectangle(cornerRadius: 22)
                .stroke(Color.white.opacity(0.09), lineWidth: 1)
        }
    }
}

private struct FocusNoticeCard: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Color(hex: "FBBF24"))
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.58))
            }
            Spacer()
        }
        .padding(16)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 18))
    }
}
