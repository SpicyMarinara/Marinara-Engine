// ──────────────────────────────────────────────
// Lorebook / World Info Types
// ──────────────────────────────────────────────

/** Top-level lorebook categories. */
export type LorebookCategory = "world" | "character" | "npc" | "spellbook" | "uncategorized";

/** Selective logic operators. */
export type SelectiveLogic = "and" | "or" | "not";

/** Role for injected lorebook content. */
export type LorebookRole = "system" | "user" | "assistant";

/** Include/exclude behavior for contextual lorebook filters. */
export type LorebookFilterMode = "any" | "include" | "exclude";

/** Extra places an entry can scan for keyword matches beyond recent chat text. */
export type LorebookMatchingSource =
  | "character_name"
  | "character_description"
  | "character_personality"
  | "character_scenario"
  | "character_tags"
  | "persona_description"
  | "persona_tags";

/** A complete lorebook (collection of entries). */
export interface Lorebook {
  id: string;
  name: string;
  description: string;
  /** Top-level category this lorebook belongs to */
  category: LorebookCategory;
  /** Default scan depth for entries that don't override */
  scanDepth: number;
  /** Max output tokens allocated to this lorebook */
  tokenBudget: number;
  recursiveScanning: boolean;
  /** Maximum recursion depth for recursive scanning (default 3) */
  maxRecursionDepth: number;
  /** ID of the character this lorebook is linked to (character books) */
  characterId: string | null;
  /** ID of the persona this lorebook is linked to (persona books) */
  personaId: string | null;
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

/**
 * A collapsible container that groups lorebook entries to reduce visual
 * clutter in the editor. Folders are flat in v1 — `parentFolderId` is reserved
 * for future nested-folder support and must currently be null.
 *
 * Folder enable/disable acts as a gate: when `enabled` is false, every entry
 * inside the folder is treated as inactive at activation time, regardless of
 * the entry's own `enabled` flag. The entry's own flag is preserved (the
 * folder toggle does NOT mutate it), so re-enabling the folder restores the
 * entries' previous individual settings.
 *
 * Folders sit above root-level entries in the editor display. Folder display
 * order among siblings is controlled by `order`. Entry `order` continues to
 * control prompt-injection priority and per-container display sort.
 */
export interface LorebookFolder {
  id: string;
  lorebookId: string;
  /** Display name shown on the folder header row. */
  name: string;
  /**
   * When false, every entry whose `folderId` matches this folder is skipped
   * during activation, regardless of the entry's own `enabled` flag.
   */
  enabled: boolean;
  /**
   * Reserved for future nested-folder support. Always null in v1; the server
   * rejects non-null values.
   */
  parentFolderId: string | null;
  /** Display order among sibling folders (lower = higher in the list). */
  order: number;
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
  /**
   * Character gates for activation. These are independent from lorebook tags,
   * which are only organizational.
   */
  characterFilterMode: LorebookFilterMode;
  characterFilterIds: string[];
  /** Character-card tag gates for activation. */
  characterTagFilterMode: LorebookFilterMode;
  characterTagFilters: string[];
  /** Generation trigger gates (chat, game, swipe, lorebook_assistant, etc.). */
  generationTriggerFilterMode: LorebookFilterMode;
  generationTriggerFilters: string[];
  /** Additional non-chat sources to include when matching entry keywords. */
  additionalMatchingSources: LorebookMatchingSource[];

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
  /**
   * ID of the folder this entry belongs to, or null if it lives at the
   * lorebook root level. Display sort by `order` is per-container — entries
   * inside a folder sort independently from root entries and from entries in
   * other folders. When a folder is disabled, every entry whose `folderId`
   * matches is excluded from activation regardless of `enabled`.
   */
  folderId: string | null;

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
