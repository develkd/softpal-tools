package ai.softpal.fitcoach.core.food

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FoodTest {

    @Test fun `Bildlabels werden Lebensmitteln zugeordnet`() {
        val pizza = FoodDatabase.suggestFromLabels(listOf(ImageLabel("Food", 0.95f), ImageLabel("Pizza", 0.9f)))
        assertEquals("pizza", pizza.first().id)
        val fruit = FoodDatabase.suggestFromLabels(listOf(ImageLabel("Banana", 0.8f), ImageLabel("Fruit", 0.7f)))
        assertEquals("banana", fruit.first().id)
        assertTrue(FoodDatabase.suggestFromLabels(listOf(ImageLabel("Food", 0.9f), ImageLabel("Dish", 0.8f))).isEmpty())
        assertTrue(FoodDatabase.looksLikeFood(listOf(ImageLabel("Food", 0.9f))))
        assertTrue(!FoodDatabase.looksLikeFood(listOf(ImageLabel("Car", 0.9f))))
    }

    @Test fun `Suche ueber Deutsch, Tuerkisch und ohne Sonderzeichen`() {
        assertEquals("doner", FoodDatabase.search("döner").first().id)
        assertEquals("doner", FoodDatabase.search("DONER").first().id)
        assertTrue(FoodDatabase.search("çorba").any { it.id == "lentil_soup" })
        assertTrue(FoodDatabase.search("corba").any { it.id == "lentil_soup" })
        assertTrue(FoodDatabase.search("Brötchen").any { it.id == "roll" })
        assertEquals("ayran", FoodDatabase.search("AYRAN").first().id)
        assertEquals("i", FoodDatabase.normalize("İ"))
        assertEquals("kisir", FoodDatabase.normalize("Kısır"))
    }

    @Test fun `Kalorien pro Portion`() {
        val apple = FoodDatabase.byId("apple")!!
        assertEquals(94, apple.portionKcal)
        assertEquals(52, apple.kcalFor(100))
        FoodDatabase.foods.forEach { assertTrue(it.id, it.kcalPer100g in 0..900 && it.portionGrams in 10..600) }
        assertEquals(FoodDatabase.foods.size, FoodDatabase.foods.map { it.id }.toSet().size)
    }

    @Test fun `KI-Antwort wird gelesen und begrenzt`() {
        val json = """
            {"items":[{"name":"Lahmacun","grams":160,"kcal":350},{"name":" Ayran ","grams":250,"kcal":90},
             {"name":"","grams":1,"kcal":1},{"name":"Riesig","grams":99999,"kcal":-5}],
             "note":"Guten Appetit!","extra":true}
        """.trimIndent()
        val result = FoodAnalysis.parse(json)
        assertEquals(3, result.items.size)
        assertEquals("Ayran", result.items[1].name)
        assertEquals(3000, result.items[2].grams)
        assertEquals(0, result.items[2].kcal)
        assertEquals(440, result.totalKcal)
        assertEquals("Guten Appetit!", result.note)
    }
}
