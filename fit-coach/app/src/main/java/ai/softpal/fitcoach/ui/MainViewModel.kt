package ai.softpal.fitcoach.ui

import ai.softpal.fitcoach.core.ActivityEntry
import ai.softpal.fitcoach.core.AppData
import ai.softpal.fitcoach.core.EnergyCalculator
import ai.softpal.fitcoach.core.Encouragement
import ai.softpal.fitcoach.core.GoalType
import ai.softpal.fitcoach.core.Lang
import ai.softpal.fitcoach.core.MealEntry
import ai.softpal.fitcoach.core.MealSource
import ai.softpal.fitcoach.core.Profile
import ai.softpal.fitcoach.core.Text
import ai.softpal.fitcoach.core.WeightEntry
import ai.softpal.fitcoach.core.exercise.Exercise
import ai.softpal.fitcoach.core.exercise.FreeActivity
import ai.softpal.fitcoach.core.food.Food
import ai.softpal.fitcoach.core.food.FoodAnalysis
import ai.softpal.fitcoach.core.food.FoodAnalysisException
import ai.softpal.fitcoach.core.food.FoodDatabase
import ai.softpal.fitcoach.core.food.ImageLabel
import ai.softpal.fitcoach.data.PhotoAnalysis
import ai.softpal.fitcoach.data.Repository
import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.UUID

/** Zustand der Fotoanalyse. */
sealed interface PhotoState {
    data object Idle : PhotoState
    data object Loading : PhotoState

    data class Ready(
        val bitmap: Bitmap,
        val labels: List<ImageLabel>,
        val suggestions: List<Food>,
        val aiRunning: Boolean = false,
        val ai: FoodAnalysis? = null,
        val aiError: FoodAnalysisException.Reason? = null,
    ) : PhotoState

    data object Failed : PhotoState
}

/** Eine Zeile, die als Mahlzeit gespeichert werden kann. */
data class MealDraft(val name: String, val kcal: Int)

