# Marinara Engine — Frontend Documentation

## Overview

Marinara Engine is an AI chat application with roleplay, visual novel, and conversation modes. The frontend is a React 19 single-page application served by Vite, styled with Tailwind CSS v4, and structured as a PWA.

The client lives in `packages/client` and communicates with a Fastify API server (`packages/server`) over REST and Server-Sent Events (SSE). Data contracts are defined in `packages/shared`.

---

## Application Architecture

### Three-Column Layout

The UI follows a Discord-inspired three-column design managed by `AppShell.tsx`:

```
┌─────────────┬─────────────────────────────┬──────────────┐
│  Left       │         Center              │  Right       │
│  Sidebar    │                             │  Panel       │
│             │  Chat area or Editor        │              │
│ ─ Chat list │  (lazy-loaded)              │ ─ Characters │
│ ─ Folders   │                             │ ─ Lorebooks  │
│ ─ Mode tabs │  ChatConversationSurface    │ ─ Presets    │
│             │  ChatRoleplaySurface        │ ─ Connections│
│             │  CharacterEditor            │ ─ Agents     │
│             │  LorebookEditor             │ ─ Personas   │
│             │  PresetEditor               │ ─ Settings   │
│             │  ...other editors           │ ─ Bot Browser│
│             │                             │              │
└─────────────┴─────────────────────────────┴──────────────┘
```

- **Left Sidebar** (`ChatSidebar.tsx`): Chat list organized by folders, filterable by mode (Conversation / Roleplay).
- **Center Pane**: Either the active chat surface or a full editor (character, lorebook, preset, etc.). Only one is visible at a time; editors replace the chat area.
- **Right Panel** (`RightPanel.tsx`): Resource browser and settings, toggled from the top bar. Once a panel is mounted, it stays in the DOM (hidden with CSS) to preserve scroll position and local state.
- **Top Bar** (`TopBar.tsx`): Quick-switch buttons for each right panel.

### Navigation

Navigation is entirely **state-driven** — there is no URL router. The `ui.store.ts` Zustand store controls what is rendered:

| Navigation target      | Store field          | Trigger function                                  |
| ---------------------- | -------------------- | ------------------------------------------------- |
| Open character editor  | `characterDetailId`  | `openCharacterDetail(id)`                         |
| Open lorebook editor   | `lorebookDetailId`   | `openLorebookDetail(id)`                          |
| Open preset editor     | `presetDetailId`     | `openPresetDetail(id)`                            |
| Open connection editor | `connectionDetailId` | `openConnectionDetail(id)`                        |
| Open agent editor      | `agentDetailId`      | `openAgentDetail(id)`                             |
| Open persona editor    | `personaDetailId`    | `openPersonaDetail(id)`                           |
| Switch right panel     | `rightPanel`         | `openRightPanel(name)` / `toggleRightPanel(name)` |
| Open modal             | `modal`              | `openModal(type, props?)`                         |

### Code Splitting

All major editors and heavy components are lazy-loaded in `AppShell.tsx` using `React.lazy()` + `Suspense`. This keeps the initial bundle under 1 MB.

---

## State Management

### Zustand Stores (Client State)

Six stores manage UI and runtime state:

#### `ui.store.ts` — Settings & UI Chrome

The only **persisted** store (localStorage via Zustand `persist` middleware). Contains:

- **Theme**: `visualTheme` ("default" | "sillytavern"), `data-theme` (dark/light), custom color overrides
- **Appearance**: `fontSize`, `chatFontSize`, `fontFamily`, custom fonts, cursor style
- **Chat display**: `boldDialogue`, `showTimestamps`, `showModelName`, `messageGrouping`, `messagesPerPage`
- **Text styling**: narration font color/opacity, chat font color/opacity, text stroke
- **Streaming**: `enableStreaming`, `streamingSpeed`
- **Conversation theme**: gradient colors for message bubbles
- **Sound**: `convoNotificationSound`, `rpNotificationSound`
- **Behavior**: `confirmBeforeDelete`, `enterToSendRP`, `enterToSendConvo`, `weatherEffects`
- **Navigation**: `rightPanel`, `rightPanelOpen`, `sidebarOpen`, `settingsTab`, all `*DetailId` fields, `modal`

