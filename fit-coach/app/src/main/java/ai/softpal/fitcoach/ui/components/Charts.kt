package ai.softpal.fitcoach.ui.components

import ai.softpal.fitcoach.R
import ai.softpal.fitcoach.core.DayStats
import ai.softpal.fitcoach.core.WeightEntry
import ai.softpal.fitcoach.ui.theme.LocalDataColors
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.format.TextStyle as DateTextStyle
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/** Legendeneintrag: Farbmarke + Text in Textfarbe (Farbe trägt nur die Zuordnung). */
@Composable
fun LegendItem(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(10.dp).background(color, RoundedCornerShape(3.dp)))
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Rundet eine Achsen-Obergrenze auf einen glatten Wert (500er-Schritte). */
private fun niceMax(value: Int): Int = max(500, (ceil(value / 500.0) * 500).toInt())

/**
 * Gruppierte Balken: aufgenommen (Blau) und verbraucht (Orange) je Tag.
 * Tippen auf einen Tag zeigt die genauen Werte.
 */
@Composable
fun CalorieBarsChart(days: List<DayStats>, modifier: Modifier = Modifier) {
    val colors = LocalDataColors.current
    val textColor = MaterialTheme.colorScheme.onSurfaceVariant
    val measurer = rememberTextMeasurer()
    val locale = currentLocale()
    var selected by remember(days) { mutableStateOf(days.lastIndex) }
    val top = niceMax(days.maxOfOrNull { max(it.consumed, it.burned) } ?: 0)
    val consumedLabel = androidx.compose.ui.res.stringResource(R.string.consumed)
    val burnedLabel = androidx.compose.ui.res.stringResource(R.string.burned)
    val description = days.joinToString("; ") {
        "${it.date.dayOfWeek.getDisplayName(DateTextStyle.FULL, locale)}: $consumedLabel ${it.consumed}, $burnedLabel ${it.burned} kcal"
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            LegendItem(colors.consumed, consumedLabel)
            LegendItem(colors.burned, burnedLabel)
        }
        days.getOrNull(selected)?.let { d ->
            Text(
                "${dayLabel(d.date, locale, long = true)} · $consumedLabel ${formatKcal(d.consumed)} · $burnedLabel ${formatKcal(d.burned)}",
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
            )
        }
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(180.dp)
                .semantics { contentDescription = description }
                .pointerInput(days) {
                    detectTapGestures { pos ->
                        val axis = 40.dp.toPx()
                        val slot = (size.width - axis) / days.size
                        selected = ((pos.x - axis) / slot).toInt().coerceIn(0, days.lastIndex)
                    }
                },
        ) {
            val axisW = 40.dp.toPx()
            val labelH = 20.dp.toPx()
            val plotH = size.height - labelH
            val labelStyle = TextStyle(fontSize = 11.sp, color = textColor)

            // Gitterlinien (zurückhaltend) mit Achsenbeschriftung
            for (i in 0..2) {
                val value = top * i / 2
                val y = plotH - plotH * i / 2f
                drawLine(colors.grid, Offset(axisW, y), Offset(size.width, y), strokeWidth = 1.dp.toPx())
                val layout = measurer.measure(value.toString(), labelStyle)
                drawText(layout, topLeft = Offset(axisW - layout.size.width - 6.dp.toPx(), y - layout.size.height / 2f))
            }

            val slot = (size.width - axisW) / days.size
            val gap = 2.dp.toPx()
            val barW = min(14.dp.toPx(), (slot * 0.7f - gap) / 2f)
            days.forEachIndexed { i, d ->
                val center = axisW + slot * i + slot / 2f
                if (i == selected) {
                    drawRoundRect(
                        colors.track, Offset(center - slot / 2f + 2f, 0f), Size(slot - 4f, plotH),
                        cornerRadius = CornerRadius(6.dp.toPx()),
                    )
                }
                bar(colors.consumed, center - gap / 2f - barW, barW, d.consumed, top, plotH)
                bar(colors.burned, center + gap / 2f, barW, d.burned, top, plotH)
                val label = measurer.measure(dayLabel(d.date, locale, long = false), labelStyle.copy(textAlign = TextAlign.Center))
                drawText(label, topLeft = Offset(center - label.size.width / 2f, plotH + 4.dp.toPx()))
            }
        }
    }
}

private fun DrawScope.bar(color: Color, x: Float, w: Float, value: Int, top: Int, plotH: Float) {
    if (value <= 0) return
    val h = max(2f, plotH * value / top)
    val r = min(4.dp.toPx(), w / 2f)
    // Abgerundetes Ende oben, gerade an der Grundlinie
    val path = Path().apply {
        moveTo(x, plotH)
        lineTo(x, plotH - h + r)
        quadraticTo(x, plotH - h, x + r, plotH - h)
        lineTo(x + w - r, plotH - h)
        quadraticTo(x + w, plotH - h, x + w, plotH - h + r)
        lineTo(x + w, plotH)
        close()
    }
    drawPath(path, color)
}

