import Foundation
import SwiftUI

// MARK: - Test Prep state
//
// The screen's transitions, kept in a plain struct that tests can drive.
//
// This shape is borrowed from `web/src/lib/test-prep-state.mjs`, and the
// borrowing is the point. That file exists because the same screen on web
// collected six rounds of review findings, four of them defects in the fix for
// the round before — every one a different combination of eighteen pieces of
// view state. Moving the decisions out of the view ended the streak. Writing
// this screen with `@State` scattered through a SwiftUI body would be
// volunteering for the same six rounds on a platform where nobody here can
// click through the result.
//
// The three rules those rounds produced, all of them learned the hard way:
//
//   - A failed request is never a fact about the learner. Not "no sessions
//     today", not "you have no plan".
//   - A refresh never destroys what is on screen.
//   - Finishing a session updates the list locally, so the row stops looking
//     open even if the refresh that would have removed it never lands.

struct TestPrepState: Equatable {
    enum Stage: Equatable { case intake, plan }

    var stage: Stage = .intake
    var loading = true
    var loadedOnce = false
    var planId: String?
    var readiness: PlanReadiness?
    var sessions: [PlannedSession] = []

    /// The sessions call failed; what is listed may be stale or incomplete.
    var sessionsFailed = false
    /// A refresh failed while we already have a plan. Said on the plan view.
    var refreshFailed = false
    /// The plan list failed and we have never seen a plan. Said on intake.
    var planLoadFailed = false

    /// What the server measured for the session just finished.
    var notice: String?
    /// Id of the session currently being closed out, if any.
    var finishing: String?

    // MARK: Transitions

    mutating func loadStarted() {
        // Only the first load blanks the page. A refresh that unmounts the
        // plan view takes whatever the learner was reading with it.
        loading = !loadedOnce
        refreshFailed = false
        planLoadFailed = false
    }

    mutating func planLoaded(id: String) {
        stage = .plan
        planId = id
    }

    /// Reached only from a *successful* call that returned no plans. A failure
    /// takes `loadFailed`, which concludes nothing about whether a plan exists.
    mutating func noPlan() {
        stage = .intake
        planId = nil
    }

    /// `nil` for either argument means that call failed — which is different
    /// from a call that succeeded and returned nothing.
    mutating func detailsLoaded(readiness: PlanReadiness?, sessions: [PlannedSession]?) {
        if let readiness { self.readiness = readiness }
        if let sessions {
            self.sessions = sessions
            sessionsFailed = false
        } else {
            // Keep whatever was legitimately shown a moment ago and say the
            // call failed, rather than rendering an empty day.
            sessionsFailed = true
        }
    }

    mutating func loadFailed() {
        // A failed request is not evidence the plan is gone. Sending a learner
        // who has a plan back to intake would have them answer the questions
        // again and come out with a second plan, because one request failed.
        if planId != nil {
            refreshFailed = true
        } else {
            stage = .intake
            planLoadFailed = true
        }
    }

    mutating func loadSettled() {
        loading = false
        loadedOnce = true
    }

    mutating func finishStarted(sessionId: String) {
        finishing = sessionId
        // Otherwise the score from the last session sits above a different one.
        notice = nil
    }

    mutating func finishSucceeded(sessionId: String, notice: String) {
        finishing = nil
        self.notice = notice
        // Dropped locally rather than waiting for the refresh to drop it. If
        // that refresh fails the row would otherwise sit there looking open
        // while the server considers it closed — and a second tap would
        // replace the result the learner is still reading.
        sessions.removeAll { $0.id == sessionId }
    }

    mutating func finishFailed(notice: String) {
        finishing = nil
        self.notice = notice
    }

    // MARK: Derived copy

    /// A page-level note that what is shown may be out of date.
    ///
    /// Deliberately only about the whole-screen refresh. Reporting a failed
    /// sessions call here too put the same sentence on screen twice on an
    /// empty day, and let a refresh failure overwrite "Nothing scheduled for
    /// today" even when the sessions list was known-good and genuinely empty.
    var staleWarning: String? {
        refreshFailed ? "I could not refresh this just now, so it may be out of date." : nil
    }

    /// Said in the Today section when the sessions call itself failed — a fact
    /// about the request, not about the learner's day.
    var sessionsNote: String? {
        sessionsFailed ? "I could not load today’s sessions just now." : nil
    }

