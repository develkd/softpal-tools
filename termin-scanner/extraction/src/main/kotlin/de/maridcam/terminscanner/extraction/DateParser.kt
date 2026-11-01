package de.maridcam.terminscanner.extraction

import java.time.DateTimeException
import java.time.LocalDate

internal data class DateMatch(val date: LocalDate, val range: IntRange, val hadYear: Boolean)

/**
 * Findet Datumsangaben in einer Textzeile (deutsch und englisch).
 *
 * Unterstützt u. a. `12.11.2026`, `12.11.26`, `12. 11. 2026`, `2026-11-12`, `12.11.`,
 * `12. November 2026`, `12 Nov`, `November 12, 2026`, `12th of November`.
 */
internal object DateParser {

    private val MONTHS: Map<String, Int> = buildMap {
        fun put(month: Int, vararg names: String) = names.forEach { put(it, month) }
        put(1, "januar", "jänner", "jaenner", "january", "jan")
        put(2, "februar", "february", "feber", "feb")
        put(3, "märz", "maerz", "marz", "march", "mär", "mrz", "mar")
        put(4, "april", "apr")
        put(5, "mai", "may")
        put(6, "juni", "june", "jun")
        put(7, "juli", "july", "jul")
        put(8, "august", "aug")
        put(9, "september", "sept", "sep")
        put(10, "oktober", "october", "okt", "oct")
        put(11, "november", "nov")
        put(12, "dezember", "december", "dez", "dec")
    }

    private val MONTH_ALTERNATION = MONTHS.keys.sortedByDescending { it.length }.joinToString("|")

    private val ISO = Regex("""(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)""")

    private val NUMERIC_WITH_YEAR =
        Regex("""(?<![\d.])(\d{1,2})\s?([./-])\s?(\d{1,2})\s?\2\s?(\d{4}|\d{2})(?!\d)""")

    private val DAY_MONTH_NAME = Regex(
        """(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\.?\s*(?:of\s+)?($MONTH_ALTERNATION)(?!\p{L})\.?(?:\s*,?\s*(\d{4})(?!\d))?""",
        RegexOption.IGNORE_CASE,
    )

    private val MONTH_NAME_DAY = Regex(
        """(?<!\p{L})($MONTH_ALTERNATION)(?!\p{L})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?!\d)(?:\s*,?\s*(\d{4})(?!\d))?""",
        RegexOption.IGNORE_CASE,
    )

    /** `12.11.` ohne Jahr – der Punkt nach dem Monat ist Pflicht, damit Uhrzeiten wie `10.30` nicht passen. */
    private val NUMERIC_WITHOUT_YEAR = Regex("""(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.(?!\s?\d)""")

    fun findDates(line: String, today: LocalDate): List<DateMatch> {
        val matches = mutableListOf<DateMatch>()

        fun overlaps(range: IntRange) = matches.any { it.range.first <= range.last && range.first <= it.range.last }

        fun add(range: IntRange, date: LocalDate?, hadYear: Boolean) {
            if (date != null && !overlaps(range)) matches += DateMatch(date, range, hadYear)
        }

        ISO.findAll(line).forEach { m ->
            val (y, mo, d) = m.destructured
            add(m.range, dateOrNull(y.toInt(), mo.toInt(), d.toInt()), hadYear = true)
        }

        NUMERIC_WITH_YEAR.findAll(line).forEach { m ->
            var day = m.groupValues[1].toInt()
            var month = m.groupValues[3].toInt()
            val separator = m.groupValues[2]
            // Amerikanisches Format (MM/DD/YYYY) nur, wenn eindeutig erkennbar.
            if (separator == "/" && month > 12 && day <= 12) {
                day = month.also { month = day }
            }
            add(m.range, dateOrNull(expandYear(m.groupValues[4]), month, day), hadYear = true)
        }

        DAY_MONTH_NAME.findAll(line).forEach { m ->
            val day = m.groupValues[1].toInt()
            val month = MONTHS.getValue(m.groupValues[2].lowercase())
            val year = m.groupValues[3]
            val date = if (year.isNotEmpty()) dateOrNull(year.toInt(), month, day) else inferYear(month, day, today)
            add(m.range, date, hadYear = year.isNotEmpty())
        }

        MONTH_NAME_DAY.findAll(line).forEach { m ->
            val month = MONTHS.getValue(m.groupValues[1].lowercase())
            val day = m.groupValues[2].toInt()
            val year = m.groupValues[3]
            val date = if (year.isNotEmpty()) dateOrNull(year.toInt(), month, day) else inferYear(month, day, today)
            add(m.range, date, hadYear = year.isNotEmpty())
        }

        NUMERIC_WITHOUT_YEAR.findAll(line).forEach { m ->
            add(m.range, inferYear(m.groupValues[2].toInt(), m.groupValues[1].toInt(), today), hadYear = false)
        }

        return matches.sortedBy { it.range.first }
    }

    private fun expandYear(year: String): Int = if (year.length == 2) 2000 + year.toInt() else year.toInt()

    /** Ohne Jahresangabe wird das nächste Vorkommen ab heute angenommen. */
    private fun inferYear(month: Int, day: Int, today: LocalDate): LocalDate? {
        val thisYear = dateOrNull(today.year, month, day) ?: return dateOrNull(today.year + 1, month, day)
        return if (thisYear.isBefore(today)) dateOrNull(today.year + 1, month, day) else thisYear
    }

    private fun dateOrNull(year: Int, month: Int, day: Int): LocalDate? {
        if (year !in 1900..2100) return null
        return try {
            LocalDate.of(year, month, day)
        } catch (e: DateTimeException) {
            null
        }
    }
}
