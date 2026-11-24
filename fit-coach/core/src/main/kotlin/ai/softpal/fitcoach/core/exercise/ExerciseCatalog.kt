package ai.softpal.fitcoach.core.exercise

import ai.softpal.fitcoach.core.ActivityLevel
import ai.softpal.fitcoach.core.ActivityLevel.NORMAL
import ai.softpal.fitcoach.core.ActivityLevel.SPORTY
import ai.softpal.fitcoach.core.ActivityLevel.UNSPORTY
import ai.softpal.fitcoach.core.Text

/**
 * Eine Übung mit Anleitung und Animation.
 *
 * [met] = metabolisches Äquivalent (Compendium of Physical Activities), daraus wird der Verbrauch berechnet.
 */
data class Exercise(
    val id: String,
    val name: Text,
    val steps: List<Text>,
    /** Empfohlene Dosierung je Aktivitätszustand, z. B. "3 × 10 Wiederholungen". */
    val dose: Map<ActivityLevel, Text>,
    val met: Double,
    val levels: Set<ActivityLevel>,
    /** Vorgeschlagene Dauer in Minuten (inkl. kurzer Pausen). */
    val minutes: Map<ActivityLevel, Int>,
    val warmup: Boolean = false,
    val animation: Animation,
) {
    fun minutesFor(level: ActivityLevel): Int = minutes[level] ?: minutes.values.first()
    fun doseFor(level: ActivityLevel): Text = dose[level] ?: dose.values.first()
}

/** Freie Aktivität ohne Animation (für manuelle Einträge wie Spazierengehen). */
data class FreeActivity(val id: String, val name: Text, val met: Double)

object ExerciseCatalog {

    private fun all(m: Int) = mapOf(UNSPORTY to m, NORMAL to m, SPORTY to m)
    private fun t(de: String, tr: String) = Text(de, tr)

    // ---------- Aufwärmen ----------

    val marching = Exercise(
        id = "marching",
        name = t("Auf der Stelle gehen", "Yerinde yürüyüş"),
        steps = listOf(
            t("Stell dich aufrecht hin, die Füße hüftbreit.", "Dik dur, ayakların kalça genişliğinde açık olsun."),
            t("Hebe abwechselnd die Knie an, als würdest du gehen.", "Yürür gibi dizlerini sırayla kaldır."),
            t("Schwinge die Arme locker mit und atme ruhig weiter.", "Kollarını rahatça salla ve sakin nefes almaya devam et."),
        ),
        dose = mapOf(
            UNSPORTY to t("3 Minuten in deinem Tempo", "Kendi temponda 3 dakika"),
            NORMAL to t("3 Minuten zügig", "3 dakika tempolu"),
            SPORTY to t("2 Minuten zum Aufwärmen", "Isınmak için 2 dakika"),
        ),
        met = 3.0, levels = setOf(UNSPORTY, NORMAL, SPORTY), minutes = mapOf(UNSPORTY to 3, NORMAL to 3, SPORTY to 2),
        warmup = true,
        animation = run {
            val n = Poses.front
            val a = n.copy(kneeL = P(44, 60), footL = P(46, 79), elbowR = P(57, 37), handR = P(56, 46))
            val b = a.mirrored()
            Animation(View.FRONT, listOf(Keyframe(n, 350), Keyframe(a, 350), Keyframe(n, 350), Keyframe(b, 350)))
        },
    )

    val armCircles = Exercise(
        id = "arm_circles",
        name = t("Armkreisen", "Kol çevirme"),
        steps = listOf(
            t("Strecke beide Arme seitlich auf Schulterhöhe aus.", "İki kolunu yanlara, omuz hizasında aç."),
            t("Zeichne mit den Händen kleine Kreise in die Luft.", "Ellerinle havada küçük daireler çiz."),
            t("Nach der Hälfte der Zeit die Richtung wechseln.", "Sürenin yarısında yönü değiştir."),
        ),
        dose = all(1).mapValues { t("2 × 30 Sekunden je Richtung", "Her yöne 2 × 30 saniye") },
        met = 2.8, levels = setOf(UNSPORTY, NORMAL, SPORTY), minutes = all(2), warmup = true,
        animation = run {
            val base = Poses.front
            fun at(dx: Float, dy: Float) = base.copy(
                elbowL = P(37f + dx / 2, 25f + dy / 2), handL = P(24f + dx, 25f + dy),
                elbowR = P(63f - dx / 2, 25f + dy / 2), handR = P(76f - dx, 25f + dy),
            )
            val r = 7f
            Animation(
                View.FRONT,
                listOf(
                    Keyframe(at(0f, -r), 220), Keyframe(at(-r, 0f), 220),
                    Keyframe(at(0f, r), 220), Keyframe(at(r, 0f), 220),
                ),
                linear = true,
            )
        },
    )

