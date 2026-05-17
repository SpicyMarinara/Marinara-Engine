// ──────────────────────────────────────────────
// Service: Image Generation
// ──────────────────────────────────────────────
// Calls image generation APIs (OpenAI DALL-E, Pollinations, Stability, etc.)
// based on a user's configured image_generation connection.

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { inflateRawSync } from "zlib";
import { DATA_DIR } from "../../utils/data-dir.js";
import { newId } from "../../utils/id-generator.js";
import {
  DEFAULT_AUTOMATIC1111_DEFAULTS,
  DEFAULT_COMFYUI_DEFAULTS,
  DEFAULT_NOVELAI_DEFAULTS,
  mergeNegativePrompt,
  mergePromptPrefix,
  inferImageSource,
  type Automatic1111Defaults,
  type ComfyUiDefaults,
  type ImageGenerationDefaultsProfile,
  type NovelAiDefaults,
} from "@marinara-engine/shared";
import { isImageLocalUrlsEnabled } from "../../config/runtime-config.js";
import { normalizeLoopbackUrl, safeFetch, validateOutboundUrl } from "../../utils/security.js";

const GALLERY_DIR = join(DATA_DIR, "gallery");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Strip HTML tags and collapse whitespace — keeps error messages readable when APIs return HTML error pages. */
function sanitizeErrorText(text: string): string {
  if (!text.includes("<")) return text.slice(0, 300);
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export interface ImageGenRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  model?: string;
  /** Optional ComfyUI workflow JSON. Placeholders like %prompt%, %width%, %height%, %seed% will be replaced. */
  comfyWorkflow?: string;
  /** Optional connection-scoped defaults for local Stable Diffusion backends. */
  imageDefaults?: ImageGenerationDefaultsProfile | null;
  /** Allow this explicit image-generation connection to call local/private URLs. */
  allowLocalUrls?: boolean;
  /** Optional base64-encoded reference image for img2img / character consistency. */
  referenceImage?: string;
  /** Optional array of base64-encoded reference images (avatars). Providers that support multiple refs use all; others use the first. */
  referenceImages?: string[];
  /** Request a transparent image background when the provider/model supports it. */
  transparentBackground?: boolean;
}

export interface ImageGenResult {
  /** Base64-encoded image data */
  base64: string;
  /** MIME type (e.g. "image/png") */
  mimeType: string;
  /** File extension without dot */
  ext: string;
}

const EXPLICIT_IMAGE_SOURCES = new Set([
  "openai",
  "nanogpt",
  "openrouter",
  "pollinations",
  "stability",
  "togetherai",
  "novelai",
  "horde",
  "xai",
  "comfyui",
  "automatic1111",
  "gemini_image",
]);

function normalizeExplicitImageSource(serviceHint: string): string {
  const normalized = serviceHint.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "drawthings") return "automatic1111";
  return EXPLICIT_IMAGE_SOURCES.has(normalized) ? normalized : "";
}

function resolveImageBackend(source: string, baseUrl: string, serviceHint: string, requestModel?: string): string {
  const inferredSource = inferImageSource(requestModel || source, baseUrl);
  const explicitSource = normalizeExplicitImageSource(serviceHint);

  if (!explicitSource) return inferredSource;

  // Gemini image models exposed through OpenAI-compatible proxies (for example LinkAPI)
  // must use the chat-completions path even if an older connection still says "openai".
  if (explicitSource === "openai" && inferredSource === "gemini_image") {
    return inferredSource;
  }

  return explicitSource;
}

/**
 * Generate an image using the configured image generation connection.
 * Returns the base64 data and metadata needed to save it.
 */
export async function generateImage(
  source: string,
  baseUrl: string,
  apiKey: string,
  serviceHint: string,
  request: ImageGenRequest,
): Promise<ImageGenResult> {
  const resolvedSource = resolveImageBackend(source, baseUrl, serviceHint, request.model);
  const normalizedBaseUrl = normalizeImageUrl(baseUrl);
  const scopedRequest = {
    ...request,
    allowLocalUrls:
      request.allowLocalUrls ?? (await shouldAllowLocalUrlsForImageConnection(normalizedBaseUrl, resolvedSource)),
  };

  switch (resolvedSource) {
    case "openai":
      return generateOpenAI(normalizedBaseUrl, apiKey, scopedRequest);
    case "nanogpt":
      return generateNanoGPT(normalizedBaseUrl, apiKey, scopedRequest);
    case "openrouter":
      return generateOpenRouter(normalizedBaseUrl, apiKey, scopedRequest);
    case "pollinations":
      return generatePollinations(scopedRequest);
    case "stability":
      return generateStability(normalizedBaseUrl, apiKey, scopedRequest);
    case "togetherai":
      return generateTogetherAI(normalizedBaseUrl, apiKey, scopedRequest);
    case "novelai":
      return generateNovelAI(normalizedBaseUrl, apiKey, scopedRequest);
    case "horde":
      return generateHorde(normalizedBaseUrl, apiKey, scopedRequest);
    case "xai":
      return generateXAI(normalizedBaseUrl, apiKey, scopedRequest);
    case "comfyui":
      return generateComfyUI(normalizedBaseUrl, scopedRequest);
    case "automatic1111":
      return generateAutomatic1111(normalizedBaseUrl, scopedRequest);
    case "gemini_image":
      return generateViaChatCompletions(normalizedBaseUrl, apiKey, scopedRequest);
    default:
      // Fallback: try OpenAI-compatible endpoint
      return generateOpenAI(normalizedBaseUrl, apiKey, scopedRequest);
  }
}

/**
 * Save a generated image to the gallery directory on disk.
 * Returns the relative file path (chatId/filename).
 */
