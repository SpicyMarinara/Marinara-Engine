import test from "node:test";
import assert from "node:assert/strict";
import { zstdCompressSync } from "node:zlib";
import { AnthropicProvider } from "../src/services/llm/providers/anthropic.provider.js";
import type { ChatOptions } from "../src/services/llm/base-provider.js";

async function captureRequestBody(
  overrides: Partial<ChatOptions> = {},
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [{ role: "user", content: "Hello" }],
) {
  const requests: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  const originalLocalUrls = process.env.PROVIDER_LOCAL_URLS_ENABLED;

  globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    process.env.PROVIDER_LOCAL_URLS_ENABLED = "true";
    const provider = new AnthropicProvider("https://api.anthropic.com/v1", "test-key");
    const options: ChatOptions = {
      model: "claude-opus-4-7",
      stream: false,
      maxTokens: 8192,
      temperature: 0.2,
      topK: 5,
      enableThinking: true,
      reasoningEffort: "high",
      ...overrides,
    };

    for await (const _ of provider.chat(messages, options)) {
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

test("Claude Opus 4.7 uses adaptive thinking with effort and no budget tokens", async () => {
  const body = await captureRequestBody();

  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.output_config, { effort: "high" });
  assert.equal("temperature" in body, false);
  assert.equal("top_k" in body, false);
  assert.equal("top_p" in body, false);
});

test("Claude Opus 4.7 forwards xhigh effort and summarized thinking display when requested", async () => {
  const body = await captureRequestBody({
    reasoningEffort: "xhigh",
    onThinking: () => {},
  });

  assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
  assert.deepEqual(body.output_config, { effort: "xhigh" });
});

test("Anthropic prompt caching uses configured conversation depth", async () => {
  const body = await captureRequestBody(
    {
      enableCaching: true,
      cachingAtDepth: 2,
    },
    [
      { role: "system", content: "System instructions" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "u3" },
    ],
  );

  assert.deepEqual(body.system, [{ type: "text", text: "System instructions", cache_control: { type: "ephemeral" } }]);

  const messages = body.messages as Array<{ role: string; content: unknown }>;
  assert.deepEqual(messages[2]?.content, [{ type: "text", text: "u2", cache_control: { type: "ephemeral" } }]);
  assert.equal(messages[4]?.content, "u3");
});

test("Anthropic non-stream chat decodes raw zstd JSON without content-encoding", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalUrls = process.env.PROVIDER_LOCAL_URLS_ENABLED;

  globalThis.fetch = async () =>
    new Response(
      zstdCompressSync(
        Buffer.from(
          JSON.stringify({
            content: [{ type: "text", text: "decoded from zstd" }],
            usage: { input_tokens: 1, output_tokens: 1 },
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
    const provider = new AnthropicProvider("https://api.anthropic.com/v1", "test-key");
    const chunks: string[] = [];

    for await (const chunk of provider.chat([{ role: "user", content: "Hello" }], {
      model: "claude-sonnet-4-5",
      stream: false,
      maxTokens: 512,
    })) {
      chunks.push(chunk);
    }

    assert.equal(chunks.join(""), "decoded from zstd");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalUrls === undefined) {
      delete process.env.PROVIDER_LOCAL_URLS_ENABLED;
    } else {
      process.env.PROVIDER_LOCAL_URLS_ENABLED = originalLocalUrls;
    }
  }
});
