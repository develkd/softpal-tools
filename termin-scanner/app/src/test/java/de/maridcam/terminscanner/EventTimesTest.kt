package de.maridcam.terminscanner

import de.maridcam.terminscanner.calendar.CalendarRepository
import de.maridcam.terminscanner.extraction.Confidence
import de.maridcam.terminscanner.ui.AppointmentDraft
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime

class EventTimesTest {

    private val berlin = ZoneId.of("Europe/Berlin")

    private fun draft(start: LocalTime?, end: LocalTime?) = AppointmentDraft(
        id = 1,
        selected = true,
        title = "Elternabend",
        date = LocalDate.of(2026, 11, 24),
        startTime = start,
        endTime = end,
        location = "",
        notes = "",
        reminderMinutes = 60,
        confidence = Confidence.HIGH,
        isDeadline = false,
    )

    @Test
    fun `ganztaegige Termine beginnen und enden um Mitternacht UTC`() {
        val times = CalendarRepository.eventTimes(draft(null, null), berlin)

        assertTrue(times.allDay)
        assertEquals("UTC", times.timeZone)
        assertEquals(1_795_478_400_000L, times.startMillis) // 2026-11-24T00:00Z
        assertEquals(24 * 60 * 60 * 1000L, times.endMillis - times.startMillis)
    }

    @Test
    fun `Termin mit Uhrzeit nutzt die Zeitzone des Geraets`() {
        val times = CalendarRepository.eventTimes(draft(LocalTime.of(19, 0), LocalTime.of(20, 30)), berlin)

        val expectedStart = ZonedDateTime.of(LocalDate.of(2026, 11, 24), LocalTime.of(19, 0), berlin)
        assertEquals(expectedStart.toInstant().toEpochMilli(), times.startMillis)
        assertEquals(90 * 60 * 1000L, times.endMillis - times.startMillis)
        assertEquals("Europe/Berlin", times.timeZone)
    }

    @Test
    fun `ohne Ende dauert ein Termin eine Stunde`() {
        val times = CalendarRepository.eventTimes(draft(LocalTime.of(9, 15), null), berlin)

        assertEquals(60 * 60 * 1000L, times.endMillis - times.startMillis)
    }

    @Test
    fun `Umschalten auf ganztaegig und zurueck`() {
        val allDay = draft(LocalTime.of(9, 0), null).withAllDay(true)
        assertTrue(allDay.isAllDay)

        val timed = allDay.withAllDay(false)
        assertEquals(LocalTime.of(9, 0), timed.startTime)
        assertEquals(LocalTime.of(10, 0), timed.effectiveEndTime)
    }
}
