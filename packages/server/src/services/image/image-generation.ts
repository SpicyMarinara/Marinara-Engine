// ──────────────────────────────────────────────
// Service: Image Generation
// ──────────────────────────────────────────────
// Calls image generation APIs (OpenAI DALL-E, Pollinations, Stability, OpenRouter, etc.)
// based on a user's configured image_generation connection.

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { inflateRawSync } from "zlib";
import { DATA_DIR } from "../../utils/data-dir.js";
import { newId } from "../../utils/id-generator.js";
import { inferImageSource } from "@marinara-engine/shared";

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
  "openrouter",
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
  switch (resolvedSource) {
    case "openai":
    case "nanogpt":
      return generateOpenAI(baseUrl, apiKey, request);
    case "pollinations":
      return generatePollinations(request);
    case "stability":
      return generateStability(baseUrl, apiKey, request);
    case "togetherai":
      return generateTogetherAI(baseUrl, apiKey, request);
    case "novelai":
      return generateNovelAI(baseUrl, apiKey, request);
    case "comfyui":
      return generateComfyUI(baseUrl, request);
    case "automatic1111":
      return generateAutomatic1111(baseUrl, request);
    case "gemini_image":
      return generateViaChatCompletions(baseUrl, apiKey, request);
    case "openrouter":
      return generateOpenRouter(baseUrl, apiKey, request);
    default:
      // Fallback: try OpenAI-compatible endpoint
      return generateOpenAI(baseUrl, apiKey, request);
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

async function generateOpenAI(baseUrl: string, apiKey: string, request: ImageGenRequest): Promise<ImageGenResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/images/generations`;
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    n: 1,
    size: `${request.width ?? 1024}x${request.height ?? 1024}`,
    response_format: "b64_json",
  };
  if (request.model) body.model = request.model;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`OpenAI image generation failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const data = (await resp.json()) as { data: Array<{ b64_json: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data in OpenAI response");

  return { base64: b64, mimeType: "image/png", ext: "png" };
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
  const resp = await fetch(url, { signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT) });

  if (!resp.ok) {
    throw new Error(`Pollinations image generation failed (${resp.status})`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return { base64, mimeType: "image/jpeg", ext: "jpg" };
}

async function generateStability(baseUrl: string, apiKey: string, request: ImageGenRequest): Promise<ImageGenResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/stable-image/generate/sd3`;
  const formData = new FormData();
  formData.append("prompt", request.prompt);
  if (request.negativePrompt) formData.append("negative_prompt", request.negativePrompt);
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

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "image/*",
    },
    body: formData,
    signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`Stability image generation failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

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

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
  });

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

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
  });

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

  const resp = await fetch(url, {
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
  });

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

  // Download the image
  const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT) });
  if (!imgResp.ok) {
    throw new Error(`Failed to download generated image (${imgResp.status})`);
  }

  const arrayBuffer = await imgResp.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  // Detect mime type from URL extension or content-type header
  const contentType = imgResp.headers.get("content-type") ?? "";
  let mimeType = "image/png";
  let ext = "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg") || imageUrl.match(/\.jpe?g/i)) {
    mimeType = "image/jpeg";
    ext = "jpg";
  } else if (contentType.includes("webp") || imageUrl.match(/\.webp/i)) {
    mimeType = "image/webp";
    ext = "webp";
  }

  return { base64, mimeType, ext };
}

// ── OpenRouter ──

/**
 * Generate an image via OpenRouter's image-output models (Gemini 2.5 Flash Image, FLUX, etc.).
 * OpenRouter exposes them through /chat/completions and returns the image as a base64 data URL
 * inside `choices[0].message.images[0].image_url.url` when the request includes
 * `modalities: ["image", "text"]`. Reference images are passed as multimodal `image_url` parts.
 */
