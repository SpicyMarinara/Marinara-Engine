// ──────────────────────────────────────────────
// Model Download Modal
//
// Handles curated Gemma downloads plus BYO
// HuggingFace model selection for the local
// sidecar runtime.
// ──────────────────────────────────────────────

import { useEffect, useState } from "react";
import { BrainCircuit, Check, ChevronDown, ChevronUp, Download, HardDrive, Loader2, MessageSquare, Search, Server, Settings2, X, Zap } from "lucide-react";
import type { SidecarBackend, SidecarQuantization, SidecarRuntimePreference } from "@marinara-engine/shared";
import { Modal } from "../ui/Modal.js";
import { useSidecarStore } from "../../stores/sidecar.store.js";

interface Props {
  open: boolean;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function formatQuantizationLabel(quantization: SidecarQuantization | null, backend: SidecarBackend): string {
  if (backend === "mlx") {
    return quantization === "q4_k_m" ? "4-bit" : "8-bit";
  }
  return quantization?.toUpperCase() ?? "Curated";
}

function formatRuntimeVariantLabel(variant: string | null): string | null {
  if (!variant) return null;
  return variant.replace(/-/g, " ");
}

function formatRuntimePreferenceLabel(preference: SidecarRuntimePreference): string {
  switch (preference) {
    case "auto":
      return "Auto detect";
    case "nvidia":
      return "NVIDIA GPU (CUDA)";
    case "amd":
      return "AMD GPU";
    case "intel":
      return "Intel GPU";
    case "vulkan":
      return "Vulkan GPU";
    case "cpu":
      return "CPU only";
    case "system":
      return "System llama-server";
    default:
      return preference;
  }
}

function describeGpuLayers(gpuLayers: number): string {
  if (gpuLayers === -1) return "Auto offload";
  if (gpuLayers === 0) return "CPU only";
  return `${gpuLayers} GPU layers`;
}

function formatCompactTokens(value: number): string {
  if (value >= 1000) {
    const shortened = value / 1000;
    return `${Number.isInteger(shortened) ? shortened.toFixed(0) : shortened.toFixed(1)}k`;
  }
  return String(value);
}

function getRuntimePreferenceOptions(platform: string, arch: string): SidecarRuntimePreference[] {
  if (platform === "win32" && arch === "x64") {
    return ["auto", "nvidia", "amd", "intel", "vulkan", "cpu", "system"];
  }

  if (platform === "linux" && arch === "x64") {
    return ["auto", "nvidia", "amd", "intel", "vulkan", "cpu", "system"];
  }

  if (platform === "linux" && arch === "arm64") {
    return ["auto", "vulkan", "cpu", "system"];
  }

  if (platform === "win32" && arch === "arm64") {
    return ["auto", "cpu", "system"];
  }

  if (platform === "darwin" && arch === "x64") {
    return ["auto", "cpu", "system"];
  }

  if (platform === "android") {
    return ["auto", "cpu"];
  }

  return ["auto", "cpu", "system"];
}

function ResponseBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
        {label}
      </div>
      <div className="rounded-lg bg-[var(--secondary)] p-3 text-sm leading-relaxed text-[var(--foreground)]">
        {value}
      </div>
    </div>
  );
}

