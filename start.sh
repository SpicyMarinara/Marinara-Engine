#!/usr/bin/env bash
# ──────────────────────────────────────────────
# Marinara Engine — Start Script (macOS / Linux)
# ──────────────────────────────────────────────
set -e

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║       Marinara Engine  —  Launcher        ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# Navigate to script directory
cd "$(dirname "$0")"

# ── Check Node.js ──
if ! command -v node &> /dev/null; then
    echo "  [ERROR] Node.js is not installed."
    echo "  Please install Node.js 24 LTS or newer from https://nodejs.org"
    echo "  Or via homebrew:  brew install node"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'.' -f1 | tr -d 'v')
echo "  [OK] Node.js $(node -v) found"

if [ "$NODE_VERSION" -lt 24 ]; then
    echo "  [ERROR] Node.js 24 LTS or newer is required. You have v${NODE_VERSION}."
    echo "          Please update Node.js from https://nodejs.org"
    exit 1
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
                # Force rebuild
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
if [ ! -d "node_modules" ]; then
    echo ""
    echo "  [..] Installing dependencies (first run)..."
    echo "       This may take a few minutes."
    echo ""
    run_pnpm install
fi

# ── Optional AI sprite background remover ──
BACKGROUNDREMOVER_AUTO_INSTALL_VALUE="${BACKGROUNDREMOVER_AUTO_INSTALL:-false}"
BACKGROUNDREMOVER_AUTO_INSTALL_NORMALIZED=$(printf '%s' "$BACKGROUNDREMOVER_AUTO_INSTALL_VALUE" | tr '[:upper:]' '[:lower:]')
case "$BACKGROUNDREMOVER_AUTO_INSTALL_NORMALIZED" in
  1|true|yes|on)
    echo "  [..] Ensuring optional AI background remover runtime..."
    run_pnpm backgroundremover:install -- --if-missing || echo "  [WARN] Optional background remover install failed; built-in cleanup will still work."
    ;;
esac

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
    run_pnpm --filter @marinara-engine/client build
fi

# Database migrations are handled automatically at server startup by runMigrations()

# ── Start ──

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
AUTO_OPEN_BROWSER_NORMALIZED=$(printf '%s' "$AUTO_OPEN_BROWSER_VALUE" | tr '[:upper:]' '[:lower:]')
case "$AUTO_OPEN_BROWSER_NORMALIZED" in
  0|false|no|off) AUTO_OPEN_BROWSER_ENABLED=0 ;;
  *) AUTO_OPEN_BROWSER_ENABLED=1 ;;
esac

if ! node scripts/check-port-available.mjs; then
  exit 1
fi

echo ""
echo "  ══════════════════════════════════════════"
echo "    Starting Marinara Engine on ${PROTOCOL}://127.0.0.1:$PORT"
echo "    Press Ctrl+C to stop"
echo "  ══════════════════════════════════════════"
echo ""

# Open browser after a short delay
if [ "$AUTO_OPEN_BROWSER_ENABLED" = "1" ]; then
  (sleep 3 && open "${PROTOCOL}://127.0.0.1:$PORT" 2>/dev/null || xdg-open "${PROTOCOL}://127.0.0.1:$PORT" 2>/dev/null) &
else
  echo "  [OK] Auto-open disabled (AUTO_OPEN_BROWSER=${AUTO_OPEN_BROWSER_VALUE})"
fi

# Start server
cd packages/server
exec node dist/index.js