export function saveImageToDisk(chatId: string, base64: string, ext: string): string {
  const dir = join(GALLERY_DIR, chatId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = `${newId()}.${ext}`;
  const filePath = join(dir, filename);
  writeFileSync(filePath, Buffer.from(base64, "base64"));
  return `${chatId}/${filename}`;
}

// ── Provider Implementations ──

/** Default 5-minute timeout for image generation API calls (overridable via env). */
const IMAGE_GEN_TIMEOUT = Number(process.env.IMAGE_GEN_TIMEOUT_MS ?? 300_000);
const MAX_IMAGE_RESPONSE_BYTES = 30 * 1024 * 1024;
const LOCAL_IMAGE_BACKENDS = new Set(["comfyui", "automatic1111"]);

function normalizeImageUrl(url: string | URL): string {
  try {
    return normalizeLoopbackUrl(url);
  } catch {
    return url.toString();
  }
}

async function shouldAllowLocalUrlsForImageConnection(baseUrl: string, resolvedSource: string): Promise<boolean> {
  if (isImageLocalUrlsEnabled() || LOCAL_IMAGE_BACKENDS.has(resolvedSource)) return true;

  try {
    await validateOutboundUrl(baseUrl, {
      allowLoopback: true,
      allowedProtocols: ["https:", "http:"],
    });
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    return /private|loopback|local|reserved/i.test(message);
  }
}

function imageFetch(url: string | URL, init?: RequestInit, options: { allowLocal?: boolean } = {}) {
  return safeFetch(url, {
    ...(init ?? {}),
    policy: {
      allowLocal: options.allowLocal ?? isImageLocalUrlsEnabled(),
      allowLoopback: true,
      allowedProtocols: ["https:", "http:"],
      flagName: "IMAGE_LOCAL_URLS_ENABLED",
    },
    maxResponseBytes: MAX_IMAGE_RESPONSE_BYTES,
  });
}

function localImageBackendFetch(url: string | URL, init?: RequestInit) {
  return imageFetch(url, init, { allowLocal: true });
}

function isOpenAIGptImageModel(model?: string): boolean {
  return !!model && /^gpt-image-(?:1|1\.5|2)(?:$|-)/i.test(model.trim());
}

function supportsOpenAITransparentBackground(model?: string): boolean {
  const m = model?.trim().toLowerCase() ?? "";
  // OpenAI documents transparent backgrounds for GPT Image output generally,
  // but explicitly excludes GPT Image 2 from background: "transparent".
  return /^gpt-image-(?:1|1\.5)(?:$|-)/i.test(m);
}

function openAIImageSize(request: ImageGenRequest): string {
  const width = request.width ?? 1024;
  const height = request.height ?? 1024;
  const requested = `${width}x${height}`;
  const model = request.model?.trim() ?? "";
  const ratio = width / Math.max(1, height);

  if (/dall-e-2/i.test(model)) {
    return width === height && [256, 512, 1024].includes(width) ? requested : "1024x1024";
  }

  if (/dall-e-3/i.test(model)) {
    if (ratio > 1.12) return "1792x1024";
    if (ratio < 0.88) return "1024x1792";
    return "1024x1024";
  }

  // GPT Image models reject small custom dimensions such as 1024x576.
  // Use the closest supported canvas and let callers crop/resize if needed.
  if (ratio > 1.12) return "1536x1024";
  if (ratio < 0.88) return "1024x1536";
  return "1024x1024";
}

const XAI_IMAGE_ASPECT_RATIOS = [
  ["1:1", 1],
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
  ["4:3", 4 / 3],
  ["3:4", 3 / 4],
  ["3:2", 3 / 2],
  ["2:3", 2 / 3],
  ["2:1", 2],
  ["1:2", 1 / 2],
  ["19.5:9", 19.5 / 9],
  ["9:19.5", 9 / 19.5],
  ["20:9", 20 / 9],
  ["9:20", 9 / 20],
] as const;

function xAIImageAspectRatio(width?: number, height?: number): string {
  if (!width || !height) return "auto";
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`xAI image generation requires positive width and height values, got ${width}x${height}`);
  }

  const ratio = width / height;
  return XAI_IMAGE_ASPECT_RATIOS.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

function imageDataUrlFromReference(reference: string): string {
  const trimmed = reference.trim();
  if (trimmed.startsWith("data:")) return trimmed;
  const base64 = trimmed.replace(/\s+/g, "");
  return `data:${detectImageMimeType(base64)};base64,${base64}`;
}

function detectImageMimeType(base64: string): string {
  const bytes = Buffer.from(base64.slice(0, 64), "base64");
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return "image/png";
}

function imageExtensionFromMimeType(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "png";
}

function decodeImageDataUrl(imageUrl: string): ImageGenResult {
  const match = imageUrl.trim().match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([\s\S]+)$/i);
  if (!match) {
    throw new Error("Generated image data URL was not a supported image format");
  }

  const declaredMimeType = match[1]!.toLowerCase().replace("image/jpg", "image/jpeg");
  const encoded = match[2]!.replace(/\s+/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("Generated image data URL was not valid base64 image data");
  }

  const buffer = Buffer.from(encoded, "base64");
  if (buffer.byteLength === 0) {
    throw new Error("Generated image data URL was empty");
  }

  const base64 = buffer.toString("base64");
  const mimeType = detectImageMimeType(base64) || declaredMimeType;
  return { base64, mimeType, ext: imageExtensionFromMimeType(mimeType) };
}

function nanoGPTImagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, "");
    if (path.endsWith("/images/generations")) {
      // Keep user-supplied full endpoint URLs, but normalize the legacy /api/v1 prefix below.
    } else if (path === "" || path === "/" || path.endsWith("/api")) {
      parsed.pathname = "/v1/images/generations";
    } else if (path.endsWith("/api/v1")) {
      parsed.pathname = `${path.slice(0, -"/api/v1".length)}/v1/images/generations`;
    } else if (path.endsWith("/v1")) {
      parsed.pathname = `${path}/images/generations`;
    } else {
      parsed.pathname = `${path}/images/generations`;
    }
    parsed.pathname = parsed.pathname.replace(/\/api\/v1\/images\/generations$/, "/v1/images/generations");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return `${trimmed}/images/generations`;
  }
}

function openAIImagesUrl(baseUrl: string, endpoint: "generations" | "edits"): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const targetPath = `/images/${endpoint}`;
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, "");
    if (/\/images\/(?:generations|edits|variations)$/i.test(path)) {
      parsed.pathname = path.replace(/\/images\/(?:generations|edits|variations)$/i, targetPath);
    } else if (path === "" || path === "/") {
      parsed.pathname = `/v1${targetPath}`;
    } else if (path.endsWith("/api/v1")) {
      parsed.pathname = `${path.slice(0, -"/api/v1".length)}/v1${targetPath}`;
    } else if (path.endsWith("/api")) {
      parsed.pathname = `${path.slice(0, -"/api".length)}/v1${targetPath}`;
    } else if (path.endsWith("/v1")) {
      parsed.pathname = `${path}${targetPath}`;
    } else {
      parsed.pathname = `${path}${targetPath}`;
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return `${trimmed}${targetPath}`;
  }
}

function openAIReferenceImages(request: ImageGenRequest): string[] {
  const references = request.referenceImages?.length
    ? request.referenceImages
    : request.referenceImage
      ? [request.referenceImage]
      : [];
  return references
    .map((reference) => reference.trim())
    .filter(Boolean)
    .slice(0, 16);
}

function decodeReferenceImage(reference: string): { base64: string; mimeType: string; ext: string } {
  const dataUrlMatch = reference.trim().match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([\s\S]+)$/i);
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1]!.toLowerCase().replace("image/jpg", "image/jpeg");
    const base64 = dataUrlMatch[2]!.replace(/\s+/g, "");
    return { base64, mimeType, ext: imageExtensionFromMimeType(mimeType) };
  }

  const base64 = reference.replace(/\s+/g, "");
  const mimeType = detectImageMimeType(base64);
  return { base64, mimeType, ext: imageExtensionFromMimeType(mimeType) };
}

