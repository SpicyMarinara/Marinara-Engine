// ──────────────────────────────────────────────
// Sidecar Local Model Types
//
// Types for the built-in Gemma E2B sidecar that
// handles tracker agents, scene analysis, widget
// updates, and game mechanics locally.
// ──────────────────────────────────────────────

/** Available quantization variants for the sidecar model. */
export type SidecarQuantization = "q8_0" | "q4_k_m";

/** Runtime backend used by the built-in local model. */
export type SidecarBackend = "llama_cpp" | "mlx";

/** Which runtime target Marinara should prepare for llama.cpp-based local inference. */
export const SIDECAR_RUNTIME_PREFERENCES = ["auto", "nvidia", "amd", "intel", "vulkan", "cpu", "system"] as const;
export type SidecarRuntimePreference = (typeof SIDECAR_RUNTIME_PREFERENCES)[number];

/** Where the active runtime comes from. */
export type SidecarRuntimeSource = "bundled" | "system";

/** Current lifecycle state of the sidecar model. */
export type SidecarStatus =
  | "not_downloaded"
  | "downloading_runtime"
  | "downloading_model"
  | "downloaded"
  | "starting_server"
  | "ready"
  | "server_error";

/** Progress info while downloading the runtime or model assets. */
export interface SidecarDownloadProgress {
  phase: "runtime" | "model";
  status: "downloading" | "complete" | "error";
  /** Bytes downloaded so far. */
  downloaded: number;
  /** Total file size in bytes (0 if unknown). */
  total: number;
  /** Download speed in bytes/second. */
  speed: number;
  /** Optional display label for the thing being downloaded. */
  label?: string;
  /** Error message if status is "error". */
  error?: string;
}

/** Persisted sidecar configuration stored server-side. */
export interface SidecarConfig {
  /** Which local runtime backend is selected. */
  backend: SidecarBackend;
  /** Active model file path, relative to data/models. Null if none. */
  modelPath: string | null;
  /** Active remote model repo id for MLX-native models. Null if none. */
  modelRepo: string | null;
  /** Which curated quantization variant is downloaded/active. Null for BYO models. */
  quantization: SidecarQuantization | null;
  /** HuggingFace repo for BYO models, e.g. "mlx-community/gemma-4-e2b-it-4bit". */
  customModelRepo: string | null;
  /** Whether to use the sidecar for tracker agents in roleplay mode. */
  useForTrackers: boolean;
  /** Whether to use the sidecar for game scene analysis (backgrounds, music, widgets, etc.). */
  useForGameScene: boolean;
  /** Context size for the model. Default 8192. */
  contextSize: number;
  /** Maximum completion tokens Marinara should request from the local runtime. */
  maxTokens: number;
  /** Sampling temperature for local inference. */
  temperature: number;
  /** Top-p nucleus sampling value for local inference. */
  topP: number;
  /** Top-k sampling limit for local inference. */
  topK: number;
  /** GPU layers to offload (-1 = try max GPU offload first, then fall back if startup fails). */
  gpuLayers: number;
  /** Which runtime target to install for llama.cpp-based local inference. */
  runtimePreference: SidecarRuntimePreference;
}

export interface SidecarRuntimeInfo {
  installed: boolean;
  build: string | null;
  variant: string | null;
  backend: SidecarBackend | null;
  source?: SidecarRuntimeSource | null;
  systemPath?: string | null;
}

export interface SidecarRuntimeDiagnostics {
  gpuVendors: string[];
  preferCuda: boolean;
  preferHip: boolean;
  preferRocm: boolean;
  preferSycl: boolean;
  preferVulkan: boolean;
  systemLlamaPath: string | null;
  launchCommand: string | null;
  launchBackend: SidecarBackend | null;
}

/** Server response for sidecar status endpoint. */
export interface SidecarStatusResponse {
  status: SidecarStatus;
  config: SidecarConfig;
  /** Whether a model file is downloaded on disk. */
  modelDownloaded: boolean;
  /** Friendly current model label for UI display. */
  modelDisplayName: string | null;
  /** Model file size in bytes (if downloaded). */
  modelSize: number | null;
  /** Installed local runtime info. */
  runtime: SidecarRuntimeInfo;
  /** Absolute log path for the spawned local sidecar process. */
  logPath: string | null;
  /** Last startup error summary, if the local runtime failed to boot. */
  startupError?: string | null;
  /** Runtime variant that most recently failed to boot. */
  failedRuntimeVariant?: string | null;
  /** Current Node.js platform string, e.g. "darwin". */
  platform: string;
  /** Current CPU architecture string, e.g. "arm64". */
  arch: string;
  /** Curated local-model presets available on this machine. */
  curatedModels: SidecarModelInfo[];
  /** Runtime-selection diagnostics for support and troubleshooting. */
  runtimeDiagnostics?: SidecarRuntimeDiagnostics;
}

// ── Scene Analysis Output ──

/** A single segment-tied effect batch. Applied when the user reaches this segment. */
export interface SceneSegmentEffect {
  /** 0-based index of the narration segment this effect triggers on. */
  segment: number;
  background?: string | null;
  music?: string | null;
  sfx?: string[];
  ambient?: string | null;
  expressions?: Record<string, string>;
  widgetUpdates?: SceneWidgetUpdate[];
}

