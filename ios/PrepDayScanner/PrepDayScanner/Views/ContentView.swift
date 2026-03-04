import SwiftUI

struct ContentView: View {
    @StateObject private var authVM = AuthViewModel()

    var body: some View {
        Group {
            switch authVM.state {
            case .loading:
                ProgressView("Loading...")

            case .signedOut:
                LoginView(authVM: authVM)

            case .signedIn(let isAdmin):
                if isAdmin {
                    MainScannerView(authVM: authVM)
                } else {
                    accessDeniedView
                }
            }
        }
    }

    private var accessDeniedView: some View {
        VStack(spacing: 20) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 60))
                .foregroundColor(.red)
            Text("Access Denied")
                .font(.title.bold())
            Text("This app is restricted to the admin account.")
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            Button("Sign Out") {
                authVM.signOut()
            }
            .buttonStyle(.bordered)
        }
        .padding()
    }
}
