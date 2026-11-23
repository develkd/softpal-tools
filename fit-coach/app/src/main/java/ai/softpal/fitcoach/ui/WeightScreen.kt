package ai.softpal.fitcoach.ui

import ai.softpal.fitcoach.R
import ai.softpal.fitcoach.core.AppData
import ai.softpal.fitcoach.core.Profile
import ai.softpal.fitcoach.core.Stats
import ai.softpal.fitcoach.ui.components.NumberField
import ai.softpal.fitcoach.ui.components.SectionCard
import ai.softpal.fitcoach.ui.components.WeightChart
import ai.softpal.fitcoach.ui.components.currentLocale
import ai.softpal.fitcoach.ui.components.formatKg
import ai.softpal.fitcoach.ui.components.parseDecimal
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@Composable
fun WeightScreen(vm: MainViewModel, data: AppData, today: LocalDate) {
    val locale = currentLocale()
    val focus = LocalFocusManager.current
    val todayEntry = data.weights.firstOrNull { it.date == today.toString() }
    var input by rememberSaveable(todayEntry) {
        mutableStateOf((todayEntry?.kg ?: data.weights.lastOrNull()?.kg)?.let { String.format(locale, "%.1f", it) }.orEmpty())
    }
    var range by rememberSaveable { mutableIntStateOf(30) }
    val value = parseDecimal(input)
    val valid = value != null && value in Profile.MIN_WEIGHT..Profile.MAX_WEIGHT

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SectionCard(title = stringResource(if (todayEntry == null) R.string.weight_enter_today else R.string.weight_update_today)) {
            Text(
                today.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(locale)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            NumberField(
                input, { input = it }, stringResource(R.string.current_weight), "kg", Modifier.fillMaxWidth(),
                decimal = true, isError = input.isNotEmpty() && !valid,
            )
            Button(
                onClick = { value?.let { vm.addWeight(it); focus.clearFocus() } },
                enabled = valid,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(stringResource(R.string.save)) }
            Text(stringResource(R.string.weight_tip), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        SectionCard(title = stringResource(R.string.weight_history)) {
            val ranges = listOf(7, 30, 90, 365)
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                ranges.forEachIndexed { i, r ->
                    SegmentedButton(
                        selected = range == r,
                        onClick = { range = r },
                        shape = SegmentedButtonDefaults.itemShape(i, ranges.size),
                    ) { Text(stringResource(R.string.days_short, r)) }
                }
            }
            val series = Stats.weightSeries(data, today, range)
            if (series.size >= 2) {
                WeightChart(series)
                val first = series.first().kg
                val last = series.last().kg
                Text(
                    stringResource(R.string.weight_range_summary, formatKg(first), formatKg(last)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text(stringResource(R.string.weight_chart_soon), style = MaterialTheme.typography.bodyMedium)
            }
        }

        SectionCard(title = stringResource(R.string.entries)) {
            val entries = data.weights.sortedByDescending { it.date }.take(30)
            if (entries.isEmpty()) Text(stringResource(R.string.weight_chart_soon))
            entries.forEach { e ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        LocalDate.parse(e.date).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)),
                        Modifier.weight(1f),
                    )
                    Text(formatKg(e.kg), fontWeight = FontWeight.SemiBold)
                    IconButton(onClick = { vm.deleteWeight(e.date) }) {
                        Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.delete))
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}
