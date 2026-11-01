package de.maridcam.terminscanner.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import de.maridcam.terminscanner.R
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

private val DATE_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE, dd.MM.yyyy", Locale.GERMANY)
private val TIME_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.GERMANY)

fun LocalDate.formatted(): String = format(DATE_FORMAT)

fun LocalTime.formatted(): String = format(TIME_FORMAT)

/** z. B. "Di., 24.11.2026, 19:00 – 20:30 Uhr" oder "Di., 24.11.2026, ganztägig". */
@Composable
fun AppointmentDraft.whenText(): String {
    val start = startTime
    val time = if (start == null) {
        stringResource(R.string.all_day_suffix)
    } else {
        stringResource(R.string.time_range, start.formatted(), (effectiveEndTime ?: start).formatted())
    }
    return "${date.formatted()}, $time"
}

@Composable
fun reminderLabel(minutes: Int?): String = when (minutes) {
    null -> stringResource(R.string.reminder_none)
    60 -> stringResource(R.string.reminder_hour)
    24 * 60 -> stringResource(R.string.reminder_day)
    ReminderOption.DEFAULT_ALL_DAY -> stringResource(R.string.reminder_day_before_9)
    6 * 24 * 60 + 15 * 60 -> stringResource(R.string.reminder_week_before_9)
    else -> stringResource(R.string.reminder_minutes, minutes)
}
