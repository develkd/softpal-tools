package de.maridcam.terminscanner.extraction

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

class AppointmentExtractorTest {

    private val today = LocalDate.of(2026, 11, 1)

    private fun extract(text: String) = AppointmentExtractor.extract(text.trimIndent(), today)

    private fun recommended(text: String) = extract(text).filter { it.recommended }

    @Test
    fun `Arzttermin mit Briefdatum - nur der Termin wird vorgeschlagen`() {
        val result = recommended(
            """
            Praxis Dr. med. Anna Schmidt
            Hauptstraße 5
            50667 Köln
            Köln, 28.10.2026
            Terminbestätigung
            Sehr geehrte Frau Yilmaz,
            hiermit bestätigen wir Ihren Termin:
            Montag, 16.11.2026 um 09:15 Uhr
            Bitte bringen Sie Ihre Versichertenkarte mit.
            """,
        )

        assertEquals(1, result.size)
        val termin = result.single()
        assertEquals(LocalDate.of(2026, 11, 16), termin.date)
        assertEquals(LocalTime.of(9, 15), termin.startTime)
        assertEquals("Termin: Praxis Dr. med. Anna Schmidt", termin.title)
    }

    @Test
    fun `Einladung mit Betreff, Uhrzeit-Zeile und Ort-Label`() {
        val result = recommended(
            """
            Grundschule am Park
            Betreff: Einladung zum Elternabend der Klasse 3b
            Liebe Eltern,
            wir laden Sie herzlich ein.
            Datum: 24.11.2026
            Uhrzeit: 19:00 - 20:30 Uhr
            Ort: Aula, Parkweg 3
            """,
        )

        val termin = result.single()
        assertEquals("Einladung zum Elternabend der Klasse 3b", termin.title)
        assertEquals(LocalDate.of(2026, 11, 24), termin.date)
        assertEquals(LocalTime.of(19, 0), termin.startTime)
        assertEquals(LocalTime.of(20, 30), termin.endTime)
        assertEquals("Aula, Parkweg 3", termin.location)
        assertEquals(Confidence.HIGH, termin.confidence)
    }

    @Test
    fun `Titel und Ort aus derselben Zeile`() {
        val termin = recommended("Elternabend am Dienstag, 12.11.2026 um 19 Uhr im Gemeindehaus.").single()

        assertEquals("Elternabend", termin.title)
        assertEquals(LocalDate.of(2026, 11, 12), termin.date)
        assertEquals(LocalTime.of(19, 0), termin.startTime)
        assertEquals("Gemeindehaus", termin.location)
    }

    @Test
    fun `ausgeschriebenes deutsches Datum mit Beginn und Ende`() {
        val termin = recommended(
            """
            Mitgliederversammlung
            Die Versammlung findet am 5. Dezember 2026 statt.
            Beginn: 18.30 Uhr
            Ende: 21 Uhr
            """,
        ).single()

        assertEquals(LocalDate.of(2026, 12, 5), termin.date)
        assertEquals(LocalTime.of(18, 30), termin.startTime)
        assertEquals(LocalTime.of(21, 0), termin.endTime)
        assertEquals("Mitgliederversammlung", termin.title)
    }

    @Test
    fun `Frist ohne Uhrzeit wird als ganztaegige Frist erkannt`() {
        val result = recommended(
            """
            Stadtverwaltung Musterstadt
            Bitte reichen Sie die Unterlagen bis zum 15.12.2026 ein.
            """,
        )

        val frist = result.single()
        assertTrue(frist.isDeadline)
        assertTrue(frist.isAllDay)
        assertEquals(LocalDate.of(2026, 12, 15), frist.date)
        assertTrue(frist.title.startsWith("Frist"))
    }

    @Test
    fun `englisches Meeting mit am pm`() {
        val termin = recommended("Team meeting on November 20, 2026 from 2:30 pm to 4 pm in Room 4").single()

        assertEquals(LocalDate.of(2026, 11, 20), termin.date)
        assertEquals(LocalTime.of(14, 30), termin.startTime)
        assertEquals(LocalTime.of(16, 0), termin.endTime)
        assertEquals("Room 4", termin.location)
        assertEquals("Team meeting", termin.title)
    }

