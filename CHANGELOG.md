# Changelog

This file is the release-notes source of truth for Marinara Engine. Reuse these entries when publishing GitHub Releases for tags in the `vX.Y.Z` format.

## [Unreleased]

### Added

- Added optional image generation for the Background agent so Roleplay can create and reuse missing scene backgrounds from an agent-selected image connection.
- Reworked the avatar crop tool into a square-region selector with corner handles + interior pan, so users can pick the exact part of the source image that becomes the circle avatar. Replaces the prior zoom + pan slider on Character avatars and adds the same widget to Personas (previously had no crop UI). The original avatar file is never overwritten — the Roleplay glued side panel still shows the full portrait.

### Changed

- Guided `/narrator` requests and guided manual character replies now use Chat reply lorebook triggers instead of Continue/Autonomous triggers. Move lorebook entries from Continue/Autonomous to Chat reply if they should fire for guided replies.
- Expanded Android APK disclaimers across GitHub Release notes, release asset naming, install docs, FAQ/troubleshooting, in-app update metadata, APK build output, and the Android shell's connection screen so users know the APK is a WebView shell and still requires the Termux launcher to be running.

### Fixed

- Made CSRF rejections visible in the UI so saves can no longer silently fail when Marinara is reached through an untrusted origin (e.g. a public IP, reverse-proxy domain, or Tailscale MagicDNS hostname). Three layers cover the issue: a sticky red banner appears at the top of the app on page load when the current browser origin would be rejected, with the exact `.env` line and a one-click copy button; the existing toast still fires on any in-session mutation that hits CSRF; and the 403 response now carries a stable `code` (`CSRF_ORIGIN_NOT_TRUSTED`, `CSRF_REFERER_NOT_TRUSTED`, `CSRF_CROSS_SITE`, or `CSRF_MISSING_HEADER`). The server logs the active CSRF auto-trust scope (loopback, HOST, private-IP literals, configured origins) on startup, and a new read-only `GET /api/csrf/origin-status` endpoint reports the current origin's trust verdict. Tailscale, Docker bridge, RFC 1918, and link-local IP-literal origins remain auto-trusted; only public IPs and DNS names need to be listed in `CSRF_TRUSTED_ORIGINS`. ([#722](https://github.com/Pasta-Devs/Marinara-Engine/issues/722))
- Restored message number display in Conversation chats when the setting is enabled.
- Fixed Docker images missing the optional background remover installer script, and added the Python venv runtime needed by the regular image installer.
- Fixed fresh Docker installs so runtime `.env` creation and file-native storage stay inside the persistent `/app/data` volume.
- Fixed Game mode image prompt review so prompt review modals can appear during first-start asset generation instead of suppressing the review flow.
- Fixed Linux NVIDIA local-runtime setup in Docker by falling back to the official Vulkan/CPU llama.cpp builds when Linux CUDA release assets are unavailable.
- Fixed GLM 5.1 via NanoGPT returning thinking-only text in Professor Mari chats by explicitly disabling thinking when reasoning is off and refusing to expose GLM thinking as visible chat output.
- Fixed app settings reverting after reload when stale server-synced settings overwrote newer browser-local preferences.

## [1.5.9]

### Added

- Improved sprite generation for expressions and full-body ones, allowing you to create matching full-body sprites for game mode to be shown alongside the expression ones.
- Spotify music player with DJ Mari (can be toggled in Settings).
- Cross-device extension storage, so browser extensions can sync through the server instead of staying tied to one device.
- Editable agent context injections and secret plot controls.
  Configurable impersonation controls, including an option to use CYOA choices as impersonation directions.
- /hide and /unhide slash commands for bulk AI-context visibility control.
- Start Chat actions from character views and the character panel.
- Persona-specific saved status options.
- Random expression sprite groups.
- Copy-message support in Game mode.
- Documentation updates for setup, updates, troubleshooting, iOS PWA use, and platform-specific install paths.
- The `.env` is now auto-created on first run (empty placeholder pointing at .env.example).
- Per-connection Fast Mode toggle for Claude (Subscription) — currently a no-op, kept for when Anthropic restores fast-mode routing.
- "Diagnose Model Routing" button on Claude (Subscription) connections, reporting which model the SDK actually billed against.
- OpenAI (ChatGPT) connections that use the local Codex ChatGPT login instead of an OpenAI API key.
- Server-side warning when the SDK silently bills against a different model than requested.
- Roleplay avatar and default sprite scale controls in Appearance settings.
- Per-connection max parallel agent job controls, allowing agent-heavy chats to split same-connection work across multiple LLM calls.
- Editable Game Session History map JSON in the current-session spoiler section.
- Markdown rendering and live preview for Game journal notes.
- `/emote name="Character" expression="expression"` for listing and manually switching roleplay sprite expressions.
- Duplicate action for individual prompt preset blocks.
- Close controls for Game mode choice prompts and quick-time event windows.
- Agent tool calls for reading and replacing chat-wide string variables.
- OpenRouter as an image generation service through the existing image connection flow.
- Game setup can now review, edit, or remove generated HUD widgets and custom stat fields before the first turn starts.
- Character cards now support Persona-style Description Extensions, with active blocks appended to prompt descriptions.
- Game mode NPC side banter now spreads long runs across later VN segments, reducing oversized popup stacks.
- Roleplay Writer Agents can now pause before the main reply so their prompt injections can be reviewed and edited.
- Game Session Logs now highlight entries included in a pending multi-message deletion.
- Conversation settings now include a Commands section for toggling hidden character commands and configuring selfie and schedule command support.
- Rare Chibi Professor Mari scroll toast easter egg with a matching thank-you response in Professor Mari chats.
- Active World Info controls in Conversation and Game mode, including mobile access through the overflow menus.

### Changed

