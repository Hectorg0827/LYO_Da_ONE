package com.lyo.app.ui.screens.classroom

import android.content.Context
import android.media.MediaPlayer
import android.net.Uri
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import com.google.gson.JsonParser
import com.lyo.app.BuildConfig
import com.lyo.app.data.api.ApiClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.Locale
import kotlin.math.abs

/**
 * Live position inside the teacher line being spoken right now, so the
 * caption can reveal words in step with the audio that is actually playing
 * instead of the moment the text arrived (the shared voice has to
 * round-trip the network first).
 */
internal data class VoiceProgress(
    val text: String,
    /** 0..1 share of the line's words that have actually been voiced. */
    val revealedFraction: Float,
    /** True once audio has really begun playing. */
    val started: Boolean,
    /** True once the line ended, failed, or was skipped by the learner. */
    val finished: Boolean,
)

/**
 * Plays the same backend-rendered teacher audio as Web and iOS.
 * Android TextToSpeech is a locale-aware emergency fallback only.
 */
internal class ClassroomVoicePlayer(context: Context) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var playbackJob: Job? = null
    private var progressJob: Job? = null
    private var activeCall: Call? = null
    private var player: MediaPlayer? = null
    private var audioFile: File? = null
    private var generation = 0
    private var enabled = true
    private var activeText: String? = null
    private var activeUtteranceId: String? = null
    private var deviceBoundarySeen = false
    private val deviceTts = TextToSpeech(appContext) { }

    /** Called on the main thread whenever the spoken line's progress changes. */
    var onProgress: ((VoiceProgress?) -> Unit)? = null

    init {
        deviceTts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                scope.launch { deviceSpeechStarted(utteranceId) }
            }

            override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
                scope.launch { deviceSpeechReached(utteranceId, end) }
            }

            override fun onDone(utteranceId: String?) {
                scope.launch { deviceSpeechEnded(utteranceId) }
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                scope.launch { deviceSpeechEnded(utteranceId) }
            }

            override fun onError(utteranceId: String?, errorCode: Int) {
                scope.launch { deviceSpeechEnded(utteranceId) }
            }
        })
    }

    fun setEnabled(value: Boolean) {
        enabled = value
        if (!value) stop()
    }

    fun play(text: String, language: String) {
        stop()
        if (!enabled || text.isBlank()) return
        val requestedGeneration = generation
        activeText = text
        // Nothing is "spoken" until audio really starts: the caption stays
        // dimmed while the shared voice is generated.
        emit(VoiceProgress(text, 0f, started = false, finished = false))
        playbackJob = scope.launch {
            try {
                val file = fetchSharedVoice(text, language)
                if (requestedGeneration != generation || !enabled) {
                    file.delete()
                    return@launch
                }
                playFile(file, requestedGeneration)
                trackMediaClock(text, requestedGeneration)
            } catch (_: CancellationException) {
                // A learner action or new scene owns the floor now.
            } catch (_: Exception) {
                if (requestedGeneration == generation && enabled) {
                    playLocalizedDeviceFallback(text, language, requestedGeneration)
                } else {
                    finishLine(requestedGeneration)
                }
            }
        }
    }

    fun stop() {
        generation += 1
        activeCall?.cancel()
        activeCall = null
        playbackJob?.cancel()
        playbackJob = null
        progressJob?.cancel()
        progressJob = null
        player?.setOnCompletionListener(null)
        player?.setOnErrorListener(null)
        player?.stopSafely()
        player?.release()
        player = null
        audioFile?.delete()
        audioFile = null
        deviceTts.stop()
        activeUtteranceId = null
        // A skipped line reads as fully spoken: the caption fills in rather
        // than freezing mid-sentence.
        clearActiveLine()
    }

    fun close() {
        stop()
        deviceTts.shutdown()
        scope.cancel()
    }

    private suspend fun fetchSharedVoice(text: String, language: String): File =
        withContext(Dispatchers.IO) {
            val body = ApiClient.gson.toJson(
                mapOf(
                    "text" to text,
                    "voice" to "nova",
                    "format" to "mp3",
                    "speed" to SPEECH_RATE,
                    "content_type" to "explanation",
                    "language" to language,
                ),
            ).toRequestBody("application/json".toMediaType())
            val request = Request.Builder()
                .url(BuildConfig.API_BASE_URL.trimEnd('/') + "/api/v1/tts/synthesize")
                .post(body)
                .build()
            val call = ApiClient.okHttp.newCall(request)
            activeCall = call
            call.execute().use { response ->
                if (!response.isSuccessful) {
                    error("Shared voice returned ${response.code}")
                }
                val root = JsonParser.parseString(response.body?.string().orEmpty()).asJsonObject
                val encoded = root.get("audio_base64")?.asString
                    ?: error("Shared voice returned no audio")
                val bytes = Base64.decode(encoded, Base64.DEFAULT)
                File.createTempFile("lyo_classroom_", ".mp3", appContext.cacheDir)
                    .apply { writeBytes(bytes) }
            }.also {
                activeCall = null
            }
        }

    private fun playFile(file: File, requestedGeneration: Int) {
        audioFile = file
        val nextPlayer = MediaPlayer().apply {
            setDataSource(appContext, Uri.fromFile(file))
            setOnCompletionListener {
                if (requestedGeneration == generation) {
                    releaseCurrentPlayer()
                    finishLine(requestedGeneration)
                }
            }
            setOnErrorListener { _, _, _ ->
                releaseCurrentPlayer()
                finishLine(requestedGeneration)
                true
            }
            prepare()
            start()
        }
        player = nextPlayer
    }

    /**
     * Follow the media clock of the generated MP3 so network latency can
     * never let the caption run ahead of the voice. Word boundaries are
     * derived from the real duration once the player reports it.
     */
    private fun trackMediaClock(text: String, requestedGeneration: Int) {
        progressJob?.cancel()
        progressJob = scope.launch {
            var starts = emptyList<Float>()
            var lastDuration = -1f
            val totalWords = SpokenCaptionTiming.words(text).size
            while (isActive && requestedGeneration == generation) {
                val current = player ?: break
                val reportedMs = runCatching { current.duration }.getOrDefault(-1)
                val duration = if (reportedMs > 0) {
                    reportedMs / 1000f
                } else {
                    SpokenCaptionTiming.estimatedSpeechSeconds(text, SPEECH_RATE.toFloat())
                }
                if (abs(duration - lastDuration) > 0.02f) {
                    starts = SpokenCaptionTiming.wordStartTimes(text, duration)
                    lastDuration = duration
                }
                val positionSeconds = runCatching { current.currentPosition }.getOrDefault(0) / 1000f
                val playing = runCatching { current.isPlaying }.getOrDefault(false)
                val started = playing || positionSeconds > 0f
                val revealed = if (started) SpokenCaptionTiming.revealCount(starts, positionSeconds) else 0
                val fraction = if (totalWords > 0) revealed.toFloat() / totalWords else 1f
                emit(VoiceProgress(text, fraction, started = started, finished = false))
                delay(CLOCK_TICK_MS)
            }
        }
    }

    private fun releaseCurrentPlayer() {
        progressJob?.cancel()
        progressJob = null
        player?.release()
        player = null
        audioFile?.delete()
        audioFile = null
    }

    private fun playLocalizedDeviceFallback(text: String, language: String, requestedGeneration: Int) {
        val tag = if (language.equals("auto", ignoreCase = true)) {
            when {
                Regex("[¿¡ñáéíóúü]", RegexOption.IGNORE_CASE).containsMatchIn(text) -> "es-US"
                else -> Locale.getDefault().toLanguageTag()
            }
        } else {
            language
        }
        deviceTts.language = Locale.forLanguageTag(tag)
        deviceTts.setSpeechRate(SPEECH_RATE.toFloat())
        val utteranceId = "lyo-classroom-$requestedGeneration"
        activeUtteranceId = utteranceId
        deviceBoundarySeen = false
        val queued = deviceTts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
        if (queued != TextToSpeech.SUCCESS) finishLine(requestedGeneration)
    }

    // ── device voice progress (callbacks arrive on the engine's thread) ──

    private fun deviceSpeechStarted(utteranceId: String?) {
        if (utteranceId == null || utteranceId != activeUtteranceId) return
        val text = activeText ?: return
        val requestedGeneration = generation
        emit(VoiceProgress(text, 0f, started = true, finished = false))
        // Engines that never report word boundaries (some Samsung builds)
        // get a paced reveal that starts on the utterance's real start.
        progressJob?.cancel()
        progressJob = scope.launch {
            delay(BOUNDARY_GRACE_MS)
            if (deviceBoundarySeen || requestedGeneration != generation) return@launch
            val duration = SpokenCaptionTiming.estimatedSpeechSeconds(text, SPEECH_RATE.toFloat())
            val starts = SpokenCaptionTiming.wordStartTimes(text, duration)
            val totalWords = starts.size
            val startedAt = System.nanoTime()
            while (isActive && requestedGeneration == generation && !deviceBoundarySeen) {
                val elapsed = (System.nanoTime() - startedAt) / 1_000_000_000f
                val revealed = SpokenCaptionTiming.revealCount(starts, elapsed)
                val fraction = if (totalWords > 0) revealed.toFloat() / totalWords else 1f
                emit(VoiceProgress(text, fraction, started = true, finished = false))
                if (elapsed >= duration) break
                delay(CLOCK_TICK_MS)
            }
        }
    }

    private fun deviceSpeechReached(utteranceId: String?, endCharacter: Int) {
        if (utteranceId == null || utteranceId != activeUtteranceId) return
        val text = activeText ?: return
        deviceBoundarySeen = true
        progressJob?.cancel()
        progressJob = null
        val totalWords = SpokenCaptionTiming.words(text).size
        val revealed = SpokenCaptionTiming.wordCountUpTo(endCharacter - 1, text)
        val fraction = if (totalWords > 0) revealed.toFloat() / totalWords else 1f
        emit(VoiceProgress(text, fraction, started = true, finished = false))
    }

    private fun deviceSpeechEnded(utteranceId: String?) {
        if (utteranceId == null || utteranceId != activeUtteranceId) return
        activeUtteranceId = null
        finishLine(generation)
    }

    // ── progress plumbing ──

    /** Marks the line finished, ignoring callbacks from a superseded playback. */
    private fun finishLine(requestedGeneration: Int) {
        if (requestedGeneration != generation) return
        clearActiveLine()
    }

    private fun clearActiveLine() {
        val text = activeText ?: return
        activeText = null
        progressJob?.cancel()
        progressJob = null
        emit(VoiceProgress(text, 1f, started = true, finished = true))
    }

    private fun emit(progress: VoiceProgress?) {
        onProgress?.invoke(progress)
    }

    private companion object {
        const val SPEECH_RATE = 0.98
        const val CLOCK_TICK_MS = 50L
        const val BOUNDARY_GRACE_MS = 220L
    }
}

private fun MediaPlayer.stopSafely() {
    runCatching { stop() }
}