Synced custom themes are **not** stored in `ui.store.ts`; they are fetched from the server via React Query and mirrored across devices connected to the same Marinara instance.

#### `chat.store.ts` — Chat Runtime

Non-persisted. Tracks the active chat session:

- `activeChatId` — which chat is displayed
- `messages` — current message array
- `isStreaming`, `streamBuffer` — generation in progress
- `inputDrafts` — per-chat draft messages
- `perChatTyping` — typing indicator state
- `unreadCounts`, `chatNotifications` — notification badges
- `abortControllers` — cancel in-flight generations

#### `agent.store.ts` — Agent Execution

Tracks agent pipeline state during and after generation:

- `activeAgents` — agents currently running
- `thoughtBubbles` — agent reasoning displayed in real-time
- `echoMessages` — echo chamber (simulated viewer chat)
- `cyoaChoices` — branching choice UI
- `debugLog` — performance metrics and token usage
- `failedAgentTypes` — agents that errored (for retry UI)

#### `game-state.store.ts` — RPG Companion

Holds scene and world context for roleplay mode:

- `current` (GameState) — date, time, location, weather, present characters, events, player stats, quests, inventory
- `isVisible`, `expandedSections` — HUD display state

#### `encounter.store.ts` — Combat System

Turn-based combat state:

- `active` — whether an encounter is in progress
- `party`, `enemies` — combatants with HP, attacks, statuses
- `environment` — arena details
- `playerActions`, `encounterLog` — action queue and history
- `combatResult` — victory/defeat/fled/interrupted

#### `gallery.store.ts` — Image Overlays

- `pinnedImages` — images pinned to the chat area as overlays

### React Query (Server Data)

All server data is fetched and cached through TanStack React Query, configured in `main.tsx`:

- **Stale time**: 30 seconds (global default)
- **Retry**: 1 attempt
- **Refetch on focus**: Disabled
- **Cache**: In-memory only (no persistence)

Each entity has a dedicated hook file that exports query and mutation hooks.

---

## Hooks Reference

All hooks live in `src/hooks/` and follow the pattern `use-{entity}.ts`.

### Chat Hooks (`use-chats.ts`)

| Hook                               | Type           | Description                                  |
| ---------------------------------- | -------------- | -------------------------------------------- |
| `useChats()`                       | Query          | All chats                                    |
| `useChat(id)`                      | Query          | Single chat by ID                            |
| `useChatMessages(chatId, perPage)` | Infinite Query | Paginated messages for a chat                |
| `useChatGroup(groupId)`            | Query          | Chat group                                   |
| `useCreateChat()`                  | Mutation       | Create a new chat                            |
| `useDeleteChat()`                  | Mutation       | Delete a chat                                |
| `useUpdateChatMetadata()`          | Mutation       | Update chat metadata (agents, sprites, etc.) |
| `useBranchChat()`                  | Mutation       | Branch a chat from a specific message        |
| `useUpdateMessage()`               | Mutation       | Edit message content (optimistic update)     |
| `useDeleteMessage()`               | Mutation       | Delete single message                        |
| `useDeleteMessages()`              | Mutation       | Delete multiple messages                     |
| `useSetActiveSwipe()`              | Mutation       | Switch to a different generation swipe       |
| `usePeekPrompt()`                  | Mutation       | Preview the assembled prompt                 |
| `useClearAllData()`                | Mutation       | Nuclear: delete everything                   |

### Character Hooks (`use-characters.ts`)

| Hook                   | Type     | Description                            |
| ---------------------- | -------- | -------------------------------------- |
| `useCharacters()`      | Query    | All characters                         |
| `useCharacter(id)`     | Query    | Single character with parsed card data |
| `useCreateCharacter()` | Mutation | Create character                       |
| `useUpdateCharacter()` | Mutation | Update character card data             |
| `useDeleteCharacter()` | Mutation | Delete character                       |
| `useUploadAvatar()`    | Mutation | Upload avatar image                    |
| `usePersonas()`        | Query    | All personas                           |
| `usePersona(id)`       | Query    | Single persona                         |
| `useCreatePersona()`   | Mutation | Create persona                         |
| `useUpdatePersona()`   | Mutation | Update persona                         |
| `useDeletePersona()`   | Mutation | Delete persona                         |
| `useCharacterGroups()` | Query    | Character groups                       |
| `usePersonaGroups()`   | Query    | Persona groups                         |

