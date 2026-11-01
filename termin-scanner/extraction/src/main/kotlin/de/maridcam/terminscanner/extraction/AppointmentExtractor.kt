package de.maridcam.terminscanner.extraction

import java.time.LocalDate
import java.time.LocalTime

/**
 * Erkennt Termine und Fristen in Dokumenttext (z. B. aus einem Foto per OCR).
 *
 * Die Erkennung arbeitet regelbasiert und vollständig offline:
 * 1. Datumsangaben in jeder Zeile finden.
 * 2. Zugehörige Uhrzeit(en) in derselben Zeile oder den Nachbarzeilen suchen.
 * 3. Titel (Betreff, Zeilentext, Überschrift, Absender) und Ort ("Ort:", "im …") ableiten.
 * 4. Jeden Fund bewerten, damit z. B. Briefdatum oder Geburtsdatum nicht als Termin vorgeschlagen werden.
 */
object AppointmentExtractor {

    private const val MARKER = '\u0000'

    private val HARD_EXCLUDE = Regex(
        """(?:geburtsdatum|geb\.|geboren|date of birth|birthday|dob)[^\d]{0,15}$""",
        RegexOption.IGNORE_CASE,
    )

    private val PENALTY_BEFORE = Regex(
        """(?:rechnungsdatum|rechnung vom|belegdatum|ausstellungsdatum|ausgestellt|druckdatum|erstellt am|stand|""" +
            """vom|lieferdatum|bestelldatum|leistungsdatum|invoice date|issued|order date|gültig ab|gültig bis|""" +
            """valid until|kundennummer|eingegangen am|eingang)[\s:]{0,15}$""",
        RegexOption.IGNORE_CASE,
    )

    private val LETTER_DATE_BEFORE = Regex("""^\s*\p{L}[\p{L} .\-]{1,40},\s*(?:den\s+)?$""", RegexOption.IGNORE_CASE)

    private val DATE_INTRO = Regex(
        """(?:\bam|\bon|\bdatum|\btermin|\bwann|\bdate|\bwhen|\bfindet|montag|dienstag|mittwoch|donnerstag|freitag|""" +
            """samstag|sonnabend|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)[\s,.:]*(?:den\s*)?$""",
        RegexOption.IGNORE_CASE,
    )

    private val DEADLINE_BEFORE = Regex(
        """(?:frist|spätestens|spaetestens|bis zum|bis zur|bis spätestens|fällig|faellig|zahlbar bis|abgabe|""" +
            """einsendeschluss|anmeldeschluss|bewerbungsschluss|meldeschluss|deadline|due|no later than|""" +
            """submit by)[^\d]{0,25}$""",
        RegexOption.IGNORE_CASE,
    )

    private val POSITIVE = Regex(
        """termin|einladung|eingeladen|laden sie|sprechstunde|untersuchung|behandlung|besprechung|sitzung|""" +
            """versammlung|veranstaltung|treffen|elternabend|elternsprechtag|gespräch|prüfung|kurs|seminar|""" +
            """workshop|feier|\bfest\b|vortrag|konferenz|beginn|findet|statt|wann|vorstellung|anhörung|""" +
            """verhandlung|impfung|abholung|übergabe|besichtigung|appointment|meeting|invitation|invite|""" +
            """scheduled|interview|event|conference|frist|fällig|spätestens|deadline|due""",
        RegexOption.IGNORE_CASE,
    )

    private val END_LABEL = Regex("""(?:ende|end|bis|until|schluss)\s*:?\s*$""", RegexOption.IGNORE_CASE)

    private val LOCATION_LABEL = Regex(
        """^\s*(?:ort|veranstaltungsort|treffpunkt|adresse|anschrift|raum|location|place|venue|where|wo)\s*\??\s*:\s*(.*)$""",
        RegexOption.IGNORE_CASE,
    )

    private val INLINE_LOCATION = Regex("""(?:^|\s)(?:in der|in dem|im|in|In der|Im|In|at the|at)\s+(\p{Lu}[^,;:()!?]{2,60})""")

    private val NOT_A_PLACE = setOf(
        "höhe", "kraft", "ordnung", "form", "zukunft", "rechnung", "absprache", "abstimmung", "ruhe", "bezug",
        "verbindung", "anspruch", "person", "textform", "schriftform", "anlage", "summe", "zeit", "ihrem", "ihrer",
    )

