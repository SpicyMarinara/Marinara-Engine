// ──────────────────────────────────────────────
// CORS configuration with hot-reload support
// ──────────────────────────────────────────────
// @fastify/cors registers once at boot, but its `origin` option accepts a
// function that is invoked per request. We use that to re-read CORS_ORIGINS
// on every request so the operator can edit .env and have the new value take
// effect within the env-watcher's polling interval (~2s) without a restart.
//
// Caveat: `credentials` is still a static option on the cors plugin. If the
// operator switches between an explicit-origin list (credentials=true) and a
// wildcard "*" (credentials=false), that specific transition still requires
// a restart. Adding/removing origins within either mode is hot-reloadable.

import { getCorsConfig } from "./runtime-config.js";
import { logger } from "../lib/logger.js";

const announcedRejectedOrigins = new Set<string>();

function announceRejectedOrigin(origin: string) {
  if (announcedRejectedOrigins.has(origin)) return;
  announcedRejectedOrigins.add(origin);
  logger.warn(
    `[cors] Rejected preflight from origin '${origin}' (not in CORS_ORIGINS). ` +
      `To allow this origin, add the following line to your .env (no restart needed): ` +
      `CORS_ORIGINS=${origin}`,
  );
}

function originIsAllowed(origin: string): boolean {
  const config = getCorsConfig();
  const candidate = config.origin;
  if (candidate === "*") return true;
  if (typeof candidate === "string") return candidate === origin;
  if (Array.isArray(candidate)) return candidate.includes(origin);
  return false;
}

export type CorsCallback = (err: Error | null, allowed: boolean) => void;

/**
 * Per-request origin check passed to @fastify/cors. Returns true when the
 * incoming Origin matches the *current* CORS_ORIGINS configuration.
 */
export function checkCorsOrigin(origin: string | undefined, callback: CorsCallback) {
  // Requests without an Origin header (curl, server-to-server, same-origin
  // navigations) are not subject to CORS — let them through.
  if (!origin) return callback(null, true);

  if (originIsAllowed(origin)) return callback(null, true);

  announceRejectedOrigin(origin);
  callback(null, false);
}

/**
 * Resolve the static @fastify/cors options. `origin` is a function so the
 * trusted set is re-read per request; `credentials` is bound at boot from
 * whatever mode (explicit list vs wildcard) was active when the server
 * started. See module docstring for the credentials-mode caveat.
 */
export function buildCorsPluginOptions() {
  const initial = getCorsConfig();
  return {
    origin: checkCorsOrigin,
    credentials: initial.credentials,
  };
}
