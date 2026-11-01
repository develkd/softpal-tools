package de.maridcam.terminscanner.extraction

/** Bereinigt typische OCR-Fehler, bevor Datum und Uhrzeit gesucht werden. */
internal object TextNormalizer {

    private val SPECIAL_SPACES = Regex("""[   \t]""")
    private val HYPHENS = Regex("""[‐‑‒−]""")

    /** Buchstabe O statt Ziffer 0 in Zahlen, z. B. "1O:3O" oder "2O26". */
    private val LETTER_O_IN_NUMBER = Regex("""(?<=\d)[Oo](?=[\d:.]|\s|$)|(?<=\d[:.])[Oo](?=\d|[Oo]|\s|$)""")

    private val MULTI_SPACE = Regex(""" {2,}""")

    fun normalize(text: String): String {
        var t = SPECIAL_SPACES.replace(text, " ")
        t = HYPHENS.replace(t, "-")
        // zweimal, damit auch "OO" in "1O:OO" vollständig ersetzt wird
        t = LETTER_O_IN_NUMBER.replace(t, "0")
        t = LETTER_O_IN_NUMBER.replace(t, "0")
        return MULTI_SPACE.replace(t, " ").trim()
    }
}
