// ──────────────────────────────────────────────
// Sidecar Local Model - Model Lifecycle Service
//
// Owns the persisted sidecar config plus local
// model download/list/delete flows for curated
// and custom HuggingFace models, including the
// Apple Silicon MLX-native path.
// ──────────────────────────────────────────────

import { basename, join, relative, resolve, sep } from "path";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import {
  SIDECAR_DEFAULT_CONFIG,
  SIDECAR_RUNTIME_PREFERENCES,
  SIDECAR_MLX_MODELS,
  SIDECAR_MODELS,
  type SidecarBackend,
  type SidecarConfig,
  type SidecarCustomModelEntry,
  type SidecarDownloadProgress,
  type SidecarModelInfo,
  type SidecarQuantization,
  type SidecarStatus,
  type SidecarStatusResponse,
} from "@marinara-engine/shared";
import { getDataDir } from "../../utils/data-dir.js";
import { downloadFileWithProgress, fetchJson, isAbortError } from "./sidecar-download.js";
import { mlxRuntimeService } from "./mlx-runtime.service.js";
import { sidecarRuntimeService } from "./sidecar-runtime.service.js";
import { assertSupportedLlamaCppModelPath, isSupportedLlamaCppModelFilename } from "./sidecar-model-files.js";

export const MODELS_DIR = join(getDataDir(), "models");
export const CUSTOM_MODELS_DIR = join(MODELS_DIR, "custom");
export const CONFIG_PATH = join(MODELS_DIR, "sidecar-config.json");
export const LEGACY_RUNTIME_STAMP_PATH = join(MODELS_DIR, "sidecar-runtime-stamp.txt");

type ProgressCallback = (progress: SidecarDownloadProgress) => void;

interface HuggingFaceTreeEntry {
  type?: string;
  path?: string;
  size?: number;
  lfs?: { size?: number };
}

interface HuggingFaceModelApiResponse {
  id?: string;
  library_name?: string | null;
  tags?: string[];
  gguf?: unknown;
  safetensors?: { total?: number } | null;
  config?: {
    quantization_config?: {
      bits?: number;
    };
  } | null;
}

function normalizeRepoPath(repo: string): string {
  return repo.trim().replace(/^\/+|\/+$/g, "");
}

function isValidRepoPath(repo: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(repo);
}

function buildHuggingFaceDownloadUrl(repo: string, modelPath: string): string {
  const encodedPath = modelPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://huggingface.co/${repo}/resolve/main/${encodedPath}`;
}

function slugifyRepo(repo: string): string {
  return repo.replace(/[^A-Za-z0-9._-]+/g, "__");
}

function extractQuantizationLabel(filename: string): string | null {
  const stem = basename(filename, ".gguf");
  const match = stem.match(/(?:^|[-_.])(IQ\d+(?:_[A-Z0-9]+)*|Q\d+(?:_[A-Z0-9]+)*)(?:$|[-_.])/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function ensureWithinModelsDir(targetPath: string): string {
  const resolvedRoot = resolve(MODELS_DIR);
  const resolvedTarget = resolve(targetPath);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + sep)) {
    throw new Error("Resolved model path escaped the sidecar models directory");
  }
  return resolvedTarget;
}

function isMacAppleSilicon(): boolean {
  return process.platform === "darwin" && process.arch === "arm64";
}

function repoLeaf(repo: string): string {
  return repo.split("/").filter(Boolean).pop() ?? repo;
}

function isRuntimePreference(value: unknown): value is SidecarConfig["runtimePreference"] {
  return typeof value === "string" && (SIDECAR_RUNTIME_PREFERENCES as readonly string[]).includes(value);
}

