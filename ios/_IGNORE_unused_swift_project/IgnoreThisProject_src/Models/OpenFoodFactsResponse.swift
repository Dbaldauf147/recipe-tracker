import Foundation

struct OFFResponse: Codable {
    let status: Int?
    let product: OFFProduct?
}

struct OFFProduct: Codable {
    let productName: String?
    let brands: String?
    let nutriments: OFFNutriments?

    enum CodingKeys: String, CodingKey {
        case productName = "product_name"
        case brands
        case nutriments
    }
}

struct OFFNutriments: Codable {
    let energyKcal100g: Double?
    let proteins100g: Double?
    let carbohydrates100g: Double?
    let fat100g: Double?
    let sugars100g: Double?
    let sodium100g: Double?
    let potassium100g: Double?      // mg (OFF stores some minerals in mg per 100g)
    let vitaminB12100g: Double?     // µg
    let vitaminC100g: Double?       // mg
    let magnesium100g: Double?      // mg
    let fiber100g: Double?
    let zinc100g: Double?           // mg
    let iron100g: Double?           // mg
    let calcium100g: Double?        // mg
    let saturatedFat100g: Double?
    let addedSugar100g: Double?     // not always available

    enum CodingKeys: String, CodingKey {
        case energyKcal100g = "energy-kcal_100g"
        case proteins100g = "proteins_100g"
        case carbohydrates100g = "carbohydrates_100g"
        case fat100g = "fat_100g"
        case sugars100g = "sugars_100g"
        case sodium100g = "sodium_100g"
        case potassium100g = "potassium_100g"
        case vitaminB12100g = "vitamin-b12_100g"
        case vitaminC100g = "vitamin-c_100g"
        case magnesium100g = "magnesium_100g"
        case fiber100g = "fiber_100g"
        case zinc100g = "zinc_100g"
        case iron100g = "iron_100g"
        case calcium100g = "calcium_100g"
        case saturatedFat100g = "saturated-fat_100g"
        case addedSugar100g = "added-sugars_100g"
    }
}
