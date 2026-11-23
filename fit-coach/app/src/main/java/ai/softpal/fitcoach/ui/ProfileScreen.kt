package ai.softpal.fitcoach.ui

import ai.softpal.fitcoach.R
import ai.softpal.fitcoach.core.ActivityLevel
import ai.softpal.fitcoach.core.EnergyCalculator
import ai.softpal.fitcoach.core.GoalType
import ai.softpal.fitcoach.core.Lang
import ai.softpal.fitcoach.core.Profile
import ai.softpal.fitcoach.core.Sex
import ai.softpal.fitcoach.ui.components.NumberField
import ai.softpal.fitcoach.ui.components.SectionCard
import ai.softpal.fitcoach.ui.components.SoftpalLogo
import ai.softpal.fitcoach.ui.components.currentLang
import ai.softpal.fitcoach.ui.components.formatKcal
import ai.softpal.fitcoach.ui.components.parseDecimal
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.os.LocaleListCompat
import kotlin.math.roundToInt

/** Sprache der App umstellen (Deutsch / Türkçe). Die Oberfläche wird dabei neu aufgebaut. */
@Composable
fun LanguagePicker(modifier: Modifier = Modifier) {
    val lang = currentLang()
    SingleChoiceSegmentedButtonRow(modifier.fillMaxWidth()) {
        listOf(Lang.DE to "Deutsch", Lang.TR to "Türkçe").forEachIndexed { i, (l, label) ->
            SegmentedButton(
                selected = lang == l,
                onClick = {
                    AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(if (l == Lang.TR) "tr" else "de"))
                },
                shape = SegmentedButtonDefaults.itemShape(i, 2),
            ) { Text(label) }
        }
    }
}

