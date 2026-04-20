# Windows Installation Guide

## Method 1: Windows Installer (Recommended)

Download **[Marinara-Engine-Installer-1.5.2.exe](https://github.com/Pasta-Devs/Marinara-Engine/releases/download/v1.5.2/Marinara-Engine-Installer-1.5.2.exe)** from the [Releases](https://github.com/Pasta-Devs/Marinara-Engine/releases) page and run it.

The installer lets you choose the install folder, checks for Node.js and Git, aligns pnpm to the repo-pinned version even if an older global pnpm is already installed, clones the repo, installs dependencies, builds the app, and creates desktop and Start Menu shortcuts with the Marinara icon.

The installer creates a git-based checkout, so it auto-updates the same way as a manual clone when launched through the Start Menu shortcut or `start.bat`.

## Method 2: Run from Source

### Prerequisites

You need **Node.js** and **Git** installed.

**Install Node.js v20+:**

Download the installer from [nodejs.org](https://nodejs.org/en/download) and run it.

**Install Git:**

Download from [git-scm.com](https://git-scm.com/download/win) and run the installer.

Verify both are installed:

```bat
node -v        :: should show v20 or higher
git --version  :: should show git version 2.x+
```

### Quick Start (Launcher)

```bat
git clone https://github.com/Pasta-Devs/Marinara-Engine.git
cd Marinara-Engine
start.bat
```

`start.bat` handles the rest: it aligns pnpm to the repo-pinned version, installs dependencies, builds the app, ensures the database schema is up to date, and opens the app in your browser.

### Manual Setup

If you prefer to run commands yourself without the launcher:

```bat
git clone https://github.com/Pasta-Devs/Marinara-Engine.git
cd Marinara-Engine
pnpm install
pnpm build
pnpm db:push
pnpm start
```

Then open **<http://127.0.0.1:7860>**. Everything runs locally.

> `pnpm start` binds to `127.0.0.1` by default. To allow LAN access, set `HOST=0.0.0.0` in `.env` first.

### Troubleshooting: `EPERM: operation not permitted` when installing pnpm

If you see an error like `EPERM: operation not permitted, open 'C:\Program Files\nodejs\yarnpkg'` or a corepack signature verification failure, corepack could not write to `C:\Program Files\nodejs\`.

**Fix one of these:**

1. **Run as Administrator** — Right-click your terminal (CMD or PowerShell), select "Run as administrator", then run `start.bat` again.
2. **Install pnpm manually** — Run `npm install -g pnpm`, then run `start.bat` again.
3. **Update corepack** — Run `npm install -g corepack`, `corepack enable`, and `corepack prepare pnpm@10.30.3 --activate` in an Administrator terminal.

## Updating

### Automatic (Launcher / Installer)

When you launch Marinara Engine via the Start Menu shortcut or `start.bat` from a git checkout, the launcher automatically:

1. Pulls the latest code from GitHub with `git pull`
2. Detects whether the checkout changed
3. Reinstalls dependencies and rebuilds when needed
4. Starts the app on the current version

This applies to both manual clones and installs created by the Windows installer.

### In-App Update Check

Go to **Settings → Advanced → Updates** and click **Check for Updates**. If a new version is available, click **Apply Update** to pull, rebuild, and restart the server automatically.

### Manual Update

If you use a git checkout without the launcher or the in-app updater:

```bat
git fetch origin main
git merge --ff-only origin/main
pnpm install
pnpm build
pnpm db:push
```

Then restart the server.
