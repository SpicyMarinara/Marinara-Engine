// ──────────────────────────────────────────────
// User Persona Types
// ──────────────────────────────────────────────

/** A user persona (the player's character/identity). */
export interface Persona {
  id: string;
  name: string;
  /** Short comment shown under the name (for disambiguation) */
  comment: string;
  description: string;
  personality: string;
  scenario: string;
  backstory: string;
  appearance: string;
  /** Avatar image path */
  avatarPath: string | null;
  /** Whether this is the currently active persona */
  isActive: boolean;
  /** Name display color/gradient (CSS value) */
  nameColor: string;
  /** Dialogue highlight color — quoted text bold + colored */
  dialogueColor: string;
  /** Chat bubble / dialogue box background color */
  boxColor: string;
  /** Persona status bars configuration (Satiety, Energy, etc.) */
  personaStats?: PersonaStatsConfig;
  /** Alternative description extensions (toggleable additions to the main description) */
  altDescriptions?: AltDescription[];
  /** Tags for organizing personas */
  tags?: string[];
  /** Saved Conversation mode activity/status text options for this persona */
  savedStatusOptions?: string[];
  createdAt: string;
  updatedAt: string;
}

/** A toggleable alternative/extended description block for a persona. */
export interface AltDescription {
  id: string;
  /** Short label for this description block (e.g. "Combat Skills", "Relationships") */
  label: string;
  /** The description content */
  content: string;
  /** Whether this block is currently active and appended to the prompt */
  active: boolean;
}

/** A single persona status bar definition. */
export interface PersonaStatBar {
  name: string;
  value: number;
  max: number;
  /** Hex color for the stat bar */
  color: string;
}

/** Configuration for persona status bars (needs/physical state). */
export interface PersonaStatsConfig {
  /** Whether persona stat tracking is enabled */
  enabled: boolean;
  /** The stat bars to track */
  bars: PersonaStatBar[];
}
