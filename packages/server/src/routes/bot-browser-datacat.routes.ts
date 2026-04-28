// ──────────────────────────────────────────────
// Routes: Browser — DataCat provider
// (Aggregator that surfaces JanitorAI characters via datacat.run REST API,
// using JanitorAI's bot-avatar CDN for images.)
// ──────────────────────────────────────────────
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";

const DATACAT_API_BASE = "https://datacat.run";
const DATACAT_IMAGE_BASE = "https://ella.janitorai.com/bot-avatars/";
const DEFAULT_MIN_TOTAL_TOKENS = 889;
const DC_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let dcSessionToken: string = "";
let inFlightInit: Promise<string> | null = null;

async function mintSessionToken(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${DATACAT_API_BASE}/api/liberator/identify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": DC_USER_AGENT,
        Origin: DATACAT_API_BASE,
        Referer: `${DATACAT_API_BASE}/`,
      },
      body: JSON.stringify({ deviceToken: randomUUID() }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`liberator/identify ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { success?: boolean; sessionToken?: string };
    if (!data?.success || !data?.sessionToken) {
      throw new Error("liberator/identify response missing sessionToken");
    }
    logger.info("[bot-browser] DataCat session minted");
    return data.sessionToken;
  } finally {
    clearTimeout(timeout);
  }
}

async function getSessionToken(): Promise<string> {
  if (dcSessionToken) return dcSessionToken;
  if (inFlightInit) return inFlightInit;
  inFlightInit = mintSessionToken()
    .then((t) => {
      dcSessionToken = t;
      inFlightInit = null;
      return t;
    })
    .catch((err) => {
      inFlightInit = null;
      throw err;
    });
  return inFlightInit;
}

function dcHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": DC_USER_AGENT,
    Origin: DATACAT_API_BASE,
    Referer: `${DATACAT_API_BASE}/`,
    "X-Session-Token": token,
  };
}

async function dcFetch(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    let token = await getSessionToken();
    let res = await fetch(`${DATACAT_API_BASE}${path}`, {
      headers: dcHeaders(token),
      signal: controller.signal,
    });
    // Token may have expired — re-mint once and retry
    if (res.status === 401) {
      dcSessionToken = "";
      token = await getSessionToken();
      res = await fetch(`${DATACAT_API_BASE}${path}`, {
        headers: dcHeaders(token),
        signal: controller.signal,
      });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upstream ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function botBrowserDatacatRoutes(app: FastifyInstance) {
  // ── Recent public browse / tag-filtered browse ──
  app.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      min_tokens?: string;
      tagIds?: string;
    };
  }>("/datacat/recent", async (req) => {
    const {
      limit = "80",
      offset = "0",
      min_tokens = String(DEFAULT_MIN_TOTAL_TOKENS),
      tagIds,
    } = req.query;
    const params = new URLSearchParams();
    params.set("limit", limit);
    params.set("offset", offset);
    params.set("summary", "1");
    params.set("minTotalTokens", min_tokens);
    if (tagIds) {
      const ids = tagIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length > 0) params.set("tagIds", ids.join(","));
    }
    return dcFetch(`/api/characters/recent-public?${params}`);
  });

  // ── Trending (24h + week buckets) ──
  app.get<{
    Querystring: {
      sortBy?: string;
      limit24?: string;
      limitWeek?: string;
    };
  }>("/datacat/fresh", async (req) => {
    const { sortBy = "score", limit24 = "80", limitWeek = "20" } = req.query;
    const params = new URLSearchParams({ summary: "1", sortBy, limit24, limitWeek });
    return dcFetch(`/api/characters/fresh?${params}`);
  });

  // ── Faceted tags ──
  app.get<{
    Querystring: {
      min_tokens?: string;
      activeTagIds?: string;
    };
  }>("/datacat/tags", async (req) => {
    const { min_tokens = String(DEFAULT_MIN_TOTAL_TOKENS), activeTagIds } = req.query;
    const params = new URLSearchParams();
    params.set("mode", "recent");
    params.set("minTotalTokens", min_tokens);
    if (activeTagIds) {
      const ids = activeTagIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length > 0) params.set("activeTagIds", ids.join(","));
    }
    return dcFetch(`/api/tags/faceted?${params}`);
  });

  // ── Character detail ──
  app.get<{ Params: { id: string } }>("/datacat/character/:id", async (req) => {
    const { id } = req.params;
    if (!id) throw new Error("Missing character id");
    return dcFetch(`/api/characters/${encodeURIComponent(id)}`);
  });

  // ── Character download (V2 card payload) ──
  app.get<{ Params: { id: string } }>("/datacat/download/:id", async (req) => {
    const { id } = req.params;
    if (!id) throw new Error("Missing character id");
    return dcFetch(`/api/characters/${encodeURIComponent(id)}/download?t=${Date.now()}`);
  });

  // ── Creator profile ──
  app.get<{ Params: { id: string } }>("/datacat/creator/:id", async (req) => {
    const { id } = req.params;
    if (!id) throw new Error("Missing creator id");
    return dcFetch(`/api/creators/${encodeURIComponent(id)}`);
  });

  // ── Characters by creator ──
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; offset?: string; sortBy?: string };
  }>("/datacat/creator/:id/characters", async (req) => {
    const { id } = req.params;
    if (!id) throw new Error("Missing creator id");
    const { limit = "24", offset = "0", sortBy = "chat_count" } = req.query;
    const params = new URLSearchParams({ limit, offset, sortBy });
    return dcFetch(`/api/creators/${encodeURIComponent(id)}/characters?${params}`);
  });

  // ── Proxy DataCat avatar images (served from JanitorAI CDN) ──
  app.get<{ Params: { "*": string } }>("/datacat/avatar/*", async (req, reply) => {
    const path = (req.params as Record<string, string>)["*"];
    if (!path) throw new Error("Missing avatar path");

    // Whitelist the upstream avatar host. Without this, an absolute URL in `path`
    // would let `/datacat/avatar/*` proxy to any address (SSRF — internal services,
    // metadata endpoints, etc.).
    let url: string;
    if (path.startsWith("http")) {
      let parsed: URL;
      try {
        parsed = new URL(path);
      } catch {
        return reply.status(400).send({ error: "Invalid avatar URL" });
      }
      if (parsed.protocol !== "https:" || parsed.hostname !== "ella.janitorai.com") {
        return reply.status(400).send({ error: "Unsupported avatar host" });
      }
      url = parsed.toString();
    } else {
      url = `${DATACAT_IMAGE_BASE}${path}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return reply.status(404).send({ error: "Avatar not found" });
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") || "image/jpeg";
      return reply.header("Content-Type", ct).header("Cache-Control", "public, max-age=86400").send(buf);
    } finally {
      clearTimeout(timeout);
    }
  });
}
