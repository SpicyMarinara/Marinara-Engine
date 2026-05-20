// Unit tests for the pure JSONL entry builder.
//
// Runs under Node's built-in test runner via `tsx --test`. No new framework
// dependency — only `node:test` + `node:assert/strict` plus the existing
// `tsx` loader already in devDependencies.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildAssistantEntry,
  buildUserEntry,
  currentToSdkUserMessage,
  SDK_VERSION,
  serializeEntries,
  splitHistoryForResume,
  type CommonSessionMeta,
} from "../jsonl-entries.ts";
import type { ChatMessage } from "../../../base-provider.ts";

const META: CommonSessionMeta = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  cwd: "/tmp/test-cwd",
  version: "test-1.0.0",
  gitBranch: "test-branch",
  permissionMode: "bypassPermissions",
};

const fixedUuid = "22222222-2222-4222-8222-222222222222";
const fixedTimestamp = "2026-05-19T00:00:00.000Z";
const fixedPromptId = "33333333-3333-4333-8333-333333333333";

describe("buildUserEntry", () => {
  it("emits string content for a plain-text user message", () => {
    const m: ChatMessage = { role: "user", content: "hello world" };
    const entry = buildUserEntry({
      message: m,
      parentUuid: null,
      meta: META,
      uuid: fixedUuid,
      timestamp: fixedTimestamp,
      promptId: fixedPromptId,
    });
    assert.equal(entry.type, "user");
    assert.equal(entry.parentUuid, null);
    assert.equal(entry.uuid, fixedUuid);
    assert.equal(entry.timestamp, fixedTimestamp);
    assert.equal(entry.promptId, fixedPromptId);
    assert.equal(entry.message.role, "user");
    assert.equal(entry.message.content, "hello world");
    assert.equal(entry.permissionMode, "bypassPermissions");
    assert.equal(entry.cwd, "/tmp/test-cwd");
    assert.equal(entry.sessionId, META.sessionId);
    assert.equal(entry.version, "test-1.0.0");
    assert.equal(entry.gitBranch, "test-branch");
    assert.equal(entry.userType, "external");
    assert.equal(entry.entrypoint, "cli");
    assert.equal(entry.isSidechain, false);
  });

  it("emits a single tool_result block for a role=tool message", () => {
    const m: ChatMessage = {
      role: "tool",
      content: "search returned 5 results",
      tool_call_id: "toolu_abc123",
    };
    const entry = buildUserEntry({ message: m, parentUuid: "parent-uuid", meta: META });
    assert.equal(entry.parentUuid, "parent-uuid");
    assert.ok(Array.isArray(entry.message.content), "expected block-array content");
    const blocks = entry.message.content as unknown as Array<Record<string, unknown>>;
    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0], {
      type: "tool_result",
      tool_use_id: "toolu_abc123",
      content: "search returned 5 results",
    });
  });

  it("emits a tool_result block with empty tool_use_id when role=tool lacks tool_call_id", () => {
    // Regression for the previous silent miscoding: role=tool with no
    // tool_call_id used to fall through to plain-text content, erasing the
    // tool linkage. Now it emits an (invalid-but-recognisable) tool_result
    // block + warns, so downstream sees the right shape.
    const m: ChatMessage = { role: "tool", content: "orphan tool output" };
    const entry = buildUserEntry({ message: m, parentUuid: null, meta: META });
    assert.ok(Array.isArray(entry.message.content), "expected block-array content");
    const blocks = entry.message.content as unknown as Array<Record<string, unknown>>;
    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0], {
      type: "tool_result",
      tool_use_id: "",
      content: "orphan tool output",
    });
  });

  it("ignores tool_call_id when role is not 'tool'", () => {
    // Defensive: an assistant or user message with a stray tool_call_id
    // shouldn't be reclassified as a tool result.
    const m: ChatMessage = { role: "user", content: "ok", tool_call_id: "toolu_x" };
    const entry = buildUserEntry({ message: m, parentUuid: null, meta: META });
    assert.equal(entry.message.content, "ok");
  });

  it("emits image blocks followed by an optional text block when images are present", () => {
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const m: ChatMessage = {
      role: "user",
      content: "what is in this picture?",
      images: [dataUrl],
    };
    const entry = buildUserEntry({ message: m, parentUuid: null, meta: META });
    const blocks = entry.message.content as unknown as Array<Record<string, unknown>>;
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!["type"], "image");
    assert.deepEqual(blocks[0]!["source"], {
      type: "base64",
      media_type: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    });
    assert.deepEqual(blocks[1]!, { type: "text", text: "what is in this picture?" });
  });

  it("omits the trailing text block when content is empty alongside images", () => {
    const dataUrl = "data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/";
    const m: ChatMessage = { role: "user", content: "", images: [dataUrl] };
    const entry = buildUserEntry({ message: m, parentUuid: null, meta: META });
    const blocks = entry.message.content as unknown as Array<Record<string, unknown>>;
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!["type"], "image");
  });

  it("drops images that are not base64 data URLs", () => {
    const m: ChatMessage = {
      role: "user",
      content: "hi",
      images: ["https://example.com/img.png", "not-a-data-url"],
    };
    const entry = buildUserEntry({ message: m, parentUuid: null, meta: META });
    // All inputs invalid → no images survived → fall back to string content path.
    assert.equal(entry.message.content, "hi");
  });

  it("falls back to empty-string content when message.content is undefined", () => {
    // ChatMessage requires content: string but defensive callers may pass
    // undefined; the builder shouldn't throw.
    const m = { role: "user", content: undefined as unknown as string } satisfies Partial<ChatMessage> as ChatMessage;
    const entry = buildUserEntry({ message: m, parentUuid: null, meta: META });
    assert.equal(entry.message.content, "");
  });

  it("preserves parentUuid chain pointer", () => {
    const m: ChatMessage = { role: "user", content: "x" };
    const entry = buildUserEntry({ message: m, parentUuid: "abc", meta: META });
    assert.equal(entry.parentUuid, "abc");
  });
});

