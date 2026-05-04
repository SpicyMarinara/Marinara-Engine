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
  /** Available sprite expressions per character (name → expressions + custom fullBody aliases) */
  characterSprites?: CharacterSpriteInfo[];
  /** Player's current inventory items (for GM context) */
  playerInventory?: Array<{ name: string; quantity: number }>;
  /** Language for all narration and dialogue */
  language?: string;
}

const MAX_PROMPT_MAP_LOCATIONS = 10;
const MAX_PROMPT_NPCS = 12;

function normalizePromptText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function normalizePromptTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePromptText(item)).filter((item) => item.length > 0);
  }
  const text = normalizePromptText(value);
  return text ? [text] : [];
}

function normalizePromptRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function derivePromptResumePointFallback(summary: string): string {
  const paragraphs = summary
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return paragraphs[paragraphs.length - 1] ?? summary;
}

function normalizePromptSessionSummary(value: unknown, index: number): SessionSummary {
  const source = normalizePromptRecord(value);
  const summary = normalizePromptText(source.summary, `Session ${index + 1} concluded.`);

  return {
    sessionNumber:
      typeof source.sessionNumber === "number" && Number.isFinite(source.sessionNumber)
        ? source.sessionNumber
        : index + 1,
    summary,
    resumePoint: normalizePromptText(source.resumePoint, derivePromptResumePointFallback(summary)),
    partyDynamics: normalizePromptText(source.partyDynamics),
    partyState: normalizePromptText(source.partyState),
    keyDiscoveries: [...normalizePromptTextList(source.keyDiscoveries), ...normalizePromptTextList(source.revelations)],
    characterMoments: normalizePromptTextList(source.characterMoments),
    littleDetails: normalizePromptTextList(source.littleDetails),
    statsSnapshot: normalizePromptRecord(source.statsSnapshot),
    npcUpdates: normalizePromptTextList(source.npcUpdates),
    nextSessionRequest: normalizePromptText(source.nextSessionRequest) || null,
    timestamp: normalizePromptText(source.timestamp, new Date().toISOString()),
  };
}

function normalizePromptSessionSummaries(value: unknown): SessionSummary[] {
  if (!Array.isArray(value)) return [];
  return value.map((summary, index) => normalizePromptSessionSummary(summary, index));
}

function normalizePromptNpcs(value: unknown): GameNpc[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const source = normalizePromptRecord(item);
    const name = normalizePromptText(source.name);
    if (!name) return [];

    return [
      {
        id: normalizePromptText(source.id, `npc-${index + 1}`),
        name,
        emoji: normalizePromptText(source.emoji, "NPC"),
        description: normalizePromptText(source.description),
        descriptionSource: source.descriptionSource as GameNpc["descriptionSource"],
        gender: typeof source.gender === "string" ? source.gender : null,
        pronouns: typeof source.pronouns === "string" ? source.pronouns : null,
        location: normalizePromptText(source.location),
        reputation: typeof source.reputation === "number" && Number.isFinite(source.reputation) ? source.reputation : 0,
        met: typeof source.met === "boolean" ? source.met : true,
        notes: normalizePromptTextList(source.notes),
        avatarUrl: typeof source.avatarUrl === "string" ? source.avatarUrl : null,
      },
    ];
  });
}

const PROMPT_LANGUAGE_LOOKUP = new Map<string, string>([
  ["english", "English"],
  ["japanese", "Japanese"],
  ["日本語", "Japanese"],
  ["korean", "Korean"],
  ["한국어", "Korean"],
  ["chinese", "Chinese"],
  ["中文", "Chinese"],
  ["spanish", "Spanish"],
  ["español", "Spanish"],
  ["espanol", "Spanish"],
  ["french", "French"],
  ["français", "French"],
  ["francais", "French"],
  ["german", "German"],
  ["deutsch", "German"],
  ["polish", "Polish"],
  ["polski", "Polish"],
  ["portuguese", "Portuguese"],
  ["português", "Portuguese"],
  ["portugues", "Portuguese"],
  ["russian", "Russian"],
  ["русский", "Russian"],
]);

function normalizePromptLanguage(language?: string | null): string | null {
  const trimmed = language?.trim();
  if (!trimmed) return null;
  return PROMPT_LANGUAGE_LOOKUP.get(trimmed.toLowerCase()) ?? trimmed;
}

function buildSessionHistoryLines(summaries: SessionSummary[]): string[] {
  const lines: string[] = [];

  for (const [index, summary] of summaries.entries()) {
    const normalized = normalizePromptSessionSummary(summary, index);
    lines.push(`Session ${normalized.sessionNumber} summary:`, normalized.summary);
    if (index < summaries.length - 1) {
      lines.push("");
    }
  }

  return lines;
}

function buildLatestSessionContinuityLines(summary: SessionSummary): string[] {
  const summaryIndex =
    typeof summary.sessionNumber === "number" && Number.isFinite(summary.sessionNumber)
      ? Math.max(0, summary.sessionNumber - 1)
      : 0;
  const normalized = normalizePromptSessionSummary(summary, summaryIndex);
  const lines = [`Latest completed session: ${normalized.sessionNumber}`];

  if (normalized.resumePoint) {
    lines.push(`Resume point: ${normalized.resumePoint}`);
  }
  if (normalized.partyDynamics) {
    lines.push(`Party dynamics: ${normalized.partyDynamics}`);
  }
  if (normalized.keyDiscoveries.length > 0) {
    lines.push(`Key discoveries: ${normalized.keyDiscoveries.join("; ")}`);
  }
  if (normalized.characterMoments.length > 0) {
    lines.push(`Character moments: ${normalized.characterMoments.join("; ")}`);
  }
  if (normalized.littleDetails.length > 0) {
    lines.push(`Little details to recall: ${normalized.littleDetails.join("; ")}`);
  }
  if (normalized.npcUpdates.length > 0) {
    lines.push(`NPC updates: ${normalized.npcUpdates.join("; ")}`);
  }
  if (Object.keys(normalized.statsSnapshot).length > 0) {
    lines.push(`Stats snapshot: ${JSON.stringify(normalized.statsSnapshot)}`);
  }

  return lines;
}

