// ──────────────────────────────────────────────
// Routes: Browser — Pygmalion provider
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";
import { safeFetch } from "../utils/security.js";

const PYGMALION_API_BASE = "https://server.pygmalion.chat/galatea.v1.PublicCharacterService";
const PYGMALION_ORIGIN = "https://pygmalion.chat";
const PYGMALION_ASSETS_BASE = "https://assets.pygmalion.chat";

// In-memory token store (persists until server restart)
let pygToken: string = "";

export async function botBrowserPygmalionRoutes(app: FastifyInstance) {
  // ── Store token directly (user pastes their auth token) ──
  app.post<{ Body: { token: string } }>("/pygmalion/set-token", async (req, reply) => {
    const { token } = req.body ?? {};
    if (!token || typeof token !== "string" || !token.trim()) {
      return reply.status(400).send({ error: "token string is required" });
    }

    let value = token.trim();

    // Normalize: strip "Bearer " prefix if pasted with it
    if (value.toLowerCase().startsWith("bearer ")) {
      value = value.slice("bearer ".length).trim();
    }

    if (value.length > 8192 || value.includes(" ") || value.includes("\n")) {
      return reply.status(400).send({ error: "Invalid token value. Paste only the token string." });
    }

    pygToken = value;
    logger.info("[bot-browser] Pygmalion token stored");
    return { ok: true };
  });

  // ── Validate stored token by making a test authenticated search ──
  app.get("/pygmalion/validate", async () => {
    if (!pygToken) {
      return { valid: false, reason: "no token stored" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${PYGMALION_API_BASE}/CharacterSearch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${pygToken}`,
          Origin: PYGMALION_ORIGIN,
          Referer: `${PYGMALION_ORIGIN}/`,
        },
        body: JSON.stringify({
          query: "",
          orderBy: "downloads",
          orderDescending: true,
          pageSize: 1,
          page: 0,
          includeSensitive: true,
        }),
        signal: controller.signal,
      });

      if (res.ok) {
        logger.info("[bot-browser] Pygmalion token validated");
        return { valid: true };
      }

      if (res.status === 401 || res.status === 403) {
        pygToken = "";
        return { valid: false, reason: "Token rejected (expired or invalid)" };
      }

      return { valid: false, reason: `HTTP ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { valid: false, reason: msg };
    } finally {
      clearTimeout(timeout);
    }
  });

  // ── Logout (clear stored token) ──
  app.post("/pygmalion/logout", async () => {
    pygToken = "";
    logger.info("[bot-browser] Pygmalion token cleared");
    return { ok: true };
  });

  // ── Check session status ──
  app.get("/pygmalion/session", async () => {
    return { active: !!pygToken, hasToken: !!pygToken };
  });

  // ── Search characters on Pygmalion via Connect RPC ──
  app.get<{
    Querystring: {
      q?: string;
      page?: string;
      pageSize?: string;
      orderBy?: string;
      orderDescending?: string;
      tagsInclude?: string;
      tagsExclude?: string;
      includeSensitive?: string;
    };
  }>("/pygmalion/search", async (req) => {
    const {
      q = "",
      page = "0",
      pageSize = "48",
      orderBy = "downloads",
      orderDescending = "true",
      tagsInclude,
      tagsExclude,
      includeSensitive = "false",
    } = req.query;

    const message: Record<string, unknown> = {
      query: q,
      orderBy,
      orderDescending: orderDescending === "true",
      pageSize: parseInt(pageSize) || 48,
      page: parseInt(page) || 0,
    };

    if (tagsInclude) {
      message.tagsNamesInclude = tagsInclude
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
    if (tagsExclude) {
      message.tagsNamesExclude = tagsExclude
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }

    // Authenticated search with NSFW
    if (includeSensitive === "true" && pygToken) {
      message.includeSensitive = true;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch(`${PYGMALION_API_BASE}/CharacterSearch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${pygToken}`,
          },
          body: JSON.stringify(message),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Pygmalion search error ${res.status}`);
        return res.json();
      } finally {
        clearTimeout(timeout);
      }
    }

    // Unauthenticated GET — public SFW results only
    const params = new URLSearchParams({
      connect: "v1",
      encoding: "json",
      message: JSON.stringify(message),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${PYGMALION_API_BASE}/CharacterSearch?${params}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Pygmalion search error ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  });

  // ── Get full character detail from Pygmalion ──
  app.get<{
    Querystring: {
      id: string;
      versionId?: string;
    };
  }>("/pygmalion/character", async (req) => {
    const { id, versionId } = req.query;
    if (!id) throw new Error("Missing character id");

    const message: Record<string, unknown> = { characterMetaId: id };
    if (versionId) message.characterVersionId = versionId;

    // Authenticated detail fetch (needed for NSFW characters)
    if (pygToken) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch(`${PYGMALION_API_BASE}/Character`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${pygToken}`,
          },
          body: JSON.stringify(message),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Pygmalion character fetch error ${res.status}`);
        return res.json();
      } finally {
        clearTimeout(timeout);
      }
    }

    const params = new URLSearchParams({
      connect: "v1",
      encoding: "json",
      message: JSON.stringify(message),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${PYGMALION_API_BASE}/Character?${params}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Pygmalion character fetch error ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  });

  // ── Proxy Pygmalion avatar images ──
  app.get<{ Params: { "*": string } }>("/pygmalion/avatar/*", async (req, reply) => {
    const assetPath = (req.params as Record<string, string>)["*"];
    if (!assetPath) throw new Error("Missing asset path");

    const url = assetPath.startsWith("http") ? assetPath : `${PYGMALION_ASSETS_BASE}/${assetPath}`;

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
