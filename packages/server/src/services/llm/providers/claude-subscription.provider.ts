// ──────────────────────────────────────────────
// LLM Provider — Claude (Subscription via Claude Agent SDK)
// ──────────────────────────────────────────────
//
// Routes chat requests through the locally-installed Claude Agent SDK so the
// signed-in Pro / Max subscription is used for billing instead of an
// `sk-ant-*` API key. The SDK shells out to the Claude Code CLI (which must
// be installed on the host: `npm i -g @anthropic-ai/claude-code` followed by
// `claude login`). When `apiKey` is supplied on the connection, it is
// forwarded as `ANTHROPIC_API_KEY` and the SDK falls back to API billing —
// useful as a safety net if subscription auth is unavailable.
//
// This provider only supports text chat — built-in agent tools (Bash, Read,
// Write, etc.) are explicitly disabled because Marinara drives its own
// agent/tool layer.
//
// References:
//   • Subscription terms: Anthropic permits Claude Code / Agent SDK usage on
//     the user's own machine under their Pro / Max subscription. This is the
//     same mechanism Zed and other IDE integrations use.
//   • SDK docs: https://docs.anthropic.com/en/docs/claude-code/sdk
//
import { BaseLLMProvider, type ChatMessage, type ChatOptions, type LLMUsage } from "../base-provider.js";
import { logger } from "../../../lib/logger.js";

/**
 * Lazy import wrapper. The SDK is heavy and pulls in optional native pieces;
 * keeping the import inside `chat()` avoids loading it for the (common) case
 * where no `claude_subscription` connection has been used yet.
 */
