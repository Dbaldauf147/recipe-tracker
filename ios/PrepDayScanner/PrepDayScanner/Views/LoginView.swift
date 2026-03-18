import SwiftUI
import AuthenticationServices

struct LoginView: View {
    @ObservedObject var authVM: AuthViewModel

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            Image(systemName: "barcode.viewfinder")
                .font(.system(size: 80))
                .foregroundColor(.blue)

            Text("Prep Day Scanner")
                .font(.largeTitle.bold())

            Text("Scan barcodes to add ingredients\nto your Prep Day database.")
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            VStack(spacing: 12) {
                // Apple Sign-In
                SignInWithAppleButton(.signIn) { request in
                    let hashedNonce = authVM.prepareAppleSignIn()
                    request.requestedScopes = [.fullName, .email]
                    request.nonce = hashedNonce
                } onCompletion: { result in
                    authVM.handleAppleSignIn(result: result)
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 50)
                .cornerRadius(12)

                // Google Sign-In
                Button(action: { authVM.signInWithGoogle() }) {
                    HStack {
                        Image(systemName: "person.crop.circle.fill")
                        Text("Sign in with Google")
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
            }
            .padding(.horizontal, 40)

            if let error = authVM.errorMessage {
                Text(error)
                    .foregroundColor(.red)
                    .font(.caption)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            Spacer()
        }
        .padding()
    }
}