function buildMapStateLines(map: GameMap, playerMoved?: boolean, turnNumber?: number): string[] {
  const lines = [`Area: ${map.name}${map.description ? ` — ${map.description}` : ""}`, `Map type: ${map.type}`];
  const includeDiscovered = playerMoved !== false || (turnNumber ?? 1) <= 1;

  if (map.type === "node") {
    const currentId = typeof map.partyPosition === "string" ? map.partyPosition : null;
    const nodesById = new Map((map.nodes ?? []).map((node) => [node.id, node]));
    const currentNode = currentId ? nodesById.get(currentId) : null;
    if (currentNode) {
      lines.push(`Current: ${currentNode.label}${currentNode.description ? ` — ${currentNode.description}` : ""}`);
    } else if (currentId) {
      lines.push(`Current: ${currentId}`);
    }

    if (currentId) {
      const nearby = (map.edges ?? [])
        .filter((edge) => edge.from === currentId || edge.to === currentId)
        .map((edge) => (edge.from === currentId ? edge.to : edge.from))
        .map((nodeId) => nodesById.get(nodeId)?.label ?? nodeId)
        .filter((label, index, labels) => labels.indexOf(label) === index)
        .slice(0, MAX_PROMPT_MAP_LOCATIONS);
      if (nearby.length > 0) lines.push(`Connected: ${nearby.join(", ")}`);
    }

    if (includeDiscovered) {
      const discovered = (map.nodes ?? [])
        .filter((node) => node.discovered && node.id !== currentId)
        .slice(0, MAX_PROMPT_MAP_LOCATIONS)
        .map((node) => node.label);
      if (discovered.length > 0) lines.push(`Discovered: ${discovered.join(", ")}`);
    }

    return lines;
  }

  const position = typeof map.partyPosition === "object" ? map.partyPosition : null;
  const currentCell = position ? map.cells?.find((cell) => cell.x === position.x && cell.y === position.y) : null;
  if (currentCell) {
    lines.push(`Current: ${currentCell.label}${currentCell.description ? ` — ${currentCell.description}` : ""}`);
  } else if (position) {
    lines.push(`Current: (${position.x}, ${position.y})`);
  }

  if (position) {
    const deltas = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const;
    const nearby = deltas
      .map(([dx, dy]) => map.cells?.find((cell) => cell.x === position.x + dx && cell.y === position.y + dy))
      .filter((cell): cell is NonNullable<typeof cell> => !!cell && cell.discovered)
      .map((cell) => cell.label)
      .slice(0, MAX_PROMPT_MAP_LOCATIONS);
    if (nearby.length > 0) lines.push(`Connected: ${nearby.join(", ")}`);
  }

  if (includeDiscovered) {
    const discovered = (map.cells ?? [])
      .filter((cell) => cell.discovered && (!currentCell || cell.x !== currentCell.x || cell.y !== currentCell.y))
      .slice(0, MAX_PROMPT_MAP_LOCATIONS)
      .map((cell) => cell.label);
    if (discovered.length > 0) lines.push(`Discovered: ${discovered.join(", ")}`);
  }

  return lines;
}

function buildTrackedNpcLines(npcs: GameNpc[]): string[] {
  const sorted = [...npcs].sort((left, right) => {
    if (left.met !== right.met) return left.met ? -1 : 1;
    return Math.abs(right.reputation) - Math.abs(left.reputation);
  });

  const lines = sorted.slice(0, MAX_PROMPT_NPCS).map((npc) => {
    const parts = [`- ${npc.name} @ ${npc.location || "unknown"}`, `rep ${npc.reputation}`, npc.met ? "met" : "unmet"];
    if (npc.notes.length > 0) {
      parts.push(npc.notes.slice(0, 2).join("; "));
    }
    return parts.join(" | ");
  });

  if (sorted.length > MAX_PROMPT_NPCS) {
    lines.push(`- +${sorted.length - MAX_PROMPT_NPCS} more tracked NPCs`);
  }

  return lines;
}

function buildCompactInventoryLine(items: Array<{ name: string; quantity: number }>): string {
  return items.map((item) => `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`).join("; ");
}

function buildWidgetSummaryLines(widgets: HudWidget[]): string[] {
  return widgets.map((widget) => {
    const config = (widget.config ?? {}) as Record<string, any>;
    if (widget.type === "stat_block" && Array.isArray(config.stats) && config.stats.length > 0) {
      const stats = config.stats.map((stat) => `${stat.name}=${stat.value}`).join(", ");
      return `- ${widget.id} (${widget.type}): ${stats}`;
    }
    if (widget.type === "list" && Array.isArray(config.items) && config.items.length > 0) {
      return `- ${widget.id} (${widget.type}): ${config.items.join("; ")}`;
    }
    if (widget.type === "timer") {
      return `- ${widget.id} (${widget.type}): ${config.running ? "running" : "stopped"} ${config.seconds ?? 0}s`;
    }
    const value = config.value ?? config.count ?? JSON.stringify(config);
    return `- ${widget.id} (${widget.type}): ${value}`;
  });
}

