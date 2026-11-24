package ai.softpal.fitcoach.core.exercise

import ai.softpal.fitcoach.core.ActivityLevel
import java.time.LocalDate

/**
 * Tagesvorschläge passend zum Aktivitätszustand: eine Aufwärmübung plus drei Hauptübungen.
 * Die Auswahl wechselt täglich, ist aber für einen Tag stabil.
 */
object Suggestions {

    const val MAIN_COUNT = 3

    fun forDay(level: ActivityLevel, date: LocalDate): List<Exercise> {
        val suitable = ExerciseCatalog.exercises.filter { level in it.levels }
        val warmups = suitable.filter { it.warmup }
        val main = suitable.filterNot { it.warmup }
        val day = date.toEpochDay().toInt()
        val warmup = warmups[Math.floorMod(day, warmups.size)]
        val start = Math.floorMod(day, main.size)
        val picked = (0 until minOf(MAIN_COUNT, main.size)).map { main[(start + it) % main.size] }
        return listOf(warmup) + picked
    }

    /** Gesamtdauer des Tagesprogramms in Minuten. */
    fun totalMinutes(level: ActivityLevel, date: LocalDate): Int = forDay(level, date).sumOf { it.minutesFor(level) }
}
