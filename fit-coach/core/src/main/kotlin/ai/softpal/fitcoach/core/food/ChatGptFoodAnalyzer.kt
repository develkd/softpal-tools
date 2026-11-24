package ai.softpal.fitcoach.core.food

import ai.softpal.fitcoach.core.Lang
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.time.Duration
import java.util.Base64

/**
 * Kalorienschätzung aus einem Foto über die OpenAI API (ChatGPT), optional mit eigenem API-Schlüssel.
 *
 * Das Foto (JPEG) wird über die Responses API (`POST /v1/responses`) gesendet; das Modell erkennt die
 * Lebensmittel, schätzt Portionsgrößen und Kalorien und antwortet als JSON nach festem Schema
 * (Structured Outputs, `text.format` = `json_schema`, `strict`). Mit `store: false` wird die Antwort
 * bei OpenAI nicht für spätere Abrufe gespeichert.
 */
class ChatGptFoodAnalyzer(
    private val apiKey: String,
    model: String = DEFAULT_MODEL,
    private val baseUrl: HttpUrl = DEFAULT_BASE_URL.toHttpUrl(),
    private val client: OkHttpClient = defaultClient,
) {
    private val model = model.trim().ifBlank { DEFAULT_MODEL }

    /** Blockierender Aufruf – auf Android aus einem Hintergrund-Thread aufrufen. */
    fun analyze(jpeg: ByteArray, lang: Lang): FoodAnalysis {
        val request = Request.Builder()
            .url(baseUrl.newBuilder().addPathSegment("responses").build())
            .header("Authorization", "Bearer $apiKey")
            .post(buildBody(jpeg, lang).toString().toRequestBody(JSON_MEDIA))
            .build()

        val (code, body) = try {
            client.newCall(request).execute().use { it.code to it.body?.string().orEmpty() }
        } catch (e: IOException) {
            throw FoodAnalysisException(FoodAnalysisException.Reason.NETWORK, e)
        }
        if (code !in 200..299) throw FoodAnalysisException(reasonFor(code, body))
        return parseResponse(body)
    }

    internal fun buildBody(jpeg: ByteArray, lang: Lang): JsonObject = buildJsonObject {
        put("model", model)
        put("instructions", systemPrompt(lang))
        putJsonArray("input") {
            addJsonObject {
                put("role", "user")
                putJsonArray("content") {
                    addJsonObject {
                        put("type", "input_text")
                        put("text", userPrompt(lang))
                    }
                    addJsonObject {
                        put("type", "input_image")
                        put("image_url", "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(jpeg))
                        put("detail", "auto")
                    }
                }
            }
        }
        putJsonObject("text") {
            putJsonObject("format") {
                put("type", "json_schema")
                put("name", "meal_analysis")
                put("strict", true)
                put("schema", schema())
            }
        }
        put("max_output_tokens", MAX_OUTPUT_TOKENS)
        put("store", false)
    }

    companion object {
        /** Standardmodell (Beispielmodell des offiziellen OpenAI-SDK); in der App änderbar. */
        const val DEFAULT_MODEL = "gpt-5.5"
        const val DEFAULT_BASE_URL = "https://api.openai.com/v1/"
        private const val MAX_OUTPUT_TOKENS = 8000
        private val JSON_MEDIA = "application/json".toMediaType()
        private val json = Json { ignoreUnknownKeys = true }

        private val defaultClient: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(Duration.ofSeconds(20))
                .callTimeout(Duration.ofSeconds(120))
                .readTimeout(Duration.ofSeconds(120))
                .build()
        }

        private fun languageName(lang: Lang) = when (lang) {
            Lang.DE -> "Deutsch"
            Lang.TR -> "Türkisch"
        }

        internal fun systemPrompt(lang: Lang) = """
            Du bist ein freundlicher Ernährungsassistent in einer Fitness-App.
            Du bekommst ein Foto einer Mahlzeit oder eines Getränks. Erkenne jedes einzelne Lebensmittel,
            schätze die sichtbare Menge in Gramm (Getränke in Milliliter ≈ Gramm) und die Kalorien (kcal)
            anhand üblicher Nährwerte. Berücksichtige typische Zubereitung (z. B. Öl, Soße, Dressing).
            Benenne die Lebensmittel kurz und alltagsnah auf ${languageName(lang)}, gern mit regionalen
            Namen (z. B. türkische oder deutsche Gerichte).
            Das Feld "note" enthält genau einen kurzen Satz auf ${languageName(lang)}, der ausschließlich
            positiv und ermutigend ist – ohne Bewertungen wie "ungesund", "zu viel" oder Verbote.
            Ist auf dem Foto kein Essen zu sehen, gib eine leere Liste "items" zurück und schreibe in
            "note" freundlich, dass du gern ein Foto einer Mahlzeit analysierst.
        """.trimIndent()

        internal fun userPrompt(lang: Lang) = when (lang) {
            Lang.DE -> "Wie viele Kalorien hat diese Mahlzeit?"
            Lang.TR -> "Bu öğün kaç kalori?"
        }

        /** JSON-Schema der Antwort; im strict-Modus müssen alle Felder "required" sein. */
        internal fun schema(): JsonObject = buildJsonObject {
            put("type", "object")
            putJsonObject("properties") {
                putJsonObject("items") {
                    put("type", "array")
                    putJsonObject("items") {
                        put("type", "object")
                        putJsonObject("properties") {
                            putJsonObject("name") { put("type", "string") }
                            putJsonObject("grams") { put("type", "integer") }
                            putJsonObject("kcal") { put("type", "integer") }
                        }
                        putJsonArray("required") { add("name"); add("grams"); add("kcal") }
                        put("additionalProperties", false)
                    }
                }
                putJsonObject("note") { put("type", "string") }
            }
            putJsonArray("required") { add("items"); add("note") }
            put("additionalProperties", false)
        }

        /** HTTP-Fehler der OpenAI API in eine Ursache übersetzen. */
        internal fun reasonFor(code: Int, body: String): FoodAnalysisException.Reason {
            val errorCode = runCatching {
                json.parseToJsonElement(body).jsonObject["error"]?.jsonObject?.get("code")?.jsonPrimitive?.contentOrNull
            }.getOrNull()
            return when {
                code == 401 || code == 403 -> FoodAnalysisException.Reason.INVALID_KEY
                errorCode == "insufficient_quota" -> FoodAnalysisException.Reason.QUOTA
                code == 404 || errorCode == "model_not_found" -> FoodAnalysisException.Reason.MODEL
                code == 429 || code >= 500 -> FoodAnalysisException.Reason.BUSY
                else -> FoodAnalysisException.Reason.OTHER
            }
        }

        /**
         * Liest die Antwort der Responses API: Text aus `output[type=message].content[type=output_text]`,
         * Ablehnungen als `content[type=refusal]`, Abbrüche als `status = "incomplete"`.
         */
        internal fun parseResponse(body: String): FoodAnalysis {
            val root = try {
                json.parseToJsonElement(body).jsonObject
            } catch (e: Exception) {
                throw FoodAnalysisException(FoodAnalysisException.Reason.UNREADABLE, e)
            }
            val messages = (root["output"] as? JsonArray).orEmpty()
                .map { it.jsonObject }
                .filter { it.str("type") == "message" }
            val parts = messages
                // Zwischenkommentare überspringen, wenn eine finale Antwort markiert ist
                .let { all -> all.filter { it.str("phase") == "final_answer" }.ifEmpty { all } }
                .flatMap { (it["content"] as? JsonArray).orEmpty().map { c -> c.jsonObject } }

            if (parts.any { it.str("type") == "refusal" }) {
                throw FoodAnalysisException(FoodAnalysisException.Reason.DECLINED)
            }
            if (root.str("status") == "incomplete") {
                val reason = root["incomplete_details"]?.let { (it as? JsonObject)?.str("reason") }
                throw FoodAnalysisException(
                    if (reason == "content_filter") FoodAnalysisException.Reason.DECLINED else FoodAnalysisException.Reason.UNREADABLE,
                )
            }
            val text = parts.filter { it.str("type") == "output_text" }.joinToString("") { it.str("text").orEmpty() }
            return try {
                FoodAnalysis.parse(text)
            } catch (e: Exception) {
                throw FoodAnalysisException(FoodAnalysisException.Reason.UNREADABLE, e)
            }
        }

        private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
    }
}
