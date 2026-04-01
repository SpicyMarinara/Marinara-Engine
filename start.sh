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
            # Force rebuild
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
if ! command -v node &> /dev/null; then
    echo "  [ERROR] Node.js is not installed."
    echo "  Please install Node.js 20+ from https://nodejs.org"
    echo "  Or via homebrew:  brew install node"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'.' -f1 | tr -d 'v')
echo "  [OK] Node.js $(node -v) found"

if [ "$NODE_VERSION" -lt 20 ]; then
    echo "  [WARN] Node.js 20+ is recommended. You have v${NODE_VERSION}."
fi

# ── Check pnpm ──
if ! command -v pnpm &> /dev/null; then
    echo "  [..] pnpm not found, installing via corepack..."
    corepack enable 2>/dev/null || npm install -g pnpm
fi
echo "  [OK] pnpm found"

# ── Install dependencies ──
if [ ! -d "node_modules" ]; then
    echo ""
    echo "  [..] Installing dependencies (first run)..."
    echo "       This may take a few minutes."
    echo ""
    pnpm install
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
    pnpm build:client
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
case "${AUTO_OPEN_BROWSER_VALUE,,}" in
  0|false|no|off) AUTO_OPEN_BROWSER_ENABLED=0 ;;
  *) AUTO_OPEN_BROWSER_ENABLED=1 ;;
esac

echo ""
echo "  ══════════════════════════════════════════"
echo "    Starting Marinara Engine on ${PROTOCOL}://localhost:$PORT"
echo "    Press Ctrl+C to stop"
echo "  ══════════════════════════════════════════"
echo ""

# Open browser after a short delay
if [ "$AUTO_OPEN_BROWSER_ENABLED" = "1" ]; then
  (sleep 3 && open "${PROTOCOL}://localhost:$PORT" 2>/dev/null || xdg-open "${PROTOCOL}://localhost:$PORT" 2>/dev/null) &
else
  echo "  [OK] Auto-open disabled (AUTO_OPEN_BROWSER=${AUTO_OPEN_BROWSER_VALUE})"
fi

# Start server
cd packages/server
exec node dist/index.js
