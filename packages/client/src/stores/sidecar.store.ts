// ──────────────────────────────────────────────
// Sidecar Store — Client state for the local
// runtime + model manager across GGUF and MLX
// ──────────────────────────────────────────────

import { create } from "zustand";
import type {
  SidecarConfig,
  SidecarCustomModelEntry,
  SidecarDownloadProgress,
  SidecarModelInfo,
  SidecarRuntimeDiagnostics,
  SidecarRuntimeInfo,
  SidecarStatus,
  SidecarStatusResponse,
  SidecarQuantization,
} from "@marinara-engine/shared";
import { SIDECAR_DEFAULT_CONFIG } from "@marinara-engine/shared";
import { ADMIN_SECRET_STORAGE_KEY, api } from "../lib/api-client.js";

interface SidecarTestMessageResult {
  success: boolean;
  response: string;
  messageContent?: string;
  reasoningContent?: string;
  nonce?: string;
  nonceVerified?: boolean;
  usage?: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
  timings?: {
    promptTokens: number | null;
    promptMs: number | null;
    predictedTokens: number | null;
    predictedMs: number | null;
  };
  latencyMs: number;
  error?: string;
  failedRuntimeVariant?: string | null;
}

interface SidecarState {
  status: SidecarStatus;
  config: SidecarConfig;
  modelDownloaded: boolean;
  modelDisplayName: string | null;
  runtime: SidecarRuntimeInfo;
  inferenceReady: boolean;
  modelSize: number | null;
  logPath: string | null;
  startupError: string | null;
  failedRuntimeVariant: string | null;
  runtimeDiagnostics: SidecarRuntimeDiagnostics | null;
  platform: string;
  arch: string;
  curatedModels: SidecarModelInfo[];
  downloadProgress: SidecarDownloadProgress | null;
  customModels: SidecarCustomModelEntry[];
  customModelsLoading: boolean;
  customModelsError: string | null;
  showDownloadModal: boolean;
  hasBeenPrompted: boolean;
  testMessagePending: boolean;
  testMessageResult: SidecarTestMessageResult | null;

  fetchStatus: () => Promise<void>;
  startDownload: (quantization: SidecarQuantization) => Promise<void>;
  startCustomDownload: (repo: string, modelPath?: string) => Promise<void>;
  listHuggingFaceModels: (repo: string) => Promise<SidecarCustomModelEntry[]>;
  clearCustomModels: () => void;
  cancelDownload: () => Promise<void>;
  deleteModel: () => Promise<void>;
  unloadModel: () => Promise<void>;
  restartRuntime: () => Promise<void>;
  installRuntime: (reinstall?: boolean) => Promise<void>;
  sendTestMessage: () => Promise<void>;
  reinstallRuntime: () => Promise<void>;
  updateConfig: (
    partial: Partial<
      Pick<
        SidecarConfig,
        | "useForTrackers"
        | "useForGameScene"
        | "contextSize"
        | "maxTokens"
        | "temperature"
        | "topP"
        | "topK"
        | "gpuLayers"
        | "runtimePreference"
      >
    >,
  ) => Promise<void>;
  setShowDownloadModal: (open: boolean) => void;
  markPrompted: () => void;
}

const PROMPTED_KEY = "marinara_sidecar_prompted";
const TRANSITIONAL_STATUSES = new Set<SidecarStatus>(["downloading_runtime", "downloading_model", "starting_server"]);
let statusPollTimer: number | null = null;

function clearStatusPollTimer() {
  if (statusPollTimer !== null) {
    window.clearTimeout(statusPollTimer);
    statusPollTimer = null;
  }
}

function shouldKeepPolling(state: Pick<SidecarState, "status" | "config" | "inferenceReady" | "runtime">): boolean {
  if (TRANSITIONAL_STATUSES.has(state.status)) {
    return true;
  }

  if (
    state.status === "downloaded" &&
    state.runtime.installed &&
    (state.config.useForGameScene || state.config.useForTrackers) &&
    !state.inferenceReady
  ) {
    return true;
  }

  return false;
}