### Preset Hooks (`use-presets.ts`)

| Hook                          | Type     | Description                               |
| ----------------------------- | -------- | ----------------------------------------- |
| `usePresets()`                | Query    | All presets                               |
| `usePreset(id)`               | Query    | Single preset                             |
| `usePresetFull(id)`           | Query    | Preset with sections, groups, and choices |
| `useDefaultPreset()`          | Query    | The default preset                        |
| `useCreatePreset()`           | Mutation | Create preset                             |
| `useUpdatePreset()`           | Mutation | Update preset                             |
| `useDeletePreset()`           | Mutation | Delete preset                             |
| `usePresetSections(presetId)` | Query    | Prompt sections for a preset              |
| `usePresetGroups(presetId)`   | Query    | Section groups                            |
| `useChoiceBlocks(presetId)`   | Query    | Interactive choice blocks                 |
| `usePresetPreview(presetId)`  | Query    | Rendered preview                          |

### Agent Hooks (`use-agents.ts`)

| Hook                 | Type     | Description                  |
| -------------------- | -------- | ---------------------------- |
| `useAgentConfigs()`  | Query    | All agent configurations     |
| `useAgentConfig(id)` | Query    | Single agent config          |
| `useCreateAgent()`   | Mutation | Create custom agent          |
| `useUpdateAgent()`   | Mutation | Update agent config          |
| `useDeleteAgent()`   | Mutation | Delete agent                 |
| `useToggleAgent()`   | Mutation | Toggle built-in agent on/off |

### Generation Hook (`use-generate.ts`)

The most complex hook. Returns `{ generate, regenerateMessage }`.

`generate(chatId, prompt, signal)` handles:

1. Setting streaming state in `chat.store.ts`
2. Sending generation request to `/api/generate`
3. Parsing SSE events: `token`, `agent_update`, `game_state`, `encounter_init`, `scene_created`, `done`, `error`
4. Updating React Query cache with new messages
5. Populating agent store with thought bubbles and debug info
6. Error handling with toast notifications

### Other Hooks

| File                           | Purpose                                   |
| ------------------------------ | ----------------------------------------- |
| `use-connections.ts`           | API connection CRUD + test                |
| `use-lorebooks.ts`             | Lorebook + entry CRUD                     |
| `use-scene.ts`                 | Scene planning, creation, conclusion      |
| `use-encounter.ts`             | Combat encounter init, action, summary    |
| `use-autonomous-messaging.ts`  | Autonomous message polling and scheduling |
| `use-idle-detection.ts`        | 10-minute inactivity detector             |
| `use-background-autonomous.ts` | Background polling for inactive chats     |
| `use-translate.ts`             | Text translation                          |
| `use-apply-regex.ts`           | Regex script execution on messages        |
| `use-custom-tools.ts`          | Custom tool CRUD                          |
| `use-knowledge-sources.ts`     | Knowledge source management               |
| `use-gallery.ts`               | Chat gallery images                       |
| `use-chat-folders.ts`          | Chat folder CRUD + reordering             |
| `use-regex-scripts.ts`         | Regex script CRUD                         |
| `use-haptic.ts`                | Haptic device connection + commands       |

---

## Component Guide

### Chat System (`components/chat/`)

The chat system is the largest feature area (30+ files). It has three rendering modes:

#### Conversation Mode (`ChatConversationSurface.tsx`)

iMessage-style chat bubbles. User messages on the right, assistant on the left. Features:

- Infinite scroll pagination (load older messages on scroll up)
- Per-message actions: edit, copy, regenerate, delete, branch, peek prompt
- Attachment support (images, files)
- Emoji and GIF pickers
- Slash commands (`/scene`, etc.)
- Notification sounds on new messages
- Draft persistence per chat

#### Roleplay Mode (`ChatRoleplaySurface.tsx`)

