// ──────────────────────────────────────────────────────────────
// Known Model Lists per Provider
// Copied from SillyTavern release branch (public/index.html)
// https://github.com/SillyTavern/SillyTavern/blob/release/public/index.html
// ──────────────────────────────────────────────────────────────
import type { APIProvider } from "../types/connection.js";

export interface KnownModel {
  id: string;
  name: string;
  context: number;
  /** Output / max completion tokens (0 = unknown / model default) */
  maxOutput: number;
}

// ── OpenAI (from #model_openai_select) ──

export const OPENAI_MODELS: KnownModel[] = [
  // GPT-5.4
  { id: "gpt-5.4", name: "gpt-5.4", context: 1050000, maxOutput: 128000 },
  { id: "gpt-5.4-2026-03-05", name: "gpt-5.4-2026-03-05", context: 1050000, maxOutput: 128000 },
  // GPT-5.4 Pro (Responses API only)
  { id: "gpt-5.4-pro", name: "gpt-5.4-pro", context: 1050000, maxOutput: 128000 },
  { id: "gpt-5.4-pro-2026-03-05", name: "gpt-5.4-pro-2026-03-05", context: 1050000, maxOutput: 128000 },
  // GPT-5.2
  { id: "gpt-5.2", name: "gpt-5.2", context: 1000000, maxOutput: 32768 },
  { id: "gpt-5.2-2025-12-11", name: "gpt-5.2-2025-12-11", context: 1000000, maxOutput: 32768 },
  { id: "gpt-5.2-chat-latest", name: "gpt-5.2-chat-latest", context: 1000000, maxOutput: 32768 },
  // GPT-5.1
  { id: "gpt-5.1", name: "gpt-5.1", context: 1000000, maxOutput: 32768 },
  { id: "gpt-5.1-2025-11-13", name: "gpt-5.1-2025-11-13", context: 1000000, maxOutput: 32768 },
  { id: "gpt-5.1-chat-latest", name: "gpt-5.1-chat-latest", context: 1000000, maxOutput: 32768 },
  // GPT-5
  { id: "gpt-5", name: "gpt-5", context: 1000000, maxOutput: 32768 },
  { id: "gpt-5-2025-08-07", name: "gpt-5-2025-08-07", context: 1000000, maxOutput: 32768 },
  { id: "gpt-5-chat-latest", name: "gpt-5-chat-latest", context: 1000000, maxOutput: 32768 },
  { id: "gpt-5-mini", name: "gpt-5-mini", context: 1000000, maxOutput: 32768 },
  { id: "gpt-5-mini-2025-08-07", name: "gpt-5-mini-2025-08-07", context: 1000000, maxOutput: 32768 },
  { id: "gpt-5-nano", name: "gpt-5-nano", context: 1000000, maxOutput: 16384 },
  { id: "gpt-5-nano-2025-08-07", name: "gpt-5-nano-2025-08-07", context: 1000000, maxOutput: 16384 },
  // GPT-4o
  { id: "gpt-4o", name: "gpt-4o", context: 128000, maxOutput: 16384 },
  { id: "gpt-4o-2024-11-20", name: "gpt-4o-2024-11-20", context: 128000, maxOutput: 16384 },
  { id: "gpt-4o-2024-08-06", name: "gpt-4o-2024-08-06", context: 128000, maxOutput: 16384 },
  { id: "gpt-4o-2024-05-13", name: "gpt-4o-2024-05-13", context: 128000, maxOutput: 4096 },
  { id: "chatgpt-4o-latest", name: "chatgpt-4o-latest", context: 128000, maxOutput: 16384 },
  // GPT-4o mini
  { id: "gpt-4o-mini", name: "gpt-4o-mini", context: 128000, maxOutput: 16384 },
  { id: "gpt-4o-mini-2024-07-18", name: "gpt-4o-mini-2024-07-18", context: 128000, maxOutput: 16384 },
  // GPT-4.1
  { id: "gpt-4.1", name: "gpt-4.1", context: 1047576, maxOutput: 32768 },
  { id: "gpt-4.1-2025-04-14", name: "gpt-4.1-2025-04-14", context: 1047576, maxOutput: 32768 },
  { id: "gpt-4.1-mini", name: "gpt-4.1-mini", context: 1047576, maxOutput: 32768 },
  { id: "gpt-4.1-mini-2025-04-14", name: "gpt-4.1-mini-2025-04-14", context: 1047576, maxOutput: 32768 },
  { id: "gpt-4.1-nano", name: "gpt-4.1-nano", context: 1047576, maxOutput: 32768 },
  { id: "gpt-4.1-nano-2025-04-14", name: "gpt-4.1-nano-2025-04-14", context: 1047576, maxOutput: 32768 },
  // o-series reasoning
  { id: "o1", name: "o1", context: 200000, maxOutput: 100000 },
  { id: "o1-2024-12-17", name: "o1-2024-12-17", context: 200000, maxOutput: 100000 },
  { id: "o1-mini", name: "o1-mini", context: 128000, maxOutput: 65536 },
  { id: "o1-mini-2024-09-12", name: "o1-mini-2024-09-12", context: 128000, maxOutput: 65536 },
  { id: "o1-pro", name: "o1-pro", context: 200000, maxOutput: 100000 },
  { id: "o1-pro-2025-03-19", name: "o1-pro-2025-03-19", context: 200000, maxOutput: 100000 },
  { id: "o3", name: "o3", context: 200000, maxOutput: 100000 },
  { id: "o3-2025-04-16", name: "o3-2025-04-16", context: 200000, maxOutput: 100000 },
  { id: "o3-mini", name: "o3-mini", context: 200000, maxOutput: 100000 },
  { id: "o3-mini-2025-01-31", name: "o3-mini-2025-01-31", context: 200000, maxOutput: 100000 },
  { id: "o4-mini", name: "o4-mini", context: 200000, maxOutput: 100000 },
  { id: "o4-mini-2025-04-16", name: "o4-mini-2025-04-16", context: 200000, maxOutput: 100000 },
  // Codex (Responses API only)
  { id: "gpt-5.3-codex", name: "gpt-5.3-codex", context: 400000, maxOutput: 128000 },
  { id: "gpt-5.2-codex", name: "gpt-5.2-codex", context: 400000, maxOutput: 128000 },
  { id: "gpt-5.1-codex", name: "gpt-5.1-codex", context: 400000, maxOutput: 128000 },
  { id: "gpt-5.1-codex-max", name: "gpt-5.1-codex-max", context: 400000, maxOutput: 128000 },
  { id: "gpt-5.1-codex-mini", name: "gpt-5.1-codex-mini", context: 400000, maxOutput: 128000 },
  { id: "gpt-5-codex", name: "gpt-5-codex", context: 400000, maxOutput: 128000 },
  { id: "codex-mini-latest", name: "codex-mini-latest", context: 200000, maxOutput: 100000 },
  // GPT-4.5
  { id: "gpt-4.5-preview", name: "gpt-4.5-preview", context: 128000, maxOutput: 16384 },
  { id: "gpt-4.5-preview-2025-02-27", name: "gpt-4.5-preview-2025-02-27", context: 128000, maxOutput: 16384 },
  // GPT-4 Turbo and GPT-4
  { id: "gpt-4-turbo", name: "gpt-4-turbo", context: 128000, maxOutput: 4096 },
  { id: "gpt-4-turbo-2024-04-09", name: "gpt-4-turbo-2024-04-09", context: 128000, maxOutput: 4096 },
  { id: "gpt-4-turbo-preview", name: "gpt-4-turbo-preview", context: 128000, maxOutput: 4096 },
  { id: "gpt-4-0125-preview", name: "gpt-4-0125-preview (2024)", context: 128000, maxOutput: 4096 },
  { id: "gpt-4-1106-preview", name: "gpt-4-1106-preview (2023)", context: 128000, maxOutput: 4096 },
  { id: "gpt-4", name: "gpt-4", context: 8192, maxOutput: 4096 },
  { id: "gpt-4-0613", name: "gpt-4-0613 (2023)", context: 8192, maxOutput: 4096 },
  { id: "gpt-4-0314", name: "gpt-4-0314 (2023)", context: 8192, maxOutput: 4096 },
  // GPT-3.5 Turbo
  { id: "gpt-3.5-turbo", name: "gpt-3.5-turbo", context: 16385, maxOutput: 4096 },
  { id: "gpt-3.5-turbo-0125", name: "gpt-3.5-turbo-0125 (2024)", context: 16385, maxOutput: 4096 },
  { id: "gpt-3.5-turbo-1106", name: "gpt-3.5-turbo-1106 (2023)", context: 16385, maxOutput: 4096 },
  { id: "gpt-3.5-turbo-instruct", name: "gpt-3.5-turbo-instruct", context: 4096, maxOutput: 4096 },
  // Other
  { id: "babbage-002", name: "babbage-002", context: 16384, maxOutput: 4096 },
  { id: "davinci-002", name: "davinci-002", context: 16384, maxOutput: 4096 },
];

