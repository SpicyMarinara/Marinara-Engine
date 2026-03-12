# 🍝 Marinara Engine

### Release 1.3.1

<h3 align="center"><b>Fun. Intuitive. Plug-And-Play.</b></h3>

<p align="center">
  <b>An AI-powered chat & roleplay engine</b> built around one idea: <b>you install it, you run it, it works.</b><br/>
  No setup wizards, no config files, no cloud accounts. Created with agentic use in mind, allowing multiple requests at once.<br/>
  Designed to be <b>the most fun, approachable, and feature-rich</b> local AI frontend out there.
</p>

---

**Conversation, roleplay, and visual novel modes** — a full character & sprite system, 18 built-in AI agents, turn-based combat, lorebooks, and more.

Everything runs locally. No accounts, no cloud, no telemetry. Connect to any OpenAI-compatible API (OpenAI, Anthropic, Google, OpenRouter, Mistral, Cohere, or any custom endpoint, local included).

> **⚠️ Alpha Software** — This is an early release. Expect rough edges, missing features, and breaking changes between versions. Bug reports and feedback are very welcome!

---

## Screenshots

<p align="center">
  <img src="docs/screenshots/chat-desktop.png" width="90%" alt="Roleplay Chat — Desktop" />
  <br/>
  <em>Roleplay Mode — Character sprites, custom backgrounds, weather effects, and AI agents</em>
</p>

<p align="center">
  <img src="docs/screenshots/home-desktop.png" width="45%" alt="Home" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/character-editor.png" width="45%" alt="Character Editor" />
</p>
<p align="center">
  <em>Home screen &nbsp;&nbsp;·&nbsp;&nbsp; Character editor with tags, metadata, and version history</em>
</p>

<p align="center">
  <img src="docs/screenshots/presets-editor.png" width="45%" alt="Presets Editor" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/persona-colors.png" width="45%" alt="Persona Colors" />
</p>
<p align="center">
  <em>Drag-and-drop prompt sections &nbsp;&nbsp;·&nbsp;&nbsp; Persona color customization with live preview</em>
</p>

<p align="center">
  <img src="docs/screenshots/tutorial.png" width="45%" alt="Onboarding Tutorial" />
</p>
<p align="center">
  <em>Guided onboarding with SillyTavern migration</em>
</p>

<p align="center">
  <img src="docs/screenshots/home-mobile.png" width="30%" alt="Home — Mobile" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/screenshots/chat-mobile.png" width="30%" alt="Chat — Mobile" />
</p>
<p align="center">
  <em>Fully responsive — works on phones and tablets via PWA</em>
</p>

---

## Changelog

### v1.3.1

**Added:**
- Bulk import for regex scripts via JSON in the Agents panel.
- Regex Scripts section moved to the top of the Agents tab for easier access.

**Changes:**
- Import icons now use a downward-arrow-into-box icon; export icons use an upward-arrow-from-box icon for clearer visual distinction.
- Mobile HUD widgets are now evenly distributed using flex layout with proper spacing from the toolbar menu.
- Echo Chamber panel on mobile now dynamically positions below the HUD bar instead of using a hardcoded offset.

**Fixes:**
- Fixed mobile world state widgets being too wide and overlapping action buttons.
- Fixed Echo Chamber window overlaying HUD widgets on mobile.
- Fixed desktop world state widgets being constrained to incorrect max-width.
- Fixed mobile tracker widget overlapping/touching the three-dots toolbar menu button.
- Fixed SQLite `IOERR_WRITE` errors caused by macOS iCloud `fileproviderd` interfering with WAL files (added `busy_timeout`, `.nosync` marker).
- Fixed `getDB()` race condition where concurrent calls could create duplicate database connections.
- Fixed `busy_timeout` PRAGMA missing from the `better-sqlite3` driver path.
- Fixed regex script import not normalizing `placement` field type (array vs string).
- Fixed CSS `@import` ordering violation in globals.css (custom rules appeared before `@import "tailwindcss"`).
- Removed orphaned `.rpg-hud-actions` CSS selector.
- Cleaned up inline styles and stale comments across components.

---

## Features

### Chat & Roleplay
- **Three Chat Modes** — Conversation (iMessage-style), Roleplay (immersive dark RPG), Visual Novel
- **Character Management** — Create or import characters with avatars, personalities, backstories, and system prompts
- **Persona System** — User personas with custom names, avatars, and descriptions
- **Group Chats** — Multiple characters in a single conversation
- **Chat Branching** — Branch conversations at any message and explore different paths
- **Message Swiping** — Generate alternate responses and swipe between them
- **SillyTavern Import** — Migrate characters, chats, presets, and settings from SillyTavern