- Agents in Roleplay display rework.
- Game mode inventory no longer has a hard item cap.
- The `.env` changes hot-reload without a server restart for most settings (auth, IP allowlist, CSRF/CORS origins, and local-URL flags). Boot-bound vars still warn on change.
- Tailscale (100.64.0.0/10) and Docker (172.16.0.0/12) traffic are trusted by default, skipping IP allowlist and Basic Auth, with BYPASS_AUTH_TAILSCALE / BYPASS_AUTH_DOCKER opt-outs.
- CORS_ORIGINS is now hot-reloadable, and same-origin requests are auto-allowed regardless of config.
- Network rejection, SSRF, CSRF, and CORS errors now name the exact env var and the line to paste into `.env` to fix them.

### Fixed

- Fixed local LM Studio connection JSON errors and .local provider endpoint validation.
- Fixed agent output leaking into the main prompt, local model fallback handling, and Narrative Director cadence in group replies.
- Fixed spurious aborts on normal generation completion and raw conversation streaming buffers appearing in the UI.
- Fixed Roleplay DM routing to linked Conversation chats and connected chat branch labels.
- Fixed retrying Conversation generation from the send button and refreshing Conversation status when opening chats.
- Fixed Memory Recall refresh after message edits, reroll invalidation, and Termux embedding handling.
- Fixed Lorebook import, embedded lorebook sync, legacy link hydration, duplicate links, stale linked counts, disabled lorebook activation, prompt preview gates, and several scoping edge cases.
- Fixed Game mode combat targeting, mobile combat layout, combat HP initialization, enemy portraits, skill-check attributes, scene time drift, map regeneration after restored turns, typed choice prompts, background switching races, and scene intro recovery after asset failures.
- Fixed grouped Conversation image attachments and selfie persistence to active swipes.
- Fixed NovelAI image request settings and V4 native prompt input.
- Fixed Google provider empty candidate handling, Claude Subscription model identity loss, llama.cpp embedding response parsing, and TTS provider diagnostics.
- Fixed Docker and Lite Docker startup/install issues, including recursive app ownership layers, CPU-only hosts, and Rollup native binary restoration.
- Fixed Lite Docker sprite generation by rebuilding the `sharp` native module after scriptless dependency installs.
- Fixed conversation schedule generation so a connection max-token override replaces the old fixed schedule budget.
- Removed the oversized Characters panel New Chat row button so character names and metadata are no longer truncated.
- Fixed Active World Info so it reflects the lorebook entries used by the last generation instead of previewing the next turn.
- Fixed Game setup JSON parsing for common LLM omissions such as a missing comma before the next property, and added line numbers to the JSON repair editor.
- Fixed Game mode Talk to GM and Talk to Party turns so they skip scene/weather analysis instead of running the full scene-prep pipeline.
- Fixed right-panel resize handle layering and custom font family normalization.
- Improved combat in Game mode.
- Claude (Subscription) silent model-identity loss; Opus and Haiku falsely self-identified as Sonnet because the SDK strips version awareness without the claude_code preset wrapping.
- Bounded the CSRF/CORS rejection-log throttle caches (capped at 2048 with FIFO eviction) so attacker-controlled origin strings can't grow process memory without bound.
- Unified the CSRF 403 response body to use origin across all branches (it was inconsistent for the Referer-not-trusted case).
- Fixed Game mode inventory item names so long names wrap instead of truncating, and removed stale item-description rendering from inventory surfaces.
- Various UI improvements.

## [1.5.8]

### Added

- Special edition of Game mode Lorebook Keeper.
- Guides for all modes.
- QoL improvements to Lorebooks handling.
- Optional intuitive swipe navigation lets Conversation and Roleplay users move through rerolls with arrow keys or touch swipes, with an opt-in reroll-at-the-end shortcut.
- Roleplay chats can now optionally let characters create direct-message Conversation chats with hidden `[dm: ...]` commands.
- Lorebook entries can now be selected in bulk and copied or moved to another lorebook.

### Fixed

- Various issues caused by the security tightening were fixed.
- Sidecar issues fixed.
- Improves the selfie regex, catching malformed commands.
- Fixed context trimming.
- MLX sidecar runtime installs the upstream `mlx-lm` source build so curated Gemma 4 MLX models can load on Apple Silicon.
- Dry-run prompt preview now trims against manually configured preset Max Context Window values instead of only connection/model limits.
- Script custom tools now show their disabled state in the editor and fail safely when `CUSTOM_TOOL_SCRIPT_ENABLED` is off instead of silently disappearing from agent tool pickers.
- Browser extensions now load under CSP through Blob module execution instead of eval, keeping extension support without adding `unsafe-eval`.
- Local sidecar runtime installation now works when the matching Admin Access secret is entered, even if `SIDECAR_RUNTIME_INSTALL_ENABLED` remains off.
- Agent traffic now warns when the default agent connection may bill a provider. Agents explicitly set to Local Model are skipped with a visible warning when the sidecar is unavailable instead of silently falling back to a paid API connection.
- Chat attachments now wait for file reads, preserve files in manual group mode, and expose supported text files like JSON/Markdown/CSV to the model instead of silently dropping them.
- Fixed rolling in Game mode.
- Lorebook Keeper updates now receive existing entry content, and append structured new facts instead of replacing user-written lorebook text.
- Docker images now repair `/app/data` volume ownership before dropping to the non-root runtime user, preventing `EACCES` startup failures during file-storage migration.
- OpenAI-compatible local streams now accept stricter and looser SSE `data:` formatting, Conversation mode visibly streams text again, and live reasoning chunks appear while a reply is still generating.
- Expression agent sprite updates now repair stale character IDs from the current character name before dropping the expression, so existing characters keep their expressions mid-session.
- Stability AI image connections now test against Stability's account endpoint, fetch legacy v1 engines when needed, and generate through the correct v2beta Stable Image task endpoints instead of probing `/models`.
- Game mode party changes made from Chat Settings now sync to game metadata and carry into future sessions.
- NanoGPT GPT Image 2 requests now normalize image size to a supported pixel budget instead of forwarding too-small canvases.
- Conversation manual generations now share the autonomous in-progress guard, preventing async catch-up replies from duplicating the same user turn.
- Edits made via "Edit Linked Lorebook" on a character with an embedded lorebook now persist back to the character's V2 `character_book`, so deleted entries no longer reappear when the character is reopened, and deleting the linked lorebook clears the embedded copy on the character and evicts the cached lorebook detail instead of leaving stale entries, a phantom Reimport button, and a ghost lorebook editor behind. Imported character cards no longer carry over a foreign `lorebookId` pointer in their extensions, the character editor verifies the linked lorebook actually exists before showing "Edit Linked Lorebook", and the lorebook editor surfaces a 404 with a toast instead of an infinite loading shimmer when opened against a deleted lorebook.

