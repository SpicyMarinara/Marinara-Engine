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
import { isClaudeSubscriptionResumeEnabled } from "../../../config/runtime-config.js";
import {
  currentToSdkUserMessage,
  SDK_VERSION,
  splitHistoryForResume,
  type SdkUserMessageForPrompt,
} from "./claude-subscription/jsonl-entries.js";
import {
  cleanupSessionFile,
  constructSessionFile,
} from "./claude-subscription/synthetic-session.js";

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

// ──────────────────────────────────────────────
// Resume-path mode tracking (module-scoped, not per-instance)
// ──────────────────────────────────────────────
//
// `useResume` is decided lazily per request because (a) env-var changes pick
// up automatically on next request, and (b) a temp-write failure (EACCES /
// EPERM / ENOENT on the user's `~/.claude/projects/`) demotes the provider
// to the fold path for a cool-down window without losing the next request.
//
// Provider instances are typically constructed per connection / per request,
// so caching this on `this` would amount to no caching at all on the success
// path and a noisy warn on each instance on the failure path. Module scope
// gives one warn per cooldown across all instances.

const RESUME_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
let resumeDisabledUntil = 0;
let resumeDisabledReason: string | null = null;

// Errno codes that mean "we couldn't write the session file because of the
// filesystem, not because of a bug" — the right response is to demote to the
// fold path and try again later. EACCES / EPERM / EROFS cover the common
// sandboxed-deployment cases (read-only homedir, wrong user, etc.). ENOENT
// is here as defense-in-depth: `constructSessionFile` calls mkdir-recursive
// first, but a race (someone deletes the directory between mkdir and
// writeFile) or a malformed CLAUDE_CONFIG_DIR pointing past a missing
// ancestor would still surface as ENOENT and should demote, not crash.
function isWriteFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "EACCES" || code === "EPERM" || code === "ENOENT" || code === "EROFS";
}

function markResumeUnavailable(reason: string, err: unknown): void {
  resumeDisabledUntil = Date.now() + RESUME_FAILURE_COOLDOWN_MS;
  resumeDisabledReason = reason;
  logger.warn(
    err,
    "[claude-subscription] resume path unavailable (%s); falling back to transcript fold for ~5min",
    reason,
  );
}

/**
 * Wrap a single SDK-shaped user message in an AsyncIterable suitable for the
 * SDK's `prompt: AsyncIterable<SDKUserMessage>` form. We yield once and
 * return — the SDK consumes one message and proceeds to generation.
 *
 * The `unknown` cast on the yielded value is because `SdkUserMessageForPrompt`
 * is declared locally (in `jsonl-entries.ts`, kept SDK-free); structurally it
 * matches the SDK's `SDKUserMessage` shape for the fields we set. The cast
 * happens at the `query()` call site where the SDK type narrows it.
 */
async function* singleMessageIterable(msg: SdkUserMessageForPrompt): AsyncIterable<unknown> {
  yield msg;
}

function shouldUseResume(): boolean {
  if (!isClaudeSubscriptionResumeEnabled()) return false;
  if (process.platform === "win32") return false;
  // `resumeDisabledUntil === 0` means we've never tripped a cooldown — fall
  // through to the happy path. A non-zero value means a prior failure put
  // us in cooldown; either we're still inside the window (return false) or
  // we've come out the other side and should reset before continuing.
  if (resumeDisabledUntil > 0) {
    if (resumeDisabledUntil > Date.now()) return false;
    logger.info(
      "[claude-subscription] resume cooldown expired (last reason: %s); re-attempting resume path",
      resumeDisabledReason ?? "unknown",
    );
    resumeDisabledUntil = 0;
    resumeDisabledReason = null;
  }
  return true;
}

/**
 * Extract system-role messages into a single concatenated string for the
 * SDK's `systemPrompt` option, used by both the fold path and the resume
 * path. System messages never ride in the JSONL.
 */
