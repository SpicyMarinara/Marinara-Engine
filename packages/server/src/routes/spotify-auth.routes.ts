// ──────────────────────────────────────────────
// Routes: Spotify OAuth (PKCE)
// ──────────────────────────────────────────────
import type { FastifyInstance, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import { createAgentsStorage } from "../services/storage/agents.storage.js";
import { buildSpotifyRedirectUri } from "../config/runtime-config.js";
import { logger } from "../lib/logger.js";
import { decryptApiKey, encryptApiKey } from "../utils/crypto.js";

// In-flight PKCE verifiers keyed by state param (short-lived, cleaned up on callback)
const pendingAuth = new Map<
  string,
  { codeVerifier: string; clientId: string; agentId: string; redirectUri: string; createdAt: number }
>();

const AUTH_TTL_MS = 10 * 60_000;

const SPOTIFY_SCOPES = [
  "user-modify-playback-state",
  "user-read-playback-state",
  "playlist-read-private",
  "user-library-read",
].join(" ");

function htmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generateRandomString(length: number): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => possible[crypto.randomInt(possible.length)]).join("");
}

async function sha256Base64url(plain: string): Promise<string> {
  const hash = crypto.createHash("sha256").update(plain).digest();
  return hash.toString("base64url");
}

type ExchangeResult = { ok: true } | { ok: false; status: number; reason: string };

function decryptStoredToken(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const decrypted = decryptApiKey(value);
  return decrypted || value;
}

