package com.lyo.app.ui.screens.classroom

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.lyo.app.BuildConfig
import com.lyo.app.data.StackRepository
import com.lyo.app.data.TokenManager
import com.lyo.app.data.api.ApiClient
import com.lyo.app.ui.components.GlassCard
import com.lyo.app.ui.theme.Background
import com.lyo.app.ui.theme.LyoPurple
import com.lyo.app.ui.theme.Surface
import com.lyo.app.ui.theme.TextPrimary
import com.lyo.app.ui.theme.TextSecondary
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.time.Instant
import java.util.Locale

internal data class ClassroomOption(
    val id: String,
    val label: String,
)

internal data class ClassroomCheckpoint(
    val componentId: String,
    val question: String,
    val options: List<ClassroomOption>,
)

internal data class ClassroomApplication(
    val componentId: String,
    val question: String,
    val placeholder: String,
    val minWords: Int,
    val actionIntent: String,
)

/** A finished teaching beat the learner can step back to. */
internal data class ClassroomBoardSnapshot(
    val teacherText: String,
    val boardTitle: String,
    val boardContent: String,
    val peerText: String?,
)

internal data class AndroidClassroomState(
    val connected: Boolean = false,
    val waiting: Boolean = true,
    val teacherText: String = "",
    val boardTitle: String = "",
    val boardContent: String = "",
    val peerText: String? = null,
    val languageCode: String = "auto",
    val checkpoint: ClassroomCheckpoint? = null,
    val application: ClassroomApplication? = null,
    val continueLabel: String? = null,
    val continueIntent: String = "continue",
    val progressCurrent: Int = 0,
    val progressTotal: Int = 1,
    val voiceEnabled: Boolean = true,
    val error: String? = null,
    /** True from the moment the teacher line is sent to the voice until it ends or is skipped. */
    val narrating: Boolean = false,
    /** 0..1 share of [teacherText] the voice has reached; null shows the whole line. */
    val captionFraction: Float? = null,
    /** Earlier boards from this session, oldest first. */
    val history: List<ClassroomBoardSnapshot> = emptyList(),
    /** Index into [history] while browsing back; -1 means the live board. */
    val viewingIndex: Int = -1,
) {
    val transport: ClassroomTransport
        get() = ClassroomTransport.derive(
            connected = connected,
            waiting = waiting,
            narrating = narrating,
            checkpointPending = checkpoint != null || application != null,
            hasLessonContent = teacherText.isNotBlank() || boardContent.isNotBlank(),
            hasContinueCta = continueLabel != null,
            historyCount = history.size,
            viewingIndex = viewingIndex,
        )

    /** The board on screen: a history snapshot while browsing back, else the live one. */
    val shownBoard: ClassroomBoardSnapshot
        get() = history.getOrNull(viewingIndex)
            ?: ClassroomBoardSnapshot(teacherText, boardTitle, boardContent, peerText)

    val viewingHistory: Boolean get() = history.getOrNull(viewingIndex) != null
}

