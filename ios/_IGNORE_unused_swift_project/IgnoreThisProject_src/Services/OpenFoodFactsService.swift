import Foundation

enum OFFError: LocalizedError {
    case productNotFound
    case networkError(Error)
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .productNotFound:
            return "Product not found in OpenFoodFacts database."
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .decodingError(let error):
            return "Failed to parse product data: \(error.localizedDescription)"
        }
    }
}

enum OpenFoodFactsService {
    static func fetchProduct(barcode: String) async throws -> OFFProduct {
        let urlString = "\(Constants.offBaseURL)\(barcode).json"
        guard let url = URL(string: urlString) else {
            throw OFFError.productNotFound
        }

        let data: Data
        do {
            var request = URLRequest(url: url)
            request.setValue("PrepDayScanner/1.0 (iOS)", forHTTPHeaderField: "User-Agent")
            let (responseData, _) = try await URLSession.shared.data(for: request)
            data = responseData
        } catch {
            throw OFFError.networkError(error)
        }

        let response: OFFResponse
        do {
            let decoder = JSONDecoder()
            response = try decoder.decode(OFFResponse.self, from: data)
        } catch {
            throw OFFError.decodingError(error)
        }

        guard let product = response.product,
              response.status == 1,
              product.productName != nil,
              !product.productName!.isEmpty else {
            throw OFFError.productNotFound
        }

        return product
    }
}
