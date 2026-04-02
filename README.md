# 🍝 Marinara Engine

<h3 align="center"><b>Fun. Intuitive. Plug-And-Play.</b></h3>

<p align="center">
  <b>A local, AI-powered chat, roleplay, and game (coming soon) engine</b> built around one idea: <b>you install it, you run it, and it just works. Oh, and don't forget about the part where you have fun! ALSO, HEY, LOOK, IT'S FREE.</b><br/>
  Created with agentic use in mind, allowing multiple requests at once. Everything is connected. Chat with your characters OOC about your roleplays. Have them create RP scenes for you. All designed with simplicity in mind: we don't want to spend hours on setup, we just want to <s>goon</s> play.<br/>
</p>

---

> **⚠️ Alpha Software** — This is an early release. Expect rough edges, missing features, and breaking changes between versions. Bug reports and feedback are very welcome!

---

## Screenshots

<p align="center">
  <img src="docs/screenshots/Desktop_Roleplay_View.png" width="90%" alt="Roleplay Chat — Desktop" />
  <br/>
  <em>Roleplay Mode — Character sprites, custom backgrounds, weather effects, and AI agents</em>
</p>

<p align="center">
  <img src="docs/screenshots/Desktop_Main_Menu.png" width="45%" alt="Home" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/Desktop_Tutorial.png" width="45%" alt="Onboarding Tutorial" />
</p>
<p align="center">
  <em>Home screen &nbsp;&nbsp;·&nbsp;&nbsp; Guided onboarding</em>
</p>

<p align="center">
  <img src="docs/screenshots/Desktop_DM_Conversation.png" width="45%" alt="DM Conversation" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/Conversation_Selfie.png" width="45%" alt="Conversation with Selfie" />
</p>
<p align="center">
  <em>Conversation Mode — Discord-style DMs with selfies and image generation</em>
</p>

<p align="center">
  <img src="docs/screenshots/Browser_Tab.png" width="90%" alt="Bot Browser" />
  <br/>
  <em>Bot Browser — Search and import characters from Chub.ai</em>
</p>

<p align="center">
  <img src="docs/screenshots/Mobile_Group_Conversation.png" width="30%" alt="Mobile Group Conversation" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/screenshots/Mobile_Roleplay_View.png" width="30%" alt="Mobile Roleplay" />
</p>
<p align="center">
  <em>Fully responsive — works on phones and tablets via PWA</em>
</p>

---

## Latest Release