// ── Anthropic / Claude (from #model_claude_select) ──

export const ANTHROPIC_MODELS: KnownModel[] = [
  { id: "claude-opus-4-7", name: "claude-opus-4-7", context: 1000000, maxOutput: 128000 },
  { id: "claude-opus-4-6", name: "claude-opus-4-6", context: 1000000, maxOutput: 32000 },
  { id: "claude-sonnet-4-6", name: "claude-sonnet-4-6", context: 1000000, maxOutput: 32000 },
  { id: "claude-opus-4-5", name: "claude-opus-4-5", context: 1000000, maxOutput: 32000 },
  { id: "claude-opus-4-5-20251101", name: "claude-opus-4-5-20251101", context: 1000000, maxOutput: 32000 },
  { id: "claude-sonnet-4-5", name: "claude-sonnet-4-5", context: 1000000, maxOutput: 16000 },
  { id: "claude-sonnet-4-5-20250929", name: "claude-sonnet-4-5-20250929", context: 1000000, maxOutput: 16000 },
  { id: "claude-haiku-4-5", name: "claude-haiku-4-5", context: 200000, maxOutput: 8192 },
  { id: "claude-haiku-4-5-20251001", name: "claude-haiku-4-5-20251001", context: 200000, maxOutput: 8192 },
  { id: "claude-opus-4-1", name: "claude-opus-4-1", context: 200000, maxOutput: 32000 },
  { id: "claude-opus-4-1-20250805", name: "claude-opus-4-1-20250805", context: 200000, maxOutput: 32000 },
  { id: "claude-opus-4-0", name: "claude-opus-4-0", context: 200000, maxOutput: 32000 },
  { id: "claude-opus-4-20250514", name: "claude-opus-4-20250514", context: 200000, maxOutput: 32000 },
  { id: "claude-sonnet-4-0", name: "claude-sonnet-4-0", context: 200000, maxOutput: 16000 },
  { id: "claude-sonnet-4-20250514", name: "claude-sonnet-4-20250514", context: 200000, maxOutput: 16000 },
  { id: "claude-3-7-sonnet-latest", name: "claude-3-7-sonnet-latest", context: 200000, maxOutput: 128000 },
  { id: "claude-3-7-sonnet-20250219", name: "claude-3-7-sonnet-20250219", context: 200000, maxOutput: 128000 },
  { id: "claude-3-5-sonnet-latest", name: "claude-3-5-sonnet-latest", context: 200000, maxOutput: 8192 },
  { id: "claude-3-5-sonnet-20241022", name: "claude-3-5-sonnet-20241022", context: 200000, maxOutput: 8192 },
  { id: "claude-3-5-sonnet-20240620", name: "claude-3-5-sonnet-20240620", context: 200000, maxOutput: 8192 },
  { id: "claude-3-5-haiku-latest", name: "claude-3-5-haiku-latest", context: 200000, maxOutput: 8192 },
  { id: "claude-3-5-haiku-20241022", name: "claude-3-5-haiku-20241022", context: 200000, maxOutput: 8192 },
  { id: "claude-3-opus-20240229", name: "claude-3-opus-20240229", context: 200000, maxOutput: 4096 },
  { id: "claude-3-haiku-20240307", name: "claude-3-haiku-20240307", context: 200000, maxOutput: 4096 },
];

