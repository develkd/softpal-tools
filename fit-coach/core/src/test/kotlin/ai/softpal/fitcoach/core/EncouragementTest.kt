package ai.softpal.fitcoach.core

import ai.softpal.fitcoach.core.food.FoodDatabase
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** Die App darf ausschließlich positive, ermutigende Hinweise geben. */
class EncouragementTest {

    private val negativeDe = listOf(
        "schlecht", "leider", "zu viel", "zu wenig", "überschritten", "versagt", "nicht geschafft", "fehler",
        "achtung", "warnung", "ungesund", "verboten", "dick", "faul", "schade", "problem", "aufgeben", "zugenommen",
    )
    private val negativeTr = listOf(
        "kötü", "maalesef", "çok fazla", "aştın", "başarısız", "hata", "dikkat", "uyarı", "sağlıksız",
        "yasak", "şişman", "tembel", "yazık", "sorun", "vazgeç", "kilo aldın",
    )

    /** Treffer nur am Wortanfang ("Geschlecht" enthält "schlecht", ist aber neutral). */
    private fun hit(text: String, word: String) = Regex("""(?<!\p{L})""" + Regex.escape(word)).containsMatchIn(text.lowercase())

    private fun assertPositive(text: Text) {
        negativeDe.forEach { assertFalse("„$it“ in: ${text.de}", hit(text.de, it)) }
        negativeTr.forEach { assertFalse("„$it“ in: ${text.tr}", hit(text.tr, it)) }
        assertTrue(text.de.isNotBlank() && text.tr.isNotBlank())
    }

    @Test fun `alle festen Texte sind positiv`() {
        Encouragement.allStaticTexts().forEach(::assertPositive)
    }

    @Test fun `Tageshinweise sind in jeder Lage positiv`() {
        val today = LocalDate.of(2026, 11, 23)
        for (consumed in listOf(0, 300, 1200, 2000, 2600, 5000)) {
            for (activity in listOf(0, 250)) {
                for (seed in 0..5) {
                    val stats = DayStats(today, consumed, activity, everydayBurn = 1800, goal = 2200)
                    Encouragement.forDay(stats, streak = seed, seed = seed).forEach(::assertPositive)
                }
            }
        }
    }

    @Test fun `Gewichtshinweise sind in jede Richtung positiv`() {
        for (goal in GoalType.entries) {
            for (prev in listOf(null, 80.0)) {
                for (now in listOf(78.0, 79.95, 80.0, 80.3, 82.0)) {
                    assertPositive(Encouragement.forWeight(prev, now, goal))
                }
            }
        }
    }

    @Test fun `Aktivitaets- und Mahlzeitenhinweise sind positiv`() {
        assertPositive(Encouragement.forActivity(120, 15))
        (0..5).forEach { assertPositive(Encouragement.forMeal(it)) }
        assertPositive(Encouragement.streakText(7))
    }

    @Test fun `Lebensmittelnamen enthalten keine Wertungen`() {
        FoodDatabase.foods.forEach { assertPositive(it.name) }
    }
}
