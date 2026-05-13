// ──────────────────────────────────────────────
// Game: On-the-fly Asset Generation
//
// Generates NPC portraits and location backgrounds
// mid-game using the user's image generation connection.
// Called from the scene-wrap pipeline when
// `enableSpriteGeneration` is active.
// ──────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { logger } from "../../lib/logger.js";
import { basename, join } from "path";
import { DATA_DIR } from "../../utils/data-dir.js";
import { generateImage, type ImageGenResult } from "../image/image-generation.js";
import { buildAssetManifest, GAME_ASSETS_DIR } from "./asset-manifest.service.js";
import type { PromptOverridesStorage } from "../storage/prompt-overrides.storage.js";
import { loadPrompt, GAME_NPC_PORTRAIT, GAME_BACKGROUND, GAME_SCENE_ILLUSTRATION } from "../prompt-overrides/index.js";
import type { ImageGenerationDefaultsProfile } from "@marinara-engine/shared";
import type { ImageGenerationSize } from "../image/image-generation-settings.js";

const NPC_AVATAR_DIR = join(DATA_DIR, "avatars", "npc");
const CHAT_BACKGROUND_DIR = join(DATA_DIR, "backgrounds");
const CHAT_BACKGROUND_META_PATH = join(CHAT_BACKGROUND_DIR, "meta.json");
export const DEFAULT_GAME_BACKGROUND_SIZE: ImageGenerationSize = { width: 1024, height: 576 };
export const DEFAULT_GAME_PORTRAIT_SIZE: ImageGenerationSize = { width: 512, height: 512 };
export const GENERATED_GAME_BACKGROUND_EXTS = ["png", "jpg", "jpeg", "webp", "avif", "gif"] as const;
const GAME_BACKGROUND_EXT_SET = new Set<string>(GENERATED_GAME_BACKGROUND_EXTS);
const GAME_PORTRAIT_NEGATIVE_PROMPT =
  "text, letters, captions, subtitles, UI, watermark, logo, signature, speech bubble, split screen, panel, collage, contact sheet, grid, four portraits, multiple portraits, duplicated face, extra head, extra person, bad anatomy, low quality";
const GAME_BACKGROUND_NEGATIVE_PROMPT =
  "text, letters, captions, subtitles, UI, watermark, logo, signature, people, character, portrait, split screen, panel, collage, contact sheet, grid, multiple frames, low quality";
const GAME_ILLUSTRATION_NEGATIVE_PROMPT =
  "text, letters, captions, subtitles, UI, watermark, logo, signature, speech bubble, split screen, panel, collage, contact sheet, character sheet, grid, four images, duplicated face, extra head, unrelated character, bad anatomy, low quality";
const MAX_GENERATED_ASSET_SLUG_BYTES = 180;

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

type ChatBackgroundMeta = Record<string, { originalName?: string; tags: string[] }>;

/** Return the extension implied by known image file signatures. */
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

/** Prefer the actual encoded bytes, then fall back to provider metadata. */
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

