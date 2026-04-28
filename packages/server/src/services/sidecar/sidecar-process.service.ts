import { spawn, type ChildProcess } from "child_process";
import { logger } from "../../lib/logger.js";
import { createWriteStream, existsSync, readFileSync, writeFileSync, type WriteStream } from "fs";
import { createServer } from "net";
import { dirname, join } from "path";
import type { SidecarBackend } from "@marinara-engine/shared";
import { sidecarModelService } from "./sidecar-model.service.js";
import { isAbortError } from "./sidecar-download.js";
import { buildLlamaArgs, buildLlamaStartupPlans } from "./sidecar-launch-plan.js";
import { buildLlamaProcessEnv } from "./sidecar-runtime-env.js";
import { mlxRuntimeService, type MlxRuntimeInstall } from "./mlx-runtime.service.js";
import { sidecarRuntimeService, type SidecarRuntimeInstall } from "./sidecar-runtime.service.js";
import { assertSupportedLlamaCppModelPath } from "./sidecar-model-files.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a localhost port")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

type ManagedRuntimeInstall = SidecarRuntimeInstall | MlxRuntimeInstall;
type SyncOptions = {
  suppressKnownFailure?: boolean;
  forceStart?: boolean;
  allowRuntimeInstall?: boolean;
};
type EnsureReadyOptions = {
  forceStart?: boolean;
  allowRuntimeInstall?: boolean;
};

class SidecarServerExitError extends Error {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;

  constructor(code: number | null, signal: NodeJS.Signals | null) {
    const reason = signal ? `signal ${signal}` : `exit ${code ?? "null"}`;
    super(`The local sidecar server exited before becoming ready (${reason})`);
    this.name = "SidecarServerExitError";
    this.exitCode = code;
    this.signal = signal;
  }
}

class SidecarProcessService {
  private child: ChildProcess | null = null;
  private logStream: WriteStream | null = null;
  private baseUrl: string | null = null;
  private ready = false;
  private currentSignature: string | null = null;
  private failedSignature: string | null = null;
  private startupError: string | null = null;
  private failedRuntimeVariant: string | null = null;
  private intentionalStop = false;
  private unexpectedCrashCount = 0;
  private lastReadyAt = 0;
  private starting = false;
  private syncLock: Promise<void> = Promise.resolve();

  isReady(): boolean {
    return this.ready && this.baseUrl !== null;
  }

  getBaseUrl(): string | null {
    return this.baseUrl;
  }

  getStartupError(): string | null {
    return this.startupError;
  }

  getFailedRuntimeVariant(): string | null {
    return this.failedRuntimeVariant;
  }

  async ensureReady(options: EnsureReadyOptions = {}): Promise<string> {
    const forceStart = options.forceStart ?? false;
    const allowRuntimeInstall = options.allowRuntimeInstall ?? false;
    await this.syncForCurrentConfig({
      suppressKnownFailure: !forceStart,
      forceStart,
      allowRuntimeInstall,
    });
    if (!this.ready || !this.baseUrl) {
      throw this.buildNotReadyError({ forceStart });
    }
    return this.baseUrl;
  }

  async syncForCurrentConfig(options?: boolean | SyncOptions): Promise<void> {
    const normalizedOptions = this.normalizeSyncOptions(options);
    return this.withLock(async () => {
      await this.syncUnlocked(normalizedOptions);
    });
  }

  async restart(): Promise<void> {
    return this.withLock(async () => {
      this.clearStartupFailure();
      this.currentSignature = null;
      await this.stopUnlocked();
      await this.syncUnlocked({ forceStart: true, allowRuntimeInstall: false });
      if (!this.ready || !this.baseUrl) {
        throw this.buildNotReadyError({ forceStart: true });
      }
    });
  }