type SdkModule = typeof import("@anthropic-ai/claude-agent-sdk");
let cachedSdk: Promise<SdkModule> | null = null;
function loadSdk(): Promise<SdkModule> {
  if (!cachedSdk) {
    cachedSdk = import("@anthropic-ai/claude-agent-sdk").catch((err) => {
      cachedSdk = null;
      throw new Error(
        `Failed to load @anthropic-ai/claude-agent-sdk. Install Claude Code on this host (npm i -g @anthropic-ai/claude-code) and run \`claude login\` once. Underlying error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }
  return cachedSdk;
}

/** @internal Test-only seam. Replaces the cached SDK module with a fake or clears it. */
export function __setSdkForTesting(mod: Pick<SdkModule, "query"> | null): void {
  cachedSdk = mod ? (Promise.resolve(mod as SdkModule) as Promise<SdkModule>) : null;
}

/**
 * Render the chat history into the single-string `prompt` form the Agent SDK
 * accepts. We extract system messages so they can be passed through the
 * dedicated `systemPrompt` option (preserving system/user separation), then
 * fold the rest of the conversation into a labelled transcript so the model
 * sees prior turns even though the SDK is one-shot per call.
 */
function renderTranscript(messages: ChatMessage[]): { systemPrompt: string | undefined; prompt: string } {
  const systemBlocks: string[] = [];
  const turns: string[] = [];

  for (const message of messages) {
    const text = message.content?.trim();
    if (!text) continue;
    if (message.role === "system") {
      systemBlocks.push(text);
      continue;
    }
    const label = message.role === "user" ? "User" : "Assistant";
    turns.push(`${label}: ${text}`);
  }

  // Claude Agent SDK requires a non-empty prompt; if the caller only supplied
  // system content (rare but possible during connection-test pings), inject a
  // minimal user turn so the SDK accepts the request.
  if (turns.length === 0) turns.push("User: [Start]");

  return {
    systemPrompt: systemBlocks.length ? systemBlocks.join("\n\n") : undefined,
    prompt: turns.join("\n\n"),
  };
}

/**
 * Provider that uses the local Claude Agent SDK for billing-via-subscription.
 *
 * `baseUrl` is ignored (the SDK manages the endpoint). `apiKey`, when set, is
 * forwarded to the spawned Claude Code process as `ANTHROPIC_API_KEY` so the
 * connection can opt into API billing instead of subscription billing.
 */
export class ClaudeSubscriptionProvider extends BaseLLMProvider {
  constructor(
    baseUrl: string,
    apiKey: string,
    defaultMaxContext?: number,
    defaultOpenrouterProvider?: string | null,
    maxTokensOverride?: number | null,
    /**
     * Connection-level fast-mode preference. When `true`, the SDK is asked to
     * route the request through its faster (and quality-degraded) path. When
     * `false`, fast mode is explicitly forced off so a persisted CLI setting
     * can't downgrade Marinara queries silently.
     */
    private readonly fastMode: boolean = false,
  ) {
    super(baseUrl, apiKey, defaultMaxContext, defaultOpenrouterProvider, maxTokensOverride);
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string, LLMUsage | void, unknown> {
    const configuredMaxTokens = options.maxTokens ?? 4096;
    const contextFit = this.fitMessagesToContext(messages, { ...options, maxTokens: configuredMaxTokens });
    this.logContextTrim(contextFit, options.model);

    const { systemPrompt, prompt } = renderTranscript(contextFit.messages);

    const { query } = await loadSdk();

    const abortController = new AbortController();
    const onUpstreamAbort = () => abortController.abort();
    if (options.signal) {
      if (options.signal.aborted) {
        abortController.abort();
      } else {
        options.signal.addEventListener("abort", onUpstreamAbort, { once: true });
      }
    }

    // Opus 4.7+ is adaptive-only (sampling parameters rejected); other models
    // accept temperature etc. but the Agent SDK doesn't expose those knobs
    // directly, so we skip them and rely on the SDK defaults.
    const modelLower = options.model.toLowerCase();
    const isAdaptiveOnly = /claude-opus-4-(?:[7-9]|\d{2,})/.test(modelLower);

    // The SDK strips the model's version awareness if we pass a plain string
    // `systemPrompt`. Without the Claude Code preset every model — Opus, Sonnet,
    // Haiku — falsely answers "Sonnet" when asked which it is, because it has
    // no framing for its own identity and falls back to the most-mentioned
    // variant in its training data. Wrapping the caller's system content as
    // the `append` of the `claude_code` preset preserves identity *and* the
    // user's framing (character card / preset). This matches the `claude` CLI
    // default and is what the SillyTavern subscription bridge uses too.
    const presetSystemPrompt: NonNullable<Parameters<SdkModule["query"]>[0]["options"]>["systemPrompt"] = systemPrompt
      ? { type: "preset", preset: "claude_code", append: systemPrompt }
      : { type: "preset", preset: "claude_code" };

    const sdkOptions: Parameters<SdkModule["query"]>[0]["options"] = {
      abortController,
      model: options.model,
      systemPrompt: presetSystemPrompt,
      includePartialMessages: options.stream ?? true,
      // Disable agent tooling — Marinara has its own tool/agent pipeline and
      // we only want plain text completions out of this provider. With tools
      // empty, no agentic loop runs, so we leave maxTurns unset; setting it
      // to 1 caused the SDK to bail with `error_max_turns` because thinking
      // and other internal steps consume turn budget alongside the assistant
      // response.
      tools: [],
      permissionMode: "bypassPermissions",
      // Always pass `settings.fastMode` explicitly so the SDK can't fall back
      // on a persisted CLI value that would silently downgrade the model. The
      // value comes from the connection-level toggle — default `false` so
      // unconfigured connections keep the requested model.
      settings: { fastMode: this.fastMode },
    };

    if (options.enableThinking) {
      sdkOptions.thinking = { type: "adaptive" };
      // EffortLevel covers low|medium|high|xhigh|max; reasoningEffort matches
      // four of those, so a runtime cast is safe.
      sdkOptions.effort = (options.reasoningEffort ?? "high") as "low" | "medium" | "high" | "xhigh";
    } else if (isAdaptiveOnly) {
      // Opus 4.7 always thinks; let the SDK pick a default effort.
      sdkOptions.thinking = { type: "adaptive" };
    }

    if (this.apiKey) {
      // Opt-in API fallback — overrides subscription auth when the connection
      // has an explicit API key set.
      sdkOptions.env = { ...process.env, ANTHROPIC_API_KEY: this.apiKey };
    }

    this.applyCustomParameters(sdkOptions as Record<string, unknown>, options);

    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let cacheWriteTokens = 0;

    try {
      const queryHandle = query({ prompt, options: sdkOptions });

      for await (const message of queryHandle) {
        if (message.type === "stream_event") {
          const event = message.event as {
            type: string;
            delta?: { type: string; text?: string; thinking?: string };
          };
          if (event.type === "content_block_delta" && event.delta) {
            if (event.delta.type === "text_delta" && event.delta.text) {
              yield event.delta.text;
            } else if (event.delta.type === "thinking_delta" && event.delta.thinking && options.onThinking) {
              options.onThinking(event.delta.thinking);
            }
          }
        } else if (message.type === "assistant" && !(options.stream ?? true)) {
          // Non-streaming path: the SDK still yields the full assistant
          // message at the end; emit the text blocks once.
          const blocks = (message.message?.content ?? []) as Array<{ type: string; text?: string; thinking?: string }>;
          for (const block of blocks) {
            if (block.type === "text" && block.text) {
              yield block.text;
            } else if (block.type === "thinking" && block.thinking && options.onThinking) {
              options.onThinking(block.thinking);
            }
          }
        } else if (message.type === "result") {
          if (message.subtype === "success") {
            const usage = message.usage ?? null;
            if (usage) {
              inputTokens = usage.input_tokens ?? 0;
              outputTokens = usage.output_tokens ?? 0;
              cachedTokens = usage.cache_read_input_tokens ?? 0;
              cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
            }
            // The SDK can bill against a different model than the one we
            // asked for (fast mode, post-rate-limit cooldown, account-tier
            // gating). `modelUsage` is keyed by the model that actually ran,
            // so any key that isn't our requested ID is a silent downgrade
            // worth surfacing.
            const usedModels = Object.keys(message.modelUsage ?? {});
            const fastModeState = message.fast_mode_state;
            const billedDifferent = usedModels.length > 0 && !usedModels.includes(options.model);
            if (billedDifferent) {
              logger.warn(
                "[claude-subscription] Requested %s but SDK billed against %s (fast_mode_state=%s) — check `claude` CLI fast mode / rate-limit cooldown",
                options.model,
                usedModels.join(", "),
                fastModeState ?? "unknown",
              );
            } else if (fastModeState && fastModeState !== "off") {
              logger.warn(
                "[claude-subscription] fast_mode_state=%s for %s — output may come from a smaller model than requested",
                fastModeState,
                options.model,
              );
            }
          } else {
            const detail = message.errors?.length ? ` — ${message.errors.join("; ")}` : "";
            throw new Error(`Claude (Subscription) request failed (${message.subtype})${detail}`);
          }
        }
      }
    } catch (err) {
      logger.error(err, "Claude Agent SDK query failed for model %s", options.model);
      const friendly = err instanceof Error ? err.message : String(err);
      throw new Error(`Claude (Subscription) request failed: ${friendly}`);
    } finally {
      if (options.signal) options.signal.removeEventListener("abort", onUpstreamAbort);
    }

    if (inputTokens || outputTokens) {
      return {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
        ...(cachedTokens ? { cachedPromptTokens: cachedTokens } : {}),
        ...(cacheWriteTokens ? { cacheWritePromptTokens: cacheWriteTokens } : {}),
      };
    }
  }

  /**
   * Embeddings are not exposed by the Claude Agent SDK. Surface a clear error
   * so callers can route embedding work to a separate connection.
   */
  override async embed(_texts: string[], _model: string): Promise<number[][]> {
    throw new Error(
      "The Claude (Subscription) provider does not support embeddings. Configure a separate embedding connection (OpenAI, Google, or local).",
    );
  }
}
