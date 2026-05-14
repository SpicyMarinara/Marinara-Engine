// ──────────────────────────────────────────────
// Routes: Spotify OAuth (PKCE)
// ──────────────────────────────────────────────
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import { createAgentsStorage } from "../services/storage/agents.storage.js";
import { buildSpotifyRedirectUri } from "../config/runtime-config.js";
import { logger } from "../lib/logger.js";
import { encryptApiKey } from "../utils/crypto.js";
import {
  decryptStoredToken,
  fetchSpotifyApi,
  resolveSpotifyCredentials,
  SPOTIFY_SCOPES,
  spotifyHasScope,
  type SpotifyCredentialsResult,
} from "../services/spotify/spotify.service.js";
import { composeDjMariPlaylist, DjMariPlaylistError } from "../services/spotify/dj-mari-playlist.service.js";

// In-flight PKCE verifiers keyed by state param (short-lived, cleaned up on callback)
const pendingAuth = new Map<
  string,
  { codeVerifier: string; clientId: string; agentId: string; redirectUri: string; createdAt: number }
>();

const AUTH_TTL_MS = 10 * 60_000;

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

type SpotifyPlaybackItem = {
  id?: string;
  uri?: string;
  name?: string;
  duration_ms?: number;
  type?: string;
  artists?: Array<{ name?: string }>;
  album?: { name?: string; images?: Array<{ url?: string; width?: number; height?: number }> };
};

type SpotifyPlaybackResponse = {
  is_playing?: boolean;
  progress_ms?: number | null;
  repeat_state?: string;
  shuffle_state?: boolean;
  smart_shuffle?: boolean;
  item?: SpotifyPlaybackItem | null;
  device?: {
    id?: string | null;
    name?: string;
    type?: string;
    volume_percent?: number | null;
    is_active?: boolean;
  } | null;
};

function mapPlayback(data: SpotifyPlaybackResponse | null) {
  if (!data) return { connected: true, active: false };
  const item = data.item ?? null;
  return {
    connected: true,
    active: true,
    isPlaying: data.is_playing === true,
    shuffle: data.shuffle_state === true,
    smartShuffle: data.smart_shuffle === true,
    repeat: data.repeat_state === "track" || data.repeat_state === "context" ? data.repeat_state : "off",
    progressMs: typeof data.progress_ms === "number" ? data.progress_ms : null,
    durationMs: typeof item?.duration_ms === "number" ? item.duration_ms : null,
    item: item
      ? {
          id: item.id ?? null,
          uri: item.uri ?? null,
          name: item.name ?? "Unknown track",
          type: item.type ?? "track",
          artists: (item.artists ?? []).map((artist) => artist.name).filter(Boolean),
          album: item.album?.name ?? null,
          imageUrl: item.album?.images?.[0]?.url ?? null,
        }
      : null,
    device: data.device
      ? {
          id: data.device.id ?? null,
          name: data.device.name ?? "Spotify device",
          type: data.device.type ?? null,
          volume: typeof data.device.volume_percent === "number" ? data.device.volume_percent : null,
          isActive: data.device.is_active === true,
        }
      : null,
  };
}

async function readSpotifyError(res: Response, fallback: string) {
  const text = await res.text().catch(() => "");
  if (!text.trim()) return fallback;
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof json.error === "string") return json.error;
    if (typeof json.error?.message === "string") return json.error.message;
  } catch {
    /* use text fallback */
  }
  return text.slice(0, 300);
}

function isSpotifyDeviceNotFound(status: number, error: string): boolean {
  return status === 404 && /device\s+not\s+found/i.test(error);
}

function isSpotifyRestrictionViolated(error: string): boolean {
  return /restriction\s+violated/i.test(error);
}

function isSpotifyVolumeUnsupported(error: string): boolean {
  return /cannot\s+control\s+device\s+volume/i.test(error);
}

