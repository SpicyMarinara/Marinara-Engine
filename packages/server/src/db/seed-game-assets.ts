// ──────────────────────────────────────────────
// Seed: Default Game Assets
// Copies bundled game-mode assets (music, SFX, sprites)
// into the data/game-assets directory on first boot.
// All assets are CC0 — see CREDITS.md in the bundle.
// ──────────────────────────────────────────────
import { logger } from "../lib/logger.js";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { GAME_ASSETS_DIR } from "../services/game/asset-manifest.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_DIR = join(__dirname, "..", "assets", "default-game-assets");
const SEED_MARKER = join(GAME_ASSETS_DIR, ".default-assets-seeded.sha256");

function hashDirRecursive(src: string, relativeRoot = ""): string {
  const hash = createHash("sha256");
  if (!existsSync(src)) return "";

  const entries = readdirSync(src).sort((a, b) => a.localeCompare(b));
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const srcPath = join(src, entry);
    const relativePath = relativeRoot ? `${relativeRoot}/${entry}` : entry;
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      hash.update(relativePath);
      hash.update(hashDirRecursive(srcPath, relativePath));
      continue;
    }
    hash.update(relativePath);
    hash.update(readFileSync(srcPath));
  }

  return hash.digest("hex");
}

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

/**
 * Ensure every directory that exists in the bundled assets has a `.native`
 * marker at the corresponding destination path. Idempotent.
 */
function ensureNativeMarkers(src: string, dest: string) {
  if (!existsSync(src)) return;
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }
  const nativeMarker = join(dest, ".native");
  if (!existsSync(nativeMarker)) {
    writeFileSync(nativeMarker, "", "utf-8");
  }
  for (const entry of readdirSync(src)) {
    if (entry.startsWith(".")) continue;
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      ensureNativeMarkers(srcPath, destPath);
    }
  }
}

export async function seedDefaultGameAssets(): Promise<void> {
  if (!existsSync(BUNDLED_DIR)) {
    logger.warn("[seed] Default game assets bundle not found — skipping");
    return;
  }

  const bundleHash = hashDirRecursive(BUNDLED_DIR);
  const existingHash = existsSync(SEED_MARKER) ? readFileSync(SEED_MARKER, "utf-8").trim() : "";
  const needsCopy = !bundleHash || existingHash !== bundleHash;

  if (needsCopy) {
    const copied = copyDirRecursive(BUNDLED_DIR, GAME_ASSETS_DIR);
    writeFileSync(SEED_MARKER, `${bundleHash}\n`, "utf-8");
    if (copied > 0) {
      logger.info(`[seed] Installed ${copied} default game asset${copied > 1 ? "s" : ""} (music, ambient, SFX, sprites)`);
    }
  }

  // Always ensure native markers are up to date (idempotent)
  ensureNativeMarkers(BUNDLED_DIR, GAME_ASSETS_DIR);
}