export function ModelDownloadModal({ open, onClose }: Props) {
  const {
    status,
    config,
    modelDownloaded,
    modelDisplayName,
    runtime,
    inferenceReady,
    logPath,
    startupError,
    failedRuntimeVariant,
    runtimeDiagnostics,
    platform,
    arch,
    curatedModels,
    downloadProgress,
    customModels,
    customModelsLoading,
    customModelsError,
    startDownload,
    startCustomDownload,
    listHuggingFaceModels,
    clearCustomModels,
    cancelDownload,
    restartRuntime,
    installRuntime,
    sendTestMessage,
    testMessagePending,
    testMessageResult,
    reinstallRuntime,
    updateConfig,
    markPrompted,
    fetchStatus,
  } = useSidecarStore();

  const isAppleSilicon = platform === "darwin" && arch === "arm64";
  const defaultCustomRepo = isAppleSilicon ? "mlx-community/gemma-4-e2b-it-4bit" : "unsloth/gemma-4-E2B-it-GGUF";
  const [selectedQuant, setSelectedQuant] = useState<SidecarQuantization>("q8_0");
  const [repoInput, setRepoInput] = useState(config.customModelRepo ?? "");
  const [selectedCustomPath, setSelectedCustomPath] = useState("");
  const [showRuntimeSettings, setShowRuntimeSettings] = useState(false);
  const [gpuLayersInput, setGpuLayersInput] = useState(config.gpuLayers > 0 ? String(config.gpuLayers) : "");
  const [gpuLayersModeDraft, setGpuLayersModeDraft] = useState<"auto" | "cpu" | "custom">(
    config.gpuLayers === -1 ? "auto" : config.gpuLayers === 0 ? "cpu" : "custom",
  );
  const [contextSizeInput, setContextSizeInput] = useState(String(config.contextSize));
  const [maxTokensInput, setMaxTokensInput] = useState(String(config.maxTokens));
  const [temperatureInput, setTemperatureInput] = useState(String(config.temperature));
  const [topPInput, setTopPInput] = useState(String(config.topP));
  const [topKInput, setTopKInput] = useState(String(config.topK));

  const activeBackend = runtime.backend ?? config.backend;
  const isSystemRuntime = runtime.source === "system";
  const canReinstallRuntime = !isSystemRuntime;
  const selectedPreset =
    curatedModels.find((model) => model.quantization === selectedQuant) ?? curatedModels[0] ?? null;
  const selectedCustomEntry =
    customModels.find((entry) => entry.path === selectedCustomPath) ?? customModels[0] ?? null;
  const isCustomRepoValidated = selectedCustomEntry?.path === repoInput.trim();
  const isDownloading = downloadProgress?.status === "downloading";
  const hasModel = modelDownloaded;
  const activeModelName = hasModel ? modelDisplayName : null;
  const shouldAutoStart = config.useForTrackers || config.useForGameScene;
  const isBlockingSetup = isDownloading || status === "downloading_runtime";
  const isPreparingServer = runtime.installed && hasModel && shouldAutoStart && !inferenceReady && status === "starting_server";
  const showSetupProgress = isBlockingSetup || isPreparingServer;
  const canFinish = status === "ready" && inferenceReady;
  const runtimePreferenceOptions = getRuntimePreferenceOptions(platform, arch);
  const gpuLayersMode = gpuLayersModeDraft;
  const quickRuntimeSummary =
    activeBackend === "mlx"
      ? `MLX runtime • ${formatCompactTokens(config.contextSize)} ctx • ${formatCompactTokens(config.maxTokens)} max`
      : `${formatRuntimePreferenceLabel(config.runtimePreference)} • ${describeGpuLayers(config.gpuLayers)} • ${formatCompactTokens(config.contextSize)} ctx • ${formatCompactTokens(config.maxTokens)} max`;

  useEffect(() => {
    if (!open) {
      clearCustomModels();
      return;
    }

    void fetchStatus();
    if (config.customModelRepo) {
      setRepoInput(config.customModelRepo);
    } else {
      setRepoInput(defaultCustomRepo);
    }
  }, [open, config.customModelRepo, defaultCustomRepo, fetchStatus, clearCustomModels]);

  useEffect(() => {
    if (curatedModels.length > 0 && !curatedModels.some((model) => model.quantization === selectedQuant)) {
      setSelectedQuant(curatedModels[0]!.quantization);
    }
  }, [curatedModels, selectedQuant]);

  useEffect(() => {
    if (customModels.length > 0 && !customModels.some((entry) => entry.path === selectedCustomPath)) {
      setSelectedCustomPath(customModels[0]!.path);
    }
  }, [customModels, selectedCustomPath]);

  useEffect(() => {
    setGpuLayersInput(config.gpuLayers > 0 ? String(config.gpuLayers) : "");
    setGpuLayersModeDraft(config.gpuLayers === -1 ? "auto" : config.gpuLayers === 0 ? "cpu" : "custom");
  }, [config.gpuLayers]);

  useEffect(() => {
    setContextSizeInput(String(config.contextSize));
    setMaxTokensInput(String(config.maxTokens));
    setTemperatureInput(String(config.temperature));
    setTopPInput(String(config.topP));
    setTopKInput(String(config.topK));
  }, [config.contextSize, config.maxTokens, config.temperature, config.topP, config.topK]);

  useEffect(() => {
    if (status === "server_error" || testMessageResult) {
      setShowRuntimeSettings(true);
    }
  }, [status, testMessageResult]);

  const progress = downloadProgress;
  const progressPercent = progress && progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : 0;
  const setupLabel =
    progress?.phase === "runtime"
      ? activeBackend === "mlx"
        ? `Preparing MLX runtime${progress.label ? ` (${progress.label})` : ""}...`
        : `Downloading local runtime${progress.label ? ` (${progress.label})` : ""}...`
      : progress?.phase === "model"
        ? `Downloading model${progress.label ? ` (${progress.label})` : ""}...`
      : isPreparingServer
          ? "Starting local runtime..."
          : "Setting up local runtime...";
  const setupDescription =
    progress?.phase === "model"
      ? isAppleSilicon
        ? "Saving your selected MLX repo and preparing it for local use."
        : "Downloading your selected GGUF and preparing it for local use."
      : progress?.phase === "runtime"
        ? activeBackend === "mlx"
          ? "Downloading a private uv bootstrap and creating an isolated MLX environment inside Marinara's sidecar runtime folder."
          : "Downloading the official local runtime for this device."
        : activeBackend === "mlx"
          ? "Starting the MLX server in the background. You can close this window while Marinara finishes booting it."
          : "Starting the local sidecar server in the background. You can close this window while Marinara finishes booting it.";
  const runtimeStatusLabel = canFinish
    ? "Ready"
    : isBlockingSetup
      ? "Setting up now"
      : isPreparingServer
        ? "Starting runtime"
      : status === "server_error"
        ? "Setup error"
        : runtime.installed
          ? isSystemRuntime
            ? "Using system runtime"
            : "Installed"
          : "Not downloaded yet";

  const handleSkip = () => {
    markPrompted();
    onClose();
  };

  const handleCuratedDownload = () => {
    markPrompted();
    void startDownload(selectedQuant);
  };

  const handleCustomDownload = () => {
    if (!repoInput.trim()) return;
    markPrompted();
    void startCustomDownload(repoInput.trim(), isAppleSilicon ? undefined : selectedCustomPath);
  };

  const handleListModels = async () => {
    await listHuggingFaceModels(repoInput.trim());
  };

  const handleDone = () => {
    markPrompted();
    onClose();
  };

  const handleRuntimePreferenceChange = (preference: SidecarRuntimePreference) => {
    void updateConfig({ runtimePreference: preference });
  };

  const handleGpuLayersModeChange = (mode: "auto" | "cpu" | "custom") => {
    setGpuLayersModeDraft(mode);

    if (mode === "auto") {
      void updateConfig({ gpuLayers: -1 });
      return;
    }

    if (mode === "cpu") {
      void updateConfig({ gpuLayers: 0 });
      return;
    }

    if (config.gpuLayers <= 0) {
      setGpuLayersInput("999");
    }
  };

  const handleApplyCustomGpuLayers = () => {
    const parsed = Number.parseInt(gpuLayersInput, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1024) {
      return;
    }
    setGpuLayersModeDraft("custom");
    void updateConfig({ gpuLayers: parsed });
  };

  const handleApplyGenerationSettings = () => {
    const parsedContextSize = Number.parseInt(contextSizeInput, 10);
    const parsedMaxTokens = Number.parseInt(maxTokensInput, 10);
    const parsedTemperature = Number.parseFloat(temperatureInput);
    const parsedTopP = Number.parseFloat(topPInput);
    const parsedTopK = Number.parseInt(topKInput, 10);

    if (
      !Number.isFinite(parsedContextSize) ||
      parsedContextSize < 512 ||
      parsedContextSize > 32768 ||
      !Number.isFinite(parsedMaxTokens) ||
      parsedMaxTokens < 64 ||
      parsedMaxTokens > 32768 ||
      !Number.isFinite(parsedTemperature) ||
      parsedTemperature < 0 ||
      parsedTemperature > 2 ||
      !Number.isFinite(parsedTopP) ||
      parsedTopP <= 0 ||
      parsedTopP > 1 ||
      !Number.isFinite(parsedTopK) ||
      parsedTopK < 0 ||
      parsedTopK > 500
    ) {
      return;
    }

    void updateConfig({
      contextSize: parsedContextSize,
      maxTokens: parsedMaxTokens,
      temperature: parsedTemperature,
      topP: parsedTopP,
      topK: parsedTopK,
    });
  };

  const parsedContextSize = Number.parseInt(contextSizeInput, 10);
  const parsedMaxTokens = Number.parseInt(maxTokensInput, 10);
  const parsedTemperature = Number.parseFloat(temperatureInput);
  const parsedTopP = Number.parseFloat(topPInput);
  const parsedTopK = Number.parseInt(topKInput, 10);
  const generationSettingsValid =
    Number.isFinite(parsedContextSize) &&
    parsedContextSize >= 512 &&
    parsedContextSize <= 32768 &&
    Number.isFinite(parsedMaxTokens) &&
    parsedMaxTokens >= 64 &&
    parsedMaxTokens <= 32768 &&
    Number.isFinite(parsedTemperature) &&
    parsedTemperature >= 0 &&
    parsedTemperature <= 2 &&
    Number.isFinite(parsedTopP) &&
    parsedTopP > 0 &&
    parsedTopP <= 1 &&
    Number.isFinite(parsedTopK) &&
    parsedTopK >= 0 &&
    parsedTopK <= 500;
  const generationSettingsDirty =
    contextSizeInput !== String(config.contextSize) ||
    maxTokensInput !== String(config.maxTokens) ||
    temperatureInput !== String(config.temperature) ||
    topPInput !== String(config.topP) ||
    topKInput !== String(config.topK);

  const handleCancelSetup = () => {
    void cancelDownload();
  };

  return (
    <Modal open={open} onClose={onClose} title="Local AI Model" width="max-w-2xl">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10">
            <BrainCircuit size="1.25rem" className="text-purple-400" />
          </div>
          <div className="text-sm text-[var(--muted-foreground)]">
            <p>
              Marinara Engine can run a local sidecar for trackers, scene analysis, and game-state helpers without
              spending main-model tokens.
            </p>
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]/70">
              {isAppleSilicon
                ? "Set up the MLX runtime first if you want Marinara to keep it private and isolated, then choose either a curated Gemma preset or an MLX-native HuggingFace repo."
                : "Set up the runtime first, then choose either a curated Gemma preset or any GGUF from HuggingFace. Runtime device selection lives inside Runtime Settings."}
            </p>
          </div>
        </div>

        {hasModel && (
          <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/15">
                <Check size="1rem" className="text-green-400" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-green-300">{activeModelName ?? "Model Installed"}</div>
                <div className="text-xs text-[var(--muted-foreground)]/70">
                  {config.customModelRepo
                    ? config.backend === "mlx"
                      ? `Custom MLX repo: ${config.customModelRepo}`
                      : `Custom GGUF from ${config.customModelRepo}`
                    : `${formatQuantizationLabel(config.quantization, config.backend)} Gemma 4 ${config.backend === "mlx" ? "MLX" : "GGUF"} preset`}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/50 p-3">
          <div className="flex items-start justify-between gap-3 max-sm:flex-col">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Server size="0.95rem" className="text-purple-300" />
                Runtime
              </div>
              <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                <span>Status: {runtimeStatusLabel}</span>
                <span> • </span>
                <span>{quickRuntimeSummary}</span>
              </div>
              <div className="mt-1 text-xs text-[var(--muted-foreground)]/75">
                {runtime.installed
                  ? isSystemRuntime
                    ? `Using system llama-server${runtime.systemPath ? `: ${runtime.systemPath}` : ""}`
                    : runtime.variant
                      ? `Installed runtime: ${formatRuntimeVariantLabel(runtime.variant)}`
                      : "Runtime installed and ready to use."
                  : hasModel
                    ? "Your model is ready, but the runtime has not been installed yet."
                    : "Install and configure the runtime here, then choose a model below."}
              </div>
              {status === "server_error" && (
                <div className="mt-2 text-xs text-amber-200">Runtime startup failed. Open Runtime Settings for details.</div>
              )}
            </div>
            <button
              onClick={() => setShowRuntimeSettings((current) => !current)}
              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
            >
              <Settings2 size="0.875rem" />
              Runtime Settings
              {showRuntimeSettings ? <ChevronUp size="0.875rem" /> : <ChevronDown size="0.875rem" />}
            </button>
          </div>

          {!showSetupProgress && (
            <div className="mt-3 flex flex-wrap gap-2">
              {!runtime.installed ? (
                <button
                  onClick={() => void installRuntime()}
                  className="flex items-center justify-center gap-2 rounded-xl bg-purple-500/15 px-4 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/25"
                >
                  <Download size="0.875rem" />
                  {activeBackend === "mlx" ? "Install MLX Runtime" : "Install Runtime"}
                </button>
              ) : (
                <>
                  {hasModel && (
                    <button
                      onClick={() => void restartRuntime()}
                      className="flex items-center justify-center gap-2 rounded-xl bg-purple-500/15 px-4 py-2 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/25"
                    >
                      <Loader2 size="0.875rem" />
                      {status === "server_error" ? "Retry Startup" : inferenceReady ? "Restart Runtime" : "Start Runtime"}
                    </button>
                  )}
                  {canReinstallRuntime && (
                    <button
                      onClick={() => void reinstallRuntime()}
                      className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]"
                    >
                      <Download size="0.875rem" />
                      Reinstall Runtime
                    </button>
                  )}
                </>
              )}
              <button
                onClick={() => {
                  setShowRuntimeSettings(true);
                  void sendTestMessage();
                }}
                disabled={!hasModel || !runtime.installed || testMessagePending}
                className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {testMessagePending ? (
                  <Loader2 size="0.875rem" className="animate-spin" />
                ) : (
                  <MessageSquare size="0.875rem" />
                )}
                Send Test Message
              </button>
            </div>
          )}

          {showRuntimeSettings && (
            <div className="mt-4 flex flex-col gap-4 rounded-xl border border-[var(--border)]/80 bg-[var(--secondary)]/40 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                    Runtime Target
                  </div>
                  {activeBackend === "mlx" ? (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/60 px-3 py-2 text-sm text-[var(--muted-foreground)]/75">
                      MLX chooses the Apple Silicon accelerator path automatically.
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <select
                          value={config.runtimePreference}
                          onChange={(event) => handleRuntimePreferenceChange(event.target.value as SidecarRuntimePreference)}
                          className="w-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 pr-10 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-purple-400/50 focus:ring-1 focus:ring-purple-400/20"
                        >
                          {runtimePreferenceOptions.map((option) => (
                            <option key={option} value={option}>
                              {formatRuntimePreferenceLabel(option)}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size="0.95rem"
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]/70"
                        />
                      </div>
                      <div className="text-xs text-[var(--muted-foreground)]/70">
                        Pick the GPU family you actually want Marinara to target so it does not guess the wrong adapter.
                      </div>
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                    GPU Offload
                  </div>
                  {activeBackend === "mlx" ? (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/60 px-3 py-2 text-sm text-[var(--muted-foreground)]/75">
                      MLX manages GPU offload automatically.
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <select
                          value={gpuLayersMode}
                          onChange={(event) => handleGpuLayersModeChange(event.target.value as "auto" | "cpu" | "custom")}
                          className="w-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 pr-10 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-purple-400/50 focus:ring-1 focus:ring-purple-400/20"
                        >
                          <option value="auto">Auto offload</option>
                          <option value="cpu">CPU only</option>
                          <option value="custom">Custom GPU layers</option>
                        </select>
                        <ChevronDown
                          size="0.95rem"
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]/70"
                        />
                      </div>
                      {gpuLayersMode === "custom" && (
                        <div className="flex items-center justify-end gap-2">
                          <input
                            value={gpuLayersInput}
                            onChange={(event) => setGpuLayersInput(event.target.value.replace(/[^\d]/g, ""))}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                handleApplyCustomGpuLayers();
                              }
                            }}
                            placeholder="1-1024"
                            inputMode="numeric"
                            className="w-24 shrink-0 rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-center text-sm text-[var(--foreground)] outline-none transition-colors focus:border-purple-400/50 focus:ring-1 focus:ring-purple-400/20"
                          />
                          <button
                            onClick={handleApplyCustomGpuLayers}
                            className="flex shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)]/70 px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--card)]"
                          >
                            Apply
                          </button>
                        </div>
                      )}
                      <div className="text-xs text-[var(--muted-foreground)]/70">
                        Auto tries max offload first, CPU only disables GPU use, and custom lets you cap how many layers go to the GPU.
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/50 p-4">
                <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                  Inference Settings
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                      Context Window
                    </span>
                    <input
                      value={contextSizeInput}
                      onChange={(event) => setContextSizeInput(event.target.value.replace(/[^\d]/g, ""))}
                      inputMode="numeric"
                      placeholder="8192"
                      className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-purple-400/50 focus:ring-1 focus:ring-purple-400/20"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                      Max Response Tokens
                    </span>
                    <input
                      value={maxTokensInput}
                      onChange={(event) => setMaxTokensInput(event.target.value.replace(/[^\d]/g, ""))}
                      inputMode="numeric"
                      placeholder="4096"
                      className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-purple-400/50 focus:ring-1 focus:ring-purple-400/20"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                      Temperature
                    </span>
                    <input
                      value={temperatureInput}
                      onChange={(event) => setTemperatureInput(event.target.value.replace(/[^0-9.]/g, ""))}
                      inputMode="decimal"
                      placeholder="0.3"
                      className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-purple-400/50 focus:ring-1 focus:ring-purple-400/20"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                      Top P
                    </span>
                    <input
                      value={topPInput}
                      onChange={(event) => setTopPInput(event.target.value.replace(/[^0-9.]/g, ""))}
                      inputMode="decimal"
                      placeholder="0.95"
                      className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-purple-400/50 focus:ring-1 focus:ring-purple-400/20"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5 md:max-w-[12rem]">
                    <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                      Top K
                    </span>
                    <input
                      value={topKInput}
                      onChange={(event) => setTopKInput(event.target.value.replace(/[^\d]/g, ""))}
                      inputMode="numeric"
                      placeholder="64"
                      className="rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-purple-400/50 focus:ring-1 focus:ring-purple-400/20"
                    />
                  </label>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
                  <div className="text-xs text-[var(--muted-foreground)]/70">
                    Max response tokens caps how much the local runtime can generate. If it is too large relative to the
                    context window, Marinara has to trim more of the prompt to make room.
                  </div>
                  <button
                    onClick={handleApplyGenerationSettings}
                    disabled={!generationSettingsValid || !generationSettingsDirty}
                    className="flex shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)]/70 px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--card)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Apply Settings
                  </button>
                </div>
              </div>

              {runtime.installed && (
                <div className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--card)]/50 p-3 text-xs text-[var(--muted-foreground)]/75">
                  <span>Status: {runtimeStatusLabel}</span>
                  {runtime.build && runtime.variant && <span>Runtime build: {runtime.build} • {runtime.variant}</span>}
                  {isSystemRuntime && runtime.systemPath && <span>Using system llama-server: {runtime.systemPath}</span>}
                </div>
              )}

              {status === "server_error" && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
                  <div className="text-sm font-medium text-amber-200">Local runtime failed to start</div>
                  <div className="mt-1 text-xs text-[var(--muted-foreground)]/85">
                    Marinara will keep working without the local model until you retry or change these settings.
                  </div>
                  <div className="mt-3 flex flex-col gap-1 text-xs text-[var(--muted-foreground)]/75">
                    {failedRuntimeVariant && <span>Runtime: {formatRuntimeVariantLabel(failedRuntimeVariant)}</span>}
                    {startupError && <span>Error: {startupError}</span>}
                    {logPath && <span>Log: {logPath}</span>}
                  </div>
                  <div className="mt-3 flex gap-2 max-sm:flex-col">
                    <button
                      onClick={() => void restartRuntime()}
                      className="flex items-center justify-center gap-2 rounded-xl bg-amber-500/15 px-4 py-2.5 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/25"
                    >
                      <Loader2 size="0.875rem" />
                      Retry Startup
                    </button>
                    {canReinstallRuntime && (
                      <button
                        onClick={() => void reinstallRuntime()}
                        className="flex items-center justify-center gap-2 rounded-xl border border-amber-500/20 px-4 py-2.5 text-sm text-amber-100 transition-colors hover:bg-amber-500/10"
                      >
                        <Download size="0.875rem" />
                        Reinstall Runtime
                      </button>
                    )}
                    <button
                      onClick={() => void updateConfig({ useForTrackers: false, useForGameScene: false })}
                      className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
                    >
                      Continue Without Local AI
                    </button>
                  </div>
                </div>
              )}

              {testMessageResult && (
                <div
                  className={`rounded-xl border p-4 ${
                    testMessageResult.success
                      ? "border-emerald-500/25 bg-emerald-500/5"
                      : "border-red-500/25 bg-red-500/5"
                  }`}
                >
                  <div className={`text-sm font-medium ${testMessageResult.success ? "text-emerald-300" : "text-red-300"}`}>
                    Local Test Message {testMessageResult.success ? "Succeeded" : "Failed"}
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted-foreground)]/75">{testMessageResult.latencyMs}ms</div>
                  {testMessageResult.success ? (
                    <div className="mt-3 flex flex-col gap-3">
                      {testMessageResult.nonce && (
                        <div className="text-xs text-[var(--muted-foreground)]/75">
                          Verification token: <span className="font-mono text-[var(--foreground)]">{testMessageResult.nonce}</span>
                          {testMessageResult.nonceVerified ? " • echoed by model" : " • not echoed"}
                        </div>
                      )}
                      {(testMessageResult.usage || testMessageResult.timings) && (
                        <div className="text-xs text-[var(--muted-foreground)]/75">
                          {testMessageResult.usage && (
                            <span>
                              Usage: prompt {testMessageResult.usage.promptTokens ?? "?"}, completion{" "}
                              {testMessageResult.usage.completionTokens ?? "?"}, total {testMessageResult.usage.totalTokens ?? "?"}
                            </span>
                          )}
                          {testMessageResult.usage && testMessageResult.timings && <span> • </span>}
                          {testMessageResult.timings && (
                            <span>
                              Timings: prompt {testMessageResult.timings.promptMs ?? "?"}ms / gen{" "}
                              {testMessageResult.timings.predictedMs ?? "?"}ms
                            </span>
                          )}
                        </div>
                      )}
                      {!!testMessageResult.messageContent && <ResponseBlock label="Message Content" value={testMessageResult.messageContent} />}
                      {!!testMessageResult.reasoningContent && (
                        <ResponseBlock label="Reasoning Content" value={testMessageResult.reasoningContent} />
                      )}
                      {!testMessageResult.messageContent && !testMessageResult.reasoningContent && (
                        <ResponseBlock label="Response" value={testMessageResult.response} />
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-col gap-1 text-xs text-red-200/90">
                      <span>{testMessageResult.error || "No response received from the local runtime."}</span>
                      {testMessageResult.failedRuntimeVariant && (
                        <span>Runtime: {formatRuntimeVariantLabel(testMessageResult.failedRuntimeVariant)}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {runtimeDiagnostics && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/50 p-3">
                  <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">Diagnostics</div>
                  <div className="mt-2 flex flex-col gap-1 text-xs text-[var(--muted-foreground)]/75">
                    {runtimeDiagnostics.gpuVendors.length > 0 && (
                      <span>Detected GPU vendors: {runtimeDiagnostics.gpuVendors.join(", ")}</span>
                    )}
                    <span>
                      Backend hints:
                      {runtimeDiagnostics.preferCuda ? " CUDA" : ""}
                      {runtimeDiagnostics.preferHip ? " HIP" : ""}
                      {runtimeDiagnostics.preferRocm ? " ROCm" : ""}
                      {runtimeDiagnostics.preferSycl ? " SYCL" : ""}
                      {runtimeDiagnostics.preferVulkan ? " Vulkan" : ""}
                      {!runtimeDiagnostics.preferCuda &&
                      !runtimeDiagnostics.preferHip &&
                      !runtimeDiagnostics.preferRocm &&
                      !runtimeDiagnostics.preferSycl &&
                      !runtimeDiagnostics.preferVulkan
                        ? " none"
                        : ""}
                    </span>
                    {runtimeDiagnostics.systemLlamaPath && <span>System llama-server: {runtimeDiagnostics.systemLlamaPath}</span>}
                    {runtimeDiagnostics.launchCommand && <span>Last launch command: {runtimeDiagnostics.launchCommand}</span>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {showSetupProgress && (
          <div className="rounded-xl border border-purple-400/25 bg-purple-500/5 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-500/15">
                <Loader2 size="1rem" className="animate-spin text-purple-300" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-purple-200">{setupLabel}</div>
                <div className="mt-1 text-xs text-[var(--muted-foreground)]/80">{setupDescription}</div>
              </div>
            </div>

            {progress ? (
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                  <span>{setupLabel}</span>
                  <span>
                    {formatBytes(progress.downloaded)}
                    {progress.total > 0 && ` / ${formatBytes(progress.total)}`}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className="h-full rounded-full bg-purple-400 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]/60">
                  <span>{progressPercent}%</span>
                  {progress.speed > 0 && <span>{formatSpeed(progress.speed)}</span>}
                </div>
              </div>
            ) : (
              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-purple-400/80" />
              </div>
            )}
          </div>
        )}

        {!isBlockingSetup && (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                {isAppleSilicon ? "Curated Gemma 4 Presets for Apple Silicon" : "Curated Gemma 4 Presets"}
              </span>
              {curatedModels.map((model) => (
                <label
                  key={`${model.backend}-${model.quantization}`}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
                    selectedQuant === model.quantization
                      ? "border-purple-400/50 bg-purple-500/5"
                      : "border-[var(--border)] hover:bg-[var(--secondary)]/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="quantization"
                    value={model.quantization}
                    checked={selectedQuant === model.quantization}
                    onChange={() => setSelectedQuant(model.quantization)}
                    className="sr-only"
                  />
                  <div
                    className={`h-4 w-4 shrink-0 rounded-full border-2 transition-colors ${
                      selectedQuant === model.quantization
                        ? "border-purple-400 bg-purple-400"
                        : "border-[var(--border)]"
                    }`}
                  >
                    {selectedQuant === model.quantization && (
                      <div className="flex h-full items-center justify-center">
                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{model.label}</div>
                    <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]/70">
                      <span className="flex items-center gap-1">
                        <Download size="0.75rem" />
                        {formatBytes(model.sizeBytes)}
                      </span>
                      <span className="flex items-center gap-1">
                        <HardDrive size="0.75rem" />~{formatBytes(model.ramBytes)} RAM
                      </span>
                    </div>
                  </div>
                  {model.quantization === "q8_0" && (
                    <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[0.625rem] font-medium text-purple-300">
                      Recommended
                    </span>
                  )}
                </label>
              ))}
              <button
                onClick={handleCuratedDownload}
                disabled={!selectedPreset}
                className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-purple-500/15 px-4 py-2.5 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
              >
                <Zap size="0.875rem" />
                {hasModel ? "Switch to Curated Preset" : "Use Curated Preset"}
              </button>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/50 p-3">
              <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
                {isAppleSilicon ? "Use Your Own MLX Model From HuggingFace" : "Use Your Own Model From HuggingFace"}
              </div>
              <div className="mt-2 text-xs text-[var(--muted-foreground)]/70">
                {isAppleSilicon
                  ? "Enter an MLX-native HuggingFace repo. Marinara will validate it, then let the MLX runtime pull and cache it locally on first startup."
                  : "Enter a GGUF repo on HuggingFace, list the available files, and choose the one you want to download."}
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex gap-2 max-sm:flex-col">
                  <input
                    value={repoInput}
                    onChange={(event) => {
                      setRepoInput(event.target.value);
                      if (customModels.length > 0 || customModelsError) {
                        clearCustomModels();
                        setSelectedCustomPath("");
                      }
                    }}
                    placeholder="owner/repo"
                    className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none transition-colors focus:border-purple-400/50"
                  />
                  <button
                    onClick={() => void handleListModels()}
                    disabled={!repoInput.trim() || customModelsLoading}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] disabled:opacity-50"
                  >
                    {customModelsLoading ? (
                      <Loader2 size="0.875rem" className="animate-spin" />
                    ) : (
                      <Search size="0.875rem" />
                    )}
                    {isAppleSilicon ? "Validate Repo" : "List Models"}
                  </button>
                </div>

                {customModelsError && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
                    {customModelsError}
                  </div>
                )}

                {isAppleSilicon && selectedCustomEntry && (
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                    <div className="text-sm font-medium text-emerald-300">{selectedCustomEntry.filename}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--muted-foreground)]/75">
                      {selectedCustomEntry.quantizationLabel && <span>{selectedCustomEntry.quantizationLabel}</span>}
                      {selectedCustomEntry.sizeBytes && <span>{formatBytes(selectedCustomEntry.sizeBytes)}</span>}
                      <span>MLX repo validated</span>
                    </div>
                  </div>
                )}

                {!isAppleSilicon && customModels.length > 0 && (
                  <>
                    <select
                      value={selectedCustomPath}
                      onChange={(event) => setSelectedCustomPath(event.target.value)}
                      className="rounded-xl border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none transition-colors focus:border-purple-400/50"
                    >
                      {customModels.map((entry) => (
                        <option key={entry.path} value={entry.path}>
                          {entry.filename}
                          {entry.quantizationLabel ? ` • ${entry.quantizationLabel}` : ""}
                          {entry.sizeBytes ? ` • ${formatBytes(entry.sizeBytes)}` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleCustomDownload}
                      disabled={!selectedCustomPath}
                      className="flex items-center justify-center gap-2 rounded-xl bg-sky-500/15 px-4 py-2.5 text-sm font-medium text-sky-300 transition-colors hover:bg-sky-500/25 disabled:opacity-50"
                    >
                      <Download size="0.875rem" />
                      {hasModel ? "Switch to Selected GGUF" : "Download Selected GGUF"}
                    </button>
                  </>
                )}

                {isAppleSilicon && (
                  <button
                    onClick={handleCustomDownload}
                    disabled={!repoInput.trim() || customModelsLoading || !isCustomRepoValidated}
                    className="flex items-center justify-center gap-2 rounded-xl bg-sky-500/15 px-4 py-2.5 text-sm font-medium text-sky-300 transition-colors hover:bg-sky-500/25 disabled:opacity-50"
                  >
                    <Download size="0.875rem" />
                    {hasModel ? "Switch to Validated MLX Repo" : "Use Validated MLX Repo"}
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {progress?.status === "error" && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-400">
            {progress.error || "Download failed. Please try again."}
          </div>
        )}

        <div className="flex items-center gap-2">
          {isBlockingSetup ? (
            <button
              onClick={handleCancelSetup}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
            >
              <X size="0.875rem" />
              Cancel Setup
            </button>
          ) : (
            <>
              <button
                onClick={handleSkip}
                className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)]"
              >
                {hasModel ? "Close" : "Skip for Now"}
              </button>
              <button
                onClick={handleDone}
                disabled={!canFinish}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-purple-500/15 px-4 py-2.5 text-sm font-medium text-purple-300 transition-colors hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-purple-500/15"
              >
                Done
              </button>
            </>
          )}
        </div>

        {!hasModel && !isBlockingSetup && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/50 p-3">
            <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]/60">
              What the local model handles
            </span>
            <ul className="mt-2 flex flex-col gap-1 text-xs text-[var(--muted-foreground)]/80">
              <li>Tracker agents in roleplay mode</li>
              <li>Scene effects in game mode (backgrounds, music, SFX, ambient)</li>
              <li>Widget updates, weather, and time-of-day changes</li>
              <li>NPC reputation tracking and expression selection</li>
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
