package ai.softpal.fitcoach.core

import kotlin.math.roundToInt

/**
 * Kalorienberechnung.
 *
 * - Grundumsatz (BMR) nach Mifflin-St Jeor:
 *   `10 × Gewicht[kg] + 6,25 × Größe[cm] − 5 × Alter + s` mit s = +5 (männlich), −161 (weiblich),
 *   −78 (divers, Mittelwert).
 * - Tagesbedarf = Grundumsatz × Aktivitätsfaktor ([ActivityLevel.factor]) + Zielanpassung ([GoalType]).
 *   Ein selbst festgelegter Wert ([Profile.customGoalKcal]) hat Vorrang.
 * - Verbrauch durch Sport über MET-Werte: `kcal = MET × Gewicht[kg] × Stunden`.
 */
object EnergyCalculator {

    /** Faktor für den Alltagsverbrauch ohne Sport (Grundumsatz + Alltagsbewegung). */
    const val EVERYDAY_FACTOR = 1.2

    /** Untergrenze für den automatisch empfohlenen Tagesbedarf. */
    const val MIN_RECOMMENDED = 1200

    fun bmr(profile: Profile): Double {
        val s = when (profile.sex) {
            Sex.MALE -> 5.0
            Sex.FEMALE -> -161.0
            Sex.DIVERSE -> -78.0
        }
        return 10.0 * profile.weightKg + 6.25 * profile.heightCm - 5.0 * profile.age + s
    }

    /** Gesamtumsatz (TDEE) je nach Aktivitätszustand. */
    fun tdee(profile: Profile): Int = (bmr(profile) * profile.activity.factor).roundToInt()

    /** Empfohlener Tagesbedarf inkl. Gewichtsziel (ohne eigene Vorgabe). */
    fun recommendedGoal(profile: Profile): Int =
        maxOf(MIN_RECOMMENDED, tdee(profile) + profile.goal.kcalAdjustment)

    /** Tatsächlich verwendetes Tagesziel: eigene Vorgabe oder Empfehlung. */
    fun dailyGoal(profile: Profile): Int = profile.customGoalKcal ?: recommendedGoal(profile)

    /** Alltagsverbrauch ohne gezielten Sport (für die Gegenüberstellung im Dashboard). */
    fun everydayBurn(profile: Profile): Int = (bmr(profile) * EVERYDAY_FACTOR).roundToInt()

    /** Verbrauch einer Aktivität in kcal. */
    fun activityKcal(met: Double, weightKg: Double, minutes: Int): Int =
        (met * weightKg * minutes / 60.0).roundToInt()

    fun bmi(profile: Profile): Double {
        val m = profile.heightCm / 100.0
        return profile.weightKg / (m * m)
    }
}
