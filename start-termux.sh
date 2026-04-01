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

# ── Ensure SQLite driver for Termux ──
# @libsql/client has no Android ARM64 binary, so we need an alternative.
# Priority: better-sqlite3 (fast, native) → sql.js (pure JS, always works)
USE_SQLJS=0

BS3_PKG=$(find node_modules -path "*/better-sqlite3/package.json" -not -path "*/.cache/*" 2>/dev/null | head -1)
[ -n "$BS3_PKG" ] && BS3_DIR=$(dirname "$BS3_PKG")

# --- Check if better-sqlite3 already works ---
if [ -n "$BS3_DIR" ] && [ -f "$BS3_DIR/build/Release/better_sqlite3.node" ] && \
   node -e "require('$BS3_DIR/build/Release/better_sqlite3.node')" 2>/dev/null; then
    echo "  [OK] better-sqlite3 native binary verified"
    export DATABASE_DRIVER="better-sqlite3"
else
    # --- Try downloading prebuilt binary ---
    if [ -z "$BS3_DIR" ]; then
        echo "  [..] Installing better-sqlite3..."
        pnpm --filter @marinara-engine/server add -O better-sqlite3@"^11.0.0" 2>&1 || true
        BS3_PKG=$(find node_modules -path "*/better-sqlite3/package.json" -not -path "*/.cache/*" 2>/dev/null | head -1)
        [ -n "$BS3_PKG" ] && BS3_DIR=$(dirname "$BS3_PKG")
    fi

    if [ -n "$BS3_DIR" ]; then
        mkdir -p "$BS3_DIR/build/Release"
        rm -f "$BS3_DIR/build/Release/better_sqlite3.node"

        PREBUILT_URL="https://github.com/SpicyMarinara/Marinara-Engine/releases/latest/download/better_sqlite3-android-arm64.node"
        echo "  [..] Downloading prebuilt better-sqlite3 for Android ARM64..."
        if curl -fSL --connect-timeout 15 --max-time 120 \
             -o "$BS3_DIR/build/Release/better_sqlite3.node" \
             "$PREBUILT_URL" 2>/dev/null && \
           node -e "require('$BS3_DIR/build/Release/better_sqlite3.node')" 2>/dev/null; then
            echo "  [OK] Prebuilt binary downloaded and verified"
            export DATABASE_DRIVER="better-sqlite3"
        else
            rm -f "$BS3_DIR/build/Release/better_sqlite3.node"
            echo "  [WARN] Prebuilt binary not available or incompatible with Node.js $(node -v)."
            USE_SQLJS=1
        fi
    else
        USE_SQLJS=1
    fi

    if [ "$USE_SQLJS" = "1" ]; then
        echo "  [..] Using sql.js (pure JavaScript SQLite — no compilation needed)"
        # Ensure sql.js is installed
        if ! node -e "require.resolve('sql.js')" 2>/dev/null; then
            pnpm --filter @marinara-engine/server add -O sql.js@"^1.12.0" 2>&1 || true
        fi
        export DATABASE_DRIVER="sql.js"
        echo "  [OK] sql.js ready"
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

# DATABASE_DRIVER was set above during SQLite driver detection
export DATABASE_DRIVER=${DATABASE_DRIVER:-sql.js}

AUTO_OPEN_BROWSER_VALUE="${AUTO_OPEN_BROWSER:-true}"
case "${AUTO_OPEN_BROWSER_VALUE,,}" in
  0|false|no|off) AUTO_OPEN_BROWSER_ENABLED=0 ;;
  *) AUTO_OPEN_BROWSER_ENABLED=1 ;;
esac

# Open in Termux browser if available (no-op if not)
if [ "$AUTO_OPEN_BROWSER_ENABLED" = "1" ] && command -v termux-open-url &> /dev/null; then
    (sleep 3 && termux-open-url "http://localhost:7860") &
elif [ "$AUTO_OPEN_BROWSER_ENABLED" != "1" ]; then
    echo "  [OK] Auto-open disabled (AUTO_OPEN_BROWSER=${AUTO_OPEN_BROWSER_VALUE})"
fi

# Start server
cd packages/server
exec node dist/index.js
