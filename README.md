# 🍝 Marinara Engine

<h3 align="center"><b>Fun. Intuitive. Plug-And-Play.</b></h3>

<p align="center">
  <b>A local, AI-powered chat, roleplay, and game engine</b> built around one idea: <b>you install it, you run it, and it just works. Oh, and don't forget about the part where you have fun! ALSO, HEY, LOOK, IT'S FREE.</b><br/>
  Created with agentic use in mind, allowing multiple requests at once. Everything is connected. Chat with your characters OOC about your roleplays. Have them create RP scenes for you. All designed with simplicity in mind: we don't want to spend hours on setup, we just want to <s>goon</s> play.<br/>
</p>

---

> **⚠️ Alpha Software** — Early release. Expect rough edges, missing features, and breaking changes. Bug reports and feedback are very welcome!

---

## Table of Contents

- [🍝 Marinara Engine](#-marinara-engine)
  - [Table of Contents](#table-of-contents)
  - [Latest Release](#latest-release)
  - [Roadmap](#roadmap)
  - [Installation](#installation)
  - [Features](#features)
    - [Chat \& Roleplay](#chat--roleplay)
    - [Visual \& Immersive](#visual--immersive)
    - [AI Agent System](#ai-agent-system)
    - [Prompt Engineering](#prompt-engineering)
    - [Connections \& Providers](#connections--providers)
    - [Export \& Data](#export--data)
  - [Documentation](#documentation)
  - [Community \& Support](#community--support)
  - [Contributors](#contributors)
  - [License](#license)

---

<a id="screenshots"></a>

<details>
<summary><h2>Screenshots</h2></summary>

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
  <img src="docs/screenshots/Browser_Game_Screen.png" width="90%" alt="Game Mode — Scene" />
  <br/>
  <em>Game Mode — AI Game Master, party of characters, generated backgrounds, weather, and time of day</em>
</p>

<p align="center">
  <img src="docs/screenshots/Browser_Game_Dialogue.png" width="45%" alt="Game Dialogue" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/Browser_Game_Party_Card.png" width="45%" alt="Party Card" />
</p>
<p align="center">
  <em>NPC dialogue tracking &nbsp;&nbsp;·&nbsp;&nbsp; Party member card with stats, levels, and abilities</em>
</p>

<p align="center">
  <img src="docs/screenshots/Mobile_Group_Conversation.png" width="30%" alt="Mobile Group Conversation" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/screenshots/Mobile_Roleplay_View.png" width="30%" alt="Mobile Roleplay" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/screenshots/Game_Mobile_Screen.png" width="30%" alt="Mobile Game Mode" />
</p>
<p align="center">
  <em>Fully responsive — Conversations, Roleplay, and Game Mode all work on phones and tablets via PWA</em>
</p>

</details>

---

## Latest Release

Current stable release: **[v1.5.7](https://github.com/Pasta-Devs/Marinara-Engine/releases/tag/v1.5.7)**.

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes. Tagged releases use the `vX.Y.Z` format and are published on the [Releases](https://github.com/Pasta-Devs/Marinara-Engine/releases) page.

---

## Roadmap

- Free-to-download mobile apps for Android and iPhone
- An engine feature for building and sharing full games with custom sprites, soundtracks, and scenarios
- New game modes: tabletop-style, point-and-click, and classic text adventures
- Ongoing improvements and bug fixes

More detailed public [roadmap](https://github.com/orgs/Pasta-Devs/projects/1).

---

## Installation

| Platform            | Guide                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| 🐳 Docker / Podman  | [Container Installation Guide](docs/installation/containers.md) — recommended |
| 🪟 Windows          | [Windows Installation Guide](docs/installation/windows.md)                    |
| 🍎🐧 macOS / Linux  | [macOS / Linux Installation Guide](docs/installation/macos-linux.md)          |
| 🤖 Android (Termux) | [Android (Termux) Installation Guide](docs/installation/android-termux.md)    |

Each guide covers installation, updating, and LAN access for that platform. See [Configuration Reference](docs/CONFIGURATION.md) for environment variables setup. Having trouble? See [FAQ](docs/FAQ.md) and [Troubleshooting](docs/TROUBLESHOOTING.md).

Security defaults are intentionally local-first: loopback access works out of the box, while LAN, Docker bridge, Tailscale, and public clients require Basic Auth unless you explicitly opt back into unauthenticated private-network access. Powerful actions such as backups, bulk import, update apply, sidecar install/download/delete, haptics, and custom tool mutation also require `ADMIN_SECRET`; see [Access Control](docs/CONFIGURATION.md#access-control).

---

## Features

### Chat & Roleplay

Three chat modes — **Conversation** (Discord-style DMs), **Roleplay** (immersive RPG with sprites and backgrounds), and **Game** (AI Game Master with party, quests, and combat). Characters can share memory across modes. Create or import characters, search the Chub.ai bot browser, organize chats into folders, branch conversations, swipe between alternate responses, and import from SillyTavern.

### Visual & Immersive

Character expression sprites with automatic emotion switching, custom scene backgrounds, dynamic weather overlays, two visual themes (Y2K Marinara and SillyTavern classic), and light/dark mode.

### AI Agent System

25+ built-in agents that run alongside your chat — world state tracking, quest management, combat, expression detection, background selection, narrative direction, prose analysis, Spotify DJ, CYOA choices, and more. All disabled by default; enable only what you want, or create custom agents.

### Prompt Engineering

Preset system with drag-and-drop prompt ordering, lorebooks with keyword triggers, an AI lorebook maker, world info inspector, regex scripts, and a macro/template system.

### Connections & Providers

OpenAI, Anthropic, Google, OpenRouter, NanoGPT, Mistral, Cohere, Pollinations, Stability AI, Together AI, NovelAI, ComfyUI, SD Web UI, and custom OpenAI-compatible endpoints. API keys are encrypted at rest with AES-256. Per-chat connection overrides.

### Export & Data

Export chats as JSONL or plain text. Fully local file-native storage — all data stays on your machine. No account required.

---

## Documentation

| Document                                             | Description                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| [docs/INSTALLATION.md](docs/INSTALLATION.md)         | Installation guide index (all platforms)                        |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md)       | Environment variables and `.env` reference                      |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)   | Common issues and fixes                                         |
| [docs/FAQ.md](docs/FAQ.md)                           | Frequently asked questions (LAN access, etc.)                   |
| [docs/FRONTEND.md](docs/FRONTEND.md)                 | Frontend architecture, components, hooks, and API reference     |
| [docs/ARCHITECTURE_MAP.md](docs/ARCHITECTURE_MAP.md) | Code ownership map and module-boundary refactor groundwork      |
| [android/README.md](android/README.md)               | Android WebView wrapper (APK) guide                             |
| [CONTRIBUTING.md](CONTRIBUTING.md)                   | Contributor workflow, validation, versioning, and release steps |
| [CHANGELOG.md](CHANGELOG.md)                         | Release notes                                                   |
| [CLAUDE.md](CLAUDE.md)                               | Maintainer notes for contributors using Claude                  |

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
- [Ailthrim](https://github.com/joshellis625)
- [Munimunigamer](https://github.com/munimunigamer)
- [John](https://github.com/guybrush01)
- [Pwildani](https://github.com/pwildani)
- [Romu](https://github.com/Romuromylus)
- [Felor](https://github.com/felorhik)
- [MagicGoddess](https://github.com/MagicGoddess)
- [Mm14141](https://github.com/mm14141)
- [Romu](https://github.com/Romuromylus)
- [Shadota](https://github.com/Shadota)
- [Teuku Rezhaldy](https://github.com/0-trspace)
- [Mohammad Javed](https://github.com/Javedz678)
- [Loungemeister](https://github.com/loungemeister)
- [Cha1latte](https://github.com/cha1latte)
- [Trade-Mottoes](https://github.com/Trade-Mottoes)
- [OnlyJimmy](https://github.com/Trade-Mottoes)
- [Xelvanis](https://github.com/Xelvanis)
- [Anarchistcowboy](https://github.com/Anarchistcowboy)
- [Adunato](https://github.com/adunato)
- [DarthTheMonster](https://github.com/DarthTheMonster)
- [Morgul](https://github.com/Morgul)
- [Kevin Ho](https://github.com/kevin-ho)
- [Tom DARONDOVAS](https://github.com/LightD31)
- [Jacob M](https://github.com/jake9000)
- [Lochalan](https://github.com/Lochalan)
- [Kolacheee](https://github.com/kolacheee)

---

## License

[AGPL-3.0](LICENSE)
