import Foundation
import FirebaseFirestore

enum FirestoreError: LocalizedError {
    case duplicateIngredient(String)
    case writeError(Error)

    var errorDescription: String? {
        switch self {
        case .duplicateIngredient(let name):
            return "An ingredient named \"\(name)\" already exists."
        case .writeError(let error):
            return "Failed to save: \(error.localizedDescription)"
        }
    }
}

enum FirestoreService {
    private static let db = Firestore.firestore()

    /// Fetches all existing ingredient names from the admin's ingredientsDb.
    static func fetchIngredientNames() async -> [String] {
        let docRef = db.collection(Constants.firestoreUsersCollection)
            .document(Constants.adminUID)

        do {
            let snapshot = try await docRef.getDocument()
            guard let data = snapshot.data(),
                  let ingredientsDb = data[Constants.ingredientsDbField] as? [[String: Any]] else {
                return []
            }
            return ingredientsDb.compactMap { $0["ingredient"] as? String }
        } catch {
            return []
        }
    }

    /// Appends a new ingredient to the admin user's ingredientsDb array.
    /// Checks for duplicate names (case-insensitive) before writing.
    static func appendIngredient(_ ingredient: Ingredient) async throws {
        let docRef = db.collection(Constants.firestoreUsersCollection)
            .document(Constants.adminUID)

        let newDict = ingredient.toDictionary()

        do {
            let snapshot = try await docRef.getDocument()
            var existing: [[String: Any]] = []

            if let data = snapshot.data(),
               let ingredientsDb = data[Constants.ingredientsDbField] as? [[String: Any]] {
                existing = ingredientsDb
            }

            // Check for duplicate name (case-insensitive)
            let newName = ingredient.ingredient.lowercased().trimmingCharacters(in: .whitespaces)
            let isDuplicate = existing.contains { entry in
                guard let name = entry["ingredient"] as? String else { return false }
                return name.lowercased().trimmingCharacters(in: .whitespaces) == newName
            }

            if isDuplicate {
                throw FirestoreError.duplicateIngredient(ingredient.ingredient)
            }

            // Append and write back
            existing.append(newDict)
            try await docRef.setData(
                [Constants.ingredientsDbField: existing],
                merge: true
            )
        } catch let error as FirestoreError {
            throw error
        } catch {
            throw FirestoreError.writeError(error)
        }
    }
}
