import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "../src/services/llm/providers/anthropic.provider.js";
import type { ChatOptions } from "../src/services/llm/base-provider.js";

async function captureRequestBody(overrides: Partial<ChatOptions> = {}) {
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
