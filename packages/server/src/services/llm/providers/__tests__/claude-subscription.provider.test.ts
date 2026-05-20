// Provider integration test — verifies the resume path wiring end-to-end.
//
// Uses `__setSdkForTesting` to inject a fake SDK that captures the `query()`
// arguments. Asserts the provider:
//   1. Writes a JSONL session file at the expected path
//   2. Passes `resume: <sessionId>` and `cwd: <process.cwd()>` to the SDK
//   3. Yields the current-turn message (with image blocks where applicable)
//      via the AsyncIterable prompt
//   4. Cleans up the session file in `finally` after the SDK completes
//
// Each test runs with `process.chdir(tmpDir)` so the provider derives a
// unique sessions directory and pollution to the real ~/.claude/projects/
// is bounded to test runs.

import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ClaudeSubscriptionProvider, __setSdkForTesting } from "../claude-subscription.provider.ts";
import { sessionsDirFor } from "../claude-subscription/synthetic-session.ts";

interface CapturedQuery {
  prompt: unknown;
  options: Record<string, unknown>;
  /**
   * Snapshot of the JSONL session file content, captured INSIDE the fake's
   * generator before the first yield. By the time the provider's `finally`
   * block runs `cleanupSessionFile`, the on-disk file is gone — tests that
   * want to inspect the JSONL must read it from this snapshot, not from
   * the filesystem. Empty string when the resume path didn't write a file
   * (single-turn / empty-history requests).
   */
  jsonlSnapshot: string;
}

function makeFakeSdk(captured: CapturedQuery[]): { query: (args: unknown) => AsyncIterable<unknown> } {
  return {
    query(args: unknown) {
      const { prompt, options } = args as { prompt: unknown; options: Record<string, unknown> };
      const entry: CapturedQuery = { prompt, options, jsonlSnapshot: "" };
      captured.push(entry);
      // resume + cwd are absent on fold-path calls and on empty-history
      // resume sub-paths, which means there's no file to snapshot below.
      const resumeId = typeof options["resume"] === "string" ? (options["resume"] as string) : null;
      const cwdOpt = typeof options["cwd"] === "string" ? (options["cwd"] as string) : null;
      const sessionPath = resumeId && cwdOpt ? join(sessionsDirFor(cwdOpt), `${resumeId}.jsonl`) : null;

      async function* iter(): AsyncIterable<unknown> {
        // The provider's `finally` cleanup runs AFTER the for-await loop
        // exits, so as long as we read here (before yielding anything),
        // the JSONL is guaranteed to still exist on disk.
        if (sessionPath) {
          try {
            entry.jsonlSnapshot = await readFile(sessionPath, "utf8");
          } catch {
            // No file (race or empty-history); leave snapshot empty.
          }
        }
        // Without a text delta the provider's empty-response guard throws
        // before any assertion runs — every wiring test would fail for an
        // irrelevant reason. Emit a minimal one to keep the guard quiet.
        yield {
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } },
        };
        yield {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 10, output_tokens: 20 },
          modelUsage: { "claude-test-model": { input_tokens: 10, output_tokens: 20 } },
          fast_mode_state: "off",
        };
      }
      return iter();
    },
  };
}

async function collectIterable<T>(it: AsyncIterable<T> | Iterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it as AsyncIterable<T>) out.push(v);
  return out;
}

async function drainProviderChat(provider: ClaudeSubscriptionProvider, messages: Parameters<ClaudeSubscriptionProvider["chat"]>[0], options: Parameters<ClaudeSubscriptionProvider["chat"]>[1]): Promise<string[]> {
  const chunks: string[] = [];
  const gen = provider.chat(messages, options);
  for await (const chunk of gen) {
    if (typeof chunk === "string") chunks.push(chunk);
  }
  return chunks;
}

