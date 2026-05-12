import type { FastifyReply, FastifyRequest } from "fastify";
import { getCsrfTrustedOrigins, getHost, getPort, getServerProtocol } from "../config/runtime-config.js";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "../utils/security.js";
import { logger } from "../lib/logger.js";
import { isPrivateNetworkIp, isLoopbackIp } from "./ip-allowlist.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SAFE_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

// Throttle "origin not trusted" log lines so a misbehaving client can't flood
// the log. Each unique origin is announced once. The cache is bounded so an
// attacker streaming unique origins can't grow process memory without bound;
// when the cap is reached we drop the oldest entry (Set preserves insertion
// order), which means a fresh origin from a long-lived attacker may eventually
// re-log once — acceptable trade-off for log volume vs. memory.
const MAX_ANNOUNCED_REJECTED_ORIGINS = 2048;
const announcedRejectedOrigins = new Set<string>();
function announceRejectedOrigin(kind: "Origin" | "Referer", value: string, hint: string) {
  const key = `${kind}:${value}`;
  if (announcedRejectedOrigins.has(key)) return;
  if (announcedRejectedOrigins.size >= MAX_ANNOUNCED_REJECTED_ORIGINS) {
    const oldest = announcedRejectedOrigins.values().next().value;
    if (oldest !== undefined) announcedRejectedOrigins.delete(oldest);
  }
  announcedRejectedOrigins.add(key);
  logger.warn(`[csrf] Rejected request: ${kind} '${value}' is not in the trusted list. ${hint}`);
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || null;
}

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isTrustedLiteralHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return isLoopbackHostname(normalized) || isPrivateNetworkIp(normalized);
}

function getRequestProtocol(request: FastifyRequest): string {
  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"]);
  if (forwardedProto === "https") return "https";
  if (forwardedProto === "http") return "http";
  return getServerProtocol();
}