async function readOpenAIImageResult(
  resp: Response,
  request: ImageGenRequest,
  operation: "generation" | "edit",
): Promise<ImageGenResult> {
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`OpenAI image ${operation} failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const data = (await resp.json()) as {
    data?: Array<{ b64_json?: string; image_base64?: string; url?: string; revised_prompt?: string }>;
  };
  const item = data.data?.[0];
  const b64 = item?.b64_json ?? item?.image_base64;
  if (!b64 && item?.url) {
    return downloadImageUrl(item.url, request.allowLocalUrls);
  }
  if (!b64) {
    const fields = item
      ? Object.keys(item).join(", ")
      : data && typeof data === "object"
        ? Object.keys(data).join(", ")
        : "none";
    throw new Error(`No image data in OpenAI response (fields: ${fields || "none"})`);
  }

  return { base64: b64, mimeType: "image/png", ext: "png" };
}

async function downloadImageUrl(imageUrl: string, allowLocalUrls = false): Promise<ImageGenResult> {
  if (imageUrl.trim().startsWith("data:")) {
    return decodeImageDataUrl(imageUrl);
  }

  const normalizedImageUrl = normalizeImageUrl(imageUrl);
  const imgResp = await imageFetch(
    normalizedImageUrl,
    { signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT) },
    { allowLocal: allowLocalUrls },
  );
  if (!imgResp.ok) {
    throw new Error(`Failed to download generated image (${imgResp.status})`);
  }

  const arrayBuffer = await imgResp.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  const contentType = imgResp.headers.get("content-type") ?? "";
  let mimeType = detectImageMimeType(base64);
  if (contentType.includes("jpeg") || contentType.includes("jpg") || normalizedImageUrl.match(/\.jpe?g/i)) {
    mimeType = "image/jpeg";
  } else if (contentType.includes("webp") || normalizedImageUrl.match(/\.webp/i)) {
    mimeType = "image/webp";
  } else if (contentType.includes("gif") || normalizedImageUrl.match(/\.gif/i)) {
    mimeType = "image/gif";
  }

  return { base64, mimeType, ext: imageExtensionFromMimeType(mimeType) };
}

async function generateOpenAI(baseUrl: string, apiKey: string, request: ImageGenRequest): Promise<ImageGenResult> {
  const usesGptImageApi = isOpenAIGptImageModel(request.model);
  const references = openAIReferenceImages(request);

  if (usesGptImageApi && references.length > 0) {
    const formData = new FormData();
    formData.append("prompt", request.prompt);
    formData.append("n", "1");
    formData.append("size", openAIImageSize(request));
    formData.append("output_format", "png");
    if (request.transparentBackground && supportsOpenAITransparentBackground(request.model)) {
      formData.append("background", "transparent");
    }
    if (request.model) formData.append("model", request.model);

    references.forEach((reference, index) => {
      const decoded = decodeReferenceImage(reference);
      formData.append(
        "image[]",
        new Blob([Buffer.from(decoded.base64, "base64")], { type: decoded.mimeType }),
        `reference-${index + 1}.${decoded.ext}`,
      );
    });

    const resp = await imageFetch(
      openAIImagesUrl(baseUrl, "edits"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
      },
      { allowLocal: request.allowLocalUrls },
    );

    return readOpenAIImageResult(resp, request, "edit");
  }

  const url = openAIImagesUrl(baseUrl, "generations");
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    n: 1,
    size: openAIImageSize(request),
  };
  if (request.model) body.model = request.model;
  if (usesGptImageApi) {
    // GPT Image models return base64 image data from the Images API without the
    // legacy DALL-E `response_format` toggle. `output_format` controls PNG/JPEG/WebP.
    body.output_format = "png";
    if (request.transparentBackground && supportsOpenAITransparentBackground(request.model)) {
      body.background = "transparent";
    }
  } else {
    body.response_format = "b64_json";
  }

  const resp = await imageFetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
    },
    { allowLocal: request.allowLocalUrls },
  );

  return readOpenAIImageResult(resp, request, "generation");
}

function xAIImagesUrl(baseUrl: string): string {
  return openAIImagesUrl(baseUrl, "generations");
}

async function generateXAI(baseUrl: string, apiKey: string, request: ImageGenRequest): Promise<ImageGenResult> {
  if (request.referenceImage || request.referenceImages?.length) {
    throw new Error("xAI image generation does not support reference images in Marinara yet.");
  }

  const body: Record<string, unknown> = {
    prompt: request.prompt,
    n: 1,
    aspect_ratio: xAIImageAspectRatio(request.width, request.height),
    response_format: "b64_json",
  };
  if (request.model) body.model = request.model;

  const resp = await imageFetch(
    xAIImagesUrl(baseUrl),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
    },
    { allowLocal: request.allowLocalUrls },
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`xAI image generation failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const data = (await resp.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const result = data.data?.[0];
  if (result?.b64_json) return { base64: result.b64_json, mimeType: "image/png", ext: "png" };
  if (result?.url) return downloadImageUrl(result.url, request.allowLocalUrls);

  throw new Error("No image data in xAI response");
}

async function generateNanoGPT(baseUrl: string, apiKey: string, request: ImageGenRequest): Promise<ImageGenResult> {
  const url = nanoGPTImagesUrl(baseUrl);
  const size = isOpenAIGptImageModel(request.model)
    ? openAIImageSize(request)
    : `${request.width ?? 1024}x${request.height ?? 1024}`;
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    n: 1,
    size,
    response_format: "b64_json",
  };
  if (request.model) body.model = request.model;
  if (request.negativePrompt) body.negative_prompt = request.negativePrompt;

  const references = request.referenceImages?.length
    ? request.referenceImages
    : request.referenceImage
      ? [request.referenceImage]
      : [];
  if (request.model?.toLowerCase().includes("flux-kontext")) {
    body.kontext_max_mode = true;
  }
  if (references.length === 1) {
    body.imageDataUrl = imageDataUrlFromReference(references[0]!);
  } else if (references.length > 1) {
    body.imageDataUrls = references.map(imageDataUrlFromReference);
  }

  const resp = await imageFetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
    },
    { allowLocal: request.allowLocalUrls },
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`NanoGPT image generation failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const data = (await resp.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const result = data.data?.[0];
  if (result?.b64_json) return { base64: result.b64_json, mimeType: "image/png", ext: "png" };
  if (result?.url) return downloadImageUrl(result.url, request.allowLocalUrls);

  throw new Error("No image data in NanoGPT response");
}

async function generatePollinations(request: ImageGenRequest): Promise<ImageGenResult> {
  const params = new URLSearchParams({
    width: String(request.width ?? 1024),
    height: String(request.height ?? 1024),
    nologo: "true",
    seed: String(Math.floor(Math.random() * 1e9)),
  });
  if (request.negativePrompt) params.set("negative", request.negativePrompt);

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(request.prompt)}?${params}`;
  const resp = await imageFetch(url, { signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT) });

  if (!resp.ok) {
    throw new Error(`Pollinations image generation failed (${resp.status})`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return { base64, mimeType: "image/jpeg", ext: "jpg" };
}

const HORDE_ANON_API_KEY = "0000000000";

function hordeUrl(baseUrl: string, targetPath: string): string {
  try {
    const url = new URL(baseUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const versionIndex = parts.findIndex((part, index) => part === "api" && parts[index + 1] === "v2");
    const prefix = versionIndex >= 0 ? parts.slice(0, versionIndex + 2) : [...parts, "api", "v2"];
    url.pathname = `/${[...prefix, ...targetPath.split("/").filter(Boolean)].join("/")}`;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return `${baseUrl.replace(/\/+$/, "")}/api/v2/${targetPath.replace(/^\/+/, "")}`;
  }
}

function hordeHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    apikey: apiKey.trim() || HORDE_ANON_API_KEY,
    "Client-Agent": "Marinara-Engine",
  };
}

