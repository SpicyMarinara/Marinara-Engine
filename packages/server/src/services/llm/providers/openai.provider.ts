// ──────────────────────────────────────────────
// LLM Provider — OpenAI (& OAI-Compatible)
// ──────────────────────────────────────────────
import {
  BaseLLMProvider,
  llmFetch,
  sanitizeApiError,
  type ChatMessage,
  type ChatOptions,
  type ChatCompletionResult,
  type LLMToolCall,
  type LLMToolDefinition,
  type LLMUsage,
} from "../base-provider.js";
import { logger } from "../../../lib/logger.js";

/**
 * Models that ONLY support the Responses API (`/responses`) and not Chat Completions.
 * All GPT-5.4 variants (base, pro, mini, dated snapshots) and Codex models use Responses.
 * Matching is case-insensitive.
 */
const RESPONSES_ONLY_PREFIXES = ["gpt-5.4", "codex-"];
const RESPONSES_ONLY_SUFFIXES = ["-codex", "-codex-max", "-codex-mini"];

type ChatCompletionsUsagePayload = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    audio_tokens?: number;
    accepted_prediction_tokens?: number;
    rejected_prediction_tokens?: number;
  };
};

type ResponsesUsagePayload = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
    audio_tokens?: number;
    accepted_prediction_tokens?: number;
    rejected_prediction_tokens?: number;
  };
};

type OpenAIProviderKind =
  | "openai"
  | "openrouter"
  | "nanogpt"
  | "xai"
  | "mistral"
  | "cohere"
  | "custom"
  | "local-sidecar";

/**
 * Handles OpenAI, OpenRouter, Mistral, Cohere, and any OpenAI-compatible endpoint.
 */
export class OpenAIProvider extends BaseLLMProvider {
  constructor(
    baseUrl: string,
    apiKey: string,
    defaultMaxContext?: number,
    defaultOpenrouterProvider?: string | null,
    maxTokensOverride?: number | null,
    private readonly providerKind: OpenAIProviderKind = "openai",
  ) {
    super(baseUrl, apiKey, defaultMaxContext, defaultOpenrouterProvider, maxTokensOverride);
  }

  private static async parseJsonBody<T>(response: Response, context: string): Promise<T> {
    const raw = await response.text();
    try {
      return JSON.parse(raw) as T;
    } catch (jsonErr) {
      // Some provider/proxy stacks may ignore stream=false and still return SSE frames.
      const ssePayload = OpenAIProvider.extractSseJsonPayload(raw);
      if (ssePayload) {
        try {
          return JSON.parse(ssePayload) as T;
        } catch {
          // Fall through to the detailed error below.
        }
      }

      const preview = raw.slice(0, 200).replace(/\s+/g, " ");
      const message = jsonErr instanceof Error ? jsonErr.message : "Unknown JSON parse failure";
      throw new Error(`${context}: Failed to parse JSON response (${message}). Body starts with: ${preview}`);
    }
  }

