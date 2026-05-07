import type { FastifyReply, FastifyRequest } from "fastify";
import { getCsrfTrustedOrigins, getHost, getPort, getServerProtocol } from "../config/runtime-config.js";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "../utils/security.js";
import { logger } from "../lib/logger.js";
import { isPrivateNetworkIp, isLoopbackIp } from "./ip-allowlist.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SAFE_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

// Throttle "origin not trusted" log lines so a misbehaving client can't flood
// the log. Each unique origin is announced once per process.
const announcedRejectedOrigins = new Set<string>();
function announceRejectedOrigin(kind: "Origin" | "Referer", value: string, hint: string) {
  const key = `${kind}:${value}`;
  if (announcedRejectedOrigins.has(key)) return;
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
      error: "Cross-site unsafe requests are not allowed",
      origin: offender,
      hint: origin || referer
        ? appendOriginHint(offender)
        : "Browser did not send an Origin or Referer header — Marinara cannot verify this is a same-origin request.",
    });
    return;
  }

  if (origin && !originTrusted) {
    announceRejectedOrigin("Origin", origin, appendOriginHint(origin));
    reply.status(403).send({
      error: `Origin '${origin}' is not in the trusted list (CSRF_TRUSTED_ORIGINS).`,
      origin,
      hint: appendOriginHint(origin),
    });
    return;
  }

  if (!origin && referer && !originTrusted) {
    announceRejectedOrigin("Referer", referer, appendOriginHint(referer));
    reply.status(403).send({
      error: `Referer '${referer}' is not in the trusted list (CSRF_TRUSTED_ORIGINS).`,
      referer,
      hint: appendOriginHint(referer),
    });
    return;
  }

  if ((origin || referer || secFetchSite) && !hasCsrfHeader(request)) {
    if (canUseSameOriginCompatibility(request, origin, referer, originTrusted, secFetchSite)) return done();
    reply.status(403).send({
      error: `Missing ${CSRF_HEADER} header`,
      hint: `Marinara's frontend sends this header automatically. If you're calling the API from a script, set ${CSRF_HEADER}: ${CSRF_HEADER_VALUE}.`,
    });
    return;
  }

  done();
}
