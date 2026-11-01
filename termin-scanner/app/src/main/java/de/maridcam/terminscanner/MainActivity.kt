package de.maridcam.terminscanner

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.content.IntentCompat
import de.maridcam.terminscanner.ui.MainViewModel
import de.maridcam.terminscanner.ui.TerminScannerApp
import de.maridcam.terminscanner.ui.theme.TerminScannerTheme

class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handleShareIntent(intent)
        setContent {
            TerminScannerTheme {
                TerminScannerApp(viewModel)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        // Berechtigung kann in den Systemeinstellungen geändert worden sein
        viewModel.refreshCalendars()
    }

    /** Bild, das aus einer anderen App (z. B. Galerie) an den Termin-Scanner geteilt wurde. */
    private fun handleShareIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND || intent.type?.startsWith("image/") != true) return
        IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let(viewModel::analyze)
    }
}
