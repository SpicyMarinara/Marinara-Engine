// ──────────────────────────────────────────────
// LLM Provider — Abstract Base
// ──────────────────────────────────────────────
import { logger } from "../../lib/logger.js";
import { isProviderLocalUrlsEnabled } from "../../config/runtime-config.js";
import { safeFetch } from "../../utils/security.js";

/**
 * Shared undici Agent with a 5-minute headers timeout (time to first byte)
 * and no body timeout — prevents indefinite hangs while still allowing
 * long-running streaming responses to complete.
 */
const LLM_HEADERS_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const llmAgentOptions = { bodyTimeout: 0, headersTimeout: LLM_HEADERS_TIMEOUT };

/**
 * Drop-in replacement for `fetch()` that uses a custom undici dispatcher
 * with no body/headers timeout. Use this for all outgoing LLM requests.
 */
export function llmFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return safeFetch(url, {
    ...(init ?? {}),
    agentOptions: llmAgentOptions,
    policy: {
      allowLocal: isProviderLocalUrlsEnabled(),
      allowLoopback: true,
      allowedProtocols: ["https:", "http:"],
      flagName: "PROVIDER_LOCAL_URLS_ENABLED",
    },
    maxResponseBytes: 50 * 1024 * 1024,
    bufferResponse: false,
  });
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Internal context-fitting hint: prompt data is preserved before chat history. */
  contextKind?: "prompt" | "history" | "injection";
  /** For tool result messages */
  tool_call_id?: string;
  /** For assistant messages with tool calls */
  tool_calls?: LLMToolCall[];
  /** Base64 data URLs for multimodal image inputs */
  images?: string[];
  /** Provider-specific metadata (e.g. Gemini parts with thought signatures) */
  providerMetadata?: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Total context window limit for prompt + completion tokens. */
  maxContext?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stream?: boolean;
  stop?: string[];
  /** Tool/function definitions for function calling */
  tools?: LLMToolDefinition[];
  /** Enable provider-native prompt caching when supported */
  enableCaching?: boolean;
  /** Callback for streaming thinking/reasoning content */
  onThinking?: (chunk: string) => void;
  /** Prefer provider APIs that expose reasoning summaries when available */
  captureReasoning?: boolean;
  /** Callback for streaming text tokens as they arrive (used in tool path) */
  onToken?: (chunk: string) => void;
  /** Enable extended thinking (reasoning models) */
  enableThinking?: boolean;
  /** Reasoning effort level for models that support it */
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  /** Output verbosity for GPT-5+ models */
  verbosity?: "low" | "medium" | "high";
  /** Abort signal — when triggered, the in-flight LLM request should be cancelled. */
  signal?: AbortSignal;
  /** Callback to receive the full response parts (for providers that return structured metadata like Gemini thought signatures) */
  onResponseParts?: (parts: unknown[]) => void;
  /** OpenRouter: preferred provider for model routing */
  openrouterProvider?: string | null;
  /** Encrypted reasoning items from a previous Responses API turn to replay for reasoning continuity */
  encryptedReasoningItems?: unknown[];
  /** Callback to receive encrypted reasoning items from the current response (store for next turn) */
  onEncryptedReasoning?: (items: unknown[]) => void;
  /** Callback to receive Chat Completions reasoning fields that must be replayed for some providers */
  onChatCompletionsReasoning?: (metadata: Record<string, unknown>) => void;
  /** Force a specific response format (e.g. { type: "json_object" }) */
  responseFormat?: { type: string };
  /** Raw provider request parameters merged into the outgoing request body. */
  customParameters?: Record<string, unknown>;
}

/** Token usage statistics returned by the model */
export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
  cacheWritePromptTokens?: number;
  /** Hidden reasoning tokens included in completion/output tokens by reasoning models. */
  completionReasoningTokens?: number;
  /** Audio output tokens included in completion/output tokens, when reported. */
  completionAudioTokens?: number;
  /** Predicted output tokens accepted by the model, when reported. */
  acceptedPredictionTokens?: number;
  /** Predicted output tokens rejected by the model but still counted in output usage. */
  rejectedPredictionTokens?: number;
}

