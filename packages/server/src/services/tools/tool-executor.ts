// ──────────────────────────────────────────────
// Tool Executor — Handles built-in + custom function calls
// ──────────────────────────────────────────────
import type { LLMToolCall } from "../llm/base-provider.js";
import vm from "node:vm";

export interface ToolExecutionResult {
  toolCallId: string;
  name: string;
  result: string;
  success: boolean;
}

/** A custom tool loaded from DB at execution time. */
export interface CustomToolDef {
  name: string;
  executionType: string;
  webhookUrl: string | null;
  staticResult: string | null;
  scriptBody: string | null;
}

/** Lorebook search function injected from the route layer. */
export type LorebookSearchFn = (
  query: string,
  category?: string | null,
) => Promise<Array<{ name: string; content: string; tag: string; keys: string[] }>>;

/** Spotify API credentials injected from the route layer. */
export interface SpotifyCredentials {
  accessToken: string;
}

export interface ToolExecutionContext {
  gameState?: Record<string, unknown>;
  customTools?: CustomToolDef[];
  searchLorebook?: LorebookSearchFn;
  spotify?: SpotifyCredentials;
}

/**
 * Execute a batch of tool calls, returning results for each.
 * Supports built-in tools and user-defined custom tools.
 */
export async function executeToolCalls(
  toolCalls: LLMToolCall[],
  context?: ToolExecutionContext,
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];

  for (const call of toolCalls) {
    try {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        args = {};
      }

      const result = await executeSingleTool(call.function.name, args, context);
      results.push({
        toolCallId: call.id,
        name: call.function.name,
        result: typeof result === "string" ? result : JSON.stringify(result),
        success: true,
      });
    } catch (err) {
      results.push({
        toolCallId: call.id,
        name: call.function.name,
        result: err instanceof Error ? err.message : "Tool execution failed",
        success: false,
      });
    }
  }

  return results;
}

async function executeSingleTool(
  name: string,
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<unknown> {
  switch (name) {
    case "roll_dice":
      return rollDice(args);
    case "update_game_state":
      return updateGameState(args, context?.gameState);
    case "set_expression":
      return setExpression(args);
    case "trigger_event":
      return triggerEvent(args);
    case "search_lorebook":
      return searchLorebook(args, context?.searchLorebook);
    case "spotify_get_playlists":
      return spotifyGetPlaylists(args, context?.spotify);
    case "spotify_get_playlist_tracks":
      return spotifyGetPlaylistTracks(args, context?.spotify);
    case "spotify_search":
      return spotifySearch(args, context?.spotify);
    case "spotify_play":
      return spotifyPlay(args, context?.spotify);
    case "spotify_set_volume":
      return spotifySetVolume(args, context?.spotify);
    default: {
      // Try custom tools
      const custom = context?.customTools?.find((t) => t.name === name);
      if (custom) return executeCustomTool(custom, args);
      return {
        error: `Unknown tool: ${name}`,
        available: ["roll_dice", "update_game_state", "set_expression", "trigger_event", "search_lorebook"],
      };
    }
  }
}

// ── Custom Tool Execution ──

async function executeCustomTool(tool: CustomToolDef, args: Record<string, unknown>): Promise<unknown> {
  switch (tool.executionType) {
    case "static":
      return { result: tool.staticResult ?? "OK", tool: tool.name, args };

    case "webhook": {
      if (!tool.webhookUrl) return { error: "No webhook URL configured" };
      try {
        const res = await fetch(tool.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: tool.name, arguments: args }),
          signal: AbortSignal.timeout(10_000),
        });
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          return { result: text };
        }
      } catch (err) {
        return { error: `Webhook call failed: ${err instanceof Error ? err.message : "unknown"}` };
      }
    }

    case "script": {
      if (!tool.scriptBody) return { error: "No script body configured" };
      try {
        // Sandboxed execution using vm.runInNewContext
        // The script only has access to the explicitly provided sandbox objects
        const sandbox = {
          args,
          JSON: { parse: JSON.parse, stringify: JSON.stringify },
          Math,
          String,
          Number,
          Date,
          Array,
          parseInt,
          parseFloat,
          isNaN,
          isFinite,
          console: { log: () => {} },
        };
        const result = vm.runInNewContext(`"use strict"; (function() { ${tool.scriptBody} })()`, sandbox, {
          timeout: 5000,
          breakOnSigint: true,
        });
        return result ?? { result: "OK" };
      } catch (err) {
        return { error: `Script error: ${err instanceof Error ? err.message : "unknown"}` };
      }
    }

    default:
      return { error: `Unknown execution type: ${tool.executionType}` };
  }
}

// ── Built-in Tool Implementations ──

