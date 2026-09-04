package com.lyo.app.ui.screens.classroom

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Word-level timing for a spoken caption.
 *
 * Mirrors the web classroom's `ClassroomCaptionSync` maths (and the iOS
 * `SpokenCaptionTiming`) so every client reveals a caption at the same pace
 * against the same audio: longer words take longer, punctuation adds a
 * natural pause, and the reveal follows the *real* playback clock rather
 * than the moment the text arrived from the server.
 */
internal object SpokenCaptionTiming {

    private val whitespace = Regex("\\s+")

    /** Whitespace-separated tokens, empty tokens removed. */
    fun words(text: String): List<String> =
        text.trim().split(whitespace).filter { it.isNotEmpty() }

    /**
     * Relative time a single word takes to say: 0.8..2.4 by spoken length,
     * plus pauses for trailing punctuation.
     */
    fun wordWeight(word: String): Float {
        val spokenLength = word.count { it.isLetterOrDigit() }
        var weight = max(0.8f, min(2.4f, spokenLength / 4.5f))
        val last = word.lastOrNull()
        if (last != null) {
            if (last in ",;:") weight += 0.65f
            if (last in ".!?") weight += 1.05f
        }
        return weight
    }

    /** Start offset (seconds) of every word when [text] spans [durationSeconds]. */
    fun wordStartTimes(text: String, durationSeconds: Float): List<Float> {
        val tokens = words(text)
        if (tokens.isEmpty()) return emptyList()
        val weights = tokens.map(::wordWeight)
        val totalWeight = max(weights.sum(), 1f)
        var elapsedWeight = 0f
        return weights.map { weight ->
            val start = (elapsedWeight / totalWeight) * durationSeconds
            elapsedWeight += weight
            start
        }
    }

    /** Words that have started by [currentTime], with the web ticker's 25 ms lookahead. */
    fun revealCount(starts: List<Float>, currentTime: Float): Int {
        var count = 0
        while (count < starts.size && currentTime + 0.025f >= starts[count]) count += 1
        return count
    }

    /** Estimated audio length when the player has not reported one: ~205 wpm at 1x. */
    fun estimatedSpeechSeconds(text: String, rate: Float): Float {
        val weighted = words(text).fold(0f) { sum, word -> sum + wordWeight(word) }
        return max(0.8f, (weighted * 60f) / (205f * max(rate, 0.5f)))
    }

    /** Words fully or partly spoken once the engine reached [characterIndex]. */
    fun wordCountUpTo(characterIndex: Int, text: String): Int {
        if (text.isBlank()) return 0
        val clamped = max(0, min(characterIndex + 1, text.length))
        return max(1, words(text.substring(0, clamped)).size)
    }

    /**
     * Maps a 0..1 spoken fraction onto a different rendering of the same
     * line (the spoken text is markdown-stripped, so word counts can differ).
     */
    fun revealedWordCount(fraction: Float, totalWords: Int): Int {
        if (totalWords <= 0) return 0
        val clamped = max(0f, min(1f, fraction))
        return (clamped * totalWords).roundToInt()
    }
}