Dark, immersive RPG-themed interface. All the conversation features plus:

- **Character sprites** with expression changes driven by the expression agent
- **Roleplay HUD** showing game state (time, location, weather, present characters)
- **Weather effects** (particle overlays matching the scene weather)
- **Echo chamber** panel (simulated viewer reactions)
- **Combat encounters** with turn-based action system
- **World info** panel showing active lorebook entries
- **Scene system** for branching mini-roleplays
- **Background images** with crossfade transitions

#### Visual Novel Mode

Sprite-driven VN experience with character positioning, transitions, and choice-based branching. Uses the same underlying data flow as roleplay mode.

#### Key Components

- **`ChatArea.tsx`**: Central orchestrator. Fetches all data (messages, characters, personas), builds the character map, determines chat mode, and renders the appropriate surface.
- **`ChatMessage.tsx`**: Renders a single message with markdown, swipe navigation, editing, and action menus. Uses an uncontrolled `EditTextarea` subcomponent to avoid re-renders during editing.
- **`ChatInput.tsx`**: User input with auto-resize, draft persistence, slash command completion, attachment handling, and emoji/GIF insertion.

### Editor Components

Each resource type has a full-page editor that replaces the chat area:

| Editor            | File                                          | Manages                                                                                   |
| ----------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Character Editor  | `components/characters/CharacterEditor.tsx`   | Character card fields (V2 spec), avatar, greeting, personality, system prompt, extensions |
| Lorebook Editor   | `components/lorebooks/LorebookEditor.tsx`     | Lorebook metadata + entries with keys, activation rules, injection settings               |
| Preset Editor     | `components/presets/PresetEditor.tsx`         | Prompt sections, groups, markers, generation parameters, choice blocks                    |
| Connection Editor | `components/connections/ConnectionEditor.tsx` | API provider, base URL, model, context window, flags                                      |
| Agent Editor      | `components/agents/AgentEditor.tsx`           | Agent prompt template, phase, connection, tools, settings                                 |
| Persona Editor    | `components/personas/PersonaEditor.tsx`       | User persona with name, description, stats, avatar                                        |

### Modal System (`components/modals/`)

Modals are rendered by `ModalRenderer.tsx`, which reads `ui.store.modal` and renders the matching component inside `<Suspense>`.

**Available modal types:**

| Type               | Component              | Purpose                                  |
| ------------------ | ---------------------- | ---------------------------------------- |
| `create-character` | `CreateCharacterModal` | Quick character creation (name + avatar) |
| `create-lorebook`  | `CreateLorebookModal`  | Quick lorebook creation                  |
| `create-preset`    | `CreatePresetModal`    | Quick preset creation                    |
| `import-character` | `ImportCharacterModal` | Import from file (JSON/PNG)              |
| `import-lorebook`  | `ImportLorebookModal`  | Import from file                         |
| `import-preset`    | `ImportPresetModal`    | Import from file                         |
| `import-persona`   | `ImportPersonaModal`   | Import from file                         |
| `st-bulk-import`   | `STBulkImportModal`    | Bulk import from SillyTavern data        |
| `character-maker`  | `CharacterMakerModal`  | AI-generated character via SSE streaming |
| `lorebook-maker`   | `LorebookMakerModal`   | AI-generated lorebook entries            |
| `persona-maker`    | `PersonaMakerModal`    | AI-generated persona                     |
| `edit-agent`       | `EditAgentModal`       | Edit agent configuration                 |

**Modal pattern**: All modals accept `{ open, onClose }`, wrap content in the `<Modal>` base component, use mutations for API calls, and show loading state from `mutation.isPending`.

### Panel System (`components/panels/`)

Right-side panels display resource lists with search, sort, and filtering. Clicking a resource opens its full editor in the center pane.

Panels are registered in `RightPanel.tsx` in two places:

1. `PANEL_CONFIG` — title, icon, gradient color
2. `PANELS` — component map

Panels use **module-level persistence**: a `mountedPanels` Set tracks which panels have been visited. Once mounted, a panel stays in the DOM (hidden with `display: none` or `aria-hidden`) to preserve its state.

### UI Primitives (`components/ui/`)

