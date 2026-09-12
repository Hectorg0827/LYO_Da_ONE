import Foundation

// MARK: - Test Prep presentation rules
//
// What a learner is told about a test they have coming up.
//
// These are pure functions with no view and no network, for the same reason
// `test-prep.mjs` and `test-prep-state.mjs` exist on web: this is exactly the
// logic that kept being got wrong there — eleven rounds of review, six of them
// on one screen, four caused by the previous round's fix — and a decision
// buried in a SwiftUI body cannot be unit-tested, while this can.
//
// The rule underneath all of them: the product must not tell a learner
// something nothing measured. "Never assessed" and "assessed at nothing" are
// one number apart and a world apart in what they claim about a person.

/// What to say about a figure that may not exist.
enum MeasuredValue: Equatable {
    /// A real measurement, 0...100, rounded for display only.
    case measured(percent: Int)
    /// A plan exists, nothing on it has been assessed. Not zero.
    case notStarted
    /// Nothing usable to report on at all.
    case unknown
}

enum TestPrepPresentation {

    // MARK: Readiness

    /// How ready the learner is, or why there is no number to give.
    ///
    /// A brand-new plan carries a readiness of 0.0 and nothing assessed.
    /// Rendering that as "0% ready" would tell someone they had failed
    /// something nobody ever asked them, so the three cases are kept apart
    /// here and the view branches on them rather than formatting a Double.
    static func readinessHeadline(_ readiness: PlanReadiness?) -> MeasuredValue {
        guard let readiness else { return .unknown }
        guard readiness.topicsTotal > 0 else { return .unknown }
        guard readiness.topicsAssessed > 0 else { return .notStarted }
        // Checked before use rather than defaulted: `readiness.readiness ?? 0`
        // would report a missing figure as a measured zero, which is the exact
        // fabrication this type exists to prevent. The server only returns nil
        // when there are no topics — already caught above — but the client
        // must not depend on the server never changing its mind.
        guard let value = readiness.readiness else { return .unknown }
        return .measured(percent: percent(value))
    }

    /// How one topic stands. `mastery: nil` means never assessed.
    static func topicStanding(_ topic: TopicStanding) -> MeasuredValue {
        guard let mastery = topic.mastery else { return .notStarted }
        return .measured(percent: percent(mastery))
    }

    /// How long until the test.
    ///
    /// A negative count means the test has been and gone, which a learner
    /// should be told plainly rather than shown as "-3 days to go".
    static func daysLabel(_ daysRemaining: Int?) -> String? {
        guard let days = daysRemaining else { return nil }
        if days < 0 { return "This test has passed" }
        if days == 0 { return "Your test is today" }
        if days == 1 { return "1 day to go" }
        return "\(days) days to go"
    }

    // MARK: Sessions

    /// Sessions the learner has not finished yet, soonest first.
    ///
    /// Rows whose timestamp will not parse sort last rather than being
    /// dropped: a session the client cannot read the date of is still a
    /// session the learner is meant to do.
    static func openSessions(_ sessions: [PlannedSession]) -> [PlannedSession] {
        sessions
            .filter(\.isOpen)
            .sorted { left, right in
                switch (left.scheduledDate, right.scheduledDate) {
                case let (l?, r?): return l < r
                case (nil, _?): return false
                case (_?, nil): return true
                case (nil, nil): return left.id < right.id
                }
            }
    }

    /// The learner's standing on the topic a session teaches, if readiness
    /// knows about it.
    ///
    /// Matched on `conceptId`, which the server puts on both sides precisely
    /// so neither has to re-derive a slug and drift. Matching on the human
    /// topic string would work until the day one of them was capitalised
    /// differently.
    static func standing(
        forSession session: PlannedSession,
        in readiness: PlanReadiness?
    ) -> TopicStanding? {
        readiness?.topics.first { $0.conceptId == session.conceptId }
    }

    // MARK: Finishing a session

    /// What to tell a learner who just finished a session.
    ///
    /// The visible half of the trust fix: the client sends no score, the
    /// server replies with what it actually measured, and this reports that
    /// reply — including when the reply is "nothing was graded", which is the
    /// ordinary outcome of an hour spent reading.
    static func completionSummary(_ outcome: SessionOutcome?) -> String {
        guard let outcome else {
            return "That is marked done. I could not read what the server measured."
        }
        // Checked before use, not defaulted: a nil score reported as 0% would
        // invent the failure that removing client-sent scores was meant to stop.
        if outcome.graded > 0, let score = outcome.performanceScore {
            return "Marked done — you scored \(percent(score))% on what was graded."
        }
        if outcome.graded > 0 || outcome.seen > 0 {
            return "Marked done. Nothing in this session was graded, so there is no score."
        }
        return "Marked done. The server saw no work recorded for this session."
    }

    // MARK: Opening the Classroom

    /// How a scheduled session is handed to the Classroom.
    ///
    /// `GENERATE:` is this app's existing convention for "teach this topic,
    /// there is no course behind it" — `LivingClassroomService` strips it and
    /// sends the remainder as the session id. Reusing it rather than inventing
    /// a second way in is the whole point of Phase C.
    ///
    /// The human topic is what travels, not `conceptId`: the server derives
    /// the concept from the topic with the same `slugify_skill` that produced
    /// `conceptId`, so they agree by construction, and a learner should never
    /// be told they are studying "long_division".
    ///
    /// Returns nil for a session with no topic. A Classroom with nothing to
    /// teach is not a destination, and the row should render without a link
    /// rather than opening an empty one.
    /// The planned length travels too. This screen tells the learner a session
    /// is 45 minutes; opening a Classroom that plans ten, and counts against a
    /// five-minute target, makes that a promise the product does not keep.
    /// A non-positive length is dropped rather than passed on, so the
    /// Classroom's own default applies instead of a nonsense one.
    static func classroomEntry(
        for session: PlannedSession
    ) -> (courseId: String, title: String, durationMinutes: Int?)? {
        let topic = session.topic.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !topic.isEmpty else { return nil }
        let minutes = session.durationMinutes > 0 ? session.durationMinutes : nil
        return (courseId: "GENERATE:\(topic)", title: topic, durationMinutes: minutes)
    }

    // MARK: Intake

    /// Is the intake conversation finished and ready to become a plan?
    ///
    /// The server decides this, not the client counting turns.
    static func intakeIsComplete(_ turn: IntakeTurnReply?) -> Bool {
        guard let turn else { return false }
        return turn.intakeComplete && !turn.testProfileId.isEmpty
    }

    /// The plan to show: the newest active one, else the newest of any.
    ///
    /// Ordered by `createdAt` rather than by arrival, which the route does not
    /// promise. String comparison is correct here and only here because these
    /// are fixed-width ISO timestamps from one server clock.
    static func currentPlan(_ plans: [StudyPlanSummary]) -> StudyPlanSummary? {
        let active = plans.filter(\.isActive)
        let pool = active.isEmpty ? plans : active
        return pool.max { $0.createdAt < $1.createdAt }
    }

    // MARK: -

    private static func percent(_ value: Double) -> Int {
        Int((min(max(value, 0), 1) * 100).rounded())
    }
}
