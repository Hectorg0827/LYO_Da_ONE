package com.lyo.app.ui.screens.classroom

/**
 * The learner-facing transport controls, derived from the real classroom
 * state the way the web classroom's `ClassroomFlowControls` does it:
 *
 * - Previous only exists when an earlier board really exists.
 * - Skip only exists while narration is actually playing.
 * - Continue appears once narration has finished and nothing is waiting on
 *   the learner — even when the scene arrived without a CTAButton, which
 *   used to leave the screen with no way forward.
 * - While browsing history, Next / Live move through real board snapshots.
 *
 * Pure so it can be unit-tested without Compose.
 */
internal enum class ForwardAction { NONE, SKIP, NEXT, LIVE, CONTINUE }

internal data class ClassroomTransport(
    val canGoPrevious: Boolean,
    val forward: ForwardAction,
    /** "live" on the current board, otherwise "n/N" through history. */
    val positionLabel: String,
) {
    val readyToContinue: Boolean get() = forward == ForwardAction.CONTINUE

    companion object {
        fun derive(
            connected: Boolean,
            waiting: Boolean,
            narrating: Boolean,
            checkpointPending: Boolean,
            hasLessonContent: Boolean,
            hasContinueCta: Boolean,
            historyCount: Int,
            viewingIndex: Int,
        ): ClassroomTransport {
            val atLive = viewingIndex < 0 || historyCount == 0
            val canGoPrevious = if (atLive) historyCount > 0 else viewingIndex > 0
            val positionLabel = if (atLive) "live" else "${viewingIndex + 1}/$historyCount"

            val forward = when {
                !atLive -> if (viewingIndex >= historyCount - 1) ForwardAction.LIVE else ForwardAction.NEXT
                narrating -> ForwardAction.SKIP
                !connected || waiting || checkpointPending -> ForwardAction.NONE
                hasContinueCta || hasLessonContent -> ForwardAction.CONTINUE
                else -> ForwardAction.NONE
            }
            return ClassroomTransport(canGoPrevious, forward, positionLabel)
        }
    }
}
