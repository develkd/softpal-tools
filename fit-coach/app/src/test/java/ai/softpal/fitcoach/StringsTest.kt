package ai.softpal.fitcoach

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Prüft die Oberflächentexte: beide Sprachen vollständig und ausschließlich positiv formuliert. */
class StringsTest {

    private fun strings(dir: String): Map<String, String> {
        val file = File("src/main/res/$dir/strings.xml")
        assertTrue("${file.absolutePath} fehlt", file.exists())
        return Regex("""<string name="([a-z_]+)"[^>]*>(.*?)</string>""")
            .findAll(file.readText())
            .associate { it.groupValues[1] to it.groupValues[2] }
    }

    private val notTranslated = setOf("app_name", "brand_name")

    @Test fun `Deutsch und Tuerkisch haben dieselben Texte`() {
        val de = strings("values")
        val tr = strings("values-tr")
        assertEquals(de.keys - notTranslated, tr.keys)
        // Platzhalter müssen in beiden Sprachen übereinstimmen
        val placeholder = Regex("""%\d\$[sd]""")
        tr.forEach { (key, value) ->
            assertEquals(key, placeholder.findAll(de.getValue(key)).map { it.value }.toSet(), placeholder.findAll(value).map { it.value }.toSet())
        }
    }

    @Test fun `keine negativen Formulierungen`() {
        val negativeDe = listOf("schlecht", "leider", "zu viel", "zu wenig", "überschritten", "versagt", "nicht geschafft", "ungesund", "verboten", "warnung", "achtung", "fehler")
        val negativeTr = listOf("kötü", "maalesef", "çok fazla", "aştın", "başarısız", "sağlıksız", "yasak", "uyarı", "dikkat", "hata", "vazgeç")
        // Wortanfang beachten: "Geschlecht" enthält "schlecht", ist aber neutral.
        fun hit(text: String, word: String) = Regex("""(?<!\p{L})""" + Regex.escape(word)).containsMatchIn(text.lowercase())
        strings("values").forEach { (k, v) -> negativeDe.forEach { assertFalse("$k: „$it“", hit(v, it)) } }
        strings("values-tr").forEach { (k, v) -> negativeTr.forEach { assertFalse("$k: „$it“", hit(v, it)) } }
    }
}
