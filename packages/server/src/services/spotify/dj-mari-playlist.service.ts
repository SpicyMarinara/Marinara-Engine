// Spotify DJ Mari - AI playlist composer
import { PROVIDERS } from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { createLLMProvider } from "../llm/provider-registry.js";
import { createAgentsStorage } from "../storage/agents.storage.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createConnectionsStorage } from "../storage/connections.storage.js";
import { fetchSpotifyApi, type SpotifyCredentialsResult } from "./spotify.service.js";

type ChatRow = Awaited<ReturnType<ReturnType<typeof createChatsStorage>["list"]>>[number];
type MessageRow = Awaited<ReturnType<ReturnType<typeof createChatsStorage>["listMessagesPaginated"]>>[number];
type CharacterRow = Awaited<ReturnType<ReturnType<typeof createCharactersStorage>["list"]>>[number];
type PersonaRow = Awaited<ReturnType<ReturnType<typeof createCharactersStorage>["listPersonas"]>>[number];

type SpotifyTrack = {
  uri: string;
  name: string;
  artist: string;
  album: string | null;
};

type GeneratedTrack = {
  title: string;
  artist: string;
  reason?: string;
};

type MatchedTrack = SpotifyTrack & {
  requestedTitle: string;
  requestedArtist: string;
  reason?: string;
};

export type DjMariPlaylistResult = {
  success: true;
  name: string;
  playlistId: string;
  playlistUri: string;
  playlistUrl: string | null;
  requestedTrackCount: number;
  trackCount: number;
  playbackStarted: boolean;
  playbackError?: string | null;
  tracks: MatchedTrack[];
};

export class DjMariPlaylistError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DjMariPlaylistError";
    this.status = status;
  }
}

const DJ_MARI_CONTEXT_TOKENS = 16_384;
const DJ_MARI_OUTPUT_TOKENS = 8_192;
const DJ_MARI_MIN_TRACKS = 25;
const DJ_MARI_MAX_TRACKS = 50;
const RECENT_CHAT_MESSAGE_LIMIT = 8;
const LIKED_SONG_EXAMPLE_LIMIT = 50;
const SPOTIFY_MIN_TITLE_SIMILARITY = 0.7;
const SPOTIFY_MIN_ARTIST_SIMILARITY = 0.2;
const SPOTIFY_MIN_MATCH_SCORE = 70;

function fail(status: number, message: string): never {
  throw new DjMariPlaylistError(status, message);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseCharacter(row: CharacterRow): { id: string; name: string; description: string; personality: string } {
  const data = parseJsonObject(row.data);
  return {
    id: row.id,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Unnamed character",
    description: typeof data.description === "string" ? data.description : "",
    personality: typeof data.personality === "string" ? data.personality : "",
  };
}

function clampText(value: string, maxChars: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 16)).trimEnd()} [truncated]`;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function normalizeSpotifyText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = new Set(normalizeSpotifyText(left).split(/\s+/).filter(Boolean));
  if (leftTokens.size === 0) return 0;
  const rightTokens = new Set(normalizeSpotifyText(right).split(/\s+/).filter(Boolean));
  let score = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) score += 1;
  }
  return score / leftTokens.size;
}

function spotifyTextSimilarity(wanted: string, actual: string): number {
  const normalizedWanted = normalizeSpotifyText(wanted);
  const normalizedActual = normalizeSpotifyText(actual);
  if (!normalizedWanted || !normalizedActual) return 0;
  if (normalizedActual === normalizedWanted) return 1;
  if (normalizedActual.includes(normalizedWanted) || normalizedWanted.includes(normalizedActual)) return 0.85;
  return tokenOverlapScore(wanted, actual);
}

function scoreSpotifyMatch(
  track: SpotifyTrack,
  desired: GeneratedTrack,
): {
  score: number;
  titleSimilarity: number;
  artistSimilarity: number;
} {
  const titleSimilarity = spotifyTextSimilarity(desired.title, track.name);
  const artistSimilarity = spotifyTextSimilarity(desired.artist, track.artist);
  return {
    score: titleSimilarity * 60 + artistSimilarity * 34,
    titleSimilarity,
    artistSimilarity,
  };
}

function isStrongSpotifyMatch(track: SpotifyTrack, desired: GeneratedTrack): boolean {
  const quality = scoreSpotifyMatch(track, desired);
  return (
    quality.titleSimilarity >= SPOTIFY_MIN_TITLE_SIMILARITY &&
    (quality.artistSimilarity >= SPOTIFY_MIN_ARTIST_SIMILARITY || quality.score >= SPOTIFY_MIN_MATCH_SCORE)
  );
}

function todayLabel(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence?.[1]) return fence[1].trim();
  const object = text.match(/\{[\s\S]*\}/);
  if (object?.[0]) return object[0].trim();
  return text.trim();
}

function parseGeneratedTracks(raw: string): GeneratedTrack[] {
  const parsed = JSON.parse(extractJson(raw)) as unknown;
  const record = parseJsonObject(parsed);
  const tracks = Array.isArray(record.tracks) ? record.tracks : Array.isArray(parsed) ? parsed : [];
  const normalized: GeneratedTrack[] = [];
  const seen = new Set<string>();

  for (const item of tracks) {
    const row = parseJsonObject(item);
    const title =
      typeof row.title === "string"
        ? row.title.trim()
        : typeof row.name === "string"
          ? row.name.trim()
          : typeof row.track === "string"
            ? row.track.trim()
            : "";
    const artist =
      typeof row.artist === "string" ? row.artist.trim() : typeof row.artists === "string" ? row.artists.trim() : "";
    if (!title || !artist) continue;

    const key = `${normalizeSpotifyText(title)}:${normalizeSpotifyText(artist)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      title,
      artist,
      reason: typeof row.reason === "string" ? clampText(row.reason, 180) : undefined,
    });
    if (normalized.length >= DJ_MARI_MAX_TRACKS) break;
  }

  return normalized;
}