## [1.5.7]

### Added

- Guide for Game mode.
- Professor Mari can now create Lorebooks for you.
- Days tracker in Game mode that you can edit.
- Lorebook entry trigger mode can now be changed directly from the entry status dot.
- Game mode interrupt button that allows you to interrupt the GM (with or without consequences to your game).
- Various improvements to the Game mode's combat and inventory systems, more cinematic battles, better UI handling, and more overall mechanics.
- Game mode map scaling.
- New permanent tag that persists in Roleplay mode if a character passed you important information in Conversation mode.
- Improvements to the Knowledge Router agent.
- Storing the Conversation Theme background gradient separately for dark and light color schemes, so switching OS/browser theme automatically loads the correct gradient.
- Custom agents now have a chat memory.
- Prompt overrides the registry for image generation.
- Active filter tab in Lorebooks.
- Compressed Lorebooks.
- Customizable generation settings for local image generation.
- When generating schedules, they now receive context from the conversation chats you had with a character.
- Hide/unhide messages in Roleplay mode.
- Alternative display of logs for Game mode.
- Custom agents can now choose a result type, including Text Rewrite for post-processing agents that edit the generated reply.
- Setting to enable showing and editing image prompts before they're sent.
- Setting to change the image dimensions for generation.
- Various small QOL changes.
- Custom agents' outputs can now be edited in the Agents button in the Roleplay mode.
- Custom parameters field.
- Sliders to control the sprite's size and opacity in Roleplay mode.
- Custom activity statuses for the user.
- Vectorized Lorebook entries are now visibly marked.
- Character card version history with compare and restore controls.
- Prefills.
- File-backed storage is now the default: legacy SQLite data is imported into JSON files under `DATA_DIR/storage`, backups include those files, and `STORAGE_BACKEND=sqlite` remains as an advanced compatibility escape hatch.
- Allowed token size outputs in agents.
- Lorebook folders.
- Game mode setup remembers custom genre, tone, setting, and goal options from previous games.
- Optional trimming for incomplete model endings before generated messages are saved.
- Draft translation button option in chat Translation settings for Conversation, Roleplay, and Game modes.
- Native vs compatible export choices for profile, character, persona, and lorebook exports.
- PocketTTS is now available as a local TTS provider.
- Optional speech-to-text microphone buttons can be enabled for Conversation, Roleplay, and Game input fields.
- Character imports now ask before extracting embedded character-card lorebooks into standalone Marinara lorebooks.
- Home Assistant HACS integration that syncs Marinara custom tools and a Home Assistant agent for smart-home control.
- Updated the supported toolchain to Node.js 24 LTS and pnpm 10.33.2 across launchers, installers, Docker images, docs, and CI, plus refreshed dependencies within their compatible ranges.
- Lorebook entries can now be scoped by active characters, character tags, and generation triggers, and can scan selected character/persona fields as extra keyword-matching sources.
- Game mode now has an optional Lorebook Keeper that updates a game-scoped lorebook after session conclusion and automatically attaches it to that game.

### Security

- Hardened default network access so loopback remains convenient while non-loopback private-network traffic fails closed unless Basic Auth, an allowlist, or an explicit unsafe opt-in is configured.
- Added global unsafe-method CSRF/origin protections, security headers, route throttling, and shared privileged-route gates for admin, update, backup/import, sidecar, haptics, and custom-tool operations.
- Added SSRF, path containment, upload validation, bulk-import capability tokens, and response-size guards around high-risk URL, file, and archive flows.
- Disabled or gated risky execution paths by default, including API-driven update apply, custom script tools, sidecar runtime installs, and remote haptic control.
- Removed the seeded default provider key, encrypted Spotify token storage, and redacted obvious secrets from profile export.
- Hardened chat HTML sanitization and SVG/image handling, then upgraded vulnerable production and build dependencies.
- Hardened Docker, Android WebView/backup, GitHub Actions action references, and Windows installer dependency verification.
- Breaking/default changes: privileged routes now require `ADMIN_SECRET`, Docker binds to localhost by default, and update apply, custom script tools, and sidecar runtime installs are disabled until operators opt in with the documented environment switches.
- Operators who intentionally need the old exposure model must set `ADMIN_SECRET`, choose a remote bind address for Docker/launchers, and explicitly enable only the required flows such as `UPDATES_APPLY_ENABLED`, `CUSTOM_TOOL_SCRIPT_ENABLED`, or `SIDECAR_RUNTIME_INSTALL_ENABLED`.

### Fixed

