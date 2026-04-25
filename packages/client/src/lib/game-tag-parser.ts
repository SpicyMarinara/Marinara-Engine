// ──────────────────────────────────────────────
// Game: GM Tag Parser
//
// Extracts [music:], [sfx:], [bg:], [ambient:],
// [choices:], [qte:], [reputation:], [state:],
// [direction:], [widget:], and other command tags
// from GM narration output.
// Returns clean content + extracted commands.
// ──────────────────────────────────────────────

import type { DirectionCommand, DirectionEffect, WidgetUpdate } from "@marinara-engine/shared";

export interface CombatEncounterTag {
  enemies: Array<{
    name: string;
    level: number;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    /** Element the enemy attacks with (for elemental reaction chains) */
    element?: string;
  }>;
}

export interface SkillCheckTag {
  skill: string;
  dc: number;
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface ElementAttackTag {
  /** Element used in the attack (e.g. "pyro", "ice", "lightning") */
  element: string;
  /** Target combatant name */
  target: string;
}

export interface InventoryTag {
  action: "add" | "remove";
  items: string[];
}

export interface SegmentInventoryUpdate {
  segment: number;
  update: InventoryTag;
}

export interface PartyRecruitTag {
  characterName: string;
}

export interface ReadableTag {
  type: "note" | "book";
  content: string;
}

export interface CombatStatusTag {
  target: string;
  effect: string;
  stat?: "attack" | "defense" | "speed" | "hp";
  modifier?: number;
  turns?: number;
}

export interface ParsedGmTags {
  /** Content with all command tags stripped. */
  cleanContent: string;
  /** Music tag to play, e.g. "music:combat:epic-battle" */
  music: string | null;
  /** One-shot SFX tags */
  sfx: string[];
  /** Background image tag */
  background: string | null;
  /** Ambient loop tag */
  ambient: string | null;
  /** Choices for player (VN-style cards) */
  choices: string[] | null;
  /** QTE actions + timer */
  qte: { actions: string[]; timer: number } | null;
  /** State transition command */
  stateChange: string | null;
  /** NPC reputation changes */
  reputationActions: Array<{ npcName: string; action: string }>;
  /** Combat encounter with enemy data */
  combatEncounter: CombatEncounterTag | null;
  /** Cinematic direction commands */
  directions: DirectionCommand[];
  /** Widget update commands */
  widgetUpdates: WidgetUpdate[];
  /** Skill check requests */
  skillChecks: SkillCheckTag[];
  /** Elemental attack triggers */
  elementAttacks: ElementAttackTag[];
  /** Combat-only status effect commands */
  combatStatuses: CombatStatusTag[];
  /** Inventory add/remove commands */
  inventoryUpdates: InventoryTag[];
  /** New characters joining the party */
  partyRecruits: PartyRecruitTag[];
  /** Note or book content for reading display */
  readables: ReadableTag[];
}

/**
 * Strip any unknown `[word: ...]` tag the model invents. Walks the text
 * tracking quote state and bracket depth so JSON content like
 * `[some_tag: {"x":[1,2]}]` is removed entirely. The naive
 * `/\[\w+:[^\]]*\]/g` stops at the FIRST `]` and leaves `}]` trailing.
 *
 * `keep` is an optional predicate — return true to skip stripping for
 * tag names that should remain in place (e.g. Note, Book).
 */
function stripUnknownBracketTags(text: string, keep?: (tagName: string) => boolean): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "[") {
      // Look ahead for `\w+:` — minimum signature of a model-invented tag
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j]!)) j++;
      const tagName = text.slice(i + 1, j);
      if (j > i + 1 && text[j] === ":" && (!keep || !keep(tagName))) {
        // Walk to balanced `]`, respecting `"`/`'` strings (and `\` escapes)
        let depth = 1;
        let inString: '"' | "'" | null = null;
        let escaped = false;
        let k = j + 1;
        for (; k < text.length; k++) {
          const c = text[k]!;
          if (escaped) { escaped = false; continue; }
          if (c === "\\") { escaped = true; continue; }
          if (inString) { if (c === inString) inString = null; continue; }
          if (c === '"' || c === "'") { inString = c; continue; }
          if (c === "[") depth++;
          else if (c === "]") {
            depth--;
            if (depth === 0) break;
          }
        }
        if (k < text.length) {
          // Found the balanced closing `]` — drop the whole tag
          i = k + 1;
          continue;
        }
        // Unbalanced (truncated/streaming) — leave the `[` in place and move on
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * Remove all instances of a bracket-enclosed tag whose content may contain
 * nested brackets (e.g. JSON arrays/objects).  Counts `[` / `]` so the match
 * extends to the *balanced* closing bracket rather than the first `]`.
 */
function stripBalancedTag(text: string, tagPrefix: string): string {
  const lower = tagPrefix.toLowerCase();
  let result = text;
  let searchFrom = 0;
  while (true) {
    const idx = result.toLowerCase().indexOf(lower, searchFrom);
    if (idx === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = idx; i < result.length; i++) {
      if (result[i] === "[") depth++;
      else if (result[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      searchFrom = idx + 1;
      continue;
    }
    result = result.slice(0, idx) + result.slice(end + 1);
  }
  return result;
}

function splitQuotedParams(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let activeQuote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if ((char === '"' || char === "'") && (!activeQuote || activeQuote === char)) {
      activeQuote = activeQuote === char ? null : char;
      current += char;
      continue;
    }

    if (char === "," && !activeQuote) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

const VALID_COMBAT_STATUS_STATS = new Set<CombatStatusTag["stat"]>(["attack", "defense", "speed", "hp"]);

function parseCombatStatusTagBody(body: string): CombatStatusTag | null {
  const fields = new Map<string, string>();

  for (const part of splitQuotedParams(body)) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = part.slice(0, separatorIndex).trim().toLowerCase();
    const value = part
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^(["'])|(["'])$/g, "");
    if (!key || !value) continue;
    fields.set(key, value);
  }

  const target = fields.get("target")?.trim();
  const effect = (fields.get("effect") ?? fields.get("name"))?.trim();
  if (!target || !effect) return null;

  const rawStat = fields.get("stat")?.trim().toLowerCase();
  const stat =
    rawStat && VALID_COMBAT_STATUS_STATS.has(rawStat as CombatStatusTag["stat"])
      ? (rawStat as CombatStatusTag["stat"])
      : undefined;

  const modifierValue = fields.get("modifier");
  const parsedModifier = modifierValue != null ? Number(modifierValue) : undefined;
  const modifier = parsedModifier != null && Number.isFinite(parsedModifier) ? Math.trunc(parsedModifier) : undefined;

  const turnsValue = fields.get("turns") ?? fields.get("duration");
  const parsedTurns = turnsValue != null ? Number(turnsValue) : undefined;
  const turns =
    parsedTurns != null && Number.isFinite(parsedTurns) && parsedTurns > 0 ? Math.trunc(parsedTurns) : undefined;

  return {
    target,
    effect,
    stat,
    modifier,
    turns,
  };
}

/**
 * Extract all occurrences of a balanced bracket tag and return their inner
 * content (the part after the colon, trimmed).  Also returns the text with
 * all matched tags removed.  Handles nested `[]` inside the tag body.
 */
function extractBalancedTags(text: string, tagPrefix: string): { contents: string[]; remaining: string } {
  const lower = tagPrefix.toLowerCase();
  const prefixLen = tagPrefix.length;
  const contents: string[] = [];
  let remaining = text;
  let searchFrom = 0;
  while (true) {
    const idx = remaining.toLowerCase().indexOf(lower, searchFrom);
    if (idx === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = idx; i < remaining.length; i++) {
      if (remaining[i] === "[") depth++;
      else if (remaining[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) {
      searchFrom = idx + 1;
      continue;
    }
    // inner = everything between "[tagPrefix:" and the balanced "]"
    const inner = remaining.slice(idx + prefixLen, end).trim();
    contents.push(inner);
    remaining = remaining.slice(0, idx) + remaining.slice(end + 1);
  }
  return { contents, remaining };
}

function parseInventoryTagBody(body: string): InventoryTag | null {
  // action: either action="add" / action=add, or a bare leading add/remove word
  let action: "add" | "remove" = "add";
  const actAttr = /action\s*=\s*"?(add|remove)"?/i.exec(body);
  if (actAttr) {
    action = actAttr[1]!.toLowerCase() as "add" | "remove";
  } else {
    const bareAct = /(^|\s)(add|remove)(\s|$)/i.exec(body);
    if (bareAct) action = bareAct[2]!.toLowerCase() as "add" | "remove";
  }

  // items: prefer quoted capture, fall back to unquoted single token / rest
  let itemStr = "";
  const itemsQuoted = /items?\s*=\s*"([^"]+)"/i.exec(body);
  if (itemsQuoted) {
    itemStr = itemsQuoted[1]!;
  } else {
    const itemsUnquoted = /items?\s*=\s*([^,\]\s][^,\]]*)/i.exec(body);
    if (itemsUnquoted) itemStr = itemsUnquoted[1]!;
  }

  const items = itemStr
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  return items.length > 0 ? { action, items } : null;
}

/**
 * Best-effort mapping of inventory tags to narration segment indices so item
 * gains/losses can land when the relevant beat is shown instead of at turn start.
 * Segment numbering mirrors GameNarration's parsing model closely enough for timing.
 */
export function parseSegmentInventoryUpdates(content: string): SegmentInventoryUpdate[] {
  let source = content
    .replace(/\[combat_result\][\s\S]*?\[\/combat_result\]/gi, "")
    .replace(/\[music:\s*[^\]]+\]/gi, "")
    .replace(/\[sfx:\s*[^\]]+\]/gi, "")
    .replace(/\[bg:\s*[^\]]+\]/gi, "")
    .replace(/\[ambient:\s*[^\]]+\]/gi, "")
    .replace(/\[qte:\s*[^\]]+\]/gi, "")
    .replace(/\[state:\s*[^\]]+\]/gi, "")
    .replace(/\[reputation:\s*[^\]]+\]/gi, "")
    .replace(/\[combat:\s*[^\]]+\]/gi, "")
    .replace(/\[direction:\s*[^\]]+\]/gi, "")
    .replace(/\[widget:\s*[^\]]+\]/gi, "")
    .replace(/\[dialogue:\s*npc="[^"]*"\]/gi, "")
    .replace(/\[session_end:\s*[^\]]*\]/gi, "")
    .replace(/\[skill_check:\s*[^\]]+\]/gi, "")
    .replace(/\[element_attack:\s*[^\]]+\]/gi, "")
    .replace(/\[party_add:\s*[^\]]+\]/gi, "")
    .replace(/\[party-turn\]/gi, "")
    .replace(/\[party-chat\]/gi, "")
    .replace(/\[dice:\s*[^\]]+\]/gi, "");

  source = stripBalancedTag(source, "[map_update:");
  source = stripBalancedTag(source, "[choices:");

  const readableContents: Array<{ type: "note" | "book"; content: string }> = [];
  for (const tag of ["[Note:", "[Book:"] as const) {
    const rType = tag === "[Note:" ? "note" : "book";
    let searchFrom = 0;
    while (true) {
      const idx = source.toLowerCase().indexOf(tag.toLowerCase(), searchFrom);
      if (idx === -1) break;
      let depth = 0;
      let end = -1;
      for (let i = idx; i < source.length; i++) {
        if (source[i] === "[") depth++;
        else if (source[i] === "]") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) {
        searchFrom = idx + 1;
        continue;
      }
      const inner = source.slice(idx + tag.length, end).trim();
      const placeholderIdx = readableContents.length;
      readableContents.push({ type: rType, content: inner });
      const placeholder = `__READABLE_${placeholderIdx}__`;
      source = source.slice(0, idx) + placeholder + source.slice(end + 1);
      searchFrom = idx + placeholder.length;
    }
  }

  const readablePlaceholderRe = /^__READABLE_(\d+)__$/;
  const narrationRegex = /^\s*Narration\s*:\s*(.+)$/i;
  const legacyDialogueRegex = /^\s*Dialogue\s*\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;
  const compactDialogueRegex = /^\s*\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/;
  const partyLineRegex =
    /^\s*\[([^\]]+)\]\s*\[(main|side|extra|action|thought|whisper(?::([^\]]+))?)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;
  const inventoryRegex = /\[inventory:\s*([^\]]+)\]/gi;

  const updatesBySegment = new Map<number, InventoryTag[]>();
  const pendingForNextSegment: InventoryTag[] = [];
  let segmentCount = 0;
  let fallbackActive = false;

  const assignToSegment = (segment: number, update: InventoryTag) => {
    const existing = updatesBySegment.get(segment) ?? [];
    existing.push(update);
    updatesBySegment.set(segment, existing);
  };

  const queueUpdates = (updates: InventoryTag[], preferredSegment: number | null) => {
    if (updates.length === 0) return;
    if (preferredSegment != null && preferredSegment >= 0) {
      for (const update of updates) assignToSegment(preferredSegment, update);
      return;
    }
    pendingForNextSegment.push(...updates);
  };

  const claimPendingForSegment = (segment: number) => {
    if (pendingForNextSegment.length === 0) return;
    for (const update of pendingForNextSegment.splice(0, pendingForNextSegment.length)) {
      assignToSegment(segment, update);
    }
  };

  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) {
      if (fallbackActive) {
        segmentCount += 1;
        fallbackActive = false;
      }
      continue;
    }

    const inventoryUpdates: InventoryTag[] = [];
    line = line.replace(inventoryRegex, (_match, body: string) => {
      const update = parseInventoryTagBody(body);
      if (update) inventoryUpdates.push(update);
      return "";
    });
    line = line.trim();

    if (!line) {
      const targetSegment = fallbackActive ? segmentCount : segmentCount > 0 ? segmentCount - 1 : null;
      queueUpdates(inventoryUpdates, targetSegment);
      continue;
    }

    const isStandaloneSegment =
      readablePlaceholderRe.test(line) ||
      partyLineRegex.test(line) ||
      narrationRegex.test(line) ||
      legacyDialogueRegex.test(line) ||
      compactDialogueRegex.test(line);

    if (isStandaloneSegment) {
      if (fallbackActive) {
        segmentCount += 1;
        fallbackActive = false;
      }
      claimPendingForSegment(segmentCount);
      for (const update of inventoryUpdates) assignToSegment(segmentCount, update);
      segmentCount += 1;
      continue;
    }

    claimPendingForSegment(segmentCount);
    for (const update of inventoryUpdates) assignToSegment(segmentCount, update);
    fallbackActive = true;
  }

  const trailingSegment = fallbackActive ? segmentCount : segmentCount > 0 ? segmentCount - 1 : 0;
  if (pendingForNextSegment.length > 0) {
    for (const update of pendingForNextSegment) assignToSegment(trailingSegment, update);
  }

  return Array.from(updatesBySegment.entries())
    .sort((a, b) => a[0] - b[0])
    .flatMap(([segment, updates]) => updates.map((update) => ({ segment, update })));
}

