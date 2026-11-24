package ai.softpal.fitcoach.core.food

import ai.softpal.fitcoach.core.Text
import java.text.Normalizer
import kotlin.math.roundToInt

/**
 * Lebensmittel mit Kalorien pro 100 g und typischer Portion.
 * [keywords] enthält englische Bildlabels (ML Kit) sowie Such-Synonyme.
 */
data class Food(
    val id: String,
    val name: Text,
    val kcalPer100g: Int,
    val portionGrams: Int,
    val keywords: List<String>,
) {
    fun kcalFor(grams: Int): Int = (kcalPer100g * grams / 100.0).roundToInt()
    val portionKcal: Int get() = kcalFor(portionGrams)
}

/** Erkanntes Bildlabel mit Sicherheit 0…1. */
data class ImageLabel(val text: String, val confidence: Float)

/** Richtwerte (gerundet) nach gängigen Nährwerttabellen. */
object FoodDatabase {

    private fun f(id: String, de: String, tr: String, kcal: Int, portion: Int, vararg kw: String) =
        Food(id, Text(de, tr), kcal, portion, kw.toList())

    val foods: List<Food> = listOf(
        // Frühstück & Brot
        f("bread", "Brot (1 Scheibe)", "Ekmek (1 dilim)", 250, 50, "bread", "toast", "loaf", "baked goods"),
        f("roll", "Brötchen", "Sandviç ekmeği", 270, 60, "bread", "bun", "roll", "baked goods"),
        f("simit", "Simit", "Simit", 280, 110, "bagel", "pretzel", "simit", "bread", "baked goods"),
        f("croissant", "Croissant", "Kruvasan", 410, 60, "croissant", "pastry", "baked goods"),
        f("muesli", "Müsli mit Milch", "Sütlü müsli", 130, 250, "cereal", "muesli", "granola", "breakfast", "bowl"),
        f("egg", "Ei, gekocht", "Haşlanmış yumurta", 155, 60, "egg", "breakfast"),
        f("menemen", "Menemen (Rührei mit Tomate)", "Menemen", 110, 250, "egg", "omelette", "scrambled", "breakfast", "menemen"),
        f("white_cheese", "Weißkäse", "Beyaz peynir", 260, 40, "cheese", "feta", "dairy", "breakfast"),
        f("cheese", "Käse (Scheibe)", "Kaşar peyniri (dilim)", 350, 30, "cheese", "dairy"),
        f("olives", "Oliven", "Zeytin", 145, 30, "olive", "breakfast"),
        f("yogurt", "Joghurt", "Yoğurt", 65, 150, "yogurt", "yoghurt", "dairy"),
        f("ayran", "Ayran", "Ayran", 35, 250, "ayran", "milk", "drink", "dairy"),
        f("milk", "Milch (Glas)", "Süt (bardak)", 64, 250, "milk", "drink", "dairy"),
        f("coffee_milk", "Milchkaffee", "Sütlü kahve", 30, 200, "coffee", "cup", "latte", "cappuccino", "drink"),
        f("tea", "Tee", "Çay", 1, 200, "tea", "cup", "drink"),
        f("orange_juice", "Orangensaft", "Portakal suyu", 45, 250, "juice", "orange juice", "drink"),
        f("cola", "Cola / Limonade", "Kola / gazoz", 42, 330, "soft drink", "cola", "soda", "drink"),
        // Obst
        f("apple", "Apfel", "Elma", 52, 180, "apple", "fruit"),
        f("banana", "Banane", "Muz", 89, 120, "banana", "fruit"),
        f("orange", "Orange", "Portakal", 47, 150, "orange", "citrus", "fruit"),
        f("grapes", "Weintrauben", "Üzüm", 69, 150, "grape", "fruit"),
        f("strawberries", "Erdbeeren", "Çilek", 32, 150, "strawberry", "berry", "fruit"),
        f("watermelon", "Wassermelone", "Karpuz", 30, 300, "watermelon", "melon", "fruit"),
        f("fruit_salad", "Obstsalat", "Meyve salatası", 55, 200, "fruit", "fruit salad", "bowl"),
        // Gemüse & Salat
        f("salad", "Gemischter Salat mit Dressing", "Zeytinyağlı karışık salata", 70, 200, "salad", "vegetable", "leaf vegetable", "lettuce", "coban"),
        f("vegetables", "Gemüse, gedünstet", "Sebze yemeği", 50, 200, "vegetable", "broccoli", "carrot", "zucchini"),
        f("cacik", "Cacık (Joghurt mit Gurke)", "Cacık", 50, 200, "cacik", "yogurt", "cucumber"),
        f("potatoes", "Kartoffeln, gekocht", "Haşlanmış patates", 80, 250, "potato"),
        // Hauptgerichte
        f("doner", "Döner im Brot", "Ekmek arası döner", 215, 350, "doner", "kebab", "sandwich", "gyro", "fast food"),
        f("durum", "Dürüm", "Dürüm", 230, 300, "durum", "wrap", "kebab", "burrito"),
        f("lahmacun", "Lahmacun", "Lahmacun", 230, 150, "lahmacun", "pizza", "flatbread"),
        f("pide", "Pide", "Pide", 260, 250, "pide", "pizza", "flatbread"),
        f("kofte", "Köfte", "Köfte", 250, 150, "meatball", "kofte", "meat"),
        f("kebab", "Spieß / Adana Kebap", "Şiş / Adana kebap", 220, 200, "kebab", "skewer", "meat", "grilling", "barbecue"),
        f("chicken", "Hähnchenbrust", "Tavuk göğsü", 165, 150, "chicken", "poultry", "meat"),
        f("schnitzel", "Schnitzel", "Şnitzel", 270, 180, "schnitzel", "cutlet", "fried", "meat"),
        f("steak", "Steak", "Biftek", 250, 200, "steak", "beef", "meat"),
        f("fish", "Fisch, gebraten", "Balık (tava/ızgara)", 200, 180, "fish", "seafood", "salmon"),
        f("sushi", "Sushi", "Suşi", 150, 200, "sushi", "seafood", "japanese"),
        f("pizza", "Pizza (halbe)", "Pizza (yarım)", 266, 250, "pizza"),
        f("pasta_tomato", "Nudeln mit Tomatensoße", "Domates soslu makarna", 140, 350, "pasta", "noodle", "spaghetti", "macaroni"),
        f("pasta_bolognese", "Spaghetti Bolognese", "Kıymalı makarna", 160, 350, "pasta", "spaghetti", "bolognese", "noodle"),
        f("rice", "Reis (Pilav)", "Pirinç pilavı", 160, 200, "rice", "pilaf"),
        f("bulgur", "Bulgur-Pilav", "Bulgur pilavı", 150, 200, "bulgur", "rice", "pilaf"),
        f("beans", "Bohneneintopf", "Kuru fasulye", 110, 300, "bean", "stew", "legume"),
        f("lentil_soup", "Linsensuppe", "Mercimek çorbası", 60, 300, "soup", "lentil"),
        f("soup", "Gemüsesuppe", "Sebze çorbası", 45, 300, "soup", "broth"),
        f("manti", "Mantı mit Joghurt", "Yoğurtlu mantı", 190, 300, "manti", "dumpling", "ravioli"),
        f("borek", "Börek", "Börek", 300, 150, "borek", "pastry", "pie", "baked goods"),
        f("gozleme", "Gözleme", "Gözleme", 250, 250, "gozleme", "flatbread", "crepe", "pancake"),
        f("falafel", "Falafel", "Falafel", 330, 150, "falafel"),
        f("burger", "Hamburger", "Hamburger", 250, 220, "hamburger", "cheeseburger", "burger", "fast food", "sandwich"),
        f("fries", "Pommes frites", "Patates kızartması", 312, 150, "french fries", "fries", "fast food", "potato"),
        f("hotdog", "Hotdog", "Sosisli sandviç", 290, 120, "hot dog", "sausage", "fast food"),
        f("currywurst", "Currywurst", "Körili sosis", 240, 250, "sausage", "currywurst"),
        f("sandwich", "Sandwich / belegtes Brot", "Sandviç", 230, 180, "sandwich", "bread", "toast"),
        // Süßes & Snacks
        f("baklava", "Baklava (2 Stück)", "Baklava (2 dilim)", 430, 80, "baklava", "dessert", "pastry", "baked goods"),
        f("kunefe", "Künefe", "Künefe", 330, 150, "kunefe", "dessert"),
        f("sutlac", "Milchreis", "Sütlaç", 130, 200, "rice pudding", "pudding", "dessert"),
        f("cake", "Kuchen (Stück)", "Kek / pasta (dilim)", 350, 100, "cake", "dessert", "baked goods", "cupcake"),
        f("cookie", "Kekse", "Kurabiye / bisküvi", 480, 40, "cookie", "biscuit", "baked goods"),
        f("chocolate", "Schokolade", "Çikolata", 540, 25, "chocolate", "confectionery", "candy"),
        f("ice_cream", "Eis (2 Kugeln)", "Dondurma (2 top)", 200, 100, "ice cream", "dessert", "frozen dessert"),
        f("donut", "Donut", "Donut", 450, 70, "doughnut", "donut", "dessert"),
        f("muffin", "Muffin", "Muffin", 380, 90, "muffin", "cupcake", "baked goods"),
        f("nuts", "Nüsse", "Kuruyemiş", 600, 30, "nut", "almond", "walnut", "hazelnut"),
        f("chips", "Chips", "Cips", 540, 50, "chips", "crisps", "snack"),
    )