function rollDice(args: Record<string, unknown>): Record<string, unknown> {
  const notation = String(args.notation ?? "1d6");
  const reason = String(args.reason ?? "");

  // Parse notation: NdS+M or NdS-M
  const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) {
    return { error: `Invalid dice notation: ${notation}`, hint: "Use format like 2d6, 1d20+5, 3d8-2" };
  }

  const count = parseInt(match[1]!, 10);
  const sides = parseInt(match[2]!, 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  if (count < 1 || count > 100 || sides < 2 || sides > 1000) {
    return { error: "Dice values out of range (1-100 dice, 2-1000 sides)" };
  }

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + modifier;

  return {
    notation,
    rolls,
    sum,
    modifier,
    total,
    reason,
    display: `🎲 ${notation}${reason ? ` (${reason})` : ""}: [${rolls.join(", ")}]${modifier ? ` ${modifier > 0 ? "+" : ""}${modifier}` : ""} = **${total}**`,
  };
}

function updateGameState(args: Record<string, unknown>, _gameState?: Record<string, unknown>): Record<string, unknown> {
  // Returns the update instruction — the client/agent pipeline applies it
  return {
    applied: true,
    update: {
      type: args.type,
      target: args.target,
      key: args.key,
      value: args.value,
      description: args.description ?? "",
    },
    display: `📊 ${args.type}: ${args.target} — ${args.key} → ${args.value}`,
  };
}

function setExpression(args: Record<string, unknown>): Record<string, unknown> {
  return {
    applied: true,
    characterName: args.characterName,
    expression: args.expression,
    display: `🎭 ${args.characterName}: expression → ${args.expression}`,
  };
}

function triggerEvent(args: Record<string, unknown>): Record<string, unknown> {
  return {
    applied: true,
    eventType: args.eventType,
    description: args.description,
    involvedCharacters: args.involvedCharacters ?? [],
    display: `⚡ Event (${args.eventType}): ${args.description}`,
  };
}

async function searchLorebook(
  args: Record<string, unknown>,
  searchFn?: LorebookSearchFn,
): Promise<Record<string, unknown>> {
  const query = String(args.query ?? "");
  const category = args.category ? String(args.category) : null;

  if (!searchFn) {
    return {
      query,
      category,
      results: [],
      note: "Lorebook search is not available in this context.",
    };
  }

  const results = await searchFn(query, category);
  return {
    query,
    category,
    results,
    count: results.length,
  };
}

// ── Spotify Tool Implementations ──

