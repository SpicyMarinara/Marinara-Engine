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

  try {
    await app.listen({ port, host });
    app.log.info(`Marinara Engine server listening on ${protocol}://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error(err, "[startup] Unhandled error during server bootstrap");
  process.exit(1);
});
