import test from "node:test";
import assert from "node:assert/strict";
import { isLikelyMmprojModelPath, isSupportedLlamaCppModelFilename } from "../src/services/sidecar/sidecar-model-files.js";

test("rejects mmproj GGUF files as main llama.cpp models", () => {
  assert.equal(isLikelyMmprojModelPath("unslothgemma-4-E2B-it-GGUFmmproj-BF16.gguf"), true);
  assert.equal(isSupportedLlamaCppModelFilename("custom/mmproj-model.gguf"), false);
});

test("accepts normal GGUF model filenames", () => {
  assert.equal(isSupportedLlamaCppModelFilename("gemma-4-E2B-it-Q4_K_M.gguf"), true);
});
