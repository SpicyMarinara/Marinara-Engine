// ──────────────────────────────────────────────
// Game Mode Types
// ──────────────────────────────────────────────
import type { GenerationParameters } from "./prompt.js";

/** The four main states a game can be in during a session. */
export type GameActiveState = "exploration" | "dialogue" | "combat" | "travel_rest";

/** How the Game Master is controlled. */
export type GameGmMode = "standalone" | "character";

/** Status of a game session. */
export type GameSessionStatus = "setup" | "active" | "concluded";

// ── Maps ──

/** A cell in the overworld grid map. */
export interface GridCell {
  x: number;
  y: number;
  emoji: string;
  label: string;
  discovered: boolean;
  terrain: string;
  /** Optional longer description shown on hover/click */
  description?: string;
}

/** A node in a dungeon/interior node-graph map. */
export interface MapNode {
  id: string;
  emoji: string;
  label: string;
  /** Visual position (percentage 0–100) */
  x: number;
  /** Visual position (percentage 0–100) */
  y: number;
  discovered: boolean;
  description?: string;
}

/** An edge connecting two nodes in a node-graph map. */
export interface MapEdge {
  from: string;
  to: string;
  label?: string;
}

/** A map of the current area — either a grid (overworld/city) or a node graph (dungeon/interior). */
export interface GameMap {
  type: "grid" | "node";
  name: string;
  description: string;
  /** Grid dimensions (only for type: "grid") */
  width?: number;
  height?: number;
  cells?: GridCell[];
  /** Node graph data (only for type: "node") */
  nodes?: MapNode[];
  edges?: MapEdge[];
  /** Current party position — {x, y} for grids, node ID for node graphs */
  partyPosition: { x: number; y: number } | string;
}

// ── Party Arcs ──

/** A personal side-quest / character arc for a party member. */
export interface PartyArc {
  /** Party member's name (matches character card name) */
  name: string;
  /** Short description of their personal quest / arc */
  arc: string;
  /** Their personal goal that drives this arc */
  goal: string;
}

// ── Character Cards (tabletop-style) ──

/** A character card generated at game setup with game-specific info + stats. */
export interface GameCharacterCard {
  name: string;
  shortDescription: string;
  class: string;
  abilities: string[];
  strengths: string[];
  weaknesses: string[];
  extra: Record<string, string>;
  /** RPG stats pulled from the character/persona card (if enabled) */
  rpgStats?: {
    attributes: Array<{ name: string; value: number }>;
    hp: { value: number; max: number };
  };
}

// ── NPCs ──

/** A tracked NPC in the game world. */
export interface GameNpc {
  id: string;
  name: string;
  emoji: string;
  description: string;
  location: string;
  /** Party reputation with this NPC: -100 (hostile) to 100 (devoted) */
  reputation: number;
  /** Whether the party has met this NPC */
  met: boolean;
  /** Notable interactions or knowledge */
  notes: string[];
  /** Optional avatar URL (generated or uploaded) */
  avatarUrl?: string | null;
}

// ── Sessions ──

/** Summary of a completed game session, carried forward to future sessions. */
export interface SessionSummary {
  sessionNumber: number;
  /** Narrative recap of what happened */
  summary: string;
  /** How party member relationships evolved */
  partyDynamics: string;
  /** Current state of the party after the session */
  partyState: string;
  /** Important plot points, quests, and lore discovered */
  keyDiscoveries: string[];
  /** Major story revelations or plot-critical moments */
  revelations: string[];
  /** Important character moments (dates, bonding, betrayals, confessions, etc.) */
  characterMoments: string[];
  /** Serialized stats/inventory/quest snapshot */
  statsSnapshot: Record<string, unknown>;
  /** NPC reputation changes */
  npcUpdates: string[];
  timestamp: string;
}

// ── Setup ──

