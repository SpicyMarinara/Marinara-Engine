import test from "node:test";
import assert from "node:assert/strict";
import {
  ClaudeSubscriptionProvider,
  __setSdkForTesting,
} from "../src/services/llm/providers/claude-subscription.provider.js";
import type { ChatMessage, ChatOptions } from "../src/services/llm/base-provider.js";

type CapturedQuery = {
  prompt: string;
  options: Record<string, unknown>;
};

/**
 * Build a fake `query()` that records the call and yields a scripted set of
 * SDK messages. Returns both the fake and the recorded calls so each test can
 * inspect what the provider sent.
 */
function makeFakeSdk(scripted: Array<Record<string, unknown>>) {
  const calls: CapturedQuery[] = [];
  const fake = {
    query: (params: { prompt: string; options?: Record<string, unknown> }) => {
      calls.push({ prompt: params.prompt, options: { ...(params.options ?? {}) } });
      // Provide an async iterable that yields the scripted messages in order.
      return (async function* () {
        for (const msg of scripted) yield msg;
      })();
    },
  };
  return { fake, calls };
}

function streamEvent(delta: { type: string; text?: string; thinking?: string }) {
  return {
    type: "stream_event",
    event: { type: "content_block_delta", delta },
  };
}

function successResult(usage?: Record<string, number>) {
  return {
    type: "result",
    subtype: "success",
    usage: usage ?? { input_tokens: 12, output_tokens: 7 },
  };
}

function makeProvider(apiKey = "") {
  return new ClaudeSubscriptionProvider("", apiKey, undefined, undefined, undefined);
}

async function drain(
  provider: ClaudeSubscriptionProvider,
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<{ text: string; usage: unknown }> {
  let text = "";
  const gen = provider.chat(messages, options);
  let next = await gen.next();
  while (!next.done) {
    text += next.value;
    next = await gen.next();
  }
  return { text, usage: next.value };
}

test.afterEach(() => {
  __setSdkForTesting(null);
});

test("streams text deltas and merges them into the yielded chunks", async () => {
  const { fake, calls } = makeFakeSdk([
    streamEvent({ type: "text_delta", text: "Hel" }),
    streamEvent({ type: "text_delta", text: "lo " }),
    streamEvent({ type: "text_delta", text: "world" }),
    successResult({ input_tokens: 5, output_tokens: 2 }),
  ]);
  __setSdkForTesting(fake);

  const provider = makeProvider();
  const { text, usage } = await drain(
    provider,
    [{ role: "user", content: "hi" }],
    { model: "claude-opus-4-5", stream: true },
  );

  assert.equal(text, "Hello world");
  assert.deepEqual(usage, { promptTokens: 5, completionTokens: 2, totalTokens: 7 });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.prompt, /User: hi$/);
  assert.equal(calls[0]!.options.includePartialMessages, true);
  assert.deepEqual(calls[0]!.options.tools, []);
  assert.equal(calls[0]!.options.permissionMode, "bypassPermissions");
  assert.equal("maxTurns" in calls[0]!.options, false);
  assert.equal(calls[0]!.options.model, "claude-opus-4-5");
});

test("extracts system messages into systemPrompt and renders the rest as a transcript", async () => {
  const { fake, calls } = makeFakeSdk([streamEvent({ type: "text_delta", text: "ok" }), successResult()]);
  __setSdkForTesting(fake);

  const provider = makeProvider();
  await drain(
    provider,
    [
      { role: "system", content: "You are Aerith." },
      { role: "system", content: "Stay in character." },
      { role: "user", content: "Hi Aerith." },
      { role: "assistant", content: "Hello, traveler." },
      { role: "user", content: "Where are we?" },
    ],
    { model: "claude-sonnet-4-5", stream: true },
  );

  assert.equal(calls[0]!.options.systemPrompt, "You are Aerith.\n\nStay in character.");
  assert.equal(
    calls[0]!.prompt,
    "User: Hi Aerith.\n\nAssistant: Hello, traveler.\n\nUser: Where are we?",
  );
});

test("Opus 4.7 enables adaptive thinking by default even without enableThinking", async () => {
  const { fake, calls } = makeFakeSdk([streamEvent({ type: "text_delta", text: "." }), successResult()]);
  __setSdkForTesting(fake);

  await drain(makeProvider(), [{ role: "user", content: "hi" }], {
    model: "claude-opus-4-7",
    stream: true,
  });

  assert.deepEqual(calls[0]!.options.thinking, { type: "adaptive" });
});

test("enableThinking with reasoningEffort=xhigh forwards both fields", async () => {
  const { fake, calls } = makeFakeSdk([streamEvent({ type: "text_delta", text: "." }), successResult()]);
  __setSdkForTesting(fake);

  await drain(makeProvider(), [{ role: "user", content: "hi" }], {
    model: "claude-opus-4-5",
    stream: true,
    enableThinking: true,
    reasoningEffort: "xhigh",
  });

  assert.deepEqual(calls[0]!.options.thinking, { type: "adaptive" });
  assert.equal(calls[0]!.options.effort, "xhigh");
});

test("thinking_delta is forwarded to onThinking and not yielded as visible text", async () => {
  const { fake } = makeFakeSdk([
    streamEvent({ type: "thinking_delta", thinking: "considering options" }),
    streamEvent({ type: "text_delta", text: "answer" }),
    successResult(),
  ]);
  __setSdkForTesting(fake);

  const thoughts: string[] = [];
  const { text } = await drain(makeProvider(), [{ role: "user", content: "?" }], {
    model: "claude-opus-4-7",
    stream: true,
    enableThinking: true,
    onThinking: (chunk) => thoughts.push(chunk),
  });

  assert.equal(text, "answer");
  assert.deepEqual(thoughts, ["considering options"]);
});

test("apiKey on the connection is forwarded as ANTHROPIC_API_KEY env override", async () => {
  const { fake, calls } = makeFakeSdk([streamEvent({ type: "text_delta", text: "." }), successResult()]);
  __setSdkForTesting(fake);

  await drain(makeProvider("sk-ant-test"), [{ role: "user", content: "hi" }], {
    model: "claude-haiku-4-5",
    stream: true,
  });

  const env = calls[0]!.options.env as Record<string, string>;
  assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-test");
});

test("non-streaming path emits text from the final assistant message", async () => {
  const { fake } = makeFakeSdk([
    {
      type: "assistant",
      message: { content: [{ type: "text", text: "complete answer" }] },
    },
    successResult(),
  ]);
  __setSdkForTesting(fake);

  const { text } = await drain(makeProvider(), [{ role: "user", content: "hi" }], {
    model: "claude-sonnet-4-5",
    stream: false,
  });

  assert.equal(text, "complete answer");
});

test("error result message is surfaced as a thrown error with details", async () => {
  const { fake } = makeFakeSdk([
    {
      type: "result",
      subtype: "error_during_execution",
      errors: ["network glitch"],
    },
  ]);
  __setSdkForTesting(fake);

  await assert.rejects(
    () =>
      drain(makeProvider(), [{ role: "user", content: "hi" }], {
        model: "claude-opus-4-5",
        stream: true,
      }),
    /Claude \(Subscription\) request failed.*network glitch/,
  );
});

test("embed() throws — embeddings are not supported on the subscription provider", async () => {
  const provider = makeProvider();
  await assert.rejects(() => provider.embed(["hello"], "irrelevant-model"), /does not support embeddings/i);
});