    /// What the Today section says, for every combination of list and failure.
    ///
    /// A decision rather than a render, because the render kept getting it
    /// wrong one branch at a time: first "Nothing scheduled for today" on a
    /// failed load, then the same sentence twice on an empty day, then — once
    /// that was split — the failure reported only when the list was empty, so
    /// a refresh that failed while keeping rows said nothing at all.
    ///
    /// | list     | sessions call | note        | emptyMessage |
    /// | -------- | ------------- | ----------- | ------------ |
    /// | has rows | fine          | nil         | nil          |
    /// | has rows | failed        | the failure | nil          |
    /// | empty    | fine          | nil         | "Nothing…"   |
    /// | empty    | failed        | the failure | nil          |
    ///
    /// The last row is the one that matters: an empty list after a failed call
    /// is not a fact about the learner's day and must not be reported as one.
    func todayCopy(openCount: Int) -> (note: String?, emptyMessage: String?) {
        let note = sessionsNote
        let empty = (openCount == 0 && note == nil) ? "Nothing scheduled for today." : nil
        return (note, empty)
    }
}

/// One line of the intake conversation.
///
/// At file scope rather than nested inside the view model: the view model is
/// `@MainActor`, and a nested type's synthesised `==` inherits that isolation
/// while `Equatable` requires it not to. Harmless in Swift 5 mode, an error
/// under strict concurrency, and there is no reason for this type to be
/// isolated at all.
struct IntakeLine: Identifiable, Equatable {
    enum Speaker: Equatable { case learner, coach }
    let id = UUID()
    let speaker: Speaker
    let text: String
}

// MARK: - Test Prep view model

@MainActor
final class TestPrepViewModel: ObservableObject {
    @Published private(set) var state = TestPrepState()

    /// The intake conversation so far, oldest first.
    @Published private(set) var transcript: [IntakeLine] = []
    @Published private(set) var intakeBusy = false
    @Published private(set) var intakeError: String?

    private let service: TestPrepPlanService
    private var testProfileId: String?

    init(service: TestPrepPlanService = .shared) {
        self.service = service
    }

    // MARK: Loading

    func load() async {
        state.loadStarted()
        defer { state.loadSettled() }

        let plans: [StudyPlanSummary]
        do {
            plans = try await service.plans()
        } catch {
            state.loadFailed()
            return
        }

        guard let plan = TestPrepPresentation.currentPlan(plans) else {
            state.noPlan()
            return
        }
        state.planLoaded(id: plan.id)
        await loadDetails(planId: plan.id)
    }

    private func loadDetails(planId: String) async {
        // Requested independently so one failure does not hide the other's
        // answer: a working readiness card beside an honest "I could not load
        // today's sessions" is better than an error screen over both.
        async let readinessTask = service.readiness(planId: planId)
        async let sessionsTask = service.todaySessions()
        let readiness = try? await readinessTask
        let sessions = try? await sessionsTask
        state.detailsLoaded(readiness: readiness, sessions: sessions)
    }

    // MARK: Intake

    func sendIntake(_ message: String) async {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !intakeBusy else { return }

        intakeBusy = true
        intakeError = nil
        transcript.append(IntakeLine(speaker: .learner, text: trimmed))
        defer { intakeBusy = false }

        let reply: IntakeTurnReply
        do {
            reply = try await service.intakeTurn(message: trimmed, testProfileId: testProfileId)
        } catch {
            intakeError = "I could not send that just now. Try again in a moment."
            return
        }

        testProfileId = reply.testProfileId
        transcript.append(IntakeLine(speaker: .coach, text: reply.messageToUser))

        // The server decides when it has enough, not a client counting turns.
        guard TestPrepPresentation.intakeIsComplete(reply) else { return }

        do {
            let plan = try await service.generatePlan(testProfileId: reply.testProfileId)
            state.planLoaded(id: plan.planId)
            await loadDetails(planId: plan.planId)
        } catch {
            intakeError = "I have everything I need, but could not build the plan just now."
        }
    }

    // MARK: Finishing a session

    func finish(session: PlannedSession) async {
        guard state.finishing == nil else { return }
        state.finishStarted(sessionId: session.id)

        do {
            let outcome = try await service.completeSession(sessionId: session.id)
            state.finishSucceeded(
                sessionId: session.id,
                notice: TestPrepPresentation.completionSummary(outcome)
            )
        } catch {
            state.finishFailed(notice: "I could not mark that done just now.")
            return
        }

        // Refresh so readiness reflects the session that just closed. A
        // failure here is reported, never allowed to undo what is on screen.
        if let planId = state.planId {
            await loadDetails(planId: planId)
        }
    }
}
