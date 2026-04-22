import test from "node:test";
import assert from "node:assert/strict";
import { resolveSidecarRequestModel } from "../src/services/sidecar/sidecar-request-model.js";

test("uses the configured Hugging Face repo for MLX requests", () => {
  assert.equal(
    resolveSidecarRequestModel("mlx", "mlx-community/gemma-4-e2b-it-4bit"),
    "mlx-community/gemma-4-e2b-it-4bit",
  );
});

test("keeps the synthetic local model name for llama.cpp requests", () => {
  assert.equal(
    resolveSidecarRequestModel("llama_cpp", "/app/data/models/gemma-4-E2B-it-Q8_0.gguf"),
    "local-sidecar",
  );
});

test("falls back to the synthetic local model name when no MLX repo is configured", () => {
  assert.equal(resolveSidecarRequestModel("mlx", null), "local-sidecar");
});