function extractSystemPrompt(messages: ChatMessage[]): string | undefined {
  const blocks: string[] = [];
  for (const m of messages) {
    if (m.role !== "system") continue;
    const text = m.content?.trim();
    if (text) blocks.push(text);
  }
  return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

/**
 * Render the chat history into the single-string `prompt` form the Agent SDK
 * accepts. We extract system messages so they can be passed through the
 * dedicated `systemPrompt` option (preserving system/user separation), then
 * fold the rest of the conversation into a labelled transcript so the model
 * sees prior turns even though the SDK is one-shot per call.
 *
 * Used by the fold path (legacy / fallback). The resume path uses
 * `splitHistoryForResume` + synthetic JSONL session instead.
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
 * The set of values the SDK call needs from the path-selection step. Pulled
 * out so `chat()` reads as a straight line — pick a path, build options,
 * call the SDK — instead of carrying five `let` declarations and a
 * definite-assignment assertion across a 30-line branch.
 *
 * `sessionPath` is the cleanup handle for the `finally` block: non-null only
 * when the resume path actually wrote a JSONL (history > 0). The
 * empty-history resume sub-path uses the AsyncIterable prompt directly with
 * no file to clean up.
 */
interface PromptSelection {
  promptArg: string | AsyncIterable<unknown>;
  systemPrompt: string | undefined;
  sessionPath: string | null;
  resumeSessionId: string | null;
  resumeCwd: string | null;
}

/**
 * Pick the resume path or the fold path for this request, and produce
 * everything the SDK call needs. Resolved per-call so env-var changes and
 * cool-down expiries take effect on the next request without restart.
 */
async function selectPromptPath(messages: ChatMessage[], model: string): Promise<PromptSelection> {
  if (shouldUseResume()) {
    try {
      return await buildResumeSelection(messages, model);
    } catch (err) {
      if (isWriteFailure(err)) {
        markResumeUnavailable("session-file write failed", err);
      } else {
        // Non-FS errors (SDK regressions, programming mistakes, unexpected
        // failures from `splitHistoryForResume` or its helpers) propagate
        // intentionally. Silently demoting on every error would mask bugs
        // that need to surface as failed requests so they get noticed.
        throw err;
      }
    }
  }
  return buildFoldSelection(messages);
}

async function buildResumeSelection(messages: ChatMessage[], model: string): Promise<PromptSelection> {
  const split = splitHistoryForResume(messages);
  const systemPrompt = extractSystemPrompt(messages);

  if (split.history.length === 0) {
    // Writing an empty JSONL would make the SDK throw "No conversation found
    // with session ID: ..." — its session loader treats `messages.length ===
    // 0` as a missing session, not as a valid zero-turn resume. So when the
    // caller's history has nothing to resume from (single-turn requests,
    // connection pings, system-only context), skip the file write entirely
    // and send the current turn straight through the AsyncIterable prompt.
    // Nothing to clean up afterward.
    logger.debug(
      "[claude-subscription] resume path: shape=%s history=empty (direct prompt, no resume)",
      split.shape,
    );
    return {
      promptArg: singleMessageIterable(currentToSdkUserMessage(split.current)),
      systemPrompt,
      sessionPath: null,
      resumeSessionId: null,
      resumeCwd: null,
    };
  }

  const cwd = process.cwd();
  const { sessionId, path } = await constructSessionFile(split.history, {
    model,
    cwd,
    sdkVersion: SDK_VERSION,
  });
  logger.debug(
    "[claude-subscription] resume path: shape=%s sessionId=%s path=%s historyLen=%d",
    split.shape,
    sessionId,
    path,
    split.history.length,
  );
  return {
    promptArg: singleMessageIterable(currentToSdkUserMessage(split.current)),
    systemPrompt,
    sessionPath: path,
    resumeSessionId: sessionId,
    resumeCwd: cwd,
  };
}

function buildFoldSelection(messages: ChatMessage[]): PromptSelection {
  // Fold path (legacy / fallback). Unchanged from the pre-resume implementation.
  const folded = renderTranscript(messages);
  return {
    promptArg: folded.prompt,
    systemPrompt: folded.systemPrompt,
    sessionPath: null,
    resumeSessionId: null,
    resumeCwd: null,
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

    const { promptArg, systemPrompt, sessionPath, resumeSessionId, resumeCwd } = await selectPromptPath(
      contextFit.messages,
      options.model,
    );

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

    // Outbound-context strip strategy: this provider is a text-chat surface
    // (roleplay / character DM), not an agent runner. The SDK's default
    // posture leaks several things the user never asked for into every
    // request, so we override each one explicitly:
    //
    //   • Use a plain-string `systemPrompt` (the caller's content as-is)
    //     instead of wrapping it under the `claude_code` preset. The preset
    //     injects ~thousands of tokens of Claude-Code-agent framing
    //     ("You are Claude Code, Anthropic's CLI...") which is wrong for
    //     a character-chat. Side effect: when asked "which model are you?"
    //     the model may fall back to its training-data prior (typically
    //     "Sonnet") instead of self-identifying accurately — acceptable for
    //     this provider's use case since the user-supplied persona prompt
    //     dominates identity.
    //   • `settingSources: []` — prevents the SDK from auto-loading
    //     `~/.claude/settings.json` + the project's `CLAUDE.md` + any
    //     workspace `.claude/settings.json` into the request context.
    //   • `skills: []` — prevents auto-load of skill metadata (~3000 tokens
    //     of installed-skill descriptions, hooks, etc.).
    //   • `allowDangerouslySkipPermissions: true` — explicit; matches the
    //     `permissionMode: "bypassPermissions"` intent and skips additional
    //     permission resolution framing.
    //   • `maxTurns: 1` — single assistant turn per call; we drive any
    //     multi-turn agent loop ourselves at the route layer.
    //
    // Wire-level artifacts the SDK still injects (`<system-reminder>`
    // userEmail/currentDate, metadata account/device UUIDs, the SDK
    // preamble system block) need a loopback passthrough to strip; that's
    // tracked as future work.

    const sdkOptions: Parameters<SdkModule["query"]>[0]["options"] = {
      abortController,
      model: options.model,
      includePartialMessages: options.stream ?? true,
      tools: [],
      skills: [],
      maxTurns: 1,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      // Always pass `settings.fastMode` explicitly so the SDK can't fall back
      // on a persisted CLI value that would silently downgrade the model. The
      // value comes from the connection-level toggle — default `false` so
      // unconfigured connections keep the requested model.
      settings: { fastMode: this.fastMode },
    };
    if (systemPrompt !== undefined) sdkOptions.systemPrompt = systemPrompt;

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

    // Resume + cwd are RESERVED keys: they're load-bearing for the resume
    // path's contract (the SDK must read JSONL from a path derived from cwd
    // and resume the session by ID). A connection's customParameters with a
    // stray `resume` or `cwd` would otherwise silently break the wiring.
    // Write them AFTER applyCustomParameters so they always win.
    if (resumeSessionId && resumeCwd) {
      (sdkOptions as Record<string, unknown>)["resume"] = resumeSessionId;
      (sdkOptions as Record<string, unknown>)["cwd"] = resumeCwd;
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let cacheWriteTokens = 0;
    let emittedText = false;
    let sawSuccessResult = false;
    let finalFastModeState: string | null = null;
    let finalUsedModels: string[] = [];

    try {
      // Cast on `prompt` is needed because we type `promptArg` locally as
      // `string | AsyncIterable<unknown>` (the AsyncIterable element type is
      // declared in jsonl-entries.ts to keep that module SDK-free). The SDK's
      // own type narrows it correctly at runtime.
      const queryHandle = query({
        prompt: promptArg as Parameters<SdkModule["query"]>[0]["prompt"],
        options: sdkOptions,
      });

      for await (const message of queryHandle) {
        if (message.type === "stream_event") {
          const event = message.event as {
            type: string;
            delta?: { type: string; text?: string; thinking?: string };
          };
          if (event.type === "content_block_delta" && event.delta) {
            if (event.delta.type === "text_delta" && event.delta.text) {
              yield event.delta.text;
              emittedText = true;
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
              emittedText = true;
            } else if (block.type === "thinking" && block.thinking && options.onThinking) {
              options.onThinking(block.thinking);
            }
          }
        } else if (message.type === "result") {
          if (message.subtype === "success") {
            sawSuccessResult = true;
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
            finalUsedModels = usedModels;
            finalFastModeState = fastModeState ?? null;
            const billedDifferent = usedModels.length > 0 && !usedModels.includes(options.model);
            if (billedDifferent) {
              logger.warn(
                "[claude-subscription] Requested %s but SDK billed against %s (fast_mode_state=%s, session=%s) — check `claude` CLI fast mode / rate-limit cooldown",
                options.model,
                usedModels.join(", "),
                fastModeState ?? "unknown",
                sessionPath ?? "fold-path",
              );
            } else if (fastModeState && fastModeState !== "off") {
              logger.warn(
                "[claude-subscription] fast_mode_state=%s for %s (session=%s) — output may come from a smaller model than requested",
                fastModeState,
                options.model,
                sessionPath ?? "fold-path",
              );
            }
            const finalResult = typeof message.result === "string" ? message.result : "";
            if (!emittedText && finalResult.trim()) {
              yield finalResult;
              emittedText = true;
            }
          } else {
            const detail = message.errors?.length ? ` — ${message.errors.join("; ")}` : "";
            throw new Error(`Claude (Subscription) request failed (${message.subtype})${detail}`);
          }
        }
      }
    } catch (err) {
      logger.error(
        err,
        "Claude Agent SDK query failed for model %s (session=%s)",
        options.model,
        sessionPath ?? "fold-path",
      );
      const friendly = err instanceof Error ? err.message : String(err);
      throw new Error(`Claude (Subscription) request failed: ${friendly}`);
    } finally {
      if (options.signal) options.signal.removeEventListener("abort", onUpstreamAbort);
      // Cleanup is best-effort — `cleanupSessionFile` swallows ENOENT and
      // logs anything else. The boot-time orphan sweep is the canonical GC
      // for cases where this `finally` doesn't run (process crash).
      if (sessionPath) {
        void cleanupSessionFile(sessionPath).catch(() => {
          // already logged inside cleanupSessionFile
        });
      }
    }

    if (!emittedText) {
      const diagnostic = [
        `model=${options.model}`,
        `successResult=${sawSuccessResult}`,
        `inputTokens=${inputTokens}`,
        `outputTokens=${outputTokens}`,
        `fast_mode_state=${finalFastModeState ?? "unknown"}`,
        `billedModels=${finalUsedModels.length ? finalUsedModels.join(",") : "none"}`,
        `HOME=${process.env.HOME ?? "unset"}`,
      ].join(", ");
      logger.warn("[claude-subscription] SDK completed without usable text (%s)", diagnostic);
      throw new Error(
        `Claude (Subscription) returned no content. Check that \`claude login\` was run for the same HOME/user as the Marinara server, then retry with LOG_LEVEL=debug if needed (${diagnostic}).`,
      );
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