/** Result from a non-streaming chat call that may include tool calls */
export interface ChatCompletionResult {
  content: string | null;
  toolCalls: LLMToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | string;
  usage?: LLMUsage;
  /** Provider-native metadata to replay with the assistant message, e.g. DeepSeek reasoning_content */
  providerMetadata?: Record<string, unknown>;
}

export interface ContextFitResult {
  messages: ChatMessage[];
  maxContext?: number;
  maxTokens?: number;
  inputBudget?: number;
  reservedTokens?: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  trimmed: boolean;
}

type ContextFitOptions = Pick<ChatOptions, "maxContext" | "maxTokens" | "tools">;

const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 6;
const IMAGE_TOKEN_ESTIMATE = 256;
const CONTEXT_SAFETY_MARGIN_TOKENS = 64;
const CONTEXT_SAFETY_MARGIN_RATIO = 0.02;
const MIN_INPUT_BUDGET_TOKENS = 128;
const MIN_OUTPUT_BUDGET_TOKENS = 128;
const OUTPUT_BUDGET_REDUCTION_HEADROOM_TOKENS = 64;
const MIN_CONTENT_CHARS = 48;
const TRUNCATION_MARKER = "\n\n[Truncated to fit context window]";

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function minDefined(...values: Array<number | undefined>): number | undefined {
  let result: number | undefined;
  for (const value of values) {
    if (value === undefined) continue;
    result = result === undefined ? value : Math.min(result, value);
  }
  return result;
}

function estimateTextTokens(text: string): number {
  return Math.ceil(Array.from(text).length / CHARS_PER_TOKEN);
}

function estimateStructuredTokens(value: unknown): number {
  try {
    return estimateTextTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function estimateToolDefinitionTokens(tools?: LLMToolDefinition[]): number {
  if (!tools?.length) return 0;
  return estimateStructuredTokens(tools) + MESSAGE_OVERHEAD_TOKENS;
}

function contextSafetyMargin(maxContext: number): number {
  return Math.max(CONTEXT_SAFETY_MARGIN_TOKENS, Math.ceil(maxContext * CONTEXT_SAFETY_MARGIN_RATIO));
}

function estimateMessageTokens(message: ChatMessage): number {
  let total = MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.content ?? "");
  if (message.tool_call_id) {
    total += estimateTextTokens(message.tool_call_id) + 2;
  }
  if (message.tool_calls?.length) {
    total += estimateStructuredTokens(message.tool_calls) + 8;
  }
  if (message.images?.length) {
    total += message.images.length * IMAGE_TOKEN_ESTIMATE;
  }
  if (message.providerMetadata) {
    total += Math.min(estimateStructuredTokens(message.providerMetadata), 512);
  }
  return total;
}

function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    ...(message.images ? { images: [...message.images] } : {}),
    ...(message.tool_calls
      ? { tool_calls: message.tool_calls.map((call) => ({ ...call, function: { ...call.function } })) }
      : {}),
    ...(message.providerMetadata ? { providerMetadata: { ...message.providerMetadata } } : {}),
  }));
}

function truncateContent(content: string, targetTokens: number, preserveStartOnly: boolean): string {
  const targetChars = Math.max(MIN_CONTENT_CHARS, Math.floor(targetTokens * CHARS_PER_TOKEN));
  if (Array.from(content).length <= targetChars) return content;

  if (targetChars <= TRUNCATION_MARKER.length + MIN_CONTENT_CHARS) {
    return Array.from(content).slice(0, targetChars).join("");
  }

  const availableChars = targetChars - TRUNCATION_MARKER.length;
  const chars = Array.from(content);

  if (preserveStartOnly) {
    return chars.slice(0, availableChars).join("") + TRUNCATION_MARKER;
  }

  const headChars = Math.ceil(availableChars * 0.65);
  const tailChars = Math.floor(availableChars * 0.35);
  return chars.slice(0, headChars).join("") + TRUNCATION_MARKER + chars.slice(-tailChars).join("");
}

