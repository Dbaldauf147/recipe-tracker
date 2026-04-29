import Foundation

@MainActor
final class IngredientEditorViewModel: ObservableObject {
    enum SaveState: Equatable {
        case idle
        case saving
        case saved
        case error(String)
    }

    @Published var ingredient: Ingredient
    @Published var saveState: SaveState = .idle
    @Published var existingNames: [String] = []

    init(ingredient: Ingredient) {
        self.ingredient = ingredient
        Task { await loadExistingNames() }
    }

    private func loadExistingNames() async {
        existingNames = await FirestoreService.fetchIngredientNames()
    }

    /// Returns names that contain the current ingredient text, case-insensitive.
    var filteredSuggestions: [String] {
        let query = ingredient.ingredient.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return [] }
        return existingNames.filter { $0.lowercased().contains(query) }
    }

    var canSave: Bool {
        !ingredient.ingredient.trimmingCharacters(in: .whitespaces).isEmpty
    }

    func save() {
        guard canSave else { return }
        saveState = .saving

        Task {
            do {
                try await FirestoreService.appendIngredient(ingredient)
                saveState = .saved
            } catch {
                saveState = .error(error.localizedDescription)
            }
        }
    }
}
