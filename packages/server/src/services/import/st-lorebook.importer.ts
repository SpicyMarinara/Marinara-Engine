// ──────────────────────────────────────────────
// Importer: SillyTavern World Info / Lorebook
// ──────────────────────────────────────────────
import type { DB } from "../../db/connection.js";
import { createLorebooksStorage } from "../storage/lorebooks.storage.js";
import type { CreateLorebookEntryInput, LorebookCategory } from "@marinara-engine/shared";
import type { TimestampOverrides } from "./import-timestamps.js";

interface STWorldInfoEntry {
  uid?: number;
  id?: number;
  // ST World Info format
  key?: string[] | string;
  keysecondary?: string[] | string;
  comment?: string;
  disable?: boolean;
  order?: number;
  // V2 Character Book format (alternative field names)
  keys?: string[] | string;
  secondary_keys?: string[] | string;
  name?: string;
  enabled?: boolean;
  insertion_order?: number;
  case_sensitive?: boolean;
  match_whole_words?: boolean;
  scan_depth?: number | null;
  // Common fields (same in both formats)
  content?: string;
  description?: string;
  constant?: boolean;
  selective?: boolean;
  selectiveLogic?: number | string;
  position?: number | string;
  depth?: number;
  probability?: number | null;
  scanDepth?: number | null;
  matchWholeWords?: boolean | null;
  caseSensitive?: boolean | null;
  role?: number | string;
  group?: string;
  groupWeight?: number | null;
  sticky?: number | null;
  cooldown?: number | null;
  delay?: number | null;
  ephemeral?: number | null;
  vectorized?: boolean;
  regex?: boolean;
  useRegex?: boolean;
  preventRecursion?: boolean;
  excludeRecursion?: boolean;
  locked?: boolean;
  extensions?: Record<string, unknown>;
}

interface STWorldInfo {
  entries?: Record<string, STWorldInfoEntry> | STWorldInfoEntry[];
  name?: string;
  description?: string;
  scan_depth?: number;
  scanDepth?: number;
  token_budget?: number;
  tokenBudget?: number;
  recursive_scanning?: boolean;
  recursiveScanning?: boolean;
  max_recursion_depth?: number;
  maxRecursionDepth?: number;
  extensions?: Record<string, unknown>;
}

// ── Category auto-detection ──

const CATEGORY_SIGNALS: Record<LorebookCategory, string[]> = {
  world: [
    "world",
    "realm",
    "kingdom",
    "empire",
    "continent",
    "geography",
    "climate",
    "history",
    "era",
    "age",
    "calendar",
    "religion",
    "magic system",
    "faction",
    "political",
    "economy",
    "trade",
    "war",
    "alliance",
    "treaty",
    "culture",
  ],
  character: [
    "personality",
    "backstory",
    "motivation",
    "goal",
    "fear",
    "trait",
    "relationship",
    "family",
    "appearance",
    "outfit",
    "skill",
    "ability",
    "power",
    "weakness",
    "likes",
    "dislikes",
    "occupation",
    "class",
  ],
  npc: [
    "shopkeeper",
    "innkeeper",
    "guard",
    "merchant",
    "villager",
    "bartender",
    "noble",
    "servant",
    "priest",
    "soldier",
    "bandit",
    "traveler",
    "stranger",
    "quest giver",
    "companion",
    "ally",
    "enemy",
    "rival",
    "mentor",
  ],
  spellbook: [
    "spell",
    "incantation",
    "cantrip",
    "ritual",
    "fireball",
    "heal",
    "magic missile",
    "lightning bolt",
    "summon",
    "enchant",
    "curse",
    "ward",
    "buff",
    "debuff",
    "attack skill",
    "special attack",
    "technique",
    "martial art",
    "combo",
  ],
  uncategorized: [],
};

function asEntryList(entries: STWorldInfo["entries"]): STWorldInfoEntry[] {
  if (Array.isArray(entries)) return entries;
  if (entries && typeof entries === "object") return Object.values(entries);
  return [];
}

function asStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return [raw];
  return [];
}

function nonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveSelectiveLogic(value: unknown): "and" | "or" | "not" {
  const logicMap: Record<number, "and" | "or" | "not"> = { 0: "and", 1: "or", 2: "not" };
  if (typeof value === "string" && ["and", "or", "not"].includes(value)) return value as "and" | "or" | "not";
  return logicMap[typeof value === "number" ? value : 0] ?? "and";
}