async function spotifyGetPlaylists(
  args: Record<string, unknown>,
  creds?: SpotifyCredentials,
): Promise<Record<string, unknown>> {
  if (!creds?.accessToken) {
    return { error: "Spotify not configured. Please add your Spotify access token in the Spotify DJ agent settings." };
  }
  const limit = Math.min(Number(args.limit ?? 20), 50);

  try {
    const res = await fetch(
      `https://api.spotify.com/v1/me/playlists?${new URLSearchParams({ limit: String(limit) })}`,
      {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return { error: `Spotify API error (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      items?: Array<{ id: string; name: string; uri: string; tracks: { total: number }; description: string }>;
    };
    const playlists = (data.items ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      uri: p.uri,
      trackCount: p.tracks.total,
      description: (p.description || "").slice(0, 100),
    }));
    return {
      playlists,
      count: playlists.length,
      hint: "Use spotify_get_playlist_tracks with a playlist ID to browse tracks, or use playlistId='liked' for Liked Songs.",
    };
  } catch (err) {
    return { error: `Spotify playlists failed: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

async function spotifyGetPlaylistTracks(
  args: Record<string, unknown>,
  creds?: SpotifyCredentials,
): Promise<Record<string, unknown>> {
  if (!creds?.accessToken) {
    return { error: "Spotify not configured. Please add your Spotify access token in the Spotify DJ agent settings." };
  }
  const playlistId = String(args.playlistId ?? "");

  if (!playlistId) {
    return {
      error: "playlistId is required. Use 'liked' for Liked Songs, or a playlist ID from spotify_get_playlists.",
    };
  }

  try {
    // Liked Songs: auto-paginate to fetch the full library
    if (playlistId === "liked") {
      const allTracks: Array<{ uri: string; name: string; artist: string; album: string }> = [];
      let offset = 0;
      const batchSize = 50;
      const MAX_LIKED = 500; // Safety cap to avoid overwhelming LLM context

      while (offset < MAX_LIKED) {
        const url = `https://api.spotify.com/v1/me/tracks?${new URLSearchParams({ limit: String(batchSize), offset: String(offset) })}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${creds.accessToken}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const body = await res.text();
          return { error: `Spotify API error (${res.status}): ${body.slice(0, 200)}` };
        }
        const data = (await res.json()) as {
          items?: Array<{
            track: { uri: string; name: string; artists: Array<{ name: string }>; album: { name: string } };
          }>;
          total?: number;
          next?: string | null;
        };
        const batch = (data.items ?? [])
          .filter((item) => item.track)
          .map((item) => ({
            uri: item.track.uri,
            name: item.track.name,
            artist: item.track.artists.map((a) => a.name).join(", "),
            album: item.track.album.name,
          }));
        allTracks.push(...batch);

        // Stop if we've fetched everything or there are no more pages
        if (!data.next || batch.length < batchSize) break;
        offset += batchSize;
      }

      return {
        playlistId: "liked",
        tracks: allTracks,
        count: allTracks.length,
        total: allTracks.length,
        offset: 0,
      };
    }

    // Regular playlists: paginated as before
    const limit = Math.min(Number(args.limit ?? 30), 50);
    const offset = Math.max(0, Number(args.offset ?? 0));
    const url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text();
      return { error: `Spotify API error (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      items?: Array<{
        track: { uri: string; name: string; artists: Array<{ name: string }>; album: { name: string } };
      }>;
      total?: number;
    };
    const tracks = (data.items ?? [])
      .filter((item) => item.track)
      .map((item) => ({
        uri: item.track.uri,
        name: item.track.name,
        artist: item.track.artists.map((a) => a.name).join(", "),
        album: item.track.album.name,
      }));
    return {
      playlistId,
      tracks,
      count: tracks.length,
      total: data.total ?? tracks.length,
      offset,
    };
  } catch (err) {
    return { error: `Spotify playlist tracks failed: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

async function spotifySearch(
  args: Record<string, unknown>,
  creds?: SpotifyCredentials,
): Promise<Record<string, unknown>> {
  if (!creds?.accessToken) {
    return { error: "Spotify not configured. Please add your Spotify access token in the Spotify DJ agent settings." };
  }
  const query = String(args.query ?? "");
  const limit = Math.min(Number(args.limit ?? 5), 20);

  try {
    const res = await fetch(
      `https://api.spotify.com/v1/search?${new URLSearchParams({ q: query, type: "track", limit: String(limit) })}`,
      {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return { error: `Spotify API error (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      tracks?: {
        items?: Array<{ uri: string; name: string; artists: Array<{ name: string }>; album: { name: string } }>;
      };
    };
    const tracks = (data.tracks?.items ?? []).map((t) => ({
      uri: t.uri,
      name: t.name,
      artist: t.artists.map((a) => a.name).join(", "),
      album: t.album.name,
    }));
    return { query, tracks, count: tracks.length };
  } catch (err) {
    return { error: `Spotify search failed: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

async function spotifyPlay(
  args: Record<string, unknown>,
  creds?: SpotifyCredentials,
): Promise<Record<string, unknown>> {
  if (!creds?.accessToken) {
    return { error: "Spotify not configured. Please add your Spotify access token in the Spotify DJ agent settings." };
  }
  const reason = String(args.reason ?? "");

  // Support both single `uri` and array `uris`
  let uris: string[] = [];
  if (Array.isArray(args.uris)) {
    uris = (args.uris as string[]).filter((u) => typeof u === "string" && u.startsWith("spotify:"));
  }
  if (args.uri && typeof args.uri === "string" && args.uri.startsWith("spotify:")) {
    // If single uri is provided, prepend it (avoid duplicates)
    if (!uris.includes(args.uri)) uris.unshift(args.uri);
  }
  if (uris.length === 0) {
    return { error: "No valid Spotify URIs provided" };
  }

  try {
    // If it's a single playlist URI, use context_uri
    const firstUri = uris[0]!;
    if (uris.length === 1 && !firstUri.startsWith("spotify:track:")) {
      const body = { context_uri: firstUri };
      const res = await fetch("https://api.spotify.com/v1/me/player/play", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok && res.status !== 204) {
        const text = await res.text();
        return { error: `Spotify play failed (${res.status}): ${text.slice(0, 200)}` };
      }
      return {
        applied: true,
        uris,
        reason,
        display: `🎵 Now playing playlist: ${firstUri}${reason ? ` — ${reason}` : ""}`,
      };
    }

    // For track URIs, pass them all as a queue
    const body = { uris };
    const res = await fetch("https://api.spotify.com/v1/me/player/play", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      return { error: `Spotify play failed (${res.status}): ${text.slice(0, 200)}` };
    }
    return {
      applied: true,
      uris,
      reason,
      queued: uris.length,
      display: `🎵 Queued ${uris.length} tracks${reason ? ` — ${reason}` : ""}`,
    };
  } catch (err) {
    return { error: `Spotify play failed: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

async function spotifySetVolume(
  args: Record<string, unknown>,
  creds?: SpotifyCredentials,
): Promise<Record<string, unknown>> {
  if (!creds?.accessToken) {
    return { error: "Spotify not configured. Please add your Spotify access token in the Spotify DJ agent settings." };
  }
  const volume = Math.max(0, Math.min(100, Number(args.volume ?? 50)));
  const reason = String(args.reason ?? "");

  try {
    const res = await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${volume}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      return { error: `Spotify volume failed (${res.status}): ${text.slice(0, 200)}` };
    }
    return { applied: true, volume, reason, display: `🔊 Volume → ${volume}%${reason ? ` (${reason})` : ""}` };
  } catch (err) {
    return { error: `Spotify volume failed: ${err instanceof Error ? err.message : "unknown"}` };
  }
}