async function readSpotifyError(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text.trim()) return fallback;
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof json.error === "string") return json.error;
    if (typeof json.error?.message === "string") return json.error.message;
    if (typeof json.message === "string") return json.message;
  } catch {
    /* use text below */
  }
  return text.slice(0, 300);
}

async function fetchLikedSongExamples(credentials: SpotifyCredentialsResult): Promise<SpotifyTrack[]> {
  const res = await fetchSpotifyApi(
    credentials,
    `/me/tracks?${new URLSearchParams({ limit: String(LIKED_SONG_EXAMPLE_LIMIT) })}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) {
    fail(res.status, `Spotify liked songs failed: ${await readSpotifyError(res, "Could not read liked songs.")}`);
  }
  const data = (await res.json()) as {
    items?: Array<{
      track?: {
        uri?: string;
        name?: string;
        artists?: Array<{ name?: string }>;
        album?: { name?: string };
      } | null;
    }>;
  };

  return (data.items ?? [])
    .map((item): SpotifyTrack | null => {
      const track = item.track;
      if (!track?.uri?.startsWith("spotify:track:")) return null;
      return {
        uri: track.uri,
        name: track.name || "Unknown track",
        artist:
          (track.artists ?? [])
            .map((artist) => artist.name)
            .filter(Boolean)
            .join(", ") || "Unknown artist",
        album: track.album?.name ?? null,
      };
    })
    .filter((track): track is SpotifyTrack => Boolean(track));
}

async function searchSpotifyTrack(
  credentials: SpotifyCredentialsResult,
  desired: GeneratedTrack,
): Promise<SpotifyTrack | null> {
  const compactTitle = desired.title.replace(/"/g, "").replace(/\s+/g, " ").trim();
  const compactArtist = desired.artist.replace(/"/g, "").replace(/\s+/g, " ").trim();
  const queries = Array.from(
    new Set([
      `track:"${compactTitle}" artist:"${compactArtist}"`,
      `"${compactTitle}" "${compactArtist}"`,
      `${compactTitle} ${compactArtist}`,
    ]),
  ).map((query) => query.slice(0, 500));
  const candidatesByUri = new Map<string, SpotifyTrack>();

  for (const query of queries) {
    const res = await fetchSpotifyApi(
      credentials,
      `/search?${new URLSearchParams({ q: query, type: "track", limit: "5" })}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) {
      logger.warn("[spotify/dj-mari] track search failed for %s - %s (%d)", desired.title, desired.artist, res.status);
      continue;
    }
    const data = (await res.json()) as {
      tracks?: {
        items?: Array<{
          uri?: string;
          name?: string;
          artists?: Array<{ name?: string }>;
          album?: { name?: string };
        }>;
      };
    };
    for (const track of data.tracks?.items ?? []) {
      if (!track.uri?.startsWith("spotify:track:")) continue;
      candidatesByUri.set(track.uri, {
        uri: track.uri,
        name: track.name || "Unknown track",
        artist:
          (track.artists ?? [])
            .map((artist) => artist.name)
            .filter(Boolean)
            .join(", ") || "Unknown artist",
        album: track.album?.name ?? null,
      });
    }

    const bestMatch = Array.from(candidatesByUri.values())
      .filter((track) => isStrongSpotifyMatch(track, desired))
      .sort((a, b) => scoreSpotifyMatch(b, desired).score - scoreSpotifyMatch(a, desired).score)[0];
    if (bestMatch) return bestMatch;
  }

  return null;
}