/** User preferences for creating a new game. */
export interface GameSetupConfig {
  genre: string;
  setting: string;
  tone: string;
  difficulty: string;
  playerGoals: string;
  gmMode: GameGmMode;
  /** Content rating: sfw or nsfw */
  rating: "sfw" | "nsfw";
  /** Character ID to use as GM (only when gmMode is "character") */
  gmCharacterId?: string;
  /** Character IDs for party members */
  partyCharacterIds: string[];
  /** User's persona ID */
  personaId?: string;
  /** Connection to use for the scene wrap-up turn (backgrounds, music, widgets, etc.).
   *  When omitted, falls back to sidecar (if available) or skips the wrap-up. */
  sceneConnectionId?: string;
  /** Enable automatic sprite generation for characters using image model */
  enableSpriteGeneration?: boolean;
  /** Connection ID for image generation (NPC portraits + location backgrounds) */
  imageConnectionId?: string;
  /** Unified art style prompt applied to all generated images (auto-generated at setup) */
  artStylePrompt?: string;
  /** Lorebook IDs to activate for this game */
  activeLorebookIds?: string[];
  /** Enable custom HUD widgets (model designs them at game start and updates during play) */
  enableCustomWidgets?: boolean;
  /** Language for all narration and dialogue (e.g. "English", "Japanese", "Spanish") */
  language?: string;
  /** Optional generation parameter overrides applied from the moment the game is created. */
  generationParameters?: Partial<GenerationParameters>;
}

// ── Dice ──

/** Result of a dice roll. */
export interface DiceRollResult {
  /** The notation used, e.g. "2d6+3" */
  notation: string;
  /** Individual die results */
  rolls: number[];
  /** Modifier applied */
  modifier: number;
  /** Final total */
  total: number;
}

/** Result of a skill check resolution. */
export interface SkillCheckResult {
  skill: string;
  dc: number;
  rolls: number[];
  usedRoll: number;
  modifier: number;
  total: number;
  success: boolean;
  criticalSuccess: boolean;
  criticalFailure: boolean;
  rollMode: "advantage" | "disadvantage" | "normal";
}

// ── Combat ──

/** A combatant (player or enemy) in the battle system. */
export interface Combatant {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  mp?: number;
  maxMp?: number;
  attack: number;
  defense: number;
  speed: number;
  level: number;
  /** "player" or "enemy" */
  side: "player" | "enemy";
  /** Sprite/avatar URL or asset tag */
  sprite?: string;
  statusEffects?: CombatStatusEffect[];
  /** Available skills beyond basic attack */
  skills?: CombatSkill[];
  /** Element this combatant's attacks carry */
  element?: string;
  /** Current elemental aura applied to this combatant */
  elementAura?: { element: string; gauge: number; sourceId: string } | null;
}

export interface CombatStatusEffect {
  name: string;
  modifier: number;
  stat: "attack" | "defense" | "speed" | "hp";
  turnsLeft: number;
}

export interface CombatSkill {
  id: string;
  name: string;
  /** "attack" | "heal" | "buff" | "debuff" */
  type: "attack" | "heal" | "buff" | "debuff";
  mpCost: number;
  /** Multiplier against base stat */
  power: number;
  description?: string;
}

/** Element presets for the elemental reaction system */
export type ElementPresetName = "default" | "genshin" | "hsr";

