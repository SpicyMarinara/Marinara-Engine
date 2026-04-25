// ──────────────────────────────────────────────
// Seed: Default Game Assets
// Copies bundled game-mode assets (music, SFX, sprites)
// into the data/game-assets directory on first boot.
// All assets are CC0 — see CREDITS.md in the bundle.
// ──────────────────────────────────────────────
import { logger } from "../lib/logger.js";
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { GAME_ASSETS_DIR } from "../services/game/asset-manifest.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_DIR = join(__dirname, "..", "assets", "default-game-assets");

/**
 * Recursively copy a source directory into a destination,
 * skipping files that already exist at the destination.
 * Returns the number of files copied.
 */
function copyDirRecursive(src: string, dest: string): number {
  if (!existsSync(src)) return 0;
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

  let copied = 0;
  const entries = readdirSync(src);

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      copied += copyDirRecursive(srcPath, destPath);
    } else {
      if (!existsSync(destPath)) {
        copyFileSync(srcPath, destPath);
        copied++;
      }
    }
  }

  return copied;
}

export async function seedDefaultGameAssets(): Promise<void> {
  if (!existsSync(BUNDLED_DIR)) {
    logger.warn("[seed] Default game assets bundle not found — skipping");
    return;
  }

  // copyDirRecursive is idempotent — it skips files that already exist at the
  // destination. Running on every boot means upgrading users automatically
  // receive any new bundled assets (e.g. new ambient tracks shipped in a
  // point release) without overwriting their own additions.
  const copied = copyDirRecursive(BUNDLED_DIR, GAME_ASSETS_DIR);

  if (copied > 0) {
    logger.info(`[seed] Installed ${copied} default game asset${copied > 1 ? "s" : ""} (music, ambient, SFX, sprites)`);
  }
}
