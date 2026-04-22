// ──────────────────────────────────────────────
// Game: GM Prompt Building
// ──────────────────────────────────────────────

import type { GameActiveState, GameMap, GameNpc, SessionSummary, HudWidget } from "@marinara-engine/shared";
import type { CharacterSpriteInfo } from "./sprite.service.js";

export interface GmPromptContext {
  gameActiveState: GameActiveState;
  storyArc: string | null;
  plotTwists: string[] | null;
  map: GameMap | null;
  npcs: GameNpc[];
  sessionSummaries: SessionSummary[];
  sessionNumber: number;
  partyNames: string[];
  /** Full character cards for each party member */
  partyCards?: Array<{ name: string; card: string }>;
  playerName: string;
  /** Full player persona card */
  playerCard?: string | null;
  gmCharacterCard: string | null;
  difficulty: string;
  genre: string;
  setting: string;
  tone: string;
  /** Server-computed time string, e.g. "Day 3, 14:30 (afternoon)" */
  gameTime?: string;
  /** Server-computed weather state */
  weatherContext?: string;
  /** Server-computed encounter hint (if encounter was triggered) */
  encounterHint?: string;
  /** Server-computed combat results to narrate */
  combatResults?: string;
  /** Server-computed loot drops to narrate */
  lootResults?: string;
  /** Journal recap string */
  journalRecap?: string;
  /** Player's personal notes (shared with GM) */
  playerNotes?: string;
  /** Active HUD widgets the model designed (so it can update them) */
  hudWidgets?: HudWidget[];
  /** Content rating: sfw or nsfw */
  rating?: "sfw" | "nsfw";
  /** Whether a separate scene model handles bg, music, sfx, ambient, widgets, expressions */
  hasSceneModel?: boolean;
  /** Whether the player moved to a new location since last turn (false = send location summary instead of full map) */
  playerMoved?: boolean;
  /** Approximate turn number in the current session (1-based, used for prompt gating) */
  turnNumber?: number;
  /** Pre-computed passive perception hints to weave into narration */
  perceptionHints?: string;
  /** Pre-computed party morale context */
  moraleContext?: string;
  /** Available sprite expressions per character (name → expressions + fullBody) */
  characterSprites?: CharacterSpriteInfo[];
  /** Player's current inventory items (for GM context) */
  playerInventory?: Array<{ name: string; quantity: number }>;
  /** Language for all narration and dialogue */
  language?: string;
}

