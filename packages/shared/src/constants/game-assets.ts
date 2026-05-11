// ──────────────────────────────────────────────
// Game-asset file-type constants (shared client + server)
// ──────────────────────────────────────────────

/** Image file extensions supported by the game-asset pipeline. */
export const IMAGE_EXTS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
]);

/** Audio file extensions supported by the game-asset pipeline. */
export const AUDIO_EXTS: ReadonlySet<string> = new Set([
  ".mp3",
  ".ogg",
  ".wav",
  ".flac",
  ".m4a",
  ".aac",
  ".webm",
]);

/** Text/code file extensions editable in the in-engine file browser. */
export const TEXT_EXTS: ReadonlySet<string> = new Set([
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".js",
  ".ts",
  ".tsx",
  ".css",
  ".html",
]);

/** MIME types for audio playback (used by <source type=...> hints). */
export const AUDIO_MIME_MAP: Readonly<Record<string, string>> = {
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".webm": "audio/webm",
};

/** MIME types for image responses (used by the server's file serving route). */
export const IMAGE_MIME_MAP: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

/** Combined MIME map for any game-asset file response. */
export const GAME_ASSET_MIME_MAP: Readonly<Record<string, string>> = {
  ...AUDIO_MIME_MAP,
  ...IMAGE_MIME_MAP,
};
