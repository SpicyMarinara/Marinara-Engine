// ──────────────────────────────────────────────
// Chat Preset Types
// ──────────────────────────────────────────────
// Reusable bundles of chat settings that the user can apply as defaults
// when creating new chats. One "active" preset per chat mode determines
// the starting state for any newly created chat in that mode.
//
// What presets DO carry: connection, prompt preset for non-conversation chats, and most metadata
// (agents, tools, lorebooks, translation, advanced parameters, context
// limit, memory recall, discord mirror, etc.).
//
// What presets DO NOT carry: per-chat identity (name, characters,
// persona, group, sprites, scene prompt, summary, tags, ephemeral
// lorebook overrides, scene lifecycle state, connected chat link, folder/sort placement).

import type { ChatMode, ChatMetadata } from "./chat.js";

/** Settings stored in a chat preset. All fields optional — only set ones override defaults. */
export interface ChatPresetSettings {
  /** Top-level chat fields */
  connectionId?: string | null;
  promptPresetId?: string | null;
  /** Subset of ChatMetadata — chat-specific keys (sprites, summary, tags, etc.) are stripped before saving. */
  metadata?: Partial<ChatMetadata>;
}

/** A chat preset stored in the database. */
export interface ChatPreset {
  id: string;
  name: string;
  /** Which chat mode this preset applies to. */
  mode: ChatMode;
  /** True for the built-in "Default" preset (cannot be deleted, renamed, or saved into). */
  isDefault: boolean;
  /** True for the preset currently used as the starting state for new chats of this mode. */
  isActive: boolean;
  /** Bundled chat settings (JSON). */
  settings: ChatPresetSettings;
  createdAt: string;
  updatedAt: string;
}

/** Metadata keys that must NOT be saved into a preset (chat-specific). */
export const CHAT_PRESET_EXCLUDED_METADATA_KEYS: readonly string[] = [
  "summary",
  "tags",
  "spriteCharacterIds",
  "spritePlacements",
  "entryStateOverrides",
  "groupScenarioOverride",
  "groupScenarioText",
  "sceneOriginChatId",
  "sceneInitiatorCharId",
  "sceneDescription",
  "sceneScenario",
  "sceneSystemPrompt",
  "sceneRating",
  "sceneStatus",
  "sceneConversationContext",
  "sceneRelationshipHistory",
  "sceneBackground",
  "activeSceneChatId",
  "sceneBusyCharIds",
  // Lorebooks are owned by the chat, never by the preset.
  "activeLorebookIds",
] as const;

/** Top-level chat keys that CAN be saved into a preset. promptPresetId is ignored for conversation-mode presets. */
export const CHAT_PRESET_INCLUDED_CHAT_KEYS: readonly string[] = ["connectionId", "promptPresetId"] as const;
