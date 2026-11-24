package ai.softpal.fitcoach.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Gewichtseintrag; pro Tag gibt es höchstens einen (der neueste ersetzt den alten). */
@Serializable
data class WeightEntry(val date: String, val kg: Double)

/** Herkunft eines Mahlzeiteneintrags. */
@Serializable
enum class MealSource { MANUAL, PHOTO_DEVICE, PHOTO_AI }

@Serializable
data class MealEntry(
    val id: String,
    val date: String,
    val time: String,
    val name: String,
    val kcal: Int,
    val source: MealSource = MealSource.MANUAL,
)

@Serializable
data class ActivityEntry(
    val id: String,
    val date: String,
    /** Übungs-ID aus dem [ai.softpal.fitcoach.core.exercise.ExerciseCatalog] oder `null` bei freier Eingabe. */
    val exerciseId: String? = null,
    val name: String,
    val minutes: Int,
    val kcal: Int,
)

/** Gesamter gespeicherter Zustand der App (eine JSON-Datei im privaten App-Speicher). */
@Serializable
data class AppData(
    val profile: Profile? = null,
    val weights: List<WeightEntry> = emptyList(),
    val meals: List<MealEntry> = emptyList(),
    val activities: List<ActivityEntry> = emptyList(),
) {
    fun withWeight(entry: WeightEntry): AppData {
        val list = (weights.filterNot { it.date == entry.date } + entry).sortedBy { it.date }
        val latest = list.last()
        // Das Profilgewicht folgt immer dem neuesten Eintrag, damit der Bedarf aktuell bleibt.
        val newProfile = profile?.let { if (latest.date == entry.date) it.copy(weightKg = entry.kg) else it }
        return copy(weights = list, profile = newProfile)
    }

    fun toJson(): String = JSON.encodeToString(serializer(), this)

    companion object {
        val JSON = Json { ignoreUnknownKeys = true; prettyPrint = false; encodeDefaults = true }

        fun fromJson(text: String): AppData = JSON.decodeFromString(serializer(), text)
    }
}
