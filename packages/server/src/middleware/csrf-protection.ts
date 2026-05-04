import type { FastifyReply, FastifyRequest } from "fastify";
import { getCsrfTrustedOrigins, getHost, getPort, getServerProtocol } from "../config/runtime-config.js";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "../utils/security.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SAFE_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

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

function requestOrigin(request: FastifyRequest): string | null {
  const host = firstHeader(request.headers.host);
  if (!host) return null;
  const protocol = request.protocol ?? getServerProtocol();
  return normalizeOrigin(`${protocol}://${host}`);
}

function configuredOrigins(request: FastifyRequest): Set<string> {
  const origins = new Set<string>();
  const current = requestOrigin(request);
  if (current) origins.add(current);

  const port = getPort();
  origins.add(`http://127.0.0.1:${port}`);
  origins.add(`http://localhost:${port}`);
  origins.add(`${getServerProtocol()}://${getHost()}:${port}`);

  for (const trusted of getCsrfTrustedOrigins()) {
    const origin = normalizeOrigin(trusted);
    if (origin) origins.add(origin);
  }
  return origins;
}

function isAllowedOrigin(originValue: string, request: FastifyRequest): boolean {
  const origin = normalizeOrigin(originValue);
  if (!origin) return false;
  if (configuredOrigins(request).has(origin)) return true;

  try {
    const parsed = new URL(origin);
    if (isLoopbackHostname(parsed.hostname)) return true;
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

export function csrfProtectionHook(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return done();
  if (!request.url.startsWith("/api/")) return done();

  const secFetchSite = firstHeader(request.headers["sec-fetch-site"]);
  if (secFetchSite && !SAFE_FETCH_SITES.has(secFetchSite.toLowerCase())) {
    reply.status(403).send({ error: "Cross-site unsafe requests are not allowed" });
    return;
  }

  const origin = firstHeader(request.headers.origin);
  if (origin && !isAllowedOrigin(origin, request)) {
    reply.status(403).send({ error: "Request origin is not trusted" });
    return;
  }

  const referer = firstHeader(request.headers.referer);
  if (!origin && referer && !isAllowedOrigin(referer, request)) {
    reply.status(403).send({ error: "Request referer is not trusted" });
    return;
  }

  if ((origin || referer || secFetchSite) && !hasCsrfHeader(request)) {
    reply.status(403).send({ error: `Missing ${CSRF_HEADER} header` });
    return;
  }

  done();
}