    val sideBends = Exercise(
        id = "side_bends",
        name = t("Seitbeugen", "Yana eğilme"),
        steps = listOf(
            t("Stell dich hüftbreit hin, ein Arm geht über den Kopf.", "Ayaklarını kalça genişliğinde aç, bir kolunu başının üzerine kaldır."),
            t("Neige den Oberkörper langsam zur Seite, bis du eine angenehme Dehnung spürst.", "Hoş bir esneme hissedene kadar gövdeni yavaşça yana eğ."),
            t("Zurück zur Mitte und Seite wechseln.", "Ortaya dön ve tarafı değiştir."),
        ),
        dose = all(1).mapValues { t("8 × pro Seite, ganz entspannt", "Her tarafa 8 kez, rahatça") },
        met = 2.5, levels = setOf(UNSPORTY, NORMAL), minutes = all(2), warmup = true,
        animation = run {
            val n = Poses.front
            val right = n.copy(
                head = P(62, 17), neck = P(57, 27),
                elbowL = P(51, 13), handL = P(61, 6),
                elbowR = P(62, 41), handR = P(63, 54),
            )
            Animation(View.FRONT, listOf(Keyframe(n, 700), Keyframe(right, 900), Keyframe(n, 700), Keyframe(right.mirrored(), 900)))
        },
    )

    val stretch = Exercise(
        id = "reach_up",
        name = t("Strecken zur Decke", "Tavana uzanma"),
        steps = listOf(
            t("Stell dich aufrecht hin und atme tief ein.", "Dik dur ve derin bir nefes al."),
            t("Strecke beide Arme nach oben und komm auf die Zehenspitzen.", "İki kolunu yukarı uzat ve parmak uçlarında yüksel."),
            t("Beim Ausatmen langsam wieder absenken.", "Nefes verirken yavaşça indir."),
        ),
        dose = all(1).mapValues { t("10 ruhige Wiederholungen", "10 sakin tekrar") },
        met = 2.3, levels = setOf(UNSPORTY, NORMAL, SPORTY), minutes = all(2), warmup = true,
        animation = run {
            val n = Poses.front
            // Arme seitlich über die Waagerechte nach oben führen (nicht durch den Kopf)
            val side = n.copy(elbowL = P(37, 26), handL = P(24, 26), elbowR = P(63, 26), handR = P(76, 26))
            val up = n.copy(
                elbowL = P(42, 13), handL = P(37, 1), elbowR = P(58, 13), handR = P(63, 1),
            ).shift(0f, -3f).copy(footL = P(45, 94), footR = P(55, 94))
            Animation(View.FRONT, listOf(Keyframe(n, 600), Keyframe(side, 600), Keyframe(up, 1100), Keyframe(side, 600)))
        },
    )

    // ---------- Kraft & Ausdauer ----------

    val squats = Exercise(
        id = "squats",
        name = t("Kniebeugen", "Squat (çömelme)"),
        steps = listOf(
            t("Füße schulterbreit, Arme nach vorne strecken.", "Ayaklar omuz genişliğinde, kollarını öne uzat."),
            t("Setz dich nach hinten, als ob ein Stuhl hinter dir stünde. Die Knie zeigen zu den Zehen.", "Arkanda sandalye varmış gibi geriye otur. Dizlerin ayak parmaklarına baksın."),
            t("Drück dich über die Fersen wieder nach oben.", "Topuklarından güç alarak tekrar yüksel."),
        ),
        dose = mapOf(
            UNSPORTY to t("2 × 8 – gern mit einem Stuhl hinter dir", "2 × 8 – istersen arkana bir sandalye koy"),
            NORMAL to t("3 × 12", "3 × 12"),
            SPORTY to t("4 × 15", "4 × 15"),
        ),
        met = 5.0, levels = setOf(UNSPORTY, NORMAL, SPORTY), minutes = mapOf(UNSPORTY to 4, NORMAL to 6, SPORTY to 8),
        animation = run {
            val up = Poses.side.copy(elbowL = P(62, 27), handL = P(75, 28), elbowR = P(62, 27), handR = P(75, 28))
            val down = up.copy(
                head = P(56, 40), neck = P(51, 49), hip = P(36, 75),
                elbowL = P(63, 50), handL = P(76, 50), elbowR = P(63, 50), handR = P(76, 50),
                kneeL = P(56, 75.4), footL = P(52, 95), kneeR = P(56, 75.4), footR = P(52, 95),
            )
            Animation(View.SIDE, listOf(Keyframe(up, 900), Keyframe(down, 900)))
        },
    )

