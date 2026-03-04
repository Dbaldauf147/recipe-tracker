import Foundation

struct Ingredient: Codable {
    var ingredient: String = ""
    var grams: String = ""
    var measurement: String = ""
    var protein: String = ""
    var carbs: String = ""
    var fat: String = ""
    var sugar: String = ""
    var sodium: String = ""
    var potassium: String = ""
    var vitaminB12: String = ""
    var vitaminC: String = ""
    var magnesium: String = ""
    var fiber: String = ""
    var zinc: String = ""
    var iron: String = ""
    var calcium: String = ""
    var calories: String = ""
    var addedSugar: String = ""
    var saturatedFat: String = ""
    var leucine: String = ""
    var notes: String = ""
    var link: String = ""
    var processed: String = ""
    var omega3: String = ""
    var proteinPerCal: String = ""
    var fiberPerCal: String = ""
    var lastBought: String = ""
    var storage: String = ""
    var minShelf: String = ""
    var maxShelf: String = ""

    /// Convert to [String: String] dictionary for Firestore storage.
    func toDictionary() -> [String: String] {
        [
            "ingredient": ingredient,
            "grams": grams,
            "measurement": measurement,
            "protein": protein,
            "carbs": carbs,
            "fat": fat,
            "sugar": sugar,
            "sodium": sodium,
            "potassium": potassium,
            "vitaminB12": vitaminB12,
            "vitaminC": vitaminC,
            "magnesium": magnesium,
            "fiber": fiber,
            "zinc": zinc,
            "iron": iron,
            "calcium": calcium,
            "calories": calories,
            "addedSugar": addedSugar,
            "saturatedFat": saturatedFat,
            "leucine": leucine,
            "notes": notes,
            "link": link,
            "processed": processed,
            "omega3": omega3,
            "proteinPerCal": proteinPerCal,
            "fiberPerCal": fiberPerCal,
            "lastBought": lastBought,
            "storage": storage,
            "minShelf": minShelf,
            "maxShelf": maxShelf,
        ]
    }
}
