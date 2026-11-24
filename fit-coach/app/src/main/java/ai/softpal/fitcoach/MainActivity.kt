package ai.softpal.fitcoach

import ai.softpal.fitcoach.ui.FitCoachApp
import ai.softpal.fitcoach.ui.theme.FitCoachTheme
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity

/** AppCompatActivity, damit die Sprache in der App umgeschaltet werden kann (AppCompatDelegate). */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            FitCoachTheme {
                FitCoachApp()
            }
        }
    }
}
