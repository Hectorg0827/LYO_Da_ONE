import XCTest
@testable import Lyo

// The rules this screen exists to hold, driven directly rather than through a
// SwiftUI body. On web the same screen collected six rounds of review
// findings, four of them defects in the fix for the round before, and moving
// the decisions out of the view is what ended the streak. Nobody in this
// workstream can tap through the iOS build, so the decisions being reachable
// by a test is the only verification this logic gets.

final class TestPrepDecodingTests: XCTestCase {

    /// The exact JSON the server's own Pydantic models produce. Captured from
    /// them rather than transcribed from the route signatures, because the two
    /// things that break a hand-written client here are invisible in the
    /// signatures: `scheduled_at` carries no timezone and `test_date` is a
    /// calendar date.
    func testASessionDecodesDespiteATimestampWithNoTimezone() throws {
        let json = """
        {"id":"s1","study_plan_id":"p1","user_id":1,
         "scheduled_at":"2026-09-11T22:00:00","duration_minutes":45,
         "topic":"Long division","session_type":"practice","module_id":null,
         "status":"scheduled","completed_at":null,"performance_score":null,
         "user_notes":null,"agent_notes":null,"concept_id":"long_division"}
        """.data(using: .utf8)!

        let session = try JSONDecoder.lyoDecoder.decode(PlannedSession.self, from: json)

        XCTAssertEqual(session.topic, "Long division")
        XCTAssertEqual(session.conceptId, "long_division")
        XCTAssertNil(session.performanceScore)
        XCTAssertTrue(session.isOpen)
        // The decoder would have thrown on this as a `Date`, failing the whole
        // list — a correct answer reported to the learner as an error.
        XCTAssertNotNil(session.scheduledDate, "a naive timestamp must still parse")
    }

    func testReadinessDecodesACalendarTestDate() throws {
        let json = """
        {"plan_id":"p1","subject":"Maths","test_date":"2026-09-25",
         "days_remaining":14,"readiness":0.4,"topics_total":2,
         "topics_assessed":1,
         "topics":[{"topic":"Long division","concept_id":"long_division",
                    "weight":1.0,"mastery":null,"attempts":0}],
         "focus_next":["Long division"]}
        """.data(using: .utf8)!

        let readiness = try JSONDecoder.lyoDecoder.decode(PlanReadiness.self, from: json)

        XCTAssertEqual(readiness.testDate, "2026-09-25")
        XCTAssertEqual(readiness.topics.count, 1)
        XCTAssertNil(readiness.topics[0].mastery, "null mastery is not zero")
    }

    func testAPlanSummaryIgnoresTheFieldsItDoesNotNeed() throws {
        // The type this replaces could not have decoded a real response at
        // all: it typed `id` as an Int where the wire sends a UUID string.
        let json = """
        {"id":"p1","test_profile_id":"tp1","user_id":1,
         "created_at":"2026-09-11T22:00:00","updated_at":"2026-09-11T22:00:00",
         "status":"active","version":1,"total_sessions":12,
         "weekly_milestones":[],"generated_by_agent":null,
         "generation_notes":null}
        """.data(using: .utf8)!

        let plan = try JSONDecoder.lyoDecoder.decode(StudyPlanSummary.self, from: json)

        XCTAssertEqual(plan.id, "p1")
        XCTAssertTrue(plan.isActive)
    }

    func testAnUnreadableTimestampIsNilRatherThanNow() {
        // Defaulting to the current time would silently sort a broken row to
        // the middle of the learner's day.
        XCTAssertNil(TestPrepDateParsing.parse(""))
        XCTAssertNil(TestPrepDateParsing.parse("not a date"))
        XCTAssertNotNil(TestPrepDateParsing.parse("2026-09-11T22:00:00Z"))
        XCTAssertNotNil(TestPrepDateParsing.parse("2026-09-11T22:00:00.123456"))
    }
}

/// Builds a session row with one field varied, for the cases the shared
/// `session()` helper cannot express.
enum StudySessionFixture {
    static func with(durationMinutes: Int) -> PlannedSession {
        PlannedSession(
            id: "s1", scheduledAt: "2026-09-11T09:00:00",
            durationMinutes: durationMinutes, topic: "Long division",
            sessionType: "practice", conceptId: "long_division",
            status: "scheduled", performanceScore: nil
        )
    }
}

