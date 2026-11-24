package ai.softpal.fitcoach.core.food

import ai.softpal.fitcoach.core.Lang
import ai.softpal.fitcoach.core.food.FoodAnalysisException.Reason
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.util.Base64

/** Prüft die ChatGPT-Anbindung gegen einen lokalen Testserver (kein echter API-Aufruf). */
class ChatGptFoodAnalyzerTest {

    private lateinit var server: MockWebServer
    private val jpeg = byteArrayOf(-1, -40, -1, 1, 2, 3)

    @Before fun start() {
        server = MockWebServer().apply { start() }
    }

    @After fun stop() {
        runCatching { server.shutdown() }
    }

    private fun analyzer(model: String = ChatGptFoodAnalyzer.DEFAULT_MODEL) =
        ChatGptFoodAnalyzer("sk-test", model, server.url("/v1/"))

    private fun ok(body: String) = MockResponse().setResponseCode(200).setHeader("Content-Type", "application/json").setBody(body)

    private fun success(itemsJson: String, note: String) = """
        {"id":"resp_1","object":"response","status":"completed","model":"gpt-5.5",
         "output":[
           {"type":"reasoning","id":"rs_1","summary":[]},
           {"type":"message","id":"msg_1","role":"assistant","status":"completed",
            "content":[{"type":"output_text","annotations":[],
                        "text":${Json.encodeToString(kotlinx.serialization.serializer<String>(), """{"items":$itemsJson,"note":"$note"}""")}}]}
         ]}
    """.trimIndent()

    @Test fun `Anfrage hat das erwartete Format der Responses API`() {
        server.enqueue(ok(success("""[{"name":"Simit","grams":110,"kcal":310}]""", "Afiyet olsun!")))
        analyzer().analyze(jpeg, Lang.TR)

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/v1/responses", recorded.path)
        assertEquals("Bearer sk-test", recorded.getHeader("Authorization"))
        val body = Json.parseToJsonElement(recorded.body.readUtf8()).jsonObject
        assertEquals("gpt-5.5", body["model"]!!.jsonPrimitive.content)
        assertEquals("false", body["store"]!!.jsonPrimitive.content)
        assertTrue(body["instructions"]!!.jsonPrimitive.content.contains("Türkisch"))

        val content = body["input"]!!.jsonArray[0].jsonObject["content"]!!.jsonArray.map { it.jsonObject }
        assertEquals(listOf("input_text", "input_image"), content.map { it["type"]!!.jsonPrimitive.content })
        assertEquals("Bu öğün kaç kalori?", content[0]["text"]!!.jsonPrimitive.content)
        assertEquals("data:image/jpeg;base64," + Base64.getEncoder().encodeToString(jpeg), content[1]["image_url"]!!.jsonPrimitive.content)

        val format = body["text"]!!.jsonObject["format"] as JsonObject
        assertEquals("json_schema", format["type"]!!.jsonPrimitive.content)
        assertEquals("true", format["strict"]!!.jsonPrimitive.content)
        val schema = format["schema"]!!.jsonObject
        assertEquals("false", schema["additionalProperties"]!!.jsonPrimitive.content)
    }

    @Test fun `Antwort wird gelesen`() {
        server.enqueue(ok(success("""[{"name":"Lahmacun","grams":160,"kcal":350},{"name":"Ayran","grams":250,"kcal":90}]""", "Guten Appetit!")))
        val result = analyzer().analyze(jpeg, Lang.DE)
        assertEquals(2, result.items.size)
        assertEquals(440, result.totalKcal)
        assertEquals("Guten Appetit!", result.note)
    }

    @Test fun `leeres Modell faellt auf das Standardmodell zurueck`() {
        server.enqueue(ok(success("[]", "Gern!")))
        analyzer(model = "  ").analyze(jpeg, Lang.DE)
        val body = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
        assertEquals(ChatGptFoodAnalyzer.DEFAULT_MODEL, body["model"]!!.jsonPrimitive.content)
    }

    private fun expect(reason: Reason, block: () -> Unit) {
        try {
            block()
            fail("erwartet: $reason")
        } catch (e: FoodAnalysisException) {
            assertEquals(reason, e.reason)
        }
    }

    @Test fun `Ablehnung und Abbruch werden erkannt`() {
        server.enqueue(ok("""{"status":"completed","output":[{"type":"message","content":[{"type":"refusal","refusal":"no"}]}]}"""))
        expect(Reason.DECLINED) { analyzer().analyze(jpeg, Lang.DE) }
        server.enqueue(ok("""{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[]}"""))
        expect(Reason.UNREADABLE) { analyzer().analyze(jpeg, Lang.DE) }
        server.enqueue(ok("""{"status":"incomplete","incomplete_details":{"reason":"content_filter"},"output":[]}"""))
        expect(Reason.DECLINED) { analyzer().analyze(jpeg, Lang.DE) }
        server.enqueue(ok("""{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"kein json"}]}]}"""))
        expect(Reason.UNREADABLE) { analyzer().analyze(jpeg, Lang.DE) }
    }

    @Test fun `HTTP-Fehler werden passenden Ursachen zugeordnet`() {
        fun error(code: Int, errCode: String?) = MockResponse().setResponseCode(code)
            .setBody("""{"error":{"message":"x","type":"t","code":${errCode?.let { "\"$it\"" } ?: "null"}}}""")
        val cases = listOf(
            error(401, "invalid_api_key") to Reason.INVALID_KEY,
            error(429, "insufficient_quota") to Reason.QUOTA,
            error(429, "rate_limit_exceeded") to Reason.BUSY,
            error(404, "model_not_found") to Reason.MODEL,
            error(503, null) to Reason.BUSY,
            error(400, "invalid_value") to Reason.OTHER,
        )
        for ((response, reason) in cases) {
            server.enqueue(response)
            expect(reason) { analyzer().analyze(jpeg, Lang.DE) }
        }
    }

    @Test fun `ohne Verbindung meldet die Analyse ein Netzwerkproblem`() {
        val url = server.url("/v1/")
        server.shutdown()
        expect(Reason.NETWORK) { ChatGptFoodAnalyzer("sk-test", baseUrl = url).analyze(jpeg, Lang.DE) }
    }

    @Test fun `Systemanweisung verlangt positive Formulierungen`() {
        val prompt = ChatGptFoodAnalyzer.systemPrompt(Lang.DE)
        assertTrue(prompt.contains("ausschließlich") && prompt.contains("positiv"))
        assertFalse(ChatGptFoodAnalyzer.systemPrompt(Lang.TR).contains("Deutsch"))
    }
}
