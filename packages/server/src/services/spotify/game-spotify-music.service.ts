// ──────────────────────────────────────────────
// Spotify Game Music — deterministic shortlist + playback
// ──────────────────────────────────────────────
import { createHash } from "node:crypto";
import type { SceneSpotifyTrackCandidate, SceneSpotifyTrackSelection } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import type { createAgentsStorage } from "../storage/agents.storage.js";
import {
  fetchSpotifyApi,
  normalizeSpotifySearchQuery,
  resolveSpotifyCredentials,
  SPOTIFY_SEARCH_QUERY_MAX_CHARS,
  type SpotifyCredentialError,
  type SpotifyCredentialsResult,
} from "./spotify.service.js";

type AgentsStorage = ReturnType<typeof createAgentsStorage>;

type GameSpotifySourceType = "liked" | "playlist" | "artist" | "any";

type SpotifyTrackIndexCacheEntry = {
  tracks: SceneSpotifyTrackCandidate[];
  total: number;
  expiresAt: number;
  fetchedAt: number;
  truncated: boolean;
};

export interface GameSpotifyCandidateResult {
  enabled: boolean;
  tracks: SceneSpotifyTrackCandidate[];
  sourceType?: GameSpotifySourceType;
  sourceLabel?: string | null;
  total?: number;
  indexedTrackCount?: number;
  cacheStatus?: "hit" | "miss";
  candidateMode?: string;
  matchedTokens?: string[];
  excludedRecentTrackCount?: number;
  query?: string | null;
  reason?: string;
}

export interface GameSpotifyPlayResult {
  success: true;
  track: SceneSpotifyTrackSelection;
  repeatState: "off" | "track" | "context" | null;
  device: string | null;
}

class GameSpotifyError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GameSpotifyError";
    this.status = status;
  }
}

const SPOTIFY_TRACK_INDEX_TTL_MS = 20 * 60_000;
const SPOTIFY_TRACK_INDEX_CACHE_MAX = 24;
const SPOTIFY_TRACK_INDEX_MAX_TRACKS = 2_500;
const SPOTIFY_PLAYBACK_SETTLE_MS = 650;
const SPOTIFY_REPEAT_RETRY_DELAYS_MS = [0, 450, 900] as const;

const spotifyTrackIndexCache = new Map<string, SpotifyTrackIndexCacheEntry>();

type SpotifyPlaybackDevice = {
  id?: string | null;
  name?: string;
  type?: string | null;
  is_active?: boolean;
  is_restricted?: boolean;
};

const SPOTIFY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const SPOTIFY_MOOD_EXPANSIONS: Array<[RegExp, string[]]> = [
  [
    /\b(action|battle|boss|chase|combat|danger|duel|fight|war)\b/,
    ["battle", "combat", "fight", "boss", "war", "intense"],
  ],
  [/\b(calm|cozy|gentle|peace|peaceful|rest|safe|soft)\b/, ["calm", "peace", "gentle", "soft", "rest", "serene"]],
  [/\b(dark|dread|fear|horror|ominous|scary|shadow|terror)\b/, ["dark", "ominous", "shadow", "night", "horror"]],
  [/\b(grief|lonely|melancholy|sad|sorrow|tragic|tears)\b/, ["sad", "sorrow", "melancholy", "lament", "lonely"]],
  [/\b(love|romance|romantic|tender|warm)\b/, ["love", "romance", "tender", "heart", "warm"]],
  [/\b(mystery|secret|sneak|stealth|suspense|tense)\b/, ["mystery", "secret", "stealth", "tension", "suspense"]],
  [/\b(epic|heroic|triumph|victory)\b/, ["epic", "hero", "triumph", "victory", "theme"]],
];

function isCredentialError(value: SpotifyCredentialsResult | SpotifyCredentialError): value is SpotifyCredentialError {
  return "error" in value;
}

function spotifyError(status: number, message: string): never {
  throw new GameSpotifyError(status, message);
}

