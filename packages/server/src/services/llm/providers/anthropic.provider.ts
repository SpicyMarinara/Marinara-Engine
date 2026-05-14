// ──────────────────────────────────────────────
// LLM Provider — Anthropic Claude
// ──────────────────────────────────────────────
import {
  BaseLLMProvider,
  llmFetch,
  sanitizeApiError,
  type ChatMessage,
  type ChatOptions,
  type LLMUsage,
} from "../base-provider.js";

const DEFAULT_CACHING_AT_DEPTH = 5;

function normalizeCachingAtDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return DEFAULT_CACHING_AT_DEPTH;
  return Math.floor(value);
}

function resolveCacheControlMessageIndex(messages: ChatMessage[], cachingAtDepth: number): number {
  if (messages.length === 0) return -1;
  return Math.max(0, messages.length - 1 - cachingAtDepth);
}

/**
 * Handles Anthropic Claude API (Messages API).
 */
export class AnthropicProvider extends BaseLLMProvider {
  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string, LLMUsage | void, unknown> {
    const configuredMaxTokens = options.maxTokens ?? 4096;
    const contextFit = this.fitMessagesToContext(messages, { ...options, maxTokens: configuredMaxTokens });
    messages = contextFit.messages;
    this.logContextTrim(contextFit, options.model);
    const maxTokens = contextFit.maxTokens ?? configuredMaxTokens;

    const url = `${this.baseUrl}/messages`;

    // Claude requires system prompt separate from messages — filter out empty-content messages
    const systemMessages = messages.filter((m) => m.role === "system" && m.content?.trim());
    const chatMessages = messages.filter((m) => m.role !== "system" && m.content?.trim());

    // Ensure alternating user/assistant pattern (Claude requirement)
    const mergedMessages = this.mergeConsecutiveMessages(chatMessages);

    const enableCaching = options.enableCaching ?? false;
    const cachingAtDepth = normalizeCachingAtDepth(options.cachingAtDepth);

    // Build system field — use content blocks with cache_control when caching is on
    let systemField: string | Array<{ type: string; text: string; cache_control?: { type: string } }> | undefined;
    if (systemMessages.length > 0) {
      if (enableCaching) {
        // Array of content blocks with cache_control on the last one
        const blocks = systemMessages.map((m, i) => ({
          type: "text" as const,
          text: m.content,
          ...(i === systemMessages.length - 1 && { cache_control: { type: "ephemeral" } }),
        }));
        systemField = blocks;
      } else {
        systemField = systemMessages.map((m) => m.content).join("\n\n");
      }
    }

    const cacheControlMessageIndex = enableCaching
      ? resolveCacheControlMessageIndex(mergedMessages, cachingAtDepth)
      : -1;

    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: maxTokens,
      ...(systemField !== undefined && { system: systemField }),
      messages: mergedMessages.map((m, i) => {
        // Build content parts (text + optional images)
        const parts: Array<Record<string, unknown>> = [];
        if (m.images?.length) {
          for (const img of m.images) {
            const match = img.match(/^data:(image\/[^;]+);base64,(.+)$/);
            if (match) {
              parts.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
            }
          }
        }
        if (m.content) {
          const textBlock: Record<string, unknown> = { type: "text", text: m.content };
          if (i === cacheControlMessageIndex) textBlock.cache_control = { type: "ephemeral" };
          parts.push(textBlock);
        }
        // Use content array if we have images or cache control, otherwise string
        if (m.images?.length || i === cacheControlMessageIndex) {
          return { role: m.role, content: parts };
        }
        return { role: m.role, content: m.content };
      }),
      stream: options.stream ?? true,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.topK ? { top_k: options.topK } : {}),
    };

    // Opus 4.7+: sampling parameters are forbidden (400 error).
    // Strip temperature, top_k, top_p regardless of thinking mode.
    const modelLower = options.model.toLowerCase();
    const isAdaptiveOnly = /claude-opus-4-(?:[7-9]|\d{2,})/.test(modelLower);
    if (isAdaptiveOnly) {
      delete body.temperature;
      delete body.top_k;
      delete body.top_p;
    }

    // Enable extended thinking for reasoning models
    if (options.enableThinking) {
      if (isAdaptiveOnly) {
        // Opus 4.7+: adaptive thinking (budget_tokens removed).
        // display defaults to "omitted" on 4.7 — set "summarized" when
        // the caller wants to surface thinking content to the user.
        const thinking: Record<string, unknown> = { type: "adaptive" };
        if (options.onThinking) {
          thinking.display = "summarized";
        }
        body.thinking = thinking;
        body.output_config = { effort: options.reasoningEffort ?? "high" };
      } else {
        // Opus 4.6 / Sonnet 4.6: prefer adaptive thinking (budget_tokens deprecated).
        const supportsAdaptive = /claude-(opus|sonnet)-4-[56]/.test(modelLower);
        if (supportsAdaptive) {
          body.thinking = { type: "adaptive" };
          body.output_config = { effort: options.reasoningEffort ?? "high" };
          // Cannot use temperature with extended thinking
          delete body.temperature;
        } else {
          const budgetTokens = Math.max(1024, Math.min(maxTokens, 16000));
          body.thinking = { type: "enabled", budget_tokens: budgetTokens };
          // Anthropic requires max_tokens to be > budget_tokens
          body.max_tokens = maxTokens + budgetTokens;
          // Cannot use temperature with extended thinking
          delete body.temperature;
        }
      }
    }

    this.applyCustomParameters(body, options);

    const response = await llmFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      bufferResponse: options.stream === false,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${sanitizeApiError(errorText)}`);
    }

    if (!options.stream) {
      const json = (await response.json()) as {
        content: Array<{ type: string; text?: string; thinking?: string }>;
        usage?: { input_tokens: number; output_tokens: number };
      };
      // Extract thinking content if present
      const thinkingBlock = json.content.find((c) => c.type === "thinking");
      if (thinkingBlock?.thinking && options.onThinking) {
        options.onThinking(thinkingBlock.thinking);
      }
      yield json.content.find((c) => c.type === "text")?.text ?? "";
      if (json.usage) {
        return {
          promptTokens: json.usage.input_tokens,
          completionTokens: json.usage.output_tokens,
          totalTokens: json.usage.input_tokens + json.usage.output_tokens,
        };
      }
      return;
    }

    // Stream SSE
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

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
    let currentBlockType = "text"; // track whether we're in a thinking or text block
    let inputTokens = 0;
    let outputTokens = 0;

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

          try {
            const event = JSON.parse(data) as {
              type: string;
              message?: { usage?: { input_tokens: number; output_tokens: number } };
              content_block?: { type: string };
              delta?: { type: string; text?: string; thinking?: string };
              usage?: { output_tokens: number };
            };
            // Capture input token count from message_start
            if (event.type === "message_start" && event.message?.usage) {
              inputTokens = event.message.usage.input_tokens;
              outputTokens = event.message.usage.output_tokens;
            }
            // Capture final output token count from message_delta
            if (event.type === "message_delta" && event.usage) {
              outputTokens = event.usage.output_tokens;
            }
            // Track block type (thinking vs text)
            if (event.type === "content_block_start" && event.content_block) {
              currentBlockType = event.content_block.type;
            }
            if (event.type === "content_block_delta") {
              if (currentBlockType === "thinking" && event.delta?.thinking && options.onThinking) {
                options.onThinking(event.delta.thinking);
              } else if (event.delta?.text) {
                yield event.delta.text;
              }
            }
            if (event.type === "message_stop") {
              if (inputTokens || outputTokens) {
                return {
                  promptTokens: inputTokens,
                  completionTokens: outputTokens,
                  totalTokens: inputTokens + outputTokens,
                };
              }
              return;
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } finally {
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
    }
    if (inputTokens || outputTokens) {
      return { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens };
    }
  }

  /**
   * Merge consecutive same-role messages (Claude requires alternation).
   */
  private mergeConsecutiveMessages(messages: ChatMessage[]): ChatMessage[] {
    const merged: ChatMessage[] = [];
    for (const msg of messages) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role) {
        last.content += "\n\n" + msg.content;
      } else {
        merged.push({ ...msg });
      }
    }
    // Claude requires at least one message; ensure it starts with a user turn
    if (merged.length === 0) {
      merged.push({ role: "user", content: "[Start]" });
    } else if (merged[0]!.role !== "user") {
      merged.unshift({ role: "user", content: "[Start]" });
    }
    return merged;
  }
}
