// ──────────────────────────────────────────────
// Server Entry Point
// ──────────────────────────────────────────────
import { buildApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { getHost, getPort, getServerProtocol, loadTlsOptions, logStorageDiagnostics } from "./config/runtime-config.js";

async function main() {
  const tls = loadTlsOptions();
  logStorageDiagnostics();
  const app = await buildApp(tls ?? undefined);
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
  } catch (err) {
    if (isShuttingDown) {
      logger.info("Startup interrupted by shutdown");
      return;
    }

    logger.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(err, "[startup] Unhandled error during server bootstrap");
  process.exit(1);
});