async function generateOpenRouter(
  baseUrl: string,
  apiKey: string,
  request: ImageGenRequest,
): Promise<ImageGenResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  // Build multimodal content: reference images first (data URLs), then the text prompt.
  const refImages = request.referenceImages?.length
    ? request.referenceImages
    : request.referenceImage
      ? [request.referenceImage]
      : [];
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

  const model = request.model || "google/gemini-2.5-flash-image";
  const body: Record<string, unknown> = {
    model,
    modalities: ["image", "text"],
    messages: [{ role: "user", content: messageContent }],
    stream: false,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // OpenRouter recommends these for attribution; harmless if absent.
      "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://marinara-engine.local",
      "X-Title": process.env.OPENROUTER_TITLE ?? "Marinara Engine",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`OpenRouter image generation failed (${resp.status}): ${sanitizeErrorText(errText)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<Record<string, unknown>>;
        images?: Array<{ type?: string; image_url?: { url?: string } }>;
      };
    }>;
  };

  const message = data.choices?.[0]?.message;
  const imageEntry = message?.images?.find((img) => img?.image_url?.url);
  let imageUrl = imageEntry?.image_url?.url;

  // Fallback 1: some routes embed the image as an `image_url` part directly inside `content`.
  if (!imageUrl && Array.isArray(message?.content)) {
    for (const part of message.content) {
      const partUrl = (part as { image_url?: { url?: string } })?.image_url?.url;
      if (typeof partUrl === "string") {
        imageUrl = partUrl;
        break;
      }
    }
  }

  // Fallback 2: legacy markdown / plain URL inside text content (older proxies).
  if (!imageUrl && typeof message?.content === "string") {
    const mdMatch = message.content.match(/!\[[^\]]*\]\(([^)]+)\)/);
    imageUrl = mdMatch?.[1] ?? message.content.match(/https?:\/\/\S+\.(png|jpg|jpeg|webp)/i)?.[0];
  }

  if (!imageUrl) {
    const preview =
      typeof message?.content === "string" ? message.content.slice(0, 200) : JSON.stringify(message ?? {}).slice(0, 200);
    throw new Error(`No image found in OpenRouter response: ${preview}`);
  }

  // Inline base64 data URL: parse mime + payload directly.
  const dataUrlMatch = imageUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1]!;
    const base64 = dataUrlMatch[2]!;
    const ext =
      mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : mimeType === "image/gif" ? "gif" : "png";
    return { base64, mimeType, ext };
  }

  // Otherwise it's a remote URL — download and detect the type from headers/extension.
  const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(IMAGE_GEN_TIMEOUT) });
  if (!imgResp.ok) {
    throw new Error(`Failed to download OpenRouter image (${imgResp.status})`);
  }
  const arrayBuffer = await imgResp.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const contentType = imgResp.headers.get("content-type") ?? "";
  let mimeType = "image/png";
  let ext = "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg") || /\.jpe?g($|\?)/i.test(imageUrl)) {
    mimeType = "image/jpeg";
    ext = "jpg";
  } else if (contentType.includes("webp") || /\.webp($|\?)/i.test(imageUrl)) {
    mimeType = "image/webp";
    ext = "webp";
  }
  return { base64, mimeType, ext };
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
  const seed = Math.floor(Math.random() * 2 ** 32);

  // Parse custom workflow or use default
  let workflow: Record<string, unknown>;
  if (request.comfyWorkflow) {
    try {
      workflow = JSON.parse(request.comfyWorkflow) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid ComfyUI workflow JSON");
    }
  } else {
    workflow = JSON.parse(JSON.stringify(DEFAULT_COMFYUI_WORKFLOW));
  }

  // Replace placeholders in the workflow JSON string
  let wfStr = JSON.stringify(workflow);
  wfStr = wfStr.replace(/%prompt%/g, escapeJsonString(request.prompt || ""));
  wfStr = wfStr.replace(/%negative_prompt%/g, escapeJsonString(request.negativePrompt || ""));
  wfStr = wfStr.replace(/%width%/g, String(request.width ?? 512));
  wfStr = wfStr.replace(/%height%/g, String(request.height ?? 768));
  wfStr = wfStr.replace(/%seed%/g, String(seed));
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
  const queueResp = await fetch(`${base}/prompt`, {
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

    const historyResp = await fetch(`${base}/history/${prompt_id}`);
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

        const imgResp = await fetch(`${base}/view?${params}`);
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
  const useImg2Img = !!(request.referenceImage || request.referenceImages?.length);
  const body: Record<string, unknown> = {
    prompt: request.prompt,
    negative_prompt: request.negativePrompt || "",
    width: request.width ?? 512,
    height: request.height ?? 768,
    steps: 20,
    cfg_scale: 7,
    seed: Math.floor(Math.random() * 2 ** 32),
    sampler_name: "Euler a",
    batch_size: 1,
    n_iter: 1,
  };
  if (request.model) {
    body.override_settings = { sd_model_checkpoint: request.model };
  }
  if (useImg2Img) {
    body.init_images = [request.referenceImage ?? request.referenceImages?.[0]];
    body.denoising_strength = 0.6;
  }

  const endpoint = useImg2Img ? `${base}/sdapi/v1/img2img` : `${base}/sdapi/v1/txt2img`;

  const resp = await fetch(endpoint, {
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