    val wallPushups = Exercise(
        id = "wall_pushups",
        name = t("Wand-Liegestütze", "Duvar şınavı"),
        steps = listOf(
            t("Stell dich etwa einen Schritt vor eine Wand und leg die Hände schulterbreit an.", "Duvardan yaklaşık bir adım uzakta dur, ellerini omuz genişliğinde duvara koy."),
            t("Beuge die Arme und bring die Brust Richtung Wand. Der Körper bleibt gerade.", "Kollarını bük ve göğsünü duvara yaklaştır. Vücudun düz kalsın."),
            t("Drück dich wieder zurück in die Ausgangsposition.", "Kendini tekrar başlangıç pozisyonuna it."),
        ),
        dose = mapOf(
            UNSPORTY to t("2 × 10", "2 × 10"),
            NORMAL to t("3 × 12", "3 × 12"),
        ),
        met = 3.0, levels = setOf(UNSPORTY, NORMAL), minutes = mapOf(UNSPORTY to 4, NORMAL to 5),
        animation = run {
            val legs = Poses.side
            val out = legs.copy(
                head = P(66.4, 21), neck = P(62, 30), hip = P(47.6, 59.3),
                elbowL = P(75, 31), handL = P(88, 32), elbowR = P(75, 31), handR = P(88, 32),
                kneeL = P(39, 76.8), footL = P(30, 95), kneeR = P(39, 76.8), footR = P(30, 95),
            )
            val inn = out.copy(
                head = P(77.8, 27.8), neck = P(72, 36), hip = P(53.1, 62.5),
                elbowL = P(78, 46), elbowR = P(78, 46),
                kneeL = P(41.8, 78.5), kneeR = P(41.8, 78.5),
            )
            Animation(View.SIDE, listOf(Keyframe(out, 900), Keyframe(inn, 900)), prop = Prop.WALL)
        },
    )

    val lunges = Exercise(
        id = "lunges",
        name = t("Ausfallschritte", "Hamle (lunge)"),
        steps = listOf(
            t("Stell dich aufrecht hin, Hände an die Hüfte oder locker hängen lassen.", "Dik dur, ellerini beline koy ya da serbest bırak."),
            t("Mach einen großen Schritt nach vorne und senke das hintere Knie Richtung Boden.", "Öne büyük bir adım at ve arka dizini yere doğru indir."),
            t("Drück dich zurück und wechsle das Bein.", "Geri itin ve bacak değiştir."),
        ),
        dose = mapOf(
            NORMAL to t("3 × 8 pro Bein", "Her bacak için 3 × 8"),
            SPORTY to t("4 × 12 pro Bein", "Her bacak için 4 × 12"),
        ),
        met = 4.0, levels = setOf(NORMAL, SPORTY), minutes = mapOf(NORMAL to 6, SPORTY to 8),
        animation = run {
            val s = Poses.side
            val lunge = s.copy(
                head = P(48, 33), neck = P(47, 44), hip = P(47, 74),
                elbowL = P(47, 59), handL = P(49, 73), elbowR = P(47, 59), handR = P(49, 73),
                kneeR = P(66, 76), footR = P(66, 95),
                kneeL = P(40, 91), footL = P(24, 95),
            )
            Animation(View.SIDE, listOf(Keyframe(s, 800), Keyframe(lunge, 900), Keyframe(s, 800), Keyframe(lunge.swapSides(), 900)))
        },
    )

    val pushups = Exercise(
        id = "pushups",
        name = t("Liegestütze", "Şınav"),
        steps = listOf(
            t("Hände schulterbreit auf den Boden, Körper bildet eine gerade Linie.", "Ellerini omuz genişliğinde yere koy, vücudun düz bir çizgi oluştursun."),
            t("Beuge die Arme und senke die Brust kontrolliert ab.", "Kollarını bük ve göğsünü kontrollü şekilde indir."),
            t("Kraftvoll hochdrücken. Auf den Knien ist es leichter – genauso wertvoll!", "Güçlü bir şekilde yukarı it. Dizlerin üzerinde daha kolay – ve aynı derecede değerli!"),
        ),
        dose = mapOf(
            NORMAL to t("3 × 8 (gern auf den Knien)", "3 × 8 (istersen dizlerin üzerinde)"),
            SPORTY to t("4 × 15", "4 × 15"),
        ),
        met = 3.8, levels = setOf(NORMAL, SPORTY), minutes = mapOf(NORMAL to 5, SPORTY to 7),
        animation = run {
            val up = Poses.highPlank
            val down = up.copy(
                head = P(81.9, 82.4), neck = P(72, 84), hip = P(46.4, 88),
                elbowL = P(61, 79), elbowR = P(61, 79),
                kneeL = P(31, 90.5), kneeR = P(31, 90.5),
            )
            Animation(View.SIDE, listOf(Keyframe(up, 900), Keyframe(down, 900)), prop = Prop.MAT)
        },
    )