function resolvePosition(value: STWorldInfoEntry["position"]): number {
  if (typeof value === "string") {
    if (value === "after_char") return 1;
    if (value === "at_depth" || value === "depth") return 2;
    return 0;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2) return value;
  return 0;
}

function resolveRole(value: STWorldInfoEntry["role"]): "system" | "user" | "assistant" {
  const roleMap: Record<number, "system" | "user" | "assistant"> = {
    0: "system",
    1: "user",
    2: "assistant",
  };
  if (value === "system" || value === "user" || value === "assistant") return value;
  return roleMap[typeof value === "number" ? value : 0] ?? "system";
}

function detectCategory(entries: STWorldInfoEntry[], name?: string): LorebookCategory {
  const scores: Record<LorebookCategory, number> = {
    world: 0,
    character: 0,
    npc: 0,
    spellbook: 0,
    uncategorized: 0,
  };

  // Build a single text blob for analysis
  const allText = [
    name ?? "",
    ...entries.map((e) => [e.comment ?? e.name ?? "", e.content ?? "", ...asStringArray(e.key ?? e.keys)].join(" ")),
  ]
    .join(" ")
    .toLowerCase();

  for (const [cat, signals] of Object.entries(CATEGORY_SIGNALS) as [LorebookCategory, string[]][]) {
    for (const signal of signals) {
      if (allText.includes(signal)) {
        scores[cat]++;
      }
    }
  }

  // Find highest-scoring category
  let best: LorebookCategory = "world"; // default
  let bestScore = 0;
  for (const [cat, score] of Object.entries(scores) as [LorebookCategory, number][]) {
    if (cat === "uncategorized") continue;
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }

  return bestScore > 0 ? best : "world";
}

/**
 * Auto-detect a tag for an individual entry based on its content/keys.
 */
