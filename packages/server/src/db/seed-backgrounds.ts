// ──────────────────────────────────────────────
// Seed: Default Backgrounds
// Copies bundled background images into the data directory on first boot.
// Images sourced from Unsplash (https://unsplash.com/license — free for any use).
// ──────────────────────────────────────────────
import { logger } from "../lib/logger.js";
import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DATA_DIR } from "../utils/data-dir.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "..", "assets", "default-backgrounds");
const BG_DIR = join(DATA_DIR, "backgrounds");
const META_PATH = join(BG_DIR, "meta.json");

/** Tag definitions for each bundled background. */
const BACKGROUND_TAGS: Record<string, string[]> = {
  "ancient_library.jpg": ["interior", "library", "fantasy", "cozy"],
  "castle_cliff.jpg": ["castle", "cliff", "fantasy", "medieval", "dramatic"],
  "city_night.jpg": ["city", "night", "urban", "modern", "neon"],
  "dark_forest.jpg": ["forest", "dark", "nature", "mysterious", "night"],
  "enchanted_forest.jpg": ["forest", "nature", "green", "fantasy", "peaceful"],
  "foggy_valley.jpg": ["valley", "fog", "mountains", "nature", "mysterious"],
  "misty_mountains.jpg": ["mountains", "dramatic", "nature", "epic", "landscape"],
  "moonlit_lake.jpg": ["lake", "night", "moon", "water", "peaceful"],
  "mountain_lake.jpg": ["mountains", "lake", "nature", "landscape", "peaceful"],
  "ocean_sunset.jpg": ["ocean", "sunset", "beach", "water", "romantic"],
  "starry_mountains.jpg": ["mountains", "night", "stars", "space", "epic"],
  "tropical_beach.jpg": ["beach", "tropical", "ocean", "day", "paradise"],
  "winter_mountains.jpg": ["winter", "snow", "mountains", "cold", "landscape"],
};

export async function seedDefaultBackgrounds() {
  // Ensure data backgrounds directory exists
  if (!existsSync(BG_DIR)) {
    mkdirSync(BG_DIR, { recursive: true });
  }

  // Skip if backgrounds already exist (user has their own collection)
  const existingFiles = readdirSync(BG_DIR).filter((f) => /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(f));
  if (existingFiles.length > 0) return;

  // Check that bundled assets exist
  if (!existsSync(ASSETS_DIR)) {
    logger.warn("[seed] Default backgrounds assets not found — skipping");
    return;
  }

  const assetFiles = readdirSync(ASSETS_DIR).filter((f) => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
  if (assetFiles.length === 0) return;

  // Copy each background file
  let copied = 0;
  for (const filename of assetFiles) {
    const src = join(ASSETS_DIR, filename);
    const dest = join(BG_DIR, filename);
    if (!existsSync(dest)) {
      copyFileSync(src, dest);
      copied++;
    }
  }

  // Build meta.json with tags
  let meta: Record<string, { originalName?: string; tags: string[] }> = {};
  if (existsSync(META_PATH)) {
    try {
      meta = JSON.parse(readFileSync(META_PATH, "utf-8"));
    } catch {
      /* start fresh */
    }
  }
  for (const filename of assetFiles) {
    if (!meta[filename]) {
      meta[filename] = { tags: BACKGROUND_TAGS[filename] ?? [] };
    }
  }
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2), "utf-8");

  if (copied > 0) {
    logger.info(`[seed] Installed ${copied} default background${copied > 1 ? "s" : ""}`);
  }
}
