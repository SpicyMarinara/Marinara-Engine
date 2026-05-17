# macOS / Linux Installation Guide

## Prerequisites

You need **Node.js** and **Git** installed. pnpm is handled automatically by the shell launcher.

**Install Node.js v24 LTS+:**

| Platform              | Command                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| macOS                 | `brew install node` or download from [nodejs.org](https://nodejs.org/en/download)               |
| Linux (Ubuntu/Debian) | `curl -fsSL https://deb.nodesource.com/setup_24.x \| sudo bash - && sudo apt install -y nodejs` |
| Linux (Fedora)        | `sudo dnf install -y nodejs`                                                                    |
| Linux (Arch)          | `sudo pacman -S nodejs npm`                                                                     |

**Install Git:**

| Platform              | Command                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| macOS                 | `brew install git` or install Xcode Command Line Tools: `xcode-select --install` |
| Linux (Ubuntu/Debian) | `sudo apt install -y git`                                                        |
| Linux (Fedora)        | `sudo dnf install -y git`                                                        |
| Linux (Arch)          | `sudo pacman -S git`                                                             |

Verify both are installed:

```bash
node -v        # should show v24 or higher
git --version  # should show git version 2.x+
```

## Quick Start (Launcher)

```bash
git clone https://github.com/Pasta-Devs/Marinara-Engine.git
cd Marinara-Engine
chmod +x start.sh
./start.sh
```

`start.sh` handles the rest: it aligns pnpm to the repo-pinned version, installs dependencies, builds the app, prepares local file-backed storage, and opens the app in your browser.

When started from a git checkout, the launcher will:

1. **Auto-update** from Git if a `.git` folder is detected
2. Check that Node.js and the repo-pinned pnpm version are installed
3. Install all dependencies on first run
4. Build the application
5. Prepare local file-backed storage
6. Load `.env`, resolve the final local URL, start the server, and open `http://127.0.0.1:<PORT>` in your browser by default

Set `AUTO_OPEN_BROWSER=false` in `.env` to skip the automatic browser launch.

## Manual Setup

If you prefer to run commands yourself without the launcher:

```bash
git clone https://github.com/Pasta-Devs/Marinara-Engine.git
cd Marinara-Engine
pnpm install
pnpm build
pnpm start
```

Then open **<http://127.0.0.1:7860>**. Everything runs locally.
File-backed storage is prepared automatically on first server start.

> `pnpm start` binds to `127.0.0.1` by default. To allow LAN access, set `HOST=0.0.0.0` in `.env` first.

## Optional AI Sprite Background Removal

Marinara can use the open-source [`backgroundremover`](https://github.com/nadermx/backgroundremover) Python tool for stronger transparent sprite cleanup. This is optional because it installs PyTorch and downloads U2Net models.

Install it once from the repo root:

```bash
pnpm backgroundremover:install
```

The installer creates a local Python venv under `DATA_DIR/background-remover` and Marinara will use it automatically for sprite cleanup. On macOS, Python 3.11 is the safest choice because `backgroundremover` depends on packages with native wheels:

```bash
brew install python@3.11
pnpm backgroundremover:install
```

To let the shell launcher install it automatically on first launch, set this in `.env`:

```bash
BACKGROUNDREMOVER_AUTO_INSTALL=true
```

## Accessing from Another Device

Want to use Marinara Engine from your phone, tablet, or another computer? See the [FAQ — LAN access](../FAQ.md#how-do-i-access-marinara-engine-from-my-phone-or-another-device) guide.

## Updating

### Automatic (Launcher)

When you launch Marinara Engine via `./start.sh` from a git checkout, the launcher automatically:

1. Fetches the latest code from GitHub into `origin/main`, then fast-forwards normal clones or moves detached release checkouts to that commit
2. Detects whether the checkout changed
3. Temporarily stashes tracked local changes if needed, then reapplies them
4. Reinstalls dependencies and rebuilds when needed
5. Starts the app on the current version

### In-App Update Check

Go to **Settings → Advanced → Updates** and click **Check for Updates** to see whether a new release exists. The in-app **Apply Update** button is disabled by default; to enable it, set `UPDATES_APPLY_ENABLED=true`, set `ADMIN_SECRET`, and save that same secret in **Settings → Advanced → Admin Access**. Otherwise, relaunch Marinara Engine from `./start.sh` to let the launcher update the app.

### Manual Update

If you use a git checkout without the launcher or the in-app updater:

```bash
git fetch origin +refs/heads/main:refs/remotes/origin/main
git merge --ff-only origin/main || git checkout --detach origin/main
pnpm install
pnpm build
```

Then restart the server.

---

## See Also

- [Configuration Reference](../CONFIGURATION.md) — environment variables and `.env` setup
- [Troubleshooting](../TROUBLESHOOTING.md) — common issues and fixes
