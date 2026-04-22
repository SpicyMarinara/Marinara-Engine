// ──────────────────────────────────────────────
// Chat & Message Types
// ──────────────────────────────────────────────

/** The four primary chat modes the engine supports. */
export type ChatMode = "conversation" | "roleplay" | "visual_novel" | "game";

/** How a multi-character (group) chat is handled. */
export type GroupChatMode = "merged" | "individual";

/** How individual-mode group chats decide response order. */
export type GroupResponseOrder = "sequential" | "smart" | "manual";

/** Role of a message in the conversation. */
export type MessageRole = "user" | "assistant" | "system" | "narrator";

/** Which side sprite sidebars / default sprite layouts prefer. */
export type SpriteSide = "left" | "right";

/** A saved on-screen sprite anchor position within the chat area. */
export interface SpritePlacement {
  /** Horizontal anchor percentage within the chat stage. */
  x: number;
  /** Vertical anchor percentage within the chat stage. */
  y: number;
}

/** A single chat conversation. */
export interface Chat {
  id: string;
  name: string;
  mode: ChatMode;
  characterIds: string[];
  /** Groups related chats together (like ST "chat files" per character) */
  groupId: string | null;
  personaId: string | null;
  promptPresetId: string | null;
  connectionId: string | null;
  /** ID of a linked chat (conversation ↔ roleplay bidirectional link) */
  connectedChatId: string | null;
  /** Folder this chat belongs to (null = root/unfiled) */
  folderId: string | null;
  /** Manual sort order within a folder (lower = higher). 0 = use default updatedAt sort. */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  metadata: ChatMetadata;
}

/** A folder for organising chats in the sidebar. */
export interface ChatFolder {
  id: string;
  name: string;
  mode: ChatMode;
  color: string;
  sortOrder: number;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A single day's auto-generated conversation summary. */
export interface DaySummaryEntry {
  /** Narrative recap of the day. */
  summary: string;
  /** Short strings the characters must remember going forward. */
  keyDetails: string[];
}

/** A single week's consolidated conversation summary (Monday → Sunday). */
export interface WeekSummaryEntry {
  /** Narrative recap of the week. */
  summary: string;
  /** Consolidated key details the characters must remember going forward. */
  keyDetails: string[];
}

/** Extra metadata stored on a chat. */
export interface ChatMetadata {
  /** Summary text for context injection */
  summary: string | null;
  /** Custom tags for organisation */
  tags: string[];
  /** Whether agents are enabled for this chat */
  enableAgents: boolean;
  /** Per-agent enable overrides (agentId → boolean) */
  agentOverrides: Record<string, boolean>;
  /** Agent IDs scoped to this chat. Non-empty = only these agents run; empty = use globally-enabled agents. */
  activeAgentIds: string[];
  /** Explicit target lorebook for the Lorebook Keeper in this chat. Null/omitted = auto-pick. */
  lorebookKeeperTargetLorebookId?: string | null;
  /** How many assistant responses behind the latest available one Lorebook Keeper should read from. */
  lorebookKeeperReadBehindMessages?: number;
  /** Tool/function IDs scoped to this chat. Non-empty = only these tools are sent; empty = use all enabled tools. */
  activeToolIds: string[];
  /** Per-chat variable selections for preset variables (variableName → value or values) */
  presetChoices: Record<string, string | string[]>;
  /** Group chat mode: "merged" (narrator) or "individual" (separate characters) */
  groupChatMode?: GroupChatMode;
  /** Group individual mode: color dialogues with speaker tags */
  groupSpeakerColors?: boolean;
  /** Group individual mode response order: "sequential" or "smart" (agent-decided) */
  groupResponseOrder?: GroupResponseOrder;
  /** Characters with visible roleplay sprites enabled for this chat. */
  spriteCharacterIds?: string[];
  /** Preferred sidebar / default layout side for chat sprites. */
  spritePosition?: SpriteSide;
  /** Saved freeform positions for enabled roleplay sprites. */
  spritePlacements?: Record<string, SpritePlacement>;
  /** When true, a shared group scenario replaces individual character card scenarios */
  groupScenarioOverride?: boolean;
  /** The shared scenario text used when groupScenarioOverride is enabled */
  groupScenarioText?: string;
  /** When true, tracker agents only run when the user manually triggers them (not after every generation) */
  manualTrackers?: boolean;
  /** Whether to recall memories from past conversations during generation. Default: true for conversation/scenes, false for roleplay. */
  enableMemoryRecall?: boolean;
  /** Discord webhook URL to mirror messages to a Discord channel. */
  discordWebhookUrl?: string;
  /** Per-chat ephemeral / enabled overrides for lorebook entries (entryId → state).
   *  Tracked per-chat so ephemeral countdown in one chat doesn't affect others. */
  entryStateOverrides?: Record<string, { ephemeral?: number | null; enabled?: boolean }>;
  /** ID of the chat preset most recently applied to this chat (drives the preset bar dropdown). */
  appliedChatPresetId?: string | null;
  // ── Game Mode Fields ──
  /** UUID linking all sessions of one game */
  gameId?: string;
  /** Session number within a game (1-based) */
  gameSessionNumber?: number;
  /** Current session lifecycle status */
  gameSessionStatus?: import("./game.js").GameSessionStatus;
  /** Current game state (exploration, dialogue, combat, travel_rest) */
  gameActiveState?: import("./game.js").GameActiveState;
  /** Whether GM is a standalone narrator or an existing character */
  gameGmMode?: import("./game.js").GameGmMode;
  /** Character ID used as GM (when gameGmMode is "character") */
  gameGmCharacterId?: string;
  /** Character IDs for the player's party */
  gamePartyCharacterIds?: string[];
  /** ID of the linked party chat */
  gamePartyChatId?: string;
  /** Current area map */
  gameMap?: import("./game.js").GameMap | null;
  /** Summaries of all previous sessions */
  gamePreviousSessionSummaries?: import("./game.js").SessionSummary[];
  /** GM-only: overarching story arc and plot (never sent to party agent) */
  gameStoryArc?: string;
  /** GM-only: planned plot twists (never sent to party agent) */
  gamePlotTwists?: string[];
  /** Active dialogue sub-scene chat ID */
  gameDialogueChatId?: string | null;
  /** Active combat sub-scene chat ID */
  gameCombatChatId?: string | null;
  /** User's initial game setup preferences */
  gameSetupConfig?: import("./game.js").GameSetupConfig | null;
  /** Tracked NPCs with reputation */
  gameNpcs?: import("./game.js").GameNpc[];

