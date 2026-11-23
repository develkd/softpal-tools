package ai.softpal.fitcoach.ui

import ai.softpal.fitcoach.R
import ai.softpal.fitcoach.core.AppData
import ai.softpal.fitcoach.core.EnergyCalculator
import ai.softpal.fitcoach.core.Encouragement
import ai.softpal.fitcoach.core.Stats
import ai.softpal.fitcoach.ui.components.CalorieBarsChart
import ai.softpal.fitcoach.ui.components.CheerCard
import ai.softpal.fitcoach.ui.components.ProgressRing
import ai.softpal.fitcoach.ui.components.SectionCard
import ai.softpal.fitcoach.ui.components.WeightChart
import ai.softpal.fitcoach.ui.components.currentLocale
import ai.softpal.fitcoach.ui.components.formatKcal
import ai.softpal.fitcoach.ui.components.formatKg
import ai.softpal.fitcoach.ui.components.local
import ai.softpal.fitcoach.ui.theme.LocalDataColors
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@Composable
fun DashboardScreen(data: AppData, today: LocalDate, onNavigate: (Tab) -> Unit) {
    val profile = data.profile ?: return
    val day = Stats.day(data, today) ?: return
    val week = Stats.lastDays(data, today, 7)
    val streak = Stats.streak(data, today)
    val colors = LocalDataColors.current
    val locale = currentLocale()

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column {
            Text(stringResource(R.string.hello), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                today.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale)),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        CheerCard(Encouragement.forDay(day, streak, today.dayOfYear).map { it.local() })

        SectionCard(title = stringResource(R.string.today)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                if (day.remaining >= 0) {
                    ProgressRing(day.progress, formatKcal(day.remaining), stringResource(R.string.still_available))
                } else {
                    ProgressRing(1f, "🎉", stringResource(R.string.goal_reached))
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatLine(stringResource(R.string.daily_goal), formatKcal(day.goal))
                    StatLine(stringResource(R.string.consumed), formatKcal(day.consumed), colors.consumed)
                    StatLine(stringResource(R.string.sport_bonus), "+" + formatKcal(day.activityKcal))
                    StatLine(stringResource(R.string.burned), formatKcal(day.burned), colors.burned)
                }
            }
            if (day.remaining < 0) {
                Text(
                    stringResource(R.string.extra_energy, formatKcal(-day.remaining)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                FilledTonalButton(onClick = { onNavigate(Tab.FOOD) }, Modifier.weight(1f)) { Text(stringResource(R.string.add_meal_short)) }
                FilledTonalButton(onClick = { onNavigate(Tab.SPORT) }, Modifier.weight(1f)) { Text(stringResource(R.string.add_activity_short)) }
            }
        }

        SectionCard(title = stringResource(R.string.week_compare)) {
            CalorieBarsChart(week)
            Text(stringResource(R.string.week_compare_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        SectionCard(title = stringResource(R.string.weight)) {
            val series = Stats.weightSeries(data, today, 30)
            val latest = data.weights.lastOrNull()
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(formatKg(latest?.kg ?: profile.weightKg), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    stringResource(R.string.bmi_value, String.format(locale, "%.1f", EnergyCalculator.bmi(profile))),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 4.dp),
                )
            }
            if (series.size >= 2) {
                WeightChart(series)
            } else {
                Text(stringResource(R.string.weight_chart_soon), style = MaterialTheme.typography.bodyMedium)
            }
            val loggedToday = data.weights.any { it.date == today.toString() }
            FilledTonalButton(onClick = { onNavigate(Tab.WEIGHT) }, Modifier.fillMaxWidth()) {
                Text(stringResource(if (loggedToday) R.string.weight_view else R.string.weight_enter_today))
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun StatLine(label: String, value: String, marker: Color? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (marker != null) Box(Modifier.size(10.dp).background(marker, RoundedCornerShape(3.dp)))
        Column {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
    }
}