async function consumeDownloadStream(
  path: string,
  body: unknown,
  set: (partial: Partial<SidecarState>) => void,
  get: () => SidecarState,
): Promise<void> {
  const adminSecret = localStorage.getItem(ADMIN_SECRET_STORAGE_KEY)?.trim();
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(adminSecret ? { "X-Admin-Secret": adminSecret } : {}) },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    throw new Error("Download request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6)) as Partial<SidecarDownloadProgress> & {
          done?: boolean;
          status?: string;
          error?: string;
        };

        if (data.done) {
          set({ downloadProgress: null });
          await get().fetchStatus();
          return;
        }

        if (data.status === "error") {
          set({
            downloadProgress: {
              phase: (data.phase as SidecarDownloadProgress["phase"]) ?? "model",
              status: "error",
              downloaded: 0,
              total: 0,
              speed: 0,
              error: data.error ?? "Download failed",
              label: data.label,
            },
          });
          await get().fetchStatus();
          return;
        }

        if (data.status === "downloading") {
          set({
            downloadProgress: {
              phase: (data.phase as SidecarDownloadProgress["phase"]) ?? "model",
              status: "downloading",
              downloaded: Number(data.downloaded ?? 0),
              total: Number(data.total ?? 0),
              speed: Number(data.speed ?? 0),
              label: data.label,
            },
            status: (data.phase === "runtime" ? "downloading_runtime" : "downloading_model") as SidecarStatus,
          });
        }
      } catch {
        // Ignore malformed SSE chunks.
      }
    }
  }

  set({ downloadProgress: null });
  await get().fetchStatus();
}