// ── Claude (Subscription via Claude Agent SDK) ──
// Models reachable through the local `claude` CLI auth (Pro / Max). Anthropic
// gates which model IDs are available per plan tier; the SDK surfaces a clear
// error if the signed-in plan can't run the requested model. We keep this list
// to the current tool-eligible families to avoid offering retired aliases that
// the subscription path no longer accepts.
export const CLAUDE_SUBSCRIPTION_MODELS: KnownModel[] = [
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", context: 1000000, maxOutput: 128000 },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", context: 1000000, maxOutput: 32000 },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", context: 1000000, maxOutput: 32000 },
  { id: "claude-opus-4-5", name: "Claude Opus 4.5", context: 1000000, maxOutput: 32000 },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", context: 1000000, maxOutput: 16000 },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", context: 200000, maxOutput: 8192 },
];

// ── Google AI Studio (from #model_google_select) ──

export const GOOGLE_MODELS: KnownModel[] = [
  // Gemini 3.1
  { id: "gemini-3.1-pro-preview", name: "gemini-3.1-pro-preview", context: 1000000, maxOutput: 65536 },
  { id: "gemini-3.1-flash-image-preview", name: "gemini-3.1-flash-image-preview", context: 65535, maxOutput: 8192 },
  // Gemini 3.0
  { id: "gemini-3-pro-preview", name: "gemini-3-pro-preview", context: 1000000, maxOutput: 65536 },
  { id: "gemini-3-pro-image-preview", name: "gemini-3-pro-image-preview", context: 65535, maxOutput: 8192 },
  { id: "gemini-3-flash-preview", name: "gemini-3-flash-preview", context: 1000000, maxOutput: 65536 },
  // Gemini 2.5
  { id: "gemini-2.5-pro", name: "gemini-2.5-pro", context: 1000000, maxOutput: 65536 },
  { id: "gemini-2.5-pro-preview-06-05", name: "gemini-2.5-pro-preview-06-05", context: 1000000, maxOutput: 65536 },
  { id: "gemini-2.5-pro-preview-05-06", name: "gemini-2.5-pro-preview-05-06", context: 1000000, maxOutput: 65536 },
  { id: "gemini-2.5-pro-preview-03-25", name: "gemini-2.5-pro-preview-03-25", context: 1000000, maxOutput: 65536 },
  { id: "gemini-2.5-flash", name: "gemini-2.5-flash", context: 1000000, maxOutput: 65536 },
  {
    id: "gemini-2.5-flash-preview-09-2025",
    name: "gemini-2.5-flash-preview-09-2025",
    context: 1000000,
    maxOutput: 65536,
  },
  { id: "gemini-2.5-flash-preview-05-20", name: "gemini-2.5-flash-preview-05-20", context: 1000000, maxOutput: 65536 },
  { id: "gemini-2.5-flash-lite", name: "gemini-2.5-flash-lite", context: 1000000, maxOutput: 65536 },
  {
    id: "gemini-2.5-flash-lite-preview-09-2025",
    name: "gemini-2.5-flash-lite-preview-09-2025",
    context: 1000000,
    maxOutput: 65536,
  },
  {
    id: "gemini-2.5-flash-lite-preview-06-17",
    name: "gemini-2.5-flash-lite-preview-06-17",
    context: 1000000,
    maxOutput: 65536,
  },
  { id: "gemini-2.5-flash-image", name: "gemini-2.5-flash-image", context: 32767, maxOutput: 8192 },
  { id: "gemini-2.5-flash-image-preview", name: "gemini-2.5-flash-image-preview", context: 32767, maxOutput: 8192 },
  // Gemini 2.0
  {
    id: "gemini-2.0-pro-exp-02-05",
    name: "gemini-2.0-pro-exp-02-05 → 2.5-exp-03-25",
    context: 1000000,
    maxOutput: 8192,
  },
  { id: "gemini-2.0-pro-exp", name: "gemini-2.0-pro-exp → 2.5-exp-03-25", context: 1000000, maxOutput: 8192 },
  { id: "gemini-exp-1206", name: "gemini-exp-1206 → 2.5-exp-03-25", context: 1000000, maxOutput: 8192 },
  { id: "gemini-2.0-flash-001", name: "gemini-2.0-flash-001", context: 1000000, maxOutput: 8192 },
  {
    id: "gemini-2.0-flash-exp-image-generation",
    name: "gemini-2.0-flash-exp-image-generation",
    context: 1000000,
    maxOutput: 8192,
  },
  {
    id: "gemini-2.0-flash-preview-image-generation",
    name: "gemini-2.0-flash-preview-image-generation",
    context: 1000000,
    maxOutput: 8192,
  },
  { id: "gemini-2.0-flash-exp", name: "gemini-2.0-flash-exp", context: 1000000, maxOutput: 8192 },
  { id: "gemini-2.0-flash", name: "gemini-2.0-flash", context: 1000000, maxOutput: 8192 },
  {
    id: "gemini-2.0-flash-thinking-exp-01-21",
    name: "gemini-2.0-flash-thinking-exp-01-21 → 2.5-flash-preview-05-20",
    context: 1000000,
    maxOutput: 65536,
  },
  {
    id: "gemini-2.0-flash-thinking-exp-1219",
    name: "gemini-2.0-flash-thinking-exp-1219 → 2.5-flash-preview-05-20",
    context: 1000000,
    maxOutput: 65536,
  },
  {
    id: "gemini-2.0-flash-thinking-exp",
    name: "gemini-2.0-flash-thinking-exp → 2.5-flash-preview-05-20",
    context: 1000000,
    maxOutput: 65536,
  },
  { id: "gemini-2.0-flash-lite-001", name: "gemini-2.0-flash-lite-001", context: 1000000, maxOutput: 8192 },
  {
    id: "gemini-2.0-flash-lite-preview-02-05",
    name: "gemini-2.0-flash-lite-preview-02-05",
    context: 1000000,
    maxOutput: 8192,
  },
  { id: "gemini-2.0-flash-lite-preview", name: "gemini-2.0-flash-lite-preview", context: 1000000, maxOutput: 8192 },
  { id: "gemini-2.0-flash-lite", name: "gemini-2.0-flash-lite", context: 1000000, maxOutput: 8192 },
  // Gemma
  { id: "gemma-3n-e4b-it", name: "gemma-3n-e4b-it", context: 32768, maxOutput: 8192 },
  { id: "gemma-3n-e2b-it", name: "gemma-3n-e2b-it", context: 32768, maxOutput: 8192 },
  { id: "gemma-3-27b-it", name: "gemma-3-27b-it", context: 32768, maxOutput: 8192 },
  { id: "gemma-3-12b-it", name: "gemma-3-12b-it", context: 32768, maxOutput: 8192 },
  { id: "gemma-3-4b-it", name: "gemma-3-4b-it", context: 32768, maxOutput: 8192 },
  { id: "gemma-3-1b-it", name: "gemma-3-1b-it", context: 32768, maxOutput: 8192 },
  // LearnLM
  { id: "learnlm-2.0-flash-experimental", name: "learnlm-2.0-flash-experimental", context: 1000000, maxOutput: 8192 },
  // Robotics-ER
  { id: "gemini-robotics-er-1.5-preview", name: "gemini-robotics-er-1.5-preview", context: 1000000, maxOutput: 8192 },
];

