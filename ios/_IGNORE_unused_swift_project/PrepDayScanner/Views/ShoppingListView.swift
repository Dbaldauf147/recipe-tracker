import SwiftUI

/// Shopping List bottom tab. Contains two sub-tabs at the top:
/// "Shopping List" and "Pantry". Both are placeholders for now — real
/// content will come later. The Pantry sub-tab replaces what would
/// otherwise be a separate bottom tab, keeping the bottom bar uncluttered.
struct ShoppingListView: View {
    @ObservedObject var authVM: AuthViewModel

    enum SubTab: String, CaseIterable, Identifiable {
        case shopping = "Shopping List"
        case pantry = "Pantry"
        var id: String { rawValue }
    }

    @State private var subTab: SubTab = .shopping

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Section", selection: $subTab) {
                    ForEach(SubTab.allCases) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)

                Divider()

                Group {
                    switch subTab {
                    case .shopping: shoppingPlaceholder
                    case .pantry:   pantryPlaceholder
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationTitle("Shopping")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Sign Out") { authVM.signOut() }
                        .font(.caption)
                }
            }
        }
    }

    private var shoppingPlaceholder: some View {
        placeholder(
            icon: "cart",
            title: "Shopping List",
            subtitle: "Your weekly shopping list will live here."
        )
    }

    private var pantryPlaceholder: some View {
        placeholder(
            icon: "cabinet",
            title: "Pantry",
            subtitle: "Items you already have in your pantry."
        )
    }

    private func placeholder(icon: String, title: String, subtitle: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 56))
                .foregroundColor(.secondary)
            Text(title)
                .font(.title2.bold())
            Text(subtitle)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Text("Coming soon")
                .font(.caption)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Color.secondary.opacity(0.15))
                .cornerRadius(6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}
