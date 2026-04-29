import Foundation
import UIKit

@MainActor
final class ScannerViewModel: ObservableObject {
    enum ScanState: Equatable {
        case scanning
        case loading(barcode: String)
        case found(barcode: String)
        case notFound
        case error(String)
    }

    @Published var state: ScanState = .scanning
    @Published var scannedIngredient: Ingredient?

    func onBarcodeScanned(_ barcode: String) {
        guard state == .scanning else { return }

        // Haptic feedback
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)

        state = .loading(barcode: barcode)

        Task {
            do {
                let product = try await OpenFoodFactsService.fetchProduct(barcode: barcode)
                let ingredient = NutrientMapper.map(product: product, barcode: barcode)
                scannedIngredient = ingredient
                state = .found(barcode: barcode)
            } catch let error as OFFError {
                switch error {
                case .productNotFound:
                    state = .notFound
                default:
                    state = .error(error.localizedDescription)
                }
            } catch {
                state = .error(error.localizedDescription)
            }
        }
    }

    func reset() {
        state = .scanning
        scannedIngredient = nil
    }
}