    @Test
    fun `Datum ohne Jahr wird in die Zukunft gelegt`() {
        val result = recommended(
            """
            Sprechstunde am 10.01. um 8:30 Uhr
            Sprechstunde am 15.11. um 10:00 Uhr
            """,
        )

        assertEquals(2, result.size)
        assertEquals(LocalDate.of(2026, 11, 15), result[0].date)
        assertEquals(LocalDate.of(2027, 1, 10), result[1].date)
        assertEquals("Sprechstunde", result[0].title)
    }

    @Test
    fun `Geburtsdatum, Rechnungsdatum und vergangene Daten werden ignoriert`() {
        val result = extract(
            """
            Rechnungsdatum: 03.11.2026
            Geburtsdatum: 14.02.1985
            Ihr Schreiben vom 20.10.2026
            """,
        )

        assertTrue(result.none { it.recommended })
        assertTrue(result.none { it.date.year == 1985 })
    }

    @Test
    fun `Dokument ohne Termin liefert nichts`() {
        assertTrue(extract("Vielen Dank für Ihren Einkauf.\nSumme 12,50 EUR").isEmpty())
    }

    @Test
    fun `mehrere Termine in einem Dokument`() {
        val result = recommended(
            """
            Kursplan Erste Hilfe
            1. Termin: 03.12.2026, 18:00 - 20:00 Uhr
            2. Termin: 10.12.2026, 18:00 - 20:00 Uhr
            """,
        )

        assertEquals(listOf(LocalDate.of(2026, 12, 3), LocalDate.of(2026, 12, 10)), result.map { it.date })
        assertTrue(result.all { it.startTime == LocalTime.of(18, 0) && it.endTime == LocalTime.of(20, 0) })
    }

    @Test
    fun `gleiches Datum mehrfach wird zusammengefasst`() {
        val result = recommended(
            """
            Termin: 18.11.2026
            Wir erwarten Sie am 18.11.2026 um 14:00 Uhr.
            """,
        )

        val termin = result.single()
        assertEquals(LocalTime.of(14, 0), termin.startTime)
    }

    @Test
    fun `OCR-Fehler O statt 0 werden korrigiert`() {
        val termin = recommended("Termin am 2O.11.2O26 um 1O:3O Uhr").single()

        assertEquals(LocalDate.of(2026, 11, 20), termin.date)
        assertEquals(LocalTime.of(10, 30), termin.startTime)
    }

    @Test
    fun `Zeilenhoehe liefert Ueberschrift als Titel`() {
        val lines = listOf(
            DocumentLine("Tag der offenen Moschee", 60f),
            DocumentLine("Wir freuen uns auf Ihren Besuch", 20f),
            DocumentLine("am 03.10.2027", 20f),
            DocumentLine("ab 11 Uhr", 20f),
        )

        val termin = AppointmentExtractor.extract(lines, today).single()
        assertEquals("Tag der offenen Moschee", termin.title)
        assertEquals(LocalTime.of(11, 0), termin.startTime)
        assertNull(termin.endTime)
    }

    @Test
    fun `Preis und Telefonnummer werden nicht als Uhrzeit erkannt`() {
        val termin = extract("Vorsorge am 20.11.2026, Kosten 12,50 EUR, Tel. 0221 123456").single()

        assertNull(termin.startTime)
        assertTrue(termin.isAllDay)
    }

    @Test
    fun `Fliesstext-Einladung mit Zeitraum und Ort im Satz`() {
        val termin = recommended(
            """
            Einladung zum Basar
            Unser Basar findet am Samstag, den 14. November 2026 von 10 bis 14 Uhr im Gemeindezentrum statt.
            """,
        ).single()

        assertEquals("Einladung zum Basar", termin.title)
        assertEquals(LocalDate.of(2026, 11, 14), termin.date)
        assertEquals(LocalTime.of(10, 0), termin.startTime)
        assertEquals(LocalTime.of(14, 0), termin.endTime)
        assertEquals("Gemeindezentrum", termin.location)
    }

    @Test
    fun `Formular-Layout mit Werten in der naechsten Zeile`() {
        val termin = recommended(
            """
            Zahnarztpraxis Lächeln
            Ihr nächster Termin
            Do., 03.12.2026
            10:45 Uhr
            """,
        ).single()

        assertEquals("Termin: Zahnarztpraxis Lächeln", termin.title)
        assertEquals(LocalTime.of(10, 45), termin.startTime)
    }
}
