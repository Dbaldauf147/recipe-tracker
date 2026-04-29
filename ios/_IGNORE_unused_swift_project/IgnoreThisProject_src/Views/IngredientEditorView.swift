import SwiftUI

struct IngredientEditorView: View {
    @StateObject private var vm: IngredientEditorViewModel
    @Environment(\.dismiss) private var dismiss
    let onDismiss: () -> Void

    init(ingredient: Ingredient, onDismiss: @escaping () -> Void) {
        _vm = StateObject(wrappedValue: IngredientEditorViewModel(ingredient: ingredient))
        self.onDismiss = onDismiss
    }

    var body: some View {
        NavigationStack {
            Group {
                if vm.saveState == .saved {
                    SuccessView {
                        dismiss()
                        onDismiss()
                    }
                } else {
                    formContent
                }
            }
            .navigationTitle("Edit Ingredient")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                        onDismiss()
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    if vm.saveState == .saving {
                        ProgressView()
                    } else if vm.saveState != .saved {
                        Button("Save") { vm.save() }
                            .bold()
                            .disabled(!vm.canSave)
                    }
                }
            }
        }
    }

    @State private var showSuggestions = false
    @FocusState private var nameFieldFocused: Bool

    private var formContent: some View {
        Form {
            Section("Basic Info") {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Name")
                            .frame(width: 130, alignment: .leading)
                            .font(.subheadline)
                        TextField("", text: $vm.ingredient.ingredient)
                            .textFieldStyle(.roundedBorder)
                            .focused($nameFieldFocused)
                            .onChange(of: vm.ingredient.ingredient) { _ in
                                showSuggestions = nameFieldFocused
                            }
                            .onChange(of: nameFieldFocused) { focused in
                                showSuggestions = focused && !vm.ingredient.ingredient.trimmingCharacters(in: .whitespaces).isEmpty
                            }
                    }
                    if showSuggestions && !vm.filteredSuggestions.isEmpty {
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 0) {
                                ForEach(vm.filteredSuggestions.prefix(8), id: \.self) { name in
                                    Button {
                                        vm.ingredient.ingredient = name
                                        showSuggestions = false
                                        nameFieldFocused = false
                                    } label: {
                                        Text(name)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .padding(.vertical, 8)
                                            .padding(.horizontal, 12)
                                    }
                                    .foregroundColor(.primary)
                                    Divider()
                                }
                            }
                        }
                        .frame(maxHeight: 200)
                        .background(Color(.systemBackground))
                        .cornerRadius(8)
                        .shadow(color: .black.opacity(0.1), radius: 4, y: 2)
                    }
                }
                field("Grams", $vm.ingredient.grams, keyboard: .decimalPad)
                field("Measurement", $vm.ingredient.measurement)
            }

            Section("Macronutrients") {
                field("Calories", $vm.ingredient.calories, keyboard: .decimalPad)
                field("Protein (g)", $vm.ingredient.protein, keyboard: .decimalPad)
                field("Carbs (g)", $vm.ingredient.carbs, keyboard: .decimalPad)
                field("Fat (g)", $vm.ingredient.fat, keyboard: .decimalPad)
                field("Saturated Fat (g)", $vm.ingredient.saturatedFat, keyboard: .decimalPad)
                field("Fiber (g)", $vm.ingredient.fiber, keyboard: .decimalPad)
            }

            Section("Sugars") {
                field("Sugar (g)", $vm.ingredient.sugar, keyboard: .decimalPad)
                field("Added Sugar (g)", $vm.ingredient.addedSugar, keyboard: .decimalPad)
            }

            Section("Minerals") {
                field("Sodium (mg)", $vm.ingredient.sodium, keyboard: .decimalPad)
                field("Potassium (mg)", $vm.ingredient.potassium, keyboard: .decimalPad)
                field("Calcium (mg)", $vm.ingredient.calcium, keyboard: .decimalPad)
                field("Magnesium (mg)", $vm.ingredient.magnesium, keyboard: .decimalPad)
                field("Iron (mg)", $vm.ingredient.iron, keyboard: .decimalPad)
                field("Zinc (mg)", $vm.ingredient.zinc, keyboard: .decimalPad)
            }

            Section("Vitamins") {
                field("Vitamin B12 (µg)", $vm.ingredient.vitaminB12, keyboard: .decimalPad)
                field("Vitamin C (mg)", $vm.ingredient.vitaminC, keyboard: .decimalPad)
            }

            Section("Other Nutrients") {
                field("Leucine (g)", $vm.ingredient.leucine, keyboard: .decimalPad)
                field("Omega 3", $vm.ingredient.omega3, keyboard: .decimalPad)
                field("Protein/Cal", $vm.ingredient.proteinPerCal, keyboard: .decimalPad)
                field("Fiber/Cal", $vm.ingredient.fiberPerCal, keyboard: .decimalPad)
            }

            Section("Details") {
                field("Processed?", $vm.ingredient.processed)
                field("Notes", $vm.ingredient.notes)
                field("Link", $vm.ingredient.link, keyboard: .URL)
                field("Last Bought", $vm.ingredient.lastBought)
                field("Storage", $vm.ingredient.storage)
                field("Min Shelf (days)", $vm.ingredient.minShelf, keyboard: .numberPad)
                field("Max Shelf (days)", $vm.ingredient.maxShelf, keyboard: .numberPad)
            }

            if case .error(let message) = vm.saveState {
                Section {
                    Text(message)
                        .foregroundColor(.red)
                }
            }
        }
    }

    private func field(
        _ label: String,
        _ binding: Binding<String>,
        keyboard: UIKeyboardType = .default
    ) -> some View {
        HStack {
            Text(label)
                .frame(width: 130, alignment: .leading)
                .font(.subheadline)
            TextField("", text: binding)
                .keyboardType(keyboard)
                .textFieldStyle(.roundedBorder)
        }
    }
}