function findOldestRemovableConversationBlock(
  messages: ChatMessage[],
  preferredKind?: ChatMessage["contextKind"],
): { start: number; deleteCount: number } | null {
  for (let index = 0; index < messages.length - 1; index++) {
    const message = messages[index]!;
    if (preferredKind) {
      if (message.contextKind !== preferredKind) continue;
    } else if (message.role === "system") {
      continue;
    }

    let deleteCount = 1;
    if (message.role === "assistant" && message.tool_calls?.length) {
      for (let nextIndex = index + 1; nextIndex < messages.length - 1; nextIndex++) {
        if (messages[nextIndex]?.role !== "tool") break;
        deleteCount += 1;
      }
    }

    return { start: index, deleteCount };
  }

  return null;
}

function findOldestRemovableSystemMessage(messages: ChatMessage[]): number {
  for (let index = 1; index < messages.length - 1; index++) {
    if (messages[index]?.role === "system") return index;
  }
  return -1;
}

function findLargestMessageIndex(
  messages: ChatMessage[],
  predicate: (message: ChatMessage, index: number) => boolean,
): number {
  let selectedIndex = -1;
  let selectedTokens = 0;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (!predicate(message, index) || !message.content) continue;
    const tokenEstimate = estimateMessageTokens(message);
    if (tokenEstimate > selectedTokens) {
      selectedTokens = tokenEstimate;
      selectedIndex = index;
    }
  }

  return selectedIndex;
}