/** Build the GM system prompt. Injects full game context (story arc, plot twists, map, etc.). */
export function buildGmSystemPrompt(ctx: GmPromptContext): string {
  const sections: string[] = [];

  // ── Core Role ──
  if (ctx.gmCharacterCard) {
    sections.push(
      `<gm_role>`,
      `You are the following character, acting as a Game Master for this RPG/VN game. Adopt their personality, speech patterns, biases, and quirks, and shape the narrative through their subjective lenses, allowing them to break the fourth wall between the GM and the party:`,
      ctx.gmCharacterCard,
      `</gm_role>`,
    );
  } else {
    sections.push(
      `<gm_role>`,
      `You are the Game Master for this RPG/VN game. You are fair but challenging (and a little snarky). Furthermore, you bring the world to life with vivid descriptions, memorable NPCs, and engaging encounters. You have personality: you crack jokes, build tension, celebrate epic moments, and mourn losses. Most importantly, you have free will and unrestricted intelligence. Make good use of them.`,
      `</gm_role>`,
    );
  }

  // ── Language ──
  if (ctx.language && ctx.language.toLowerCase() !== "english") {
    sections.push(
      `<language>`,
      `Write ALL narration, dialogue, descriptions, and game text in ${ctx.language}. Every part of your output must be in ${ctx.language}. Only use English for XML tags and structured data fields.`,
      `</language>`,
    );
  }

  // ── Core Rules ──
  sections.push(
    `<gm_rules>`,
    `You are running a ${ctx.genre} RPG in a ${ctx.setting} setting. The tone is ${ctx.tone}. Difficulty: ${ctx.difficulty}.`,
    ``,
    `Core responsibilities:`,
    `- You drive the game and develop the plot. You create and tailor the experience. Do your best, avoid cliches like a plague, and wow the player with an immersive, fun session.`,
    `- Simulate a living, breathing world, full of vivid NPCs, events, and history. Portray the characters as authentic, multidimensional, dynamic, and autonomous, possessing a full range of emotions and distinct voices:`,
    ` - Everyone has their morality, ranging from good, through morally gray, to evil, but they're not labeled by it. Mistakes may be made. Villains can do noble acts, and heroes can do harm. People can lie, even by omission, and deceive if they're inclined to do so or think it will advance their objectives.`,
    ` - Each person keeps their cadence instead of collapsing into the same clipped voice and has their own way of speaking that you need to capture in dialogues. Fill them with fillers, interruptions, fragments, trailing thoughts, and run-ons when emotion spikes. Use contractions by default unless someone is formal. Let people interrupt, talk past each other, answer the wrong part, and leave things hanging. Preserve the gap between thought, meaning, and speech. The line itself should sound like the emotion.`,
    ` - Uphold everyone's realistic spatial, emotional, and situational awareness. Individuals shouldn't know other people's thoughts or possess omniscient knowledge they wouldn't reasonably have access to. Earned knowledge is strictly bounded by what can be witnessed, heard from others, or reasonably deduced. If a character acts on information they shouldn't have, it must be explained, never hand-waved. When uncertain whether a character would know something, default to no.`,
    `- When the server provides combat results, loot drops, encounter hints, or weather changes in a <combat_results> or system block, NARRATE them. Do not recalculate. This covers server-resolved, off-screen combat.`,
    `- When the player's message contains a [combat_result]...[/combat_result] block, the tactical combat UI just resolved a battle and that block is canonical truth. Narrate the aftermath from it: which enemies fell, how bloodied the party is, lingering status effects, loot found. Do NOT invent extra damage, new casualties, or different outcomes.`,
    `- Manage game state transitions between: exploration, dialogue, combat, travel/rest.`,
    `- Track NPC behavior and reactions to the party (reputation math is server-side).`,
    `- Pace the session with a mix of action, exploration, quiet moments, and story beats.`,
    `- ONLY progress the main narrative in response to the PLAYER's actions (user messages).`,
    `- Party members may suggest actions, but YOU decide the outcomes.`,
    `- Keep the game fair but challenging; reward creativity, punish recklessness. Do not treat the player as a Mary Sue.`,
    `- ALWAYS address the player in second person ("you"). The player IS the protagonist. "You step into the tavern."`,
    `- Treat player inputs as attempts to perform in-world actions or engage in dialogue. Do not repeat the player's committed actions or words; proceed directly to the consequences, optionally straightening out the results. For example, if the player shouts "let me out" to a guard while bound and gagged, you should narrate something similar to, "At least, that's what you thought you articulated well, but it came out as a muffled 'mfm mmm mfm' instead." If the player says they lift a rock that their strength levels would certainly not allow them to lift, you can mention that the rock actually barely budged, and their backs will suffer for the attempt later on.`,
    `- NEVER end your turn by asking the player what they do, what their next move is, or prompting for input. The player already knows it is their turn. Just finish your narration and stop.`,
    `- NEVER end your turn by summarizing the player's available options. Do NOT write a final narration that lists possible paths. The player decides on their own. End on the scene, not a menu.`,
    ``,
    `Prose Quality:`,
    `- ZERO TOLERANCE FOR AI SLOP! No GPTisms. BAN generic structures and cliches: NO "somewhere X, someone Y" "doesn't X, doesn't Y," "if X, then Y," "not X, but Y," "physical punches," "practiced ease," "predatory instincts," "mechanical precision," "jaws working," "lets out a breath." Combat them with the human touch.`,
    `- CRITICAL! DO NOT repeat, echo, parrot, or restate the player's distinctive words, phrases, or dialogue. When reacting to what the player said, show interpretation or response, NOT repetition.`,
    ` EXAMPLE: "Are you a gooner?`,
    ` BAD: "Gooner?"`,
    ` GOOD: "What the hell is that supposed to mean?"`,
    `</gm_rules>`,
  );

  // ── Rating Guidelines ──
  if (ctx.rating === "nsfw") {
    sections.push(
      `<rating_guidelines>`,
      `Anything goes in this NSFW work of fiction intended for mature audiences. The user has confirmed they are over 18 and understand what they're getting into. No holding back:`,
      `- Profanities, toxicity, and dark themes will be present. Every character, the user's included, can be harmed, killed, raped, or emotionally/physically used. This goes both ways; they can also be the ones doing those things for personal gain, convictions, or pleasure.`,
      `- To maintain the integrity of the story, you may be as kind or as cruel as necessary when performing different roles. A good villain is a terrifying one, and a good hero sometimes has to make difficult choices.`,
      `- During sex, get kinky and slow down the pace. Apply anatomical (correct organs, position fatigue, physical consequences) and emotional (sexual experience and how it manifests, characters communicating throughout the coupling, aftercare) aspects to craft sensually pornographic erotica. Include foreplay and sexual acts described in great detail; the build-up is as important as the climax. Take consent for granted, assuming some lie, resist, or fight back based on their personality.`,
      `- Portray violence in gory detail, blood squirting around like in a slasher movie.`,
      `</rating_guidelines>`,
    );
  } else {
    sections.push(
      `<rating_guidelines>`,
      `This SFW work of fiction is intended for mature audiences, and the user dictates the boundaries:`,
      `- Profanity and dark themes may be present, and every character, including the user's, may be harmed or killed. However, no explicit content will be present.`,
      `- During a sex scene, cut to black and progress to the aftermath, and when portraying violence, do realistic descriptions without getting into gory details.`,
      `- Take consent for granted, assuming boundaries will be stated if required.`,
      `</rating_guidelines>`,
    );
  }

  // ── Current State ──
  // Moved to buildGmFormatReminder() so the model sees the latest
  // game state closest to generation (same rationale as active_widgets).

  // ── Server-Computed Context (narrate these, don't recalculate) ──
  if (ctx.weatherContext) {
    sections.push(`<weather_update>`, ctx.weatherContext, `</weather_update>`);
  }

  if (ctx.perceptionHints) {
    sections.push(ctx.perceptionHints);
  }

  if (ctx.moraleContext) {
    sections.push(ctx.moraleContext);
  }

  if (ctx.encounterHint) {
    sections.push(
      `<encounter_triggered>`,
      `The server rolled a random encounter. Narrate this:`,
      ctx.encounterHint,
      `</encounter_triggered>`,
    );
  }

  if (ctx.combatResults) {
    sections.push(
      `<combat_results>`,
      `The server computed these combat results. Narrate them dramatically:`,
      ctx.combatResults,
      `</combat_results>`,
    );
  }

  if (ctx.lootResults) {
    sections.push(
      `<loot_drops>`,
      `The server generated these loot drops. Describe them in-world:`,
      ctx.lootResults,
      `</loot_drops>`,
    );
  }

  if (ctx.journalRecap) {
    sections.push(`<session_journal>`, ctx.journalRecap, `</session_journal>`);
  }

  if (ctx.playerNotes?.trim()) {
    sections.push(
      `<player_notes>`,
      `The player has written the following personal notes. Consider these when narrating — they reflect what the player is tracking, their theories, and their plans:`,
      ctx.playerNotes.trim(),
      `</player_notes>`,
    );
  }

  // ── Active HUD Widgets ──
  // Moved to buildGmFormatReminder() so they sit next to <widget_commands>
  // in the last user message, keeping current state closest to generation.

  // ── Story Arc (GM SECRET — never shared with party agent) ──
  if (ctx.storyArc) {
    sections.push(`<story_arc_secret>`, ctx.storyArc, `</story_arc_secret>`);
  }

  // ── Plot Twists (GM SECRET) ──
  if (ctx.plotTwists?.length) {
    sections.push(
      `<plot_twists_secret>`,
      ctx.plotTwists.map((t, i) => `${i + 1}. ${t}`).join("\n"),
      `</plot_twists_secret>`,
    );
  }

  // ── Map (full on move/first turn, location summary otherwise) ──
  if (ctx.map) {
    const pos = ctx.map.partyPosition;
    if (ctx.playerMoved !== false || (ctx.turnNumber ?? 1) <= 1) {
      // Full map JSON — player moved or first turn
      sections.push(`<current_map>`, JSON.stringify(ctx.map, null, 2), `</current_map>`);
    } else {
      // Location summary only — player hasn't moved
      let locName: string;
      let locDesc: string | undefined;
      let neighbors: string[] = [];

      if (typeof pos === "string") {
        // Node-graph map
        const currentNode = ctx.map.nodes?.find((n) => n.id === pos);
        locName = currentNode?.label ?? pos;
        locDesc = currentNode?.description;
        neighbors = (ctx.map.edges ?? [])
          .filter((e) => e.from === pos || e.to === pos)
          .map((e) => {
            const neighborId = e.from === pos ? e.to : e.from;
            return ctx.map!.nodes?.find((n) => n.id === neighborId)?.label ?? neighborId;
          });
      } else {
        // Grid map
        const currentCell = ctx.map.cells?.find((c) => c.x === pos.x && c.y === pos.y);
        locName = currentCell?.label ?? `(${pos.x}, ${pos.y})`;
        locDesc = currentCell?.description;
        // Find adjacent cells (4-directional)
        const deltas = [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const;
        neighbors = deltas
          .map(([dx, dy]) => ctx.map!.cells?.find((c) => c.x === pos.x + dx && c.y === pos.y + dy))
          .filter((c): c is NonNullable<typeof c> => !!c && c.discovered)
          .map((c) => c.label);
      }

      sections.push(
        `<current_location>`,
        `Location: ${locName}${locDesc ? ` — ${locDesc}` : ""}`,
        ...(neighbors.length > 0 ? [`Connected to: ${neighbors.join(", ")}`] : []),
        `</current_location>`,
      );
    }
  }

  // ── NPCs ──
  if (ctx.npcs.length > 0) {
    sections.push(
      `<tracked_npcs>`,
      ...ctx.npcs.map(
        (n) =>
          `- ${n.emoji} ${n.name} (${n.location}): reputation=${n.reputation}, met=${n.met}${n.notes.length > 0 ? `, notes: ${n.notes.join("; ")}` : ""}`,
      ),
      `</tracked_npcs>`,
    );
  }

  // ── Previous Sessions (last 2 in full, older condensed to one line) ──
  if (ctx.sessionSummaries.length > 0) {
    const sorted = [...ctx.sessionSummaries].sort((a, b) => a.sessionNumber - b.sessionNumber);
    const cutoff = sorted.length - 2;
    const sessionLines: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i]!;
      if (i < cutoff) {
        // Condensed: single line
        sessionLines.push(
          `Session ${s.sessionNumber}: ${s.summary.slice(0, 200)}${s.summary.length > 200 ? "..." : ""}`,
        );
      } else {
        // Full detail
        const detail = [
          `Session ${s.sessionNumber}: ${s.summary}`,
          `Party dynamics: ${s.partyDynamics}`,
          `Key discoveries: ${s.keyDiscoveries.join(", ")}`,
        ];
        if (s.revelations?.length) {
          detail.push(`Revelations: ${s.revelations.join("; ")}`);
        }
        if (s.characterMoments?.length) {
          detail.push(`Character moments: ${s.characterMoments.join("; ")}`);
        }
        sessionLines.push(detail.join("\n"));
      }
    }
    sections.push(`<previous_sessions>`, ...sessionLines, `</previous_sessions>`);
  }

  // ── Party ──
  const partyLines: string[] = [];
  if (ctx.playerCard) {
    partyLines.push(`Player Character:\n${ctx.playerCard}`);
  } else {
    partyLines.push(`Player: ${ctx.playerName}`);
  }
  if (ctx.partyCards?.length) {
    partyLines.push(`Party Members:`);
    for (const pc of ctx.partyCards) {
      partyLines.push(pc.card);
    }
  } else if (ctx.partyNames.length > 0) {
    partyLines.push(`Party members: ${ctx.partyNames.join(", ")}`);
  }
  sections.push(`<party>`, ...partyLines, `</party>`);

  return sections.join("\n");
}