    private val SUBJECT_LABEL = Regex(
        """^\s*(?:betreff|betr\.?|subject|re|thema|anlass|veranstaltung|event)\s*:\s*(.+)$""",
        RegexOption.IGNORE_CASE,
    )

    private val INVITATION_LINE = Regex("""^\s*(?:einladung|invitation)\b.{3,}""", RegexOption.IGNORE_CASE)

    private val ORGANIZATION = Regex(
        """praxis|\bdr\.|klinik|krankenhaus|zahnarzt|ärzt|arztpraxis|schule|gymnasium|kita\b|kindergarten|\bamt\b|""" +
            """behörde|stadtverwaltung|gemeinde|verein|gmbh|\bag\b|e\.\s?v\.|universität|hochschule|moschee|bank|""" +
            """versicherung|kanzlei|jobcenter|agentur|bürgeramt|finanzamt|landratsamt|gericht|hospital|clinic|school""",
        RegexOption.IGNORE_CASE,
    )

    private val LABEL_PREFIX = Regex(
        """^\s*(?:datum|uhrzeit|zeit|wann|termin|date|time|when|betreff|betr\.?|subject|thema|beginn|start)\s*:\s*""",
        RegexOption.IGNORE_CASE,
    )

    private val WEEKDAYS = Regex(
        """(?<!\p{L})(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag|monday|tuesday|""" +
            """wednesday|thursday|friday|saturday|sunday|(?:mo|di|mi|do|fr|sa|so|mon|tue|wed|thu|fri|sat|sun)\.)(?!\p{L}),?""",
        RegexOption.IGNORE_CASE,
    )

    private val FILLER_BEFORE_MARKER = Regex(
        """(?<!\p{L})(?:am|um|den|ab|von|bis|bis zum|gegen|zwischen|on|at|from|to|until|und|and|by|vom|zum|""" +
            """frist|spätestens)[\s,:]*$MARKER""",
        RegexOption.IGNORE_CASE,
    )

    private val FILLER_AFTER_MARKER = Regex("""$MARKER[\s,]*(?:uhr|h|bis|to|und|and|-|–|—)(?!\p{L})""", RegexOption.IGNORE_CASE)

    private val MARKER_SEQUENCE = Regex("""$MARKER(?:[\s,.\-–—]*$MARKER)+""")

    private val GENERIC_WORDS = setOf(
        "ihr", "ihre", "ihren", "ihrem", "nächster", "nächste", "nächsten", "naechster", "neuer", "neue", "neuen",
        "termin", "termine", "terminbestätigung", "terminvereinbarung", "terminerinnerung", "datum", "uhrzeit",
        "zeit", "wann", "am", "um", "den", "beginn", "ende", "date", "time", "when", "your", "next", "appointment",
        "is", "on", "at", "ist", "wir", "sie", "bitte", "the", "der", "die", "das", "vom", "bis", "zum", "zur",
        "folgender", "folgenden", "geplant", "findet", "statt", "verschoben", "auf", "new", "scheduled", "for",
        "von", "frist", "spätestens", "uhr", "tag", "und", "and", "stand", "start", "ab", "a", "an", "of",
        "reminder", "erinnerung", "bestätigung", "confirmation", "nochmals", "noch", "einmal", "hiermit",
    )

    private val SENTENCE_WORDS = setOf(
        "findet", "statt", "wir", "sie", "bitte", "laden", "ist", "sind", "wird", "werden", "möchten", "freuen",
        "erwarten", "bestätigen", "erinnern", "haben", "können", "we", "you", "please", "will", "is", "are",
    )

    private val TRIM_CHARS = charArrayOf(' ', ',', ';', ':', '-', '–', '—', '|', '.', '/', '(', ')')

    private data class Scored(val candidate: AppointmentCandidate, val score: Int)

    /** Komfort-Variante für reinen Text, Zeilen durch Zeilenumbrüche getrennt. */
    fun extract(text: String, today: LocalDate = LocalDate.now()): List<AppointmentCandidate> =
        extract(text.lines().map { DocumentLine(it) }, today)

