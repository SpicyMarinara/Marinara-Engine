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
PNPM_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).packageManager?.split('@')[1] || '10.30.3'")
PNPM_RUNNER="pnpm"

run_pnpm() {
    if [ "$PNPM_RUNNER" = "corepack" ]; then
        corepack "pnpm@${PNPM_VERSION}" "$@"
    elif [ "$PNPM_RUNNER" = "npx" ]; then
        npx --yes "pnpm@${PNPM_VERSION}" "$@"
    else
        pnpm "$@"
    fi
}

if command -v corepack &> /dev/null; then
    echo "  [..] Aligning pnpm to ${PNPM_VERSION} via Corepack..."
    CURRENT_PNPM_VERSION=$(corepack "pnpm@${PNPM_VERSION}" --version 2>/dev/null || true)
    if [ "$CURRENT_PNPM_VERSION" = "$PNPM_VERSION" ]; then
        PNPM_RUNNER="corepack"
    fi
fi

if [ "$PNPM_RUNNER" = "pnpm" ]; then
    CURRENT_PNPM_VERSION=$(pnpm --version 2>/dev/null || true)
    if [ "$CURRENT_PNPM_VERSION" != "$PNPM_VERSION" ]; then
        CURRENT_PNPM_VERSION=""
    fi
fi

if [ -z "$CURRENT_PNPM_VERSION" ]; then
    echo "  [..] Using temporary pnpm ${PNPM_VERSION} via npx..."
    CURRENT_PNPM_VERSION=$(npx --yes "pnpm@${PNPM_VERSION}" --version 2>/dev/null || true)
    if [ "$CURRENT_PNPM_VERSION" = "$PNPM_VERSION" ]; then
        PNPM_RUNNER="npx"
    fi
fi

if [ -z "$CURRENT_PNPM_VERSION" ] || [ "$CURRENT_PNPM_VERSION" != "$PNPM_VERSION" ]; then
    echo "  [ERROR] Failed to make pnpm ${PNPM_VERSION} available."
    exit 1
fi
echo "  [OK] pnpm ${CURRENT_PNPM_VERSION} ready"

# ── Auto-update from Git ──
if [ -d ".git" ]; then
    echo "  [..] Checking for updates..."
    OLD_HEAD=$(git rev-parse HEAD 2>/dev/null)
    if ! git fetch origin main --quiet 2>/dev/null; then
        echo "  [WARN] Could not check for updates (no internet?). Continuing with current version."
    elif [ "$OLD_HEAD" = "$(git rev-parse origin/main 2>/dev/null || true)" ]; then
        echo "  [OK] Already up to date"
    else
        TARGET_HEAD=$(git rev-parse origin/main 2>/dev/null || true)
        # Stash any tracked local changes (e.g. pnpm install modifying package.json) so the fast-forward update doesn't fail
        STASHED=0
        if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
            git stash push -q -m "auto-stash before update" 2>/dev/null && STASHED=1
        fi
        if git merge --ff-only origin/main 2>/dev/null; then
            NEW_HEAD=$(git rev-parse HEAD 2>/dev/null)
            if [ "$STASHED" = "1" ]; then
                if ! git stash pop -q 2>/dev/null; then
                    echo "  [WARN] Stash pop conflicted — resetting to clean HEAD"
                    git checkout -- . 2>/dev/null || true
                    git stash drop -q 2>/dev/null || true
                fi
            fi
            if [ "$NEW_HEAD" != "$TARGET_HEAD" ]; then
                echo "  [WARN] Update did not land on origin/main. Continuing with current version."
            else
                echo "  [OK] Updated to $(git log -1 --format='%h %s' 2>/dev/null)"
                echo "  [..] Reinstalling dependencies..."
                run_pnpm install
                rm -rf packages/shared/dist packages/server/dist packages/client/dist
                rm -f packages/shared/tsconfig.tsbuildinfo packages/server/tsconfig.tsbuildinfo packages/client/tsconfig.tsbuildinfo
            fi
        else
            echo "  [WARN] Could not fast-forward to origin/main. Continuing with current version."
            if [ "$STASHED" = "1" ]; then
                if ! git stash pop -q 2>/dev/null; then
                    echo "  [WARN] Stash pop conflicted — resetting to clean HEAD"
                    git checkout -- . 2>/dev/null || true
                    git stash drop -q 2>/dev/null || true
                fi
            fi
        fi
    fi
