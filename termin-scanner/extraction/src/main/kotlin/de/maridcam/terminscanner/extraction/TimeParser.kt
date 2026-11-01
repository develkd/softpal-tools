package de.maridcam.terminscanner.extraction

import java.time.LocalTime

internal data class TimeMatch(val start: LocalTime, val end: LocalTime?, val range: IntRange)

/**
 * Findet Uhrzeiten und Zeiträume in einer Textzeile.
 *
 * Unterstützt u. a. `14:30`, `14.30 Uhr`, `14 Uhr`, `14h`, `2:30 pm`, `10:00 - 11:30 Uhr`,
 * `von 10 bis 12 Uhr`, `9 am to 11 am`.
 *
 * Datumsangaben müssen vorher maskiert werden (siehe [mask]), damit `12.11` nicht als Uhrzeit gilt.
 */
internal object TimeParser {

    private val TOKEN = Regex(
        """(?<![\d.:,])([01]?\d|2[0-3])(?:([:.])([0-5]\d))?(?:\s*(uhr|h(?!\p{L})|[ap]\.?\s?m\.?(?!\p{L})))?(?![\d:])""",
        RegexOption.IGNORE_CASE,
    )

    private val RANGE_CONNECTOR = Regex("""^\s*(?:-|–|—|bis|to|until|till)\s*$""", RegexOption.IGNORE_CASE)

    private val TIME_CONTEXT_BEFORE = Regex(
        """(?:\bum|\bab|\bvon|\bgegen|\bzwischen|\bat|\bfrom|\bbeginn:?|\buhrzeit:?|\bzeit:?|\btime:?|\bstart:?|\bende:?|\bend:?|\bbis)\s*$""",
        RegexOption.IGNORE_CASE,
    )

    /** Reicht auch für eine volle Stunde ohne "Uhr" ("um 9", "Beginn: 9"). */
    private val STRONG_TIME_CONTEXT_BEFORE = Regex(
        """(?:\bum|\bgegen|\bat|\bbeginn:?|\buhrzeit:?|\bzeit:?|\btime:?|\bstart:?)\s*$""",
        RegexOption.IGNORE_CASE,
    )

    private data class Token(
        val hour: Int,
        val minute: Int?,
        val separator: String,
        val suffix: String,
        val range: IntRange,
        val hasContext: Boolean,
        val hasStrongContext: Boolean,
    ) {
        val isAmPm get() = suffix.startsWith("a") || suffix.startsWith("p")
        val isPm get() = suffix.startsWith("p")

        /** Eindeutig eine Uhrzeit, auch ohne Zusammenhang. */
        val isExplicit get() = separator == ":" || suffix.isNotEmpty()

        fun toLocalTime(pmFallback: Boolean = false): LocalTime? {
            var h = hour
            if (isAmPm || pmFallback) {
                if (h > 12) return null
                val pm = isPm || (pmFallback && !isAmPm)
                if (pm && h < 12) h += 12
                if (!pm && h == 12) h = 0
            }
            return LocalTime.of(h, minute ?: 0)
        }
    }

    fun findTimes(maskedLine: String): List<TimeMatch> {
        val tokens = TOKEN.findAll(maskedLine).map { m ->
            val before = maskedLine.substring(0, m.range.first)
            Token(
                hour = m.groupValues[1].toInt(),
                minute = m.groupValues[3].takeIf { it.isNotEmpty() }?.toInt(),
                separator = m.groupValues[2],
                suffix = m.groupValues[4].lowercase().replace(" ", "").replace(".", ""),
                range = trimmedRange(maskedLine, m.range),
                hasContext = TIME_CONTEXT_BEFORE.containsMatchIn(before.takeLast(14)),
                hasStrongContext = STRONG_TIME_CONTEXT_BEFORE.containsMatchIn(before.takeLast(14)),
            )
        }.toList()

        val result = mutableListOf<TimeMatch>()
        var i = 0
        while (i < tokens.size) {
            val a = tokens[i]
            val b = tokens.getOrNull(i + 1)
            val between = b?.let { maskedLine.substring(a.range.last + 1, it.range.first) }
            if (b != null && between != null && RANGE_CONNECTOR.matches(between)) {
                // Zeitraum: "10:00 - 11:30", "von 10 bis 12 Uhr", "9 to 11 am"
                val rangeIsTime = a.isExplicit || b.isExplicit || a.minute != null || a.hasContext
                if (rangeIsTime) {
                    val end = b.toLocalTime()
                    // "1 - 3 pm" → 13:00–15:00, aber "11 - 1 pm" → 11:00–13:00
                    val inheritPm = !a.isAmPm && b.isPm && end != null && a.hour < 12 && a.hour + 12 <= end.hour
                    val start = a.toLocalTime(pmFallback = inheritPm)
                    if (start != null && end != null) {
                        result += TimeMatch(start, end.takeIf { it.isAfter(start) }, a.range.first..b.range.last)
                        i += 2
                        continue
                    }
                }
            }
            if (isTime(a)) {
                a.toLocalTime()?.let { result += TimeMatch(it, null, a.range) }
            }
            i++
        }
        return result
    }

    private fun isTime(token: Token): Boolean = when {
        token.separator == ":" -> true
        token.suffix.isNotEmpty() -> true
        // "14.30" nur mit passendem Kontext ("um", "ab", "von" …), "um 10" nur mit eindeutigem ("um", "Beginn:" …)
        token.minute != null -> token.hasContext
        else -> token.hasStrongContext
    }

    private fun trimmedRange(text: String, range: IntRange): IntRange {
        var last = range.last
        while (last > range.first && text[last].isWhitespace()) last--
        return range.first..last
    }

    /** Ersetzt die angegebenen Bereiche durch Leerzeichen (gleiche Länge, Indizes bleiben gültig). */
    fun mask(line: String, ranges: List<IntRange>): String {
        val chars = line.toCharArray()
        ranges.forEach { r -> for (i in r) if (i in chars.indices) chars[i] = ' ' }
        return String(chars)
    }
}
