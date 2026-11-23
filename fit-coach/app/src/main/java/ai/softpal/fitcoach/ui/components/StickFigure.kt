package ai.softpal.fitcoach.ui.components

import ai.softpal.fitcoach.core.exercise.Animation
import ai.softpal.fitcoach.core.exercise.P
import ai.softpal.fitcoach.core.exercise.Pose
import ai.softpal.fitcoach.core.exercise.Prop
import ai.softpal.fitcoach.core.exercise.View
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import ai.softpal.fitcoach.ui.theme.LocalDataColors

/**
 * Animierte Strichfigur, die eine Übung vormacht. Die Haltungen kommen als Keyframes aus dem
 * Kernmodul und werden pro Frame weich ineinander überblendet.
 */
@Composable
fun ExerciseAnimation(
    animation: Animation,
    description: String,
    modifier: Modifier = Modifier,
    playing: Boolean = true,
) {
    var time by remember { mutableLongStateOf(0L) }
    LaunchedEffect(animation, playing) {
        if (!playing) return@LaunchedEffect
        val start = withFrameMillis { it } - time
        while (true) {
            withFrameMillis { time = it - start }
        }
    }
    val figure = MaterialTheme.colorScheme.onSurface
    val accent = LocalDataColors.current.consumed
    val ground = MaterialTheme.colorScheme.outlineVariant
    val pose = animation.poseAt(time)

    Canvas(
        modifier
            .aspectRatio(1f)
            .semantics { contentDescription = description },
    ) {
        // Raster: x 0…100, y −10…100  → quadratische Zeichenfläche mit Rand
        val scale = size.minDimension / 116f
        val ox = (size.width - 100f * scale) / 2f
        val oy = 12f * scale
        fun o(p: P) = Offset(ox + p.x * scale, oy + p.y * scale)

        // Boden & Hilfsmittel
        drawLine(ground, o(P(4, 96.5)), o(P(96, 96.5)), strokeWidth = 2f * scale / 1.5f, cap = StrokeCap.Round)
        when (animation.prop) {
            Prop.WALL -> drawRect(ground, topLeft = o(P(89, 5)), size = Size(5f * scale, 91.5f * scale))
            Prop.MAT -> drawRoundRect(
                accent.copy(alpha = 0.25f), topLeft = o(P(8, 94)), size = Size(86f * scale, 2.5f * scale),
                cornerRadius = CornerRadius(scale),
            )
            Prop.NONE -> Unit
        }
        drawFigure(pose, animation.view, figure, scale, ::o)
    }
}

private fun DrawScope.drawFigure(pose: Pose, view: View, color: Color, scale: Float, o: (P) -> Offset) {
    val w = 4.2f * scale
    val far = if (view == View.SIDE) color.copy(alpha = 0.45f) else color
    fun limb(c: Color, vararg pts: P) {
        for (i in 0 until pts.size - 1) drawLine(c, o(pts[i]), o(pts[i + 1]), strokeWidth = w, cap = StrokeCap.Round)
    }
    // Abgewandte Seite zuerst (in der Seitenansicht blasser)
    limb(far, pose.neck, pose.elbowL, pose.handL)
    limb(far, pose.hip, pose.kneeL, pose.footL)
    if (view == View.SIDE) limb(far, pose.footL, P(pose.footL.x + 4f, pose.footL.y))
    // Rumpf, Kopf, zugewandte Seite
    limb(color, pose.neck, pose.hip)
    limb(color, pose.hip, pose.kneeR, pose.footR)
    if (view == View.SIDE) limb(color, pose.footR, P(pose.footR.x + 4f, pose.footR.y))
    limb(color, pose.neck, pose.elbowR, pose.handR)
    drawCircle(color, radius = 6.5f * scale, center = o(pose.head))
}
