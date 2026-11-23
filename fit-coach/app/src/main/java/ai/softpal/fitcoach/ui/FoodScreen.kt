package ai.softpal.fitcoach.ui

import ai.softpal.fitcoach.R
import ai.softpal.fitcoach.core.AppData
import ai.softpal.fitcoach.core.Lang
import ai.softpal.fitcoach.core.MealSource
import ai.softpal.fitcoach.core.food.Food
import ai.softpal.fitcoach.core.food.FoodAnalysisException.Reason
import ai.softpal.fitcoach.core.food.FoodDatabase
import ai.softpal.fitcoach.ui.components.NumberField
import ai.softpal.fitcoach.ui.components.SectionCard
import ai.softpal.fitcoach.ui.components.currentLang
import ai.softpal.fitcoach.ui.components.formatKcal
import ai.softpal.fitcoach.ui.components.local
import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.io.File
import java.time.LocalDate
import kotlin.math.roundToInt

@Composable
fun FoodScreen(vm: MainViewModel, data: AppData, today: LocalDate) {
    val context = LocalContext.current
    val lang = currentLang()
    val apiKey by vm.apiKey.collectAsStateWithLifecycle()
    val photo by vm.photo.collectAsStateWithLifecycle()
    var pendingPhoto by rememberSaveable { mutableStateOf<Uri?>(null) }
    var showManual by rememberSaveable { mutableStateOf(false) }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val uri = pendingPhoto
        if (success && uri != null) vm.analyzePhoto(uri, lang)
    }
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { vm.analyzePhoto(it, lang) }
    }

    val meals = data.meals.filter { it.date == today.toString() }.sortedBy { it.time }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SectionCard(title = stringResource(R.string.photo_title)) {
            Text(stringResource(R.string.photo_text), style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        val uri = newPhotoUri(context)
                        pendingPhoto = uri
                        takePicture.launch(uri)
                    },
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(painterResource(R.drawable.ic_camera), contentDescription = null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.take_photo))
                }
                OutlinedButton(
                    onClick = { pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(painterResource(R.drawable.ic_image), contentDescription = null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.from_gallery))
                }
            }
            TextButton(onClick = { showManual = true }) {
                Icon(Icons.Filled.Edit, contentDescription = null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.enter_manually))
            }
            Text(
                stringResource(if (apiKey.isBlank()) R.string.photo_mode_device else R.string.photo_mode_ai),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        SectionCard(title = stringResource(R.string.meals_today)) {
            if (meals.isEmpty()) {
                Text(stringResource(R.string.meals_empty), style = MaterialTheme.typography.bodyMedium)
            } else {
                meals.forEach { meal ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(meal.name, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(meal.time, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(formatKcal(meal.kcal), fontWeight = FontWeight.SemiBold)
                        IconButton(onClick = { vm.deleteMeal(meal.id) }) {
                            Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.delete))
                        }
                    }
                }
                HorizontalDivider()
                Row {
                    Text(stringResource(R.string.total), Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                    Text(formatKcal(meals.sumOf { it.kcal }), fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(48.dp))
                }
            }
        }
    }

    if (photo != PhotoState.Idle) {
        PhotoDialog(
            state = photo,
            onDismiss = vm::closePhoto,
            onSave = { drafts, source ->
                vm.addMeals(drafts, source)
                vm.closePhoto()
            },
        )
    }
    if (showManual) {
        ManualMealDialog(
            onDismiss = { showManual = false },
            onSave = {
                vm.addMeals(listOf(it), MealSource.MANUAL)
                showManual = false
            },
        )
    }
}

