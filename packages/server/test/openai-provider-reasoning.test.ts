import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_LISTS } from "../../shared/src/constants/model-lists.ts";
import { OpenAIProvider } from "../src/services/llm/providers/openai.provider.js";
import type { ChatOptions } from "../src/services/llm/base-provider.js";

async function captureChatRequestBody(
  model: string,
  overrides: Partial<ChatOptions> = {},
  baseUrl = "https://example.com/v1",
) {
  const requests: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  const originalLocalUrls = process.env.PROVIDER_LOCAL_URLS_ENABLED;

  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    process.env.PROVIDER_LOCAL_URLS_ENABLED = "true";
    const provider = new OpenAIProvider(baseUrl, "test-key");
    const options: ChatOptions = {
      model,
      stream: false,
      maxTokens: 512,
      reasoningEffort: "high",
      ...overrides,
    };

    for await (const _ of provider.chat([{ role: "user", content: "Hello" }], options)) {
      // Consume the non-streaming generator.
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalUrls === undefined) {
      delete process.env.PROVIDER_LOCAL_URLS_ENABLED;
    } else {
      process.env.PROVIDER_LOCAL_URLS_ENABLED = originalLocalUrls;
    }
  }

  assert.equal(requests.length, 1);
  return requests[0]!;
}

async function captureChatCompleteRequestBody(
  model: string,
  overrides: Partial<ChatOptions> = {},
  baseUrl = "https://example.com/v1",
) {
  const requests: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  const originalLocalUrls = process.env.PROVIDER_LOCAL_URLS_ENABLED;

  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(
      [
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
        "data: [DONE]",
        "",
      ].join("\n"),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  };

  try {
    process.env.PROVIDER_LOCAL_URLS_ENABLED = "true";
    const provider = new OpenAIProvider(baseUrl, "test-key");
    const options: ChatOptions = {
      model,
      stream: false,
      maxTokens: 512,
      reasoningEffort: "high",
      ...overrides,
    };

    await provider.chatComplete([{ role: "user", content: "Hello" }], options);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalUrls === undefined) {
      delete process.env.PROVIDER_LOCAL_URLS_ENABLED;
    } else {
      process.env.PROVIDER_LOCAL_URLS_ENABLED = originalLocalUrls;
    }
  }

  assert.equal(requests.length, 1);
  return requests[0]!;
}

test("non-reasoning models do not receive reasoning payloads", async () => {
  const body = await captureChatRequestBody("mistral-small-latest");

  assert.equal("reasoning_effort" in body, false);
  assert.equal("enable_thinking" in body, false);
});

test("GLM models still use enable_thinking", async () => {
  const body = await captureChatRequestBody("glm-4.5");

  assert.equal(body.enable_thinking, true);
  assert.equal("reasoning_effort" in body, false);
});

test("OpenAI reasoning models still receive reasoning_effort", async () => {
  const body = await captureChatRequestBody("o3-mini");

  assert.equal(body.reasoning_effort, "high");
  assert.equal("enable_thinking" in body, false);
});

test("gpt-5.5 uses Chat Completions reasoning and verbosity payloads", async () => {
  const body = await captureChatRequestBody("gpt-5.5", {
    reasoningEffort: "xhigh",
    verbosity: "high",
  });

  assert.equal(body.model, "gpt-5.5");
  assert.equal(body.stream, true);
  assert.equal(body.reasoning_effort, "xhigh");
  assert.equal(body.verbosity, "high");
  assert.equal("reasoning" in body, false);
  assert.equal("text" in body, false);
});

test("gpt-5.5 chatComplete forces streaming and keeps generation parameters", async () => {
  const body = await captureChatCompleteRequestBody("gpt-5.5", {
    reasoningEffort: "xhigh",
    verbosity: "high",
  });

  assert.equal(body.model, "gpt-5.5");
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.reasoning_effort, "xhigh");
  assert.equal(body.verbosity, "high");
});

test("assistant reasoning_content metadata is replayed on Chat Completions messages", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  const originalLocalUrls = process.env.PROVIDER_LOCAL_URLS_ENABLED;

  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    process.env.PROVIDER_LOCAL_URLS_ENABLED = "true";
    const provider = new OpenAIProvider("https://openrouter.ai/api/v1", "test-key");
    for await (const _ of provider.chat(
      [
        {
          role: "assistant",
          content: "Let me check that.",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }],
          providerMetadata: { reasoning_content: "I need the lookup tool first." },
        },
        { role: "tool", content: "done", tool_call_id: "call_1" },
        { role: "user", content: "Continue." },
      ],
      { model: "deepseek/deepseek-v4-pro", stream: false, maxTokens: 512 },
    )) {
      // Consume the non-streaming generator.
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalUrls === undefined) {
      delete process.env.PROVIDER_LOCAL_URLS_ENABLED;
    } else {
      process.env.PROVIDER_LOCAL_URLS_ENABLED = originalLocalUrls;
    }
  }

  const messages = requests[0]?.messages as Array<Record<string, unknown>>;
  assert.equal(messages[0]?.reasoning_content, "I need the lookup tool first.");
});

test("chatComplete returns streamed reasoning_content metadata with tool calls", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalUrls = process.env.PROVIDER_LOCAL_URLS_ENABLED;

  globalThis.fetch = async () =>
    new Response(
      [
        'data: {"choices":[{"delta":{"reasoning_content":"I should call the tool."},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
        "data: [DONE]",
        "",
      ].join("\n"),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      },
    );

  try {
    process.env.PROVIDER_LOCAL_URLS_ENABLED = "true";
    const provider = new OpenAIProvider("https://openrouter.ai/api/v1", "test-key");
    const result = await provider.chatComplete([{ role: "user", content: "Need a lookup." }], {
      model: "deepseek/deepseek-v4-pro",
      stream: true,
      maxTokens: 512,
      tools: [{ type: "function", function: { name: "lookup", description: "Lookup", parameters: {} } }],
    });

    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.toolCalls[0]?.id, "call_1");
    assert.equal(result.providerMetadata?.reasoning_content, "I should call the tool.");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalUrls === undefined) {
      delete process.env.PROVIDER_LOCAL_URLS_ENABLED;
    } else {
      process.env.PROVIDER_LOCAL_URLS_ENABLED = originalLocalUrls;
    }
  }
});

test("gpt-5.5 is included in both OpenAI and OAI-compatible selector model lists", () => {
  assert.ok(MODEL_LISTS.openai.some((model) => model.id === "gpt-5.5"));
  assert.ok(MODEL_LISTS.custom.some((model) => model.id === "gpt-5.5"));
});

test("responses reasoning config is omitted for non-reasoning models", () => {
  const provider = new OpenAIProvider("https://example.com/v1", "test-key") as any;
  const body = provider.buildResponsesBody([{ role: "user", content: "Hello" }], {
    model: "mistral-small-latest",
    stream: false,
    reasoningEffort: "high",
    enableThinking: true,
  } satisfies ChatOptions) as Record<string, unknown>;

  assert.equal("reasoning" in body, false);
  assert.equal("enable_thinking" in body, false);
});

test("responses requests include fallback input for system-only prompts", () => {
  const provider = new OpenAIProvider("https://example.com/v1", "test-key") as any;
  const body = provider.buildResponsesBody([{ role: "system", content: "You are helpful." }], {
    model: "gpt-5.4",
    stream: false,
    maxTokens: 128,
  } satisfies ChatOptions) as Record<string, unknown>;

  assert.equal(body.instructions, "You are helpful.");
  assert.deepEqual(body.input, [{ role: "user", content: "Continue." }]);
});
