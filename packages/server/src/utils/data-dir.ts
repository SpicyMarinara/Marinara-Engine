// ──────────────────────────────────────────────
// Data Directory — single source of truth
//
// Resolves the runtime data directory (DB, gallery, avatars, sprites, …)
// independently of process.cwd() so the path is stable regardless of
// how the server is started (start.sh, Docker, pnpm start, dev mode).
//
//  Priority:
//    1. DATA_DIR environment variable  (explicit override)
//    2. <server-package-root>/data     (compatibility default)
// ──────────────────────────────────────────────
import { getDataDir as getConfiguredDataDir } from "../config/runtime-config.js";

/**
 * Absolute path to the runtime data directory.
 * Contains: DB, gallery images, avatars, backgrounds, sprites, fonts, knowledge-sources.
 */
export function getDataDir() {
  return getConfiguredDataDir();
}

export const DATA_DIR = getDataDir();