final class TestPrepPresentationTests: XCTestCase {

    private func readiness(
        readiness value: Double?,
        total: Int,
        assessed: Int,
        topics: [TopicStanding] = [],
        focus: [String] = []
    ) -> PlanReadiness {
        PlanReadiness(
            planId: "p1", subject: "Maths", testDate: "2026-09-25",
            daysRemaining: 14, readiness: value, topicsTotal: total,
            topicsAssessed: assessed, topics: topics, focusNext: focus
        )
    }

    private func session(
        id: String = "s1",
        topic: String = "Long division",
        conceptId: String = "long_division",
        at: String = "2026-09-11T09:00:00",
        status: String = "scheduled"
    ) -> PlannedSession {
        PlannedSession(
            id: id, scheduledAt: at, durationMinutes: 45, topic: topic,
            sessionType: "practice", conceptId: conceptId, status: status,
            performanceScore: nil
        )
    }

    // MARK: Never assessed is not zero

    func testANewPlanSaysYouHaveNotStartedRatherThanZeroPercent() {
        // A brand-new plan carries a readiness of 0.0 with nothing assessed.
        // Both render as a number; only one of them is true about a person who
        // has not been asked anything.
        let headline = TestPrepPresentation.readinessHeadline(
            readiness(readiness: 0.0, total: 4, assessed: 0)
        )

        XCTAssertEqual(headline, .notStarted)
    }

    func testAMeasuredZeroIsStillReportedAsZero() {
        // Measured and nothing demonstrated is a real finding, and hiding it
        // would be the opposite failure.
        let headline = TestPrepPresentation.readinessHeadline(
            readiness(readiness: 0.0, total: 4, assessed: 4)
        )

        XCTAssertEqual(headline, .measured(percent: 0))
    }

    func testAMissingFigureIsNotReportedAsZero() {
        let headline = TestPrepPresentation.readinessHeadline(
            readiness(readiness: nil, total: 4, assessed: 2)
        )

        XCTAssertEqual(headline, .unknown)
    }

    func testATestWithNoTopicsHasNothingToBeReadyFor() {
        XCTAssertEqual(
            TestPrepPresentation.readinessHeadline(readiness(readiness: nil, total: 0, assessed: 0)),
            .unknown
        )
        XCTAssertEqual(TestPrepPresentation.readinessHeadline(nil), .unknown)
    }

    func testAFigureIsRoundedAndClampedForDisplayOnly() {
        XCTAssertEqual(
            TestPrepPresentation.readinessHeadline(readiness(readiness: 0.416, total: 4, assessed: 2)),
            .measured(percent: 42)
        )
        XCTAssertEqual(
            TestPrepPresentation.readinessHeadline(readiness(readiness: 1.4, total: 4, assessed: 4)),
            .measured(percent: 100)
        )
    }

    func testATopicNobodyAskedAboutReportsNotStarted() {
        let untouched = TopicStanding(
            topic: "Long division", conceptId: "long_division",
            weight: 1, mastery: nil, attempts: 0
        )
        let attempted = TopicStanding(
            topic: "Fractions", conceptId: "fractions",
            weight: 1, mastery: 0.0, attempts: 3
        )

        XCTAssertEqual(TestPrepPresentation.topicStanding(untouched), .notStarted)
        XCTAssertEqual(TestPrepPresentation.topicStanding(attempted), .measured(percent: 0))
    }

    // MARK: The date

    func testAPassedTestIsSaidPlainly() {
        XCTAssertEqual(TestPrepPresentation.daysLabel(-3), "This test has passed")
        XCTAssertEqual(TestPrepPresentation.daysLabel(0), "Your test is today")
        XCTAssertEqual(TestPrepPresentation.daysLabel(1), "1 day to go")
        XCTAssertEqual(TestPrepPresentation.daysLabel(9), "9 days to go")
        XCTAssertNil(TestPrepPresentation.daysLabel(nil))
    }

    // MARK: Sessions