### Visual & Immersive
- **Sprite System** — Character expression sprites with automatic emotion-based switching
- **Custom Backgrounds** — Upload backgrounds with per-scene switching
- **Weather Effects** — Dynamic weather overlays (rain, snow, fog, etc.)
- **Two Visual Themes** — Y2K Marinara theme and a faithful SillyTavern classic theme
- **Light & Dark Mode**

### AI Agent System (18 Built-In)
Agents are autonomous AI assistants that run alongside your chat, each handling a specific task:

| Agent | What It Does |
|-------|-------------|
| **World State** | Tracks date/time, weather, location, and present characters |
| **Quest Tracker** | Manages quest objectives, completion, and rewards |
| **Character Tracker** | Monitors character moods, relationships, and inventory |
| **Persona Stats** | Tracks your protagonist's HP, MP, XP, and custom stats |
| **Narrative Director** | Introduces events, NPCs, and plot beats to keep the story moving |
| **Prose Guardian** | Rewrites AI responses to improve prose quality |
| **Continuity Checker** | Detects contradictions with established lore and facts |
| **Combat** | Turn-based RPG combat with initiative, HP tracking, and actions |
| **Expression Engine** | Detects emotions and selects character sprites |
| **Background** | Picks the best background image for the current scene |
| **Echo Chamber** | Simulates a live-stream chat reacting to your roleplay |
| **Prompt Reviewer** | Reviews and scores the assembled prompt before generation |
| **Illustrator** | Generates image prompts for key scenes |
| **Lorebook Keeper** | Automatically creates and updates lorebook entries |
| **Immersive HTML** | Formats roleplay output with styled HTML |
| **Consistency Editor** | Edits responses for internal consistency |
| **Spotify DJ** | Controls Spotify playback to match the scene mood |
| **Chat Summarizer** | Generates condensed summaries of long conversations |

All agents are disabled by default — enable only the ones you want. You can also create **custom agents** with your own prompts and tool configurations.

### Prompt Engineering
- **Preset System** — Save and load full prompt configurations (system prompt sections, sampling parameters, etc.)
- **Prompt Sections** — Modular prompt builder with drag-and-drop ordering, depth injection, and per-section toggles
- **Lorebooks** — World-building entries with keyword triggers that inject context automatically
- **Regex Scripts** — Custom text processing with regex find/replace on inputs and outputs
- **Macro System** — Template variables like `{{char}}`, `{{user}}`, `{{time}}`, and agent markers

### Connections & Providers
- **Multi-Provider** — OpenAI, Anthropic, Google, OpenRouter, Mistral, Cohere, and any custom OpenAI-compatible endpoint
- **Encrypted API Keys** — API keys are encrypted at rest with AES-256
- **Per-Chat Overrides** — Different presets and connections per chat

### Export & Data
- **Export Chats** — Save as JSON or Markdown
- **Fully Local** — SQLite database, all data stays on your machine
- **No Account Required** — Just install and go

---

## Installation