| Component          | Description                                                       |
| ------------------ | ----------------------------------------------------------------- |
| `Modal`            | Base modal with backdrop click, escape key, enter/exit animations |
| `ColorPicker`      | Solid color or gradient picker with preset swatches               |
| `ExpandedTextarea` | Full-screen portal overlay for editing large text blocks          |
| `EmojiPicker`      | Searchable emoji popover (portal-rendered)                        |
| `GifPicker`        | GIF search via Giphy API                                          |
| `HelpTooltip`      | Hover icon → tooltip (portal-positioned)                          |

All UI components use **controlled props** (value + onChange) and **portal rendering** for overlays.

---

## API Client (`lib/api-client.ts`)

All server communication uses the `api` object:

```typescript
import { api, ApiError } from "@/lib/api-client";
```

| Method                         | Signature           | Description                           |
| ------------------------------ | ------------------- | ------------------------------------- |
| `api.get<T>(path)`             | `GET /api{path}`    | Fetch JSON                            |
| `api.post<T>(path, body)`      | `POST /api{path}`   | Send JSON, receive JSON               |
| `api.put<T>(path, body)`       | `PUT /api{path}`    | Full update                           |
| `api.patch<T>(path, body)`     | `PATCH /api{path}`  | Partial update                        |
| `api.delete(path)`             | `DELETE /api{path}` | Delete resource                       |
| `api.upload(path, FormData)`   | `POST /api{path}`   | Multipart file upload                 |
| `api.download(path, filename)` | `GET /api{path}`    | Download + save-as dialog             |
| `api.stream(path, body)`       | `POST /api{path}`   | SSE async generator (tokens only)     |
| `api.streamEvents(path, body)` | `POST /api{path}`   | SSE async generator (all event types) |

Errors throw `ApiError` with `status` and `message` properties.

---

## Styling System

### Tailwind CSS v4

The project uses Tailwind CSS v4 with the `@tailwindcss/vite` plugin (no PostCSS configuration needed). Theme tokens are mapped from CSS custom properties in `globals.css`:

```css
@theme {
  --color-primary: var(--primary);
  --color-background: var(--background);
  --color-border: var(--border);
  /* ... */
}
```

### Theme Architecture

`globals.css` is organized into 20 labeled sections:

1. Tailwind `@theme` mapping
2. Dark theme CSS variables (50+ semantic colors)
3. Light theme overrides
4. Base reset and body defaults
5. Custom SVG cursors (Y2K themed)
6. Custom scrollbars
7. Glass/frosted panels (`.glass`, `.glass-strong`)
8. Glow and shadow utilities
9. UI components (badges, cards, buttons, stars)
10. Keyframe animations (gradient borders, scanlines)
11. Chat animations (message-in, shimmer, grid)
12. Chat: Glimmer theme (roleplay bubbles)
13. Chat: Conversation mode (message bubbles)
14. Chat: Roleplay mode (immersive dark)
15. Sprites and game HUD
16. Function call cards (tool-use display)
17. Responsive / mobile
18. SillyTavern theme (imported from `themes/sillytavern.css`)
19. Accessibility (`prefers-reduced-motion`)
20. Performance hints (`will-change`, GPU compositing)

### Custom Themes

Users can create custom themes via the Settings > Themes panel. Theme definitions are stored on the Marinara server and sync across connected devices; the active custom theme is also shared. The CSS is injected as a `<style>` tag by `CustomThemeInjector.tsx`.

---

## Shared Package (`packages/shared`)

The frontend imports types, schemas, and constants from `@marinara-engine/shared`.

### Constants

| File               | Exports                                                                                                              | Key Values                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `defaults.ts`      | `APP_VERSION`, `PROFESSOR_MARI_ID`, `DEFAULT_CONNECTION_ID`, `DEFAULT_GENERATION_PARAMS`, `MAX_FILE_SIZES`, `LIMITS` | Version source, built-in character ID, default generation settings        |
| `providers.ts`     | `PROVIDERS`                                                                                                          | API provider configs (OpenAI, Anthropic, Google, etc.) with URLs and auth |
| `chat-modes.ts`    | `CHAT_MODES`                                                                                                         | Mode definitions: conversation, roleplay, visual_novel                    |
| `model-lists.ts`   | Model catalogs + `IMAGE_GENERATION_SOURCES`, `IMAGE_GEN_MODELS`                                                      | Static model lists per provider, image generation providers               |
| `agent-prompts.ts` | Default prompts for 15+ built-in agents                                                                              | System prompts for world-state, prose-guardian, continuity, etc.          |