    /** Allgemeine Labels, die nur "Essen" bedeuten und keine konkrete Zuordnung erlauben. */
    private val genericLabels = setOf("food", "dish", "cuisine", "meal", "ingredient", "recipe", "tableware", "plate", "lunch", "dinner")

    fun byId(id: String): Food? = foods.firstOrNull { it.id == id }

    /** `true`, wenn die Labels überhaupt nach Essen aussehen. */
    fun looksLikeFood(labels: List<ImageLabel>): Boolean =
        labels.any { l -> normalize(l.text) in genericLabels || suggestFromLabels(listOf(l), 1).isNotEmpty() }

    /**
     * Ordnet Bildlabels Lebensmitteln zu. Jedes passende Schlüsselwort zählt mit der Sicherheit
     * des Labels; je konkreter das Schlüsselwort (weiter vorne in der Liste), desto höher das Gewicht.
     */
    fun suggestFromLabels(labels: List<ImageLabel>, limit: Int = 6): List<Food> {
        val specific = labels.filter { normalize(it.text) !in genericLabels }
        val scores = foods.associateWith { food ->
            specific.sumOf { label ->
                val l = normalize(label.text)
                food.keywords.withIndex().filter { (_, kw) -> matches(l, normalize(kw)) }
                    .maxOfOrNull { (index, _) -> label.confidence.toDouble() / (1 + index * 0.25) } ?: 0.0
            }
        }
        return scores.filterValues { it > 0.0 }.entries.sortedByDescending { it.value }.take(limit).map { it.key }
    }

    /** Freitextsuche über deutsche und türkische Namen sowie Schlüsselwörter. */
    fun search(query: String, limit: Int = 20): List<Food> {
        val q = normalize(query)
        if (q.isBlank()) return foods.take(limit)
        return foods.filter { food ->
            normalize(food.name.de).contains(q) || normalize(food.name.tr).contains(q) ||
                food.keywords.any { normalize(it).contains(q) }
        }.take(limit)
    }

    private fun matches(label: String, keyword: String): Boolean =
        label == keyword || label.split(' ').contains(keyword) || keyword.split(' ').contains(label) ||
            (keyword.length >= 4 && label.startsWith(keyword)) || (label.length >= 4 && keyword.startsWith(label))

    /** Kleinbuchstaben, ohne Akzente; türkisches ı/İ und deutsche Umlaute werden vereinheitlicht. */
    fun normalize(s: String): String {
        val lower = s.trim().replace('İ', 'i').replace('I', 'i').lowercase().replace('ı', 'i').replace("ß", "ss")
        return Normalizer.normalize(lower, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
    }
}
