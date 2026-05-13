import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { MODEL_LISTS } from "../../shared/src/constants/model-lists.ts";
import { createLLMProvider } from "../src/services/llm/provider-registry.js";
import { OpenAIProvider } from "../src/services/llm/providers/openai.provider.js";
import type { ChatMessage, ChatOptions } from "../src/services/llm/base-provider.js";

async function captureChatRequestBody(
  model: string,
  overrides: Partial<ChatOptions> = {},
  baseUrl = "https://example.com/v1",
  provider = new OpenAIProvider(baseUrl, "test-key"),
) {
  const request = await captureChatRequest(model, overrides, baseUrl, provider);
  return request.body;
}

async function captureChatRequest(
  model: string,
  overrides: Partial<ChatOptions> = {},
  baseUrl = "https://example.com/v1",
  provider = new OpenAIProvider(baseUrl, "test-key"),
) {
  const requests: Array<Record<string, unknown>> = [];
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalLocalUrls = process.env.PROVIDER_LOCAL_URLS_ENABLED;

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
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
  assert.equal(urls.length, 1);
  return { url: urls[0]!, body: requests[0]! };
}

async function captureChatRequestBodyForMessages(
  messages: ChatMessage[],
  model: string,
  overrides: Partial<ChatOptions> = {},
  baseUrl = "https://example.com/v1",
  provider = new OpenAIProvider(baseUrl, "test-key"),
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
    for await (const _ of provider.chat(messages, {
      model,
      stream: false,
      maxTokens: 512,
      reasoningEffort: "high",
      ...overrides,
    })) {
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
  provider = new OpenAIProvider(baseUrl, "test-key"),
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

test("GLM models on native Z.AI endpoints still use enable_thinking for provider routes", async () => {
  const body = await captureChatRequestBody("glm-4.5", {}, "https://api.z.ai/api/paas/v4");

  assert.equal(body.enable_thinking, true);
  assert.equal("reasoning_effort" in body, false);
});

test("NanoGPT GLM models explicitly disable thinking when reasoning is off", async () => {
  const provider = createLLMProvider("nanogpt", "https://nano-gpt.com/api/v1", "test-key");
  const body = await captureChatRequestBody(
    "glm-5.1",
    { reasoningEffort: undefined },
    "https://nano-gpt.com/api/v1",
    provider,
  );

  assert.equal(body.enable_thinking, false);
  assert.equal("reasoning_effort" in body, false);
});

test("NanoGPT GLM chatComplete requests explicitly disable thinking when reasoning is off", async () => {
  const provider = createLLMProvider("nanogpt", "https://nano-gpt.com/api/v1", "test-key");
  const body = await captureChatCompleteRequestBody(
    "glm-5.1",
    { reasoningEffort: undefined },
    "https://nano-gpt.com/api/v1",
    provider,
  );

  assert.equal(body.enable_thinking, false);
  assert.equal("reasoning_effort" in body, false);
});

test("custom compatible endpoints omit enable_thinking even on native Z.AI URLs", async () => {
  const provider = createLLMProvider("custom", "https://api.z.ai/api/paas/v4", "test-key");
  const body = await captureChatRequestBody("glm-4.5", {}, "https://api.z.ai/api/paas/v4", provider);

  assert.equal("enable_thinking" in body, false);
  assert.equal("reasoning_effort" in body, false);
});

test("GLM native endpoint detection ignores host-like URL path and query strings", async () => {
  const adversarialUrl = "https://example.com/api.z.ai/v1?next=https://open.bigmodel.cn/api/paas/v4";

  const chatBody = await captureChatRequestBody("glm-4.5", {}, adversarialUrl);
  const completeBody = await captureChatCompleteRequestBody("glm-4.5", {}, adversarialUrl);

  assert.equal("enable_thinking" in chatBody, false);
  assert.equal("reasoning_effort" in chatBody, false);
  assert.equal("enable_thinking" in completeBody, false);
  assert.equal("reasoning_effort" in completeBody, false);
});

test("GLM-named models on custom compatible endpoints omit enable_thinking", async () => {
  const provider = createLLMProvider("custom", "https://api.venice.ai/api/v1", "test-key");
  const body = await captureChatRequestBody("zai-org-glm-5-1", {}, "https://api.venice.ai/api/v1", provider);

  assert.equal("enable_thinking" in body, false);
  assert.equal("reasoning_effort" in body, false);
});

test("GLM-named chatComplete requests on custom compatible endpoints omit enable_thinking", async () => {
  const provider = createLLMProvider("custom", "https://api.venice.ai/api/v1", "test-key");
  const body = await captureChatCompleteRequestBody("zai-org-glm-5-1", {}, "https://api.venice.ai/api/v1", provider);

  assert.equal("enable_thinking" in body, false);
  assert.equal("reasoning_effort" in body, false);
});

test("custom compatible endpoints keep OpenAI reasoning model names on a standard body", async () => {
  const provider = createLLMProvider("custom", "https://example.com/v1", "test-key");
  const body = await captureChatRequestBody("o3-mini", {}, "https://example.com/v1", provider);

  assert.equal(body.max_tokens, 512);
  assert.equal("max_completion_tokens" in body, false);
  assert.equal("reasoning_effort" in body, false);
  assert.equal("enable_thinking" in body, false);
});

test("custom compatible GPT-5.5 endpoints stay on Chat Completions", async () => {
  const provider = createLLMProvider("custom", "https://example.com/v1", "test-key");
  const request = await captureChatRequest(
    "gpt-5.5",
    { reasoningEffort: "xhigh", verbosity: "high", temperature: 0.7, topP: 0.9 },
    "https://example.com/v1",
    provider,
  );
  const body = request.body;

  assert.equal(request.url, "https://example.com/v1/chat/completions");
  assert.equal(body.stream, false);
  assert.equal(body.max_completion_tokens, 512);
  assert.deepEqual(body.messages, [{ role: "user", content: "Hello" }]);
  assert.equal("stream_options" in body, false);
  assert.equal("max_tokens" in body, false);
  assert.equal("max_output_tokens" in body, false);
  assert.equal("input" in body, false);
  assert.equal("reasoning" in body, false);
  assert.equal("text" in body, false);
  assert.equal(body.reasoning_effort, "xhigh");
  assert.equal("temperature" in body, false);
  assert.equal("top_p" in body, false);
});

test("custom compatible streams accept SSE data lines without a space", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalUrls = process.env.PROVIDER_LOCAL_URLS_ENABLED;
  const encoder = new TextEncoder();
  const makeResponse = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data:{"choices":[{"delta":{"content":"hel"}}]}\n\n'));
          controller.enqueue(encoder.encode('data:{"choices":[{"delta":{"content":"lo"}}]}\n\n'));
          controller.enqueue(encoder.encode("data:[DONE]\n\n"));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );

  globalThis.fetch = async () => makeResponse();

  try {
    process.env.PROVIDER_LOCAL_URLS_ENABLED = "true";
    const provider = createLLMProvider("custom", "https://example.com/v1", "test-key");
    const streamedChunks: string[] = [];
    for await (const chunk of provider.chat([{ role: "user", content: "Hello" }], {
      model: "llama.cpp-model",
      stream: true,
      maxTokens: 512,
    })) {
      streamedChunks.push(chunk);
    }
    assert.equal(streamedChunks.join(""), "hello");

    const tokenChunks: string[] = [];
    const result = await provider.chatComplete([{ role: "user", content: "Hello" }], {
      model: "llama.cpp-model",
      stream: true,
      maxTokens: 512,
      onToken: (chunk) => tokenChunks.push(chunk),
    });
    assert.equal(tokenChunks.join(""), "hello");
    assert.equal(result.content, "hello");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalUrls === undefined) {
      delete process.env.PROVIDER_LOCAL_URLS_ENABLED;
    } else {
      process.env.PROVIDER_LOCAL_URLS_ENABLED = originalLocalUrls;
    }
  }
});

