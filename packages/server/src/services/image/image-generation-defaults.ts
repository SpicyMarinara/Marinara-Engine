import {
  IMAGE_DEFAULTS_STORAGE_KEY,
  imageSourceToDefaultsService,
  inferImageSource,
  normalizeImageGenerationProfile,
  type ImageGenerationDefaultsProfile,
} from "@marinara-engine/shared";

export interface ImageDefaultsConnection {
  provider?: string | null;
  baseUrl?: string | null;
  model?: string | null;
  imageGenerationSource?: string | null;
  imageService?: string | null;
  defaultParameters?: string | Record<string, unknown> | null;
}

export function resolveImageGenerationService(conn: ImageDefaultsConnection): string {
  const explicit = (conn.imageService || conn.imageGenerationSource || "").trim();
  if (explicit) return explicit.toLowerCase();
  if (conn.baseUrl?.toLowerCase().includes("novelai.net")) return "novelai";
  return inferImageSource(conn.model || "", conn.baseUrl || "");
}

export function resolveConnectionImageDefaults(conn: ImageDefaultsConnection): ImageGenerationDefaultsProfile | null {
  const service = imageSourceToDefaultsService(resolveImageGenerationService(conn));
  if (!service) return null;

  const params = parseDefaultParametersRoot(conn.defaultParameters);
  return normalizeImageGenerationProfile(params[IMAGE_DEFAULTS_STORAGE_KEY], service).profile;
}

function parseDefaultParametersRoot(
  value: string | Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value : {};
}