private fun newPhotoUri(context: Context): Uri {
    val dir = File(context.cacheDir, "photos").apply { mkdirs() }
    // Alte Fotos aufräumen – sie werden nach der Analyse nicht mehr gebraucht.
    dir.listFiles()?.forEach { it.delete() }
    val file = File(dir, "mahlzeit_${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
}

/** Ergebnis der Fotoanalyse prüfen, anpassen und speichern. */
@Composable
private fun PhotoDialog(state: PhotoState, onDismiss: () -> Unit, onSave: (List<MealDraft>, MealSource) -> Unit) {
    val drafts = remember { mutableStateListOf<MealDraft>() }
    var fromAi by remember { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    val ready = state as? PhotoState.Ready
    val lang = currentLang()

    // KI-Ergebnis automatisch übernehmen, sobald es da ist
    LaunchedEffect(ready?.ai) {
        val ai = ready?.ai ?: return@LaunchedEffect
        drafts.clear()
        drafts.addAll(ai.items.map { MealDraft(it.name, it.kcal) })
        fromAi = true
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.photo_result_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.close)) }
                }
                when (state) {
                    PhotoState.Loading, PhotoState.Idle -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        CircularProgressIndicator(Modifier.size(24.dp))
                        Text(stringResource(R.string.photo_loading))
                    }
                    PhotoState.Failed -> Text(stringResource(R.string.photo_failed))
                    is PhotoState.Ready -> {
                        Image(
                            bitmap = state.bitmap.asImageBitmap(),
                            contentDescription = stringResource(R.string.photo_title),
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxWidth().height(200.dp).clip(RoundedCornerShape(16.dp)),
                        )
                        AiSection(state)
                        DeviceSection(state, onAdd = { food, factor ->
                            val grams = (food.portionGrams * factor).roundToInt()
                            drafts.add(MealDraft(foodLabel(food, factor, lang), food.kcalFor(grams)))
                        })
                    }
                }

                if (ready != null) {
                    SectionCard(title = stringResource(R.string.search_food)) {
                        OutlinedTextField(
                            value = query, onValueChange = { query = it }, singleLine = true,
                            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                            placeholder = { Text(stringResource(R.string.search_food_hint)) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        if (query.isNotBlank()) {
                            FoodDatabase.search(query, limit = 6).forEach { food ->
                                FoodRow(food) { factor ->
                                    val grams = (food.portionGrams * factor).roundToInt()
                                    drafts.add(MealDraft(foodLabel(food, factor, lang), food.kcalFor(grams)))
                                }
                            }
                        }
                    }

                    SectionCard(title = stringResource(R.string.your_meal)) {
                        if (drafts.isEmpty()) {
                            Text(stringResource(R.string.your_meal_empty), style = MaterialTheme.typography.bodyMedium)
                        }
                        drafts.forEachIndexed { i, d ->
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedTextField(
                                    value = d.name, onValueChange = { drafts[i] = d.copy(name = it) },
                                    singleLine = true, modifier = Modifier.weight(1f),
                                )
                                NumberField(
                                    value = d.kcal.toString(), onValueChange = { drafts[i] = d.copy(kcal = it.toIntOrNull() ?: 0) },
                                    label = "", suffix = "kcal", modifier = Modifier.width(120.dp),
                                )
                                IconButton(onClick = { drafts.removeAt(i) }) {
                                    Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.delete))
                                }
                            }
                        }
                        if (drafts.isNotEmpty()) {
                            Text(
                                stringResource(R.string.total) + ": " + formatKcal(drafts.sumOf { it.kcal }),
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                    Button(
                        onClick = { onSave(drafts.filter { it.name.isNotBlank() }, if (fromAi) MealSource.PHOTO_AI else MealSource.PHOTO_DEVICE) },
                        enabled = drafts.any { it.name.isNotBlank() },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) { Text(stringResource(R.string.save_meal)) }
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

@Composable
private fun AiSection(state: PhotoState.Ready) {
    when {
        state.aiRunning -> SectionCard(title = stringResource(R.string.ai_title)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator(Modifier.size(24.dp))
                Text(stringResource(R.string.ai_running))
            }
        }
        state.ai != null -> SectionCard(title = stringResource(R.string.ai_title)) {
            if (state.ai.items.isEmpty()) {
                Text(state.ai.note.ifBlank { stringResource(R.string.ai_nothing) })
            } else {
                Text(stringResource(R.string.ai_result, formatKcal(state.ai.totalKcal)), fontWeight = FontWeight.SemiBold)
                state.ai.items.forEach {
                    Text("• ${it.name} (${it.grams} g): ${formatKcal(it.kcal)}", style = MaterialTheme.typography.bodyMedium)
                }
                if (state.ai.note.isNotBlank()) Text("✨ " + state.ai.note, style = MaterialTheme.typography.bodyMedium)
            }
        }
        state.aiError != null -> SectionCard(title = stringResource(R.string.ai_title)) {
            Text(
                stringResource(
                    when (state.aiError) {
                        Reason.INVALID_KEY -> R.string.ai_error_key
                        Reason.BUSY -> R.string.ai_error_busy
                        Reason.NETWORK -> R.string.ai_error_network
                        else -> R.string.ai_error_other
                    },
                ),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun DeviceSection(state: PhotoState.Ready, onAdd: (Food, Double) -> Unit) {
    SectionCard(title = stringResource(R.string.device_title)) {
        if (state.labels.isNotEmpty()) {
            Text(
                stringResource(R.string.device_labels, state.labels.take(5).joinToString { it.text }),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (state.suggestions.isEmpty()) {
            Text(stringResource(R.string.device_no_match), style = MaterialTheme.typography.bodyMedium)
        } else {
            Text(stringResource(R.string.device_pick), style = MaterialTheme.typography.bodyMedium)
            state.suggestions.forEach { food -> FoodRow(food) { onAdd(food, it) } }
        }
    }
}

/** Lebensmittel mit Portionsfaktoren zum Hinzufügen. */
@Composable
private fun FoodRow(food: Food, onAdd: (Double) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(food.name.local(), fontWeight = FontWeight.Medium)
        Text(
            stringResource(R.string.portion_info, food.portionGrams, formatKcal(food.portionKcal)),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(0.5 to "½", 1.0 to "1", 1.5 to "1½", 2.0 to "2").forEach { (factor, label) ->
                AssistChip(
                    onClick = { onAdd(factor) },
                    label = { Text("$label ×") },
                    leadingIcon = { Icon(Icons.Filled.Add, contentDescription = null, Modifier.size(16.dp)) },
                )
            }
        }
    }
}

private fun foodLabel(food: Food, factor: Double, lang: Lang): String {
    val name = food.name[lang]
    val f = when (factor) {
        1.0 -> return name
        0.5 -> "½"
        1.5 -> "1½"
        else -> factor.roundToInt().toString()
    }
    return "$name ($f ×)"
}

/** Mahlzeit von Hand eintragen, mit Vorschlägen aus der Lebensmittel-Tabelle. */
@Composable
private fun ManualMealDialog(onDismiss: () -> Unit, onSave: (MealDraft) -> Unit) {
    val lang = currentLang()
    var name by rememberSaveable { mutableStateOf("") }
    var kcal by rememberSaveable { mutableStateOf("") }
    val matches = if (name.length >= 2) FoodDatabase.search(name, limit = 4) else emptyList()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.enter_manually)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                OutlinedTextField(
                    value = name, onValueChange = { name = it }, singleLine = true,
                    label = { Text(stringResource(R.string.meal_name)) }, modifier = Modifier.fillMaxWidth(),
                )
                matches.forEach { food ->
                    Text(
                        "${food.name.local()} · ${formatKcal(food.portionKcal)}",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { name = food.name[lang]; kcal = food.portionKcal.toString() }
                            .padding(vertical = 6.dp, horizontal = 4.dp),
                    )
                }
                NumberField(kcal, { kcal = it }, stringResource(R.string.calories), "kcal", Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            FilledTonalButton(
                onClick = { onSave(MealDraft(name, kcal.toIntOrNull() ?: 0)) },
                enabled = name.isNotBlank() && (kcal.toIntOrNull() ?: 0) > 0,
            ) { Text(stringResource(R.string.save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