function detectEntryTag(entry: STWorldInfoEntry): string {
  const text = [entry.comment ?? entry.name ?? "", entry.content ?? "", ...asStringArray(entry.key ?? entry.keys)]
    .join(" ")
    .toLowerCase();
  const tagSignals: Record<string, string[]> = {
    location: [
      "city",
      "town",
      "village",
      "forest",
      "mountain",
      "river",
      "cave",
      "dungeon",
      "castle",
      "tower",
      "temple",
      "tavern",
      "inn",
    ],
    character: ["personality", "backstory", "appearance", "motivation", "fear", "goal", "trait"],
    item: ["sword", "potion", "artifact", "weapon", "armor", "ring", "amulet", "scroll", "tome"],
    faction: ["guild", "order", "alliance", "faction", "clan", "tribe", "house", "court"],
    lore: ["history", "legend", "myth", "prophecy", "ancient", "origin", "creation", "divine"],
    magic: ["spell", "enchant", "ritual", "arcane", "mana", "rune", "conjur", "summon"],
    creature: ["dragon", "beast", "monster", "demon", "undead", "spirit", "elemental", "golem"],
    event: ["battle", "war", "festival", "ceremony", "ritual", "tournament", "coronation"],
  };

  let bestTag = "";
  let bestScore = 0;
  for (const [tag, signals] of Object.entries(tagSignals)) {
    let score = 0;
    for (const signal of signals) {
      if (text.includes(signal)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTag = tag;
    }
  }
  return bestTag;
}

/**
 * Import a SillyTavern World Info JSON file.
 */
export async function importSTLorebook(
  raw: Record<string, unknown>,
  db: DB,
  options?: {
    characterId?: string;
    namePrefix?: string;
    fallbackName?: string;
    timestampOverrides?: TimestampOverrides | null;
    existingLorebookId?: string | null;
  },
) {
  const storage = createLorebooksStorage(db);
  const wi = raw as unknown as STWorldInfo;

  const entryList = asEntryList(wi.entries);
  const detectedCategory = detectCategory(entryList, wi.name);

  const lbName = options?.namePrefix
    ? `${options.namePrefix} — ${wi.name ?? "Lorebook"}`
    : (wi.name ?? options?.fallbackName ?? "Imported Lorebook");

  const lorebookInput = {
    name: lbName,
    description: nonEmptyString(wi.description) ?? "Imported from SillyTavern",
    category: detectedCategory,
    scanDepth: asNumber(wi.scan_depth ?? wi.scanDepth, 2),
    tokenBudget: asNumber(wi.token_budget ?? wi.tokenBudget, 2048),
    recursiveScanning: Boolean(wi.recursive_scanning ?? wi.recursiveScanning ?? false),
    maxRecursionDepth: asNumber(wi.max_recursion_depth ?? wi.maxRecursionDepth, 3),
    generatedBy: "import" as const,
    ...(options?.characterId ? { characterIds: [options.characterId] } : {}),
  };

  let lorebook: Record<string, unknown> | null = null;
  const existingLorebookId = options?.existingLorebookId ?? null;
  if (existingLorebookId) {
    const existing = (await storage.getById(existingLorebookId)) as Record<string, unknown> | null;
    if (existing) {
      lorebook = (await storage.update(existingLorebookId, lorebookInput)) as Record<string, unknown> | null;
      const existingEntries = (await storage.listEntries(existingLorebookId)) as unknown as Array<{ id: string }>;
      for (const entry of existingEntries) {
        await storage.removeEntry(entry.id);
      }
    }
  }

  if (!lorebook) {
    lorebook = (await storage.create(lorebookInput, options?.timestampOverrides)) as Record<string, unknown> | null;
  }

  if (!lorebook) return { error: "Failed to create lorebook" };

  const lorebookId = lorebook.id as string;
  const lorebookName = lorebook.name as string;
  let imported = 0;

  for (const entry of entryList) {
    // Resolve fields that differ between ST World Info format and V2 Character Book format
    const rawKeys = entry.key ?? entry.keys;
    const resolvedKeys = asStringArray(rawKeys);
    const rawSecondary = entry.keysecondary ?? entry.secondary_keys;
    const resolvedSecondaryKeys = asStringArray(rawSecondary);
    const resolvedName = nonEmptyString(entry.comment, entry.name) ?? `Entry ${imported + 1}`;
    // ST uses `disable` (inverted), V2 uses `enabled`
    const resolvedEnabled = entry.disable != null ? !entry.disable : (entry.enabled ?? true);
    const resolvedOrder = asNumber(entry.order ?? entry.insertion_order ?? entry.uid ?? entry.id, 100);
    // V2 position can be string ("before_char"/"after_char") — map to number
    const resolvedPosition = resolvePosition(entry.position);
    // Role can be a number (ST) or string (V2)
    const resolvedRole = resolveRole(entry.role);
    const resolvedCaseSensitive = entry.caseSensitive ?? entry.case_sensitive ?? false;
    const resolvedMatchWholeWords = entry.matchWholeWords ?? entry.match_whole_words ?? false;
    const sanitizedContent = normalizeString(entry.content);
    const sanitizedDescription = normalizeString(entry.description);

    const input: CreateLorebookEntryInput = {
      lorebookId: lorebookId,
      name: resolvedName,
      content: sanitizedContent,
      description: sanitizedDescription,
      keys: resolvedKeys,
      secondaryKeys: resolvedSecondaryKeys,
      enabled: resolvedEnabled,
      constant: entry.constant ?? false,
      selective: entry.selective ?? false,
      selectiveLogic: resolveSelectiveLogic(entry.selectiveLogic),
      probability: asNullableNumber(entry.probability),
      scanDepth: asNullableNumber(entry.scanDepth ?? entry.scan_depth),
      matchWholeWords: resolvedMatchWholeWords,
      caseSensitive: resolvedCaseSensitive,
      useRegex: Boolean(entry.useRegex ?? entry.regex ?? false),
      position: resolvedPosition,
      depth: asNumber(entry.depth, 4),
      order: resolvedOrder,
      role: resolvedRole,
      sticky: asNullableNumber(entry.sticky),
      cooldown: asNullableNumber(entry.cooldown),
      delay: asNullableNumber(entry.delay),
      ephemeral: asNullableNumber(entry.ephemeral),
      group: entry.group ?? "",
      groupWeight: asNullableNumber(entry.groupWeight),
      tag: detectEntryTag(entry),
      relationships: {},
      dynamicState: {},
      activationConditions: [],
      schedule: null,
      preventRecursion: Boolean(entry.preventRecursion ?? entry.excludeRecursion ?? false),
      locked: Boolean(entry.locked ?? false),
    };

    await storage.createEntry(input);
    imported++;
  }

  return {
    success: true,
    lorebookId: lorebookId,
    name: lorebookName,
    category: detectedCategory,
    entriesImported: imported,
    reimported: !!existingLorebookId,
  };
}
