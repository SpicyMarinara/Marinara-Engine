// ──────────────────────────────────────────────
// Routes: Browser (proxy to character sources)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";

const CHUB_API_BASE = "https://api.chub.ai";
const CHUB_AVATARS = "https://avatars.charhub.io";

/** Safely proxy-fetch an external URL, returning sanitised JSON. */
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

export async function botBrowserRoutes(app: FastifyInstance) {
  // ── Search characters on Chub ──
  app.get<{
    Querystring: {
      q?: string;
      page?: string;
      sort?: string;
      nsfw?: string;
      tags?: string;
      excludeTags?: string;
      asc?: string;
      min_tokens?: string;
      max_tokens?: string;
      require_images?: string;
      require_lore?: string;
      require_expressions?: string;
      require_alternate_greetings?: string;
      max_days_ago?: string;
      special_mode?: string;
      username?: string;
    };
  }>("/chub/search", async (req) => {
    const {
      q = "",
      page = "1",
      sort = "download_count",
      nsfw = "true",
      tags,
      excludeTags,
      asc,
      min_tokens = "50",
      max_tokens,
      require_images,
      require_lore,
      require_expressions,
      require_alternate_greetings,
      max_days_ago,
      special_mode,
      username,
    } = req.query;

    // Build params exactly as Chub API expects them
    const params = new URLSearchParams({
      search: q,
      first: "48",
      page,
      nsfw,
      nsfl: nsfw,
      include_forks: "true",
      venus: "false",
      min_tokens,
    });

    // Sort: only set if not "default" (default = let Chub decide relevance)
    if (sort && sort !== "default") {
      params.set("sort", sort);
    }

    // Ascending sort direction
    if (asc === "true") {
      params.set("asc", "true");
    }

    // Time period filter
    if (max_days_ago && max_days_ago !== "0") {
      params.set("max_days_ago", max_days_ago);
    }

    // Special mode (e.g. "newcomer" for Recent Hits)
    if (special_mode) {
      params.set("special_mode", special_mode);
    }

    // Author/username filter
    if (username) {
      params.set("username", username);
    }

    // Token limits
    if (max_tokens) params.set("max_tokens", max_tokens);

    // Tag filters
    if (tags) params.set("topics", tags);
    if (excludeTags) params.set("excludetopics", excludeTags);

    // Feature filters
    if (require_images === "true") params.set("require_images", "true");
    if (require_lore === "true") params.set("require_lore", "true");
    if (require_expressions === "true") params.set("require_expressions", "true");
    if (require_alternate_greetings === "true") params.set("require_alternate_greetings", "true");

    const data = await proxyFetch(`${CHUB_API_BASE}/search?${params}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    return data;
  });

  // ── Get full character data from Chub ──
  app.get<{ Params: { "*": string } }>("/chub/character/*", async (req) => {
    const fullPath = (req.params as Record<string, string>)["*"];
    if (!fullPath) throw new Error("Missing character path");
    const nocache = Date.now();
    const data = await proxyFetch(
      `${CHUB_API_BASE}/api/characters/${encodeURI(fullPath)}?full=true&nocache=${nocache}`,
      { headers: { Accept: "application/json", "Cache-Control": "no-cache" } },
    );
    return data;
  });

  // ── Download character card PNG from Chub (for import) ──
  app.get<{ Params: { "*": string } }>("/chub/download/*", async (req, reply) => {
    const fullPath = (req.params as Record<string, string>)["*"];
    if (!fullPath) throw new Error("Missing character path");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`${CHUB_AVATARS}/avatars/${encodeURI(fullPath)}/chara_card_v2.png`, {
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

  // ── Proxy character avatar images (avoids CORS for thumbnails) ──
  app.get<{ Params: { "*": string } }>("/chub/avatar/*", async (req, reply) => {
    const fullPath = (req.params as Record<string, string>)["*"];
    if (!fullPath) throw new Error("Missing avatar path");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${CHUB_AVATARS}/avatars/${encodeURI(fullPath)}/avatar.webp`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        // Fallback to chara_card_v2.png thumbnail
        const res2 = await fetch(`${CHUB_AVATARS}/avatars/${encodeURI(fullPath)}/chara_card_v2.png`, {
          signal: controller.signal,
        });
        if (!res2.ok) return reply.status(404).send({ error: "Avatar not found" });
        const buf = Buffer.from(await res2.arrayBuffer());
        return reply.header("Content-Type", "image/png").header("Cache-Control", "public, max-age=86400").send(buf);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return reply.header("Content-Type", "image/webp").header("Cache-Control", "public, max-age=86400").send(buf);
    } finally {
      clearTimeout(timeout);
    }
  });

}
