// ──────────────────────────────────────────────
// Game: On-the-fly Asset Generation
//
// Generates NPC portraits and location backgrounds
// mid-game using the user's image generation connection.
// Called from the scene-wrap pipeline when
// `enableSpriteGeneration` is active.
// ──────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { logger } from "../../lib/logger.js";
import { join } from "path";
import { DATA_DIR } from "../../utils/data-dir.js";
import { generateImage, type ImageGenResult } from "../image/image-generation.js";
import { buildAssetManifest, GAME_ASSETS_DIR } from "./asset-manifest.service.js";
import type { PromptOverridesStorage } from "../storage/prompt-overrides.storage.js";
import { loadPrompt, GAME_NPC_PORTRAIT, GAME_BACKGROUND, GAME_SCENE_ILLUSTRATION } from "../prompt-overrides/index.js";

const NPC_AVATAR_DIR = join(DATA_DIR, "avatars", "npc");
const GAME_BACKGROUND_WIDTH = 1024;
const GAME_BACKGROUND_HEIGHT = 576;
const GAME_BACKGROUND_EXTS = ["png", "jpg", "jpeg", "webp", "avif", "gif"] as const;
const GAME_BACKGROUND_EXT_SET = new Set<string>(GAME_BACKGROUND_EXTS);

// sharp is optional in the server package. Generated game backgrounds should be
// stored at the VN canvas ratio when possible, but generation must still work on
// platforms where sharp is unavailable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharpFn = any;
let _sharp: SharpFn | null = null;
let _sharpLoadFailed = false;

async function getSharp(): Promise<SharpFn | null> {
  if (_sharp) return _sharp;
  if (_sharpLoadFailed) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - optional native dependency
    const mod = await import("sharp");
    _sharp = (mod.default ?? mod) as SharpFn;
    return _sharp;
  } catch {
    _sharpLoadFailed = true;
    return null;
  }
}

type GameBackgroundImage = {
  buffer: Buffer;
  ext: string;
};

function detectImageExt(buffer: Buffer): string | null {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "gif";
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "webp";
  }
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "avif";
  }
  return null;
}

function normalizeGeneratedImageExt(result: Pick<ImageGenResult, "mimeType" | "ext">, buffer: Buffer): string {
  const detectedExt = detectImageExt(buffer);
  if (detectedExt) return detectedExt;

  const ext = result.ext.trim().toLowerCase().replace(/^\./, "");
  if (GAME_BACKGROUND_EXT_SET.has(ext)) return ext === "jpeg" ? "jpg" : ext;

  const mime = result.mimeType.toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("avif")) return "avif";
  if (mime.includes("gif")) return "gif";
  return "png";
}

