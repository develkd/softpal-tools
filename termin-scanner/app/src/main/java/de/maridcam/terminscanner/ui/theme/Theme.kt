package de.maridcam.terminscanner.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
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
)

/**
 * App-Theme im softpal-Branding. Dynamische Systemfarben (Material You) sind bewusst
 * deaktiviert, damit die Markenfarben auf allen Geräten gleich aussehen.
 */
@Composable
fun TerminScannerTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(colorScheme = if (darkTheme) DarkColors else LightColors, content = content)
}