function hordePrompt(request: ImageGenRequest): string {
  const prompt = request.prompt.trim();
  const negativePrompt = request.negativePrompt?.trim();
  return negativePrompt ? `${prompt} ### ${negativePrompt}` : prompt;
}

async function readHordeJson<T>(resp: Response, fallback: string): Promise<T> {
  const text = await resp.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${fallback}: ${sanitizeErrorText(text)}`);
  }
}

async function generateHorde(baseUrl: string, apiKey: string, request: ImageGenRequest): Promise<ImageGenResult> {
  const body: Record<string, unknown> = {
    prompt: hordePrompt(request),
    params: {
      n: 1,
      width: request.width ?? 512,
      height: request.height ?? 512,
      steps: 30,
      cfg_scale: 7,
      sampler_name: "k_euler",
    },
  };
  if (request.model) body.models = [request.model];

  const startResp = await imageFetch(
    hordeUrl(baseUrl, "generate/async"),
    {
      method: "POST",
      headers: hordeHeaders(apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
    },
    { allowLocal: request.allowLocalUrls },
  );

  if (!startResp.ok) {
    const errText = await startResp.text().catch(() => "Unknown error");
    throw new Error(`Horde image generation failed (${startResp.status}): ${sanitizeErrorText(errText)}`);
  }

  const start = await readHordeJson<{ id?: string }>(startResp, "Could not parse Horde generation response");
  const jobId = start.id?.trim();
  if (!jobId) throw new Error("Horde image generation did not return a job id");

  const maxAttempts = Math.max(1, Math.ceil(IMAGE_GEN_TIMEOUT / 2000));
  let completed = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const checkResp = await imageFetch(
      hordeUrl(baseUrl, `generate/check/${encodeURIComponent(jobId)}`),
      {
        headers: hordeHeaders(apiKey),
        signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
      },
      { allowLocal: request.allowLocalUrls },
    );

    if (!checkResp.ok) {
      const errText = await checkResp.text().catch(() => "Unknown error");
      throw new Error(`Horde image generation check failed (${checkResp.status}): ${sanitizeErrorText(errText)}`);
    }

    const check = await readHordeJson<{ done?: boolean; is_possible?: boolean; faulted?: boolean }>(
      checkResp,
      "Could not parse Horde generation check response",
    );
    if (check.is_possible === false || check.faulted) {
      throw new Error("Horde image generation could not be completed by available workers");
    }
    if (check.done) {
      completed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (!completed) {
    throw new Error("Horde image generation timed out before the worker finished");
  }

  const statusResp = await imageFetch(
    hordeUrl(baseUrl, `generate/status/${encodeURIComponent(jobId)}`),
    {
      headers: hordeHeaders(apiKey),
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
    },
    { allowLocal: request.allowLocalUrls },
  );

  if (!statusResp.ok) {
    const errText = await statusResp.text().catch(() => "Unknown error");
    throw new Error(`Horde image generation status failed (${statusResp.status}): ${sanitizeErrorText(errText)}`);
  }

  const status = await readHordeJson<{ generations?: Array<{ img?: string; censored?: boolean }> }>(
    statusResp,
    "Could not parse Horde generation status response",
  );
  const generation = status.generations?.find((item) => item.img);
  if (!generation?.img) throw new Error("No image data in Horde response");
  if (generation.censored) throw new Error("Horde image generation was censored by the worker");

  const image = generation.img.trim();
  if (image.startsWith("data:")) return decodeImageDataUrl(image);
  if (/^https?:\/\//i.test(image)) return downloadImageUrl(image, request.allowLocalUrls);

  const mimeType = detectImageMimeType(image);
  return { base64: image, mimeType, ext: imageExtensionFromMimeType(mimeType) };
}

function buildStabilityUrl(baseUrl: string, targetPath: string): string {
  try {
    const url = new URL(baseUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const versionIndex = parts.findIndex((part) => part === "v1" || part === "v2beta");
    const prefix = versionIndex >= 0 ? parts.slice(0, versionIndex) : parts;
    url.pathname = `/${[...prefix, ...targetPath.split("/").filter(Boolean)].join("/")}`;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return `${baseUrl.replace(/\/+$/, "")}/${targetPath.replace(/^\/+/, "")}`;
  }
}

function isStabilityV1Base(baseUrl: string): boolean {
  try {
    const parts = new URL(baseUrl).pathname.split("/").filter(Boolean);
    return parts.includes("v1") && !parts.includes("v2beta");
  } catch {
    return /\/v1(?:\/|$)/i.test(baseUrl) && !/\/v2beta(?:\/|$)/i.test(baseUrl);
  }
}

function normalizeStabilitySd3Model(model?: string): string {
  const raw = model?.trim() || "sd3.5-large";
  const lower = raw.toLowerCase();
  if (lower === "sd3-large") return "sd3.5-large";
  if (lower === "sd3-large-turbo") return "sd3.5-large-turbo";
  if (lower === "sd3-medium") return "sd3.5-medium";
  return raw;
}

function resolveStabilityV2Endpoint(baseUrl: string, request: ImageGenRequest): { url: string; model: string | null } {
  const hasReference = Boolean(request.referenceImage || request.referenceImages?.length);
  const model = request.model?.trim().toLowerCase() ?? "";

  if (!hasReference && (model === "stable-image-ultra" || model === "ultra")) {
    return { url: buildStabilityUrl(baseUrl, "v2beta/stable-image/generate/ultra"), model: null };
  }

  if (!hasReference && (model === "stable-image-core" || model === "core")) {
    return { url: buildStabilityUrl(baseUrl, "v2beta/stable-image/generate/core"), model: null };
  }

  return {
    url: buildStabilityUrl(baseUrl, "v2beta/stable-image/generate/sd3"),
    model: normalizeStabilitySd3Model(request.model),
  };
}

function stabilityAspectRatio(width?: number, height?: number): string | null {
  if (!width || !height) return null;
  const ratio = width / height;
  const candidates = [
    ["21:9", 21 / 9],
    ["16:9", 16 / 9],
    ["3:2", 3 / 2],
    ["5:4", 5 / 4],
    ["1:1", 1],
    ["4:5", 4 / 5],
    ["2:3", 2 / 3],
    ["9:16", 9 / 16],
    ["9:21", 9 / 21],
  ] as const;
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

function normalizeStabilityV1Engine(model?: string): string {
  const raw = model?.trim() ?? "";
  const lower = raw.toLowerCase();
  if (!raw || lower.startsWith("sd3") || lower.startsWith("stable-image") || lower.includes("/")) {
    return "stable-diffusion-xl-1024-v1-0";
  }
  return raw;
}

async function generateStability(baseUrl: string, apiKey: string, request: ImageGenRequest): Promise<ImageGenResult> {
  if (isStabilityV1Base(baseUrl)) {
    return generateStabilityV1(baseUrl, apiKey, request);
  }

  const endpoint = resolveStabilityV2Endpoint(baseUrl, request);
  const formData = new FormData();
  formData.append("prompt", request.prompt);
  if (request.negativePrompt) formData.append("negative_prompt", request.negativePrompt);
  if (endpoint.model) formData.append("model", endpoint.model);
  const aspectRatio = stabilityAspectRatio(request.width, request.height);
  if (aspectRatio) formData.append("aspect_ratio", aspectRatio);
  if (request.referenceImage) {
    formData.append(
      "image",
      new Blob([Buffer.from(request.referenceImage, "base64")], { type: "image/png" }),
      "reference.png",
    );
    formData.append("strength", "0.5");
    formData.append("mode", "image-to-image");
  } else if (request.referenceImages?.length) {
    formData.append(
      "image",
      new Blob([Buffer.from(request.referenceImages[0]!, "base64")], { type: "image/png" }),
      "reference.png",
    );
    formData.append("strength", "0.5");
    formData.append("mode", "image-to-image");
  }
  formData.append("output_format", "png");

  const resp = await imageFetch(
    endpoint.url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "image/*",
      },
      body: formData,
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
    },
    { allowLocal: request.allowLocalUrls },
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`Stability image generation failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return { base64, mimeType: "image/png", ext: "png" };
}

