// ──────────────────────────────────────────────
// Agent System Types
// ──────────────────────────────────────────────

/** When in the generation pipeline an agent runs. */
export type AgentPhase =
  /** Before the main generation (can modify prompt context) */
  | "pre_generation"
  /** Fires alongside the main generation (does not receive mainResponse) */
  | "parallel"
  /** After the main response is complete (can modify it) */
  | "post_processing";

/** The result type an agent can produce. */
export type AgentResultType =
  | "game_state_update"
  | "text_rewrite"
  | "sprite_change"
  | "echo_message"
  | "quest_update"
  | "image_prompt"
  | "context_injection"
  | "continuity_check"
  | "director_event"
  | "lorebook_update"
  | "prompt_review"
  | "background_change"
  | "character_tracker_update"
  | "persona_stats_update"
  | "custom_tracker_update"
  | "chat_summary"
  | "spotify_control"
  | "haptic_command"
  | "cyoa_choices"
  | "secret_plot"
  | "game_master_narration"
  | "party_action"
  | "game_map_update"
  | "game_state_transition";

/** Configuration for a single agent. */
export interface AgentConfig {
  id: string;
  /** Agent type identifier (e.g. "world-state", "prose-guardian") */
  type: string;
  /** Display name */
  name: string;
  description: string;
  /** When this agent runs in the pipeline */
  phase: AgentPhase;
  /** Whether globally enabled */
  enabled: boolean;
  /** Override: use a different connection/model for this agent */
  connectionId: string | null;
  /** Agent-specific prompt template */
  promptTemplate: string;
  /** Agent-specific settings */
  settings: Record<string, unknown>;
  /** Function/tool definitions this agent can use */
  tools: ToolDefinition[];
  /** Tool calling configuration */
  toolConfig: AgentToolConfig | null;
  createdAt: string;
  updatedAt: string;
}

/** Result produced by an agent after execution. */
export interface AgentResult {
  agentId: string;
  agentType: string;
  type: AgentResultType;
  /** The result payload (varies by type) */
  data: unknown;
  /** Token usage */
  tokensUsed: number;
  /** How long the agent took */
  durationMs: number;
  /** Whether the agent succeeded */
  success: boolean;
  error: string | null;
}

