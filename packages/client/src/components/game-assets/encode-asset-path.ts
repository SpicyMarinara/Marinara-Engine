// ──────────────────────────────────────────────
// Encode a game-asset relative path for use in URLs.
// Splits on "/" and encodeURIComponent()s each segment so
// characters like #, ?, +, and spaces don't break the URL.
// ──────────────────────────────────────────────
export function encodeAssetPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