/** Extract all command tags from GM narration and return clean content. */
export function parseGmTags(content: string): ParsedGmTags {
  let text = content;
  const result: ParsedGmTags = {
    cleanContent: "",
    music: null,
    sfx: [],
    background: null,
    ambient: null,
    choices: null,
    qte: null,
    stateChange: null,
    reputationActions: [],
    combatEncounter: null,
    directions: [],
    widgetUpdates: [],
    skillChecks: [],
    elementAttacks: [],
    combatStatuses: [],
    inventoryUpdates: [],
    partyRecruits: [],
    readables: [],
  };

  // [music: tag]
  const musicMatch = text.match(/\[music:\s*([^\]]+)\]/i);
  if (musicMatch) {
    result.music = musicMatch[1]!.trim();
    text = text.replace(musicMatch[0], "");
  }

  // [sfx: tag] — can appear multiple times
  const sfxRegex = /\[sfx:\s*([^\]]+)\]/gi;
  let sfxMatch: RegExpExecArray | null;
  while ((sfxMatch = sfxRegex.exec(text)) !== null) {
    result.sfx.push(sfxMatch[1]!.trim());
  }
  text = text.replace(/\[sfx:\s*[^\]]+\]/gi, "");

  // [bg: tag]
  const bgMatch = text.match(/\[bg:\s*([^\]]+)\]/i);
  if (bgMatch) {
    result.background = bgMatch[1]!.trim();
    text = text.replace(bgMatch[0], "");
  }

  // [ambient: tag]
  const ambientMatch = text.match(/\[ambient:\s*([^\]]+)\]/i);
  if (ambientMatch) {
    result.ambient = ambientMatch[1]!.trim();
    text = text.replace(ambientMatch[0], "");
  }

  // [choices: "A" | "B" | "C"] — use balanced bracket extraction for content with ]
  {
    const { contents, remaining } = extractBalancedTags(text, "[choices:");
    if (contents.length > 0) {
      const raw = contents[0]!;
      const choices = raw
        .split("|")
        .map((c) => c.trim().replace(/^["']|["']$/g, ""))
        .filter((c) => c.length > 0);
      if (choices.length > 0) result.choices = choices;
    }
    text = remaining;
  }

  // [qte: action1 | action2, timer: 5s]
  const qteMatch = text.match(/\[qte:\s*(.+?),\s*timer:\s*(\d+)s?\]/i);
  if (qteMatch) {
    const actions = qteMatch[1]!
      .split("|")
      .map((a) => a.trim().replace(/^["']|["']$/g, ""))
      .filter((a) => a.length > 0);
    const timer = parseInt(qteMatch[2]!, 10);
    if (actions.length > 0 && !isNaN(timer)) {
      result.qte = { actions, timer };
    }
    text = text.replace(qteMatch[0], "");
  }

  // [state: exploration|dialogue|combat|travel_rest]
  const stateMatch = text.match(/\[state:\s*(exploration|dialogue|combat|travel_rest)\]/i);
  if (stateMatch) {
    result.stateChange = stateMatch[1]!.trim();
    text = text.replace(stateMatch[0], "");
  }

  // [reputation: npc="Name" action="helped"] — can appear multiple times
  const repRegex = /\[reputation:\s*npc="([^"]+)"\s*action="([^"]+)"\]/gi;
  let repMatch: RegExpExecArray | null;
  while ((repMatch = repRegex.exec(text)) !== null) {
    result.reputationActions.push({
      npcName: repMatch[1]!.trim(),
      action: repMatch[2]!.trim(),
    });
  }
  text = text.replace(/\[reputation:\s*npc="[^"]+"\s*action="[^"]+"\]/gi, "");

  // [combat: enemies="Goblin:5:40:8:5:6, Skeleton:3:25:6:3:4"]
  // Format: Name:Level:HP:ATK:DEF:SPD — comma separated for multiple enemies
  // Simplified format: [combat: enemies="Goblin, Skeleton"] (auto-generates stats from level)
  const combatMatch = text.match(/\[combat:\s*enemies="([^"]+)"\]/i);
  if (combatMatch) {
    const raw = combatMatch[1]!;
    const enemyEntries = raw
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    const enemies: CombatEncounterTag["enemies"] = [];

    for (const entry of enemyEntries) {
      const parts = entry.split(":").map((p) => p.trim());
      if (parts.length >= 6) {
        // Full stat format: Name:Level:HP:ATK:DEF:SPD[:Element]
        enemies.push({
          name: parts[0]!,
          level: parseInt(parts[1]!, 10) || 1,
          hp: parseInt(parts[2]!, 10) || 30,
          attack: parseInt(parts[3]!, 10) || 8,
          defense: parseInt(parts[4]!, 10) || 5,
          speed: parseInt(parts[5]!, 10) || 5,
          element: parts[6] || undefined,
        });
      } else {
        // Name only or Name:Level — auto-generate stats
        const name = parts[0]!;
        const level = parts.length >= 2 ? parseInt(parts[1]!, 10) || 1 : 3;
        enemies.push({
          name,
          level,
          hp: 20 + level * 8,
          attack: 5 + level * 2,
          defense: 3 + level,
          speed: 3 + level,
        });
      }
    }

    if (enemies.length > 0) {
      result.combatEncounter = { enemies };
    }
    text = text.replace(combatMatch[0], "");
  }

  // [direction: effect, param: value, ...] — cinematic commands (can appear multiple times)
  const VALID_DIRECTIONS = new Set([
    "fade_from_black",
    "fade_to_black",
    "flash",
    "screen_shake",
    "blur",
    "vignette",
    "letterbox",
    "color_grade",
    "focus",
  ]) as Set<string>;
  const dirRegex = /\[direction:\s*([^\],]+)(?:,([^\]]*))?\]/gi;
  let dirMatch: RegExpExecArray | null;
  while ((dirMatch = dirRegex.exec(text)) !== null) {
    const effect = dirMatch[1]!.trim();
    if (!VALID_DIRECTIONS.has(effect)) continue;
    const cmd: DirectionCommand = { effect: effect as DirectionEffect };
    if (dirMatch[2]) {
      const paramStr = dirMatch[2];
      const pairs = paramStr.split(",").map((p) => p.trim());
      const extraParams: Record<string, string> = {};
      for (const pair of pairs) {
        const [k, v] = pair.split(":").map((s) => s.trim());
        if (!k || !v) continue;
        if (k === "duration") {
          const parsed = parseFloat(v);
          cmd.duration = isNaN(parsed) ? 1 : parsed;
        } else if (k === "intensity") {
          const parsed = parseFloat(v);
          cmd.intensity = Math.max(0, Math.min(1, isNaN(parsed) ? 0.5 : parsed));
        } else if (k === "target" && (v === "background" || v === "content" || v === "all")) cmd.target = v;
        else extraParams[k] = v;
      }
      if (Object.keys(extraParams).length > 0) cmd.params = extraParams;
    }
    result.directions.push(cmd);
  }
  text = text.replace(/\[direction:\s*[^\]]+\]/gi, "");

  // [widget: id, key: value, ...] — widget update commands (can appear multiple times)
  const widgetRegex = /\[widget:\s*([^,\]]+)(?:,([^\]]*))?\]/gi;
  let widgetMatch: RegExpExecArray | null;
  while ((widgetMatch = widgetRegex.exec(text)) !== null) {
    const widgetId = widgetMatch[1]!.trim();
    const changes: WidgetUpdate["changes"] = {};
    if (widgetMatch[2]) {
      const pairs = splitQuotedParams(widgetMatch[2]);
      for (const pair of pairs) {
        const colonIdx = pair.indexOf(":");
        if (colonIdx < 0) continue;
        const k = pair.slice(0, colonIdx).trim();
        const v = pair.slice(colonIdx + 1).trim();
        const stripped = v.replace(/^["']|["']$/g, "");
        if (k === "value") {
          const parsed = parseFloat(stripped);
          changes.value = isNaN(parsed) ? stripped : parsed;
        } else if (k === "stat") changes.statName = stripped;
        else if (k === "add") changes.add = stripped;
        else if (k === "remove") changes.remove = stripped;
        else if (k === "count") {
          const parsed = parseInt(stripped, 10);
          changes.count = isNaN(parsed) ? 0 : parsed;
        } else if (k === "running") changes.running = stripped === "true";
        else if (k === "seconds") {
          const parsed = parseInt(stripped, 10);
          changes.seconds = isNaN(parsed) ? 0 : parsed;
        }
      }
    }
    result.widgetUpdates.push({ widgetId, changes });
  }
  text = text.replace(/\[widget:\s*[^\]]+\]/gi, "");

  // Also strip other existing tags that the UI handles separately
  // [map_update: ...] — uses balanced bracket stripping because JSON content contains nested []
  text = stripBalancedTag(text, "[map_update:");
  // [dialogue: npc="..."]
  text = text.replace(/\[dialogue:\s*npc="[^"]*"\]/gi, "");
  // [session_end: ...]
  text = text.replace(/\[session_end:\s*[^\]]*\]/gi, "");

  // [skill_check: skill="Perception" dc=15] — can appear multiple times
  const skillRegex = /\[skill_check:\s*skill="([^"]+)"\s*dc=(\d+)(?:\s*advantage)?(?:\s*disadvantage)?\]/gi;
  let skillMatch: RegExpExecArray | null;
  while ((skillMatch = skillRegex.exec(text)) !== null) {
    const tag: SkillCheckTag = {
      skill: skillMatch[1]!.trim(),
      dc: parseInt(skillMatch[2]!, 10),
    };
    if (skillMatch[0].includes("advantage")) tag.advantage = true;
    if (skillMatch[0].includes("disadvantage")) tag.disadvantage = true;
    result.skillChecks.push(tag);
  }
  text = text.replace(/\[skill_check:\s*[^\]]+\]/gi, "");

  // [element_attack: element="pyro" target="Goblin"] — can appear multiple times
  const elemRegex = /\[element_attack:\s*element="([^"]+)"\s*target="([^"]+)"\]/gi;
  let elemMatch: RegExpExecArray | null;
  while ((elemMatch = elemRegex.exec(text)) !== null) {
    result.elementAttacks.push({
      element: elemMatch[1]!.trim().toLowerCase(),
      target: elemMatch[2]!.trim(),
    });
  }
  text = text.replace(/\[element_attack:\s*[^\]]+\]/gi, "");

  // [status: target="Goblin" effect="Poison" turns=3 stat="hp" modifier=-6]
  const statusRegex = /\[status:\s*([^\]]+)\]/gi;
  let statusMatch: RegExpExecArray | null;
  while ((statusMatch = statusRegex.exec(text)) !== null) {
    const parsed = parseCombatStatusTagBody(statusMatch[1] ?? "");
    if (parsed) result.combatStatuses.push(parsed);
  }
  text = text.replace(/\[status:\s*[^\]]+\]/gi, "");

  // [inventory: ...] — lenient parser: accepts any attribute order, quoted or
  // unquoted values, `item` or `items`, and a bare `add|remove` keyword.
  // Examples that all parse:
  //   [inventory: action="add" item="Bronze Key, Health Potion"]
  //   [inventory: add item="Bronze Key"]
  //   [inventory: item="Bronze Key" action=add]
  //   [inventory: items="Bronze Key, Map"]   (plural)
  //   [inventory: remove item=Bronze Key]    (unquoted single word)
  const invBlockRegex = /\[inventory:\s*([^\]]+)\]/gi;
  let invBlock: RegExpExecArray | null;
  while ((invBlock = invBlockRegex.exec(text)) !== null) {
    const update = parseInventoryTagBody(invBlock[1] || "");
    if (update) result.inventoryUpdates.push(update);
  }
  text = text.replace(/\[inventory:\s*[^\]]+\]/gi, "");

  // [party_add: character="Name"] — can appear multiple times
  const partyAddRegex = /\[party_add:\s*([^\]]+)\]/gi;
  let partyAddMatch: RegExpExecArray | null;
  while ((partyAddMatch = partyAddRegex.exec(text)) !== null) {
    const body = partyAddMatch[1] ?? "";
    const quoted = /(?:character|name)\s*=\s*"([^"]+)"/i.exec(body);
    const unquoted = quoted ? null : /(?:character|name)\s*=\s*([^,\]]+)/i.exec(body);
    const rawName = quoted?.[1] ?? unquoted?.[1] ?? body;
    const characterName = rawName.trim().replace(/^["']|["']$/g, "");
    if (characterName) {
      result.partyRecruits.push({ characterName });
    }
  }
  text = text.replace(/\[party_add:\s*[^\]]+\]/gi, "");

  // [Note: content] or [Book: content] — readable documents (balanced brackets)
  {
    const { contents: noteContents, remaining: afterNotes } = extractBalancedTags(text, "[Note:");
    text = afterNotes;
    for (const c of noteContents) {
      if (c) result.readables.push({ type: "note", content: c });
    }
    const { contents: bookContents, remaining: afterBooks } = extractBalancedTags(text, "[Book:");
    text = afterBooks;
    for (const c of bookContents) {
      if (c) result.readables.push({ type: "book", content: c });
    }
  }

  // [dice: ...] — informational dice results
  text = text.replace(/\[dice:\s*[^\]]+\]/gi, "");

  // Catch-all: strip any remaining [tag: ...] brackets the model may invent.
  // Quote-aware bracket-balanced walk so JSON content like `[x: {"y":[1]}]`
  // is removed entirely instead of stopping at the first inner `]`.
  text = stripUnknownBracketTags(text);

  // Remove orphaned ] on a line by itself (from partially-stripped multi-line tags)
  text = text.replace(/^\s*\]\s*$/gm, "");

  result.cleanContent = text.trim();
  return result;
}

