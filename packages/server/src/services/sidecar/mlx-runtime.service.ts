import { execFileSync, spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import type { SidecarDownloadProgress, SidecarRuntimeInfo } from "@marinara-engine/shared";
import { getDataDir } from "../../utils/data-dir.js";
import { isAbortError, retry } from "./sidecar-download.js";

const MLX_RUNTIME_DIR = join(getDataDir(), "sidecar-runtime", "mlx");
const MLX_UV_DIR = join(MLX_RUNTIME_DIR, "uv");
const MLX_UV_CACHE_DIR = join(MLX_RUNTIME_DIR, "uv-cache");
const MLX_PYTHON_INSTALL_DIR = join(MLX_RUNTIME_DIR, "python");
const MLX_PYTHON_BIN_DIR = join(MLX_RUNTIME_DIR, "python-bin");
const MLX_VENV_DIR = join(MLX_RUNTIME_DIR, ".venv");
const MLX_HF_HOME = join(MLX_RUNTIME_DIR, "hf-home");
const UV_BIN = process.platform === "win32" ? join(MLX_UV_DIR, "uv.exe") : join(MLX_UV_DIR, "uv");
const VENV_PYTHON =
  process.platform === "win32" ? join(MLX_VENV_DIR, "Scripts", "python.exe") : join(MLX_VENV_DIR, "bin", "python");
const UV_INSTALLER_URL = "https://astral.sh/uv/install.sh";
const PYTHON_VERSION = "3.12";

export interface MlxRuntimeInstall {
  backend: "mlx";
  build: string;
  variant: string;
  platform: NodeJS.Platform;
  arch: string;
  directoryPath: string;
  pythonPath: string;
  hfHomePath: string;
}

function isSupportedPlatform(): boolean {
  return process.platform === "darwin" && process.arch === "arm64";
}

function isInstalled(): boolean {
  return existsSync(VENV_PYTHON);
}

function readBundledUvVersion(): string | null {
  if (!existsSync(UV_BIN)) {
    return null;
  }

  try {
    return execFileSync(UV_BIN, ["--version"], {
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
  } catch {
    return null;
  }
}

function readInstalledVersion(): string | null {
  if (!isInstalled()) {
    return null;
  }

  try {
    return execFileSync(VENV_PYTHON, ["-c", "import importlib.metadata; print(importlib.metadata.version('mlx-lm'))"], {
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
  } catch {
    return null;
  }
}

function buildInstallRecord(version: string): MlxRuntimeInstall {
  return {
    backend: "mlx",
    build: `mlx-lm ${version}`,
    variant: "macos-arm64-mlx",
    platform: process.platform,
    arch: process.arch,
    directoryPath: MLX_RUNTIME_DIR,
    pythonPath: VENV_PYTHON,
    hfHomePath: MLX_HF_HOME,
  };
}

class MlxRuntimeService {
  private installPromise: Promise<MlxRuntimeInstall> | null = null;
  private activeChild: ChildProcess | null = null;
  private activeFetchAbort: AbortController | null = null;
  private cancelRequested = false;

  getStatus(): SidecarRuntimeInfo {
    const version = readInstalledVersion();
    return {
      installed: version !== null,
      build: version ? `mlx-lm ${version}` : null,
      variant: isSupportedPlatform() ? "macos-arm64-mlx" : null,
      backend: "mlx",
      source: "bundled",
      systemPath: null,
    };
  }

  getHfHomePath(): string {
    return MLX_HF_HOME;
  }

  cancelInstall(): void {
    this.cancelRequested = true;
    this.activeFetchAbort?.abort();
    this.activeFetchAbort = null;
    const child = this.activeChild;
    if (!child) {
      return;
    }

    try {
      child.kill("SIGTERM");
    } catch {
      // Best-effort cancel.
    }
  }

  resetRuntime(): void {
    this.cancelInstall();
    rmSync(MLX_RUNTIME_DIR, { recursive: true, force: true });
  }

  clearModelCache(): void {
    rmSync(MLX_HF_HOME, { recursive: true, force: true });
  }

  async ensureInstalled(onProgress?: (progress: SidecarDownloadProgress) => void): Promise<MlxRuntimeInstall> {
    const installedVersion = readInstalledVersion();
    if (installedVersion) {
      return buildInstallRecord(installedVersion);
    }

    if (this.installPromise) {
      return this.installPromise;
    }

    this.installPromise = this.installLatest(onProgress).finally(() => {
      this.installPromise = null;
      this.activeChild = null;
      this.activeFetchAbort = null;
      this.cancelRequested = false;
    });
    return this.installPromise;
  }

  private emitProgress(
    onProgress: ((progress: SidecarDownloadProgress) => void) | undefined,
    status: SidecarDownloadProgress["status"],
    label: string,
    error?: string,
  ): void {
    onProgress?.({
      phase: "runtime",
      status,
      downloaded: 0,
      total: 0,
      speed: 0,
      label,
      error,
    });
  }

  private async installLatest(onProgress?: (progress: SidecarDownloadProgress) => void): Promise<MlxRuntimeInstall> {
    if (!isSupportedPlatform()) {
      throw new Error("The MLX sidecar is only supported on macOS Apple Silicon.");
    }

    mkdirSync(MLX_RUNTIME_DIR, { recursive: true });
    mkdirSync(MLX_UV_DIR, { recursive: true });
    mkdirSync(MLX_UV_CACHE_DIR, { recursive: true });
    mkdirSync(MLX_PYTHON_INSTALL_DIR, { recursive: true });
    mkdirSync(MLX_PYTHON_BIN_DIR, { recursive: true });
    mkdirSync(MLX_HF_HOME, { recursive: true });
    this.cancelRequested = false;

    await this.ensureUvInstalled(onProgress);

    try {
      this.emitProgress(onProgress, "downloading", `Python ${PYTHON_VERSION} runtime`);
      await this.runCommand(UV_BIN, ["venv", MLX_VENV_DIR, "--python", PYTHON_VERSION], {
        cwd: MLX_RUNTIME_DIR,
        env: this.getUvEnv(),
      });
      this.emitProgress(onProgress, "downloading", "MLX runtime dependencies");
      await this.runCommand(UV_BIN, ["pip", "install", "--python", VENV_PYTHON, "mlx-lm"], {
        cwd: MLX_RUNTIME_DIR,
        env: this.getUvEnv(),
      });
      this.emitProgress(onProgress, "downloading", "Verifying MLX runtime");
    } catch (error) {
      this.emitProgress(
        onProgress,
        "error",
        "mlx-lm runtime",
        error instanceof Error ? error.message : "Failed to prepare the MLX runtime",
      );
      throw error;
    }

    const version = readInstalledVersion();
    if (!version) {
      throw new Error("The MLX runtime environment was created, but mlx-lm could not be verified.");
    }

    this.emitProgress(onProgress, "complete", "mlx-lm runtime");
    return buildInstallRecord(version);
  }

  private getUvEnv(): NodeJS.ProcessEnv {
    return {
      UV_CACHE_DIR: MLX_UV_CACHE_DIR,
      UV_PYTHON_INSTALL_DIR: MLX_PYTHON_INSTALL_DIR,
      UV_PYTHON_BIN_DIR: MLX_PYTHON_BIN_DIR,
      UV_PYTHON_INSTALL_BIN: "0",
      UV_MANAGED_PYTHON: "1",
      UV_NO_CONFIG: "1",
    };
  }

  private async ensureUvInstalled(onProgress?: (progress: SidecarDownloadProgress) => void): Promise<void> {
    if (readBundledUvVersion()) {
      return;
    }

    this.emitProgress(onProgress, "downloading", "uv dependency manager");

    let script: string;
    try {
      script = await retry(
        async () => {
          const abortController = new AbortController();
          this.activeFetchAbort = abortController;
          try {
            const response = await fetch(UV_INSTALLER_URL, {
              signal: abortController.signal,
              headers: {
                "User-Agent": "MarinaraEngine",
              },
            });

            if (!response.ok) {
              const raw = await response.text().catch(() => "");
              throw new Error(
                `Failed to download the uv installer: HTTP ${response.status} ${raw || response.statusText}`.trim(),
              );
            }

            const text = await response.text();
            if (!text.trim()) {
              throw new Error("Failed to download the uv installer: received an empty response.");
            }

            return text;
          } finally {
            this.activeFetchAbort = null;
          }
        },
        {
          retries: 2,
          baseDelayMs: 500,
          shouldRetry: (error) => !isAbortError(error),
        },
      );
    } catch (error) {
      if (isAbortError(error) || this.cancelRequested) {
        throw new Error("Install aborted");
      }
      throw error;
    }

    try {
      this.emitProgress(onProgress, "downloading", "Installing uv dependency manager");
      await this.runCommand("/bin/sh", ["-s"], {
        cwd: MLX_RUNTIME_DIR,
        env: {
          UV_UNMANAGED_INSTALL: MLX_UV_DIR,
          UV_NO_MODIFY_PATH: "1",
        },
        stdin: script,
      });
    } catch (error) {
      if (isAbortError(error) || this.cancelRequested) {
        throw new Error("Install aborted");
      }

      throw new Error(
        error instanceof Error
          ? `Failed to bootstrap uv for the MLX runtime.\n${error.message}`
          : "Failed to bootstrap uv for the MLX runtime.",
      );
    }

    if (!readBundledUvVersion()) {
      throw new Error("The private uv bootstrap completed, but the bundled uv binary could not be verified.");
    }
  }

  private async runCommand(
    command: string,
    args: string[],
    options: {
      cwd: string;
      env?: NodeJS.ProcessEnv;
      stdin?: string;
    },
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
        },
        stdio: [options.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      this.activeChild = child;

      let combinedOutput = "";
      if (options.stdin !== undefined) {
        child.stdin?.on("error", () => {
          // Ignore broken pipes if the child exits early.
        });
        child.stdin?.end(options.stdin);
      }
      child.stdout?.on("data", (chunk) => {
        combinedOutput += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        combinedOutput += String(chunk);
      });

      child.on("error", (error) => {
        this.activeChild = null;
        reject(error);
      });
      child.on("close", (code, signal) => {
        this.activeChild = null;
        if (code === 0) {
          resolve();
          return;
        }

        if (this.cancelRequested) {
          reject(new Error("Install aborted"));
          return;
        }

        const reason = signal ? `signal ${signal}` : `exit ${code ?? "null"}`;
        const details = combinedOutput.trim();
        reject(new Error(details ? `${command} ${reason}\n${details}` : `${command} ${reason}`));
      });
    });
  }
}

export const mlxRuntimeService = new MlxRuntimeService();
