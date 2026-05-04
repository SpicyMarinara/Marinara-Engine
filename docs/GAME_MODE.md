# Game Mode — Getting Started

Game Mode is one of Marinara Engine's chat modes, alongside Conversation, Roleplay, and Visual Novel. Where Conversation is a Discord-style DM with a single character and Roleplay drops you into an immersive scene with sprites and backgrounds, Game Mode runs a full singleplayer RPG: an AI Game Master narrates the world, NPCs, and combat; your party of characters takes actions; and the engine tracks state across sessions (map, NPCs, quests, weather, in-world time).

This guide is a getting-started reference. It covers how Game Mode works under the hood, how to fill out the setup wizard, what makes a good GM character card, what models and settings tend to give the best experience, and how to fix the most common failures. If you're brand new and just want to start a game, jump to [Setting up a game](#setting-up-a-game).

**What this guide does not cover:** deep in-game combat mechanics, NPC and party management during play, save/resume behavior, regenerating a world after world-gen, and other advanced workflows. Ask in the Marinara Discord (or open a GitHub issue) for help with those for now.

## Is Game Mode right for you?

Game Mode delivers the most when you have:

- **A capable model on a paid connection.** Free-tier routing typically can't handle world-gen reliably (see [Recommended models](#recommended-models)).
- **A working Image Generation connection, or willingness to pay for one.** The layout is designed around having visuals (see [Image Generation](#image-generation)).
- **An interest in playing through a story with persistent world state** — the engine tracks characters, NPCs, locations, time, weather, and quests across turns. You don't have to engage with every RPG mechanic; some users skip combat and dice entirely and use Game Mode for narrative-driven, visual-novel-style play. The structural elements are available when you want them.

If the first two don't apply — you're on a free or slow connection, or you don't want to run image generation — Marinara's other modes (Conversation or Roleplay) may be a better fit. You can always come back to Game Mode later when your setup matches what it's optimized for.

## How Game Mode works

Game Mode runs in two distinct phases.

### Phase 1: World generation (one big call)

When you finish the setup wizard and click **Start**, the engine sends one large prompt to your selected GM connection and asks the model to return a structured JSON document containing:

- **World overview** — 2–3 paragraphs of narrative setting, shown to you in-game
- **Story arc** and **plot twists** — secret narrative beats the GM keeps to itself
- **Starting map** — a node graph of regions you can travel between, with discovery state and connections
- **Starting NPCs** — characters with roles, descriptions, locations, and reputation values
- **Party arcs** — a personal quest hook for each party member
- **Game-specific character sheets** — class, abilities, strengths, and weaknesses for every party character
- **Art style prompt** — a unified visual style (20–40 words) used for any images generated later
- **HUD blueprint** — up to four widgets (gauges, counters, timers, stat blocks, etc.) plus a visual theme

If the model fails to return valid JSON or skips required fields, world-gen fails with a 422 error and you can retry. **This is the most demanding step in Game Mode** — it's why model choice matters most here. See [Recommended models](#recommended-models) below.

### Phase 2: Gameplay (turn by turn)

Once the world is generated, each turn assembles a fresh prompt that includes:

- The current game state (exploration, dialogue, combat, travel/rest)
- Story arc and plot twists (visible to GM only)
- Map, party position, and discovered locations
- NPCs and their reputation values
- Session summaries from previous play sessions
- Full character cards for party members and your persona
- Genre, setting, tone, difficulty, and language preferences
- Current in-world time (e.g. "Day 3, 14:30") and weather
- Encounter hints when combat triggers
- Player notes / journal
- HUD widget state
- Content rating (SFW / NSFW)

The model returns narration, dialogue, scene description, and any state changes (combat results, map updates, NPC reactions). If you have **Scene Analysis** or **Image Generation** enabled, those run on a separate sidecar connection afterward to add backgrounds, music, sprite expressions, and HUD widget updates — see [Optional toggles](#optional-toggles).

Because the prompt assembled per turn is rich, Game Mode handles long-term coherence reasonably well. It also means you're paying for a lot of context per call, so a model that handles long context cleanly is a better fit than one that doesn't.

### Sessions: ending and starting new ones

Within a single Game Mode game, you can play across multiple **sessions** — long-running play threads similar to how a tabletop group might split a campaign across multiple play nights. Sessions have explicit lifecycle hooks that are neither normal gameplay turns nor world-gen, but a third kind of LLM call:

**Ending a session** is triggered either by you clicking **End Session** or by the GM emitting an `[session_end: reason="..."]` tag inline when narrative warrants it. The engine runs a single LLM call to your GM connection that's structurally distinct from a gameplay turn:

- Lower temperature (`0.45` vs. `~1.0` for gameplay) — more deterministic structured output
- Input: the full session transcript plus the journal and current game state
- Output: a JSON payload with three top-level sections
  - **`summary`** — structured continuity data, including the narrative recap (a nested `summary` field) and the `resumePoint` for the next session, plus categorized continuity fields (party dynamics, party state, key discoveries, character moments, little details, NPC updates, and a stats snapshot containing party morale and inventory)
  - **`campaignProgression`** — updates to the overarching campaign: `storyArc`, `plotTwists`, and `partyArcs`. Only refreshed if the session materially advanced them; otherwise carried forward unchanged
  - **`characterCards`** — the full updated party character cards. Changes are conservative — class evolution, new abilities, stat bumps of ±1–3 per session — only when session events justify them

This is closer to world-gen in shape (structured JSON output) than to a gameplay turn, but it operates on existing state instead of generating from scratch. The resulting summary becomes part of every subsequent session's prompt context (it's what shows up under "session summaries from previous play sessions" in [Phase 2](#phase-2-gameplay-turn-by-turn)).

**Starting a new session** happens when you click **New Session** on a concluded game. The engine:

- Creates a new chat numbered sequentially (Session 2, Session 3, etc.) forked from the previous session
- Runs an LLM call to generate a **recap message** anchored on the previous session's `resumePoint`
- Carries forward the game state — map, NPCs, party, quests, time, weather, journal
- Posts the recap as the new session's first message

The recap call is also distinct from a gameplay turn — its job is purely to bridge two narratives. It's smaller in scope than session-end's structured update.

In summary:

- **Gameplay turns** = ongoing narration, lots of state injected, narrative output
- **End Session** = retrospective JSON summary + state updates (closer to world-gen in structure, operates on existing state)
- **Start Session** = bridging recap that anchors the next session on the resumePoint

The lifecycle is designed so you can run long-running games across multiple play sessions without overwhelming the model's context window — older session details get compressed into summaries, and only the most recent narrative stays in full fidelity.

## Setting up a game

The setup wizard has four steps: **Genre & Setting**, **Party & GM**, **You & Model**, and **Goals**. The only field that is strictly required is the GM connection (model) — everything else has a sensible default, so if you just want to test the mode you can blow through the wizard with most fields blank and Marinara will infer reasonable values. The fields below are the ones that actually steer your game.

### Genre

Multi-select from a fixed list (Fantasy, Sci-Fi, Horror, Modern, Post-Apocalyptic, Cyberpunk, Steampunk, Historical) plus a free-form custom input. Default: `Fantasy`.

Combinations work — the wizard joins your selected genres into a single comma-separated string passed to the model, so `["Fantasy", "Horror"]` becomes `"Fantasy, Horror"` in the prompt. Different blends suggest different aesthetics, but the actual result depends heavily on Tone, Setting, and model choice. Stacking many genres asks the model to weave together more sets of conventions; if a multi-genre setup produces muddled-feeling output, narrowing the list and steering aesthetic via Setting or Additional Preferences usually helps more than adding still more genres.

### Setting

Free-text. One sentence describing where this world lives. The wizard shows clickable suggestion chips beneath the input — `Surprise me!`, `A war-torn kingdom with ancient ruins`, `A neon-lit city of hackers and megacorps`, `A cursed forest hiding a forgotten god` — that fill the field for you. Clicking **Surprise me!** sets the field to `Surprise me, go wild!`, which tells the model to invent the setting itself.

If you leave it blank, the engine falls back to a generic placeholder like `A fantasy world`, which gives the model very little to work with.

Best practice: anchor the world with one defining detail. `A flooded post-apocalyptic Earth where the only safe ground is the ruins of skyscraper rooftops` gives the model 100x more to work with than `post-apocalyptic`.

### Tone

Multi-select from Heroic, Dark, Comedic, Gritty, Whimsical, Serious, Campy, plus custom input. Default: `Heroic`.

Tone sets the emotional register. It compounds with model choice — some models lean cheerful regardless of tone, while others swing the other way. (As of mid-2026, GLM5 in particular trends toward player-positive narration even when "Dark" is selected, and will sometimes narrate around bad dice rolls.) If you want a dark game and your model isn't delivering, layer that in **Additional Preferences** as well.

### Difficulty

Single-select: Casual, Normal, Hard, Brutal. Default: `Normal`.

Affects how punishing combat and consequences feel. Brutal will let your character die. Casual narrates around bad outcomes more readily. Normal sits in the middle.

### Player Goals

Free-text, optional. Like the Setting field, the wizard shows clickable suggestions beneath the input — `Surprise me!`, `Find the lost artifact`, `Survive and uncover the truth`, `Become the ruler of the land`. Clicking **Surprise me!** sets the field to `Surprise me, go wild!` and lets the model invent your goals. If you leave it blank, the engine falls back to `Have an adventure`.

A short paragraph beats a single bullet here. `Find my missing sister and uncover what the inquisition is hiding` gives the GM something concrete to weave into the story arc and plot twists. `Have fun` gives it nothing and you'll get a generic adventure.

### Additional Preferences

Free-text, optional. Use this for anything that doesn't fit the structured fields:

- Content limits — `no graphic violence against children`
- Tropes you want included — `at least one heist sequence; one major betrayal`
- Tropes you want banned — `no resurrection magic, deaths are permanent`
- Pacing notes — `slow burn — let me explore towns before any major plot beats`
- Specific NPCs or factions you want seeded — `there is a rival adventuring party led by a noble named Cassia who keeps showing up at the worst times`

This is also where to override model tendencies. If your tone is Dark but the model keeps narrating cheerfully, add `keep narration grim, do not soften failures or character pain`.

### Rating

Single-select: SFW or NSFW. Default: `SFW`.

Gates whether explicit content is allowed in narration and dialogue. Setting this to NSFW does not force NSFW content — it just permits it.

### Game Language

Dropdown of 10 supported languages: English, Japanese, Korean, Chinese, Spanish, French, German, Polish, Portuguese, Russian. Default: `English`.

All in-game text — narration, dialogue, NPC names, journal entries — is generated in the selected language.

## Using lorebooks for richer world setup

The wizard's **Party & GM** step lets you attach one or more lorebooks to your game. This is a powerful complement to the entry fields above when you want to play in a specific established setting — your own homebrew world, a fan adaptation, a setting you've built up across previous campaigns — and giving the GM a paragraph in **Setting** isn't enough.

### How it works during world-gen

When you click Start, the engine pulls the **constant** entries from your attached lorebooks and feeds them to the model as canonical facts. The setup prompt wraps them with the instruction `Selected constant lorebook canon that MUST be treated as true for this world`. The model uses them when generating the world overview, story arc, NPCs, plot twists, and starting map.

Only constant entries fire during world-gen because there's no chat text yet for keyword triggers to match against. Keyword-triggered entries activate later, during gameplay turns, once player input contains their trigger words.

### Practical tips

- For world-gen, only mark entries as **constant** if you want them baked into the initial world. Trigger-only entries won't fire until gameplay starts.
- Keep the constant set lean. Constant entries add to your context budget on every world-gen call and every gameplay turn. Major setting facts, key locations, recurring factions: yes. Every minor NPC and item: probably no — let those trigger by name during gameplay.
- You can use Claude or another LLM to draft a lorebook from existing source material — paste in a wiki page or your campaign notes and ask for structured entries with sensible keywords. This is currently one of the fastest ways to bootstrap a rich setting.

## Playing the game

Once setup completes, you'll be in the gameplay UI. A couple of input controls are worth knowing about up front because they aren't obvious.

### Address modes: who you're talking to

The input bar has a small chat-bubble icon (next to the dice button) that toggles **who your message is addressed to**. Three modes:

- **Scene** (default) — your message becomes a normal in-game action or dialogue line. The GM and party respond.
- **Talk to Party** — prefixes your message with `[To the party]` and routes the response through the **Party Players agent**, which speaks as your party members. Useful for tactical conferences ("OK team, what should we do here?") or in-character conversation between you and your party. Only available when your party isn't empty.
- **Talk to GM** — prefixes your message with `[To the GM]`. The GM responds out-of-character. Useful for asking clarifying questions ("does my character know about the temple?"), requesting pacing changes ("can we slow down this scene?"), or seeding something into the world.

The active mode is color-coded — sky for party, amber for GM. Toggle once to enter a non-default mode; toggle again to return to Scene.

### Rolling dice

The 🎲 button in the input bar opens a quick-dice menu. Eight preset notations are one click away: `d20`, `d6`, `2d6`, `d10`, `d100`, `d4`, `d8`, `d12`. You can also type custom notation like `3d8+2` and add it.

A picked roll is **queued** rather than sent immediately — a badge appears in the input bar showing the queued roll. When you send your next message, the roll is resolved server-side first (standard JavaScript PRNG, fresh per roll), the result is appended to your message as `[dice: 2d6 = 9 (4,5)]`, and the GM treats it as canonical truth. The GM is explicitly instructed not to recalculate or contradict the result.

## GM character

The **Party & GM** step in the wizard lets you pick one of two **GM modes**:

- **Standalone** (default): Marinara assembles a synthetic GM persona from your setup. The system prompt tells the model to act as "an excellent Game Master, fair but challenging (and a little snarky)" and lets it bring its own voice within those rails. No card required.
- **Character**: pick one of your existing character cards as the GM. The engine wraps the card with a "you are this character, acting as a Game Master" instruction so the model adopts the character's voice while still running the game.

If this is your first Game Mode session, **use Standalone.** It's the default for a reason — there's nothing to author, the model's GM behavior is consistent with what the engine expects, and you get to feel out how Game Mode plays before investing in a custom GM persona.

### When to use a character GM

Pick character mode when you have a specific narrator voice in mind — a sarcastic AI dungeon master, an in-world chronicler, a sentient grimoire, etc. The card overrides the default snarky-GM voice with its own personality and biases.

### What makes a good GM card

The Marinara community hasn't published a definitive guide on this, so the following is best-practice synthesis grounded in how the engine actually wires the card into the prompt:

- **The card sets _voice and persona_, not narrative content.** World-gen already supplies world-building, story arc, plot twists, NPC roster, and party arcs. The card tells the model *how* the GM speaks and reacts — not what story to run.
- **`description` and `personality` matter most.** These set the cadence and biases the GM brings to narration. A short, vivid description outperforms a long lore dump.
- **`mes_example` is a trap if you're not careful.** Most chat cards include examples of the character speaking *as themselves, one-on-one with a user*. In GM mode, that pulls the model toward "be that character in a chat" rather than "narrate a world as that character." If you author `mes_example` for a GM card, show the character *narrating scenes, describing places, reacting to player actions, calling for what the player does next* — not having an intimate one-on-one conversation.
- **Avoid hardcoded scenarios in the `scenario` or system-prompt fields.** World-gen will produce its own setting. A GM card with a baked-in scenario fights the engine instead of complementing it.
- **Model choice still dominates tone.** A card written for a grim narrator paired with a player-positive model will still narrate cheerfully. Plan to compensate via Additional Preferences or pick a model whose tendencies match the card.

The engine doesn't ship a default or example GM card, and the community hasn't published a canonical one yet. Your starting point is either your existing character library or a fresh card built from scratch. **If you've authored a GM card you're happy with, share it in the Marinara Discord** — we'd like to link or include community-validated examples here in a future revision.

## Party characters

The wizard's **Party & GM** step also lets you pick one or more characters from your library as your party — the companions who travel with you and act under the GM's narrative jurisdiction during scenes. Each party slot expects **one character per card**.

### What works well as a party card

- A standard character card with **name, description, personality, and a clear voice**. The same fields you'd use for a Roleplay or Conversation card work here.
- **One character per card.** Even if your library has a "complete adventuring party" written as a single card, the engine treats that whole card as one entity — the Party Players agent wraps each card in a single `<party_member>` block, so a multi-character card gets lumped together and loses individual voice. Split compound cards into individual character cards before adding them to a party.
- Cards that capture *how the character speaks and reacts* more than ones full of plot lore. World-gen produces its own world and story; the card brings the party member's voice to it.

### Persona cards

Your **persona** — the character you yourself play, picked in the **You & Model** step — is treated as a distinct slot in the prompt. The engine separates `personaCard` (who you are) from `partyCards` (who you're with). Don't put your own character in the party slot, and don't pick a party member as your persona — they're routed differently in the prompt and you'll end up confusing the model.

## Recommended models

Game Mode is more demanding than Conversation or Roleplay because of world-gen: one large strict-JSON response that has to populate ten or so keys (map, NPCs, story arc, party arcs, HUD blueprint, etc.) without skipping fields or producing invalid JSON. A model that handles regular roleplay fine can still fail world-gen.

**For world-gen, use a top-tier model.** As of mid-2026, the providers/tiers most commonly reported as reliable for this step are:

- **Anthropic** — Claude Opus or Claude Sonnet (current generation)
- **OpenAI** — GPT-4 class (GPT-4o, GPT-5)
- **Google** — Gemini Pro (current generation)

**For ongoing gameplay turns,** you can sometimes drop a tier if cost matters — the per-turn prompt is rich but the model isn't being asked for strict JSON, just narration and state changes. Mid-tier models (Claude Haiku, GPT-4 mini, Gemini Flash) may hold up; results depend on how long your campaigns run and how much continuity matters to you. If you notice the GM forgetting NPCs, contradicting earlier world details, or dropping plot threads, bump the model back up.

**Avoid for world-gen:**

- **The default `OpenRouter Free` connection** that Marinara auto-seeds for new installs. It uses model `openrouter/free`, which routes among free-tier models (typically smaller / older) that cannot reliably produce world-gen JSON. If this is your only connection, world-gen will fail repeatedly. Either configure a paid connection for the GM model or pin a specific capable model on your OpenRouter connection.
- **OpenRouter `openrouter/auto`** — same problem. Routes to whichever model OpenRouter currently designates as the default, which may not be capable of strict JSON. Pin a specific model.
- **Smaller open-weight models** (roughly 7B–13B parameters) — typically cannot complete world-gen JSON reliably.

**Per-model behavior notes:**

- **Opus** tends toward dramatic openings (`In the year of our forsaken reckoning...`). If that bothers you, prompt against it in Additional Preferences.
- **GLM5** trends toward player-positive narration regardless of Tone (see [Tone](#tone) above).

## Generation parameters

Game Mode uses Marinara's shared generation parameter system. See [Generation Parameters](GENERATION_PARAMETERS.md) for the full defaults table, tuning advice, and per-backend gotchas (Claude `temperature`/`topP` conflict, Claude thinking mode, OpenRouter caveats).

For Game Mode specifically, raise `maxTokens` to at least `10000` if world-gen JSON gets truncated — the structured output is large.

## Optional toggles

Two extras live in **Chat Settings** for an active game (open via the settings icon during play).

### Scene Analysis

Post-processes each GM turn through a separate **sidecar connection** that produces:

- Background image prompts (passed to the Image Generation connection)
- Music / audio cue suggestions
- Sprite expression updates for NPCs in scene
- HUD widget state updates, when widgets were defined in the world-gen blueprint

The sidecar prompt is **not** seen by the main GM model, and the main GM does **not** see what the sidecar produces — they run in parallel pipelines. This means a small/fast model on the sidecar connection won't drag down main GM quality, and vice versa.

If you've downloaded Marinara's local sidecar model, you can route Scene Analysis through it (the wizard exposes a "use local" toggle for the scene model), avoiding API costs entirely.

**Known issue:** Google AI Studio has been reported to crash Scene Analysis on retry with `Cannot read properties of undefined (reading '0')`. If you hit this, switch the sidecar connection to a different provider.

### Image Generation

Generates NPC portraits, location backgrounds, and inventory imagery via your selected Image Generation connection (Stability AI, ComfyUI, AUTOMATIC1111, etc.). Uses the `artStylePrompt` from world-gen to keep visuals consistent within a game.

**Important: Game Mode's layout is designed around having visuals.** It uses a visual-novel-style presentation with backgrounds and sprite slots. With Image Generation off, you still get the narrative, state tracking, and combat mechanics — but the visual chrome that the layout was built around stays empty or placeholder. If you can't run Image Generation (no provider that supports it, or unwilling to pay for the per-turn image calls), it's worth knowing this up front so the empty visuals aren't a surprise. See also [Is Game Mode right for you?](#is-game-mode-right-for-you) above.

This toggle adds the most cost per turn — one or more image API calls each time the scene changes. If you do enable it, expect a meaningful per-session cost increase compared to running without.

## The `game-assets` folder

The engine stores game-related media in `packages/server/data/game-assets/` relative to your install. Subfolders are organized by category:

- `music/` — top-level categories `exploration`, `combat`, `dialogue`, `travel_rest`. Each category is further nested by genre (`fantasy`, `slice_of_life`, `horror`, etc.) and intensity (`calm`, `tense`, `intense`) — for example `music/combat/fantasy/intense/`. Legacy flat layouts from older installs are auto-migrated.
- `sfx/` — `ui`, `combat`, `exploration`
- `ambient/` — `nature`, `urban`, `interior`
- `sprites/` — `generic-fantasy`, `generic-scifi`
- `backgrounds/` — `fantasy`, `scifi`, `modern`, `illustrations`

A `manifest.json` is auto-generated on startup (and again whenever you upload). It maps tags like `backgrounds:fantasy:dark-forest` to specific files. The GM model receives a condensed tag list at generation time and references assets by tag.

You can upload custom files — including custom sprites — via the Game Assets upload endpoint or its Settings UI. An uploaded sprite tagged `sprites:generic-fantasy:custom-npc` becomes available for the engine to choose. Built-in assets take precedence on tag collisions; user uploads land under a `:user:` namespace.

Generated NPC portraits (when Image Generation is on) are stored separately under `data/avatars/npc/<chatId>/`, not in `game-assets/`.

## Troubleshooting

### How do I see what calls Game Mode is actually making?

Set `LOG_LEVEL=debug` in your `.env` file and restart the server. Marinara will log complete LLM prompts (every message role and content), full responses, token counts, generation timing, agent pipeline details, and game state patches. This is especially useful in Game Mode, where the per-turn prompt is large and assembled from many sources — debug logging is the only way to see exactly what context the model is receiving and how many tokens you're spending on each call.

Set it back to `warn` (the default) when you're done — debug output is high-volume and floods the terminal. See [Logging Levels](CONFIGURATION.md#logging-levels) for full details.

**Privacy note before sharing logs:** debug output contains your full prompts — character cards, persona content, lorebook entries, chat history, world-state, and any sensitive in-world material. Redact private content (NSFW, real-world identifiers, private campaign details) before posting logs in Discord, GitHub issues, or any public forum.

### World-gen fails immediately with a JSON / 422 error

Most common cause: the GM model can't produce the full structured JSON. Try in order:

1. Check what connection your GM model is using. If you're using the auto-seeded `OpenRouter Free` connection (which uses model `openrouter/free`), this is almost certainly your problem — free-tier routing usually can't handle world-gen. Switch to a top-tier model on a paid connection (see [Recommended models](#recommended-models)).
2. Retry. Some failures are transient — the same prompt works the second time.
3. If you're on `openrouter/auto` or any auto-routing model, switch to a pinned, capable model.
4. Shorten Setting and Additional Preferences if they are very long — large inputs leave less budget for the strict-JSON output.

### `Bad Request: temperature and top_p cannot both be specified`

Claude rejects simultaneous `temperature` and `topP`. In your GM connection's generation parameters, leave one of them unset (not at its default value — actually unset). Save and retry.

### Game Mode keeps narrating cheerfully despite Tone: Dark

Some models lean cheerful regardless of Tone (see [Tone](#tone)). Two options:

- Add an explicit override in **Additional Preferences** during setup, e.g. `keep narration grim, do not soften failures or character pain, narrate consequences of failed actions truthfully`.
- Switch to a model whose defaults align better with the tone you want.

### The GM forgets details from earlier sessions

Long campaigns put pressure on the model's context window. Per-turn prompts include compressed session summaries from previous play, but compression loses fidelity. Things to try:

- Use **Player Notes / Journal** to keep the most important continuity facts visible to the model on every turn.
- If you're starting a new game inspired by an earlier one, re-state the critical facts in **Additional Preferences** at setup.
- Bump to a model with a larger context window if you regularly run long campaigns.

### Scene Analysis crashes on Google AI Studio

Known issue. Switch the sidecar connection to a different provider, or route Scene Analysis through the local sidecar model if you have it downloaded.

### Game Mode shows fewer agent toggles than other modes

Intentional. Game Mode exposes only **Scene Analysis** and **Image Generation** in the settings drawer to keep the game's structured turn loop intact. The agents that drive the rest of Game Mode (game-master, party-player, world-state, quest, expression, combat) run automatically and are not user-toggleable.

---

## Found this confusing? Tell us

This guide will only get better with feedback. If something here didn't make sense, contradicted what you saw, or missed a question you actually had — [join the Discord](https://discord.com/invite/KdAkTg94ME) or [open a GitHub issue](https://github.com/Pasta-Devs/Marinara-Engine/issues). The most useful feedback is the specific kind: "I read X and still didn't know how to do Y."