  async installRuntime(): Promise<void> {
    return this.withLock(async () => {
      this.clearStartupFailure();
      const backend = sidecarModelService.getResolvedBackend();
      const hadUsableRuntime = this.isRuntimeInstalled(backend);
      if (!hadUsableRuntime) {
        await this.stopUnlocked();
      }
      await this.ensureRuntimeInstalled(backend);
      if (!hadUsableRuntime) {
        this.cleanupInactiveRuntimeBackends(backend);
      }

      if (sidecarModelService.getConfiguredModelRef() && sidecarModelService.isEnabled()) {
        await this.syncUnlocked({ allowRuntimeInstall: false });
      } else {
        sidecarModelService.setStatus(sidecarModelService.getConfiguredModelRef() ? "downloaded" : "not_downloaded");
      }
    });
  }

  async reinstallRuntime(): Promise<void> {
    return this.withLock(async () => {
      await this.stopUnlocked();
      this.clearStartupFailure();

      const backend = sidecarModelService.getResolvedBackend();
      if (backend === "mlx") {
        mlxRuntimeService.resetRuntime();
      } else {
        if (sidecarRuntimeService.getStatus(sidecarModelService.getConfig().runtimePreference).source === "system") {
          throw new Error(
            "The local runtime is using a system llama-server from PATH. Reinstall that runtime outside Marinara.",
          );
        }
        sidecarRuntimeService.resetRuntime();
      }

      if (sidecarModelService.getConfiguredModelRef() && sidecarModelService.isEnabled()) {
        await this.syncUnlocked({ allowRuntimeInstall: true });
      } else {
        await this.ensureRuntimeInstalled(backend);
        sidecarModelService.setStatus(sidecarModelService.getConfiguredModelRef() ? "downloaded" : "not_downloaded");
      }

      this.cleanupInactiveRuntimeBackends(backend);
    });
  }

