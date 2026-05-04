# Conversation Mode — Getting Started

Conversation Mode is one of Marinara Engine's chat modes, alongside Roleplay, Visual Novel, and Game. Where Game Mode runs a structured RPG and Roleplay drops you into an immersive scene with sprites and backgrounds, **Conversation is Discord-style DMs** — one or more characters, an input bar, and a message history. No GM, no scene chrome, no required mechanics. It's the lightest-weight mode and the one most users will spend the most time in.

This guide is a getting-started reference. It covers what Conversation Mode does, how to set up a chat, the difference between 1:1 and group chats, the Conversation-specific features (schedules, autonomous messages, character exchanges, selfies), how connected chats work, and what models and parameters tend to fit well.

**What this guide does not cover:** deep agent customization, regex scripts, branching/swipe internals (those work the same across modes), and the lorebook authoring UI itself (covered in the lorebook editor's in-app help). Ask in the Marinara Discord (or open a GitHub issue) for help with those.

## When to pick Conversation Mode

Use Conversation Mode when:

- You want to chat with a character the way you'd DM a friend — text in, text out, no scene state.
- You want to talk to **multiple characters at once** in one thread (group chats are part of Conversation Mode, not their own mode).
- You're on a **free or weaker connection** that struggles with structured-JSON outputs. Conversation is forgiving — most models that can chat at all can run a conversation.
- You want **autonomous behavior** — characters that send messages on their own, follow availability schedules, and react across time.

Pick Roleplay or Game Mode instead if you want immersive scene presentation (sprites, backgrounds), or structured RPG mechanics (party, quests, combat, world state).

## Setting up a chat

When you start a new Conversation chat, a Discord-style **quick-setup modal** appears. Unlike Roleplay's multi-step wizard, Conversation's setup is a single-screen panel that lets you configure the essentials and start chatting in seconds. You can also dismiss the modal and configure later via the chat settings drawer.

The quick setup has these controls:

- **Connection** (required) — which LLM provider/model the chat sends messages to.
- **Persona** (optional) — the character *you* play, if you want to be more than a generic user.
- **Character(s)** — tap to add one or more characters from your library. One = 1:1 chat. More than one = group chat. The chat name auto-generates from the picked characters' names unless you've renamed it.
- **Autonomous messages toggle** — defaults to ON. When enabled, characters can message you on their own when you're idle (see [Autonomous messages](#autonomous-messages) below).
- **Generate schedules toggle** — defaults to OFF. When enabled and you click Start chatting, the engine runs the Schedule Planner agent to generate weekly availability grids for each character.
- **Customize generation parameters toggle** — defaults to OFF. When enabled, you can override the connection's default temperature, max tokens, etc.

Once Connection and at least one Character are set, click **Start chatting** to apply the settings and enter the chat. Lorebooks and presets aren't part of the quick-setup modal — attach those any time via the chat settings drawer.

## Single-character vs. group chats

The number of characters you select determines the chat shape:

- **1 character** — a 1:1 DM. The character responds to each of your messages.
- **2 or more characters** — a group chat. By default, characters reply automatically and the Response Orchestrator agent decides who speaks. You can also tell characters to stay quiet unless you `@mention` them — see [Group chat configuration](#group-chat-configuration) below.

There's no separate "group chat mode" to enable — the engine flips into group behavior automatically when you have more than one character.

## Group chat configuration

A few settings in the chat settings drawer shape how group chats behave. (Roleplay and Game Mode have their own, more elaborate group-chat controls — what's described here is Conversation-specific.)

### Manual Replies — "Only Reply When Mentioned"

A single toggle in the chat settings drawer.

- **OFF** (default) — characters reply automatically to your messages. If you `@mention` a specific character, the response focuses on that character.
- **ON** ("Only Reply When Mentioned") — characters stay quiet until you `@mention` one or trigger one from the **character picker** that appears in the input bar (visible in group chats). Useful when you want tight control over turn-taking and don't want everyone responding to every message.

### Character exchanges

A toggle in the chat settings drawer (visible only when you have multiple characters) that lets characters chat with **each other** rather than only with you. With this on, the response orchestrator can decide a character should address another character. With it off, all responses are directed at you.

## Conversation-specific features

These are features Conversation Mode has that other modes don't.

### Character schedules

Each character in a Conversation chat has a **7-day × 24-hour availability grid** showing their status (`online`, `idle`, `dnd`, `offline`) and a per-hour activity description (e.g. `Meetings`, `Free time`, `Sleeping`). The grids are:

- **Auto-generated** by the Schedule Planner agent the first time a chat is started. The agent reads each character's card and infers a reasonable weekly pattern.
- **User-editable** in the chat settings drawer — open the schedule editor, drag-fill cells, type custom activity strings.
- **Regenerable** with global guidance preferences (e.g. `no characters past midnight`, `everyone is a college student`).

Schedules influence **autonomous messaging timing** — a character whose schedule says they're `offline` won't reach out unprompted, even if autonomous messages are enabled. They're stored per-chat, so the same character can have different schedules in different conversations.

### Autonomous messages

A toggle in the chat settings drawer (and in the quick-setup modal). When enabled, characters can send you messages **on their own** if you've been idle for a while. The Autonomous Messenger agent reads each character's personality and schedule, then triggers an unprompted message when:

- The user has been inactive for a configured amount of time.
- The character's schedule says they're online or idle (not offline or dnd).
- The character's personality fits reaching out (a chatty character will message sooner than a reserved one).

Autonomous messages **default to ON** when you complete the quick-setup modal. Turn them off in the chat settings drawer if you want messages only when you initiate.

### Selfies and per-character image generation

Conversation Mode supports characters sending you **selfies** — image-generation calls that produce photos of the character in context. Distinct from the world-and-scene illustrations Roleplay and Game Mode use, selfies are tied to one specific character.

To enable:

1. In the chat settings drawer, set a **Selfie Connection** (an image-generation provider — Stability AI, ComfyUI, AUTOMATIC1111, etc.).
2. Optionally set a **Selfie Resolution** (default `512x768`).
3. Optionally edit per-character **selfie tags** — appearance prompts the character should always include in their selfies (e.g. specific clothing, settings, art style).

Once configured, characters can send selfies as part of their messages, or you can ask them for one explicitly. Each selfie costs an image-generation API call.

## Connected chats

Conversations can be **connected** to a Roleplay or Game chat — letting your DM character know what's happening in the story (or vice versa). The bridge is intentionally **asymmetric**: roleplays auto-pull conversation context, but conversations don't auto-pull roleplay context. This keeps DM prompts lean while letting story-side context flow inward.

The full mechanics (when context flows automatically, how to bridge it manually with `<influence>` and `<note>` tags) are documented in the FAQ:

- [Why doesn't my roleplay character remember the messages from our connected conversation?](FAQ.md#why-doesnt-my-roleplay-character-remember-the-messages-from-our-connected-conversation)

## Recommended models

Conversation Mode is the most forgiving of the chat modes. Unlike Game Mode (which demands strict-JSON outputs that small models often fail), Conversation just needs the model to write coherent dialogue.

**Most modern API models work fine,** including:

- **Free-tier OpenRouter routing** (like the auto-seeded `OpenRouter Free` connection) — actually usable here, in contrast to Game Mode where it typically fails.
- **Mid-tier models** — Claude Haiku, GPT-4 mini, Gemini Flash, GLM5, Llama 3 70B, etc. Plenty of personality and dialogue quality.
- **Top-tier models** — Claude Opus/Sonnet, GPT-4 class, Gemini Pro. Better at long-context recall and consistent character voice over time, especially across long chat histories.

**When to upgrade your model:**

- The character keeps **breaking persona** or forgetting key facts — try a more capable model.
- You're running **long chats** (thousands of messages) and the character has lost the thread of older context — bigger context window helps.
- The character's prose feels **flat or repetitive** — better models tend to write more varied dialogue.

**Specific notes:**

- **Autonomous messages and schedules** require structured-ish output from the Schedule Planner / Autonomous Messenger / Response Orchestrator agents. Very weak models can fail these. If schedules generate as gibberish or autonomous messages misfire, your model is too small for the agent calls — switch to a mid-tier or better model on the **agent** connection (which can be different from the main chat connection).
- **Group chats** put more pressure on the model to keep distinct character voices apart from each other. If you notice characters bleeding together — speaking the same way, finishing each other's sentences in unintended ways — switch to a more capable model on the chat connection.

## Lorebooks in Conversation

Lorebooks attached to a Conversation chat work the way they're typically used in chat frontends — both **constant** and **keyword-triggered** entries fire on each turn:

- **Constant entries** — always injected into the prompt, every turn. Use for setting facts that should always be in context (the world this chat takes place in, the relationships between characters, ground rules).
- **Keyword-triggered entries** — injected when the trigger words appear in recent chat messages. Use for content that should only show up when relevant (specific NPCs by name, location-specific details, items by name).

This is different from Game Mode's world-gen, where only constant entries fire (because there's no chat text yet to match against keywords). In Conversation, both kinds work normally.

The lorebook editor itself has its own in-app UI for authoring entries — keywords, position, recursion settings, folder organization. The depth of those settings is beyond this guide; the inline help in the editor covers them.

## Generation parameters

Conversation uses Marinara's shared generation parameter system. See [Generation Parameters](GENERATION_PARAMETERS.md) for the defaults table, tuning advice, and per-backend gotchas (Claude `temperature`/`topP` conflict, Claude thinking mode, OpenRouter caveats).

For Conversation specifically, the defaults work well as-is for most use cases. Two tuning hints if you want the chat to feel different:

- **Same character keeps repeating phrasing across many turns** — raise `frequencyPenalty` or `presencePenalty` slightly (`0.3`–`0.6`).
- **Character voice feels stiff** — raise `temperature` to `1.1` or `1.2`. Conversation tolerates more variability than Game Mode does because there's no JSON parsing risk.

## Troubleshooting

### How do I see what calls Conversation Mode is making?

Set `LOG_LEVEL=debug` in your `.env` file and restart the server. Marinara logs complete LLM prompts (every message role and content), full responses, token counts, and per-agent batch details. This is the most reliable way to see what context the model is receiving on each turn — including which lorebook entries fired, what the persona injected, and how big each prompt is.

Set it back to `warn` (the default) when you're done — debug output is high-volume. See [Logging Levels](CONFIGURATION.md#logging-levels) for full details.

**Privacy note before sharing logs:** debug output contains your full prompts — character cards, persona content, lorebook entries, and chat history. Redact private content (NSFW, real-world identifiers, anything you wouldn't want public) before posting logs in Discord, GitHub issues, or any public forum.

### Autonomous messages are spamming me

Open the chat settings drawer and turn off **Autonomous messages**. They default to ON when you complete the quick-setup modal, so this is a common adjustment. If the character is messaging more aggressively than you'd like, you can also reshape their schedule to mark more hours `dnd` or `offline`, which suppresses autonomous reach-outs during those windows.

### Group chat: one character monopolizes responses

Two options:

- Turn on **Manual Replies** ("Only Reply When Mentioned") in the chat settings drawer and `@mention` characters explicitly when you want them to speak.
- Or use the **character picker** that appears in the input bar to trigger specific characters' responses one at a time without enabling Manual Replies globally.

### Character forgets things from earlier in the conversation

Long chats fill the model's context window. The engine summarizes older messages, but compression loses fidelity. Things to try:

- Bump to a model with a larger context window.
- Add critical facts to a **lorebook entry as constant** so they're always in scope, regardless of how far back in chat history they were said.
- Open a fresh chat (with the same character / persona) when the current one gets very long. You can still reference past chats via connected chats if you want continuity.

### Selfies fail or generate the wrong character

Two common causes:

- The Selfie Connection isn't producing the character correctly — check that the per-character selfie tags include the appearance details that make this character recognizable to your image model.
- The image-gen provider returned an error — check the network tab in your browser dev tools or the server logs (`LOG_LEVEL=debug`) for the actual API response.

---

## Found this confusing? Tell us

This guide will only get better with feedback. If something here didn't make sense, contradicted what you saw, or missed a question you actually had — [join the Discord](https://discord.com/invite/KdAkTg94ME) or [open a GitHub issue](https://github.com/Pasta-Devs/Marinara-Engine/issues). The most useful feedback is the specific kind: "I read X and still didn't know how to do Y."