export const useSidecarStore = create<SidecarState>((set, get) => ({
  status: "not_downloaded",
  config: { ...SIDECAR_DEFAULT_CONFIG },
  modelDownloaded: false,
  modelDisplayName: null,
  runtime: { installed: false, build: null, variant: null, backend: null },
  inferenceReady: false,
  modelSize: null,
  logPath: null,
  startupError: null,
  failedRuntimeVariant: null,
  runtimeDiagnostics: null,
  platform: "",
  arch: "",
  curatedModels: [],
  downloadProgress: null,
  customModels: [],
  customModelsLoading: false,
  customModelsError: null,
  showDownloadModal: false,
  hasBeenPrompted: localStorage.getItem(PROMPTED_KEY) === "true",
  testMessagePending: false,
  testMessageResult: null,

  fetchStatus: async () => {
    try {
      const response = await api.get<SidecarStatusResponse & { inferenceReady: boolean }>("/sidecar/status");
      const nextState = {
        status: response.status,
        config: response.config,
        modelDownloaded: response.modelDownloaded,
        modelDisplayName: response.modelDisplayName,
        runtime: response.runtime,
        inferenceReady: response.inferenceReady,
        modelSize: response.modelSize,
        logPath: response.logPath,
        startupError: response.startupError ?? null,
        failedRuntimeVariant: response.failedRuntimeVariant ?? null,
        runtimeDiagnostics: response.runtimeDiagnostics ?? null,
        platform: response.platform,
        arch: response.arch,
        curatedModels: response.curatedModels,
      };
      set(nextState);

      clearStatusPollTimer();
      if (shouldKeepPolling(nextState)) {
        statusPollTimer = window.setTimeout(() => {
          void get().fetchStatus();
        }, 1500);
      }
    } catch {
      // Best-effort: the server may not support sidecar yet.
    }
  },

  startDownload: async (quantization) => {
    set({
      status: "downloading_model",
      startupError: null,
      failedRuntimeVariant: null,
      testMessageResult: null,
      downloadProgress: {
        phase: "model",
        status: "downloading",
        downloaded: 0,
        total: 0,
        speed: 0,
      },
    });

    try {
      await consumeDownloadStream("/api/sidecar/download", { quantization }, set, get);
    } catch (error) {
      set({
        downloadProgress: {
          phase: "model",
          status: "error",
          downloaded: 0,
          total: 0,
          speed: 0,
          error: error instanceof Error ? error.message : "Download failed",
        },
      });
    }
  },

  startCustomDownload: async (repo, modelPath) => {
    set({
      status: "downloading_model",
      startupError: null,
      failedRuntimeVariant: null,
      testMessageResult: null,
      downloadProgress: {
        phase: "model",
        status: "downloading",
        downloaded: 0,
        total: 0,
        speed: 0,
      },
    });

    try {
      await consumeDownloadStream("/api/sidecar/download/custom", modelPath ? { repo, modelPath } : { repo }, set, get);
    } catch (error) {
      set({
        downloadProgress: {
          phase: "model",
          status: "error",
          downloaded: 0,
          total: 0,
          speed: 0,
          error: error instanceof Error ? error.message : "Download failed",
        },
      });
    }
  },

  listHuggingFaceModels: async (repo) => {
    set({ customModelsLoading: true, customModelsError: null });
    try {
      const response = await api.post<{ models: SidecarCustomModelEntry[] }>("/sidecar/models/list-huggingface", {
        repo,
      });
      set({ customModels: response.models, customModelsLoading: false, customModelsError: null });
      return response.models;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list HuggingFace models";
      set({ customModels: [], customModelsLoading: false, customModelsError: message });
      throw error;
    }
  },

  clearCustomModels: () => {
    set({ customModels: [], customModelsError: null, customModelsLoading: false });
  },

  cancelDownload: async () => {
    try {
      await api.post("/sidecar/download/cancel");
    } catch {
      // Best-effort cancel.
    }

    set({ downloadProgress: null });
    await get().fetchStatus();
  },

  deleteModel: async () => {
    try {
      await api.delete("/sidecar/model");
      set({
        status: "not_downloaded",
        config: { ...SIDECAR_DEFAULT_CONFIG },
        modelDownloaded: false,
        modelDisplayName: null,
        inferenceReady: false,
        modelSize: null,
        startupError: null,
        failedRuntimeVariant: null,
        runtimeDiagnostics: null,
        testMessageResult: null,
      });
      await get().fetchStatus();
    } catch {
      // Best-effort delete.
    }
  },

  unloadModel: async () => {
    try {
      await api.post("/sidecar/unload");
      await get().fetchStatus();
    } catch {
      // Best-effort unload.
    }
  },

  restartRuntime: async () => {
    set({
      status: "starting_server",
      startupError: null,
      failedRuntimeVariant: null,
      testMessageResult: null,
      downloadProgress: null,
    });

    try {
      await api.post("/sidecar/restart");
    } catch {
      // Best-effort: fetchStatus will surface the latest sidecar error.
    }

    await get().fetchStatus();
  },

  installRuntime: async (reinstall = false) => {
    set({
      status: "downloading_runtime",
      startupError: null,
      failedRuntimeVariant: null,
      testMessageResult: null,
      downloadProgress: {
        phase: "runtime",
        status: "downloading",
        downloaded: 0,
        total: 0,
        speed: 0,
        label: reinstall ? "Reinstalling local runtime" : "Installing local runtime",
      },
    });

    try {
      await consumeDownloadStream("/api/sidecar/runtime/install", reinstall ? { reinstall: true } : {}, set, get);
    } catch (error) {
      set({
        downloadProgress: {
          phase: "runtime",
          status: "error",
          downloaded: 0,
          total: 0,
          speed: 0,
          error: error instanceof Error ? error.message : "Failed to install the local runtime",
          label: reinstall ? "Reinstall local runtime" : "Install local runtime",
        },
      });
    }
  },

  sendTestMessage: async () => {
    set({
      testMessagePending: true,
      testMessageResult: null,
      startupError: null,
      failedRuntimeVariant: null,
    });

    try {
      const result = await api.post<SidecarTestMessageResult>("/sidecar/test-message");
      set({
        testMessagePending: false,
        testMessageResult: result,
      });
    } catch (error) {
      set({
        testMessagePending: false,
        testMessageResult: {
          success: false,
          response: "",
          latencyMs: 0,
          error: error instanceof Error ? error.message : "Failed to run the local sidecar test message",
          failedRuntimeVariant: null,
        },
      });
    }

    await get().fetchStatus();
  },

  reinstallRuntime: async () => {
    await get().installRuntime(true);
  },

  updateConfig: async (partial) => {
    const previous = get().config;
    set({ config: { ...previous, ...partial } });
    try {
      const response = await api.patch<{ config: SidecarConfig }>("/sidecar/config", partial);
      set({ config: response.config });
      void get().fetchStatus();
    } catch {
      set({ config: previous });
    }
  },

  setShowDownloadModal: (open) => set({ showDownloadModal: open }),

  markPrompted: () => {
    localStorage.setItem(PROMPTED_KEY, "true");
    set({ hasBeenPrompted: true });
  },
}));