async function generateStabilityV1(baseUrl: string, apiKey: string, request: ImageGenRequest): Promise<ImageGenResult> {
  const engine = normalizeStabilityV1Engine(request.model);
  const url = buildStabilityUrl(baseUrl, `v1/generation/${engine}/text-to-image`);
  const textPrompts: Array<{ text: string; weight: number }> = [{ text: request.prompt, weight: 1 }];
  if (request.negativePrompt) textPrompts.push({ text: request.negativePrompt, weight: -1 });

  const body = {
    text_prompts: textPrompts,
    cfg_scale: 7,
    height: request.height ?? 1024,
    width: request.width ?? 1024,
    samples: 1,
    steps: 30,
  };

  const resp = await imageFetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
    },
    { allowLocal: request.allowLocalUrls },
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`Stability image generation failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const data = (await resp.json()) as { artifacts?: Array<{ base64?: string }> };
  const base64 = data.artifacts?.find((artifact) => artifact.base64)?.base64;
  if (!base64) throw new Error("No image data in Stability response");

  return { base64, mimeType: "image/png", ext: "png" };
}

async function generateTogetherAI(baseUrl: string, apiKey: string, request: ImageGenRequest): Promise<ImageGenResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/images/generations`;
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    model: request.model || "black-forest-labs/FLUX.1-schnell-Free",
    n: 1,
    width: request.width ?? 1024,
    height: request.height ?? 1024,
    response_format: "b64_json",
  };
  if (request.negativePrompt) body.negative_prompt = request.negativePrompt;

  const resp = await imageFetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
    },
    { allowLocal: request.allowLocalUrls },
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`Together AI image generation failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const data = (await resp.json()) as { data: Array<{ b64_json: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data in Together AI response");

  return { base64: b64, mimeType: "image/png", ext: "png" };
}

const NOVELAI_V4_PROMPT_HINT =
  "NovelAI V4/V4.5 prompts support roughly 512 T5 tokens and reject most Unicode prompt characters; try a shorter ASCII prompt without emoji or non-Latin text.";

function isNovelAiV4Model(model: string): boolean {
  return /^nai-diffusion-(?:4(?:-(?:curated-preview|full))?|4-5(?:-(?:curated|full))?)$/i.test(model.trim());
}

function sanitizeNovelAiV4Prompt(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function prepareNovelAiPrompt(value: string, fieldName: string, model: string): string {
  if (!isNovelAiV4Model(model)) return value;

  const sanitized = sanitizeNovelAiV4Prompt(value);
  if (value.trim() && !sanitized) {
    throw new Error(
      `NovelAI ${fieldName} contains only unsupported V4/V4.5 prompt characters. ${NOVELAI_V4_PROMPT_HINT}`,
    );
  }
  return sanitized;
}

async function generateNovelAI(baseUrl: string, apiKey: string, request: ImageGenRequest): Promise<ImageGenResult> {
  // Only use the native NovelAI API format when hitting the actual NovelAI domain.
  // Proxies (linkapi.ai, etc.) expose OpenAI-compatible chat completions that return
  // image URLs in markdown format (![image](url)).
  const isNativeNovelAI = baseUrl.toLowerCase().includes("novelai.net");
  if (!isNativeNovelAI) {
    return generateViaChatCompletions(baseUrl, apiKey, request);
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/ai/generate-image`;
  const model = request.model || "nai-diffusion-4-5-full";
  const isV4 = isNovelAiV4Model(model);
  const defaults = resolveNovelAiDefaults(request);
  const prompt = prepareNovelAiPrompt(mergePromptPrefix(defaults.promptPrefix, request.prompt), "prompt", model);
  const negativePrompt = prepareNovelAiPrompt(
    mergeNegativePrompt(defaults.negativePromptPrefix, request.negativePrompt),
    "negative prompt",
    model,
  );
  const seed = resolveSeed(request.imageDefaults);

  const parameters: Record<string, unknown> = {
    width: request.width ?? 832,
    height: request.height ?? 1216,
    n_samples: 1,
    ucPreset: defaults.undesiredContentPreset,
    negative_prompt: negativePrompt,
    seed,
    scale: defaults.promptGuidance,
    steps: defaults.steps,
    sampler: defaults.sampler,
  };
  if (defaults.noiseSchedule) {
    parameters.noise_schedule = defaults.noiseSchedule;
  }
  if (isV4) {
    parameters.cfg_rescale = defaults.promptGuidanceRescale;
  }

  if (isV4) {
    parameters.params_version = 3;
    parameters.v4_prompt = {
      caption: { base_caption: prompt, char_captions: [] },
      use_coords: false,
      use_order: true,
    };
    parameters.v4_negative_prompt = {
      caption: { base_caption: negativePrompt, char_captions: [] },
      use_coords: false,
      use_order: true,
    };
    if (request.referenceImage) {
      parameters.reference_image_multiple = [request.referenceImage];
      parameters.reference_information_extracted_multiple = [1];
      parameters.reference_strength_multiple = [0.6];
    } else if (request.referenceImages?.length) {
      parameters.reference_image_multiple = request.referenceImages;
      parameters.reference_information_extracted_multiple = request.referenceImages.map(() => 1);
      parameters.reference_strength_multiple = request.referenceImages.map(() => 0.6);
    } else {
      parameters.reference_image_multiple = [];
      parameters.reference_information_extracted_multiple = [];
      parameters.reference_strength_multiple = [];
    }
  }

  const body: Record<string, unknown> = {
    input: prompt,
    model,
    action: "generate",
    parameters,
  };

  const resp = await imageFetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
    },
    { allowLocal: request.allowLocalUrls },
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    const hint = isV4 ? ` ${NOVELAI_V4_PROMPT_HINT}` : "";
    throw new Error(`NovelAI image generation failed (${resp.status}): ${sanitizeErrorText(errText)}${hint}`);
  }

  // NovelAI returns a zip file containing the image
  const arrayBuffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // Check if response is a zip (PK signature) — extract using the central directory
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const extracted = extractFirstFileFromZip(bytes);
    if (extracted) {
      const imageBytes = appendNovelAiGenerationMetadata(Buffer.from(extracted), body);
      const base64 = imageBytes.toString("base64");
      return { base64, mimeType: "image/png", ext: "png" };
    }
  }

  // Check if it's a PNG directly
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const imageBytes = appendNovelAiGenerationMetadata(Buffer.from(bytes), body);
    const base64 = imageBytes.toString("base64");
    return { base64, mimeType: "image/png", ext: "png" };
  }

  // Try parsing as JSON (some proxies return JSON with base64)
  try {
    const text = new TextDecoder().decode(bytes);
    const json = JSON.parse(text);
    const b64 = json.data?.[0]?.b64_json ?? json.output?.[0] ?? json.image;
    if (b64) return { base64: b64, mimeType: "image/png", ext: "png" };
  } catch {
    /* not JSON */
  }

  throw new Error("Could not parse NovelAI image response");
}

