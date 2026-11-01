package de.maridcam.terminscanner.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import de.maridcam.terminscanner.R
import de.maridcam.terminscanner.calendar.CalendarRepository
import de.maridcam.terminscanner.calendar.DeviceCalendar
import java.io.File

@Composable
fun TerminScannerApp(viewModel: MainViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when (val screen = state.screen) {
            Screen.Start -> StartScreen(onImage = viewModel::analyze)
            Screen.Processing -> ProcessingScreen()
            is Screen.Review -> ReviewScreen(screen, state, viewModel)
            is Screen.Done -> DoneScreen(screen, viewModel)
            is Screen.Failure -> FailureScreen(screen.message, onBack = viewModel::reset)
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------------------------

/** softpal-Wortmarke, passend zum Theme eingefärbt (schwarz im Light Mode, weiß im Dark Mode). */
@Composable
private fun SoftpalLogo(modifier: Modifier = Modifier, height: Dp = 36.dp) {
    Icon(
        painter = painterResource(R.drawable.softpal_logo),
        contentDescription = stringResource(R.string.brand_name),
        tint = MaterialTheme.colorScheme.onBackground,
        // Seitenverhältnis des Logos: 264 × 56
        modifier = modifier.size(width = height * (264f / 56f), height = height),
    )
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

@Composable
private fun StartScreen(onImage: (Uri) -> Unit) {
    val context = LocalContext.current
    var pendingPhoto by rememberSaveable { mutableStateOf<Uri?>(null) }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val uri = pendingPhoto
        if (success && uri != null) onImage(uri)
    }
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let(onImage)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(PaddingValues(horizontal = 24.dp, vertical = 32.dp)),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SoftpalLogo(
            modifier = Modifier
                .padding(top = 8.dp, bottom = 16.dp)
                .align(Alignment.CenterHorizontally),
        )
        Text(
            stringResource(R.string.start_title),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(stringResource(R.string.start_intro), style = MaterialTheme.typography.bodyLarge)

        Spacer(Modifier.height(8.dp))
        Button(
            onClick = {
                val uri = newPhotoUri(context)
                pendingPhoto = uri
                try {
                    takePicture.launch(uri)
                } catch (e: ActivityNotFoundException) {
                    Toast.makeText(context, R.string.error_no_camera, Toast.LENGTH_LONG).show()
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
        ) {
            Icon(painterResource(R.drawable.ic_camera), contentDescription = null)
            Spacer(Modifier.width(12.dp))
            Text(stringResource(R.string.start_take_photo))
        }
        OutlinedButton(
            onClick = {
                pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
        ) {
            Icon(painterResource(R.drawable.ic_image), contentDescription = null)
            Spacer(Modifier.width(12.dp))
            Text(stringResource(R.string.start_pick_image))
        }

        Spacer(Modifier.height(8.dp))
        InfoCard(title = stringResource(R.string.start_tips_title), text = stringResource(R.string.start_tips))
        Text(
            stringResource(R.string.start_privacy),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun newPhotoUri(context: Context): Uri {
    val dir = File(context.cacheDir, "photos").apply { mkdirs() }
    // alte Fotos aufräumen – sie werden nach der Analyse nicht mehr gebraucht
    dir.listFiles()?.forEach { it.delete() }
    val file = File(dir, "dokument_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
}

// ---------------------------------------------------------------------------------------------
// Verarbeitung
// ---------------------------------------------------------------------------------------------

@Composable
private fun ProcessingScreen() {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.processing), style = MaterialTheme.typography.titleMedium)
    }
}

// ---------------------------------------------------------------------------------------------
// Prüfen & bestätigen
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReviewScreen(screen: Screen.Review, state: UiState, viewModel: MainViewModel) {
    val context = LocalContext.current
    var showConfirm by remember { mutableStateOf(false) }
    var showText by rememberSaveable { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { viewModel.refreshCalendars() }

    BackHandler(onBack = viewModel::reset)

    val selected = screen.drafts.filter { it.selected }
    val titlesValid = selected.all { it.title.isNotBlank() }
    val directSave = state.hasCalendarPermission && state.selectedCalendar != null

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.review_title)) },
                navigationIcon = {
                    IconButton(onClick = viewModel::reset) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = {
                    Icon(
                        painter = painterResource(R.drawable.softpal_mark),
                        contentDescription = stringResource(R.string.brand_name),
                        tint = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier
                            .padding(end = 16.dp)
                            .size(width = 36.dp, height = 20.dp),
                    )
                },
            )
        },
        bottomBar = {
            Column(
                Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(16.dp),
            ) {
                if (!titlesValid) {
                    Text(
                        stringResource(R.string.review_title_missing),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                }
                Button(
                    onClick = { showConfirm = true },
                    enabled = selected.isNotEmpty() && titlesValid && !state.isSaving,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                ) {
                    if (state.isSaving) {
                        CircularProgressIndicator(Modifier.size(24.dp), color = MaterialTheme.colorScheme.onPrimary)
                    } else {
                        Text(
                            if (directSave) {
                                stringResource(R.string.review_submit, selected.size)
                            } else {
                                stringResource(R.string.review_submit_app, selected.size)
                            },
                        )
                    }
                }
            }
        },
    ) { padding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = padding.calculateTopPadding() + 8.dp,
                bottom = padding.calculateBottomPadding() + 16.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                when (screen.drafts.size) {
                    0 -> InfoCard(
                        title = stringResource(R.string.review_none_title),
                        text = stringResource(R.string.review_none_text),
                        warning = true,
                    )
                    1 -> Text(stringResource(R.string.review_found_one))
                    else -> Text(stringResource(R.string.review_found_many, screen.drafts.size))
                }
            }

            item {
                CalendarSection(
                    state = state,
                    onRequestPermission = { permissionLauncher.launch(CalendarRepository.PERMISSIONS) },
                    onSelect = viewModel::selectCalendar,
                )
            }

            items(screen.drafts, key = { it.id }) { draft ->
                AppointmentCard(
                    draft = draft,
                    onChange = viewModel::updateDraft,
                    onRemove = { viewModel.removeDraft(draft.id) },
                )
            }

            item {
                TextButton(onClick = viewModel::addEmptyDraft) {
                    Icon(Icons.Default.Add, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.review_add))
                }
            }

            if (screen.recognizedText.isNotBlank()) {
                item {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    stringResource(R.string.review_recognized_text),
                                    style = MaterialTheme.typography.titleSmall,
                                    modifier = Modifier.weight(1f),
                                )
                                TextButton(onClick = { showText = !showText }) {
                                    Text(stringResource(if (showText) R.string.review_hide else R.string.review_show))
                                }
                            }
                            if (showText) {
                                SelectionContainer {
                                    Text(screen.recognizedText, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showConfirm) {
        ConfirmDialog(
            drafts = selected,
            calendar = state.selectedCalendar.takeIf { directSave },
            onConfirm = {
                showConfirm = false
                if (directSave) {
                    viewModel.saveConfirmed()
                } else {
                    // Ohne Kalender-Berechtigung: Kalender-App mit vorausgefüllten Terminen öffnen
                    selected.forEach { draft ->
                        try {
                            context.startActivity(viewModel.calendarRepository.insertViaCalendarAppIntent(draft))
                        } catch (e: ActivityNotFoundException) {
                            Toast.makeText(context, R.string.calendar_none, Toast.LENGTH_LONG).show()
                        }
                    }
                }
            },
            onDismiss = { showConfirm = false },
        )
    }
}

@Composable
private fun CalendarSection(
    state: UiState,
    onRequestPermission: () -> Unit,
    onSelect: (Long) -> Unit,
) {
    when {
        !state.hasCalendarPermission -> Card(
            Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.calendar_permission_title), style = MaterialTheme.typography.titleSmall)
                Text(stringResource(R.string.calendar_permission_text), style = MaterialTheme.typography.bodyMedium)
                Button(onClick = onRequestPermission) { Text(stringResource(R.string.calendar_permission_grant)) }
            }
        }

        state.calendars.isEmpty() -> InfoCard(
            title = stringResource(R.string.calendar_target),
            text = stringResource(R.string.calendar_none),
            warning = true,
        )

        else -> CalendarSelector(state.calendars, state.selectedCalendar, onSelect)
    }
}

@Composable
private fun CalendarSelector(calendars: List<DeviceCalendar>, selected: DeviceCalendar?, onSelect: (Long) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(
            stringResource(R.string.calendar_target),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Box {
            OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
                selected?.let { CalendarColorDot(it.color) }
                Spacer(Modifier.width(8.dp))
                Text(selected?.let(::calendarLabel).orEmpty(), modifier = Modifier.weight(1f))
                Icon(Icons.Default.ArrowDropDown, contentDescription = null)
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                calendars.forEach { calendar ->
                    DropdownMenuItem(
                        leadingIcon = { CalendarColorDot(calendar.color) },
                        text = { Text(calendarLabel(calendar)) },
                        onClick = {
                            onSelect(calendar.id)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

private fun calendarLabel(calendar: DeviceCalendar): String =
    if (calendar.accountName.isNotBlank() && calendar.accountName != calendar.displayName) {
        "${calendar.displayName} (${calendar.accountName})"
    } else {
        calendar.displayName
    }

@Composable
private fun CalendarColorDot(color: Int) {
    Surface(shape = CircleShape, color = Color(color), modifier = Modifier.size(12.dp)) {}
}

@Composable
private fun ConfirmDialog(
    drafts: List<AppointmentDraft>,
    calendar: DeviceCalendar?,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.confirm_title)) },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    if (calendar != null) {
                        stringResource(R.string.confirm_text, calendarLabel(calendar))
                    } else {
                        stringResource(R.string.confirm_text_app)
                    },
                )
                drafts.forEach { draft ->
                    HorizontalDivider()
                    Column {
                        Text(draft.title, fontWeight = FontWeight.SemiBold)
                        Text(draft.whenText(), style = MaterialTheme.typography.bodyMedium)
                        if (draft.location.isNotBlank()) {
                            Text(draft.location, style = MaterialTheme.typography.bodyMedium)
                        }
                        Text(
                            reminderLabel(draft.reminderMinutes),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        },
        confirmButton = { Button(onClick = onConfirm) { Text(stringResource(R.string.confirm_yes)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.confirm_no)) } },
    )
}

// ---------------------------------------------------------------------------------------------
// Ergebnis
// ---------------------------------------------------------------------------------------------

@Composable
private fun DoneScreen(screen: Screen.Done, viewModel: MainViewModel) {
    val context = LocalContext.current
    BackHandler(onBack = viewModel::reset)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(PaddingValues(horizontal = 24.dp, vertical = 32.dp)),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.done_title), style = MaterialTheme.typography.headlineMedium)

        screen.results.forEach { result ->
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.Top) {
                    val (icon, tint) = when (result) {
                        is SaveResult.Saved -> Icons.Default.CheckCircle to MaterialTheme.colorScheme.primary
                        is SaveResult.Duplicate -> Icons.Default.Info to MaterialTheme.colorScheme.secondary
                        is SaveResult.Failed -> Icons.Default.Warning to MaterialTheme.colorScheme.error
                    }
                    Icon(icon, contentDescription = null, tint = tint)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(result.draft.title, fontWeight = FontWeight.SemiBold)
                        Text(result.draft.whenText(), style = MaterialTheme.typography.bodyMedium)
                        Text(
                            when (result) {
                                is SaveResult.Saved -> stringResource(R.string.done_saved)
                                is SaveResult.Duplicate -> stringResource(R.string.done_duplicate)
                                is SaveResult.Failed -> stringResource(R.string.done_failed, result.reason)
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = tint,
                        )
                        if (result is SaveResult.Saved) {
                            TextButton(onClick = {
                                try {
                                    context.startActivity(viewModel.calendarRepository.viewEventIntent(result.eventId))
                                } catch (e: ActivityNotFoundException) {
                                    Toast.makeText(context, R.string.calendar_none, Toast.LENGTH_LONG).show()
                                }
                            }) { Text(stringResource(R.string.done_open)) }
                        }
                    }
                }
            }
        }

        Button(onClick = viewModel::reset, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.done_again))
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Fehler & Hilfs-Komponenten
// ---------------------------------------------------------------------------------------------

@Composable
private fun FailureScreen(message: String, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.failure_title), style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.failure_text, message), textAlign = TextAlign.Center)
        Spacer(Modifier.height(24.dp))
        Button(onClick = onBack) { Text(stringResource(R.string.failure_retry)) }
    }
}

@Composable
private fun InfoCard(title: String, text: String, warning: Boolean = false) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (warning) {
                MaterialTheme.colorScheme.errorContainer
            } else {
                MaterialTheme.colorScheme.surfaceContainerHigh
            },
        ),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