/** Scene analysis result from the sidecar model for game mode.
 *  Generated after the main model's narration is complete. */
export interface SceneAnalysis {
  /** Background tag from the asset manifest to display. */
  background: string | null;
  /** Music tag to play. */
  music: string | null;
  /** Ambient loop tag. */
  ambient: string | null;
  /** Weather description update — applied immediately. */
  weather: string | null;
  /** Time of day update — applied immediately. */
  timeOfDay: string | null;
  /** NPC reputation changes — applied immediately. */
  reputationChanges: SceneReputationChange[];
  /** Scene-wide widget updates — applied immediately after the turn. */
  widgetUpdates?: SceneWidgetUpdate[];
  /** Segment-indexed effects. Each entry fires when the user reaches that segment. */
  segmentEffects?: SceneSegmentEffect[];
  /** NPC avatars generated during this scene wrap (populated by server when image gen is enabled). */
  generatedNpcAvatars?: Array<{ name: string; avatarUrl: string }>;
}

/** A single widget update from scene analysis. */
export interface SceneWidgetUpdate {
  widgetId: string;
  /** For progress_bar/gauge/relationship_meter: new value. */
  value?: number | string;
  /** For counter: new count. */
  count?: number;
  /** For list/inventory: item to add. */
  add?: string;
  /** For list/inventory: item to remove. */
  remove?: string;
  /** For timer: start/stop. */
  running?: boolean;
  /** For timer: set seconds. */
  seconds?: number;
  /** For stat_block: which stat to update (by name). */
  statName?: string;
}

/** A reputation change from scene analysis. */
export interface SceneReputationChange {
  npcName: string;
  action: string;
}

// ── Model Metadata ──

/** Info about available sidecar models for download. */
export interface SidecarModelInfo {
  quantization: SidecarQuantization;
  /** Display name, e.g. "Gemma 4 E2B — Q8" */
  label: string;
  /** Backend used by this preset. */
  backend: SidecarBackend;
  /** Final GGUF filename on disk, or the repo id for non-file-backed runtimes. */
  filename: string;
  /** Approximate file size in bytes. */
  sizeBytes: number;
  /** Approximate RAM needed at runtime. */
  ramBytes: number;
  /** HuggingFace download URL when the preset downloads a local file directly. */
  downloadUrl?: string;
  /** HuggingFace repo id when the backend loads by repo name directly. */
  repoId?: string;
  /** SHA256 hash for integrity check. */
  sha256?: string;
}

export interface SidecarCustomModelEntry {
  path: string;
  filename: string;
  sizeBytes: number | null;
  quantizationLabel: string | null;
  downloadUrl: string;
}

/** Default sidecar configuration. */
export const SIDECAR_DEFAULT_CONFIG: SidecarConfig = {
  backend: "llama_cpp",
  modelPath: null,
  modelRepo: null,
  quantization: null,
  customModelRepo: null,
  useForTrackers: false,
  useForGameScene: true,
  contextSize: 8192,
  maxTokens: 4096,
  temperature: 0.3,
  topP: 0.95,
  topK: 64,
  gpuLayers: -1,
  runtimePreference: "auto",
};

/**
 * Reserved ID for the synthetic sidecar connection entry. The connections
 * storage layer merges this ID into read paths when the sidecar is enabled
 * as a connection, and rejects writes against it. Never stored in the DB.
 */
export const SIDECAR_CONNECTION_ID = "sidecar:local";

/** Available models for download. */
export const SIDECAR_MODELS: SidecarModelInfo[] = [
  {
    quantization: "q8_0",
    backend: "llama_cpp",
    label: "Gemma 4 E2B — Q8 (Best Quality)",
    filename: "gemma-4-E2B-it-Q8_0.gguf",
    sizeBytes: 5_400_000_000,
    ramBytes: 5_800_000_000,
    downloadUrl: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q8_0.gguf",
  },
  {
    quantization: "q4_k_m",
    backend: "llama_cpp",
    label: "Gemma 4 E2B — Q4_K_M (Smaller, Faster)",
    filename: "gemma-4-E2B-it-Q4_K_M.gguf",
    sizeBytes: 3_200_000_000,
    ramBytes: 3_600_000_000,
    downloadUrl: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf",
  },
];

/** Apple Silicon MLX-native curated models. */
export const SIDECAR_MLX_MODELS: SidecarModelInfo[] = [
  {
    quantization: "q8_0",
    backend: "mlx",
    label: "Gemma 4 E2B — 8-bit MLX (Best Quality)",
    filename: "mlx-community/gemma-4-e2b-it-8bit",
    repoId: "mlx-community/gemma-4-e2b-it-8bit",
    sizeBytes: 5_900_000_000,
    ramBytes: 7_500_000_000,
  },
  {
    quantization: "q4_k_m",
    backend: "mlx",
    label: "Gemma 4 E2B — 4-bit MLX (Smaller, Faster)",
    filename: "mlx-community/gemma-4-e2b-it-4bit",
    repoId: "mlx-community/gemma-4-e2b-it-4bit",
    sizeBytes: 3_610_000_000,
    ramBytes: 4_800_000_000,
  },
];