- Custom OpenAI-compatible endpoints like Venice no longer receive provider-specific request fields just because a fetched model ID matches an OpenAI, xAI, OpenRouter, or Z.AI naming pattern.
- Addressed various security concerns.
- Game mode dark screen error addressed.
- Removed the persistent SQLite database as the default live storage path, reducing release-to-release migration failures.
- File-backed migration now merges every known legacy database location and performs a one-time repair for snapshots that missed chats during early v1.5.7 testing.
- On mobile Roleplay, the branch quick-switcher now lives inside the three-dot toolbar menu, so it no longer overlaps the Agents' controls.
- Settings Debug Mode now prints prompt, scene-analysis, party-turn, and game asset debug logs even when `LOG_LEVEL` is not set to `debug`.
- Switching chats doesn't stop the generation of the previously triggered one.
- Cross-conversations confusions addressed.
- {{user}} and {{char}} macros now work in all modes.
- Injections at a specific depth now work correctly.
- Added Spotify OAuth redirect URI handling and manual paste-back.
- [Start the game] is being sent twice upon starting the game.
- Expression Engine now retrieves all the available sprites correctly upon retry.
- Fixed unstable message pagination cursor.
- Various errors were addressed.
- Advanced parameters are now respected by local endpoints.
- Improved the quality of some prompts.
- Ensured the daily/weekly summaries trigger consistently.
- We now handle assets in Game mode better.
- Conversation mode characters no longer reply to themselves; instead, they reply to you.
- Drag-and-drop on mobiles now works.
- Custom agents can now rewrite your messages.
- Full-body sprites in game mode now get updated properly.
- Deleted characters from group chat no longer appear as Unknown.
- Roleplay setup and connection setup dialogs now fit short screens with internal scrolling, and Custom Parameters starts empty with an example placeholder.
- File-backed storage now supports Lorebook folders during generation and migration.
- Deleting one saved character card version now leaves the rest of the version history intact.
- Removed the legacy database setup step from the installer flow.
- Fresh installs no longer install the old `better-sqlite3` or `sql.js` SQLite fallback packages.
- Browser-tab character imports now preserve embedded Chub lorebooks as linked Marinara lorebooks.
- OpenRouter Claude reasoning is requested with OpenRouter's unified `reasoning` payload again, restoring thinking capture for Sonnet/Opus reasoning models.
- Sprite sheet prompts now more explicitly require complete slicable grids for expression and full-body pose generation.
- Loopback LLM provider URLs are allowed by default again, so local model servers on `127.0.0.1`, `::1`, or `localhost` do not require the broad private-network URL opt-in.
- Restored the animated Marinara logo on the home screen while keeping the static logo as the inactive-page fallback.
- Tightened the home screen spacing so the logo, FAQ, credits, and special thanks fit more comfortably on desktop and mobile.
- Windows installer updates now force-refresh the release tag and verify the resolved tag commit instead of aborting on legitimate v1.5.7 hotfix retags.
- The v1.5.7 Android wrapper APK now uses a bumped `versionCode` for hotfix updates and the release workflow uploads an installable sideload APK.
- Game Lorebook Keeper now continues in the background after a session is concluded instead of holding the End Session response open.
- Launchers, installers, and in-app updates now fall back to installed or temporary pnpm when Corepack cannot resolve the exact pinned pnpm patch version.
- Explicit ComfyUI and AUTOMATIC1111 image-generation connections can use LAN/private-network hosts without the broad image URL opt-in.
- Restored scoped HTML/CSS rendering inside Roleplay messages and narrator bubbles.
- Backup and profile export failures now surface the specific server/admin-secret error instead of a generic failure toast.
- Haptic agent position commands now normalize PositionWithDuration-style outputs and continue executing later commands if one device command fails.
- Lorebook entry drawers now autosave edits, so the manual Save Entry button is no longer needed.
- Docker/LAN browser origins now pass CSRF checks when Marinara is reached through a mapped host port, and `CSRF_TRUSTED_ORIGINS=*` is honored as an explicit unsafe wildcard.
- Loopback backup/profile export requests no longer require `ADMIN_SECRET` by default; remote privileged requests still do.
- Turning off Conversation schedules now clears saved schedule metadata and resets affected character availability state.
- Removed the Workbox `index.html` navigation fallback that caused non-precached-url console noise.
- Various minor UI bugs.

## [1.5.6]

### Added