function appendNovelAiGenerationMetadata(image: Buffer, body: Record<string, unknown>): Buffer {
  try {
    const metadata = JSON.stringify({
      source: "marinara-engine",
      provider: "novelai",
      request: body,
    });
    return injectPngTextChunk(image, "marinara_novelai_request", metadata);
  } catch {
    return image;
  }
}

function injectPngTextChunk(png: Buffer, keyword: string, text: string): Buffer {
  if (png.subarray(0, 8).compare(PNG_SIGNATURE) !== 0) {
    throw new Error("Invalid PNG signature");
  }

  const textChunk = buildPngChunk("iTXt", buildPngInternationalTextData(keyword, text));
  const parts: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;
  let inserted = false;

  while (offset < png.length) {
    const chunkLen = png.readUInt32BE(offset);
    const chunkType = png.subarray(offset + 4, offset + 8).toString("ascii");
    const totalChunkSize = 4 + 4 + chunkLen + 4;
    const chunkBuf = png.subarray(offset, offset + totalChunkSize);

    if (chunkType === "IDAT" && !inserted) {
      parts.push(textChunk);
      inserted = true;
    }
    parts.push(chunkBuf);
    offset += totalChunkSize;
  }

  if (!inserted) {
    parts.splice(parts.length - 1, 0, textChunk);
  }

  return Buffer.concat(parts);
}

function buildPngInternationalTextData(keyword: string, text: string): Buffer {
  return Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(text, "utf8")]);
}

function buildPngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Extract the first file from a zip archive.
 * Uses the central directory (at the end of the zip) to get reliable offset/size,
 * since local file headers may have zeroed-out sizes when a data descriptor is used.
 */
function extractFirstFileFromZip(zip: Uint8Array): Uint8Array | null {
  // Find End of Central Directory record (search backwards for signature 0x06054b50)
  let eocdOffset = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;
  if (eocdOffset + 19 >= zip.length) return null;

  // Read first central directory entry offset
  const cdOffset =
    zip[eocdOffset + 16]! |
    (zip[eocdOffset + 17]! << 8) |
    (zip[eocdOffset + 18]! << 16) |
    (zip[eocdOffset + 19]! << 24);

  // Parse central directory entry for the first file
  const cd = cdOffset;
  if (cd + 45 >= zip.length) return null;
  if (zip[cd] !== 0x50 || zip[cd + 1] !== 0x4b || zip[cd + 2] !== 0x01 || zip[cd + 3] !== 0x02) return null;

  const method = zip[cd + 10]! | (zip[cd + 11]! << 8);
  const compSize = zip[cd + 20]! | (zip[cd + 21]! << 8) | (zip[cd + 22]! << 16) | (zip[cd + 23]! << 24);
  const uncompSize = zip[cd + 24]! | (zip[cd + 25]! << 8) | (zip[cd + 26]! << 16) | (zip[cd + 27]! << 24);
  const localHeaderOffset = zip[cd + 42]! | (zip[cd + 43]! << 8) | (zip[cd + 44]! << 16) | (zip[cd + 45]! << 24);

  // Skip past local file header to reach data
  const lh = localHeaderOffset;
  if (lh + 29 >= zip.length) return null;
  const lhFnLen = zip[lh + 26]! | (zip[lh + 27]! << 8);
  const lhExtraLen = zip[lh + 28]! | (zip[lh + 29]! << 8);
  const dataStart = lh + 30 + lhFnLen + lhExtraLen;

  const dataSize = method === 0 ? uncompSize : compSize;
  if (dataStart + dataSize > zip.length) return null;
  if (method === 0) {
    // Stored (no compression)
    return zip.slice(dataStart, dataStart + uncompSize);
  }

  if (method === 8) {
    // Deflate
    const compressed = zip.slice(dataStart, dataStart + compSize);
    try {
      return inflateRawSync(Buffer.from(compressed));
    } catch {
      // Malformed or unsupported deflate data
      return null;
    }
  }

  // Unsupported compression method
  return null;
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, "");
    if (!path.endsWith("/chat/completions")) {
      url.pathname =
        path.endsWith("/v1") || path.endsWith("/api/v1") ? `${path}/chat/completions` : `${path}/chat/completions`;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return `${trimmed}/chat/completions`;
  }
}