    fun extract(lines: List<DocumentLine>, today: LocalDate = LocalDate.now()): List<AppointmentCandidate> {
        val doc = lines.map { it.copy(text = TextNormalizer.normalize(it.text)) }.filter { it.text.isNotBlank() }
        val texts = doc.map { it.text }
        val dates = texts.map { DateParser.findDates(it, today) }

        val subject = findSubject(texts, dates)
        val heading = findHeading(doc, dates)
        val organization = findOrganization(texts, dates)

        val found = mutableListOf<Scored>()
        for (i in texts.indices) {
            val line = texts[i]
            val lineDates = dates[i]
            if (lineDates.isEmpty()) continue
            val masked = TimeParser.mask(line, lineDates.map { it.range })
            val lineTimes = TimeParser.findTimes(masked)

            lineDates.forEachIndexed { index, date ->
                val before = line.substring(0, date.range.first)
                if (HARD_EXCLUDE.containsMatchIn(before.takeLast(40))) return@forEachIndexed

                // --- Uhrzeit(en) ---------------------------------------------------------------
                val segmentEnd = lineDates.getOrNull(index + 1)?.range?.first ?: line.length
                var times = lineTimes.filter { it.range.first > date.range.last && it.range.first < segmentEnd }
                if (times.isEmpty() && lineDates.size == 1) times = lineTimes

                var start: LocalTime? = null
                var end: LocalTime? = null
                fun consume(found: List<TimeMatch>, text: String) {
                    for (t in found) {
                        val isEnd = END_LABEL.containsMatchIn(text.substring(0, t.range.first).takeLast(12))
                        val currentStart = start
                        if (currentStart == null && !isEnd) {
                            start = t.start
                            end = t.end
                        } else if (currentStart != null && end == null && isEnd && t.start.isAfter(currentStart)) {
                            end = t.start
                        }
                    }
                }
                consume(times, masked)
                for (j in i + 1..minOf(i + 2, texts.lastIndex)) {
                    if (dates[j].isNotEmpty() || (start != null && end != null)) break
                    consume(TimeParser.findTimes(texts[j]), texts[j])
                }
                if (start == null && i > 0 && dates[i - 1].isEmpty()) {
                    consume(TimeParser.findTimes(texts[i - 1]), texts[i - 1])
                }

                // --- Bewertung ------------------------------------------------------------------
                val isDeadline = start == null && DEADLINE_BEFORE.containsMatchIn(before.takeLast(45))
                val rest = masked.substring(date.range.last + 1, segmentEnd)
                var score = 0
                if (start != null) score += 3
                val window = texts.subList(maxOf(0, i - 2), minOf(texts.size, i + 2)).joinToString(" ")
                if (POSITIVE.containsMatchIn(window)) score += 2
                if (DATE_INTRO.containsMatchIn(before.takeLast(30))) score += 1
                if (isDeadline) score += 2
                if (PENALTY_BEFORE.containsMatchIn(before.takeLast(40))) score -= 3
                if (start == null && LETTER_DATE_BEFORE.matches(before) && rest.isBlank()) score -= 4
                if (date.date.isBefore(today)) score -= 5
                if (date.date.isAfter(today.plusYears(3))) score -= 2
                if (score < 0) return@forEachIndexed

                // --- Titel & Ort ----------------------------------------------------------------
                val timeRanges = lineTimes.map { it.range }
                val location = findLabeledLocation(texts, i)
                    ?: if (start != null) findInlineLocation(TimeParser.mask(masked, timeRanges)) else null
                var lineTitle = cleanTitle(line, lineDates.map { it.range } + timeRanges)
                if (location != null) {
                    lineTitle = lineTitle
                        .replace(Regex("""\s*(?:in der|in dem|im|in|at the|at)\s+${Regex.escape(location)}.*$""", RegexOption.IGNORE_CASE), "")
                        .trim(*TRIM_CHARS)
                }
                val title = buildTitle(
                    lineTitle = lineTitle,
                    linesAbove = (i - 1 downTo maxOf(0, i - 2)).filter { dates[it].isEmpty() }.map { texts[it] },
                    subject = subject,
                    heading = heading,
                    organization = organization,
                    isDeadline = isDeadline,
                )

                val source = texts.subList(maxOf(0, i - 1), minOf(texts.size, i + 3)).joinToString("\n")
                found += Scored(
                    AppointmentCandidate(
                        title = title,
                        date = date.date,
                        startTime = start,
                        endTime = end,
                        location = location,
                        sourceText = source,
                        isDeadline = isDeadline,
                        confidence = when {
                            score >= 5 -> Confidence.HIGH
                            score >= 2 -> Confidence.MEDIUM
                            else -> Confidence.LOW
                        },
                        recommended = score >= 2 && !date.date.isBefore(today),
                    ),
                    score,
                )
            }
        }
        return deduplicate(found)
    }

