package com.lyo.app.ui.screens.create

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.lyo.app.ui.components.GlassCard
import com.lyo.app.ui.navigation.Routes
import com.lyo.app.ui.theme.Background
import com.lyo.app.ui.theme.LyoBlue
import com.lyo.app.ui.theme.LyoGreen
import com.lyo.app.ui.theme.LyoPink
import com.lyo.app.ui.theme.LyoPurple
import com.lyo.app.ui.theme.TextPrimary
import com.lyo.app.ui.theme.TextSecondary

private data class CreateAction(
    val title: String,
    val subtitle: String,
    val icon: ImageVector,
    val accent: Color,
    val route: String,
)

private val createActions = listOf(
    CreateAction(
        title = "Create a clip",
        subtitle = "Choose a video, preview it, add its learning context, and publish it.",
        icon = Icons.Filled.PlayCircle,
        accent = LyoPink,
        route = Routes.CREATE_CLIP,
    ),
    CreateAction(
        title = "Write a community post",
        subtitle = "Publish a question, insight, study tip, or learning update.",
        icon = Icons.Filled.Add,
        accent = LyoPurple,
        route = Routes.CREATE_POST,
    ),
    CreateAction(
        title = "Create a study group",
        subtitle = "Open a public group or a private group that requires approval.",
        icon = Icons.Filled.Groups,
        accent = LyoGreen,
        route = Routes.CREATE_GROUP,
    ),
    CreateAction(
        title = "Create a learning event",
        subtitle = "Schedule an online or in-person Community event with real attendance limits.",
        icon = Icons.Filled.Event,
        accent = LyoBlue,
        route = Routes.CREATE_EVENT,
    ),
    CreateAction(
        title = "Generate an AI course",
        subtitle = "Use the existing course generator to choose a topic, difficulty, and duration.",
        icon = Icons.Filled.School,
        accent = LyoPurple,
        route = Routes.COURSES,
    ),
    CreateAction(
        title = "Plan content with Lyo",
        subtitle = "Open the real LYO conversation before deciding what to publish.",
        icon = Icons.Filled.SmartToy,
        accent = LyoBlue,
        route = Routes.CHAT,
    ),
)

@Composable
fun CreateScreen(nav: NavHostController) {
    LazyColumn(
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        modifier = Modifier
            .fillMaxSize()
            .background(Background),
    ) {
        item {
            Text(
                text = "Create",
                style = MaterialTheme.typography.headlineLarge,
                color = TextPrimary,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Choose a production workflow. Every visible action is connected to a real service.",
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary,
                modifier = Modifier.padding(top = 6.dp),
            )
            Spacer(Modifier.height(8.dp))
        }

        items(createActions.size) { index ->
            val action = createActions[index]
            GlassCard(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { nav.navigate(action.route) },
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(16.dp),
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                        modifier = Modifier
                            .size(50.dp)
                            .clip(RoundedCornerShape(15.dp))
                            .background(action.accent.copy(alpha = 0.16f)),
                    ) {
                        Icon(
                            imageVector = action.icon,
                            contentDescription = null,
                            tint = action.accent,
                            modifier = Modifier.size(25.dp),
                        )
                    }
                    Column(
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier
                            .weight(1f)
                            .padding(start = 14.dp),
                    ) {
                        Text(
                            text = action.title,
                            style = MaterialTheme.typography.titleMedium,
                            color = TextPrimary,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            text = action.subtitle,
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary,
                        )
                    }
                    Icon(
                        imageVector = Icons.Filled.MenuBook,
                        contentDescription = "Open ${action.title}",
                        tint = TextSecondary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }

        item {
            Text(
                text = "Story publishing remains omitted until Android has a complete media-capture and story-upload contract.",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 10.dp),
            )
        }
    }
}