- New connection provider Claude (Subscription) that routes chat through the locally installed Claude Agent SDK so requests bill against your Anthropic Pro / Max subscription instead of an `sk-ant-*` API key. Requires `npm i -g @anthropic-ai/claude-code` and a one-time `claude login` on the host running Marinara. This is the same auth mechanism Anthropic-endorsed integrations like Zed use; no proxy or third-party shim is involved. Built-in agent tools are disabled and use Marinara's own agent/tool layer. Embeddings are not supported on this provider; configure a separate connection for them.
- The "Mari is thinking…" indicator appears above the composer while Professor Mari executes her embedded commands (create/update character, fetch, create chat, navigate). Makes it clear that her background work is running, not frozen. Bonus: Dottore is doing jumping jacks.
- Dry-run generation endpoint (`POST /api/generate/dryRun`) that runs the full generation pipeline without side effects; no messages persisted, no agents or tools invoked, no Discord webhooks. Extensions can send a `userMessage` to preview "what if I said this", use `impersonate: true` to preview the user's next in-character line, enable optional injections (lorebook, trackers, chat summary), override the preset or connection, and optionally receive the assembled prompt instead of a completion (`returnPrompt: true`). Supports both non-streaming JSON responses and SSE streaming with abort capability. Intended as a stopgap extension API for flexible prompt inspection and silent generation.
- In Game mode, NPCs can be added/removed from your party, plus now you can manage the party manually.
- If you have Image Generation enabled in Game mode, during important scenes, the model now generates immersive VN-like scenes from the player's POV.
- Overall improvements to generating expressions/full-body sprites for your characters.
- Guided generations with a visible indicator.
- Schedule generation preferences added for conversations.
- Pygmalion, Jenny, and DataCat added to the Browser.
- Pinnable taskbar shortcut via custom launcher.
- Universal Tool Support for agents.
- New Knowledge Router agent.
- You can now link Personas to Lorebooks.
- Drag-and-drop Lorebook entries.
- Added ElevenLabs for TTS support.
- TTS now supports character and NPC voices.
- You can now see spoilers for Game mode and edit the plot accordingly to your needs in the History section.
- Upon ending the Game session, you can now optionally include what you want to happen in the next session.
- Separate volume levels for different sounds in Game mode.
- Added the `/impersonate_prompt` command that allows you to change the impersonate prompt.
- Added manual mode in Conversations that only makes the character respond when you ping them with `@name`.
- Resizing sprites in game mode.
- Conversation auto-summarization now has a Day Rollover Hour (so a late-night session doesn't get cut in half when calendar midnight passes) and a Recent Message Tail (keeps the last N messages verbatim across the day boundary so characters wake up remembering the actual flow of last night, not just the gist). Defaults: 4 AM rollover, 10-message tail.
- Conversation characters can now emit durable `<note>...</note>` tags for connected roleplay and game chats. Notes persist in the target chat's prompt until cleared from Chat Settings.
- Lorebook entries now use compact rows with inline controls and an expandable inline editor.
- Lorebook entries can now be grouped into collapsible folders to reduce vertical clutter for stable or AI-managed entries. Folders have their own enable/disable toggle that gates every entry inside (regardless of each entry's own toggle) without modifying the entries' individual settings, so re-enabling a folder restores everything to how it was. Each folder is its own container — sort by Order works inside the folder, and a folder full of high-Order entries can sit above root-level entries with low Order without conflict. Move entries between folders via a per-row folder picker or drag-and-drop. Collapse state is per-browser (localStorage). Folders are flat in this release; nesting may follow.

### Fixed

- UI and other minor glitches in Game Mode.
- Image Generation in game mode is not firing up for named NPCs in a scene.
- More ComfyUI fixes.
- Various general fixes and improvements.
- Anchor link error.
- We now enable the send button immediately after branching.
- Remove background actually sticks across switches.
- Sidecar CUDA runtime setup fix.
- Light Mode readability issues.
- Removed the ability to apply presets to Conversations, which broke the format.
- Improved usability on mobile devices with small screens, where tapping tiny buttons could be difficult.
- Navigational icons under messages now scale with the display size.
- When selecting Personas during chat setups, you can now see their avatars.
- Switching between chats doesn't cancel generations in progress.
- Parameters added to Conversations and Roleplay setups.
- Bugged NPC entries in Game mode journal.
- Creating a new agent doesn't delete the old one.
- Preset names are no longer set to Default upon being selected.
- Black screen on search bar typing in chats was fixed.
- Various UI fixes applied.
- DeepSeek V4 is now supported.
- Addressed the bug that deleted your Persona fields when uploading an avatar in an unsaved state.
- Minor adjustments to some agent widgets.
- Game mode now supports multiple maps.
- Debug mode restored.
- Expression Engine retries now load available sprites, validate returned expressions, and persist the corrected sprite state.

## [1.5.5]

### Added

- New agent: Card Evolution Auditor that actively updates your characters as they grow.
- Polska gurom!!! In Game mode.
- GM can now add party members during the game and create character cards for them.
- Turn, Scene Analysis, and Assets Image Generation retry button in Game mode.
- Improved Game mode's structure and prompts.
- Custom widgets, notes/books, session summaries, and inventory in Game mode are now all editable.
- You can now upload custom NPC portraits in Game mode when clicking on the portraits.
- The Characters tab now opens a full-page library with large card browsing, creator-note previews, and a selected-card overview before editing.
- Chat galleries and character galleries now support selecting and uploading multiple images in one action.
- Chat branches can now be switched from a selector at the top of the chat bar instead of only through Manage Chat Files.
- Conversation schedules now let you customize per-character idle and DND response delays, plus inactivity follow-up timing.
- Character titles to mirror the ones Personas have.
- Various macros, see all under `/macros`.
- Game mode combat improvements (statuses, abilities).
- Bulk delete.
- Search filters for chats in the Chats tab.
- TTS support.
- FAQ on the home page.

### Fixed

- Fresh installs and client builds no longer fail with `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` because the shared package now builds from root entrypoints instead of the client package's nested `predev` and `prebuild` hooks.
- The lite container release workflow now inspects the correct `-lite` image tag instead of the nonexistent `*-lite-lite` tag, so tagged lite image publishing completes successfully again.
- Fixed sidecar startup state and enabled logs for Ollama to see what's going on.
- You can now use tab when writing lorebook entries.
- Some image generation endpoints.
- Clicking roleplay image attachments now opens them in Marinara's in-app lightbox instead of a new browser tab.
- Auto-play in game mode now pauses when you're reading a note, a book, or doing a QTE event.
- Opening a conversation no longer resets the autonomous-message inactivity timers just because the message history finished loading.
- OpenAI-compatible connections no longer send reasoning payloads to models that do not support them.
- Selfies and sprite generation no longer force a character avatar as a hidden reference image by default.
- Explicitly adding or editing an agent no longer persists it as globally disabled.
- Memory recall now stays inside a dedicated prompt budget before injection, preventing recalled history from crowding out agent and thinking context.
- Exporting a modified character to PNG no longer reuses stale embedded card metadata from the avatar image.
- Sprites get displayed automatically when you add Expression Engine to your chat, and their setup was moved to the Agents section of Chat Settings.
- More ComfyUI fixes.
- Group chats' inconsistent injections: now, upon regenerations, the model knows who should respond.
- Game mode scene-wrap now only sends the current party's character names instead of the entire imported character library, preventing large libraries from tripping the 100-name limit.
- Professor Mari now has access to all the fields in character cards/personas/lorebooks/etc. and can correctly split info into them.
- The Windows installer now downloads Git from a valid prerequisite URL again instead of failing the autodownload step with a missing PowerShell `-Uri` argument.
- Mobile UI fixes for Game mode.
- Increased the output size to 16384 tokens on the new Game setup generation to prevent malformed JSON errors.
- Decreased padding for text in boxes in the Glued Side Panel avatars option.
- Edit Sheet in Game mode black screen bug.
- CYOA choices can now be edited.
- UI fixes.
- Lorebook entries now don't stay active after they've been activated once, and the lorebooks respect the token limits of how many active entries there may be at once.
- Custom widgets now may change between sessions.
- No more looping music/ambiance in Game mode.
- If a provider accepts a smaller context size than the overall model allows, we now automatically reduce the output size to match the allowed size.

## [1.5.4]

### Added

- An option to control when the Narrative Director triggers to prevent rushing.
- Every time you add an agent to a chat, you now see a window with its description and setup.
- Macros support for {{user}} and {{char}} in Game mode.
- Added translation support to the Game mode.
- You can now address the GM directly in the Game mode.
- Refresh cache button in Advanced Settings.

### Fixed

- OpenAI endpoint now correctly re-routes all GPT-5.4 models via Responses API.
- Strengthened the regex to catch incorrect formatting of the messages in Conversations mode.
- Restored the slight delay on receiving multi-line messages in Conversations mode.
- Fixed mobile side displays of dialogues in Game mode.
- Game mode incorrect starting narration.
- ComfyUI generation for sprites and default workflow fixes.
- Removed a bugged new chat creation from Manage Chat Files.
- Bold dialogue formatting now supports Chinese and Japanese quotation marks.
- Strengthened commands in Conversations mode.
- Various mobile UI fixes.
- Scenes cannot be branched anymore (that broke them).
- Sprite generation triggering on unsupported platforms.
- Cross-awareness with game mode.
- Clicking on new conversation notifications while in Game mode now takes you to the Conversations correctly.
- All GLM models now correctly receive only the `enable_thinking` parameter with `false/true` depending on whether you chose reasoning to be `None` or any other.
- Improved Lorebook Keeper agent.
- QTE in Game mode fix.

## [1.5.3]

### Added

- Character galleries for storing reference images directly on a character instead of a specific chat.
- Conversation mode swipe controls.
- An option to delete a selected swipe instead of the entire message.
- Prompt caching support and cache hit/write visibility for OpenRouter Claude connections.
- Recommended models for the first Game generation.
- A setting to disable bold dialogue formatting while keeping dialogue colors.
- Custom parameters setup for initial Game mode generation.
- Instant display of messages in game mode.
- Discord Mirror for all chatting modes.
- No more "Preset Variables" pop-up on presets without them.

### Fixed

- We no longer use browser pop-up windows, so the users won't accidentally permanently dismiss them.
- Various setup fixes, including Docker runtime libraries and launcher/installer build steps.
- Decreased text padding in Roleplay mode inside the message box area.
- Session recordings can now be accessed.
- Addressed Drizzle errors.
- Impersonate direction is now properly sent to the model.
- Inventory is now saved and stored between game sessions.
- We now apply the correct headers for official Anthropic calls.
- Multi-line messages no longer collapse after editing in Conversations.
- Character schedules now use your local timezone when generating.
- Dialogue highlight colors now keep working even when bold dialogue is turned off.
- Marinara landing-screen effects now stop rendering when they are off-screen, and they stay paused while the tab is inactive.
- Text renders in HD.
- We correctly catch Gemma-4's thinking tag.
- Audio docker fix.
- Selecting a new location in the Game mode now doesn't automatically transport you there.
- Party-only Game turns no longer commit staged travel.
- Game Discord Mirror now carries narrator labels across regular turns and new-session recaps.
- Game chat parameter changes now override setup-time defaults after the game has already been created.

## [1.5.2]

### Added

- General settings now include a persisted app-language selector at the top of the tab. It currently exposes only English and is ready for future translation PRs to extend it.
- Added a new option to display character/persona avatars in the Roleplay mode (as a side panel, bigger size). Access it in the Appearance Settings.
- NanoGPT support and improved image connection handling.
- Added a macOS Apple Silicon-only MLX backend for the local sidecar.
- Support for running different local models.

### Fixed

- Installed Windows desktop and Start Menu shortcuts now launch Marinara Engine with the correct working directory, so packaged installs no longer open and close immediately.
- Windows installers and launchers now force the repo-pinned pnpm version through Corepack when available, so older global pnpm installs no longer break setup, and the batch installer restores the Marinara icon on the desktop shortcut.
- Conversation mode no longer forces OpenAI-compatible backends like NovelAI onto the non-streaming transport path, preventing immediate cancellations while keeping complete-message rendering in the UI.
- Character maker, persona maker, lorebook maker, prompt review, retry-agents, game setup, and other system tasks now obey the global Streaming Responses toggle instead of silently forcing streamed transport.
- Image Generation connections can now keep ComfyUI selected on non-default hosts and ports, so remote ComfyUI servers still expose checkpoint fetching and custom workflow JSON.
- Connection max-context limits now trim oversized prompts before generation, and prompt inspection shows the fitted prompt that was actually sent upstream.
- OpenRouter connection provider preferences now carry through agent runs, game setup, GM/tool generations, and other helper flows instead of falling back to Auto router outside the main chat path.
- Inline reasoning blocks wrapped in `<thought>...</thought>` or `<|think|>...<|/think|>` are now extracted into stored message thoughts, and game-mode JSON helpers strip those blocks before parsing model output.
- Glued Side Panel roleplay avatars now fade and blur out more aggressively at the bottom so they merge into the message bubble instead of ending abruptly.
- Clean installs no longer warn that pnpm ignored build scripts for `onnxruntime-node` and `protobufjs`, so Windows users do not need to run `pnpm approve-builds` or patch `package.json` by hand.
- Added the no split mode flag to prevent the looping crash of Gemma-4 on multiple GPU systems.
- Tracker agents can now use the built-in local sidecar through the normal Connection Override dropdown, and the Local Model card now provides a bulk action to point every built-in tracker at the local model.
- Fixed new game mode sessions not starting after the last one concluded.

## [1.5.1]

### Added

- Display of the time of the day in the game mode.
- Custom game widgets can be moved around.

### Changed

- Removed the Quests tab from Game Mode. Game sessions deliberately do not use tracker agents for quests, so the journal now focuses on the code-driven data it actually maintains to avoid excessive generations.

### Fixed

- Returning to an active game session no longer reopens the full-screen world overview and blocks the current scene behind the black intro overlay.
- Combat encounters now wait until narration and scene presentation finish before opening, and HUD widgets hide during combat and restore correctly afterward.
- Loot drops now resolve to the correct item names instead of malformed combat-drop payloads.
- Constant lorebook entries selected for Game Mode are now injected during world generation instead of being skipped during setup.
- Non-English setup languages now propagate through setup generation and GM output formatting, so game text stays in the selected language.
- `/game/setup` now streams upstream tokens during first-turn world generation, reducing timeout failures on slower local backends.
- Map discoveries and NPC meetings now populate the journal from code-owned game state. Locations appear when discovered, and NPCs are logged when first met instead of only after a reputation change.
- Our built-in Gemma-4 will now target available GPUs during generations.
- Fixed Gemma-4 issues on Windows.
- We now only install llama-cpp if you choose to host Gemma-4.

## [1.5.0]

### Added

- Introducing the new **Game Mode**! A cross between a classic roleplay and a visual novel, fully driven by the AI GM! Embark on adventures either solo or with a party of characters of your choice. Or perhaps have one of your characters DM the game for you and others? The games span multiple sessions, and _anything_ can happen. The sky is the limit. Well, I guess your wallet, too.
  - Follow an easy and quick game setup wizard to customize your game, or ask the model to come up with the ideas for you.
  - The game's UI is a cross between RPGs (think Baldur's Gate) and visual novels. Witness dynamically changing dialogues, backgrounds, sprites, ambiance, music, sounds, and weather; all based on your current scene. The mode supports sprites and will show them with different expressions. You have an item inventory, an automatically updated journal storing information about your adventure, and an option to talk to your party whenever you feel like simply chatting with them instead of progressing.
  - Your party, and you, all have unique character cards, secrets, and goals to achieve. Remember to keep morale high.
  - Do dice rolls yourself or let the GM handle those for you.
  - Play with the interactive widgets, travel to different locations via a map, build a reputation with NPCs and factions, and explore a dynamically changing world.
  - Everything is handled on the backend. You just sit back, relax, and enjoy the experience.
  - Seriously, just try it. It's fun. I put a lot of time and effort into it, so you'd better enjoy it, or I'll explode.
- Automated sprite generation for expressions and full-body poses in character cards. These can be used for both roleplay and game modes.
- Saved presets for starting new roleplays and conversations.
- Option to save parameters (samplers) per connection.
- Select, duplicate, and manage multiple chats/characters/lorebooks/personas/etc. at once.
- More filters to sort by in lorebooks, and added an ability to lock entries from being edited by agents.
- You may now generate images based on the chat anytime by pressing the "Illustrate" button in the Gallery.
- Spellbooks were added as a separate lorebook category, used in combat.
- Added an ability to download and use Gemma-4-E2B, a tiny model that can be run even on mobile devices and can handle trackers in roleplays and scene analysis for the game mode.
- Other minor things I probably forgot about, have fun discovering them on your own.

### Fixed

- Expression Engine fix that prevented sprites from being generated.
- Messages will no longer disappear and reappear only upon page refresh.
- Scenes created out of conversations now inherit all the parameters from their original chat.
- Fixed a "niche advanced parameter bug", if you know, you know.
- Added full markdown support for roleplays.
- Various Termux/iPhone native fixes for both installation and UI.
- Text formatting with asterisks is now fixed.
- Bettered image generation support.
- Lorebook entries not working in scenes.
- Numbered lists now display correctly.
- You can now select a folder where your backup will be saved.
- No more random scroll-ups when editing lorebooks.
- Additional minor fixes that I can't be bothered enough to list, I want a break.

## [1.4.8]

### Added

- Added `pnpm check`, version-sync helpers, and PR CI checks for version drift.
- Added tracked-installer and release-note scripts plus a GitHub release workflow driven by `CHANGELOG.md`.

### Changed

- Startup config now resolves `.env` before env-sensitive server modules, normalizes repo-root data and SQLite paths, and keeps `/api/*` 404s JSON-only.
- Shell launchers now align on the resolved `PORT`, honor launcher-level browser auto-open consistently, and pin pnpm to the repo version.
- Android now uses a build-time WebView server URL constant instead of a hardcoded Java literal, with optional `MARINARA_PORT` support in `android/build-apk.sh`.
- The client app shell now lazy-loads editors, right-panel surfaces, onboarding, modals, and the main chat surface to reduce initial bundle weight.

### Fixed

- **Vanishing messages after generation** — Messages could disappear at the end of streaming in Roleplay mode due to the browser and service worker serving stale cached API responses. Added triple-layer cache busting (server `Cache-Control: no-store`, client `cache: "no-store"`, and Workbox `NetworkOnly` for API routes) and hardened the streaming-to-message transition with retry-on-failure and double-rAF React commit timing.
- **Agent deletion foreign key constraint** — Deleting an agent no longer fails when chat history references its characters.
- **Mode switch caching** — Switching between Conversation and Roleplay mode now correctly invalidates the cached chat data.
- **Update system** — The in-app update check and notification flow now works reliably.
- `CORS_ORIGINS=*` now behaves as explicit allow-all without credentials, while explicit origin lists retain credentialed CORS support.
- GIF search no longer falls back to a shared embedded API key when `GIPHY_API_KEY` is unset.
- Sidebar tab text metrics were made explicit so descenders like the `y` in `Roleplay` no longer clip.
- Default log level changed to `warn` to reduce console noise.
- Cross-post redirect handling corrected.
- Restored local data-path compatibility so existing installs continue to resolve storage under `packages/server/data`.
- Update checks now resolve the newest GitHub `v*` tag even when `releases/latest` is stale.

## [1.4.7]

### Added

- **Persona Groups** — Organize personas into named groups with full CRUD backend and SQLite storage.
- **Group Scenario Override** — Replace individual character scenarios with a single shared scenario for group chats.
- **AI Persona Maker** — Generate complete personas from a prompt using your LLM connection via SSE streaming.
- **Import Persona** — Import personas from PNG character cards or JSON files.
- **Quick Connection & Persona Switchers** — Floating popover switchers anchored to the chat input.
- **Notification Bubbles** — Floating avatar notification bubbles for unread messages in background chats.

### Changed

- **Personas Panel Redesign** — Search, sort, active/inactive filter, plus New, Import, and AI Maker action buttons.
- **Quick Switcher Vertical Alignment** — Desktop quick switchers anchor to the input box container's top border.
- **Conversation Edit Simplification** — Removed keyboard shortcuts from message editing; explicit cancel/save buttons only.
- **Blank Line Collapsing** — Runs of 3+ consecutive newlines collapsed to a double newline.
- **OpenRouter Thinking/Content Block Parsing** — Correctly parses thinking and content blocks from reasoning models.
- **Claude 4.5/4.6 Temperature-Only Sampling** — Omits `top_p` for Claude models that only support temperature.

### Fixed

- Fixed quick switcher flash at (0,0) on mount.
- Fixed notification bubbles not triggering from normal generation path.
- Fixed notification character ID parsing (JSON string now properly parsed).
- Fixed empty conversation response guard.
- Fixed memory recall scoping.
- Fixed Lorebook Keeper scoping.
- Fixed missing `persona_groups` DB migration.

## [1.4.6]

### Added

- **Bot Browser** — Browse, search, and one-click import characters from Chub.ai directly inside the app. Includes paginated grid view, sort by downloads, stars, or trending, an NSFW filter toggle, and full character detail previews.
- **Chat Folders** — Organize chats into named, color-coded folders with drag-and-drop reorder. Move chats between folders, collapse or expand them, and filter by mode. State is persisted server-side.
- **Slash Commands** — Added SillyTavern-style commands with autocomplete, including `/roll`, `/sys`, `/narrator`, `/continue`, `/as <character>`, `/impersonate`, `/remind <time> <message>`, `/random`, `/scene`, and `/help`.
- **AI Lorebook Maker** — Generate structured lorebook entries from a topic prompt using your LLM connection, with SSE streaming, batch support, and attach-to-existing-lorebook support.
- **Connection Duplicate & Test** — Clone existing connections, including encrypted API keys, and test connectivity with provider-specific checks.
- **ComfyUI Custom Workflows** — Paste custom workflow JSON with `%prompt%`, `%negative_prompt%`, `%width%`, `%height%`, `%seed%`, and `%model%` placeholders.
- **OpenRouter Provider Preference** — Select a preferred upstream provider when routing through OpenRouter.
- **Expanded Image Generation** — Added Pollinations, Stability AI, Together AI, NovelAI, ComfyUI, and AUTOMATIC1111 / SD Web UI alongside OpenAI-compatible image generation.
- **Plain Text Chat Export** — Export chat history as readable plain text alongside the existing JSONL format.
- **Embedding Base URL** — Configure a per-connection base URL for embedding endpoints.

### Changed

- **Performance — Streaming Re-render Optimization** — Extracted streaming UI into isolated components so the main chat area no longer re-renders on every streamed token.
- **Performance — Zustand Selector Batching** — Combined UI store selectors with shallow comparison and memoized style objects to reduce unnecessary re-renders.
- **Performance — Debounced UI Persistence** — Debounced `localStorage` writes and added unload or visibility flushes to reduce churn without losing data.
- **Chat Text Appearance** — Unified chat text color under a single setting and set the default text stroke width to `0.5px`.
- **Folder UX** — New folders now appear at the top, render above unfiled chats, and support inline rename plus hover-delete affordances.
- **Roleplay Input Responsiveness** — Tightened responsive spacing and flex behavior in the input bar to prevent overflow.
- **Home Page Mobile Layout** — Reduced mobile padding, constrained content width, and improved QuickStart card responsiveness.
- **Tracker Injection Order** — Tracker data now injects before Output Format for correct prompt ordering.
- **Settings Panel Polish** — Renamed reset actions to "Reset to default", removed redundant labels, and consolidated reset behavior.

### Fixed

- **Infinite re-render loop** — Wrapped the combined Zustand selector in `useShallow()` so `memo()` can short-circuit correctly.
- **Message background opacity** — Corrected roleplay bubble colors to match the intended Tailwind neutral palette.
- **New folders appearing at the bottom** — Fixed both the server-side sort order assignment and the client-side render ordering.
- **Missing DB column migrations** — Added `openrouter_provider`, `comfyui_workflow`, and `embedding_base_url` to startup column migrations.
- **Combat encounter `parseJSON`** — Corrected escape-sequence handling and added multi-stage sanitization for AI responses.
- **Additional fixes and polish** — Includes smaller bug fixes that shipped as part of the same release.
