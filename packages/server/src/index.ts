// ──────────────────────────────────────────────
// Server Entry Point
// ──────────────────────────────────────────────
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { buildApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { getHost, getPort, getServerProtocol, loadTlsOptions, logStorageDiagnostics } from "./config/runtime-config.js";
import { logCsrfTrustSummary } from "./middleware/csrf-protection.js";
import { startEnvWatcher } from "./config/env-watcher.js";
import { migrateTaskbarShortcuts } from "./services/setup/taskbar-shortcut-migration.js";
import { cleanupOrphanedSessions, sessionsDirFor } from "./services/llm/providers/claude-subscription/synthetic-session.js";

function isAddressInUseError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err && err.code === "EADDRINUSE";
}

function scheduleTaskbarShortcutMigration() {
  const timeout = setTimeout(() => {
    const installDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    void migrateTaskbarShortcuts(installDir).catch((err) => {
      logger.warn({ err }, "taskbar shortcut migration skipped");
    });
  }, 1_000);
  timeout.unref?.();
}

/**
 * Sweep stale `claude_subscription` synthetic session files once at startup.
 * These are temp files written under `~/.claude/projects/<cwd-as-dashes>/`
 * before each Claude Agent SDK `query({ resume })` call. The provider's
 * `finally` block cleans them on the happy path; this sweep is the GC for
 * cases where the process crashed or was killed mid-request.
 *
 * Gated on non-win32 because the cwd-as-dashes path resolver
 * (`sessionsDirFor` in synthetic-session.ts) has not been validated against
 * Claude Code's Windows project-dir convention — `C:\…` paths can't be
 * transformed by the same `replaceAll("/", "-")` rule we use on *nix. Until
 * that's verified end-to-end, the resume code path (and therefore this
 * sweep) is *nix-only. Listed as a known limitation in PR #990's body. If
 * you're maintaining this and `sessionsDirFor` has been validated on win32,
 * drop the gate.
 */
const ORPHAN_SWEEP_MAX_AGE_MS = 15 * 60 * 1000;
function runClaudeSubscriptionOrphanSweep() {
  if (process.platform === "win32") return;
  const dir = sessionsDirFor(process.cwd());
  // `void` + the .then/.catch pair means this never blocks boot or rejects
  // unhandled. The 15-minute age threshold inside `cleanupOrphanedSessions`
  // protects any session file an in-flight request might have just written,
  // so no deferral is needed to avoid racing them.
  void cleanupOrphanedSessions(ORPHAN_SWEEP_MAX_AGE_MS, Date.now(), dir).then(
    (removed) => {
      if (removed > 0) {
        logger.info("[claude-subscription/jsonl] swept %d orphaned session file(s) from %s", removed, dir);
      }
    },
    (err) => logger.warn({ err, dir }, "[claude-subscription/jsonl] orphan sweep failed"),
  );
}

async function main() {
  const tls = loadTlsOptions();
  logStorageDiagnostics();
  const app = await buildApp(tls ?? undefined);
  const envWatcher = startEnvWatcher();
  const protocol = tls ? "https" : getServerProtocol();
  const port = getPort();
  const host = getHost();
  let isShuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (isShuttingDown) {
      logger.warn("Received %s while shutdown is already in progress", signal);
      process.exit(1);
    }

    isShuttingDown = true;
    logger.info("Received %s; shutting down Marinara Engine", signal);

    try {
      envWatcher.stop();
      await app.close();
      logger.info("Shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error(err, "Shutdown failed");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  try {
    await app.listen({ port, host });
    logger.info(`Marinara Engine server listening on ${protocol}://${host}:${port}`);
    logCsrfTrustSummary();
    scheduleTaskbarShortcutMigration();
    runClaudeSubscriptionOrphanSweep();
  } catch (err) {
    if (isShuttingDown) {
      logger.info("Startup interrupted by shutdown");
      return;
    }

    if (isAddressInUseError(err)) {
      logger.error(
        err,
        "Port %d is already in use. Marinara Engine could not start. Close the app using that port or set PORT to another value, for example PORT=7869 bash ./start.sh on macOS/Linux or set PORT=7869 && start.bat in Windows cmd.",
        port,
      );
    } else {
      logger.error(err);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(err, "[startup] Unhandled error during server bootstrap");
  process.exit(1);
});