### Schemas (Zod)

All input validation uses Zod schemas from `packages/shared/src/schemas/`:

| Schema file             | Entities                                                         |
| ----------------------- | ---------------------------------------------------------------- |
| `agent.schema.ts`       | AgentConfig create/update, agent phases, result types            |
| `character.schema.ts`   | Character card V2, extensions, character books, groups           |
| `chat.schema.ts`        | Chat create, message create, generation request                  |
| `connection.schema.ts`  | API connection create/update                                     |
| `custom-tool.schema.ts` | Custom tool definitions                                          |
| `lorebook.schema.ts`    | Lorebook + entry create/update, activation conditions, schedules |
| `prompt.schema.ts`      | Preset, section, group, choice block, generation parameters      |
| `regex.schema.ts`       | Regex script create/update                                       |

### Types

Type definitions for all entities in `packages/shared/src/types/`:

| Type file             | Key interfaces                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `agent.ts`            | `AgentConfig`, `AgentResult`, `AgentContext`, `ToolDefinition`, `ToolCall`, `ToolResult`, `BUILT_IN_AGENTS` |
| `character.ts`        | `Character`, `CharacterCardV2`, `CharacterData`, `CharacterExtensions`, `RPGStatsConfig`                    |
| `chat.ts`             | `Chat`, `ChatMetadata`, `Message`, `MessageExtra`, `GenerationInfo`, `StreamEvent`                          |
| `connection.ts`       | `APIConnection`, `ModelInfo`, `ModelCapabilities`, `ConnectionTestResult`                                   |
| `combat-encounter.ts` | `CombatPartyMember`, `CombatEnemy`, `CombatActionResult`, `EncounterSettings`                               |
| `game-state.ts`       | `GameState`, `PresentCharacter`, `PlayerStats`, `QuestProgress`, `InventoryItem`                            |
| `lorebook.ts`         | `Lorebook`, `LorebookEntry`, `ActivationCondition`, `LorebookSchedule`, `QuestData`                         |
| `persona.ts`          | `Persona`, `PersonaStatsConfig`, `AltDescription`                                                           |
| `prompt.ts`           | `PromptPreset`, `PromptSection`, `PromptGroup`, `ChoiceBlock`, `GenerationParameters`                       |
| `scene.ts`            | `SceneMeta`, `SceneFullPlan`                                                                                |
| `vn.ts`               | `VNScene`, `VNSprite`, `VNTransition`, `VNChoice`                                                           |
| `haptic.ts`           | `HapticDevice`, `HapticStatus`, `HapticDeviceCommand`                                                       |
| `regex.ts`            | `RegexScript`                                                                                               |
| `export.ts`           | `ExportEnvelope<T>`                                                                                         |

### Utilities

| File              | Purpose                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `macro-engine.ts` | `resolveMacros(template, context)` — replaces `{{date}}`, `{{char}}`, `{{random}}`, `{{roll:2d6}}`, `{{getvar::name}}`, etc. |
| `xml-wrapper.ts`  | `wrapInXml()`, `stripXmlTags()`, `nameToXmlTag()`                                                                            |

---

## API Endpoints

The server (`packages/server`) exposes the following REST API at `/api`:

### Core Resources

