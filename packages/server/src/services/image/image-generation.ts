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
  mergeNegativePrompt,
  mergePromptPrefix,
  inferImageSource,
  type Automatic1111Defaults,
  type ComfyUiDefaults,
  type ImageGenerationDefaultsProfile,
} from "@marinara-engine/shared";
import { isImageLocalUrlsEnabled } from "../../config/runtime-config.js";
import { normalizeLoopbackUrl, safeFetch, validateOutboundUrl } from "../../utils/security.js";

const GALLERY_DIR = join(DATA_DIR, "gallery");

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
  "pollinations",
  "stability",
  "togetherai",
  "novelai",
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
    case "pollinations":
      return generatePollinations(scopedRequest);
    case "stability":
      return generateStability(normalizedBaseUrl, apiKey, scopedRequest);
    case "togetherai":
      return generateTogetherAI(normalizedBaseUrl, apiKey, scopedRequest);
    case "novelai":
      return generateNovelAI(normalizedBaseUrl, apiKey, scopedRequest);
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

async function downloadImageUrl(imageUrl: string, allowLocalUrls = false): Promise<ImageGenResult> {
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
  let mimeType = "image/png";
  let ext = "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg") || normalizedImageUrl.match(/\.jpe?g/i)) {
    mimeType = "image/jpeg";
    ext = "jpg";
  } else if (contentType.includes("webp") || normalizedImageUrl.match(/\.webp/i)) {
    mimeType = "image/webp";
    ext = "webp";
  }

  return { base64, mimeType, ext };
}

async function generateOpenAI(baseUrl: string, apiKey: string, request: ImageGenRequest): Promise<ImageGenResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/images/generations`;
  const usesGptImageApi = isOpenAIGptImageModel(request.model);
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

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`OpenAI image generation failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const data = (await resp.json()) as { data: Array<{ b64_json: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data in OpenAI response");

  return { base64: b64, mimeType: "image/png", ext: "png" };
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
  const isV4 = model.includes("nai-diffusion-4");

  const parameters: Record<string, unknown> = {
    width: request.width ?? 832,
    height: request.height ?? 1216,
    n_samples: 1,
    ucPreset: 0,
    negative_prompt: request.negativePrompt ?? "",
    seed: Math.floor(Math.random() * 2 ** 32),
    scale: 6,
    steps: 28,
    sampler: "k_euler_ancestral",
  };

  if (isV4) {
    parameters.params_version = 3;
    parameters.v4_prompt = {
      caption: { base_caption: request.prompt, char_captions: [] },
      use_coords: false,
      use_order: true,
    };
    parameters.v4_negative_prompt = {
      caption: { base_caption: request.negativePrompt ?? "", char_captions: [] },
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
    input: isV4 ? "" : request.prompt,
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
    throw new Error(`NovelAI image generation failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  // NovelAI returns a zip file containing the image
  const arrayBuffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // Check if response is a zip (PK signature) — extract using the central directory
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const extracted = extractFirstFileFromZip(bytes);
    if (extracted) {
      const base64 = Buffer.from(extracted).toString("base64");
      return { base64, mimeType: "image/png", ext: "png" };
    }
  }

  // Check if it's a PNG directly
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const base64 = Buffer.from(bytes).toString("base64");
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
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  // Build multimodal content parts: reference images first, then the text prompt
  const refImages = request.referenceImages ?? (request.referenceImage ? [request.referenceImage] : []);
  let messageContent: string | Array<Record<string, unknown>>;
  if (refImages.length > 0) {
    const parts: Array<Record<string, unknown>> = refImages.map((b64) => ({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${b64}` },
    }));
    parts.push({ type: "text", text: request.prompt });
    messageContent = parts;
  } else {
    messageContent = request.prompt;
  }

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
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";

  // Extract image URL from markdown: ![...](url) or plain https:// URL
  const mdMatch = content.match(/!\[[^\]]*\]\(([^)]+)\)/);
  const imageUrl = mdMatch?.[1] ?? content.match(/https?:\/\/\S+\.(png|jpg|jpeg|webp)/i)?.[0];

  if (!imageUrl) {
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

function escapeJsonString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
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

  // Replace placeholders in the workflow JSON string
  let wfStr = JSON.stringify(workflow);
  wfStr = wfStr.replace(/%prompt%/g, escapeJsonString(prompt));
  wfStr = wfStr.replace(/%negative_prompt%/g, escapeJsonString(negativePrompt));
  wfStr = wfStr.replace(/%width%/g, String(request.width ?? 512));
  wfStr = wfStr.replace(/%height%/g, String(request.height ?? 768));
  wfStr = wfStr.replace(/%seed%/g, String(seed));
  wfStr = wfStr.replace(/%steps%/g, String(defaults.steps));
  wfStr = wfStr.replace(/%cfg%/g, String(defaults.cfgScale));
  wfStr = wfStr.replace(/%cfg_scale%/g, String(defaults.cfgScale));
  wfStr = wfStr.replace(/%scale%/g, String(defaults.cfgScale));
  wfStr = wfStr.replace(/%sampler%/g, escapeJsonString(defaults.sampler));
  wfStr = wfStr.replace(/%scheduler%/g, escapeJsonString(defaults.scheduler));
  wfStr = wfStr.replace(/%denoise%/g, String(defaults.denoisingStrength));
  wfStr = wfStr.replace(/%denoising_strength%/g, String(defaults.denoisingStrength));
  wfStr = wfStr.replace(/%clip_skip%/g, String(defaults.clipSkip ?? 0));
  if (request.model) {
    wfStr = wfStr.replace(/%model%/g, request.model.replace(/"/g, '\\"'));
  }
  if (request.referenceImage) {
    wfStr = wfStr.replace(/%reference_image%/g, request.referenceImage.replace(/"/g, '\\"'));
  } else if (request.referenceImages?.length) {
    wfStr = wfStr.replace(/%reference_image%/g, request.referenceImages[0]!.replace(/"/g, '\\"'));
  }
  const resolvedWorkflow = JSON.parse(wfStr);

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
