// ──────────────────────────────────────────────
// Encode a game-asset relative path for use in URLs.
// Splits on "/" and encodeURIComponent()s each segment so
// characters like #, ?, +, and spaces don't break the URL.
// ──────────────────────────────────────────────

/**
 * Encode a game-asset relative path for safe use in URLs.
 *
 * Splits the path on "/", runs `encodeURIComponent` on each segment,
 * then rejoins. This prevents `#`, `?`, `+`, and spaces from corrupting
 * `/api/game-assets/file/{path}` URLs.
 *
 * @param path - Relative path inside `data/game-assets/` (e.g. "sprites/hero.png")
 * @returns URL-safe encoded path (e.g. "sprites/hero.png")
 */
export function encodeAssetPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