// ── MistralAI (loaded dynamically from API in SillyTavern — no static list) ──

export const MISTRAL_MODELS: KnownModel[] = [];

// ── Cohere (from #model_cohere_select) ──

export const COHERE_MODELS: KnownModel[] = [
  // Stable
  { id: "c4ai-aya-23-8b", name: "c4ai-aya-23-8b", context: 8192, maxOutput: 4096 },
  { id: "c4ai-aya-23", name: "c4ai-aya-23", context: 8192, maxOutput: 4096 },
  { id: "c4ai-aya-expanse-8b", name: "c4ai-aya-expanse-8b", context: 8192, maxOutput: 4096 },
  { id: "c4ai-aya-expanse-32b", name: "c4ai-aya-expanse-32b", context: 128000, maxOutput: 4096 },
  { id: "c4ai-aya-vision-8b", name: "c4ai-aya-vision-8b", context: 8192, maxOutput: 4096 },
  { id: "c4ai-aya-vision-32b", name: "c4ai-aya-vision-32b", context: 128000, maxOutput: 4096 },
  { id: "command-light", name: "command-light", context: 4096, maxOutput: 4096 },
  { id: "command", name: "command", context: 4096, maxOutput: 4096 },
  { id: "command-r", name: "command-r", context: 128000, maxOutput: 4096 },
  { id: "command-r-plus", name: "command-r-plus", context: 128000, maxOutput: 4096 },
  { id: "command-r-08-2024", name: "command-r-08-2024", context: 128000, maxOutput: 4096 },
  { id: "command-r-plus-08-2024", name: "command-r-plus-08-2024", context: 128000, maxOutput: 4096 },
  { id: "command-r7b-12-2024", name: "command-r7b-12-2024", context: 128000, maxOutput: 4096 },
  { id: "command-a-03-2025", name: "command-a-03-2025", context: 256000, maxOutput: 8192 },
  { id: "command-a-vision-07-2025", name: "command-a-vision-07-2025", context: 256000, maxOutput: 8192 },
  // Nightly
  { id: "command-light-nightly", name: "command-light-nightly", context: 4096, maxOutput: 4096 },
  { id: "command-nightly", name: "command-nightly", context: 128000, maxOutput: 4096 },
];