@Composable
fun ProfileScreen(initial: Profile?, onSave: (Profile) -> Unit, isOnboarding: Boolean) {
    var age by rememberSaveable { mutableStateOf(initial?.age?.toString().orEmpty()) }
    var sex by rememberSaveable { mutableStateOf(initial?.sex) }
    var height by rememberSaveable { mutableStateOf(initial?.heightCm?.let { trimNumber(it) }.orEmpty()) }
    var weight by rememberSaveable { mutableStateOf(initial?.weightKg?.let { trimNumber(it) }.orEmpty()) }
    var activity by rememberSaveable { mutableStateOf(initial?.activity) }
    var goal by rememberSaveable { mutableStateOf(initial?.goal ?: GoalType.KEEP) }
    var customOn by rememberSaveable { mutableStateOf(initial?.customGoalKcal != null) }
    var custom by rememberSaveable { mutableStateOf(initial?.customGoalKcal?.toString().orEmpty()) }

    val draft = run {
        val a = age.toIntOrNull()
        val h = parseDecimal(height)
        val w = parseDecimal(weight)
        val s = sex
        val act = activity
        if (a != null && h != null && w != null && s != null && act != null) {
            Profile(a, s, h, w, act, goal, if (customOn) custom.toIntOrNull() ?: -1 else null)
        } else {
            null
        }
    }
    val recommended = draft?.copy(customGoalKcal = null)?.takeIf { it.isValid() }?.let { EnergyCalculator.recommendedGoal(it) }

    val content: @Composable () -> Unit = {
        // In den Einstellungen ist das Formular Teil einer bereits scrollbaren Seite.
        val outer = if (isOnboarding) Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding() else Modifier.fillMaxWidth()
        Column(
            outer.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (isOnboarding) {
                SoftpalLogo(height = 24.dp)
                Text(stringResource(R.string.welcome_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text(stringResource(R.string.welcome_text), style = MaterialTheme.typography.bodyLarge)
                LanguagePicker()
            }

            SectionCard(title = stringResource(R.string.profile_about_you)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    NumberField(
                        age, { age = it }, stringResource(R.string.age), stringResource(R.string.years),
                        Modifier.weight(1f),
                        isError = age.isNotEmpty() && age.toIntOrNull() !in Profile.MIN_AGE..Profile.MAX_AGE,
                    )
                    NumberField(
                        height, { height = it }, stringResource(R.string.height), "cm", Modifier.weight(1f), decimal = true,
                        isError = height.isNotEmpty() && (parseDecimal(height) ?: 0.0) !in Profile.MIN_HEIGHT..Profile.MAX_HEIGHT,
                    )
                }
                NumberField(
                    weight, { weight = it }, stringResource(R.string.current_weight), "kg", Modifier.fillMaxWidth(), decimal = true,
                    isError = weight.isNotEmpty() && (parseDecimal(weight) ?: 0.0) !in Profile.MIN_WEIGHT..Profile.MAX_WEIGHT,
                )
                Text(stringResource(R.string.sex), style = MaterialTheme.typography.labelLarge)
                val sexes = listOf(Sex.FEMALE to R.string.sex_female, Sex.MALE to R.string.sex_male, Sex.DIVERSE to R.string.sex_diverse)
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    sexes.forEachIndexed { i, (s, label) ->
                        SegmentedButton(
                            selected = sex == s,
                            onClick = { sex = s },
                            shape = SegmentedButtonDefaults.itemShape(i, sexes.size),
                        ) { Text(stringResource(label)) }
                    }
                }
            }

            SectionCard(title = stringResource(R.string.activity_level)) {
                val levels = listOf(
                    Triple(ActivityLevel.SPORTY, R.string.level_sporty, R.string.level_sporty_desc),
                    Triple(ActivityLevel.NORMAL, R.string.level_normal, R.string.level_normal_desc),
                    Triple(ActivityLevel.UNSPORTY, R.string.level_unsporty, R.string.level_unsporty_desc),
                )
                levels.forEach { (level, title, desc) ->
                    val selected = activity == level
                    OutlinedCard(
                        onClick = { activity = level },
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = selected, onClick = { activity = level })
                            Column {
                                Text(stringResource(title), fontWeight = FontWeight.SemiBold)
                                Text(stringResource(desc), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }

            SectionCard(title = stringResource(R.string.daily_goal)) {
                Text(stringResource(R.string.goal_type), style = MaterialTheme.typography.labelLarge)
                val goals = listOf(GoalType.LOSE to R.string.goal_lose, GoalType.KEEP to R.string.goal_keep, GoalType.GAIN to R.string.goal_gain)
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    goals.forEachIndexed { i, (g, label) ->
                        SegmentedButton(
                            selected = goal == g,
                            onClick = { goal = g },
                            shape = SegmentedButtonDefaults.itemShape(i, goals.size),
                        ) { Text(stringResource(label)) }
                    }
                }
                if (recommended != null) {
                    Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = RoundedCornerShape(12.dp)) {
                        Column(Modifier.fillMaxWidth().padding(12.dp)) {
                            Text(stringResource(R.string.recommended_need), style = MaterialTheme.typography.labelLarge)
                            Text(formatKcal(recommended), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                            Text(stringResource(R.string.recommended_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.custom_goal), Modifier.weight(1f))
                    Switch(checked = customOn, onCheckedChange = {
                        customOn = it
                        if (it && custom.isBlank()) custom = recommended?.toString().orEmpty()
                    })
                }
                if (customOn) {
                    NumberField(
                        custom, { custom = it }, stringResource(R.string.custom_goal_field), "kcal", Modifier.fillMaxWidth(),
                        isError = custom.toIntOrNull() !in Profile.MIN_GOAL..Profile.MAX_GOAL,
                        supportingText = stringResource(R.string.custom_goal_range, Profile.MIN_GOAL, Profile.MAX_GOAL),
                    )
                }
            }

            Button(
                onClick = { draft?.let(onSave) },
                enabled = draft?.isValid() == true,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                Text(stringResource(if (isOnboarding) R.string.start_now else R.string.save))
            }
            if (draft?.isValid() != true) {
                Text(stringResource(R.string.profile_fill_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (isOnboarding) {
        Surface(Modifier.fillMaxSize().systemBarsPadding(), color = MaterialTheme.colorScheme.background) { content() }
    } else {
        content()
    }
}

private fun trimNumber(v: Double): String =
    if (v == v.roundToInt().toDouble()) v.roundToInt().toString() else v.toString().replace('.', ',')
