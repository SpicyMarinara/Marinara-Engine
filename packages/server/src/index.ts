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
