import Foundation

enum NutrientMapper {
    /// Maps an OpenFoodFacts product to an Ingredient struct.
    /// All nutrition values from OFF are per 100g.
    static func map(product: OFFProduct, barcode: String) -> Ingredient {
        let n = product.nutriments
        let name = product.productName ?? "Unknown Product"
        let brand = product.brands

        let displayName: String
        if let brand, !brand.isEmpty {
            displayName = "\(name) (\(brand))"
        } else {
            displayName = name
        }

        let calories = n?.energyKcal100g ?? 0
        let protein = n?.proteins100g ?? 0
        let fiber = n?.fiber100g ?? 0

        // sodium from OFF is in grams → convert to mg for website
        let sodiumMg = (n?.sodium100g ?? 0) * 1000

        // Compute per-calorie ratios
        let proteinPerCal: Double = calories > 0 ? (protein / calories * 100).rounded(to: 2) : 0
        let fiberPerCal: Double = calories > 0 ? (fiber / calories * 100).rounded(to: 2) : 0

        return Ingredient(
            ingredient: displayName,
            grams: "100",
            measurement: "g",
            protein: format(protein),
            carbs: format(n?.carbohydrates100g),
            fat: format(n?.fat100g),
            sugar: format(n?.sugars100g),
            sodium: format(sodiumMg),
            potassium: format(n?.potassium100g),
            vitaminB12: format(n?.vitaminB12100g),
            vitaminC: format(n?.vitaminC100g),
            magnesium: format(n?.magnesium100g),
            fiber: format(fiber),
            zinc: format(n?.zinc100g),
            iron: format(n?.iron100g),
            calcium: format(n?.calcium100g),
            calories: format(calories),
            addedSugar: format(n?.addedSugar100g),
            saturatedFat: format(n?.saturatedFat100g),
            leucine: "",
            notes: "Scanned: \(barcode)",
            link: "https://world.openfoodfacts.org/product/\(barcode)",
            processed: "",
            omega3: "",
            proteinPerCal: format(proteinPerCal),
            fiberPerCal: format(fiberPerCal),
            lastBought: "",
            storage: "",
            minShelf: "",
            maxShelf: ""
        )
    }

    private static func format(_ value: Double?) -> String {
        guard let value, value != 0 else { return "" }
        // Remove trailing zeros: 12.50 → "12.5", 12.00 → "12"
        let formatted = String(format: "%.2f", value)
        return formatted
            .replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression)
    }

    private static func format(_ value: Double) -> String {
        let formatted = String(format: "%.2f", value)
        return formatted
            .replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression)
    }
}

private extension Double {
    func rounded(to places: Int) -> Double {
        let multiplier = pow(10.0, Double(places))
        return (self * multiplier).rounded() / multiplier
    }
}
