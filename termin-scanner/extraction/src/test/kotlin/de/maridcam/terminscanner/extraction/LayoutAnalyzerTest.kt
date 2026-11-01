package de.maridcam.terminscanner.extraction

import org.junit.Assert.assertEquals
import org.junit.Test

class LayoutAnalyzerTest {

    @Test
    fun `Spalten auf gleicher Hoehe werden zu einer Zeile verbunden`() {
        val boxes = listOf(
            TextBox("24.11.2026", left = 400, top = 102, right = 600, bottom = 132),
            TextBox("Datum:", left = 50, top = 100, right = 200, bottom = 130),
            TextBox("Uhrzeit:", left = 50, top = 150, right = 200, bottom = 180),
            TextBox("19:00 Uhr", left = 400, top = 148, right = 600, bottom = 178),
        )

        val lines = LayoutAnalyzer.toLines(boxes).map { it.text }

        assertEquals(listOf("Datum: 24.11.2026", "Uhrzeit: 19:00 Uhr"), lines)
    }

    @Test
    fun `uebereinanderliegende Zeilen bleiben getrennt`() {
        val boxes = listOf(
            TextBox("Einladung", left = 50, top = 0, right = 600, bottom = 60),
            TextBox("Liebe Eltern,", left = 50, top = 70, right = 300, bottom = 95),
        )

        val lines = LayoutAnalyzer.toLines(boxes)

        assertEquals(listOf("Einladung", "Liebe Eltern,"), lines.map { it.text })
        assertEquals(60f, lines[0].height)
    }
}
