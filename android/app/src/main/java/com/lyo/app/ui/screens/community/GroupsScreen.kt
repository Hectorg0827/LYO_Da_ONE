package com.lyo.app.ui.screens.community

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.lyo.app.data.api.ApiClient
import com.lyo.app.data.api.GroupDto
import com.lyo.app.ui.components.CardGradients
import com.lyo.app.ui.components.EmptyState
import com.lyo.app.ui.components.GlassCard
import com.lyo.app.ui.components.LoadingBox
import com.lyo.app.ui.theme.Background
import com.lyo.app.ui.theme.LyoPurple
import com.lyo.app.ui.theme.LyoRed
import com.lyo.app.ui.theme.TextPrimary
import com.lyo.app.ui.theme.TextSecondary
import java.io.IOException
import kotlinx.coroutines.launch
import retrofit2.HttpException

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupsScreen(nav: NavHostController) {
    var groups by remember { mutableStateOf<List<GroupDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var loaded by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var pendingGroupId by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    suspend fun loadGroups(preserveVisibleContent: Boolean) {
        if (!preserveVisibleContent) loading = true
        loadError = null
        runCatching { ApiClient.api.groups() }
            .onSuccess { response ->
                groups = response
                loaded = true
            }
            .onFailure { error ->
                loadError = groupFailureMessage(error, "load study groups")
            }
        loading = false
    }

    LaunchedEffect(reloadKey) {
        loadGroups(preserveVisibleContent = groups.isNotEmpty())
    }

    fun toggleMembership(group: GroupDto) {
        val id = group.idStr
        if (id.isBlank() || pendingGroupId != null) return

        pendingGroupId = id
        actionError = null
        scope.launch {
            val joined = group.isMember == true
            runCatching {
                if (joined) {
                    val response = ApiClient.api.leaveGroup(id)
                    require(response.isSuccessful) {
                        "The server rejected the leave request (${response.code()})."
                    }
                } else {
                    ApiClient.api.joinGroup(id)
                }
            }.onSuccess {
                loadGroups(preserveVisibleContent = true)
            }.onFailure { error ->
                actionError = groupFailureMessage(
                    error,
                    if (joined) "leave this study group" else "join this study group",
                )
            }
            pendingGroupId = null
        }
    }

    Scaffold(
        containerColor = Background,
        topBar = {
            TopAppBar(
                title = { Text("Study Groups") },
                navigationIcon = {
                    IconButton(onClick = { nav.popBackStack() }) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = TextPrimary,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Background,
                    titleContentColor = TextPrimary,
                ),
            )
        },
    ) { padding ->
        when {
            loading && groups.isEmpty() -> LoadingBox(modifier = Modifier.padding(padding))
            loadError != null && groups.isEmpty() -> GroupLoadError(
                message = loadError.orEmpty(),
                onRetry = { reloadKey++ },
                modifier = Modifier.padding(padding),
            )
            loaded && groups.isEmpty() -> EmptyState(
                title = "No groups yet",
                subtitle = "Create or join groups to learn together",
                modifier = Modifier.padding(padding),
            )
            else -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
            ) {
                loadError?.let { message ->
                    InlineGroupError(
                        message = message,
                        actionLabel = "Retry refresh",
                        onAction = { reloadKey++ },
                    )
                }
                actionError?.let { message ->
                    InlineGroupError(
                        message = message,
                        actionLabel = "Dismiss",
                        onAction = { actionError = null },
                    )
                }

                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    itemsIndexed(groups, key = { _, group -> group.idStr }) { index, group ->
                        val id = group.idStr
                        val joined = group.isMember == true
                        val pending = pendingGroupId == id

                        GlassCard(modifier = Modifier.fillMaxWidth()) {
                            Spacer(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(72.dp)
                                    .background(CardGradients[index % CardGradients.size]),
                            )
                            Column(modifier = Modifier.padding(14.dp)) {
                                Text(
                                    group.name ?: "Group",
                                    style = MaterialTheme.typography.titleLarge,
                                )
                                if (!group.description.isNullOrBlank()) {
                                    Spacer(Modifier.height(4.dp))
                                    Text(
                                        group.description,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = TextSecondary,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                Spacer(Modifier.height(10.dp))
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        Icons.Filled.People,
                                        contentDescription = "Members",
                                        tint = TextSecondary,
                                        modifier = Modifier.size(16.dp),
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        "${group.memberCount ?: 0} members",
                                        style = MaterialTheme.typography.labelLarge,
                                        color = TextSecondary,
                                    )
                                    Spacer(Modifier.weight(1f))
                                    if (joined) {
                                        OutlinedButton(
                                            onClick = { toggleMembership(group) },
                                            enabled = pendingGroupId == null,
                                        ) {
                                            if (pending) {
                                                CircularProgressIndicator(
                                                    strokeWidth = 2.dp,
                                                    modifier = Modifier.size(18.dp),
                                                )
                                            } else {
                                                Text("Leave", color = TextSecondary)
                                            }
                                        }
                                    } else {
                                        Button(
                                            onClick = { toggleMembership(group) },
                                            enabled = pendingGroupId == null,
                                            colors = ButtonDefaults.buttonColors(
                                                containerColor = LyoPurple,
                                                contentColor = Color.White,
                                            ),
                                        ) {
                                            if (pending) {
                                                CircularProgressIndicator(
                                                    color = Color.White,
                                                    strokeWidth = 2.dp,
                                                    modifier = Modifier.size(18.dp),
                                                )
                                            } else {
                                                Text("Join")
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GroupLoadError(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
    ) {
        Text(
            "Study groups could not be loaded",
            style = MaterialTheme.typography.headlineSmall,
            color = TextPrimary,
            textAlign = TextAlign.Center,
        )
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
        Text(
            "Retry",
            style = MaterialTheme.typography.titleSmall,
            color = LyoPurple,
            modifier = Modifier
                .padding(top = 16.dp)
                .clickable(onClick = onRetry)
                .padding(8.dp),
        )
    }
}

@Composable
private fun InlineGroupError(
    message: String,
    actionLabel: String,
    onAction: () -> Unit,
) {
    GlassCard(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Text(
                message,
                style = MaterialTheme.typography.bodySmall,
                color = LyoRed,
                modifier = Modifier.weight(1f),
            )
            Text(
                actionLabel,
                style = MaterialTheme.typography.labelLarge,
                color = LyoPurple,
                modifier = Modifier
                    .clickable(onClick = onAction)
                    .padding(8.dp),
            )
        }
    }
}

private fun groupFailureMessage(error: Throwable, action: String): String = when (error) {
    is HttpException -> when (error.code()) {
        401, 403 -> "Sign in again to $action."
        404 -> "This study group is no longer available."
        409 -> "The membership changed elsewhere. Refresh and retry."
        429 -> "Too many requests. Wait briefly and retry."
        else -> "LYO could not $action (${error.code()})."
    }
    is IOException -> "Check your connection and retry."
    else -> error.localizedMessage ?: "LYO could not $action."
}
