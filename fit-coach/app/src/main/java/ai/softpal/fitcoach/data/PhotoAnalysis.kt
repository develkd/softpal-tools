package ai.softpal.fitcoach.data

import ai.softpal.fitcoach.core.Lang
import ai.softpal.fitcoach.core.food.ChatGptFoodAnalyzer
import ai.softpal.fitcoach.core.food.FoodAnalysis
import ai.softpal.fitcoach.core.food.ImageLabel
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max

/** Foto laden, auf dem Gerät erkennen (ML Kit) und optional per ChatGPT (OpenAI API) analysieren. */
object PhotoAnalysis {

    /** Längste Bildkante für Erkennung und Upload (größere Bilder bringen keinen Genauigkeitsgewinn). */
    private const val MAX_SIDE = 1568

    suspend fun loadBitmap(context: Context, uri: Uri): Bitmap = withContext(Dispatchers.IO) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val source = ImageDecoder.createSource(context.contentResolver, uri)
            // ImageDecoder berücksichtigt die EXIF-Drehung von Kamerafotos automatisch.
            ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                val w = info.size.width
                val h = info.size.height
                val scale = MAX_SIDE.toFloat() / max(w, h)
                if (scale < 1f) decoder.setTargetSize((w * scale).toInt(), (h * scale).toInt())
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
            val opts = BitmapFactory.Options().apply { inSampleSize = sample }
            context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
                ?: error("Bild konnte nicht geladen werden")
        }
    }

    /** Erkennt allgemeine Bildinhalte (z. B. "Pizza", "Fruit") – offline auf dem Gerät. */
    suspend fun labelsOnDevice(bitmap: Bitmap): List<ImageLabel> {
        val labeler = ImageLabeling.getClient(
            ImageLabelerOptions.Builder().setConfidenceThreshold(0.4f).build(),
        )
        return try {
            labeler.process(InputImage.fromBitmap(bitmap, 0)).await().map { ImageLabel(it.text, it.confidence) }
        } finally {
            labeler.close()
        }
    }

    /** Genaue Analyse über ChatGPT / OpenAI API (nur mit hinterlegtem API-Schlüssel). */
    suspend fun analyzeWithChatGpt(bitmap: Bitmap, apiKey: String, model: String, lang: Lang): FoodAnalysis = withContext(Dispatchers.IO) {
        val jpeg = ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
            out.toByteArray()
        }
        ChatGptFoodAnalyzer(apiKey, model).analyze(jpeg, lang)
    }
}