function spotifyControlPath(path: string, deviceId?: string | null): string {
  if (!deviceId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${new URLSearchParams({ device_id: deviceId }).toString()}`;
}

async function fetchSpotifyPlayerControl(args: {
  credentials: SpotifyCredentialsResult;
  path: string;
  method: "POST" | "PUT";
  fallbackError: string;
  deviceId?: string | null;
  body?: string;
}): Promise<{ res: Response; error: string | null }> {
  const options = { method: args.method, body: args.body };
  const res = await fetchSpotifyApi(args.credentials, spotifyControlPath(args.path, args.deviceId), options);
  if (res.ok || res.status === 204 || !args.deviceId) return { res, error: null };

  const error = await readSpotifyError(res, args.fallbackError);
  if (!isSpotifyDeviceNotFound(res.status, error) && !isSpotifyRestrictionViolated(error)) return { res, error };

  logger.debug(
    "[spotify] Playback device %s failed for %s (%s); retrying against the active Spotify device",
    args.deviceId,
    args.path,
    error,
  );

  const retry = await fetchSpotifyApi(args.credentials, args.path, options);
  return {
    res: retry,
    error: retry.ok || retry.status === 204 ? null : await readSpotifyError(retry, args.fallbackError),
  };
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

  async function getCredentialsOrReply(reply: FastifyReply, agentId?: string | null) {
    const result = await resolveSpotifyCredentials(storage, { agentId });
    if ("error" in result) {
      reply.status(result.status).send({ error: result.error });
      return null;
    }
    return result;
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
          spotifyScope: tokens.scope,
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
        scope?: string;
      };

      await storage.update(agentId, {
        settings: {
          ...settings,
          spotifyAccessToken: encryptApiKey(tokens.access_token),
          // Spotify may rotate refresh tokens
          spotifyRefreshToken: encryptApiKey(tokens.refresh_token ?? refreshToken),
          spotifyExpiresAt: Date.now() + tokens.expires_in * 1000,
          spotifyScope: tokens.scope ?? settings.spotifyScope,
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
    const scopeText = typeof settings.spotifyScope === "string" ? settings.spotifyScope : "";
    const scopes = scopeText.split(/\s+/).filter(Boolean);

    return {
      connected: hasToken && hasRefresh,
      expired: isExpired,
      clientId: (settings.spotifyClientId as string) ?? null,
      redirectUri: buildSpotifyRedirectUri(req as FastifyRequest),
      scopes,
      missingScopes: scopeText ? SPOTIFY_SCOPES.split(/\s+/).filter((scope) => !scopes.includes(scope)) : [],
    };
  });

  /**
   * GET /api/spotify/access-token?agentId=xxx
   * Returns a short-lived user access token for the browser-only Web Playback SDK.
   */
  app.get<{ Querystring: { agentId?: string } }>("/access-token", async (req, reply) => {
    const credentials = await getCredentialsOrReply(reply, req.query.agentId ?? null);
    if (!credentials) return;

    return {
      accessToken: credentials.accessToken,
      expiresAt: credentials.expiresAt,
      agentId: credentials.agentId,
      scopes: credentials.scopes,
      hasStreamingScope: spotifyHasScope(credentials.scopes, "streaming"),
    };
  });

  /**
   * GET /api/spotify/player
   * Current playback state for the global mini player.
   */
  app.get<{ Querystring: { agentId?: string } }>("/player", async (req, reply) => {
    const credentials = await getCredentialsOrReply(reply, req.query.agentId ?? null);
    if (!credentials) return;

    const res = await fetchSpotifyApi(credentials, "/me/player");
    if (res.status === 204) return mapPlayback(null);
    if (!res.ok) {
      return reply.status(res.status).send({ error: await readSpotifyError(res, "Spotify playback state failed") });
    }
    return mapPlayback((await res.json()) as SpotifyPlaybackResponse);
  });

  app.get<{ Querystring: { agentId?: string } }>("/devices", async (req, reply) => {
    const credentials = await getCredentialsOrReply(reply, req.query.agentId ?? null);
    if (!credentials) return;

    const res = await fetchSpotifyApi(credentials, "/me/player/devices");
    if (!res.ok) {
      return reply.status(res.status).send({ error: await readSpotifyError(res, "Spotify devices failed") });
    }
    const data = (await res.json()) as {
      devices?: Array<{
        id?: string | null;
        name?: string;
        type?: string;
        is_active?: boolean;
        volume_percent?: number | null;
      }>;
    };
    return {
      devices: (data.devices ?? []).map((device) => ({
        id: device.id ?? null,
        name: device.name ?? "Spotify device",
        type: device.type ?? null,
        isActive: device.is_active === true,
        volume: typeof device.volume_percent === "number" ? device.volume_percent : null,
      })),
    };
  });

  app.get<{ Querystring: { limit?: string; agentId?: string } }>("/playlists", async (req, reply) => {
    const credentials = await getCredentialsOrReply(reply, req.query.agentId ?? null);
    if (!credentials) return;

    const limit = Math.max(1, Math.min(50, Number(req.query.limit ?? 50)));
    const res = await fetchSpotifyApi(credentials, `/me/playlists?${new URLSearchParams({ limit: String(limit) })}`);
    if (!res.ok) {
      return reply.status(res.status).send({ error: await readSpotifyError(res, "Spotify playlists failed") });
    }
    const data = (await res.json()) as {
      items?: Array<{
        id?: string;
        name?: string;
        uri?: string;
        tracks?: { total?: number };
        owner?: { id?: string };
      }>;
    };

    // Spotify strips `tracks.total` from /me/playlists for Development Mode
    // apps. Look up real counts by hitting /playlists/{id}/items?limit=1 in
    // parallel for playlists owned by the connected user (followed playlists
    // 403 and stay unknown). Falls back gracefully if Spotify changes its mind.
    const meRes = await fetchSpotifyApi(credentials, "/me").catch((err) => {
      logger.warn(err, "Spotify /me lookup failed while resolving playlist ownership");
      return null;
    });
    const myId = meRes && meRes.ok ? ((await meRes.json()) as { id?: string }).id : null;
    if (!myId) {
      logger.warn("Could not resolve Spotify user id; playlist ownership will be unknown");
    }

    const playlists = await Promise.all(
      (data.items ?? []).map(async (playlist) => {
        const reported = playlist.tracks?.total;
        // Tri-state: true (owned), false (followed), null (unknown — e.g. /me lookup failed).
        // Null prevents the client from mislabeling owned playlists as "followed — unavailable"
        // when /me transiently fails.
        const owned: boolean | null = myId ? playlist.owner?.id === myId : null;
        let trackCount: number | null = typeof reported === "number" ? reported : null;
        if (trackCount === null && owned === true && playlist.id) {
          const itemsRes = await fetchSpotifyApi(
            credentials,
            `/playlists/${encodeURIComponent(playlist.id)}/items?limit=1`,
          ).catch(() => null);
          if (itemsRes && itemsRes.ok) {
            const itemsData = (await itemsRes.json().catch(() => null)) as { total?: number } | null;
            if (typeof itemsData?.total === "number") trackCount = itemsData.total;
          }
        }
        return {
          id: playlist.id ?? "",
          name: playlist.name ?? "Untitled playlist",
          uri: playlist.uri ?? "",
          trackCount,
          owned,
        };
      }),
    );

    return { playlists };
  });

  app.post<{ Body: { agentId?: string; deviceId?: string | null } }>("/dj-mari-playlist", async (req, reply) => {
    const credentials = await getCredentialsOrReply(reply, req.body?.agentId ?? null);
    if (!credentials) return;

    const requiredScopes = [
      "user-read-private",
      "playlist-modify-public",
      "playlist-modify-private",
      "user-library-read",
      "user-modify-playback-state",
    ];
    const missingScopes = requiredScopes.filter((scope) => !spotifyHasScope(credentials.scopes, scope));
    if (missingScopes.length > 0) {
      return reply.status(400).send({
        error: `Reconnect Spotify to let DJ Mari create playlists. Missing scopes: ${missingScopes.join(", ")}`,
        missingScopes,
      });
    }

    try {
      return await composeDjMariPlaylist({ db: app.db, credentials, deviceId: req.body?.deviceId ?? null });
    } catch (err) {
      if (err instanceof DjMariPlaylistError) {
        return reply.status(err.status).send({ error: err.message });
      }
      logger.error(err, "DJ Mari playlist creation failed");
      return reply.status(500).send({ error: err instanceof Error ? err.message : "DJ Mari playlist creation failed" });
    }
  });

  app.put<{
    Body: { agentId?: string; deviceId?: string | null; uri?: string; uris?: string[]; contextUri?: string };
  }>("/player/play", async (req, reply) => {
    const credentials = await getCredentialsOrReply(reply, req.body?.agentId ?? null);
    if (!credentials) return;

    const body: Record<string, unknown> = {};
    if (typeof req.body?.contextUri === "string" && req.body.contextUri.startsWith("spotify:")) {
      body.context_uri = req.body.contextUri;
    } else if (Array.isArray(req.body?.uris) && req.body.uris.length > 0) {
      body.uris = req.body.uris.filter((uri) => typeof uri === "string" && uri.startsWith("spotify:"));
    } else if (typeof req.body?.uri === "string" && req.body.uri.startsWith("spotify:")) {
      body.uris = [req.body.uri];
    }

    const { res, error } = await fetchSpotifyPlayerControl({
      credentials,
      path: "/me/player/play",
      method: "PUT",
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
      deviceId: req.body?.deviceId,
      fallbackError: "Spotify play failed",
    });
    if (!res.ok && res.status !== 204) {
      return reply.status(res.status).send({ error: error ?? (await readSpotifyError(res, "Spotify play failed")) });
    }
    return { success: true };
  });

  app.put<{ Body: { agentId?: string; deviceId?: string | null } }>("/player/pause", async (req, reply) => {
    const credentials = await getCredentialsOrReply(reply, req.body?.agentId ?? null);
    if (!credentials) return;

    const { res, error } = await fetchSpotifyPlayerControl({
      credentials,
      path: "/me/player/pause",
      method: "PUT",
      deviceId: req.body?.deviceId,
      fallbackError: "Spotify pause failed",
    });
    if (!res.ok && res.status !== 204) {
      return reply.status(res.status).send({ error: error ?? (await readSpotifyError(res, "Spotify pause failed")) });
    }
    return { success: true };
  });

  app.post<{ Body: { agentId?: string; deviceId?: string | null } }>("/player/next", async (req, reply) => {
    const credentials = await getCredentialsOrReply(reply, req.body?.agentId ?? null);
    if (!credentials) return;

    const { res, error } = await fetchSpotifyPlayerControl({
      credentials,
      path: "/me/player/next",
      method: "POST",
      deviceId: req.body?.deviceId,
      fallbackError: "Spotify next failed",
    });
    if (!res.ok && res.status !== 204) {
      return reply.status(res.status).send({ error: error ?? (await readSpotifyError(res, "Spotify next failed")) });
    }
    return { success: true };
  });

  app.post<{ Body: { agentId?: string; deviceId?: string | null } }>("/player/previous", async (req, reply) => {
    const credentials = await getCredentialsOrReply(reply, req.body?.agentId ?? null);
    if (!credentials) return;

    const { res, error } = await fetchSpotifyPlayerControl({
      credentials,
      path: "/me/player/previous",
      method: "POST",
      deviceId: req.body?.deviceId,
      fallbackError: "Spotify previous failed",
    });
    if (!res.ok && res.status !== 204) {
      return reply
        .status(res.status)
        .send({ error: error ?? (await readSpotifyError(res, "Spotify previous failed")) });
    }
    return { success: true };
  });

  app.put<{ Body: { agentId?: string; volume: number; deviceId?: string | null } }>(
    "/player/volume",
    async (req, reply) => {
      const credentials = await getCredentialsOrReply(reply, req.body?.agentId ?? null);
      if (!credentials) return;

      const volume = Math.max(0, Math.min(100, Math.round(Number(req.body?.volume ?? 50))));
      const { res, error } = await fetchSpotifyPlayerControl({
        credentials,
        path: `/me/player/volume?${new URLSearchParams({ volume_percent: String(volume) }).toString()}`,
        method: "PUT",
        deviceId: req.body?.deviceId,
        fallbackError: "Spotify volume failed",
      });
      if (!res.ok && res.status !== 204) {
        const message = error ?? (await readSpotifyError(res, "Spotify volume failed"));
        if (isSpotifyVolumeUnsupported(message)) {
          return reply.status(409).send({
            code: "SPOTIFY_VOLUME_UNSUPPORTED",
            error: "This Spotify device does not allow remote volume control. Use the device volume buttons instead.",
          });
        }
        return reply.status(res.status).send({ error: message });
      }
      return { success: true, volume };
    },
  );

  app.put<{ Body: { agentId?: string; enabled: boolean; deviceId?: string | null } }>(
    "/player/shuffle",
    async (req, reply) => {
      const credentials = await getCredentialsOrReply(reply, req.body?.agentId ?? null);
      if (!credentials) return;

      const { res, error } = await fetchSpotifyPlayerControl({
        credentials,
        path: `/me/player/shuffle?${new URLSearchParams({
          state: req.body?.enabled === true ? "true" : "false",
        }).toString()}`,
        method: "PUT",
        deviceId: req.body?.deviceId,
        fallbackError: "Spotify shuffle failed",
      });
      if (!res.ok && res.status !== 204) {
        return reply
          .status(res.status)
          .send({ error: error ?? (await readSpotifyError(res, "Spotify shuffle failed")) });
      }
      return { success: true, shuffle: req.body?.enabled === true };
    },
  );

  app.put<{ Body: { agentId?: string; state: "off" | "track" | "context"; deviceId?: string | null } }>(
    "/player/repeat",
    async (req, reply) => {
      const credentials = await getCredentialsOrReply(reply, req.body?.agentId ?? null);
      if (!credentials) return;

      const state = req.body?.state;
      if (state !== "off" && state !== "track" && state !== "context") {
        return reply.status(400).send({ error: "repeat state must be off, track, or context" });
      }

      const { res, error } = await fetchSpotifyPlayerControl({
        credentials,
        path: `/me/player/repeat?${new URLSearchParams({ state }).toString()}`,
        method: "PUT",
        deviceId: req.body?.deviceId,
        fallbackError: "Spotify repeat failed",
      });
      if (!res.ok && res.status !== 204) {
        return reply
          .status(res.status)
          .send({ error: error ?? (await readSpotifyError(res, "Spotify repeat failed")) });
      }
      return { success: true, repeat: state };
    },
  );

  app.put<{ Body: { agentId?: string; deviceId: string; play?: boolean } }>("/player/transfer", async (req, reply) => {
    const credentials = await getCredentialsOrReply(reply, req.body?.agentId ?? null);
    if (!credentials) return;

    const deviceId = req.body?.deviceId;
    if (!deviceId) return reply.status(400).send({ error: "deviceId is required" });
    const res = await fetchSpotifyApi(credentials, "/me/player", {
      method: "PUT",
      body: JSON.stringify({ device_ids: [deviceId], play: req.body?.play === true }),
    });
    if (!res.ok && res.status !== 204) {
      return reply.status(res.status).send({ error: await readSpotifyError(res, "Spotify transfer failed") });
    }
    return { success: true };
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
