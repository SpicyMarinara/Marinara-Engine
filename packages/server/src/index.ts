// ──────────────────────────────────────────────
// Server Entry Point
// ──────────────────────────────────────────────
import { buildApp } from "./app.js";
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
  console.error(`[ERROR] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