// ── OpenRouter (loaded dynamically from API in SillyTavern — no static list) ──

export const OPENROUTER_MODELS: KnownModel[] = [];

// ── Additional providers with static lists in SillyTavern ──

// Groq (from #model_groq_select)
export const GROQ_MODELS: KnownModel[] = [
  { id: "qwen/qwen3-32b", name: "qwen/qwen3-32b", context: 128000, maxOutput: 8192 },
  { id: "deepseek-r1-distill-llama-70b", name: "deepseek-r1-distill-llama-70b", context: 128000, maxOutput: 8192 },
  { id: "gemma2-9b-it", name: "gemma2-9b-it", context: 8191, maxOutput: 8191 },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    name: "meta-llama/llama-4-scout-17b-16e-instruct",
    context: 131072,
    maxOutput: 8192,
  },
  {
    id: "meta-llama/llama-4-maverick-17b-128e-instruct",
    name: "meta-llama/llama-4-maverick-17b-128e-instruct",
    context: 131072,
    maxOutput: 8192,
  },
  { id: "llama-3.1-8b-instant", name: "llama-3.1-8b-instant", context: 131072, maxOutput: 8192 },
  { id: "llama-3.3-70b-versatile", name: "llama-3.3-70b-versatile", context: 128000, maxOutput: 32768 },
  { id: "llama-guard-3-8b", name: "llama-guard-3-8b", context: 8192, maxOutput: 4096 },
  { id: "llama3-70b-8192", name: "llama3-70b-8192", context: 8192, maxOutput: 4096 },
  { id: "llama3-8b-8192", name: "llama3-8b-8192", context: 8192, maxOutput: 4096 },
  { id: "mistral-saba-24b", name: "mistral-saba-24b", context: 32768, maxOutput: 8192 },
];