  // ── Conversation-Mode Auto-Summarization ──
  /** Per-day auto-generated conversation summaries (key: "DD.MM.YYYY"). */
  daySummaries?: Record<string, DaySummaryEntry>;
  /** Per-week consolidated conversation summaries (key: Monday "DD.MM.YYYY"). */
  weekSummaries?: Record<string, WeekSummaryEntry>;

  /** Any extra key-value data */
  [key: string]: unknown;
}

/** A single message within a chat. */
export interface Message {
  id: string;
  chatId: string;
  role: MessageRole;
  /** Which character sent this (null for user messages / narration) */
  characterId: string | null;
  content: string;
  /** Index into the swipes array for the currently displayed alternative */
  activeSwipeIndex: number;
  /** Number of swipes for this message (0 or 1 = no alternatives) */
  swipeCount?: number;
  createdAt: string;
  /** Extra display data */
  extra: MessageExtra;
}

/** Additional data attached to a message. */
export interface MessageExtra {
  /** Display-formatted text (may differ from raw content) */
  displayText: string | null;
  /** Whether this message was generated by the AI vs typed by user */
  isGenerated: boolean;
  /** Token count of this message */
  tokenCount: number | null;
  /** Generation metadata */
  generationInfo: GenerationInfo | null;
  /** When true, this message marks the "new start" of the conversation — all earlier messages are excluded from context */
  isConversationStart?: boolean;
  /** Model's reasoning/thinking content (if available) */
  thinking?: string | null;
  /** Per-swipe sprite expressions from the Expression Engine agent */
  spriteExpressions?: Record<string, string> | null;
  /** Per-swipe CYOA choices from the CYOA Choices agent */
  cyoaChoices?: Array<{ label: string; text: string }> | null;
  /** Snapshot of the persona that was active when this message was sent (user messages only) */
  personaSnapshot?: {
    personaId: string;
    name: string;
    avatarUrl?: string | null;
    nameColor?: string | null;
    dialogueColor?: string | null;
    boxColor?: string | null;
  } | null;
}

/** Metadata about how a message was generated. */
export interface GenerationInfo {
  model: string;
  provider: string;
  temperature: number | null;
  tokensPrompt: number | null;
  tokensCompletion: number | null;
  tokensCachedPrompt?: number | null;
  tokensCacheWritePrompt?: number | null;
  durationMs: number | null;
  finishReason: string | null;
}

/** A swipe (alternate response) for a message. */
export interface MessageSwipe {
  id: string;
  messageId: string;
  index: number;
  content: string;
  createdAt: string;
  extra: MessageExtra;
}

/** Payload sent to start a generation. */
export interface GenerateRequest {
  chatId: string;
  userMessage: string | null;
  /** If set, regenerate the message at this ID */
  regenerateMessageId: string | null;
  /** Override connection for this generation */
  connectionId: string | null;
}

/** An SSE event from the generation stream. */
export interface StreamEvent {
  type: "token" | "agent_update" | "game_state" | "done" | "error";
  data: string;
  agentId?: string;
  messageId?: string;
}

/** An OOC influence queued from a conversation chat to be injected into a roleplay chat. */
export interface OocInfluence {
  id: string;
  sourceChatId: string;
  targetChatId: string;
  content: string;
  anchorMessageId: string;
  consumed: boolean;
  createdAt: string;
}
