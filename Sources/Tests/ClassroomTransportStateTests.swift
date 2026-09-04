import XCTest
@testable import Lyo

final class ClassroomTransportStateTests: XCTestCase {
    private func state(
        currentIndex: Int = 0,
        stepCount: Int = 3,
        isNarrating: Bool = false,
        requiresInteraction: Bool = false,
        interactionCompleted: Bool = true,
        waitingForScene: Bool = false,
        hasQueuedSteps: Bool = false
    ) -> ClassroomTransportState {
        ClassroomTransportState(
            currentIndex: currentIndex,
            stepCount: stepCount,
            isNarrating: isNarrating,
            requiresInteraction: requiresInteraction,
            interactionCompleted: interactionCompleted,
            waitingForScene: waitingForScene,
            hasQueuedSteps: hasQueuedSteps
        )
    }

    func testSkipOnlyExistsWhileNarrationIsPlaying() {
        XCTAssertEqual(state(isNarrating: true).forward, .skip)
        XCTAssertEqual(state(isNarrating: true, requiresInteraction: true, interactionCompleted: false).forward, .skip)
        XCTAssertEqual(state(isNarrating: false).forward, .next)
    }

    func testNextMovesThroughStepsAlreadyOnScreen() {
        XCTAssertEqual(state(currentIndex: 0, stepCount: 3).forward, .next)
        XCTAssertEqual(state(currentIndex: 1, stepCount: 3).forward, .next)
        XCTAssertEqual(state(currentIndex: 2, stepCount: 3).forward, .continue)
    }

    func testQueuedComponentsReadAsNextNotContinue() {
        XCTAssertEqual(state(currentIndex: 2, stepCount: 3, hasQueuedSteps: true).forward, .next)
        XCTAssertEqual(state(currentIndex: 2, stepCount: 3, hasQueuedSteps: false).forward, .continue)
    }

    func testContinueWaitsForTheServerOnTheLastStep() {
        XCTAssertEqual(state(currentIndex: 2, stepCount: 3, waitingForScene: true).forward, .waiting)
        XCTAssertEqual(state(currentIndex: 2, stepCount: 3, waitingForScene: false).forward, .continue)
    }

    func testAPendingCheckpointIsTheOnlyWayForward() {
        XCTAssertEqual(state(currentIndex: 0, requiresInteraction: true, interactionCompleted: false).forward, .none)
        XCTAssertEqual(state(currentIndex: 2, requiresInteraction: true, interactionCompleted: false).forward, .none)
        XCTAssertEqual(state(currentIndex: 0, requiresInteraction: true, interactionCompleted: true).forward, .next)
    }

    func testPreviousOnlyExistsWhenAPreviousStepExists() {
        XCTAssertFalse(state(currentIndex: 0).canGoPrevious)
        XCTAssertTrue(state(currentIndex: 1).canGoPrevious)
        XCTAssertFalse(state(currentIndex: 0, stepCount: 0).canGoPrevious)
    }

    func testPositionLabelAndEmptyLesson() {
        XCTAssertEqual(state(currentIndex: 1, stepCount: 3).positionLabel, "2/3")
        XCTAssertEqual(state(currentIndex: 0, stepCount: 0).positionLabel, "")
        XCTAssertEqual(state(currentIndex: 0, stepCount: 0).forward, .none)
    }

    func testLabelsFollowTheSceneLanguage() {
        XCTAssertEqual(ClassroomTransportState.continueLabel(languageCode: "es-MX"), "Continuar")
        XCTAssertEqual(ClassroomTransportState.continueLabel(languageCode: "en"), "Continue")
        XCTAssertEqual(ClassroomTransportState.continueLabel(languageCode: nil), "Continue")
        XCTAssertEqual(ClassroomTransportState.skipLabel(languageCode: "ES"), "Saltar")
    }
}
