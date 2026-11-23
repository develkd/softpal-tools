package ai.softpal.fitcoach.core

import org.junit.Assert.assertEquals
import org.junit.Test

class EnergyCalculatorTest {

    private val man = Profile(age = 30, sex = Sex.MALE, heightCm = 180.0, weightKg = 80.0, activity = ActivityLevel.NORMAL)
    private val woman = Profile(age = 25, sex = Sex.FEMALE, heightCm = 165.0, weightKg = 60.0, activity = ActivityLevel.UNSPORTY)

    @Test fun `Grundumsatz nach Mifflin-St Jeor`() {
        assertEquals(1780.0, EnergyCalculator.bmr(man), 0.01)
        assertEquals(1345.25, EnergyCalculator.bmr(woman), 0.01)
        // divers: Mittelwert der Geschlechtskonstanten
        assertEquals(1780.0 - 83, EnergyCalculator.bmr(man.copy(sex = Sex.DIVERSE)), 0.01)
    }

    @Test fun `Tagesbedarf haengt vom Aktivitaetszustand ab`() {
        assertEquals(2136, EnergyCalculator.tdee(man.copy(activity = ActivityLevel.UNSPORTY)))
        assertEquals(2759, EnergyCalculator.tdee(man))
        assertEquals(3071, EnergyCalculator.tdee(man.copy(activity = ActivityLevel.SPORTY)))
    }

    @Test fun `Gewichtsziel verschiebt die Empfehlung, eigene Vorgabe hat Vorrang`() {
        assertEquals(2759 - 400, EnergyCalculator.dailyGoal(man.copy(goal = GoalType.LOSE)))
        assertEquals(2759 + 300, EnergyCalculator.dailyGoal(man.copy(goal = GoalType.GAIN)))
        assertEquals(1900, EnergyCalculator.dailyGoal(man.copy(goal = GoalType.LOSE, customGoalKcal = 1900)))
    }

    @Test fun `Empfehlung faellt nie unter die Untergrenze`() {
        val small = Profile(80, Sex.FEMALE, 150.0, 40.0, ActivityLevel.UNSPORTY, GoalType.LOSE)
        assertEquals(EnergyCalculator.MIN_RECOMMENDED, EnergyCalculator.dailyGoal(small))
    }

    @Test fun `Verbrauch ueber MET`() {
        // 8 MET × 70 kg × 0,5 h = 280 kcal
        assertEquals(280, EnergyCalculator.activityKcal(8.0, 70.0, 30))
    }

    @Test fun `Profilpruefung`() {
        assertEquals(true, man.isValid())
        assertEquals(false, man.copy(age = 5).isValid())
        assertEquals(false, man.copy(customGoalKcal = 300).isValid())
    }
}
