import test from "node:test";
import assert from "node:assert/strict";
import { zstdCompressSync } from "node:zlib";
import { parseEmbeddingResponse } from "../src/services/llm/base-provider.js";
import { OpenAIProvider } from "../src/services/llm/providers/openai.provider.js";

test("parseEmbeddingResponse accepts OpenAI-compatible data wrappers", () => {
  assert.deepEqual(parseEmbeddingResponse({ data: [{ embedding: [0.1, 0.2] }] }), [[0.1, 0.2]]);
});

test("parseEmbeddingResponse accepts llama.cpp /embeddings arrays", () => {
  assert.deepEqual(parseEmbeddingResponse([{ embedding: [0.3, 0.4] }]), [[0.3, 0.4]]);
});

test("parseEmbeddingResponse rejects invalid response shapes with a clear error", () => {
  assert.throws(() => parseEmbeddingResponse({ embedding: [0.1, 0.2] }), /embedding array/i);
  assert.throws(() => parseEmbeddingResponse({ data: [{ value: [0.1, 0.2] }] }), /invalid embedding item/i);
});

test("embed decodes raw zstd JSON without content-encoding", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalUrls = process.env.PROVIDER_LOCAL_URLS_ENABLED;

  globalThis.fetch = async () =>
    new Response(
      zstdCompressSync(
        Buffer.from(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2] }],
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
    const provider = new OpenAIProvider("https://api.venice.ai/api/v1", "test-key");

    assert.deepEqual(await provider.embed(["hello"], "embedding-model"), [[0.1, 0.2]]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalUrls === undefined) {
      delete process.env.PROVIDER_LOCAL_URLS_ENABLED;
    } else {
      process.env.PROVIDER_LOCAL_URLS_ENABLED = originalLocalUrls;
    }
  }
});