async function matchGeneratedTracks(
  credentials: SpotifyCredentialsResult,
  generated: GeneratedTrack[],
  likedFallbacks: SpotifyTrack[],
): Promise<MatchedTrack[]> {
  const matched: MatchedTrack[] = [];
  const seenUris = new Set<string>();
  const searchBatchSize = 5;

  for (let index = 0; index < generated.length && matched.length < DJ_MARI_MAX_TRACKS; index += searchBatchSize) {
    const batch = generated.slice(index, index + searchBatchSize);
    const results = await Promise.all(
      batch.map(async (desired) => ({ desired, match: await searchSpotifyTrack(credentials, desired) })),
    );
    for (const { desired, match } of results) {
      if (!match || seenUris.has(match.uri)) continue;
      seenUris.add(match.uri);
      matched.push({
        ...match,
        requestedTitle: desired.title,
        requestedArtist: desired.artist,
        reason: desired.reason,
      });
      if (matched.length >= DJ_MARI_MAX_TRACKS) break;
    }
  }

  for (const liked of likedFallbacks) {
    if (matched.length >= DJ_MARI_MIN_TRACKS) break;
    if (seenUris.has(liked.uri)) continue;
    seenUris.add(liked.uri);
    matched.push({
      ...liked,
      requestedTitle: liked.name,
      requestedArtist: liked.artist,
      reason: "Fallback from the user's Liked Songs to keep the playlist full.",
    });
  }

  return matched.slice(0, DJ_MARI_MAX_TRACKS);
}

async function resolveProviderConnection(db: DB) {
  const agents = createAgentsStorage(db);
  const connections = createConnectionsStorage(db);
  const spotifyAgent = await agents.getByType("spotify");
  const connId = spotifyAgent?.connectionId ?? null;
  const conn = connId ? await connections.getWithKey(connId) : await connections.getDefaultForAgents();
  if (!conn) {
    fail(400, "Configure a model connection for the Spotify DJ agent, or set a default agent connection.");
  }

  let baseUrl = conn.baseUrl;
  if (!baseUrl) {
    const provider = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
    baseUrl = provider?.defaultBaseUrl ?? "";
  }
  if (!baseUrl && conn.provider === "claude_subscription") baseUrl = "claude-agent-sdk://local";
  if (!baseUrl) fail(400, "The selected model connection has no base URL configured.");

  return { conn, baseUrl };
}

function summarizeMetadata(chat: ChatRow): Record<string, unknown> {
  const meta = parseJsonObject(chat.metadata);
  const out: Record<string, unknown> = {};
  for (const key of ["summary", "tags", "gameActiveState", "gameStoryArc", "gameSpotifySourceType"]) {
    if (meta[key] !== undefined && meta[key] !== null && meta[key] !== "") out[key] = meta[key];
  }
  const setup = parseJsonObject(meta.gameSetupConfig);
  for (const key of ["setting", "genre", "tone", "premise", "playerGoals", "additionalPreferences"]) {
    if (setup[key] !== undefined && setup[key] !== null && setup[key] !== "") out[`setup.${key}`] = setup[key];
  }
  return out;
}

async function resolveMostRecentPersona(
  chats: ChatRow[],
  charactersStorage: ReturnType<typeof createCharactersStorage>,
): Promise<PersonaRow | null> {
  for (const chat of chats) {
    if (!chat.personaId) continue;
    const persona = await charactersStorage.getPersona(chat.personaId);
    if (persona) return persona;
  }

  const personas = await charactersStorage.listPersonas();
  return personas.find((persona) => persona.isActive === "true") ?? personas[0] ?? null;
}

async function buildRecentChatContext(args: {
  chats: ChatRow[];
  chatsStorage: ReturnType<typeof createChatsStorage>;
  characterNames: Map<string, string>;
  personaName: string | null;
}) {
  const modes = ["conversation", "roleplay", "game"] as const;
  const contexts = [];

  for (const mode of modes) {
    const chat = args.chats.find((candidate) => candidate.mode === mode);
    if (!chat) continue;
    const messages = await args.chatsStorage.listMessagesPaginated(chat.id, RECENT_CHAT_MESSAGE_LIMIT);
    contexts.push({
      mode,
      chatName: chat.name,
      updatedAt: chat.updatedAt,
      characterNames: parseStringArray(chat.characterIds)
        .map((id) => args.characterNames.get(id) ?? id)
        .filter(Boolean),
      context: summarizeMetadata(chat),
      latestMessages: messages.map((message: MessageRow) => ({
        role: message.role,
        speaker:
          message.characterId && args.characterNames.has(message.characterId)
            ? args.characterNames.get(message.characterId)
            : message.role === "user"
              ? (args.personaName ?? "User")
              : message.role,
        text: clampText(message.content, 900),
      })),
    });
  }

  return contexts;
}