  private static extractSseJsonPayload(raw: string): string | null {
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      const payload = OpenAIProvider.extractSseData(trimmed);
      if (payload == null) continue;
      if (!payload || payload === "[DONE]") continue;
      return payload;
    }
    return null;
  }

  private static extractSseData(trimmedLine: string): string | null {
    if (!trimmedLine.startsWith("data:")) return null;
    return trimmedLine.slice(5).trimStart();
  }

  private static extractSseEvent(trimmedLine: string): string | null {
    if (!trimmedLine.startsWith("event:")) return null;
    return trimmedLine.slice(6).trimStart();
  }

  private static normalizeTopP(topP: number | null | undefined): number | undefined {
    if (topP == null || !Number.isFinite(topP)) return undefined;
    if (topP <= 0) return 1;
    return Math.min(topP, 1);
  }

  private normalizeChatCompletionsResponseFormat(responseFormat?: { type: string }): unknown | undefined {
    if (!responseFormat) return undefined;

    if (this.isGenericCustomProvider() && responseFormat.type === "json_object") {
      return { type: "json_schema", json_schema: { name: "response", schema: { type: "object" }, strict: true } };
    }

    return responseFormat;
  }

  /**
   * Extract text and thinking from an OpenRouter/Anthropic-style content block array.
   * OpenRouter may return `content` as an array of typed blocks instead of a plain string:
   *   [{ type: "thinking", thinking: "..." }, { type: "text", text: "..." }]
   */
  private static extractContentBlocks(content: unknown): { text: string; thinking: string } | null {
    if (!Array.isArray(content)) return null;
    let text = "";
    let thinking = "";
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Record<string, unknown>;
      if (b.type === "thinking" && typeof b.thinking === "string") {
        thinking += b.thinking;
      } else if (b.type === "text" && typeof b.text === "string") {
        text += b.text;
      }
    }
    return { text, thinking };
  }

  private shouldSendTopK(): boolean {
    return this.apiKey === "local-sidecar";
  }

  /**
   * Extract reasoning/thinking from an OpenAI-compatible message or delta object.
   * Handles multiple provider formats:
   *   - `reasoning_content` (DeepSeek native)
   *   - `reasoning` (OpenRouter / NanoGPT)
   *   - `reasoning_details` array (OpenRouter newer format)
   */
  private static extractReasoning(obj: Record<string, unknown> | undefined | null): string {
    if (!obj) return "";
    // Plain string fields
    if (typeof obj.reasoning_content === "string" && obj.reasoning_content) return obj.reasoning_content;
    if (typeof obj.reasoning === "string" && obj.reasoning) return obj.reasoning;
    // reasoning_details array: [{type:"reasoning.text", text:"..."}, {type:"reasoning.summary", summary:"..."}]
    if (Array.isArray(obj.reasoning_details)) {
      let text = "";
      for (const item of obj.reasoning_details) {
        if (typeof item !== "object" || item === null) continue;
        const d = item as Record<string, unknown>;
        if (d.type === "reasoning.text" && typeof d.text === "string") text += d.text;
        else if (d.type === "reasoning.summary" && typeof d.summary === "string") text += d.summary;
      }
      if (text) return text;
    }
    return "";
  }

  /**
   * Preserve provider-native Chat Completions reasoning fields for replay.
   * DeepSeek thinking + tool calls requires `reasoning_content` to be passed
   * back on the assistant tool-call message. OpenRouter may also expose
   * `reasoning` or `reasoning_details` for the same continuity purpose.
   */
  private static extractReasoningMetadata(obj: Record<string, unknown> | undefined | null): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};
    if (!obj) return metadata;
    if (typeof obj.reasoning_content === "string" && obj.reasoning_content) {
      metadata.reasoning_content = obj.reasoning_content;
    }
    if (typeof obj.reasoning === "string" && obj.reasoning) {
      metadata.reasoning = obj.reasoning;
    }
    if (Array.isArray(obj.reasoning_details) && obj.reasoning_details.length) {
      metadata.reasoning_details = OpenAIProvider.mergeReasoningDetails([], obj.reasoning_details);
    }
    return metadata;
  }

  private static reasoningDetailMergeKey(item: Record<string, unknown>): string | null {
    const type = typeof item.type === "string" ? item.type : "";
    const format = typeof item.format === "string" ? item.format : "";
    const id =
      typeof item.id === "string"
        ? item.id
        : typeof item.signature === "string"
          ? item.signature
          : typeof item.index === "number"
            ? String(item.index)
            : "";
    if (!id) return null;
    return `${type}|${format}|${id}`;
  }

  private static mergeReasoningDetailStrings(
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): void {
    for (const field of ["text", "summary", "thinking"] as const) {
      const next = incoming[field];
      if (typeof next !== "string" || next.length === 0) continue;
      const current = existing[field];
      existing[field] = typeof current === "string" ? `${current}${next}` : next;
    }
  }

  private static mergeReasoningDetails(existing: unknown[], incoming: unknown[]): Record<string, unknown>[] {
    const merged: Record<string, unknown>[] = existing
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({ ...item }));
    const keyed = new Map<string, Record<string, unknown>>();
    for (const item of merged) {
      const key = OpenAIProvider.reasoningDetailMergeKey(item);
      if (key) keyed.set(key, item);
    }

    for (const item of incoming) {
      if (typeof item !== "object" || item === null) continue;
      const incomingDetail = item as Record<string, unknown>;
      const key = OpenAIProvider.reasoningDetailMergeKey(incomingDetail);
      const existingDetail = key ? keyed.get(key) : undefined;
      if (!existingDetail) {
        const clone = { ...incomingDetail };
        merged.push(clone);
        if (key) keyed.set(key, clone);
        continue;
      }

      OpenAIProvider.mergeReasoningDetailStrings(existingDetail, incomingDetail);
      for (const [field, value] of Object.entries(incomingDetail)) {
        if (field === "text" || field === "summary" || field === "thinking") continue;
        if (value !== undefined && value !== null) {
          existingDetail[field] = value;
        }
      }
    }

    return merged;
  }

  private static appendReasoningMetadata(
    target: Record<string, unknown>,
    obj: Record<string, unknown> | undefined | null,
  ): void {
    const metadata = OpenAIProvider.extractReasoningMetadata(obj);
    if (typeof metadata.reasoning_content === "string") {
      const current = typeof target.reasoning_content === "string" ? target.reasoning_content : "";
      target.reasoning_content = `${current}${metadata.reasoning_content}`;
    }
    if (typeof metadata.reasoning === "string") {
      const current = typeof target.reasoning === "string" ? target.reasoning : "";
      target.reasoning = `${current}${metadata.reasoning}`;
    }
    if (Array.isArray(metadata.reasoning_details)) {
      target.reasoning_details = OpenAIProvider.mergeReasoningDetails(
        Array.isArray(target.reasoning_details) ? target.reasoning_details : [],
        metadata.reasoning_details,
      );
    }
  }

  private static hasReasoningMetadata(metadata: Record<string, unknown> | undefined | null): boolean {
    if (!metadata) return false;
    return (
      (typeof metadata.reasoning_content === "string" && metadata.reasoning_content.length > 0) ||
      (typeof metadata.reasoning === "string" && metadata.reasoning.length > 0) ||
      (Array.isArray(metadata.reasoning_details) && metadata.reasoning_details.length > 0)
    );
  }

  private assistantReasoningPayload(
    providerMetadata: Record<string, unknown> | undefined,
    model?: string,
  ): Record<string, unknown> {
    if (!providerMetadata) return {};
    const metadata = OpenAIProvider.extractReasoningMetadata(providerMetadata);
    if (Array.isArray(metadata.reasoning_details) && metadata.reasoning_details.length) {
      return { reasoning_details: metadata.reasoning_details };
    }
    if (model && this.supportsOpenRouterUnifiedReasoning(model)) {
      return {};
    }
    return metadata;
  }

  private static emitChatCompletionsReasoning(options: ChatOptions, metadata: Record<string, unknown>): void {
    if (OpenAIProvider.hasReasoningMetadata(metadata)) {
      options.onChatCompletionsReasoning?.(metadata);
    }
  }

  /** Build standard request headers, adding OpenRouter app tracking when applicable. */
  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (!this.isGenericCustomProvider() && this.baseUrl.includes("openrouter.ai")) {
      h["HTTP-Referer"] = "https://github.com/Pasta-Devs/Marinara-Engine";
      h["X-Title"] = "Marinara Engine";
    }
    return h;
  }

  private isGenericCustomProvider(): boolean {
    return this.providerKind === "custom";
  }

  /** Check if a model ID represents an OpenAI reasoning model */
  private isReasoningModel(model: string): boolean {
    if (this.isGenericCustomProvider()) return false;
    const m = model.toLowerCase();
    return /^(o1|o3|o4)/.test(m) || m.startsWith("gpt-5");
  }

  private isXAIEndpoint(): boolean {
    if (this.isGenericCustomProvider()) return false;
    const baseUrl = this.baseUrl.toLowerCase();
    return baseUrl.includes("api.x.ai") || baseUrl.includes("x.ai/");
  }

  private isOpenRouterXAIModel(model: string): boolean {
    return (
      !this.isGenericCustomProvider() &&
      this.baseUrl.includes("openrouter.ai") &&
      model.toLowerCase().startsWith("x-ai/grok-")
    );
  }

  private isXAIMultiAgentModel(model: string): boolean {
    if (this.isGenericCustomProvider()) return false;
    return model.toLowerCase() === "grok-4.20-multi-agent";
  }

  private isXAIReasoningModel(model: string): boolean {
    if (!this.isXAIEndpoint() && !this.isOpenRouterXAIModel(model)) return false;
    const m = model.toLowerCase();
    return (
      m.startsWith("x-ai/grok-") ||
      m.startsWith("grok-4.3") ||
      m.startsWith("grok-4-1-fast") ||
      this.isXAIMultiAgentModel(model)
    );
  }

  private shouldSendStopSequences(model: string): boolean {
    return !this.isXAIReasoningModel(model);
  }

  private shouldSendPenaltyParams(model: string): boolean {
    return !this.isXAIReasoningModel(model);
  }

  /**
   * Check if a model/config does NOT support temperature/topP.
   * o-series models never do.
   * GPT-5.x models only support temperature when reasoning effort is "none" (the default).
   */
  private isNoTemperatureModel(model: string, reasoningEffort?: string): boolean {
    if (this.isGenericCustomProvider()) return false;
    const m = model.toLowerCase();
    if (/^(o1|o3|o4)/.test(m)) return true;
    if (m.startsWith("gpt-5") && reasoningEffort && reasoningEffort !== "none") return true;
    // Claude Opus 4.7+: all sampling params forbidden (covers reverse proxies)
    if (/claude-opus-4-(?:[7-9]|\d{2,})/.test(m)) return true;
    return false;
  }

  /** GLM variants on Z.AI/BigModel use a boolean thinking toggle instead of effort-based reasoning config. */
  private isGLMModel(model: string): boolean {
    return model.toLowerCase().includes("glm");
  }

  private isNativeGLMEndpoint(): boolean {
    try {
      const hostname = new URL(this.baseUrl).hostname.toLowerCase();
      return (
        hostname === "api.z.ai" ||
        hostname.endsWith(".api.z.ai") ||
        hostname === "open.bigmodel.cn" ||
        hostname.endsWith(".open.bigmodel.cn")
      );
    } catch {
      return false;
    }
  }

  private shouldSendGLMEnableThinking(model: string): boolean {
    return !this.isGenericCustomProvider() && this.isGLMModel(model) && this.isNativeGLMEndpoint();
  }

  private hasActiveReasoningEffort(reasoningEffort?: string | null): boolean {
    return !!reasoningEffort && reasoningEffort !== "none";
  }

  private isOpenRouterEndpoint(): boolean {
    return !this.isGenericCustomProvider() && this.baseUrl.includes("openrouter.ai");
  }

  private supportsOpenRouterUnifiedReasoning(model: string): boolean {
    if (!this.isOpenRouterEndpoint()) return false;
    const m = model.toLowerCase();
    return m.includes("claude-3.7") || /claude-(?:opus|sonnet|haiku)-4(?:[.-]|\b)/.test(m);
  }

  private shouldSendReasoningEffort(model: string, reasoningEffort?: string | null): boolean {
    return this.isReasoningModel(model) && this.hasActiveReasoningEffort(reasoningEffort);
  }

  private applyChatCompletionsReasoning(body: Record<string, unknown>, options: ChatOptions): void {
    if (this.isXAIReasoningModel(options.model)) {
      return;
    }

    if (this.shouldSendGLMEnableThinking(options.model)) {
      body.enable_thinking = this.hasActiveReasoningEffort(options.reasoningEffort);
      return;
    }

    if (
      this.supportsOpenRouterUnifiedReasoning(options.model) &&
      this.hasActiveReasoningEffort(options.reasoningEffort)
    ) {
      body.reasoning = { effort: options.reasoningEffort };
      return;
    }

    if (this.shouldSendReasoningEffort(options.model, options.reasoningEffort)) {
      body.reasoning_effort = options.reasoningEffort;
    }
  }

  private applyResponsesReasoning(body: Record<string, unknown>, options: ChatOptions): void {
    if (this.isXAIMultiAgentModel(options.model)) {
      if (this.hasActiveReasoningEffort(options.reasoningEffort)) {
        body.reasoning = { effort: options.reasoningEffort };
      }
      return;
    }

    if (this.isXAIReasoningModel(options.model)) {
      return;
    }

    if (this.shouldSendGLMEnableThinking(options.model)) {
      body.enable_thinking = this.hasActiveReasoningEffort(options.reasoningEffort);
      return;
    }

    if (!this.isReasoningModel(options.model)) {
      return;
    }

    const reasoning: Record<string, unknown> = {};
    if (this.hasActiveReasoningEffort(options.reasoningEffort)) {
      reasoning.effort = options.reasoningEffort;
    }
    if (options.enableThinking) {
      reasoning.summary = "auto";
    }
    if (Object.keys(reasoning).length > 0) {
      body.reasoning = reasoning;
    }
  }

  /** Check if a model requires or benefits from the Responses API instead of Chat Completions */
  private useResponsesAPI(model: string, options?: Pick<ChatOptions, "captureReasoning">): boolean {
    if (this.isGenericCustomProvider()) return false;
    const m = model.toLowerCase();
    return (
      this.isXAIMultiAgentModel(model) ||
      (!!options?.captureReasoning && this.isXAIReasoningModel(model)) ||
      RESPONSES_ONLY_PREFIXES.some((p) => m.startsWith(p)) ||
      RESPONSES_ONLY_SUFFIXES.some((s) => m.endsWith(s))
    );
  }

  private requiresStreamingChatCompletions(model: string): boolean {
    if (this.isGenericCustomProvider()) return false;
    return model.toLowerCase().startsWith("gpt-5.5");
  }

  private shouldUseOpenRouterPromptCaching(options: ChatOptions): boolean {
    return (
      !this.isGenericCustomProvider() &&
      this.baseUrl.includes("openrouter.ai") &&
      !!options.enableCaching &&
      options.model.toLowerCase().includes("claude")
    );
  }

  private applyOpenRouterPromptCaching(body: Record<string, unknown>, options: ChatOptions): void {
    if (!this.shouldUseOpenRouterPromptCaching(options)) return;
    body.cache_control = { type: "ephemeral" };
    logger.debug("[OpenAI] Enabling OpenRouter prompt caching for model=%s", options.model);
  }

  private supportsGpt5Verbosity(model: string): boolean {
    return !this.isGenericCustomProvider() && model.toLowerCase().startsWith("gpt-5");
  }

  private shouldApplyOpenRouterProviderOverride(openrouterProvider?: string | null): boolean {
    return !!openrouterProvider && !this.isGenericCustomProvider() && this.baseUrl.includes("openrouter.ai");
  }

  private static extractChatCompletionsUsage(usage: ChatCompletionsUsagePayload | undefined): LLMUsage | undefined {
    if (!usage) return undefined;
    return {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
      cachedPromptTokens: usage.prompt_tokens_details?.cached_tokens,
      cacheWritePromptTokens: usage.prompt_tokens_details?.cache_write_tokens,
      completionReasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
      completionAudioTokens: usage.completion_tokens_details?.audio_tokens,
      acceptedPredictionTokens: usage.completion_tokens_details?.accepted_prediction_tokens,
      rejectedPredictionTokens: usage.completion_tokens_details?.rejected_prediction_tokens,
    };
  }

  /**
   * Whether this model uses "developer" role instead of "system" in Chat Completions.
   * OpenAI GPT-5.x and o-series models use "developer" for system-level instructions.
   */
  private usesDeveloperRole(model: string): boolean {
    if (this.isGenericCustomProvider()) return false;
    const m = model.toLowerCase();
    return m.startsWith("gpt-5") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4");
  }

  private formatMessages(messages: ChatMessage[], model?: string) {
    const devRole = model && this.usesDeveloperRole(model);
    return messages
      .filter((m) => {
        // Keep tool messages and assistant messages with tool_calls regardless of content
        if (m.role === "tool") return true;
        if (m.role === "assistant" && m.tool_calls?.length) return true;
        // Drop messages with empty/whitespace-only content
        return m.content?.trim();
      })
      .map((m) => {
        const reasoningPayload =
          m.role === "assistant" ? this.assistantReasoningPayload(m.providerMetadata, model) : {};
        if (m.role === "tool") {
          return { role: "tool" as const, content: m.content, tool_call_id: m.tool_call_id };
        }
        if (m.role === "assistant" && m.tool_calls?.length) {
          return {
            role: "assistant" as const,
            content: m.content || null,
            tool_calls: m.tool_calls,
            ...reasoningPayload,
          };
        }
        // Multimodal: if message has images, use content array format
        if (m.images?.length) {
          const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
          if (m.content) parts.push({ type: "text", text: m.content });
          for (const img of m.images) {
            parts.push({ type: "image_url", image_url: { url: img } });
          }
          return { role: m.role, content: parts };
        }
        // Map system → developer for newer OpenAI models
        const role = m.role === "system" && devRole ? "developer" : m.role;
        return { role, content: m.content, ...reasoningPayload };
      });
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string, LLMUsage | void, unknown> {
    const configuredMaxTokens = this.applyMaxTokensCap(options.maxTokens ?? 4096);
    const contextFit = this.fitMessagesToContext(messages, { ...options, maxTokens: configuredMaxTokens });
    messages = contextFit.messages;
    this.logContextTrim(contextFit, options.model);
    const maxTokens = this.applyMaxTokensCap(contextFit.maxTokens ?? configuredMaxTokens);

    // Route to Responses API for models that require it
    if (this.useResponsesAPI(options.model, options)) {
      logger.debug(
        "[OpenAI] Routing chat() to Responses API for model=%s stream=%s",
        options.model,
        options.stream ?? true,
      );
      return yield* this.chatResponses(messages, { ...options, maxTokens });
    }

    const url = `${this.baseUrl}/chat/completions`;
    const reasoning = this.isReasoningModel(options.model);

    const formatted = this.formatMessages(messages, options.model);
    // Ensure at least one non-system message exists (some providers like Gemini
    // reject requests with only system messages)
    if (!formatted.some((m) => m.role !== "system" && m.role !== "developer")) {
      formatted.push({ role: "user", content: "Continue." });
    }

    const effectiveStream = this.requiresStreamingChatCompletions(options.model) ? true : (options.stream ?? true);

    const body: Record<string, unknown> = {
      model: options.model,
      messages: formatted,
      stream: effectiveStream,
      ...(this.shouldSendStopSequences(options.model) && options.stop?.length ? { stop: options.stop } : {}),
      ...(options.tools?.length ? { tools: options.tools } : {}),
      ...(effectiveStream ? { stream_options: { include_usage: true } } : {}),
    };

    if (reasoning) {
      // Reasoning models use max_completion_tokens instead of max_tokens
      body.max_completion_tokens = maxTokens;
    } else {
      body.max_tokens = maxTokens;
    }

    // o-series models never support temperature/topP; GPT-5.x only with effort=none
    if (!this.isNoTemperatureModel(options.model, options.reasoningEffort)) {
      body.temperature = options.temperature ?? 1;
      const topP = OpenAIProvider.normalizeTopP(options.topP);
      if (topP != null) body.top_p = topP;
      if (
        this.shouldSendTopK() &&
        typeof options.topK === "number" &&
        Number.isFinite(options.topK) &&
        options.topK > 0
      ) {
        body.top_k = Math.round(options.topK);
      }
      if (this.shouldSendPenaltyParams(options.model)) {
        if (options.frequencyPenalty) body.frequency_penalty = options.frequencyPenalty;
        if (options.presencePenalty) body.presence_penalty = options.presencePenalty;
      }
    }

    if (options.verbosity && this.supportsGpt5Verbosity(options.model)) {
      body.verbosity = options.verbosity;
    }

    this.applyChatCompletionsReasoning(body, options);

    // OpenRouter provider routing preference
    const openrouterProvider = this.resolveOpenrouterProvider(options.openrouterProvider);
    if (this.shouldApplyOpenRouterProviderOverride(openrouterProvider)) {
      body.provider = { order: [openrouterProvider] };
    }

    this.applyOpenRouterPromptCaching(body, options);

    // Force response format (e.g. JSON mode)
    const normalizedResponseFormat = this.normalizeChatCompletionsResponseFormat(options.responseFormat);
    if (normalizedResponseFormat) {
      body.response_format = normalizedResponseFormat;
    }

    this.applyCustomParameters(body, options);

    logger.debug(
      "[OpenAI chat()] stream=%s model=%s reasoning_effort=%s enableThinking=%s verbosity=%s max_completion_tokens=%s max_tokens=%s temperature=%s top_p=%s tools=%s",
      body.stream,
      body.model,
      body.reasoning_effort ?? "none",
      !!options.enableThinking,
      body.verbosity ?? "default",
      body.max_completion_tokens ?? "n/a",
      body.max_tokens ?? "n/a",
      body.temperature ?? "default",
      body.top_p ?? "default",
      Array.isArray(body.tools) ? body.tools.length : 0,
    );

    const response = await llmFetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${sanitizeApiError(errorText)}`);
    }

    if (!effectiveStream) {
      const json = await OpenAIProvider.parseJsonBody<{
        choices: Array<{ message: Record<string, unknown> & { content: string | unknown[] } }>;
        usage?: ChatCompletionsUsagePayload;
      }>(response, "OpenAI chat() non-stream response");
      const msg = json.choices[0]?.message;
      const reasoningMetadata = OpenAIProvider.extractReasoningMetadata(msg);
      OpenAIProvider.emitChatCompletionsReasoning(options, reasoningMetadata);
      const reasoning = OpenAIProvider.extractReasoning(msg);
      if (reasoning && options.onThinking) {
        options.onThinking(reasoning);
      }
      // Handle OpenRouter content block arrays (Anthropic-style)
      const blocks = OpenAIProvider.extractContentBlocks(msg?.content);
      if (blocks) {
        if (!reasoning && blocks.thinking && options.onThinking) options.onThinking(blocks.thinking);
        yield blocks.text;
      } else {
        yield (msg?.content as string) ?? "";
      }
      return OpenAIProvider.extractChatCompletionsUsage(json.usage);
    }

    // Stream SSE response
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    // Ensure aborting the signal cancels the reader (closes the TCP connection
    // to the backend), even if undici doesn't propagate the abort automatically.
    const onAbort = () => reader.cancel().catch(() => {});
    if (options.signal) {
      if (options.signal.aborted) {
        await reader.cancel().catch(() => {});
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let streamUsage: LLMUsage | undefined;
    const reasoningMetadata: Record<string, unknown> = {};

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          const data = OpenAIProvider.extractSseData(trimmed);
          if (data == null) continue;
          if (data === "[DONE]") {
            OpenAIProvider.emitChatCompletionsReasoning(options, reasoningMetadata);
            if (streamUsage) return streamUsage;
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{ delta: Record<string, unknown> & { content?: string | unknown[] } }>;
              usage?: ChatCompletionsUsagePayload;
            };
            // Capture usage from the final chunk (OpenAI sends it with stream_options)
            if (parsed.usage) {
              streamUsage = OpenAIProvider.extractChatCompletionsUsage(parsed.usage);
            }
            const delta = parsed.choices[0]?.delta;
            OpenAIProvider.appendReasoningMetadata(reasoningMetadata, delta);
            const reasoning = OpenAIProvider.extractReasoning(delta);
            if (reasoning && options.onThinking) {
              options.onThinking(reasoning);
            }
            // Handle OpenRouter content block arrays (Anthropic-style)
            const blocks = OpenAIProvider.extractContentBlocks(delta?.content);
            if (blocks) {
              if (!reasoning && blocks.thinking && options.onThinking) options.onThinking(blocks.thinking);
              if (blocks.text) yield blocks.text;
            } else if (delta?.content) {
              yield delta.content as string;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
    }
    OpenAIProvider.emitChatCompletionsReasoning(options, reasoningMetadata);
    if (streamUsage) return streamUsage;
  }

  /** Non-streaming completion with tool-call support */
  async chatComplete(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> {
    const configuredMaxTokens = this.applyMaxTokensCap(options.maxTokens ?? 4096);
    const contextFit = this.fitMessagesToContext(messages, { ...options, maxTokens: configuredMaxTokens });
    messages = contextFit.messages;
    this.logContextTrim(contextFit, options.model);
    const maxTokens = this.applyMaxTokensCap(contextFit.maxTokens ?? configuredMaxTokens);

    // Route to Responses API for models that require it
    if (this.useResponsesAPI(options.model, options)) {
      logger.debug(
        "[OpenAI] Routing chatComplete() to Responses API for model=%s onToken=%s",
        options.model,
        !!options.onToken,
      );
      return this.chatCompleteResponses(messages, { ...options, maxTokens });
    }

    const url = `${this.baseUrl}/chat/completions`;
    const reasoning = this.isReasoningModel(options.model);

    const useStream = this.requiresStreamingChatCompletions(options.model)
      ? true
      : (options.stream ?? !!options.onToken);

    const formatted = this.formatMessages(messages, options.model);
    if (!formatted.some((m) => m.role !== "system" && m.role !== "developer")) {
      formatted.push({ role: "user", content: "Continue." });
    }

    const body: Record<string, unknown> = {
      model: options.model,
      messages: formatted,
      stream: useStream,
      ...(this.shouldSendStopSequences(options.model) && options.stop?.length ? { stop: options.stop } : {}),
      ...(options.tools?.length ? { tools: options.tools } : {}),
      ...(useStream ? { stream_options: { include_usage: true } } : {}),
    };

    if (reasoning) {
      body.max_completion_tokens = maxTokens;
    } else {
      body.max_tokens = maxTokens;
    }

    // o-series models never support temperature/topP; GPT-5.x only with effort=none
    if (!this.isNoTemperatureModel(options.model, options.reasoningEffort)) {
      body.temperature = options.temperature ?? 1;
      const topP = OpenAIProvider.normalizeTopP(options.topP);
      if (topP != null) body.top_p = topP;
      if (
        this.shouldSendTopK() &&
        typeof options.topK === "number" &&
        Number.isFinite(options.topK) &&
        options.topK > 0
      ) {
        body.top_k = Math.round(options.topK);
      }
      if (this.shouldSendPenaltyParams(options.model)) {
        if (options.frequencyPenalty) body.frequency_penalty = options.frequencyPenalty;
        if (options.presencePenalty) body.presence_penalty = options.presencePenalty;
      }
    }

    if (options.verbosity && this.supportsGpt5Verbosity(options.model)) {
      body.verbosity = options.verbosity;
    }

    this.applyChatCompletionsReasoning(body, options);

    // OpenRouter provider routing preference
    const openrouterProvider = this.resolveOpenrouterProvider(options.openrouterProvider);
    if (this.shouldApplyOpenRouterProviderOverride(openrouterProvider)) {
      body.provider = { order: [openrouterProvider] };
    }

    this.applyOpenRouterPromptCaching(body, options);

    // Force response format (e.g. JSON mode)
    const normalizedResponseFormat = this.normalizeChatCompletionsResponseFormat(options.responseFormat);
    if (normalizedResponseFormat) {
      body.response_format = normalizedResponseFormat;
    }

    this.applyCustomParameters(body, options);

    logger.debug("[OpenAI chatComplete()] stream=%s model=%s onToken=%s", useStream, body.model, !!options.onToken);

    const response = await llmFetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${sanitizeApiError(errorText)}`);
    }

    if (!useStream) {
      // Non-streaming path (no onToken callback)
      const json = await OpenAIProvider.parseJsonBody<{
        choices: Array<{
          message: Record<string, unknown> & {
            content: string | unknown[] | null;
            tool_calls?: LLMToolCall[];
          };
          finish_reason: string;
        }>;
        usage?: ChatCompletionsUsagePayload;
      }>(response, "OpenAI chatComplete() non-stream response");

      const choice = json.choices[0];
      const reasoningMetadata = OpenAIProvider.extractReasoningMetadata(choice?.message);
      OpenAIProvider.emitChatCompletionsReasoning(options, reasoningMetadata);
      const reasoning = OpenAIProvider.extractReasoning(choice?.message);
      if (reasoning && options.onThinking) {
        options.onThinking(reasoning);
      }
      // Handle OpenRouter content block arrays (Anthropic-style)
      let resolvedContent: string | null = null;
      const blocks = OpenAIProvider.extractContentBlocks(choice?.message?.content);
      if (blocks) {
        if (!reasoning && blocks.thinking && options.onThinking) options.onThinking(blocks.thinking);
        resolvedContent = blocks.text || null;
      } else {
        resolvedContent = (choice?.message?.content as string) ?? null;
      }
      const usage = OpenAIProvider.extractChatCompletionsUsage(json.usage);
      return {
        content: resolvedContent,
        toolCalls: choice?.message?.tool_calls ?? [],
        finishReason: choice?.finish_reason ?? "stop",
        usage,
        ...(OpenAIProvider.hasReasoningMetadata(reasoningMetadata) ? { providerMetadata: reasoningMetadata } : {}),
      };
    }

    // ── Streaming path: stream text tokens via onToken, collect tool calls ──
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let finishReason = "stop";
    let streamUsage: LLMUsage | undefined;
    const reasoningMetadata: Record<string, unknown> = {};

    // Accumulate tool calls from deltas
    const toolCallsMap = new Map<
      number,
      { id: string; type: "function"; function: { name: string; arguments: string } }
    >();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        const data = OpenAIProvider.extractSseData(trimmed);
        if (data == null) continue;
        if (data === "[DONE]") break;

        try {
          const parsed = JSON.parse(data) as {
            choices: Array<{
              delta: Record<string, unknown> & {
                content?: string | unknown[];
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  type?: "function";
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string;
            }>;
            usage?: ChatCompletionsUsagePayload;
          };

          if (parsed.usage) {
            streamUsage = OpenAIProvider.extractChatCompletionsUsage(parsed.usage);
          }

          const choice = parsed.choices[0];
          if (!choice) continue;

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          const delta = choice.delta;
          OpenAIProvider.appendReasoningMetadata(reasoningMetadata, delta);

          // Stream reasoning/thinking
          const reasoning = OpenAIProvider.extractReasoning(delta);
          if (reasoning && options.onThinking) {
            options.onThinking(reasoning);
          }

          // Handle OpenRouter content block arrays (Anthropic-style)
          const blocks = OpenAIProvider.extractContentBlocks(delta?.content);
          if (blocks) {
            if (!reasoning && blocks.thinking && options.onThinking) options.onThinking(blocks.thinking);
            if (blocks.text) {
              content += blocks.text;
              options.onToken?.(blocks.text);
            }
          } else if (delta?.content) {
            content += delta.content as string;
            options.onToken?.(delta.content as string);
          }

          // Accumulate tool call deltas
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCallsMap.get(tc.index);
              if (!existing) {
                toolCallsMap.set(tc.index, {
                  id: tc.id ?? "",
                  type: "function",
                  function: {
                    name: tc.function?.name ?? "",
                    arguments: tc.function?.arguments ?? "",
                  },
                });
              } else {
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.function.name += tc.function.name;
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
              }
            }
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    // Collect tool calls in order
    const toolCalls: LLMToolCall[] = [];
    const sortedKeys = [...toolCallsMap.keys()].sort((a, b) => a - b);
    for (const key of sortedKeys) {
      toolCalls.push(toolCallsMap.get(key)!);
    }

    OpenAIProvider.emitChatCompletionsReasoning(options, reasoningMetadata);

    return {
      content: content || null,
      toolCalls,
      finishReason: finishReason === "tool_calls" ? "tool_calls" : finishReason,
      usage: streamUsage,
      ...(OpenAIProvider.hasReasoningMetadata(reasoningMetadata) ? { providerMetadata: reasoningMetadata } : {}),
    };
  }

  // ══════════════════════════════════════════════
  // OpenAI Responses API (/responses)
  // ══════════════════════════════════════════════

  /**
   * Convert chat-completion-style messages into Responses API `input` items.
   * System messages are extracted into the top-level `instructions` field.
   * Tool messages become `function_call_output` items.
   * Assistant messages with tool_calls become `function_call` items.
   */
  private formatResponsesInput(messages: ChatMessage[]): {
    instructions: string | undefined;
    input: Array<Record<string, unknown>>;
  } {
    // The Responses API requires function-call IDs to start with "fc_".
    // Tool calls coming from Chat Completions history use "call_" prefix.
    // Re-map consistently so both function_call and function_call_output match.
    const idMap = new Map<string, string>();
    let fcCounter = 0;
    const ensureFcId = (id: string): string => {
      if (id.startsWith("fc_")) return id;
      const existing = idMap.get(id);
      if (existing) return existing;
      const mapped = `fc_mapped_${++fcCounter}`;
      idMap.set(id, mapped);
      return mapped;
    };

    let instructions: string | undefined;
    const input: Array<Record<string, unknown>> = [];

    for (const m of messages) {
      if (m.role === "system") {
        // Merge all system messages into the top-level `instructions` field,
        // which is the canonical way to pass system/developer messages in
        // the Responses API.
        if (m.content?.trim()) {
          if (instructions) {
            instructions += "\n\n" + m.content;
          } else {
            instructions = m.content;
          }
        }
        continue;
      }

      if (m.role === "tool") {
        // Tool result → function_call_output item
        input.push({
          type: "function_call_output",
          call_id: m.tool_call_id ? ensureFcId(m.tool_call_id) : m.tool_call_id,
          output: m.content,
        });
        continue;
      }

      if (m.role === "assistant" && m.tool_calls?.length) {
        // First emit the text content if any
        if (m.content) {
          input.push({ role: "assistant", content: m.content });
        }
        // Then emit each tool call as a function_call item
        for (const tc of m.tool_calls) {
          const fcId = ensureFcId(tc.id);
          input.push({
            type: "function_call",
            id: fcId,
            call_id: fcId,
            name: tc.function.name,
            arguments: tc.function.arguments,
          });
        }
        continue;
      }

      if (m.role === "user" && m.images?.length) {
        // Multimodal user message
        const content: Array<Record<string, unknown>> = [];
        if (m.content) content.push({ type: "input_text", text: m.content });
        for (const img of m.images) {
          content.push({ type: "input_image", image_url: img });
        }
        input.push({ role: "user", content });
        continue;
      }

      // Regular user or assistant message — skip empty content
      if (!m.content?.trim()) continue;
      input.push({ role: m.role, content: m.content });
    }

    if (input.length === 0) {
      input.push({ role: "user", content: "Continue." });
    }

    return { instructions, input };
  }

  /** Convert LLMToolDefinition[] to Responses API tool format */
  private formatResponsesTools(tools: LLMToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
  }

  /** Check if a Responses API error is due to stale/corrupt encrypted reasoning items */
  private isEncryptedContentError(errorText: string): boolean {
    return errorText.includes("encrypted content") && errorText.includes("could not be");
  }

  /** Strip encrypted reasoning items from a Responses API body for retry */
  private stripEncryptedItems(body: Record<string, unknown>): Record<string, unknown> {
    const input = body.input as Array<Record<string, unknown>> | undefined;
    if (input) {
      body.input = input.filter((item) => item.type !== "reasoning");
    }
    return body;
  }

  /** Build the Responses API request body */
  private buildResponsesBody(messages: ChatMessage[], options: ChatOptions): Record<string, unknown> {
    const { instructions, input } = this.formatResponsesInput(messages);

    // Replay encrypted reasoning items from the previous turn so the model
    // retains its reasoning context and avoids re-deriving (and re-narrating) the same conclusions.
    if (options.encryptedReasoningItems?.length) {
      let lastAssistantIdx = -1;
      for (let i = input.length - 1; i >= 0; i--) {
        if ((input[i] as Record<string, unknown>).role === "assistant") {
          lastAssistantIdx = i;
          break;
        }
      }
      if (lastAssistantIdx >= 0) {
        input.splice(lastAssistantIdx, 0, ...(options.encryptedReasoningItems as Array<Record<string, unknown>>));
      }
    }

    const body: Record<string, unknown> = {
      model: options.model,
      input,
      stream: options.stream ?? true,
      store: false, // don't persist responses on OpenAI side
      // Request encrypted reasoning items so we can replay them on the next turn
      include: ["reasoning.encrypted_content"],
    };

    if (instructions) {
      body.instructions = instructions;
    }

    if (options.maxTokens && !this.isXAIMultiAgentModel(options.model)) {
      body.max_output_tokens = options.maxTokens;
    }

    // o-series models never support temperature/topP; GPT-5.x only with effort=none
    if (!this.isNoTemperatureModel(options.model, options.reasoningEffort)) {
      if (options.temperature != null) body.temperature = options.temperature;
      const topP = OpenAIProvider.normalizeTopP(options.topP);
      if (topP != null) body.top_p = topP;
      if (this.shouldSendPenaltyParams(options.model)) {
        if (options.frequencyPenalty) body.frequency_penalty = options.frequencyPenalty;
        if (options.presencePenalty) body.presence_penalty = options.presencePenalty;
      }
    }

    this.applyResponsesReasoning(body, options);

    // GPT-5+ text verbosity control
    if (options.verbosity && this.supportsGpt5Verbosity(options.model)) {
      body.text = { verbosity: options.verbosity };
    }

    const openrouterProvider = this.resolveOpenrouterProvider(options.openrouterProvider);
    if (this.shouldApplyOpenRouterProviderOverride(openrouterProvider)) {
      body.provider = { order: [openrouterProvider] };
    }

    if (options.tools?.length && !this.isXAIMultiAgentModel(options.model)) {
      body.tools = this.formatResponsesTools(options.tools);
    }

    this.applyCustomParameters(body, options);

    return body;
  }

  /**
   * Streaming generation using the Responses API.
   * SSE events use typed event names like `response.output_text.delta`.
   */
  private async *chatResponses(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<string, LLMUsage | void, unknown> {
    const url = `${this.baseUrl}/responses`;
    const body = this.buildResponsesBody(messages, options);
    logger.debug(
      "[OpenAI chatResponses] model=%s stream=%s reasoning=%j enableThinking=%s verbosity=%s max_output_tokens=%s tools=%s",
      body.model,
      body.stream,
      body.reasoning ?? {},
      !!options.enableThinking,
      typeof body.text === "object" && body.text && "verbosity" in body.text
        ? ((body.text as { verbosity?: string }).verbosity ?? "default")
        : "default",
      body.max_output_tokens ?? "n/a",
      Array.isArray(body.tools) ? body.tools.length : 0,
    );

    let response = await llmFetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Retry without encrypted reasoning items if they're stale/corrupt
      if (
        response.status === 400 &&
        this.isEncryptedContentError(errorText) &&
        options.encryptedReasoningItems?.length
      ) {
        logger.warn("[OpenAI chatResponses] Encrypted reasoning items rejected, retrying without them");
        options.onEncryptedReasoning?.([]); // clear the cache
        this.stripEncryptedItems(body);
        response = await llmFetch(url, {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
          ...(options.signal ? { signal: options.signal } : {}),
        });
        if (!response.ok) {
          const retryError = await response.text();
          throw new Error(`OpenAI Responses API error ${response.status}: ${sanitizeApiError(retryError)}`);
        }
      } else {
        throw new Error(`OpenAI Responses API error ${response.status}: ${sanitizeApiError(errorText)}`);
      }
    }

    if (!options.stream) {
      // Non-streaming: parse the full response
      const json = await OpenAIProvider.parseJsonBody<Record<string, unknown>>(
        response,
        "OpenAI chatResponses() non-stream response",
      );
      // Extract reasoning summaries for non-streaming
      if (options.onThinking) {
        const output = json.output as Array<Record<string, unknown>> | undefined;
        if (output) {
          for (const item of output) {
            if (item.type === "reasoning") {
              const summary = item.summary as Array<Record<string, unknown>> | undefined;
              if (summary) {
                for (const part of summary) {
                  if (part.type === "summary_text" && typeof part.text === "string") {
                    options.onThinking(part.text);
                  }
                }
              }
            }
          }
        }
      }
      // Emit encrypted reasoning items for multi-turn context
      this.emitEncryptedReasoning(json, options);
      const text = this.extractResponsesText(json);
      if (text) yield text;
      return this.extractResponsesUsage(json);
    }

    // Stream SSE
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let streamUsage: LLMUsage | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let currentEvent = "";
      for (const line of lines) {
        const trimmed = line.trim();

        // SSE event type line
        const eventName = OpenAIProvider.extractSseEvent(trimmed);
        if (eventName != null) {
          currentEvent = eventName;
          continue;
        }

        const data = OpenAIProvider.extractSseData(trimmed);
        if (data == null) {
          if (trimmed === "") currentEvent = ""; // reset on blank line
          continue;
        }

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          // Use SSE event: field if present, otherwise fall back to the JSON type field.
          // Some proxies strip SSE event names and only forward data lines.
          const eventType = currentEvent || (parsed.type as string) || "";

          switch (eventType) {
            case "response.output_text.delta": {
              const delta = parsed.delta as string | undefined;
              if (delta) yield delta;
              break;
            }
            case "response.reasoning_summary_text.delta": {
              const delta = parsed.delta as string | undefined;
              if (delta && options.onThinking) options.onThinking(delta);
              break;
            }
            case "response.refusal.delta": {
              // Treat refusals as regular text so the user sees the message
              const delta = parsed.delta as string | undefined;
              if (delta) yield delta;
              break;
            }
            case "response.completed": {
              // Extract usage and encrypted reasoning from the completed response
              const resp = parsed.response as Record<string, unknown> | undefined;
              if (resp) {
                streamUsage = this.extractResponsesUsage(resp);
                this.emitEncryptedReasoning(resp, options);
              }
              break;
            }
            // Ignore other event types (response.created, response.in_progress, etc.)
          }
        } catch {
          // Skip malformed JSON
        }
        currentEvent = "";
      }
    }

    if (streamUsage) return streamUsage;
  }

  /**
   * Non-streaming completion with tool-call support via the Responses API.
   */
  private async chatCompleteResponses(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> {
    const url = `${this.baseUrl}/responses`;
    const useStream = options.stream ?? !!options.onToken;
    const body = this.buildResponsesBody(messages, { ...options, stream: useStream });
    logger.debug(
      "[OpenAI chatCompleteResponses] reasoning=%s onThinking=%s",
      JSON.stringify(body.reasoning ?? null),
      !!options.onThinking,
    );

    let response = await llmFetch(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Retry without encrypted reasoning items if they're stale/corrupt
      if (
        response.status === 400 &&
        this.isEncryptedContentError(errorText) &&
        options.encryptedReasoningItems?.length
      ) {
        logger.warn("[OpenAI chatCompleteResponses] Encrypted reasoning items rejected, retrying without them");
        options.onEncryptedReasoning?.([]); // clear the cache
        this.stripEncryptedItems(body);
        response = await llmFetch(url, {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
          ...(options.signal ? { signal: options.signal } : {}),
        });
        if (!response.ok) {
          const retryError = await response.text();
          throw new Error(`OpenAI Responses API error ${response.status}: ${sanitizeApiError(retryError)}`);
        }
      } else {
        throw new Error(`OpenAI Responses API error ${response.status}: ${sanitizeApiError(errorText)}`);
      }
    }

    if (!useStream) {
      // Non-streaming: parse the full response
      const json = await OpenAIProvider.parseJsonBody<Record<string, unknown>>(
        response,
        "OpenAI chatCompleteResponses() non-stream response",
      );
      // Extract reasoning summaries
      if (options.onThinking) {
        const output = json.output as Array<Record<string, unknown>> | undefined;
        if (output) {
          for (const item of output) {
            if (item.type === "reasoning") {
              const summary = item.summary as Array<Record<string, unknown>> | undefined;
              if (summary) {
                for (const part of summary) {
                  if (part.type === "summary_text" && typeof part.text === "string") {
                    options.onThinking(part.text);
                  }
                }
              }
            }
          }
        }
      }
      // Emit encrypted reasoning items for multi-turn context
      this.emitEncryptedReasoning(json, options);
      return this.parseResponsesResult(json);
    }

    // Streaming path: stream text tokens, accumulate function calls
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const onAbortCCR = () => reader.cancel().catch(() => {});
    if (options.signal) {
      if (options.signal.aborted) {
        await reader.cancel().catch(() => {});
        return { content: null, toolCalls: [], finishReason: "stop", usage: undefined };
      }
      options.signal.addEventListener("abort", onAbortCCR, { once: true });
    }

    const decoder = new TextDecoder();
    let sseBuffer = "";
    let content = "";
    let finishReason = "stop";
    let streamUsage: LLMUsage | undefined;
    const functionCalls: LLMToolCall[] = [];
    // Track in-progress function call argument deltas keyed by call_id
    const fnCallArgs = new Map<string, { id: string; name: string; arguments: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";

      let currentEvent = "";
      for (const line of lines) {
        const trimmed = line.trim();

        const eventName = OpenAIProvider.extractSseEvent(trimmed);
        if (eventName != null) {
          currentEvent = eventName;
          continue;
        }

        const data = OpenAIProvider.extractSseData(trimmed);
        if (data == null) {
          if (trimmed === "") currentEvent = "";
          continue;
        }

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          // Use SSE event: field if present, otherwise fall back to the JSON type field.
          // Some proxies strip SSE event names and only forward data lines.
          const eventType = currentEvent || (parsed.type as string) || "";

          switch (eventType) {
            case "response.output_text.delta": {
              const delta = parsed.delta as string | undefined;
              if (delta) {
                content += delta;
                options.onToken?.(delta);
              }
              break;
            }

            case "response.reasoning_summary_text.delta": {
              const delta = parsed.delta as string | undefined;
              if (delta && options.onThinking) options.onThinking(delta);
              break;
            }

            case "response.output_item.added": {
              // A new output item appeared — could be a function_call
              const item = parsed.item as Record<string, unknown> | undefined;
              if (item?.type === "function_call") {
                const callId = (item.call_id ?? item.id) as string;
                fnCallArgs.set(callId, {
                  id: callId,
                  name: (item.name as string) ?? "",
                  arguments: (item.arguments as string) ?? "",
                });
              }
              break;
            }

            case "response.function_call_arguments.delta": {
              const callId = parsed.call_id as string | undefined;
              const delta = parsed.delta as string | undefined;
              if (callId && delta) {
                const entry = fnCallArgs.get(callId);
                if (entry) entry.arguments += delta;
              }
              break;
            }

            case "response.function_call_arguments.done": {
              const callId = parsed.call_id as string | undefined;
              if (callId) {
                const entry = fnCallArgs.get(callId);
                if (entry) {
                  // Overwrite with the final arguments if provided
                  const args = parsed.arguments as string | undefined;
                  if (args) entry.arguments = args;
                }
              }
              break;
            }

            case "response.output_item.done": {
              // Finalize function_call items
              const item = parsed.item as Record<string, unknown> | undefined;
              if (item?.type === "function_call") {
                const callId = ((item.call_id ?? item.id) as string) ?? "";
                const entry = fnCallArgs.get(callId);
                functionCalls.push({
                  id: callId,
                  type: "function",
                  function: {
                    name: entry?.name ?? (item.name as string) ?? "",
                    arguments: entry?.arguments ?? (item.arguments as string) ?? "",
                  },
                });
              }
              break;
            }

            case "response.completed": {
              const resp = parsed.response as Record<string, unknown> | undefined;
              if (resp) {
                streamUsage = this.extractResponsesUsage(resp);
                this.emitEncryptedReasoning(resp, options);
                const status = resp.status as string | undefined;
                if (status === "incomplete") finishReason = "length";
              }
              break;
            }
          }
        } catch {
          // Skip malformed JSON
        }
        currentEvent = "";
      }
    }
    if (options.signal) options.signal.removeEventListener("abort", onAbortCCR);
    // Check if we got tool calls
    if (functionCalls.length > 0) {
      finishReason = "tool_calls";
    }

    return {
      content: content || null,
      toolCalls: functionCalls,
      finishReason,
      usage: streamUsage,
    };
  }

  /** Extract output text from a non-streaming Responses API result */
  private extractResponsesText(json: Record<string, unknown>): string {
    // output_text is a convenience field
    if (typeof json.output_text === "string") return json.output_text;

    // Otherwise walk the output items
    const output = json.output as Array<Record<string, unknown>> | undefined;
    if (!output) return "";

    let text = "";
    for (const item of output) {
      if (item.type === "message") {
        const content = item.content as Array<Record<string, unknown>> | undefined;
        if (content) {
          for (const part of content) {
            if (part.type === "output_text" && typeof part.text === "string") {
              text += part.text;
            }
          }
        }
      }
    }
    return text;
  }

  /**
   * Extract encrypted reasoning items from a Responses API result's output array.
   * These are opaque `{ type: "reasoning", encrypted_content: "..." }` objects
   * that can be replayed in the next turn's input for reasoning continuity.
   */
  private extractEncryptedReasoningItems(json: Record<string, unknown>): unknown[] {
    const output = json.output as Array<Record<string, unknown>> | undefined;
    if (!output) return [];
    return output.filter((item) => item.type === "reasoning" && typeof item.encrypted_content === "string");
  }

  /** Emit encrypted reasoning items via the callback if present */
  private emitEncryptedReasoning(json: Record<string, unknown>, options: ChatOptions): void {
    if (!options.onEncryptedReasoning) return;
    const items = this.extractEncryptedReasoningItems(json);
    if (items.length > 0) options.onEncryptedReasoning(items);
  }

  /** Extract usage from a Responses API result */
  private extractResponsesUsage(json: Record<string, unknown>): LLMUsage | undefined {
    const usage = json.usage as ResponsesUsagePayload | undefined;
    if (!usage) return undefined;
    return {
      promptTokens: usage.input_tokens ?? 0,
      completionTokens: usage.output_tokens ?? 0,
      totalTokens: usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      cachedPromptTokens: usage.input_tokens_details?.cached_tokens,
      cacheWritePromptTokens: usage.input_tokens_details?.cache_write_tokens,
      completionReasoningTokens: usage.output_tokens_details?.reasoning_tokens,
      completionAudioTokens: usage.output_tokens_details?.audio_tokens,
      acceptedPredictionTokens: usage.output_tokens_details?.accepted_prediction_tokens,
      rejectedPredictionTokens: usage.output_tokens_details?.rejected_prediction_tokens,
    };
  }

  /** Parse a non-streaming Responses API result into ChatCompletionResult */
  private parseResponsesResult(json: Record<string, unknown>): ChatCompletionResult {
    const text = this.extractResponsesText(json);
    const usage = this.extractResponsesUsage(json);
    const output = json.output as Array<Record<string, unknown>> | undefined;

    // Extract function calls from output items
    const toolCalls: LLMToolCall[] = [];
    if (output) {
      for (const item of output) {
        if (item.type === "function_call") {
          toolCalls.push({
            id: ((item.call_id ?? item.id) as string) ?? "",
            type: "function",
            function: {
              name: (item.name as string) ?? "",
              arguments: (item.arguments as string) ?? "",
            },
          });
        }
      }
    }

    const status = json.status as string | undefined;
    let finishReason: string;
    if (toolCalls.length > 0) {
      finishReason = "tool_calls";
    } else if (status === "incomplete") {
      finishReason = "length";
    } else {
      finishReason = "stop";
    }

    return {
      content: text || null,
      toolCalls,
      finishReason,
      usage,
    };
  }
}