internal class AndroidClassroomController(
    context: Context,
    private val courseId: String,
) {
    var state by mutableStateOf(AndroidClassroomState())
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val voice = ClassroomVoicePlayer(context).also { player ->
        player.onProgress = ::handleVoiceProgress
    }
    private var socket: WebSocket? = null
    private var seenComponents = mutableSetOf<String>()

    /**
     * The caption follows the voice: while a line is being generated or
     * spoken, only the words the audio has reached read as spoken. Once it
     * ends (or the learner skips it) the whole line shows.
     */
    private fun handleVoiceProgress(progress: VoiceProgress?) {
        val live = progress != null && !progress.finished && progress.text == state.teacherText
        state = state.copy(
            narrating = live,
            captionFraction = if (live) progress?.revealedFraction else null,
        )
    }

    /** Cuts the current narration short; the caption fills in immediately. */
    fun skipNarration() {
        voice.stop()
    }

    /** Step back through earlier boards. */
    fun viewPrevious() {
        val transport = state.transport
        if (!transport.canGoPrevious) return
        val target = if (state.viewingIndex < 0) state.history.size - 1 else state.viewingIndex - 1
        state = state.copy(viewingIndex = target)
    }

    /** The single forward control: Skip, Next, Live, or Continue depending on real state. */
    fun viewForward() {
        when (state.transport.forward) {
            ForwardAction.SKIP -> skipNarration()
            ForwardAction.NEXT -> state = state.copy(viewingIndex = state.viewingIndex + 1)
            ForwardAction.LIVE -> state = state.copy(viewingIndex = -1)
            ForwardAction.CONTINUE -> continueLesson()
            ForwardAction.NONE -> Unit
        }
    }

    fun connect(topic: String) {
        val token = TokenManager.accessToken
        if (token.isNullOrBlank()) {
            state = state.copy(waiting = false, error = "Sign in to start the AI classroom.")
            return
        }
        socket?.cancel()
        val endpoint = (
            BuildConfig.API_BASE_URL.trimEnd('/') +
                "/api/v1/classroom/ws/connect"
            ).toHttpUrl()
            .newBuilder()
            .addQueryParameter("session_id", courseId)
            .addQueryParameter("course_id", courseId)
            .addQueryParameter("client_contract_version", "2")
            .addQueryParameter("topic", topic)
            .addQueryParameter("token", token)
            .addQueryParameter("mode", "solo")
            .addQueryParameter("duration_minutes", "10")
            .addQueryParameter("language", "auto")
            .build()
        val request = Request.Builder()
            .url(endpoint)
            .header("Authorization", "Bearer $token")
            .build()
        state = state.copy(waiting = true, error = null)
        socket = ApiClient.okHttp.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    scope.launch { state = state.copy(connected = true, error = null) }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    scope.launch { consumeMessage(text) }
                }

                override fun onFailure(
                    webSocket: WebSocket,
                    t: Throwable,
                    response: Response?,
                ) {
                    scope.launch {
                        state = state.copy(
                            connected = false,
                            waiting = false,
                            error = "The live classroom connection was interrupted.",
                        )
                    }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    scope.launch { state = state.copy(connected = false) }
                }
            },
        )
    }

    fun setVoiceEnabled(enabled: Boolean) {
        voice.setEnabled(enabled)
        state = state.copy(voiceEnabled = enabled)
    }

    fun beginLearnerInput() {
        voice.stop()
    }

    fun answer(option: ClassroomOption) {
        val checkpoint = state.checkpoint ?: return
        beginLearnerInput()
        if (sendAction(
            intent = "submit_answer",
            componentId = checkpoint.componentId,
            answerData = mapOf(
                "selected_option_id" to option.id,
                "selected_option_label" to option.label,
            ),
        )) awaitServerScene()
    }

    fun submitApplication(response: String) {
        val application = state.application ?: return
        beginLearnerInput()
        if (sendAction(
            intent = application.actionIntent,
            componentId = application.componentId,
            answerData = mapOf("response" to response.trim()),
        )) awaitServerScene()
    }

    fun continueLesson() {
        // Continue is a real classroom action even when the scene came
        // without a CTAButton — the backend treats `continue` as canonical.
        if (!state.transport.readyToContinue) return
        val intent = state.continueIntent
        beginLearnerInput()
        if (sendAction(intent, "android_continue")) awaitServerScene()
    }

    fun askQuestion(question: String): Boolean {
        if (question.isBlank()) return false
        beginLearnerInput()
        val sent = sendAction(
            intent = "ask_question",
            componentId = "android_ask",
            answerData = mapOf("message" to question.trim()),
        )
        if (sent) awaitServerScene()
        return sent
    }

    fun requestHint() {
        val componentId = state.checkpoint?.componentId
            ?: state.application?.componentId
            ?: return
        beginLearnerInput()
        if (sendAction(
            intent = "request_hint",
            componentId = componentId,
            answerData = mapOf("hint_level" to "nudge"),
        )) awaitServerScene()
    }

    fun skipQuestion() {
        val componentId = state.checkpoint?.componentId
            ?: state.application?.componentId
            ?: return
        beginLearnerInput()
        if (sendAction(
            intent = "skip_question",
            componentId = componentId,
            answerData = mapOf("reason" to "unsure"),
        )) awaitServerScene()
    }

    fun close() {
        voice.close()
        socket?.close(1000, "Leaving classroom")
        socket = null
        scope.cancel()
    }

    private fun awaitServerScene() {
        state = state.copy(
            waiting = true,
            checkpoint = null,
            application = null,
            continueLabel = null,
            peerText = null,
        )
    }

    private fun sendAction(
        intent: String,
        componentId: String,
        answerData: Map<String, String>? = null,
    ): Boolean {
        val activeSocket = socket
        if (activeSocket == null || !state.connected) {
            state = state.copy(
                waiting = false,
                error = "The classroom is offline. Reconnect before sending your answer.",
            )
            return false
        }
        val payload = linkedMapOf<String, Any>(
            "event_type" to "user_action",
            "session_id" to courseId,
            "action_intent" to intent,
            "component_id" to componentId,
            "timestamp" to Instant.now().toString(),
        )
        answerData?.let { payload["answer_data"] = it }
        val sent = activeSocket.send(ApiClient.gson.toJson(payload))
        if (!sent) {
            state = state.copy(
                waiting = false,
                error = "Your response was not sent. Please try again.",
            )
        }
        return sent
    }

    private fun consumeMessage(raw: String) {
        val root = runCatching { JsonParser.parseString(raw).asJsonObject }.getOrNull() ?: return
        val data = root.objectOrNull("data")
        val event = (
            root.stringOrNull("event_type")
                ?: data?.stringOrNull("event_type")
                ?: root.stringOrNull("type")
                ?: ""
            ).lowercase()
        val scene = root.objectOrNull("scene") ?: data?.objectOrNull("scene")

        if (event == "scene_start" || (event == "scene_stream" && scene != null)) {
            beginScene()
            scene?.arrayOrNull("components")?.forEach { element ->
                if (element.isJsonObject) consumeComponent(element.asJsonObject)
            }
            return
        }
        if (event == "component_render" || event == "component_stream") {
            val component = root.objectOrNull("component")
                ?: data?.objectOrNull("component")
                ?: data
            component?.let(::consumeComponent)
            return
        }
        if (event == "scene_complete") {
            state = state.copy(waiting = false)
        } else if (event == "error") {
            state = state.copy(waiting = false, error = "The classroom hit a snag.")
        }
    }

    private fun beginScene() {
        voice.stop()
        seenComponents = mutableSetOf()
        // Keep the finished beat so Previous can bring it back, and jump to
        // live: a new scene is always the board the learner should be on.
        val finished = state.takeIf { it.teacherText.isNotBlank() || it.boardContent.isNotBlank() }
            ?.let { ClassroomBoardSnapshot(it.teacherText, it.boardTitle, it.boardContent, it.peerText) }
        state = state.copy(
            waiting = true,
            teacherText = "",
            boardTitle = "",
            boardContent = "",
            peerText = null,
            checkpoint = null,
            application = null,
            continueLabel = null,
            error = null,
            narrating = false,
            captionFraction = null,
            history = if (finished != null) state.history + finished else state.history,
            viewingIndex = -1,
        )
    }

    private fun consumeComponent(component: JsonObject) {
        val id = component.stringOrNull("component_id")
            ?: component.stringOrNull("id")
            ?: return
        if (!seenComponents.add(id)) return
        val type = component.stringOrNull("type").orEmpty()
        val language = component.stringOrNull("language_code") ?: state.languageCode
        when (type) {
            "TeacherMessage" -> {
                val text = component.stringOrNull("text")
                    ?: component.stringOrNull("content")
                    ?: return
                state = state.copy(
                    teacherText = text,
                    languageCode = language,
                    waiting = false,
                    narrating = false,
                    captionFraction = null,
                )
                if (state.voiceEnabled) voice.play(text, language)
            }
            "StudentPrompt" -> {
                state = state.copy(peerText = component.stringOrNull("text"))
            }
            "ExampleBlock" -> {
                state = state.copy(
                    boardTitle = component.stringOrNull("title") ?: "Worked example",
                    boardContent = component.stringOrNull("content").orEmpty(),
                    waiting = false,
                )
            }
            "LessonBlock" -> {
                val block = component.objectOrNull("block")
                state = state.copy(
                    boardTitle = block?.stringOrNull("title") ?: "Lesson board",
                    boardContent = block?.stringOrNull("content").orEmpty(),
                    waiting = false,
                )
            }
            "QuizCard" -> {
                val options = component.arrayOrNull("options")
                    ?.mapNotNull { option ->
                        option.takeIf { it.isJsonObject }?.asJsonObject?.let {
                            ClassroomOption(
                                id = it.stringOrNull("id").orEmpty(),
                                label = it.stringOrNull("label").orEmpty(),
                            )
                        }
                    }
                    .orEmpty()
                state = state.copy(
                    checkpoint = ClassroomCheckpoint(
                        componentId = id,
                        question = component.stringOrNull("question").orEmpty(),
                        options = options,
                    ),
                    waiting = false,
                    continueLabel = null,
                )
            }
            "InputField" -> {
                state = state.copy(
                    application = ClassroomApplication(
                        componentId = id,
                        question = component.stringOrNull("question").orEmpty(),
                        placeholder = component.stringOrNull("placeholder")
                            ?: "Explain and apply the idea…",
                        minWords = component.intOrNull("min_words") ?: 6,
                        actionIntent = component.stringOrNull("action_intent")
                            ?: "submit_transfer",
                    ),
                    waiting = false,
                    continueLabel = null,
                )
            }
            "CTAButton" -> {
                state = state.copy(
                    continueLabel = component.stringOrNull("label") ?: "Continue",
                    continueIntent = component.stringOrNull("action_intent") ?: "continue",
                    waiting = false,
                )
            }
            "ProgressBar" -> {
                state = state.copy(
                    progressCurrent = component.intOrNull("current") ?: 0,
                    progressTotal = (component.intOrNull("total") ?: 1).coerceAtLeast(1),
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClassroomScreen(nav: NavHostController, courseId: String) {
    val context = LocalContext.current
    val controller = remember(courseId) {
        AndroidClassroomController(context, courseId)
    }
    val state = controller.state
    val isSpanish = state.languageCode.lowercase().startsWith("es")
    var title by remember(courseId) { mutableStateOf("AI Classroom") }
    var question by remember { mutableStateOf("") }
    var applicationResponse by remember(state.application?.componentId) {
        mutableStateOf("")
    }
    var dictatingApplication by remember { mutableStateOf(false) }
    var dictationError by remember { mutableStateOf<String?>(null) }
    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val transcript = result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
                ?.trim()
                .orEmpty()
            if (transcript.isNotEmpty()) {
                if (dictatingApplication) {
                    applicationResponse = listOf(applicationResponse.trimEnd(), transcript)
                        .filter { it.isNotBlank() }
                        .joinToString(" ")
                } else {
                    question = listOf(question.trimEnd(), transcript)
                        .filter { it.isNotBlank() }
                        .joinToString(" ")
                }
                dictationError = null
            }
        }
    }

    fun startDictation(forApplication: Boolean) {
        controller.beginLearnerInput()
        dictatingApplication = forApplication
        val language = state.languageCode.takeUnless {
            it.equals("auto", ignoreCase = true)
        } ?: Locale.getDefault().toLanguageTag()
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
            )
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(
                RecognizerIntent.EXTRA_PROMPT,
                if (forApplication) {
                    if (isSpanish) "Explica tu respuesta" else "Explain your answer"
                } else {
                    if (isSpanish) "Pregunta al docente" else "Ask the teacher"
                },
            )
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        try {
            speechLauncher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            dictationError = "Speech recognition is not available on this device."
        }
    }

    LaunchedEffect(courseId) {
        val course = runCatching { ApiClient.api.course(courseId) }.getOrNull()
        title = course?.title ?: "AI Classroom"
        controller.connect(title)
        // Save this course into the learner's device- and platform-agnostic
        // Stacks list the moment the classroom opens, mirroring web's
        // /classroom page upsertCourseOnStart effect and iOS's
        // UIStackStore.upsertCourse call — every entry point that lands
        // here (CourseHeader's "Start Class" and the standalone "Start AI
        // Classroom" button) gets this for free. No-ops silently if the
        // learner isn't signed in or the sync fails.
        StackRepository.upsertCourseOnStart(courseId, title = title)
    }
    DisposableEffect(controller) {
        onDispose { controller.close() }
    }

    Scaffold(
        containerColor = Background,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(title)
                        Text(
                            if (isSpanish) "Una idea a la vez" else "One idea at a time",
                            style = MaterialTheme.typography.labelSmall,
                            color = TextSecondary,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = { nav.popBackStack() }) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = TextPrimary,
                        )
                    }
                },
                actions = {
                    IconButton(
                        onClick = { controller.setVoiceEnabled(!state.voiceEnabled) },
                    ) {
                        Icon(
                            if (state.voiceEnabled) Icons.Filled.VolumeUp
                            else Icons.Filled.VolumeOff,
                            contentDescription = "Toggle teacher voice",
                            tint = LyoPurple,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Background),
            )
        },
    ) { padding ->
        val transport = state.transport
        val board = state.shownBoard
        val viewingHistory = state.viewingHistory

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp),
        ) {
            item {
                LinearProgressIndicator(
                    progress = {
                        state.progressCurrent.toFloat() /
                            state.progressTotal.toFloat()
                    },
                    color = LyoPurple,
                    trackColor = Surface,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            // Transport rail: Previous / position / Skip · Next · Live ·
            // Continue, derived from the real lesson state so the learner
            // always has a visible way forward and back.
            item {
                ClassroomTransportRow(
                    transport = transport,
                    continueLabel = state.continueLabel,
                    isSpanish = isSpanish,
                    onPrevious = controller::viewPrevious,
                    onForward = controller::viewForward,
                )
            }

            if (viewingHistory) {
                item {
                    Text(
                        if (isSpanish) "Viendo una pizarra anterior" else "Viewing an earlier board",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextSecondary,
                    )
                }
            }

            if (board.teacherText.isNotBlank()) {
                item {
                    GlassCard {
                        Column(Modifier.padding(18.dp)) {
                            Text(
                                "Lyo",
                                style = MaterialTheme.typography.labelLarge,
                                color = LyoPurple,
                            )
                            Spacer(Modifier.height(8.dp))
                            SpokenCaptionText(
                                text = board.teacherText,
                                revealedFraction = if (viewingHistory) null else state.captionFraction,
                            )
                        }
                    }
                }
            }

            if (board.boardContent.isNotBlank()) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Surface, RoundedCornerShape(18.dp))
                            .padding(18.dp),
                    ) {
                        Text(
                            board.boardTitle,
                            style = MaterialTheme.typography.titleMedium,
                            color = LyoPurple,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(board.boardContent, color = TextPrimary)
                    }
                }
            }

            board.peerText?.let { peerText ->
                item {
                    Text(
                        peerText,
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary,
                    )
                }
            }

            state.checkpoint?.takeUnless { viewingHistory }?.let { checkpoint ->
                item {
                    GlassCard {
                        Column(Modifier.padding(18.dp)) {
                            Text(
                                checkpoint.question,
                                style = MaterialTheme.typography.titleMedium,
                                color = TextPrimary,
                            )
                            Spacer(Modifier.height(10.dp))
                            checkpoint.options.forEach { option ->
                                OutlinedButton(
                                    onClick = { controller.answer(option) },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 4.dp),
                                ) {
                                    Text(option.label)
                                }
                            }
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                OutlinedButton(
                                    onClick = controller::requestHint,
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Text(if (isSpanish) "Pedir ayuda" else "Ask for help")
                                }
                                OutlinedButton(
                                    onClick = controller::skipQuestion,
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Text(if (isSpanish) "Omitir" else "Skip for now")
                                }
                            }
                        }
                    }
                }
            }

            state.application?.takeUnless { viewingHistory }?.let { application ->
                item {
                    val wordCount = applicationResponse
                        .trim()
                        .split(Regex("\\s+"))
                        .count { it.isNotBlank() }
                    GlassCard {
                        Column(Modifier.padding(18.dp)) {
                            Text(
                                application.question,
                                style = MaterialTheme.typography.titleMedium,
                                color = TextPrimary,
                            )
                            Spacer(Modifier.height(10.dp))
                            OutlinedTextField(
                                value = applicationResponse,
                                onValueChange = {
                                    controller.beginLearnerInput()
                                    applicationResponse = it
                                },
                                placeholder = { Text(application.placeholder) },
                                minLines = 3,
                                trailingIcon = {
                                    IconButton(onClick = { startDictation(true) }) {
                                        Icon(
                                            Icons.Filled.Mic,
                                            contentDescription = "Dictate application",
                                            tint = LyoPurple,
                                        )
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(
                                    if (isSpanish) {
                                        "$wordCount/${application.minWords} palabras"
                                    } else {
                                        "$wordCount/${application.minWords} words"
                                    },
                                    color = TextSecondary,
                                )
                                Button(
                                    onClick = {
                                        controller.submitApplication(applicationResponse)
                                    },
                                    enabled = wordCount >= application.minWords,
                                ) {
                                    Text(if (isSpanish) "Enviar" else "Submit")
                                }
                            }
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                OutlinedButton(
                                    onClick = controller::requestHint,
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Text(if (isSpanish) "Pedir ayuda" else "Ask for help")
                                }
                                OutlinedButton(
                                    onClick = controller::skipQuestion,
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Text(if (isSpanish) "Omitir" else "Skip for now")
                                }
                            }
                        }
                    }
                }
            }

            // Continue appears once narration has finished and nothing is
            // waiting on the learner — with or without a server CTAButton.
            if (transport.readyToContinue) {
                item {
                    val primary = if (isSpanish) "Continuar" else "Continue"
                    val secondary = state.continueLabel
                        ?.trim()
                        ?.takeIf { it.isNotEmpty() && !it.equals(primary, ignoreCase = true) }
                    Button(
                        onClick = controller::continueLesson,
                        colors = ButtonDefaults.buttonColors(containerColor = LyoPurple),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(primary, fontWeight = FontWeight.SemiBold)
                            if (secondary != null) {
                                Text(
                                    secondary,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = TextPrimary.copy(alpha = 0.7f),
                                )
                            }
                        }
                    }
                }
            }

            if (state.waiting && !viewingHistory) {
                item {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.padding(vertical = 8.dp),
                    ) {
                        CircularProgressIndicator(
                            color = LyoPurple,
                            modifier = Modifier.height(22.dp),
                        )
                        Text(
                            if (isSpanish) {
                                "Preparando el siguiente paso…"
                            } else {
                                "Preparing the next teaching beat…"
                            },
                            color = TextSecondary,
                        )
                    }
                }
            }

            state.error?.let { error ->
                item {
                    Text(error, color = MaterialTheme.colorScheme.error)
                }
            }

            dictationError?.let { error ->
                item {
                    Text(error, color = MaterialTheme.colorScheme.error)
                }
            }

            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedTextField(
                        value = question,
                        onValueChange = {
                            controller.beginLearnerInput()
                            question = it
                        },
                        placeholder = {
                            Text(if (isSpanish) "Pregunta al docente" else "Ask the teacher")
                        },
                        trailingIcon = {
                            IconButton(onClick = { startDictation(false) }) {
                                Icon(
                                    Icons.Filled.Mic,
                                    contentDescription = "Dictate question",
                                    tint = LyoPurple,
                                )
                            }
                        },
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = {
                            if (controller.askQuestion(question)) {
                                question = ""
                            }
                        },
                    ) {
                        Icon(
                            Icons.Filled.Send,
                            contentDescription = "Send question",
                            tint = LyoPurple,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Previous / position / forward rail. Only controls that are real right
 * now are rendered: no inert placeholders.
 */
@Composable
private fun ClassroomTransportRow(
    transport: ClassroomTransport,
    continueLabel: String?,
    isSpanish: Boolean,
    onPrevious: () -> Unit,
    onForward: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .background(Surface.copy(alpha = 0.55f), RoundedCornerShape(999.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        Box(Modifier.width(112.dp), contentAlignment = Alignment.CenterStart) {
            if (transport.canGoPrevious) {
                TextButton(onClick = onPrevious) {
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                        contentDescription = null,
                        tint = TextSecondary,
                        modifier = Modifier.size(16.dp),
                    )
                    Text(
                        if (isSpanish) "Anterior" else "Previous",
                        color = TextSecondary,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
        }

        Text(
            transport.positionLabel.uppercase(),
            fontFamily = FontFamily.Monospace,
            fontSize = 10.sp,
            letterSpacing = 1.2.sp,
            color = TextSecondary.copy(alpha = 0.7f),
            modifier = Modifier.weight(1f),
            textAlign = TextAlign.Center,
        )

        Box(Modifier.width(112.dp), contentAlignment = Alignment.CenterEnd) {
            when (transport.forward) {
                ForwardAction.SKIP -> TextButton(onClick = onForward) {
                    Text(
                        if (isSpanish) "Saltar" else "Skip",
                        color = TextSecondary,
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Icon(
                        Icons.Filled.FastForward,
                        contentDescription = if (isSpanish) "Saltar la explicación" else "Skip the explanation currently playing",
                        tint = TextSecondary,
                        modifier = Modifier.size(16.dp),
                    )
                }
                ForwardAction.NEXT, ForwardAction.LIVE -> TextButton(onClick = onForward) {
                    Text(
                        when (transport.forward) {
                            ForwardAction.LIVE -> if (isSpanish) "En vivo" else "Live"
                            else -> if (isSpanish) "Siguiente" else "Next"
                        },
                        color = TextSecondary,
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = TextSecondary,
                        modifier = Modifier.size(16.dp),
                    )
                }
                ForwardAction.CONTINUE -> TextButton(onClick = onForward) {
                    Text(
                        continueLabel?.takeIf { it.isNotBlank() }
                            ?: if (isSpanish) "Continuar" else "Continue",
                        color = LyoPurple,
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 1,
                    )
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = LyoPurple,
                        modifier = Modifier.size(16.dp),
                    )
                }
                ForwardAction.NONE -> Unit
            }
        }
    }
}

/**
 * The teacher line with the words the voice has not reached yet dimmed.
 * Every word stays in the layout so the card never jumps while speaking.
 */
@Composable
private fun SpokenCaptionText(text: String, revealedFraction: Float?) {
    if (revealedFraction == null) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = TextPrimary)
        return
    }
    val words = SpokenCaptionTiming.words(text)
    val revealed = SpokenCaptionTiming.revealedWordCount(revealedFraction, words.size)
    val annotated = buildAnnotatedString {
        words.forEachIndexed { index, word ->
            if (index > 0) append(' ')
            if (index < revealed) {
                append(word)
            } else {
                withStyle(SpanStyle(color = TextPrimary.copy(alpha = 0.28f))) { append(word) }
            }
        }
    }
    Text(annotated, style = MaterialTheme.typography.bodyLarge, color = TextPrimary)
}

private fun JsonObject.stringOrNull(key: String): String? =
    get(key)?.takeUnless { it.isJsonNull }?.asString

private fun JsonObject.intOrNull(key: String): Int? =
    get(key)?.takeUnless { it.isJsonNull }?.asInt

private fun JsonObject.objectOrNull(key: String): JsonObject? =
    get(key)?.takeIf { it.isJsonObject }?.asJsonObject

private fun JsonObject.arrayOrNull(key: String) =
    get(key)?.takeIf { it.isJsonArray }?.asJsonArray
