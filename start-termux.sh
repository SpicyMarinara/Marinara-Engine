#!/data/data/com.termux/files/usr/bin/bash
# ──────────────────────────────────────────────
# Marinara Engine — Start Script (Termux / Android)
# ──────────────────────────────────────────────
set -e

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   Marinara Engine  —  Termux Launcher    ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# Navigate to script directory
cd "$(dirname "$0")"

# ── Ensure required Termux packages ──
for pkg_name in git; do
    if ! dpkg -s "$pkg_name" &> /dev/null; then
        echo "  [..] Installing $pkg_name..."
        pkg install -y "$pkg_name" 2>/dev/null || true
    fi
done

# ── Fix platform detection for native binaries ──
# Node.js 22+ on Termux reports process.platform = "android", but Termux uses
# the Linux kernel and Linux ARM64 native binaries work perfectly. Tell pnpm to
# install both android AND linux optional dependencies so build tools like
# rollup, lightningcss, and tailwindcss oxide resolve correctly.
# Run early so the auto-update's pnpm install also benefits.
NODE_PLAT=$(node -e "process.stdout.write(process.platform)" 2>/dev/null || echo "")
if [ "$NODE_PLAT" = "android" ]; then
    NPMRC_MARKER="# termux-supported-architectures"
    if ! grep -q "$NPMRC_MARKER" .npmrc 2>/dev/null; then
        NODE_ARCH=$(node -e "process.stdout.write(process.arch)" 2>/dev/null || echo "")
        echo "  [OK] Detected Android/Termux (${NODE_ARCH:-unknown}) — enabling Linux binaries"
        {
            echo "$NPMRC_MARKER"
            echo "supportedArchitectures.os[]=current"
            echo "supportedArchitectures.os[]=linux"
            echo "supportedArchitectures.cpu[]=current"
            [ -n "$NODE_ARCH" ] && echo "supportedArchitectures.cpu[]=$NODE_ARCH"
        } >> .npmrc
        # Force pnpm to re-resolve optional deps on next install
        TERMUX_FORCE_INSTALL=1
    fi
fi

# ── Auto-update from Git ──
if [ -d ".git" ]; then
    echo "  [..] Checking for updates..."
    OLD_HEAD=$(git rev-parse HEAD 2>/dev/null)
    if git pull 2>/dev/null; then
        NEW_HEAD=$(git rev-parse HEAD 2>/dev/null)
        if [ "$OLD_HEAD" != "$NEW_HEAD" ]; then
            echo "  [OK] Updated to $(git log -1 --format='%h %s' 2>/dev/null)"
            echo "  [..] Reinstalling dependencies..."
            pnpm install
            rm -rf packages/shared/dist packages/server/dist packages/client/dist
            rm -f packages/shared/tsconfig.tsbuildinfo packages/server/tsconfig.tsbuildinfo packages/client/tsconfig.tsbuildinfo
        else
            echo "  [OK] Already up to date"
        fi
    else
        echo "  [WARN] Could not check for updates (no internet?). Continuing with current version."
    fi
fi

# ── Check Node.js ──
if ! command -v node &> /dev/null || ! node -v &> /dev/null; then
    echo "  [..] Node.js not found or broken — installing via pkg..."
    pkg install -y nodejs-lts
fi

if ! NODE_VERSION=$(node -v 2>/dev/null | cut -d'.' -f1 | tr -d 'v'); then
    echo "  [ERR] Node.js is still not working after install."
    echo "        Try:  pkg upgrade && pkg install nodejs-lts"
    exit 1
fi

if [ -z "$NODE_VERSION" ]; then
    echo "  [ERR] Could not determine Node.js version."
    echo "        Try:  pkg upgrade && pkg install nodejs-lts"
    exit 1
fi

echo "  [OK] Node.js $(node -v) found"