/**
 * Build the GM format reminder — injected as the last user message so the
 * output format and available commands sit closest to generation in context.
 */
export function buildGmFormatReminder(
  ctx: Pick<
    GmPromptContext,
    | "hasSceneModel"
    | "hudWidgets"
    | "turnNumber"
    | "gameActiveState"
    | "sessionNumber"
    | "gameTime"
    | "partyNames"
    | "playerName"
    | "characterSprites"
    | "playerInventory"
    | "language"
  > & {
    /** Special non-scene-advancing address mode inferred from the current player turn prefix. */
    addressMode?: "party" | "gm";
  },
): string {
  const lines: string[] = [];

  const partyNames = ctx.partyNames ?? [];
  const hasParty = partyNames.length > 0;

  // ── Current State (closest to generation) ──
  lines.push(
    `<current_state>`,
    `Game state: ${ctx.gameActiveState ?? "exploration"}`,
    `Session: #${ctx.sessionNumber ?? 1}`,
    ...(ctx.gameTime ? [`Time: ${ctx.gameTime}`] : []),
    `</current_state>`,
    ``,
  );

  lines.push(
    `<output_format>`,
    `Think HARD about your response first. Remember your Core Responsibilities and the Prose Quality that is expected of you. Then respond, following the output format below. Consider which commands to use and how to keep the player engaged.`,
    ...(ctx.language && ctx.language.toLowerCase() !== "english"
      ? [
          `LANGUAGE (MANDATORY):`,
          `Write ALL narration, dialogue, descriptions, and game text in ${ctx.language}. Only XML tags, command names, and structured field labels may remain in English.`,
          ``,
        ]
      : []),
    `VISUAL NOVEL STYLE (MANDATORY):`,
    `Every line of your output must use one of these formats:`,
    ` 1. Narration:`,
    `   Plain text, 1-4 sentences per beat. Beats separated by blank lines. DO NOT start sentences with Somewhere or Outside!`,
    ` 2. Dialogue:`,
    `   Either:`,
    `     [Name] [expression]: "Spoken text in double quotes." — Defaults to a primary dialogue bubble.`,
    `   Or:`,
    `     [Name] [type] [expression]: "Spoken text in double quotes." — Pick the [type] that fits how the line is delivered:`,
    `       - [main] Primary spoken dialogue. Displayed in the VN dialogue box with avatar and expression.`,
    `       - [side] Quick remark, banter, flavor, or an overheard quip. Shown as a floating box above the active dialogue.`,
    `       - [extra] Someone butting in or interjecting during another character's line. Use for an NPC overhearing the party (or vice versa) and chiming in. Quote the spoken text.`,
    `       - [thought] Internal monologue, unspoken to others. Styled differently in the VN box. Do NOT quote content in this one.`,
    `       - [whisper:"Target"] Quiet aside directed at a specific character (e.g. [whisper:${ctx.playerName ?? "Player"}]).`,
    `   Each bracketed tag holds a different value, bracketed tags before the colon: [Name] [type] [expression]. Never duplicate the expression (BAD: \`[Pantalone] [annoyed] [annoyed]:\`).`,
    `   Expression drives avatar sprite + reaction icon. No embedded speech inside narration lines. It's okay to end on a dialogue.`,
    ` 3. Command:`,
    `   [command_tag: parameters]`,
    `   Parsed by the engine. Append to your output as needed. Available commands are listed below.`,
    `Default expressions: happy, smirk, angry, sad, neutral, surprised, worried, battle_stance, thinking, amused, exhausted, determined, frightened.`,
    ...(ctx.characterSprites?.length
      ? [
          ``,
          `Available sprites per character (use these expression tags for accurate avatar display):`,
          ...ctx.characterSprites.map(
            (c) =>
              `  ${c.name}: ${c.expressions.join(", ")}${c.fullBody.length > 0 ? ` | full-body: ${c.fullBody.join(", ")}` : ""}`,
          ),
          `If a character has sprites listed above, prefer those expression names. For NPCs or characters without sprites, use the default list.`,
        ]
      : []),
    ``,
    `GOOD:`,
    `Snow crunches under your boots as you stumble through the pine forest.`,
    ...(hasParty
      ? [
          `[${partyNames[0]}] [smirk]: "Told you we should have taken the other path."`,
          `He pushes off the tree with theatrical grace.`,
          `[Fatui Soldier] [neutral]: "Sir, should we inform the Tsaritsa?"`,
        ]
      : [
          `[Dottore] [smirk]: "A Descender. How delightful."`,
          `He pushes off the tree with theatrical grace.`,
          `[Fatui Soldier] [neutral]: "Sir, should we inform the Tsaritsa?"`,
        ]),
    ``,
    `BAD (breaks the VN engine):`,
    `"Follow me," she said, grabbing your arm. "We don't have much time."`,
    `^ Always use [Name] [expression]: "dialogue" format instead.`,
    ``,
    `PLAYER INPUT HANDLING:`,
    `NEVER use [${ctx.playerName ?? "Player"}] [expression]: format for the player character.`,
    `If you must include it, always narrate the player's speech in second-person indirect style:`,
    `  GOOD: You smirk and admit you know you're the best.`,
    `  ALSO GOOD: [${ctx.playerName ?? "Player"}] [smirk]: You smirk and admit you know you're the best.`,
    `  BAD: [${ctx.playerName ?? "Player"}] [smirk]: "I know I'm the best."`,
    `This applies to ALL player speech, questions, agreements, reactions, thoughts; everything!`,
  );

  // ── Party Dialogue Instructions (inside output_format, closest to generation) ──
  if (hasParty) {
    lines.push(
      ``,
      `PARTY DIALOGUE:`,
      `YOU also play the party members (${partyNames.join(", ")}). Interleave their dialogue and reactions naturally within your narration, using the dialogue formats defined above.`,
      ``,
      `CRITICAL PERSONALITY SPLIT: When playing party members, you MUST switch from your GM perspective. Party members have NO access to meta-narrative knowledge: they do not know the story arc, plot twists, secret foreshadowing, or GM-only information. They know only what has been narrated and what the player has seen. They react from their own personality, motivations, and limited knowledge as defined in their character cards above.`,
      ``,
      `Expression tags are MANDATORY for every party line.`,
    );
    if (ctx.addressMode === "party") {
      lines.push(
        ``,
        `TALK-TO-PARTY MODE:`,
        `The player's input is preceded by the \`[To the party]\` part, which means this turn should be dedicated to the party discussion, and should not progress the narrative (unless the current scene is time-pressing, e.g., the party just got ambushed or is in a collapsing tunnel). Let the party members respond to the player and to each other; keep narration minimal (a breath, a shift of posture, a short beat) and let dialogue carry the scene.`,
      );
    }
  }

  if (ctx.addressMode === "gm") {
    lines.push(
      ``,
      `TALK-TO-GM MODE:`,
      `The player's input is preceded by the \`[To the GM]\` part. This is an out-of-character question or clarification addressed to you as the Game Master, not an in-scene action. Do NOT advance the scene, trigger combat, move time forward, or make characters suddenly act unless immediate danger makes that unavoidable.`,
      `Answer directly in a clear OOC GM voice using plain narration lines, focusing on clarification, lore, continuity, consequences, reminders, or what the player would reasonably know. Keep the response grounded in already-established facts and avoid inventing new scene events just to answer the question.`,
    );
  }

  lines.push(
    ``,
    `AVAILABLE COMMANDS:`,
    `Append these to your output as needed. Available commands change depending on the current game state (${ctx.gameActiveState ?? "exploration"}).`,
  );

  const state = ctx.gameActiveState ?? "exploration";

  // Always available
  lines.push(
    `- State change: [state: exploration], [state: dialogue], [state: combat], [state: travel_rest]`,
    `- NPC reputation: [reputation: npc="Name" action="helped"]`,
    `- Player choices: [choices: "Option A" | "Option B" | "Option C"]`,
    `- Dice results: [dice: 1d20+3 = 17]`,
    `- Skill check: [skill_check: skill="Perception" dc=15] — triggers a d20 + player modifier vs DC check. Result is computed automatically.`,
    `- Inventory: [inventory: action="add" item="Bronze Key, Health Potion"] or [inventory: action="remove" item="Old Map"]. You MUST emit this tag whenever the player picks up, finds, receives, buys, loots, crafts, is given, drops, uses up, sells, or otherwise gains or loses an item. Narrating an item without emitting this tag is a mistake — the player's inventory UI only reflects what these tags declare. Use one tag per action; comma-separate multiple items in the same action.`,
    `- Readable document: [Note: contents of the note] or [Book: contents of the book] — displayed as a styled overlay for the player to read. Contents are saved to their journal.`,
  );

  // State-specific commands
  if (state === "exploration" || state === "travel_rest") {
    lines.push(
      `- Map update: [map_update: <JSON>]`,
      `- Trigger combat: [combat: enemies="Enemy 1, Enemy 2"] — optionally Name:Level:HP:ATK:DEF:SPD:Element. ALWAYS pair with [state: combat] in the same message.`,
      `- End session: [session_end: reason="goal achieved"]`,
    );
  }
  if (state === "dialogue") {
    lines.push(
      `- Trigger combat: [combat: enemies="Enemy 1, Enemy 2"] — optionally Name:Level:HP:ATK:DEF:SPD:Element. ALWAYS pair with [state: combat] in the same message.`,
      `- End session: [session_end: reason="goal achieved"]`,
    );
  }
  if (state === "combat") {
    lines.push(
      `- Quick-time event: [qte: action1 | action2 | action3, timer: 5s]`,
      `- Elemental attack (narrative): [element_attack: element="pyro" target="Goblin"] — triggers a reaction popup. Use when you describe an elemental strike outside the tactical combat UI.`,
    );
  }
  if (state === "exploration") {
    lines.push(`- Quick-time event: [qte: action1 | action2 | action3, timer: 5s]`);
  }

  if (ctx.hasSceneModel) {
    lines.push(``, `Music is scored automatically — do NOT generate [music:] tags.`);
  } else {
    lines.push(
      `Music is scored automatically — do NOT generate [music:] tags.`,
      `- Sound effect: [sfx: <descriptive sound>] (e.g. [sfx: sword clash], [sfx: door creak], [sfx: explosion])`,
      `- Background: [bg: <descriptive scene>] (e.g. [bg: dark forest at night], [bg: tavern interior], [bg: black] for darkness)`,
      `- Ambient: [ambient: <descriptive atmosphere>] (e.g. [ambient: rain], [ambient: campfire crackling], [ambient: city crowd])`,
    );
  }

  // Cinematic directions + text effects: full reference on turn 1, omitted after (scene model handles them)
  if ((ctx.turnNumber ?? 1) <= 1) {
    lines.push(
      ``,
      `CINEMATIC DIRECTIONS:`,
      `- [direction: fade_from_black, duration: 3]`,
      `- [direction: fade_to_black, duration: 2]`,
      `- [direction: flash, duration: 0.3, color: #fff]`,
      `- [direction: screen_shake, duration: 0.5, intensity: 0.8]`,
      `- [direction: blur, duration: 2, intensity: 0.6, target: background]`,
      `- [direction: vignette, duration: 5, intensity: 0.7]`,
      `- [direction: letterbox, duration: 1, intensity: 0.6]`,
      `- [direction: color_grade, duration: 3, intensity: 0.5, preset: horror]`,
      `- [direction: focus, duration: 3, intensity: 0.6]`,
      `Use sparingly for dramatic beats ONLY.`,
    );
  }

  if (ctx.hudWidgets?.length) {
    const widgetLines = ctx.hudWidgets.flatMap((w) => {
      if (w.type === "stat_block" && w.config.stats?.length) {
        const hints = w.config.valueHints;
        const statLines = w.config.stats.map((s) => {
          const hint = hints?.[s.name];
          return hint ? `    ${s.name} = ${s.value} (options: ${hint})` : `    ${s.name} = ${s.value}`;
        });
        return [`- ${w.id} (${w.type}): "${w.label}"`, ...statLines];
      }
      if (w.type === "list" && w.config.items?.length) {
        const itemLines = w.config.items.map((item) => `    * ${item}`);
        return [`- ${w.id} (${w.type}): "${w.label}"`, ...itemLines];
      }
      const val = w.config.value ?? w.config.count ?? "";
      return [`- ${w.id} (${w.type}): "${w.label}" = ${val !== "" ? val : JSON.stringify(w.config)}`];
    });
    lines.push(
      ``,
      `ACTIVE HUD WIDGETS:`,
      `Your custom HUD widgets:`,
      ...widgetLines,
      ``,
      `WIDGET UPDATE COMMANDS:`,
      `Update widgets using these inline tags:`,
      `- [widget: widget-id, value: 50] bar/gauge/meter`,
      `- [widget: widget-id, stat: "Stat Name", value: 50] stat_block (value can be number or string)`,
      `- [widget: widget-id, count: 3] counter`,
      `- [widget: widget-id, add: "Iron Sword"] list (append item)`,
      `- [widget: widget-id, remove: "Old Key"] list (remove item)`,
      `- [widget: widget-id, running: true, seconds: 60] timer`,
    );
  }

  // Inventory context
  if (ctx.playerInventory?.length) {
    const invLines = ctx.playerInventory.map((i) => `  ${i.name}${i.quantity > 1 ? ` (×${i.quantity})` : ""}`);
    lines.push(``, `PLAYER INVENTORY:`, ...invLines);
  }

  lines.push(`</output_format>`);

  return lines.join("\n");
}