/** Build the GM system prompt. Injects full game context (story arc, plot twists, map, etc.). */
export function buildGmSystemPrompt(ctx: GmPromptContext): string {
  const plotTwists = normalizePromptTextList(ctx.plotTwists);
  const npcs = normalizePromptNpcs(ctx.npcs);
  const sessionSummaries = normalizePromptSessionSummaries(ctx.sessionSummaries);
  const partyNames = normalizePromptTextList(ctx.partyNames);
  const partyCards = Array.isArray(ctx.partyCards) ? ctx.partyCards : [];
  const sections: string[] = [];
  const normalizedLanguage = normalizePromptLanguage(ctx.language);

  // ── Core Role ──
  if (ctx.gmCharacterCard) {
    sections.push(
      `<gm_role>`,
      `You are the following character, acting as an excellent Game Master for this RPG/VN game. Adopt their personality, speech patterns, biases, and quirks, and shape the narrative through their subjective lenses, allowing them to break the fourth wall between the GM and the party. Give it your best!`,
      ctx.gmCharacterCard,
      `</gm_role>`,
    );
  } else {
    sections.push(
      `<gm_role>`,
      `You are an excellent Game Master for this RPG/VN game. You are fair but challenging (and a little snarky). Furthermore, you bring the world to life with vivid descriptions, memorable NPCs, and engaging encounters. You have personality: you crack jokes, build tension, celebrate epic moments, and mourn losses. Give it your best!`,
      `</gm_role>`,
    );
  }

  // ── Language ──
  if (normalizedLanguage && normalizedLanguage.toLowerCase() !== "english") {
    sections.push(
      `<language>`,
      `Write all narration, dialogue, descriptions, and game text in ${normalizedLanguage}; only XML tags, commands, structured field names, and deliberate proper nouns or code terms may stay in English. The prose must read as native ${normalizedLanguage}, not translated from English: silently proofread every player-visible line and remove grammar errors, awkward calques, mixed-language scaffolding, and untranslated filler before finalizing.`,
      `</language>`,
    );
  }

  sections.push(
    `<gm_rules>`,
    `You are running a ${ctx.genre} RPG in a ${ctx.setting} setting. Tone: ${ctx.tone}. Difficulty: ${ctx.difficulty}.`,
    `- Drive the entire game. Introduce stakes, dangers, conflicts, consequences, discoveries, tensions, relationship dynamics, world-building, or reactions accordingly.`,
    `- Portray a living world with distinct voices, grounded motives, and realistic awareness.`,
    `- Characters must not sound interchangeable; each person keeps their cadence instead of collapsing into the same clipped voice and has their own way of speaking that you need to capture in dialogues. Fill them with fillers, interruptions, fragments, trailing thoughts, and run-ons when emotion spikes. Use contractions by default unless someone is formal. Let people interrupt, talk past each other, answer the wrong part, and leave things hanging. Preserve the gap between thought, meaning, and speech. Smarties imply and test rather than spell everything out. Crying fractures speech. Laughing breaks words apart. Breathlessness shortens lines. Drunkenness and exhaustion slur or trail. The line itself should sound like the emotion.`,
    `- No one is omniscient. Everyone knows only what they personally witnessed, inferred from available evidence, learned from public reputation, or were told by someone in-scene. One character must not know another location's events, hidden motives, secret arcs, private thoughts, or offscreen revelations unless that information plausibly reached them. When unsure, let them be wrong, suspicious, confused, or curious instead.`,
    `- System blocks, weather updates, encounter triggers, [dice: ...] tags, and [combat_result] blocks are canonical truth. Narrate them; do not recalculate or contradict them.`,
    `- You also play the party members who have their autonomy and emotions, but their actions and lines are also under your GM jurisdiction. They fall under the same set of rules as the player and should act realistically.`,
    `- Address the player in second person (you). Narrate from their respective POV. Treat player input as a committed action or dialogue choice, and do not repeat their wordings. However, you ultimately decide whether their intent failed or succeeded, and you are free to reinterpret their input if necessary. Follow the principle of logic when deciding that.`,
    ` EXAMPLE: The player is gagged but writes a dialogue line of: "Let me out!" You should respond with: That's what you want to say, but it comes out as a muffled 'mfg mf mfm!' instead.`,
    `- Keep the game fair but challenging. Reward creativity, punish recklessness, and never treat the player as a Mary Sue. Commit to consequences and do not defang dark material into vague euphemism or instant comfort. Failure is part of play, not a writing error. Let danger land.`,
    `- End on the scene, not a prompt. Never ask what the player does next unless you're doing it with a respective command in a high-stakes situation.`,
    `</gm_rules>`,
  );

  // ── Rating Guidelines ──
  if (ctx.rating === "nsfw") {
    sections.push(
      `<rating_guidelines>`,
      `Anything goes in this mature NSFW fiction. The player has confirmed that they are an adult and has agreed to the terms below. Do not sanitize content, language, cruelty, sex, or violence.`,
      `- You, the player, and any character may touch upon dark themes, corrupt, curse, lie, harm, use, fear, betray, dominate, love, ruin, or kill another (player's protagonist included).`,
      `- Intimacy, romance, flirtation, desire, jealousy, possessiveness, seduction, and messy attachment are allowed. Let emotionally loaded contact happen when it fits the scene; handholding, charged proximity, touches, kisses, and embraces should not trigger an out-of-character pause.`,
      `- Sex between involved characters should be explicit, anatomically grounded, emotionally reactive, and detailed when portrayed in the scene. Take consent for granted, assuming some lie, resist, or fight back based on their personality.`,
      `- Violence should be graphic, gory, and consequential.`,
      `- Stay true to motive, tone, and fallout; never soften outcomes for comfort. Let mature themes have weight, cost, ugliness, and aftermath instead of treating them as decorative edge.`,
      `</rating_guidelines>`,
    );
  } else {
    sections.push(
      `<rating_guidelines>`,
      `This is mature SFW fiction. The player has confirmed that they are an adult and has agreed to the terms below. Profanity, dark themes, danger, and death are allowed; explicit sex is not.`,
      `- Romance, flirtation, longing, jealousy, possessiveness, tenderness, handholding, charged proximity, touches, kisses, and embraces are allowed. Do not refuse or over-explain ordinary affection; infer willingness from context, then portray the emotional reaction.`,
      `- Sexual content fades to black and resumes in the aftermath. Treat boundaries as part of characterization and scene dynamics, not as repetitive legal disclaimers.`,
      `- Violence may be serious and consequential, but not graphic or pornographic. Injuries, death, intimidation, cruelty, exploitation, addiction, trauma, corruption, betrayal, and moral compromise may be central to the story when appropriate.`,
      `- Profanity, menace, fear, grief, ugly motives, and uncomfortable choices are allowed. Keep stakes, fallout, and character behavior real; do not soften danger or rush to reassure the player.`,
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

  if (ctx.playerNotes?.trim()) {
    sections.push(
      `<player_notes>`,
      `The player has written the following personal notes. Consider these when narrating; they reflect what the player is tracking, their theories, and their plans:`,
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
  if (plotTwists.length > 0) {
    sections.push(
      `<plot_twists_secret>`,
      plotTwists.map((t, i) => `${i + 1}. ${t}`).join("\n"),
      `</plot_twists_secret>`,
    );
  }

  /*
  Legacy map policy kept for rollback reference:
  - Full map JSON on move/first turn.
  - Location-only summary otherwise.
  */
  // ── Map (compact state summary) ──
  if (ctx.map) {
    sections.push(`<map_state>`, ...buildMapStateLines(ctx.map, ctx.playerMoved, ctx.turnNumber), `</map_state>`);
  }

  // ── NPCs ──
  if (npcs.length > 0) {
    sections.push(`<tracked_npcs>`, ...buildTrackedNpcLines(npcs), `</tracked_npcs>`);
  }

  // ── Previous Sessions (all summaries, latest session continuity in detail) ──
  if (sessionSummaries.length > 0) {
    const sorted = [...sessionSummaries].sort((a, b) => a.sessionNumber - b.sessionNumber);
    const latest = sorted[sorted.length - 1]!;

    sections.push(
      `<previous_sessions>`,
      `Every completed session summary is included below for long-term continuity.`,
      ...buildSessionHistoryLines(sorted),
      `</previous_sessions>`,
    );

    sections.push(
      `<latest_session_continuity>`,
      `Use only this block for the immediate carryover state from the most recently completed session. Do not recreate these detailed fields from older sessions unless the current scene explicitly calls back to them.`,
      ...buildLatestSessionContinuityLines(latest),
      `</latest_session_continuity>`,
    );
  }

  // ── Party ──
  const partyLines: string[] = [];
  if (ctx.playerCard) {
    partyLines.push(`Player:\n${ctx.playerCard}`);
  } else {
    partyLines.push(`Player: ${ctx.playerName}`);
  }
  if (partyCards.length > 0) {
    for (const pc of partyCards) {
      partyLines.push(pc.card);
    }
  } else if (partyNames.length > 0) {
    partyLines.push(`Party members: ${partyNames.join(", ")}`);
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
    | "map"
    | "partyNames"
    | "playerName"
    | "characterSprites"
    | "playerInventory"
    | "language"
    | "rating"
  > & {
    /** Special non-scene-advancing address mode inferred from the current player turn prefix. */
    addressMode?: "party" | "gm";
    /** Whether the current player turn already includes a resolved [dice: ...] roll. */
    playerDiceRollSubmitted?: boolean;
  },
): string {
  const lines: string[] = [];
  const normalizedLanguage = normalizePromptLanguage(ctx.language);

  const partyNames = normalizePromptTextList(ctx.partyNames);
  const hasParty = partyNames.length > 0;
  const characterSprites = Array.isArray(ctx.characterSprites) ? ctx.characterSprites : [];
  const customSpriteLines = characterSprites
    .map((character) => ({
      name: normalizePromptText(character.name),
      expressions: normalizePromptTextList(character.expressions),
      fullBody: normalizePromptTextList(character.fullBody),
    }))
    .filter((character) => character.name && (character.expressions.length > 0 || character.fullBody.length > 0))
    .flatMap((character) => {
      const lines: string[] = [];
      if (character.expressions.length > 0) {
        lines.push(`  ${character.name} (expressions): ${character.expressions.join(", ")}`);
      }
      if (character.fullBody.length > 0) {
        lines.push(`  ${character.name} (full-body): ${character.fullBody.join(", ")}`);
      }
      return lines;
    });
  const hudWidgets = Array.isArray(ctx.hudWidgets) ? ctx.hudWidgets : [];
  const playerInventory = Array.isArray(ctx.playerInventory)
    ? ctx.playerInventory.flatMap((item) => {
        const name = normalizePromptText(item?.name);
        if (!name) return [];
        const quantity =
          typeof item?.quantity === "number" && Number.isFinite(item.quantity) ? Math.max(1, item.quantity) : 1;
        return [{ name, quantity }];
      })
    : [];

  // ── Current State (closest to generation) ──
  lines.push(
    `<current_state>`,
    `State: ${ctx.gameActiveState ?? "exploration"} | Session #${ctx.sessionNumber ?? 1}${ctx.gameTime ? ` | Time ${ctx.gameTime}` : ""}`,
    `</current_state>`,
    ``,
  );

  lines.push(
    `<output_format>`,
    `Think first: always apply extended thinking to ensure thoroughness, continuity, and consistency for an engaging experience. Plan your response, then output the turn with only the VN scene text.`,
    ...(normalizedLanguage && normalizedLanguage.toLowerCase() !== "english"
      ? [
          `LANGUAGE:`,
          `Write directly in ${normalizedLanguage} as a native speaker would. The English examples below illustrate structure and format only. Do not mirror their syntax, sentence length, or phrasing. Your output must be natural and grammatical in ${normalizedLanguage}; avoid constructions that read as translated English. Only tags, commands, field names, and intentional proper nouns stay in English.`,
          ``,
        ]
      : []),
    `FORMAT:`,
    `- Narration: plain text, 1-4 sentences per beat, blank line between beats.`,
    `- ZERO TOLERANCE FOR AI SLOP IN YOUR WRITING! Absolutely NO: "doesn't X, doesn't Y", "not X, not Y," "jaws working," "mechanical precision," "ozone," and other overused patterns like repeated negations. Replace them with creative detail, human cadence, and consequential action. Show what does happen instead of what doesn't.`,
    `- Remember to NEVER mix narration and dialogue in the same line. Output them separately.`,
    ...(ctx.rating === "nsfw" ? [`- Adult mode enabled, explicit content allowed.`] : []),
    `- Dialogue: [Name] [expression]: "Text"`,
    `- Variant dialogue: [Name] [main|side|thought|whisper:"Target"] [expression]: "text"`,
    `- Thought lines are unquoted.`,
    `- Commands: [tag: params].`,
    `- Default expressions: neutral, happy, sad, angry, surprised, scared, disgusted, thinking, laughing, crying, blushing, smirk, embarrassed, determined, confused, sleepy.`,
    ...(customSpriteLines.length
      ? [
          ``,
          `- Available sprites per character (use these EXACT names when the character has any listed expression; only fall back to the defaults if the character has no listed sprites):`,
          ...customSpriteLines,
        ]
      : []),
    ``,
    `DIALOGUE TYPE USAGE:`,
    `- [main]: the primary spoken line that should own the VN box in this beat.`,
    `- [side]: a short aside, banter line, interruption, interjection, overheard cut-in, or other flavor remark while the scene keeps moving. It shows as the floating popup above the VN box.`,
    `- [thought]: internal thought, unheard by others, never quoted.`,
    `- [whisper:"Target"]: quiet speech meant for one listener only.`,
    ``,
    `EXAMPLE:`,
    `Rain needles the broken shrine roof.`,
    hasParty
      ? `[${partyNames[0]}] [main] [worried]: "We should move. Now."`
      : `[Guide] [main] [worried]: "We should move. Now."`,
    `[${ctx.playerName ?? "Player"}] [main] [amused]: You remind him that he says that every time the wind changes.`,
    ``,
    ``,
    `PLAYER INPUT:`,
    `- Continue directly from the player's input, treating it like a concluded beat. Do not reiterate it.`,
    `- Only quoted speech in the player's inputs is spoken aloud. Unquoted player text is narration, action, or internal thought, to which only the GM has access. Characters cannot perceive it unless the player makes it observable or says it out loud.`,
    `- Never quote the player character. Narrate the player's speech, thoughts, and actions indirectly in second person. Example:`,
    `[${ctx.playerName ?? "Player"}] [thought] [smirk]: You think you're the best.`,
    `- CRITICAL: NEVER echo the player's distinctive words, phrases, or dialogue. NO PARROTTING!`,
    `- Keep the turn's length flexible, depending on the current scene and state. If the player's agency is low (exploration, travel/rest): make it longer. If it's high (combat, dialogue, or other intense situation): keep it concise. Sometimes a single line of dialogue or a narrative beat is enough to allow back-and-forth interactions.`,
    `- Pace the plot without rushing through it; when danger is not immediate, allow breathers, rest, party banter, and small character moments.`,
    `- End naturally when it's the player's turn to act or speak.`,
    ``,
  );

  // ── Party Dialogue Instructions (inside output_format, closest to generation) ──
  if (hasParty) {
    lines.push(
      ``,
      `PARTY:`,
      `You also play ${partyNames.join(", ")}. They should naturally converse with each other from time to time. Party members know only what they have seen, heard, inferred, or been told. There is a hard GM/PARTY information boundary: party dialogue must never reveal or hint at hidden arcs, plot twists, unrevealed motives, plans, encounter scripting, or any other GM-only/meta knowledge unless they learned it in-world. No spoilers, overguiding, or meta leakage.`,
    );
    if (ctx.addressMode === "party") {
      lines.push(
        ``,
        `TALK-TO-PARTY MODE:`,
        `The player is addressing the party out loud. Keep narration minimal, let party dialogue carry the turn, and do not advance the scene unless immediate danger forces it.`,
      );
    }
  }

  if (ctx.addressMode === "gm") {
    lines.push(
      ``,
      `TALK-TO-GM MODE:`,
      `The player is addressing you out of character. Answer directly in a clear OOC GM voice and do not advance the scene unless immediate danger makes that unavoidable.`,
    );
  }

  lines.push(
    ``,
    `COMMANDS:`,
    `- Emit commands when canonical game or UI state changes; no command is needed for flavor alone.`,
    `- [choices: "Option A" | "Option B" | "Option C"] - only for explicit player-facing options that require a selection. Use plain straight quotes around each option (do not escape inner quotes with backslashes).`,
  );

  if (ctx.playerDiceRollSubmitted) {
    lines.push(
      `- [skill_check: skill="Skill Name" dc="1-20" rolls="player's dice result" modifier="0-10" total="roll + modifier | 1 | 20" result="critical_success | success | failure | critical_failure"] - if the player presented you with a [dice: ...] roll, start the turn with the check and narrate the consequences in the same turn. Choose DC fairly (5 trivial, 10 routine under pressure, 15 hard, 20 desperate).`,
    );
  } else {
    lines.push(
      `- [skill_check: skill="Skill Name" dc="1-20" rolls="1-20" modifier="0-10" total="roll + modifier | 1 | 20" result="critical_success | success | failure | critical_failure"] - only when uncertainty or the player's actions should be resolved mechanically. Abandon positivity bias: choose DC (5 trivial, 10 routine under pressure, 15 hard, 20 desperate), roll honestly, and narrate the consequence in the same turn.`,
    );
  }

  lines.push(
    `- [qte: action1 | action2 | action3, timer: 6s] - only as the final thing in the turn when the player must react to an immediate timed prompt or split-second action. Stop immediately after this tag: choosing an action commits the player's next turn.`,
    ...(ctx.map?.type === "node"
      ? [
          `- [map_update: new_location="Location Name" connected_to="Previous Location Name" node_emoji="emoji"] - only when the party arrives at an entirely new location on the current node map.`,
        ]
      : []),
    `- [inventory: action="add | remove" item="Item A, Item B"] - every real item gain or loss, keep their names short.`,
    `- [Note: contents] or [Book: contents] - when a new readable note or book is acquired and should be tracked in the journal.`,
    `- [state: exploration | dialogue | combat | travel_rest] - only on actual mode transitions. If you're planning to use [state: combat], this one ALWAYS has to be at the end of the turn, as it initiates a new combat generation and UI.`,
    `- [reputation: npc="Name" action="helped"] - when an NPC's tracked stance changes because of what happened.`,
    `- [party_change: character="Exact Character Name" change="add | remove"] - only when someone truly joins or leaves the party. Use remove when a party member dies, permanently departs, or is no longer traveling with the player.`,
    `- [session_end: reason="goal achieved"] - only when the current session truly ends.`,
  );

  if (ctx.gameActiveState === "combat") {
    lines.push(
      ``,
      `COMBAT GM ADJUDICATION:`,
      `Combat rounds are resolved by the combat UI. During ordinary combat narration, do not emit tactical combat commands or recalculate combat mechanics. If the player sends a special maneuver, follow the explicit instruction included in that user message.`,
    );
  }

  if (!ctx.hasSceneModel) {
    lines.push(`Scene tags allowed: [sfx: ...] [bg: ...] [ambient: ...]`);
  }

  if (hudWidgets.length > 0) {
    lines.push(
      ``,
      `HUD WIDGETS:`,
      ...buildWidgetSummaryLines(hudWidgets),
      `Widget usage: emit widget commands only when tracked state changes. value = bars/gauges, count = counters, stat = one stat_block entry, add/remove = rotating list items, running/seconds = timers.`,
      `Widget commands: [widget: id, value: n] [widget: id, stat: "Name", value: x] [widget: id, count: n] [widget: id, add: "Item"] [widget: id, remove: "Item"] [widget: id, running: true, seconds: 60]`,
      `List widgets: keep at most 5 short entries visible; remove stale items freely.`,
    );
  }

  // Inventory context
  if (playerInventory.length > 0) {
    lines.push(``, `PLAYER INVENTORY: ${buildCompactInventoryLine(playerInventory)}`);
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
  const normalizedLanguage = normalizePromptLanguage(ctx.language);
  const ratingBlock =
    rating === "nsfw"
      ? [
          `<rating>`,
          `Anything goes in this NSFW work of fiction intended for mature audiences. The user has confirmed they are over 18 and understand what they're getting into. No holding back:`,
          ` - Profanities, toxicity, and dark themes will be present. Every character, the user's included, can be raped, harmed, killed, betrayed, dominated, or emotionally/physically used. This goes both ways; they can also be the ones doing those things for personal gain, convictions, or pleasure.`,
          ` - To maintain the integrity of the story, you may be as kind or as cruel as necessary when performing different roles. A good villain is a terrifying one, and a good hero sometimes has to make difficult choices.`,
          ` - Romance and intimate contact should not stall on repetitive approval beats. Handholding, charged proximity, touches, kisses, embraces, jealousy, seduction, and messy attachment can happen naturally when chemistry, body language, or player intent supports them.`,
          ` - During sex between involved adult characters, get kinky and slow down the pace. Apply anatomical (position fatigue, physical consequences) and emotional (experience, communication, aftercare) aspects to craft sensually pornographic erotica. Include foreplay and sexual acts described in great detail; the build-up is as important as the climax. Take consent for granted, assuming some lie, resist, or fight back based on their personality.`,
          ` - Portray violence in gory detail, blood squirting around like in a slasher movie.`,
          `</rating>`,
        ].join("\n")
      : [
          `<rating>`,
          `This SFW work of fiction is intended for mature audiences, and the user dictates the boundaries:`,
          ` - Profanity and dark themes may be present, and every character, including the user's, may be harmed or killed. However, no explicit content will be present.`,
          ` - Romance and affectionate contact should not stall on repetitive approval beats: handholding, charged proximity, touches, kisses, embraces, jealousy, longing, tenderness, and messy attachment can happen naturally when chemistry, body language, or player intent supports them.`,
          ` - During a sex scene, cut to black and progress to the aftermath, and when portraying violence, do realistic descriptions without getting into gory details.`,
          ` - Treat boundaries as part of characterization and scene dynamics, not as repetitive legal disclaimers.`,
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
    ...(normalizedLanguage && normalizedLanguage.toLowerCase() !== "english"
      ? [
          `<language>`,
          `Write every natural-language string value in the JSON output in ${normalizedLanguage}. This includes worldOverview, storyArc, plotTwists, descriptions, arcs, labels, and any other prose. Keep ONLY the JSON keys and structural syntax in English.`,
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
          `If you design a list widget, treat it as a compact rotating list with a hard cap of 5 entries. Choose items worth surfacing right now, and expect older entries to be swapped out as the situation changes.`,
          `Keep each list item concise and label-like when possible. Avoid long multi-clause sentences, because the same text may need to be referenced later for removal or swapping.`,
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
export function buildSessionSummaryPrompt(language?: string | null): string {
  const normalizedLanguage = normalizePromptLanguage(language);
  return [
    `Summarize this completed game session as structured continuity data.`,
    `Return JSON with exactly these keys and no others: summary, resumePoint, partyDynamics, partyState, keyDiscoveries, characterMoments, littleDetails, npcUpdates, statsSnapshot.`,
    ``,
    `1. **summary**: Chronological recap of the key events in 2–4 paragraphs. This is the only field that should read like a flowing narrative. Do not duplicate bullet-list items verbatim from the fields below.`,
    `2. **resumePoint**: One short paragraph or 1–3 sentences stating the exact in-world situation at session end and where the next session must resume from. Name the location, present characters, current pressure, and the immediate unfinished action or decision when possible.`,
    `3. **partyDynamics**: How party member relationships evolved this session. Relationship changes only.`,
    `4. **partyState**: Current condition of the party after the session (HP, morale, injuries, resources, exhaustion, or readiness).`,
    `5. **keyDiscoveries**: Array of durable, actionable continuity facts: important plot points, hidden truths, twists, quests, lore learned, locations, and newly opened leads that still matter next session. Use this single bucket for both discoveries and reveals. Do not include emotional moments or NPC stance changes unless that fact itself is the core continuity item.`,
    `6. **characterMoments**: Array of notable personal moments between the player and specific characters. Use this only for bonding, romance, betrayal, confessions, arguments, or other interpersonal beats. Empty array if none.`,
    `7. **littleDetails**: Array of small personal details to recall later: preferences, habits, favorite things, casual promises, private jokes, fears, motifs, or fragments of a character's past that are not major plot discoveries. Empty array if none.`,
    `8. **npcUpdates**: Array of NPC reputation changes, newly met NPCs, and important shifts in an NPC's stance, allegiance, or immediate agenda.`,
    `9. **statsSnapshot**: Current party stats, inventory, quest states, and any location / pressure details needed for continuity. This must be a JSON object, not prose.`,
    ``,
    `Cross-field dedupe rules:`,
    `- Each fact belongs in the single best category only once. Do not repeat the same information across summary, keyDiscoveries, characterMoments, littleDetails, npcUpdates, or statsSnapshot.`,
    `- If something is primarily a relationship or emotional beat, keep it out of keyDiscoveries and npcUpdates.`,
    `- If something is primarily an NPC stance change, keep it out of keyDiscoveries unless that stance change is itself the core continuity fact.`,
    `- If something is primarily a lore/quest lead, keep it out of characterMoments.`,
    `- Use empty strings, empty arrays, or {} when a category has no meaningful content.`,
    ``,
    normalizedLanguage
      ? `Language: write every natural-language value in ${normalizedLanguage}. Keep the JSON keys exactly as specified in English.`
      : ``,
    ``,
    `Output valid JSON only.`,
  ].join("\n");
}

/** Build a prompt for concluding a session in one pass. */
export function buildSessionConclusionPrompt(args: {
  language?: string | null;
  includeCharacterCards: boolean;
}): string {
  const normalizedLanguage = normalizePromptLanguage(args.language);
  return [
    `Review this completed game session and return all end-of-session continuity updates in one JSON object.`,
    `Return JSON with exactly these top-level keys and no others: summary, campaignProgression, characterCards.`,
    ``,
    ...(normalizedLanguage
      ? [
          `Language: write every natural-language value in ${normalizedLanguage}. Keep the JSON keys and booleans exactly as specified in English.`,
          ``,
        ]
      : []),
    `summary must be an object with exactly these keys and no others: summary, resumePoint, partyDynamics, partyState, keyDiscoveries, characterMoments, littleDetails, npcUpdates, statsSnapshot.`,
    `- summary.summary: Chronological recap of the key events in 2-4 paragraphs. This is the only field that should read like flowing narrative prose.`,
    `- summary.resumePoint: One short paragraph or 1-3 sentences stating the exact in-world situation at session end and where the next session must resume from.`,
    `- summary.partyDynamics: Relationship changes within the party only.`,
    `- summary.partyState: Current condition of the party after the session, including readiness, injuries, morale, resources, or exhaustion.`,
    `- summary.keyDiscoveries: Array of durable, actionable continuity facts: important plot points, hidden truths, twists, quests, lore learned, locations, and newly opened leads that still matter next session. Use this single bucket for both discoveries and reveals.`,
    `- summary.characterMoments: Array of notable interpersonal beats such as bonding, romance, betrayal, confessions, arguments, or other personal turning points.`,
    `- summary.littleDetails: Array of small personal details to recall later: preferences, habits, favorite things, casual promises, private jokes, fears, motifs, or fragments of a character's past that are not major plot discoveries.`,
    `- summary.npcUpdates: Array of newly met NPCs, reputation changes, and important shifts in an NPC's stance, allegiance, or immediate agenda.`,
    `- summary.statsSnapshot: JSON object with continuity-critical state such as party stats, inventory, quest progress, location, active pressure, and partyMorale as a number from 0 to 100.`,
    ``,
    `campaignProgression must be an object with exactly these keys and no others: storyArc, plotTwists, partyArcs.`,
    `- campaignProgression.storyArc: Refresh the overarching campaign arc only if this session materially advanced or changed it. Otherwise preserve the current arc.`,
    `- campaignProgression.plotTwists: Keep unresolved twists that still matter, remove obsolete ones, and add any major new twist revealed this session.`,
    `- campaignProgression.partyArcs: Return the FULL array of party arcs. Carry forward unfinished arcs with updated wording where needed. If an arc completed, mark completed: true and include a short resolution note.`,
    ``,
    `characterCards rules:`,
    ...(args.includeCharacterCards
      ? [
          `- characterCards must be a JSON array containing the FULL updated card for each supplied party character.`,
          `- Return every supplied character exactly once, even if unchanged.`,
          `- Only make conservative changes that are clearly justified by session events. This represents organic growth, not sudden transformation.`,
        ]
      : [`- characterCards must be an empty JSON array because no current character cards were supplied.`]),
    `- Keep each card aligned with the input schema: name, shortDescription, class, abilities, strengths, weaknesses, extra.`,
    ``,
    `Cross-section dedupe rules:`,
    `- Each fact belongs in the single best category only once. Do not restate the same information across summary.summary, summary.keyDiscoveries, summary.characterMoments, summary.littleDetails, summary.npcUpdates, summary.statsSnapshot, or campaignProgression.`,
    `- If something is primarily a relationship or emotional beat, keep it out of keyDiscoveries and npcUpdates.`,
    `- If something is primarily an NPC stance change, keep it out of keyDiscoveries unless that stance change is itself the core continuity fact.`,
    `- If something is primarily a lore or quest lead, keep it out of characterMoments.`,
    `- Be conservative. Preserve existing campaign state and cards when the session did not justify a change.`,
    `- Use empty strings, empty arrays, or {} when a category has no meaningful content.`,
    ``,
    `Output valid JSON only.`,
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

/** Build the prompt for adjusting campaign progression at session end. */
export function buildCampaignProgressionPrompt(language?: string | null): string {
  const normalizedLanguage = normalizePromptLanguage(language);
  return [
    `You are the Game Master reviewing what happened during this session to update the campaign's ongoing progression state.`,
    ``,
    ...(normalizedLanguage
      ? [
          `Language: write every natural-language value in ${normalizedLanguage}. Keep the JSON keys and booleans in English.`,
          ``,
        ]
      : []),
    `Update these campaign tracking fields based on the completed session:`,
    `- storyArc: refresh the overarching campaign arc only if the session materially advanced or changed it.`,
    `- plotTwists: keep unresolved twists that still matter, remove obsolete ones, and add any major new twist revealed this session.`,
    `- partyArcs: return the FULL array of party arcs. Carry forward unfinished arcs with updated wording where needed. If an arc completed, mark \"completed\": true and include a short \"resolution\" note. Keep unfinished arcs as \"completed\": false or omit the field.`,
    ``,
    `RULES:`,
    `- Be conservative. Do not rewrite campaign state unless the session justified it.`,
    `- Preserve continuity with the existing state when nothing changed.`,
    `- Return FULL updated values, not patches.`,
    `- For partyArcs, each item must include: name, arc, goal. It may also include completed and resolution.`,
    `- Do not invent extra top-level keys.`,
    ``,
    `Output exactly one JSON object with these keys: storyArc, plotTwists, partyArcs.`,
  ].join("\n");
}

export function buildPartyRecruitCardPrompt(ctx: {
  targetCharacterName: string;
  targetCharacterCard: string;
  currentPartyNames: string[];
  currentPartyCards?: string | null;
  existingTargetCard?: string | null;
  worldOverview?: string | null;
  storyArc?: string | null;
  plotTwists?: string[] | null;
  currentState?: string | null;
  recentTranscript?: string | null;
  language?: string | null;
  purpose?: "recruit" | "regenerate";
}): string {
  const normalizedLanguage = normalizePromptLanguage(ctx.language);
  const isRegeneration = ctx.purpose === "regenerate";
  const sections: string[] = [
    `You are the Game Master updating an ongoing RPG campaign.`,
    isRegeneration
      ? `A companion's party sheet is malformed or outdated. Regenerate one clean JSON character card for them that matches the existing game card schema.`
      : `A new companion is joining the party. Create a single JSON character card for them that matches the existing game card schema.`,
    ``,
    ...(normalizedLanguage && normalizedLanguage.toLowerCase() !== "english"
      ? [
          `<language>`,
          `Write every natural-language string value in ${normalizedLanguage}. Keep JSON keys and structural syntax in English.`,
          `</language>`,
          ``,
        ]
      : []),
    `RULES:`,
    `- Return EXACTLY one JSON object with these keys: name, shortDescription, class, abilities, strengths, weaknesses, extra.`,
    `- Keep the name exactly "${ctx.targetCharacterName}".`,
    `- Ground the card in the existing campaign state, world, and recent events.`,
    `- Respect the supplied character card as canon. Do not contradict it.`,
    ...(isRegeneration
      ? [
          `- Treat the existing target party sheet as a damaged draft: preserve useful facts, but fix malformed fields, bad formatting, missing structure, and awkward or off-tone values.`,
        ]
      : []),
    `- abilities, strengths, and weaknesses must be arrays of strings.`,
    `- extra must be an object of string values.`,
    `- Do not output markdown, explanations, or any wrapper text.`,
    ``,
    `<current_party>`,
    `Current party members: ${ctx.currentPartyNames.length > 0 ? ctx.currentPartyNames.join(", ") : "None"}`,
    `</current_party>`,
    ``,
    `<recruited_character>`,
    ctx.targetCharacterCard,
    `</recruited_character>`,
  ];

  if (ctx.worldOverview) {
    sections.push(``, `<world_overview>`, ctx.worldOverview, `</world_overview>`);
  }
  if (ctx.storyArc) {
    sections.push(``, `<story_arc>`, ctx.storyArc, `</story_arc>`);
  }
  if (ctx.plotTwists && ctx.plotTwists.length > 0) {
    sections.push(``, `<plot_twists>`, ...ctx.plotTwists, `</plot_twists>`);
  }
  if (ctx.currentPartyCards?.trim()) {
    sections.push(``, `<existing_party_cards>`, ctx.currentPartyCards.trim(), `</existing_party_cards>`);
  }
  if (ctx.existingTargetCard?.trim()) {
    sections.push(``, `<existing_target_party_sheet>`, ctx.existingTargetCard.trim(), `</existing_target_party_sheet>`);
  }
  if (ctx.currentState?.trim()) {
    sections.push(``, `<current_state>`, ctx.currentState.trim(), `</current_state>`);
  }
  if (ctx.recentTranscript?.trim()) {
    sections.push(``, `<recent_transcript>`, ctx.recentTranscript.trim(), `</recent_transcript>`);
  }

  return sections.join("\n");
}
