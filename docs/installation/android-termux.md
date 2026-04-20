# Android (Termux) Installation Guide

Marinara Engine runs on Android via [Termux](https://f-droid.org/en/packages/com.termux/), a terminal emulator and Linux environment for Android.

## Prerequisites

Install **Termux** from [F-Droid](https://f-droid.org/en/packages/com.termux/). Do **not** use the Play Store version — it is outdated and unsupported.

## Installation

Open Termux and run:

```bash
pkg update && pkg install -y git nodejs-lts && git clone https://github.com/Pasta-Devs/Marinara-Engine.git && cd Marinara-Engine && chmod +x start-termux.sh && ./start-termux.sh
```

This one-liner:
1. Updates Termux packages
2. Installs Git and Node.js
3. Clones the Marinara Engine repo
4. Makes the launcher executable
5. Runs the Termux launcher for the first time

The Termux launcher downloads the prebuilt SQLite native module when available, installs dependencies, builds the app, and starts the server at `http://127.0.0.1:<PORT>` using the `PORT` value from `.env` or the default `7860`.

> **Note:** The first run takes a few minutes because it builds the app on your device. Subsequent runs are much faster.

After installation, open **<http://127.0.0.1:7860>** in your Android browser, or install the PWA from the "Add to Home Screen" prompt for a more native experience.

## Starting the App Again

After the initial setup, start Marinara Engine by running in Termux:

```bash
cd Marinara-Engine
./start-termux.sh
```

## Optional: Android App Shell (APK)

If you want a dedicated home-screen icon that opens Marinara Engine like a native app, see [android/README.md](../../android/README.md). The APK is a WebView wrapper around the Termux-served app — the Termux server must be running for the APK to work.

## Accessing from Another Device on Your Network

You can use Marinara Engine from a browser on another device on the same Wi-Fi network:

1. Find your Android device's local IP in Settings → Wi-Fi → your network.
2. The Termux launcher binds to `0.0.0.0` by default, so the app is already reachable on LAN.
3. Open a browser on the other device and go to `http://<android-ip>:7860`.

## Updating

The `start-termux.sh` launcher automatically updates Marinara Engine on each run:

1. Pulls the latest code from GitHub with `git pull`
2. Detects whether the checkout changed
3. Reinstalls dependencies and rebuilds when needed
4. Starts the app on the current version

Simply run `./start-termux.sh` to get the latest version each time.

### In-App Update Check

You can also go to **Settings → Advanced → Updates** and click **Check for Updates**, then **Apply Update** to trigger a pull and rebuild from within the app.