async function gameBackgroundImage(result: ImageGenResult): Promise<GameBackgroundImage> {
  const input = Buffer.from(result.base64, "base64");
  const sharp = await getSharp();
  if (!sharp) return { buffer: input, ext: normalizeGeneratedImageExt(result, input) };
  try {
    const buffer = await sharp(input)
      .resize(GAME_BACKGROUND_WIDTH, GAME_BACKGROUND_HEIGHT, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    return { buffer, ext: "png" };
  } catch (err) {
    logger.warn(err, "[game-asset-gen] Failed to resize generated game background; saving original image");
    return { buffer: input, ext: normalizeGeneratedImageExt(result, input) };
  }
}

function generatedBackgroundPath(targetDir: string, slug: string, ext: string): string {
  return join(targetDir, `${slug}.${ext}`);
}

function existingGeneratedBackgroundPath(targetDir: string, slug: string): string | null {
  for (const ext of GAME_BACKGROUND_EXTS) {
    const candidate = generatedBackgroundPath(targetDir, slug, ext);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function readAvatarBase64(avatarPath: string | null | undefined): string | undefined {
  if (!avatarPath) return undefined;
  const cleanAvatarPath = avatarPath.split("?")[0] ?? avatarPath;
  const parts = cleanAvatarPath.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || part.includes("\\"))) return undefined;

  let diskPath: string | null = null;
  if (cleanAvatarPath.startsWith("/api/avatars/file/")) {
    const filename = parts.at(-1);
    if (filename) diskPath = join(DATA_DIR, "avatars", filename);
  } else if (cleanAvatarPath.startsWith("/api/avatars/npc/")) {
    const chatId = parts.at(-2);
    const filename = parts.at(-1);
    if (chatId && filename) diskPath = join(DATA_DIR, "avatars", "npc", chatId, filename);
  } else if (cleanAvatarPath.startsWith("avatars/")) {
    diskPath = join(DATA_DIR, ...parts);
  }

  if (!diskPath) return undefined;
  try {
    if (!existsSync(diskPath)) return undefined;
    return readFileSync(diskPath).toString("base64");
  } catch {
    return undefined;
  }
}

/** Sanitise a name into a safe filesystem slug. */
function safeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function hasExplicitNonHumanCue(value: string): boolean {
  return /\b(?:animal|cat|kitten|dog|puppy|wolf|fox|bird|raven|crow|owl|horse|deer|rabbit|rat|mouse|snake|lizard|dragon|beast|creature|monster|spirit|ghost|construct|golem|doll|object|statue|mascot|non[-\s]?human|anthropomorphic|feral|quadruped)\b/i.test(
    value,
  );
}

function npcPortraitVariables(req: NpcPortraitRequest) {
  const context = req.appearance.trim();
  const explicitNonHuman = hasExplicitNonHumanCue(`${req.npcName} ${context}`);
  return {
    npcName: req.npcName,
    appearanceLine: context ? `Canonical visual description from the current game: ${context}.` : "",
    nonHumanRule: explicitNonHuman
      ? "The description explicitly indicates a non-human subject. Preserve that exact species, body plan, age category, and silhouette; do not turn it into a human or kemonomimi character unless the description says humanoid."
      : "Unless the description explicitly says otherwise, depict this NPC as a human or humanoid person. Do not infer an animal species from the name, mood, speech verbs, or setting.",
    artStyleLine: req.artStyle ? `Art style: ${req.artStyle}.` : "",
    compositionRule: explicitNonHuman
      ? "Use a centered avatar composition appropriate to the subject, including a creature portrait or full head-and-body crop only when that best preserves the described non-human form."
      : "Use a centered human/humanoid avatar composition: face and shoulders, readable expression, clear outfit cues.",
  };
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
  debugLog?: (message: string, ...args: any[]) => void;
  /** Storage for user-supplied prompt overrides. Optional — falls back to default builder when omitted. */
  promptOverridesStorage?: PromptOverridesStorage;
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

  const vars = npcPortraitVariables(req);
  const rawPrompt = req.promptOverridesStorage
    ? await loadPrompt(req.promptOverridesStorage, GAME_NPC_PORTRAIT, vars)
    : GAME_NPC_PORTRAIT.defaultBuilder(vars);
  const prompt = rawPrompt.slice(0, 1400);
  req.debugLog?.(
    "[debug/game/image-generation] NPC portrait request name=%s model=%s source=%s size=512x512 prompt:\n%s",
    req.npcName,
    req.imgModel,
    req.imgSource || req.imgService || "",
    prompt,
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
    req.debugLog?.(
      "[debug/game/image-generation] NPC portrait result name=%s bytes=%d url=%s",
      req.npcName,
      Buffer.byteLength(result.base64, "base64"),
      url,
    );
    logger.info(`[game-asset-gen] Generated NPC portrait for "${req.npcName}" → ${url}`);
    return url;
  } catch (err) {
    logger.warn(err, '[game-asset-gen] Failed to generate portrait for "%s"', req.npcName);
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
  debugLog?: (message: string, ...args: any[]) => void;
  /** Storage for user-supplied prompt overrides. Optional — falls back to default builder when omitted. */
  promptOverridesStorage?: PromptOverridesStorage;
}

export interface SceneIllustrationGenRequest {
  chatId: string;
  prompt: string;
  reason?: string;
  characters?: string[];
  characterDescriptions?: string[];
  slug?: string;
  genre?: string;
  setting?: string;
  artStyle?: string;
  referenceImages?: string[];
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgComfyWorkflow?: string | undefined;
  debugLog?: (message: string, ...args: any[]) => void;
  /** Storage for user-supplied prompt overrides. Optional — falls back to default builder when omitted. */
  promptOverridesStorage?: PromptOverridesStorage;
}

/**
 * Generate a background image for a game location and add it to the
 * asset manifest. Returns the asset tag on success, or null on failure.
 */
export async function generateBackground(req: BackgroundGenRequest): Promise<string | null> {
  const slug = safeName(req.locationSlug);
  if (!slug) return null;

  const subcategory = genreToFolder(req.genre);
  const targetDir = join(GAME_ASSETS_DIR, "backgrounds", subcategory);

  // Build asset tag: backgrounds:<category>:<slug>
  const tag = `backgrounds:${subcategory}:${slug}`;

  // Skip if already generated
  if (existingGeneratedBackgroundPath(targetDir, slug)) {
    return tag;
  }

  const styleHint = [req.artStyle, req.genre, req.setting].filter(Boolean).join(", ");
  const backgroundVars = {
    sceneDescription: req.sceneDescription,
    styleLine: styleHint ? `Style: ${styleHint}.` : "",
  };
  const rawBackgroundPrompt = req.promptOverridesStorage
    ? await loadPrompt(req.promptOverridesStorage, GAME_BACKGROUND, backgroundVars)
    : GAME_BACKGROUND.defaultBuilder(backgroundVars);
  const prompt = rawBackgroundPrompt.slice(0, 1000);
  req.debugLog?.(
    "[debug/game/image-generation] background request slug=%s model=%s source=%s targetSize=%dx%d prompt:\n%s",
    slug,
    req.imgModel,
    req.imgSource || req.imgService || "",
    GAME_BACKGROUND_WIDTH,
    GAME_BACKGROUND_HEIGHT,
    prompt,
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
        width: GAME_BACKGROUND_WIDTH,
        height: GAME_BACKGROUND_HEIGHT,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
      },
    );

    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const image = await gameBackgroundImage(result);
    const targetPath = generatedBackgroundPath(targetDir, slug, image.ext);
    writeFileSync(targetPath, image.buffer);

    // Rebuild manifest so the new tag is available immediately
    buildAssetManifest();

    logger.info(`[game-asset-gen] Generated background "${slug}" → tag: ${tag}`);
    req.debugLog?.(
      "[debug/game/image-generation] background result slug=%s bytes=%d tag=%s",
      slug,
      image.buffer.byteLength,
      tag,
    );
    return tag;
  } catch (err) {
    logger.warn(err, '[game-asset-gen] Failed to generate background "%s"', slug);
    return null;
  }
}