fi

# ── Guard: validate workspace package.json files ──
# A previous failed stash-pop or interrupted pnpm add can leave conflict markers
# in package.json files, causing pnpm install to fail with JSON parse errors.
for _pj in package.json packages/shared/package.json packages/server/package.json packages/client/package.json; do
    if [ -f "$_pj" ] && ! node -e "JSON.parse(require('fs').readFileSync('$_pj','utf8'))" 2>/dev/null; then
        echo "  [WARN] $_pj is corrupted — restoring from git"
        git checkout -- "$_pj" 2>/dev/null || true
    fi
done

# ── Detect stale dist (source updated but dist not rebuilt) ──
if [ -f "packages/shared/dist/constants/defaults.js" ]; then
    SOURCE_VER=$(node -p "require('./package.json').version" 2>/dev/null || true)
    DIST_VER=$(node -e "try{const m=require('./packages/shared/dist/constants/defaults.js');console.log(m.APP_VERSION)}catch{}" 2>/dev/null || true)
    SOURCE_COMMIT=$(git rev-parse --short=12 HEAD 2>/dev/null || true)
    DIST_COMMIT=$(node -e "try{const m=require('./packages/server/dist/config/build-meta.json');console.log(m.commit || '')}catch{}" 2>/dev/null || true)
    if [ -n "$SOURCE_VER" ] && [ -n "$DIST_VER" ] && [ "$SOURCE_VER" != "$DIST_VER" ]; then
        echo "  [WARN] Version mismatch: source v$SOURCE_VER but dist has v$DIST_VER"
        echo "  [..] Forcing rebuild to apply update..."
        run_pnpm install
        rm -rf packages/shared/dist packages/server/dist packages/client/dist
        rm -f packages/shared/tsconfig.tsbuildinfo packages/server/tsconfig.tsbuildinfo packages/client/tsconfig.tsbuildinfo
    fi
    if [ -n "$SOURCE_COMMIT" ] && [ "$SOURCE_COMMIT" != "$DIST_COMMIT" ]; then
        echo "  [WARN] Build commit mismatch: source $SOURCE_COMMIT but dist has ${DIST_COMMIT:-<missing>}"
        echo "  [..] Forcing rebuild to apply update..."
        run_pnpm install
        rm -rf packages/shared/dist packages/server/dist packages/client/dist
        rm -f packages/shared/tsconfig.tsbuildinfo packages/server/tsconfig.tsbuildinfo packages/client/tsconfig.tsbuildinfo
    fi
fi

# ── Install dependencies ──
if [ ! -d "node_modules" ] || [ "$TERMUX_FORCE_INSTALL" = "1" ]; then
    echo ""
    echo "  [..] Installing dependencies${TERMUX_FORCE_INSTALL:+ (refreshing for platform fix)}..."
    echo "       This may take several minutes on mobile."
    echo ""
    run_pnpm install
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
        # better-sqlite3 is already declared in optionalDependencies —
        # just ensure it's installed without rewriting package.json.
        echo "  [..] Installing better-sqlite3..."
        run_pnpm install --filter @marinara-engine/server 2>&1 || true
        BS3_PKG=$(find node_modules -path "*/better-sqlite3/package.json" -not -path "*/.cache/*" 2>/dev/null | head -1)
        [ -n "$BS3_PKG" ] && BS3_DIR=$(dirname "$BS3_PKG")
    fi

    if [ -n "$BS3_DIR" ]; then
        mkdir -p "$BS3_DIR/build/Release"
        rm -f "$BS3_DIR/build/Release/better_sqlite3.node"

        PREBUILT_URL="https://github.com/Pasta-Devs/Marinara-Engine/releases/latest/download/better_sqlite3-android-arm64.node"
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
        # sql.js is already declared in optionalDependencies —
        # just ensure it's installed without rewriting package.json.
        if ! node -e "require.resolve('sql.js')" 2>/dev/null; then
            run_pnpm install --filter @marinara-engine/server 2>&1 || true
        fi
        export DATABASE_DRIVER="sql.js"
        echo "  [OK] sql.js ready"
    fi
