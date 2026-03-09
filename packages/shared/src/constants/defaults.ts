// ──────────────────────────────────────────────
// Default Configurations
// ──────────────────────────────────────────────
import type { GenerationParameters } from "../types/prompt.js";

/** App version — single source of truth. */
export const APP_VERSION = "1.2.0";

/** Default generation parameters for new presets. */
export const DEFAULT_GENERATION_PARAMS: GenerationParameters = {
  temperature: 1,
  topP: 1,
  topK: 0,
  minP: 0,
  maxTokens: 4096,
  maxContext: 128000,
  frequencyPenalty: 0,
  presencePenalty: 0,
  reasoningEffort: null,
  verbosity: null,
  squashSystemMessages: true,
  showThoughts: true,
  useMaxContext: false,
  stopSequences: [],
  strictRoleFormatting: true,
  singleUserMessage: false,
};

/** Maximum file sizes for uploads. */
export const MAX_FILE_SIZES = {
  AVATAR: 10 * 1024 * 1024, // 10 MB
  BACKGROUND: 20 * 1024 * 1024, // 20 MB
  SPRITE: 10 * 1024 * 1024, // 10 MB
  CHARACTER_JSON: 5 * 1024 * 1024, // 5 MB
  LOREBOOK_JSON: 10 * 1024 * 1024, // 10 MB
  PRESET_JSON: 2 * 1024 * 1024, // 2 MB
  CHAT_JSONL: 50 * 1024 * 1024, // 50 MB
} as const;

/** Limits for various entities. */
export const LIMITS = {
  /** Max messages to include in context for agents */
  AGENT_CONTEXT_MESSAGES: 20,
  /** Max lorebook entries that can be injected */
  MAX_LOREBOOK_ENTRIES: 100,
  /** Default summary trigger: every N messages */
  SUMMARY_INTERVAL: 50,
  /** Default vectorization: top-K results */
  VECTOR_TOP_K: 10,
  /** Echo Chamber: messages per generation */
  ECHO_CHAMBER_MESSAGES: 5,
} as const;