export function getGameSpotifyErrorStatus(error: unknown): number {
  return error instanceof GameSpotifyError ? error.status : 500;
}

function normalizeSourceType(value: unknown): GameSpotifySourceType {
  return value === "playlist" || value === "artist" || value === "any" || value === "liked" ? value : "liked";
}

function getGameSpotifySource(meta: Record<string, unknown>):
  | {
      enabled: true;
      type: GameSpotifySourceType;
      playlistId: string | null;
      playlistName: string | null;
      artist: string | null;
    }
  | { enabled: false; reason: string } {
  if (meta.gameUseSpotifyMusic !== true) {
    return { enabled: false, reason: "Spotify music is disabled for this game." };
  }

  const type = normalizeSourceType(meta.gameSpotifySourceType);
  const playlistId = typeof meta.gameSpotifyPlaylistId === "string" ? meta.gameSpotifyPlaylistId.trim() : "";
  const playlistName = typeof meta.gameSpotifyPlaylistName === "string" ? meta.gameSpotifyPlaylistName.trim() : "";
  const artist = typeof meta.gameSpotifyArtist === "string" ? meta.gameSpotifyArtist.trim() : "";

  if (type === "playlist" && !playlistId) {
    return { enabled: false, reason: "Spotify playlist source is selected, but no playlist is configured." };
  }
  if (type === "artist" && !artist) {
    return { enabled: false, reason: "Spotify artist source is selected, but no artist is configured." };
  }

  return {
    enabled: true,
    type,
    playlistId: type === "playlist" ? playlistId : type === "liked" ? "liked" : null,
    playlistName: playlistName || null,
    artist: artist || null,
  };
}

function clampCount(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value ?? fallback);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSpotifyText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildSpotifyCandidateTokens(query: string): string[] {
  const normalized = normalizeSpotifyText(query);
  const tokens = new Set(
    normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !SPOTIFY_STOP_WORDS.has(token)),
  );

  for (const [pattern, expansions] of SPOTIFY_MOOD_EXPANSIONS) {
    if (pattern.test(normalized)) {
      expansions.forEach((term) => tokens.add(term));
    }
  }

  return Array.from(tokens);
}

function hashFraction(value: string): number {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16) / 0xffffffff;
}

function scoreSpotifyCandidate(track: SceneSpotifyTrackCandidate, phrase: string, tokens: string[]): number {
  const name = normalizeSpotifyText(track.name);
  const artist = normalizeSpotifyText(track.artist);
  const album = normalizeSpotifyText(track.album ?? "");
  const haystack = `${name} ${artist} ${album}`;
  let score = 0;

  if (phrase && haystack.includes(phrase)) score += 35;
  for (const token of tokens) {
    if (name.includes(token)) score += 8;
    if (album.includes(token)) score += 4;
    if (artist.includes(token)) score += 2;
  }

  return score + hashFraction(`${track.uri}:${phrase}`) * 0.01;
}

function sampleSpotifyTracksEvenly(
  tracks: SceneSpotifyTrackCandidate[],
  count: number,
  seed: string,
): SceneSpotifyTrackCandidate[] {
  if (tracks.length <= count) return tracks;
  const start = Math.floor(hashFraction(seed) * Math.max(1, Math.floor(tracks.length / count)));
  const step = tracks.length / count;
  const sampled: SceneSpotifyTrackCandidate[] = [];
  const seen = new Set<string>();

  for (let i = 0; sampled.length < count && i < count * 3; i++) {
    const index = Math.min(tracks.length - 1, Math.floor(start + i * step) % tracks.length);
    const track = tracks[index];
    if (track && !seen.has(track.uri)) {
      sampled.push(track);
      seen.add(track.uri);
    }
  }

  for (const track of tracks) {
    if (sampled.length >= count) break;
    if (!seen.has(track.uri)) {
      sampled.push(track);
      seen.add(track.uri);
    }
  }

  return sampled;
}