/** Resize generated backgrounds through sharp when available, preserving original format otherwise. */
async function gameBackgroundImage(result: ImageGenResult, size: ImageGenerationSize): Promise<GameBackgroundImage> {
  const input = Buffer.from(result.base64, "base64");
  const sharp = await getSharp();
  if (!sharp) return { buffer: input, ext: normalizeGeneratedImageExt(result, input) };
  try {
    const buffer = await sharp(input)
      .resize(size.width, size.height, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    return { buffer, ext: "png" };
  } catch (err) {
    logger.warn(err, "[game-asset-gen] Failed to resize generated game background; saving original image");
    return { buffer: input, ext: normalizeGeneratedImageExt(result, input) };
  }
}

/** Build the generated game background file path for a slug and extension. */
function generatedBackgroundPath(targetDir: string, slug: string, ext: string): string {
  return join(targetDir, `${slug}.${ext}`);
}

/** Find an existing generated background regardless of the saved image format. */
function existingGeneratedBackgroundPath(targetDir: string, slug: string): string | null {
  for (const ext of GENERATED_GAME_BACKGROUND_EXTS) {
    const candidate = generatedBackgroundPath(targetDir, slug, ext);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readChatBackgroundMeta(): ChatBackgroundMeta {
  if (!existsSync(CHAT_BACKGROUND_META_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CHAT_BACKGROUND_META_PATH, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as ChatBackgroundMeta) : {};
  } catch {
    return {};
  }
}

function writeChatBackgroundMeta(meta: ChatBackgroundMeta): void {
  if (!existsSync(CHAT_BACKGROUND_DIR)) mkdirSync(CHAT_BACKGROUND_DIR, { recursive: true });
  writeFileSync(CHAT_BACKGROUND_META_PATH, JSON.stringify(meta, null, 2), "utf-8");
}

function chatBackgroundTags(req: ChatBackgroundGenRequest, slug: string): string[] {
  const tags = new Set<string>(["generated", "roleplay", slug.replace(/-/g, " ")]);
  for (const value of [req.locationSlug, req.reason]) {
    if (!value) continue;
    const clean = value.trim().replace(/\s+/g, " ");
    if (clean) tags.add(clean.slice(0, 80));
  }
  return Array.from(tags).filter(Boolean);
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

function truncateSlugByBytes(slug: string, maxBytes: number): string {
  let truncated = slug;
  while (Buffer.byteLength(truncated, "utf8") > maxBytes) {
    truncated = truncated.slice(0, -1);
  }
  return truncated.replace(/-+$/g, "");
}

export function safeGeneratedAssetSlug(name: string, opts: { maxBytes?: number; suffix?: string } = {}): string {
  const maxBytes = opts.maxBytes ?? MAX_GENERATED_ASSET_SLUG_BYTES;
  const slug = safeName(name) || "asset";
  const suffix = opts.suffix ? safeName(opts.suffix) : "";
  const candidate = suffix ? `${slug}-${suffix}` : slug;
  if (Buffer.byteLength(candidate, "utf8") <= maxBytes) return candidate;

  const hash = createHash("sha256").update(slug).digest("hex").slice(0, 8);
  const tail = [hash, suffix].filter(Boolean).join("-");
  const prefixBudget = Math.max(1, maxBytes - Buffer.byteLength(tail, "utf8") - 1);
  const prefix = truncateSlugByBytes(slug, prefixBudget) || "asset";
  return `${prefix}-${tail}`;
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

function resolvedSize(size: ImageGenerationSize | undefined, fallback: ImageGenerationSize): ImageGenerationSize {
  return {
    width: size?.width ?? fallback.width,
    height: size?.height ?? fallback.height,
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
  imgDefaults?: ImageGenerationDefaultsProfile | null;
  debugLog?: (message: string, ...args: any[]) => void;
  /** Storage for user-supplied prompt overrides. Optional — falls back to default builder when omitted. */
  promptOverridesStorage?: PromptOverridesStorage;
  size?: ImageGenerationSize;
  promptOverride?: string;
  /** When true, overwrite an existing generated NPC portrait instead of reusing it. */
  force?: boolean;
}

export async function buildNpcPortraitImagePrompt(req: NpcPortraitRequest): Promise<string> {
  if (req.promptOverride?.trim()) return req.promptOverride.trim().slice(0, 1400);
  const vars = npcPortraitVariables(req);
  const rawPrompt = req.promptOverridesStorage
    ? await loadPrompt(req.promptOverridesStorage, GAME_NPC_PORTRAIT, vars)
    : GAME_NPC_PORTRAIT.defaultBuilder(vars);
  return rawPrompt.slice(0, 1400);
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

  // Skip if already exists unless the caller explicitly asked for a fresh portrait.
  if (!req.force && existsSync(avatarPath)) {
    return `/api/avatars/npc/${req.chatId}/${slug}.png`;
  }

  const prompt = await buildNpcPortraitImagePrompt(req);
  const size = resolvedSize(req.size, DEFAULT_GAME_PORTRAIT_SIZE);
  req.debugLog?.(
    "[debug/game/image-generation] NPC portrait request name=%s model=%s source=%s size=%dx%d prompt:\n%s",
    req.npcName,
    req.imgModel,
    req.imgSource || req.imgService || "",
    size.width,
    size.height,
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
        negativePrompt: GAME_PORTRAIT_NEGATIVE_PROMPT,
        model: req.imgModel,
        width: size.width,
        height: size.height,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
        imageDefaults: req.imgDefaults ?? undefined,
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
  imgDefaults?: ImageGenerationDefaultsProfile | null;
  debugLog?: (message: string, ...args: any[]) => void;
  /** Storage for user-supplied prompt overrides. Optional — falls back to default builder when omitted. */
  promptOverridesStorage?: PromptOverridesStorage;
  size?: ImageGenerationSize;
  promptOverride?: string;
}

export interface ChatBackgroundGenRequest extends BackgroundGenRequest {
  /** Why the background agent asked for generation. Stored as background metadata. */
  reason?: string;
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
  /** Extra user instructions appended to scene illustration prompts. */
  imagePromptInstructions?: string;
  referenceImages?: string[];
  imgSource?: string | null;
  imgModel: string;
  imgBaseUrl: string;
  imgApiKey: string;
  imgService?: string | null;
  imgComfyWorkflow?: string | undefined;
  imgDefaults?: ImageGenerationDefaultsProfile | null;
  debugLog?: (message: string, ...args: any[]) => void;
  /** Storage for user-supplied prompt overrides. Optional — falls back to default builder when omitted. */
  promptOverridesStorage?: PromptOverridesStorage;
  size?: ImageGenerationSize;
  promptOverride?: string;
}

export async function buildBackgroundImagePrompt(req: BackgroundGenRequest): Promise<string> {
  if (req.promptOverride?.trim()) return req.promptOverride.trim().slice(0, 1000);
  const styleHint = [req.artStyle, req.genre, req.setting].filter(Boolean).join(", ");
  const backgroundVars = {
    sceneDescription: req.sceneDescription,
    styleLine: styleHint ? `Style: ${styleHint}.` : "",
  };
  const rawBackgroundPrompt = req.promptOverridesStorage
    ? await loadPrompt(req.promptOverridesStorage, GAME_BACKGROUND, backgroundVars)
    : GAME_BACKGROUND.defaultBuilder(backgroundVars);
  return rawBackgroundPrompt.slice(0, 1000);
}

export async function buildSceneIllustrationImagePrompt(req: SceneIllustrationGenRequest): Promise<string> {
  if (req.promptOverride?.trim()) return req.promptOverride.trim().slice(0, 2200);
  const styleHint = [req.artStyle, req.genre, req.setting].filter(Boolean).join(", ");
  const imagePromptInstructionsLine = req.imagePromptInstructions?.trim()
    ? `User image instructions: ${req.imagePromptInstructions.trim().replace(/\s+/g, " ").slice(0, 1200)}`
    : "";
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
    imagePromptInstructionsLine,
  };
  const rawIllustrationPrompt = req.promptOverridesStorage
    ? await loadPrompt(req.promptOverridesStorage, GAME_SCENE_ILLUSTRATION, sceneIllustrationVars)
    : GAME_SCENE_ILLUSTRATION.defaultBuilder(sceneIllustrationVars);
  const finalPrompt =
    imagePromptInstructionsLine && !rawIllustrationPrompt.includes(imagePromptInstructionsLine)
      ? `${rawIllustrationPrompt}\n${imagePromptInstructionsLine}`
      : rawIllustrationPrompt;
  return finalPrompt.slice(0, 2200);
}

/**
 * Generate a background image for a game location and add it to the
 * asset manifest. Returns the asset tag on success, or null on failure.
 */
export async function generateBackground(req: BackgroundGenRequest): Promise<string | null> {
  const slug = safeGeneratedAssetSlug(req.locationSlug);
  if (!slug) return null;

  const subcategory = genreToFolder(req.genre);
  const targetDir = join(GAME_ASSETS_DIR, "backgrounds", subcategory);

  // Build asset tag: backgrounds:<category>:<slug>
  const tag = `backgrounds:${subcategory}:${slug}`;

  // Skip if already generated
  if (existingGeneratedBackgroundPath(targetDir, slug)) {
    return tag;
  }

  const prompt = await buildBackgroundImagePrompt(req);
  const size = resolvedSize(req.size, DEFAULT_GAME_BACKGROUND_SIZE);
  req.debugLog?.(
    "[debug/game/image-generation] background request slug=%s model=%s source=%s targetSize=%dx%d prompt:\n%s",
    slug,
    req.imgModel,
    req.imgSource || req.imgService || "",
    size.width,
    size.height,
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
        negativePrompt: GAME_BACKGROUND_NEGATIVE_PROMPT,
        model: req.imgModel,
        width: size.width,
        height: size.height,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
        imageDefaults: req.imgDefaults ?? undefined,
      },
    );

    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const image = await gameBackgroundImage(result, size);
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

/**
 * Generate a reusable Roleplay chat background and save it into the normal
 * user backgrounds folder so the Background agent can select it on later turns.
 * Returns the saved filename on success, or null on failure.
 */
export async function generateChatBackground(req: ChatBackgroundGenRequest): Promise<string | null> {
  const baseSlug = safeGeneratedAssetSlug(req.locationSlug || req.sceneDescription.slice(0, 80), { maxBytes: 160 });
  if (!baseSlug) return null;

  const slug = `generated-${baseSlug}`;
  if (!existsSync(CHAT_BACKGROUND_DIR)) mkdirSync(CHAT_BACKGROUND_DIR, { recursive: true });

  const existingPath = existingGeneratedBackgroundPath(CHAT_BACKGROUND_DIR, slug);
  if (existingPath) return basename(existingPath);

  const prompt = await buildBackgroundImagePrompt(req);
  const size = resolvedSize(req.size, DEFAULT_GAME_BACKGROUND_SIZE);
  req.debugLog?.(
    "[debug/background-agent/image-generation] request slug=%s model=%s source=%s targetSize=%dx%d prompt:\n%s",
    slug,
    req.imgModel,
    req.imgSource || req.imgService || "",
    size.width,
    size.height,
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
        negativePrompt: GAME_BACKGROUND_NEGATIVE_PROMPT,
        model: req.imgModel,
        width: size.width,
        height: size.height,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
        imageDefaults: req.imgDefaults ?? undefined,
      },
    );

    const image = await gameBackgroundImage(result, size);
    const filename = `${slug}.${image.ext}`;
    writeFileSync(join(CHAT_BACKGROUND_DIR, filename), image.buffer);

    const meta = readChatBackgroundMeta();
    meta[filename] = {
      originalName: `Generated: ${req.locationSlug || baseSlug}`,
      tags: chatBackgroundTags(req, baseSlug),
    };
    writeChatBackgroundMeta(meta);

    buildAssetManifest();
    logger.info('[background-agent] Generated roleplay background "%s"', filename);
    req.debugLog?.(
      "[debug/background-agent/image-generation] result slug=%s bytes=%d filename=%s",
      slug,
      image.buffer.byteLength,
      filename,
    );
    return filename;
  } catch (err) {
    logger.warn(err, '[background-agent] Failed to generate roleplay background "%s"', slug);
    return null;
  }
}

export async function generateSceneIllustration(req: SceneIllustrationGenRequest): Promise<string | null> {
  const slug = safeGeneratedAssetSlug(req.slug || req.reason || req.prompt.slice(0, 80) || "scene-illustration", {
    suffix: Date.now().toString(36),
  });
  const targetDir = join(GAME_ASSETS_DIR, "backgrounds", "illustrations");
  const tag = `backgrounds:illustrations:${slug}`;

  const prompt = await buildSceneIllustrationImagePrompt(req);
  const size = resolvedSize(req.size, DEFAULT_GAME_BACKGROUND_SIZE);
  req.debugLog?.(
    "[debug/game/image-generation] scene illustration request slug=%s model=%s source=%s targetSize=%dx%d refs=%d prompt:\n%s",
    slug,
    req.imgModel,
    req.imgSource || req.imgService || "",
    size.width,
    size.height,
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
        negativePrompt: GAME_ILLUSTRATION_NEGATIVE_PROMPT,
        model: req.imgModel,
        width: size.width,
        height: size.height,
        comfyWorkflow: req.imgComfyWorkflow || undefined,
        imageDefaults: req.imgDefaults ?? undefined,
        referenceImages: req.referenceImages?.length ? req.referenceImages.slice(0, 4) : undefined,
      },
    );

    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
    const image = await gameBackgroundImage(result, size);
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
