package ai.softpal.fitcoach.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// softpal-Branding: monochrom, Schwarz auf Weiß (bzw. invertiert im Dark Mode).
private val SoftpalBlack = Color(0xFF000000)
private val SoftpalWhite = Color(0xFFFFFFFF)
private val SoftpalGray = Color(0xFF5F5F5F)
private val SoftpalLightGray = Color(0xFFEDEDED)
private val SoftpalDarkGray = Color(0xFF2A2A2A)

private val LightColors = lightColorScheme(
    primary = SoftpalBlack,
    onPrimary = SoftpalWhite,
    primaryContainer = SoftpalLightGray,
    onPrimaryContainer = SoftpalBlack,
    secondary = SoftpalGray,
    onSecondary = SoftpalWhite,
    secondaryContainer = SoftpalLightGray,
    onSecondaryContainer = SoftpalBlack,
    background = SoftpalWhite,
    onBackground = SoftpalBlack,
    surface = SoftpalWhite,
    onSurface = SoftpalBlack,
    surfaceVariant = Color(0xFFF4F4F2),
    onSurfaceVariant = Color(0xFF52514E),
    surfaceContainer = Color(0xFFF4F4F2),
    surfaceContainerHigh = SoftpalLightGray,
    outlineVariant = Color(0xFFDDDDDA),
)

private val DarkColors = darkColorScheme(
    primary = SoftpalWhite,
    onPrimary = SoftpalBlack,
    primaryContainer = SoftpalDarkGray,
    onPrimaryContainer = SoftpalWhite,
    secondary = Color(0xFFBDBDBD),
    onSecondary = SoftpalBlack,
    secondaryContainer = SoftpalDarkGray,
    onSecondaryContainer = SoftpalWhite,
    background = Color(0xFF0E0E0E),
    onBackground = SoftpalWhite,
    surface = Color(0xFF0E0E0E),
    onSurface = SoftpalWhite,
    surfaceVariant = Color(0xFF1A1A19),
    onSurfaceVariant = Color(0xFFC3C2B7),
    surfaceContainer = Color(0xFF1A1A19),
    surfaceContainerHigh = SoftpalDarkGray,
    outlineVariant = Color(0xFF3A3A38),
)

/**
 * Farben für Diagramme und Daten. Kategorische Reihen nach der validierten Referenzpalette
 * (Slot 1 Blau = aufgenommen, Slot 2 Orange = verbraucht), je Modus eigens abgestuft.
 */
@Immutable
data class DataColors(
    val consumed: Color,
    val burned: Color,
    val grid: Color,
    val track: Color,
)

private val LightData = DataColors(
    consumed = Color(0xFF2A78D6),
    burned = Color(0xFFEB6834),
    grid = Color(0xFFE4E4E1),
    track = Color(0xFFEDEDEB),
)

private val DarkData = DataColors(
    consumed = Color(0xFF3987E5),
    burned = Color(0xFFD95926),
    grid = Color(0xFF2E2E2C),
    track = Color(0xFF2A2A28),
)

val LocalDataColors = staticCompositionLocalOf { LightData }

@Composable
fun FitCoachTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(LocalDataColors provides if (darkTheme) DarkData else LightData) {
        MaterialTheme(colorScheme = if (darkTheme) DarkColors else LightColors, content = content)
    }
}