export async function generateSceneIllustration(req: SceneIllustrationGenRequest): Promise<string | null> {
  const baseSlug = safeName(req.slug || req.reason || req.prompt.slice(0, 80)) || "scene-illustration";
  const slug = `${baseSlug}-${Date.now().toString(36)}`;
  const targetDir = join(GAME_ASSETS_DIR, "backgrounds", "illustrations");
  const tag = `backgrounds:illustrations:${slug}`;

  const styleHint = [req.artStyle, req.genre, req.setting].filter(Boolean).join(", ");
  const sceneIllustrationVars = {
    scenePrompt: req.prompt,
    narrativePurposeLine: req.reason ? `Narrative purpose: ${req.reason}.` : "",
    charactersLine: req.characters?.length ? `Characters: ${req.characters.join(", ")}.` : "",
    referenceHandlingLine: req.referenceImages?.length
      ? "Reference handling: attached character reference images are available. Use them to match faces, hair, build, colors, and distinctive features for the referenced characters."
      : "",
    appearanceNotesBlock: req.characterDescriptions?.length
      ? `Appearance notes for visible characters without an attached reference image:\n- ${req.characterDescriptions.join("\n- ")}`
      : "",
    artDirectionLine: styleHint ? `Art direction: ${styleHint}.` : "",
  };
  const rawIllustrationPrompt = req.promptOverridesStorage
    ? await loadPrompt(req.promptOverridesStorage, GAME_SCENE_ILLUSTRATION, sceneIllustrationVars)
    : GAME_SCENE_ILLUSTRATION.defaultBuilder(sceneIllustrationVars);
  const prompt = rawIllustrationPrompt.slice(0, 2200);
  req.debugLog?.(
    "[debug/game/image-generation] scene illustration request slug=%s model=%s source=%s targetSize=%dx%d refs=%d prompt:\n%s",
    slug,
    req.imgModel,
    req.imgSource || req.imgService || "",
    GAME_BACKGROUND_WIDTH,
    GAME_BACKGROUND_HEIGHT,
    req.referenceImages?.length ?? 0,
    prompt,
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
        width: GAME_BACKGROUND_WIDTH,
        height: GAME_BACKGROUND_HEIGHT,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
        referenceImages: req.referenceImages?.length ? req.referenceImages.slice(0, 4) : undefined,
      },
    );

    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const image = await gameBackgroundImage(result);
    const targetPath = generatedBackgroundPath(targetDir, slug, image.ext);
    writeFileSync(targetPath, image.buffer);
    buildAssetManifest();

    logger.info('[game-asset-gen] Generated scene illustration "%s" -> tag: %s', slug, tag);
    req.debugLog?.(
      "[debug/game/image-generation] scene illustration result slug=%s bytes=%d tag=%s",
      slug,
      image.buffer.byteLength,
      tag,
    );
    return tag;
  } catch (err) {
    logger.warn(err, '[game-asset-gen] Failed to generate scene illustration "%s"', slug);
    return null;
  }
}