    val plank = Exercise(
        id = "plank",
        name = t("Unterarmstütz (Plank)", "Plank (ön kol desteği)"),
        steps = listOf(
            t("Stütz dich auf die Unterarme, Ellbogen unter den Schultern.", "Ön kollarına yaslan, dirseklerin omuzlarının altında olsun."),
            t("Heb den Körper in eine gerade Linie – Bauch und Po leicht anspannen.", "Vücudunu düz bir çizgiye kaldır – karnını ve kalçanı hafifçe sık."),
            t("Ruhig weiteratmen und die Position halten.", "Sakin nefes almaya devam et ve pozisyonu koru."),
        ),
        dose = mapOf(
            UNSPORTY to t("3 × 15 Sekunden (gern auf den Knien)", "3 × 15 saniye (istersen dizlerin üzerinde)"),
            NORMAL to t("3 × 30 Sekunden", "3 × 30 saniye"),
            SPORTY to t("3 × 60 Sekunden", "3 × 60 saniye"),
        ),
        met = 4.0, levels = setOf(UNSPORTY, NORMAL, SPORTY), minutes = mapOf(UNSPORTY to 3, NORMAL to 4, SPORTY to 5),
        animation = run {
            val hold = Pose(
                head = P(79.7, 77.7), neck = P(70, 80), hip = P(45.3, 85.9),
                elbowL = P(70, 93), handL = P(82, 93), elbowR = P(70, 93), handR = P(82, 93),
                kneeL = P(30.4, 89.4), footL = P(15, 93), kneeR = P(30.4, 89.4), footR = P(15, 93),
            )
            val breathe = hold.copy(hip = P(45.3, 84.9), kneeL = P(30.4, 88.8), kneeR = P(30.4, 88.8))
            Animation(View.SIDE, listOf(Keyframe(hold, 1500), Keyframe(breathe, 1500)), prop = Prop.MAT)
        },
    )

    val jumpingJacks = Exercise(
        id = "jumping_jacks",
        name = t("Hampelmann", "Jumping jack"),
        steps = listOf(
            t("Stell dich aufrecht hin, die Arme seitlich am Körper.", "Dik dur, kolların yanlarda olsun."),
            t("Spring in die Grätsche und führe die Arme über den Kopf.", "Bacaklarını açarak zıpla ve kollarını başının üzerine kaldır."),
            t("Spring zurück in die Ausgangsposition. Locker und federnd bleiben.", "Başlangıç pozisyonuna geri zıpla. Rahat ve esnek kal."),
        ),
        dose = mapOf(
            NORMAL to t("3 × 30 Sekunden", "3 × 30 saniye"),
            SPORTY to t("4 × 45 Sekunden", "4 × 45 saniye"),
        ),
        met = 8.0, levels = setOf(NORMAL, SPORTY), minutes = mapOf(NORMAL to 4, SPORTY to 5),
        animation = run {
            val n = Poses.front
            val open = n.copy(
                elbowL = P(39, 16), handL = P(33, 5), elbowR = P(61, 16), handR = P(67, 5),
                kneeL = P(41, 75), footL = P(33, 95), kneeR = P(59, 75), footR = P(67, 95),
            )
            Animation(View.FRONT, listOf(Keyframe(n, 380), Keyframe(open, 380)))
        },
    )

    val highKnees = Exercise(
        id = "high_knees",
        name = t("Kniehebelauf", "Diz çekme koşusu"),
        steps = listOf(
            t("Lauf auf der Stelle und zieh die Knie bis etwa Hüfthöhe.", "Yerinde koş ve dizlerini yaklaşık kalça hizasına çek."),
            t("Die Hände vor dem Bauch halten – die Knie tippen sie an.", "Ellerini karnının önünde tut – dizlerin ellerine değsin."),
            t("Auf den Fußballen landen und gleichmäßig atmen.", "Ayak tabanının ön kısmına bas ve düzenli nefes al."),
        ),
        dose = mapOf(
            NORMAL to t("4 × 20 Sekunden", "4 × 20 saniye"),
            SPORTY to t("5 × 30 Sekunden", "5 × 30 saniye"),
        ),
        met = 8.0, levels = setOf(NORMAL, SPORTY), minutes = mapOf(NORMAL to 4, SPORTY to 5),
        animation = run {
            val base = Poses.front.copy(elbowL = P(40, 40), handL = P(45, 52), elbowR = P(60, 40), handR = P(55, 52))
            val a = base.copy(kneeL = P(44, 53), footL = P(46, 70)).shift(0f, -2f).copy(footR = P(55, 95))
            val b = a.mirrored().copy(footL = P(45, 95))
            Animation(View.FRONT, listOf(Keyframe(a, 260), Keyframe(b, 260)))
        },
    )

