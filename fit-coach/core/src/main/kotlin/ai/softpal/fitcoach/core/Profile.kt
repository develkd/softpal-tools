package ai.softpal.fitcoach.core

import kotlinx.serialization.Serializable

/** Sprache der App-Inhalte (Oberfläche: Android-Ressourcen, Inhalte: [Text]). */
enum class Lang { DE, TR }

/** Zweisprachiger Text. Alle Inhalte der App (Übungen, Lebensmittel, Hinweise) liegen so vor. */
data class Text(val de: String, val tr: String) {
    operator fun get(lang: Lang): String = when (lang) {
        Lang.DE -> de
        Lang.TR -> tr
    }
}

@Serializable
enum class Sex { MALE, FEMALE, DIVERSE }

/** Aktivitätszustand – bestimmt den Faktor auf den Grundumsatz (PAL-Wert). */
@Serializable
enum class ActivityLevel(val factor: Double) {
    /** Sitzende Tätigkeit, kaum Sport. */
    UNSPORTY(1.2),

    /** Mäßig aktiv, etwa 3–5 × pro Woche Bewegung. */
    NORMAL(1.55),

    /** Sehr aktiv, fast täglich Sport. */
    SPORTY(1.725),
}

/** Optionales Gewichtsziel; verschiebt den empfohlenen Tagesbedarf. */
@Serializable
enum class GoalType(val kcalAdjustment: Int) {
    LOSE(-400),
    KEEP(0),
    GAIN(300),
}

@Serializable
data class Profile(
    val age: Int,
    val sex: Sex,
    val heightCm: Double,
    val weightKg: Double,
    val activity: ActivityLevel,
    val goal: GoalType = GoalType.KEEP,
    /** Selbst festgelegter Tagesbedarf in kcal; `null` = automatisch berechnen. */
    val customGoalKcal: Int? = null,
) {
    fun isValid(): Boolean =
        age in MIN_AGE..MAX_AGE && heightCm in MIN_HEIGHT..MAX_HEIGHT && weightKg in MIN_WEIGHT..MAX_WEIGHT &&
            (customGoalKcal == null || customGoalKcal in MIN_GOAL..MAX_GOAL)

    companion object {
        const val MIN_AGE = 14
        const val MAX_AGE = 110
        const val MIN_HEIGHT = 100.0
        const val MAX_HEIGHT = 250.0
        const val MIN_WEIGHT = 30.0
        const val MAX_WEIGHT = 350.0
        const val MIN_GOAL = 1000
        const val MAX_GOAL = 6000
    }
}
