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

const LOCKDOWN_JSON_MESSAGE =
  "Non-loopback access requires authentication because no Basic Auth credentials are configured. " +
  "Set BASIC_AUTH_USER and BASIC_AUTH_PASS, add this IP to IP_ALLOWLIST, " +
  "or explicitly opt in with ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK=true for LAN/private clients. " +
  "Set ALLOW_UNAUTHENTICATED_REMOTE=true only if unauthenticated public access is intentional.";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wantsHtml(request: FastifyRequest): boolean {
  if (request.url.startsWith("/api/")) return false;
  const accept = request.headers.accept;
  const value = Array.isArray(accept) ? accept[0] : accept;
  return typeof value === "string" && value.toLowerCase().includes("text/html");
}

function renderLockdownPage(clientIp: string): string {
  const safeIp = escapeHtml(clientIp);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Marinara Engine — Set up access</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0e1320;
    --panel: #161c2c;
    --panel-2: #1d2438;
    --border: #2a3350;
    --text: #e8ecf6;
    --muted: #9aa3bd;
    --accent: #f4a35d;
    --accent-soft: rgba(244, 163, 93, 0.12);
    --code-bg: #0a0f1c;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: radial-gradient(1200px 800px at 80% -10%, #1a223a 0%, var(--bg) 60%) fixed;
    color: var(--text);
    font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 32px 16px 64px;
  }
  main {
    width: 100%;
    max-width: 720px;
  }
  header { margin-bottom: 24px; }
  .badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  h1 {
    font-size: 26px;
    line-height: 1.25;
    margin: 12px 0 8px;
    font-weight: 600;
  }
  p.lede { color: var(--muted); margin: 0; }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 22px;
    margin-top: 16px;
  }
  .panel h2 {
    font-size: 17px;
    margin: 0 0 6px;
    font-weight: 600;
  }
  .panel .hint { color: var(--muted); font-size: 14px; margin: 0 0 12px; }
  ol { margin: 0; padding-left: 20px; }
  ol li { margin: 6px 0; }
  code, pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
  }
  code {
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1px 6px;
  }
  pre {
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    overflow-x: auto;
    margin: 8px 0 0;
  }
  .ip-pill {
    display: inline-block;
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: 6px;
    padding: 1px 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
  }
  footer {
    margin-top: 20px;
    padding: 16px 22px;
    background: var(--panel-2);
    border: 1px dashed var(--border);
    border-radius: 12px;
    color: var(--muted);
    font-size: 13px;
  }
  footer strong { color: var(--text); }
  a { color: var(--accent); text-decoration: none; border-bottom: 1px dotted rgba(244,163,93,0.4); }
  a:hover { border-bottom-color: var(--accent); }
  .links {
    margin-top: 18px;
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-size: 14px;
  }
</style>
</head>
<body>
  <main>
    <header>
      <span class="badge">Access blocked</span>
      <h1>This Marinara Engine install needs access control before remote devices can connect.</h1>
      <p class="lede">You're connecting from <span class="ip-pill">${safeIp}</span>, which isn't loopback. To protect your data, the server refuses non-local traffic until you choose how this device should authenticate. Pick one of the options below, restart Marinara, then refresh this page.</p>
    </header>

    <section class="panel">
      <h2>Option 1 — Basic Auth (recommended)</h2>
      <p class="hint">Best for shared networks, Tailscale, or any device you don't fully control. The browser will prompt for the username and password once, then remember it.</p>
      <ol>
        <li>Open your <code>.env</code> file in the Marinara Engine folder.</li>
        <li>Add (or edit) these two lines, picking your own values:
          <pre>BASIC_AUTH_USER=yourname
BASIC_AUTH_PASS=a-long-random-password</pre>
        </li>
        <li>Restart Marinara Engine. Refresh this page and enter the credentials.</li>
      </ol>
    </section>

    <section class="panel">
      <h2>Option 2 — IP allowlist</h2>
      <p class="hint">Best when you only need a few known devices to connect — e.g. your phone on a home network, or specific Tailscale peers.</p>
      <ol>
        <li>Open your <code>.env</code> file in the Marinara Engine folder.</li>
        <li>Add this line. Your current IP is already filled in — add more entries (comma-separated, CIDR allowed) for other devices:
          <pre>IP_ALLOWLIST=${safeIp}</pre>
        </li>
        <li>Restart Marinara Engine and refresh this page.</li>
      </ol>
    </section>

    <footer>
      <strong>On a fully trusted private network?</strong> You can restore the legacy passwordless LAN behavior with <code>ALLOW_UNAUTHENTICATED_PRIVATE_NETWORK=true</code> in your <code>.env</code>. Only do this when you trust every device that can reach this server — anyone on the network will have full access without a password.
      <div class="links">
        <a href="https://github.com/Pasta-Devs/Marinara-Engine/blob/main/docs/FAQ.md#how-do-i-access-marinara-engine-from-my-phone-or-another-device" target="_blank" rel="noopener noreferrer">FAQ: Access from another device</a>
        <a href="https://github.com/Pasta-Devs/Marinara-Engine/blob/main/docs/TROUBLESHOOTING.md#app-not-loading-on-mobile--another-device" target="_blank" rel="noopener noreferrer">Troubleshooting</a>
        <a href="https://github.com/Pasta-Devs/Marinara-Engine/blob/main/docs/CONFIGURATION.md" target="_blank" rel="noopener noreferrer">Full configuration reference</a>
      </div>
    </footer>
  </main>
</body>
</html>`;
}

function sendLockdown(request: FastifyRequest, reply: FastifyReply) {
  if (wantsHtml(request)) {
    reply.status(403).header("Content-Type", "text/html; charset=utf-8").send(renderLockdownPage(request.ip));
    return;
  }
  reply.status(403).send({ error: "Forbidden", message: LOCKDOWN_JSON_MESSAGE });
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
    sendLockdown(request, reply);
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