function findMostUsedCharacter(chats: ChatRow[], characters: ReturnType<typeof parseCharacter>[]) {
  const counts = new Map<string, number>();
  for (const chat of chats) {
    for (const id of parseStringArray(chat.characterIds)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const [id] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!id) return null;
  const character = characters.find((candidate) => candidate.id === id);
  if (!character) return null;
  return {
    name: character.name,
    description: clampText(character.description, 1200),
    personality: clampText(character.personality, 800),
    chatCount: counts.get(id) ?? 0,
  };
}

async function buildDjMariContext(db: DB, credentials: SpotifyCredentialsResult) {
  const chatsStorage = createChatsStorage(db);
  const charactersStorage = createCharactersStorage(db);
  const [chats, characterRows, likedSongs] = await Promise.all([
    chatsStorage.list(),
    charactersStorage.list(),
    fetchLikedSongExamples(credentials),
  ]);
  const characters = characterRows.map(parseCharacter);
  const characterNames = new Map(characters.map((character) => [character.id, character.name]));
  const persona = await resolveMostRecentPersona(chats, charactersStorage);
  const recentChats = await buildRecentChatContext({
    chats,
    chatsStorage,
    characterNames,
    personaName: persona?.name ?? null,
  });

  return {
    persona: persona
      ? {
          name: persona.name,
          description: clampText(persona.description ?? "", 1600),
          personality: clampText(persona.personality ?? "", 900),
          appearance: clampText(persona.appearance ?? "", 700),
        }
      : null,
    characterNames: characters.map((character) => character.name),
    recentChats,
    likedSongExamples: likedSongs.map((song) => ({
      name: song.name,
      artist: song.artist,
      album: song.album,
    })),
    mostUsedCharacter: findMostUsedCharacter(chats, characters),
    likedSongs,
  };
}

async function generatePlaylistPlan(args: {
  db: DB;
  context: Awaited<ReturnType<typeof buildDjMariContext>>;
  playlistName: string;
}): Promise<GeneratedTrack[]> {
  const { conn, baseUrl } = await resolveProviderConnection(args.db);
  const effectiveMaxContext = Math.max(DJ_MARI_CONTEXT_TOKENS, Number(conn.maxContext ?? 0) || 0);
  const provider = createLLMProvider(
    conn.provider,
    baseUrl,
    conn.apiKey ?? "",
    effectiveMaxContext,
    conn.openrouterProvider,
    conn.maxTokensOverride,
    conn.claudeFastMode === "true",
  );

  const userContext = {
    playlistName: args.playlistName,
    desiredTrackCount: `${DJ_MARI_MIN_TRACKS}-${DJ_MARI_MAX_TRACKS}`,
    persona: args.context.persona,
    characterNames: args.context.characterNames,
    recentChats: args.context.recentChats,
    likedSongExamples: args.context.likedSongExamples,
    optionalSuggestionSeed: args.context.mostUsedCharacter,
  };

  const result = await provider.chatComplete(
    [
      {
        role: "system",
        content: [
          "You are DJ Mari, a taste-aware Spotify playlist curator for Marinara Engine.",
          "Compose a private Spotify playlist for the user from their persona, characters, freshest chat context, and liked-song taste samples.",
          "Pick 25-50 specific real songs that are likely to exist in Spotify's catalogue. Prefer strong emotional fit, roleplay/game atmosphere, repeat-listening value, and a coherent flow.",
          "Do not include podcasts, local files, playlists, albums, duplicate songs, or fictional track names.",
          'Return strict JSON only: {"tracks":[{"title":"Song title","artist":"Primary artist","reason":"short reason"}]}.',
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(userContext),
        contextKind: "prompt",
      },
    ],
    {
      model: conn.model,
      temperature: 0.75,
      maxTokens: DJ_MARI_OUTPUT_TOKENS,
      maxContext: effectiveMaxContext,
      stream: true,
    },
  );

  let tracks: GeneratedTrack[] = [];
  try {
    tracks = parseGeneratedTracks(result.content ?? "");
  } catch (err) {
    logger.warn(err, "[spotify/dj-mari] Failed to parse playlist JSON");
    fail(502, "DJ Mari returned a playlist plan that could not be parsed.");
  }
  if (tracks.length === 0) {
    fail(502, "DJ Mari returned no usable tracks.");
  }
  return tracks;
}

async function createSpotifyPlaylist(
  credentials: SpotifyCredentialsResult,
  name: string,
  tracks: MatchedTrack[],
): Promise<
  Omit<DjMariPlaylistResult, "success" | "requestedTrackCount" | "tracks" | "playbackStarted" | "playbackError">
> {
  const playlistRes = await fetchSpotifyApi(credentials, "/me/playlists", {
    method: "POST",
    body: JSON.stringify({
      name,
      public: false,
      collaborative: false,
      description: "Created by DJ Mari in Marinara Engine.",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!playlistRes.ok) {
    fail(
      playlistRes.status,
      `Spotify playlist creation failed: ${await readSpotifyError(playlistRes, "Could not create playlist.")}`,
    );
  }
  const playlist = (await playlistRes.json()) as {
    id?: string;
    uri?: string;
    external_urls?: { spotify?: string };
  };
  if (!playlist.id || !playlist.uri) fail(502, "Spotify playlist creation returned an incomplete response.");

  const uris = tracks.map((track) => track.uri);
  const addRes = await fetchSpotifyApi(credentials, `/playlists/${encodeURIComponent(playlist.id)}/items`, {
    method: "POST",
    body: JSON.stringify({ uris }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!addRes.ok) {
    fail(addRes.status, `Spotify add tracks failed: ${await readSpotifyError(addRes, "Could not add tracks.")}`);
  }

  return {
    name,
    playlistId: playlist.id,
    playlistUri: playlist.uri,
    playlistUrl: playlist.external_urls?.spotify ?? null,
    trackCount: tracks.length,
  };
}

async function startSpotifyPlaylistPlayback(args: {
  credentials: SpotifyCredentialsResult;
  playlistUri: string;
  deviceId?: string | null;
}): Promise<{ started: boolean; error?: string | null }> {
  const deviceId = typeof args.deviceId === "string" && args.deviceId.trim() ? args.deviceId.trim() : null;

  if (deviceId) {
    const transferRes = await fetchSpotifyApi(args.credentials, "/me/player", {
      method: "PUT",
      body: JSON.stringify({ device_ids: [deviceId], play: false }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!transferRes.ok && transferRes.status !== 204) {
      logger.debug(
        "[spotify/dj-mari] Device transfer before playlist playback failed (%d): %s",
        transferRes.status,
        await readSpotifyError(transferRes, "Spotify transfer failed."),
      );
    }
  }

  const query = deviceId ? `?${new URLSearchParams({ device_id: deviceId })}` : "";
  const playRes = await fetchSpotifyApi(args.credentials, `/me/player/play${query}`, {
    method: "PUT",
    body: JSON.stringify({ context_uri: args.playlistUri }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!playRes.ok && playRes.status !== 204) {
    return {
      started: false,
      error: await readSpotifyError(playRes, "Spotify could not start the new playlist."),
    };
  }

  return { started: true, error: null };
}

export async function composeDjMariPlaylist(args: {
  db: DB;
  credentials: SpotifyCredentialsResult;
  deviceId?: string | null;
}): Promise<DjMariPlaylistResult> {
  const playlistName = `DJ Mari ${todayLabel()}`;
  const context = await buildDjMariContext(args.db, args.credentials);
  const generatedTracks = await generatePlaylistPlan({ db: args.db, context, playlistName });
  const matchedTracks = await matchGeneratedTracks(args.credentials, generatedTracks, context.likedSongs);

  if (matchedTracks.length < DJ_MARI_MIN_TRACKS) {
    fail(
      502,
      `DJ Mari only matched ${matchedTracks.length} Spotify tracks. Need at least ${DJ_MARI_MIN_TRACKS}; try again after adding more Liked Songs or using a broader model prompt.`,
    );
  }

  const playlist = await createSpotifyPlaylist(args.credentials, playlistName, matchedTracks);
  const playback = await startSpotifyPlaylistPlayback({
    credentials: args.credentials,
    playlistUri: playlist.playlistUri,
    deviceId: args.deviceId,
  });
  return {
    success: true,
    ...playlist,
    requestedTrackCount: generatedTracks.length,
    playbackStarted: playback.started,
    playbackError: playback.error ?? null,
    tracks: matchedTracks,
  };
}
