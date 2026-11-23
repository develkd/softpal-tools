package ai.softpal.fitcoach.core.exercise

/** Punkt im Animationsraster: x 0…100 (links → rechts), y −10…100 (oben → unten, Boden bei 95). */
data class P(val x: Float, val y: Float) {
    constructor(x: Number, y: Number) : this(x.toFloat(), y.toFloat())

    fun lerp(to: P, t: Float) = P(x + (to.x - x) * t, y + (to.y - y) * t)
    fun shift(dx: Float, dy: Float) = P(x + dx, y + dy)
}

/**
 * Körperhaltung einer Strichfigur. "L" ist in der Seitenansicht die vom Betrachter abgewandte
 * Körperseite (wird blasser gezeichnet), in der Frontansicht die linke Bildseite.
 */
data class Pose(
    val head: P,
    val neck: P,
    val hip: P,
    val elbowL: P,
    val handL: P,
    val elbowR: P,
    val handR: P,
    val kneeL: P,
    val footL: P,
    val kneeR: P,
    val footR: P,
) {
    val points: List<P> get() = listOf(head, neck, hip, elbowL, handL, elbowR, handR, kneeL, footL, kneeR, footR)

    fun lerp(to: Pose, t: Float) = Pose(
        head.lerp(to.head, t), neck.lerp(to.neck, t), hip.lerp(to.hip, t),
        elbowL.lerp(to.elbowL, t), handL.lerp(to.handL, t),
        elbowR.lerp(to.elbowR, t), handR.lerp(to.handR, t),
        kneeL.lerp(to.kneeL, t), footL.lerp(to.footL, t),
        kneeR.lerp(to.kneeR, t), footR.lerp(to.footR, t),
    )

    /** Spiegelt die Haltung an der senkrechten Mittelachse (Frontansicht: links ↔ rechts). */
    fun mirrored(): Pose {
        fun m(p: P) = P(100f - p.x, p.y)
        return Pose(
            head = m(head), neck = m(neck), hip = m(hip),
            elbowL = m(elbowR), handL = m(handR), elbowR = m(elbowL), handR = m(handL),
            kneeL = m(kneeR), footL = m(footR), kneeR = m(kneeL), footR = m(footL),
        )
    }

    /** Tauscht die Beine (und Arme) – für Seitenansichten mit wechselnder Seite. */
    fun swapSides() = copy(
        elbowL = elbowR, handL = handR, elbowR = elbowL, handR = handL,
        kneeL = kneeR, footL = footR, kneeR = kneeL, footR = footL,
    )

    fun shift(dx: Float, dy: Float) = Pose(
        head.shift(dx, dy), neck.shift(dx, dy), hip.shift(dx, dy),
        elbowL.shift(dx, dy), handL.shift(dx, dy), elbowR.shift(dx, dy), handR.shift(dx, dy),
        kneeL.shift(dx, dy), footL.shift(dx, dy), kneeR.shift(dx, dy), footR.shift(dx, dy),
    )
}

/** Eine Haltung, die die Animation in [durationMs] Millisekunden ansteuert. */
data class Keyframe(val pose: Pose, val durationMs: Int)

enum class View { FRONT, SIDE }

/** Hilfsobjekte, die zur Figur gezeichnet werden. */
enum class Prop { NONE, WALL, MAT }

/** Animation einer Übung: Keyframes laufen in einer Endlosschleife. */
data class Animation(
    val view: View,
    val keyframes: List<Keyframe>,
    val prop: Prop = Prop.NONE,
    /** `true` = gleichmäßige Bewegung (Kreise), sonst weiches Ein-/Ausschwingen. */
    val linear: Boolean = false,
) {
    val cycleMs: Int get() = keyframes.sumOf { it.durationMs }

    /** Haltung zum Zeitpunkt [timeMs] innerhalb der Schleife. */
    fun poseAt(timeMs: Long): Pose {
        require(keyframes.isNotEmpty())
        if (keyframes.size == 1) return keyframes[0].pose
        var t = (timeMs % cycleMs).toInt()
        for (i in keyframes.indices) {
            val kf = keyframes[i]
            if (t < kf.durationMs) {
                val next = keyframes[(i + 1) % keyframes.size]
                val f = t.toFloat() / kf.durationMs
                return kf.pose.lerp(next.pose, if (linear) f else easeInOut(f))
            }
            t -= kf.durationMs
        }
        return keyframes.last().pose
    }

    private fun easeInOut(t: Float): Float = if (t < 0.5f) 2 * t * t else 1 - (-2 * t + 2) * (-2 * t + 2) / 2
}

/** Grundhaltungen, aus denen die Übungen aufgebaut sind. */
internal object Poses {
    /** Frontansicht, aufrecht, Arme hängend. */
    val front = Pose(
        head = P(50, 14), neck = P(50, 25), hip = P(50, 55),
        elbowL = P(43, 39), handL = P(41, 53), elbowR = P(57, 39), handR = P(59, 53),
        kneeL = P(46, 75), footL = P(45, 95), kneeR = P(54, 75), footR = P(55, 95),
    )

    /** Seitenansicht (Blick nach rechts), aufrecht, Arme hängend. */
    val side = Pose(
        head = P(51, 14), neck = P(50, 25), hip = P(50, 55),
        elbowL = P(50, 40), handL = P(52, 54), elbowR = P(50, 40), handR = P(52, 54),
        kneeL = P(51, 75), footL = P(50, 95), kneeR = P(51, 75), footR = P(50, 95),
    )

    /** Hoher Stütz (Liegestütz oben), Seitenansicht. */
    val highPlank = Pose(
        head = P(80.7, 55), neck = P(72, 60), hip = P(46.4, 75),
        elbowL = P(72, 76.5), handL = P(72, 93), elbowR = P(72, 76.5), handR = P(72, 93),
        kneeL = P(31, 84), footL = P(15, 93), kneeR = P(31, 84), footR = P(15, 93),
    )

    /** Hocke mit Händen am Boden (Burpee), Seitenansicht. */
    val crouch = Pose(
        head = P(66, 50), neck = P(58, 56), hip = P(40, 78),
        elbowL = P(65, 74), handL = P(68, 93), elbowR = P(65, 74), handR = P(68, 93),
        kneeL = P(57, 77), footL = P(52, 95), kneeR = P(57, 77), footR = P(52, 95),
    )
}