// DeepSeek (from #model_deepseek_select)
export const DEEPSEEK_MODELS: KnownModel[] = [
  { id: "deepseek-chat", name: "deepseek-chat", context: 131072, maxOutput: 8192 },
  { id: "deepseek-coder", name: "deepseek-coder", context: 131072, maxOutput: 8192 },
  { id: "deepseek-reasoner", name: "deepseek-reasoner", context: 131072, maxOutput: 8192 },
];

// Perplexity (from #model_perplexity_select)
export const PERPLEXITY_MODELS: KnownModel[] = [
  // Sonar Models
  { id: "sonar", name: "sonar", context: 128000, maxOutput: 4096 },
  { id: "sonar-pro", name: "sonar-pro", context: 200000, maxOutput: 8192 },
  { id: "sonar-reasoning", name: "sonar-reasoning", context: 128000, maxOutput: 8192 },
  { id: "sonar-reasoning-pro", name: "sonar-reasoning-pro", context: 128000, maxOutput: 8192 },
  { id: "sonar-deep-research", name: "sonar-deep-research", context: 128000, maxOutput: 8192 },
  // Offline Models
  { id: "r1-1776", name: "r1-1776", context: 128000, maxOutput: 8192 },
];

// Moonshot (from #model_moonshot_select)
export const MOONSHOT_MODELS: KnownModel[] = [
  { id: "kimi-k2-0711-preview", name: "kimi-k2-0711-preview", context: 256000, maxOutput: 8192 },
  { id: "moonshot-v1-8k", name: "moonshot-v1-8k", context: 8192, maxOutput: 4096 },
  { id: "moonshot-v1-32k", name: "moonshot-v1-32k", context: 32768, maxOutput: 4096 },
  { id: "moonshot-v1-128k", name: "moonshot-v1-128k", context: 128000, maxOutput: 4096 },
  { id: "moonshot-v1-auto", name: "moonshot-v1-auto", context: 128000, maxOutput: 4096 },
  { id: "kimi-latest", name: "kimi-latest", context: 256000, maxOutput: 8192 },
  { id: "moonshot-v1-8k-vision-preview", name: "moonshot-v1-8k-vision-preview", context: 8192, maxOutput: 4096 },
  { id: "moonshot-v1-32k-vision-preview", name: "moonshot-v1-32k-vision-preview", context: 32768, maxOutput: 4096 },
  { id: "moonshot-v1-128k-vision-preview", name: "moonshot-v1-128k-vision-preview", context: 128000, maxOutput: 4096 },
  { id: "kimi-thinking-preview", name: "kimi-thinking-preview", context: 256000, maxOutput: 8192 },
];

// Z.AI / GLM (from #model_zai_select)
export const ZAI_MODELS: KnownModel[] = [
  { id: "glm-5", name: "glm-5", context: 200000, maxOutput: 8192 },
  { id: "glm-4.7", name: "glm-4.7", context: 200000, maxOutput: 8192 },
  { id: "glm-4.7-flash", name: "glm-4.7-flash", context: 200000, maxOutput: 8192 },
  { id: "glm-4.7-flashx", name: "glm-4.7-flashx", context: 200000, maxOutput: 8192 },
  { id: "glm-4.6", name: "glm-4.6", context: 200000, maxOutput: 8192 },
  { id: "glm-4.6v", name: "glm-4.6v", context: 200000, maxOutput: 8192 },
  { id: "glm-4.6v-flash", name: "glm-4.6v-flash", context: 200000, maxOutput: 8192 },
  { id: "glm-4.6v-flashx", name: "glm-4.6v-flashx", context: 200000, maxOutput: 8192 },
  { id: "glm-4.5v", name: "glm-4.5v", context: 128000, maxOutput: 4096 },
  { id: "glm-4.5", name: "glm-4.5", context: 128000, maxOutput: 4096 },
  { id: "glm-4.5-air", name: "glm-4.5-air", context: 128000, maxOutput: 4096 },
  { id: "glm-4.5-x", name: "glm-4.5-x", context: 128000, maxOutput: 4096 },
  { id: "glm-4.5-airx", name: "glm-4.5-airx", context: 128000, maxOutput: 4096 },
  { id: "glm-4.5-flash", name: "glm-4.5-flash", context: 128000, maxOutput: 4096 },
  { id: "glm-4-32b-0414-128k", name: "glm-4-32b-0414-128k", context: 128000, maxOutput: 4096 },
  { id: "autoglm-phone-multilingual", name: "autoglm-phone-multilingual", context: 128000, maxOutput: 4096 },
];

