package ai.softpal.fitcoach.data

import ai.softpal.fitcoach.core.AppData
import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Speichert alle Daten als JSON-Datei im privaten App-Speicher (keine Cloud, kein Konto).
 * Der OpenAI-API-Schlüssel für die KI-Analyse (ChatGPT) liegt getrennt in privaten SharedPreferences.
 */
class Repository(context: Context) {

    private val file = File(context.filesDir, "fitcoach.json")
    private val secrets = context.getSharedPreferences("secrets", Context.MODE_PRIVATE)
    private val mutex = Mutex()

    private val _data = MutableStateFlow(load())
    val data: StateFlow<AppData> = _data.asStateFlow()

    private val _apiKey = MutableStateFlow(secrets.getString(KEY_API, null).orEmpty())
    val apiKey: StateFlow<String> = _apiKey.asStateFlow()

    private val _model = MutableStateFlow(secrets.getString(KEY_MODEL, null).orEmpty())

    /** Gewähltes OpenAI-Modell; leer = Standardmodell. */
    val model: StateFlow<String> = _model.asStateFlow()

    init {
        // Schlüssel aus der früheren Claude-Anbindung entfernen
        if (secrets.contains(KEY_OLD_ANTHROPIC)) secrets.edit().remove(KEY_OLD_ANTHROPIC).apply()
    }

    private fun load(): AppData = try {
        if (file.exists()) AppData.fromJson(file.readText()) else AppData()
    } catch (e: Exception) {
        Log.w(TAG, "Daten konnten nicht gelesen werden, Sicherung angelegt", e)
        file.copyTo(File(file.parentFile, "fitcoach.backup.json"), overwrite = true)
        AppData()
    }

    suspend fun update(transform: (AppData) -> AppData) = mutex.withLock {
        val next = transform(_data.value)
        _data.value = next
        withContext(Dispatchers.IO) {
            val tmp = File(file.parentFile, "fitcoach.json.tmp")
            tmp.writeText(next.toJson())
            if (!tmp.renameTo(file)) {
                file.writeText(next.toJson())
                tmp.delete()
            }
        }
    }

    fun setApiKey(key: String) {
        val trimmed = key.trim()
        secrets.edit().putString(KEY_API, trimmed).apply()
        _apiKey.value = trimmed
    }

    fun setModel(model: String) {
        val trimmed = model.trim()
        secrets.edit().putString(KEY_MODEL, trimmed).apply()
        _model.value = trimmed
    }

    private companion object {
        const val TAG = "FitCoach"
        const val KEY_API = "openai_api_key"
        const val KEY_MODEL = "openai_model"
        const val KEY_OLD_ANTHROPIC = "anthropic_api_key"
    }
}
