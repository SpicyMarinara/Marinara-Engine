// ──────────────────────────────────────────────
// Middleware: HTTP Basic Auth + safe-by-default remote lockdown
// ──────────────────────────────────────────────
// Set BASIC_AUTH_USER and BASIC_AUTH_PASS to enable HTTP Basic Authentication
// on every request from non-loopback, non-allowlisted IPs.
//
// When credentials are NOT configured, this middleware refuses remote
// connections by default (returns 403). This protects users who accidentally
// expose the port to the public internet without setting up a password.
// To opt back into the legacy "anyone can connect" behaviour, set
// ALLOW_UNAUTHENTICATED_REMOTE=true.
//
// Optional:
//   BASIC_AUTH_REALM            — string shown in the browser password prompt
//                                 (default: "Marinara Engine")
//   ALLOW_UNAUTHENTICATED_REMOTE — set to "true" to disable the default lockdown
//                                  (NOT recommended on internet-facing servers)
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
import { getBasicAuthConfig, isUnauthenticatedRemoteAllowed } from "../config/runtime-config.js";
import { logger } from "../lib/logger.js";
import { isInIpAllowlist, isLoopbackIp } from "./ip-allowlist.js";

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
    logger.info(`[basic-auth] HTTP Basic Auth enabled (realm="${cached.resolved.realm}", user="${cached.resolved.user}")`);
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
      "Remote access is disabled because no authentication is configured. " +
      "Set BASIC_AUTH_USER and BASIC_AUTH_PASS, add this IP to IP_ALLOWLIST, " +
      "or set ALLOW_UNAUTHENTICATED_REMOTE=true to allow unauthenticated remote connections.",
  });
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

  // No credentials configured → safe-by-default lockdown for remote IPs.
  // Opt out via ALLOW_UNAUTHENTICATED_REMOTE=true for legacy open-access behaviour.
  if (!config) {
    if (isUnauthenticatedRemoteAllowed()) return done();
    if (!lockdownAnnounced) {
      logger.warn(
        `[basic-auth] Refused remote connection from ${ip}. No auth configured; set BASIC_AUTH_USER/BASIC_AUTH_PASS, IP_ALLOWLIST, or ALLOW_UNAUTHENTICATED_REMOTE=true.`,
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
