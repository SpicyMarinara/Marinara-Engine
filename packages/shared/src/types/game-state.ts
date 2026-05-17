// ──────────────────────────────────────────────
// Game State Types (RPG Companion replacement)
// ──────────────────────────────────────────────

/** Complete game state snapshot, linked to a message. */
export interface GameState {
  id: string;
  chatId: string;
  messageId: string;
  /** Swipe index this state corresponds to */
  swipeIndex: number;

  // ── Scene ──
  date: string | null;
  time: string | null;
  location: string | null;
  weather: string | null;
  temperature: string | null;

  // ── Characters ──
  presentCharacters: PresentCharacter[];

  // ── Events ──
  recentEvents: string[];

  // ── Player ──
  playerStats: PlayerStats | null;

  // ── Persona ──
  /** Persona status bars (Satiety, Energy, etc.) — tracked by persona-stats agent */
  personaStats: CharacterStat[] | null;

  /** Whether this snapshot has been committed (user sent a follow-up message). */
  committed?: boolean;

  /** JSON object of manually-edited field names → values. Carried forward across agent snapshots. */
  manualOverrides?: Record<string, string> | null;

  createdAt: string;
}

/** A character present in the current scene. */
export interface PresentCharacter {
  characterId: string;
  name: string;
  emoji: string;
  mood: string;
  /** @deprecated No longer tracked — kept for backward compat */
  action?: string;
  /** Brief physical appearance description */
  appearance: string | null;
  /** Current clothing / outfit description */
  outfit: string | null;
  /** Avatar image path (e.g., /api/avatars/file/<filename>) */
  avatarPath?: string | null;
  /** Featured tracker portrait focus, 0 = left, 100 = right. */
  portraitFocusX?: number;
  /** Featured tracker portrait focus, 0 = top, 100 = bottom; expression sprites may exceed 100 to dip below the frame. */
  portraitFocusY?: number;
  /** Featured tracker portrait zoom multiplier. */
  portraitZoom?: number;
  /** Per-character custom fields */
  customFields: Record<string, string>;
  /** Per-character stats (HP, etc.) */
  stats: CharacterStat[];
  /** What the character is thinking */
  thoughts: string | null;
}

/** A numeric stat for a character. */
export interface CharacterStat {
  name: string;
  value: number;
  max: number;
  color: string;
}

/** A user-defined custom tracker field. */
export interface CustomTrackerField {
  name: string;
  value: string;
}

/** Player-specific stats and inventory. */
export interface PlayerStats {
  /** Custom stat bars */
  stats: CharacterStat[];
  /** Classic RPG attributes */
  attributes: RPGAttributes | null;
  /** Skills list */
  skills: Record<string, number>;
  /** Inventory items */
  inventory: InventoryItem[];
  /** Active quests */
  activeQuests: QuestProgress[];
  /** Status text */
  status: string;
  /** User-defined custom tracker fields */
  customTrackerFields?: CustomTrackerField[];
}

/** Classic D&D-style attributes. */
export interface RPGAttributes {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

/** An item in the player's inventory. */
export interface InventoryItem {
  name: string;
  description: string;
  quantity: number;
  /** Location: "on_person" | "stored" | custom */
  location: string;
}

/** Quest progress data tracked in game state. */
export interface QuestProgress {
  questEntryId: string;
  name: string;
  currentStage: number;
  objectives: Array<{ text: string; completed: boolean }>;
  completed: boolean;
}