  async stop(): Promise<void> {
    if (this.starting && this.child) {
      this.intentionalStop = true;
      try {
        this.child.kill("SIGTERM");
      } catch {
        // Best-effort early stop while startup is still waiting.
      }
    }

    return this.withLock(async () => {
      await this.stopUnlocked();
      this.clearStartupFailure();
      if (sidecarModelService.getConfiguredModelRef()) {
        sidecarModelService.setStatus("downloaded");
      } else {
        sidecarModelService.setStatus("not_downloaded");
      }
    });
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.syncLock;
    this.syncLock = next;
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private normalizeSyncOptions(options?: boolean | SyncOptions): SyncOptions {
    if (typeof options === "boolean") {
      return { forceStart: options, allowRuntimeInstall: false };
    }
    return options ?? {};
  }

  private buildNotReadyError(options: { forceStart?: boolean } = {}): Error {
    if (!sidecarModelService.getConfiguredModelRef()) {
      return new Error("Download or select a local model before using the local sidecar.");
    }

    const backend = sidecarModelService.getResolvedBackend();
    if (!this.isRuntimeInstalled(backend)) {
      return new Error("Install the local runtime from Local AI Model before using the local sidecar.");
    }

    if (!options.forceStart && !sidecarModelService.isEnabled()) {
      return new Error(
        "Enable the local model for trackers or game scene analysis, or start it manually from Local AI Model.",
      );
    }

    return new Error(this.startupError ?? "The local sidecar server is not ready");
  }

  private isRuntimeInstalled(backend: SidecarBackend): boolean {
    if (backend === "mlx") {
      return mlxRuntimeService.getStatus().installed;
    }

    return sidecarRuntimeService.getStatus(sidecarModelService.getConfig().runtimePreference).installed;
  }

  private async syncUnlocked(options: SyncOptions = {}): Promise<void> {
    const modelRef = sidecarModelService.getConfiguredModelRef();
    const backend = sidecarModelService.getResolvedBackend();

    if (!modelRef) {
      await this.stopUnlocked();
      this.clearStartupFailure();
      sidecarModelService.setStatus("not_downloaded");
      return;
    }

    if (!options.forceStart && !sidecarModelService.isEnabled()) {
      await this.stopUnlocked();
      this.clearStartupFailure();
      sidecarModelService.setStatus("downloaded");
      return;
    }

    if (!options.allowRuntimeInstall && !this.isRuntimeInstalled(backend)) {
      await this.stopUnlocked();
      this.clearStartupFailure();
      sidecarModelService.setStatus("downloaded");
      return;
    }

    const runtime = await this.ensureRuntimeInstalled(backend);
    const nextSignature = this.buildRuntimeSignature(backend, runtime, modelRef);

    if (this.child && this.ready && this.currentSignature === nextSignature) {
      sidecarModelService.setStatus("ready");
      return;
    }

    if (options.suppressKnownFailure && !this.child && !this.ready && this.failedSignature === nextSignature) {
      sidecarModelService.setStatus("server_error");
      return;
    }

    sidecarModelService.setStatus("starting_server");
    await this.stopUnlocked();
    await this.startUnlocked(runtime, modelRef);
  }

  private async ensureRuntimeInstalled(
    backend: SidecarBackend,
    options?: { excludeVariants?: string[] },
  ): Promise<ManagedRuntimeInstall> {
    sidecarModelService.setStatus("downloading_runtime");
    try {
      if (backend === "mlx") {
        return await mlxRuntimeService.ensureInstalled((progress) => {
          sidecarModelService.emitExternalProgress(progress);
        });
      }

      return await sidecarRuntimeService.ensureInstalled(
        (progress) => {
          sidecarModelService.emitExternalProgress(progress);
        },
        {
          ...options,
          preference: sidecarModelService.getConfig().runtimePreference,
        },
      );
    } catch (error) {
      if (isAbortError(error)) {
        sidecarModelService.setStatus(sidecarModelService.getConfiguredModelRef() ? "downloaded" : "not_downloaded");
      } else {
        sidecarModelService.setStatus("server_error");
      }
      throw error;
    }
  }

  private isMlxRuntime(runtime: ManagedRuntimeInstall): runtime is MlxRuntimeInstall {
    return "pythonPath" in runtime;
  }

  private cleanupInactiveRuntimeBackends(activeBackend: SidecarBackend): void {
    if (activeBackend === "mlx") {
      sidecarRuntimeService.resetRuntime();
      return;
    }

    mlxRuntimeService.resetRuntime();
  }

  private getLlamaServerPath(runtime: ManagedRuntimeInstall): string {
    if (this.isMlxRuntime(runtime)) {
      throw new Error("Expected a llama.cpp runtime install");
    }
    return runtime.serverPath;
  }

  private getMlxPythonPath(runtime: ManagedRuntimeInstall): string {
    if (!this.isMlxRuntime(runtime)) {
      throw new Error("Expected an MLX runtime install");
    }
    return runtime.pythonPath;
  }

  private buildLlamaArgs(modelPath: string, gpuLayers: number, port: number, runtime: SidecarRuntimeInstall): string[] {
    const config = sidecarModelService.getConfig();
    return buildLlamaArgs({
      modelPath,
      gpuLayers,
      port,
      contextSize: config.contextSize,
      runtimeVariant: runtime.variant,
    });
  }

  private buildMlxArgs(modelRepo: string, port: number): string[] {
    return ["-m", "mlx_lm.server", "--model", modelRepo, "--host", "127.0.0.1", "--port", String(port)];
  }

  private usesGpuRuntime(runtime: SidecarRuntimeInstall): boolean {
    return runtime.gpuCapable ?? sidecarRuntimeService.isGpuVariant(runtime.variant);
  }

  private buildLlamaStartupPlans(runtime: SidecarRuntimeInstall): Array<{ gpuLayers: number; label: string }> {
    const config = sidecarModelService.getConfig();
    return buildLlamaStartupPlans({
      configuredGpuLayers: config.gpuLayers,
      usesGpuRuntime: this.usesGpuRuntime(runtime),
    });
  }

  private shouldRetryStartup(error: unknown): error is SidecarServerExitError {
    return error instanceof SidecarServerExitError;
  }

  private formatCommandArgs(args: string[]): string {
    return args.map((arg) => (/[\s"]/u.test(arg) ? JSON.stringify(arg) : arg)).join(" ");
  }

  private readRecentLogLines(maxLines = 12): string | null {
    try {
      const log = readFileSync(sidecarRuntimeService.getLogPath(), "utf-8").trim();
      if (!log) {
        return null;
      }
      return log.split(/\r?\n/u).slice(-maxLines).join("\n");
    } catch {
      return null;
    }
  }

  private decorateStartupError(error: unknown, commandFile: string, args: string[]): Error {
    const baseMessage = error instanceof Error ? error.message : "The local sidecar server failed to start";
    const commandLine = `${commandFile} ${this.formatCommandArgs(args)}`.trim();
    const recentLogs = this.readRecentLogLines();
    if (!recentLogs) {
      return new Error(`${baseMessage}\nCommand: ${commandLine}`);
    }
    return new Error(`${baseMessage}\nCommand: ${commandLine}\nRecent sidecar log:\n${recentLogs}`);
  }

  private getChildExitError(child: ChildProcess): SidecarServerExitError | null {
    if (child.exitCode === null && child.signalCode === null) {
      return null;
    }
    return new SidecarServerExitError(child.exitCode, child.signalCode);
  }

  private buildRuntimeSignature(backend: SidecarBackend, runtime: ManagedRuntimeInstall, modelRef: string): string {
    const config = sidecarModelService.getConfig();
    return backend === "mlx"
      ? JSON.stringify({
          backend,
          pythonPath: this.getMlxPythonPath(runtime),
          modelRef,
        })
      : JSON.stringify({
          backend,
          serverPath: this.getLlamaServerPath(runtime),
          modelRef,
          contextSize: config.contextSize,
          gpuLayers: config.gpuLayers,
        });
  }

  private clearStartupFailure(): void {
    this.failedSignature = null;
    this.startupError = null;
    this.failedRuntimeVariant = null;
  }

  private summarizeStartupError(error: unknown): string {
    const message = error instanceof Error ? error.message : "The local sidecar server failed to start";
    return message.split(/\r?\n/u)[0]?.trim() || "The local sidecar server failed to start";
  }

  private rememberStartupFailure(signature: string, runtimeVariant: string | null, error: unknown): void {
    this.failedSignature = signature;
    this.failedRuntimeVariant = runtimeVariant;
    this.startupError = this.summarizeStartupError(error);
    sidecarModelService.setStatus("server_error");
  }

  private async startUnlocked(runtime: ManagedRuntimeInstall, modelRef: string): Promise<void> {
    writeFileSync(sidecarRuntimeService.getLogPath(), "", "utf-8");
    this.starting = true;
    try {
      if (this.isMlxRuntime(runtime)) {
        await this.startMlxUnlocked(runtime, modelRef);
        return;
      }

      await this.startLlamaUnlocked(runtime, modelRef);
    } finally {
      this.starting = false;
    }
  }

  private async startLlamaUnlocked(runtime: SidecarRuntimeInstall, modelPath: string): Promise<void> {
    if (!existsSync(modelPath)) {
      throw new Error("The selected sidecar model file is missing. Please download it again.");
    }
    assertSupportedLlamaCppModelPath(modelPath);

    let activeRuntime: SidecarRuntimeInstall | null = runtime;
    const attemptedVariants = new Set<string>();
    let lastError: Error | null = null;

    while (activeRuntime) {
      const runtimeSignature = this.buildRuntimeSignature("llama_cpp", activeRuntime, modelPath);
      attemptedVariants.add(activeRuntime.variant);

      try {
        await this.startLlamaForInstalledRuntimeUnlocked(activeRuntime, modelPath, runtimeSignature);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("The local sidecar server failed to start");

        const nextRuntime: ManagedRuntimeInstall | null = this.usesGpuRuntime(activeRuntime)
          ? await this.ensureRuntimeInstalled("llama_cpp", {
              excludeVariants: [...attemptedVariants],
            }).catch(() => null)
          : null;

        if (nextRuntime && !this.isMlxRuntime(nextRuntime) && !attemptedVariants.has(nextRuntime.variant)) {
          logger.warn(
            error,
            "[sidecar] Runtime %s failed to boot before ready. Retrying with %s.",
            activeRuntime.variant,
            nextRuntime.variant,
          );
          activeRuntime = nextRuntime;
          continue;
        }

        this.rememberStartupFailure(runtimeSignature, activeRuntime.variant, lastError);
        throw lastError;
      }
    }

    this.rememberStartupFailure(
      this.buildRuntimeSignature("llama_cpp", runtime, modelPath),
      runtime.variant,
      lastError ?? new Error("The local sidecar server failed to start"),
    );
    throw lastError ?? new Error("The local sidecar server failed to start");
  }

  private async startLlamaForInstalledRuntimeUnlocked(
    runtime: SidecarRuntimeInstall,
    modelPath: string,
    signature: string,
  ): Promise<void> {
    const startupPlans = this.buildLlamaStartupPlans(runtime);

    for (let attempt = 0; attempt < startupPlans.length; attempt += 1) {
      const plan = startupPlans[attempt]!;
      const port = await getFreePort();
      const args = this.buildLlamaArgs(modelPath, plan.gpuLayers, port, runtime);
      sidecarRuntimeService.setLaunchDiagnostics(`${runtime.serverPath} ${this.formatCommandArgs(args)}`, "llama_cpp");

      const logStream = createWriteStream(sidecarRuntimeService.getLogPath(), { flags: "a" });
      logStream.write(`[sidecar] startup attempt ${attempt + 1}/${startupPlans.length} (${plan.label})\n`);
      logStream.write(`[sidecar] runtime variant: ${runtime.variant}\n`);
      logStream.write(`[sidecar] command: ${runtime.serverPath} ${this.formatCommandArgs(args)}\n`);

      const child = spawn(runtime.serverPath, args, {
        cwd: dirname(runtime.serverPath),
        env: buildLlamaProcessEnv(runtime),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.bindChild(child, logStream, `http://127.0.0.1:${port}`, signature);

      try {
        await this.waitForReady(this.baseUrl!, child, "llama_cpp");
        this.markReady();
        return;
      } catch (error) {
        const decoratedError = this.decorateStartupError(error, runtime.serverPath, args);
        await this.stopUnlocked();

        const nextPlan = startupPlans[attempt + 1];
        if (nextPlan && this.shouldRetryStartup(error)) {
          logger.warn(error, "[sidecar] Startup with %s failed. Retrying with %s.", plan.label, nextPlan.label);
          continue;
        }

        throw decoratedError;
      }
    }

    throw new Error("The local sidecar server failed to start");
  }

  private async startMlxUnlocked(runtime: MlxRuntimeInstall, modelRepo: string): Promise<void> {
    const port = await getFreePort();
    const args = this.buildMlxArgs(modelRepo, port);
    const signature = this.buildRuntimeSignature("mlx", runtime, modelRepo);
    sidecarRuntimeService.setLaunchDiagnostics(`${runtime.pythonPath} ${this.formatCommandArgs(args)}`, "mlx");
    const logStream = createWriteStream(sidecarRuntimeService.getLogPath(), { flags: "a" });
    logStream.write(`[sidecar] startup attempt 1/1 (MLX native)\n`);
    logStream.write(`[sidecar] command: ${runtime.pythonPath} ${this.formatCommandArgs(args)}\n`);

    const child = spawn(runtime.pythonPath, args, {
      cwd: runtime.directoryPath,
      env: {
        ...process.env,
        HF_HOME: runtime.hfHomePath,
        HF_HUB_CACHE: join(runtime.hfHomePath, "hub"),
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.bindChild(child, logStream, `http://127.0.0.1:${port}`, signature);

    try {
      await this.waitForReady(this.baseUrl!, child, "mlx");
      this.markReady();
    } catch (error) {
      const decorated = this.decorateStartupError(error, runtime.pythonPath, args);
      await this.stopUnlocked();
      this.rememberStartupFailure(signature, runtime.variant, decorated);
      throw decorated;
    }
  }

  private bindChild(child: ChildProcess, logStream: WriteStream, baseUrl: string, signature: string): void {
    this.child = child;
    this.logStream = logStream;
    this.baseUrl = baseUrl;
    this.ready = false;
    this.currentSignature = signature;
    this.intentionalStop = false;

    child.stdout?.on("data", (chunk) => {
      logStream.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      logStream.write(chunk);
    });
    child.on("exit", (code, signal) => {
      void this.handleChildExit(code, signal);
    });
  }

  private markReady(): void {
    this.ready = true;
    this.unexpectedCrashCount = 0;
    this.lastReadyAt = Date.now();
    this.clearStartupFailure();
    sidecarModelService.setStatus("ready");
    sidecarModelService.clearLegacyRuntimeStamp();
  }

  private async waitForReady(baseUrl: string, child: ChildProcess, backend: SidecarBackend): Promise<void> {
    const timeoutAt = Date.now() + (backend === "mlx" ? 20 * 60_000 : 60_000);
    let lastError: unknown = null;

    while (Date.now() < timeoutAt) {
      const exitError = this.getChildExitError(child);
      if (exitError) {
        throw exitError;
      }

      try {
        const response = await fetch(backend === "mlx" ? `${baseUrl}/v1/models` : `${baseUrl}/health`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (response.ok) {
          return;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
        const latestExitError = this.getChildExitError(child);
        if (latestExitError) {
          throw latestExitError;
        }
      }

      await delay(backend === "mlx" ? 1_000 : 500);
    }

    const exitError = this.getChildExitError(child);
    if (exitError) {
      throw exitError;
    }

    throw lastError instanceof Error ? lastError : new Error("Timed out waiting for the local sidecar server");
  }

  private async stopUnlocked(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.ready = false;
      this.baseUrl = null;
      return;
    }

    this.intentionalStop = true;
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });

    try {
      child.kill("SIGTERM");
    } catch {
      // Best-effort shutdown.
    }

    const timeout = delay(5_000);
    await Promise.race([exited, timeout]);

    if (child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Best-effort forced shutdown.
      }
    }

    this.cleanupChildState();
  }

  private cleanupChildState(): void {
    this.child = null;
    this.ready = false;
    this.baseUrl = null;
    this.currentSignature = null;
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  private async handleChildExit(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    const wasIntentional = this.intentionalStop;
    this.intentionalStop = false;
    this.cleanupChildState();

    if (wasIntentional) {
      return;
    }

    logger.error(
      "[sidecar] Local sidecar server exited unexpectedly (code=%s, signal=%s)",
      code ?? "null",
      signal ?? "null",
    );

    if (this.starting) {
      return;
    }

    const crashedSoonAfterReady = this.lastReadyAt > 0 && Date.now() - this.lastReadyAt < 30_000;
    this.unexpectedCrashCount = crashedSoonAfterReady ? this.unexpectedCrashCount + 1 : 1;

    if (this.unexpectedCrashCount > 1) {
      this.startupError = "The local sidecar server crashed repeatedly after startup";
      sidecarModelService.setStatus("server_error");
      return;
    }

    try {
      await this.syncForCurrentConfig({ allowRuntimeInstall: false });
    } catch (error) {
      logger.error(error, "[sidecar] Auto-restart failed");
      sidecarModelService.setStatus("server_error");
    }
  }
}

export const sidecarProcessService = new SidecarProcessService();
