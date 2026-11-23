package ai.softpal.fitcoach.ui.components

import ai.softpal.fitcoach.R
import ai.softpal.fitcoach.core.Lang
import ai.softpal.fitcoach.core.Text
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import java.text.NumberFormat
import java.util.Locale

/** Aktuelle Sprache der Oberfläche (folgt der App-Sprache bzw. dem System). */
@Composable
@ReadOnlyComposable
fun currentLang(): Lang =
    if (LocalConfiguration.current.locales[0].language == "tr") Lang.TR else Lang.DE

@Composable
@ReadOnlyComposable
fun currentLocale(): Locale = LocalConfiguration.current.locales[0]

/** Zweisprachigen Inhalt in der aktuellen Sprache. */
@Composable
@ReadOnlyComposable
fun Text.local(): String = this[currentLang()]

@Composable
fun formatKcal(kcal: Int): String =
    stringResource(R.string.kcal_value, NumberFormat.getIntegerInstance(currentLocale()).format(kcal))

@Composable
fun formatKg(kg: Double): String =
    stringResource(R.string.kg_value, NumberFormat.getNumberInstance(currentLocale()).apply { maximumFractionDigits = 1; minimumFractionDigits = 1 }.format(kg))

/** Liest Dezimalzahlen mit Komma oder Punkt. */
fun parseDecimal(text: String): Double? = text.trim().replace(',', '.').toDoubleOrNull()

/** softpal-Wortmarke, passend zum Theme eingefärbt. */
@Composable
fun SoftpalLogo(modifier: Modifier = Modifier, height: Dp = 20.dp) {
    Icon(
        painter = painterResource(R.drawable.softpal_logo),
        contentDescription = stringResource(R.string.brand_name),
        tint = MaterialTheme.colorScheme.onBackground,
        // Seitenverhältnis des Logos: 264 × 56
        modifier = modifier.size(width = height * (264f / 56f), height = height),
    )
}

@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (title != null) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }
            content()
        }
    }
}

/** Ermutigender Hinweis mit Herz-Symbol. */
@Composable
fun CheerCard(lines: List<String>, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
        ),
    ) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Text("✨", style = MaterialTheme.typography.titleLarge)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                lines.forEach { Text(it, style = MaterialTheme.typography.bodyLarge) }
            }
        }
    }
}

@Composable
fun NumberField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    suffix: String,
    modifier: Modifier = Modifier,
    decimal: Boolean = false,
    isError: Boolean = false,
    supportingText: String? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { new -> onValueChange(new.filter { it.isDigit() || (decimal && (it == ',' || it == '.')) }.take(6)) },
        label = { Text(label) },
        suffix = { Text(suffix) },
        singleLine = true,
        isError = isError,
        supportingText = supportingText?.let { { Text(it) } },
        keyboardOptions = KeyboardOptions(keyboardType = if (decimal) KeyboardType.Decimal else KeyboardType.Number),
        modifier = modifier,
    )
}