if [ "$NODE_VERSION" -lt 20 ]; then
    echo "  [WARN] Node.js 20+ is recommended. You have v${NODE_VERSION}."
    echo "         Run:  pkg upgrade nodejs-lts"
fi

# ── Check pnpm ──
if ! command -v pnpm &> /dev/null; then
    echo "  [..] pnpm not found, installing globally..."
    npm install -g pnpm
fi
echo "  [OK] pnpm found"

# ── Install dependencies ──
if [ ! -d "node_modules" ] || [ "$TERMUX_FORCE_INSTALL" = "1" ]; then
    echo ""
    echo "  [..] Installing dependencies${TERMUX_FORCE_INSTALL:+ (refreshing for platform fix)}..."
    echo "       This may take several minutes on mobile."
    echo ""
    pnpm install
fi

# ── Ensure better-sqlite3 native binary ──
# @libsql/client has no Android ARM64 binary, so we fall back to better-sqlite3.
# We ship a prebuilt .node binary to avoid needing build tools on the phone.
export DATABASE_DRIVER="better-sqlite3"

BS3_PKG=$(find node_modules -path "*/better-sqlite3/package.json" -not -path "*/.cache/*" 2>/dev/null | head -1)
if [ -n "$BS3_PKG" ]; then
    BS3_DIR=$(dirname "$BS3_PKG")
else
    echo "  [..] Installing better-sqlite3 (required for Termux)..."
    pnpm --filter @marinara-engine/server add -O better-sqlite3@"^11.0.0" 2>&1 || true
    BS3_PKG=$(find node_modules -path "*/better-sqlite3/package.json" -not -path "*/.cache/*" 2>/dev/null | head -1)
    [ -n "$BS3_PKG" ] && BS3_DIR=$(dirname "$BS3_PKG")
fi

if [ -z "$BS3_DIR" ]; then
    echo "  [ERR] Could not install better-sqlite3."
    echo "        Try manually: pnpm --filter @marinara-engine/server add -O better-sqlite3"
    exit 1
fi

if [ ! -f "$BS3_DIR/build/Release/better_sqlite3.node" ] || \
   ! node -e "require('$BS3_DIR/build/Release/better_sqlite3.node')" 2>/dev/null; then
    mkdir -p "$BS3_DIR/build/Release"
    rm -f "$BS3_DIR/build/Release/better_sqlite3.node"

    NEED_SOURCE_BUILD=0

    # --- Try 1: Download prebuilt binary from GitHub releases ---
    PREBUILT_URL="https://github.com/SpicyMarinara/Marinara-Engine/releases/latest/download/better_sqlite3-android-arm64.node"
    echo "  [..] Downloading prebuilt better-sqlite3 for Android ARM64..."
    if curl -fSL --connect-timeout 15 --max-time 120 \
         -o "$BS3_DIR/build/Release/better_sqlite3.node" \
         "$PREBUILT_URL" 2>/dev/null; then
        # Verify the binary actually loads with the current Node.js version
        if node -e "require('$BS3_DIR/build/Release/better_sqlite3.node')" 2>/dev/null; then
            echo "  [OK] Prebuilt binary downloaded and verified"
        else
            rm -f "$BS3_DIR/build/Release/better_sqlite3.node"
            echo "  [WARN] Prebuilt binary is not compatible with Node.js $(node -v) (ABI mismatch)."
            echo "         Falling back to compiling from source."
            NEED_SOURCE_BUILD=1
        fi
    else
        rm -f "$BS3_DIR/build/Release/better_sqlite3.node"
        echo "  [WARN] Prebuilt not available — compiling from source."
        NEED_SOURCE_BUILD=1
    fi

    if [ "$NEED_SOURCE_BUILD" = "1" ]; then
        echo "         This takes 2-5 minutes. Please wait."

        # --- Try 2: Compile from source (needs build tools) ---
        for pkg_name in python build-essential; do
            if ! dpkg -s "$pkg_name" &>/dev/null; then
                echo "  [..] Installing $pkg_name..."
                pkg install -y "$pkg_name" 2>/dev/null || true
            fi
        done

        # Symlink node-addon-api so binding.gyp can resolve it from pnpm's virtual store
        if [ ! -d "$BS3_DIR/node_modules/node-addon-api" ]; then
            NAPI_DIR=$(find node_modules -path "*/node-addon-api/napi.h" 2>/dev/null | head -1)
            if [ -n "$NAPI_DIR" ]; then
                mkdir -p "$BS3_DIR/node_modules"
                ln -sf "$(cd "$(dirname "$NAPI_DIR")" && pwd)" "$BS3_DIR/node_modules/node-addon-api"
            fi
        fi

        if ! command -v node-gyp &>/dev/null; then
            npm install -g node-gyp
        fi

        # Force Linux build path — Termux's Node 22+ reports platform=android
        # which triggers the Android NDK code path in binding.gyp.
        export GYP_DEFINES="OS=linux"
        (cd "$BS3_DIR" && node-gyp rebuild --release --loglevel=verbose) || {
            echo ""
            echo "  [ERR] Failed to compile better-sqlite3."
            echo "        Make sure build tools are installed:"
            echo "          pkg install build-essential python"
            echo "        Then delete node_modules and try again:"
            echo "          rm -rf node_modules && ./start-termux.sh"
            exit 1
        }
        echo "  [OK] better-sqlite3 compiled from source"
    fi
