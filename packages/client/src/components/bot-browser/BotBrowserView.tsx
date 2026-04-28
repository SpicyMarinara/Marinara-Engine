// ──────────────────────────────────────────────
// View: Browser (full-page, replaces chat area)
// Multi-provider: ChubAI, JannyAI, CharacterTavern, Pygmalion, Wyvern
// With login modals for Pygmalion & CharacterTavern NSFW, PNG download for all providers
// ──────────────────────────────────────────────
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  Search,
  Star,
  MessageSquare,
  Hash,
  Download,
  Loader2,
  ChevronLeft,
  ChevronDown,
  X,
  CheckCircle,
  ExternalLink,
  ArrowLeft,
  RefreshCw,
  SlidersHorizontal,
  Tag,
  Heart,
  Eye,
  LogIn,
  LogOut,
  KeyRound,
  Cookie,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { characterKeys } from "../../hooks/use-characters";
import { lorebookKeys } from "../../hooks/use-lorebooks";
import { parsePngCharacterCard } from "../../lib/png-parser";
import { useUIStore } from "../../stores/ui.store";
import { toast } from "sonner";
import { cn } from "../../lib/utils";

// ════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════

interface BrowseCard {
  id: string;
  name: string;
  creator: string;
  tagline: string;
  tags: string[];
  avatarUrl: string;
  stat1: number;
  stat1Label: string;
  stat1Icon: "star" | "download" | "heart" | "eye" | "message" | "hash";
  stat2: number;
  stat2Label: string;
  stat2Icon: "star" | "download" | "heart" | "eye" | "message" | "hash";
  stat3: number;
  stat3Label: string;
  stat3Icon: "star" | "download" | "heart" | "eye" | "message" | "hash";
  nsfw: boolean;
  externalUrl: string;
  _raw: unknown;
}

interface SortOption {
  value: string;
  label: string;
  group?: string;
}

interface FilterFeature {
  key: string;
  label: string;
  icon: string;
}

interface ProviderConfig {
  id: string;
  name: string;
  icon: string;
  sortOptions: SortOption[];
  defaultSort: string;
  /** Items per page returned by the provider's search. Used by the shared paginator. */
  pageSize: number;
  features: FilterFeature[];
  hasSortDirection: boolean;
  hasTokenFilters: boolean;
  extraToggles: { key: string; label: string; icon: string }[];
  nsfwAvailable: boolean;
  /** "login" = show login modal, "wyvern" = show sort hint, true/false = normal */
  nsfwMode: "free" | "login" | "wyvern";
  search: (params: SearchParams) => Promise<{ cards: BrowseCard[]; totalCount: number }>;
  fetchDetail: (card: BrowseCard) => Promise<CardDetail | null>;
  importCard: (card: BrowseCard) => Promise<void>;
  getAvatarUrl: (card: BrowseCard) => string;
  getExternalUrl: (card: BrowseCard) => string;
  siteName: string;
}

interface SearchParams {
  query: string;
  page: number;
  sort: string;
  nsfw: boolean;
  includeTags: string[];
  excludeTags: string[];
  sortAsc: boolean;
  minTokens: string;
  maxTokens: string;
  features: Record<string, boolean>;
  extraToggles: Record<string, boolean>;
}

interface CardDetail {
  description?: string;
  personality?: string;
  scenario?: string;
  firstMessage?: string;
  exampleDialogs?: string;
  alternateGreetings?: string[];
  creatorNotes?: string;
  hasLorebook?: boolean;
  extra?: { title: string; content: string }[];
}

// ════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const STAT_ICONS = {
  star: Star,
  download: Download,
  heart: Heart,
  eye: Eye,
  message: MessageSquare,
  hash: Hash,
};

// ════════════════════════════════════════════════
// LocalStorage persistence helpers
// ════════════════════════════════════════════════

const STORAGE_KEY = "marinara-bot-browser";

interface BrowserPersist {
  nsfw: Record<string, boolean>;
  logins: Record<string, boolean>;
  lastSource?: string;
}

function loadPersist(): BrowserPersist {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { nsfw: {}, logins: {} };
}

function savePersist(data: BrowserPersist) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function getPersistNsfw(sourceId: string): boolean {
  return loadPersist().nsfw[sourceId] ?? false;
}

function setPersistNsfw(sourceId: string, value: boolean) {
  const data = loadPersist();
  data.nsfw[sourceId] = value;
  savePersist(data);
}

function getPersistLogin(sourceId: string): boolean {
  return loadPersist().logins[sourceId] ?? false;
}

function setPersistLogin(sourceId: string, value: boolean) {
  const data = loadPersist();
  data.logins[sourceId] = value;
  savePersist(data);
}

// ════════════════════════════════════════════════
// JannyAI tag map
// ════════════════════════════════════════════════

const JANNY_TAG_MAP: Record<number, string> = {
  1: "Male",
  2: "Female",
  3: "Non-binary",
  4: "Celebrity",
  5: "OC",
  6: "Fictional",
  7: "Real",
  8: "Game",
  9: "Anime",
  10: "Historical",
  11: "Royalty",
  12: "Detective",
  13: "Hero",
  14: "Villain",
  15: "Magical",
  16: "Non-human",
  17: "Monster",
  18: "Monster Girl",
  19: "Alien",
  20: "Robot",
  21: "Politics",
  22: "Vampire",
  23: "Giant",
  24: "OpenAI",
  25: "Elf",
  26: "Multiple",
  27: "VTuber",
  28: "Dominant",
  29: "Submissive",
  30: "Scenario",
  31: "Pokemon",
  32: "Assistant",
  34: "Non-English",
  36: "Philosophy",
  38: "RPG",
  39: "Religion",
  41: "Books",
  42: "AnyPOV",
  43: "Angst",
  44: "Demi-Human",
  45: "Enemies to Lovers",
  46: "Smut",
  47: "MLM",
  48: "WLW",
  49: "Action",
  50: "Romance",
  51: "Horror",
  52: "Slice of Life",
  53: "Fantasy",
  54: "Drama",
  55: "Comedy",
  56: "Mystery",
  57: "Sci-Fi",
  59: "Yandere",
  60: "Furry",
  61: "Movies/TV",
};

function jannyTagNames(ids: number[]): string[] {
  return (ids || []).map((id) => JANNY_TAG_MAP[id] || `Tag ${id}`);
}

const JANNY_TAG_REVERSE: Record<string, number> = {};
for (const [id, name] of Object.entries(JANNY_TAG_MAP)) {
  JANNY_TAG_REVERSE[name.toLowerCase()] = Number(id);
}

function jannyTagNamesToIds(names: string[]): string[] {
  return names
    .map((n) => JANNY_TAG_REVERSE[n.toLowerCase()])
    .filter((id): id is number => id !== undefined)
    .map(String);
}

// ════════════════════════════════════════════════
// Provider: ChubAI
// ════════════════════════════════════════════════

const CHUB_SORT_PRESETS: { value: string; sort: string; days: number; special_mode: string }[] = [
  { value: "popular_week", sort: "download_count", days: 7, special_mode: "" },
  { value: "popular_month", sort: "download_count", days: 30, special_mode: "" },
  { value: "popular_all", sort: "download_count", days: 0, special_mode: "" },
  { value: "rated_week", sort: "star_count", days: 7, special_mode: "" },
  { value: "rated_all", sort: "star_count", days: 0, special_mode: "" },
  { value: "newest", sort: "id", days: 30, special_mode: "" },
  { value: "updated", sort: "last_activity_at", days: 0, special_mode: "" },
  { value: "recent_hits", sort: "default", days: 0, special_mode: "newcomer" },
  { value: "random", sort: "random", days: 0, special_mode: "" },
];

const chubProvider: ProviderConfig = {
  id: "chub",
  name: "ChubAI",
  icon: "✦",
  siteName: "Chub",
  defaultSort: "popular_all",
  pageSize: 48,
  sortOptions: [
    { value: "popular_all", label: "👑 Most Downloaded", group: "Popular" },
    { value: "popular_week", label: "🔥 Hot This Week", group: "Popular" },
    { value: "popular_month", label: "📈 Hot This Month", group: "Popular" },
    { value: "rated_week", label: "⭐ Top Rated (Week)", group: "Quality" },
    { value: "rated_all", label: "⭐ Top Rated (All Time)", group: "Quality" },
    { value: "newest", label: "🆕 Newest", group: "Discovery" },
    { value: "updated", label: "🔄 Recently Updated", group: "Discovery" },
    { value: "recent_hits", label: "🌟 Recent Hits", group: "Discovery" },
    { value: "random", label: "🎲 Random", group: "Discovery" },
  ],
  features: [
    { key: "images", label: "Image Gallery", icon: "🖼️" },
    { key: "lore", label: "Lorebook", icon: "📖" },
    { key: "expressions", label: "Expressions", icon: "😊" },
    { key: "greetings", label: "Alt Greetings", icon: "💬" },
  ],
  hasSortDirection: true,
  hasTokenFilters: true,
  extraToggles: [],
  nsfwAvailable: true,
  nsfwMode: "free",
  getAvatarUrl: (card) => `/api/bot-browser/chub/avatar/${card.id}`,
  getExternalUrl: (card) => `https://chub.ai/characters/${card.id}`,
  search: async (p) => {
    const preset = CHUB_SORT_PRESETS.find((pr) => pr.value === p.sort) ?? CHUB_SORT_PRESETS[0];
    const isSearching = p.query.trim().length > 0;
    const params = new URLSearchParams({ q: p.query, page: String(p.page), nsfw: String(p.nsfw) });
    if (isSearching) {
      if (preset.sort !== "default") params.set("sort", preset.sort);
    } else {
      params.set("sort", preset.sort);
      if (preset.days > 0) params.set("max_days_ago", String(preset.days));
      if (preset.special_mode) params.set("special_mode", preset.special_mode);
    }
    if (p.sortAsc) params.set("asc", "true");
    if (p.includeTags.length > 0) params.set("tags", p.includeTags.join(","));
    if (p.excludeTags.length > 0) params.set("excludeTags", p.excludeTags.join(","));
    if (p.minTokens) params.set("min_tokens", p.minTokens);
    if (p.maxTokens) params.set("max_tokens", p.maxTokens);
    if (p.features.images) params.set("require_images", "true");
    if (p.features.lore) params.set("require_lore", "true");
    if (p.features.expressions) params.set("require_expressions", "true");
    if (p.features.greetings) params.set("require_alternate_greetings", "true");
    const res = await fetch(`/api/bot-browser/chub/search?${params}`);
    if (!res.ok) throw new Error("Search failed");
    const raw = await res.json();
    const data = raw?.data ?? raw;
    const nodes = data?.nodes ?? [];
    // Chub API "count" = items on this page, not total. Use cursor to detect more pages.
    const hasMore = !!data?.cursor;
    const chubTotal = hasMore ? (p.page + 1) * 48 : (p.page - 1) * 48 + nodes.length;

    return {
      cards: nodes.map((n: any) => ({
        id: n.fullPath,
        name: n.name || "Unnamed",
        creator: (n.fullPath || "").split("/")[0] || "",
        tagline: n.tagline || "",
        tags: n.topics || [],
        avatarUrl: `/api/bot-browser/chub/avatar/${n.fullPath}`,
        stat1: n.starCount || 0,
        stat1Label: "Downloads",
        stat1Icon: "download" as const,
        stat2: n.nChats || 0,
        stat2Label: "Chats",
        stat2Icon: "message" as const,
        stat3: n.nTokens || 0,
        stat3Label: "Tokens",
        stat3Icon: "hash" as const,
        nsfw: !!n.nsfw,
        externalUrl: `https://chub.ai/characters/${n.fullPath}`,
        _raw: n,
      })),
      totalCount: chubTotal,
    };
  },
  fetchDetail: async (card) => {
    const res = await fetch(`/api/bot-browser/chub/character/${card.id}`);
    if (!res.ok) return null;
    const raw = await res.json();
    const node = raw?.data?.node ?? raw?.node;
    if (!node) return null;
    const def = node.definition || {};
    return {
      description: def.personality || undefined,
      personality: def.tavern_personality || undefined,
      scenario: def.scenario || undefined,
      firstMessage: def.first_message || undefined,
      exampleDialogs: def.example_dialogs || undefined,
      alternateGreetings: def.alternate_greetings || [],
      creatorNotes: def.description || undefined,
      hasLorebook: !!def.embedded_lorebook,
    };
  },
  importCard: async () => {},
};

