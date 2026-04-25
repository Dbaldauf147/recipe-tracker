import SwiftUI

struct MainTabView: View {
    @ObservedObject var authVM: AuthViewModel

    var body: some View {
        TabView {
            MainScannerView(authVM: authVM)
                .tabItem {
                    Label("Scan", systemImage: "barcode.viewfinder")
                }

            ShoppingListView(authVM: authVM)
                .tabItem {
                    Label("Shopping", systemImage: "cart.fill")
                }

            LogWorkoutView(authVM: authVM)
                .tabItem {
                    Label("Log Workout", systemImage: "dumbbell.fill")
                }
        }
    }
}
