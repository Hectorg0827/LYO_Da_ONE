package com.lyo.app.ui.screens.chat

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import coil.compose.AsyncImage
import com.lyo.app.data.api.AiConversationMessageDto
import com.lyo.app.data.api.ApiClient
import com.lyo.app.data.api.ChatStreamClient
import com.lyo.app.data.api.ChatStreamEvent
import com.lyo.app.data.api.ChatMediaRef
import com.lyo.app.data.api.CheckAnswerRequest
import com.lyo.app.data.api.CheckAnswerResult
import com.lyo.app.data.api.CreateAiConversationRequest
import com.lyo.app.data.api.SmartBlock
import com.lyo.app.ui.components.LyoBrandGradient
import com.lyo.app.ui.components.SmartBlockList
import com.lyo.app.ui.theme.Background
import com.lyo.app.ui.theme.BorderColor
import com.lyo.app.ui.theme.LyoPurple
import com.lyo.app.ui.theme.Surface
import com.lyo.app.ui.theme.TextPrimary
import com.lyo.app.ui.theme.TextSecondary
import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.UUID
import kotlin.math.max
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

private const val MAX_CHAT_CHARS = 4_000
private const val MAX_CHAT_ATTACHMENT_BYTES = 10L * 1024 * 1024
private const val MAX_CHAT_ATTACHMENT_TOTAL_BYTES = 20L * 1024 * 1024
private const val MAX_CHAT_ATTACHMENTS = 4
private const val ASSISTANT_RESPONSE_WIDTH_FRACTION = 0.99f
private val SupportedChatAttachmentTypes = setOf(
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
)

private val ImageMarkdown = Regex(
    """!\[([^]]*)]\((https?://[^)]*/api/v1/media/file/chat/[^)]+)\)""",
)
private val FileMarkdown = Regex(
    """\[📎 ([^]]+)]\((https?://[^)]*/api/v1/media/file/chat/[^)]+)\)""",
)

data class ChatMsg(
    val role: String,
    val content: String,
    val id: String = UUID.randomUUID().toString(),
    /** Structured lesson blocks, when the turn carried them. */
    val blocks: List<SmartBlock>? = null,
    /** Server-graded verdicts for this message's answered checks, keyed by block id. */
    val checkResults: Map<String, CheckAnswerResult> = emptyMap(),
)

/**
 * Restores a reloaded conversation's structured blocks *and* any checks
 * already answered in a previous session — the server persists the verdict
 * onto `block.metadata.result` when a check is graded (see /chat/check),
 * so without reading it back a reloaded check would re-offer itself as
 * unanswered. Mirrors web's extractCheckResults (chat-store.ts).
 */
private fun AiConversationMessageDto.toChatMsg(): ChatMsg {
    val checkResults = blocks.orEmpty().mapNotNull { block ->
        val resultJson = block.metadata?.get("result") ?: return@mapNotNull null
        runCatching { ApiClient.gson.fromJson(resultJson, CheckAnswerResult::class.java) }
            .getOrNull()
            ?.let { block.id to it }
    }.toMap()
    return ChatMsg(role = role, content = content, id = id, blocks = blocks, checkResults = checkResults)
}

private data class PendingChatAttachment(
    val name: String,
    val url: String,
    val mimeType: String,
    val size: Long,
    val isImage: Boolean,
)

private data class LinkedAttachment(
    val name: String,
    val url: String,
    val isImage: Boolean,
)

private data class ParsedChatContent(
    val text: String,
    val attachments: List<LinkedAttachment>,
)

private val Suggestions = listOf(
    "Explain quantum computing",
    "Make me a study plan",
    "Help me learn Spanish",
    "Summarize photosynthesis",
)