// ════════════════════════════════════════════════
// Provider: JannyAI
// ════════════════════════════════════════════════

const jannyProvider: ProviderConfig = {
  id: "janny",
  name: "JannyAI",
  icon: "🤖",
  siteName: "JannyAI",
  defaultSort: "newest",
  pageSize: 80,
  sortOptions: [
    { value: "newest", label: "🆕 Newest", group: "Date" },
    { value: "oldest", label: "🕐 Oldest", group: "Date" },
    { value: "tokens_desc", label: "📊 Most Tokens", group: "Tokens" },
    { value: "tokens_asc", label: "📊 Least Tokens", group: "Tokens" },
    { value: "relevant", label: "🔍 Relevance", group: "Search" },
  ],
  features: [],
  hasSortDirection: false,
  hasTokenFilters: true,
  extraToggles: [{ key: "showLowQuality", label: "Show Low Quality", icon: "🚫" }],
  nsfwAvailable: true,
  nsfwMode: "free",
  getAvatarUrl: (card) => `/api/bot-browser/janny/avatar/${(card._raw as any)?.avatar || ""}`,
  getExternalUrl: (card) => {
    const raw = card._raw as any;
    const slug = card.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return `https://jannyai.com/characters/${raw?.id || card.id}_character-${slug}`;
  },
  search: async (p) => {
    // Fetch a one-time search token from the server (token is scraped from JannyAI's
    // public Astro bundle). The actual MeiliSearch POST runs from the BROWSER so that
    // Cloudflare sees a real browser TLS fingerprint + the user's cf_clearance cookie.
    const tokenRes = await fetch("/api/bot-browser/janny/token");
    if (!tokenRes.ok) throw new Error("Could not obtain JannyAI token");
    const { token } = await tokenRes.json();
    if (!token) throw new Error("JannyAI token unavailable");

    const sortMap: Record<string, string[]> = {
      newest: ["createdAtStamp:desc"],
      oldest: ["createdAtStamp:asc"],
      tokens_desc: ["totalToken:desc"],
      tokens_asc: ["totalToken:asc"],
      relevant: [],
    };
    const sortArr = sortMap[p.sort] ?? sortMap.newest!;

    // Split include tags into "known" (mapped to MeiliSearch tagIds) and "custom"
    // (free-form names that aren't in JANNY_TAG_MAP). Known tags filter server-side;
    // custom tags filter client-side against the hit's resolved tag-name list.
    const knownIncludeTagIds = jannyTagNamesToIds(p.includeTags);
    const customIncludeTags = p.includeTags
      .filter((t) => JANNY_TAG_REVERSE[t.toLowerCase()] === undefined)
      .map((t) => t.toLowerCase());

    const fetchOnePage = async (pageNum: number) => {
      const filters: string[] = [];
      filters.push(`totalToken >= ${parseInt(p.minTokens) || 29}`);
      filters.push(`totalToken <= ${parseInt(p.maxTokens) || 100000}`);
      if (!p.nsfw) filters.push("isNsfw = false");
      if (!p.extraToggles.showLowQuality) filters.push("isLowQuality = false");
      if (knownIncludeTagIds.length > 0) {
        filters.push(knownIncludeTagIds.map((id) => `tagIds = ${id}`).join(" AND "));
      }

      const body = {
        queries: [
          {
            indexUid: "janny-characters",
            q: p.query,
            facets: ["isLowQuality", "isNsfw", "tagIds", "totalToken"],
            attributesToCrop: ["description:300"],
            cropMarker: "...",
            filter: filters,
            attributesToHighlight: ["name", "description"],
            highlightPreTag: "__ais-highlight__",
            highlightPostTag: "__/ais-highlight__",
            hitsPerPage: 80,
            page: pageNum,
            ...(sortArr.length > 0 ? { sort: sortArr } : {}),
          },
        ],
      };

      const res = await fetch("https://search.jannyai.com/multi-search", {
        method: "POST",
        // Cross-origin POST: required so the browser actually sends cf_clearance +
        // any other jannyai.com cookies the user already has — that's what gets us
        // past Cloudflare's bot challenge. Without this the workaround is a no-op.
        credentials: "include",
        headers: {
          Accept: "*/*",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-meilisearch-client": "Meilisearch instant-meilisearch (v0.19.0) ; Meilisearch JavaScript (v0.41.0)",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error(
            "JannyAI is blocking the request (Cloudflare). Visit https://jannyai.com once in this browser to clear the challenge, then retry.",
          );
        }
        throw new Error(`JannyAI search error ${res.status}`);
      }
      const raw = await res.json();
      return raw?.results?.[0];
    };

    const lowerExclude = p.excludeTags.map((t) => t.toLowerCase());
    const applyClientFilter = (hitsArr: any[]): any[] => {
      if (lowerExclude.length === 0 && customIncludeTags.length === 0) return hitsArr;
      return hitsArr.filter((h: any) => {
        const charTagNames = jannyTagNames(h.tagIds || []).map((t) => t.toLowerCase());
        if (lowerExclude.length > 0 && lowerExclude.some((et) => charTagNames.includes(et))) return false;
        // Custom tags: every custom tag must appear in the hit's resolved tag names
        if (customIncludeTags.length > 0 && !customIncludeTags.every((ct) => charTagNames.includes(ct))) return false;
        return true;
      });
    };

    let currentPage = p.page;
    const result = await fetchOnePage(currentPage);
    let hits = applyClientFilter(result?.hits || []);
    const totalPages = result?.totalPages || 1;

    // Auto-fetch up to 3 extra pages when client-side filters thin the page
    if (lowerExclude.length > 0 || customIncludeTags.length > 0) {
      let autoFetches = 0;
      while (hits.length < 80 && currentPage < totalPages && autoFetches < 3) {
        autoFetches++;
        currentPage++;
        const more = await fetchOnePage(currentPage);
        hits = hits.concat(applyClientFilter(more?.hits || []));
      }
    }
    return {
      cards: hits.map((h: any) => ({
        id: h.id || "",
        name: h.name || "Unnamed",
        creator: h.creatorUsername || "",
        tagline: (h.description || "").replace(/<[^>]*>/g, "").slice(0, 200),
        tags: jannyTagNames(h.tagIds),
        avatarUrl: h.avatar ? `/api/bot-browser/janny/avatar/${h.avatar}` : "",
        stat1: h.totalToken || 0,
        stat1Label: "Tokens",
        stat1Icon: "hash" as const,
        stat2: 0,
        stat2Label: "",
        stat2Icon: "star" as const,
        stat3: 0,
        stat3Label: "",
        stat3Icon: "star" as const,
        nsfw: !!h.isNsfw,
        externalUrl: `https://jannyai.com/characters/${h.id}_character-${(h.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        _raw: h,
      })),
      totalCount: result?.totalHits ?? totalPages * 80,
    };
  },
  fetchDetail: async (card) => {
    const raw = card._raw as any;
    const charId = raw?.id || card.id;
    const slug = card.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const pageUrl = `https://jannyai.com/characters/${charId}_character-${slug}`;

    // Helper to decode Astro's [type, data] serialization
    function decodeAstro(value: unknown): unknown {
      if (!Array.isArray(value)) return value;
      const [type, data] = value;
      if (type === 0) {
        if (typeof data === "object" && data !== null && !Array.isArray(data)) {
          const decoded: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
            decoded[key] = decodeAstro(val);
          }
          return decoded;
        }
        return data;
      } else if (type === 1) {
        return (data as unknown[]).map((item: unknown) => decodeAstro(item));
      }
      return data;
    }

    // Helper to parse character from HTML
    function parseCharFromHtml(html: string): Record<string, unknown> | null {
      if (!html || html.includes("Just a moment") || html.includes("cf-challenge")) return null;
      let astroMatch = html.match(/astro-island[^>]*component-export="CharacterButtons"[^>]*props="([^"]+)"/);
      if (!astroMatch) astroMatch = html.match(/astro-island[^>]*props="([^"]*character[^"]*)"/);
      if (!astroMatch?.[1]) return null;
      try {
        const decoded = astroMatch[1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#39;/g, "'");
        const propsJson = JSON.parse(decoded);
        return decodeAstro(propsJson.character) as Record<string, unknown> | null;
      } catch {
        return null;
      }
    }

    // Strategy 1: corsproxy.io from browser (preferred — bypasses Cloudflare via the
    // user's browser TLS fingerprint + any cf_clearance cookie they have for jannyai.com)
    try {
      const proxyRes = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(pageUrl)}`, {
        headers: { Accept: "text/html,application/xhtml+xml,*/*" },
      });
      if (proxyRes.ok) {
        const html = await proxyRes.text();
        const char = parseCharFromHtml(html);
        if (char && (char.personality || char.firstMessage)) {
          return {
            description: (char.personality as string) || undefined,
            scenario: (char.scenario as string) || undefined,
            firstMessage: (char.firstMessage as string) || undefined,
            exampleDialogs: (char.exampleDialogs as string) || undefined,
            creatorNotes: char.description
              ? typeof char.description === "string"
                ? char.description.replace(/<[^>]*>/g, "").trim()
                : undefined
              : undefined,
          };
        }
      }
    } catch {
      /* fall through */
    }

    // Strategy 2: server-side proxy (likely fails due to Cloudflare, but try anyway)
    try {
      const res = await fetch(`/api/bot-browser/janny/character/${charId}?slug=character-${slug}`);
      if (res.ok) {
        const data = await res.json();
        const char = data?.character;
        if (char && (char.personality || char.firstMessage)) {
          return {
            description: char.personality || undefined,
            scenario: char.scenario || undefined,
            firstMessage: char.firstMessage || undefined,
            exampleDialogs: char.exampleDialogs || undefined,
            creatorNotes: char.description
              ? typeof char.description === "string"
                ? char.description.replace(/<[^>]*>/g, "").trim()
                : undefined
              : undefined,
          };
        }
      }
    } catch {
      /* fall through */
    }

    // Fallback: use search result data
    const rawDesc = raw?.description || "";
    const plainDesc = typeof rawDesc === "string" ? rawDesc.replace(/<[^>]*>/g, "").trim() : "";
    if (plainDesc) {
      return { creatorNotes: plainDesc };
    }
    return null;
  },

  importCard: async () => {},
};

// ════════════════════════════════════════════════
// Provider: CharacterTavern
// ════════════════════════════════════════════════

const chartavernProvider: ProviderConfig = {
  id: "chartavern",
  name: "CharacterTavern",
  icon: "🍺",
  siteName: "CharacterTavern",
  defaultSort: "most_popular",
  pageSize: 60,
  sortOptions: [
    { value: "most_popular", label: "🔥 Most Popular" },
    { value: "trending", label: "📈 Trending" },
    { value: "newest", label: "🆕 Newest" },
    { value: "oldest", label: "🕐 Oldest" },
    { value: "most_likes", label: "❤️ Most Liked" },
  ],
  features: [{ key: "lore", label: "Lorebook", icon: "📖" }],
  hasSortDirection: false,
  hasTokenFilters: true,
  extraToggles: [{ key: "isOC", label: "Original Character", icon: "⭐" }],
  nsfwAvailable: false,
  nsfwMode: "login",
  getAvatarUrl: (card) => `/api/bot-browser/chartavern/avatar/${card.id}`,
  getExternalUrl: (card) => `https://character-tavern.com/character/${card.id}`,
  search: async (p) => {
    const params = new URLSearchParams({
      q: p.query,
      page: String(p.page),
      limit: "60",
      sort: p.sort,
      nsfw: String(p.nsfw),
    });
    if (p.includeTags.length > 0) params.set("tags", p.includeTags.join(","));
    if (p.excludeTags.length > 0) params.set("excludeTags", p.excludeTags.join(","));
    if (p.minTokens && p.minTokens !== "0") params.set("min_tokens", p.minTokens);
    if (p.maxTokens && p.maxTokens !== "0") params.set("max_tokens", p.maxTokens);
    if (p.features.lore) params.set("hasLorebook", "true");
    if (p.extraToggles.isOC) params.set("isOC", "true");
    const res = await fetch(`/api/bot-browser/chartavern/search?${params}`);
    if (!res.ok) throw new Error("Search failed");
    const data = await res.json();
    const hits = data?.hits || [];
    return {
      cards: hits.map((h: any) => ({
        id: h.path || "",
        name: h.name || "Unnamed",
        creator: h.author || (h.path || "").split("/")[0] || "",
        tagline: h.tagline || "",
        tags: Array.isArray(h.tags) ? h.tags : [],
        avatarUrl: h.path ? `/api/bot-browser/chartavern/avatar/${h.path}` : "",
        stat1: h.downloads || 0,
        stat1Label: "Downloads",
        stat1Icon: "download" as const,
        stat2: h.likes || 0,
        stat2Label: "Likes",
        stat2Icon: "heart" as const,
        stat3: h.totalTokens || 0,
        stat3Label: "Tokens",
        stat3Icon: "hash" as const,
        nsfw: !!h.isNSFW,
        externalUrl: `https://character-tavern.com/character/${h.path}`,
        _raw: h,
      })),
      totalCount: (data?.totalHits ?? data?.totalPages) ? data.totalPages * 60 : hits.length,
    };
  },
  fetchDetail: async (card) => {
    const parts = card.id.split("/");
    if (parts.length < 2) return null;
    const res = await fetch(`/api/bot-browser/chartavern/character/${parts[0]}/${parts[1]}`);
    if (!res.ok) return null;
    const data = await res.json();
    const c = data?.card;
    if (!c) return null;
    return {
      description: c.definition_character_description || undefined,
      personality: c.definition_personality || undefined,
      scenario: c.definition_scenario || undefined,
      firstMessage: c.definition_first_message || undefined,
      exampleDialogs: c.definition_example_messages || undefined,
      creatorNotes: c.description || undefined,
      hasLorebook: !!c.lorebookId,
    };
  },
  importCard: async () => {},
};

// ════════════════════════════════════════════════
// Provider: Pygmalion
// ════════════════════════════════════════════════

const pygmalionProvider: ProviderConfig = {
  id: "pygmalion",
  name: "Pygmalion",
  icon: "🔥",
  siteName: "Pygmalion",
  defaultSort: "downloads",
  pageSize: 48,
  sortOptions: [
    { value: "downloads", label: "⬇️ Downloads" },
    { value: "stars", label: "⭐ Stars" },
    { value: "views", label: "👁️ Views" },
    { value: "approved_at", label: "🆕 Newest" },
    { value: "token_count", label: "📝 Tokens" },
    { value: "display_name", label: "🔤 Name" },
  ],
  features: [],
  hasSortDirection: true,
  hasTokenFilters: false,
  extraToggles: [],
  nsfwAvailable: false,
  nsfwMode: "login",
  getAvatarUrl: (card) => {
    const raw = card._raw as any;
    const av = raw?.avatarUrl;
    if (!av) return "";
    if (av.startsWith("http")) return `/api/bot-browser/pygmalion/avatar/${encodeURIComponent(av)}`;
    return `/api/bot-browser/pygmalion/avatar/${av}`;
  },
  getExternalUrl: (card) => `https://pygmalion.chat/character/${card.id}`,
  search: async (p) => {
    const params = new URLSearchParams({
      q: p.query,
      page: String(Math.max(0, p.page - 1)),
      pageSize: "48",
      orderBy: p.sort,
      orderDescending: String(!p.sortAsc),
    });
    if (p.includeTags.length > 0) params.set("tagsInclude", p.includeTags.join(","));
    if (p.excludeTags.length > 0) params.set("tagsExclude", p.excludeTags.join(","));
    if (p.nsfw) params.set("includeSensitive", "true");
    const res = await fetch(`/api/bot-browser/pygmalion/search?${params}`);
    if (!res.ok) throw new Error("Search failed");
    const data = await res.json();
    const chars = data?.characters || [];
    const totalItems = parseInt(data?.totalItems || "0", 10);
    return {
      cards: chars.map((c: any) => {
        const owner = c.owner || {};
        const av = c.avatarUrl;
        let avatarProxyUrl = "";
        if (av) {
          avatarProxyUrl = av.startsWith("http")
            ? `/api/bot-browser/pygmalion/avatar/${encodeURIComponent(av)}`
            : `/api/bot-browser/pygmalion/avatar/${av}`;
        }
        return {
          id: c.id || "",
          name: c.displayName || "Unnamed",
          creator: owner.username || owner.displayName || "",
          tagline: c.description || "",
          tags: Array.isArray(c.tags) ? c.tags : [],
          avatarUrl: avatarProxyUrl,
          stat1: c.downloads || 0,
          stat1Label: "Downloads",
          stat1Icon: "download" as const,
          stat2: c.stars || 0,
          stat2Label: "Stars",
          stat2Icon: "star" as const,
          stat3: c.chatCount || 0,
          stat3Label: "Chats",
          stat3Icon: "message" as const,
          nsfw: !!c.isSensitive,
          externalUrl: `https://pygmalion.chat/character/${c.id}`,
          _raw: c,
        };
      }),
      totalCount: totalItems,
    };
  },
  fetchDetail: async (card) => {
    const res = await fetch(`/api/bot-browser/pygmalion/character?id=${card.id}`);
    if (!res.ok) return null;
    const data = await res.json();
    const char = data?.character;
    if (!char) return null;
    const p = char.personality || {};
    return {
      description: p.persona || undefined,
      firstMessage: p.greeting || undefined,
      exampleDialogs: p.mesExample || undefined,
      creatorNotes: p.characterNotes || undefined,
      alternateGreetings: Array.isArray(p.alternateGreetings) ? p.alternateGreetings.filter(Boolean) : [],
    };
  },
  importCard: async () => {},
};

// ════════════════════════════════════════════════
// Provider: Wyvern
// ════════════════════════════════════════════════

const wyvernProvider: ProviderConfig = {
  id: "wyvern",
  name: "Wyvern",
  icon: "🐉",
  siteName: "Wyvern",
  defaultSort: "popular",
  pageSize: 48,
  sortOptions: [
    { value: "popular", label: "🔥 Popular" },
    { value: "nsfw-popular", label: "🔞 Popular NSFW" },
    { value: "recommended", label: "⭐ Recommended" },
    { value: "created_at", label: "🆕 New" },
    { value: "votes", label: "❤️ Most Likes" },
    { value: "messages", label: "💬 Most Messages" },
  ],
  features: [
    { key: "lore", label: "Lorebook", icon: "📖" },
    { key: "greetings", label: "Alt Greetings", icon: "💬" },
  ],
  hasSortDirection: false,
  hasTokenFilters: true,
  extraToggles: [],
  nsfwAvailable: false,
  nsfwMode: "wyvern",
  getAvatarUrl: (card) => {
    const raw = card._raw as any;
    const src = raw?.avatar_url || raw?.avatar;
    if (!src) return "";
    if (src.startsWith("http")) return `/api/bot-browser/wyvern/avatar/${encodeURIComponent(src)}`;
    return `/api/bot-browser/wyvern/avatar/${src}/public`;
  },
  getExternalUrl: (card) => `https://app.wyvern.chat/characters/${card.id}`,
  search: async (p) => {
    const params = new URLSearchParams({ page: String(p.page), limit: "48", sort: p.sort });
    if (p.query) params.set("q", p.query);
    if (p.includeTags.length > 0) params.set("tags", p.includeTags.join(","));
    if (!p.nsfw && p.sort !== "nsfw-popular") params.set("rating", "none");
    const res = await fetch(`/api/bot-browser/wyvern/search?${params}`);
    if (!res.ok) throw new Error("Search failed");
    const data = await res.json();
    let results = data?.results || [];
    // Client-side exclude tag filtering (Wyvern API doesn't support server-side exclude)
    if (p.excludeTags.length > 0) {
      const lowerExclude = p.excludeTags.map((t) => t.toLowerCase());
      results = results.filter((c: any) => {
        const charTags = (c.tags || []).map((t: string) => t.toLowerCase());
        return !lowerExclude.some((et) => charTags.includes(et));
      });
    }
    return {
      cards: results.map((c: any) => {
        const sr = c.statistics_record || c.entity_statistics || {};
        const creatorName = c.creator?.displayName || c.creator?.username || "";
        const src = c.avatar_url || c.avatar;
        let avatarProxyUrl = "";
        if (src) {
          avatarProxyUrl = src.startsWith("http")
            ? `/api/bot-browser/wyvern/avatar/${encodeURIComponent(src)}`
            : `/api/bot-browser/wyvern/avatar/${src}/public`;
        }
        return {
          id: c.id || "",
          name: c.name || "Unnamed",
          creator: creatorName,
          tagline: c.tagline || "",
          tags: Array.isArray(c.tags) ? c.tags : [],
          avatarUrl: avatarProxyUrl,
          stat1: sr.likes || sr.total_likes || c.likes || 0,
          stat1Label: "Likes",
          stat1Icon: "heart" as const,
          stat2: sr.messages || sr.total_messages || c.messages || 0,
          stat2Label: "Messages",
          stat2Icon: "message" as const,
          stat3: sr.views || sr.total_views || c.views || 0,
          stat3Label: "Views",
          stat3Icon: "eye" as const,
          nsfw: !!(c.rating && c.rating !== "none"),
          externalUrl: `https://app.wyvern.chat/characters/${c.id}`,
          _raw: c,
        };
      }),
      totalCount: data?.total ?? (data?.hasMore ? (p.page + 1) * 48 : results.length),
    };
  },
  fetchDetail: async (card) => {
    const res = await fetch(`/api/bot-browser/wyvern/character/${card.id}`);
    if (!res.ok) return null;
    const c = await res.json();
    if (!c) return null;
    return {
      description: c.description || undefined,
      personality: c.personality || undefined,
      scenario: c.scenario || undefined,
      firstMessage: c.first_mes || undefined,
      exampleDialogs: c.mes_example || undefined,
      creatorNotes: c.creator_notes || undefined,
      alternateGreetings: Array.isArray(c.alternate_greetings) ? c.alternate_greetings.filter(Boolean) : [],
      hasLorebook: !!(c.lorebooks?.length > 0),
    };
  },
  importCard: async () => {},
};

// ════════════════════════════════════════════════
// Provider: DataCat
// (Aggregator surfacing JanitorAI characters via datacat.run REST API)
// ════════════════════════════════════════════════

// Cache of DataCat tags (name <-> id) populated from the faceted endpoint.
// Names are lowercased so user input from the tag panel can match either the
// upstream display name or any case variant.
//
// DataCat returns ~28k tags. Rendering all of them as buttons crashes the
// browser, so the tag panel only shows the top N most-popular tags
// (`datacatTopTagNames`); the full id<->name maps are still populated so
// custom user input and card-level resolution still work for the long tail.
const TOP_TAGS_DISPLAY_LIMIT = 150;
const datacatTagNameToId = new Map<string, number>();
const datacatTagIdToName = new Map<number, string>();
let datacatTopTagNames: string[] = [];
let datacatTagsLoaded = false;
let datacatTagsLoading: Promise<void> | null = null;

async function loadDatacatTags(): Promise<void> {
  if (datacatTagsLoaded) return;
  if (datacatTagsLoading) return datacatTagsLoading;
  datacatTagsLoading = (async () => {
    try {
      const res = await fetch("/api/bot-browser/datacat/tags");
      if (!res.ok) return;
      const data = await res.json();
      const list: any[] = data?.tags || data?.facets || data || [];
      const sortable: { id: number; name: string; count: number }[] = [];
      for (const t of list) {
        const id = Number(t?.id ?? t?.tag_id ?? t?.tagId);
        const name: string = (t?.name || t?.slug || "").toString();
        const count = Number(t?.count ?? 0) || 0;
        if (Number.isFinite(id) && name) {
          datacatTagNameToId.set(name.toLowerCase(), id);
          datacatTagIdToName.set(id, name);
          sortable.push({ id, name, count });
        }
      }
      sortable.sort((a, b) => b.count - a.count);
      datacatTopTagNames = sortable.slice(0, TOP_TAGS_DISPLAY_LIMIT).map((t) => t.name);
      datacatTagsLoaded = true;
    } finally {
      datacatTagsLoading = null;
    }
  })();
  return datacatTagsLoading;
}

function datacatTagNamesToIds(names: string[]): number[] {
  return names
    .map((n) => datacatTagNameToId.get(n.toLowerCase()))
    .filter((id): id is number => typeof id === "number");
}

const datacatProvider: ProviderConfig = {
  id: "datacat",
  name: "DataCat",
  icon: "🐱",
  siteName: "DataCat",
  defaultSort: "relevance",
  pageSize: 80,
  sortOptions: [
    { value: "relevance", label: "🔍 Relevance" },
    { value: "fresh", label: "🔥 Fresh" },
  ],
  features: [],
  hasSortDirection: false,
  hasTokenFilters: false,
  extraToggles: [],
  // DataCat is NSFW-only — hide the toggle since every character is NSFW-tagged
  nsfwAvailable: false,
  nsfwMode: "wyvern",
  getAvatarUrl: (card) => {
    const raw = card._raw as any;
    const av = raw?.avatar || "";
    if (!av) return "";
    if (av.startsWith("http")) return `/api/bot-browser/datacat/avatar/${encodeURIComponent(av)}`;
    return `/api/bot-browser/datacat/avatar/${av}`;
  },
  getExternalUrl: (card) => {
    const raw = card._raw as any;
    const id = raw?.characterId || raw?.character_id || card.id;
    return `https://datacat.run/characters/${id}`;
  },
  search: async (p) => {
    await loadDatacatTags();
    const tagIds = p.includeTags.length > 0 ? datacatTagNamesToIds(p.includeTags) : [];

    // Fresh = trending, Relevance = recent-public (which is the "Characters" tab on
    // datacat.run — supports tag filtering and shows the full library).
    const useFresh = p.sort === "fresh" && tagIds.length === 0 && !p.query;

    let list: any[] = [];
    let totalCount = 0;

    if (useFresh) {
      const params = new URLSearchParams({
        sortBy: "score",
        limit24: "80",
        limitWeek: "0",
      });
      const res = await fetch(`/api/bot-browser/datacat/fresh?${params}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      // Response shape: { success, sortBy, windows: { last24h: { count, characters: [...] }, thisWeek: {...} } }
      const last24h = data?.windows?.last24h || data?.last24h;
      list = Array.isArray(last24h) ? last24h : last24h?.characters || [];
      totalCount = data?.windows?.last24h?.count ?? list.length;
    } else {
      const offset = Math.max(0, (p.page - 1) * 80);
      const params = new URLSearchParams({ limit: "80", offset: String(offset) });
      if (tagIds.length > 0) params.set("tagIds", tagIds.join(","));
      const res = await fetch(`/api/bot-browser/datacat/recent?${params}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      list = data?.characters || [];
      totalCount = data?.totalCount || list.length;
    }

    // Client-side query filter (DataCat REST has no full-text search on these endpoints)
    if (p.query) {
      const q = p.query.toLowerCase();
      list = list.filter((c: any) => {
        const name = (c.chat_name || c.name || "").toLowerCase();
        return name.includes(q);
      });
    }
    // DataCat is NSFW-only — every character is tagged NSFW upstream, so filtering
    // by nsfw=false would always return an empty list. Skip the filter entirely.
    // Client-side excludeTags filter
    if (p.excludeTags.length > 0) {
      const lowerExclude = p.excludeTags.map((t) => t.toLowerCase());
      list = list.filter((c: any) => {
        const tagNames = (Array.isArray(c.tags) ? c.tags : [])
          .map((t: any) => (typeof t === "string" ? t : t?.name || t?.slug || ""))
          .map((s: string) => s.toLowerCase());
        return !lowerExclude.some((et) => tagNames.includes(et));
      });
    }

    return {
      cards: list.map((c: any) => {
        // Tags can come either as objects ({id,name,slug}), as strings, or as
        // numeric tagIds — try every shape and normalize to display names.
        const rawTags: any[] = Array.isArray(c.tags) ? c.tags : Array.isArray(c.tagIds) ? c.tagIds : [];
        const tagNames: string[] = rawTags
          .map((t: any) => {
            if (typeof t === "string") return t;
            if (typeof t === "number") return datacatTagIdToName.get(t) || "";
            return t?.name || t?.slug || (typeof t?.id === "number" ? datacatTagIdToName.get(t.id) || "" : "");
          })
          .filter(Boolean);
        const av = c.avatar || "";
        const avatarProxyUrl = av
          ? av.startsWith("http")
            ? `/api/bot-browser/datacat/avatar/${encodeURIComponent(av)}`
            : `/api/bot-browser/datacat/avatar/${av}`
          : "";
        const charId = c.characterId || c.character_id || c.id || "";
        return {
          id: charId,
          name: c.chatName || c.chat_name || c.name || "Unnamed",
          creator: c.creatorName || c.creator_name || "",
          tagline: (c.description || "").replace(/<[^>]*>/g, "").slice(0, 200),
          tags: tagNames,
          avatarUrl: avatarProxyUrl,
          stat1: c.chatCount || c.chat_count || 0,
          stat1Label: "Chats",
          stat1Icon: "message" as const,
          stat2: c.totalTokens || c.total_tokens || 0,
          stat2Label: "Tokens",
          stat2Icon: "hash" as const,
          stat3: 0,
          stat3Label: "",
          stat3Icon: "star" as const,
          nsfw: !!c.isNsfw,
          externalUrl: `https://datacat.run/characters/${charId}`,
          _raw: c,
        };
      }),
      totalCount,
    };
  },
  fetchDetail: async (card) => {
    const id = (card._raw as any)?.characterId || (card._raw as any)?.character_id || card.id;
    if (!id) return null;
    // Prefer the download endpoint for V2-shaped data, fall back to character endpoint
    try {
      const dlRes = await fetch(`/api/bot-browser/datacat/download/${encodeURIComponent(id)}`);
      if (dlRes.ok) {
        const dl = await dlRes.json();
        const d = dl?.data;
        if (d) {
          return {
            description: d.description || d.personality || undefined,
            personality: d.personality || undefined,
            scenario: d.scenario || undefined,
            firstMessage: d.first_mes || undefined,
            exampleDialogs: d.mes_example || undefined,
            creatorNotes: d.creator_notes || undefined,
            alternateGreetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.filter(Boolean) : [],
          };
        }
      }
    } catch {
      /* fall through */
    }
    try {
      const res = await fetch(`/api/bot-browser/datacat/character/${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const data = await res.json();
      const c = data?.character || data;
      if (!c) return null;
      const rawDesc = c.description || "";
      const plainDesc = typeof rawDesc === "string" ? rawDesc.replace(/<[^>]*>/g, "").trim() : "";
      return {
        description: c.personality || undefined,
        scenario: c.scenario || undefined,
        firstMessage: c.first_message || undefined,
        creatorNotes: plainDesc || undefined,
      };
    } catch {
      return null;
    }
  },
  importCard: async () => {},
};

// ════════════════════════════════════════════════
// Provider Registry
// ════════════════════════════════════════════════

const ALL_PROVIDERS: ProviderConfig[] = [
  chubProvider,
  jannyProvider,
  chartavernProvider,
  pygmalionProvider,
  wyvernProvider,
  datacatProvider,
];

function getProvider(id: string): ProviderConfig {
  return ALL_PROVIDERS.find((p) => p.id === id) ?? chubProvider;
}

// ════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════

export function BotBrowserView() {
  const qc = useQueryClient();
  const closeBotBrowser = useUIStore((s) => s.closeBotBrowser);

  const [sourceId, setSourceId] = useState("chub");
  const [sourceOpen, setSourceOpen] = useState(false);
  const provider = useMemo(() => getProvider(sourceId), [sourceId]);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(provider.defaultSort);
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [nsfw, setNsfwRaw] = useState(() => getPersistNsfw("chub"));
  const sourceIdRef = useRef(sourceId);
  sourceIdRef.current = sourceId;
  const setNsfw = useCallback((val: boolean) => {
    setNsfwRaw(val);
    setPersistNsfw(sourceIdRef.current, val);
  }, []);

  const [tagSearch, setTagSearch] = useState("");
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  const [showFiltersPanel, setShowFiltersPanel] = useState(false);
  const [minTokens, setMinTokens] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [extraToggles, setExtraToggles] = useState<Record<string, boolean>>({});

  const [results, setResults] = useState<BrowseCard[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCard, setSelectedCard] = useState<BrowseCard | null>(null);
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  // ── Auth state ──
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pygLoggedIn, setPygLoggedInRaw] = useState(() => getPersistLogin("pygmalion"));
  const [ctLoggedIn, setCtLoggedInRaw] = useState(() => getPersistLogin("chartavern"));
  const [loginLoading, setLoginLoading] = useState(false);

  const setPygLoggedIn = useCallback((val: boolean) => {
    setPygLoggedInRaw(val);
    setPersistLogin("pygmalion", val);
  }, []);
  const setCtLoggedIn = useCallback((val: boolean) => {
    setCtLoggedInRaw(val);
    setPersistLogin("chartavern", val);
  }, []);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── Check auth sessions on mount — sync persisted state with server ──
  useEffect(() => {
    fetch("/api/bot-browser/pygmalion/session")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.active && pygLoggedIn) {
          setPygLoggedIn(false);
          toast.info("Pygmalion session expired — please log in again.");
        } else if (d?.active) setPygLoggedIn(true);
      })
      .catch(() => {});
    fetch("/api/bot-browser/chartavern/session")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.active && ctLoggedIn) {
          setCtLoggedIn(false);
          toast.info("CharacterTavern session expired — please log in again.");
        } else if (d?.active) setCtLoggedIn(true);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Dynamically update nsfwAvailable based on auth ──
  const effectiveNsfwAvailable = useMemo(() => {
    if (provider.nsfwMode === "free") return true;
    if (provider.nsfwMode === "wyvern") return false;
    if (provider.nsfwMode === "login") {
      if (sourceId === "pygmalion") return pygLoggedIn;
      if (sourceId === "chartavern") return ctLoggedIn;
    }
    return provider.nsfwAvailable;
  }, [provider, sourceId, pygLoggedIn, ctLoggedIn]);

  const [datacatNsfwAcked, setDatacatNsfwAcked] = useState(false);
  const [pendingDatacatSwitch, setPendingDatacatSwitch] = useState(false);

  const performSwitch = useCallback((newId: string) => {
    const newProv = getProvider(newId);
    setSourceId(newId);
    setSourceOpen(false);
    setQuery("");
    setSort(newProv.defaultSort);
    setSortAsc(false);
    setPage(1);
    // DataCat is NSFW-only — every character is tagged NSFW upstream, force the flag on
    setNsfwRaw(newId === "datacat" ? true : getPersistNsfw(newId));
    setIncludeTags([]);
    setExcludeTags([]);
    setTagSearch("");
    setAvailableTags([]);
    setShowTagPanel(false);
    setShowFiltersPanel(false);
    setMinTokens("");
    setMaxTokens("");
    setFeatures({});
    setExtraToggles({});
    setResults([]);
    setTotalCount(0);
    setError(null);
    setSelectedCard(null);
    setDetail(null);
    setShowLoginModal(false);
  }, []);

  const switchProvider = useCallback(
    (newId: string) => {
      if (newId === "datacat" && !datacatNsfwAcked) {
        setSourceOpen(false);
        setPendingDatacatSwitch(true);
        return;
      }
      performSwitch(newId);
    },
    [datacatNsfwAcked, performSwitch],
  );

  useEffect(() => {
    const allTags = new Set<string>();
    for (const card of results) {
      if (card.tags) for (const t of card.tags) allTags.add(t);
    }
    setAvailableTags((prev) => {
      const merged = new Set([...prev, ...allTags]);
      return Array.from(merged).sort((a, b) => a.localeCompare(b));
    });
  }, [results]);

  // When DataCat is the active provider, eagerly populate the tag panel with
  // only the top-N most-popular DataCat tags. (The full ~28k tag list lives in
  // the module-level id<->name maps for resolution; rendering all of them as
  // buttons would freeze the browser.)
  useEffect(() => {
    if (sourceId !== "datacat") return;
    let cancelled = false;
    loadDatacatTags().then(() => {
      if (cancelled || datacatTopTagNames.length === 0) return;
      setAvailableTags((prev) => {
        const merged = new Set([...prev, ...datacatTopTagNames]);
        return Array.from(merged).sort((a, b) => a.localeCompare(b));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  const doSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await provider.search({
        query,
        page,
        sort,
        nsfw,
        includeTags,
        excludeTags,
        sortAsc,
        minTokens,
        maxTokens,
        features,
        extraToggles,
      });

      setResults(result.cards);
      setTotalCount(result.totalCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [
    provider,
    query,
    page,
    sort,
    nsfw,
    includeTags,
    excludeTags,
    sortAsc,
    minTokens,
    maxTokens,
    features,
    extraToggles,
  ]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(doSearch, query ? 400 : 0);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [doSearch, query]);

  const openDetail = async (card: BrowseCard) => {
    setSelectedCard(card);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await provider.fetchDetail(card);
      setDetail(d);
    } catch {
      toast.error("Failed to load character details");
      setSelectedCard(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleImport = async (card: BrowseCard) => {
    setImporting(true);
    try {
      let downloadUrl = "";
      if (sourceId === "chub") downloadUrl = `/api/bot-browser/chub/download/${card.id}`;
      else if (sourceId === "chartavern") downloadUrl = `/api/bot-browser/chartavern/download/${card.id}`;

      if (downloadUrl) {
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error("Failed to download character card");
        const blob = await res.blob();
        const file = new File([blob], "character.png", { type: "image/png" });
        const { json, imageDataUrl } = await parsePngCharacterCard(file);
        const importRes = await fetch("/api/import/st-character", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...json, _avatarDataUrl: imageDataUrl, _botBrowserSource: `${sourceId}:${card.id}` }),
        });
        const data = await importRes.json();
        if (data.success) {
          toast.success(`Imported "${data.name ?? "character"}" successfully!`);
          qc.invalidateQueries({ queryKey: characterKeys.list() });
          if (data.lorebook) qc.invalidateQueries({ queryKey: lorebookKeys.all });
        } else throw new Error(data.error ?? "Import failed");
      } else {
        let cardDetail = detail;
        if (!cardDetail) cardDetail = await provider.fetchDetail(card);
        // For extracted JanitorAI data, description contains the full personality definition
        const descriptionText = cardDetail?.description || "";
        const personalityText = cardDetail?.personality || "";
        const v2: Record<string, unknown> = {
          name: card.name,
          description: descriptionText || personalityText,
          personality: personalityText && descriptionText ? personalityText : "",
          scenario: cardDetail?.scenario || "",
          first_mes: cardDetail?.firstMessage || "",
          mes_example: cardDetail?.exampleDialogs || "",
          creator_notes: cardDetail?.creatorNotes || "",
          tags: card.tags,
          creator: card.creator,
          alternate_greetings: cardDetail?.alternateGreetings || [],
          extensions: { [`${sourceId}`]: { id: card.id } },
          _botBrowserSource: `${sourceId}:${card.id}`,
        };
        const avatarSrc = card.avatarUrl;
        if (avatarSrc) {
          try {
            const avatarRes = await fetch(avatarSrc);
            if (avatarRes.ok) {
              const avatarBlob = await avatarRes.blob();
              const reader = new FileReader();
              const dataUrl = await new Promise<string>((resolve) => {
                reader.onload = () => resolve(reader.result as string);
                reader.readAsDataURL(avatarBlob);
              });
              v2._avatarDataUrl = dataUrl;
            }
          } catch {
            /* ignore */
          }
        }
        const importRes = await fetch("/api/import/st-character", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v2),
        });
        const data = await importRes.json();
        if (data.success) {
          toast.success(`Imported "${data.name ?? card.name}" successfully!`);
          qc.invalidateQueries({ queryKey: characterKeys.list() });
          if (data.lorebook) qc.invalidateQueries({ queryKey: lorebookKeys.all });
        } else throw new Error(data.error ?? "Import failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const toggleIncludeTag = (tag: string) => {
    setIncludeTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
    setExcludeTags((prev) => prev.filter((t) => t !== tag));
    setPage(1);
  };
  const toggleExcludeTag = (tag: string) => {
    setExcludeTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
    setIncludeTags((prev) => prev.filter((t) => t !== tag));
    setPage(1);
  };
  const clearAllTags = () => {
    setIncludeTags([]);
    setExcludeTags([]);
    setPage(1);
  };

  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) return availableTags;
    const q = tagSearch.toLowerCase();
    return availableTags.filter((t) => t.toLowerCase().includes(q));
  }, [availableTags, tagSearch]);

  const addCustomTag = () => {
    const custom = tagSearch.trim().toLowerCase();
    if (custom.length >= 2 && !includeTags.includes(custom)) {
      setIncludeTags((prev) => [...prev, custom]);
      setTagSearch("");
      setPage(1);
    }
  };

  const toggleFeature = (key: string) => {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
    setPage(1);
  };
  const toggleExtra = (key: string) => {
    setExtraToggles((prev) => ({ ...prev, [key]: !prev[key] }));
    setPage(1);
  };

  const activeFeatureCount =
    provider.features.filter((f) => features[f.key]).length +
    provider.extraToggles.filter((t) => extraToggles[t.key]).length;
  const hasActiveFeatures = activeFeatureCount > 0;
  const canAddCustomTag = tagSearch.trim().length >= 2 && !includeTags.includes(tagSearch.trim().toLowerCase());
  const perPage = provider.pageSize;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

  const sortGroups = useMemo(() => {
    const groups: { label: string; options: SortOption[] }[] = [];
    for (const opt of provider.sortOptions) {
      const groupLabel = opt.group || "";
      let group = groups.find((g) => g.label === groupLabel);
      if (!group) {
        group = { label: groupLabel, options: [] };
        groups.push(group);
      }
      group.options.push(opt);
    }
    return groups;
  }, [provider]);

  // ── NSFW click handler ──
  const handleNsfwClick = (e: React.MouseEvent) => {
    if (effectiveNsfwAvailable) return; // Let the checkbox handle it
    e.preventDefault();
    if (sourceId === "wyvern") {
      toast.info('Use the "🔞 Popular NSFW" sort option to browse NSFW content on Wyvern.');
    } else if (provider.nsfwMode === "login") {
      setShowLoginModal(true);
    }
  };

  // ── Auth handlers ──
  const handlePygmalionSetToken = async (token: string) => {
    setLoginLoading(true);
    try {
      const res = await fetch("/api/bot-browser/pygmalion/set-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save token");

      // Validate
      const valRes = await fetch("/api/bot-browser/pygmalion/validate");
      const valData = await valRes.json();
      if (!valData.valid) throw new Error(valData.reason || "Token validation failed");

      setPygLoggedIn(true);
      setShowLoginModal(false);
      setNsfw(true);
      setPage(1);
      toast.success("Logged in to Pygmalion! NSFW content enabled.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Token validation failed");
    } finally {
      setLoginLoading(false);
    }
  };

  const handlePygmalionLogout = async () => {
    await fetch("/api/bot-browser/pygmalion/logout", { method: "POST" });
    setPygLoggedIn(false);
    setNsfw(false);
    setPage(1);
    toast.info("Logged out of Pygmalion.");
  };

  const handleCtSetCookie = async (cookie: string) => {
    setLoginLoading(true);
    try {
      const res = await fetch("/api/bot-browser/chartavern/set-cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to save cookie");

      // Validate
      const valRes = await fetch("/api/bot-browser/chartavern/validate");
      const valData = await valRes.json();
      if (!valData.valid) throw new Error(valData.reason || "Cookie validation failed");

      setCtLoggedIn(true);
      setShowLoginModal(false);
      setNsfw(true);
      setPage(1);
      toast.success(
        `Logged in to CharacterTavern! ${valData.hasNsfw ? "NSFW content detected." : "NSFW content enabled."}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cookie validation failed");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleCtLogout = async () => {
    await fetch("/api/bot-browser/chartavern/logout", { method: "POST" });
    setCtLoggedIn(false);
    setNsfw(false);
    setPage(1);
    toast.info("Logged out of CharacterTavern.");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ═══ Header ═══ */}
      <div className="relative flex h-12 flex-shrink-0 items-center gap-3 px-4">
        <div className="absolute inset-x-0 bottom-0 h-px bg-[var(--border)]/30" />
        <button
          onClick={closeBotBrowser}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft size="0.875rem" /> Back
        </button>
        <h2 className="text-sm font-semibold text-[var(--foreground)]">Browser</h2>
        <div className="relative ml-2">
          <button
            onClick={() => setSourceOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--accent)]"
          >
            <span>{provider.icon}</span>
            <span>{provider.name}</span>
            <ChevronDown size="0.625rem" className={cn("transition-transform", sourceOpen && "rotate-180")} />
          </button>
          {sourceOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl">
              {ALL_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => switchProvider(p.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs transition-colors",
                    p.id === sourceId
                      ? "bg-[var(--primary)]/15 text-[var(--primary)] font-semibold"
                      : "hover:bg-[var(--accent)]",
                  )}
                >
                  <span className="text-sm">{p.icon}</span>
                  <span>{p.name}</span>
                  {p.id === sourceId && <span className="ml-auto text-[0.6rem]">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Auth indicator for login providers */}
        {sourceId === "pygmalion" && pygLoggedIn && (
          <span className="ml-auto flex items-center gap-1 text-[0.65rem] text-emerald-400">
            <CheckCircle size="0.625rem" /> Logged in
          </span>
        )}
        {sourceId === "chartavern" && ctLoggedIn && (
          <span className="ml-auto flex items-center gap-1 text-[0.65rem] text-emerald-400">
            <CheckCircle size="0.625rem" /> Session active
          </span>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ═══ Tag Sidebar ═══ */}
        {showTagPanel && (
          <div className="flex w-[260px] flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)]/50">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <Tag size="0.75rem" /> Tags
              </span>
              <div className="flex items-center gap-1">
                {(includeTags.length > 0 || excludeTags.length > 0) && (
                  <button
                    onClick={clearAllTags}
                    className="rounded px-1.5 py-0.5 text-[0.6rem] text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setShowTagPanel(false)}
                  className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                >
                  <X size="0.75rem" />
                </button>
              </div>
            </div>
            <div className="px-3 py-2">
              <input
                type="text"
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomTag();
                  }
                }}
                placeholder="Search tags..."
                className="w-full rounded-md border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[var(--primary)]"
              />
            </div>
            {(includeTags.length > 0 || excludeTags.length > 0) && (
              <div className="flex flex-wrap gap-1 border-b border-[var(--border)] px-3 pb-2">
                {includeTags.map((tag) => (
                  <span
                    key={`inc-${tag}`}
                    onClick={() => toggleIncludeTag(tag)}
                    className="cursor-pointer rounded-full bg-emerald-500/20 px-2 py-0.5 text-[0.6rem] font-medium text-emerald-400 ring-1 ring-emerald-500/30 transition-colors hover:bg-emerald-500/30"
                  >
                    + {tag}
                  </span>
                ))}
                {excludeTags.map((tag) => (
                  <span
                    key={`exc-${tag}`}
                    onClick={() => toggleExcludeTag(tag)}
                    className="cursor-pointer rounded-full bg-red-500/20 px-2 py-0.5 text-[0.6rem] font-medium text-red-400 ring-1 ring-red-500/30 transition-colors hover:bg-red-500/30"
                  >
                    − {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-1 py-1">
              {canAddCustomTag && (
                <div className="mx-1 mb-1 flex flex-col gap-1">
                  <button
                    onClick={addCustomTag}
                    className="flex w-full items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20"
                  >
                    + Add <strong>{tagSearch.trim().toLowerCase()}</strong> as filter
                  </button>
                  <button
                    onClick={() => {
                      const custom = tagSearch.trim().toLowerCase();
                      if (custom.length >= 2 && !excludeTags.includes(custom)) {
                        setExcludeTags((prev) => [...prev, custom]);
                        setIncludeTags((prev) => prev.filter((t) => t !== custom));
                        setTagSearch("");
                        setPage(1);
                      }
                    }}
                    className="flex w-full items-center gap-1.5 rounded-md bg-red-500/10 px-2 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
                  >
                    − Block <strong>{tagSearch.trim().toLowerCase()}</strong> from results
                  </button>
                </div>
              )}
              {filteredTags.length === 0 && !canAddCustomTag ? (
                <div className="px-2 py-4 text-center text-[0.65rem] italic text-[var(--muted-foreground)]">
                  {availableTags.length === 0 ? "Tags will appear after searching" : "No tags match filter"}
                </div>
              ) : (
                filteredTags.map((tag) => {
                  const isIncluded = includeTags.includes(tag);
                  const isExcluded = excludeTags.includes(tag);
                  return (
                    <div
                      key={tag}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-[var(--accent)]/50"
                    >
                      <button
                        onClick={() => toggleIncludeTag(tag)}
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[0.5rem] transition-all",
                          isIncluded
                            ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                            : "border-[var(--border)] hover:border-emerald-500/50",
                        )}
                      >
                        {isIncluded && "✓"}
                      </button>
                      <span className="min-w-0 flex-1 truncate">{tag}</span>
                      <button
                        onClick={() => toggleExcludeTag(tag)}
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[0.5rem] transition-all",
                          isExcluded
                            ? "border-red-500 bg-red-500/20 text-red-400"
                            : "border-red-500/30 text-red-400/40 hover:border-red-500/60 hover:text-red-400 hover:bg-red-500/10",
                        )}
                      >
                        −
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ═══ Main area ═══ */}
        <div className="flex-1 overflow-y-auto p-4">
          {selectedCard ? (
            <DetailView
              card={selectedCard}
              detail={detail}
              loading={detailLoading}
              importing={importing}
              provider={provider}
              onBack={() => {
                setSelectedCard(null);
                setDetail(null);
              }}
              onImport={handleImport}
              onDetailUpdate={setDetail}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {/* ═══ Toolbar ═══ */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search
                    size="0.875rem"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
                  />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search characters..."
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] py-2 pl-9 pr-8 text-sm text-[var(--foreground)] placeholder-[var(--muted-foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                  />
                  {query && (
                    <button
                      onClick={() => setQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                    >
                      <X size="0.75rem" />
                    </button>
                  )}
                </div>

                <select
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none"
                >
                  {sortGroups.map((group) =>
                    group.label ? (
                      <optgroup key={group.label} label={group.label}>
                        {group.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      group.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))
                    ),
                  )}
                </select>

                <button
                  onClick={() => setShowTagPanel((v) => !v)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors",
                    showTagPanel || includeTags.length > 0 || excludeTags.length > 0
                      ? "border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]"
                      : "border-[var(--border)] bg-[var(--secondary)] hover:bg-[var(--accent)]",
                  )}
                >
                  <Tag size="0.75rem" /> Tags
                  {(includeTags.length > 0 || excludeTags.length > 0) && (
                    <span className="rounded-full bg-[var(--primary)]/20 px-1.5 text-[0.6rem] font-semibold">
                      {includeTags.length + excludeTags.length}
                    </span>
                  )}
                </button>

                {(provider.features.length > 0 ||
                  provider.hasSortDirection ||
                  provider.hasTokenFilters ||
                  provider.extraToggles.length > 0) && (
                  <button
                    onClick={() => setShowFiltersPanel((v) => !v)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors",
                      showFiltersPanel || hasActiveFeatures
                        ? "border-[var(--primary)]/40 bg-[var(--primary)]/10 text-[var(--primary)]"
                        : "border-[var(--border)] bg-[var(--secondary)] hover:bg-[var(--accent)]",
                    )}
                  >
                    <SlidersHorizontal size="0.75rem" /> Filters
                    {hasActiveFeatures && (
                      <span className="rounded-full bg-[var(--primary)]/20 px-1.5 text-[0.6rem] font-semibold">
                        {activeFeatureCount}
                      </span>
                    )}
                  </button>
                )}

                {/* NSFW toggle */}
                {(() => {
                  const isLoginProvider = provider.nsfwMode === "login";
                  const isLoggedInForProvider =
                    (sourceId === "pygmalion" && pygLoggedIn) || (sourceId === "chartavern" && ctLoggedIn);
                  const nsfwGreyedOut = isLoginProvider && isLoggedInForProvider;
                  return (
                    <label
                      className={cn(
                        "flex select-none items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-xs",
                        nsfwGreyedOut
                          ? "cursor-not-allowed opacity-40"
                          : effectiveNsfwAvailable
                            ? "cursor-pointer"
                            : "cursor-pointer opacity-50",
                      )}
                      title={
                        nsfwGreyedOut
                          ? "NSFW depends on your account settings"
                          : effectiveNsfwAvailable
                            ? "Toggle NSFW content"
                            : sourceId === "wyvern"
                              ? 'Use the "Popular NSFW" sort option'
                              : sourceId === "datacat"
                                ? "DataCat is NSFW-only"
                                : `Click to log in to ${provider.name} for NSFW content`
                      }
                      onClick={nsfwGreyedOut ? (e: React.MouseEvent) => e.preventDefault() : handleNsfwClick}
                    >
                      <input
                        type="checkbox"
                        checked={nsfwGreyedOut ? true : nsfw}
                        disabled={nsfwGreyedOut || !effectiveNsfwAvailable}
                        onChange={(e) => {
                          if (!nsfwGreyedOut && effectiveNsfwAvailable) {
                            setNsfw(e.target.checked);
                            setPage(1);
                          }
                        }}
                        className="accent-[var(--primary)]"
                      />{" "}
                      NSFW
                      {nsfwGreyedOut && (
                        <span className="ml-0.5 text-[0.55rem] text-[var(--muted-foreground)]">(account)</span>
                      )}
                      {!nsfwGreyedOut && isLoginProvider && !effectiveNsfwAvailable && (
                        <LogIn size="0.625rem" className="ml-0.5 opacity-70" />
                      )}
                    </label>
                  );
                })()}

                {/* Login button / auth info / logout for providers requiring login */}
                {provider.nsfwMode === "login" &&
                  ((sourceId === "pygmalion" && pygLoggedIn) || (sourceId === "chartavern" && ctLoggedIn) ? (
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[0.65rem] text-emerald-400">
                        <CheckCircle size="0.625rem" /> NSFW depends on your account settings
                      </span>
                      <button
                        onClick={() => {
                          if (sourceId === "pygmalion") handlePygmalionLogout();
                          else if (sourceId === "chartavern") handleCtLogout();
                        }}
                        className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-2 text-[0.65rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--destructive)]"
                        title="Log out"
                      >
                        <LogOut size="0.625rem" /> Logout
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowLoginModal(true)}
                      className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-xs transition-colors hover:bg-[var(--accent)]"
                    >
                      <LogIn size="0.75rem" /> Log In
                    </button>
                  ))}
                {sourceId === "wyvern" && (
                  <span className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[0.65rem] text-amber-400">
                    Use "🔞 Popular NSFW" sort for NSFW content
                  </span>
                )}

                <button
                  onClick={doSearch}
                  className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2 text-xs transition-colors hover:bg-[var(--accent)]"
                  title="Refresh"
                >
                  <RefreshCw size="0.75rem" />
                </button>
              </div>

              {/* ═══ Filters panel ═══ */}
              {showFiltersPanel && (
                <div className="flex flex-wrap gap-6 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/50 px-4 py-3">
                  {(provider.features.length > 0 || provider.extraToggles.length > 0) && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                        Character Must Have
                      </span>
                      {provider.features.map((f) => (
                        <label key={f.key} className="flex cursor-pointer items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={!!features[f.key]}
                            onChange={() => toggleFeature(f.key)}
                            className="accent-[var(--primary)]"
                          />
                          <span>
                            {f.icon} {f.label}
                          </span>
                        </label>
                      ))}
                      {provider.extraToggles.map((t) => (
                        <label key={t.key} className="flex cursor-pointer items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={!!extraToggles[t.key]}
                            onChange={() => toggleExtra(t.key)}
                            className="accent-[var(--primary)]"
                          />
                          <span>
                            {t.icon} {t.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                  {(provider.hasSortDirection || provider.hasTokenFilters) && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                        Advanced Options
                      </span>
                      {provider.hasSortDirection && (
                        <div className="flex items-center gap-2">
                          <label className="w-24 text-xs text-[var(--muted-foreground)]">Sort Direction</label>
                          <select
                            value={sortAsc ? "asc" : "desc"}
                            onChange={(e) => {
                              setSortAsc(e.target.value === "asc");
                              setPage(1);
                            }}
                            className="rounded border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs outline-none"
                          >
                            <option value="desc">Descending</option>
                            <option value="asc">Ascending</option>
                          </select>
                        </div>
                      )}
                      {provider.hasTokenFilters && (
                        <>
                          <div className="flex items-center gap-2">
                            <label className="w-24 text-xs text-[var(--muted-foreground)]">Min Tokens</label>
                            <input
                              type="number"
                              value={minTokens}
                              onChange={(e) => {
                                setMinTokens(e.target.value);
                                setPage(1);
                              }}
                              placeholder="50"
                              className="w-20 rounded border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs outline-none focus:border-[var(--primary)]"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="w-24 text-xs text-[var(--muted-foreground)]">Max Tokens</label>
                            <input
                              type="number"
                              value={maxTokens}
                              onChange={(e) => {
                                setMaxTokens(e.target.value);
                                setPage(1);
                              }}
                              placeholder="100000"
                              className="w-20 rounded border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs outline-none focus:border-[var(--primary)]"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ═══ Results ═══ */}
              {loading ? (
                <div className="flex flex-1 items-center justify-center py-12">
                  <Loader2 size="1.5rem" className="animate-spin text-[var(--muted-foreground)]" />
                </div>
              ) : error ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
                  <span className="text-sm text-[var(--destructive)]">{error}</span>
                  <button
                    onClick={doSearch}
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)]/15 px-4 py-2 text-xs font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/25"
                  >
                    <RefreshCw size="0.75rem" /> Retry
                  </button>
                </div>
              ) : results.length === 0 ? (
                <div className="flex flex-1 items-center justify-center py-12 text-sm text-[var(--muted-foreground)]">
                  No characters found
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {results.map((card) => (
                      <CardTile key={card.id} card={card} onClick={() => openDetail(card)} />
                    ))}
                  </div>
                  {(totalPages > 1 || page > 1) && (
                    <div className="flex items-center justify-center gap-2 pt-2 pb-4">
                      <button
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        Page {page}
                        {totalPages > 1 && totalPages < 9000 ? ` of ${totalPages}` : ""}
                      </span>
                      <button
                        disabled={page >= totalPages && totalPages > 1}
                        onClick={() => setPage((p) => p + 1)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Login Modal ═══ */}
      {showLoginModal && (
        <LoginModal
          sourceId={sourceId}
          provider={provider}
          pygLoggedIn={pygLoggedIn}
          ctLoggedIn={ctLoggedIn}
          loginLoading={loginLoading}
          onClose={() => setShowLoginModal(false)}
          onPygSetToken={handlePygmalionSetToken}
          onPygLogout={handlePygmalionLogout}
          onCtSetCookie={handleCtSetCookie}
          onCtLogout={handleCtLogout}
        />
      )}

      {/* ═══ DataCat NSFW Warning ═══ */}
      {pendingDatacatSwitch && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingDatacatSwitch(false);
          }}
        >
          <div className="absolute inset-0 bg-black/60" onClick={() => setPendingDatacatSwitch(false)} />
          <div
            className="relative w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
                <span className="text-amber-400">⚠️</span> DataCat is NSFW only
              </h3>
              <button
                onClick={() => setPendingDatacatSwitch(false)}
                className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              >
                <X size="1rem" />
              </button>
            </div>
            <div className="flex flex-col gap-3 p-5 text-sm text-[var(--foreground)]">
              <p>
                Every character on DataCat is tagged NSFW upstream, so the NSFW filter is locked on for this provider.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    setDatacatNsfwAcked(true);
                    setPendingDatacatSwitch(false);
                    performSwitch("datacat");
                  }}
                  className="flex-1 rounded-lg bg-pink-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-pink-500"
                >
                  Continue to DataCat
                </button>
                <button
                  onClick={() => setPendingDatacatSwitch(false)}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-4 py-2 text-xs font-medium transition-colors hover:bg-[var(--accent)]"
                >
                  Don't continue to DataCat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════
// Login Modal
// ════════════════════════════════════════════════

function LoginModal({
  sourceId,
  provider: _provider,
  pygLoggedIn,
  ctLoggedIn,
  loginLoading,
  onClose,
  onPygSetToken,
  onPygLogout,
  onCtSetCookie,
  onCtLogout,
}: {
  sourceId: string;
  provider: ProviderConfig;
  pygLoggedIn: boolean;
  ctLoggedIn: boolean;
  loginLoading: boolean;
  onClose: () => void;
  onPygSetToken: (t: string) => void;
  onPygLogout: () => void;
  onCtSetCookie: (c: string) => void;
  onCtLogout: () => void;
}) {
  const [pygTokenInput, setPygTokenInput] = useState("");
  const [cookie, setCookie] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [showPygHelp, setShowPygHelp] = useState(false);

  const isPyg = sourceId === "pygmalion";
  const isCt = sourceId === "chartavern";
  const isLoggedIn = isPyg ? pygLoggedIn : ctLoggedIn;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
            {isPyg ? (
              <>
                <KeyRound size="1rem" className="text-amber-400" /> Pygmalion Authentication
              </>
            ) : (
              <>
                <Cookie size="1rem" className="text-amber-400" /> CharacterTavern Session
              </>
            )}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <X size="1rem" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {/* Info boxes */}
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-[var(--foreground)]">
            <span className="mr-1.5 text-emerald-400">✅</span>
            <strong>Browsing and downloading public characters works without logging in!</strong>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-[var(--foreground)]">
            <span className="mr-1.5">🔑</span>
            <strong>Optional:</strong>{" "}
            {isPyg
              ? "Paste your auth token to enable NSFW content and access authenticated character data."
              : "Paste your session cookies to see NSFW-tagged content."}
          </div>

          {/* Login form */}
          {isPyg ? (
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Auth Token</label>
                <textarea
                  value={pygTokenInput}
                  onChange={(e) => setPygTokenInput(e.target.value)}
                  disabled={isLoggedIn || loginLoading}
                  placeholder="Paste your Pygmalion auth token here"
                  rows={3}
                  className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 font-mono text-xs outline-none transition-colors focus:border-[var(--primary)] disabled:opacity-50"
                />
              </div>
              <details open={showPygHelp} onToggle={(e) => setShowPygHelp((e.target as HTMLDetailsElement).open)}>
                <summary className="cursor-pointer text-xs font-medium text-blue-400 hover:underline">
                  ▸ ❓ How to get your auth token
                </summary>
                <div className="mt-2 flex flex-col gap-1.5 rounded-lg bg-[var(--secondary)] p-3 text-[0.7rem] leading-relaxed text-[var(--muted-foreground)]">
                  <p>
                    1. Go to{" "}
                    <a
                      href="https://pygmalion.chat"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 underline"
                    >
                      pygmalion.chat
                    </a>{" "}
                    and log in
                  </p>
                  <p>
                    2. Open DevTools (F12) → <strong>Application</strong> tab → <strong>Local Storage</strong>
                  </p>
                  <p>
                    3. Find the entry named <code className="rounded bg-[var(--accent)] px-1">authn</code>
                  </p>
                  <p>
                    4. Copy its <strong>Value</strong> (a long string, ~705 characters) and paste it above
                  </p>
                </div>
              </details>
              {isLoggedIn && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle size="0.75rem" /> Token active — NSFW content enabled
                </div>
              )}
              <div className="flex items-center gap-2">
                {!isLoggedIn ? (
                  <button
                    onClick={() => onPygSetToken(pygTokenInput)}
                    disabled={loginLoading || !pygTokenInput.trim()}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {loginLoading ? <Loader2 size="0.75rem" className="animate-spin" /> : <KeyRound size="0.75rem" />}{" "}
                    Save & Connect
                  </button>
                ) : (
                  <button
                    onClick={onPygLogout}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-4 py-2 text-xs font-medium transition-colors hover:bg-[var(--accent)]"
                  >
                    <LogOut size="0.75rem" /> Log Out
                  </button>
                )}
                <a
                  href="https://pygmalion.chat"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-4 py-2 text-xs font-medium transition-colors hover:bg-[var(--accent)]"
                >
                  <ExternalLink size="0.75rem" /> Website
                </a>
              </div>
            </div>
          ) : isCt ? (
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Cookie String</label>
                <textarea
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  disabled={isLoggedIn || loginLoading}
                  placeholder="Paste your session cookie value here"
                  rows={3}
                  className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--primary)] disabled:opacity-50"
                />
              </div>
              <details open={showHelp} onToggle={(e) => setShowHelp((e.target as HTMLDetailsElement).open)}>
                <summary className="cursor-pointer text-xs font-medium text-blue-400 hover:underline">
                  ▸ ❓ How to get your session cookie
                </summary>
                <div className="mt-2 flex flex-col gap-1.5 rounded-lg bg-[var(--secondary)] p-3 text-[0.7rem] leading-relaxed text-[var(--muted-foreground)]">
                  <p>
                    1. Go to{" "}
                    <a
                      href="https://character-tavern.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 underline"
                    >
                      character-tavern.com
                    </a>{" "}
                    and log in
                  </p>
                  <p>2. Open DevTools (F12) → Application tab → Cookies</p>
                  <p>
                    3. Find the <code className="rounded bg-[var(--accent)] px-1">session</code> cookie
                  </p>
                  <p>
                    4. Copy its <strong>Value</strong> and paste it above
                  </p>
                </div>
              </details>
              {isLoggedIn && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle size="0.75rem" /> Session active — NSFW content enabled
                </div>
              )}
              <div className="flex items-center gap-2">
                {!isLoggedIn ? (
                  <button
                    onClick={() => onCtSetCookie(cookie)}
                    disabled={loginLoading || !cookie.trim()}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {loginLoading ? <Loader2 size="0.75rem" className="animate-spin" /> : <Cookie size="0.75rem" />}{" "}
                    Save & Connect
                  </button>
                ) : (
                  <button
                    onClick={onCtLogout}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-4 py-2 text-xs font-medium transition-colors hover:bg-[var(--accent)]"
                  >
                    <LogOut size="0.75rem" /> Log Out
                  </button>
                )}
                <a
                  href="https://character-tavern.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-4 py-2 text-xs font-medium transition-colors hover:bg-[var(--accent)]"
                >
                  <ExternalLink size="0.75rem" /> CharacterTavern
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════
// Card Tile
// ════════════════════════════════════════════════

function CardTile({ card, onClick }: { card: BrowseCard; onClick: () => void }) {
  const [imgError, setImgError] = useState(false);
  const Stat1Icon = STAT_ICONS[card.stat1Icon];
  const Stat2Icon = STAT_ICONS[card.stat2Icon];
  const Stat3Icon = STAT_ICONS[card.stat3Icon];

  return (
    <button
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] text-left transition-all hover:border-pink-500/40 hover:shadow-lg hover:shadow-pink-500/10 active:scale-[0.98]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-[var(--secondary)]">
        {imgError || !card.avatarUrl ? (
          <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]">
            <Hash size="2rem" />
          </div>
        ) : (
          <img
            src={card.avatarUrl}
            alt={card.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            onError={() => setImgError(true)}
          />
        )}
        {card.nsfw && (
          <span className="absolute left-1.5 top-1.5 rounded bg-red-500/80 px-1.5 py-0.5 text-[0.55rem] font-bold text-white">
            NSFW
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="truncate text-sm font-semibold text-[var(--foreground)]">{card.name}</h3>
        {card.creator && <p className="truncate text-xs text-[var(--muted-foreground)]">by {card.creator}</p>}
        {card.tagline && (
          <p className="line-clamp-2 text-xs text-[var(--muted-foreground)] opacity-70">{card.tagline}</p>
        )}
        <div className="mt-auto flex items-center gap-2 pt-1.5 text-[0.65rem] text-pink-400/80">
          {card.stat1 > 0 && card.stat1Label && (
            <span className="flex items-center gap-0.5" title={card.stat1Label}>
              <Stat1Icon size="0.625rem" /> {fmtNum(card.stat1)}
            </span>
          )}
          {card.stat2 > 0 && card.stat2Label && (
            <span className="flex items-center gap-0.5" title={card.stat2Label}>
              <Stat2Icon size="0.625rem" /> {fmtNum(card.stat2)}
            </span>
          )}
          {card.stat3 > 0 && card.stat3Label && (
            <span className="flex items-center gap-0.5" title={card.stat3Label}>
              <Stat3Icon size="0.625rem" /> {fmtNum(card.stat3)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ════════════════════════════════════════════════
// Detail View
// ════════════════════════════════════════════════

function DetailView({
  card,
  detail,
  loading,
  importing,
  provider,
  onBack,
  onImport,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onDetailUpdate,
}: {
  card: BrowseCard;
  detail: CardDetail | null;
  loading: boolean;
  importing: boolean;
  provider: ProviderConfig;
  onBack: () => void;
  onImport: (card: BrowseCard) => void;
  onDetailUpdate?: (detail: CardDetail) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const displayDetail = detail;
  const handleDownloadPng = async () => {
    setDownloading(true);
    try {
      const d = displayDetail;
      const descriptionText = d?.description || "";
      const personalityText = d?.personality || "";
      const charData: Record<string, unknown> = {
        name: card.name,
        description: descriptionText || personalityText,
        personality: personalityText && descriptionText ? personalityText : "",
        scenario: d?.scenario || "",
        first_mes: d?.firstMessage || "",
        mes_example: d?.exampleDialogs || "",
        creator_notes: d?.creatorNotes || "",
        tags: card.tags || [],
        creator: card.creator || "",
        alternate_greetings: d?.alternateGreetings || [],
        extensions: { [`${provider.id}`]: { id: card.id } },
      };

      const blob = await buildCharacterCardPng(card.avatarUrl, charData);

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(card.name || "character").replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded "${card.name}" as PNG character card!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <ChevronLeft size="0.875rem" /> Back to results
        </button>
        <div className="flex-1" />
        <a
          href={card.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <ExternalLink size="0.75rem" /> View on {provider.siteName}
        </a>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size="1.5rem" className="animate-spin text-[var(--muted-foreground)]" />
        </div>
      ) : (
        <div className="flex gap-5 max-md:flex-col">
          <div className="flex w-56 shrink-0 flex-col gap-3 max-md:w-full max-md:flex-row max-md:items-start">
            <div className="aspect-square w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--secondary)] max-md:w-32">
              {imgError || !card.avatarUrl ? (
                <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]">
                  <Hash size="2.5rem" />
                </div>
              ) : (
                <img
                  src={card.avatarUrl}
                  alt={card.name}
                  className="h-full w-full object-cover"
                  onError={() => setImgError(true)}
                />
              )}
            </div>
            <div className="flex flex-col gap-2 max-md:flex-1">
              <button
                onClick={() => onImport(card)}
                disabled={importing}
                className="flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-xs font-medium text-[var(--primary-foreground)] transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                {importing ? <Loader2 size="0.875rem" className="animate-spin" /> : <Download size="0.875rem" />}
                {importing ? "Importing..." : "Import"}
              </button>
              <button
                onClick={handleDownloadPng}
                disabled={downloading}
                className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-4 py-2 text-xs font-medium text-[var(--foreground)] transition-all hover:bg-[var(--accent)] active:scale-95 disabled:opacity-50"
              >
                {downloading ? <Loader2 size="0.75rem" className="animate-spin" /> : <Download size="0.75rem" />}
                {downloading ? "Building PNG..." : "Download as PNG"}
              </button>
              <div className="flex flex-col gap-1 rounded-lg bg-[var(--secondary)] p-2.5 text-xs text-pink-400/80">
                {card.stat1 > 0 && card.stat1Label && (
                  <span className="flex items-center gap-1.5">
                    {(() => {
                      const I = STAT_ICONS[card.stat1Icon];
                      return <I size="0.75rem" />;
                    })()}{" "}
                    {fmtNum(card.stat1)} {card.stat1Label.toLowerCase()}
                  </span>
                )}
                {card.stat2 > 0 && card.stat2Label && (
                  <span className="flex items-center gap-1.5">
                    {(() => {
                      const I = STAT_ICONS[card.stat2Icon];
                      return <I size="0.75rem" />;
                    })()}{" "}
                    {fmtNum(card.stat2)} {card.stat2Label.toLowerCase()}
                  </span>
                )}
                {card.stat3 > 0 && card.stat3Label && (
                  <span className="flex items-center gap-1.5">
                    {(() => {
                      const I = STAT_ICONS[card.stat3Icon];
                      return <I size="0.75rem" />;
                    })()}{" "}
                    {fmtNum(card.stat3)} {card.stat3Label.toLowerCase()}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div>
              <h3 className="text-lg font-bold text-[var(--foreground)]">{card.name}</h3>
              {card.creator && <p className="text-xs text-[var(--muted-foreground)]">by {card.creator}</p>}
            </div>
            {card.tagline && <p className="text-sm text-[var(--foreground)]/80">{card.tagline}</p>}
            {card.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {card.tags.slice(0, 20).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.65rem] text-[var(--muted-foreground)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {displayDetail ? (
              <div className="flex flex-col gap-3">
                {displayDetail.creatorNotes && (
                  <DefSection title="Creator's Notes" content={displayDetail.creatorNotes} />
                )}
                {displayDetail.description && (
                  <DefSection title="Description / Personality" content={displayDetail.description} />
                )}
                {displayDetail.personality && <DefSection title="Personality" content={displayDetail.personality} />}
                {displayDetail.scenario && <DefSection title="Scenario" content={displayDetail.scenario} />}
                {displayDetail.firstMessage && (
                  <DefSection title="First Message" content={displayDetail.firstMessage} />
                )}
                {displayDetail.alternateGreetings && displayDetail.alternateGreetings.length > 0 && (
                  <div>
                    <h4 className="mb-1 text-xs font-semibold text-[var(--foreground)]">
                      Alternate Greetings ({displayDetail.alternateGreetings.length})
                    </h4>
                    <div className="flex flex-col gap-1.5">
                      {displayDetail.alternateGreetings.map((g, i) => (
                        <div
                          key={i}
                          className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--secondary)] p-2.5 text-xs text-[var(--muted-foreground)]"
                        >
                          {g}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {displayDetail.exampleDialogs && (
                  <DefSection title="Example Dialogues" content={displayDetail.exampleDialogs} />
                )}
                {displayDetail.hasLorebook && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                    <CheckCircle size="0.75rem" /> Has embedded lorebook
                  </div>
                )}
                {displayDetail.extra?.map((section, i) => (
                  <DefSection key={i} title={section.title} content={section.content} />
                ))}
              </div>
            ) : (
              <div className="py-4 text-xs italic text-[var(--muted-foreground)]">
                {loading
                  ? "Loading character details..."
                  : "No detailed definition available. You can still import this character with basic info."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════
// Definition Section
// ════════════════════════════════════════════════

// ════════════════════════════════════════════════
// PNG Character Card Builder
// ════════════════════════════════════════════════

/** Build a SillyTavern-compatible PNG character card with embedded V2 JSON in a tEXt chunk. */
async function buildCharacterCardPng(avatarUrl: string, charData: Record<string, unknown>): Promise<Blob> {
  // Step 1: Fetch avatar and draw to canvas to get raw PNG bytes
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load avatar image"));
    img.src = avatarUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))), "image/png");
  });
  const pngBuf = new Uint8Array(await pngBlob.arrayBuffer());

  // Step 2: Build the V2 character card JSON
  const v2Card = {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: charData.name || "",
      description: charData.description || "",
      personality: charData.personality || "",
      scenario: charData.scenario || "",
      first_mes: charData.first_mes || "",
      mes_example: charData.mes_example || "",
      creator_notes: charData.creator_notes || "",
      system_prompt: "",
      post_history_instructions: "",
      tags: charData.tags || [],
      creator: charData.creator || "",
      character_version: "",
      alternate_greetings: charData.alternate_greetings || [],
      extensions: charData.extensions || {},
    },
  };

  // Step 3: Encode JSON as base64
  const jsonStr = JSON.stringify(v2Card);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  // Manual base64 encode that handles UTF-8 properly
  let binary = "";
  for (let i = 0; i < jsonBytes.length; i++) binary += String.fromCharCode(jsonBytes[i]);
  const b64 = btoa(binary);

  // Step 4: Build tEXt chunk: keyword("chara") + null byte + base64 text
  const keyword = new TextEncoder().encode("chara");
  const textData = new TextEncoder().encode(b64);
  const chunkPayload = new Uint8Array(keyword.length + 1 + textData.length);
  chunkPayload.set(keyword, 0);
  chunkPayload[keyword.length] = 0; // null separator
  chunkPayload.set(textData, keyword.length + 1);

  // Step 5: Calculate CRC32 for the chunk (type + data)
  const typeBytes = new TextEncoder().encode("tEXt");
  const crcInput = new Uint8Array(typeBytes.length + chunkPayload.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(chunkPayload, typeBytes.length);
  const crc = crc32(crcInput);

  // Step 6: Build the full chunk (length + type + data + crc)
  const chunkLength = chunkPayload.length;
  const fullChunk = new Uint8Array(4 + 4 + chunkLength + 4);
  // Length (big-endian)
  fullChunk[0] = (chunkLength >> 24) & 0xff;
  fullChunk[1] = (chunkLength >> 16) & 0xff;
  fullChunk[2] = (chunkLength >> 8) & 0xff;
  fullChunk[3] = chunkLength & 0xff;
  // Type
  fullChunk.set(typeBytes, 4);
  // Data
  fullChunk.set(chunkPayload, 8);
  // CRC (big-endian)
  fullChunk[8 + chunkLength] = (crc >> 24) & 0xff;
  fullChunk[9 + chunkLength] = (crc >> 16) & 0xff;
  fullChunk[10 + chunkLength] = (crc >> 8) & 0xff;
  fullChunk[11 + chunkLength] = crc & 0xff;

  // Step 7: Insert chunk before IEND in the PNG
  // Find IEND chunk (last 12 bytes typically: length(4) + "IEND"(4) + crc(4))
  let iendOffset = -1;
  for (let i = pngBuf.length - 12; i >= 8; i--) {
    if (pngBuf[i + 4] === 0x49 && pngBuf[i + 5] === 0x45 && pngBuf[i + 6] === 0x4e && pngBuf[i + 7] === 0x44) {
      iendOffset = i;
      break;
    }
  }
  if (iendOffset === -1) throw new Error("Could not find IEND chunk in PNG");

  // Build final PNG: everything before IEND + our tEXt chunk + IEND
  const beforeIend = pngBuf.slice(0, iendOffset);
  const iendChunk = pngBuf.slice(iendOffset);
  const finalPng = new Uint8Array(beforeIend.length + fullChunk.length + iendChunk.length);
  finalPng.set(beforeIend, 0);
  finalPng.set(fullChunk, beforeIend.length);
  finalPng.set(iendChunk, beforeIend.length + fullChunk.length);

  return new Blob([finalPng], { type: "image/png" });
}

/** CRC32 implementation for PNG chunk checksums */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  // Build table on first call
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crc32.table[n] = c;
    }
  }
  for (let i = 0; i < data.length; i++) {
    crc = crc32.table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
crc32.table = null as Uint32Array | null;

function DefSection({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-[var(--foreground)]">{title}</h4>
      <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--secondary)] p-2.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
        {content}
      </div>
    </div>
  );
}