export function fitMessagesToContext(
  messages: ChatMessage[],
  options: ContextFitOptions,
  defaultMaxContext?: number,
): ContextFitResult {
  const requestedMaxTokens = normalizePositiveInteger(options.maxTokens);
  const maxContext = minDefined(
    normalizePositiveInteger(options.maxContext),
    normalizePositiveInteger(defaultMaxContext),
  );
  const estimatedTokensBefore = estimateMessagesTokens(messages);
  const toolTokens = estimateToolDefinitionTokens(options.tools);

  if (!maxContext) {
    return {
      messages,
      maxTokens: requestedMaxTokens,
      reservedTokens: toolTokens,
      estimatedTokensBefore,
      estimatedTokensAfter: estimatedTokensBefore,
      trimmed: false,
    };
  }

  const reservedTokens = contextSafetyMargin(maxContext) + toolTokens;
  const usableWindow = Math.max(1, maxContext - reservedTokens);
  const reservedInputFloor = Math.min(MIN_INPUT_BUDGET_TOKENS, Math.max(0, usableWindow - 1));
  let maxTokens =
    requestedMaxTokens === undefined
      ? undefined
      : Math.max(1, Math.min(requestedMaxTokens, Math.max(1, usableWindow - reservedInputFloor)));
  let inputBudget = Math.max(0, usableWindow - (maxTokens ?? 0));

  if (estimatedTokensBefore > inputBudget && maxTokens !== undefined) {
    const minimumOutputBudget = Math.min(MIN_OUTPUT_BUDGET_TOKENS, Math.max(1, usableWindow - 1));
    const headroom = Math.min(OUTPUT_BUDGET_REDUCTION_HEADROOM_TOKENS, Math.max(0, usableWindow - 1));
    const maxTokensThatFitPrompt = Math.max(1, usableWindow - estimatedTokensBefore - headroom);
    const reducedMaxTokens = Math.max(minimumOutputBudget, Math.min(maxTokens, maxTokensThatFitPrompt));
    if (reducedMaxTokens < maxTokens) {
      maxTokens = reducedMaxTokens;
      inputBudget = Math.max(0, usableWindow - maxTokens);
    }
  }

  if (estimatedTokensBefore <= inputBudget) {
    return {
      messages,
      maxContext,
      maxTokens,
      inputBudget,
      reservedTokens,
      estimatedTokensBefore,
      estimatedTokensAfter: estimatedTokensBefore,
      trimmed: false,
    };
  }

  const fittedMessages = cloneMessages(messages);
  let estimatedTokensAfter = estimateMessagesTokens(fittedMessages);

  while (estimatedTokensAfter > inputBudget && fittedMessages.length > 1) {
    const block =
      findOldestRemovableConversationBlock(fittedMessages, "history") ??
      findOldestRemovableConversationBlock(fittedMessages);
    if (!block) break;
    fittedMessages.splice(block.start, block.deleteCount);
    estimatedTokensAfter = estimateMessagesTokens(fittedMessages);
  }

  if (estimatedTokensAfter > inputBudget && maxTokens !== undefined) {
    const minimumOutputBudget = Math.min(MIN_OUTPUT_BUDGET_TOKENS, Math.max(1, usableWindow - 1));
    const maxTokensThatFitPrompt = Math.max(1, usableWindow - estimatedTokensAfter);
    const reducedMaxTokens = Math.max(minimumOutputBudget, Math.min(maxTokens, maxTokensThatFitPrompt));
    if (reducedMaxTokens < maxTokens) {
      maxTokens = reducedMaxTokens;
      inputBudget = Math.max(0, usableWindow - maxTokens);
    }
  }

  while (estimatedTokensAfter > inputBudget && fittedMessages.length > 1) {
    const removableSystemIndex = findOldestRemovableSystemMessage(fittedMessages);
    if (removableSystemIndex < 0) break;
    fittedMessages.splice(removableSystemIndex, 1);
    estimatedTokensAfter = estimateMessagesTokens(fittedMessages);
  }

  let guard = 0;
  while (estimatedTokensAfter > inputBudget && guard < 12) {
    guard += 1;

    const systemIndex = findLargestMessageIndex(
      fittedMessages,
      (message, index) => message.role === "system" && index < fittedMessages.length,
    );
    if (systemIndex >= 0) {
      const message = fittedMessages[systemIndex]!;
      const nonContentTokens = estimateMessageTokens({ ...message, content: "" });
      const excessTokens = estimatedTokensAfter - inputBudget;
      const targetTokens = Math.max(8, estimateMessageTokens(message) - excessTokens - nonContentTokens);
      const truncated = truncateContent(message.content, targetTokens, true);
      if (truncated !== message.content) {
        message.content = truncated;
        estimatedTokensAfter = estimateMessagesTokens(fittedMessages);
        continue;
      }
    }

    const historicalIndex = findLargestMessageIndex(
      fittedMessages,
      (message, index) => message.contextKind === "history" && index < fittedMessages.length - 1,
    );
    const fallbackHistoricalIndex =
      historicalIndex >= 0
        ? historicalIndex
        : findLargestMessageIndex(fittedMessages, (_message, index) => index < fittedMessages.length - 1);
    if (fallbackHistoricalIndex >= 0) {
      const message = fittedMessages[fallbackHistoricalIndex]!;
      const nonContentTokens = estimateMessageTokens({ ...message, content: "" });
      const excessTokens = estimatedTokensAfter - inputBudget;
      const targetTokens = Math.max(8, estimateMessageTokens(message) - excessTokens - nonContentTokens);
      const truncated = truncateContent(message.content, targetTokens, message.role === "system");
      if (truncated !== message.content) {
        message.content = truncated;
        estimatedTokensAfter = estimateMessagesTokens(fittedMessages);
        continue;
      }
    }

    const lastIndex = fittedMessages.length - 1;
    if (lastIndex >= 0) {
      const message = fittedMessages[lastIndex]!;
      const nonContentTokens = estimateMessageTokens({ ...message, content: "" });
      const excessTokens = estimatedTokensAfter - inputBudget;
      const targetTokens = Math.max(8, estimateMessageTokens(message) - excessTokens - nonContentTokens);
      const truncated = truncateContent(message.content, targetTokens, false);
      if (truncated !== message.content) {
        message.content = truncated;
        estimatedTokensAfter = estimateMessagesTokens(fittedMessages);
        continue;
      }
    }

    break;
  }

  return {
    messages: fittedMessages,
    maxContext,
    maxTokens,
    inputBudget,
    reservedTokens,
    estimatedTokensBefore,
    estimatedTokensAfter,
    trimmed: estimatedTokensAfter < estimatedTokensBefore,
  };
}

/**
 * Sanitise raw error response text for display.
 * Strips HTML (Cloudflare/proxy error pages), extracts the title, and truncates.
 */
