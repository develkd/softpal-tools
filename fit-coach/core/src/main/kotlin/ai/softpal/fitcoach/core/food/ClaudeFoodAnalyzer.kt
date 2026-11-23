package ai.softpal.fitcoach.core.food

import ai.softpal.fitcoach.core.Lang
import com.anthropic.client.AnthropicClient
import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.core.JsonValue
import com.anthropic.errors.AnthropicIoException
import com.anthropic.errors.AnthropicServiceException
import com.anthropic.errors.InternalServerException
import com.anthropic.errors.PermissionDeniedException
import com.anthropic.errors.RateLimitException
import com.anthropic.errors.UnauthorizedException
import com.anthropic.models.messages.Base64ImageSource
import com.anthropic.models.messages.ContentBlockParam
import com.anthropic.models.messages.JsonOutputFormat
import com.anthropic.models.messages.MessageCreateParams
import com.anthropic.models.messages.OutputConfig
import com.anthropic.models.messages.StopReason
import java.time.Duration
import java.util.Base64

/**
 * Kalorienschätzung aus einem Foto über die Claude API (optional, mit eigenem API-Schlüssel).
 *
 * Das Foto (JPEG) wird an die Anthropic API gesendet; Claude erkennt die Lebensmittel, schätzt
 * Portionsgrößen und Kalorien und antwortet als strukturiertes JSON ([FoodAnalysis]).
 */
class ClaudeFoodAnalyzer(apiKey: String, private val model: String = MODEL) : AutoCloseable {

    private val client: AnthropicClient = AnthropicOkHttpClient.builder()
        .apiKey(apiKey)
        .timeout(Duration.ofSeconds(120))
        .build()

    /** Blockierender Aufruf – auf Android aus einem Hintergrund-Thread aufrufen. */
    fun analyze(jpeg: ByteArray, lang: Lang): FoodAnalysis {
        val response = try {
            client.messages().create(buildParams(jpeg, lang))
        } catch (e: UnauthorizedException) {
            throw FoodAnalysisException(FoodAnalysisException.Reason.INVALID_KEY, e)
        } catch (e: PermissionDeniedException) {
            throw FoodAnalysisException(FoodAnalysisException.Reason.INVALID_KEY, e)
        } catch (e: RateLimitException) {
            throw FoodAnalysisException(FoodAnalysisException.Reason.BUSY, e)
        } catch (e: InternalServerException) {
            throw FoodAnalysisException(FoodAnalysisException.Reason.BUSY, e)
        } catch (e: AnthropicServiceException) {
            throw FoodAnalysisException(FoodAnalysisException.Reason.OTHER, e)
        } catch (e: AnthropicIoException) {
            throw FoodAnalysisException(FoodAnalysisException.Reason.NETWORK, e)
        }

        when (response.stopReason().orElse(null)) {
            StopReason.REFUSAL -> throw FoodAnalysisException(FoodAnalysisException.Reason.DECLINED)
            StopReason.MAX_TOKENS -> throw FoodAnalysisException(FoodAnalysisException.Reason.UNREADABLE)
            else -> Unit
        }
        val text = response.content().mapNotNull { block -> block.text().map { it.text() }.orElse(null) }.joinToString("")
        return try {
            FoodAnalysis.parse(text)
        } catch (e: Exception) {
            throw FoodAnalysisException(FoodAnalysisException.Reason.UNREADABLE, e)
        }
    }

    internal fun buildParams(jpeg: ByteArray, lang: Lang): MessageCreateParams {
        val image = Base64ImageSource.builder()
            .data(Base64.getEncoder().encodeToString(jpeg))
            .mediaType(Base64ImageSource.MediaType.IMAGE_JPEG)
            .build()
        return MessageCreateParams.builder()
            .model(model)
            .maxTokens(16000L)
            .system(systemPrompt(lang))
            .outputConfig(
                OutputConfig.builder()
                    .effort(OutputConfig.Effort.MEDIUM)
                    .format(JsonOutputFormat.builder().schema(schema()).build())
                    .build(),
            )
            // Serverseitiger Fallback auf ein anderes Modell, falls eine Anfrage abgelehnt wird.
            .putAdditionalHeader("anthropic-beta", FALLBACK_BETA)
            .putAdditionalBodyProperty("fallbacks", JsonValue.from("default"))
            .addUserMessageOfContentBlockParams(
                listOf(
                    ContentBlockParam.ofImage(image),
                    ContentBlockParam.ofText(userPrompt(lang)),
                ),
            )
            .build()
    }

    override fun close() = client.close()

    companion object {
        const val MODEL = "claude-opus-5-5"
        const val FALLBACK_BETA = "server-side-fallback-2026-07-01"

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

        /** JSON-Schema der Antwort (strukturierte Ausgabe). */
        internal fun schema(): JsonOutputFormat.Schema {
            val item = mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "name" to mapOf("type" to "string"),
                    "grams" to mapOf("type" to "integer"),
                    "kcal" to mapOf("type" to "integer"),
                ),
                "required" to listOf("name", "grams", "kcal"),
                "additionalProperties" to false,
            )
            return JsonOutputFormat.Schema.builder()
                .putAdditionalProperty("type", JsonValue.from("object"))
                .putAdditionalProperty(
                    "properties",
                    JsonValue.from(mapOf("items" to mapOf("type" to "array", "items" to item), "note" to mapOf("type" to "string"))),
                )
                .putAdditionalProperty("required", JsonValue.from(listOf("items", "note")))
                .putAdditionalProperty("additionalProperties", JsonValue.from(false))
                .build()
        }
    }
}
