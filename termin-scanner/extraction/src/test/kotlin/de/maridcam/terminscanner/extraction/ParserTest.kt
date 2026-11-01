package de.maridcam.terminscanner.extraction

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

class ParserTest {

    private val today = LocalDate.of(2026, 11, 1)

    private fun date(text: String) = DateParser.findDates(text, today).map { it.date }

    private fun times(text: String) = TimeParser.findTimes(text).map { it.start to it.end }

    @Test
    fun `numerische Datumsformate`() {
        assertEquals(listOf(LocalDate.of(2026, 11, 12)), date("12.11.2026"))
        assertEquals(listOf(LocalDate.of(2026, 11, 12)), date("12.11.26"))
        assertEquals(listOf(LocalDate.of(2026, 11, 12)), date("12. 11. 2026"))
        assertEquals(listOf(LocalDate.of(2026, 11, 12)), date("2026-11-12"))
        assertEquals(listOf(LocalDate.of(2026, 11, 12)), date("12/11/2026"))
        assertEquals(listOf(LocalDate.of(2026, 11, 25)), date("11/25/2026"))
        assertEquals(listOf(LocalDate.of(2026, 11, 12)), date("am 12.11. um 10 Uhr"))
    }

    @Test
    fun `ausgeschriebene Monatsnamen`() {
        assertEquals(listOf(LocalDate.of(2026, 3, 5)), date("5. März 2026"))
        assertEquals(listOf(LocalDate.of(2027, 3, 5)), date("5. Maerz"))
        assertEquals(listOf(LocalDate.of(2026, 12, 1)), date("1. Dez. 2026"))
        assertEquals(listOf(LocalDate.of(2026, 11, 20)), date("November 20th, 2026"))
        assertEquals(listOf(LocalDate.of(2026, 11, 20)), date("20th of November 2026"))
        assertTrue(date("Mainz 12").isEmpty())
    }

    @Test
    fun `ungueltige Daten werden verworfen`() {
        assertTrue(date("31.02.2026").isEmpty())
        assertTrue(date("Version 1.2.3").isEmpty())
        assertTrue(date("10.30 Uhr").isEmpty())
    }

    @Test
    fun `Uhrzeiten und Zeitraeume`() {
        assertEquals(listOf(LocalTime.of(14, 30) to null), times("14:30"))
        assertEquals(listOf(LocalTime.of(14, 30) to null), times("14.30 Uhr"))
        assertEquals(listOf(LocalTime.of(9, 0) to null), times("9 Uhr"))
        assertEquals(listOf(LocalTime.of(9, 0) to null), times("um 9"))
        assertEquals(listOf(LocalTime.of(14, 0) to null), times("2 pm"))
        assertEquals(listOf(LocalTime.of(10, 0) to LocalTime.of(11, 30)), times("10:00 - 11:30 Uhr"))
        assertEquals(listOf(LocalTime.of(10, 0) to LocalTime.of(12, 0)), times("von 10 bis 12 Uhr"))
        assertEquals(listOf(LocalTime.of(13, 0) to LocalTime.of(15, 0)), times("1 - 3 pm"))
        assertEquals(listOf(LocalTime.of(11, 0) to LocalTime.of(13, 0)), times("11 - 1 pm"))
    }

    @Test
    fun `Zahlen ohne Zeitbezug sind keine Uhrzeit`() {
        assertTrue(times("Zimmer 12").isEmpty())
        assertTrue(times("Preis 12,50 EUR").isEmpty())
        assertTrue(times("Tel. 0221 123456").isEmpty())
        assertTrue(times("Seite 3 von 4").isEmpty())
    }

    @Test
    fun `Titelbereinigung entfernt Datum, Wochentag und Fuellwoerter`() {
        val line = "Elternabend am Dienstag, 12.11.2026 um 19 Uhr"
        val dates = DateParser.findDates(line, today)
        val masked = TimeParser.mask(line, dates.map { it.range })
        val ranges = dates.map { it.range } + TimeParser.findTimes(masked).map { it.range }

        assertEquals("Elternabend", AppointmentExtractor.cleanTitle(line, ranges))
    }
}