function buildChatImageMessageContent(request: ImageGenRequest): string | Array<Record<string, unknown>> {
  const refImages = request.referenceImages ?? (request.referenceImage ? [request.referenceImage] : []);
  const prompt = request.negativePrompt
    ? `${request.prompt}\n\nAvoid in the image: ${request.negativePrompt}`
    : request.prompt;
  if (refImages.length > 0) {
    const parts: Array<Record<string, unknown>> = refImages.map((b64) => ({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${b64}` },
    }));
    parts.push({ type: "text", text: prompt });
    return parts;
  }
  return prompt;
}

function extractImageUrlFromMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const record = message as Record<string, unknown>;
  const images = Array.isArray(record.images) ? record.images : [];
  for (const image of images) {
    if (!image || typeof image !== "object") continue;
    const imageRecord = image as Record<string, unknown>;
    const snake = imageRecord.image_url;
    if (snake && typeof snake === "object" && typeof (snake as Record<string, unknown>).url === "string") {
      return (snake as { url: string }).url;
    }
    const camel = imageRecord.imageUrl;
    if (camel && typeof camel === "object" && typeof (camel as Record<string, unknown>).url === "string") {
      return (camel as { url: string }).url;
    }
    if (typeof imageRecord.url === "string") return imageRecord.url;
  }

  const content = typeof record.content === "string" ? record.content : "";
  const mdMatch = content.match(/!\[[^\]]*\]\(([^)]+)\)/);
  const dataUrlMatch = content.match(/data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+/i);
  return mdMatch?.[1] ?? dataUrlMatch?.[0] ?? content.match(/https?:\/\/\S+\.(png|jpg|jpeg|webp|gif)/i)?.[0] ?? null;
}

function openRouterAspectRatio(width?: number, height?: number): string | null {
  if (!width || !height) return null;
  const ratio = width / Math.max(1, height);
  const candidates = [
    ["21:9", 21 / 9],
    ["16:9", 16 / 9],
    ["3:2", 3 / 2],
    ["5:4", 5 / 4],
    ["4:3", 4 / 3],
    ["1:1", 1],
    ["3:4", 3 / 4],
    ["4:5", 4 / 5],
    ["2:3", 2 / 3],
    ["9:16", 9 / 16],
  ] as const;
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

function openRouterModalities(model?: string): string[] {
  const lower = model?.trim().toLowerCase() ?? "";
  if (lower.startsWith("black-forest-labs/") || lower.startsWith("sourceful/") || lower.startsWith("recraft/")) {
    return ["image"];
  }
  return ["image", "text"];
}

async function generateOpenRouter(baseUrl: string, apiKey: string, request: ImageGenRequest): Promise<ImageGenResult> {
  const body: Record<string, unknown> = {
    model: request.model || "google/gemini-2.5-flash-image",
    messages: [{ role: "user", content: buildChatImageMessageContent(request) }],
    modalities: openRouterModalities(request.model),
    stream: false,
  };
  const aspectRatio = openRouterAspectRatio(request.width, request.height);
  if (aspectRatio) body.image_config = { aspect_ratio: aspectRatio };

  const resp = await imageFetch(
    chatCompletionsUrl(baseUrl),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
    },
    { allowLocal: request.allowLocalUrls },
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`OpenRouter image generation failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const data = (await resp.json()) as { choices?: Array<{ message?: unknown }> };
  const message = data.choices?.[0]?.message;
  const imageUrl = extractImageUrlFromMessage(message);
  if (!imageUrl) {
    const content =
      message && typeof message === "object" && typeof (message as Record<string, unknown>).content === "string"
        ? ((message as Record<string, string>).content ?? "")
        : "";
    throw new Error(`No image data in OpenRouter response: ${content.slice(0, 200)}`);
  }

  return downloadImageUrl(imageUrl, request.allowLocalUrls);
}

/**
 * Generate an image via an OpenAI-compatible chat completions endpoint.
 * Some proxies (LinkAPI, etc.) expose image models through /chat/completions
 * and return the result as a markdown image link: ![image](url)
 */
async function generateViaChatCompletions(
  baseUrl: string,
  apiKey: string,
  request: ImageGenRequest,
): Promise<ImageGenResult> {
  const url = chatCompletionsUrl(baseUrl);
  const messageContent = buildChatImageMessageContent(request);

  const resp = await imageFetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || "nai-diffusion-4-5-full",
        messages: [{ role: "user", content: messageContent }],
        stream: false,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
    },
    { allowLocal: request.allowLocalUrls },
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`Image generation via chat completions failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: unknown }>;
  };
  const message = data.choices?.[0]?.message;
  const imageUrl = extractImageUrlFromMessage(message);

  if (!imageUrl) {
    const content =
      message && typeof message === "object" && typeof (message as Record<string, unknown>).content === "string"
        ? ((message as Record<string, string>).content ?? "")
        : "";
    throw new Error(`No image URL found in proxy response: ${content.slice(0, 200)}`);
  }

  return downloadImageUrl(imageUrl, request.allowLocalUrls);
}

// ── ComfyUI ──

/** Default minimal txt2img workflow for ComfyUI. */
const DEFAULT_COMFYUI_WORKFLOW: Record<string, unknown> = {
  "3": {
    class_type: "KSampler",
    inputs: {
      seed: "%seed%",
      steps: 20,
      cfg: 7,
      sampler_name: "euler_ancestral",
      scheduler: "normal",
      denoise: 1,
      model: ["4", 0],
      positive: ["6", 0],
      negative: ["7", 0],
      latent_image: ["5", 0],
    },
  },
  "4": {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: "%model%" },
  },
  "5": {
    class_type: "EmptyLatentImage",
    inputs: { width: "%width%", height: "%height%", batch_size: 1 },
  },
  "6": {
    class_type: "CLIPTextEncode",
    inputs: { text: "%prompt%", clip: ["4", 1] },
  },
  "7": {
    class_type: "CLIPTextEncode",
    inputs: { text: "%negative_prompt%", clip: ["4", 1] },
  },
  "8": {
    class_type: "VAEDecode",
    inputs: { samples: ["3", 0], vae: ["4", 2] },
  },
  "9": {
    class_type: "SaveImage",
    inputs: { filename_prefix: "marinara", images: ["8", 0] },
  },
};

const COMFYUI_GEN_TIMEOUT = Number(process.env.COMFYUI_GEN_TIMEOUT ?? 120);

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

function resolveSeed(profile: ImageGenerationDefaultsProfile | null | undefined): number {
  return typeof profile?.seed === "number" && profile.seed >= 0 ? profile.seed : randomSeed();
}

function resolveNovelAiDefaults(request: ImageGenRequest): NovelAiDefaults {
  if (request.imageDefaults?.service === "novelai" && request.imageDefaults.novelai) {
    return request.imageDefaults.novelai;
  }
  return DEFAULT_NOVELAI_DEFAULTS;
}

function resolveAutomatic1111Defaults(request: ImageGenRequest): Automatic1111Defaults {
  if (request.imageDefaults?.service === "automatic1111" && request.imageDefaults.automatic1111) {
    return request.imageDefaults.automatic1111;
  }
  return DEFAULT_AUTOMATIC1111_DEFAULTS;
}

function resolveComfyUiDefaults(request: ImageGenRequest): ComfyUiDefaults {
  if (request.imageDefaults?.service === "comfyui" && request.imageDefaults.comfyui) {
    return request.imageDefaults.comfyui;
  }
  return DEFAULT_COMFYUI_DEFAULTS;
}

function buildDefaultComfyUiWorkflow(defaults: ComfyUiDefaults): Record<string, unknown> {
  const workflow = JSON.parse(JSON.stringify(DEFAULT_COMFYUI_WORKFLOW)) as Record<string, unknown>;
  const samplerInputs = ((workflow["3"] as Record<string, unknown>)?.inputs ?? {}) as Record<string, unknown>;
  samplerInputs.steps = defaults.steps;
  samplerInputs.cfg = defaults.cfgScale;
  samplerInputs.sampler_name = defaults.sampler || DEFAULT_COMFYUI_DEFAULTS.sampler;
  samplerInputs.scheduler = defaults.scheduler || DEFAULT_COMFYUI_DEFAULTS.scheduler;
  samplerInputs.denoise = defaults.denoisingStrength;
  return workflow;
}

function replaceComfyUiPlaceholders(
  value: unknown,
  replacements: Record<string, string | number>,
): unknown {
  if (typeof value === "string") {
    const exactReplacement = replacements[value];
    if (exactReplacement !== undefined) return exactReplacement;

    return Object.entries(replacements).reduce(
      (resolved, [placeholder, replacement]) => resolved.replaceAll(placeholder, String(replacement)),
      value,
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceComfyUiPlaceholders(item, replacements));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, replaceComfyUiPlaceholders(entry, replacements)]),
    );
  }

  return value;
}

async function generateComfyUI(baseUrl: string, request: ImageGenRequest): Promise<ImageGenResult> {
  const base = baseUrl.replace(/\/+$/, "");
  const defaults = resolveComfyUiDefaults(request);
  const seed = resolveSeed(request.imageDefaults);
  const prompt = mergePromptPrefix(defaults.promptPrefix, request.prompt || "");
  const negativePrompt = mergeNegativePrompt(defaults.negativePromptPrefix, request.negativePrompt);

  // Parse custom workflow or use default
  let workflow: Record<string, unknown>;
  if (request.comfyWorkflow) {
    try {
      workflow = JSON.parse(request.comfyWorkflow) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid ComfyUI workflow JSON");
    }
  } else {
    workflow = buildDefaultComfyUiWorkflow(defaults);
  }

  const replacements: Record<string, string | number> = {
    "%prompt%": prompt,
    "%negative_prompt%": negativePrompt,
    "%width%": request.width ?? 512,
    "%height%": request.height ?? 768,
    "%seed%": seed,
    "%steps%": defaults.steps,
    "%cfg%": defaults.cfgScale,
    "%cfg_scale%": defaults.cfgScale,
    "%scale%": defaults.cfgScale,
    "%sampler%": defaults.sampler,
    "%scheduler%": defaults.scheduler,
    "%denoise%": defaults.denoisingStrength,
    "%denoising_strength%": defaults.denoisingStrength,
    "%clip_skip%": defaults.clipSkip ?? 0,
  };
  if (request.model) {
    replacements["%model%"] = request.model;
  }
  if (request.referenceImage) {
    replacements["%reference_image%"] = request.referenceImage;
  } else if (request.referenceImages?.length) {
    replacements["%reference_image%"] = request.referenceImages[0]!;
  }
  const resolvedWorkflow = replaceComfyUiPlaceholders(workflow, replacements);

  // Queue the workflow
  const queueResp = await localImageBackendFetch(`${base}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: resolvedWorkflow }),
    signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
  });

  if (!queueResp.ok) {
    const errText = await queueResp.text().catch(() => "Unknown error");
    throw new Error(`ComfyUI queue failed (${queueResp.status}): ${sanitizeErrorText(errText)}`);
  }

  const { prompt_id } = (await queueResp.json()) as { prompt_id: string };

  // Poll for completion (max ~120 seconds)
  for (let i = 0; i < COMFYUI_GEN_TIMEOUT; i++) {
    await new Promise((r) => setTimeout(r, 1000));

    const historyResp = await localImageBackendFetch(`${base}/history/${prompt_id}`, {
      signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
    });
    if (!historyResp.ok) continue;

    const history = (await historyResp.json()) as Record<
      string,
      {
        outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
      }
    >;

    const entry = history[prompt_id];
    if (!entry?.outputs) continue;

    // Find the first output with images
    for (const nodeOutput of Object.values(entry.outputs)) {
      const images = nodeOutput.images;
      if (images && images.length > 0) {
        const img = images[0]!;
        const params = new URLSearchParams({
          filename: img.filename,
          subfolder: img.subfolder || "",
          type: img.type || "output",
        });

        const imgResp = await localImageBackendFetch(`${base}/view?${params}`, {
          signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
        });
        if (!imgResp.ok) {
          throw new Error(`ComfyUI image fetch failed (${imgResp.status})`);
        }

        const arrayBuffer = await imgResp.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        const ext = img.filename.endsWith(".jpg") || img.filename.endsWith(".jpeg") ? "jpg" : "png";
        const mimeType = ext === "jpg" ? "image/jpeg" : "image/png";
        return { base64, mimeType, ext };
      }
    }
  }

  throw new Error("ComfyUI generation timed out after 120 seconds");
}