@Composable
fun ChatScreen(nav: NavHostController) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val messages = remember { mutableStateListOf<ChatMsg>() }
    var input by remember { mutableStateOf("") }
    var isStreaming by remember { mutableStateOf(false) }
    var activeConversationId by remember { mutableStateOf<String?>(null) }
    val pendingAttachments = remember { mutableStateListOf<PendingChatAttachment>() }
    var uploadingAttachment by remember { mutableStateOf(false) }
    var dictating by remember { mutableStateOf(false) }
    var inputError by remember { mutableStateOf<String?>(null) }
    var textToSpeech by remember { mutableStateOf<TextToSpeech?>(null) }
    var textToSpeechReady by remember { mutableStateOf(false) }
    var speakingMessageId by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()
    val mainHandler = remember { Handler(Looper.getMainLooper()) }

    DisposableEffect(context) {
        lateinit var engine: TextToSpeech
        engine = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val languageResult = engine.setLanguage(Locale.getDefault())
                textToSpeechReady = languageResult != TextToSpeech.LANG_MISSING_DATA &&
                    languageResult != TextToSpeech.LANG_NOT_SUPPORTED
            } else {
                textToSpeechReady = false
            }
        }
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit

            override fun onDone(utteranceId: String?) {
                mainHandler.post {
                    if (speakingMessageId == utteranceId) speakingMessageId = null
                }
            }

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                mainHandler.post {
                    if (speakingMessageId == utteranceId) speakingMessageId = null
                }
            }
        })
        textToSpeech = engine

        onDispose {
            engine.stop()
            engine.shutdown()
            textToSpeech = null
            textToSpeechReady = false
            speakingMessageId = null
        }
    }

    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        dictating = false
        if (result.resultCode == Activity.RESULT_OK) {
            val transcript = result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
                ?.trim()
                .orEmpty()
            if (transcript.isNotEmpty()) {
                input = listOf(input.trimEnd(), transcript)
                    .filter { it.isNotBlank() }
                    .joinToString(" ")
                    .take(MAX_CHAT_CHARS)
                inputError = null
            }
        }
    }

    val attachmentPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        if (uris.isEmpty() || uploadingAttachment || isStreaming) {
            return@rememberLauncherForActivityResult
        }
        val remaining = MAX_CHAT_ATTACHMENTS - pendingAttachments.size
        if (remaining <= 0) {
            inputError = "You can attach up to four files."
            return@rememberLauncherForActivityResult
        }
        if (uris.size > remaining) {
            inputError = "Only $remaining more attachment${if (remaining == 1) "" else "s"} can be added."
        } else {
            inputError = null
        }

        uploadingAttachment = true
        scope.launch {
            var totalBytes = pendingAttachments.sumOf { it.size }
            for (uri in uris.take(remaining)) {
                try {
                    val attachment = uploadChatAttachment(
                        context = context,
                        uri = uri,
                        remainingTotalBytes = MAX_CHAT_ATTACHMENT_TOTAL_BYTES - totalBytes,
                    )
                    pendingAttachments.add(attachment)
                    totalBytes += attachment.size
                } catch (error: Exception) {
                    inputError = error.message ?: "The attachment could not be uploaded."
                }
            }
            uploadingAttachment = false
        }
    }

    fun send(raw: String) {
        val trimmed = raw.trim()
        val attachments = pendingAttachments.toList()
        if ((trimmed.isEmpty() && attachments.isEmpty()) || isStreaming || uploadingAttachment) return

        val content = buildChatContent(trimmed, attachments)
        val clientMessageId = UUID.randomUUID().toString()
        messages.add(ChatMsg(role = "user", content = content, id = clientMessageId))
        messages.add(ChatMsg(role = "assistant", content = ""))
        input = ""
        pendingAttachments.clear()
        inputError = null
        isStreaming = true

        scope.launch {
            val conversationId = activeConversationId ?: runCatching {
                ApiClient.api.createAiConversation(
                    CreateAiConversationRequest(
                        title = trimmed.ifBlank { attachments.firstOrNull()?.name.orEmpty() }.take(80),
                    ),
                ).id
            }.getOrElse {
                messages[messages.lastIndex] = messages.last().copy(
                    content = "I couldn't save this conversation. Please check your connection and try again.",
                )
                isStreaming = false
                return@launch
            }
            activeConversationId = conversationId

            runCatching {
                ChatStreamClient.stream(
                    text = trimmed,
                    conversationId = conversationId,
                    clientMessageId = clientMessageId,
                    media = attachments.map { attachment ->
                        ChatMediaRef(
                            modality = if (attachment.isImage) "IMAGE" else "DOCUMENT",
                            uri = attachment.url,
                            mimeType = attachment.mimeType,
                            name = attachment.name,
                            sizeBytes = attachment.size,
                        )
                    },
                ).collect { event ->
                    when (event) {
                        is ChatStreamEvent.Chunk -> {
                            val last = messages.last()
                            messages[messages.lastIndex] = last.copy(content = last.content + event.text)
                        }

                        is ChatStreamEvent.SmartBlocks -> {
                            // Structured lesson content — every beat, not just
                            // plain prose. Previously unhandled, so lessons
                            // rendered as whatever plain text also came through.
                            val last = messages.last()
                            messages[messages.lastIndex] = last.copy(blocks = event.blocks)
                        }

                        is ChatStreamEvent.Done -> Unit
                        is ChatStreamEvent.Conversation -> activeConversationId = event.id
                        is ChatStreamEvent.Error -> {
                            messages[messages.lastIndex] = messages.last().copy(
                                content = "The response was interrupted. Your conversation is saved—please try again.",
                            )
                        }
                    }
                }
            }.onFailure {
                messages[messages.lastIndex] = messages.last().copy(
                    content = "The response was interrupted. Your conversation is saved—please try again.",
                )
            }
            isStreaming = false
        }
    }

    /**
     * Grade an in-chat check against the block the server itself emitted.
     *
     * Sends only which option was picked. Correctness comes back from the
     * server — this must never be inferred locally from
     * `QuizBlockPayload.correctIndex`, which is the exact bug this endpoint
     * exists to remove (chat praising a wrong answer). Mirrors web's
     * answerCheck / iOS's UnifiedChatService.answerCheck.
     */
    fun answerCheck(messageId: String, blockId: String, selectedIndex: Int) {
        val conversationId = activeConversationId ?: return
        scope.launch {
            runCatching {
                ApiClient.api.checkChatAnswer(
                    CheckAnswerRequest(
                        conversationId = conversationId,
                        blockId = blockId,
                        selectedIndex = selectedIndex,
                    ),
                )
            }.onSuccess { result ->
                val index = messages.indexOfFirst { it.id == messageId }
                if (index >= 0) {
                    val current = messages[index]
                    messages[index] = current.copy(checkResults = current.checkResults + (blockId to result))
                }
            }
            // No onFailure handler: best-effort, same as web/iOS. A failed
            // grade leaves the check pending rather than faking a verdict —
            // the option stays tappable so the learner can try again.
        }
    }

    fun startDictation() {
        if (isStreaming || uploadingAttachment || dictating) return
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your message to Lyo")
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        try {
            dictating = true
            inputError = null
            speechLauncher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            dictating = false
            inputError = "Speech recognition is not available on this device."
        }
    }

    fun toggleSpeech(message: ChatMsg) {
        val engine = textToSpeech ?: return
        if (speakingMessageId == message.id) {
            engine.stop()
            speakingMessageId = null
            return
        }

        val parsed = parseChatContent(message.content)
        val spokenText = parsed.text.ifBlank {
            parsed.attachments.joinToString(", ") { "Attachment: ${it.name}" }
        }
        if (spokenText.isBlank()) return

        engine.stop()
        speakingMessageId = message.id
        engine.speak(
            spokenText,
            TextToSpeech.QUEUE_FLUSH,
            null,
            message.id,
        )
    }

    // Resume the most recent server conversation on any Android device.
    LaunchedEffect(Unit) {
        runCatching {
            val latest = ApiClient.api.aiConversations().conversations.firstOrNull() ?: return@runCatching
            val detail = ApiClient.api.aiConversation(latest.id)
            activeConversationId = detail.id
            messages.clear()
            messages.addAll(detail.messages.map { it.toChatMsg() })
        }
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(max(0, messages.size - 1))
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Background)
            .imePadding(),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            Text("LYO", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
            TextButton(
                enabled = !isStreaming && !uploadingAttachment,
                onClick = {
                    textToSpeech?.stop()
                    speakingMessageId = null
                    activeConversationId = null
                    pendingAttachments.clear()
                    inputError = null
                    messages.clear()
                },
            ) { Text("New chat", color = LyoPurple) }
        }

        if (messages.isEmpty()) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp),
            ) {
                Text(
                    text = "LYO",
                    style = MaterialTheme.typography.headlineLarge,
                    color = TextPrimary,
                )
                Text(
                    text = "Ask me anything about learning",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
                )
                Suggestions.forEach { suggestion ->
                    Box(
                        modifier = Modifier
                            .padding(vertical = 4.dp)
                            .clip(RoundedCornerShape(20.dp))
                            .background(Surface)
                            .border(1.dp, BorderColor, RoundedCornerShape(20.dp))
                            .clickable(enabled = !isStreaming) { send(suggestion) }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                    ) {
                        Text(
                            text = suggestion,
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextPrimary,
                        )
                    }
                }
            }
        } else {
            LazyColumn(
                state = listState,
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(vertical = 16.dp),
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) {
                items(messages, key = { it.id }) { msg ->
                    MessageBubble(
                        msg = msg,
                        showTyping = isStreaming &&
                            msg.id == messages.lastOrNull()?.id &&
                            msg.role == "assistant" &&
                            msg.content.isEmpty() &&
                            msg.blocks.isNullOrEmpty(),
                        canSpeak = textToSpeechReady && msg.role == "assistant" && msg.content.isNotBlank(),
                        speaking = speakingMessageId == msg.id,
                        onAnswerCheck = { blockId, index -> answerCheck(msg.id, blockId, index) },
                        onToggleSpeech = { toggleSpeech(msg) },
                    )
                }
            }
        }

        inputError?.let { error ->
            Text(
                text = error,
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFFFF9A9A),
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
            )
        }

        pendingAttachments.forEach { attachment ->
            PendingAttachmentChip(
                attachment = attachment,
                onRemove = { pendingAttachments.remove(attachment) },
            )
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .background(Surface)
                .padding(horizontal = 8.dp, vertical = 8.dp),
        ) {
            IconButton(
                onClick = {
                    attachmentPicker.launch(
                        arrayOf(
                            "image/jpeg", "image/png", "image/webp", "image/heic",
                            "application/pdf", "text/plain", "text/markdown", "text/csv",
                            "application/json",
                        ),
                    )
                },
                enabled = !isStreaming && !uploadingAttachment &&
                    pendingAttachments.size < MAX_CHAT_ATTACHMENTS,
                modifier = Modifier.size(44.dp),
            ) {
                if (uploadingAttachment) {
                    CircularProgressIndicator(
                        color = LyoPurple,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(20.dp),
                    )
                } else {
                    Icon(
                        imageVector = Icons.Default.AttachFile,
                        contentDescription = "Attach an image or document",
                        tint = TextSecondary,
                    )
                }
            }

            IconButton(
                onClick = ::startDictation,
                enabled = !isStreaming && !uploadingAttachment && !dictating,
                modifier = Modifier.size(44.dp),
            ) {
                if (dictating) {
                    CircularProgressIndicator(
                        color = LyoPurple,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(20.dp),
                    )
                } else {
                    Icon(
                        imageVector = Icons.Default.Mic,
                        contentDescription = "Dictate message",
                        tint = TextSecondary,
                    )
                }
            }

            OutlinedTextField(
                value = input,
                onValueChange = { if (it.length <= MAX_CHAT_CHARS) input = it },
                enabled = !isStreaming,
                placeholder = {
                    Text(
                        when {
                            isStreaming -> "Lyo is thinking…"
                            dictating -> "Listening…"
                            else -> "Ask Lyo anything…"
                        },
                        color = TextSecondary,
                    )
                },
                shape = RoundedCornerShape(24.dp),
                maxLines = 4,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = LyoPurple,
                    unfocusedBorderColor = BorderColor,
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                    cursorColor = LyoPurple,
                ),
                modifier = Modifier.weight(1f),
            )

            IconButton(
                onClick = { send(input) },
                enabled = !isStreaming &&
                    !uploadingAttachment &&
                    (input.isNotBlank() || pendingAttachments.isNotEmpty()),
                modifier = Modifier
                    .padding(start = 6.dp)
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(
                        if (isStreaming || uploadingAttachment) LyoPurple.copy(alpha = 0.4f)
                        else LyoPurple,
                    ),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Send,
                    contentDescription = "Send",
                    tint = Color.White,
                )
            }
        }
    }
}