    /**
     * Gleiches Datum mehrfach im Dokument (z. B. "Datum: 12.11." und später "am 12.11. um 10 Uhr"):
     * Einträge mit Uhrzeit gewinnen gegen ganztägige, ansonsten gewinnt die höhere Bewertung.
     */
    private fun deduplicate(found: List<Scored>): List<AppointmentCandidate> =
        found.groupBy { it.candidate.date }
            .flatMap { (_, sameDay) ->
                val hasTimed = sameDay.any { it.candidate.startTime != null }
                sameDay
                    .filter { !hasTimed || it.candidate.startTime != null || it.candidate.isDeadline }
                    .groupBy { it.candidate.startTime to it.candidate.isDeadline }
                    .map { (_, group) ->
                        val best = group.maxBy { it.score }
                        val location = best.candidate.location ?: group.firstNotNullOfOrNull { it.candidate.location }
                        best.candidate.copy(location = location)
                    }
            }
            .sortedWith(compareBy({ it.date }, { it.startTime ?: LocalTime.MIN }))

    /**
     * Titel-Reihenfolge: kurze Zeile am Datum ("Elternabend am …") → Betreff/Einladung →
     * Überschrift-Zeile darüber → größte Zeile (Überschrift) → Absender ("Termin: Praxis …") → Satz am Datum.
     */
    private fun buildTitle(
        lineTitle: String,
        linesAbove: List<String>,
        subject: String?,
        heading: String?,
        organization: String?,
        isDeadline: Boolean,
    ): String {
        val lineIsUseful = !isGeneric(lineTitle)
        val lineIsShort = lineIsUseful && lineTitle.length <= 45 && lineTitle.split(' ').size <= 5 && !isSentence(lineTitle)
        val titleAbove = linesAbove
            .filter { isTitleLike(it) && POSITIVE.containsMatchIn(it) && !LOCATION_LABEL.containsMatchIn(it) }
            .map { cleanTitle(it, emptyList()) }
            .firstOrNull { !isGeneric(it) }
        val base = when {
            lineIsShort -> lineTitle
            subject != null -> subject
            titleAbove != null -> titleAbove
            heading != null -> heading
            isDeadline && lineIsUseful -> lineTitle
            organization != null -> if (isDeadline) organization else "Termin: $organization"
            lineIsUseful -> lineTitle
            else -> "Termin"
        }
        val limited = if (base.length > 80) base.take(77).trimEnd() + "…" else base
        return when {
            !isDeadline -> limited
            limited.contains("frist", ignoreCase = true) -> limited
            limited == "Termin" -> "Frist"
            else -> "Frist: $limited"
        }
    }

    private fun isSentence(text: String): Boolean =
        text.lowercase().split(Regex("""[^\p{L}]+""")).any { it in SENTENCE_WORDS }

    /** Überschrift-artige Zeile: kurz, kein Satzanfang in Kleinschreibung, kein Doppelpunkt am Ende. */
    private fun isTitleLike(line: String): Boolean {
        val trimmed = line.trim()
        return trimmed.length <= 60 &&
            trimmed.split(' ').size <= 6 &&
            trimmed.firstOrNull()?.isLowerCase() != true &&
            !trimmed.endsWith(":") &&
            !trimmed.endsWith(",") &&
            !isSentence(trimmed)
    }

    /** Entfernt Datum, Uhrzeit, Wochentage und Füllwörter aus einer Zeile, damit der Rest als Titel taugt. */
    internal fun cleanTitle(line: String, removeRanges: List<IntRange>): String {
        val sb = StringBuilder()
        val sorted = removeRanges.sortedBy { it.first }
        var pos = 0
        for (r in sorted) {
            if (r.first < pos) continue
            sb.append(line, pos, r.first).append(MARKER)
            pos = r.last + 1
        }
        if (pos < line.length) sb.append(line, pos, line.length)

        var t = LABEL_PREFIX.replace(sb.toString(), "")
        t = WEEKDAYS.replace(t, " ")
        while (true) {
            val next = MARKER_SEQUENCE.replace(
                FILLER_AFTER_MARKER.replace(FILLER_BEFORE_MARKER.replace(t, "$MARKER"), "$MARKER"),
                "$MARKER",
            )
            if (next == t) break
            t = next
        }
        t = t.replace(MARKER, ' ')
        t = LABEL_PREFIX.replace(t.trim(), "")
        return t.replace(Regex("""\s+"""), " ").replace(Regex("""\s+([,.;:!?])"""), "$1").trim(*TRIM_CHARS)
    }

