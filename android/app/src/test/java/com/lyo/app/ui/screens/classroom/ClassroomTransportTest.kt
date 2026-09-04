package com.lyo.app.ui.screens.classroom

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClassroomTransportTest {

    private fun live(
        connected: Boolean = true,
        waiting: Boolean = false,
        narrating: Boolean = false,
        checkpointPending: Boolean = false,
        hasLessonContent: Boolean = true,
        hasContinueCta: Boolean = false,
        historyCount: Int = 0,
        viewingIndex: Int = -1,
    ) = ClassroomTransport.derive(
        connected = connected,
        waiting = waiting,
        narrating = narrating,
        checkpointPending = checkpointPending,
        hasLessonContent = hasLessonContent,
        hasContinueCta = hasContinueCta,
        historyCount = historyCount,
        viewingIndex = viewingIndex,
    )

    @Test
    fun `skip only exists while narration is playing`() {
        assertEquals(ForwardAction.SKIP, live(narrating = true).forward)
        assertEquals(ForwardAction.SKIP, live(narrating = true, checkpointPending = true).forward)
        assertEquals(ForwardAction.CONTINUE, live(narrating = false).forward)
    }

    @Test
    fun `continue appears without a CTA once the scene has content`() {
        val transport = live(hasContinueCta = false, hasLessonContent = true)
        assertEquals(ForwardAction.CONTINUE, transport.forward)
        assertTrue(transport.readyToContinue)
    }

    @Test
    fun `nothing is offered while the server is still working or offline`() {
        assertEquals(ForwardAction.NONE, live(waiting = true).forward)
        assertEquals(ForwardAction.NONE, live(connected = false).forward)
        assertEquals(ForwardAction.NONE, live(hasLessonContent = false, hasContinueCta = false).forward)
    }

    @Test
    fun `a pending checkpoint is the only way forward`() {
        assertEquals(ForwardAction.NONE, live(checkpointPending = true, hasContinueCta = true).forward)
    }

    @Test
    fun `previous only exists when history exists`() {
        assertFalse(live(historyCount = 0).canGoPrevious)
        assertTrue(live(historyCount = 2).canGoPrevious)
        assertFalse(live(historyCount = 2, viewingIndex = 0).canGoPrevious)
        assertTrue(live(historyCount = 2, viewingIndex = 1).canGoPrevious)
    }

    @Test
    fun `browsing history moves through real snapshots then back to live`() {
        val middle = live(historyCount = 3, viewingIndex = 0, narrating = true)
        assertEquals(ForwardAction.NEXT, middle.forward)
        assertEquals("1/3", middle.positionLabel)

        val last = live(historyCount = 3, viewingIndex = 2)
        assertEquals(ForwardAction.LIVE, last.forward)
        assertEquals("3/3", last.positionLabel)

        assertEquals("live", live(historyCount = 3).positionLabel)
    }
}