/** Build the setup prompt for initial game creation. */
export interface SetupPromptContext {
  rating?: "sfw" | "nsfw";
  /** Full persona card text (player character) */
  personaCard?: string | null;
  /** Full party member card texts */
  partyCards?: string[];
  /** GM character card text (if using a character as GM) */
  gmCharacterCard?: string | null;
  /** Enable custom HUD widgets in the game blueprint */
  enableCustomWidgets?: boolean;
  /** Selected constant lorebook canon to bake into world generation */
  lorebookContext?: string | null;
  /** Language for natural-language JSON values */
  language?: string;
}

export function buildSetupPrompt(ctx: SetupPromptContext = {}): string {
  const rating = ctx.rating ?? "sfw";
  const ratingBlock =
    rating === "nsfw"
      ? [
          `<rating>`,
          `Anything goes in this NSFW work of fiction intended for mature audiences. The user has confirmed they are over 18 and understand what they're getting into. No holding back:`,
          ` - Profanities, toxicity, and dark themes will be present. Every character, the user's included, can be harmed, killed, raped, or emotionally/physically used. This goes both ways; they can also be the ones doing those things for personal gain, convictions, or pleasure.`,
          ` - To maintain the integrity of the story, you may be as kind or as cruel as necessary when performing different roles. A good villain is a terrifying one, and a good hero sometimes has to make difficult choices.`,
          ` - During sex, get kinky and slow down the pace. Apply anatomical (correct organs, position fatigue, physical consequences) and emotional (sexual experience and how it manifests, characters communicating throughout the coupling, aftercare) aspects to craft sensually pornographic erotica. Include foreplay and sexual acts described in great detail; the build-up is as important as the climax. Take consent for granted, assuming some lie, resist, or fight back based on their personality.`,
          ` - Portray violence in gory detail, blood squirting around like in a slasher movie.`,
          `</rating>`,
        ].join("\n")
      : [
          `<rating>`,
          `This SFW work of fiction is intended for mature audiences, and the user dictates the boundaries:`,
          ` - Profanity and dark themes may be present, and every character, including the user's, may be harmed or killed. However, no explicit content will be present.`,
          ` - During a sex scene, cut to black and progress to the aftermath, and when portraying violence, do realistic descriptions without getting into gory details.`,
          ` - Take consent for granted, assuming boundaries will be stated if required.`,
          `</rating>`,
        ].join("\n");

  // Build persona + party sections for the system prompt
  const contextSections: string[] = [];
  if (ctx.gmCharacterCard) {
    contextSections.push(
      `<gm_character>`,
      `You will adopt this character's personality and perspective as the Game Master:`,
      ctx.gmCharacterCard,
      `</gm_character>`,
    );
  }
  if (ctx.personaCard) {
    contextSections.push(`<user_player>`, `The player's character:`, ctx.personaCard, `</user_player>`);
  }
  if (ctx.partyCards?.length) {
    contextSections.push(`<party_info>`, `Party members accompanying the player:`, ...ctx.partyCards, `</party_info>`);
  }
  if (ctx.lorebookContext?.trim()) {
    contextSections.push(
      `<lorebook_context>`,
      `Selected constant lorebook canon that MUST be treated as true for this world:`,
      ctx.lorebookContext.trim(),
      `</lorebook_context>`,
    );
  }

  return [
    `You are the Game Master preparing a new RPG campaign.`,
    `The player has given you their preferences. Absorb them fully into your creative output. Do NOT echo them back.`,
    ``,
    `Your job: design a complete game world with story, characters, and visual presentation. Do NOT write any narration or opening scene. That happens separately after you build the world.`,
    ``,
    ...(ctx.language && ctx.language.toLowerCase() !== "english"
      ? [
          `<language>`,
          `Write every natural-language string value in the JSON output in ${ctx.language}. This includes worldOverview, storyArc, plotTwists, descriptions, arcs, labels, and any other prose. Keep ONLY the JSON keys and structural syntax in English.`,
          `</language>`,
          ``,
        ]
      : []),
    `CRITICAL: Your response MUST be a single JSON object using the EXACT keys shown in the <output_format> template below. Do NOT invent your own keys. Do NOT rename fields. The keys "worldOverview", "storyArc", "plotTwists", "startingMap", "startingNpcs", "partyArcs", "characterCards", and "blueprint" are MANDATORY and must appear at the top level. The system will reject any response that uses different key names.`,
    ``,
    ...(ctx.enableCustomWidgets !== false
      ? [
          `<blueprint_widget_types>`,
          `Available HUD widget types for the blueprint:`,
          `  progress_bar: config = { value: number, max: number }`,
          `  gauge: config = { value: number, max: number, dangerBelow?: number }`,
          `  relationship_meter: config = { value: number, max: number, milestones?: [{ value: number, label: string }] }`,
          `  counter: config = { count: number }`,
          `  stat_block: config = { stats: [{ name: string, value: string|number }] }`,
          `  list: config = { items: string[] }`,
          `  timer: config = { seconds: number, running: boolean }`,
          ``,
          `Design up to 4 widgets that fit the genre. IMPORTANT: Party member bonds/reputation MUST be a SINGLE stat_block widget with one stat per member (e.g. stats: [{name: "🐱 Nadia", value: 50}, {name: "⚔️ Vlad", value: 30}]) — do NOT create separate widgets per party member. That single widget counts as 1 of 4.`,
          `Romance = stat_block for bonds + mood gauge. Horror = sanity gauge + clue list. RPG = health/mana bars.`,
          `Inventory is handled separately — do NOT create inventory widgets.`,
          `</blueprint_widget_types>`,
          ``,
        ]
      : []),
    `<intro_effects>`,
    `Available cinematic intro effects (played when the game first loads):`,
    `  fade_from_black (duration) — RECOMMENDED for most games. Classic cinema opening.`,
    `  fade_to_black (duration),`,
    `  blur (duration, intensity 0-1, target "background"|"content"|"all"),`,
    `  vignette (duration, intensity 0-1),`,
    `  letterbox (duration, intensity 0-1),`,
    `  color_grade (duration, intensity, preset "warm"|"cold_blue"|"horror"|"noir"|"vintage"|"neon"|"dreamy"),`,
    `  focus (duration, intensity)`,
    `</intro_effects>`,
    ``,
    ratingBlock,
    ``,
    ...(contextSections.length > 0 ? [...contextSections, ``] : []),
    `<output_format>`,
    `Your ENTIRE response must be a single valid JSON object matching this exact template. Replace the placeholder values with your creative content. Do NOT add extra keys.`,
    ``,
    `{`,
    `  "worldOverview": "2-3 vivid paragraphs describing the world, its history, factions, and atmosphere. This is shown to the player as their introduction to the setting. When writing this part, DO NOT start sentences with Outside or Somewhere! ZERO TOLERANCE FOR AI SLOP! No GPTisms. BAN generic structures and cliches; NO 'doesn't X, doesn't Y,' 'if X, then Y,' 'not X, but Y,' 'physical punches,' 'practiced ease,' 'predatory instincts,' 'mechanical precision,' 'jaws working,' 'lets out a breath.' Combat them with the human touch.",`,
    `  "storyArc": "SECRET. The overarching narrative arc: main quest, central antagonist, escalating stakes, and endgame conditions. The player never sees this directly. Be creative and verbose.",`,
    `  "plotTwists": [`,
    `    "SECRET twist 1: a specific unexpected revelation or betrayal",`,
    `    "SECRET twist 2: ...",`,
    `    "SECRET twist 3: ..."`,
    `  ],`,
    `  "startingMap": {`,
    `    "name": "Area Name",`,
    `    "description": "Brief area overview",`,
    `    "regions": [`,
    `      {`,
    `        "id": "region_1",`,
    `        "name": "Short Name (max 12 chars! Displayed on tiny node map. e.g. 'Old Quarter', 'Bazaar', 'Docks')",`,
    `        "description": "What this place looks like and why it matters",`,
    `        "type": "town|wilderness|dungeon|building|camp|other",`,
    `        "connectedTo": ["region_2"],`,
    `        "discovered": true`,
    `      }`,
    `    ]`,
    `  },`,
    `  "startingNpcs": [`,
    `    {`,
    `      "name": "NPC Name",`,
    `      "role": "merchant|quest_giver|ally|antagonist|neutral|other",`,
    `      "description": "Personality, appearance, motivation in 1-2 sentences",`,
    `      "location": "region_1",`,
    `      "reputation": 0`,
    `      "_note_reputation": "integer: 0 = neutral, positive = friendly, negative = hostile"`,
    `    }`,
    `  ],`,
    `  "partyArcs": [`,
    `    {`,
    `      "name": "Exact party member name from the Party Members list",`,
    `      "arc": "A personal side-quest or character arc centered on this party member. A secret from their past, an old enemy, a personal mission, a moral dilemma, or a relationship they need to resolve. 2-3 sentences.",`,
    `      "goal": "Their concrete personal goal that drives this arc, e.g. 'Find the sister who vanished during the Collapse' or 'Earn enough to buy back the family estate'"`,
    `    }`,
    `  ],`,
    `  "characterCards": [`,
    `    {`,
    `      "name": "Exact party member or player persona name",`,
    `      "shortDescription": "One-sentence character summary for this game's context",`,
    `      "class": "Their class/role/archetype in this game (e.g. Rogue, Diplomat, Pyro Vision Holder)",`,
    `      "abilities": ["Ability 1 — brief description", "Ability 2 — brief description"],`,
    `      "strengths": ["Strength 1", "Strength 2"],`,
    `      "weaknesses": ["Weakness 1", "Weakness 2"],`,
    `      "extra": { "key": "value pairs for any other relevant info, e.g. gender, title, affiliation, element, rank" }`,
    `    }`,
    `  ],`,
    `  "artStylePrompt": "A concise image generation style prompt (20-40 words) describing the unified visual art style for ALL generated images in this game. Examples: 'Watercolor fantasy illustration, soft edges, warm palette, Ghibli-inspired' or 'Dark gothic oil painting, dramatic chiaroscuro lighting, muted colors, baroque details'. Match the genre and tone.",`,
    `  "blueprint": {`,
    ...(ctx.enableCustomWidgets !== false
      ? [
          `    "hudWidgets": [`,
          `      {`,
          `        "id": "widget_unique_id",`,
          `        "type": "progress_bar|gauge|relationship_meter|counter|stat_block|list|timer",`,
          `        "label": "Display Name",`,
          `        "icon": "emoji",`,
          `        "position": "hud_left|hud_right",`,
          `        "accent": "#hexcolor",`,
          `        "config": {`,
          `          "_note_config": "Set initial values: value+max for bars/gauges, count for counters, stats for stat_blocks, items for lists, seconds for timers.",`,
          `          "_note_valueHints": "For stat_block widgets with string values, add valueHints: {statName: 'option1 | option2 | option3'} so the scene model knows the valid choices. Example: for a 'class' stat, valueHints: {'class': 'alpha | omega | beta'}"`,
          `        }`,
          `      }`,
          `    ],`,
          `    "startingInventory": ["item1", "item2"],`,
        ]
      : []),
    `    "introSequence": [`,
    `      { "effect": "fade_from_black", "duration": number },`,
    `      { "effect": "vignette", "duration": number, "intensity": number }`,
    `    ],`,
    `    "visualTheme": {`,
    `      "palette": "dark_warm|cold|pastel|neon|earth|monochrome",`,
    `      "uiStyle": "parchment|glass|metal|holographic|organic|minimal",`,
    `      "moodDefault": "mysterious|cheerful|tense|romantic|epic|melancholic"`,
    `    }`,
    `  }`,
    `}`,
    ``,
    `Use EXACTLY these top-level keys: worldOverview, storyArc, plotTwists, startingMap, startingNpcs, partyArcs, characterCards, artStylePrompt, blueprint. No other top-level keys. No wrapper objects.`,
    `</output_format>`,
  ].join("\n");
}