    func testOpenSessionsExcludeFinishedOnesAndSortByTime() {
        let rows = [
            session(id: "late", at: "2026-09-11T18:00:00"),
            session(id: "done", status: "completed"),
            session(id: "skipped", status: "skipped"),
            session(id: "early", at: "2026-09-11T08:00:00"),
        ]

        let open = TestPrepPresentation.openSessions(rows).map(\.id)

        XCTAssertEqual(open, ["early", "late"])
    }

    func testASessionWithAnUnreadableTimeIsKeptAndSortedLast() {
        // It is still a session the learner is meant to do. Dropping it would
        // quietly shorten their day.
        let rows = [
            session(id: "broken", at: "sometime"),
            session(id: "fine", at: "2026-09-11T08:00:00"),
        ]

        XCTAssertEqual(TestPrepPresentation.openSessions(rows).map(\.id), ["fine", "broken"])
    }

    func testASessionIsMatchedToItsStandingByConceptIdNotTopicText() {
        // The server puts `concept_id` on both sides so neither re-derives a
        // slug. Matching on the human string would work until the day one of
        // them was capitalised differently — which is the class of bug that
        // split this learner record in the first place.
        let standing = TopicStanding(
            topic: "long division", conceptId: "long_division",
            weight: 1, mastery: 0.5, attempts: 2
        )
        let row = session(topic: "Long Division", conceptId: "long_division")

        let matched = TestPrepPresentation.standing(
            forSession: row,
            in: readiness(readiness: 0.5, total: 1, assessed: 1, topics: [standing])
        )

        XCTAssertEqual(matched?.conceptId, "long_division")
    }

    // MARK: Opening the Classroom

    func testASessionOpensTheClassroomOnItsHumanTopic() {
        let entry = TestPrepPresentation.classroomEntry(for: session())

        // `GENERATE:` is this app's existing convention for a topic with no
        // course behind it; `LivingClassroomService` strips it.
        XCTAssertEqual(entry?.courseId, "GENERATE:Long division")
        // Not the concept id: a learner should never be told they are about to
        // study "long_division". The server derives the concept from the topic
        // with the same slug rule that produced `conceptId`.
        XCTAssertEqual(entry?.title, "Long division")
    }

    func testTheSessionsPlannedLengthTravelsWithIt() {
        // The row says "45 min". Opening a Classroom that plans ten and counts
        // against a five-minute target makes that a promise the product does
        // not keep.
        let entry = TestPrepPresentation.classroomEntry(for: session())

        XCTAssertEqual(entry?.durationMinutes, 45)
    }

    func testANonsenseLengthIsDroppedRatherThanPassedOn() {
        // So the Classroom's own default applies instead of a zero-minute one.
        let zero = StudySessionFixture.with(durationMinutes: 0)
        let negative = StudySessionFixture.with(durationMinutes: -5)

        XCTAssertNil(TestPrepPresentation.classroomEntry(for: zero)?.durationMinutes)
        XCTAssertNil(TestPrepPresentation.classroomEntry(for: negative)?.durationMinutes)
    }

    func testASessionWithNoTopicHasNowhereToGo() {
        XCTAssertNil(TestPrepPresentation.classroomEntry(for: session(topic: "   ")))
    }

    // MARK: Finishing

    func testAGradedSessionReportsWhatTheServerMeasured() {
        let summary = TestPrepPresentation.completionSummary(
            SessionOutcome(ok: true, performanceScore: 0.75, graded: 3, seen: 5)
        )

        XCTAssertTrue(summary.contains("75%"), summary)
    }

    func testASessionWithNothingGradedIsNotReportedAsZero() {
        // An hour spent reading is a real session. Calling it 0% would invent
        // the failure that removing client-sent scores was meant to stop.
        let summary = TestPrepPresentation.completionSummary(
            SessionOutcome(ok: true, performanceScore: nil, graded: 0, seen: 4)
        )

        XCTAssertTrue(summary.contains("no score"), summary)
        XCTAssertFalse(summary.contains("0%"), summary)
    }

    func testANullScoreBesideGradedWorkIsStillNotZero() {
        let summary = TestPrepPresentation.completionSummary(
            SessionOutcome(ok: true, performanceScore: nil, graded: 2, seen: 2)
        )

        XCTAssertFalse(summary.contains("0%"), summary)
    }

