import SwiftUI

struct MainTabView: View {
    @ObservedObject var authVM: AuthViewModel

    var body: some View {
        TabView {
            MainScannerView(authVM: authVM)
                .tabItem {
                    Label("Scan", systemImage: "barcode.viewfinder")
                }

            LogWorkoutView(authVM: authVM)
                .tabItem {
                    Label("Log Workout", systemImage: "dumbbell.fill")
                }
        }
    }
}
