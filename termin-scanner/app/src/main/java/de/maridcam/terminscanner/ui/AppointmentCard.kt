package de.maridcam.terminscanner.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import de.maridcam.terminscanner.R
import de.maridcam.terminscanner.extraction.Confidence
import java.time.LocalDate
import java.time.LocalTime

/** Bearbeitbare Karte für einen erkannten Termin. */
@Composable
fun AppointmentCard(
    draft: AppointmentDraft,
    onChange: (AppointmentDraft) -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val containerColor = if (draft.selected) {
        MaterialTheme.colorScheme.surfaceContainerLow
    } else {
        MaterialTheme.colorScheme.surfaceContainerLowest
    }

    Card(modifier = modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = containerColor)) {
        Column(Modifier.padding(start = 8.dp, end = 8.dp, bottom = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = draft.selected, onCheckedChange = { onChange(draft.copy(selected = it)) })
                ConfidenceChip(draft.confidence, draft.isDeadline)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onRemove) {
                    Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.draft_remove))
                }
            }

            Column(Modifier.padding(horizontal = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = draft.title,
                    onValueChange = { onChange(draft.copy(title = it)) },
                    label = { Text(stringResource(R.string.draft_title)) },
                    isError = draft.selected && draft.title.isBlank(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                OutlinedButton(
                    onClick = {
                        DatePickerDialog(
                            context,
                            { _, year, month, day -> onChange(draft.copy(date = LocalDate.of(year, month + 1, day))) },
                            draft.date.year,
                            draft.date.monthValue - 1,
                            draft.date.dayOfMonth,
                        ).show()
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.DateRange, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(draft.date.formatted())
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.draft_all_day), Modifier.weight(1f))
                    Switch(checked = draft.isAllDay, onCheckedChange = { onChange(draft.withAllDay(it)) })
                }

                val start = draft.startTime
                if (start != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = {
                                showTimePicker(context, start) { picked ->
                                    // Dauer beibehalten, wenn der Beginn verschoben wird
                                    val duration = java.time.Duration.between(start, draft.effectiveEndTime ?: start)
                                    val newEnd = picked.plus(duration).takeIf { it.isAfter(picked) }
                                    onChange(draft.copy(startTime = picked, endTime = newEnd))
                                }
                            },
                            modifier = Modifier.weight(1f),
                        ) { Text(stringResource(R.string.draft_start, start.formatted())) }

                        OutlinedButton(
                            onClick = {
                                showTimePicker(context, draft.effectiveEndTime ?: start) { picked ->
                                    onChange(draft.copy(endTime = picked))
                                }
                            },
                            modifier = Modifier.weight(1f),
                        ) { Text(stringResource(R.string.draft_end, (draft.effectiveEndTime ?: start).formatted())) }
                    }
                }

                OutlinedTextField(
                    value = draft.location,
                    onValueChange = { onChange(draft.copy(location = it)) },
                    label = { Text(stringResource(R.string.draft_location)) },
                    leadingIcon = { Icon(Icons.Default.LocationOn, contentDescription = null) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                ReminderSelector(draft, onChange)

                OutlinedTextField(
                    value = draft.notes,
                    onValueChange = { onChange(draft.copy(notes = it)) },
                    label = { Text(stringResource(R.string.draft_notes)) },
                    minLines = 2,
                    maxLines = 5,
                    textStyle = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun ConfidenceChip(confidence: Confidence, isDeadline: Boolean) {
    val label = when (confidence) {
        Confidence.HIGH -> stringResource(R.string.confidence_high)
        Confidence.MEDIUM -> stringResource(R.string.confidence_medium)
        Confidence.LOW -> stringResource(R.string.confidence_low)
    }
    val color = when (confidence) {
        Confidence.HIGH -> MaterialTheme.colorScheme.primary
        Confidence.MEDIUM -> MaterialTheme.colorScheme.secondary
        Confidence.LOW -> MaterialTheme.colorScheme.error
    }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        AssistChip(
            onClick = {},
            label = { Text(label, fontWeight = FontWeight.Medium) },
            colors = AssistChipDefaults.assistChipColors(labelColor = color),
        )
        if (isDeadline) {
            AssistChip(onClick = {}, label = { Text(stringResource(R.string.draft_deadline)) })
        }
    }
}

@Composable
private fun ReminderSelector(draft: AppointmentDraft, onChange: (AppointmentDraft) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val options = if (draft.isAllDay) ReminderOption.ALL_DAY else ReminderOption.TIMED
    Box {
        TextButton(onClick = { expanded = true }) {
            Icon(Icons.Default.Notifications, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(reminderLabel(draft.reminderMinutes))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { minutes ->
                DropdownMenuItem(
                    text = { Text(reminderLabel(minutes)) },
                    onClick = {
                        onChange(draft.copy(reminderMinutes = minutes))
                        expanded = false
                    },
                )
            }
        }
    }
}

private fun showTimePicker(context: android.content.Context, initial: LocalTime, onPicked: (LocalTime) -> Unit) {
    TimePickerDialog(
        context,
        { _, hour, minute -> onPicked(LocalTime.of(hour, minute)) },
        initial.hour,
        initial.minute,
        true,
    ).show()
}