/** Strip all GM command tags from text, returning clean display content. */
export function stripGmTags(content: string): string {
  let text = content
    // Strip the tactical-combat recap block sent after a battle (multiline, no colon).
    .replace(/\[combat_result\][\s\S]*?\[\/combat_result\]/gi, "")
    .replace(/\[music:\s*[^\]]+\]/gi, "")
    .replace(/\[sfx:\s*[^\]]+\]/gi, "")
    .replace(/\[bg:\s*[^\]]+\]/gi, "")
    .replace(/\[ambient:\s*[^\]]+\]/gi, "")
    .replace(/\[qte:\s*[^\]]+\]/gi, "")
    .replace(/\[state:\s*[^\]]+\]/gi, "")
    .replace(/\[reputation:\s*[^\]]+\]/gi, "")
    .replace(/\[combat:\s*[^\]]+\]/gi, "")
    .replace(/\[direction:\s*[^\]]+\]/gi, "")
    .replace(/\[widget:\s*[^\]]+\]/gi, "")
    .replace(/\[dialogue:\s*npc="[^"]*"\]/gi, "")
    .replace(/\[session_end:\s*[^\]]*\]/gi, "")
    .replace(/\[skill_check:\s*[^\]]+\]/gi, "")
    .replace(/\[element_attack:\s*[^\]]+\]/gi, "")
    .replace(/\[inventory:\s*[^\]]+\]/gi, "")
    .replace(/\[party_add:\s*[^\]]+\]/gi, "")
    .replace(/\[party-turn\]/gi, "")
    .replace(/\[party-chat\]/gi, "")
    .replace(/\[dice:\s*[^\]]+\]/gi, "");
  // Quote-aware catch-all for any remaining [tag: ...] the model may invent
  text = stripUnknownBracketTags(text);
  // Balanced bracket stripping for tags whose content may contain nested []
  text = stripBalancedTag(text, "[map_update:");
  text = stripBalancedTag(text, "[choices:");
  text = stripBalancedTag(text, "[Note:");
  text = stripBalancedTag(text, "[Book:");
  // Remove orphaned ] on a line by itself (from partially-stripped multi-line tags)
  text = text.replace(/^\s*\]\s*$/gm, "");
  return text.trim();
}