describe("ClaudeSubscriptionProvider — resume path wiring", () => {
  let tmpCwd: string;
  let priorCwd: string;
  let priorPlatform: NodeJS.Platform;

  beforeEach(async () => {
    tmpCwd = await mkdtemp(join(tmpdir(), "marinara-provider-test-"));
    priorCwd = process.cwd();
    priorPlatform = process.platform;
    // Force non-win32 so the resume path is exercised even when this test
    // runs on a Windows CI host. We restore in afterEach.
    if (priorPlatform === "win32") {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    }
    process.chdir(tmpCwd);
  });

  afterEach(async () => {
    process.chdir(priorCwd);
    __setSdkForTesting(null);
    // Restore platform.
    if (process.platform !== priorPlatform) {
      Object.defineProperty(process, "platform", { value: priorPlatform, configurable: true });
    }
    // Best-effort cleanup of the per-test sessions directory under ~/.claude/projects/.
    await rm(sessionsDirFor(tmpCwd), { recursive: true, force: true });
    // And the tmp working dir itself.
    await rm(tmpCwd, { recursive: true, force: true });
  });

  it("passes resume + cwd to the SDK and writes the JSONL file at the matching path", async () => {
    const captured: CapturedQuery[] = [];
    // Fake `query` returns `AsyncIterable<unknown>` rather than the SDK's full
    // `Query` interface (with `close()` etc.). The provider only iterates, so
    // the runtime shape is sufficient; cast through `unknown` at the seam.
    __setSdkForTesting(makeFakeSdk(captured) as unknown as Parameters<typeof __setSdkForTesting>[0]);

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [
        { role: "user", content: "first user message" },
        { role: "assistant", content: "first assistant reply" },
        { role: "user", content: "second user message" },
      ],
      { model: "claude-test-model", stream: false },
    );

    assert.equal(captured.length, 1, "SDK query() should have been called exactly once");
    const call = captured[0]!;
    assert.equal(call.options["cwd"], tmpCwd, "cwd should match the temp working dir we chdir'd into");
    const resumeId = call.options["resume"];
    assert.equal(typeof resumeId, "string", "resume should be a string sessionId");
    assert.match(resumeId as string, /^[0-9a-f-]{36}$/, "resume should look like a UUID");

    // Prompt is an AsyncIterable<SDKUserMessage>; collect and inspect.
    const promptMessages = await collectIterable(call.prompt as AsyncIterable<unknown>);
    assert.equal(promptMessages.length, 1, "prompt iterable should yield exactly one SDKUserMessage");
    const userMsg = promptMessages[0] as { type: string; message: { role: string; content: unknown } };
    assert.equal(userMsg.type, "user");
    assert.equal(userMsg.message.role, "user");
    assert.equal(userMsg.message.content, "second user message", "current turn should be the trailing user message");
  });

  it("emits image blocks on the current turn AND on historical user turns in JSONL", async () => {
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const captured: CapturedQuery[] = [];
    // Fake `query` returns `AsyncIterable<unknown>` rather than the SDK's full
    // `Query` interface (with `close()` etc.). The provider only iterates, so
    // the runtime shape is sufficient; cast through `unknown` at the seam.
    __setSdkForTesting(makeFakeSdk(captured) as unknown as Parameters<typeof __setSdkForTesting>[0]);

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [
        { role: "user", content: "look at this", images: [dataUrl] },
        { role: "assistant", content: "I see it" },
        { role: "user", content: "and this one?", images: [dataUrl] },
      ],
      { model: "claude-test-model", stream: false },
    );

    const call = captured[0]!;

    // Current-turn images come through the prompt iterable.
    const promptMessages = await collectIterable(call.prompt as AsyncIterable<unknown>);
    const userMsg = promptMessages[0] as { message: { content: unknown } };
    const currentBlocks = userMsg.message.content as unknown as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(currentBlocks), "current turn with images must use block-array content");
    assert.equal(currentBlocks[0]!["type"], "image", "first block is the image");
    assert.deepEqual(currentBlocks[1], { type: "text", text: "and this one?" });

    // Historical-turn image must appear in the JSONL session file. We read
    // from the snapshot captured by the fake SDK before the provider's
    // finally-cleanup ran — reading from disk here would race the cleanup
    // and skip the assertion silently. The snapshot must be non-empty for
    // any resume call with prior history.
    assert.ok(call.jsonlSnapshot.length > 0, "fake should have captured the JSONL before cleanup");
    const firstLine = call.jsonlSnapshot.split("\n")[0]!;
    const parsed = JSON.parse(firstLine) as {
      type: string;
      message: { content: Array<Record<string, unknown>> };
    };
    assert.equal(parsed.type, "user");
    assert.ok(Array.isArray(parsed.message.content), "historical user with images must use block-array content");
    assert.equal(parsed.message.content[0]!["type"], "image", "historical image block survives in JSONL");
  });

  it("keeps the trailing assistant prefill in JSONL and sends a synthetic continuation prompt", async () => {
    const captured: CapturedQuery[] = [];
    // Fake `query` returns `AsyncIterable<unknown>` rather than the SDK's full
    // `Query` interface (with `close()` etc.). The provider only iterates, so
    // the runtime shape is sufficient; cast through `unknown` at the seam.
    __setSdkForTesting(makeFakeSdk(captured) as unknown as Parameters<typeof __setSdkForTesting>[0]);

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [
        { role: "user", content: "tell me a story" },
        { role: "assistant", content: "Once upon a time, there was" },
      ],
      { model: "claude-test-model", stream: false },
    );

    const call = captured[0]!;
    const promptMessages = await collectIterable(call.prompt as AsyncIterable<unknown>);
    const userMsg = promptMessages[0] as { message: { role: string; content: unknown } };
    assert.equal(userMsg.message.role, "user");
    // Synthetic continuation is non-empty (Anthropic API rejects empty content)
    // and clearly NOT the assistant's text.
    assert.equal(typeof userMsg.message.content, "string");
    assert.notEqual(userMsg.message.content, "Once upon a time, there was");
    assert.ok((userMsg.message.content as string).length > 0);
  });

  it("connection-level customParameters cannot override the reserved resume/cwd keys", async () => {
    const captured: CapturedQuery[] = [];
    __setSdkForTesting(makeFakeSdk(captured) as unknown as Parameters<typeof __setSdkForTesting>[0]);

    const provider = new ClaudeSubscriptionProvider("", "");
    // Multi-turn history so the resume path actually engages (single-turn
    // requests skip resume entirely — see the dedicated test below).
    await drainProviderChat(
      provider,
      [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ],
      {
        model: "claude-test-model",
        stream: false,
        customParameters: {
          resume: "attacker-forged-session-id",
          cwd: "/etc/passwd",
        },
      },
    );

    const call = captured[0]!;
    assert.notEqual(call.options["resume"], "attacker-forged-session-id", "resume must not be overridable via customParameters");
    assert.notEqual(call.options["cwd"], "/etc/passwd", "cwd must not be overridable via customParameters");
    assert.equal(call.options["cwd"], tmpCwd);
    assert.match(call.options["resume"] as string, /^[0-9a-f-]{36}$/);
  });

  it("skips the resume path entirely for single-turn requests (empty history)", async () => {
    // Regression for the "No conversation found" failure we hit in dev:
    // writing an empty JSONL and passing it to resume makes the SDK reject
    // it, so we only construct a session file when there's prior history
    // to resume from. Single-turn requests send `current` directly via
    // the AsyncIterable prompt instead.
    const captured: CapturedQuery[] = [];
    __setSdkForTesting(makeFakeSdk(captured) as unknown as Parameters<typeof __setSdkForTesting>[0]);

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [{ role: "user", content: "single turn message" }],
      { model: "claude-test-model", stream: false },
    );

    const call = captured[0]!;
    assert.equal(call.options["resume"], undefined, "resume must NOT be set for single-turn requests");
    assert.equal(call.options["cwd"], undefined, "cwd must NOT be set when resume is absent");

    // The current message still flows via the AsyncIterable prompt so images
    // and multimodal content on the first turn still work.
    const promptMessages = await collectIterable(call.prompt as AsyncIterable<unknown>);
    assert.equal(promptMessages.length, 1);
    const userMsg = promptMessages[0] as { type: string; message: { content: unknown } };
    assert.equal(userMsg.type, "user");
    assert.equal(userMsg.message.content, "single turn message");
  });

  it("concurrent provider calls produce distinct session UUIDs and files (no shared sessionId by chatId)", async () => {
    // Locks in the invariant: each chat() invocation mints a fresh UUID via
    // randomUUID() inside constructSessionFile. There is no `chatId ->
    // sessionId` mapping that would cause same-tick concurrent calls to
    // race on a shared JSONL file. If a future refactor introduces such a
    // mapping, this test fires immediately.
    const captured: CapturedQuery[] = [];
    __setSdkForTesting(makeFakeSdk(captured) as unknown as Parameters<typeof __setSdkForTesting>[0]);

    const provider = new ClaudeSubscriptionProvider("", "");

    // Fire two chat() calls in the same tick; await both together.
    // Multi-turn so resume actually engages (see single-turn skip test).
    const baseHistory = [
      { role: "user" as const, content: "prior turn" },
      { role: "assistant" as const, content: "prior reply" },
    ];
    const drainA = drainProviderChat(
      provider,
      [...baseHistory, { role: "user", content: "concurrent A" }],
      { model: "claude-test-model", stream: false },
    );
    const drainB = drainProviderChat(
      provider,
      [...baseHistory, { role: "user", content: "concurrent B" }],
      { model: "claude-test-model", stream: false },
    );
    await Promise.all([drainA, drainB]);

    assert.equal(captured.length, 2, "both calls should have invoked the SDK");
    const resumeA = captured[0]!.options["resume"];
    const resumeB = captured[1]!.options["resume"];
    assert.equal(typeof resumeA, "string");
    assert.equal(typeof resumeB, "string");
    assert.notEqual(resumeA, resumeB, "concurrent calls must produce distinct resume sessionIds");

    // Both files should have lived under the same sessions directory but
    // with distinct names. Cleanup is best-effort (`void ...catch`); the
    // afterEach `rm` will sweep whatever remains.
    const dir = sessionsDirFor(tmpCwd);
    const pathA = join(dir, `${resumeA as string}.jsonl`);
    const pathB = join(dir, `${resumeB as string}.jsonl`);
    assert.notEqual(pathA, pathB);
  });

  it("assembles the same systemPrompt under CLAUDE_SUBSCRIPTION_USE_RESUME=true and =false", async () => {
    // Snapshot parity: toggling the kill switch must not change what the
    // SDK sees as `systemPrompt`. Catches accidental skipping of a system-
    // assembly step in either branch.
    const messages: Parameters<ClaudeSubscriptionProvider["chat"]>[0] = [
      { role: "system", content: "you are mari" },
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ];

    // Snapshot the developer's shell env so we always leave it the way we
    // found it — without this, a contributor whose shell has the kill
    // switch set would see it silently cleared after running this test.
    const priorKill = process.env.CLAUDE_SUBSCRIPTION_USE_RESUME;
    const capturedResume: CapturedQuery[] = [];
    const capturedFold: CapturedQuery[] = [];
    try {
      // ── Resume path (env unset → default true) ──
      __setSdkForTesting(makeFakeSdk(capturedResume) as unknown as Parameters<typeof __setSdkForTesting>[0]);
      delete process.env.CLAUDE_SUBSCRIPTION_USE_RESUME;
      const providerResume = new ClaudeSubscriptionProvider("", "");
      await drainProviderChat(providerResume, messages, { model: "claude-test-model", stream: false });

      // ── Fold path (env=false) ──
      __setSdkForTesting(makeFakeSdk(capturedFold) as unknown as Parameters<typeof __setSdkForTesting>[0]);
      process.env.CLAUDE_SUBSCRIPTION_USE_RESUME = "false";
      const providerFold = new ClaudeSubscriptionProvider("", "");
      await drainProviderChat(providerFold, messages, { model: "claude-test-model", stream: false });
    } finally {
      if (priorKill === undefined) delete process.env.CLAUDE_SUBSCRIPTION_USE_RESUME;
      else process.env.CLAUDE_SUBSCRIPTION_USE_RESUME = priorKill;
    }

    assert.equal(capturedResume.length, 1);
    assert.equal(capturedFold.length, 1);

    // systemPrompt is a plain string of the caller's content (not a preset
    // wrap) on both paths, and concatenating multiple system messages with
    // `\n\n` is the contract both branches must honor. Asserting equality
    // here catches a future refactor that accidentally diverges them.
    const systemResume = capturedResume[0]!.options["systemPrompt"];
    const systemFold = capturedFold[0]!.options["systemPrompt"];
    assert.equal(typeof systemResume, "string");
    assert.equal(typeof systemFold, "string");
    assert.equal(
      systemResume,
      systemFold,
      "systemPrompt must match byte-for-byte between resume and fold paths",
    );
    assert.equal(systemResume, "you are mari\n\nbe terse");
  });

  it("strips SDK auto-context: no claude_code preset, empty skills/settingSources, maxTurns=1", async () => {
    // Locks in the outbound-context strip set. Each of these defaults
    // would leak something the user never asked for:
    //   - `claude_code` preset → Claude Code's agent framing prefix
    //   - non-empty/unset skills → auto-loaded skill metadata
    //   - non-empty/unset settingSources → ~/.claude/settings.json + project CLAUDE.md
    //   - maxTurns unset → SDK might try multi-turn loops internally
    //   - allowDangerouslySkipPermissions false → permission framing
    const captured: CapturedQuery[] = [];
    __setSdkForTesting(makeFakeSdk(captured) as unknown as Parameters<typeof __setSdkForTesting>[0]);

    const provider = new ClaudeSubscriptionProvider("", "");
    await drainProviderChat(
      provider,
      [
        { role: "system", content: "be Mari" },
        { role: "user", content: "hello" },
      ],
      { model: "claude-test-model", stream: false },
    );

    const opts = captured[0]!.options;
    assert.equal(typeof opts["systemPrompt"], "string", "systemPrompt must be a plain string, not a preset object");
    assert.notEqual(
      typeof opts["systemPrompt"],
      "object",
      "systemPrompt as `{type:'preset',...}` would re-introduce the claude_code preset leak",
    );
    assert.deepEqual(opts["skills"], [], "skills must be explicitly empty");
    assert.deepEqual(opts["settingSources"], [], "settingSources must be explicitly empty so CLAUDE.md doesn't auto-load");
    assert.equal(opts["maxTurns"], 1, "maxTurns must be 1 — Marinara drives multi-turn at the route layer");
    assert.equal(opts["allowDangerouslySkipPermissions"], true, "explicit bypass to skip permission framing");
    assert.equal(opts["permissionMode"], "bypassPermissions");
    assert.deepEqual(opts["tools"], []);
  });

  it("cleans up the session file after the SDK completes (best-effort)", async () => {
    const captured: CapturedQuery[] = [];
    __setSdkForTesting(makeFakeSdk(captured) as unknown as Parameters<typeof __setSdkForTesting>[0]);

    const provider = new ClaudeSubscriptionProvider("", "");
    // Multi-turn so a session file actually gets written (single-turn skips
    // the resume path entirely; cleanup of a never-written file is vacuous).
    await drainProviderChat(
      provider,
      [
        { role: "user", content: "prior" },
        { role: "assistant", content: "prior reply" },
        { role: "user", content: "test cleanup" },
      ],
      { model: "claude-test-model", stream: false },
    );

    const sessionId = captured[0]!.options["resume"] as string;
    assert.match(sessionId, /^[0-9a-f-]{36}$/, "resume must be set so we're actually exercising cleanup");
    const sessionPath = join(sessionsDirFor(tmpCwd), `${sessionId}.jsonl`);
    // Cleanup is fire-and-forget (`void cleanupSessionFile(...).catch(...)`)
    // so we yield to the microtask queue once before checking.
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(() => stat(sessionPath), /ENOENT/, "session file should be cleaned up after completion");
  });
});