// AI21 (from #model_ai21_select)
export const AI21_MODELS: KnownModel[] = [
  // Jamba (Latest)
  { id: "jamba-mini", name: "jamba-mini", context: 256000, maxOutput: 4096 },
  { id: "jamba-large", name: "jamba-large", context: 256000, maxOutput: 4096 },
  // Jamba 1.7
  { id: "jamba-1.7-mini", name: "jamba-1.7-mini", context: 256000, maxOutput: 4096 },
  { id: "jamba-1.7-large", name: "jamba-1.7-large", context: 256000, maxOutput: 4096 },
  // Jamba 1.6 (Deprecated)
  { id: "jamba-1.6-mini", name: "jamba-1.6-mini", context: 256000, maxOutput: 4096 },
  { id: "jamba-1.6-large", name: "jamba-1.6-large", context: 256000, maxOutput: 4096 },
  // Jamba 1.5 (Deprecated)
  { id: "jamba-1.5-mini", name: "jamba-1.5-mini", context: 256000, maxOutput: 4096 },
  { id: "jamba-1.5-large", name: "jamba-1.5-large", context: 256000, maxOutput: 4096 },
  // Jamba-Instruct (Deprecated)
  { id: "jamba-instruct-preview", name: "jamba-instruct-preview", context: 256000, maxOutput: 4096 },
];

// ── Image Generation Sources (service metadata for base URLs) ──

export interface ImageGenSource {
  id: string;
  name: string;
  description: string;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
}

export const IMAGE_GENERATION_SOURCES: ImageGenSource[] = [
  {
    id: "openai",
    name: "OpenAI (DALL-E)",
    description: "DALL-E 2, DALL-E 3, and GPT Image via the OpenAI API.",
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
  },
  {
    id: "stability",
    name: "Stability AI",
    description: "Stable Diffusion 3, SDXL, and Stable Image via the Stability API.",
    defaultBaseUrl: "https://api.stability.ai/v2beta",
    requiresApiKey: true,
  },
  {
    id: "togetherai",
    name: "Together AI",
    description: "FLUX, Stable Diffusion, and other open-source image models.",
    defaultBaseUrl: "https://api.together.xyz/v1",
    requiresApiKey: true,
  },
  {
    id: "novelai",
    name: "NovelAI",
    description: "NovelAI Diffusion anime-style image generation.",
    defaultBaseUrl: "https://image.novelai.net",
    requiresApiKey: true,
  },
  {
    id: "pollinations",
    name: "Pollinations",
    description: "Free, no-key-needed image generation via Pollinations AI.",
    defaultBaseUrl: "https://image.pollinations.ai",
    requiresApiKey: false,
  },
  {
    id: "horde",
    name: "Stable Horde",
    description: "Crowdsourced distributed image generation. Free with optional API key.",
    defaultBaseUrl: "https://stablehorde.net/api/v2",
    requiresApiKey: false,
  },
  {
    id: "automatic1111",
    name: "SD Web UI (AUTOMATIC1111 / Forge)",
    description: "Local Stable Diffusion via AUTOMATIC1111 or SD.Next WebUI.",
    defaultBaseUrl: "http://localhost:7860",
    requiresApiKey: false,
  },
  {
    id: "comfyui",
    name: "ComfyUI",
    description: "Local node-based image generation with ComfyUI.",
    defaultBaseUrl: "http://127.0.0.1:8188",
    requiresApiKey: false,
  },
  {
    id: "drawthings",
    name: "Draw Things",
    description: "macOS / iOS local image generation via Draw Things.",
    defaultBaseUrl: "http://localhost:7860",
    requiresApiKey: false,
  },
  {
    id: "nanogpt",
    name: "NanoGPT",
    description: "Image generation via the NanoGPT aggregator.",
    defaultBaseUrl: "https://nano-gpt.com/api/v1",
    requiresApiKey: true,
  },
  {
    id: "blockentropy",
    name: "Block Entropy",
    description: "Decentralised image generation network.",
    defaultBaseUrl: "https://api.blockentropy.ai",
    requiresApiKey: true,
  },
];

