package de.maridcam.terminscanner.ocr

import android.content.Context
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import de.maridcam.terminscanner.extraction.DocumentLine
import de.maridcam.terminscanner.extraction.LayoutAnalyzer
import de.maridcam.terminscanner.extraction.TextBox
import kotlinx.coroutines.tasks.await

/** Ergebnis der Texterkennung: Zeilen (für die Termin-Erkennung) und Rohtext (zur Anzeige). */
data class RecognizedDocument(val lines: List<DocumentLine>, val fullText: String)

/**
 * Texterkennung mit Google ML Kit – läuft vollständig auf dem Gerät,
 * das Foto verlässt das Handy nicht.
 */
class TextRecognitionService(private val context: Context) {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    suspend fun recognize(imageUri: Uri): RecognizedDocument {
        // fromFilePath berücksichtigt die EXIF-Ausrichtung des Fotos
        val image = InputImage.fromFilePath(context, imageUri)
        val result = recognizer.process(image).await()

        val ocrLines = result.textBlocks.flatMap { it.lines }
        val boxes = ocrLines.mapNotNull { line ->
            line.boundingBox?.let { TextBox(line.text, it.left, it.top, it.right, it.bottom) }
        }
        val withoutBox = ocrLines.filter { it.boundingBox == null }.map { DocumentLine(it.text) }

        return RecognizedDocument(
            lines = LayoutAnalyzer.toLines(boxes) + withoutBox,
            fullText = result.text,
        )
    }

    fun close() = recognizer.close()
}
