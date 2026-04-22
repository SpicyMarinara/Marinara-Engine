export type LlamaStartupPlan = {
  gpuLayers: number;
  label: string;
};

export function buildLlamaArgs(options: {
  modelPath: string;
  gpuLayers: number;
  port: number;
  contextSize: number;
  runtimeVariant: string;
}): string[] {
  const args = [
    "-m",
    options.modelPath,
    "--host",
    "127.0.0.1",
    "--parallel",
    "2",
    "--ctx-size",
    String(options.contextSize),
    "--port",
    String(options.port),
  ];

  // Gemma 4 needs split mode disabled on CUDA multi-GPU launches,
  // but non-CUDA builds may reject the flag entirely.
  if (/cuda/i.test(options.runtimeVariant) && options.gpuLayers > 0) {
    args.push("-sm", "none");
  }

  args.push("-ngl", String(options.gpuLayers));
  return args;
}

export function buildLlamaStartupPlans(options: {
  configuredGpuLayers: number;
  usesGpuRuntime: boolean;
}): LlamaStartupPlan[] {
  if (options.configuredGpuLayers !== -1) {
    return [{ gpuLayers: options.configuredGpuLayers, label: `gpuLayers=${options.configuredGpuLayers}` }];
  }

  if (!options.usesGpuRuntime) {
    return [{ gpuLayers: 0, label: "CPU runtime" }];
  }

  return [
    { gpuLayers: 999, label: "max GPU offload" },
    { gpuLayers: 0, label: "CPU fallback" },
  ];
}