describe("ClaudeSubscriptionProvider — win32 fold-path fallback", () => {
  // The synthetic-session resume machinery is Linux/macOS only
  // (`constructSessionFile` throws on win32), so Windows hosts must degrade
  // to the transcript-fold path. Pinning that contract here is what lets the
  // synthetic-session unit suite be skipped on win32 rather than ported.
  let priorPlatform: NodeJS.Platform;
  beforeEach(() => {
    priorPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  });
  afterEach(() => {
    __setSdkForTesting(null);
    if (process.platform !== priorPlatform) {
      Object.defineProperty(process, "platform", { value: priorPlatform, configurable: true });
    }
  });

  it("uses the fold path on win32 — no resume, no cwd, plain-string prompt", async () => {
    const captured: CapturedQuery[] = [];
    __setSdkForTesting(makeFakeSdk(captured) as unknown as Parameters<typeof __setSdkForTesting>[0]);

    const provider = new ClaudeSubscriptionProvider("", "");
    // Multi-turn history: on a non-win32 host this WOULD engage the resume
    // path, so asserting it doesn't here proves the platform gate works.
    await drainProviderChat(
      provider,
      [
        { role: "user", content: "first user message" },
        { role: "assistant", content: "first assistant reply" },
        { role: "user", content: "second user message" },
      ],
      { model: "claude-test-model", stream: false },
    );

    const call = captured[0]!;
    assert.equal(call.options["resume"], undefined, "resume must NOT be set on win32 (fold path)");
    assert.equal(call.options["cwd"], undefined, "cwd must NOT be set on win32 (fold path)");
    assert.equal(
      typeof call.prompt,
      "string",
      "fold path passes a plain-string transcript, not an AsyncIterable",
    );
    const prompt = call.prompt as string;
    assert.match(prompt, /second user message/, "folded transcript must include the latest turn");
    assert.match(prompt, /first assistant reply/, "folded transcript must include prior turns");
  });
});