/** Shared context passed to every agent. */
export interface AgentContext {
  chatId: string;
  chatMode: string;
  /** Recent chat history (last N messages) */
  recentMessages: Array<{
    role: string;
    content: string;
    characterId?: string;
    /** Committed game state snapshot for this message (if any). */
    gameState?: import("./game-state.js").GameState | null;
  }>;
  /** The main response text (available for post-processing agents) */
  mainResponse: string | null;
  /** Current game state (if any) */
  gameState: import("./game-state.js").GameState | null;
  /** Active characters in the chat */
  characters: Array<{ id: string; name: string; description: string }>;
  /** User persona info */
  persona: {
    name: string;
    description: string;
    personality?: string;
    backstory?: string;
    appearance?: string;
    scenario?: string;
    personaStats?: { enabled: boolean; bars: Array<{ name: string; value: number; max: number; color: string }> };
    rpgStats?: {
      enabled: boolean;
      attributes: Array<{ name: string; value: number }>;
      hp: { value: number; max: number };
    };
  } | null;
  /** The agent's own persistent memory (key-value) */
  memory: Record<string, unknown>;
  /** Lorebook entries activated for this generation (read context) */
  activatedLorebookEntries: Array<{ id: string; name: string; content: string; tag: string }> | null;
  /** All lorebook IDs the agent can write to */
  writableLorebookIds: string[] | null;
  /** Chat summary text (if any) — helps agents avoid duplicating summarized info */
  chatSummary: string | null;
  /** Whether internal agent LLM calls should use transport streaming. */
  streaming?: boolean;
  /** Abort signal — when triggered, agent execution should stop. Typed as `any` to avoid DOM/Node lib dependency. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signal?: any;
}

/** Built-in agent type identifiers. */
export const BUILT_IN_AGENT_IDS = {
  WORLD_STATE: "world-state",
  PROSE_GUARDIAN: "prose-guardian",
  CONTINUITY: "continuity",
  EXPRESSION: "expression",
  ECHO_CHAMBER: "echo-chamber",
  DIRECTOR: "director",
  QUEST: "quest",
  ILLUSTRATOR: "illustrator",
  LOREBOOK_KEEPER: "lorebook-keeper",
  PROMPT_REVIEWER: "prompt-reviewer",
  COMBAT: "combat",
  BACKGROUND: "background",
  CHARACTER_TRACKER: "character-tracker",
  PERSONA_STATS: "persona-stats",
  HTML: "html",
  CHAT_SUMMARY: "chat-summary",
  SPOTIFY: "spotify",
  EDITOR: "editor",
  KNOWLEDGE_RETRIEVAL: "knowledge-retrieval",
  SCHEDULE_PLANNER: "schedule-planner",
  RESPONSE_ORCHESTRATOR: "response-orchestrator",
  AUTONOMOUS_MESSENGER: "autonomous-messenger",
  CUSTOM_TRACKER: "custom-tracker",
  HAPTIC: "haptic",
  CYOA: "cyoa",
  SECRET_PLOT_DRIVER: "secret-plot-driver",
  GAME_MASTER: "game-master",
  PARTY_PLAYER: "party-player",
} as const;

export type AgentCategory = "writer" | "tracker" | "misc";

export interface BuiltInAgentMeta {
  id: string;
  name: string;
  description: string;
  phase: AgentPhase;
  enabledByDefault: boolean;
  /** Whether "Add as Prompt Section" should default to on when first created */
  defaultInjectAsSection?: boolean;
  category: AgentCategory;
}

export const BUILT_IN_AGENTS: BuiltInAgentMeta[] = [
  // ── Writer Agents ──
  {
    id: "prose-guardian",
    name: "Prose Guardian",
    description:
      "Analyzes recent messages for repetition, rhetorical patterns, and sentence structure — then generates strict writing directives to force variety and freshness.",
    phase: "pre_generation",
    enabledByDefault: false,
    category: "writer",
  },
  {
    id: "continuity",
    name: "Continuity Checker",
    description: "Detects contradictions with established lore and facts.",
    phase: "post_processing",
    enabledByDefault: false,
    category: "writer",
  },
  {
    id: "director",
    name: "Narrative Director",
    description: "Introduces events, NPCs, and plot beats to keep the story moving.",
    phase: "pre_generation",
    enabledByDefault: false,
    defaultInjectAsSection: true,
    category: "writer",
  },
  {
    id: "echo-chamber",
    name: "Echo Chamber",
    description: "Simulates a live streaming-style chat reacting to your roleplay in real time.",
    phase: "parallel",
    enabledByDefault: false,
    category: "misc",
  },
  {
    id: "prompt-reviewer",
    name: "Prompt Reviewer",
    description:
      "Analyses your prompt preset for clarity, redundancy, and formatting issues, and suggests improvements.",
    phase: "pre_generation",
    enabledByDefault: false,
    category: "writer",
  },

  // ── Tracker Agents ──
  {
    id: "world-state",
    name: "World State",
    description: "Tracks date/time, weather, location, and present characters automatically.",
    phase: "post_processing",
    enabledByDefault: false,
    defaultInjectAsSection: true,
    category: "tracker",
  },
  {
    id: "expression",
    name: "Expression Engine",
    description: "Detects character emotions and selects VN sprites/expressions.",
    phase: "post_processing",
    enabledByDefault: false,
    category: "tracker",
  },
  {
    id: "quest",
    name: "Quest Tracker",
    description: "Manages quest objectives, completion states, and rewards.",
    phase: "post_processing",
    enabledByDefault: false,
    defaultInjectAsSection: true,
    category: "tracker",
  },
  {
    id: "background",
    name: "Background",
    description: "Selects the most fitting background image for the current scene from your uploaded backgrounds.",
    phase: "post_processing",
    enabledByDefault: false,
    category: "tracker",
  },
  {
    id: "character-tracker",
    name: "Character Tracker",
    description:
      "Tracks which characters are present in the scene, their mood, actions, appearance, outfit, thoughts, and per-character stats (HP, etc.).",
    phase: "post_processing",
    enabledByDefault: false,
    defaultInjectAsSection: true,
    category: "tracker",
  },
  {
    id: "persona-stats",
    name: "Persona Stats",
    description:
      "Tracks the player persona's status bars — Satiety, Energy, Hygiene, and other custom stats — with realistic changes based on narrative events.",
    phase: "post_processing",
    enabledByDefault: false,
    defaultInjectAsSection: true,
    category: "tracker",
  },
  {
    id: "custom-tracker",
    name: "Custom Tracker",
    description:
      "Tracks user-defined fields (currencies, counters, flags, or any custom data). Add any fields you want the model to keep track of during the roleplay.",
    phase: "post_processing",
    enabledByDefault: false,
    defaultInjectAsSection: true,
    category: "tracker",
  },

  // ── Misc Agents ──
  {
    id: "illustrator",
    name: "Illustrator",
    description: "Generates image prompts for key scenes (requires image generation API).",
    phase: "post_processing",
    enabledByDefault: false,
    category: "misc",
  },
  {
    id: "lorebook-keeper",
    name: "Lorebook Keeper",
    description:
      "Automatically creates and updates lorebook entries based on story events, new characters, and world changes.",
    phase: "post_processing",
    enabledByDefault: false,
    category: "misc",
  },
  {
    id: "combat",
    name: "Combat",
    description: "Manages combat encounters, initiative, HP tracking, and turn-based actions.",
    phase: "parallel",
    enabledByDefault: false,
    category: "misc",
  },
  {
    id: "html",
    name: "Immersive HTML",
    description:
      "Injects a prompt directive that encourages the model to include inline HTML, CSS, and JS for immersive in-world visual elements.",
    phase: "pre_generation",
    enabledByDefault: false,
    category: "misc",
  },
  {
    id: "chat-summary",
    name: "Automated Chat Summary",
    description:
      "Automatically generates a rolling summary of the conversation every X user messages. Add to a chat for hands-free summary updates.",
    phase: "post_processing",
    enabledByDefault: false,
    category: "misc",
  },
  {
    id: "spotify",
    name: "Spotify DJ",
    description:
      "Analyzes the narrative mood and controls Spotify playback — searching tracks, adjusting volume, and cueing music to match the scene. Requires a Spotify Premium account and API credentials.",
    phase: "post_processing",
    enabledByDefault: false,
    category: "misc",
  },
  {
    id: "editor",
    name: "Consistency Editor",
    description:
      "Reads all agent data (tracker states, prose rules, continuity notes) and edits the model's response to fix factual errors, outfit/stat contradictions, repetition, and other inconsistencies.",
    phase: "post_processing",
    enabledByDefault: false,
    category: "writer",
  },
  {
    id: "knowledge-retrieval",
    name: "Knowledge Retrieval",
    description:
      "Scans specified lorebooks for information relevant to the current conversation, summarizes the key data, and injects it into the prompt — a lightweight RAG pipeline without vector databases.",
    phase: "pre_generation",
    enabledByDefault: false,
    category: "writer",
  },

  // ── Conversation Agents ──
  {
    id: "schedule-planner",
    name: "Schedule Planner",
    description:
      "Generates a realistic weekly schedule for each character in Conversation mode based on their personality and description. Updates automatically each week.",
    phase: "pre_generation",
    enabledByDefault: false,
    category: "tracker",
  },
  {
    id: "response-orchestrator",
    name: "Response Orchestrator",
    description:
      "For group Conversation chats — decides which character(s) should respond to a message based on context, personality, and relevance.",
    phase: "pre_generation",
    enabledByDefault: false,
    category: "misc",
  },
  {
    id: "autonomous-messenger",
    name: "Autonomous Messenger",
    description:
      "Allows characters to send messages unprompted when the user has been inactive, based on personality traits like talkativeness and the character's current schedule.",
    phase: "parallel",
    enabledByDefault: false,
    category: "misc",
  },
  {
    id: "haptic",
    name: "Love Toys Control",
    description:
      "Analyzes narrative content and controls connected intimate toys in real time. Requires Intiface Central running locally — connect your toy there first, then enable this agent.",
    phase: "post_processing",
    enabledByDefault: false,
    category: "misc",
  },
  {
    id: "cyoa",
    name: "CYOA Choices",
    description:
      "Generates interactive Choose Your Own Adventure choices after each assistant message. Click a choice to send it as your response. Roleplay mode only.",
    phase: "post_processing",
    enabledByDefault: false,
    category: "misc",
  },
  {
    id: "secret-plot-driver",
    name: "Secret Plot Driver",
    description:
      "Secretly develops an overarching story arc and scene directions behind the scenes. The user never sees the actual plot — only a hint that something is unfolding. Creates long-term narrative structure with protagonist growth, mysteries, and pacing control.",
    phase: "pre_generation",
    enabledByDefault: false,
    defaultInjectAsSection: true,
    category: "writer",
  },

  // ── Game Agents ──
  {
    id: "game-master",
    name: "Game Master",
    description:
      "Narrates the RPG, handles dice rolls, manages NPCs, combat triggers, state transitions, map updates, story pacing, and session flow. The primary responder in Game mode.",
    phase: "pre_generation",
    enabledByDefault: false,
    defaultInjectAsSection: true,
    category: "misc",
  },
  {
    id: "party-player",
    name: "Party Player",
    description:
      "Controls non-player party members autonomously — their dialogue, actions, and decisions. Only sees public narration and party chat (no GM secrets like story arcs or plot twists).",
    phase: "parallel",
    enabledByDefault: false,
    category: "misc",
  },
];

export const BUILT_IN_AGENT_RUN_INTERVAL_DEFAULTS: Readonly<Record<string, number>> = {
  director: 5,
  "lorebook-keeper": 8,
  "chat-summary": 5,
};

export function getDefaultBuiltInAgentSettings(agentType: string): Record<string, unknown> {
  const builtIn = BUILT_IN_AGENTS.find((agent) => agent.id === agentType);
  const settings: Record<string, unknown> = {};

  if (builtIn?.defaultInjectAsSection) {
    settings.injectAsSection = true;
  }

  const runInterval = BUILT_IN_AGENT_RUN_INTERVAL_DEFAULTS[agentType];
  if (runInterval !== undefined) {
    settings.runInterval = runInterval;
  }

  return settings;
}

/** Recommended default tools for each built-in agent type. */
export const DEFAULT_AGENT_TOOLS: Record<string, string[]> = {
  "world-state": ["update_game_state"],
  "prose-guardian": [],
  continuity: ["search_lorebook"],
  expression: ["set_expression"],
  "echo-chamber": [],
  director: ["trigger_event"],
  quest: ["update_game_state"],
  illustrator: [],
  "lorebook-keeper": ["search_lorebook"],
  "prompt-reviewer": [],
  combat: ["roll_dice", "update_game_state"],
  background: [],
  "character-tracker": ["update_game_state"],
  "persona-stats": ["update_game_state"],
  html: [],
  "chat-summary": [],
  spotify: [
    "spotify_get_playlists",
    "spotify_get_playlist_tracks",
    "spotify_search",
    "spotify_play",
    "spotify_set_volume",
  ],
  editor: [],
  "knowledge-retrieval": ["search_lorebook"],
  "schedule-planner": [],
  "response-orchestrator": [],
  "autonomous-messenger": [],
  "custom-tracker": ["update_game_state"],
  haptic: [],
  cyoa: [],
  "secret-plot-driver": [],
  "game-master": ["roll_dice", "update_game_state"],
  "party-player": [],
};

/** Data shape for a lorebook_update agent result. */
export interface LorebookUpdateResult {
  /** "create" | "update" | "delete" */
  action: "create" | "update" | "delete";
  /** Target lorebook ID */
  lorebookId: string;
  /** Entry ID (for update/delete) */
  entryId?: string;
  /** Entry data (for create/update) */
  entry?: {
    name: string;
    content: string;
    keys: string[];
    tag?: string;
  };
}

// ──────────────────────────────────────────────
// Function Calling / Tool Use Types
// ──────────────────────────────────────────────

/** JSON Schema subset for tool parameter definitions. */
export interface ToolParameterSchema {
  type: "object" | "string" | "number" | "boolean" | "array";
  description?: string;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  items?: ToolParameterProperty;
}

export interface ToolParameterProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: ToolParameterProperty;
  default?: unknown;
}