    val mountainClimbers = Exercise(
        id = "mountain_climbers",
        name = t("Bergsteiger", "Dağcı (mountain climber)"),
        steps = listOf(
            t("Geh in den hohen Stütz – Hände unter den Schultern.", "Yüksek şınav pozisyonuna geç – ellerin omuzlarının altında."),
            t("Zieh abwechselnd ein Knie zur Brust.", "Sırayla bir dizini göğsüne çek."),
            t("Rhythmisch weiter, der Rücken bleibt lang.", "Ritmik şekilde devam et, sırtın uzun kalsın."),
        ),
        dose = mapOf(SPORTY to t("4 × 30 Sekunden", "4 × 30 saniye")),
        met = 8.0, levels = setOf(SPORTY), minutes = mapOf(SPORTY to 5),
        animation = run {
            val base = Poses.highPlank
            val a = base.copy(kneeR = P(60, 82), footR = P(52, 92))
            Animation(View.SIDE, listOf(Keyframe(a, 330), Keyframe(a.swapSides(), 330)), prop = Prop.MAT)
        },
    )

    val burpees = Exercise(
        id = "burpees",
        name = t("Burpees", "Burpee"),
        steps = listOf(
            t("Aus dem Stand in die Hocke gehen und die Hände auf den Boden setzen.", "Ayaktayken çömel ve ellerini yere koy."),
            t("Die Beine nach hinten in den Stütz springen.", "Bacaklarını geriye atarak şınav pozisyonuna geç."),
            t("Zurück in die Hocke und mit gestreckten Armen nach oben springen.", "Tekrar çömel ve kollarını uzatarak yukarı zıpla."),
        ),
        dose = mapOf(SPORTY to t("3 × 10", "3 × 10")),
        met = 8.0, levels = setOf(SPORTY), minutes = mapOf(SPORTY to 6),
        animation = run {
            val stand = Poses.side
            val jump = Pose(
                head = P(51, 8), neck = P(50, 19), hip = P(50, 49),
                elbowL = P(57, 9), handL = P(63, -3), elbowR = P(57, 9), handR = P(63, -3),
                kneeL = P(51, 69), footL = P(50, 89), kneeR = P(51, 69), footR = P(50, 89),
            )
            Animation(
                View.SIDE,
                listOf(
                    Keyframe(stand, 450), Keyframe(Poses.crouch, 400), Keyframe(Poses.highPlank, 500),
                    Keyframe(Poses.crouch, 400), Keyframe(jump, 450),
                ),
            )
        },
    )

    /** Alle Übungen mit Animation. */
    val exercises: List<Exercise> = listOf(
        marching, armCircles, sideBends, stretch,
        squats, wallPushups, lunges, pushups, plank, jumpingJacks, highKnees, mountainClimbers, burpees,
    )

    /** Weitere Aktivitäten zum manuellen Eintragen. */
    val freeActivities: List<FreeActivity> = listOf(
        FreeActivity("walking", t("Spazierengehen", "Yürüyüş"), 3.5),
        FreeActivity("brisk_walking", t("Zügiges Gehen", "Tempolu yürüyüş"), 4.3),
        FreeActivity("jogging", t("Joggen", "Koşu"), 7.0),
        FreeActivity("cycling", t("Radfahren", "Bisiklet"), 6.8),
        FreeActivity("swimming", t("Schwimmen", "Yüzme"), 6.0),
        FreeActivity("yoga", t("Yoga", "Yoga"), 2.5),
        FreeActivity("dancing", t("Tanzen", "Dans"), 5.0),
        FreeActivity("football", t("Fußball", "Futbol"), 7.0),
        FreeActivity("fitness", t("Fitnessstudio", "Spor salonu"), 5.0),
        FreeActivity("housework", t("Hausarbeit", "Ev işleri"), 3.0),
        FreeActivity("stairs", t("Treppensteigen", "Merdiven çıkma"), 4.0),
    )

    fun byId(id: String): Exercise? = exercises.firstOrNull { it.id == id }
}
