package ai.softpal.fitcoach.core.exercise

import ai.softpal.fitcoach.core.ActivityLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import kotlin.math.hypot

class ExerciseTest {

    private fun len(a: P, b: P) = hypot(a.x - b.x, a.y - b.y)

    @Test fun `jede Uebung ist vollstaendig in beiden Sprachen`() {
        val ids = ExerciseCatalog.exercises.map { it.id }
        assertEquals(ids.size, ids.toSet().size)
        for (e in ExerciseCatalog.exercises) {
            assertTrue(e.id, e.name.de.isNotBlank() && e.name.tr.isNotBlank())
            assertTrue(e.id, e.steps.size >= 2 && e.steps.all { it.de.isNotBlank() && it.tr.isNotBlank() })
            assertTrue(e.id, e.levels.isNotEmpty() && e.met > 0)
            e.levels.forEach { level ->
                assertTrue("${e.id} Dosis $level", e.dose.containsKey(level))
                assertTrue("${e.id} Minuten $level", e.minutes.containsKey(level))
            }
        }
    }

    @Test fun `Animationen bleiben im Bild und haben plausible Gliederlaengen`() {
        for (e in ExerciseCatalog.exercises) {
            val anim = e.animation
            assertTrue(e.id, anim.keyframes.size >= 2 && anim.cycleMs in 400..10_000)
            val poses = anim.keyframes.map { it.pose }
            poses.flatMap { it.points }.forEach { p ->
                assertTrue("${e.id}: $p", p.x in 0f..100f && p.y in -10f..100f)
            }
            // Rumpf und Beine dürfen sich zwischen den Haltungen nicht stark verändern.
            fun check(name: String, f: (Pose) -> Float) {
                val values = poses.map(f)
                assertTrue("${e.id} $name: $values", values.max() / values.min() < 1.6f)
            }
            check("Rumpf") { len(it.neck, it.hip) }
            // In der Frontansicht sind angehobene Knie perspektivisch verkürzt – Beine nur seitlich prüfen.
            if (anim.view == View.SIDE) {
                check("Oberschenkel L") { len(it.hip, it.kneeL) }
                check("Oberschenkel R") { len(it.hip, it.kneeR) }
                check("Unterschenkel L") { len(it.kneeL, it.footL) }
                check("Unterschenkel R") { len(it.kneeR, it.footR) }
            }
        }
    }

    @Test fun `Animation laeuft fluessig im Kreis`() {
        val anim = ExerciseCatalog.jumpingJacks.animation
        assertEquals(anim.keyframes[0].pose, anim.poseAt(0))
        assertEquals(anim.keyframes[1].pose, anim.poseAt(anim.keyframes[0].durationMs.toLong()))
        assertEquals(anim.poseAt(10), anim.poseAt(anim.cycleMs + 10L))
        val mid = anim.poseAt(anim.keyframes[0].durationMs / 2L)
        assertTrue(mid.handL.y < anim.keyframes[0].pose.handL.y && mid.handL.y > anim.keyframes[1].pose.handL.y)
    }

    @Test fun `Vorschlaege passen zum Aktivitaetszustand und wechseln taeglich`() {
        val day = LocalDate.of(2026, 11, 23)
        for (level in ActivityLevel.entries) {
            val list = Suggestions.forDay(level, day)
            assertEquals(1 + Suggestions.MAIN_COUNT, list.size)
            assertTrue(list.first().warmup)
            assertTrue(list.all { level in it.levels })
            assertEquals(list.size, list.toSet().size)
            assertEquals(list, Suggestions.forDay(level, day))
            val week = (0L..6L).map { Suggestions.forDay(level, day.plusDays(it)) }.toSet()
            assertTrue("$level wechselt", week.size > 1)
        }
        assertTrue(Suggestions.forDay(ActivityLevel.UNSPORTY, day).none { it.met >= 8.0 })
    }
}
