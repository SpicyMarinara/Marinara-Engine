// ──────────────────────────────────────────────
// Routes: Browser — JannyAI provider
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";

const JANNY_SEARCH_URL = "https://search.jannyai.com/multi-search";
const JANNY_IMAGE_BASE = "https://image.jannyai.com/bot-avatars/";
const JANNY_SITE_BASE = "https://jannyai.com";
const JANNY_FALLBACK_TOKEN = "88a6463b66e04fb07ba87ee3db06af337f492ce511d93df6e2d2968cb2ff2b30";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function jannySearchHeaders(token: string): Record<string, string> {
  return {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    Origin: JANNY_SITE_BASE,
    Referer: `${JANNY_SITE_BASE}/`,
    "User-Agent": BROWSER_UA,
    "x-meilisearch-client": "Meilisearch instant-meilisearch (v0.19.0) ; Meilisearch JavaScript (v0.41.0)",
    "Sec-Fetch-Site": "same-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  };
}

let cachedToken: string = "";
// When the scrape fails we still hand back JANNY_FALLBACK_TOKEN so callers don't
// stall, but we mark that fact and only keep that result for a short TTL so a
// transient scrape failure can't poison the cache until process restart.
let cachedTokenIsFallback = false;
let cachedTokenAt = 0;
const FALLBACK_TOKEN_TTL_MS = 60_000;
let inFlightTokenFetch: Promise<string> | null = null;

async function fetchJannyPage(path: string): Promise<string | null> {
  // Direct fetch first; fall back to corsproxy.io when Cloudflare blocks our IP.
  // Each fetch gets its own 15s kill-switch so a hung upstream can't pin a request open.
  const directController = new AbortController();
  const directTimeout = setTimeout(() => directController.abort(), 15_000);
  try {
    const direct = await fetch(`${JANNY_SITE_BASE}${path}`, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,*/*" },
      signal: directController.signal,
    });
    if (direct.ok) return direct.text();
  } catch {
    /* fall through */
  } finally {
    clearTimeout(directTimeout);
  }

  const proxyController = new AbortController();
  const proxyTimeout = setTimeout(() => proxyController.abort(), 15_000);
  try {
    const proxied = await fetch(
      `https://corsproxy.io/?url=${encodeURIComponent(`${JANNY_SITE_BASE}${path}`)}`,
      {
        headers: { Accept: "text/html,application/xhtml+xml,*/*" },
        signal: proxyController.signal,
      },
    );
    if (proxied.ok) return proxied.text();
  } catch {
    /* fall through */
  } finally {
    clearTimeout(proxyTimeout);
  }
  return null;
}

async function scrapeToken(): Promise<{ token: string; isFallback: boolean }> {
  try {
    const html = await fetchJannyPage("/characters/search");
    if (!html) return { token: JANNY_FALLBACK_TOKEN, isFallback: true };

    // Resolve client-config bundle path: either inlined directly in the page,
    // or imported by the SearchPage chunk (Janny's bundler split changed in 2026).
    let configPath: string | null = null;
    const directMatch = html.match(/client-config\.[a-zA-Z0-9_-]+\.js/);
    if (directMatch) {
      configPath = `/_astro/${directMatch[0]}`;
    } else {
      const spMatch = html.match(/SearchPage\.[a-zA-Z0-9_-]+\.js/);
      if (spMatch) {
        const spJs = await fetchJannyPage(`/_astro/${spMatch[0]}`);
        if (spJs) {
          const impMatch = spJs.match(/client-config\.[a-zA-Z0-9_-]+\.js/);
          if (impMatch) configPath = `/_astro/${impMatch[0]}`;
        }
      }
    }

    if (configPath) {
      const cfgJs = await fetchJannyPage(configPath);
      if (cfgJs) {
        const tokenMatch = cfgJs.match(/"([a-f0-9]{64})"/);
        if (tokenMatch?.[1]) return { token: tokenMatch[1], isFallback: false };
      }
    }
  } catch {
    // fall through to fallback
  }
  return { token: JANNY_FALLBACK_TOKEN, isFallback: true };
}

async function getSearchToken(): Promise<string> {
  // Honor a cached fresh-scrape result indefinitely; honor a cached fallback
  // only for FALLBACK_TOKEN_TTL_MS so a transient scrape failure can't poison
  // /janny/token until process restart.
  if (cachedToken) {
    if (!cachedTokenIsFallback || Date.now() - cachedTokenAt < FALLBACK_TOKEN_TTL_MS) {
      return cachedToken;
    }
    cachedToken = "";
  }
  if (inFlightTokenFetch) return inFlightTokenFetch;
  inFlightTokenFetch = scrapeToken().then(({ token, isFallback }) => {
    cachedToken = token;
    cachedTokenIsFallback = isFallback;
    cachedTokenAt = Date.now();
    inFlightTokenFetch = null;
    return token;
  });
  return inFlightTokenFetch;
}

interface JannyMeiliHit {
  id?: string;
  name?: string;
  tagIds?: number[];
  creatorId?: string;
  creatorUsername?: string;
}

async function backfillFromSearch(name: string, charId: string): Promise<JannyMeiliHit | null> {
  if (!name) return null;
  const token = await getSearchToken();
  const body = {
    queries: [
      {
        indexUid: "janny-characters",
        q: name,
        hitsPerPage: 20,
        page: 1,
      },
    ],
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(JANNY_SEARCH_URL, {
      method: "POST",
      headers: jannySearchHeaders(token),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      // Mirror the search-route behavior so the next call re-scrapes a fresh token.
      cachedToken = "";
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ hits?: JannyMeiliHit[] }> };
    const hits = data?.results?.[0]?.hits || [];
    return hits.find((h) => h.id === charId) ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function botBrowserJannyRoutes(app: FastifyInstance) {
  // ── Expose the scraped MeiliSearch token so the browser can POST search directly ──
  // (Server-side search.jannyai.com calls are blocked by Cloudflare. The upstream
  // SillyTavern extension works because the request comes from the user's browser,
  // which carries cf_clearance and a real TLS fingerprint. We do the same.)
  app.get("/janny/token", async () => {
    const token = await getSearchToken();
    return { token };
  });

  // ── Search characters on JannyAI via MeiliSearch (server-side fallback only) ──
  app.get<{
    Querystring: {
      q?: string;
      page?: string;
      limit?: string;
      sort?: string;
      nsfw?: string;
      showLowQuality?: string;
      min_tokens?: string;
      max_tokens?: string;
      tagIds?: string;
    };
  }>("/janny/search", async (req) => {
    const {
      q = "",
      page = "1",
      limit = "80",
      sort = "newest",
      nsfw = "true",
      showLowQuality = "false",
      min_tokens = "29",
      max_tokens = "100000",
      tagIds,
    } = req.query;

    const filters: string[] = [];
    filters.push(`totalToken >= ${parseInt(min_tokens) || 29}`);
    filters.push(`totalToken <= ${parseInt(max_tokens) || 100000}`);
    if (nsfw !== "true") filters.push("isNsfw = false");
    if (showLowQuality !== "true") filters.push("isLowQuality = false");

    if (tagIds) {
      const ids = tagIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length > 0) {
        const tagClauses = ids.map((id) => `tagIds = ${id}`);
        filters.push(tagClauses.join(" AND "));
      }
    }

    const sortMap: Record<string, string[]> = {
      newest: ["createdAtStamp:desc"],
      oldest: ["createdAtStamp:asc"],
      tokens_desc: ["totalToken:desc"],
      tokens_asc: ["totalToken:asc"],
      relevant: [],
    };
    const sortArr: string[] = sortMap[sort] || sortMap.newest || [];

    const body: Record<string, unknown> = {
      queries: [
        {
          indexUid: "janny-characters",
          q,
          facets: ["isLowQuality", "isNsfw", "tagIds", "totalToken"],
          attributesToCrop: ["description:300"],
          cropMarker: "...",
          filter: filters,
          attributesToHighlight: ["name", "description"],
          highlightPreTag: "__ais-highlight__",
          highlightPostTag: "__/ais-highlight__",
          hitsPerPage: parseInt(limit) || 80,
          page: parseInt(page) || 1,
          ...(sortArr.length > 0 ? { sort: sortArr } : {}),
        },
      ],
    };

    const token = await getSearchToken();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(JANNY_SEARCH_URL, {
        method: "POST",
        headers: jannySearchHeaders(token),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        // Token may have rotated — bust the cache so the next call re-scrapes
        cachedToken = "";
        const cfMitigated = res.headers.get("cf-mitigated");
        if (cfMitigated || res.status === 403) {
          throw new Error(
            "JannyAI is currently blocking server-to-server requests (Cloudflare bot mitigation). Try again later or use a different provider.",
          );
        }
      }
      if (!res.ok) throw new Error(`JannyAI search error ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  });

  // ── Proxy JannyAI avatar images ──
  // ── Fetch full character details by scraping JannyAI page ──
  app.get<{ Params: { id: string } }>("/janny/character/:id", async (req, reply) => {
    const charId = req.params.id;
    if (!charId) throw new Error("Missing character ID");

    const slug = (req.query as Record<string, string>)?.slug || "character";
    const pageUrl = `${JANNY_SITE_BASE}/characters/${charId}_${slug}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      let html = "";

      // Strategy 1: Direct fetch
      try {
        const directRes = await fetch(pageUrl, {
          headers: {
            Accept: "text/html,application/xhtml+xml,*/*",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Referer: "https://jannyai.com/",
          },
          signal: controller.signal,
          redirect: "follow",
        });
        if (directRes.ok) {
          html = await directRes.text();
          if (
            html.length < 1000 ||
            html.includes("Just a moment") ||
            html.includes("cf-challenge") ||
            html.includes("challenge-platform") ||
            !html.includes("astro-island")
          ) {
            html = "";
          }
        }
      } catch {
        /* fall through */
      }

      // Strategy 2: corsproxy.io
      if (!html) {
        try {
          const proxyRes = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(pageUrl)}`, {
            headers: {
              Accept: "text/html,application/xhtml+xml,*/*",
              Origin: "https://jannyai.com",
            },
            signal: controller.signal,
          });
          if (proxyRes.ok) {
            html = await proxyRes.text();
            if (
              html.length < 1000 ||
              html.includes("Just a moment") ||
              html.includes("cf-challenge") ||
              html.includes("challenge-platform") ||
              !html.includes("astro-island")
            ) {
              html = "";
            }
          }
        } catch {
          /* fall through */
        }
      }

      if (!html) {
        return reply.status(404).send({ error: "Could not fetch character page (Cloudflare blocked)" });
      }

      // Parse Astro island props containing character data
      let astroMatch = html.match(/astro-island[^>]*component-export="CharacterButtons"[^>]*props="([^"]+)"/);
      if (!astroMatch) {
        astroMatch = html.match(/astro-island[^>]*props="([^"]*character[^"]*)"/);
      }
      if (!astroMatch) {
        return reply.status(404).send({ error: "Could not parse character data from page" });
      }

      const propsDecoded = astroMatch[1]!
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'");

      const propsJson = JSON.parse(propsDecoded);

      function decodeAstroValue(value: unknown): unknown {
        if (!Array.isArray(value)) return value;
        const [type, data] = value;
        if (type === 0) {
          if (typeof data === "object" && data !== null && !Array.isArray(data)) {
            const decoded: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
              decoded[key] = decodeAstroValue(val);
            }
            return decoded;
          }
          return data;
        } else if (type === 1) {
          return (data as unknown[]).map((item: unknown) => decodeAstroValue(item));
        }
        return data;
      }

      const character = decodeAstroValue(propsJson.character) as Record<string, unknown> | null;

      if (!character) {
        return reply.status(404).send({ error: "No character data found in page" });
      }

      const creatorMatch = html.match(/Creator:\s*(?:<\/[^>]+>\s*)?<a[^>]*>@?([^<]+)<\/a>/);
      if (creatorMatch) {
        character.creatorUsername = creatorMatch[1]!.trim();
      }

      // Backfill missing tagIds/creatorId from MeiliSearch — page scrape often lacks these
      const tagIds = character.tagIds as number[] | undefined;
      if (!tagIds?.length || !character.creatorId) {
        const hit = await backfillFromSearch(typeof character.name === "string" ? character.name : "", charId);
        if (hit) {
          if (!tagIds?.length && hit.tagIds?.length) character.tagIds = hit.tagIds;
          if (!character.creatorId && hit.creatorId) character.creatorId = hit.creatorId;
        }
      }

      return {
        character,
        success: true,
      };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return reply.status(504).send({ error: "Request timed out" });
      }
      return reply.status(500).send({ error: (err as Error).message });
    } finally {
      clearTimeout(timeout);
    }
  });

  app.get<{ Params: { "*": string } }>("/janny/avatar/*", async (req, reply) => {
    const avatarPath = (req.params as Record<string, string>)["*"];
    if (!avatarPath) throw new Error("Missing avatar path");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${JANNY_IMAGE_BASE}${avatarPath}`, {
        signal: controller.signal,
      });
      if (!res.ok) return reply.status(404).send({ error: "Avatar not found" });
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get("content-type") || "image/jpeg";
      return reply.header("Content-Type", ct).header("Cache-Control", "public, max-age=86400").send(buf);
    } finally {
      clearTimeout(timeout);
    }
  });
}
