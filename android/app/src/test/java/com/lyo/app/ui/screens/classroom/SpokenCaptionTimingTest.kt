package com.lyo.app.ui.screens.classroom

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SpokenCaptionTimingTest {

    @Test
    fun `words drops empty tokens`() {
        assertEquals(listOf("Hola,", "clase."), SpokenCaptionTiming.words("  Hola,   clase. \n"))
        assertEquals(emptyList<String>(), SpokenCaptionTiming.words("   "))
    }

    @Test
    fun `punctuation and length make a word take longer`() {
        assertTrue(SpokenCaptionTiming.wordWeight("photosynthesis") > SpokenCaptionTiming.wordWeight("a"))
        assertTrue(SpokenCaptionTiming.wordWeight("end.") > SpokenCaptionTiming.wordWeight("end"))
        assertTrue(SpokenCaptionTiming.wordWeight("end,") > SpokenCaptionTiming.wordWeight("end"))
        assertEquals(0.8f, SpokenCaptionTiming.wordWeight("a"), 0.0001f)
        assertEquals(2.4f, SpokenCaptionTiming.wordWeight("aaaaaaaaaaaaaaaaaaaaaaaa"), 0.0001f)
    }

    @Test
    fun `word start times begin at zero and stay inside the duration`() {
        val starts = SpokenCaptionTiming.wordStartTimes("One two three, four.", 4f)
        assertEquals(4, starts.size)
        assertEquals(0f, starts.first(), 0.0001f)
        for (i in 1 until starts.size) assertTrue(starts[i] > starts[i - 1])
        assertTrue(starts.last() < 4f)
        assertEquals(emptyList<Float>(), SpokenCaptionTiming.wordStartTimes("", 4f))
    }

    @Test
    fun `reveal count follows the playback clock`() {
        val starts = listOf(0f, 1f, 2f, 3f)
        assertEquals(1, SpokenCaptionTiming.revealCount(starts, 0f))
        assertEquals(2, SpokenCaptionTiming.revealCount(starts, 0.99f))
        assertEquals(4, SpokenCaptionTiming.revealCount(starts, 10f))
        assertEquals(0, SpokenCaptionTiming.revealCount(emptyList(), 5f))
    }

    @Test
    fun `estimated duration scales with rate and never collapses`() {
        val slow = SpokenCaptionTiming.estimatedSpeechSeconds("A fairly ordinary teaching sentence.", 0.8f)
        val fast = SpokenCaptionTiming.estimatedSpeechSeconds("A fairly ordinary teaching sentence.", 1.4f)
        assertTrue(slow > fast)
        assertEquals(0.8f, SpokenCaptionTiming.estimatedSpeechSeconds("", 1f), 0.0001f)
    }

    @Test
    fun `character boundaries map onto words`() {
        val text = "Hello brave new world"
        assertEquals(1, SpokenCaptionTiming.wordCountUpTo(0, text))
        assertEquals(2, SpokenCaptionTiming.wordCountUpTo(6, text))
        assertEquals(4, SpokenCaptionTiming.wordCountUpTo(999, text))
        assertEquals(0, SpokenCaptionTiming.wordCountUpTo(3, "   "))
    }

    @Test
    fun `fractions map onto the displayed word count`() {
        assertEquals(0, SpokenCaptionTiming.revealedWordCount(0f, 10))
        assertEquals(5, SpokenCaptionTiming.revealedWordCount(0.5f, 10))
        assertEquals(10, SpokenCaptionTiming.revealedWordCount(1.5f, 10))
        assertEquals(0, SpokenCaptionTiming.revealedWordCount(0.7f, 0))
    }
}
