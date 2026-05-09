// ──────────────────────────────────────────────
// LLM Provider — Google Gemini
// ──────────────────────────────────────────────
import {
  BaseLLMProvider,
  llmFetch,
  sanitizeApiError,
  type ChatMessage,
  type ChatOptions,
  type LLMUsage,
} from "../base-provider.js";

/** A single Gemini response part (text, thought summary, or signature-only). */
interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
}

/**
 * Handles Google Gemini API (generateContent / streamGenerateContent).
 */
export class GoogleProvider extends BaseLLMProvider {
  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string, LLMUsage | void, unknown> {
    const configuredMaxTokens = options.maxTokens ?? 4096;
    const contextFit = this.fitMessagesToContext(messages, { ...options, maxTokens: configuredMaxTokens });
    messages = contextFit.messages;
    this.logContextTrim(contextFit, options.model || "gemini-2.0-flash");
    const maxTokens = contextFit.maxTokens ?? configuredMaxTokens;

    const model = options.model || "gemini-2.0-flash";

    // Gemini 3.x models use thinkingLevel; Gemini 2.5 uses thinkingBudget
    const isGemini3 = /gemini-3/i.test(model);

    // Only models that actually support thinking should get thinkingConfig:
    // Gemini 3.x, 2.5-flash/pro, and 2.0-flash-thinking.
    const supportsThinking = isGemini3 || /gemini-2\.5|gemini-2\.0-flash-thinking/i.test(model);

    let thinkingConfig: Record<string, unknown> | undefined;
    if (supportsThinking && (options.enableThinking || options.reasoningEffort)) {
      if (isGemini3) {
        const levelMap = { low: "low", medium: "medium", high: "high", xhigh: "high" } as const;
        thinkingConfig = {
          thinkingLevel: options.reasoningEffort ? levelMap[options.reasoningEffort] : "high",
          includeThoughts: true,
        };
      } else {
        const budgetMap = { low: 1024, medium: 8192, high: 24576, xhigh: 24576 } as const;
        thinkingConfig = {
          thinkingBudget: options.reasoningEffort ? budgetMap[options.reasoningEffort] : 8192,
          includeThoughts: true,
        };
      }
    }

    // Ensure the base URL includes the /v1beta path segment required by the Gemini API.
    // Proxies like api.linkapi.ai need this appended (SillyTavern does it automatically).
    let base = this.baseUrl.replace(/\/+$/, "");
    if (!/\/v\d/.test(base)) base += "/v1beta";

    // When thinking is enabled, force non-streaming (generateContent) because
    // proxies like linkapi.ai strip thought parts from SSE streams but return
    // them in non-streaming responses. Text is still yielded so SSE works.
    const useStreaming = options.stream && !thinkingConfig;
    const endpoint = useStreaming ? "streamGenerateContent" : "generateContent";
    const url = `${base}/models/${model}:${endpoint}${useStreaming ? "?alt=sse" : ""}`;

    // Convert to Gemini format — filter out empty-content messages
    const systemMessages = messages.filter((m) => m.role === "system" && m.content?.trim());
    const chatMessages = messages.filter((m) => m.role !== "system" && m.content?.trim());

    const contents = chatMessages.map((m) => {
      // If this model message has stored Gemini parts (with thought signatures),
      // use them directly to preserve reasoning state across turns.
      if (m.role === "assistant" && m.providerMetadata?.geminiParts) {
        const storedParts = m.providerMetadata.geminiParts as GeminiPart[];
        return { role: "model" as const, parts: storedParts };
      }

      const parts: Array<Record<string, unknown>> = [];
      if (m.images?.length) {
        for (const img of m.images) {
          const match = img.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
          }
        }
      }
      parts.push({ text: m.content });
      return {
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts,
      };
    });

    // Gemini requires at least one entry in contents — if all non-system messages
    // were empty (e.g. preset with only comments), fall back to a minimal user turn
    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: "Continue." }] });
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 1,
        maxOutputTokens: maxTokens,
        topP: options.topP ?? 1,
        ...(options.topK ? { topK: options.topK } : {}),
        ...(options.frequencyPenalty ? { frequencyPenalty: options.frequencyPenalty } : {}),
        ...(options.presencePenalty ? { presencePenalty: options.presencePenalty } : {}),
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    };

    if (systemMessages.length > 0) {
      body.systemInstruction = {
        parts: [{ text: systemMessages.map((m) => m.content).join("\n\n") }],
      };
    }

    this.applyCustomParameters(body, options);

    const response = await llmFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${sanitizeApiError(errorText)}`);
    }

    // ── Non-streaming path (also used when thinking is enabled) ──
    if (!useStreaming) {
      const json = (await response.json()) as {
        candidates?: Array<{
          content: { parts: GeminiPart[] };
        }>;
        usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
      };
      const parts = json.candidates?.[0]?.content?.parts ?? [];

      // Report full parts (with thought signatures) for storage
      if (options.onResponseParts) options.onResponseParts(parts);

      for (const part of parts) {
        if (part.thought && part.text && options.onThinking) {
          options.onThinking(part.text);
        } else if (part.text && !part.thought) {
          yield part.text;
        }
      }
      if (json.usageMetadata) {
        return {
          promptTokens: json.usageMetadata.promptTokenCount,
          completionTokens: json.usageMetadata.candidatesTokenCount,
          totalTokens: json.usageMetadata.totalTokenCount,
        };
      }
      return;
    }

    // ── SSE streaming path (no thinking) ──
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
    let streamUsage: LLMUsage | undefined;

    // Accumulators for reconstructing response parts
    let thoughtText = "";
    let responseText = "";
    let lastSignature: string | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);

          try {
            const parsed = JSON.parse(data);
            if (parsed.usageMetadata) {
              streamUsage = {
                promptTokens: parsed.usageMetadata.promptTokenCount,
                completionTokens: parsed.usageMetadata.candidatesTokenCount,
                totalTokens: parsed.usageMetadata.totalTokenCount,
              };
            }
            const parts: GeminiPart[] = parsed.candidates?.[0]?.content?.parts ?? [];
            for (const part of parts) {
              // Capture thought signature from any part
              if (part.thoughtSignature) lastSignature = part.thoughtSignature;

              if (part.thought && part.text) {
                // Thought summary part
                thoughtText += part.text;
                if (options.onThinking) options.onThinking(part.text);
              } else if (part.text && !part.thought) {
                // Regular text part
                responseText += part.text;
                yield part.text;
              }
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } finally {
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
    }

    // Reconstruct the canonical parts array for storage (thought signatures + summaries)
    if (options.onResponseParts) {
      const responseParts: GeminiPart[] = [];
      if (thoughtText) responseParts.push({ text: thoughtText, thought: true });
      const textPart: GeminiPart = { text: responseText };
      if (lastSignature) textPart.thoughtSignature = lastSignature;
      responseParts.push(textPart);
      options.onResponseParts(responseParts);
    }

    if (streamUsage) return streamUsage;
  }
}