Current stable release: **[v1.4.7](https://github.com/SpicyMarinara/Marinara-Engine/releases/tag/v1.4.7)**.

Detailed release notes now live in [CHANGELOG.md](CHANGELOG.md). Tagged releases use the `vX.Y.Z` format, and GitHub Releases remain the publication mechanism for installers, release notes, and update metadata.

## Project Docs

- [CONTRIBUTING.md](CONTRIBUTING.md) — contributor workflow, validation, versioning, and release steps
- [CLAUDE.md](CLAUDE.md) — thin maintainer notes for contributors using Claude
- [CHANGELOG.md](CHANGELOG.md) — release notes source of truth
- [android/README.md](android/README.md) — Android WebView wrapper guide

---

## Installation

### Windows Easiest Method

Download **[Marinara-Engine-Installer-1.4.7.exe](https://github.com/SpicyMarinara/Marinara-Engine/releases/download/v1.4.7/Marinara-Engine-Installer-1.4.7.exe)** from the [Releases](https://github.com/SpicyMarinara/Marinara-Engine/releases) page and run it. The installer checks for Node.js and Git, clones the repo, installs dependencies, builds the app, and creates a desktop shortcut.

### Run from Source (All Platforms)

#### Prerequisites

You need **Node.js** and **Git** installed before running Marinara Engine. pnpm is handled automatically by the shell launchers, or you can install it yourself for manual setup.

**Install Node.js v20+:**

| Platform | How to Install |
| --- | --- |
| Windows | Download the installer from [nodejs.org](https://nodejs.org/en/download) and run it |
| macOS | `brew install node` or download from [nodejs.org](https://nodejs.org/en/download) |
| Linux (Ubuntu/Debian) | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo bash - && sudo apt install -y nodejs` |
| Linux (Fedora) | `sudo dnf install -y nodejs` |
| Linux (Arch) | `sudo pacman -S nodejs npm` |

**Install Git:**

| Platform | How to Install |
| --- | --- |
| Windows | Download from [git-scm.com](https://git-scm.com/download/win) and run the installer |
| macOS | `brew install git` or install Xcode Command Line Tools: `xcode-select --install` |
| Linux (Ubuntu/Debian) | `sudo apt install -y git` |
| Linux (Fedora) | `sudo dnf install -y git` |
| Linux (Arch) | `sudo pacman -S git` |

Verify both are installed:

```bash
node -v        # should show v20 or higher
git --version  # should show git version 2.x+
```

#### Quick Start

**Windows:**

```bat
git clone https://github.com/SpicyMarinara/marinara-engine.git
cd marinara-engine
start.bat
```

**macOS / Linux:**

```bash
git clone https://github.com/SpicyMarinara/marinara-engine.git
cd marinara-engine
chmod +x start.sh
./start.sh
```

**Android (Termux):**

Install [Termux](https://f-droid.org/en/packages/com.termux/) from F-Droid (the Play Store version is outdated), then run:

```bash
pkg update && pkg install -y git nodejs-lts && git clone https://github.com/SpicyMarinara/marinara-engine.git && cd marinara-engine && chmod +x start-termux.sh && ./start-termux.sh
```

The Termux launcher downloads the prebuilt SQLite native module when available, installs dependencies, builds the app, and starts the server at `http://localhost:<PORT>` using the resolved `PORT` value from `.env` or the default `7860`. First run takes a few minutes on mobile. After that, run `./start-termux.sh` to start again.

If you also want a dedicated Android app shell, see [android/README.md](android/README.md). The APK is a WebView wrapper around the Termux-served app; it does not replace the server.

> **Tip:** Install the PWA from your browser's "Add to Home Screen" prompt for a more native feel.

When started from a git checkout, the shell launchers will:

1. **Auto-update** from Git if a `.git` folder is detected
2. Check that Node.js and the repo-pinned pnpm version are installed
3. Install all dependencies on first run
4. Build the application
5. Ensure the database schema is up to date
6. Load `.env`, resolve the final local URL, start the server, and open `http://localhost:<PORT>` in your browser by default

Set `AUTO_OPEN_BROWSER=false` in `.env` to skip the automatic browser launch. This applies to the shell launchers (`start.bat`, `start.sh`, and `start-termux.sh`) only. The Android wrapper uses its own WebView.

#### Manual Setup

```bash
git clone https://github.com/SpicyMarinara/marinara-engine.git
cd marinara-engine
pnpm install
pnpm build
pnpm db:push
pnpm start
```

Then open **<http://localhost:7860>**. Everything runs locally.

Bare `pnpm start` binds to `127.0.0.1` by default. If you want LAN access without using a launcher, set `HOST=0.0.0.0` first.

### Updating

Git-based installs update automatically. If you launch Marinara Engine via `start.sh`, `start.bat`, or `start-termux.sh` from a git checkout, the launcher:

1. Pulls the latest code from GitHub with `git pull`
2. Detects whether the checkout changed
3. Reinstalls dependencies and rebuilds when needed
4. Starts the app on the current version

This includes installs created by the Windows installer, because the installer clones the repository and keeps the `.git` directory.

In-app update checks read the latest GitHub Release tag. If you use Docker, the app shows the pull command instead of updating automatically. Docker images are published from `v*` tags.

#### In-App Update Check

Go to **Settings → Advanced → Updates** and click **Check for Updates**. If a new version is available:

- **Git installs** — Click **Apply Update** to pull, rebuild, and restart the server automatically.
- **Docker** — The UI shows the command to run: `docker compose pull && docker compose up -d`.

#### Manual Update

If you use a git checkout without the shell launchers or the in-app updater:

```bash
git pull
pnpm install
pnpm build
pnpm db:push
```

Then restart the server.

---

## Accessing from Mobile (or Another Device)

If you're running Marinara Engine on your computer and want to use it from your phone or tablet on the same network:

If you started the app with bare `pnpm start`, set `HOST=0.0.0.0` first or use one of the shell launchers, which already default to that host.

1. **Find your computer's local IP address:**
   - **Windows:** Run `ipconfig` and look for `IPv4 Address`
   - **macOS:** Check System Settings → Wi-Fi → your network, or run `ipconfig getifaddr en0`
   - **Linux:** Run `hostname -I` or `ip addr`
2. **Open a browser on your phone** and go to:

   ```
   http://<your-computer-ip>:7860
   ```

   Example: `http://192.168.1.42:7860`
3. **Install the PWA** from your browser for a more native app experience.

> **Tip:** If you're not on the same network, tools like [Tailscale](https://tailscale.com/) give each device a stable IP address on a private network.

---

## Development

```bash
# Start both server + client with hot reload
pnpm dev

# Canonical local validation (lint + build)
pnpm check

# Server only (port 7860)
pnpm dev:server

# Client only (port 5173, proxies API to server)
pnpm dev:client
```

Contributor workflow, validation, and release/version policy live in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Features

### Chat & Roleplay

- **Three Chat Modes** — Conversation (Discord-style), Roleplay (immersive RPG), Game (coming soon)
- **Plug-And-Play** — Minimal setup and local-first defaults
- **A Connected System** — Chats can share memory and context across modes
- **Character Management** — Create or import characters with avatars, personalities, backstories, and system prompts
- **Bot Browser** — Search and import characters from Chub.ai directly inside the app
- **Chat Folders** — Organize chats into named, color-coded folders
- **Avatar Zoom & Repositioning** — Crop and reposition character avatars with a zoom slider and drag-to-pan
- **Persona System** — User personas with custom names, avatars, and descriptions
- **Group Chats** — Multiple characters in a single conversation
- **Chat Branching** — Branch conversations at any message and explore different paths
- **Message Swiping** — Generate alternate responses and swipe between them
- **Slash Commands** — `/narrator`, `/random`, `/sys`, `/as`, `/continue`, `/impersonate`, and more for quick chat control
- **SillyTavern Import** — Migrate characters, chats, presets, and settings from SillyTavern

### Visual & Immersive

- **Sprite System** — Character expression sprites with automatic emotion-based switching
- **Custom Backgrounds** — Upload backgrounds with per-scene switching
- **Weather Effects** — Dynamic weather overlays (rain, snow, fog, and more)
- **Two Visual Themes** — Y2K Marinara theme and a faithful SillyTavern classic theme
- **Light & Dark Mode** — Both are supported

### AI Agent System (25 Built-In)

Agents are autonomous AI assistants that run alongside your chat, each handling a specific task:

| Agent | What It Does |
| --- | --- |
| **World State** | Tracks date, time, weather, location, and present characters |
| **Quest Tracker** | Manages quest objectives, completion, and rewards |
| **Character Tracker** | Monitors character moods, relationships, appearance, outfit, and stats |
| **Persona Stats** | Tracks your protagonist's needs and condition bars |
| **Custom Tracker** | Tracks user-defined fields such as currencies, counters, and flags |
| **Narrative Director** | Introduces events, NPCs, and plot beats to keep the story moving |
| **Prose Guardian** | Analyzes writing patterns and generates directives to improve prose variety |
| **Continuity Checker** | Detects contradictions with established lore and facts |
| **Combat** | Handles turn-based RPG combat with initiative, HP tracking, and actions |
| **Expression Engine** | Detects emotions and selects character sprites |
| **Background** | Picks the best background image for the current scene |
| **Echo Chamber** | Simulates a live-stream chat reacting to your roleplay |
| **Prompt Reviewer** | Reviews and scores the assembled prompt before generation |
| **Illustrator** | Generates image prompts for key scenes |
| **Lorebook Keeper** | Automatically creates and updates lorebook entries |
| **Immersive HTML** | Injects styled HTML, CSS, and JS for in-world visuals |
| **Consistency Editor** | Edits responses to fix factual errors and tracker contradictions |
| **Spotify DJ** | Controls Spotify playback to match the scene's mood |
| **Chat Summary** | Generates condensed rolling summaries of long conversations |
| **Knowledge Retrieval** | Scans lorebooks for relevant context using chunked RAG |
| **Schedule Planner** | Generates realistic weekly schedules for characters in Conversation mode |
| **Response Orchestrator** | Decides which character or characters should respond in group conversations |
| **Love Toys Control** | Controls Buttplug.io haptic devices with per-device capability awareness |
| **CYOA Choices** | Generates 2 to 4 in-character choices after each response |
| **Autonomous Messenger** | Allows characters to send messages unprompted when the user is inactive |

All agents are disabled by default. Enable only the ones you want, or create custom agents with your own prompts and tool configurations.

### Prompt Engineering

- **Preset System** — Save and load full prompt configurations
- **Prompt Sections** — Drag-and-drop ordering, depth injection, and per-section toggles
- **Lorebooks** — World-building entries with keyword triggers that inject context automatically
- **AI Lorebook Maker** — Generate structured lorebook entries from a topic prompt
- **World Info Inspector** — Live view of active lorebook entries in the current chat, with token usage and keyword details
- **Lorebook Token Counts & Sorting** — Estimated token counts per entry, sortable by order, name, tokens, or keys
- **Regex Scripts** — Custom text processing with regex find or replace on inputs and outputs
- **Macro System** — Template variables like `{{char}}`, `{{user}}`, `{{time}}`, and agent markers

### Connections & Providers

- **Multi-Provider** — OpenAI, Anthropic, Google, OpenRouter, Mistral, Cohere, Pollinations, Stability AI, Together AI, NovelAI, ComfyUI, AUTOMATIC1111 / SD Web UI, and custom OpenAI-compatible endpoints
- **Encrypted API Keys** — API keys are encrypted at rest with AES-256
- **Per-Chat Overrides** — Different presets and connections per chat
- **Connection Duplication & Testing** — Clone connections and validate provider-specific connectivity

### Export & Data

- **Export Chats** — Save chats as JSONL or plain text
- **Fully Local** — SQLite database, all data stays on your machine
- **No Account Required** — Just install and go

---

## Configuration

Copy `.env.example` to `.env` to customize:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `7860` | Server port. Keep Android builds, launchers, Docker, and Termux on the same value. |
| `HOST` | `127.0.0.1` (`pnpm start`) / `0.0.0.0` (shell launchers) | Bind address |
| `AUTO_OPEN_BROWSER` | `true` | Whether the shell launchers auto-open the local app URL. Set to `false`, `0`, `no`, or `off` to disable. Does not apply to the Android WebView wrapper. |
| `DATABASE_URL` | `file:./data/marinara-engine.db` | SQLite database path. Relative file paths resolve from `packages/server` for compatibility with existing local installs. |
| `ENCRYPTION_KEY` | _(empty)_ | AES key for API key encryption (generate with `openssl rand -hex 32`) |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Allowed CORS origins. Set `*` for allow-all without credentials; explicit origin lists keep credentialed CORS support. |
| `SSL_CERT` | _(empty)_ | Path to the TLS certificate. Set both `SSL_CERT` and `SSL_KEY` to enable HTTPS. |
| `SSL_KEY` | _(empty)_ | Path to the TLS private key |
| `IP_ALLOWLIST` | _(empty)_ | Comma-separated IPs or CIDRs to allow. Loopback is always allowed. |
| `GIPHY_API_KEY` | _(empty)_ | Optional Giphy API key. GIF search is unavailable when unset. |

---

## Project Structure

```text
marinara-engine/
├── packages/
│   ├── client/       # React frontend (Vite + Tailwind v4)
│   ├── server/       # Fastify API, SQLite database, AI agents, update routes
│   └── shared/       # Shared types, schemas, constants, version data
├── android/          # Android WebView wrapper for the Termux-served app
├── installer/        # Windows installer sources and scripts
├── docs/             # Screenshots and supporting docs assets
├── start.bat         # Windows launcher
├── start.sh          # macOS/Linux launcher
├── start-termux.sh   # Termux launcher
└── .env.example      # Environment template
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Tailwind CSS v4, Framer Motion, Zustand, React Query |
| Backend | Fastify 5, Drizzle ORM, SQLite |
| PWA | vite-plugin-pwa, Web App Manifest |
| Shared | TypeScript 5, Zod |
| Build | Vite 6, pnpm workspaces |

---

## Troubleshooting

### Windows: `EPERM: operation not permitted` when installing pnpm

If you see an error like `EPERM: operation not permitted, open 'C:\Program Files\nodejs\yarnpkg'` or a corepack signature verification failure, corepack could not write to `C:\Program Files\nodejs\`.

**Fix one of these:**

1. **Run as Administrator** — Right-click your terminal (CMD or PowerShell), select "Run as administrator", then run `start.bat` again.
2. **Install pnpm manually** — Run `npm install -g pnpm`, then run `start.bat` again.
3. **Update corepack** — Run `npm install -g corepack`, `corepack enable`, and `corepack prepare pnpm@10.30.3 --activate` in an Administrator terminal.

### Data Seems Missing After A Recent Update

If your chats or presets appear to be missing after updating, do not delete any data folders yet. Recent path changes can make the app open a different SQLite file without erasing the old one.

Check both local data locations:

1. `packages/server/data/`
2. `data/`

Look for `marinara-engine.db` plus any `-wal` and `-shm` companion files. The server now logs the resolved `DATA_DIR` and database path on startup to help identify which one is active.

---

## Community & Support

- [**Join our Discord**](https://discord.com/invite/KdAkTg94ME) — Chat, get help, share characters, and give feedback
- [**Support on Ko-fi**](https://ko-fi.com/marinara_spaghetti) — Help keep the project alive

---

## Contributors

- [Spicy Marinara](https://github.com/SpicyMarinara)
- [Jorge Becerra](https://github.com/JorgeLTE)
- [Coda](https://github.com/coxde)
- [Andy Mauragis](https://github.com/amauragis)
- [LukaTheHero](https://github.com/LukaTheHero)
- [TheLonelyDevil9](https://github.com/TheLonelyDevil9)

---

## License

[AGPL-3.0](LICENSE)