describe("buildAssistantEntry", () => {
  it("emits a single text block with end_turn stop_reason for plain text", () => {
    const m: ChatMessage = { role: "assistant", content: "hello back" };
    const entry = buildAssistantEntry({ message: m, parentUuid: null, meta: META, model: "opus-test" });
    assert.equal(entry.type, "assistant");
    assert.equal(entry.message.role, "assistant");
    assert.equal(entry.message.model, "opus-test");
    assert.equal(entry.message.stop_reason, "end_turn");
    assert.equal(entry.message.stop_sequence, null);
    assert.deepEqual(entry.message.usage, { input_tokens: 0, output_tokens: 0 });
    assert.equal(entry.message.content.length, 1);
    assert.deepEqual(entry.message.content[0]!, { type: "text", text: "hello back" });
    assert.ok(entry.message.id.startsWith("msg_"), "id should start with 'msg_'");
    assert.ok(entry.requestId.startsWith("req_"), "requestId should start with 'req_'");
  });

  it("emits text + tool_use blocks with tool_use stop_reason when tool_calls present", () => {
    const m: ChatMessage = {
      role: "assistant",
      content: "running search",
      tool_calls: [
        {
          id: "toolu_001",
          type: "function",
          function: { name: "search", arguments: '{"q":"cats","limit":5}' },
        },
      ],
    };
    const entry = buildAssistantEntry({ message: m, parentUuid: null, meta: META, model: "opus-test" });
    assert.equal(entry.message.stop_reason, "tool_use");
    assert.equal(entry.message.content.length, 2);
    assert.deepEqual(entry.message.content[0]!, { type: "text", text: "running search" });
    assert.deepEqual(entry.message.content[1]!, {
      type: "tool_use",
      id: "toolu_001",
      name: "search",
      input: { q: "cats", limit: 5 },
    });
  });

  it("emits only tool_use blocks when assistant content is empty but tool_calls present", () => {
    const m: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "t1", type: "function", function: { name: "fn", arguments: "{}" } },
      ],
    };
    const entry = buildAssistantEntry({ message: m, parentUuid: null, meta: META, model: "m" });
    assert.equal(entry.message.content.length, 1);
    assert.equal(entry.message.content[0]!.type, "tool_use");
    assert.equal(entry.message.stop_reason, "tool_use");
  });

  it("falls back to an empty text block when neither content nor tool_calls are present", () => {
    // The Anthropic API rejects empty content arrays. Verify the placeholder
    // text block keeps the entry valid.
    const m: ChatMessage = { role: "assistant", content: "" };
    const entry = buildAssistantEntry({ message: m, parentUuid: null, meta: META, model: "m" });
    assert.equal(entry.message.content.length, 1);
    assert.deepEqual(entry.message.content[0]!, { type: "text", text: "" });
    assert.equal(entry.message.stop_reason, "end_turn");
  });

  it("substitutes {} when tool_use arguments are not valid JSON", () => {
    const m: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "t1", type: "function", function: { name: "fn", arguments: "this is not json" } },
      ],
    };
    const entry = buildAssistantEntry({ message: m, parentUuid: null, meta: META, model: "m" });
    assert.equal(entry.message.content.length, 1, "expected exactly one tool_use block");
    const toolUse = entry.message.content[0]! as { input: Record<string, unknown> };
    assert.deepEqual(toolUse.input, {});
  });

  it("substitutes {} when tool_use arguments parse to an array (non-object)", () => {
    // OpenAI tool-call arguments must be a JSON object; an array slipping
    // through (bug upstream) should not propagate as `input: [...]` since
    // Anthropic's tool_use schema requires an object.
    const m: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "t1", type: "function", function: { name: "fn", arguments: "[1,2,3]" } },
      ],
    };
    const entry = buildAssistantEntry({ message: m, parentUuid: null, meta: META, model: "m" });
    assert.equal(entry.message.content.length, 1, "expected exactly one tool_use block");
    const toolUse = entry.message.content[0]! as { input: Record<string, unknown> };
    assert.deepEqual(toolUse.input, {});
  });

  it("substitutes {} when tool_use arguments parse to null", () => {
    const m: ChatMessage = {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "t1", type: "function", function: { name: "fn", arguments: "null" } },
      ],
    };
    const entry = buildAssistantEntry({ message: m, parentUuid: null, meta: META, model: "m" });
    assert.equal(entry.message.content.length, 1, "expected exactly one tool_use block");
    const toolUse = entry.message.content[0]! as { input: Record<string, unknown> };
    assert.deepEqual(toolUse.input, {});
  });

  it("uses caller-supplied id/requestId/uuid/timestamp overrides", () => {
    const m: ChatMessage = { role: "assistant", content: "x" };
    const entry = buildAssistantEntry({
      message: m,
      parentUuid: null,
      meta: META,
      model: "m",
      uuid: fixedUuid,
      timestamp: fixedTimestamp,
      messageId: "msg_fixed",
      requestId: "req_fixed",
    });
    assert.equal(entry.uuid, fixedUuid);
    assert.equal(entry.timestamp, fixedTimestamp);
    assert.equal(entry.message.id, "msg_fixed");
    assert.equal(entry.requestId, "req_fixed");
  });
});