    private fun isGeneric(title: String): Boolean {
        val words = title.lowercase().split(Regex("""[^\p{L}]+""")).filter { it.isNotEmpty() }
        if (words.sumOf { it.length } < 3) return true
        return words.all { it in GENERIC_WORDS || it.length == 1 }
    }

    private fun findSubject(texts: List<String>, dates: List<List<DateMatch>>): String? {
        texts.forEachIndexed { i, line ->
            SUBJECT_LABEL.find(line)?.let { m ->
                val offset = m.groups[1]!!.range.first
                val ranges = dates[i].mapNotNull { d ->
                    if (d.range.first >= offset) (d.range.first - offset)..(d.range.last - offset) else null
                }
                val value = cleanTitle(m.groupValues[1], ranges)
                if (!isGeneric(value)) return value.take(80)
            }
        }
        return texts.indices
            .firstOrNull { INVITATION_LINE.containsMatchIn(texts[it]) }
            ?.let { cleanTitle(texts[it], dates[it].map { d -> d.range }) }
            ?.takeIf { !isGeneric(it) && it.length <= 80 }
    }

    /** Überschrift = deutlich größte Zeile in der oberen Dokumenthälfte (nur wenn Zeilenhöhen bekannt sind). */
    private fun findHeading(doc: List<DocumentLine>, dates: List<List<DateMatch>>): String? {
        val heights = doc.mapNotNull { it.height }.sorted()
        if (heights.size < 3) return null
        val median = heights[heights.size / 2]
        return doc.indices
            .take(maxOf(3, doc.size / 2))
            .filter { dates[it].isEmpty() && doc[it].height != null && doc[it].text.count(Char::isLetter) >= 4 }
            .maxByOrNull { doc[it].height!! }
            ?.takeIf { doc[it].height!! >= median * 1.3f }
            ?.let { cleanTitle(doc[it].text, emptyList()) }
            ?.takeIf { !isGeneric(it) && it.length <= 60 }
    }

    private fun findOrganization(texts: List<String>, dates: List<List<DateMatch>>): String? =
        texts.indices.take(8)
            .firstOrNull { dates[it].isEmpty() && ORGANIZATION.containsMatchIn(texts[it]) && texts[it].length <= 60 }
            ?.let { cleanTitle(texts[it], emptyList()) }

    private fun findLabeledLocation(texts: List<String>, dateLine: Int): String? {
        for (j in maxOf(0, dateLine - 1)..minOf(texts.lastIndex, dateLine + 3)) {
            val m = LOCATION_LABEL.find(texts[j]) ?: continue
            val value = m.groupValues[1].trim(*TRIM_CHARS)
            val location = value.ifEmpty { texts.getOrNull(j + 1)?.trim(*TRIM_CHARS).orEmpty() }
            // Folgezeile mit Postleitzahl/Ort anhängen ("Musterstraße 1" + "12345 Musterstadt")
            val next = texts.getOrNull(if (value.isEmpty()) j + 2 else j + 1)
            val withCity = if (next != null && Regex("""^\d{5}\s+\p{L}""").containsMatchIn(next)) "$location, $next" else location
            if (withCity.isNotBlank()) return withCity.take(100)
        }
        return null
    }

    private fun findInlineLocation(maskedRest: String): String? {
        val m = INLINE_LOCATION.find(maskedRest) ?: return null
        val value = m.groupValues[1].replace(Regex("""\s+"""), " ").trim(*TRIM_CHARS)
        val firstWord = value.substringBefore(' ').lowercase()
        if (firstWord in NOT_A_PLACE || value.none(Char::isLetter)) return null
        // Nachfolgende Satzteile abschneiden ("im Gemeindehaus statt" → "Gemeindehaus")
        return value.replace(Regex("""\s+(?:statt|ein|an|teil|sein|stattfinden|findet)\b.*$""", RegexOption.IGNORE_CASE), "")
            .trim(*TRIM_CHARS)
            .takeIf { it.length >= 3 }
    }
}
