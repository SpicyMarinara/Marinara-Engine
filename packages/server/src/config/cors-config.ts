// ──────────────────────────────────────────────
// CORS configuration with hot-reload + same-origin auto-allow
// ──────────────────────────────────────────────
// We use @fastify/cors's delegator mode so the trusted origin set is
// re-evaluated for every request. This buys us two things:
//
//  1. Adding / removing entries in CORS_ORIGINS takes effect within ~2s of
//     saving .env (the env-watcher's polling interval), no restart required.
//
//  2. Same-origin requests are auto-allowed regardless of CORS_ORIGINS.
//     If the browser's Origin header matches the URL the request actually
//     reached (the Host header), it's by definition same-origin and CORS
//     restrictions don't apply. This means a user who visits Marinara at
//     http://localhost:7860 OR http://100.x.y.z:7860 (Tailscale) doesn't
//     have to add either URL to CORS_ORIGINS — same-origin "just works."
//     They only need CORS_ORIGINS for genuine cross-origin frontends (a
//     dev Vite server on a different port, a separate hostname behind a
//     reverse proxy that rewrites Host, etc.).

import type { FastifyRequest } from "fastify";
import { getCorsConfig, getServerProtocol } from "./runtime-config.js";
import { logger } from "../lib/logger.js";

const announcedRejectedOrigins = new Set<string>();

function announceRejectedOrigin(origin: string) {
  if (announcedRejectedOrigins.has(origin)) return;
  announcedRejectedOrigins.add(origin);
  logger.warn(
    `[cors] Rejected cross-origin request from '${origin}' (not in CORS_ORIGINS, not same-origin). ` +
      `To allow it, add '${origin}' to CORS_ORIGINS in your .env — comma-separated if you already have entries, ` +
      `e.g. CORS_ORIGINS=http://existing.example,${origin}. No restart needed (takes effect within ~2s).`,
  );
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || null;
}

function selfOriginFromRequest(req: FastifyRequest): string | null {
  const host = firstHeader(req.headers.host);
  if (!host) return null;
  // Honour the proxy-forwarded protocol when present, otherwise fall back
  // to the protocol Marinara is actually serving on.
  const forwardedProto = firstHeader(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : getServerProtocol();
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function originIsAllowed(origin: string): boolean {
  const config = getCorsConfig();
  const candidate = config.origin;
  if (candidate === "*") return true;
  if (typeof candidate === "string") return candidate === origin;
  if (Array.isArray(candidate)) return candidate.includes(origin);
  return false;
}

export type CorsDelegateCallback = (
  err: Error | null,
  options?: { origin: boolean | string; credentials?: boolean },
) => void;

/**
 * Per-request CORS resolver. Order:
 *   1. No Origin header → not a CORS request, no restrictions apply.
 *   2. Origin matches the request's own host (same-origin) → always allowed.
 *   3. Origin matches CORS_ORIGINS or "*" → allowed.
 *   4. Otherwise → rejected, log a one-shot diagnostic for the operator.
 */
export function corsDelegate(req: FastifyRequest, callback: CorsDelegateCallback) {
  const origin = firstHeader(req.headers.origin);
  if (!origin) {
    return callback(null, { origin: true });
  }

  const selfOrigin = selfOriginFromRequest(req);
  if (selfOrigin && origin === selfOrigin) {
    return callback(null, { origin: true, credentials: getCorsConfig().credentials });
  }

  if (originIsAllowed(origin)) {
    const config = getCorsConfig();
    if (config.origin === "*") {
      return callback(null, { origin: true, credentials: false });
    }
    return callback(null, { origin: true, credentials: config.credentials });
  }

  announceRejectedOrigin(origin);
  callback(null, { origin: false });
}
