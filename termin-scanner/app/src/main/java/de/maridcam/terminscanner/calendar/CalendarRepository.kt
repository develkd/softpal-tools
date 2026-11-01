package de.maridcam.terminscanner.calendar

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.CalendarContract
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Reminders
import androidx.core.content.ContextCompat
import de.maridcam.terminscanner.ui.AppointmentDraft
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime

/** Ein beschreibbarer Kalender auf dem Gerät (z. B. das Google-Konto). */
data class DeviceCalendar(
    val id: Long,
    val displayName: String,
    val accountName: String,
    val accountType: String,
    val isPrimary: Boolean,
    val color: Int,
) {
    val isGoogle: Boolean get() = accountType == GOOGLE_ACCOUNT_TYPE

    companion object {
        const val GOOGLE_ACCOUNT_TYPE = "com.google"
    }
}

/** Start/Ende eines Termins in Millisekunden, wie sie der Kalender-Provider erwartet. */
data class EventTimes(val startMillis: Long, val endMillis: Long, val timeZone: String, val allDay: Boolean)

/**
 * Zugriff auf den Android-Kalender (CalendarContract).
 *
 * Termine, die in einen Google-Kalender eingetragen werden, synchronisiert Android
 * automatisch mit dem Google Kalender im Web und auf anderen Geräten.
 */
class CalendarRepository(private val context: Context) {

    fun hasPermission(): Boolean = PERMISSIONS.all {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }

    /** Alle Kalender, in die geschrieben werden darf – Google-Kalender und Hauptkalender zuerst. */
    fun writableCalendars(): List<DeviceCalendar> {
        if (!hasPermission()) return emptyList()
        val projection = arrayOf(
            Calendars._ID,
            Calendars.CALENDAR_DISPLAY_NAME,
            Calendars.ACCOUNT_NAME,
            Calendars.ACCOUNT_TYPE,
            Calendars.IS_PRIMARY,
            Calendars.CALENDAR_COLOR,
        )
        val selection = "${Calendars.CALENDAR_ACCESS_LEVEL} >= ? AND ${Calendars.VISIBLE} = 1"
        val args = arrayOf(Calendars.CAL_ACCESS_CONTRIBUTOR.toString())

        val calendars = mutableListOf<DeviceCalendar>()
        context.contentResolver.query(Calendars.CONTENT_URI, projection, selection, args, null)?.use { c ->
            while (c.moveToNext()) {
                calendars += DeviceCalendar(
                    id = c.getLong(0),
                    displayName = c.getString(1).orEmpty(),
                    accountName = c.getString(2).orEmpty(),
                    accountType = c.getString(3).orEmpty(),
                    isPrimary = !c.isNull(4) && c.getInt(4) == 1,
                    color = c.getInt(5),
                )
            }
        }
        return calendars.sortedWith(
            compareByDescending<DeviceCalendar> { it.isGoogle }
                .thenByDescending { it.isPrimary }
                .thenBy { it.displayName.lowercase() },
        )
    }

    /** Prüft, ob es im Kalender bereits einen Termin mit gleichem Titel und Beginn gibt. */
    fun alreadyExists(calendarId: Long, draft: AppointmentDraft): Boolean {
        val times = eventTimes(draft)
        val selection = "${Events.CALENDAR_ID} = ? AND ${Events.DTSTART} = ? AND ${Events.TITLE} = ? AND ${Events.DELETED} = 0"
        val args = arrayOf(calendarId.toString(), times.startMillis.toString(), draft.title.trim())
        return context.contentResolver.query(Events.CONTENT_URI, arrayOf(Events._ID), selection, args, null)
            ?.use { it.count > 0 } ?: false
    }

    /** Trägt den Termin ein und gibt die ID des neuen Kalendereintrags zurück. */
    fun insert(calendarId: Long, draft: AppointmentDraft): Long {
        val times = eventTimes(draft)
        val values = ContentValues().apply {
            put(Events.CALENDAR_ID, calendarId)
            put(Events.TITLE, draft.title.trim())
            put(Events.DTSTART, times.startMillis)
            put(Events.DTEND, times.endMillis)
            put(Events.EVENT_TIMEZONE, times.timeZone)
            put(Events.ALL_DAY, if (times.allDay) 1 else 0)
            if (draft.location.isNotBlank()) put(Events.EVENT_LOCATION, draft.location.trim())
            put(Events.DESCRIPTION, description(draft))
            put(Events.HAS_ALARM, if (draft.reminderMinutes != null) 1 else 0)
        }
        val uri = context.contentResolver.insert(Events.CONTENT_URI, values)
            ?: error("Der Kalender hat den Termin nicht angenommen.")
        val eventId = ContentUris.parseId(uri)

        draft.reminderMinutes?.let { minutes ->
            val reminder = ContentValues().apply {
                put(Reminders.EVENT_ID, eventId)
                put(Reminders.MINUTES, minutes)
                put(Reminders.METHOD, Reminders.METHOD_ALERT)
            }
            context.contentResolver.insert(Reminders.CONTENT_URI, reminder)
        }
        return eventId
    }

    /** Öffnet einen eingetragenen Termin in der Kalender-App. */
    fun viewEventIntent(eventId: Long): Intent =
        Intent(Intent.ACTION_VIEW, ContentUris.withAppendedId(Events.CONTENT_URI, eventId))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /**
     * Ersatzweg ohne Kalender-Berechtigung: öffnet die Kalender-App mit vorausgefülltem Termin,
     * dort bestätigt der Nutzer selbst mit "Speichern".
     */
    fun insertViaCalendarAppIntent(draft: AppointmentDraft): Intent {
        val times = eventTimes(draft)
        return Intent(Intent.ACTION_INSERT)
            .setData(Events.CONTENT_URI)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, times.startMillis)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, times.endMillis)
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, times.allDay)
            .putExtra(Events.TITLE, draft.title.trim())
            .putExtra(Events.EVENT_LOCATION, draft.location.trim())
            .putExtra(Events.DESCRIPTION, description(draft))
    }

    private fun description(draft: AppointmentDraft): String =
        buildString {
            if (draft.notes.isNotBlank()) {
                append(draft.notes.trim())
                append("\n\n")
            }
            append("Automatisch aus einem Dokument erkannt (Termin-Scanner).")
        }

    companion object {
        val PERMISSIONS = arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)

        /**
         * Ganztägige Termine müssen laut CalendarContract in UTC um 0:00 Uhr beginnen und enden.
         * Andere Termine werden in der Zeitzone des Geräts angelegt.
         */
        fun eventTimes(draft: AppointmentDraft, zone: ZoneId = ZoneId.systemDefault()): EventTimes {
            val start = draft.startTime
            return if (start == null) {
                EventTimes(
                    startMillis = draft.date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
                    endMillis = draft.date.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
                    timeZone = "UTC",
                    allDay = true,
                )
            } else {
                val end = draft.effectiveEndTime ?: start.plusHours(1)
                EventTimes(
                    startMillis = ZonedDateTime.of(draft.date, start, zone).toInstant().toEpochMilli(),
                    endMillis = ZonedDateTime.of(draft.date, end, zone).toInstant().toEpochMilli(),
                    timeZone = zone.id,
                    allDay = false,
                )
            }
        }
    }
}

