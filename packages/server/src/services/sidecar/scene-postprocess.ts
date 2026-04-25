// ──────────────────────────────────────────────
// Sidecar — Scene Post-Processing
//
// Fuzzy-matches the raw model output (which may
// contain prose descriptions instead of exact
// asset tags) against the available asset lists,
// normalizes expression labels, and filters
// widget updates to valid IDs.
// ──────────────────────────────────────────────

import type { SceneAnalysis, SceneSegmentEffect } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";

// ── Expression normalization ──

const VALID_EXPRESSIONS = new Set([
  "happy",
  "sad",
  "angry",
  "smirk",
  "surprised",
  "neutral",
  "worried",
  "thinking",
  "amused",
  "battle_stance",
  "frightened",
  "determined",
  "exhausted",
]);

/** keyword fragments → canonical expression  */
const EXPRESSION_MAP: [string[], string][] = [
  [["happy", "joy", "cheerful", "delighted", "pleased", "bright", "grinning"], "happy"],
  [["sad", "sorrow", "grief", "melanchol", "tearful", "dejected", "mournful"], "sad"],
  [["angry", "rage", "fury", "furious", "hostile", "irritat", "livid"], "angry"],
  [["smirk", "sly", "smug", "sardonic", "wry", "cunning", "scheming"], "smirk"],
  [["surprise", "shock", "startl", "astonish", "stun", "bewild"], "surprised"],
  [["worri", "anxious", "concern", "nervous", "uneasy", "apprehen"], "worried"],
  [["think", "ponder", "contemplat", "thoughtful", "calculat", "consider"], "thinking"],
  [["amuse", "playful", "entertai", "mischiev", "bemuse", "ironic", "clinical"], "amused"],
  [["battle", "fight", "combat", "stance", "ready", "poised", "brace"], "battle_stance"],
  [["fright", "fear", "terror", "scare", "horrif", "panic", "vulnerable"], "frightened"],
  [["determin", "resolv", "command", "precise", "focus", "steel", "stoic", "stern"], "determined"],
  [["exhaust", "tired", "fatigue", "weary", "drain", "spent", "collaps", "concuss", "disorient"], "exhausted"],
];

function normalizeExpression(value: string): string {
  const lower = value.toLowerCase().trim();
  // Direct hit (e.g. "amused")
  const firstWord = lower.split(/[\s,;.]+/)[0] ?? "";
  if (VALID_EXPRESSIONS.has(firstWord)) return firstWord;
  if (VALID_EXPRESSIONS.has(lower)) return lower;
  // Keyword scan
  for (const [keywords, expr] of EXPRESSION_MAP) {
    if (keywords.some((k) => lower.includes(k))) return expr;
  }
  return "neutral";
}

// ── Tag fuzzy-matching ──

/** Score how well a prose description matches an asset tag by keyword overlap. */
function tagScore(prose: string, tag: string): number {
  const words = prose
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const parts = tag
    .toLowerCase()
    .split(/[:\-_]+/)
    .filter((p) => p.length > 1);

  let score = 0;
  for (const part of parts) {
    for (const word of words) {
      if (part.includes(word) || word.includes(part)) {
        score++;
        break;
      }
    }
  }
  return score;
}

/** Find the best-matching tag for a prose description. */
function bestMatch(prose: string, tags: string[]): string | null {
  if (!tags.length) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const tag of tags) {
    const s = tagScore(prose, tag);
    if (s > bestScore) {
      bestScore = s;
      best = tag;
    }
  }
  return best;
}

// ── Public API ──

export interface PostProcessContext {
  availableBackgrounds: string[];
  availableSfx: string[];
  validWidgetIds: Set<string>;
  characterNames: string[];
}

/**
 * Post-process a single segment's per-beat effects:
 * fuzzy-match SFX and filter widget IDs.
 */