private fun dayLabel(date: LocalDate, locale: java.util.Locale, long: Boolean): String =
    if (long) {
        "${date.dayOfWeek.getDisplayName(DateTextStyle.FULL, locale)}, ${date.dayOfMonth}.${date.monthValue}."
    } else {
        date.dayOfWeek.getDisplayName(DateTextStyle.SHORT, locale).take(3)
    }

/** Gewichtsverlauf als Linie mit Punkten; Tippen wählt den nächsten Eintrag. */
@Composable
fun WeightChart(entries: List<WeightEntry>, modifier: Modifier = Modifier) {
    val colors = LocalDataColors.current
    val line = colors.consumed
    val surface = MaterialTheme.colorScheme.surfaceContainer
    val textColor = MaterialTheme.colorScheme.onSurfaceVariant
    val measurer = rememberTextMeasurer()
    val locale = currentLocale()
    var selected by remember(entries) { mutableStateOf(entries.lastIndex) }
    if (entries.isEmpty()) return

    val minKg = entries.minOf { it.kg }
    val maxKg = entries.maxOf { it.kg }
    val pad = max(1.0, (maxKg - minKg) * 0.2)
    val low = kotlin.math.floor(minKg - pad)
    val high = ceil(maxKg + pad)
    val first = LocalDate.parse(entries.first().date)
    val spanDays = max(1L, LocalDate.parse(entries.last().date).toEpochDay() - first.toEpochDay())
    val description = entries.joinToString("; ") { "${it.date}: ${it.kg} kg" }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        entries.getOrNull(selected)?.let { e ->
            val d = LocalDate.parse(e.date)
            Text(
                "${d.dayOfMonth}.${d.monthValue}.${d.year} · ${formatKg(e.kg)}",
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
            )
        }
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(160.dp)
                .semantics { contentDescription = description }
                .pointerInput(entries) {
                    detectTapGestures { pos ->
                        val axis = 40.dp.toPx()
                        val w = size.width - axis - 8.dp.toPx()
                        selected = entries.indices.minByOrNull { i ->
                            val x = axis + w * (LocalDate.parse(entries[i].date).toEpochDay() - first.toEpochDay()) / spanDays
                            kotlin.math.abs(x - pos.x)
                        } ?: selected
                    }
                },
        ) {
            val axisW = 40.dp.toPx()
            val plotW = size.width - axisW - 8.dp.toPx()
            val plotH = size.height - 6.dp.toPx()
            val labelStyle = TextStyle(fontSize = 11.sp, color = textColor)
            fun y(kg: Double) = (plotH - (kg - low) / (high - low) * (plotH - 6.dp.toPx())).toFloat()
            fun x(e: WeightEntry) = axisW + plotW * (LocalDate.parse(e.date).toEpochDay() - first.toEpochDay()) / spanDays.toFloat()

            for (kg in listOf(low, (low + high) / 2, high)) {
                val yy = y(kg)
                drawLine(colors.grid, Offset(axisW, yy), Offset(size.width, yy), strokeWidth = 1.dp.toPx())
                val layout = measurer.measure(String.format(locale, "%.0f", kg), labelStyle)
                drawText(layout, topLeft = Offset(axisW - layout.size.width - 6.dp.toPx(), yy - layout.size.height / 2f))
            }
            val pts = entries.map { Offset(if (entries.size == 1) axisW + plotW / 2 else x(it), y(it.kg)) }
            if (pts.size > 1) {
                val path = Path().apply {
                    moveTo(pts[0].x, pts[0].y)
                    pts.drop(1).forEach { lineTo(it.x, it.y) }
                }
                drawPath(path, line, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
            }
            pts.forEachIndexed { i, p ->
                val r = if (i == selected) 6.dp.toPx() else 4.dp.toPx()
                drawCircle(surface, radius = r + 2.dp.toPx(), center = p)
                drawCircle(line, radius = r, center = p)
            }
            pts.getOrNull(selected)?.let { p ->
                drawLine(
                    textColor.copy(alpha = 0.4f), Offset(p.x, 0f), Offset(p.x, plotH),
                    strokeWidth = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)),
                )
            }
        }
    }
}

/** Fortschrittsring für das Tagesziel. Über 100 % bleibt der Ring einfach voll. */
@Composable
fun ProgressRing(progress: Float, centerTop: String, centerBottom: String, modifier: Modifier = Modifier) {
    val colors = LocalDataColors.current
    Box(modifier.size(150.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(150.dp)) {
            val stroke = 14.dp.toPx()
            val inset = stroke / 2
            val arcSize = Size(size.width - stroke, size.height - stroke)
            drawArc(colors.track, -90f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            val sweep = 360f * progress.coerceIn(0f, 1f)
            if (sweep > 0f) {
                drawArc(colors.consumed, -90f, sweep, false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(20.dp)) {
            Text(centerTop, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text(centerBottom, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}
