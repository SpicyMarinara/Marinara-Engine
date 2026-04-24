// ──────────────────────────────────────────────
// Routes: Browser — CharacterTavern provider
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";

const CT_API_BASE = "https://character-tavern.com/api";
const CT_CARDS_CDN = "https://cards.character-tavern.com";

// In-memory session cookie store (persists until server restart)
let ctSessionCookie: string = "";

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

/** Build headers for CT API — includes session cookie if stored */
function ctHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
    Accept: "application/json",
  };
  if (ctSessionCookie) {
    headers["Cookie"] = ctSessionCookie;
  }
  return headers;
}

export async function botBrowserChartavernRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════
  // Cookie Auth Endpoints
  // ═══════════════════════════════════════════════

  /** Store a session cookie for authenticated requests */
  app.post<{ Body: { cookie: string } }>("/chartavern/set-cookie", async (req, reply) => {
    const { cookie } = req.body ?? {};
    if (!cookie || typeof cookie !== "string" || !cookie.trim()) {
      return reply.status(400).send({ error: "cookie string is required" });
    }

    let value = cookie.trim();

    // Normalize: accept bare value or session=VALUE
    if (value.startsWith("session=")) {
      value = value.slice("session=".length).trim();
    }

    // Reject multiple cookies or suspicious input
    if (value.includes(";") || value.length > 4096) {
      return reply.status(400).send({ error: "Invalid cookie value. Paste only the session cookie value." });
    }

    if (!value) {
      return reply.status(400).send({ error: "Empty cookie value" });
    }

    ctSessionCookie = `session=${value}`;
    logger.info("[bot-browser] CT session cookie stored");
    return { ok: true };
  });

  /** Validate stored cookie by making a test search */
  app.get("/chartavern/validate", async () => {
    if (!ctSessionCookie) {
      return { valid: false, reason: "no cookies stored" };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(`${CT_API_BASE}/search/cards?query=test&limit=5`, {
          headers: ctHeaders(),
          signal: controller.signal,
        });

        if (res.ok) {
          const data = (await res.json()) as { hits?: Array<{ isNSFW?: boolean }>; totalHits?: number };
          const hits = data?.hits || [];
          const hasNsfw = hits.some((h) => h.isNSFW === true);

          // Check if server rejected the cookie
          const setCookie = res.headers.get("set-cookie");
          const isRejected = setCookie && (setCookie.includes("session=;") || setCookie.includes("Max-Age=0"));

          if (isRejected) {
            logger.warn("[bot-browser] CT session rejected by server");
            ctSessionCookie = "";
            return { valid: false, reason: "Session rejected/expired by server" };
          }

          logger.info(`[bot-browser] CT validate: ${hits.length} hits, hasNSFW=${hasNsfw}`);
          return { valid: true, hasNsfw };
        } else if (res.status === 403) {
          ctSessionCookie = "";
          return { valid: false, reason: "rejected (cookies expired or invalid)" };
        } else {
          return { valid: false, reason: `HTTP ${res.status}` };
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return { valid: false, reason: msg };
    }
  });

  /** Clear stored session cookie */
  app.post("/chartavern/logout", async () => {
    ctSessionCookie = "";
    logger.info("[bot-browser] CT session cleared");
    return { ok: true };
  });

  /** Check if a CT session is active */
  app.get("/chartavern/session", async () => {
    return { active: !!ctSessionCookie };
  });

  // ═══════════════════════════════════════════════
  // Search & Browse Endpoints (now cookie-aware)
  // ═══════════════════════════════════════════════

  /** Search characters on CharacterTavern */
  app.get<{
    Querystring: {
      q?: string;
      page?: string;
      limit?: string;
      sort?: string;
      nsfw?: string;
      tags?: string;
      excludeTags?: string;
      min_tokens?: string;
      max_tokens?: string;
      hasLorebook?: string;
      isOC?: string;
    };
  }>("/chartavern/search", async (req) => {
    const {
      q = "",
      page = "1",
      limit = "60",
      sort = "most_popular",
      nsfw = "true",
      tags,
      excludeTags,
      min_tokens,
      max_tokens,
      hasLorebook,
      isOC,
    } = req.query;

    const params = new URLSearchParams();
    params.set("query", q);
    params.set("sort", sort);
    params.set("page", page);
    params.set("limit", limit);

    if (tags) params.set("tags", tags);

    // Build exclude tags — merge explicit excludes with nsfw tag when nsfw is off
    const excludeList: string[] = excludeTags ? excludeTags.split(",").map((t) => t.trim()) : [];
    if (nsfw !== "true" && !excludeList.includes("nsfw")) {
      excludeList.push("nsfw");
    }
    if (excludeList.length > 0) params.set("exclude_tags", excludeList.join(","));

    if (min_tokens && min_tokens !== "0") params.set("minimum_tokens", min_tokens);
    if (max_tokens && max_tokens !== "0") params.set("maximum_tokens", max_tokens);
    if (hasLorebook === "true") params.set("hasLorebook", "true");
    if (isOC === "true") params.set("isOC", "true");

    // Use cookie-aware headers for authenticated NSFW search
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${CT_API_BASE}/search/cards?${params}`, {
        headers: ctHeaders(),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Upstream ${res.status}: ${text.slice(0, 300)}`);
      }
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  });

  /** Get full character detail from CharacterTavern */
  app.get<{ Params: { author: string; slug: string } }>("/chartavern/character/:author/:slug", async (req) => {
    const { author, slug } = req.params;
    if (!author || !slug) throw new Error("Missing author or slug");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${CT_API_BASE}/character/${encodeURIComponent(author)}/${encodeURIComponent(slug)}`, {
        headers: ctHeaders(),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Upstream ${res.status}: ${text.slice(0, 300)}`);
      }
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  });

  /** Fetch top tags from CharacterTavern */
  app.get("/chartavern/top-tags", async () => {
    const data = await proxyFetch(`${CT_API_BASE}/catalog/top-tags`, {
      headers: { Accept: "application/json" },
    });
    return data;
  });

  /** Download character card PNG from CharacterTavern (for import) */
  app.get<{ Params: { "*": string } }>("/chartavern/download/*", async (req, reply) => {
    const path = (req.params as Record<string, string>)["*"];
    if (!path) throw new Error("Missing character path");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`${CT_CARDS_CDN}/${encodeURI(path)}.png`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return reply
        .header("Content-Type", "image/png")
        .header("Content-Disposition", `attachment; filename="character.png"`)
        .send(buf);
    } finally {
      clearTimeout(timeout);
    }
  });

  /** Proxy CharacterTavern avatar images */
  app.get<{ Params: { "*": string } }>("/chartavern/avatar/*", async (req, reply) => {
    const path = (req.params as Record<string, string>)["*"];
    if (!path) throw new Error("Missing avatar path");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${CT_CARDS_CDN}/cdn-cgi/image/format=auto,width=320,quality=85/${encodeURI(path)}.png`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const res2 = await fetch(`${CT_CARDS_CDN}/${encodeURI(path)}.png`, {
          signal: controller.signal,
        });
        if (!res2.ok) return reply.status(404).send({ error: "Avatar not found" });
        const buf = Buffer.from(await res2.arrayBuffer());
        return reply.header("Content-Type", "image/png").header("Cache-Control", "public, max-age=86400").send(buf);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") || "image/png";
      return reply.header("Content-Type", ct).header("Cache-Control", "public, max-age=86400").send(buf);
    } finally {
      clearTimeout(timeout);
    }
  });
}
