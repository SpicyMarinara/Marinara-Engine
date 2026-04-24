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
};

/**
 * Handles OpenAI, OpenRouter, Mistral, Cohere, and any OpenAI-compatible endpoint.
 */
export class OpenAIProvider extends BaseLLMProvider {
  private static normalizeTopP(topP: number | null | undefined): number | undefined {
    if (topP == null || !Number.isFinite(topP)) return undefined;
    if (topP <= 0) return 1;
    return Math.min(topP, 1);
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

  /** Build standard request headers, adding OpenRouter app tracking when applicable. */
  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.baseUrl.includes("openrouter.ai")) {
      h["HTTP-Referer"] = "https://github.com/Pasta-Devs/Marinara-Engine";
      h["X-Title"] = "Marinara Engine";
    }
    return h;
  }

  /** Check if a model ID represents an OpenAI reasoning model */
  private isReasoningModel(model: string): boolean {
    const m = model.toLowerCase();
    return /^(o1|o3|o4)/.test(m) || m.startsWith("gpt-5");
  }

  /**
   * Check if a model/config does NOT support temperature/topP.
   * o-series models never do.
   * GPT-5.x models only support temperature when reasoning effort is "none" (the default).
   */
  private isNoTemperatureModel(model: string, reasoningEffort?: string): boolean {
    const m = model.toLowerCase();
    if (/^(o1|o3|o4)/.test(m)) return true;
    if (m.startsWith("gpt-5") && reasoningEffort && reasoningEffort !== "none") return true;
    // Claude Opus 4.7+: all sampling params forbidden (covers reverse proxies)
    if (/claude-opus-4-(?:[7-9]|\d{2,})/.test(m)) return true;
    return false;
  }

  /** GLM variants use a boolean thinking toggle instead of effort-based reasoning config. */
  private isGLMModel(model: string): boolean {
    return model.toLowerCase().includes("glm");
  }

  private hasActiveReasoningEffort(reasoningEffort?: string | null): boolean {
    return !!reasoningEffort && reasoningEffort !== "none";
  }

  private shouldSendReasoningEffort(model: string, reasoningEffort?: string | null): boolean {
    return this.isReasoningModel(model) && this.hasActiveReasoningEffort(reasoningEffort);
  }

  private applyChatCompletionsReasoning(body: Record<string, unknown>, options: ChatOptions): void {
    if (this.isGLMModel(options.model)) {
      body.enable_thinking = this.hasActiveReasoningEffort(options.reasoningEffort);
      return;
    }

    if (this.shouldSendReasoningEffort(options.model, options.reasoningEffort)) {
      body.reasoning_effort = options.reasoningEffort;
    }
  }

  private applyResponsesReasoning(body: Record<string, unknown>, options: ChatOptions): void {
    if (this.isGLMModel(options.model)) {
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

  /** Check if a model requires the Responses API instead of Chat Completions */
  private useResponsesAPI(model: string): boolean {
    const m = model.toLowerCase();
    return RESPONSES_ONLY_PREFIXES.some((p) => m.startsWith(p)) || RESPONSES_ONLY_SUFFIXES.some((s) => m.endsWith(s));
  }

  private shouldUseOpenRouterPromptCaching(options: ChatOptions): boolean {
    return (
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

  private static extractChatCompletionsUsage(usage: ChatCompletionsUsagePayload | undefined): LLMUsage | undefined {
    if (!usage) return undefined;
    return {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
      cachedPromptTokens: usage.prompt_tokens_details?.cached_tokens,
      cacheWritePromptTokens: usage.prompt_tokens_details?.cache_write_tokens,
    };
  }

  /**
   * Whether this model uses "developer" role instead of "system" in Chat Completions.
   * OpenAI GPT-5.x and o-series models use "developer" for system-level instructions.
   */
  private usesDeveloperRole(model: string): boolean {
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
        if (m.role === "tool") {
          return { role: "tool" as const, content: m.content, tool_call_id: m.tool_call_id };
        }
        if (m.role === "assistant" && m.tool_calls?.length) {
          return {
            role: "assistant" as const,
            content: m.content || null,
            tool_calls: m.tool_calls,
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
        return { role, content: m.content };
      });
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string, LLMUsage | void, unknown> {
    const configuredMaxTokens = this.applyMaxTokensCap(options.maxTokens ?? 4096);
    const contextFit = this.fitMessagesToContext(messages, { ...options, maxTokens: configuredMaxTokens });
    messages = contextFit.messages;
    this.logContextTrim(contextFit, options.model);
    const maxTokens = this.applyMaxTokensCap(contextFit.maxTokens ?? configuredMaxTokens);

    // Route to Responses API for models that require it
    if (this.useResponsesAPI(options.model)) {
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

    const effectiveStream = options.stream ?? true;

    const body: Record<string, unknown> = {
      model: options.model,
      messages: formatted,
      stream: effectiveStream,
      ...(options.stop?.length ? { stop: options.stop } : {}),
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
      if (options.frequencyPenalty) body.frequency_penalty = options.frequencyPenalty;
      if (options.presencePenalty) body.presence_penalty = options.presencePenalty;
    }

    this.applyChatCompletionsReasoning(body, options);

    // OpenRouter provider routing preference
    const openrouterProvider = this.resolveOpenrouterProvider(options.openrouterProvider);
    if (openrouterProvider && this.baseUrl.includes("openrouter.ai")) {
      body.provider = { order: [openrouterProvider] };
    }

    this.applyOpenRouterPromptCaching(body, options);

    // Force response format (e.g. JSON mode)
    if (options.responseFormat) {
      body.response_format = options.responseFormat;
    }

    logger.debug("[OpenAI chat()] stream=%s model=%s", body.stream, body.model);

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
      const json = (await response.json()) as {
        choices: Array<{ message: Record<string, unknown> & { content: string | unknown[] } }>;
        usage?: ChatCompletionsUsagePayload;
      };
      const msg = json.choices[0]?.message;
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

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") {
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
    if (this.useResponsesAPI(options.model)) {
      logger.debug(
        "[OpenAI] Routing chatComplete() to Responses API for model=%s onToken=%s",
        options.model,
        !!options.onToken,
      );
      return this.chatCompleteResponses(messages, { ...options, maxTokens });
    }

    const url = `${this.baseUrl}/chat/completions`;
    const reasoning = this.isReasoningModel(options.model);

    const useStream = options.stream ?? !!options.onToken;

    const formatted = this.formatMessages(messages, options.model);
    if (!formatted.some((m) => m.role !== "system" && m.role !== "developer")) {
      formatted.push({ role: "user", content: "Continue." });
    }

    const body: Record<string, unknown> = {
      model: options.model,
      messages: formatted,
      stream: useStream,
      ...(options.stop?.length ? { stop: options.stop } : {}),
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
      if (options.frequencyPenalty) body.frequency_penalty = options.frequencyPenalty;
      if (options.presencePenalty) body.presence_penalty = options.presencePenalty;
    }

    this.applyChatCompletionsReasoning(body, options);

    // OpenRouter provider routing preference
    const openrouterProvider = this.resolveOpenrouterProvider(options.openrouterProvider);
    if (openrouterProvider && this.baseUrl.includes("openrouter.ai")) {
      body.provider = { order: [openrouterProvider] };
    }

    this.applyOpenRouterPromptCaching(body, options);

    // Force response format (e.g. JSON mode)
    if (options.responseFormat) {
      body.response_format = options.responseFormat;
    }

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
      const json = (await response.json()) as {
        choices: Array<{
          message: Record<string, unknown> & {
            content: string | unknown[] | null;
            tool_calls?: LLMToolCall[];
          };
          finish_reason: string;
        }>;
        usage?: ChatCompletionsUsagePayload;
      };

      const choice = json.choices[0];
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
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
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

    return {
      content: content || null,
      toolCalls,
      finishReason: finishReason === "tool_calls" ? "tool_calls" : finishReason,
      usage: streamUsage,
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

    if (options.maxTokens) {
      body.max_output_tokens = options.maxTokens;
    }

    // o-series models never support temperature/topP; GPT-5.x only with effort=none
    if (!this.isNoTemperatureModel(options.model, options.reasoningEffort)) {
      if (options.temperature != null) body.temperature = options.temperature;
      const topP = OpenAIProvider.normalizeTopP(options.topP);
      if (topP != null) body.top_p = topP;
      if (options.frequencyPenalty) body.frequency_penalty = options.frequencyPenalty;
      if (options.presencePenalty) body.presence_penalty = options.presencePenalty;
    }

    this.applyResponsesReasoning(body, options);

    // GPT-5+ text verbosity control
    if (options.verbosity && options.model.toLowerCase().startsWith("gpt-5")) {
      body.text = { verbosity: options.verbosity };
    }

    const openrouterProvider = this.resolveOpenrouterProvider(options.openrouterProvider);
    if (openrouterProvider && this.baseUrl.includes("openrouter.ai")) {
      body.provider = { order: [openrouterProvider] };
    }

    if (options.tools?.length) {
      body.tools = this.formatResponsesTools(options.tools);
    }

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
    logger.debug("[OpenAI chatResponses] reasoning=%s onThinking=%s", JSON.stringify(body.reasoning ?? null), !!options.onThinking);

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
      const json = (await response.json()) as Record<string, unknown>;
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
        if (trimmed.startsWith("event: ")) {
          currentEvent = trimmed.slice(7);
          continue;
        }

        if (!trimmed.startsWith("data: ")) {
          if (trimmed === "") currentEvent = ""; // reset on blank line
          continue;
        }
        const data = trimmed.slice(6);

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
      const json = (await response.json()) as Record<string, unknown>;
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

        if (trimmed.startsWith("event: ")) {
          currentEvent = trimmed.slice(7);
          continue;
        }

        if (!trimmed.startsWith("data: ")) {
          if (trimmed === "") currentEvent = "";
          continue;
        }
        const data = trimmed.slice(6);

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
    const usage = json.usage as Record<string, number> | undefined;
    if (!usage) return undefined;
    return {
      promptTokens: usage.input_tokens ?? 0,
      completionTokens: usage.output_tokens ?? 0,
      totalTokens: usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
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