function getRequestHostOrigin(request: FastifyRequest): string | null {
  const host = firstHeader(request.headers.host);
  if (!host) return null;

  const protocol = getRequestProtocol(request);
  try {
    const parsed = new URL(`${protocol}://${host}`);
    if (!isTrustedLiteralHostname(parsed.hostname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function originUsesServerPort(origin: URL): boolean {
  const port = origin.port ? Number.parseInt(origin.port, 10) : origin.protocol === "https:" ? 443 : 80;
  return port === getPort();
}

function hasWildcardTrustedOrigin(): boolean {
  return getCsrfTrustedOrigins().some((trusted) => trusted === "*");
}

function configuredOrigins(): Set<string> {
  const origins = new Set<string>();

  const port = getPort();
  origins.add(`http://127.0.0.1:${port}`);
  origins.add(`http://localhost:${port}`);

  const configuredHost = getHost();
  if (configuredHost !== "0.0.0.0" && configuredHost !== "::") {
    origins.add(`${getServerProtocol()}://${configuredHost}:${port}`);
  }

  for (const trusted of getCsrfTrustedOrigins()) {
    const origin = normalizeOrigin(trusted);
    if (origin) origins.add(origin);
  }
  return origins;
}

function isAllowedOrigin(originValue: string, request: FastifyRequest): boolean {
  const origin = normalizeOrigin(originValue);
  if (!origin) return false;
  if (hasWildcardTrustedOrigin()) return true;
  if (configuredOrigins().has(origin)) return true;
  if (origin === getRequestHostOrigin(request)) return true;

  try {
    const parsed = new URL(origin);
    if (isLoopbackHostname(parsed.hostname) && isLoopbackIp(request.ip)) return true;
    if (originUsesServerPort(parsed) && isTrustedLiteralHostname(parsed.hostname)) return true;
  } catch {
    return false;
  }

  return false;
}

function hasCsrfHeader(request: FastifyRequest): boolean {
  const value = request.headers[CSRF_HEADER];
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === CSRF_HEADER_VALUE;
}

function getRequestOrigin(request: FastifyRequest): string | null {
  const host = firstHeader(request.headers.host);
  if (!host) return null;

  try {
    return new URL(`${getRequestProtocol(request)}://${host}`).origin;
  } catch {
    return null;
  }
}

function canUseSameOriginCompatibility(
  request: FastifyRequest,
  origin: string | null,
  referer: string | null,
  originTrusted: boolean,
  secFetchSite: string | null,
): boolean {
  if (!originTrusted || hasWildcardTrustedOrigin()) return false;
  if (secFetchSite && secFetchSite.toLowerCase() !== "same-origin") return false;

  const sourceOrigin = origin ? normalizeOrigin(origin) : referer ? normalizeOrigin(referer) : null;
  return !!sourceOrigin && sourceOrigin === getRequestOrigin(request);
}

function appendOriginHint(origin: string): string {
  // Non-destructive instruction: tell the operator to APPEND the offending
  // origin to CSRF_TRUSTED_ORIGINS rather than replace the variable, so a
  // user who already trusts other origins doesn't accidentally clobber them.
  const normalized = normalizeOrigin(origin) ?? origin;
  return (
    `Add '${normalized}' to CSRF_TRUSTED_ORIGINS in your .env — comma-separated if you already have entries, ` +
    `e.g. CSRF_TRUSTED_ORIGINS=http://existing.example,${normalized}. No restart needed (takes effect within ~2s).`
  );
}

/**
 * Summary of which origins the CSRF hook will accept without an entry in
 * CSRF_TRUSTED_ORIGINS. Used for the startup diagnostic so operators can see
 * the auto-trust scope at a glance and not paste duplicate entries into .env.
 */
export interface CsrfTrustSummary {
  loopback: string[];
  host: string | null;
  configured: string[];
  wildcard: boolean;
  privateLiteralPattern: string;
}

export function getCsrfTrustSummary(): CsrfTrustSummary {
  const port = getPort();
  const loopback = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const configuredHost = getHost();
  const host =
    configuredHost !== "0.0.0.0" && configuredHost !== "::"
      ? `${getServerProtocol()}://${configuredHost}:${port}`
      : null;
  const configured = getCsrfTrustedOrigins().filter((entry) => entry !== "*");
  const wildcard = hasWildcardTrustedOrigin();
  // Auto-trust also covers any RFC 1918 / CGNAT (Tailscale) / Docker bridge /
  // link-local IP literal where the browser's Origin matches the Host header,
  // on any port. Operators don't need to enumerate those in CSRF_TRUSTED_ORIGINS.
  const privateLiteralPattern =
    "any RFC 1918 / CGNAT (Tailscale) / Docker / link-local IP literal where Origin matches Host";
  return { loopback, host, configured, wildcard, privateLiteralPattern };
}

export interface OriginTrustVerdict {
  trusted: boolean;
  /** Resolved origin string the verdict applies to (Origin or fallback Referer). null if neither was present. */
  origin: string | null;
  /** Where the origin came from. "host" means no Origin/Referer was sent and we derived from the Host header. */
  source: "origin" | "referer" | "host" | "none";
  /** Stable reject-code (matches the 403 body codes) when not trusted. null when trusted. */
  code: "CSRF_ORIGIN_NOT_TRUSTED" | "CSRF_REFERER_NOT_TRUSTED" | "CSRF_NO_ORIGIN" | null;
  /** Operator-facing hint with the exact .env line to add. null when trusted. */
  hint: string | null;
}

/**
 * Pure (no logging, no side effects) version of the CSRF hook's origin check.
 * Used by the /api/csrf/origin-status diagnostic so the client can show a
 * "your origin is not trusted" warning on page load BEFORE the user tries to
 * save anything. The hook itself stays the gatekeeper; this is read-only.
 */
export function evaluateRequestOriginTrust(request: FastifyRequest): OriginTrustVerdict {
  const origin = firstHeader(request.headers.origin);
  const referer = firstHeader(request.headers.referer);

  if (origin) {
    const trusted = isAllowedOrigin(origin, request);
    return {
      trusted,
      origin,
      source: "origin",
      code: trusted ? null : "CSRF_ORIGIN_NOT_TRUSTED",
      hint: trusted ? null : appendOriginHint(origin),
    };
  }

  if (referer) {
    const trusted = isAllowedOrigin(referer, request);
    const normalized = normalizeOrigin(referer) ?? referer;
    return {
      trusted,
      origin: normalized,
      source: "referer",
      code: trusted ? null : "CSRF_REFERER_NOT_TRUSTED",
      hint: trusted ? null : appendOriginHint(referer),
    };
  }

  // Neither Origin nor Referer was sent. Browsers will always send at least
  // one of these for same-origin XHR/fetch, so a request landing here is
  // either a non-browser client or a stripped request. Treat it as "no
  // signal" rather than untrusted — the unsafe-method hook still gates
  // mutations on its own.
  const hostOrigin = getRequestHostOrigin(request);
  return {
    trusted: true,
    origin: hostOrigin,
    source: hostOrigin ? "host" : "none",
    code: null,
    hint: null,
  };
}

export function logCsrfTrustSummary(log: { info(message: string): void; warn(message: string): void } = logger) {
  const summary = getCsrfTrustSummary();
  log.info(`[csrf] Auto-trusted (loopback): ${summary.loopback.join(", ")}`);
  if (summary.host) log.info(`[csrf] Auto-trusted (HOST): ${summary.host}`);
  log.info(`[csrf] Auto-trusted (pattern): ${summary.privateLiteralPattern}`);
  if (summary.configured.length > 0) {
    log.info(`[csrf] CSRF_TRUSTED_ORIGINS: ${summary.configured.join(", ")}`);
  }
  if (summary.wildcard) {
    log.warn("[csrf] CSRF_TRUSTED_ORIGINS contains '*' — every browser origin can reach unsafe API routes");
  }
}

export function csrfProtectionHook(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return done();
  if (!request.url.startsWith("/api/")) return done();

  const origin = firstHeader(request.headers.origin);
  const referer = firstHeader(request.headers.referer);
  let originTrusted = false;
  if (origin) {
    originTrusted = isAllowedOrigin(origin, request);
  } else if (referer) {
    originTrusted = isAllowedOrigin(referer, request);
  }
  const secFetchSite = firstHeader(request.headers["sec-fetch-site"]);
  if (secFetchSite && !SAFE_FETCH_SITES.has(secFetchSite.toLowerCase()) && !originTrusted) {
    const offender = origin ?? referer ?? "(unknown)";
    if (origin || referer) announceRejectedOrigin(origin ? "Origin" : "Referer", offender, appendOriginHint(offender));
    reply.status(403).send({
      code: "CSRF_CROSS_SITE",
      error: "Cross-site unsafe requests are not allowed",
      origin: offender,
      hint:
        origin || referer
          ? appendOriginHint(offender)
          : "Browser did not send an Origin or Referer header — Marinara cannot verify this is a same-origin request.",
    });
    return;
  }

  if (origin && !originTrusted) {
    announceRejectedOrigin("Origin", origin, appendOriginHint(origin));
    reply.status(403).send({
      code: "CSRF_ORIGIN_NOT_TRUSTED",
      error: `Origin '${origin}' is not in the trusted list (CSRF_TRUSTED_ORIGINS).`,
      origin,
      hint: appendOriginHint(origin),
    });
    return;
  }

  if (!origin && referer && !originTrusted) {
    announceRejectedOrigin("Referer", referer, appendOriginHint(referer));
    // Use the same `origin` key as the sibling branches even though this
    // rejection was driven by the Referer header. Stable schema for clients
    // parsing 403 bodies; the error string still names "Referer" so the
    // operator knows which header carried the offending value.
    reply.status(403).send({
      code: "CSRF_REFERER_NOT_TRUSTED",
      error: `Referer '${referer}' is not in the trusted list (CSRF_TRUSTED_ORIGINS).`,
      origin: referer,
      hint: appendOriginHint(referer),
    });
    return;
  }

  if ((origin || referer || secFetchSite) && !hasCsrfHeader(request)) {
    if (canUseSameOriginCompatibility(request, origin, referer, originTrusted, secFetchSite)) return done();
    reply.status(403).send({
      code: "CSRF_MISSING_HEADER",
      error: `Missing ${CSRF_HEADER} header`,
      hint: `Marinara's frontend sends this header automatically. If you're calling the API from a script, set ${CSRF_HEADER}: ${CSRF_HEADER_VALUE}.`,
    });
    return;
  }

  done();
}
