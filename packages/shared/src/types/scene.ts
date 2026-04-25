// ──────────────────────────────────────────────
// Scene Types
// ──────────────────────────────────────────────
// A "scene" is a character-initiated (or user-initiated) mini-roleplay
// session that branches off from a conversation chat. The character
// sets up the scenario, background, and participants. After the scene
// concludes, a summary is injected as a permanent memory and the user
// returns to the conversation.
// ──────────────────────────────────────────────

/** Metadata stored on the scene's roleplay chat. */
export interface SceneMeta {
  /** The conversation chat that spawned this scene. */
  sceneOriginChatId: string;
  /** The character who initiated the scene (or null if user-initiated). */
  sceneInitiatorCharId: string | null;
  /** Human-readable scenario description (shown as narrator message). */
  sceneDescription: string;
  /** Hidden scenario / plot outline — not shown to user. */
  sceneScenario: string | null;
  /** Background filename to apply. */
  sceneBackground: string | null;
  /** Custom system prompt crafted by the LLM for this scene. */
  sceneSystemPrompt: string | null;
  /** A concise summary of the characters' relationship and shared history. */
  sceneRelationshipHistory: string | null;
  /** Whether the scene is SFW or NSFW. */
  sceneRating: "sfw" | "nsfw";
  /** Lifecycle status. */
  sceneStatus: "active" | "concluded";
}

/** The comprehensive plan the LLM generates for a scene. */
export interface SceneFullPlan {
  /** Display name for the scene chat. */
  name: string;
  /** Short description shown to the user as a narrator message. */
  description: string;
  /** Hidden scenario / plot arc — kept secret from the user. */
  scenario: string;
  /** The first in-character message the character sends to start the scene. */
  firstMessage: string;
  /** Background filename (from the available list) or null. */
  background: string | null;
  /** Character IDs to include (defaults to origin chat chars). */
  characterIds: string[];
  /** Custom system prompt: writing style, narration POV, tense, participation style. */
  systemPrompt: string;
  /** SFW or NSFW. */
  rating: "sfw" | "nsfw";
  /** A concise summary of who the characters are to each other and their shared history. */
  relationshipHistory: string;
  /** A short, fun, user-visible guide about how to play/participate in this scene. */
  participationGuide: string;
}

/** Request body for POST /scene/create. */
export interface SceneCreateRequest {
  /** The conversation chat to branch from. */
  originChatId: string;
  /** Which character initiated the scene (null if user-initiated). */
  initiatorCharId: string | null;
  /** The full plan from the LLM. */
  plan: SceneFullPlan;
  /** Connection to use for the scene's generations. */
  connectionId?: string | null;
}

/** Response from POST /scene/create. */
export interface SceneCreateResponse {
  /** The newly created scene (roleplay) chat. */
  chatId: string;
  chatName: string;
  description: string;
  /** Background filename chosen for the scene (null if none). */
  background: string | null;
}

/** Request body for POST /scene/conclude. */
export interface SceneConcludeRequest {
  /** The scene (roleplay) chat to conclude. */
  sceneChatId: string;
  /** Connection override. */
  connectionId?: string | null;
}

/** Response from POST /scene/conclude. */
export interface SceneConcludeResponse {
  /** The generated narrative summary. */
  summary: string;
  /** The origin conversation chat ID to navigate back to. */
  originChatId: string;
}

/** Request body for POST /scene/abandon. */
export interface SceneAbandonRequest {
  /** The scene (roleplay) chat to abandon and delete. */
  sceneChatId: string;
}

/** Response from POST /scene/abandon. */
export interface SceneAbandonResponse {
  /** The origin conversation chat ID to navigate back to. */
  originChatId: string;
}

/** Scene fork behavior: clone preserves the source scene, convert consumes it. */
export type SceneForkMode = "clone" | "convert";

/**
 * Request body for POST /scene/fork.
 *
 * Forking preserves roleplay continuity, messages, and safe roleplay settings,
 * but intentionally does not copy scene lifecycle metadata into the new chat.
 */
export interface SceneForkRequest {
  /** The scene (roleplay) chat to copy into a standalone roleplay. */
  sceneChatId: string;
  /** Clone keeps the original scene active; convert detaches and discards it. */
  mode: SceneForkMode;
  /** Clone only: copy scene messages chronologically up to and including this message. */
  upToMessageId?: string;
  /** Include origin conversation and relationship context as a hidden narrator note. */
  includePreSceneSummary?: boolean;
  /** Include scene participation guidance messages when copying scene messages. */
  includeParticipationGuide?: boolean;
}

/** Response from POST /scene/fork. */
export interface SceneForkResponse {
  /** The newly created standalone roleplay chat. */
  chatId: string;
  /** The origin conversation chat ID, if the scene had one. */
  originChatId: string | null;
  mode: SceneForkMode;
}

/** Request body for POST /scene/plan (user-initiated via /scene command). */
export interface ScenePlanRequest {
  /** The conversation chat where the user typed /scene. */
  chatId: string;
  /** The user's description of what kind of scene they want. */
  prompt: string;
  /** Connection override. */
  connectionId?: string | null;
}

/** Response from POST /scene/plan — the LLM plans everything. */
export interface ScenePlanResponse {
  plan: SceneFullPlan | null;
  /** Set when planning failed (e.g. model didn't return valid JSON). */
  error?: string;
}