function normalizeIntegerSetting(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeFloatSetting(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

class SidecarModelService {
  private config: SidecarConfig;
  private status: SidecarStatus = "not_downloaded";
  private downloadAbort: AbortController | null = null;
  private progressListeners = new Set<ProgressCallback>();

  constructor() {
    mkdirSync(MODELS_DIR, { recursive: true });
    mkdirSync(CUSTOM_MODELS_DIR, { recursive: true });
    this.config = this.loadConfig();
    this.status = this.detectStatus();
  }

  private loadConfig(): SidecarConfig {
    let nextConfig: SidecarConfig = { ...SIDECAR_DEFAULT_CONFIG };
    let shouldRewrite = false;

    try {
      if (existsSync(CONFIG_PATH)) {
        const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<SidecarConfig>;
        nextConfig = { ...SIDECAR_DEFAULT_CONFIG, ...raw };
        nextConfig.contextSize = normalizeIntegerSetting(nextConfig.contextSize, SIDECAR_DEFAULT_CONFIG.contextSize, 512, 32768);
        nextConfig.maxTokens = normalizeIntegerSetting(nextConfig.maxTokens, SIDECAR_DEFAULT_CONFIG.maxTokens, 64, 32768);
        nextConfig.temperature = normalizeFloatSetting(nextConfig.temperature, SIDECAR_DEFAULT_CONFIG.temperature, 0, 2);
        nextConfig.topP = normalizeFloatSetting(nextConfig.topP, SIDECAR_DEFAULT_CONFIG.topP, Number.EPSILON, 1);
        nextConfig.topK = normalizeIntegerSetting(nextConfig.topK, SIDECAR_DEFAULT_CONFIG.topK, 0, 500);
        nextConfig.gpuLayers = normalizeIntegerSetting(nextConfig.gpuLayers, SIDECAR_DEFAULT_CONFIG.gpuLayers, -1, 1024);

        if (!isRuntimePreference(nextConfig.runtimePreference)) {
          nextConfig.runtimePreference = SIDECAR_DEFAULT_CONFIG.runtimePreference;
          shouldRewrite = true;
        }

        // v1.5.x configs only tracked the curated quantization. Migrate them to an explicit model ref.
        if (!nextConfig.modelPath && !nextConfig.modelRepo && nextConfig.quantization) {
          const curated = SIDECAR_MODELS.find((model) => model.quantization === nextConfig.quantization);
          nextConfig.modelPath = curated?.filename ?? null;
          nextConfig.backend = "llama_cpp";
          shouldRewrite = true;
        }

        if (nextConfig.modelPath && !this.isSafeRelativeModelPath(nextConfig.modelPath)) {
          nextConfig.modelPath = null;
          nextConfig.quantization = null;
          nextConfig.customModelRepo = null;
          shouldRewrite = true;
        }

        const resolvedBackend = this.resolveBackend(nextConfig);
        if (nextConfig.backend !== resolvedBackend) {
          nextConfig.backend = resolvedBackend;
          shouldRewrite = true;
        }

        if (resolvedBackend === "llama_cpp" && nextConfig.modelRepo) {
          nextConfig.modelRepo = null;
          shouldRewrite = true;
        }

        if (resolvedBackend === "mlx" && nextConfig.modelPath) {
          nextConfig.modelPath = null;
          shouldRewrite = true;
        }
      }
    } catch {
      shouldRewrite = true;
      nextConfig = { ...SIDECAR_DEFAULT_CONFIG };
    }

    if (shouldRewrite) {
      this.writeConfig(nextConfig);
    }

    return nextConfig;
  }

  private writeConfig(config: SidecarConfig): void {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  }

  private saveConfig(): void {
    this.writeConfig(this.config);
  }

  private detectStatus(): SidecarStatus {
    return this.hasConfiguredModel() ? "downloaded" : "not_downloaded";
  }

  private isSafeRelativeModelPath(modelPath: string): boolean {
    try {
      const resolved = this.resolveModelPath(modelPath);
      const rel = relative(resolve(MODELS_DIR), resolved);
      return rel !== "" && !rel.startsWith("..") && !rel.split(/[\\/]/).includes("..");
    } catch {
      return false;
    }
  }

  private resolveModelPath(modelPath: string): string {
    return ensureWithinModelsDir(join(MODELS_DIR, modelPath));
  }

  private resolveBackend(config: SidecarConfig = this.config): SidecarBackend {
    if (config.modelPath) {
      return "llama_cpp";
    }
    if (config.backend === "mlx" && isMacAppleSilicon()) {
      return "mlx";
    }
    if (config.modelRepo && isMacAppleSilicon()) {
      return "mlx";
    }
    return isMacAppleSilicon() ? "mlx" : "llama_cpp";
  }

  private getCuratedModelsForCurrentPlatform(): SidecarModelInfo[] {
    return isMacAppleSilicon() ? SIDECAR_MLX_MODELS : SIDECAR_MODELS;
  }

  private getModelFilePathForConfig(config: SidecarConfig = this.config): string | null {
    if (!config.modelPath) return null;
    const resolved = this.resolveModelPath(config.modelPath);
    return existsSync(resolved) ? resolved : null;
  }

  private getConfiguredModelFileTarget(config: SidecarConfig): string | null {
    if (!config.modelPath) return null;
    try {
      return this.resolveModelPath(config.modelPath);
    } catch {
      return null;
    }
  }

  private hasConfiguredModel(config: SidecarConfig = this.config): boolean {
    return this.resolveBackend(config) === "mlx" ? !!config.modelRepo : this.getModelFilePathForConfig(config) !== null;
  }

  private getConfiguredModelSize(config: SidecarConfig = this.config): number | null {
    if (this.resolveBackend(config) === "mlx") {
      const curated = this.getCuratedModelsForCurrentPlatform().find(
        (model) => model.repoId === config.modelRepo || model.quantization === config.quantization,
      );
      return curated?.sizeBytes ?? null;
    }

    const modelPath = this.getModelFilePathForConfig(config);
    if (!modelPath) {
      return null;
    }

    try {
      return statSync(modelPath).size;
    } catch {
      return null;
    }
  }

  private getModelDisplayName(config: SidecarConfig = this.config): string | null {
    if (this.resolveBackend(config) === "mlx") {
      if (!config.modelRepo) {
        return null;
      }

      const curated = this.getCuratedModelsForCurrentPlatform().find((model) => model.repoId === config.modelRepo);
      return curated?.label ?? repoLeaf(config.modelRepo);
    }

    const modelPath = this.getModelFilePathForConfig(config);
    return modelPath && config.modelPath ? basename(config.modelPath) : null;
  }

  private cleanupPreviousModel(previousConfig: SidecarConfig, nextConfig: SidecarConfig): void {
    const previousBackend = this.resolveBackend(previousConfig);
    const nextBackend = this.resolveBackend(nextConfig);

    if (previousBackend === "mlx") {
      if (previousConfig.modelRepo && previousConfig.modelRepo !== nextConfig.modelRepo) {
        mlxRuntimeService.clearModelCache();
      }
      return;
    }

    const previousPath = this.getConfiguredModelFileTarget(previousConfig);
    if (!previousPath || !existsSync(previousPath)) {
      return;
    }

    if (nextBackend === "llama_cpp") {
      const nextPath = this.getConfiguredModelFileTarget(nextConfig);
      if (nextPath === previousPath) {
        return;
      }
    }

    unlinkSync(previousPath);
  }

  private async fetchRepoInfo(repo: string): Promise<HuggingFaceModelApiResponse> {
    return await fetchJson<HuggingFaceModelApiResponse>(`https://huggingface.co/api/models/${repo}`);
  }

  private inferMlxQuantizationLabel(info: HuggingFaceModelApiResponse, entries: HuggingFaceTreeEntry[]): string | null {
    const quantizationBits = info.config?.quantization_config?.bits;
    if (typeof quantizationBits === "number" && Number.isFinite(quantizationBits)) {
      return `${quantizationBits}-bit MLX`;
    }

    const tag = info.tags?.find((value) => /^\d+-bit$/i.test(value));
    if (tag) {
      return `${tag} MLX`;
    }

    const hasOptiqMetadata = entries.some((entry) => entry.path?.toLowerCase().endsWith("optiq_metadata.json"));
    if (hasOptiqMetadata) {
      return "OptiQ MLX";
    }

    return "MLX";
  }

  private inferMlxRepoSize(info: HuggingFaceModelApiResponse, entries: HuggingFaceTreeEntry[]): number | null {
    const safetensorsTotal = info.safetensors?.total;
    if (typeof safetensorsTotal === "number" && Number.isFinite(safetensorsTotal) && safetensorsTotal > 0) {
      return safetensorsTotal;
    }

    const total = entries.reduce((sum, entry) => {
      const isWeightFile = entry.path?.toLowerCase().endsWith(".safetensors");
      if (!isWeightFile) {
        return sum;
      }
      return sum + (entry.size ?? entry.lfs?.size ?? 0);
    }, 0);
    return total > 0 ? total : null;
  }

  private isMlxRepo(info: HuggingFaceModelApiResponse, entries: HuggingFaceTreeEntry[]): boolean {
    const tags = new Set((info.tags ?? []).map((tag) => tag.toLowerCase()));
    if (info.gguf || tags.has("gguf")) {
      return false;
    }

    if ((info.library_name ?? "").toLowerCase() === "mlx" || tags.has("mlx")) {
      return true;
    }

    const files = entries.map((entry) => entry.path?.toLowerCase() ?? "");
    if (files.some((path) => path.endsWith(".gguf"))) {
      return false;
    }

    const hasConfig = files.some((path) => path.endsWith("config.json"));
    const hasTokenizer = files.some((path) => path.endsWith("tokenizer.json") || path.endsWith("tokenizer.model"));
    const hasSafetensors = files.some((path) => path.endsWith(".safetensors"));
    return hasConfig && hasTokenizer && hasSafetensors;
  }

  private async resolveCustomMlxRepo(repo: string): Promise<SidecarCustomModelEntry> {
    const info = await this.fetchRepoInfo(repo);
    const tags = new Set((info.tags ?? []).map((tag) => tag.toLowerCase()));
    const isClearlyGguf = Boolean(info.gguf) || tags.has("gguf");
    const isClearlyMlx = (info.library_name ?? "").toLowerCase() === "mlx" || tags.has("mlx");
    const entries = isClearlyMlx || isClearlyGguf ? [] : await this.fetchRepoTree(repo);

    if (!this.isMlxRepo(info, entries)) {
      throw new Error(
        "That repository does not look like an MLX model repo. On Apple Silicon, custom HuggingFace models must be MLX-native repos, not GGUF repos.",
      );
    }

    return {
      path: repo,
      filename: repo,
      sizeBytes: this.inferMlxRepoSize(info, entries),
      quantizationLabel: this.inferMlxQuantizationLabel(info, entries),
      downloadUrl: `https://huggingface.co/${repo}`,
    };
  }

  private emitProgress(progress: SidecarDownloadProgress, inline?: ProgressCallback): void {
    inline?.(progress);
    for (const listener of this.progressListeners) {
      listener(progress);
    }
  }

  private buildModelErrorProgress(error: unknown): SidecarDownloadProgress {
    return {
      phase: "model",
      status: "error",
      downloaded: 0,
      total: 0,
      speed: 0,
      error: error instanceof Error ? error.message : "Model download failed",
    };
  }

  getStatus(): SidecarStatusResponse {
    const backend = this.resolveBackend();
    const runtime =
      backend === "mlx"
        ? mlxRuntimeService.getStatus()
        : {
            ...sidecarRuntimeService.getStatus(this.config.runtimePreference),
            backend: "llama_cpp" as const,
          };

    return {
      status: this.status,
      config: { ...this.config, backend },
      modelDownloaded: this.hasConfiguredModel(),
      modelDisplayName: this.getModelDisplayName(),
      modelSize: this.getConfiguredModelSize(),
      runtime,
      logPath: sidecarRuntimeService.getLogPath(),
      platform: process.platform,
      arch: process.arch,
      curatedModels: this.getCuratedModelsForCurrentPlatform(),
      runtimeDiagnostics: backend === "mlx" ? undefined : sidecarRuntimeService.getDiagnostics(),
    };
  }

  getConfig(): SidecarConfig {
    return { ...this.config, backend: this.resolveBackend() };
  }

  isEnabled(): boolean {
    return this.config.useForGameScene || this.config.useForTrackers;
  }

  getResolvedBackend(): SidecarBackend {
    return this.resolveBackend();
  }

  getConfiguredModelRef(): string | null {
    return this.resolveBackend() === "mlx" ? this.config.modelRepo : this.getModelFilePath();
  }

  getModelFilePath(): string | null {
    return this.getModelFilePathForConfig();
  }

  getModelRelativePath(): string | null {
    return this.getModelFilePath() ? this.config.modelPath : null;
  }

  isReady(): boolean {
    return this.status === "ready" || this.status === "downloaded" || this.status === "starting_server";
  }

  updateConfig(
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
  ): SidecarConfig {
    this.config = { ...this.config, ...partial };
    this.saveConfig();
    if (this.status === "not_downloaded" && this.hasConfiguredModel()) {
      this.status = "downloaded";
    }
    return { ...this.config, backend: this.resolveBackend() };
  }

  async download(quantization: SidecarQuantization, onProgress?: ProgressCallback): Promise<void> {
    const modelInfo = this.getCuratedModelsForCurrentPlatform().find((model) => model.quantization === quantization);
    if (!modelInfo) {
      throw new Error(`Unknown sidecar quantization: ${quantization}`);
    }

    const previousConfig = { ...this.config };

    if (modelInfo.backend === "mlx") {
      const repoId = modelInfo.repoId ?? modelInfo.filename;
      const nextConfig: SidecarConfig = {
        ...previousConfig,
        backend: "mlx",
        modelPath: null,
        modelRepo: repoId,
        quantization,
        customModelRepo: null,
      };
      this.cleanupPreviousModel(previousConfig, nextConfig);
      this.config = nextConfig;
      this.saveConfig();
      this.status = "downloaded";
      this.emitProgress(
        {
          phase: "model",
          status: "complete",
          downloaded: modelInfo.sizeBytes,
          total: modelInfo.sizeBytes,
          speed: 0,
          label: modelInfo.label,
        },
        onProgress,
      );
      return;
    }

    const relativePath = modelInfo.filename;
    const destination = this.resolveModelPath(relativePath);
    const nextConfig: SidecarConfig = {
      ...previousConfig,
      backend: "llama_cpp",
      modelPath: relativePath,
      modelRepo: null,
      quantization,
      customModelRepo: null,
    };
    if (existsSync(destination)) {
      this.cleanupPreviousModel(previousConfig, nextConfig);
      this.config = nextConfig;
      this.saveConfig();
      this.status = "downloaded";
      this.emitProgress(
        {
          phase: "model",
          status: "complete",
          downloaded: modelInfo.sizeBytes,
          total: modelInfo.sizeBytes,
          speed: 0,
          label: modelInfo.label,
        },
        onProgress,
      );
      return;
    }

    if (!modelInfo.downloadUrl) {
      throw new Error(`The ${modelInfo.label} preset is missing a download URL.`);
    }

    await this.downloadModelFile(
      {
        url: modelInfo.downloadUrl,
        relativePath,
        label: modelInfo.label,
      },
      onProgress,
    );

    this.cleanupPreviousModel(previousConfig, nextConfig);
    this.config = nextConfig;
    this.saveConfig();
    this.status = "downloaded";
  }

  async listHuggingFaceModels(repoInput: string): Promise<SidecarCustomModelEntry[]> {
    const repo = normalizeRepoPath(repoInput);
    if (!isValidRepoPath(repo)) {
      throw new Error("Repository must be in owner/repo format");
    }

    if (isMacAppleSilicon()) {
      return [await this.resolveCustomMlxRepo(repo)];
    }

    const entries = await this.fetchRepoTree(repo);
    const ggufEntries = entries.filter(
      (entry) => entry.type === "file" && entry.path && isSupportedLlamaCppModelFilename(entry.path),
    );
    if (ggufEntries.length === 0) {
      return [];
    }

    return ggufEntries
      .map((entry) => {
        const path = entry.path!;
        return {
          path,
          filename: basename(path),
          sizeBytes: entry.size ?? entry.lfs?.size ?? null,
          quantizationLabel: extractQuantizationLabel(path),
          downloadUrl: buildHuggingFaceDownloadUrl(repo, path),
        } satisfies SidecarCustomModelEntry;
      })
      .sort((a, b) => a.filename.localeCompare(b.filename));
  }

  async downloadCustomModel(
    repoInput: string,
    modelPath?: string,
    onProgress?: ProgressCallback,
  ): Promise<SidecarCustomModelEntry> {
    const repo = normalizeRepoPath(repoInput);
    if (!isValidRepoPath(repo)) {
      throw new Error("Repository must be in owner/repo format");
    }

    const previousConfig = { ...this.config };

    if (isMacAppleSilicon()) {
      const selected = await this.resolveCustomMlxRepo(repo);
      const nextConfig: SidecarConfig = {
        ...previousConfig,
        backend: "mlx",
        modelPath: null,
        modelRepo: repo,
        quantization: null,
        customModelRepo: repo,
      };
      this.cleanupPreviousModel(previousConfig, nextConfig);
      this.config = nextConfig;
      this.saveConfig();
      this.status = "downloaded";
      this.emitProgress(
        {
          phase: "model",
          status: "complete",
          downloaded: selected.sizeBytes ?? 0,
          total: selected.sizeBytes ?? 0,
          speed: 0,
          label: selected.filename,
        },
        onProgress,
      );
      return selected;
    }

    const models = await this.listHuggingFaceModels(repo);
    const selected = models.find((entry) => entry.path === modelPath || entry.filename === modelPath);
    if (!selected) {
      throw new Error("Selected GGUF was not found in that repository");
    }
    assertSupportedLlamaCppModelPath(selected.path);

    const relativePath = join("custom", `${slugifyRepo(repo)}__${selected.filename}`).replace(/\\/g, "/");
    const destination = this.resolveModelPath(relativePath);
    const nextConfig: SidecarConfig = {
      ...previousConfig,
      backend: "llama_cpp",
      modelPath: relativePath,
      modelRepo: null,
      quantization: null,
      customModelRepo: repo,
    };
    if (!existsSync(destination)) {
      await this.downloadModelFile(
        {
          url: selected.downloadUrl,
          relativePath,
          label: selected.filename,
        },
        onProgress,
      );
    } else {
      this.emitProgress(
        {
          phase: "model",
          status: "complete",
          downloaded: selected.sizeBytes ?? 0,
          total: selected.sizeBytes ?? 0,
          speed: 0,
          label: selected.filename,
        },
        onProgress,
      );
    }

    this.cleanupPreviousModel(previousConfig, nextConfig);
    this.config = nextConfig;
    this.saveConfig();
    this.status = "downloaded";
    return selected;
  }

  private async fetchRepoTree(repo: string): Promise<HuggingFaceTreeEntry[]> {
    const attempts = [
      `https://huggingface.co/api/models/${repo}/tree/main?recursive=1`,
      `https://huggingface.co/api/models/${repo}/tree/master?recursive=1`,
    ];

    let lastError: unknown;
    for (const url of attempts) {
      try {
        return await fetchJson<HuggingFaceTreeEntry[]>(url);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Failed to load HuggingFace repository tree");
  }

  private async downloadModelFile(
    input: { url: string; relativePath: string; label: string },
    onProgress?: ProgressCallback,
  ): Promise<void> {
    if (this.downloadAbort) {
      throw new Error("Another sidecar download is already in progress");
    }

    this.status = "downloading_model";
    this.downloadAbort = new AbortController();
    const destination = this.resolveModelPath(input.relativePath);

    try {
      await downloadFileWithProgress({
        url: input.url,
        destPath: destination,
        signal: this.downloadAbort.signal,
        progress: {
          phase: "model",
          label: input.label,
        },
        onProgress: (progress) => this.emitProgress(progress, onProgress),
      });
    } catch (error) {
      this.status = this.detectStatus();
      if (isAbortError(error)) {
        throw new Error("Download cancelled");
      }

      const progress = this.buildModelErrorProgress(error);
      this.emitProgress(progress, onProgress);
      throw error;
    } finally {
      this.downloadAbort = null;
    }
  }

  cancelDownload(): void {
    this.downloadAbort?.abort();
    this.downloadAbort = null;
  }

  deleteModel(): void {
    if (this.resolveBackend() === "mlx") {
      mlxRuntimeService.clearModelCache();
    } else {
      const modelPath = this.getModelFilePath();
      if (modelPath && existsSync(modelPath)) {
        unlinkSync(modelPath);
      }
    }

    this.config = {
      ...this.config,
      backend: isMacAppleSilicon() ? "mlx" : "llama_cpp",
      modelPath: null,
      modelRepo: null,
      quantization: null,
      customModelRepo: null,
    };
    this.saveConfig();
    this.status = "not_downloaded";
  }

  addProgressListener(callback: ProgressCallback): void {
    this.progressListeners.add(callback);
  }

  removeProgressListener(callback: ProgressCallback): void {
    this.progressListeners.delete(callback);
  }

  setStatus(status: SidecarStatus): void {
    this.status = status;
  }

  emitExternalProgress(progress: SidecarDownloadProgress): void {
    this.emitProgress(progress);
  }

  clearLegacyRuntimeStamp(): void {
    try {
      if (existsSync(LEGACY_RUNTIME_STAMP_PATH)) {
        unlinkSync(LEGACY_RUNTIME_STAMP_PATH);
      }
    } catch {
      // Best-effort cleanup for v1.5.x build stamp residue.
    }
  }
}

export const sidecarModelService = new SidecarModelService();