/** Lightweight element info for the client */
export interface ElementInfo {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

/** A single attack result in combat. */
export interface CombatAttackResult {
  attackerId: string;
  defenderId: string;
  attackRoll: number;
  defenseRoll: number;
  rawDamage: number;
  mitigated: number;
  finalDamage: number;
  isCritical: boolean;
  isMiss: boolean;
  remainingHp: number;
  isKo: boolean;
  /** Skill used, if any */
  skillName?: string;
  /** Element used in the attack */
  element?: string;
  /** Elemental reaction triggered */
  reaction?: {
    reaction: string;
    description: string;
    damageMultiplier: number;
    appliedEffects?: CombatStatusEffect[];
    consumedAura?: boolean;
  } | null;
}

/** Full round result from the server. */
export interface CombatRoundResult {
  round: number;
  initiative: Array<{ id: string; name: string; roll: number; speed: number; total: number }>;
  actions: CombatAttackResult[];
  statusTicks: Array<{ id: string; effect: string; expired: boolean }>;
  /** Elemental reactions that fired this round */
  reactions: Array<{ attackerId: string; defenderId: string; reaction: string; description: string }>;
}

/** Player-chosen action for their turn. */
export type CombatPlayerAction =
  | { type: "attack"; targetId: string }
  | { type: "skill"; skillId: string; targetId: string }
  | { type: "item"; itemId: string; targetId?: string }
  | { type: "defend" }
  | { type: "flee" };

/** Post-combat summary handed to the GM for narration. */
export interface CombatSummary {
  outcome: "victory" | "defeat" | "flee";
  rounds: number;
  party: Array<{
    name: string;
    hp: number;
    maxHp: number;
    ko: boolean;
    statusEffects: string[];
  }>;
  enemies: Array<{
    name: string;
    defeated: boolean;
    hp: number;
    maxHp: number;
  }>;
  loot?: Array<{ name: string; quantity?: number }>;
}

// ── Cinematic Direction ──

/** Visual effect types the GM can trigger via [direction: ...] commands. */
export type DirectionEffect =
  | "fade_from_black"
  | "fade_to_black"
  | "flash"
  | "screen_shake"
  | "blur"
  | "vignette"
  | "letterbox"
  | "color_grade"
  | "focus";

/** A single cinematic direction command parsed from GM output. */
export interface DirectionCommand {
  effect: DirectionEffect;
  /** Duration in seconds. Default 1. */
  duration?: number;
  /** Intensity 0-1. Default 0.5. */
  intensity?: number;
  /** Target layer: "background" | "content" | "all". Default "all". */
  target?: "background" | "content" | "all";
  /** Arbitrary params: color for flash, preset for color_grade, etc. */
  params?: Record<string, string>;
}

// ── HUD Widgets ──

/** Available widget types the model can use for custom HUD elements. */
export type HudWidgetType =
  | "progress_bar"
  | "gauge"
  | "relationship_meter"
  | "counter"
  | "stat_block"
  | "list"
  | "inventory_grid"
  | "timer";

/** Milestone marker on a progress/relationship bar. */
export interface WidgetMilestone {
  at: number;
  label: string;
}

/** A model-defined HUD widget. */
export interface HudWidget {
  id: string;
  type: HudWidgetType;
  label: string;
  icon?: string;
  position: "hud_left" | "hud_right";
  accent?: string;
  config: HudWidgetConfig;
}

/** Type-specific widget config. */
export interface HudWidgetConfig {
  // progress_bar / gauge / relationship_meter
  value?: number;
  max?: number;
  milestones?: WidgetMilestone[];
  dangerBelow?: number;

  // counter
  count?: number;

  // stat_block
  stats?: Array<{ name: string; value: number | string }>;

  // list
  items?: string[];

  // inventory_grid
  slots?: number;
  categories?: string[];
  contents?: Array<{ name: string; slot?: string; quantity?: number }>;

  // timer
  seconds?: number;
  running?: boolean;

  // GM-defined value hints for the scene model (e.g. "alpha | omega | beta" for a class stat)
  valueHints?: Record<string, string>;
}

/** A widget update command parsed from [widget: ...] tags. */
export interface WidgetUpdate {
  widgetId: string;
  /** Partial config / value changes to merge. */
  changes: Omit<Partial<HudWidgetConfig>, "value"> & {
    value?: number | string;
    add?: string;
    remove?: string;
    statName?: string;
  };
}

// ── Game Blueprint ──

/** Visual theme preferences designed by the GM during setup. */
export interface BlueprintVisualTheme {
  palette: string;
  uiStyle: string;
  moodDefault: string;
}

/** The GM-designed blueprint created during game setup. */
export interface GameBlueprint {
  hudWidgets: HudWidget[];
  introSequence: DirectionCommand[];
  visualTheme: BlueprintVisualTheme;
}

// ── Party Dialogue ──

/** The type of dialogue a party member can produce. */
export type PartyDialogueType = "main" | "side" | "extra" | "action" | "thought" | "whisper";

/** A single line of party dialogue parsed from the party generation response. */
export interface PartyDialogueLine {
  /** Character name who is speaking/acting. */
  character: string;
  /** The type of dialogue delivery. */
  type: PartyDialogueType;
  /** The dialogue/action text content. */
  content: string;
  /** Target character name (only for "whisper" type). */
  target?: string;
  /** Expression/mood for the character's sprite (e.g. "smirk", "angry", "happy"). */
  expression?: string;
}

// ── Checkpoints ──

export type CheckpointTrigger =
  | "manual"
  | "session_start"
  | "session_end"
  | "combat_start"
  | "combat_end"
  | "location_change"
  | "auto_interval";

export interface GameCheckpoint {
  id: string;
  chatId: string;
  snapshotId: string;
  messageId: string;
  label: string;
  triggerType: CheckpointTrigger;
  location: string | null;
  gameState: string | null;
  weather: string | null;
  timeOfDay: string | null;
  turnNumber: number | null;
  createdAt: string;
}
