package ai.softpal.fitcoach.ui

import ai.softpal.fitcoach.R
import ai.softpal.fitcoach.core.ActivityLevel
import ai.softpal.fitcoach.core.AppData
import ai.softpal.fitcoach.core.EnergyCalculator
import ai.softpal.fitcoach.core.exercise.Exercise
import ai.softpal.fitcoach.core.exercise.ExerciseCatalog
import ai.softpal.fitcoach.core.exercise.FreeActivity
import ai.softpal.fitcoach.core.exercise.Suggestions
import ai.softpal.fitcoach.ui.components.ExerciseAnimation
import ai.softpal.fitcoach.ui.components.NumberField
import ai.softpal.fitcoach.ui.components.SectionCard
import ai.softpal.fitcoach.ui.components.currentLang
import ai.softpal.fitcoach.ui.components.formatKcal
import ai.softpal.fitcoach.ui.components.local
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import java.time.LocalDate

@Composable
fun SportScreen(vm: MainViewModel, data: AppData, today: LocalDate, onOpen: (String) -> Unit) {
    val profile = data.profile ?: return
    val level = profile.activity
    val plan = Suggestions.forDay(level, today)
    val todays = data.activities.filter { it.date == today.toString() }
    val doneIds = todays.mapNotNull { it.exerciseId }.toSet()
    var showFree by rememberSaveable { mutableStateOf(false) }
    var showAll by rememberSaveable { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column {
            Text(stringResource(R.string.plan_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                stringResource(R.string.plan_subtitle, stringResource(levelName(level)), Suggestions.totalMinutes(level, today)),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        plan.forEach { ExerciseCard(it, level, done = it.id in doneIds, onClick = { onOpen(it.id) }) }

        if (plan.all { it.id in doneIds }) {
            Text(stringResource(R.string.plan_done), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }

        SectionCard(title = stringResource(R.string.activities_today)) {
            if (todays.isEmpty()) {
                Text(stringResource(R.string.activities_empty), style = MaterialTheme.typography.bodyMedium)
            } else {
                todays.forEach { a ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(a.name, fontWeight = FontWeight.Medium)
                            Text(stringResource(R.string.minutes_value, a.minutes), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text("+" + formatKcal(a.kcal), fontWeight = FontWeight.SemiBold)
                        IconButton(onClick = { vm.deleteActivity(a.id) }) {
                            Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.delete))
                        }
                    }
                }
                HorizontalDivider()
                Text(stringResource(R.string.total) + ": +" + formatKcal(todays.sumOf { it.kcal }), fontWeight = FontWeight.Bold)
            }
            FilledTonalButton(onClick = { showFree = true }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.Add, contentDescription = null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.add_other_activity))
            }
        }

        OutlinedButton(onClick = { showAll = !showAll }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(if (showAll) R.string.hide_all_exercises else R.string.show_all_exercises))
        }
        if (showAll) {
            ExerciseCatalog.exercises.filterNot { it in plan }.forEach {
                ExerciseCard(it, level, done = it.id in doneIds, onClick = { onOpen(it.id) })
            }
        }
        Spacer(Modifier.height(8.dp))
    }

    if (showFree) {
        FreeActivityDialog(
            weightKg = profile.weightKg,
            onDismiss = { showFree = false },
            onSave = { activity, name, minutes ->
                vm.logFreeActivity(activity, name, minutes)
                showFree = false
            },
        )
    }
}

fun levelName(level: ActivityLevel) = when (level) {
    ActivityLevel.SPORTY -> R.string.level_sporty
    ActivityLevel.NORMAL -> R.string.level_normal
    ActivityLevel.UNSPORTY -> R.string.level_unsporty
}

