import test from "node:test";
import assert from "node:assert/strict";
import { parseEmbeddingResponse } from "../src/services/llm/base-provider.js";

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
