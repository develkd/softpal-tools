package de.maridcam.terminscanner.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import de.maridcam.terminscanner.calendar.CalendarRepository
import de.maridcam.terminscanner.calendar.DeviceCalendar
import de.maridcam.terminscanner.extraction.AppointmentExtractor
import de.maridcam.terminscanner.ocr.TextRecognitionService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate

sealed interface Screen {
    /** Startbildschirm: Foto aufnehmen oder Bild wählen. */
    data object Start : Screen

    /** Texterkennung läuft. */
    data object Processing : Screen

    /** Erkannte Termine prüfen, bearbeiten und bestätigen. */
    data class Review(val drafts: List<AppointmentDraft>, val recognizedText: String) : Screen

    /** Ergebnis nach dem Eintragen. */
    data class Done(val results: List<SaveResult>) : Screen

    data class Failure(val message: String) : Screen
}

sealed interface SaveResult {
    val draft: AppointmentDraft

    data class Saved(override val draft: AppointmentDraft, val eventId: Long) : SaveResult
    data class Duplicate(override val draft: AppointmentDraft) : SaveResult
    data class Failed(override val draft: AppointmentDraft, val reason: String) : SaveResult
}

data class UiState(
    val screen: Screen = Screen.Start,
    val hasCalendarPermission: Boolean = false,
    val calendars: List<DeviceCalendar> = emptyList(),
    val selectedCalendarId: Long? = null,
    val isSaving: Boolean = false,
) {
    val selectedCalendar: DeviceCalendar? get() = calendars.firstOrNull { it.id == selectedCalendarId }
}

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val textRecognition = TextRecognitionService(application)
    val calendarRepository = CalendarRepository(application)

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var nextDraftId = 1L

    init {
        refreshCalendars()
    }

    /** Foto analysieren: Text erkennen → Termine suchen → Prüfansicht zeigen. */
    fun analyze(imageUri: Uri) {
        _state.update { it.copy(screen = Screen.Processing) }
        viewModelScope.launch {
            val screen = try {
                val document = textRecognition.recognize(imageUri)
                val candidates = withContext(Dispatchers.Default) {
                    AppointmentExtractor.extract(document.lines, LocalDate.now())
                }
                Screen.Review(
                    drafts = candidates.map { AppointmentDraft.from(it, nextDraftId++) },
                    recognizedText = document.fullText,
                )
            } catch (e: Exception) {
                Screen.Failure(e.localizedMessage ?: e.javaClass.simpleName)
            }
            _state.update { it.copy(screen = screen) }
        }
    }

    fun refreshCalendars() {
        viewModelScope.launch {
            val hasPermission = calendarRepository.hasPermission()
            val calendars = withContext(Dispatchers.IO) { calendarRepository.writableCalendars() }
            _state.update { current ->
                val keepSelection = calendars.any { it.id == current.selectedCalendarId }
                current.copy(
                    hasCalendarPermission = hasPermission,
                    calendars = calendars,
                    selectedCalendarId = if (keepSelection) current.selectedCalendarId else calendars.firstOrNull()?.id,
                )
            }
        }
    }

    fun selectCalendar(id: Long) = _state.update { it.copy(selectedCalendarId = id) }

    fun updateDraft(draft: AppointmentDraft) = updateReview { drafts -> drafts.map { if (it.id == draft.id) draft else it } }

    fun removeDraft(id: Long) = updateReview { drafts -> drafts.filterNot { it.id == id } }

    fun addEmptyDraft() = updateReview { drafts -> drafts + AppointmentDraft.empty(nextDraftId++) }

    private fun updateReview(change: (List<AppointmentDraft>) -> List<AppointmentDraft>) = _state.update { s ->
        val review = s.screen as? Screen.Review ?: return@update s
        s.copy(screen = review.copy(drafts = change(review.drafts)))
    }

    /** Wird erst nach der ausdrücklichen Bestätigung im Dialog aufgerufen. */
    fun saveConfirmed() {
        val current = _state.value
        val review = current.screen as? Screen.Review ?: return
        val calendarId = current.selectedCalendarId ?: return
        val drafts = review.drafts.filter { it.selected }
        if (drafts.isEmpty() || current.isSaving) return

        _state.update { it.copy(isSaving = true) }
        viewModelScope.launch {
            val results = withContext(Dispatchers.IO) {
                drafts.map { draft ->
                    try {
                        if (calendarRepository.alreadyExists(calendarId, draft)) {
                            SaveResult.Duplicate(draft)
                        } else {
                            SaveResult.Saved(draft, calendarRepository.insert(calendarId, draft))
                        }
                    } catch (e: Exception) {
                        SaveResult.Failed(draft, e.localizedMessage ?: e.javaClass.simpleName)
                    }
                }
            }
            _state.update { it.copy(isSaving = false, screen = Screen.Done(results)) }
        }
    }

    fun reset() = _state.update { it.copy(screen = Screen.Start) }

    override fun onCleared() {
        textRecognition.close()
    }
}