// Known image generation models (grouped by service)
const IMAGE_GEN_MODELS: KnownModel[] = [
  // OpenAI
  { id: "dall-e-3", name: "DALL-E 3", context: 0, maxOutput: 0 },
  { id: "dall-e-2", name: "DALL-E 2", context: 0, maxOutput: 0 },
  { id: "gpt-image-1", name: "GPT Image 1", context: 0, maxOutput: 0 },
  // Stability AI
  { id: "sd3-large", name: "Stable Diffusion 3 Large", context: 0, maxOutput: 0 },
  { id: "sd3-large-turbo", name: "SD3 Large Turbo", context: 0, maxOutput: 0 },
  { id: "sd3-medium", name: "Stable Diffusion 3 Medium", context: 0, maxOutput: 0 },
  // Together AI
  { id: "black-forest-labs/FLUX.1-schnell-Free", name: "FLUX.1 Schnell (Free)", context: 0, maxOutput: 0 },
  { id: "black-forest-labs/FLUX.1-schnell", name: "FLUX.1 Schnell", context: 0, maxOutput: 0 },
  { id: "black-forest-labs/FLUX.1.1-pro", name: "FLUX 1.1 Pro", context: 0, maxOutput: 0 },
  { id: "stabilityai/stable-diffusion-xl-base-1.0", name: "SDXL Base 1.0", context: 0, maxOutput: 0 },
  // NovelAI
  { id: "nai-diffusion-4-curated-preview", name: "NAI Diffusion 4 Curated", context: 0, maxOutput: 0 },
  { id: "nai-diffusion-4-5-full", name: "NAI Diffusion 4.5 Full", context: 0, maxOutput: 0 },
  { id: "nai-diffusion-3", name: "NAI Diffusion 3 (Anime V3)", context: 0, maxOutput: 0 },
  // Pollinations (model-free, but include as placeholder)
  { id: "pollinations", name: "Pollinations (Auto)", context: 0, maxOutput: 0 },
];

/**
 * Infer which image generation API source to use from the model name and base URL.
 * The caller should fall back to "openai" (OpenAI-compatible) if no match is found.
 */
export function inferImageSource(model: string, baseUrl: string): string {
  const m = model.toLowerCase();
  const u = baseUrl.toLowerCase();
  if (
    m === "openai" ||
    m === "stability" ||
    m === "togetherai" ||
    m === "novelai" ||
    m === "pollinations" ||
    m === "horde" ||
    m === "blockentropy" ||
    m === "comfyui" ||
    m === "automatic1111" ||
    m === "gemini_image"
  ) {
    return m;
  }
  if (m === "drawthings") return "automatic1111";
  if (m.startsWith("dall-e") || m.startsWith("gpt-image") || u.includes("openai.com")) return "openai";
  if (m.startsWith("sd3") || u.includes("stability.ai")) return "stability";
  if (m.includes("nai-diffusion") || u.includes("novelai.net")) return "novelai";
  if (m === "pollinations" || u.includes("pollinations.ai")) return "pollinations";
  if (m.includes("black-forest") || m.includes("flux") || u.includes("together.xyz")) return "togetherai";
  if (u.includes("stablehorde.net")) return "horde";
  if (u.includes("blockentropy")) return "blockentropy";
  if (u.includes(":8188") || u.includes("comfyui")) return "comfyui";
  if (u.includes(":7860") && !u.includes("drawthings")) return "automatic1111";
  // Gemini image models generate via chat completions (native or proxy)
  if (m.includes("gemini") && m.includes("image")) return "gemini_image";
  if (m.includes("imagen")) return "gemini_image";
  // OpenAI-compatible fallback (works for most proxies)
  if (u.includes("nano-gpt.com")) return "nanogpt";
  return "openai";
}

// ── Provider → Model map ──

export const MODEL_LISTS: Record<APIProvider, KnownModel[]> = {
  openai: OPENAI_MODELS,
  anthropic: ANTHROPIC_MODELS,
  claude_subscription: CLAUDE_SUBSCRIPTION_MODELS,
  google: GOOGLE_MODELS,
  mistral: MISTRAL_MODELS,
  cohere: COHERE_MODELS,
  openrouter: OPENROUTER_MODELS,
  nanogpt: [], // NanoGPT aggregator — models fetched dynamically via API
  custom: [], // User must type model ID manually for custom endpoints
  image_generation: IMAGE_GEN_MODELS,
};

/**
 * Look up a known model by ID across all providers.
 */
export function findKnownModel(provider: APIProvider, modelId: string): KnownModel | undefined {
  return MODEL_LISTS[provider]?.find((m) => m.id === modelId);
}
