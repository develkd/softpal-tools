package de.maridcam.terminscanner.extraction

import java.time.LocalDate
import java.time.LocalTime

/**
 * Eine Textzeile aus der Texterkennung (OCR).
 *
 * @param text erkannter Text der Zeile
 * @param height optionale Höhe der Zeile in Pixeln; größere Zeilen sind meist Überschriften
 */
data class DocumentLine(val text: String, val height: Float? = null)

/** Wie sicher die Erkennung ist, dass es sich wirklich um einen Termin handelt. */
enum class Confidence { HIGH, MEDIUM, LOW }

/**
 * Ein im Dokument gefundener möglicher Termin.
 *
 * Ein Termin ohne [startTime] ist ganztägig.
 */
data class AppointmentCandidate(
    val title: String,
    val date: LocalDate,
    val startTime: LocalTime?,
    val endTime: LocalTime?,
    val location: String?,
    /** Die Textstelle im Dokument, aus der der Termin erkannt wurde. */
    val sourceText: String,
    /** `true`, wenn es sich um eine Frist ("bis zum …") statt um einen Termin handelt. */
    val isDeadline: Boolean,
    val confidence: Confidence,
    /** `true`, wenn die App diesen Termin zum Eintragen vorschlagen (vorauswählen) soll. */
    val recommended: Boolean,
) {
    val isAllDay: Boolean get() = startTime == null
}
