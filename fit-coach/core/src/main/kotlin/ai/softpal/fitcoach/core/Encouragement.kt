package ai.softpal.fitcoach.core

import kotlin.math.abs

/**
 * Hinweise der App – ausschließlich positiv und ermutigend.
 *
 * Grundsatz: Es gibt keine "zu viel/zu wenig"-Wertungen, keine Warnfarben und keine Verbote.
 * Jede Situation wird als Fortschritt oder als Chance formuliert. Ein Unit-Test prüft alle Texte
 * gegen eine Liste negativer Begriffe.
 */
object Encouragement {

    private val freshStart = listOf(
        Text(
            "Ein neuer Tag voller Möglichkeiten! Trag deine erste Mahlzeit ein, wann immer du magst.",
            "Fırsatlarla dolu yeni bir gün! İlk öğününü dilediğin zaman ekleyebilirsin.",
        ),
        Text(
            "Schön, dass du da bist! Heute ist ein wunderbarer Tag, um gut für dich zu sorgen.",
            "Burada olman harika! Bugün kendine iyi bakmak için güzel bir gün.",
        ),
    )

    private val goodStart = listOf(
        Text(
            "Guter Start! Du hast noch reichlich Spielraum für leckere, nahrhafte Mahlzeiten.",
            "Harika bir başlangıç! Lezzetli ve besleyici öğünler için hâlâ bolca yerin var.",
        ),
        Text(
            "Du bist auf einem richtig guten Weg – genieße deine nächste Mahlzeit!",
            "Çok güzel bir yoldasın – bir sonraki öğününün tadını çıkar!",
        ),
    )

    private val onTrack = listOf(
        Text(
            "Du bist super unterwegs – dein Tag ist schön ausgewogen.",
            "Süper gidiyorsun – günün güzel bir denge içinde.",
        ),
        Text(
            "Weiter so! Du achtest wunderbar auf dich.",
            "Böyle devam! Kendine çok güzel özen gösteriyorsun.",
        ),
    )

    private val goalReached = listOf(
        Text(
            "Klasse! Du triffst dein Tagesziel richtig gut.",
            "Harika! Günlük hedefini çok güzel yakaladın.",
        ),
        Text(
            "Bravo – dein Körper ist heute bestens versorgt!",
            "Bravo – vücudun bugün en güzel şekilde beslendi!",
        ),
    )

    private val extraEnergy = listOf(
        Text(
            "Heute hast du ordentlich Energie getankt – perfekt für eine kleine Bewegungseinheit! Jeder Schritt zählt.",
            "Bugün bolca enerji depoladın – küçük bir hareket molası için ideal! Her adım değerli.",
        ),
        Text(
            "Volle Energiespeicher! Ein Spaziergang oder eine Übung aus dem Sport-Bereich macht jetzt richtig Freude.",
            "Enerji depoların dolu! Şimdi kısa bir yürüyüş ya da spor bölümünden bir egzersiz çok keyifli olur.",
        ),
    )

    private val movedToday = Text(
        "Stark, dass du dich heute bewegt hast!",
        "Bugün hareket etmen harika!",
    )

    /** Tageshinweis für das Dashboard. [seed] sorgt für Abwechslung (z. B. Tag des Jahres). */
    fun forDay(stats: DayStats, streak: Int, seed: Int): List<Text> {
        val pool = when {
            stats.consumed == 0 -> freshStart
            stats.progress < 0.5f -> goodStart
            stats.progress < 0.9f -> onTrack
            stats.progress <= 1.1f -> goalReached
            else -> extraEnergy
        }
        return buildList {
            add(pool[abs(seed) % pool.size])
            if (stats.activityKcal > 0) add(movedToday)
            if (streak >= 2) add(streakText(streak))
        }
    }

    fun streakText(days: Int) = Text(
        "$days Tage in Folge dabei – deine Beständigkeit ist beeindruckend!",
        "$days gündür aralıksız buradasın – istikrarın gerçekten etkileyici!",
    )

    /** Hinweis nach dem Eintragen des Gewichts. */
    fun forWeight(previousKg: Double?, currentKg: Double, goal: GoalType): Text {
        if (previousKg == null) {
            return Text(
                "Dein erster Eintrag ist gemacht – der Startpunkt deiner Erfolgsgeschichte!",
                "İlk kaydın tamam – başarı hikâyenin başlangıç noktası!",
            )
        }
        val diff = currentKg - previousKg
        val towardsGoal = when (goal) {
            GoalType.LOSE -> diff < -0.05
            GoalType.GAIN -> diff > 0.05
            GoalType.KEEP -> abs(diff) <= 0.5
        }
        return when {
            towardsGoal && goal != GoalType.KEEP -> Text(
                "Super, du kommst deinem Ziel näher! Dein Einsatz zahlt sich aus.",
                "Süper, hedefine yaklaşıyorsun! Emeğinin karşılığını alıyorsun.",
            )
            towardsGoal -> Text(
                "Wunderbar stabil – du hältst dein Gewicht mit Leichtigkeit!",
                "Harika, dengedesin – kilonu zahmetsizce koruyorsun!",
            )
            abs(diff) <= 0.05 -> Text(
                "Beständigkeit ist eine Stärke – schön, dass du regelmäßig eincheckst!",
                "İstikrar bir güçtür – düzenli olarak kayıt girmen harika!",
            )
            else -> Text(
                "Das Gewicht schwankt ganz natürlich von Tag zu Tag. Toll, dass du dranbleibst – der Trend über Wochen zählt!",
                "Kilo günden güne doğal olarak değişir. Devam etmen harika – asıl önemli olan haftalar boyunca eğilim!",
            )
        }
    }

    /** Hinweis nach einer erledigten Übung. */
    fun forActivity(kcal: Int, minutes: Int) = Text(
        "Großartig! $minutes Minuten Bewegung – du hast $kcal kcal in Energie für dich verwandelt.",
        "Muhteşem! $minutes dakika hareket – $kcal kcal'yi kendin için enerjiye dönüştürdün.",
    )

    /** Hinweis nach dem Eintragen einer Mahlzeit. */
    fun forMeal(seed: Int): Text {
        val pool = listOf(
            Text("Lecker! Deine Mahlzeit ist eingetragen.", "Afiyet olsun! Öğünün kaydedildi."),
            Text("Gut gemacht – Achtsamkeit beim Essen ist ein toller Schritt!", "Aferin – yemekte farkındalık harika bir adım!"),
            Text("Eingetragen! Du behältst wunderbar den Überblick.", "Kaydedildi! Genel durumu çok güzel takip ediyorsun."),
        )
        return pool[abs(seed) % pool.size]
    }

    /** Alle festen Texte (für den Positiv-Test). */
    internal fun allStaticTexts(): List<Text> =
        freshStart + goodStart + onTrack + goalReached + extraEnergy + movedToday
}