describe("serializeEntries", () => {
  it("returns empty string for empty entries", () => {
    assert.equal(serializeEntries([]), "");
  });

  it("emits one JSON object per line with a trailing newline", () => {
    const user = buildUserEntry({
      message: { role: "user", content: "a" },
      parentUuid: null,
      meta: META,
      uuid: "u1",
      timestamp: fixedTimestamp,
      promptId: "p1",
    });
    const assistant = buildAssistantEntry({
      message: { role: "assistant", content: "b" },
      parentUuid: "u1",
      meta: META,
      model: "m",
      uuid: "u2",
      timestamp: fixedTimestamp,
      messageId: "msg_1",
      requestId: "req_1",
    });
    const text = serializeEntries([user, assistant]);
    const lines = text.split("\n");
    // Two entries + trailing empty string from the final newline = 3.
    assert.equal(lines.length, 3);
    assert.equal(lines[2]!, "");
    const parsed0 = JSON.parse(lines[0]!) as Record<string, unknown>;
    const parsed1 = JSON.parse(lines[1]!) as Record<string, unknown>;
    assert.equal(parsed0["type"], "user");
    assert.equal(parsed1["type"], "assistant");
    assert.equal(parsed1["parentUuid"], "u1");
  });
});

describe("splitHistoryForResume", () => {
  it("emits trailing-user split for a normal multi-turn history", () => {
    const history: ChatMessage[] = [
      { role: "system", content: "be helpful" },
      { role: "user", content: "1" },
      { role: "assistant", content: "2" },
      { role: "user", content: "3" },
    ];
    const split = splitHistoryForResume(history);
    assert.equal(split.shape, "trailing-user");
    // System is stripped from history (rides systemPrompt instead); after
    // stripping there are 3 non-system messages, the trailing one is
    // `current`, so history holds the 2 prior turns.
    assert.equal(split.history.length, 2);
    assert.equal(split.history[0]!.role, "user");
    assert.equal(split.history[1]!.role, "assistant");
    assert.equal(split.current.role, "user");
    assert.equal(split.current.content, "3");
  });

  it("emits trailing-tool split for an agent-loop mid-stream history", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "do a thing" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "t1", type: "function", function: { name: "f", arguments: "{}" } }],
      },
      { role: "tool", content: "result", tool_call_id: "t1" },
    ];
    const split = splitHistoryForResume(history);
    assert.equal(split.shape, "trailing-tool");
    assert.equal(split.history.length, 2);
    assert.equal(split.current.role, "tool");
    assert.equal(split.current.tool_call_id, "t1");
  });

  it("keeps trailing assistant in JSONL and synthesizes a continuation prompt (prefill path)", () => {
    // Marinara's assistantPrefill feature lands here (generate.routes.ts).
    const history: ChatMessage[] = [
      { role: "user", content: "story start: " },
      { role: "assistant", content: "Once upon a time," },
    ];
    const split = splitHistoryForResume(history);
    assert.equal(split.shape, "trailing-assistant-continue");
    assert.equal(split.history.length, 2, "trailing assistant must stay in JSONL for prefill visibility");
    assert.equal(split.history[1]!.role, "assistant");
    assert.equal(split.history[1]!.content, "Once upon a time,");
    assert.equal(split.current.role, "user");
    assert.ok(split.current.content.length > 0, "synthetic continuation must be non-empty for the Anthropic API");
  });

  it("synthesizes a [Start] prompt for empty history", () => {
    const split = splitHistoryForResume([]);
    assert.equal(split.shape, "synthetic-start");
    assert.equal(split.history.length, 0);
    assert.equal(split.current.role, "user");
    assert.ok(split.current.content.length > 0);
  });

  it("synthesizes a [Start] prompt for system-only history", () => {
    const split = splitHistoryForResume([{ role: "system", content: "be helpful" }]);
    assert.equal(split.shape, "synthetic-start");
    assert.equal(split.history.length, 0);
    assert.equal(split.current.role, "user");
  });

  it("returns empty history for [system, user] (system filtered, user becomes current)", () => {
    // Regression: the previous implementation kept system messages in
    // `history`, so [system, user] gave history.length=1, the provider's
    // "empty → skip resume" gate didn't fire, an empty JSONL was written
    // (assembleEntries filters system anyway), and the SDK rejected it with
    // "No conversation found." This is the common Marinara case — persona /
    // character prompt followed by the user's first message.
    const history: ChatMessage[] = [
      { role: "system", content: "you are Mari" },
      { role: "user", content: "hello" },
    ];
    const split = splitHistoryForResume(history);
    assert.equal(split.shape, "trailing-user");
    assert.equal(split.history.length, 0, "system messages must not count toward history length");
    assert.equal(split.current.role, "user");
    assert.equal(split.current.content, "hello");
  });

  it("filters interleaved system messages out of history", () => {
    // [system, user, assistant, system, user] → history = [user, assistant],
    // current = trailing user.
    const history: ChatMessage[] = [
      { role: "system", content: "s1" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "system", content: "s2" },
      { role: "user", content: "u2" },
    ];
    const split = splitHistoryForResume(history);
    assert.equal(split.shape, "trailing-user");
    assert.equal(split.history.length, 2);
    assert.equal(split.history[0]!.role, "user");
    assert.equal(split.history[1]!.role, "assistant");
    assert.equal(split.current.content, "u2");
  });

  it("treats system messages as transparent for the trailing-message determination", () => {
    // A system message appearing AFTER the last user/assistant shouldn't
    // change the split — system rides systemPrompt, not the JSONL.
    const history: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "system", content: "remember to be concise" },
    ];
    const split = splitHistoryForResume(history);
    assert.equal(split.shape, "trailing-assistant-continue");
    // The trailing assistant (not the trailing system) drives the shape.
  });
});