fi

# ── Build if needed ──
if [ ! -d "packages/shared/dist" ]; then
    echo "  [..] Building shared types..."
    pnpm build:shared
fi
if [ ! -d "packages/server/dist" ]; then
    echo "  [..] Building server..."
    pnpm build:server
fi
if [ ! -d "packages/client/dist" ]; then
    echo "  [..] Building client..."
    # Skip tsc type-check on Termux — it OOMs on low-memory devices.
    # Skip PWA service worker — terser minifier OOMs on low-memory devices.
    # Vite doesn't need tsc output (tsconfig has noEmit: true).
    if ! SKIP_PWA=1 pnpm --filter @marinara-engine/client exec vite build 2>&1; then
        echo "  [WARN] Vite build failed — native binaries may not match Node.js $(node -v)."
        echo "  [..] Installing WASM fallback for rollup and retrying..."
        pnpm --filter @marinara-engine/client add -D @rollup/wasm-node 2>/dev/null || true
        SKIP_PWA=1 pnpm --filter @marinara-engine/client exec vite build
    fi
fi

# ── Database schema ──
echo "  [..] Syncing database schema..."
pnpm db:push 2>/dev/null || true

# ── Detect IP address for LAN access ──
LOCAL_IP=$(ip -4 addr show wlan0 2>/dev/null | grep 'inet ' | sed 's/.*inet \([0-9.]*\).*/\1/' || echo "")
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n 1 || echo "")
fi

# ── Start ──
echo ""
echo "  ══════════════════════════════════════════"
echo "    Starting Marinara Engine on http://localhost:7860"
if [ -n "$LOCAL_IP" ]; then
echo "    LAN access: http://${LOCAL_IP}:7860"
fi
echo ""
echo "    Open the URL above in your mobile browser."
echo "    Press Ctrl+C to stop"
echo "  ══════════════════════════════════════════"
echo ""

# Load .env if present (respects user overrides)
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

export NODE_ENV=production
export PORT=${PORT:-7860}
export HOST=${HOST:-0.0.0.0}

# Use better-sqlite3 on Termux — @libsql/client has no Android ARM64 native binary
export DATABASE_DRIVER=${DATABASE_DRIVER:-better-sqlite3}

# Open in Termux browser if available (no-op if not)
if command -v termux-open-url &> /dev/null; then
    (sleep 3 && termux-open-url "http://localhost:7860") &
fi

# Start server
cd packages/server
exec node dist/index.js
