import SwiftUI

struct SuccessView: View {
    let onScanAnother: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 80))
                .foregroundColor(.green)

            Text("Saved!")
                .font(.title.bold())

            Text("Ingredient added to your\nPrep Day database.")
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Button(action: onScanAnother) {
                HStack {
                    Image(systemName: "barcode.viewfinder")
                    Text("Scan Another")
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.blue)
                .foregroundColor(.white)
                .cornerRadius(12)
            }
            .padding(.horizontal, 40)

            Spacer()
        }
        .padding()
    }
}