@Composable
private fun ExerciseCard(exercise: Exercise, level: ActivityLevel, done: Boolean, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.background) {
                ExerciseAnimation(exercise.animation, exercise.name.local(), Modifier.size(84.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (exercise.warmup) {
                    Text(stringResource(R.string.warmup), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(exercise.name.local(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(exercise.doseFor(level).local(), style = MaterialTheme.typography.bodyMedium)
                Text(stringResource(R.string.minutes_value, exercise.minutesFor(level)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (done) {
                Icon(Icons.Filled.CheckCircle, contentDescription = stringResource(R.string.done), tint = MaterialTheme.colorScheme.primary)
            } else {
                Icon(Icons.Filled.PlayArrow, contentDescription = stringResource(R.string.open_exercise))
            }
        }
    }
}

/** Übungsdetail: große Animation, Schritt-für-Schritt-Anleitung, Stoppuhr, "Geschafft". */
@Composable
fun ExerciseDetailScreen(exerciseId: String, level: ActivityLevel, onDone: (Exercise, String, Int) -> Unit) {
    val exercise = ExerciseCatalog.byId(exerciseId) ?: return
    val lang = currentLang()
    var minutes by rememberSaveable(exerciseId) { mutableIntStateOf(exercise.minutesFor(level)) }
    var running by rememberSaveable { mutableStateOf(false) }
    var seconds by rememberSaveable { mutableIntStateOf(0) }

    LaunchedEffect(running) {
        while (running) {
            delay(1000)
            seconds++
            if (seconds % 60 == 0) minutes = maxOf(minutes, seconds / 60)
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(exercise.name.local(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
            ExerciseAnimation(
                exercise.animation,
                stringResource(R.string.animation_description, exercise.name.local()),
                Modifier.fillMaxWidth().heightIn(max = 360.dp).padding(8.dp),
            )
        }
        Text(exercise.doseFor(level).local(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)

        SectionCard(title = stringResource(R.string.how_to)) {
            exercise.steps.forEachIndexed { i, step ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primary, modifier = Modifier.size(26.dp)) {
                        Text(
                            "${i + 1}",
                            color = MaterialTheme.colorScheme.onPrimary,
                            style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.padding(top = 3.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                    Text(step.local(), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                }
            }
            Text(stringResource(R.string.exercise_tip), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        SectionCard(title = stringResource(R.string.stopwatch)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("%d:%02d".format(seconds / 60, seconds % 60), style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                FilledTonalButton(onClick = { running = !running }) {
                    Text(stringResource(if (running) R.string.pause else R.string.start))
                }
                TextButton(onClick = { running = false; seconds = 0 }) { Text(stringResource(R.string.reset)) }
            }
        }

        SectionCard(title = stringResource(R.string.duration)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                FilledTonalIconButton(onClick = { minutes = maxOf(1, minutes - 1) }) { Text("−", style = MaterialTheme.typography.titleLarge) }
                Text(stringResource(R.string.minutes_value, minutes), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                FilledTonalIconButton(onClick = { minutes = minOf(180, minutes + 1) }) { Text("+", style = MaterialTheme.typography.titleLarge) }
            }
        }

        Button(
            onClick = { running = false; onDone(exercise, exercise.name[lang], minutes) },
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) { Text(stringResource(R.string.done_log)) }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun FreeActivityDialog(weightKg: Double, onDismiss: () -> Unit, onSave: (FreeActivity, String, Int) -> Unit) {
    val lang = currentLang()
    var selectedId by rememberSaveable { mutableStateOf(ExerciseCatalog.freeActivities.first().id) }
    var minutes by rememberSaveable { mutableStateOf("30") }
    val selected = ExerciseCatalog.freeActivities.first { it.id == selectedId }
    val mins = minutes.toIntOrNull() ?: 0
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.add_other_activity)) },
        text = {
            Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState())) {
                ExerciseCatalog.freeActivities.forEach { a ->
                    Row(
                        Modifier.fillMaxWidth().selectable(selected = a.id == selectedId, onClick = { selectedId = a.id }),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = a.id == selectedId, onClick = { selectedId = a.id })
                        Text(a.name.local())
                    }
                }
                Spacer(Modifier.height(8.dp))
                NumberField(minutes, { minutes = it }, stringResource(R.string.duration), "min", Modifier.fillMaxWidth())
                if (mins > 0) {
                    Text(
                        stringResource(R.string.estimated_burn, formatKcal(EnergyCalculator.activityKcal(selected.met, weightKg, mins))),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        },
        confirmButton = {
            FilledTonalButton(onClick = { onSave(selected, selected.name[lang], mins) }, enabled = mins in 1..600) {
                Text(stringResource(R.string.save))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