fi

# ── Build if needed ──
if [ ! -d "packages/shared/dist" ]; then
    echo "  [..] Building shared types..."
    run_pnpm --filter @marinara-engine/shared build
fi
if [ ! -d "packages/server/dist" ]; then
    echo "  [..] Building server..."
    run_pnpm --filter @marinara-engine/server build
fi
if [ ! -d "packages/client/dist" ]; then
    echo "  [..] Building client..."
    # Skip tsc type-check on Termux — it OOMs on low-memory devices.
    # Skip PWA service worker — terser minifier OOMs on low-memory devices.
    # Vite doesn't need tsc output (tsconfig has noEmit: true).
    if ! SKIP_PWA=1 run_pnpm --filter @marinara-engine/client exec vite build 2>&1; then
        echo "  [WARN] Vite build failed — native binaries may not match Node.js $(node -v)."
        echo "  [..] Installing WASM fallback for rollup and retrying..."
        run_pnpm --filter @marinara-engine/client add -D @rollup/wasm-node 2>/dev/null || true
        SKIP_PWA=1 run_pnpm --filter @marinara-engine/client exec vite build
    fi
fi

# ── Database schema ──
echo "  [..] Syncing database schema..."
run_pnpm --filter @marinara-engine/server db:push 2>/dev/null || true

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

if [ -n "$SSL_CERT" ] && [ -n "$SSL_KEY" ]; then
  PROTOCOL=https
else
  PROTOCOL=http
fi

AUTO_OPEN_BROWSER_VALUE="${AUTO_OPEN_BROWSER:-true}"
case "${AUTO_OPEN_BROWSER_VALUE,,}" in
  0|false|no|off) AUTO_OPEN_BROWSER_ENABLED=0 ;;
  *) AUTO_OPEN_BROWSER_ENABLED=1 ;;
esac

# ── Detect IP address for LAN access ──
LOCAL_IP=$(ip -4 addr show wlan0 2>/dev/null | grep 'inet ' | sed 's/.*inet \([0-9.]*\).*/\1/' || echo "")
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n 1 || echo "")
fi

# ── Start ──
echo ""
echo "  ══════════════════════════════════════════"
echo "    Starting Marinara Engine on ${PROTOCOL}://127.0.0.1:${PORT}"
if [ -n "$LOCAL_IP" ]; then
echo "    LAN access: ${PROTOCOL}://${LOCAL_IP}:${PORT}"
fi
echo ""
echo "    Open the URL above in your mobile browser."
echo "    Press Ctrl+C to stop"
echo "  ══════════════════════════════════════════"
echo ""

# Open in Termux browser if available (no-op if not)
if [ "$AUTO_OPEN_BROWSER_ENABLED" = "1" ] && command -v termux-open-url &> /dev/null; then
    (sleep 3 && termux-open-url "${PROTOCOL}://127.0.0.1:${PORT}") &
elif [ "$AUTO_OPEN_BROWSER_ENABLED" != "1" ]; then
    echo "  [OK] Auto-open disabled (AUTO_OPEN_BROWSER=${AUTO_OPEN_BROWSER_VALUE})"
fi

# Start server
cd packages/server
exec node dist/index.js
