package de.maridcam.terminscanner.extraction

/** Eine von der OCR erkannte Textzeile mit Position im Bild (Pixel). */
data class TextBox(val text: String, val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val height: Int get() = bottom - top
    val centerY: Float get() = (top + bottom) / 2f
}

/**
 * Setzt OCR-Zeilen, die im Bild auf gleicher Höhe liegen, zu einer Zeile zusammen.
 *
 * Formulare und Briefe stehen oft in zwei Spalten ("Datum:" links, "24.11.2026" rechts).
 * Die OCR liefert diese als getrennte Blöcke; erst zusammengesetzt ergeben sie "Datum: 24.11.2026".
 */
object LayoutAnalyzer {

    fun toLines(boxes: List<TextBox>): List<DocumentLine> {
        val rows = mutableListOf<MutableList<TextBox>>()
        for (box in boxes.filter { it.text.isNotBlank() }.sortedBy { it.centerY }) {
            val row = rows.lastOrNull()
            if (row != null && belongsToRow(row, box)) row += box else rows += mutableListOf(box)
        }
        return rows.map { row ->
            val sorted = row.sortedBy { it.left }
            DocumentLine(
                text = sorted.joinToString(" ") { it.text.trim() },
                height = sorted.maxOf { it.height }.toFloat(),
            )
        }
    }

    private fun belongsToRow(row: List<TextBox>, box: TextBox): Boolean {
        val rowCenter = row.map { it.centerY }.average().toFloat()
        val rowHeight = row.maxOf { it.height }
        val tolerance = minOf(rowHeight, box.height) * 0.5f
        val overlapsHorizontally = row.any { it.left < box.right && box.left < it.right }
        return !overlapsHorizontally && kotlin.math.abs(box.centerY - rowCenter) <= tolerance
    }
}