function postProcessSegment(seg: SceneSegmentEffect, ctx: PostProcessContext): SceneSegmentEffect {
  const out = { ...seg };

  // Background — fuzzy-match or synthesise generated tag
  if (out.background && out.background !== "null") {
    if (!ctx.availableBackgrounds.includes(out.background)) {
      if (out.background.startsWith("backgrounds:generated:")) {
        // Already valid generated format
      } else {
        const matched = bestMatch(out.background, ctx.availableBackgrounds);
        if (matched) {
          logger.debug(`[postprocess] seg[${seg.segment}] bg: "${out.background}" → "${matched}"`);
          out.background = matched;
        } else {
          const slug = out.background
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 50);
          const gen = `backgrounds:generated:${slug}`;
          logger.debug(`[postprocess] seg[${seg.segment}] bg: "${out.background}" → "${gen}" (no tag match)`);
          out.background = gen;
        }
      }
    }
  } else {
    out.background = undefined;
  }

  // SFX
  if (out.sfx?.length) {
    const matched: string[] = [];
    for (const item of out.sfx) {
      if (ctx.availableSfx.includes(item)) {
        matched.push(item);
      } else {
        const m = bestMatch(item, ctx.availableSfx);
        if (m && !matched.includes(m)) {
          logger.debug(`[postprocess] seg[${seg.segment}] sfx: "${item}" → "${m}"`);
          matched.push(m);
        } else {
          logger.debug(`[postprocess] seg[${seg.segment}] sfx: "${item}" → dropped`);
        }
      }
    }
    out.sfx = matched;
  }

  // Widget Updates
  if (out.widgetUpdates?.length) {
    const before = out.widgetUpdates.length;
    out.widgetUpdates = out.widgetUpdates.filter((wu) => ctx.validWidgetIds.has(wu.widgetId));
    if (out.widgetUpdates.length !== before) {
      logger.debug(
        `[postprocess] seg[${seg.segment}] widgets: ${before} → ${out.widgetUpdates.length} (invalid IDs removed)`,
      );
    }
  }

  return out;
}

/**
 * Clean up the raw model output so every field uses real asset tags,
 * valid expression labels, and existing widget IDs.
 */
export function postProcessSceneResult(raw: SceneAnalysis, ctx: PostProcessContext): SceneAnalysis {
  const result = { ...raw };

  // ── Sanitize string "null" → actual null (grammar sometimes emits the string) ──
  if (result.background === "null") result.background = null;
  if (result.music === "null") result.music = null;
  if (result.ambient === "null") result.ambient = null;
  if (result.weather === "null") result.weather = null;
  if (result.timeOfDay === "null") result.timeOfDay = null;

  // ── Background ──
  if (result.background && !ctx.availableBackgrounds.includes(result.background)) {
    // If the model already output a backgrounds:generated:* tag, leave it as-is
    if (result.background.startsWith("backgrounds:generated:")) {
      // Already valid generated format — no change needed
    } else {
      const matched = bestMatch(result.background, ctx.availableBackgrounds);
      if (matched) {
        logger.debug(`[postprocess] bg: "${result.background}" → "${matched}"`);
        result.background = matched;
      } else {
        // Synthesise a generated-background slug the client can render
        const slug = result.background
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 50);
        const gen = `backgrounds:generated:${slug}`;
        logger.debug(`[postprocess] bg: "${result.background}" → "${gen}" (no tag match)`);
        result.background = gen;
      }
    }
  }

  // Music and ambient are scored deterministically by scoreMusic/scoreAmbient on the server.
  // The LLM is no longer asked to produce these fields, so no postprocessing needed.

  // ── Weather — map non-visual values to visual equivalents ──
  if (result.weather) {
    const weatherMap: Record<string, string> = {
      cold: "frost",
      hot: "clear",
      freezing: "frost",
    };
    const mapped = weatherMap[result.weather.toLowerCase()];
    if (mapped) {
      logger.debug(`[postprocess] weather: "${result.weather}" → "${mapped}"`);
      result.weather = mapped;
    }
  }

  // ── Top-level widget updates — now handled by the GM model, not sidecar ──
  // Clear any stale widgetUpdates the sidecar might still produce
  if (result.widgetUpdates?.length) {
    logger.debug(
      `[postprocess] Ignoring ${result.widgetUpdates.length} sidecar widgetUpdates (GM handles widgets now)`,
    );
    result.widgetUpdates = [];
  }

  // ── Segment Effects (per-beat) ──
  if (result.segmentEffects?.length) {
    result.segmentEffects = result.segmentEffects.map((seg) => postProcessSegment(seg, ctx));
  }

  return result;
}