@Composable
private fun PendingAttachmentChip(
    attachment: PendingChatAttachment,
    onRemove: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .background(Surface)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        if (attachment.isImage) {
            AsyncImage(
                model = attachment.url,
                contentDescription = attachment.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(10.dp)),
            )
        } else {
            Icon(
                imageVector = Icons.Default.InsertDriveFile,
                contentDescription = null,
                tint = LyoPurple,
                modifier = Modifier.size(32.dp),
            )
        }
        Text(
            text = attachment.name,
            style = MaterialTheme.typography.bodySmall,
            color = TextPrimary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onRemove, modifier = Modifier.size(36.dp)) {
            Icon(
                imageVector = Icons.Default.Close,
                contentDescription = "Remove attachment",
                tint = TextSecondary,
            )
        }
    }
}

@Composable
private fun MessageBubble(
    msg: ChatMsg,
    showTyping: Boolean,
    canSpeak: Boolean,
    speaking: Boolean,
    onToggleSpeech: () -> Unit,
    onAnswerCheck: (blockId: String, selectedIndex: Int) -> Unit,
) {
    val context = LocalContext.current
    val isUser = msg.role == "user"
    val parsed = remember(msg.content) { parseChatContent(msg.content) }

    Row(
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Center,
        modifier = if (isUser) {
            Modifier.fillMaxWidth().padding(horizontal = 16.dp)
        } else {
            Modifier.fillMaxWidth()
        },
    ) {
        val bubbleShape = RoundedCornerShape(
            topStart = 18.dp,
            topEnd = 18.dp,
            bottomStart = if (isUser) 18.dp else 4.dp,
            bottomEnd = if (isUser) 4.dp else 18.dp,
        )
        val bubbleModifier = Modifier
            .then(
                if (isUser) Modifier.widthIn(max = 320.dp)
                else Modifier.fillMaxWidth(ASSISTANT_RESPONSE_WIDTH_FRACTION),
            )
            .clip(bubbleShape)
            .let {
                if (isUser) it.background(LyoBrandGradient)
                else it
                    .background(Surface)
                    .border(1.dp, BorderColor, bubbleShape)
            }
            .padding(horizontal = 14.dp, vertical = 10.dp)

        Column(modifier = bubbleModifier) {
            if (showTyping) {
                val transition = rememberInfiniteTransition(label = "typing")
                val blinkAlpha by transition.animateFloat(
                    initialValue = 0.2f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(durationMillis = 500),
                        repeatMode = RepeatMode.Reverse,
                    ),
                    label = "typingAlpha",
                )
                Text(
                    text = "...",
                    style = MaterialTheme.typography.bodyLarge,
                    color = TextSecondary,
                    modifier = Modifier.alpha(blinkAlpha),
                )
            } else {
                parsed.attachments.forEachIndexed { index, attachment ->
                    if (attachment.isImage) {
                        AsyncImage(
                            model = attachment.url,
                            contentDescription = attachment.name,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 120.dp, max = 240.dp)
                                .padding(top = if (index == 0) 0.dp else 8.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { openAttachment(context, attachment.url) },
                        )
                    } else {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color.White.copy(alpha = 0.08f))
                                .clickable { openAttachment(context, attachment.url) }
                                .fillMaxWidth()
                                .padding(top = if (index == 0) 0.dp else 8.dp)
                                .padding(10.dp),
                        ) {
                            Icon(
                                imageVector = Icons.Default.InsertDriveFile,
                                contentDescription = null,
                                tint = if (isUser) Color.White else LyoPurple,
                            )
                            Text(
                                text = attachment.name,
                                style = MaterialTheme.typography.bodySmall,
                                color = if (isUser) Color.White else TextPrimary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }

                val blocks = msg.blocks
                if (!blocks.isNullOrEmpty()) {
                    // Structured lesson content — every beat (hook, callout,
                    // dataViz, flashcard, quiz, ...), not just the plain text
                    // in msg.content. Rendered instead of parsed.text below,
                    // same mutual exclusivity web/iOS use: a turn's answer
                    // lives in one place or the other, never both.
                    SmartBlockList(
                        blocks = blocks,
                        checkResults = msg.checkResults,
                        onQuizAnswer = onAnswerCheck,
                        modifier = Modifier.padding(top = if (parsed.attachments.isNotEmpty()) 8.dp else 0.dp),
                        contentColor = if (isUser) Color.White else TextPrimary,
                    )
                } else if (parsed.text.isNotBlank()) {
                    Text(
                        text = parsed.text,
                        style = MaterialTheme.typography.bodyLarge,
                        color = if (isUser) Color.White else TextPrimary,
                        modifier = Modifier.padding(top = if (parsed.attachments.isNotEmpty()) 8.dp else 0.dp),
                    )
                }

                if (canSpeak) {
                    IconButton(
                        onClick = onToggleSpeech,
                        modifier = Modifier
                            .align(Alignment.End)
                            .padding(top = 4.dp)
                            .size(32.dp),
                    ) {
                        Icon(
                            imageVector = if (speaking) Icons.Default.Stop else Icons.Default.VolumeUp,
                            contentDescription = if (speaking) "Stop reading" else "Read response aloud",
                            tint = LyoPurple,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
        }
    }
}

private suspend fun uploadChatAttachment(
    context: Context,
    uri: Uri,
    remainingTotalBytes: Long,
): PendingChatAttachment {
    val resolver = context.contentResolver
    val displayName = attachmentDisplayName(context, uri)
    val contentType = chatAttachmentMimeType(resolver.getType(uri), displayName)
        ?: throw IllegalArgumentException("Choose an image, PDF, TXT, Markdown, CSV, or JSON file.")
    if (contentType !in SupportedChatAttachmentTypes) {
        throw IllegalArgumentException("That file type is not supported in chat.")
    }
    if (remainingTotalBytes <= 0) {
        throw IllegalArgumentException("Attachments may total at most 20MB.")
    }

    val byteLimit = minOf(MAX_CHAT_ATTACHMENT_BYTES, remainingTotalBytes)
    val bytes = withContext(Dispatchers.IO) {
        resolver.openInputStream(uri)?.use { stream ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                total += read
                if (total > byteLimit) {
                    val message = if (total > MAX_CHAT_ATTACHMENT_BYTES) {
                        "Each attachment must be 10MB or smaller."
                    } else {
                        "Attachments may total at most 20MB."
                    }
                    throw IllegalArgumentException(message)
                }
                output.write(buffer, 0, read)
            }
            output.toByteArray()
        }
    } ?: throw IllegalStateException("The selected attachment could not be read.")

    val file = MultipartBody.Part.createFormData(
        "file",
        displayName,
        bytes.toRequestBody(contentType.toMediaType()),
    )
    val uploaded = ApiClient.api.uploadMedia(
        file = file,
        folder = "chat".toRequestBody("text/plain".toMediaType()),
    )
    val url = uploaded.url
        ?: throw IllegalStateException("The media service did not return a file URL.")
    return PendingChatAttachment(
        name = displayName,
        url = url,
        mimeType = contentType,
        size = bytes.size.toLong(),
        isImage = contentType.startsWith("image/"),
    )
}

private fun chatAttachmentMimeType(reportedType: String?, displayName: String): String? {
    val normalized = reportedType?.substringBefore(';')?.trim()?.lowercase()
    if (normalized in SupportedChatAttachmentTypes) return normalized
    return when (displayName.substringAfterLast('.', "").lowercase()) {
        "jpg", "jpeg" -> "image/jpeg"
        "png" -> "image/png"
        "webp" -> "image/webp"
        "heic" -> "image/heic"
        "pdf" -> "application/pdf"
        "txt" -> "text/plain"
        "md", "markdown" -> "text/markdown"
        "csv" -> "text/csv"
        "json" -> "application/json"
        else -> null
    }
}

private fun attachmentDisplayName(context: Context, uri: Uri): String {
    val resolver = context.contentResolver
    val queriedName = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor ->
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
        }
    return queriedName
        ?.takeIf { it.isNotBlank() }
        ?.replace("[", "")
        ?.replace("]", "")
        ?.replace("(", "")
        ?.replace(")", "")
        ?.take(120)
        ?: "attachment"
}

private fun buildChatContent(
    text: String,
    attachments: List<PendingChatAttachment>,
): String {
    val parts = mutableListOf<String>()
    if (text.isNotBlank()) parts.add(text)
    attachments.forEach { attachment ->
        parts.add(
            if (attachment.isImage) "![${attachment.name}](${attachment.url})"
            else "[📎 ${attachment.name}](${attachment.url})",
        )
    }
    return parts.joinToString("\n\n")
}

private fun parseChatContent(content: String): ParsedChatContent {
    val attachments = mutableListOf<Pair<Int, LinkedAttachment>>()
    ImageMarkdown.findAll(content).forEach { match ->
        attachments.add(
            match.range.first to LinkedAttachment(
                name = match.groupValues[1].ifBlank { "Image" },
                url = match.groupValues[2],
                isImage = true,
            ),
        )
    }
    FileMarkdown.findAll(content).forEach { match ->
        attachments.add(
            match.range.first to LinkedAttachment(
                name = match.groupValues[1],
                url = match.groupValues[2],
                isImage = false,
            ),
        )
    }
    val text = content
        .replace(ImageMarkdown, "")
        .replace(FileMarkdown, "")
        .trim()
    return ParsedChatContent(
        text = text,
        attachments = attachments.sortedBy { it.first }.map { it.second },
    )
}

private fun openAttachment(context: Context, url: String) {
    runCatching {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}