| Prefix               | Methods                       | Description                                          |
| -------------------- | ----------------------------- | ---------------------------------------------------- |
| `/api/characters`    | GET, POST, PATCH, DELETE      | Character CRUD, groups, export (JSON/PNG)            |
| `/api/chats`         | GET, POST, PATCH, DELETE      | Chat CRUD, messages, metadata, connect/disconnect    |
| `/api/prompts`       | GET, POST, PATCH, DELETE      | Preset CRUD, sections, groups, choice blocks, export |
| `/api/connections`   | GET, POST, PATCH, DELETE      | API connection CRUD, duplicate, test                 |
| `/api/agents`        | GET, POST, PATCH, DELETE, PUT | Agent CRUD, toggle, echo messages                    |
| `/api/lorebooks`     | GET, POST, PATCH, DELETE      | Lorebook CRUD, entries, export                       |
| `/api/custom-tools`  | GET, POST, PATCH, DELETE      | Custom tool CRUD                                     |
| `/api/regex-scripts` | GET, POST, PATCH, DELETE      | Regex script CRUD                                    |

### Generation

| Endpoint                                        | Method | Description                             |
| ----------------------------------------------- | ------ | --------------------------------------- |
| `/api/generate`                                 | POST   | Main SSE generation with agent pipeline |
| `/api/generate/retry-agents/:chatId/:messageId` | POST   | Retry agent phases                      |

### Chat Features

| Prefix              | Endpoints                        | Description                 |
| ------------------- | -------------------------------- | --------------------------- |
| `/api/chat-folders` | CRUD + reorder                   | Chat folder management      |
| `/api/conversation` | schedule, status, message, check | Autonomous messaging system |
| `/api/scene`        | create, plan, conclude           | Scene branching             |
| `/api/encounter`    | init, action, summary            | Combat encounters           |
| `/api/translate`    | POST                             | Text translation            |

### Media & Assets

| Prefix                        | Description                  |
| ----------------------------- | ---------------------------- |
| `/api/avatars/file/:filename` | Avatar image serving         |
| `/api/backgrounds`            | Background CRUD + upload     |
| `/api/sprites/:characterId`   | Sprite expression management |
| `/api/fonts`                  | Custom font management       |
| `/api/gallery/:chatId`        | Per-chat gallery images      |
| `/api/gifs/search`            | GIF search (Giphy proxy)     |

### AI Generators

| Endpoint                        | Description                   |
| ------------------------------- | ----------------------------- |
| `/api/character-maker/generate` | AI character generation (SSE) |
| `/api/lorebook-maker/generate`  | AI lorebook generation (SSE)  |
| `/api/persona-maker/generate`   | AI persona generation (SSE)   |
| `/api/prompt-reviewer/review`   | Preset quality review (SSE)   |

### External Integrations

| Prefix                          | Description                |
| ------------------------------- | -------------------------- |
| `/api/bot-browser/chub/*`       | Chub character search      |
| `/api/bot-browser/chartavern/*` | CharacterTavern search     |
| `/api/bot-browser/janny/*`      | JannyAI search             |
| `/api/bot-browser/pygmalion/*`  | Pygmalion search           |
| `/api/bot-browser/wyvern/*`     | Wyvern search              |
| `/api/haptic/*`                 | Buttplug.io device control |
| `/api/spotify/*`                | Spotify auth (PKCE)        |
| `/api/knowledge-sources`        | RAG knowledge base         |

### System

| Endpoint                      | Description                             |
| ----------------------------- | --------------------------------------- |
| `/api/updates/check`          | Version check against GitHub releases   |
| `/api/updates/latest`         | Latest release metadata                 |
| `/api/updates/commits-behind` | Git install update distance             |
| `/api/backup`                 | Full backup, export, import             |
| `/api/import/*`               | SillyTavern and Marinara profile import |
| `/api/admin/clear-all`        | Nuclear data clear                      |

---

## PWA Support

The app is a Progressive Web App configured via VitePWA:

- **Manifest**: `public/manifest.json` with "Marinara Engine" app name, standalone display mode, dark theme
- **Icons**: 64px favicon, 192px + 512px maskable icons, splash logo
- **Service Worker**: Workbox with auto-update strategy
- **Caching**: Static assets cached; `/api/*` routes use NetworkOnly
- **Keep-alive**: `lib/keep-alive.ts` uses Web Locks API + BroadcastChannel pings to prevent tab sleeping

### Version Skew Detection

`App.tsx` polls `/api/health` every 5 minutes. If the server version differs from the client's cached version, the service worker is unregistered and caches are cleared to force an update.

---

## Agent System

