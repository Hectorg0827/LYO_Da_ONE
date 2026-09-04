import Foundation

/// Derives the learner-facing transport controls for the active lesson
/// from the real lesson state, mirroring the web classroom's
/// `ClassroomFlowControls`:
///
/// - Previous only exists when a previous step really exists.
/// - Skip only exists while narration is actually playing.
/// - Next appears when a later step is already on screen and nothing is
///   waiting on the learner.
/// - Continue appears on the last step once narration has finished and
///   there is no unanswered checkpoint, even if the scene arrived without
///   an explicit call-to-action.
/// - Nothing is offered while the server is still preparing a scene.
///
/// Pure value logic so it can be unit-tested without SwiftUI.
struct ClassroomTransportState: Equatable {

    enum ForwardAction: Equatable {
        case none
        /// Cut the current narration short.
        case skip
        /// Move to the next step already on screen.
        case next
        /// Ask the backend for the next scene.
        case `continue`
        /// The server is generating; show a quiet status instead of a button.
        case waiting
    }

    let canGoPrevious: Bool
    let forward: ForwardAction
    /// "3/7" style position label; empty when there are no steps yet.
    let positionLabel: String

    init(
        currentIndex: Int,
        stepCount: Int,
        isNarrating: Bool,
        requiresInteraction: Bool,
        interactionCompleted: Bool,
        waitingForScene: Bool,
        hasQueuedSteps: Bool = false
    ) {
        canGoPrevious = stepCount > 0 && currentIndex > 0
        positionLabel = stepCount > 0
            ? "\(min(currentIndex, stepCount - 1) + 1)/\(stepCount)"
            : ""

        let checkpointPending = requiresInteraction && !interactionCompleted
        // Components the server already sent but the lesson has not revealed
        // yet are a real next step too — revealing them never hits the
        // backend, so they read as Next rather than Continue.
        let hasNextStep = stepCount > 0 && (currentIndex < stepCount - 1 || hasQueuedSteps)

        if stepCount == 0 {
            forward = .none
        } else if isNarrating {
            forward = .skip
        } else if checkpointPending {
            // The board is waiting on an answer; the answer is the way forward.
            forward = .none
        } else if hasNextStep {
            forward = .next
        } else if waitingForScene {
            forward = .waiting
        } else {
            forward = .continue
        }
    }

    /// Localised primary label for the forward button.
    static func continueLabel(languageCode: String?) -> String {
        (languageCode ?? "").lowercased().hasPrefix("es") ? "Continuar" : "Continue"
    }

    static func nextLabel(languageCode: String?) -> String {
        (languageCode ?? "").lowercased().hasPrefix("es") ? "Siguiente" : "Next"
    }

    static func previousLabel(languageCode: String?) -> String {
        (languageCode ?? "").lowercased().hasPrefix("es") ? "Anterior" : "Previous"
    }

    static func skipLabel(languageCode: String?) -> String {
        (languageCode ?? "").lowercased().hasPrefix("es") ? "Saltar" : "Skip"
    }

    static func waitingLabel(languageCode: String?) -> String {
        (languageCode ?? "").lowercased().hasPrefix("es") ? "Preparando…" : "Preparing…"
    }
}