// ── AUTOMATIC1111 / SD Web UI / Forge ──

async function generateAutomatic1111(baseUrl: string, request: ImageGenRequest): Promise<ImageGenResult> {
  const base = baseUrl.replace(/\/+$/, "");
  const defaults = resolveAutomatic1111Defaults(request);
  const useImg2Img = !!(request.referenceImage || request.referenceImages?.length);
  const overrideSettings: Record<string, unknown> = {};
  if (request.model) {
    overrideSettings.sd_model_checkpoint = request.model;
  }
  if (defaults.clipSkip) {
    overrideSettings.CLIP_stop_at_last_layers = defaults.clipSkip;
  }

  const body: Record<string, unknown> = {
    prompt: mergePromptPrefix(defaults.promptPrefix, request.prompt),
    negative_prompt: mergeNegativePrompt(defaults.negativePromptPrefix, request.negativePrompt),
    width: request.width ?? 512,
    height: request.height ?? 768,
    steps: defaults.steps,
    cfg_scale: defaults.cfgScale,
    seed: resolveSeed(request.imageDefaults),
    sampler_name: defaults.sampler || DEFAULT_AUTOMATIC1111_DEFAULTS.sampler,
    batch_size: 1,
    n_iter: 1,
    restore_faces: defaults.restoreFaces,
  };
  if (defaults.scheduler) {
    body.scheduler = defaults.scheduler;
  }
  if (Object.keys(overrideSettings).length > 0) {
    body.override_settings = overrideSettings;
  }
  if (useImg2Img) {
    body.init_images = [request.referenceImage ?? request.referenceImages?.[0]];
    body.denoising_strength = defaults.denoisingStrength;
  }

  const endpoint = useImg2Img ? `${base}/sdapi/v1/img2img` : `${base}/sdapi/v1/txt2img`;

  const resp = await localImageBackendFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`AUTOMATIC1111 generation failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const data = (await resp.json()) as { images?: string[] };
  const b64 = data.images?.[0];
  if (!b64) throw new Error("No image data in AUTOMATIC1111 response");

  return { base64: b64, mimeType: "image/png", ext: "png" };
}