    func testNoReplyAtAllIsSaidRatherThanAssumed() {
        let summary = TestPrepPresentation.completionSummary(nil)

        XCTAssertTrue(summary.contains("could not read"), summary)
    }

    // MARK: Which plan

    func testTheNewestActivePlanWins() {
        let plans = [
            StudyPlanSummary(id: "old", testProfileId: "t", status: "active",
                             createdAt: "2026-09-01T10:00:00", totalSessions: 5),
            StudyPlanSummary(id: "new", testProfileId: "t", status: "active",
                             createdAt: "2026-09-09T10:00:00", totalSessions: 5),
            StudyPlanSummary(id: "archived", testProfileId: "t", status: "archived",
                             createdAt: "2026-09-10T10:00:00", totalSessions: 5),
        ]

        XCTAssertEqual(TestPrepPresentation.currentPlan(plans)?.id, "new")
    }

    func testWithNoActivePlanTheNewestOfAnyIsShown() {
        let plans = [
            StudyPlanSummary(id: "a", testProfileId: "t", status: "archived",
                             createdAt: "2026-09-01T10:00:00", totalSessions: 5),
            StudyPlanSummary(id: "b", testProfileId: "t", status: "archived",
                             createdAt: "2026-09-05T10:00:00", totalSessions: 5),
        ]

        XCTAssertEqual(TestPrepPresentation.currentPlan(plans)?.id, "b")
        XCTAssertNil(TestPrepPresentation.currentPlan([]))
    }

    // MARK: Intake completion is the server's call

    func testIntakeIsCompleteOnlyWhenTheServerSaysSo() {
        XCTAssertTrue(TestPrepPresentation.intakeIsComplete(
            IntakeTurnReply(testProfileId: "tp1", messageToUser: "Got it.", intakeComplete: true)
        ))
        XCTAssertFalse(TestPrepPresentation.intakeIsComplete(
            IntakeTurnReply(testProfileId: "tp1", messageToUser: "When is it?", intakeComplete: false)
        ))
        XCTAssertFalse(TestPrepPresentation.intakeIsComplete(
            IntakeTurnReply(testProfileId: "", messageToUser: "Got it.", intakeComplete: true)
        ))
        XCTAssertFalse(TestPrepPresentation.intakeIsComplete(nil))
    }
}

final class TestPrepStateTests: XCTestCase {

    private func loaded() -> TestPrepState {
        var state = TestPrepState()
        state.loadStarted()
        state.planLoaded(id: "p1")
        state.detailsLoaded(
            readiness: PlanReadiness(
                planId: "p1", subject: "Maths", testDate: "2026-09-25",
                daysRemaining: 14, readiness: 0.4, topicsTotal: 2,
                topicsAssessed: 1, topics: [], focusNext: []
            ),
            sessions: [row("s1"), row("s2")]
        )
        state.loadSettled()
        return state
    }

    private func row(_ id: String) -> PlannedSession {
        PlannedSession(
            id: id, scheduledAt: "2026-09-11T09:00:00", durationMinutes: 30,
            topic: "Long division", sessionType: "practice",
            conceptId: "long_division", status: "scheduled", performanceScore: nil
        )
    }

    // MARK: A refresh never destroys what is on screen

    func testTheFirstLoadBlanksTheScreenAndARefreshDoesNot() {
        var first = TestPrepState()
        first.loadStarted()
        XCTAssertTrue(first.loading)

        var after = loaded()
        after.loadStarted()
        XCTAssertFalse(after.loading, "a refresh unmounted the plan view")
    }

    func testAFailedSessionsCallKeepsTheRowsAlreadyShown() {
        var state = loaded()
        state.detailsLoaded(readiness: nil, sessions: nil)

        XCTAssertEqual(state.sessions.count, 2)
        XCTAssertTrue(state.sessionsFailed)
    }

    // MARK: A failed request is never a fact about the learner

    func testAFailedRefreshDoesNotSendALearnerWithAPlanBackToIntake() {
        // They would answer the intake questions again and come out with a
        // second plan, because one request happened to fail.
        var state = loaded()
        state.loadFailed()

        XCTAssertEqual(state.stage, .plan)
        XCTAssertEqual(state.planId, "p1")
        XCTAssertNotNil(state.staleWarning)
    }

