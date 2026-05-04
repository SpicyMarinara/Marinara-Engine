// ──────────────────────────────────────────────
// Routes: Browser — Wyvern provider
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { safeFetch } from "../utils/security.js";

const WYVERN_API_BASE = "https://api.wyvern.chat";
const WYVERN_IMAGE_BASE = "https://imagedelivery.net";

async function proxyFetch(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upstream ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function botBrowserWyvernRoutes(app: FastifyInstance) {
  // ── Search characters on Wyvern ──
  app.get<{
    Querystring: {
      q?: string;
      page?: string;
      limit?: string;
      sort?: string;
      order?: string;
      tags?: string;
      rating?: string;
    };
  }>("/wyvern/search", async (req) => {
    const { q = "", page = "1", limit = "48", sort = "popular", order = "DESC", tags, rating } = req.query;

    const params = new URLSearchParams();
    params.set("limit", limit);
    params.set("page", page);

    // Include tags
    if (tags) params.set("tags", tags);

    // Search query — when searching, omit sort so results are global
    if (q) {
      params.set("q", q);
    } else {
      params.set("sort", sort);
      params.set("order", order);
    }

    // Rating filter (SFW = "none", omit for all content)
    if (rating) params.set("rating", rating);

    const data = await proxyFetch(`${WYVERN_API_BASE}/exploreSearch/characters?${params}`, {
      headers: { Accept: "application/json" },
    });
    return data;
  });

  // ── Get full character detail from Wyvern ──
  app.get<{ Params: { id: string } }>("/wyvern/character/:id", async (req) => {
    const { id } = req.params;
    if (!id) throw new Error("Missing character id");
    const data = await proxyFetch(`${WYVERN_API_BASE}/characters/${id}`, {
      headers: { Accept: "application/json" },
    });
    return data;
  });

  // ── Search creators on Wyvern ──
  app.get<{
    Querystring: { q: string; page?: string; limit?: string };
  }>("/wyvern/search-users", async (req) => {
    const { q, page = "1", limit = "10" } = req.query;
    if (!q) throw new Error("Missing query");
    const params = new URLSearchParams({ q, page, limit });
    const data = await proxyFetch(`${WYVERN_API_BASE}/exploreSearch/users?${params}`, {
      headers: { Accept: "application/json" },
    });
    return data;
  });

  // ── Get characters by creator ──
  app.get<{ Params: { uid: string } }>("/wyvern/characters/user/:uid", async (req) => {
    const { uid } = req.params;
    if (!uid) throw new Error("Missing user id");
    const data = await proxyFetch(`${WYVERN_API_BASE}/characters/user/${uid}`, {
      headers: { Accept: "application/json" },
    });
    return data;
  });

  // ── Proxy Wyvern avatar images ──
  app.get<{ Params: { "*": string } }>("/wyvern/avatar/*", async (req, reply) => {
    const imgPath = (req.params as Record<string, string>)["*"];
    if (!imgPath) throw new Error("Missing image path");

    // imgPath could be a full imagedelivery.net URL or a partial path
    let url: string;
    if (imgPath.startsWith("http")) {
      url = imgPath;
    } else if (imgPath.includes("imagedelivery.net")) {
      url = `https://${imgPath}`;
    } else {
      // Assume it's an imagedelivery.net CDN ID like "Dv4koOwHQU3XnXLqtl0aVQ/uuid/public"
      url = `${WYVERN_IMAGE_BASE}/${imgPath}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await safeFetch(url, {
        signal: controller.signal,
        policy: { allowedProtocols: ["https:"] },
        allowedContentTypes: ["image/"],
        maxResponseBytes: 10 * 1024 * 1024,
      });
      if (!res.ok) return reply.status(404).send({ error: "Avatar not found" });
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") || "image/webp";
      return reply.header("Content-Type", ct).header("Cache-Control", "public, max-age=86400").send(buf);
    } finally {
      clearTimeout(timeout);
    }
  });
}
