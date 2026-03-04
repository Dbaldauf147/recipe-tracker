import SwiftUI

struct MainScannerView: View {
    @ObservedObject var authVM: AuthViewModel
    @StateObject private var scannerVM = ScannerViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                // Camera is always running underneath
                ScannerView { barcode in
                    scannerVM.onBarcodeScanned(barcode)
                }
                .ignoresSafeArea()

                // State-driven overlays
                switch scannerVM.state {
                case .scanning:
                    scanningOverlay

                case .loading(let barcode):
                    loadingOverlay(barcode: barcode)

                case .found:
                    Color.clear
                        .onAppear {
                            // Navigation handled by sheet
                        }

                case .notFound:
                    notFoundOverlay

                case .error(let message):
                    errorOverlay(message: message)
                }
            }
            .navigationTitle("Prep Day Scanner")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Sign Out") {
                        authVM.signOut()
                    }
                    .font(.caption)
                }
            }
            .sheet(isPresented: showEditorBinding) {
                if let ingredient = scannerVM.scannedIngredient {
                    IngredientEditorView(
                        ingredient: ingredient,
                        onDismiss: { scannerVM.reset() }
                    )
                }
            }
        }
    }

    private var showEditorBinding: Binding<Bool> {
        Binding(
            get: {
                if case .found = scannerVM.state { return true }
                return false
            },
            set: { newValue in
                if !newValue { scannerVM.reset() }
            }
        )
    }

    // MARK: - Overlays

    private var scanningOverlay: some View {
        VStack {
            Spacer()
            // Scanning reticle hint
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(.white, lineWidth: 3)
                .frame(width: 280, height: 120)
                .shadow(radius: 10)
            Text("Point at a barcode")
                .foregroundColor(.white)
                .font(.headline)
                .padding(8)
                .background(.black.opacity(0.6))
                .cornerRadius(8)
            Spacer()
        }
    }

    private func loadingOverlay(barcode: String) -> some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)
                .tint(.white)
            Text("Looking up \(barcode)...")
                .foregroundColor(.white)
                .font(.headline)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black.opacity(0.7))
    }

    private var notFoundOverlay: some View {
        VStack(spacing: 20) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 50))
                .foregroundColor(.yellow)
            Text("Product Not Found")
                .font(.title2.bold())
                .foregroundColor(.white)
            Text("This barcode isn't in the\nOpenFoodFacts database.")
                .foregroundColor(.white.opacity(0.8))
                .multilineTextAlignment(.center)
            Button("Try Again") {
                scannerVM.reset()
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black.opacity(0.8))
    }

    private func errorOverlay(message: String) -> some View {
        VStack(spacing: 20) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 50))
                .foregroundColor(.red)
            Text("Error")
                .font(.title2.bold())
                .foregroundColor(.white)
            Text(message)
                .foregroundColor(.white.opacity(0.8))
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            Button("Try Again") {
                scannerVM.reset()
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black.opacity(0.8))
    }
}