describe("currentToSdkUserMessage", () => {
  it("emits string content for a plain-text user message", () => {
    const m: ChatMessage = { role: "user", content: "hello" };
    const msg = currentToSdkUserMessage(m);
    assert.equal(msg.type, "user");
    assert.equal(msg.message.role, "user");
    assert.equal(msg.message.content, "hello");
    assert.equal(msg.parent_tool_use_id, null);
  });

  it("emits image blocks + optional text block when images are present", () => {
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const m: ChatMessage = { role: "user", content: "what is this?", images: [dataUrl] };
    const msg = currentToSdkUserMessage(m);
    assert.ok(Array.isArray(msg.message.content));
    const blocks = msg.message.content as unknown as Array<Record<string, unknown>>;
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!["type"], "image");
    assert.deepEqual(blocks[1], { type: "text", text: "what is this?" });
  });

  it("emits a tool_result block when role=tool with tool_call_id", () => {
    const m: ChatMessage = { role: "tool", content: "result", tool_call_id: "toolu_001" };
    const msg = currentToSdkUserMessage(m);
    assert.ok(Array.isArray(msg.message.content));
    const blocks = msg.message.content as unknown as Array<Record<string, unknown>>;
    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0], {
      type: "tool_result",
      tool_use_id: "toolu_001",
      content: "result",
    });
  });

  it("emits a tool_result block with empty tool_use_id when role=tool lacks tool_call_id", () => {
    const m: ChatMessage = { role: "tool", content: "orphan" };
    const msg = currentToSdkUserMessage(m);
    const blocks = msg.message.content as unknown as Array<Record<string, unknown>>;
    assert.equal(blocks[0]!["tool_use_id"], "");
  });

  it("drops images that are not base64 data URLs", () => {
    const m: ChatMessage = {
      role: "user",
      content: "hi",
      images: ["https://example.com/x.png", "not-a-data-url"],
    };
    const msg = currentToSdkUserMessage(m);
    // All invalid → no image blocks → string content fallback.
    assert.equal(msg.message.content, "hi");
  });
});

describe("SDK_VERSION", () => {
  it("is a non-empty string (the installed SDK version, or 'unknown' fallback)", () => {
    assert.equal(typeof SDK_VERSION, "string");
    assert.ok(SDK_VERSION.length > 0);
  });

  it("matches the installed @anthropic-ai/claude-agent-sdk package version when resolvable", () => {
    // If the package is resolvable in this test env (it is, per devDependencies),
    // SDK_VERSION should look like a semver, not "unknown".
    assert.match(SDK_VERSION, /^\d+\.\d+\.\d+/, "expected semver-like; got " + SDK_VERSION);
  });
});
