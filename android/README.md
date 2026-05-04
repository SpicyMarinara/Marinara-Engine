# Marinara Engine - Android APK

The Android app is a thin WebView wrapper around Marinara Engine running locally in Termux. It is not a standalone server build.

## How It Works

- Start Marinara Engine in Termux with `./start-termux.sh`.
- The APK opens `http://127.0.0.1:<PORT>` inside a fullscreen WebView. The default build-time port is `7860`.
- The server, launcher updates, and `AUTO_OPEN_BROWSER` behavior are owned by the Termux launcher, not by this APK.
- Release and versioning policy follows the main repo docs in [../CONTRIBUTING.md](../CONTRIBUTING.md): root `package.json` is canonical, Android `versionName` should match the app version, and `versionCode` must increase for every shipped APK.
- If you build the APK with a non-default port, Termux must use the same `PORT` value in `.env`.

**Flow:** start the server in Termux, then open the Marinara Engine Android app.

## Features

- Native app icon on the home screen
- Full-screen standalone experience without browser chrome
- Automatic retry while the local server is still starting
- File upload support for character cards, images, and similar assets
- Back button navigation inside the WebView
- External links open in your default browser
- Android backup is disabled for the wrapper app, and the WebView disallows file URL access and mixed-content loading.

## Building the APK

### Prerequisites

- **Java 17+** — `brew install openjdk@17` (macOS) or `pkg install openjdk-17` (Termux)
- **Android SDK** — Set the `ANDROID_HOME` environment variable
- **Gradle** — `brew install gradle` (macOS) or `pkg install gradle` (Termux)

### Build

```bash
cd android

# Debug APK (for testing)
./build-apk.sh

# Release APK
./build-apk.sh release

# Optional: build against a different local server port
MARINARA_PORT=9000 ./build-apk.sh
```

Build outputs:

- Debug: `app/build/outputs/apk/debug/app-debug.apk`
- Release: `app/build/outputs/apk/release/app-release-unsigned.apk`

### Install

```bash
# Via ADB
adb install app/build/outputs/apk/debug/app-debug.apk

# Or transfer the APK file to your phone and open it there
```

## Building on Termux (on-device)

You can build the APK directly on your Android device:

```bash
# Install prerequisites
pkg install openjdk-17 gradle

# Set ANDROID_HOME (adjust if your SDK is elsewhere)
export ANDROID_HOME=$HOME/android-sdk

# Build
cd android
./build-apk.sh
```

## Usage

1. Start Marinara Engine in Termux:

   ```bash
   ./start-termux.sh
   ```

2. Open the **Marinara Engine** app from your home screen.
3. The app shows "Connecting..." until the local server is ready, then loads automatically.

Because the APK points at `http://127.0.0.1:<PORT>`, it only works while the Marinara Engine server is running on the same Android device and using the same port value.

## Pre-built APKs

When maintainers attach them to a tagged release, pre-built APKs are available on the main [Releases](https://github.com/Pasta-Devs/Marinara-Engine/releases) page.
