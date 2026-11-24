package ai.softpal.fitcoach.core

import java.time.LocalDate

/** Kalorien eines Tages: aufgenommen vs. verbraucht, dazu das Tagesziel. */
data class DayStats(
    val date: LocalDate,
    val consumed: Int,
    val activityKcal: Int,
    val everydayBurn: Int,
    val goal: Int,
) {
    /** Gesamtverbrauch = Alltagsverbrauch + Sport. */
    val burned: Int get() = everydayBurn + activityKcal

    /** Noch verfügbare Kalorien bis zum Ziel (Sport zählt als Bonus dazu). */
    val remaining: Int get() = goal + activityKcal - consumed

    /** Anteil des Tagesziels (inkl. Sport-Bonus), 0.0 … ∞. */
    val progress: Float get() = if (goal + activityKcal <= 0) 0f else consumed.toFloat() / (goal + activityKcal)
}

object Stats {

    fun day(data: AppData, date: LocalDate): DayStats? {
        val profile = data.profile ?: return null
        val key = date.toString()
        val profileThatDay = profile.copy(weightKg = weightOn(data, date) ?: profile.weightKg)
        return DayStats(
            date = date,
            consumed = data.meals.filter { it.date == key }.sumOf { it.kcal },
            activityKcal = data.activities.filter { it.date == key }.sumOf { it.kcal },
            everydayBurn = EnergyCalculator.everydayBurn(profileThatDay),
            goal = EnergyCalculator.dailyGoal(profile),
        )
    }

    /** Die letzten [count] Tage bis einschließlich [today], ältester zuerst. */
    fun lastDays(data: AppData, today: LocalDate, count: Int): List<DayStats> =
        (count - 1 downTo 0).mapNotNull { day(data, today.minusDays(it.toLong())) }

    /** Gewicht an einem Tag: letzter Eintrag an oder vor diesem Tag. */
    fun weightOn(data: AppData, date: LocalDate): Double? =
        data.weights.filter { it.date <= date.toString() }.maxByOrNull { it.date }?.kg

    /** Gewichtseinträge im Zeitraum, ältester zuerst. */
    fun weightSeries(data: AppData, today: LocalDate, days: Int): List<WeightEntry> {
        val from = today.minusDays((days - 1).toLong()).toString()
        return data.weights.filter { it.date >= from && it.date <= today.toString() }.sortedBy { it.date }
    }

    /** Anzahl aufeinanderfolgender Tage (bis heute oder gestern) mit mindestens einem Eintrag. */
    fun streak(data: AppData, today: LocalDate): Int {
        val active = buildSet {
            data.weights.forEach { add(it.date) }
            data.meals.forEach { add(it.date) }
            data.activities.forEach { add(it.date) }
        }
        var day = if (today.toString() in active) today else today.minusDays(1)
        var count = 0
        while (day.toString() in active) {
            count++
            day = day.minusDays(1)
        }
        return count
    }
}
