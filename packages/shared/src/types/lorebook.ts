// ──────────────────────────────────────────────
// Lorebook / World Info Types
// ──────────────────────────────────────────────

/** Top-level lorebook categories. */
export type LorebookCategory = "world" | "character" | "npc" | "spellbook" | "uncategorized";

/** Selective logic operators. */
export type SelectiveLogic = "and" | "or" | "not";

/** Role for injected lorebook content. */
export type LorebookRole = "system" | "user" | "assistant";

/** A complete lorebook (collection of entries). */
export interface Lorebook {
  id: string;
  name: string;
  description: string;
  /** Top-level category this lorebook belongs to */
  category: LorebookCategory;
  /** Default scan depth for entries that don't override */
  scanDepth: number;
  /** Max tokens allocated to this lorebook */
  tokenBudget: number;
  recursiveScanning: boolean;
  /** Maximum recursion depth for recursive scanning (default 3) */
  maxRecursionDepth: number;
  /** ID of the character this lorebook is linked to (character books) */
  characterId: string | null;
  /** ID of the chat this lorebook is scoped to (if any) */
  chatId: string | null;
  /** Whether this lorebook is globally active */
  enabled: boolean;
  /** Tags for organizing/filtering lorebooks */
  tags: string[];
  /** Agent/generation origin tracking */
  generatedBy: "user" | "agent" | "import" | null;
  sourceAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A single lorebook entry. */
export interface LorebookEntry {
  id: string;
  lorebookId: string;
  /** Display name */
  name: string;
  /** The actual content injected into the prompt */
  content: string;
  /** Short summary used by the knowledge-router agent to decide if this entry is relevant */
  description: string;
  /** Primary trigger keywords (supports regex) */
  keys: string[];
  /** Secondary / optional keywords */
  secondaryKeys: string[];

  // ── Activation settings ──
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  selectiveLogic: SelectiveLogic;
  probability: number | null;
  /** How far back in chat to scan for matches */
  scanDepth: number | null;
  matchWholeWords: boolean;
  caseSensitive: boolean;
  /** Use regex matching for keys */
  useRegex: boolean;

  // ── Injection settings ──
  /** 0 = before character, 1 = after character, 2 = inject at message depth */
  position: number;
  /** Insertion depth in the message array */
  depth: number;
  /** Insertion priority (lower = earlier) */
  order: number;
  role: LorebookRole;

  // ── Timing ──
  /** Keep active for N messages after trigger */
  sticky: number | null;
  /** Wait N messages between activations */
  cooldown: number | null;
  /** Delay N messages before first activation */
  delay: number | null;
  /** Activations remaining before auto-disable (null = unlimited) */
  ephemeral: number | null;

  // ── Grouping ──
  group: string;
  groupWeight: number | null;

  // ── Engine extensions (beyond ST) ──
  /** When true, the Lorebook Keeper agent cannot modify or overwrite this entry */
  locked: boolean;
  /** When true, this entry's content won't trigger further entries during recursive scanning */
  preventRecursion: boolean;
  /** Sub-category tag for the entry (e.g. "location", "item", "lore", "quest") */
  tag: string;
  /** Relationships to other entries: { entryId: relationshipType } */
  relationships: Record<string, string>;
  /** Dynamic state for quests etc. (arbitrary JSON) */
  dynamicState: Record<string, unknown>;
  /** Game-state conditional activation rules */
  activationConditions: ActivationCondition[];
  /** Schedule: only active during certain in-game times/dates */
  schedule: LorebookSchedule | null;

  /** Pre-computed embedding vector for semantic matching (null if not vectorized) */
  embedding: number[] | null;

  createdAt: string;
  updatedAt: string;
}

/** A rule for conditional lorebook activation based on game state. */
export interface ActivationCondition {
  /** The game state field to check (e.g. "location", "time_of_day") */
  field: string;
  /** Comparison operator */
  operator: "equals" | "not_equals" | "contains" | "not_contains" | "gt" | "lt";
  /** Value to compare against */
  value: string;
}

/** Schedule for time-based activation. */
export interface LorebookSchedule {
  /** In-game times when active (e.g. ["morning", "evening"]) */
  activeTimes: string[];
  /** In-game dates/seasons when active */
  activeDates: string[];
  /** In-game locations where active */
  activeLocations: string[];
}

/** Quest-specific fields for quest-type lorebook entries. */
export interface QuestData {
  stages: QuestStage[];
  currentStageIndex: number;
  completed: boolean;
  rewards: string[];
}

/** A single stage/objective in a quest. */
export interface QuestStage {
  name: string;
  description: string;
  objectives: QuestObjective[];
  completionTrigger: string;
}

/** An objective within a quest stage. */
export interface QuestObjective {
  text: string;
  completed: boolean;
}