class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val repo = Repository(app)

    val data: StateFlow<AppData> = repo.data
    val apiKey: StateFlow<String> = repo.apiKey
    val model: StateFlow<String> = repo.model

    private val _today = MutableStateFlow(LocalDate.now())
    val today: StateFlow<LocalDate> = _today.asStateFlow()

    private val _photo = MutableStateFlow<PhotoState>(PhotoState.Idle)
    val photo: StateFlow<PhotoState> = _photo.asStateFlow()
    private var photoJob: Job? = null

    /** Positive Rückmeldungen für die Snackbar. */
    private val _messages = Channel<Text>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    fun refreshToday() {
        _today.value = LocalDate.now()
    }

    private fun todayKey() = _today.value.toString()
    private fun now() = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm"))
    private fun newId() = UUID.randomUUID().toString()

    // ---------- Profil & Gewicht ----------

    fun saveProfile(profile: Profile) = viewModelScope.launch {
        val firstTime = repo.data.value.profile == null
        repo.update { d ->
            val withProfile = d.copy(profile = profile)
            val latest = d.weights.maxByOrNull { it.date }
            if (latest == null || latest.kg != profile.weightKg) {
                withProfile.withWeight(WeightEntry(todayKey(), profile.weightKg))
            } else {
                withProfile
            }
        }
        _messages.send(
            if (firstTime) {
                Text("Willkommen! Dein persönlicher Tagesbedarf ist berechnet – los geht's!", "Hoş geldin! Kişisel günlük ihtiyacın hesaplandı – hadi başlayalım!")
            } else {
                Text("Gespeichert! Dein Tagesbedarf ist auf dem neuesten Stand.", "Kaydedildi! Günlük ihtiyacın güncellendi.")
            },
        )
    }

    fun addWeight(kg: Double) = viewModelScope.launch {
        val before = repo.data.value.weights.filter { it.date < todayKey() }.maxByOrNull { it.date }?.kg
        val goal = repo.data.value.profile?.goal ?: GoalType.KEEP
        repo.update { it.withWeight(WeightEntry(todayKey(), kg)) }
        _messages.send(Encouragement.forWeight(before, kg, goal))
    }

    fun deleteWeight(date: String) = viewModelScope.launch {
        repo.update { d -> d.copy(weights = d.weights.filterNot { it.date == date }) }
    }

    // ---------- Mahlzeiten ----------

    fun addMeals(items: List<MealDraft>, source: MealSource) = viewModelScope.launch {
        if (items.isEmpty()) return@launch
        val time = now()
        repo.update { d ->
            d.copy(meals = d.meals + items.map { MealEntry(newId(), todayKey(), time, it.name.trim(), it.kcal, source) })
        }
        _messages.send(Encouragement.forMeal(repo.data.value.meals.size))
    }

    fun deleteMeal(id: String) = viewModelScope.launch {
        repo.update { d -> d.copy(meals = d.meals.filterNot { it.id == id }) }
    }

    // ---------- Bewegung ----------

    private fun weightKg() = repo.data.value.profile?.weightKg ?: 70.0

    fun logExercise(exercise: Exercise, name: String, minutes: Int) =
        logActivity(exercise.id, name, minutes, EnergyCalculator.activityKcal(exercise.met, weightKg(), minutes))

    fun logFreeActivity(activity: FreeActivity, name: String, minutes: Int) =
        logActivity(activity.id, name, minutes, EnergyCalculator.activityKcal(activity.met, weightKg(), minutes))

    private fun logActivity(id: String, name: String, minutes: Int, kcal: Int) = viewModelScope.launch {
        repo.update { d -> d.copy(activities = d.activities + ActivityEntry(newId(), todayKey(), id, name, minutes, kcal)) }
        _messages.send(Encouragement.forActivity(kcal, minutes))
    }

    fun deleteActivity(id: String) = viewModelScope.launch {
        repo.update { d -> d.copy(activities = d.activities.filterNot { it.id == id }) }
    }

    // ---------- Einstellungen ----------

    fun setApiKey(key: String) = repo.setApiKey(key)
    fun setModel(model: String) = repo.setModel(model)

    // ---------- Foto ----------

    fun analyzePhoto(uri: Uri, lang: Lang) {
        photoJob?.cancel()
        photoJob = viewModelScope.launch {
            _photo.value = PhotoState.Loading
            val bitmap = try {
                PhotoAnalysis.loadBitmap(getApplication(), uri)
            } catch (e: Exception) {
                Log.w(TAG, "Foto konnte nicht geladen werden", e)
                _photo.value = PhotoState.Failed
                return@launch
            }
            val labels = try {
                PhotoAnalysis.labelsOnDevice(bitmap)
            } catch (e: Exception) {
                Log.w(TAG, "Bilderkennung nicht verfügbar", e)
                emptyList()
            }
            val key = repo.apiKey.value
            var state = PhotoState.Ready(
                bitmap = bitmap,
                labels = labels,
                suggestions = FoodDatabase.suggestFromLabels(labels),
                aiRunning = key.isNotBlank(),
            )
            _photo.value = state
            if (key.isBlank()) return@launch
            state = try {
                state.copy(aiRunning = false, ai = PhotoAnalysis.analyzeWithChatGpt(bitmap, key, repo.model.value, lang))
            } catch (e: FoodAnalysisException) {
                Log.w(TAG, "KI-Analyse: ${e.reason}", e)
                state.copy(aiRunning = false, aiError = e.reason)
            } catch (e: Exception) {
                Log.w(TAG, "KI-Analyse fehlgeschlagen", e)
                state.copy(aiRunning = false, aiError = FoodAnalysisException.Reason.OTHER)
            }
            _photo.value = state
        }
    }

    fun closePhoto() {
        photoJob?.cancel()
        _photo.value = PhotoState.Idle
    }

    private companion object {
        const val TAG = "FitCoach"
    }
}