## Windows EASIEST METHOD
Download **[Marinara-Engine-Installer-1.3.1.exe](https://github.com/SpicyMarinara/Marinara-Engine/releases/download/v1.3.1/Marinara-Engine-Installer-1.3.1.exe)** from the [Releases](https://github.com/SpicyMarinara/Marinara-Engine/releases) page and run it. The installer checks for Node.js and Git, clones the repo, installs dependencies, builds the app, and creates a desktop shortcut.

---

## Alternatives

### Run from Source (All Platforms)

### Prerequisites

You need **Node.js** and **Git** installed before running Marinara Engine. pnpm is handled automatically by the start script.

**Install Node.js v20+:**

| Platform | How to Install |
|----------|---------------|
| Windows | Download the installer from [nodejs.org](https://nodejs.org/en/download) and run it |
| macOS | `brew install node` or download from [nodejs.org](https://nodejs.org/en/download) |
| Linux (Ubuntu/Debian) | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo bash - && sudo apt install -y nodejs` |
| Linux (Fedora) | `sudo dnf install -y nodejs` |
| Linux (Arch) | `sudo pacman -S nodejs npm` |

**Install Git:**

| Platform | How to Install |
|----------|---------------|
| Windows | Download from [git-scm.com](https://git-scm.com/download/win) and run the installer |
| macOS | `brew install git` or install Xcode Command Line Tools: `xcode-select --install` |
| Linux (Ubuntu/Debian) | `sudo apt install -y git` |
| Linux (Fedora) | `sudo dnf install -y git` |
| Linux (Arch) | `sudo pacman -S git` |

Verify both are installed:
```bash
node -v   # should show v20 or higher
git -v    # should show git version 2.x+
```

### Quick Start

**Windows:**
```
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
pkg update && pkg install -y git nodejs-lts
npm install -g pnpm
git clone https://github.com/SpicyMarinara/marinara-engine.git
cd marinara-engine
chmod +x start-termux.sh
./start-termux.sh
```

The Termux launcher handles everything automatically — it downloads a prebuilt native module, installs dependencies, builds the app, and starts the server at `http://localhost:7860`. First run takes a few minutes on mobile. After that, just run `./start-termux.sh` to start.

> **Tip:** Install the PWA — tap the browser menu and "Add to Home Screen" for a native app feel.

The start script will:
1. **Auto-update** from Git (if a `.git` folder is detected)
2. Check that Node.js and pnpm are installed
3. Install all dependencies (first run only)
4. Build the application
5. Initialize the database
6. Start the server and open `http://localhost:7860` in your browser

### Manual Setup

```bash
git clone https://github.com/SpicyMarinara/marinara-engine.git
cd marinara-engine
pnpm install
pnpm build
pnpm db:push
pnpm start
```

Then open **http://localhost:7860**. That's it — no account, no cloud, everything runs locally.

### Updating

**Updates are automatic.** Every time you launch Marinara Engine via `start.sh`, `start.bat`, or `start-termux.sh`, the launcher:

1. Pulls the latest code from GitHub (`git pull`)
2. Detects if anything changed
3. Reinstalls dependencies and rebuilds automatically
4. Runs database migrations

**You don't need to do anything** — just launch the app as usual and you'll always be on the latest version.

This works for all platforms: Windows (installer or manual), macOS, Linux, and Termux.

To update manually (e.g. if you don't use the start scripts):
```bash
git pull
pnpm install
pnpm build
pnpm db:push
```

Then restart the server.

---

## Development

```bash
# Start both server + client with hot reload
pnpm dev

# Server only (port 7860)
pnpm dev:server

# Client only (port 5173, proxies API to server)
pnpm dev:client
```

---

## Configuration

Copy `.env.example` to `.env` to customize:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `7860` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_URL` | `file:./data/marinara-engine.db` | SQLite database path |
| `ENCRYPTION_KEY` | *(empty)* | AES key for API key encryption (generate with `openssl rand -hex 32`) |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed CORS origins |
| `SSL_CERT` | *(empty)* | Path to TLS certificate (e.g. `fullchain.pem`). Set both `SSL_CERT` and `SSL_KEY` to enable HTTPS |
| `SSL_KEY` | *(empty)* | Path to TLS private key (e.g. `privkey.pem`) |

---

## Project Structure

```
marinara-engine/
├── packages/
│   ├── shared/      # TypeScript types, schemas, constants
│   ├── server/      # Fastify API + SQLite database + AI agents
│   └── client/      # React frontend (Vite + Tailwind v4)
├── start.bat        # Windows launcher
├── start.sh         # macOS/Linux launcher
└── .env.example     # Environment template
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Tailwind CSS v4, Framer Motion, Zustand, React Query |
| Backend | Fastify 5, Drizzle ORM, SQLite |
| PWA | vite-plugin-pwa, Web App Manifest |
| Shared | TypeScript 5, Zod |
| Build | Vite 6, pnpm workspaces |

---

## Troubleshooting

### Windows: `EPERM: operation not permitted` when installing pnpm

If you see an error like `EPERM: operation not permitted, open 'C:\Program Files\nodejs\yarnpkg'` or a corepack signature verification failure, this is a Windows permissions issue — corepack can't write to `C:\Program Files\nodejs\`.

**Fix (pick one):**

1. **Run as Administrator** — Right-click your terminal (CMD or PowerShell) and select "Run as administrator", then run `start.bat` again.

2. **Install pnpm manually** (recommended — avoids corepack entirely):
   ```
   npm install -g pnpm
   ```
   Then run `start.bat` again.

3. **Update corepack** (if you want to keep using it):
   ```
   npm install -g corepack
   corepack enable
   corepack prepare pnpm@latest --activate
   ```
   Run these in an Administrator terminal.

---

## License

[AGPL-3.0](LICENSE)
