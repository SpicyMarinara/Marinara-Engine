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

SKIP_UPDATE=0
for arg in "$@"; do
    case "$arg" in
        --skip-update|--no-update)
            SKIP_UPDATE=1
            ;;
        -h|--help)
            echo "Usage: ./start-termux.sh [--skip-update]"
            echo ""
            echo "  ./start-termux.sh               Check for updates, then start Marinara Engine"
            echo "  ./start-termux.sh --skip-update Start the current local install without checking for updates"
            exit 0
            ;;
        *)
            echo "  [ERROR] Unknown option: $arg"
            echo "          Run ./start-termux.sh --help for usage."
            exit 1
            ;;
    esac
done

# ── Ensure required Termux packages ──
for pkg_name in git; do
    if ! dpkg -s "$pkg_name" &> /dev/null; then
        echo "  [..] Installing $pkg_name..."
        pkg install -y -o Dpkg::Options::="--force-confold" "$pkg_name" 2>/dev/null || true
    fi
done

# ── Fix platform detection for native binaries ──
# Node.js 24+ on Termux reports process.platform = "android", but Termux uses
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
    # Ensure wasm32 is supported (required for sharp fallback on some Android devices)
    if ! grep -q "supportedArchitectures.cpu\[\]=wasm32" .npmrc 2>/dev/null; then
        echo "supportedArchitectures.cpu[]=wasm32" >> .npmrc
        TERMUX_FORCE_INSTALL=1
    fi
fi

# ── Check Node.js ──
if ! command -v node &> /dev/null || ! node -v &> /dev/null; then
    echo "  [..] Node.js not found or broken — installing via pkg..."
    pkg install -y -o Dpkg::Options::="--force-confold" nodejs-lts
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

if [ "$NODE_VERSION" -lt 24 ]; then
    echo "  [..] Node.js 24 LTS or newer is required. You have v${NODE_VERSION}; upgrading nodejs-lts..."
    pkg upgrade -y -o Dpkg::Options::="--force-confold" nodejs-lts || pkg install -y -o Dpkg::Options::="--force-confold" nodejs-lts
    if ! NODE_VERSION=$(node -v 2>/dev/null | cut -d'.' -f1 | tr -d 'v'); then
        echo "  [ERR] Node.js is still not working after upgrade."
        echo "        Try:  pkg upgrade && pkg install nodejs-lts"
        exit 1
    fi
    if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 24 ]; then
        echo "  [ERR] Node.js 24 LTS or newer is required. Current version: $(node -v 2>/dev/null || echo unknown)"
        echo "        Try:  pkg upgrade && pkg install nodejs-lts"
        exit 1
    fi
    echo "  [OK] Node.js $(node -v) ready"
fi

# ── Check pnpm ──
PNPM_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).packageManager?.split('@')[1] || '10.33.2'")
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
    if [ -n "$CURRENT_PNPM_VERSION" ]; then
        echo "  [..] Using installed pnpm ${CURRENT_PNPM_VERSION}"
    fi
fi

if [ -z "$CURRENT_PNPM_VERSION" ]; then
    echo "  [..] Using temporary pnpm ${PNPM_VERSION} via npx..."
    CURRENT_PNPM_VERSION=$(npx --yes "pnpm@${PNPM_VERSION}" --version 2>/dev/null || true)
    if [ "$CURRENT_PNPM_VERSION" = "$PNPM_VERSION" ]; then
        PNPM_RUNNER="npx"
    fi
fi

if [ -z "$CURRENT_PNPM_VERSION" ]; then
    echo "  [ERROR] Failed to make pnpm ${PNPM_VERSION} available."
    exit 1
fi
echo "  [OK] pnpm ${CURRENT_PNPM_VERSION} ready"

restore_stashed_changes() {
    if [ "$STASHED" != "1" ] || [ -z "$STASH_REF" ]; then
        return 0
    fi

    if git stash apply -q "$STASH_REF" 2>/dev/null; then
        git stash drop -q "$STASH_REF" 2>/dev/null || true
        return 0
    fi

    echo "  [WARN] Auto-update could not reapply your local changes cleanly."
    echo "         Your changes are preserved in ${STASH_REF}."
    echo "         Review them with: git stash show -p ${STASH_REF}"
    echo "         Reapply them manually with: git stash pop ${STASH_REF}"
    git reset --hard HEAD >/dev/null 2>&1 || true
    return 1
}

# ── Auto-update from Git ──
if [ "$SKIP_UPDATE" = "1" ]; then
    echo "  [OK] Skipping update check; starting the current local install."
elif [ -d ".git" ]; then
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
        STASH_REF=""
        if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
            if git stash push -q -m "auto-stash before update" 2>/dev/null; then
                STASHED=1
                STASH_REF=$(git stash list -1 --format=%gd 2>/dev/null || true)
            fi
        fi
        if git merge --ff-only origin/main 2>/dev/null; then
            NEW_HEAD=$(git rev-parse HEAD 2>/dev/null)
            if [ "$STASHED" = "1" ]; then
                restore_stashed_changes || true
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
                restore_stashed_changes || true
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
        echo "  [..] Ensuring WASM fallback for rollup is installed and retrying..."
        run_pnpm install --filter @marinara-engine/client 2>/dev/null || true
        SKIP_PWA=1 run_pnpm --filter @marinara-engine/client exec vite build
    fi
fi

# Load .env if present (respects user overrides)
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

export NODE_ENV=production
export PORT=${PORT:-7860}
export HOST=${HOST:-0.0.0.0}

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
