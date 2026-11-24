package ai.softpal.fitcoach.ui

import ai.softpal.fitcoach.R
import ai.softpal.fitcoach.ui.components.SoftpalLogo
import ai.softpal.fitcoach.ui.components.currentLang
import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel

enum class Tab(@param:StringRes val label: Int, @param:DrawableRes val icon: Int?) {
    DASHBOARD(R.string.tab_dashboard, null),
    FOOD(R.string.tab_food, R.drawable.ic_food),
    SPORT(R.string.tab_sport, R.drawable.ic_sport),
    WEIGHT(R.string.tab_weight, R.drawable.ic_weight),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FitCoachApp(vm: MainViewModel = viewModel()) {
    val data by vm.data.collectAsStateWithLifecycle()
    val today by vm.today.collectAsStateWithLifecycle()
    val lang = currentLang()
    val snackbar = remember { SnackbarHostState() }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refreshToday() }
    LaunchedEffect(vm, lang) {
        vm.messages.collect { snackbar.showSnackbar(it[lang]) }
    }

    val profile = data.profile
    if (profile == null) {
        // Erster Start: Profil einrichten
        ProfileScreen(initial = null, onSave = vm::saveProfile, isOnboarding = true)
        return
    }

    var tab by rememberSaveable { mutableStateOf(Tab.DASHBOARD) }
    var showSettings by rememberSaveable { mutableStateOf(false) }
    var openExercise by rememberSaveable { mutableStateOf<String?>(null) }

    BackHandler(enabled = showSettings || openExercise != null || tab != Tab.DASHBOARD) {
        when {
            openExercise != null -> openExercise = null
            showSettings -> showSettings = false
            else -> tab = Tab.DASHBOARD
        }
    }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { SoftpalLogo() },
                navigationIcon = {
                    if (showSettings || openExercise != null) {
                        IconButton(onClick = { if (openExercise != null) openExercise = null else showSettings = false }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                        }
                    }
                },
                actions = {
                    if (!showSettings) {
                        IconButton(onClick = { openExercise = null; showSettings = true }) {
                            Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.settings))
                        }
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t && !showSettings && openExercise == null,
                        onClick = { tab = t; showSettings = false; openExercise = null },
                        icon = {
                            if (t.icon != null) Icon(painterResource(t.icon), contentDescription = null)
                            else Icon(Icons.Filled.Home, contentDescription = null)
                        },
                        label = { Text(stringResource(t.label)) },
                    )
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Box(Modifier.padding(padding)) {
            when {
                showSettings -> SettingsScreen(vm, profile)
                openExercise != null -> ExerciseDetailScreen(
                    exerciseId = openExercise!!,
                    level = profile.activity,
                    onDone = { exercise, name, minutes ->
                        vm.logExercise(exercise, name, minutes)
                        openExercise = null
                    },
                )
                else -> when (tab) {
                    Tab.DASHBOARD -> DashboardScreen(data, today, onNavigate = { tab = it })
                    Tab.FOOD -> FoodScreen(vm, data, today)
                    Tab.SPORT -> SportScreen(vm, data, today, onOpen = { openExercise = it })
                    Tab.WEIGHT -> WeightScreen(vm, data, today)
                }
            }
        }
    }
}