    func testAFailedFirstLoadSendsThemToIntakeAndSaysSo() {
        var state = TestPrepState()
        state.loadStarted()
        state.loadFailed()

        XCTAssertEqual(state.stage, .intake)
        XCTAssertTrue(state.planLoadFailed)
    }

    func testOnlyASuccessfulEmptyListMeansNoPlan() {
        var state = loaded()
        state.noPlan()

        XCTAssertEqual(state.stage, .intake)
        XCTAssertNil(state.planId)
    }

    func testStartingALoadClearsThePreviousFailureNotices() {
        var state = loaded()
        state.loadFailed()
        state.loadStarted()

        XCTAssertFalse(state.refreshFailed)
        XCTAssertFalse(state.planLoadFailed)
    }

    // MARK: Finishing a session

    func testAFinishedSessionLeavesTheListImmediately() {
        var state = loaded()
        state.finishSucceeded(sessionId: "s1", notice: "Marked done.")

        XCTAssertEqual(state.sessions.map(\.id), ["s2"])
        XCTAssertEqual(state.notice, "Marked done.")
        XCTAssertNil(state.finishing)
    }

    func testTheResultSurvivesARefreshThatFailsStraightAfterwards() {
        // The whole point of finishing is being told what the server measured.
        // A failed refresh must not take that away, and must not leave the row
        // looking open either.
        var state = loaded()
        state.finishSucceeded(sessionId: "s1", notice: "Nothing was graded.")
        state.loadFailed()

        XCTAssertEqual(state.notice, "Nothing was graded.")
        XCTAssertEqual(state.sessions.map(\.id), ["s2"])
        XCTAssertNotNil(state.staleWarning)
    }

    func testStartingANewFinishClearsThePreviousResult() {
        // Otherwise the score from the last session sits above a different one.
        var state = loaded()
        state.finishSucceeded(sessionId: "s1", notice: "Scored 75%.")
        state.finishStarted(sessionId: "s2")

        XCTAssertNil(state.notice)
        XCTAssertEqual(state.finishing, "s2")
    }

    func testAFailedFinishSaysSoAndStopsSpinning() {
        var state = loaded()
        state.finishStarted(sessionId: "s1")
        state.finishFailed(notice: "I could not mark that done just now.")

        XCTAssertNil(state.finishing)
        XCTAssertEqual(state.notice, "I could not mark that done just now.")
    }

    // MARK: One failure, one sentence, in the right place

    func testARefreshFailureDoesNotOverwriteAGenuinelyEmptyDay() {
        // The sessions call succeeded and returned nothing; that is a fact
        // about the day. Only the overall refresh failed, which is a fact
        // about the request.
        var state = loaded()
        state.detailsLoaded(readiness: nil, sessions: [])
        state.loadFailed()

        XCTAssertNotNil(state.staleWarning)
        XCTAssertNil(state.sessionsNote, "the day is empty, not unknown")
    }

    func testAFailedSessionsCallDoesNotClaimTheWholeScreenIsStale() {
        var state = loaded()
        state.detailsLoaded(readiness: nil, sessions: nil)

        XCTAssertNil(state.staleWarning)
        XCTAssertNotNil(state.sessionsNote)
    }

    func testTwoDifferentFailuresNeverProduceTheSameSentenceTwice() {
        var state = loaded()
        state.detailsLoaded(readiness: nil, sessions: nil)
        state.loadFailed()

        XCTAssertNotNil(state.staleWarning)
        XCTAssertNotNil(state.sessionsNote)
        XCTAssertNotEqual(state.staleWarning, state.sessionsNote)
    }

    // MARK: The Today section, in every combination

    func testASessionsFailureIsReportedWhetherOrNotRowsRemain() {
        // The failure used to be rendered only in the empty branch, so a
        // refresh that failed while keeping rows told the learner nothing.
        var state = loaded()
        state.detailsLoaded(readiness: nil, sessions: nil)

        XCTAssertNotNil(state.todayCopy(openCount: 2).note, "silent while rows remain")
        XCTAssertNotNil(state.todayCopy(openCount: 0).note, "silent on an empty list")
    }