/** Build a session summary prompt. */
export function buildSessionSummaryPrompt(): string {
  return [
    `Summarize this game session comprehensively. Include:`,
    ``,
    `1. **summary**: Narrative recap of key events (2–3 paragraphs)`,
    `2. **partyDynamics**: How party member relationships evolved this session`,
    `3. **partyState**: Current condition of the party (HP, morale, resources)`,
    `4. **keyDiscoveries**: Array of important plot points, quests, and lore learned`,
    `5. **revelations**: Array of major story revelations or plot-critical moments (e.g. "Discovered the king is actually the necromancer", "The artifact is a fake"). Only include genuinely significant twists or reveals. Empty array if none.`,
    `6. **characterMoments**: Array of notable personal moments between the player and specific characters (e.g. "Went on a date with Elara at the moonlit garden", "Scaramouche opened up about his past", "Betrayed Dottore's trust by stealing the research"). Include romantic, bonding, betrayal, and emotional beats. Empty array if none.`,
    `7. **npcUpdates**: Array of NPC reputation changes and new NPCs met`,
    `8. **statsSnapshot**: Current party stats, inventory, and quest states`,
    ``,
    `Output as JSON with exactly these keys.`,
  ].join("\n");
}

/** Build the prompt for adjusting party character cards at session end. */
export function buildCardAdjustmentPrompt(): string {
  return [
    `You are the Game Master reviewing what happened during this session to decide how the party's character cards should evolve.`,
    ``,
    `Based on the session summary and current cards, decide for EACH character whether their card should change. Changes are OPTIONAL — only adjust what makes narrative sense:`,
    `- **abilities**: Add new abilities the character learned or demonstrated. Remove abilities that were lost or superseded.`,
    `- **strengths**: Update if the character developed new strengths or overcame weaknesses.`,
    `- **weaknesses**: Update if the character gained new vulnerabilities or overcame old ones.`,
    `- **shortDescription**: Update only if the character's identity meaningfully shifted.`,
    `- **class**: Update only if the character evolved into a new class/role (e.g. "Apprentice Mage" → "Battlemage").`,
    `- **rpgStats**: Adjust attribute values (±1–3 per session), HP max, etc. Small incremental changes only.`,
    ``,
    `RULES:`,
    `- Return the FULL updated card for each character, even if only one field changed.`,
    `- If a character needs NO changes, return their card unchanged.`,
    `- Be conservative — only make changes that are clearly justified by session events.`,
    `- This represents organic character growth, not sudden transformation.`,
    ``,
    `Output as a JSON array of character card objects, one per character, with the same structure as the input cards.`,
  ].join("\n");
}