/**
 * Strip all GM tags EXCEPT [Note:] and [Book:] — these are kept inline
 * so the narration parser can create readable segments at the correct
 * story position.
 */
export function stripGmTagsKeepReadables(content: string): string {
  let text = content
    // Strip the tactical-combat recap block sent after a battle (multiline, no colon).
    .replace(/\[combat_result\][\s\S]*?\[\/combat_result\]/gi, "")
    .replace(/\[music:\s*[^\]]+\]/gi, "")
    .replace(/\[sfx:\s*[^\]]+\]/gi, "")
    .replace(/\[bg:\s*[^\]]+\]/gi, "")
    .replace(/\[ambient:\s*[^\]]+\]/gi, "")
    .replace(/\[qte:\s*[^\]]+\]/gi, "")
    .replace(/\[state:\s*[^\]]+\]/gi, "")
    .replace(/\[reputation:\s*[^\]]+\]/gi, "")
    .replace(/\[combat:\s*[^\]]+\]/gi, "")
    .replace(/\[direction:\s*[^\]]+\]/gi, "")
    .replace(/\[widget:\s*[^\]]+\]/gi, "")
    .replace(/\[dialogue:\s*npc="[^"]*"\]/gi, "")
    .replace(/\[session_end:\s*[^\]]*\]/gi, "")
    .replace(/\[skill_check:\s*[^\]]+\]/gi, "")
    .replace(/\[element_attack:\s*[^\]]+\]/gi, "")
    .replace(/\[inventory:\s*[^\]]+\]/gi, "")
    .replace(/\[party_add:\s*[^\]]+\]/gi, "")
    .replace(/\[party-turn\]/gi, "")
    .replace(/\[party-chat\]/gi, "")
    .replace(/\[dice:\s*[^\]]+\]/gi, "");
  // Quote-aware catch-all for unknown tags, keeping Note/Book inline.
  // Case-insensitive to match extractBalancedTags (which lowercases the prefix);
  // otherwise `[note:]` / `[book:]` would slip past extraction and get stripped.
  text = stripUnknownBracketTags(text, (name) => {
    const lower = name.toLowerCase();
    return lower === "note" || lower === "book";
  });
  // Balanced bracket stripping for non-readable tags
  text = stripBalancedTag(text, "[map_update:");
  text = stripBalancedTag(text, "[choices:");
  // NOTE: [Note:] and [Book:] are intentionally kept!
  // Remove orphaned ] on a line by itself (from partially-stripped multi-line tags)
  text = text.replace(/^\s*\]\s*$/gm, "");
  return text.trim();
}