/** Definition of a tool/function that an agent can call. */
export interface ToolDefinition {
  /** Unique tool name (e.g. "get_weather", "roll_dice") */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for the parameters */
  parameters: ToolParameterSchema;
}

/** A tool call made by the model during generation. */
export interface ToolCall {
  /** Server-assigned ID for tracking */
  id: string;
  /** Which tool to call */
  name: string;
  /** Parsed arguments */
  arguments: Record<string, unknown>;
}

/** Result of executing a tool call. */
export interface ToolResult {
  /** Matches the ToolCall id */
  toolCallId: string;
  /** Tool name for display */
  name: string;
  /** Stringified result */
  result: string;
  /** Whether execution succeeded */
  success: boolean;
}

/** A user-created custom function tool persisted in DB. */
export interface CustomTool {
  id: string;
  name: string;
  description: string;
  parametersSchema: ToolParameterSchema;
  executionType: "webhook" | "static" | "script";
  webhookUrl: string | null;
  staticResult: string | null;
  scriptBody: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Extended AgentConfig with tool definitions. */
export interface AgentToolConfig {
  /** Tools this agent can use */
  tools: ToolDefinition[];
  /** How many tool calls are allowed per turn (0 = unlimited) */
  maxCallsPerTurn: number;
  /** Whether to allow parallel tool calls */
  parallelCalls: boolean;
}

/** Built-in tool definitions available to all agents. */
export const BUILT_IN_TOOLS: ToolDefinition[] = [
  {
    name: "roll_dice",
    description:
      "Roll dice using standard notation (e.g. 2d6, 1d20+5). Used for RPG mechanics, skill checks, and random outcomes.",
    parameters: {
      type: "object",
      properties: {
        notation: { type: "string", description: "Dice notation (e.g. '2d6', '1d20+5', '3d8-2')" },
        reason: { type: "string", description: "Why the roll is being made (e.g. 'Perception check')" },
      },
      required: ["notation"],
    },
  },
  {
    name: "update_game_state",
    description: "Update the current game state — character stats, inventory, quest progress, etc.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Type of update",
          enum: ["stat_change", "inventory_add", "inventory_remove", "quest_update", "location_change", "time_advance"],
        },
        target: { type: "string", description: "Who or what is being updated (character name or 'player')" },
        key: { type: "string", description: "The specific stat/item/quest being changed" },
        value: { type: "string", description: "The new value or change amount" },
        description: { type: "string", description: "Human-readable description of the change" },
      },
      required: ["type", "target", "key", "value"],
    },
  },
  {
    name: "set_expression",
    description: "Set a character's sprite expression for visual novel display.",
    parameters: {
      type: "object",
      properties: {
        characterName: { type: "string", description: "Name of the character" },
        expression: { type: "string", description: "Expression name (e.g. happy, sad, angry, neutral)" },
      },
      required: ["characterName", "expression"],
    },
  },
  {
    name: "trigger_event",
    description: "Trigger a narrative event — introduce an NPC, start a quest, change the scene, etc.",
    parameters: {
      type: "object",
      properties: {
        eventType: {
          type: "string",
          description: "Type of event",
          enum: [
            "npc_entrance",
            "npc_exit",
            "quest_start",
            "quest_complete",
            "scene_change",
            "combat_start",
            "combat_end",
            "revelation",
            "custom",
          ],
        },
        description: { type: "string", description: "What happens in this event" },
        involvedCharacters: { type: "array", items: { type: "string" }, description: "Names of characters involved" },
      },
      required: ["eventType", "description"],
    },
  },
  {
    name: "search_lorebook",
    description: "Search the lorebook for relevant world-building information.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — keywords, character names, locations, etc." },
        category: { type: "string", description: "Optional category filter" },
      },
      required: ["query"],
    },
  },
  {
    name: "spotify_get_playlists",
    description:
      "Get the user's Spotify playlists and saved library. Returns playlist names and URIs. Use this FIRST to see what the user already has before searching.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of playlists to return (default: 20, max: 50)" },
      },
    },
  },
  {
    name: "spotify_get_playlist_tracks",
    description:
      "Get tracks from a specific playlist or the user's Liked Songs. For Liked Songs (playlistId='liked'), returns the FULL library automatically (up to 500 tracks). For regular playlists, returns a paginated batch.",
    parameters: {
      type: "object",
      properties: {
        playlistId: {
          type: "string",
          description: "Playlist ID (from spotify_get_playlists), or 'liked' for the user's full Liked Songs library",
        },
        limit: {
          type: "number",
          description:
            "Number of tracks to return for regular playlists (default: 30, max: 50). Ignored for 'liked' which auto-fetches all.",
        },
        offset: {
          type: "number",
          description: "Offset for pagination for regular playlists (default: 0). Ignored for 'liked'.",
        },
      },
      required: ["playlistId"],
    },
  },
  {
    name: "spotify_search",
    description:
      "Search Spotify for tracks matching a mood, genre, or specific query. Returns a list of track URIs. Prefer using the user's playlists/liked songs first.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query — mood keywords, genre, artist, or track name (e.g. 'dark ambient orchestral', 'battle music epic')",
        },
        limit: { type: "number", description: "Number of results to return (default: 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "spotify_play",
    description:
      "Play one or more tracks, or a playlist, on the user's active Spotify device. Pass multiple URIs to queue a sequence of tracks.",
    parameters: {
      type: "object",
      properties: {
        uri: {
          type: "string",
          description:
            "Single Spotify URI to play (e.g. 'spotify:track:xxx' or 'spotify:playlist:xxx'). Use 'uris' instead when queueing multiple tracks.",
        },
        uris: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of Spotify track URIs to play as a queue (e.g. ['spotify:track:xxx', 'spotify:track:yyy']). The first track plays immediately, the rest are queued.",
        },
        reason: { type: "string", description: "Why this track fits the current scene mood" },
      },
      required: [],
    },
  },
  {
    name: "spotify_set_volume",
    description: "Set the playback volume on the user's active Spotify device (0-100).",
    parameters: {
      type: "object",
      properties: {
        volume: { type: "number", description: "Volume level (0-100)" },
        reason: {
          type: "string",
          description: "Why the volume is being adjusted (e.g. 'quiet scene', 'intense battle')",
        },
      },
      required: ["volume"],
    },
  },
];