The agent system processes AI responses through configurable pipelines. Agents run in three phases:

1. **Pre-generation**: Before the main LLM call (e.g., context injection, knowledge retrieval)
2. **Parallel**: Alongside the main generation (e.g., world-state tracking, expression detection)
3. **Post-processing**: After the main response (e.g., prose rewriting, lorebook updates)

### Built-in Agents (24)

| Agent                   | Phase           | Description                                                 |
| ----------------------- | --------------- | ----------------------------------------------------------- |
| `world-state`           | parallel        | Extracts date, time, location, weather from narrative       |
| `prose-guardian`        | post_processing | Enforces writing quality (anti-repetition, show-don't-tell) |
| `continuity`            | parallel        | Detects contradictions (names, locations, timeline)         |
| `expression`            | parallel        | Selects character sprite expressions                        |
| `echo-chamber`          | post_processing | Simulates Twitch-style viewer reactions                     |
| `director`              | pre_generation  | Injects narrative stage directions                          |
| `quest`                 | parallel        | Tracks quest creation, updates, completion                  |
| `illustrator`           | parallel        | Generates image prompts for key scenes                      |
| `lorebook-keeper`       | post_processing | Auto-creates/updates lorebook entries                       |
| `prompt-reviewer`       | pre_generation  | Quality-checks the assembled prompt                         |
| `combat`                | parallel        | Tracks combat rounds, HP, initiative                        |
| `background`            | parallel        | Selects fitting background image                            |
| `character-tracker`     | parallel        | Tracks character state changes                              |
| `persona-stats`         | parallel        | Tracks player persona stat changes                          |
| `html`                  | post_processing | Injects HTML elements into messages                         |
| `chat-summary`          | post_processing | Generates conversation summaries                            |
| `spotify`               | parallel        | Controls Spotify playback                                   |
| `editor`                | post_processing | Edits/transforms the response                               |
| `knowledge-retrieval`   | pre_generation  | RAG from knowledge sources                                  |
| `schedule-planner`      | pre_generation  | Plans character message schedules                           |
| `response-orchestrator` | pre_generation  | Orchestrates multi-character responses                      |
| `autonomous-messenger`  | pre_generation  | Handles autonomous character messages                       |
| `custom-tracker`        | parallel        | User-defined tracking                                       |
| `haptic`                | post_processing | Haptic device commands                                      |

### Agent Result Types

Agents produce typed results that the frontend handles:

`game_state_update`, `text_rewrite`, `sprite_change`, `echo_message`, `quest_update`, `image_prompt`, `context_injection`, `continuity_check`, `director_event`, `lorebook_update`, `prompt_review`, `background_change`, `character_tracker_update`, `persona_stats_update`, `custom_tracker_update`, `chat_summary`, `spotify_control`, `haptic_command`, `cyoa_choices`

---

## Chat Modes

### Conversation Mode

Plain dialogue with one or more AI characters. Characters can have different statuses (online, idle, DnD, offline) that influence response timing and style.

**Default agents**: schedule-planner, response-orchestrator, autonomous-messenger

### Roleplay Mode

Immersive narrative experience with game state tracking:

- Scene context (location, time, weather)
- Character presence and mood
- Player stats, inventory, and quests
- Combat encounters
- World info from lorebooks
- Sprite expressions

**Default agents**: world-state, prose-guardian, continuity, expression

### Visual Novel Mode

VN-style experience with:

- Character sprites with positioning (7 positions from far-left to far-right)
- Scene transitions (fade, dissolve, slide, wipe)
- Choice-based branching
- Expression changes

**Default agents**: world-state, prose-guardian, expression

---

## Development

### Commands

```bash
pnpm install          # Install all dependencies
pnpm dev              # Start server + client with hot reload
pnpm dev:client       # Vite dev server only
pnpm dev:server       # API server only
pnpm check            # TypeScript + ESLint (baseline validation)
pnpm build            # Production build
```

### Bundle Budget

- Main entry: max 1 MB
- Per-chunk: max 500 KB
- Vendor splits: react, tanstack, motion, zustand, icons, misc

### Path Alias

`@/*` resolves to `./src/*` in both TypeScript and Vite configs.
