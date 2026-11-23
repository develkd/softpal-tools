package ai.softpal.fitcoach.ui

import ai.softpal.fitcoach.R
import ai.softpal.fitcoach.core.Profile
import ai.softpal.fitcoach.ui.components.SectionCard
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun SettingsScreen(vm: MainViewModel, profile: Profile) {
    val savedKey by vm.apiKey.collectAsStateWithLifecycle()
    var key by rememberSaveable(savedKey) { mutableStateOf(savedKey) }

    Column(Modifier.verticalScroll(rememberScrollState()).imePadding()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(stringResource(R.string.settings), style = MaterialTheme.typography.headlineSmall)
            SectionCard(title = stringResource(R.string.language)) {
                LanguagePicker()
            }
            SectionCard(title = stringResource(R.string.ai_settings_title)) {
                Text(stringResource(R.string.ai_settings_text), style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = key, onValueChange = { key = it.trim() }, singleLine = true,
                    label = { Text(stringResource(R.string.api_key)) },
                    placeholder = { Text("sk-ant-…") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilledTonalButton(onClick = { vm.setApiKey(key) }, enabled = key != savedKey) { Text(stringResource(R.string.save)) }
                    if (savedKey.isNotBlank()) {
                        TextButton(onClick = { key = ""; vm.setApiKey("") }) { Text(stringResource(R.string.remove_key)) }
                    }
                }
                Text(
                    stringResource(if (savedKey.isBlank()) R.string.ai_status_off else R.string.ai_status_on),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            SectionCard(title = stringResource(R.string.privacy_title)) {
                Text(stringResource(R.string.privacy_text), style = MaterialTheme.typography.bodySmall)
            }
            Text(stringResource(R.string.profile_and_goal), style = MaterialTheme.typography.titleLarge)
        }
        ProfileScreen(initial = profile, onSave = vm::saveProfile, isOnboarding = false)
    }
}