test("OpenRouter non-stream chat decodes raw gzip JSON without content-encoding", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalUrls = process.env.PROVIDER_LOCAL_URLS_ENABLED;

  globalThis.fetch = async () =>
    new Response(
      gzipSync(
        Buffer.from(
          JSON.stringify({
            choices: [{ message: { content: "decoded" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        ),
      ),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    process.env.PROVIDER_LOCAL_URLS_ENABLED = "true";
    const provider = new OpenAIProvider("https://openrouter.ai/api/v1", "test-key");
    const chunks: string[] = [];
    for await (const chunk of provider.chat([{ role: "user", content: "Hello" }], {
      model: "deepseek/deepseek-v4-pro",
      stream: false,
      maxTokens: 512,
    })) {
      chunks.push(chunk);
    }

    assert.equal(chunks.join(""), "decoded");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalUrls === undefined) {
      delete process.env.PROVIDER_LOCAL_URLS_ENABLED;
    } else {
      process.env.PROVIDER_LOCAL_URLS_ENABLED = originalLocalUrls;
    }
  }
});

test("custom parameters can opt custom endpoints into provider-specific fields", async () => {
  const provider = createLLMProvider("custom", "https://api.venice.ai/api/v1", "test-key");
  const body = await captureChatRequestBody(
    "zai-org-glm-5-1",
    { customParameters: { enable_thinking: true } },
    "https://api.venice.ai/api/v1",
    provider,
  );

  assert.equal(body.enable_thinking, true);
});

test("OpenAI reasoning models still receive reasoning_effort", async () => {
  const body = await captureChatRequestBody("o3-mini");

  assert.equal(body.reasoning_effort, "high");
  assert.equal("enable_thinking" in body, false);
});

test("OpenRouter Claude models receive unified reasoning config", async () => {
  const body = await captureChatRequestBody("anthropic/claude-sonnet-4.6", {}, "https://openrouter.ai/api/v1");

  assert.deepEqual(body.reasoning, { effort: "high" });
  assert.equal("reasoning_effort" in body, false);
  assert.equal("enable_thinking" in body, false);
});

test("OpenRouter Claude chatComplete receives unified reasoning config", async () => {
  const body = await captureChatCompleteRequestBody(
    "anthropic/claude-opus-4.7",
    { reasoningEffort: "xhigh" },
    "https://openrouter.ai/api/v1",
  );

  assert.deepEqual(body.reasoning, { effort: "xhigh" });
  assert.equal("reasoning_effort" in body, false);
  assert.equal("enable_thinking" in body, false);
});

test("gpt-5.5 routes chat through Responses reasoning and text payloads", async () => {
  const body = await captureChatRequestBody("gpt-5.5", {
    reasoningEffort: "xhigh",
    verbosity: "high",
  });

  assert.equal(body.model, "gpt-5.5");
  assert.equal(body.stream, false);
  assert.equal(body.store, false);
  assert.deepEqual(body.input, [{ role: "user", content: "Hello" }]);
  assert.equal(body.max_output_tokens, 512);
  assert.deepEqual(body.reasoning, { effort: "xhigh" });
  assert.deepEqual(body.text, { verbosity: "high" });
  assert.equal("messages" in body, false);
  assert.equal("reasoning_effort" in body, false);
  assert.equal("verbosity" in body, false);
  assert.equal("max_completion_tokens" in body, false);
});

test("gpt-5.5 omits Responses sampling parameters even without reasoning effort", async () => {
  const body = await captureChatRequestBody("gpt-5.5", {
    reasoningEffort: undefined,
    temperature: 0.7,
    topP: 0.9,
    frequencyPenalty: 0.2,
    presencePenalty: 0.3,
  });

  assert.equal(body.model, "gpt-5.5");
  assert.equal(body.max_output_tokens, 512);
  assert.equal("reasoning" in body, false);
  assert.equal("temperature" in body, false);
  assert.equal("top_p" in body, false);
  assert.equal("frequency_penalty" in body, false);
  assert.equal("presence_penalty" in body, false);
});

test("gpt-5.5 routes chatComplete through Responses without Chat Completions streaming extras", async () => {
  const body = await captureChatCompleteRequestBody("gpt-5.5", {
    reasoningEffort: "xhigh",
    verbosity: "high",
  });

  assert.equal(body.model, "gpt-5.5");
  assert.equal(body.stream, false);
  assert.equal(body.max_output_tokens, 512);
  assert.deepEqual(body.reasoning, { effort: "xhigh" });
  assert.deepEqual(body.text, { verbosity: "high" });
  assert.equal("stream_options" in body, false);
  assert.equal("messages" in body, false);
  assert.equal("reasoning_effort" in body, false);
  assert.equal("verbosity" in body, false);
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

test("OpenRouter Claude replays reasoning_details without plaintext reasoning", async () => {
  const reasoningDetails = [{ type: "reasoning.text", index: 0, text: "I should infer quietly." }];
  const body = await captureChatRequestBodyForMessages(
    [
      {
        role: "assistant",
        content: "The answer arrives.",
        providerMetadata: {
          reasoning: "I should infer quietly.",
          reasoning_details: reasoningDetails,
        },
      },
      { role: "user", content: "Continue." },
    ],
    "anthropic/claude-opus-4.6",
    {},
    "https://openrouter.ai/api/v1",
  );

  const messages = body.messages as Array<Record<string, unknown>>;
  assert.deepEqual(messages[0]?.reasoning_details, reasoningDetails);
  assert.equal("reasoning" in messages[0]!, false);
});

test("OpenRouter Claude does not replay plaintext reasoning without reasoning_details", async () => {
  const body = await captureChatRequestBodyForMessages(
    [
      {
        role: "assistant",
        content: "The answer arrives.",
        providerMetadata: { reasoning: "Visible reasoning without replay details." },
      },
      { role: "user", content: "Continue." },
    ],
    "anthropic/claude-opus-4.6",
    {},
    "https://openrouter.ai/api/v1",
  );

  const messages = body.messages as Array<Record<string, unknown>>;
  assert.equal("reasoning" in messages[0]!, false);
  assert.equal("reasoning_details" in messages[0]!, false);
});

test("OpenRouter Claude streamed reasoning_details fragments are merged for replay", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalUrls = process.env.PROVIDER_LOCAL_URLS_ENABLED;

  globalThis.fetch = async () =>
    new Response(
      [
        'data: {"choices":[{"delta":{"reasoning":"First ","reasoning_details":[{"type":"reasoning.text","index":0,"text":"First "}]},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"reasoning":"second.","reasoning_details":[{"type":"reasoning.text","index":0,"text":"second."}],"content":"ok"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
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
    const result = await provider.chatComplete([{ role: "user", content: "Think." }], {
      model: "anthropic/claude-opus-4.6",
      stream: true,
      maxTokens: 512,
      reasoningEffort: "high",
    });

    assert.equal(result.providerMetadata?.reasoning, "First second.");
    assert.deepEqual(result.providerMetadata?.reasoning_details, [
      { type: "reasoning.text", index: 0, text: "First second." },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalUrls === undefined) {
      delete process.env.PROVIDER_LOCAL_URLS_ENABLED;
    } else {
      process.env.PROVIDER_LOCAL_URLS_ENABLED = originalLocalUrls;
    }
  }
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

test("OpenAI ChatGPT responses requests omit unsupported Codex parameters", () => {
  const provider = new OpenAIProvider(
    "https://chatgpt.com/backend-api/codex",
    "test-key",
    undefined,
    null,
    null,
    "openai-chatgpt",
  ) as any;
  const body = provider.buildResponsesBody([{ role: "user", content: "Hello" }], {
    model: "gpt-5.2",
    stream: false,
    maxTokens: 128,
    temperature: 0.7,
    topP: 0.9,
    reasoningEffort: "high",
    enableThinking: true,
    verbosity: "medium",
  } satisfies ChatOptions) as Record<string, unknown>;

  assert.equal(body.stream, true);
  assert.equal(body.instructions, "You are a helpful assistant.");
  assert.equal("max_output_tokens" in body, false);
  assert.equal(body.store, false);
  assert.equal("include" in body, false);
  assert.equal("temperature" in body, false);
  assert.equal("top_p" in body, false);
  assert.equal("reasoning" in body, false);
  assert.equal("text" in body, false);
});

test("OpenAI ChatGPT chatComplete decodes SSE when caller requests non-streaming", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  const originalLocalUrls = process.env.PROVIDER_LOCAL_URLS_ENABLED;

  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(
      [
        'data: {"type":"response.output_text.delta","delta":"hel"}',
        'data: {"type":"response.output_text.delta","delta":"lo"}',
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"hello"}]}]}}',
        "data: [DONE]",
        "",
      ].join("\n"),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };

  try {
    process.env.PROVIDER_LOCAL_URLS_ENABLED = "true";
    const provider = new OpenAIProvider(
      "https://chatgpt.com/backend-api/codex",
      "test-key",
      undefined,
      null,
      null,
      "openai-chatgpt",
    );
    const result = await provider.chatComplete([{ role: "user", content: "Hi" }], {
      model: "gpt-5.2",
      stream: false,
      maxTokens: 128,
    });

    assert.equal(result.content, "hello");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.stream, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalUrls === undefined) {
      delete process.env.PROVIDER_LOCAL_URLS_ENABLED;
    } else {
      process.env.PROVIDER_LOCAL_URLS_ENABLED = originalLocalUrls;
    }
  }
});

test("responses requests translate responseFormat to text.format", () => {
  const provider = new OpenAIProvider("https://example.com/v1", "test-key") as any;
  const body = provider.buildResponsesBody([{ role: "user", content: "Return JSON." }], {
    model: "gpt-5.5",
    stream: false,
    maxTokens: 128,
    verbosity: "medium",
    responseFormat: { type: "json_object" },
  } satisfies ChatOptions) as Record<string, unknown>;

  assert.deepEqual(body.text, { verbosity: "medium", format: { type: "json_object" } });
  assert.equal("response_format" in body, false);
});
