// ──────────────────────────────────────────────
// Asset Fuzzy Matching
//
// Resolves descriptive/semantic asset tags from the
// GM model (e.g. "tense combat music") to real asset
// tags in the manifest using keyword overlap scoring.
// ──────────────────────────────────────────────

/**
 * Score how well a prose description matches an asset tag by keyword overlap.
 * The category word is excluded from scoring on both sides because it is the
 * universal prefix of every tag in the manifest — counting it would give
 * every candidate a free point and make the "first tag wins" tie-breaker
 * pick an arbitrary library bg for any novel scene.
 */
function tagScore(prose: string, tag: string, category: string): number {
  const categoryLower = category.toLowerCase();
  const words = prose
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && w !== categoryLower);
  const parts = tag
    .toLowerCase()
    .split(/[:\-_]+/)
    .filter((p) => p.length > 1 && p !== categoryLower);

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

/**
 * Find the best-matching tag for a prose description. For backgrounds we
 * require at least two specific-word overlaps so a brand-new location with
 * only the (already stripped) category prefix in common does not get pinned
 * to whichever library tag happens to come first in iteration order. Audio
 * categories keep the original ≥1 threshold — single-word matches like
 * "tense" or "combat" are meaningful in the deeper audio hierarchy and the
 * "no fuzzy match" fall-through for those categories is silent (returns the
 * original tag, no playback) rather than visually disruptive.
 */
function bestMatch(prose: string, tags: string[], category: string): string | null {
  if (!tags.length) return null;
  const minOverlap = category === "backgrounds" ? 2 : 1;
  let best: string | null = null;
  let bestScore = minOverlap - 1;
  for (const tag of tags) {
    const s = tagScore(prose, tag, category);
    if (s > bestScore) {
      bestScore = s;
      best = tag;
    }
  }
  return best;
}

/**
 * Resolve a potentially descriptive asset tag to a real manifest tag.
 * If the tag already exists in the manifest, returns it as-is.
 * Otherwise fuzzy-matches against tags in the given category.
 */
export function resolveAssetTag(
  tag: string,
  category: "music" | "sfx" | "backgrounds" | "ambient",
  manifest: Record<string, { path: string }> | null,
): string {
  if (!manifest) return tag;

  // Already an exact match
  if (manifest[tag]) return tag;

  // Collect tags in this category
  const categoryTags = Object.keys(manifest).filter((k) => k.startsWith(category + ":"));

  // Try fuzzy match
  const matched = bestMatch(tag, categoryTags, category);
  if (matched) {
    console.debug(`[asset-resolve] "${tag}" → "${matched}"`);
    return matched;
  }

  // For backgrounds, fall through to generated slug format
  if (category === "backgrounds") {
    const slug = tag
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
    const gen = `backgrounds:generated:${slug}`;
    console.debug(`[asset-resolve] "${tag}" → "${gen}" (no match, generated slug)`);
    return gen;
  }

  // No match — return original (will fail to resolve but won't crash)
  console.debug(`[asset-resolve] "${tag}" → no match in ${categoryTags.length} ${category} tags`);
  return tag;
}
