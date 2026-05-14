#!/usr/bin/env bash
# Build the Marinara Engine Android APK
# Requires: Android SDK (ANDROID_HOME or ANDROID_SDK_ROOT set) and Java 17+
#
# Usage:
#   ./build-apk.sh          # debug APK
#   ./build-apk.sh release  # release APK
#   MARINARA_PORT=9000 ./build-apk.sh

set -euo pipefail
cd "$(dirname "$0")"

BUILD_TYPE="${1:-debug}"
MARINARA_PORT="${MARINARA_PORT:-}"
GRADLE_ARGS=()
if [ -n "$MARINARA_PORT" ]; then
    GRADLE_ARGS+=("-PmarinaraPort=${MARINARA_PORT}")
fi

# Verify ANDROID_HOME
if [ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]; then
    echo "Error: ANDROID_HOME or ANDROID_SDK_ROOT is not set."
    echo ""
    echo "Install Android SDK command-line tools:"
    echo "  macOS:  brew install --cask android-commandlinetools"
    echo "  Linux:  Download from https://developer.android.com/studio#command-line-tools-only"
    echo "  Termux: pkg install openjdk-17 && pkg install gradle"
    echo ""
    echo "Then set: export ANDROID_HOME=\$HOME/Android/Sdk"
    exit 1
fi

export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"

# Check for Java
if ! command -v java &>/dev/null; then
    echo "Error: Java not found. Install JDK 17+."
    echo "  macOS:  brew install openjdk@17"
    echo "  Termux: pkg install openjdk-17"
    exit 1
fi

echo "Building Marinara Engine APK ($BUILD_TYPE)..."

# Use gradlew if available, otherwise system gradle
if [ -f "./gradlew" ]; then
    chmod +x ./gradlew
    GRADLE_CMD="./gradlew"
else
    if command -v gradle &>/dev/null; then
        GRADLE_CMD="gradle"
    else
        echo "Downloading Gradle wrapper..."
        gradle wrapper --gradle-version 8.5 2>/dev/null || {
            echo "Error: Gradle not found. Install it or run from Android Studio."
            echo "  macOS:  brew install gradle"
            echo "  Termux: pkg install gradle"
            exit 1
        }
        chmod +x ./gradlew
        GRADLE_CMD="./gradlew"
    fi
fi

if [ "$BUILD_TYPE" = "release" ]; then
    $GRADLE_CMD "${GRADLE_ARGS[@]}" assembleRelease
    APK_PATH=$(find app/build/outputs/apk/release -name "*.apk" | head -n1)
else
    $GRADLE_CMD "${GRADLE_ARGS[@]}" assembleDebug
    APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
fi

if [ -n "${APK_PATH:-}" ] && [ -f "$APK_PATH" ]; then
    SIZE=$(du -h "$APK_PATH" | cut -f1)
    echo ""
    echo "✓ APK built successfully ($SIZE)"
    echo "  $APK_PATH"
    echo ""
    echo "Install on device:"
    echo "  adb install $APK_PATH"
    echo ""
    echo "Important: this APK is a WebView shell, not a standalone server app."
    echo "Start Marinara Engine in Termux with ./start-termux.sh before opening it."
    echo ""
    echo "Or copy to phone and open the file to install."
else
    echo "Error: APK not found at expected path."
    exit 1
fi
