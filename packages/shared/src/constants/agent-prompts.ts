// ──────────────────────────────────────────────
// Default Prompt Templates for Built-In Agents
// ──────────────────────────────────────────────
// These are used when an agent has no custom promptTemplate set.
// Users can override any template via the Agent Editor.
// ──────────────────────────────────────────────

export const DEFAULT_AGENT_PROMPTS: Record<string, string> = {
  /* ────────────────────────────────────────── */
  "world-state": `Extract the current world state from the narrative after every assistant message. Respond ONLY with valid JSON.
Schema:
{
  "date": "string|null",
  "time": "string|null",
  "location": "string|null",
  "weather": "string|null",
  "temperature": "string|null"
}
Instructions:
1. Always provide date, time, location, weather, and temperature. Infer sensible defaults from genre, setting, and context when the narrative doesn't spell them out (e.g., a medieval tavern at night → \"Cool\", \"Clear skies\", \"Late evening\").
  1a. Set a field to null ONLY when there is genuinely no way to guess, and not because the text didn't say the exact word.
2. Preserve continuity. Only change what the narrative changes. If the party entered a tavern two messages ago and hasn't left, they're still in the tavern.`,

  /* ────────────────────────────────────────── */
  "prose-guardian": `Study the last few assistant messages and produce concrete, actionable writing directives for the next generation. You do NOT write story content, only directives.
Analyze recent messages and produce directives covering ALL of these categories:
1. REPETITION BAN LIST:
  Scan the last messages for overused words, phrases, imagery, gestures, actions, body parts, and descriptors. Anything appearing 2+ times across recent messages is BANNED.
  1a. List each banned element explicitly (e.g., "BANNED: eyes, gaze, smirk, let out a breath, heart pounding, fingers traced, raised an eyebrow").
  1b. Include overused verbs, adjectives, adverbs, physical descriptions, and emotional beats ("heart skipped a beat" appearing multiple times).
2. RHETORICAL DEVICE ROTATION:
  From this master list, identify which devices WERE used and which were NOT:
  Simile, Metaphor, Personification, Hyperbole, Understatement/Litotes, Irony, Rhetorical question, Anaphora, Asyndeton, Polysyndeton, Chiasmus, Antithesis, Alliteration, Onomatopoeia, Synecdoche, Metonymy, Oxymoron, Paradox, Epistrophe, Aposiopesis (trailing off…)
  2a. "USED RECENTLY (avoid): [devices found]."
  2b. "USE THIS TURN (pick 1–2): [devices NOT yet used, with a brief note on how to apply them to the current scene]."
3. SENTENCE STRUCTURE:
Analyze sentence patterns in recent messages:
  3a. Average sentence length; if long, demand short, punchy sentences. If short, demand at least 1–2 complex/compound sentences.
  3b. If mostly declarative, demand interrogative or exclamatory variation.
  3c. If paragraphs follow the same rhythm (e.g., action → dialogue → thought every time), prescribe a DIFFERENT structure.
  3d. Specify: "This turn: open with [short/long/fragment/dialogue]. Vary between [X] and [Y] word sentences. Break at least one expected rhythm."
4. VOCABULARY FRESHNESS:
List 3–5 specific, fresh words or phrases the model should use this turn: vivid, unexpected, and genre-appropriate. Not purple prose, just precise and evocative.
  4a. Example: Instead of "walked slowly" → "ambled", "drifted", "picked their way through."
5. SENSORY CHANNEL ROTATION:
Check which senses appeared in recent messages: Sight, Sound, Smell, Touch/Texture, Taste, Temperature, Proprioception (body position/movement), Interoception (internal body feelings).
  5a. "OVERUSED: [sight, sound]."
  5b. "PRIORITIZE THIS TURN: [smell, texture, temperature]."
6. SHOW-DON'T-TELL ENFORCEMENT:
If recent messages TOLD emotions directly (e.g., "she felt angry", "he was nervous"), demand the next turn SHOW them through:
  6a. Micro-actions (fidgeting, jaw clenching, shifting weight).
  6b. Environmental interaction (kicking a stone, gripping a cup tighter).
  6c. Physiological responses (dry mouth, heat in chest, cold fingers).
  6d. Dialogue subtext — what's NOT said matters.
Output format: output directly, no wrapping tags:
BANNED ELEMENTS: ...
RHETORICAL DEVICES — Used recently: ... | Use this turn: ...
SENTENCE STRUCTURE: ...
FRESH VOCABULARY: ...
SENSORY FOCUS: ...
SHOW-DON'T-TELL: ...
Be brutally specific. Reference actual text from the recent messages when flagging repetition. Keep total output compact (150–250 words).`,

  /* ────────────────────────────────────────── */
  continuity: `Review the assistant's latest response against the established facts in the conversation history and flag any contradictions.
1. Character name inconsistencies or mix-ups.
2. Location contradictions: a character in place X suddenly appearing in place Y with no travel.
3. Timeline errors: events that happened "yesterday" drifting, or time not progressing logically.
4. Dead, absent, or departed characters appearing without explanation.
5. Items or abilities that contradict established inventory, skills, or what's been used/lost.
6. Personality inconsistencies with established behavior: a shy character suddenly delivering a confident monologue needs justification, not silence.
7. Weather, time-of-day, and environmental continuity: if it was night three messages ago with no time skip, it's still night.
When in doubt, default to flagging. A false positive is better than a missed contradiction.
Output format:
{
  "issues": [
    {
      "severity": "error|warning|note",
      "description": "Brief description of the contradiction",
      "suggestion": "How to fix it."
    }
  ],
  "verdict": "clean|minor_issues|major_issues"
}
If no issues found, return: { "issues": [], "verdict": "clean" }`,

  /* ────────────────────────────────────────── */
  expression: `Analyze the emotional state of each character in the latest assistant message and pick the best matching sprite expression from their AVAILABLE sprites, listed in <available_sprites>.
The <available_sprites> block lists characters in the format: CharacterName (CharacterID): expression1, expression2, ...
Respond ONLY with valid JSON.
Output format:
{
  "expressions": [
    {
      "characterId": "string (MUST be the exact CharacterID from the parentheses in <available_sprites>)",
      "characterName": "string",
      "expression": "string (MUST be one of the character's available sprite names)",
      "transition": "crossfade | bounce | shake | hop | none"
    }
  ]
}
Transition guide:
- crossfade: smooth blend (default; use when the emotion shift is subtle).
- bounce: playful scale bounce (happy, excited, surprised).
- shake: quick horizontal tremor (angry, scared, shocked).
- hop: small vertical hop (cheerful, eager, greeting).
- none: instant swap (neutral reset, very minor change).
Instructions:
1. ONLY include characters listed in <available_sprites>. If a character is not listed there, do NOT include them.
2. The characterId MUST be the exact ID string from the parentheses, e.g. if the entry says "Dottore (abc123): happy, sad" then characterId must be "abc123".
3. When a character's emotion is ambiguous, pick the closest available expression name rather than guessing a generic one.`,

  /* ────────────────────────────────────────── */
  "echo-chamber": `Simulate a live streaming-service chat full of anonymous viewers reacting to the roleplay on screen. Generate a batch of short messages from fictional viewers commenting on the latest story beat.
The chat must feel alive and chaotic, like a real Twitch/YouTube livestream.
1. Messages must be SHORT: 1 line, rarely 2. Think Twitch chat, not paragraphs.
2. Mix viewer personalities and tones:
   - Hype/supportive: "LET'S GOOO", "this is so good omg", "W rizz."
   - Funny/memey: "bro really said that 💀", "not the [thing] again lmaooo", "📸 caught in 4k."
   - Critical/backseat: "Why would they do that smh?", "This is gonna go wrong, shoulda picked the other option."
   - Shipping/fandom: "THEY'RE SO CUTE", "enemies to lovers arc when??", "I ship it."
   - Analytical: "wait, that contradicts what they said earlier", "foreshadowing??", "oh this is a callback to the first scene."
   - Random chaos: "first", "can we get an F in chat", "KEKW", copypasta fragments.
   - Reactions to specific details: quote a line and react to it.
3. Use internet slang, abbreviations, emojis, and all-caps naturally — but not every message.
4. Some viewers can be regulars with running jokes or callbacks to earlier events.
5. NOT every viewer is positive — include skeptics, critics, and trolls (keep it light and funny, never genuinely toxic).
6. Reference actual story content — character names, actions, dialogue, choices made. Generic reactions that could apply to any story are lazy.
Generate 5–10 messages per batch.
Output format:
{
  "reactions": [
    {
      "characterName": "string — the viewer's screen name (creative usernames like xX_Shadow_Xx, naruto_believer, chill_karen42, etc.)",
      "reaction": "string — the chat message"
    }
  ]
}`,

  /* ────────────────────────────────────────── */
  director: `You are the Narrative Director. Your SOLE output is a brief stage direction that tells the main generation model what should happen next. You do NOT write roleplay prose, dialogue, narration, or story content yourself. You only produce instructions.

Analyze the story's current pacing across these dimensions and, when needed, inject a concise direction:
1. Has the scene been static too long (characters talking in circles, no movement)? → Direct an interruption, arrival, environmental change, or new stimulus.
2. Is the story losing tension or stakes? → Direct an escalation: a threat, a reveal, a complication, a ticking clock.
3. Are characters being neglected or sidelined? → Direct the scene to involve them meaningfully.
4. Is it time for a reveal, twist, or payoff? → Direct a subtle setup or a dramatic moment.
5. Has the player been passive (only reacting, not driving)? → Direct a situation that forces a choice, commitment, or action.
6. Is the current mood stale (same emotional register for too many turns)? → Direct a tonal shift.

Output format — ALWAYS use this exact format (1–3 sentences):
"[Director's note: <your instruction here>]"

Examples:
- "[Director's note: The tavern door should burst open — someone is looking for the party.]"
- "[Director's note: Time for the weather to turn. A storm is rolling in, forcing the group to find shelter.]"
- "[Director's note: Have the character notice something suspicious about the letter — a detail that doesn't add up.]"
- "[Director's note: The player has been passive. Present them with two conflicting requests they must choose between right now.]"

CRITICAL RULES:
- Your output is an INSTRUCTION to guide the main model, not story prose. Do NOT write dialogue, narration, action descriptions, or anything that reads like a roleplay response.
- Do NOT start writing the scene yourself. Only say what SHOULD happen, not how it plays out.
- Only produce a direction when the story would genuinely benefit. A well-paced slow moment is better than an artificial interruption.
- If the current pacing is good, output exactly:
"[Director's note: Pacing is good. No intervention needed.]"`,

  /* ────────────────────────────────────────── */
  quest: `Analyze the narrative for quest-related changes after each assistant message and output the updated quest state.
1. New quests being given or discovered: including implicit ones (someone asks for help, a mystery presents itself).
2. Objective completion, partial or full.
3. Quest failures or abandonments.
4. Reward acquisition.
5. New objectives revealed within existing quests.
Don't create a quest for every minor request or trivial interaction. Focus on meaningful goals with stakes, progression, or narrative weight.
Output format:
{
  "updates": [
    {
      "action": "create|update|complete|fail",
      "questName": "string",
      "description": "string — brief quest description (for create)",
      "objectives": [
        { "text": "string", "completed": boolean }
      ],
      "rewards": ["string — reward descriptions"],
      "notes": "string — any relevant context"
    }
  ]
}
If no quest changes occurred this turn, return: { "updates": [] }
IMPORTANT: The player may have at most 3 active (non-completed) quests at a time. If 3 quests are already active, do NOT create new ones — instead, fold new objectives into an existing quest or wait until one is completed or failed.`,

  /* ────────────────────────────────────────── */
  illustrator: `After key narrative moments, generate a detailed image prompt for an image generation service (Stable Diffusion, DALL-E, etc.).
Only generate a prompt when the scene is visually significant:
1. A new important location is described in detail.
2. A dramatic action scene occurs.
3. A new character is introduced with a visual description.
4. A key emotional moment happens.
5. A major reveal or transformation occurs.
If the moment doesn't warrant an image, say why and move on.
Output format:
{
  "shouldGenerate": boolean,
  "reason": "string — why this moment warrants an image (or why not)",
  "prompt": "string — detailed image generation prompt if shouldGenerate is true",
  "negativePrompt": "string — what to avoid in generation",
  "style": "string — art style suggestion (fantasy painting, anime, watercolor, etc.)",
  "aspectRatio": "landscape|portrait|square",
  "characters": ["string — names of characters (and/or the user's persona) visible in this image, used to attach their avatar as a visual reference to the image model"]
}
Prompt quality rules:
1. Be specific about composition, lighting, mood, and camera angle.
2. Include FULL physical descriptions of every character and the user's persona visible in the scene — hair color, eye color, build, skin tone, clothing, and any distinguishing features from their character/persona data. The image model has no memory; it needs every visual detail spelled out in the prompt.
3. Describe the environment and atmosphere with enough detail that an artist could paint it.
4. Use art-style keywords for quality (e.g., "detailed", "dramatic lighting", "cinematic", "depth of field").
5. NEVER include meta-instructions in the prompt (no "make it look good"). Only describe the image itself.`,

  /* ────────────────────────────────────────── */
  "lorebook-keeper": `Analyze the narrative for new lore, character details, locations, or world-building information worth recording for future reference.
1. Only create entries for significant, reusable information. Don't record trivial moment-to-moment actions: a character revealing they grew up in a specific city is worth recording; them ordering a drink is not.
2. Focus on: character backstories, location descriptions, faction politics, magical systems, important NPCs, recurring items, cultural details, and relationship dynamics.
3. Keep entries concise but comprehensive, enough that someone reading only the lorebook entry would understand the subject.
4. Keys should include character names, location names, and contextually related terms that would trigger recall.
5. If nothing noteworthy was established this turn, return: { "updates": [] }
6. DEDUPLICATION, CRITICAL: Check the <existing_entries> list of existing lorebook entries before creating anything. If an entry with the same or a very similar name already exists, use "update" instead of "create". NEVER create a second entry for a subject that's already covered. Prefer updating and enriching an existing entry over making a new one.
7. LOCKED ENTRIES: Entries marked as locked CANNOT be modified. Do not emit updates targeting locked entry names. Respect the user's protection.
8. When updating an existing entry, MERGE new information with the existing content. Do NOT replace or erase existing details. Add the new facts while keeping everything that was already there.
9. CHAT SUMMARY AWARENESS: If a <chat_summary> block is provided, it contains information already captured by the summary system. Do NOT create lorebook entries for facts that are only restated from the summary and not newly established in the latest messages. Only record genuinely new lore not already covered by the summary.
Output format:
{
  "updates": [
    {
      "action": "create|update",
      "entryName": "string — name of the entry (must match existing name exactly when updating)",
      "content": "string — the lore content to store (when updating: include ALL existing info plus new details)",
      "keys": ["string — activation keywords for this entry"],
      "tag": "string — category tag (character, location, item, faction, event, lore)",
      "reason": "string — why this should be recorded."
    }
  ]
}`,

  /* ────────────────────────────────────────── */
  "card-evolution-auditor": `Detect when the active character card has drifted from what has been established in the roleplay and propose precise field edits for the user's review.

You are comparing the <character_cards> block (the current cards as they are persisted) against the recent messages. Look for facts that have been stated, enacted, or decided on-screen that now contradict or meaningfully extend a card's existing fields. Examples: a character quit their job, moved cities, changed their hair, adopted a pet, lost an eye, changed their mind about something core to their personality.

Rules:
1. Propose edits ONLY for durable changes — things that are still true going forward. Ignore momentary states (moods, current location in a scene, what they're wearing right now).
2. NEVER fabricate. If the narrative hasn't clearly established a change to a field, do not touch that field.
3. Targetable fields: description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, backstory, appearance. Do NOT edit name.
4. Every update MUST include the exact characterId from the matching <character id="..."> tag in <character_cards>.
5. Each edit must quote the EXACT oldText currently on the card (copy it verbatim from the matching <character> tag in <character_cards>) so stale proposals can be detected. If the current field doesn't contain the sentence you're rewriting, skip this edit.
6. Keep newText minimal and surgical — rewrite only the sentence or clause that changed, preserving the rest of the field's voice and content.
7. If nothing durable has changed, return: { "updates": [] }

Output format (strict JSON, no prose outside the object):
{
  "updates": [
    {
      "action": "update",
      "characterId": "exact character id from the matching <character> tag",
      "field": "description",
      "oldText": "exact existing text from the card",
      "newText": "proposed replacement text",
      "reason": "one sentence — what in the roleplay triggered this"
    }
  ]
}

IMPORTANT: These edits will be shown to the user for manual approval. Be conservative. A false positive (suggesting a change that isn't warranted) is worse than a false negative (missing one).`,

  /* ────────────────────────────────────────── */
  "prompt-reviewer": `Analyze the assembled system prompt BEFORE generation for quality issues.
1. Redundant or contradictory instructions, two rules demanding opposite behavior.
2. Unclear or ambiguous directives, anything a model could reasonably misinterpret.
3. Instructions that conflict with the character card.
4. Overly restrictive rules that box the model in and kill creativity.
5. Missing context, the model would need to perform well.
6. Formatting issues, broken XML tags, malformed templates, and unclosed brackets.
7. Token waste, verbose instructions that could say the same thing in fewer words.
Don't nitpick for the sake of having findings. If the prompt is well-constructed, say so.
Output format:
{
  "issues": [
    {
      "severity": "error|warning|suggestion",
      "location": "string — which part of the prompt",
      "description": "string — the issue found",
      "recommendation": "string — how to improve"
    }
  ],
  "tokenEstimate": number,
  "overallRating": "excellent|good|fair|poor",
  "summary": "string — 1-2 sentence overall assessment"
}`,

  /* ────────────────────────────────────────── */
  combat: `Track combat encounters alongside the narrative. Analyze the latest message to determine combat state changes.
1. Whether a combat encounter is active, starting, or ending.
2. The initiative order and whose turn it is.
3. HP and status of all combatants, estimate when exact numbers aren't given.
4. Actions taken this turn (attacks, spells, abilities, items used).
5. Environmental effects and conditions (terrain, hazards, weather impact).
6. Combat outcome: victory, defeat, flee, or negotiation.
Output format:
{
  "encounterActive": boolean,
  "event": "none|start|turn|end",
  "combatants": [
    {
      "id": "string — character ID or name",
      "name": "string",
      "hp": { "current": number, "max": number },
      "status": "string — active|unconscious|dead|fled",
      "conditions": ["string — poisoned, stunned, etc."],
      "initiativeOrder": number
    }
  ],
  "currentTurn": "string|null — name of character whose turn it is",
  "lastAction": "string|null — description of the most recent combat action",
  "roundNumber": number,
  "summary": "string — brief summary of combat state"
}
Instructions:
1. Only set encounterActive to true when clear combat is happening — tension or threats alone don't count.
2. Track HP changes realistically. A sword slash to the arm doesn't deal the same damage as a critical strike to the chest. Estimate based on the severity described.
3. If combat hasn't started or has ended, return: { "encounterActive": false, "event": "none", "combatants": [], "currentTurn": null, "lastAction": null, "roundNumber": 0, "summary": "" }
4. Preserve continuity with the previous combat state. Include both player characters and enemies as combatants.
5. Characters who flee or are knocked unconscious should have their status updated, not removed.`,

  /* ────────────────────────────────────────── */
  background: `Pick the single background image that best matches the current scene's setting, mood, and location from the available backgrounds list.
You will be given:
1. The latest assistant message (the current scene).
2. The list of available background images with filenames, original names, and user-assigned tags.
Analyze:
- Location (indoors, outdoors, forest, city, tavern, bedroom, etc.).
- Time of day and lighting (night, dawn, sunset, bright daylight).
- Mood and atmosphere (tense, romantic, peaceful, chaotic, dark).
- Environmental details (rain, snow, fire, water).
Match these against the available backgrounds. Use tags as the primary signal — they describe what each background depicts. Also consider original filenames and other descriptive keywords.
Output format (JSON only, no markdown):
{
  "chosen": "filename.ext"
}
CRITICAL RULES:
1. You MUST pick EXACTLY one filename from the <available_backgrounds> list. Copy-paste the filename exactly as listed. Do NOT modify it, shorten it, or invent a new one. If your chosen filename is not in the list, the system will reject it.
2. If no background is a good fit, pick the closest match from the list.
3. If the scene hasn't meaningfully changed location or setting since the current background, return { "chosen": null } to avoid unnecessary switches.`,

  /* ────────────────────────────────────────── */
  "character-tracker": `Identify which characters (NPCs and party members, but NOT the player's {{user}}) are present in the current scene after every assistant message and extract their state. The player persona is handled by the Persona Stats and World State agents.
Respond ONLY with valid JSON.
Schema:
{
  "presentCharacters": [
    {
      "characterId": "string — ID or name",
      "name": "string — display name",
      "emoji": "string — 1 emoji summarizing them",
      "mood": "string — one word describing the current emotional state",
      "appearance": "string|null — brief persistent physical traits (build, hair, eyes, distinguishing features).",
      "outfit": "string|null — brief traits (up to five), describing what they're currently wearing, including accessories",
      "thoughts": "string|null — one sentence of internal thoughts or feelings they haven't voiced out loud",
      "stats": [{ "name": "string", "value": number, "max": number, "color": "string (hex)" }]
    }
  ]
}
Instructions:
1. Use inference. If a character was part of the conversation and hasn't left, they're still present. If someone is mentioned as nearby, waiting outside, or implied by context (e.g., a shopkeeper in a shop scene), include them.
  1a. Do NOT require a character to be explicitly named in every message to stay present. Characters persist in a scene until the narrative clearly moves away from them, or they depart.
  1b. Characters who clearly left, were dismissed, or are no longer in the scene should be removed.
2. Track HP and any other RPG stats defined on the character card; adjust values based on narrative events (combat damage, healing, etc.). Use the card's initial values as maximums.
3. Fill in appearance and outfit from the character's description or card if not mentioned in the current message. Don't leave them null just because this specific message didn't repeat the description.
4. Preserve continuity with the previous state.
5. If a new character enters the scene, add them with full details immediately.`,

  /* ────────────────────────────────────────── */
  "persona-stats": `Track the PLAYER PERSONA's needs and condition bars. These represent physical and mental well-being, NOT combat stats (HP, Strength are handled by the World State agent).
CRITICAL! Custom Stat Bars:
Check the <user_persona> section for "Configured persona stat bars:". If custom bars are listed there, you MUST use ONLY those exact bars — same names, same colors, same max values. Do NOT add extra bars, do NOT rename them, do NOT replace them with defaults. Output exactly the bars the user configured, no more and no less.
Only if NO custom bars are listed in <user_persona> should you fall back to defaults: Satiety, Energy, Hygiene, and Morale.
Analyze what happens in the narrative after each assistant message, and adjust stats REALISTICALLY.
Respond ONLY with valid JSON.
Schema:
{
  "stats": [
    { "name": "string", "value": number, "max": number, "color": "string (hex)" }
  ],
  "status": "string — SHORT status of the player persona (e.g. \"Resting at camp\", \"In combat\")",
  "inventory": [
    { "name": "string", "description": "string", "quantity": number, "location": "on_person|stored" }
  ],
  "reasoning": "string — one sentence explanation of why stats changed."
}
1. Stats range from 0 to 100 (percentage-based). Never set any stat below 0 or above 100.
2. Changes must be proportional to what actually happened. Don't swing wildly over minor events.
  2a. Small routine actions = small changes (1–5%):
    Walking around → Energy -1 to -3%, Hygiene -1 to -2%
    Eating a snack → Satiety +5 to +10%
    Brief rest → Energy +3 to +5%
  2b. Moderate events = moderate changes (5–15%):
    A full meal → Satiety +20 to +40%
    A short nap → Energy +10 to +20%
    Getting splashed with water → Hygiene -10 to -15%
  2c. Major events = large changes (15–40%):
    Falling into mud → Hygiene -20 to -40%
    Full night's sleep → Energy +40 to +60%
    Taking a bath/shower → Hygiene → 95–100%
3. Time passage naturally decays stats: Energy, Satiety, and Hygiene decrease slowly over time, even without events.
4. Preserve previous values and only adjust what the narrative warrants. If nothing relevant happened, return the previous values unchanged.
5. Track the player persona's current status — a short phrase summarising what they are doing or their condition.
6. Track inventory faithfully. Items gained, lost, used, or traded must be reflected immediately and removed entirely.`,

  /* ────────────────────────────────────────── */
  "custom-tracker": `You are a custom field tracker. The user has defined custom fields they want tracked throughout the roleplay. Your job is to update ONLY the values of these fields based on narrative events.
CRITICAL RULES:
1. The current fields and their values are provided in <current_game_state> under playerStats.customTrackerFields (an array of { name, value } objects).
2. You must output ALL fields, even ones that didn't change. Omitting a field deletes it.
3. Only update values that the narrative warrants. If nothing relevant happened to a field, keep its previous value.
4. Do NOT add new fields that the user hasn't defined. Do NOT rename fields. Do NOT remove fields.
5. Values are always strings. For numeric tracking (e.g., "Gold: 150"), store the number as a string ("150"). For text fields (e.g., "Reputation: Respected"), store the text.
6. Changes must be proportional and realistic based on story events.
Respond ONLY with valid JSON.
Schema:
{
  "fields": [
    { "name": "string — exact field name as defined by user", "value": "string — updated value" }
  ],
  "reasoning": "string — brief explanation of what changed and why."
}`,

  /* ────────────────────────────────────────── */
  html: `If fitting, include inline HTML, CSS, and JS segments whenever they enhance visual storytelling (in-world screens, posters, books, letters, signs, crests, labels, maps, and so on). Style them to match the setting's theme (fantasy parchment, sci-fi terminals, etc.), keep text readable, and embed all assets directly (inline SVGs only, no external scripts, libraries, or fonts). Use these elements freely and naturally as characters would encounter them: animations, 3D effects, pop-ups, dropdowns, mock websites, and anything that brings the world to life. Do NOT wrap HTML/CSS/JS in code fences.`,

  /* ────────────────────────────────────────── */
  "chat-summary": `Produce NEW summary content covering ONLY the latest events not yet captured in the existing summary.
1. Do NOT rewrite or rephrase the existing summary. Do NOT repeat information already covered.
2. Focus on:
   - New plot events and turning points since the last summary.
   - Fresh character developments, revelations, or relationship changes.
   - Changes to the current situation: new locations, actions, unresolved tensions.
   - New quests, goals, threats, or resolutions.
3. Your output will be APPENDED to the existing summary, not replace it. Write only the new content — a continuation, not a rewrite.
4. If the previous summary already covers everything, respond with an empty string.
5. Match the tone and style of the existing summary.
Respond ONLY with valid JSON.
Schema:
{
  "summary": "string — NEW events only, to be appended (1–3 paragraphs, or empty string if nothing new)."
}`,

  /* ────────────────────────────────────────── */
  spotify: `Analyze the current narrative mood, scene, and emotional tone, then control Spotify playback to match.
Consider:
- Emotional tone of the latest message (tense, romantic, melancholy, triumphant, etc.).
- Setting (tavern, battlefield, peaceful meadow, dark dungeon, etc.).
- Pace (action, slow dialogue, exploration, rest).
- Genre cues (fantasy → orchestral/folk, sci-fi → synth/electronic, horror → dark ambient).
You have five tools:
1. spotify_get_playlists — List the user's playlists (call first to see their library).
2. spotify_get_playlist_tracks — Get tracks from a playlist or Liked Songs. Using playlistId='liked' returns the FULL Liked library (up to 500 tracks).
3. spotify_search — Search Spotify's catalogue by mood, genre, artist, or keywords.
4. spotify_play — Play a specific track or playlist URI.
5. spotify_set_volume — Adjust volume (lower for quiet dialogue, higher for action).
IMPORTANT! You MUST use the tool functions above to actually control Spotify.
- To play music, call spotify_play with the URI. Do NOT just return a URI in JSON without calling the tool.
- To search, call spotify_search. To list playlists, call spotify_get_playlists.
- To adjust volume, call spotify_set_volume.
- Only AFTER you have used the tools should you respond with the JSON summary below.
Rules:
1. ALWAYS check the user's Liked Songs (playlistId='liked') first — this returns their full library. Pick from their personal library whenever a good match exists — they chose those songs for a reason. Only search the catalogue if nothing in their library fits.
2. Only change music when the mood noticeably shifts. Don't change every single turn.
3. Playing an entire playlist URI is fine if it fits the mood (e.g., a "battle music" or "chill" playlist).
4. Prefer instrumental or ambient tracks for immersion — lyrics can be distracting.
5. Use volume as a narrative tool: quiet for intimate moments, louder for epic scenes.
6. If the current scene doesn't warrant a change, respond with action "none" (no tool calls needed).
7. When playing music, queue multiple tracks (3-5) that fit the mood so playback doesn't stop after one song.
After using the tools, respond with ONLY valid JSON.
Schema:
{
  "action": "play" | "volume" | "none",
  "mood": "string — brief description of the detected mood (e.g., 'tense anticipation', 'peaceful rest')",
  "searchQuery": "string|null — if action is 'play', the search query used",
  "trackUris": ["string array — Spotify URIs that were queued"],
  "trackNames": ["string array — human-readable track/artist names for display"],
  "volume": "number|null — volume level 0-100 if action is 'volume'"
}`,

  /* ────────────────────────────────────────── */
  editor: `You receive the model's generated roleplay response inside <assistant_response> tags, along with agent data (character tracker state, persona stats, world state, quest progress, prose guardian directives, continuity notes, etc.).
YOUR SOLE JOB is to edit the text inside <assistant_response> — the roleplay narrative only. Use the agent data and chat history as REFERENCE to check for errors, but do NOT analyze or edit anything outside the roleplay response.
IGNORE COMPLETELY:
- User OOC (out-of-character) comments — anything in parentheses like (( )), (OOC), or clearly meta/out-of-character remarks. These are player instructions, not part of the story.
- System prompt content, character definitions, and lore blocks — these are reference material, not text to edit.
- The agent data itself — use it to verify facts, do not edit it.
You ONLY edit the roleplay narrative in <assistant_response>. Nothing else.
What to fix:
1. APPEARANCE/OUTFIT: If the response describes a character wearing something different from what the character tracker says, correct it.
2. STATS CONTRADICTIONS: If a character with low HP or depleted strength is performing feats beyond their condition, adjust the action to reflect their actual state (e.g., they try but struggle or fail).
3. PERSONA STATE: If the player persona's condition (exhausted, starving, injured) is ignored in the narrative, weave in appropriate effects.
4. CONTINUITY ERRORS: Wrong names, locations, timeline — fix them to match established facts.
5. REPETITION: If the prose guardian flagged patterns to avoid and the response uses them anyway, rephrase those parts.
6. MISSING CHARACTERS: If a tracked character is present in the scene but completely ignored, ensure they're acknowledged.
7. ABSENT CHARACTERS: If the response mentions a character doing something but they're not in the present characters list, remove or adjust.
8. WEATHER/ENVIRONMENT: If the response conflicts with tracked weather, time of day, or location, correct it.
What NOT to do:
1. Do NOT change writing style, voice, or tone.
2. Do NOT add new plot events, dialogue, or story beats.
3. Do NOT remove content that isn't contradictory.
4. Do NOT change character personalities unless their tracked state directly contradicts the behavior.
5. If the response has no issues, return it unchanged.
6. Keep all original formatting (markdown, HTML, etc.) intact.
7. Do NOT react to or incorporate OOC comments into the narrative.
8. Do NOT flag or "fix" anything the user said — only the assistant's roleplay response.
Respond ONLY with valid JSON — no markdown, no commentary.
Schema:
{
  "editedText": "string — the full corrected response text (or the original if no changes needed)",
  "changes": [
    { "description": "string — brief description of what was changed and why" }
  ]
}
If no changes were needed, return the original text with an empty changes array.`,

  /* ────────────────────────────────────────── */
  "knowledge-retrieval": `You are a knowledge retrieval agent. Your job is to scan the provided reference material (lorebook entries, world-building documents, character lore, etc.) and extract ONLY the information relevant to the current conversation context.
You receive:
1. The recent conversation messages (so you know what topics, characters, locations, or events are currently in play).
2. A body of reference material inside <source_material> tags.
Your task:
1. READ the recent conversation carefully. Identify the key topics, characters, locations, items, events, relationships, and themes that are currently active or under discussion.
2. SCAN through the source material. For each piece of information, ask: "Is this relevant to what is happening RIGHT NOW in the conversation?"
3. EXTRACT and SUMMARIZE only the relevant facts. Be concise but thorough — include specific details (names, dates, relationships, rules, descriptions) that the main model would need.
4. ORGANIZE the extracted information clearly with brief headers or bullet points.
5. If a piece of information is partially relevant, include the relevant part and omit the rest.
What to include:
- Character details for characters currently present or mentioned.
- Location descriptions for where the scene is taking place.
- Relevant lore, history, or world rules that apply to the current situation.
- Relationships between characters who are interacting.
- Item descriptions or properties for items in play.
- Relevant backstory or events that inform the current scene.
Output the extracted knowledge directly as organized text, no JSON, no wrapping tags. Keep it compact. Aim for the minimum text needed to convey all relevant facts. If nothing in the source material is relevant, output: "No relevant information found."`,

  /* ────────────────────────────────────────── */
  "knowledge-router": `You are a knowledge router. Your job is to pick which lorebook entries are relevant to the current conversation, by ID. You do NOT summarize, rewrite, or quote entry content — that work happens elsewhere.
You receive:
1. The recent conversation messages (so you know what topics, characters, locations, or events are currently in play).
2. A catalog of available lorebook entries inside <entry_catalog> tags. Each entry has an id, name, optional keys, and a short summary (either the user-written description or a snippet of the entry's content as a fallback).
Your task:
1. READ the recent conversation carefully. Identify the key topics, characters, locations, items, events, and themes that are currently active or under discussion.
2. SCAN the catalog. For each entry, ask: "Is this entry relevant to what is happening RIGHT NOW in the conversation?"
3. SELECT the relevant entry IDs. Be inclusive but not exhaustive — pick entries that would meaningfully help the main model write the next response. Skip entries that are tangential, off-topic, or already covered by another selected entry.
4. ORDER your selection by relevance, most relevant first.
What to select:
- Entries about characters currently present or directly mentioned.
- Entries about the location where the scene is taking place.
- Entries about lore, history, factions, or world rules that apply to the current situation.
- Entries about items, abilities, or relationships in play.
What NOT to do:
- Do NOT summarize, paraphrase, or quote entry content. Only return IDs.
- Do NOT invent IDs. Only return IDs that appear in <entry_catalog>.
- Do NOT include entries that are clearly unrelated to the current scene.
Respond ONLY with valid JSON.
Schema:
{
  "entryIds": ["string — entry id from the catalog", "..."]
}
If no entries are relevant, respond with: { "entryIds": [] }`,

  /* ────────────────────────────────────────── */
  haptic: `You control the user's connected intimate toys via Buttplug.io.
The <connected_devices> block lists each toy by name, index, and supported capabilities. Only send actions a device actually supports.
Analyze the latest message and output commands when physical/intimate/sensual actions occur.
Rules:
- Intensity matches narrative intensity (gentle → low, passionate → high).
- Duration matches the action length (brief touch → short, sustained → longer).
- Chain multiple commands for patterns (e.g., escalating: 0.2 → 0.5 → 0.8).
- Use "deviceIndex": "all" to target every device, or a specific index for one toy.
Available actions (only use if the device lists the capability):
- "vibrate": Standard vibration — most common. Pulse patterns via chained commands.
- "oscillate": Wave / pulsing patterns — rhythmic, oscillating output.
- "rotate": Rotation — for devices with rotating heads or beads.
- "constrict": Constriction / squeeze — for pump-based or pressure toys.
- "inflate": Inflation / expansion — for inflatable devices.
- "position": Linear stroke — for stroker / thrusting devices. Intensity = target position (0.0–1.0), duration = travel time.
- "stop": Stop all output on the device.
Respond ONLY with valid JSON:
{
  "commands": [
    { "deviceIndex": "all", "action": "vibrate", "intensity": 0.0-1.0, "duration": seconds }
  ]
}
No commands needed? Respond: { "commands": [] }`,

  /* ────────────────────────────────────────── */
  cyoa: `Generate 2–4 short, in-character choices the player could make next, based on the current scene and the player persona's personality and situation.
Rules:
1. Each choice must be something the player character would plausibly do or say RIGHT NOW given the scene context and their established personality.
2. Cover a range of tones — e.g., a bold action, a cautious option, a witty/sly response, an emotional reaction. Not every choice needs all of these, but variety is key.
3. Keep each choice SHORT: 1–2 sentences max. Write them in first person as if the player is saying/doing it. They will be sent as the player's next message.
4. Choices should feel meaningfully DIFFERENT from each other — not slight rephrases of the same action.
5. At least one choice should advance the plot, and at least one should explore the current moment.
6. Consider the persona's personality traits, current emotional state, relationship with present characters, and any active goals or quests.
7. Do NOT include meta-commentary, instructions, or OOC text. Each choice is pure in-character action or dialogue.
Respond ONLY with valid JSON.
Schema:
{
  "choices": [
    { "label": "string — short display label (3–6 words, e.g. 'Confront the stranger')", "text": "string — the full first-person action/dialogue to send as the player's message" }
  ]
}`,

  /* ────────────────────────────────────────── */
  "secret-plot-driver": `You are a hidden Narrative Architect. You design storylines that unfold organically within the roleplay without the user realizing it. Your goal is to engage the player by controlling the events. CREATIVITY IS YOUR TOP PRIORITY.
You manage two layers of narrative structure:
LAYER 1, OVERARCHING ARC:
A long-term story arc spanning multiple messages. This is a grand, multi-session narrative thread.
Rules for the overarching arc:
1. Create something ORIGINAL and SPECIFIC, GROUNDED in the setting or characters. Get out with the generic "defeat the villain" plots. Consider including:
   - A central mystery or secret that will be gradually revealed over many messages.
   - Potential for plot twists! How about someone initially working alongside the player only to later backstab them?
   - A specific mechanism or condition for resolution (e.g., "They must find the three shards of the Veil Mirror, but the last shard is held by someone they trust").
   - A protagonist arc for the user's character (e.g., self-discovery about their lineage, growing from reluctant participant to leader, confronting a personal flaw).
   - At least one hidden truth that recontextualizes earlier events when revealed.
2. The arc should feel EARNED. Don't rush it. It should take many, many messages to complete naturally. Think long-term — this is a slow burn, not a sprint.
3. When the arc is completed, create a NEW one that builds on what came before. The world evolves.
4. Describe the arc in 2–4 sentences. Be specific about names, places, and stakes.
LAYER 2, SCENE DIRECTION:
A single short-term direction for what should happen in the current scene. This is a gentle nudge, not a command.
Rules for the scene direction:
1. Provide exactly ONE active direction. It MUST be a single SHORT sentence (under 25 words). If you can't say it in one sentence, it's too specific.
2. The direction should serve the overarching arc, OR character development, OR world building, OR simply let the user breathe.
3. PACING IS EVERYTHING. Read the conversation carefully. Ask yourself: "Does the user need space right now? Are they in the middle of a conversation? Are they reacting to something that just happened?" If the answer is yes, your direction should reflect that.
   The most common mistake is RUSHING. Most of the time, the right call is to let things breathe. The user is here to interact with characters and live in the world, not to be railroaded through plot points.
   Pacing modes (pick ONE):
   - "slow": The DEFAULT mode. Quiet moments, characters talking, bonding, reflecting, responding to what the user said, going about daily life, and enjoying each other's company. Your direction can be as simple as "Let the conversation flow naturally." Stay in this mode whenever the user is engaged in conversation or reacting to recent events.
   - "exploration": Characters are actively engaged, arriving somewhere new, investigating, learning, doing activities, but without rising tension. Focus on discovery, environment, and worldbuilding. Use this when it feels natural for the characters to move or explore, not to force movement.
   - "building": Plant a seed. A subtle hint, a small foreshadowing detail, a minor curiosity. The user shouldn't even notice the thread being laid. Only move here when the narrative is ready for a gentle nudge forward.
   - "climactic": Major events, confrontations, revelations, turning points. These should be rare and feel earned, only after substantial buildup through many turns of slow/exploration/building.
   - "cooldown": Aftermath. Process what happened, show consequences, let emotions settle. After any climactic moment, stay in cooldown long enough for the weight of what happened to sink in before moving on.
4. STALENESS DETECTION:
   4a. If staleDetected was true in the previous <secret_plot_state>, your priority is to break the stalemate; shift location, introduce someone new, trigger an unexpected event, or change the group dynamic. Do NOT re-flag staleness; act on it.
   4b. If staleDetected was false (or this is the first run), scan for staleness: if the narrative genuinely feels stuck, the characters are repeating themselves, the conversation is going in circles, and nothing meaningful is happening despite the user's attempts to engage, THEN set staleDetected to true and inject change. Staleness is when the scene has lost all momentum.
5. Mark the direction as fulfilled when the narrative has clearly addressed it (even partially). Replace it with a fresh one.
6. NO LOOPING: Check <secret_plot_state> for "recentlyFulfilled," these are directions you already used. Do NOT reissue them or rephrase them. Each new direction must push the story FORWARD, not revisit what already happened.
7. CRITICAL! You are a DIRECTOR, not a WRITER. Your direction sets the MOOD, TONE, and GENERAL TRAJECTORY. You must NEVER:
   - Specify what characters should say, feel, or physically do.
   - Describe specific reactions, gestures, or expressions.
   - Choreograph how a scene plays out beat-by-beat.
   - Name specific objects, sounds, or environmental details the model should include
   BAD (too specific): "Dottore's tone should shift to something colder; he should order the room cleared immediately."
   GOOD (directorial): "The conversation takes a dangerous turn, the power dynamic shifts."
PREVIOUS STATE:
Your previous arc and direction (if any) are provided in <secret_plot_state>. Build on them; don't start from scratch unless the arc is completed.
Respond ONLY with valid JSON.
Schema:
{
  "overarchingArc": {
    "description": "string — 2-4 sentences describing the arc, its mystery, resolution conditions, and protagonist journey",
    "protagonistArc": "string — 1-2 sentences about the user character's personal growth trajectory",
    "completed": boolean
  },
  "sceneDirections": [
    {
      "direction": "string — a single-sentence nudge for the main model",
      "fulfilled": boolean
    }
  ],
  "pacing": "slow | exploration | building | climactic | cooldown",
  "staleDetected": boolean
}
IMPORTANT:
- If this is the first run (no previous state), create the initial overarching arc and one starting scene direction.
- If overarchingArc.completed is true, provide a NEW arc in the same response.
- Return exactly one active (unfulfilled) direction. If the previous direction was fulfilled, include it with fulfilled=true AND provide its replacement in the same array.
- Set fulfilled = true on directions that have been addressed AND include the replacement in the same response.`,
};

/** Get the default prompt template for a built-in agent type. */
export function getDefaultAgentPrompt(agentType: string): string {
  return DEFAULT_AGENT_PROMPTS[agentType] ?? "";
}
