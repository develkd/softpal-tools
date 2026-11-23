package ai.softpal.fitcoach.core.food

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Ein erkanntes Lebensmittel auf dem Foto. */
@Serializable
data class AnalyzedItem(val name: String, val grams: Int, val kcal: Int)

/** Ergebnis der Fotoanalyse. */
@Serializable
data class FoodAnalysis(val items: List<AnalyzedItem>, val note: String = "") {
    val totalKcal: Int get() = items.sumOf { it.kcal }

    companion object {
        private val json = Json { ignoreUnknownKeys = true; isLenient = true }

        /** Liest die JSON-Antwort; unplausible Werte werden auf sinnvolle Grenzen begrenzt. */
        fun parse(text: String): FoodAnalysis {
            val start = text.indexOf('{')
            val end = text.lastIndexOf('}')
            require(start >= 0 && end > start) { "Keine JSON-Antwort" }
            val raw = json.decodeFromString(serializer(), text.substring(start, end + 1))
            return raw.copy(
                items = raw.items
                    .filter { it.name.isNotBlank() }
                    .map { it.copy(name = it.name.trim(), grams = it.grams.coerceIn(0, 3000), kcal = it.kcal.coerceIn(0, 5000)) },
                note = raw.note.trim(),
            )
        }
    }
}

/** Fehler der KI-Analyse, nach Ursache unterschieden (für passende Hinweise in der App). */
class FoodAnalysisException(val reason: Reason, cause: Throwable? = null) : Exception(reason.name, cause) {
    enum class Reason { INVALID_KEY, BUSY, NETWORK, DECLINED, UNREADABLE, OTHER }
}
