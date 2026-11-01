package de.maridcam.terminscanner.ui

import de.maridcam.terminscanner.extraction.AppointmentCandidate
import de.maridcam.terminscanner.extraction.Confidence
import java.time.LocalDate
import java.time.LocalTime

/** Ein Termin, wie ihn der Nutzer vor dem Eintragen prüfen und bearbeiten kann. */
data class AppointmentDraft(
    val id: Long,
    val selected: Boolean,
    val title: String,
    val date: LocalDate,
    val startTime: LocalTime?,
    val endTime: LocalTime?,
    val location: String,
    val notes: String,
    /** Minuten vor Beginn; bei ganztägigen Terminen relativ zu 0:00 Uhr des Tages. `null` = keine Erinnerung. */
    val reminderMinutes: Int?,
    val confidence: Confidence,
    val isDeadline: Boolean,
) {
    val isAllDay: Boolean get() = startTime == null

    /** Ende für den Kalender: angegebenes Ende oder eine Stunde nach Beginn. */
    val effectiveEndTime: LocalTime?
        get() {
            val start = startTime ?: return null
            val end = endTime
            return if (end != null && end.isAfter(start)) end else start.plusHours(1).takeIf { it.isAfter(start) } ?: LocalTime.of(23, 59)
        }

    fun withAllDay(allDay: Boolean): AppointmentDraft = when {
        allDay -> copy(startTime = null, endTime = null, reminderMinutes = reminderMinutes?.let { ReminderOption.DEFAULT_ALL_DAY })
        isAllDay -> copy(startTime = LocalTime.of(9, 0), endTime = LocalTime.of(10, 0), reminderMinutes = reminderMinutes?.let { ReminderOption.DEFAULT_TIMED })
        else -> this
    }

    companion object {
        fun from(candidate: AppointmentCandidate, id: Long) = AppointmentDraft(
            id = id,
            selected = candidate.recommended,
            title = candidate.title,
            date = candidate.date,
            startTime = candidate.startTime,
            endTime = candidate.endTime,
            location = candidate.location.orEmpty(),
            notes = candidate.sourceText,
            reminderMinutes = if (candidate.isAllDay) ReminderOption.DEFAULT_ALL_DAY else ReminderOption.DEFAULT_TIMED,
            confidence = candidate.confidence,
            isDeadline = candidate.isDeadline,
        )

        fun empty(id: Long) = AppointmentDraft(
            id = id,
            selected = true,
            title = "",
            date = LocalDate.now().plusDays(1),
            startTime = LocalTime.of(9, 0),
            endTime = LocalTime.of(10, 0),
            location = "",
            notes = "",
            reminderMinutes = ReminderOption.DEFAULT_TIMED,
            confidence = Confidence.HIGH,
            isDeadline = false,
        )
    }
}

/** Erinnerungs-Auswahl; ganztägige Termine erinnern zu einer Uhrzeit am Vortag. */
object ReminderOption {
    const val DEFAULT_TIMED = 60
    const val DEFAULT_ALL_DAY = 15 * 60 // Vortag, 9:00 Uhr

    val TIMED: List<Int?> = listOf(null, 15, 60, 24 * 60)
    val ALL_DAY: List<Int?> = listOf(null, 15 * 60, 6 * 24 * 60 + 15 * 60)
}
