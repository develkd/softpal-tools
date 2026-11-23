package ai.softpal.fitcoach.core

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class RecordsAndStatsTest {

    private val today = LocalDate.of(2026, 11, 23)
    private val profile = Profile(30, Sex.MALE, 180.0, 80.0, ActivityLevel.NORMAL)

    @Test fun `ein Gewichtseintrag pro Tag, Profilgewicht folgt dem neuesten`() {
        var data = AppData(profile = profile)
        data = data.withWeight(WeightEntry("2026-11-22", 80.0))
        data = data.withWeight(WeightEntry("2026-11-23", 79.5))
        data = data.withWeight(WeightEntry("2026-11-23", 79.2))
        assertEquals(2, data.weights.size)
        assertEquals(79.2, data.profile!!.weightKg, 0.0)
        // Nachtrag für einen älteren Tag ändert das aktuelle Profilgewicht nicht
        data = data.withWeight(WeightEntry("2026-11-20", 81.0))
        assertEquals(79.2, data.profile!!.weightKg, 0.0)
        assertEquals("2026-11-20", data.weights.first().date)
    }

    @Test fun `JSON hin und zurueck`() {
        val data = AppData(
            profile = profile.copy(customGoalKcal = 2100),
            weights = listOf(WeightEntry("2026-11-23", 79.0)),
            meals = listOf(MealEntry("m1", "2026-11-23", "08:00", "Simit", 300, MealSource.PHOTO_AI)),
            activities = listOf(ActivityEntry("a1", "2026-11-23", "squats", "Kniebeugen", 6, 40)),
        )
        assertEquals(data, AppData.fromJson(data.toJson()))
        // unbekannte Felder aus neueren Versionen stören nicht
        assertEquals(AppData(), AppData.fromJson("""{"zukunft":1}"""))
    }

    @Test fun `Tageswerte aufgenommen gegen verbraucht`() {
        val data = AppData(
            profile = profile,
            meals = listOf(
                MealEntry("1", "2026-11-23", "08:00", "A", 500),
                MealEntry("2", "2026-11-23", "12:00", "B", 700),
                MealEntry("3", "2026-11-22", "12:00", "C", 999),
            ),
            activities = listOf(ActivityEntry("a", "2026-11-23", null, "Joggen", 30, 280)),
        )
        val day = Stats.day(data, today)!!
        assertEquals(1200, day.consumed)
        assertEquals(280, day.activityKcal)
        assertEquals(2136, day.everydayBurn) // 1780 × 1,2
        assertEquals(2136 + 280, day.burned)
        assertEquals(2759 + 280 - 1200, day.remaining)
        assertEquals(7, Stats.lastDays(data, today, 7).size)
        assertEquals(LocalDate.of(2026, 11, 17), Stats.lastDays(data, today, 7).first().date)
    }

    @Test fun `Serie zaehlt aufeinanderfolgende Tage`() {
        val data = AppData(
            profile = profile,
            weights = listOf(WeightEntry("2026-11-21", 80.0)),
            meals = listOf(MealEntry("1", "2026-11-22", "08:00", "A", 1), MealEntry("2", "2026-11-19", "08:00", "A", 1)),
        )
        assertEquals(2, Stats.streak(data, today)) // heute noch nichts, gestern + vorgestern
        val withToday = data.copy(activities = listOf(ActivityEntry("a", "2026-11-23", null, "x", 1, 1)))
        assertEquals(3, Stats.streak(withToday, today))
    }
}
