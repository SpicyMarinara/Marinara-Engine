// ──────────────────────────────────────────────
// Middleware: HTTP Basic Auth + safe-by-default remote lockdown
// ──────────────────────────────────────────────
// Set BASIC_AUTH_USER and BASIC_AUTH_PASS to enable HTTP Basic Authentication
// on every request from non-loopback, non-allowlisted IPs.
//
// When credentials are NOT configured, this middleware refuses connections
// from every non-loopback IP (returns 401/403) unless the operator explicitly
// opts into unauthenticated private/public access. This protects LAN, Docker,
// Tailscale, and internet-exposed installs by default.
//
// Note: the private-network exemption applies ONLY when no Basic Auth is
// configured. If you set BASIC_AUTH_USER/PASS, the password is required
// from every IP except loopback and explicit IP_ALLOWLIST matches —
// because if you went out of your way to set a password, you mean it.
//
// To opt back into the legacy "LAN/private networks can connect without auth"
// behaviour, set ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK=true. To allow
// unauthenticated public IPs too, set ALLOW_UNAUTHENTICATED_REMOTE=true.
//
// Optional:
//   BASIC_AUTH_REALM            — string shown in the browser password prompt
//                                 (default: "Marinara Engine")
//   ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK — set to "true" to allow LAN/Docker/
//                                           Tailscale clients without auth
//                                           (NOT recommended on shared networks)
//   ALLOW_UNAUTHENTICATED_REMOTE          — set to "true" to allow public IPs
//                                           without auth (NOT recommended)
//
// Notes:
//   • The `/api/health` endpoint is exempt so external uptime checks /
//     load balancers can probe the server without needing credentials.
//   • Loopback (127.0.0.1, ::1) is exempt — if you're already on the box,
//     you don't need a password.
//   • Any IP that matches IP_ALLOWLIST is also exempt — if you've already
//     vouched for a network, requiring a second factor would be noise.
//   • Use a strong, random password — Basic Auth sends credentials on
//     every request, only base64-encoded. Always pair with HTTPS in
//     production (see SSL_CERT / SSL_KEY).

import type { FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";
import {
  getBasicAuthConfig,
  isUnauthenticatedPrivateNetworkAllowed,
  isUnauthenticatedRemoteAllowed,
} from "../config/runtime-config.js";
import { logger } from "../lib/logger.js";
import { isInIpAllowlist, isLoopbackIp, isPrivateNetworkIp } from "./ip-allowlist.js";

interface CachedConfig {
  user: string;
  pass: string;
  realm: string;
  expectedHeader: Buffer;
  announced: boolean;
}

let cached: { raw: { user: string | null; pass: string | null; realm: string }; resolved: CachedConfig | null } | null =
  null;

function buildExpectedHeader(user: string, pass: string): Buffer {
  return Buffer.from(`Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`, "utf8");
}

function loadConfig(): CachedConfig | null {
  const raw = getBasicAuthConfig();
  if (!cached || cached.raw.user !== raw.user || cached.raw.pass !== raw.pass || cached.raw.realm !== raw.realm) {
    if (raw.user && raw.pass) {
      cached = {
        raw,
        resolved: {
          user: raw.user,
          pass: raw.pass,
          realm: raw.realm,
          expectedHeader: buildExpectedHeader(raw.user, raw.pass),
          announced: false,
        },
      };
    } else {
      cached = { raw, resolved: null };
    }
  }

  if (cached.resolved && !cached.resolved.announced) {
    logger.info(
      `[basic-auth] HTTP Basic Auth enabled (realm="${cached.resolved.realm}", user="${cached.resolved.user}")`,
    );
    cached.resolved.announced = true;
  }

  return cached.resolved;
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sendChallenge(reply: FastifyReply, realm: string) {
  // Quote the realm and escape any embedded quotes / backslashes so the
  // header stays well-formed even if the user picks an exotic realm string.
  const safeRealm = realm.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  reply.header("WWW-Authenticate", `Basic realm="${safeRealm}", charset="UTF-8"`);
  reply.status(401).send({ error: "Authentication required" });
}

let lockdownAnnounced = false;

function sendLockdown(reply: FastifyReply) {
  reply.status(403).send({
    error: "Forbidden",
    message:
      "Non-loopback access requires authentication because no Basic Auth credentials are configured. " +
      "Set BASIC_AUTH_USER and BASIC_AUTH_PASS, add this IP to IP_ALLOWLIST, " +
      "or explicitly opt in with ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK=true for LAN/private clients. " +
      "Set ALLOW_UNAUTHENTICATED_REMOTE=true only if unauthenticated public access is intentional.",
  });
}

export function hasBasicAuthConfigured(): boolean {
  return loadConfig() !== null;
}

export function isBasicAuthSatisfied(request: FastifyRequest): boolean {
  if (request.url === "/api/health" || request.url.startsWith("/api/health?")) return true;

  const ip = request.ip;
  if (isLoopbackIp(ip) || isInIpAllowlist(ip)) return true;

  const config = loadConfig();
  if (!config) {
    if (isPrivateNetworkIp(ip) && isUnauthenticatedPrivateNetworkAllowed()) return true;
    return isUnauthenticatedRemoteAllowed();
  }

  const header = request.headers.authorization;
  if (!header || typeof header !== "string") return false;
  return safeEqual(Buffer.from(header, "utf8"), config.expectedHeader);
}

// ── Fastify onRequest hook ──

export function basicAuthHook(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  // Exempt the health endpoint so external probes still work
  if (request.url === "/api/health" || request.url.startsWith("/api/health?")) {
    return done();
  }

  // Exempt loopback and any IP already vouched for by IP_ALLOWLIST
  const ip = request.ip;
  const trusted = isLoopbackIp(ip) || isInIpAllowlist(ip);
  if (trusted) return done();

  const config = loadConfig();

  // No credentials configured → fail closed for every non-loopback IP unless
  // the operator has explicitly opted back into private/public unauthenticated access.
  if (!config) {
    if (isPrivateNetworkIp(ip) && isUnauthenticatedPrivateNetworkAllowed()) return done();
    if (isUnauthenticatedRemoteAllowed()) return done();
    if (!lockdownAnnounced) {
      logger.warn(
        `[basic-auth] Refused non-loopback connection from ${ip}. No auth configured; set BASIC_AUTH_USER/BASIC_AUTH_PASS, add the IP to IP_ALLOWLIST, or explicitly opt in with ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK/ALLOW_UNAUTHENTICATED_REMOTE.`,
      );
      lockdownAnnounced = true;
    }
    sendLockdown(reply);
    return;
  }

  const header = request.headers.authorization;
  if (!header || typeof header !== "string") {
    sendChallenge(reply, config.realm);
    return;
  }

  const provided = Buffer.from(header, "utf8");
  if (!safeEqual(provided, config.expectedHeader)) {
    sendChallenge(reply, config.realm);
    return;
  }

  return done();
}