export function sanitizeApiError(raw: string, maxLen = 300): string {
  // If it looks like HTML, pull out the <title> or strip all tags
  if (raw.includes("<html") || raw.includes("<!DOCTYPE")) {
    const titleMatch = raw.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch?.[1]) return titleMatch[1].trim().slice(0, maxLen);
    // Strip tags and collapse whitespace
    const stripped = raw
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return stripped.slice(0, maxLen) || "HTML error page (no details)";
  }
  // Try to parse as JSON and extract an error message
  try {
    const json = JSON.parse(raw);
    const msg = json?.error?.message ?? json?.error ?? json?.message;
    if (typeof msg === "string") return msg.slice(0, maxLen);
  } catch {
    // not JSON — return as-is
  }
  return raw.slice(0, maxLen);
}

/**
 * Abstract base for all LLM providers.
 * Every provider must implement the `chat` method as an async generator.
 */
export abstract class BaseLLMProvider {
  constructor(
    protected baseUrl: string,
    protected apiKey: string,
    protected defaultMaxContext?: number,
    protected defaultOpenrouterProvider?: string | null,
    protected maxTokensOverride?: number | null,
  ) {}

  /** Cap output max_tokens to the connection-level override, if one is set. */
  protected applyMaxTokensCap(tokens: number): number {
    if (this.maxTokensOverride && tokens > this.maxTokensOverride) return this.maxTokensOverride;
    return tokens;
  }

  /** Returns the connection-level max output tokens override, if set. */
  public get maxTokensOverrideValue(): number | null {
    return this.maxTokensOverride ?? null;
  }

  protected fitMessagesToContext(messages: ChatMessage[], options: ContextFitOptions) {
    return fitMessagesToContext(messages, options, this.defaultMaxContext);
  }

  protected logContextTrim(result: ContextFitResult, model: string): void {
    if (!result.trimmed || !result.inputBudget) return;
    logger.warn(
      "[LLM context] Trimmed prompt for %s from ~%d to ~%d tokens (budget ~%d, maxContext=%d)",
      model,
      result.estimatedTokensBefore,
      result.estimatedTokensAfter,
      result.inputBudget!,
      result.maxContext!,
    );
  }

  protected resolveOpenrouterProvider(openrouterProvider?: string | null): string | null | undefined {
    return openrouterProvider ?? this.defaultOpenrouterProvider;
  }

  protected applyCustomParameters(body: Record<string, unknown>, options: ChatOptions): void {
    if (!options.customParameters || Object.keys(options.customParameters).length === 0) return;
    deepMergeRequestBody(body, options.customParameters);
  }

  /**
   * Stream a chat completion. Yields text chunks, optionally returns usage on completion.
   */
  abstract chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string, LLMUsage | void, unknown>;

  /**
   * Non-streaming chat completion with tool-use support.
   * Default implementation collects from the streaming generator.
   * If onToken is provided, streams text chunks in real time.
   */
  async chatComplete(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> {
    let content = "";
    const useStream = options.stream ?? !!options.onToken;
    const gen = this.chat(messages, { ...options, stream: useStream });
    let result = await gen.next();
    while (!result.done) {
      content += result.value;
      if (options.onToken) {
        options.onToken(result.value);
      }
      result = await gen.next();
    }
    const usage = result.value || undefined;
    return { content, toolCalls: [], finishReason: "stop", usage };
  }

  /**
   * Generate embeddings for one or more texts.
   * Default implementation calls the OpenAI-compatible /embeddings endpoint.
   * Override in provider subclasses that use a different API shape.
   */
  async embed(texts: string[], model: string): Promise<number[][]> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.baseUrl.includes("openrouter.ai")) {
      headers["HTTP-Referer"] = "https://github.com/Pasta-Devs/Marinara-Engine";
      headers["X-Title"] = "Marinara Engine";
    }
    const res = await llmFetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ input: texts, model }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Embedding request failed (${res.status}): ${sanitizeApiError(body)}`);
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return json.data.map((d) => d.embedding);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepMergeRequestBody(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const current = target[key];
    if (isPlainRecord(current) && isPlainRecord(value)) {
      deepMergeRequestBody(current, value);
    } else {
      target[key] = value;
    }
  }
}