export async function spotifyAuthRoutes(app: FastifyInstance) {
  const storage = createAgentsStorage(app.db);

  // Clean up stale pending auth entries (older than AUTH_TTL_MS)
  function cleanupPending() {
    const now = Date.now();
    for (const [key, entry] of pendingAuth) {
      if (now - entry.createdAt > AUTH_TTL_MS) pendingAuth.delete(key);
    }
  }

  /** Exchange code for tokens and persist them. Shared by /callback and /exchange. */
  async function completeExchange(args: { code: string; state: string }): Promise<ExchangeResult> {
    const { code, state } = args;
    const pending = pendingAuth.get(state);
    const expired = pending && Date.now() - pending.createdAt > AUTH_TTL_MS;
    if (!pending || expired) {
      if (expired) pendingAuth.delete(state);
      return { ok: false, status: 400, reason: "Authorization session expired or was already used." };
    }

    pendingAuth.delete(state);

    const { codeVerifier, clientId, agentId, redirectUri } = pending;

    const agent = await storage.getById(agentId);
    if (!agent) return { ok: false, status: 404, reason: "Agent not found" };

    try {
      const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        return {
          ok: false,
          status: tokenRes.status,
          reason: `Token exchange failed: ${body.slice(0, 200)}`,
        };
      }

      const tokens = (await tokenRes.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
        scope: string;
      };

      const latestAgent = await storage.getById(agentId);
      if (!latestAgent) return { ok: false, status: 404, reason: "Agent not found" };
      const latestSettings =
        latestAgent.settings && typeof latestAgent.settings === "string"
          ? JSON.parse(latestAgent.settings)
          : (latestAgent.settings ?? {});

      await storage.update(agentId, {
        settings: {
          ...latestSettings,
          spotifyAccessToken: encryptApiKey(tokens.access_token),
          spotifyRefreshToken: encryptApiKey(tokens.refresh_token),
          spotifyExpiresAt: Date.now() + tokens.expires_in * 1000,
          spotifyClientId: clientId,
        },
      });

      return { ok: true };
    } catch (err) {
      logger.error(err, "Spotify token exchange failed");
      return {
        ok: false,
        status: 500,
        reason: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  /**
   * GET /api/spotify/authorize?clientId=xxx&agentId=yyy
   * → Returns the Spotify authorization URL for the client to redirect to.
   */
  app.get<{ Querystring: { clientId: string; agentId: string } }>("/authorize", async (req, reply) => {
    const { clientId, agentId } = req.query;
    if (!clientId || !agentId) {
      return reply.status(400).send({ error: "clientId and agentId are required" });
    }

    cleanupPending();

    const codeVerifier = generateRandomString(64);
    const codeChallenge = await sha256Base64url(codeVerifier);
    const state = generateRandomString(32);

    const redirectUri = buildSpotifyRedirectUri(req as FastifyRequest);
    pendingAuth.set(state, { codeVerifier, clientId, agentId, redirectUri, createdAt: Date.now() });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: SPOTIFY_SCOPES,
      code_challenge_method: "S256",
      code_challenge: codeChallenge,
      redirect_uri: redirectUri,
      state,
    });

    const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;
    return { authUrl, redirectUri };
  });

  /**
   * GET /api/spotify/callback?code=xxx&state=yyy
   * Spotify redirects here after user authorizes. Exchanges code for tokens
   * and stores them in the agent settings.
   */
  app.get<{ Querystring: { code?: string; error?: string; state?: string } }>("/callback", async (req, reply) => {
    const { code, error, state } = req.query;

    if (error || !code || !state) {
      return reply
        .status(400)
        .type("text/html")
        .send(
          `<html><body style="font-family:system-ui;background:#1a1a2e;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h2 style="color:#f44">Spotify Authorization Failed</h2>
            <p>${htmlEscape(error ?? "Missing authorization code")}</p>
            <p style="color:#888">You can close this window.</p>
          </div>
        </body></html>`,
        );
    }

    const result = await completeExchange({ code, state });
    if (!result.ok) {
      return reply
        .status(result.status)
        .type("text/html")
        .send(
          `<html><body style="font-family:system-ui;background:#1a1a2e;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h2 style="color:#f44">Spotify Authorization Failed</h2>
            <p style="color:#888">${htmlEscape(result.reason)}</p>
            <p style="color:#888">You can close this window and try again.</p>
          </div>
        </body></html>`,
        );
    }

    return reply.type("text/html").send(
      `<html><body style="font-family:system-ui;background:#1a1a2e;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <h2 style="color:#1DB954">✓ Spotify Connected!</h2>
          <p style="color:#888">You can close this window and return to the app.</p>
          <script>window.close()</script>
        </div>
      </body></html>`,
    );
  });

  /**
   * POST /api/spotify/exchange
   * Body: { callbackUrl?: string; code?: string; state?: string }
   * Manual paste-back path for installs where the browser can't reach the
   * loopback callback. Accepts the full redirected URL or pre-extracted code+state.
   */
  app.post<{ Body: { callbackUrl?: string; code?: string; state?: string } }>("/exchange", async (req, reply) => {
    const body = req.body ?? {};
    let { code, state } = body;

    if (!code || !state) {
      const callbackUrl = body.callbackUrl?.trim();
      if (callbackUrl) {
        try {
          const parsed = new URL(callbackUrl);
          const errParam = parsed.searchParams.get("error");
          if (errParam) {
            return reply.status(400).send({ error: `Spotify returned an error: ${errParam}` });
          }
          code = parsed.searchParams.get("code") ?? undefined;
          state = parsed.searchParams.get("state") ?? undefined;
        } catch {
          return reply
            .status(400)
            .send({ error: "Could not parse the pasted URL. Make sure you copied the full address bar contents." });
        }
      }
    }

    if (!code || !state) {
      return reply
        .status(400)
        .send({ error: "Missing code or state. Paste the full URL Spotify redirected your browser to." });
    }

    cleanupPending();
    const result = await completeExchange({ code, state });
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.reason });
    }
    return { success: true };
  });

  /**
   * POST /api/spotify/refresh
   * Body: { agentId }
   * Refreshes the Spotify access token using the stored refresh token.
   */
  app.post<{ Body: { agentId: string } }>("/refresh", async (req, reply) => {
    const { agentId } = req.body ?? {};
    if (!agentId) return reply.status(400).send({ error: "agentId is required" });

    const agent = await storage.getById(agentId);
    if (!agent) return reply.status(404).send({ error: "Agent not found" });

    const settings =
      agent.settings && typeof agent.settings === "string" ? JSON.parse(agent.settings) : (agent.settings ?? {});

    const refreshToken = decryptStoredToken(settings.spotifyRefreshToken);
    const clientId = settings.spotifyClientId as string;
    if (!refreshToken || !clientId) {
      return reply.status(400).send({ error: "No Spotify refresh token or client ID configured" });
    }

    try {
      const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        return reply.status(tokenRes.status).send({ error: `Spotify refresh failed: ${body.slice(0, 200)}` });
      }

      const tokens = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };

      await storage.update(agentId, {
        settings: {
          ...settings,
          spotifyAccessToken: encryptApiKey(tokens.access_token),
          // Spotify may rotate refresh tokens
          spotifyRefreshToken: tokens.refresh_token ? encryptApiKey(tokens.refresh_token) : settings.spotifyRefreshToken,
          spotifyExpiresAt: Date.now() + tokens.expires_in * 1000,
        },
      });

      return { success: true };
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : "Refresh failed" });
    }
  });

  /**
   * GET /api/spotify/status?agentId=xxx
   * Returns whether Spotify is connected (has valid tokens).
   */
  app.get<{ Querystring: { agentId: string } }>("/status", async (req, reply) => {
    const { agentId } = req.query;
    if (!agentId) return reply.status(400).send({ error: "agentId is required" });

    const agent = await storage.getById(agentId);
    if (!agent) return reply.status(404).send({ error: "Agent not found" });

    const settings =
      agent.settings && typeof agent.settings === "string" ? JSON.parse(agent.settings) : (agent.settings ?? {});

    const hasToken = !!decryptStoredToken(settings.spotifyAccessToken);
    const hasRefresh = !!decryptStoredToken(settings.spotifyRefreshToken);
    const expiresAt = (settings.spotifyExpiresAt as number) ?? 0;
    const isExpired = expiresAt > 0 && Date.now() > expiresAt;

    return {
      connected: hasToken && hasRefresh,
      expired: isExpired,
      clientId: (settings.spotifyClientId as string) ?? null,
      redirectUri: buildSpotifyRedirectUri(req as FastifyRequest),
    };
  });

  /**
   * POST /api/spotify/disconnect
   * Body: { agentId }
   * Removes Spotify tokens from agent settings.
   */
  app.post<{ Body: { agentId: string } }>("/disconnect", async (req, reply) => {
    const { agentId } = req.body ?? {};
    if (!agentId) return reply.status(400).send({ error: "agentId is required" });

    const agent = await storage.getById(agentId);
    if (!agent) return reply.status(404).send({ error: "Agent not found" });

    const settings =
      agent.settings && typeof agent.settings === "string" ? JSON.parse(agent.settings) : (agent.settings ?? {});

    const { spotifyAccessToken, spotifyRefreshToken, spotifyExpiresAt, ...rest } = settings;
    await storage.update(agentId, { settings: rest });

    return { success: true };
  });
}