    func testAnEmptyListAfterAFailedCallIsNotAnEmptyDay() {
        var state = loaded()
        state.detailsLoaded(readiness: nil, sessions: nil)

        XCTAssertNil(state.todayCopy(openCount: 0).emptyMessage)
    }

    func testAGenuinelyEmptyDaySaysSo() {
        var state = loaded()
        state.detailsLoaded(readiness: nil, sessions: [])

        XCTAssertEqual(state.todayCopy(openCount: 0).emptyMessage, "Nothing scheduled for today.")
        XCTAssertNil(state.todayCopy(openCount: 0).note)
    }

    func testAWorkingDayWithSessionsSaysNothingExtra() {
        let state = loaded()
        let copy = state.todayCopy(openCount: 2)

        XCTAssertNil(copy.note)
        XCTAssertNil(copy.emptyMessage)
    }


    // MARK: A failed lookup must not become a second plan

    func testIntakeIsBlockedWhileWeDoNotKnowWhetherAPlanExists() {
        // `loadFailed` already refuses to send a learner who HAS a plan to
        // intake. This is the other half: on a first load we cannot tell, and
        // intake ends in `plans/generate`, which creates one unconditionally.
        // Leaving the composer live let a learner walk into a duplicate by
        // hand — the same bug the transition avoids, with one extra step.
        var state = TestPrepState()
        state.loadStarted()
        state.loadFailed()

        XCTAssertEqual(state.stage, .intake)
        XCTAssertFalse(state.canStartIntake, "a duplicate plan is one keystroke away")
    }

    func testARetryThatSucceedsUnblocksIntake() {
        var state = TestPrepState()
        state.loadStarted()
        state.loadFailed()

        state.loadStarted()
        XCTAssertTrue(state.canStartIntake)

        state.noPlan()
        XCTAssertTrue(state.canStartIntake, "a successful empty list is the green light")
    }

    func testALearnerWithNoPlanAndNoFailureCanStartStraightAway() {
        var state = TestPrepState()
        state.loadStarted()
        state.noPlan()
        state.loadSettled()

        XCTAssertTrue(state.canStartIntake)
        XCTAssertTrue(TestPrepState().canStartIntake)
    }

    // MARK: A stale readiness figure is not a current one

    func testAFailedReadinessCallKeepsTheFigureButStopsCallingItCurrent() {
        var state = loaded()
        state.detailsLoaded(readiness: nil, sessions: [])

        XCTAssertNotNil(state.readiness, "the last figure is kept rather than blanked")
        XCTAssertNotNil(state.readinessNote, "but it is no longer presented as up to date")
    }

    func testTheReadinessNoteIsWorstToOmitRightAfterFinishingASession() {
        // The evidence has just changed. Showing the figure from before the
        // work, silently, claims it accounted for that work.
        var state = loaded()
        state.finishSucceeded(sessionId: "s1", notice: "Scored 75%.")
        state.detailsLoaded(readiness: nil, sessions: [])

        XCTAssertNotNil(state.readinessNote)
        XCTAssertEqual(state.notice, "Scored 75%.", "and the result still stands")
    }

    func testASuccessfulReadinessCallClearsTheNote() {
        var state = loaded()
        state.detailsLoaded(readiness: nil, sessions: [])
        state.detailsLoaded(
            readiness: PlanReadiness(
                planId: "p1", subject: "Maths", testDate: "2026-09-25",
                daysRemaining: 14, readiness: 0.5, topicsTotal: 2,
                topicsAssessed: 2, topics: [], focusNext: []
            ),
            sessions: []
        )

        XCTAssertNil(state.readinessNote)
    }

    func testAReadinessFailureDoesNotClaimTheWholeScreenIsStale() {
        var state = loaded()
        state.detailsLoaded(readiness: nil, sessions: [])

        XCTAssertNil(state.staleWarning)
        XCTAssertNotNil(state.readinessNote)
        XCTAssertNil(loaded().readinessNote)
    }

    func testThreeDifferentFailuresNeverProduceTheSameSentence() {
        var state = loaded()
        state.detailsLoaded(readiness: nil, sessions: nil)
        state.loadFailed()

        let sentences = [state.staleWarning, state.sessionsNote, state.readinessNote]
        XCTAssertEqual(Set(sentences.compactMap { $0 }).count, 3, "\(sentences)")
    }
}
