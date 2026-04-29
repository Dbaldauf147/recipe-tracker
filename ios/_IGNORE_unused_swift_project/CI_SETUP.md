# Prep Day Scanner — CI / TestFlight Setup

This doc explains how to wire up `.github/workflows/ios-build.yml`
so that **every push to `master` automatically uploads a new build to
TestFlight**, and you can install it from the TestFlight app on your
phone without ever opening Xcode locally.

> One-time setup. After this you don't have to touch your Mac for
> normal iOS updates.

## Step 0: Replace the workflow file

Open `.github/workflows/ios-build.yml` in the GitHub web UI (or your
local editor) and replace its entire contents with the YAML at the
bottom of this doc ([see "Workflow YAML"](#workflow-yaml)). Commit
the change to `master` (or the feature branch — anywhere you have
push permission).

> **Why you have to do this manually:** the assistant that wrote
> this doc isn't allowed to push changes to files under
> `.github/workflows/` — GitHub only lets tokens with the special
> `workflow` scope edit them. Easiest way: open the file in
> github.com, click the pencil icon, paste, commit.

## Prerequisites

You need an **Apple Developer Program** membership ($99/yr) for the
team that owns the bundle ID `com.sundayroutine.prepdayscanner`. If
you've never enrolled, do that first at
<https://developer.apple.com/programs/>.

You also need the app to exist in **App Store Connect**:

1. <https://appstoreconnect.apple.com> → My Apps → **+** → New App
2. Platform: iOS, Bundle ID: `com.sundayroutine.prepdayscanner`,
   SKU anything (e.g. `prepdayscanner`).
3. You don't have to submit anything — just creating the record is
   enough for TestFlight uploads.

## How it works

The workflow has two modes:

- **Push to `master`** → archive, sign, upload to TestFlight.
- **Manual trigger from Actions tab on any other branch** → just
  verify the app compiles (no signing, no upload). Useful for
  testing feature branches before merging.

CFBundleVersion is bumped on every run to `${{ github.run_number }}`,
so TestFlight always gets a unique build number.

## GitHub repo secrets to add

Add each of these at **Repo → Settings → Secrets and variables →
Actions → New repository secret**.

| Secret name | What it is | How to get it |
|---|---|---|
| `APPLE_TEAM_ID` | 10-char team ID, e.g. `ABC123XYZ4` | <https://developer.apple.com/account> → Membership |
| `GOOGLE_SERVICE_INFO_PLIST` | base64 of `GoogleService-Info.plist` | `base64 -i GoogleService-Info.plist \| pbcopy` |
| `APPLE_P12_BASE64` | base64 of the **Apple Distribution** signing cert exported as `.p12` | See "Export the .p12" below |
| `APPLE_P12_PASSWORD` | The password you set when exporting the .p12 | (whatever you typed) |
| `APPLE_PROVISION_PROFILE_BASE64` | base64 of the App Store provisioning profile (`.mobileprovision`) | See "Provisioning profile" below |
| `APP_STORE_CONNECT_API_KEY` | base64 of the App Store Connect API key (`.p8` file) | See "App Store Connect API key" below |
| `ASC_KEY_ID` | 10-char API key ID, e.g. `AB12CD34EF` | App Store Connect → Users and Access → Integrations → App Store Connect API |
| `ASC_ISSUER_ID` | UUID, e.g. `12345678-90ab-cdef-1234-567890abcdef` | Same page as the key ID, shown at the top |

Detailed instructions for the three "see below" rows are below.

### Export the .p12 (signing certificate)

1. On a Mac, open **Keychain Access**.
2. If you don't already have an Apple Distribution certificate:
   - <https://developer.apple.com/account> → Certificates → **+**
   - Type: **Apple Distribution**
   - Follow the CSR (Certificate Signing Request) flow — Keychain
     Access → Certificate Assistant → Request a Certificate from a
     Certificate Authority… → save to disk → upload that CSR.
   - Download the resulting `.cer` and double-click to add to
     Keychain.
3. In Keychain Access → My Certificates, find **Apple Distribution:
   <Your Name> (TEAM_ID)** with the matching private key (the
   triangle disclosure shows a key under it).
4. Right-click → **Export** → format **Personal Information
   Exchange (.p12)** → set a password → save as `cert.p12`.
5. Convert to base64 for the secret:
   ```bash
   base64 -i cert.p12 | pbcopy
   ```
   Paste into the `APPLE_P12_BASE64` secret. Put the password into
   `APPLE_P12_PASSWORD`.

### Provisioning profile

1. <https://developer.apple.com/account> → Profiles → **+**
2. Type: **App Store** (under Distribution).
3. App ID: `com.sundayroutine.prepdayscanner` (create the App ID
   first if it doesn't exist — Identifiers → **+** → App IDs).
4. Certificate: pick the Apple Distribution certificate from above.
5. Name it something like `Prep Day Scanner App Store`.
6. Download the `.mobileprovision` file.
7. Convert and copy:
   ```bash
   base64 -i Prep_Day_Scanner_App_Store.mobileprovision | pbcopy
   ```
   Paste into the `APPLE_PROVISION_PROFILE_BASE64` secret.

### App Store Connect API key

1. <https://appstoreconnect.apple.com> → **Users and Access** →
   **Integrations** → **App Store Connect API**.
2. Click **+** to generate a new key. Role: **App Manager** is
   sufficient for TestFlight uploads (Admin works too).
3. Download the `.p8` file (you can only download once — keep it
   safe).
4. Note the **Key ID** (e.g. `AB12CD34EF`) → `ASC_KEY_ID` secret.
5. Note the **Issuer ID** at the top of the page (UUID) →
   `ASC_ISSUER_ID` secret.
6. Convert the `.p8` to base64:
   ```bash
   base64 -i AuthKey_AB12CD34EF.p8 | pbcopy
   ```
   Paste into the `APP_STORE_CONNECT_API_KEY` secret.

## First run

Once all eight secrets are saved:

1. Merge your feature branch into `master` (or push directly to
   `master`).
2. Watch the build at **Actions → iOS Build & TestFlight**.
3. After ~10–15 min, the build appears in App Store Connect →
   TestFlight → Builds with status "Processing", then "Ready to
   Submit". Internal testers (you) get it via the TestFlight app on
   your phone.
4. The very first TestFlight build will ask you to fill in **export
   compliance** info (one-time per app). After that, builds appear
   automatically.

## Testing a feature branch without uploading

From the **Actions** tab → **iOS Build & TestFlight** → **Run
workflow** dropdown → pick your feature branch → Run. This does a
no-signing build and tells you whether the app compiles, without
touching TestFlight.

## Common failure modes

- **"No signing certificate found"** — `APPLE_P12_BASE64` is wrong
  or the password is wrong. Re-export from Keychain Access.
- **"Provisioning profile doesn't include the bundle identifier"** —
  the profile was generated for the wrong App ID. Make sure it's tied
  to `com.sundayroutine.prepdayscanner`.
- **"This bundle is invalid. The value for key CFBundleVersion … must
  be higher than"** — TestFlight rejects duplicate build numbers. The
  workflow uses `github.run_number` which is monotonic, so this only
  happens if you delete the workflow runs and start over. Easiest
  fix: bump `CFBundleShortVersionString` (the marketing version like
  `1.0.1`) in `Info.plist`.
- **"Authentication credentials are missing or invalid"** during
  `altool --upload-app` — `ASC_KEY_ID` / `ASC_ISSUER_ID` /
  `APP_STORE_CONNECT_API_KEY` mismatch. Verify on the App Store
  Connect API page.

## Workflow YAML

Paste this as the entire contents of `.github/workflows/ios-build.yml`:

```yaml
name: iOS Build & TestFlight

on:
  push:
    paths:
      - 'ios/**'
      - '.github/workflows/ios-build.yml'
    branches: [master]
  workflow_dispatch: # allows manual trigger from any branch in the Actions tab

jobs:
  build:
    runs-on: macos-14
    timeout-minutes: 40

    env:
      BUNDLE_ID: com.sundayroutine.prepdayscanner
      SCHEME: PrepDayScanner
      PROJECT_DIR: ios/PrepDayScanner
      # Build number = github.run_number, so every CI run produces a
      # unique CFBundleVersion (TestFlight rejects duplicates).
      BUILD_NUMBER: ${{ github.run_number }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Select Xcode 15
        run: sudo xcode-select -s /Applications/Xcode_15.4.app/Contents/Developer

      - name: Install XcodeGen
        run: brew install xcodegen

      - name: Decode GoogleService-Info.plist
        run: |
          mkdir -p $PROJECT_DIR/PrepDayScanner/Resources
          echo "${{ secrets.GOOGLE_SERVICE_INFO_PLIST }}" \
            | base64 --decode \
            > $PROJECT_DIR/PrepDayScanner/Resources/GoogleService-Info.plist

      - name: Generate Xcode project
        working-directory: ${{ env.PROJECT_DIR }}
        run: xcodegen generate

      - name: Bump CFBundleVersion to GitHub run number
        run: |
          /usr/libexec/PlistBuddy \
            -c "Set :CFBundleVersion ${BUILD_NUMBER}" \
            $PROJECT_DIR/PrepDayScanner/Info.plist

      - name: Resolve Swift packages
        working-directory: ${{ env.PROJECT_DIR }}
        run: |
          xcodebuild -resolvePackageDependencies \
            -project PrepDayScanner.xcodeproj \
            -scheme PrepDayScanner

      # On manual triggers from non-master branches, just verify the app
      # compiles. Full archive + TestFlight upload only on master pushes.
      - name: Verify build (no signing)
        if: github.ref != 'refs/heads/master'
        working-directory: ${{ env.PROJECT_DIR }}
        run: |
          xcodebuild build \
            -project PrepDayScanner.xcodeproj \
            -scheme $SCHEME \
            -destination 'generic/platform=iOS' \
            -configuration Release \
            CODE_SIGNING_ALLOWED=NO \
            CODE_SIGNING_REQUIRED=NO \
            CODE_SIGN_IDENTITY="" \
            | tail -30

      - name: Install Apple certificate & provisioning profile
        if: github.ref == 'refs/heads/master'
        env:
          P12_BASE64: ${{ secrets.APPLE_P12_BASE64 }}
          P12_PASSWORD: ${{ secrets.APPLE_P12_PASSWORD }}
          PROVISION_BASE64: ${{ secrets.APPLE_PROVISION_PROFILE_BASE64 }}
        run: |
          set -euo pipefail
          CERT_PATH="$RUNNER_TEMP/cert.p12"
          PROV_PATH="$RUNNER_TEMP/profile.mobileprovision"
          KEYCHAIN_PATH="$RUNNER_TEMP/app-signing.keychain-db"
          KEYCHAIN_PASSWORD="$(uuidgen)"

          echo "$P12_BASE64" | base64 --decode > "$CERT_PATH"
          echo "$PROVISION_BASE64" | base64 --decode > "$PROV_PATH"

          security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security import "$CERT_PATH" -P "$P12_PASSWORD" \
            -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
          security set-key-partition-list \
            -S apple-tool:,apple: -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security list-keychain -d user -s "$KEYCHAIN_PATH" login.keychain

          mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
          PROFILE_UUID=$(/usr/libexec/PlistBuddy -c "Print :UUID" \
            /dev/stdin <<< "$(security cms -D -i "$PROV_PATH")")
          cp "$PROV_PATH" \
            "$HOME/Library/MobileDevice/Provisioning Profiles/${PROFILE_UUID}.mobileprovision"

          PROFILE_NAME=$(/usr/libexec/PlistBuddy -c "Print :Name" \
            /dev/stdin <<< "$(security cms -D -i "$PROV_PATH")")
          echo "PROFILE_NAME=$PROFILE_NAME" >> "$GITHUB_ENV"
          echo "PROFILE_UUID=$PROFILE_UUID" >> "$GITHUB_ENV"

      - name: Archive
        if: github.ref == 'refs/heads/master'
        working-directory: ${{ env.PROJECT_DIR }}
        env:
          TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: |
          set -euo pipefail
          xcodebuild archive \
            -project PrepDayScanner.xcodeproj \
            -scheme $SCHEME \
            -archivePath "$RUNNER_TEMP/PrepDayScanner.xcarchive" \
            -configuration Release \
            -destination 'generic/platform=iOS' \
            DEVELOPMENT_TEAM="$TEAM_ID" \
            CODE_SIGN_STYLE=Manual \
            CODE_SIGN_IDENTITY="Apple Distribution" \
            PROVISIONING_PROFILE_SPECIFIER="$PROFILE_NAME" \
            CURRENT_PROJECT_VERSION=$BUILD_NUMBER \
            | tail -50

      - name: Write ExportOptions.plist
        if: github.ref == 'refs/heads/master'
        env:
          TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: |
          cat > "$RUNNER_TEMP/ExportOptions.plist" <<EOF
          <?xml version="1.0" encoding="UTF-8"?>
          <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
            "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
          <plist version="1.0">
          <dict>
            <key>method</key>
            <string>app-store</string>
            <key>teamID</key>
            <string>${TEAM_ID}</string>
            <key>signingStyle</key>
            <string>manual</string>
            <key>signingCertificate</key>
            <string>Apple Distribution</string>
            <key>provisioningProfiles</key>
            <dict>
              <key>${BUNDLE_ID}</key>
              <string>${PROFILE_NAME}</string>
            </dict>
            <key>uploadBitcode</key>
            <false/>
            <key>uploadSymbols</key>
            <true/>
            <key>destination</key>
            <string>export</string>
          </dict>
          </plist>
          EOF

      - name: Export IPA
        if: github.ref == 'refs/heads/master'
        run: |
          set -euo pipefail
          xcodebuild -exportArchive \
            -archivePath "$RUNNER_TEMP/PrepDayScanner.xcarchive" \
            -exportPath "$RUNNER_TEMP/export" \
            -exportOptionsPlist "$RUNNER_TEMP/ExportOptions.plist" \
            | tail -50
          ls -la "$RUNNER_TEMP/export"

      - name: Upload to TestFlight
        if: github.ref == 'refs/heads/master'
        env:
          ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}
          ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}
          ASC_KEY_P8_BASE64: ${{ secrets.APP_STORE_CONNECT_API_KEY }}
        run: |
          set -euo pipefail
          # altool looks for the .p8 here automatically.
          mkdir -p "$HOME/.appstoreconnect/private_keys"
          echo "$ASC_KEY_P8_BASE64" | base64 --decode \
            > "$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"

          IPA=$(ls "$RUNNER_TEMP/export"/*.ipa | head -1)
          echo "Uploading: $IPA"
          xcrun altool --upload-app \
            --type ios \
            --file "$IPA" \
            --apiKey "$ASC_KEY_ID" \
            --apiIssuer "$ASC_ISSUER_ID"
```
