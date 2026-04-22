import test from "node:test";
import assert from "node:assert/strict";
import { buildLlamaArgs, buildLlamaStartupPlans } from "../src/services/sidecar/sidecar-launch-plan.js";

test("CPU runtimes only attempt CPU startup when gpuLayers is auto", () => {
  assert.deepEqual(buildLlamaStartupPlans({ configuredGpuLayers: -1, usesGpuRuntime: false }), [
    { gpuLayers: 0, label: "CPU runtime" },
  ]);
});

test("GPU runtimes try max offload first and then CPU fallback when gpuLayers is auto", () => {
  assert.deepEqual(buildLlamaStartupPlans({ configuredGpuLayers: -1, usesGpuRuntime: true }), [
    { gpuLayers: 999, label: "max GPU offload" },
    { gpuLayers: 0, label: "CPU fallback" },
  ]);
});

test("explicit gpuLayers disables automatic fallback planning", () => {
  assert.deepEqual(buildLlamaStartupPlans({ configuredGpuLayers: 12, usesGpuRuntime: true }), [
    { gpuLayers: 12, label: "gpuLayers=12" },
  ]);
});

test("CUDA offload attempts include split-mode disable", () => {
  assert.deepEqual(
    buildLlamaArgs({
      modelPath: "/app/data/models/gemma.gguf",
      gpuLayers: 999,
      port: 8080,
      contextSize: 8192,
      runtimeVariant: "win-x64-cuda",
    }),
    [
      "-m",
      "/app/data/models/gemma.gguf",
      "--host",
      "127.0.0.1",
      "--parallel",
      "2",
      "--ctx-size",
      "8192",
      "--port",
      "8080",
      "-sm",
      "none",
      "-ngl",
      "999",
    ],
  );
});

test("CPU fallback on a CUDA runtime does not keep split-mode disable", () => {
  assert.deepEqual(
    buildLlamaArgs({
      modelPath: "/app/data/models/gemma.gguf",
      gpuLayers: 0,
      port: 8080,
      contextSize: 8192,
      runtimeVariant: "win-x64-cuda",
    }),
    [
      "-m",
      "/app/data/models/gemma.gguf",
      "--host",
      "127.0.0.1",
      "--parallel",
      "2",
      "--ctx-size",
      "8192",
      "--port",
      "8080",
      "-ngl",
      "0",
    ],
  );
});

test("CPU runtime launches never add split-mode disable", () => {
  assert.deepEqual(
    buildLlamaArgs({
      modelPath: "/app/data/models/gemma.gguf",
      gpuLayers: 0,
      port: 8080,
      contextSize: 8192,
      runtimeVariant: "win-x64-cpu",
    }),
    [
      "-m",
      "/app/data/models/gemma.gguf",
      "--host",
      "127.0.0.1",
      "--parallel",
      "2",
      "--ctx-size",
      "8192",
      "--port",
      "8080",
      "-ngl",
      "0",
    ],
  );
});
