# Prep Day Scanner — Setup Guide

## Prerequisites
- Mac with Xcode 15+ installed
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) installed (`brew install xcodegen`)
- Your Firebase project: `sunday-routine`

## Step 1: Generate the Xcode project

```bash
cd ios/PrepDayScanner
xcodegen generate
```

This reads `project.yml` and creates `PrepDayScanner.xcodeproj`.

## Step 2: Add your iOS app to Firebase

1. Go to [Firebase Console](https://console.firebase.google.com) → `sunday-routine` project
2. Project Settings → General → "Add app" → iOS
3. Bundle ID: `com.sundayroutine.prepdayscanner`
4. App nickname: `Prep Day Scanner`
5. Skip "Download config file" for now, click through to finish

## Step 3: Download GoogleService-Info.plist

1. In Firebase Console → Project Settings → Your iOS app
2. Download `GoogleService-Info.plist`
3. Place it at: `PrepDayScanner/Resources/GoogleService-Info.plist`

## Step 4: Update the URL scheme

1. Open `GoogleService-Info.plist` and find the `REVERSED_CLIENT_ID` value
2. Open `PrepDayScanner/Info.plist`
3. Replace `REVERSED_CLIENT_ID_FROM_GOOGLE_SERVICE_INFO_PLIST` with the actual reversed client ID value

## Step 5: Open in Xcode and resolve packages

```bash
open PrepDayScanner.xcodeproj
```

Xcode will automatically fetch SPM dependencies (Firebase SDK, Google Sign-In).

## Step 6: Set your development team

1. In Xcode → Target → Signing & Capabilities
2. Select your development team
3. Ensure bundle ID is `com.sundayroutine.prepdayscanner`

## Step 7: Build and run

1. Select your iPhone (or a simulator — note: barcode scanning won't work on simulator)
2. Build and run (Cmd+R)

## Alternative: Create project manually in Xcode

If you prefer not to use XcodeGen:

1. Open Xcode → File → New → Project → iOS → App
2. Product Name: `PrepDayScanner`
3. Bundle ID: `com.sundayroutine.prepdayscanner`
4. Interface: SwiftUI, Language: Swift
5. Delete the auto-generated files (ContentView.swift, etc.)
6. Drag all files from the `PrepDayScanner/` folder into the Xcode project
7. File → Add Package Dependencies:
   - `https://github.com/firebase/firebase-ios-sdk` → select `FirebaseAuth`, `FirebaseFirestore`
   - `https://github.com/google/GoogleSignIn-iOS` → select `GoogleSignIn`, `GoogleSignInSwift`
8. Add `GoogleService-Info.plist` to the project
9. Add `NSCameraUsageDescription` to Info.plist (already in our Info.plist)
10. Add URL Type with `REVERSED_CLIENT_ID` from GoogleService-Info.plist
