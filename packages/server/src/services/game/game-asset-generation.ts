// ──────────────────────────────────────────────
// Game: On-the-fly Asset Generation
//
// Generates NPC portraits and location backgrounds
// mid-game using the user's image generation connection.
// Called from the scene-wrap pipeline when
// `enableSpriteGeneration` is active.
// ──────────────────────────────────────────────

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { logger } from "../../lib/logger.js";
import { join } from "path";
import { DATA_DIR } from "../../utils/data-dir.js";
import { generateImage, type ImageGenRequest } from "../image/image-generation.js";
import { buildAssetManifest, GAME_ASSETS_DIR } from "./asset-manifest.service.js";

const NPC_AVATAR_DIR = join(DATA_DIR, "avatars", "npc");

/** Sanitise a name into a safe filesystem slug. */
function safeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ── NPC Portrait Generation ──

export interface NpcPortraitRequest {
  chatId: string;
  npcName: string;
  appearance: string;
  /** Unified art style prompt for visual consistency. */
  artStyle?: string;
  /** Connection credentials — already resolved & decrypted. */
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgComfyWorkflow?: string | undefined;
}

/**
 * Generate a single portrait for an NPC and save it to disk.
 * Returns the avatar URL path on success, or null on failure.
 */
export async function generateNpcPortrait(req: NpcPortraitRequest): Promise<string | null> {
  const slug = safeName(req.npcName);
  if (!slug) return null;

  const avatarDir = join(NPC_AVATAR_DIR, req.chatId);
  const avatarPath = join(avatarDir, `${slug}.png`);

  // Skip if already exists
  if (existsSync(avatarPath)) {
    return `/api/avatars/npc/${req.chatId}/${slug}.png`;
  }

  const prompt =
    `Portrait of ${req.npcName}, ${req.appearance}. ${req.artStyle ? `Art style: ${req.artStyle}. ` : ""}Character portrait, head and shoulders, detailed face, high quality`.slice(
      0,
      1000,
    );

  try {
    const result = await generateImage(
      req.imgModel,
      req.imgBaseUrl,
      req.imgApiKey,
      req.imgSource || req.imgService || "",
      {
        prompt,
        model: req.imgModel,
        width: 512,
        height: 512,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
      },
    );

    if (!existsSync(avatarDir)) mkdirSync(avatarDir, { recursive: true });
    writeFileSync(avatarPath, Buffer.from(result.base64, "base64"));

    const url = `/api/avatars/npc/${req.chatId}/${slug}.png`;
    logger.info(`[game-asset-gen] Generated NPC portrait for "${req.npcName}" → ${url}`);
    return url;
  } catch (err) {
    logger.warn(`[game-asset-gen] Failed to generate portrait for "${req.npcName}": %s`, err);
    return null;
  }
}

// ── Background Generation ──

/** Map a game genre string to one of the canonical background folders. */
function genreToFolder(genre?: string): string {
  if (!genre) return "fantasy";
  const g = genre.toLowerCase();
  if (g.includes("sci") || g.includes("cyber") || g.includes("space") || g.includes("futur")) return "scifi";
  if (g.includes("modern") || g.includes("contemporary") || g.includes("urban") || g.includes("real")) return "modern";
  return "fantasy";
}

export interface BackgroundGenRequest {
  chatId: string;
  /** Short slug for the location, e.g. "dark-forest-clearing" */
  locationSlug: string;
  /** Scene description used as the image prompt. */
  sceneDescription: string;
  /** The game's genre/setting/tone for style guidance. */
  genre?: string;
  setting?: string;
  /** Unified art style prompt for visual consistency. */
  artStyle?: string;
  /** Connection credentials. */
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgComfyWorkflow?: string | undefined;
}

/**
 * Generate a background image for a game location and add it to the
 * asset manifest. Returns the asset tag on success, or null on failure.
 */
export async function generateBackground(req: BackgroundGenRequest): Promise<string | null> {
  const slug = safeName(req.locationSlug);
  if (!slug) return null;

  const subcategory = genreToFolder(req.genre);
  const filename = `${slug}.png`;
  const targetDir = join(GAME_ASSETS_DIR, "backgrounds", subcategory);
  const targetPath = join(targetDir, filename);

  // Build asset tag: backgrounds:<category>:<slug>
  const tag = `backgrounds:${subcategory}:${slug}`;

  // Skip if already generated
  if (existsSync(targetPath)) {
    return tag;
  }

  const styleHint = [req.artStyle, req.genre, req.setting].filter(Boolean).join(", ");
  const prompt =
    `${req.sceneDescription}. ${styleHint ? `Style: ${styleHint}.` : ""} Wide-angle landscape, detailed environment, no characters, no text, no UI, game background art, high quality`.slice(
      0,
      1000,
    );

  try {
    const result = await generateImage(
      req.imgModel,
      req.imgBaseUrl,
      req.imgApiKey,
      req.imgSource || req.imgService || "",
      {
        prompt,
        model: req.imgModel,
        width: 1024,
        height: 576,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
      },
    );

    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    writeFileSync(targetPath, Buffer.from(result.base64, "base64"));

    // Rebuild manifest so the new tag is available immediately
    buildAssetManifest();

    logger.info(`[game-asset-gen] Generated background "${slug}" → tag: ${tag}`);
    return tag;
  } catch (err) {
    logger.warn(`[game-asset-gen] Failed to generate background "${slug}": %s`, err);
    return null;
  }
}