function buildSpotifyCandidatePool(
  tracks: SceneSpotifyTrackCandidate[],
  recentTrackUris: readonly string[] | undefined,
): {
  tracks: SceneSpotifyTrackCandidate[];
  excludedRecentTrackCount: number;
} {
  const recent = new Set(
    (recentTrackUris ?? []).filter((uri): uri is string => typeof uri === "string" && uri.startsWith("spotify:track:")),
  );
  if (recent.size === 0) {
    return { tracks, excludedRecentTrackCount: 0 };
  }

  const fresh = tracks.filter((track) => !recent.has(track.uri));
  if (fresh.length === 0) {
    return { tracks, excludedRecentTrackCount: 0 };
  }

  return {
    tracks: fresh,
    excludedRecentTrackCount: tracks.length - fresh.length,
  };
}

function selectSpotifyTrackCandidates(args: {
  tracks: SceneSpotifyTrackCandidate[];
  query: string;
  limit: number;
  sourceKey: string;
  recentTrackUris?: readonly string[];
}): {
  candidates: SceneSpotifyTrackCandidate[];
  mode: string;
  tokens: string[];
  excludedRecentTrackCount: number;
} {
  const phrase = normalizeSpotifyText(args.query);
  const tokens = buildSpotifyCandidateTokens(args.query);
  const pool = buildSpotifyCandidatePool(args.tracks, args.recentTrackUris);
  const modeSuffix = pool.excludedRecentTrackCount > 0 ? "_fresh" : "";
  if (tokens.length === 0) {
    return {
      candidates: sampleSpotifyTracksEvenly(pool.tracks, args.limit, `${args.sourceKey}:balanced`),
      mode: `balanced_sample${modeSuffix}`,
      tokens,
      excludedRecentTrackCount: pool.excludedRecentTrackCount,
    };
  }

  const scored = pool.tracks
    .map((track) => ({ ...track, score: scoreSpotifyCandidate(track, phrase, tokens) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const strong = scored.filter((track) => (track.score ?? 0) >= 2);
  const selected: SceneSpotifyTrackCandidate[] = strong.slice(0, Math.max(0, Math.floor(args.limit * 0.8)));
  const seen = new Set(selected.map((track) => track.uri));
  const reserve = args.limit - selected.length;

  if (reserve > 0) {
    const fallback = sampleSpotifyTracksEvenly(
      pool.tracks.filter((track) => !seen.has(track.uri)),
      reserve,
      `${args.sourceKey}:${phrase}:fallback`,
    );
    selected.push(...fallback);
  }

  return {
    candidates: selected.slice(0, args.limit),
    mode: `${strong.length > 0 ? "scored_candidates" : "balanced_sample"}${modeSuffix}`,
    tokens,
    excludedRecentTrackCount: pool.excludedRecentTrackCount,
  };
}

function spotifyTrackCacheKey(credentials: SpotifyCredentialsResult, sourceKey: string): string {
  const digest = createHash("sha256").update(credentials.accessToken).digest("hex").slice(0, 12);
  return `${digest}:${sourceKey}`;
}

function pruneSpotifyTrackCache() {
  while (spotifyTrackIndexCache.size > SPOTIFY_TRACK_INDEX_CACHE_MAX) {
    const oldest = spotifyTrackIndexCache.keys().next().value as string | undefined;
    if (!oldest) return;
    spotifyTrackIndexCache.delete(oldest);
  }
}

// /me/tracks wraps each track under `.track`, while /playlists/{id}/items wraps
// it under `.item` (the singular field, because an item may also be a podcast
// episode). Accept either shape so the same mapper covers both endpoints.
type SpotifyTrackInner = {
  uri?: string;
  name?: string;
  artists?: Array<{ name?: string }>;
  album?: { name?: string };
};

function mapSpotifyTrackItems(
  items: Array<{ track?: SpotifyTrackInner | null; item?: SpotifyTrackInner | null }>,
  offset: number,
): SceneSpotifyTrackCandidate[] {
  return items
    .map((item, index): SceneSpotifyTrackCandidate | null => {
      const track = item.track ?? item.item;
      if (!track?.uri?.startsWith("spotify:track:")) return null;
      return {
        uri: track.uri,
        name: track.name || "Unknown track",
        artist:
          (track.artists ?? [])
            .map((a) => a.name)
            .filter(Boolean)
            .join(", ") || "Unknown artist",
        album: track.album?.name || "Unknown album",
        position: offset + index + 1,
      };
    })
    .filter((track): track is SceneSpotifyTrackCandidate => Boolean(track));
}

async function fetchSpotifyTrackIndex(
  sourceKey: string,
  credentials: SpotifyCredentialsResult,
): Promise<SpotifyTrackIndexCacheEntry & { cacheStatus: "hit" | "miss" }> {
  const cacheKey = spotifyTrackCacheKey(credentials, sourceKey);
  const cached = spotifyTrackIndexCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached, cacheStatus: "hit" };
  }

  const tracks: SceneSpotifyTrackCandidate[] = [];
  let offset = 0;
  let total = 0;
  let fetchedItems = 0;
  const batchSize = sourceKey === "liked" ? 50 : 100;

  while (offset < SPOTIFY_TRACK_INDEX_MAX_TRACKS) {
    const pageSize = Math.min(batchSize, SPOTIFY_TRACK_INDEX_MAX_TRACKS - offset);
    // Use /playlists/{id}/items (the supported endpoint) rather than the deprecated
    // /tracks variant. After Spotify's 2026-03 Web API migration, /tracks returns
    // 403 for Development Mode apps and only the /items path works.
    const endpoint =
      sourceKey === "liked"
        ? `/me/tracks?${new URLSearchParams({ limit: String(pageSize), offset: String(offset) })}`
        : `/playlists/${encodeURIComponent(sourceKey)}/items?${new URLSearchParams({ limit: String(pageSize), offset: String(offset) })}`;
    const res = await fetchSpotifyApi(credentials, endpoint, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      // Development Mode apps without Extended Quota can only read playlists owned
      // by the connected Spotify user; followed/editorial playlists 403.
      if (res.status === 403 && sourceKey !== "liked") {
        spotifyError(
          403,
          "Spotify denied access to this playlist's contents. Spotify only allows reading playlists owned by the connected account; followed or editorial playlists are blocked for Development Mode apps. Pick a playlist you own, switch to Liked Songs, or use Any Spotify.",
        );
      }
      const body = await res.text();
      spotifyError(res.status, `Spotify track index failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      items?: Array<{ track?: SpotifyTrackInner | null; item?: SpotifyTrackInner | null }>;
      total?: number;
      next?: string | null;
    };
    const items = data.items ?? [];
    total = typeof data.total === "number" ? data.total : Math.max(total, offset + items.length);
    fetchedItems = offset + items.length;
    tracks.push(...mapSpotifyTrackItems(items, offset));

    if (!data.next || items.length === 0 || items.length < pageSize) break;
    offset += items.length;
  }

  const entry: SpotifyTrackIndexCacheEntry = {
    tracks,
    total: total || tracks.length,
    expiresAt: Date.now() + SPOTIFY_TRACK_INDEX_TTL_MS,
    fetchedAt: Date.now(),
    truncated: fetchedItems >= SPOTIFY_TRACK_INDEX_MAX_TRACKS && fetchedItems < total,
  };
  spotifyTrackIndexCache.set(cacheKey, entry);
  pruneSpotifyTrackCache();
  return { ...entry, cacheStatus: "miss" };
}

async function searchSpotifyTracks(
  credentials: SpotifyCredentialsResult,
  query: string,
  limit: number,
): Promise<SceneSpotifyTrackCandidate[]> {
  const q = normalizeSpotifySearchQuery(query) || "soundtrack";
  const res = await fetchSpotifyApi(
    credentials,
    `/search?${new URLSearchParams({ q, type: "track", limit: String(limit) })}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) {
    const body = await res.text();
    spotifyError(res.status, `Spotify search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    tracks?: {
      items?: Array<{ uri?: string; name?: string; artists?: Array<{ name?: string }>; album?: { name?: string } }>;
    };
  };
  return (data.tracks?.items ?? [])
    .map((track, index): SceneSpotifyTrackCandidate | null => {
      if (!track.uri?.startsWith("spotify:track:")) return null;
      return {
        uri: track.uri,
        name: track.name || "Unknown track",
        artist:
          (track.artists ?? [])
            .map((artist) => artist.name)
            .filter(Boolean)
            .join(", ") || "Unknown artist",
        album: track.album?.name || "Unknown album",
        position: index + 1,
      };
    })
    .filter((track): track is SceneSpotifyTrackCandidate => Boolean(track));
}

function buildArtistSearchQuery(artist: string, query: string): string {
  const artistFilter = normalizeSpotifySearchQuery(`artist:${artist}`, 120);
  const fallback = artistFilter || "artist";
  const remaining = Math.max(1, SPOTIFY_SEARCH_QUERY_MAX_CHARS - fallback.length - 1);
  const sceneQuery = normalizeSpotifySearchQuery(query || "soundtrack", remaining);
  return normalizeSpotifySearchQuery([fallback, sceneQuery].filter(Boolean).join(" "));
}

async function getCredentials(storage: AgentsStorage): Promise<SpotifyCredentialsResult> {
  const credentials = await resolveSpotifyCredentials(storage, { refreshSkewMs: 60_000 });
  if (isCredentialError(credentials)) {
    spotifyError(credentials.status, credentials.error);
  }
  return credentials;
}

export function buildGameSpotifySceneQuery(args: {
  narration: string;
  playerAction?: string | null;
  context?: Record<string, unknown> | null;
}): string {
  const context = args.context ?? {};
  const parts = [
    typeof context.currentState === "string" ? context.currentState : "",
    typeof context.currentWeather === "string" ? context.currentWeather : "",
    typeof context.currentTimeOfDay === "string" ? context.currentTimeOfDay : "",
    typeof args.playerAction === "string" ? args.playerAction : "",
    args.narration,
  ];
  return parts
    .join(" ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

export async function getGameSpotifyCandidates(args: {
  storage: AgentsStorage;
  chatMeta: Record<string, unknown>;
  query: string;
  limit?: number;
  recentTrackUris?: readonly string[];
}): Promise<GameSpotifyCandidateResult> {
  const source = getGameSpotifySource(args.chatMeta);
  if (!source.enabled) {
    return { enabled: false, tracks: [], reason: source.reason };
  }

  const credentials = await getCredentials(args.storage);
  const limit = clampCount(args.limit ?? 50, 50, 1, 50);
  const query = normalizeSpotifySearchQuery(args.query);

  if (source.type === "liked" || source.type === "playlist") {
    const sourceKey = source.playlistId ?? "liked";
    const index = await fetchSpotifyTrackIndex(sourceKey, credentials);
    const selection = selectSpotifyTrackCandidates({
      tracks: index.tracks,
      query,
      limit,
      sourceKey,
      recentTrackUris: args.recentTrackUris,
    });
    return {
      enabled: true,
      tracks: selection.candidates,
      sourceType: source.type,
      sourceLabel: source.type === "playlist" ? source.playlistName : "Liked Songs",
      total: index.total,
      indexedTrackCount: index.tracks.length,
      cacheStatus: index.cacheStatus,
      candidateMode: selection.mode,
      matchedTokens: selection.tokens,
      excludedRecentTrackCount: selection.excludedRecentTrackCount,
      query: query || null,
    };
  }

  if (source.type === "artist") {
    const artist = source.artist ?? "";
    const artistQuery = buildArtistSearchQuery(artist, query);
    let tracks = await searchSpotifyTracks(credentials, artistQuery, limit);
    if (tracks.length === 0) {
      tracks = await searchSpotifyTracks(credentials, `artist:${artist}`, limit);
    }
    const pool = buildSpotifyCandidatePool(tracks, args.recentTrackUris);
    return {
      enabled: true,
      tracks: pool.tracks.slice(0, limit),
      sourceType: source.type,
      sourceLabel: artist,
      candidateMode: `spotify_search${pool.excludedRecentTrackCount > 0 ? "_fresh" : ""}`,
      excludedRecentTrackCount: pool.excludedRecentTrackCount,
      query: artistQuery,
    };
  }

  const tracks = await searchSpotifyTracks(credentials, query || "game soundtrack instrumental", limit);
  const pool = buildSpotifyCandidatePool(tracks, args.recentTrackUris);
  return {
    enabled: true,
    tracks: pool.tracks.slice(0, limit),
    sourceType: source.type,
    sourceLabel: "Spotify search",
    candidateMode: `spotify_search${pool.excludedRecentTrackCount > 0 ? "_fresh" : ""}`,
    excludedRecentTrackCount: pool.excludedRecentTrackCount,
    query: query || null,
  };
}

function normalizeRepeatState(value: unknown): "off" | "track" | "context" {
  return value === "track" || value === "context" ? value : "off";
}

function isPersonalMobileSpotifyDeviceType(type: string | null | undefined): boolean {
  const normalized = type?.toLowerCase() ?? "";
  return normalized === "smartphone" || normalized === "tablet";
}

async function readPlaybackSnapshot(credentials: SpotifyCredentialsResult): Promise<{
  trackUri: string | null;
  repeatState: "off" | "track" | "context";
  deviceId: string | null;
  deviceName: string | null;
  deviceType: string | null;
} | null> {
  const res = await fetchSpotifyApi(credentials, "/me/player", { signal: AbortSignal.timeout(10_000) }).catch(
    () => null,
  );
  if (!res || res.status === 204 || !res.ok) return null;
  const data = (await res.json()) as {
    repeat_state?: string;
    item?: { uri?: string | null } | null;
    device?: { id?: string | null; name?: string | null; type?: string | null } | null;
  };
  return {
    trackUri: typeof data.item?.uri === "string" ? data.item.uri : null,
    repeatState: normalizeRepeatState(data.repeat_state),
    deviceId: typeof data.device?.id === "string" ? data.device.id : null,
    deviceName: typeof data.device?.name === "string" ? data.device.name : null,
    deviceType: typeof data.device?.type === "string" ? data.device.type : null,
  };
}

// When no playback session is active, /me/player returns 204 and the snapshot
// has no device_id. Fall back to /me/player/devices so the SDK mini-player (or
// any other idle-but-connected device) can be targeted directly — otherwise
// /me/player/play with no device_id 404s with NO_ACTIVE_DEVICE.
async function findAvailablePlaybackDevice(
  credentials: SpotifyCredentialsResult,
  options?: { mobileOnly?: boolean },
): Promise<{ deviceId: string; deviceName: string } | null> {
  const res = await fetchSpotifyApi(credentials, "/me/player/devices", {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    devices?: SpotifyPlaybackDevice[];
  } | null;
  const devices = data?.devices ?? [];

  const pick = (predicate: (d: SpotifyPlaybackDevice) => boolean) =>
    devices.find((d) => typeof d.id === "string" && d.id && !d.is_restricted && predicate(d));

  const candidate =
    options?.mobileOnly === true
      ? (pick((d) => d.is_active === true && isPersonalMobileSpotifyDeviceType(d.type)) ??
        pick((d) => isPersonalMobileSpotifyDeviceType(d.type)))
      : (pick((d) => d.is_active === true) ??
        pick((d) => d.name !== "Marinara Engine") ??
        pick((d) => d.name === "Marinara Engine"));

  if (!candidate?.id) return null;
  return { deviceId: candidate.id, deviceName: candidate.name ?? "Spotify device" };
}

async function setSpotifyRepeat(
  credentials: SpotifyCredentialsResult,
  state: "off" | "track" | "context",
  deviceId?: string | null,
  attempts = 1,
): Promise<"off" | "track" | "context" | null> {
  for (let i = 0; i < attempts; i++) {
    const delay = SPOTIFY_REPEAT_RETRY_DELAYS_MS[Math.min(i, SPOTIFY_REPEAT_RETRY_DELAYS_MS.length - 1)] ?? 0;
    if (delay > 0) await wait(delay);
    const params = new URLSearchParams({ state });
    if (deviceId) params.set("device_id", deviceId);
    const res = await fetchSpotifyApi(credentials, `/me/player/repeat?${params.toString()}`, {
      method: "PUT",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (res && (res.ok || res.status === 204)) return state;
  }
  return null;
}

export async function playGameSpotifyTrack(args: {
  storage: AgentsStorage;
  chatMeta: Record<string, unknown>;
  track: SceneSpotifyTrackSelection;
  deviceId?: string | null;
  mobileDeviceOnly?: boolean;
}): Promise<GameSpotifyPlayResult> {
  const source = getGameSpotifySource(args.chatMeta);
  if (!source.enabled) {
    spotifyError(400, source.reason);
  }
  if (!args.track.uri.startsWith("spotify:track:")) {
    spotifyError(400, "A valid Spotify track URI is required.");
  }

  const credentials = await getCredentials(args.storage);
  const before = await readPlaybackSnapshot(credentials);
  const canUseCurrentDevice =
    args.mobileDeviceOnly !== true || isPersonalMobileSpotifyDeviceType(before?.deviceType ?? null);
  let targetDeviceId = args.deviceId ?? (canUseCurrentDevice ? (before?.deviceId ?? null) : null);
  let targetDeviceName =
    args.deviceId && args.deviceId !== before?.deviceId
      ? null
      : canUseCurrentDevice
        ? (before?.deviceName ?? null)
        : null;
  if (!targetDeviceId) {
    const fallback = await findAvailablePlaybackDevice(credentials, { mobileOnly: args.mobileDeviceOnly === true });
    if (fallback) {
      targetDeviceId = fallback.deviceId;
      targetDeviceName = fallback.deviceName;
    }
  }

  if (!targetDeviceId) {
    if (args.mobileDeviceOnly === true) {
      spotifyError(
        404,
        "No phone or tablet Spotify device is available. Open Spotify on this phone so it appears as a Spotify Connect device, then try again.",
      );
    }
    spotifyError(
      404,
      "No Spotify device is available. Enable the Spotify mini player in Settings, or open Spotify on another device, then try again.",
    );
  }

  const query = `?${new URLSearchParams({ device_id: targetDeviceId }).toString()}`;

  await setSpotifyRepeat(credentials, "off", targetDeviceId).catch((err) => {
    logger.debug(err, "[spotify/game] Failed to clear repeat before scene track playback");
  });

  const res = await fetchSpotifyApi(credentials, `/me/player/play${query}`, {
    method: "PUT",
    body: JSON.stringify({ uris: [args.track.uri], position_ms: 0 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    spotifyError(res.status, `Spotify play failed (${res.status}): ${body.slice(0, 200)}`);
  }

  await wait(SPOTIFY_PLAYBACK_SETTLE_MS);
  let repeatState = await setSpotifyRepeat(credentials, "track", targetDeviceId, 3);
  let current = await readPlaybackSnapshot(credentials);
  if (current?.trackUri === args.track.uri && current.repeatState !== "track") {
    repeatState = await setSpotifyRepeat(credentials, "track", current.deviceId ?? targetDeviceId, 3);
    current = await readPlaybackSnapshot(credentials);
  }

  return {
    success: true,
    track: args.track,
    repeatState: current?.repeatState ?? repeatState ?? null,
    device: current?.deviceName ?? targetDeviceName,
  };
}
