import type {
  Automatic1111Defaults,
  ComfyUiDefaults,
  ImageDefaultsService,
  ImageGenerationDefaultsProfile,
  NovelAiDefaults,
} from "../types/image-generation-defaults.js";

export const IMAGE_DEFAULTS_STORAGE_KEY = "imageGeneration";
export const IMAGE_GENERATION_DEFAULTS_VERSION = 1 as const;

export const IMAGE_DEFAULTS_SERVICES: ImageDefaultsService[] = ["automatic1111", "comfyui", "novelai"];

export const DEFAULT_AUTOMATIC1111_DEFAULTS: Automatic1111Defaults = {
  promptPrefix: "",
  negativePromptPrefix: "",
  sampler: "Euler a",
  scheduler: "",
  steps: 20,
  cfgScale: 7,
  clipSkip: null,
  restoreFaces: false,
  denoisingStrength: 0.6,
};

export const DEFAULT_COMFYUI_DEFAULTS: ComfyUiDefaults = {
  promptPrefix: "",
  negativePromptPrefix: "",
  sampler: "euler_ancestral",
  scheduler: "normal",
  steps: 20,
  cfgScale: 7,
  denoisingStrength: 1,
  clipSkip: null,
};

export const DEFAULT_NOVELAI_DEFAULTS: NovelAiDefaults = {
  promptPrefix: "",
  negativePromptPrefix: "",
  sampler: "k_euler_ancestral",
  noiseSchedule: "karras",
  steps: 28,
  promptGuidance: 6,
  promptGuidanceRescale: 0,
  undesiredContentPreset: 0,
};

export const SD_WEBUI_SAMPLER_OPTIONS = [
  { value: "", label: "Automatic / backend default" },
  { value: "Euler a", label: "Euler a" },
  { value: "Euler", label: "Euler" },
  { value: "DPM++ 2M", label: "DPM++ 2M" },
  { value: "DPM++ 2M Karras", label: "DPM++ 2M Karras" },
  { value: "DPM++ SDE", label: "DPM++ SDE" },
  { value: "DPM++ SDE Karras", label: "DPM++ SDE Karras" },
  { value: "DPM++ 2M SDE", label: "DPM++ 2M SDE" },
  { value: "UniPC", label: "UniPC" },
  { value: "DDIM", label: "DDIM" },
  { value: "LMS", label: "LMS" },
  { value: "Heun", label: "Heun" },
  { value: "DPM2", label: "DPM2" },
  { value: "DPM2 a", label: "DPM2 a" },
] as const;

export const SD_WEBUI_SCHEDULER_OPTIONS = [
  { value: "", label: "Automatic / backend default" },
  { value: "Automatic", label: "Automatic" },
  { value: "Uniform", label: "Uniform" },
  { value: "Karras", label: "Karras" },
  { value: "Exponential", label: "Exponential" },
  { value: "Polyexponential", label: "Polyexponential" },
  { value: "SGM Uniform", label: "SGM Uniform" },
  { value: "KL Optimal", label: "KL Optimal" },
] as const;

export const COMFYUI_SAMPLER_OPTIONS = [
  { value: "", label: "Automatic / backend default" },
  { value: "euler_ancestral", label: "Euler ancestral" },
  { value: "euler", label: "Euler" },
  { value: "dpmpp_2m", label: "DPM++ 2M" },
  { value: "dpmpp_sde", label: "DPM++ SDE" },
  { value: "dpmpp_2m_sde", label: "DPM++ 2M SDE" },
  { value: "ddim", label: "DDIM" },
  { value: "uni_pc", label: "UniPC" },
  { value: "lms", label: "LMS" },
  { value: "heun", label: "Heun" },
] as const;

export const COMFYUI_SCHEDULER_OPTIONS = [
  { value: "", label: "Automatic / backend default" },
  { value: "normal", label: "Normal" },
  { value: "karras", label: "Karras" },
  { value: "exponential", label: "Exponential" },
  { value: "sgm_uniform", label: "SGM Uniform" },
  { value: "simple", label: "Simple" },
  { value: "ddim_uniform", label: "DDIM uniform" },
] as const;

export const NOVELAI_SAMPLER_OPTIONS = [
  { value: "k_euler_ancestral", label: "Euler ancestral" },
  { value: "k_euler", label: "Euler" },
  { value: "k_dpmpp_2m", label: "DPM++ 2M" },
  { value: "k_dpmpp_sde", label: "DPM++ SDE" },
  { value: "ddim", label: "DDIM" },
] as const;

export const NOVELAI_NOISE_SCHEDULE_OPTIONS = [
  { value: "karras", label: "Karras" },
  { value: "native", label: "Native" },
  { value: "exponential", label: "Exponential" },
  { value: "polyexponential", label: "Polyexponential" },
] as const;

export interface NormalizeImageGenerationProfileResult {
  profile: ImageGenerationDefaultsProfile;
  changed: boolean;
}

export function imageSourceToDefaultsService(value: unknown): ImageDefaultsService | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "drawthings") return "automatic1111";
  return isImageDefaultsService(normalized) ? normalized : null;
}

export function isImageDefaultsService(value: unknown): value is ImageDefaultsService {
  return typeof value === "string" && (IMAGE_DEFAULTS_SERVICES as string[]).includes(value);
}

export function createDefaultImageGenerationProfile(service: ImageDefaultsService): ImageGenerationDefaultsProfile {
  const profile: ImageGenerationDefaultsProfile = {
    version: IMAGE_GENERATION_DEFAULTS_VERSION,
    service,
    seed: -1,
  };
  if (service === "automatic1111") profile.automatic1111 = { ...DEFAULT_AUTOMATIC1111_DEFAULTS };
  if (service === "comfyui") profile.comfyui = { ...DEFAULT_COMFYUI_DEFAULTS };
  if (service === "novelai") profile.novelai = { ...DEFAULT_NOVELAI_DEFAULTS };
  return profile;
}

export function normalizeImageGenerationProfile(
  rawProfile: unknown,
  service: ImageDefaultsService,
): NormalizeImageGenerationProfileResult {
  if (!isRecord(rawProfile)) {
    return { profile: createDefaultImageGenerationProfile(service), changed: true };
  }

  const profile = createDefaultImageGenerationProfile(service);
  profile.seed = readInteger(rawProfile.seed, -1, -1, 4_294_967_295);

  if (service === "automatic1111") {
    profile.automatic1111 = normalizeAutomatic1111Defaults(rawProfile.automatic1111);
  } else if (service === "comfyui") {
    profile.comfyui = normalizeComfyUiDefaults(rawProfile.comfyui);
  } else {
    profile.novelai = normalizeNovelAiDefaults(rawProfile.novelai);
  }

  const changed = JSON.stringify(profile) !== JSON.stringify(rawProfile);
  return { profile, changed };
}

export function sanitizeImageGenerationProfile(
  profile: ImageGenerationDefaultsProfile,
  service: ImageDefaultsService,
): ImageGenerationDefaultsProfile {
  return normalizeImageGenerationProfile(profile, service).profile;
}

export function mergePromptPrefix(prefix: string, prompt: string): string {
  const trimmedPrefix = prefix.trim();
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrefix) return trimmedPrompt;
  if (!trimmedPrompt) return trimmedPrefix;
  return `${trimmedPrefix}, ${trimmedPrompt}`;
}

export function mergeNegativePrompt(prefix: string, prompt?: string): string {
  const trimmedPrefix = prefix.trim();
  const trimmedPrompt = (prompt ?? "").trim();
  if (!trimmedPrefix) return trimmedPrompt;
  if (!trimmedPrompt) return trimmedPrefix;
  return `${trimmedPrefix}, ${trimmedPrompt}`;
}

function normalizeAutomatic1111Defaults(rawDefaults: unknown): Automatic1111Defaults {
  const raw = isRecord(rawDefaults) ? rawDefaults : {};
  return {
    promptPrefix: readString(raw.promptPrefix, DEFAULT_AUTOMATIC1111_DEFAULTS.promptPrefix),
    negativePromptPrefix: readString(raw.negativePromptPrefix, DEFAULT_AUTOMATIC1111_DEFAULTS.negativePromptPrefix),
    sampler: readString(raw.sampler, DEFAULT_AUTOMATIC1111_DEFAULTS.sampler),
    scheduler: readString(raw.scheduler, DEFAULT_AUTOMATIC1111_DEFAULTS.scheduler),
    steps: readInteger(raw.steps, DEFAULT_AUTOMATIC1111_DEFAULTS.steps, 1, 150),
    cfgScale: readNumber(raw.cfgScale, DEFAULT_AUTOMATIC1111_DEFAULTS.cfgScale, 0, 30),
    clipSkip: readNullableInteger(raw.clipSkip, DEFAULT_AUTOMATIC1111_DEFAULTS.clipSkip, 1, 12),
    restoreFaces: readBoolean(raw.restoreFaces, DEFAULT_AUTOMATIC1111_DEFAULTS.restoreFaces),
    denoisingStrength: readNumber(raw.denoisingStrength, DEFAULT_AUTOMATIC1111_DEFAULTS.denoisingStrength, 0, 1),
  };
}

function normalizeComfyUiDefaults(rawDefaults: unknown): ComfyUiDefaults {
  const raw = isRecord(rawDefaults) ? rawDefaults : {};
  return {
    promptPrefix: readString(raw.promptPrefix, DEFAULT_COMFYUI_DEFAULTS.promptPrefix),
    negativePromptPrefix: readString(raw.negativePromptPrefix, DEFAULT_COMFYUI_DEFAULTS.negativePromptPrefix),
    sampler: readString(raw.sampler, DEFAULT_COMFYUI_DEFAULTS.sampler),
    scheduler: readString(raw.scheduler, DEFAULT_COMFYUI_DEFAULTS.scheduler),
    steps: readInteger(raw.steps, DEFAULT_COMFYUI_DEFAULTS.steps, 1, 150),
    cfgScale: readNumber(raw.cfgScale, DEFAULT_COMFYUI_DEFAULTS.cfgScale, 0, 30),
    denoisingStrength: readNumber(raw.denoisingStrength, DEFAULT_COMFYUI_DEFAULTS.denoisingStrength, 0, 1),
    clipSkip: readNullableInteger(raw.clipSkip, DEFAULT_COMFYUI_DEFAULTS.clipSkip, 1, 12),
  };
}

function normalizeNovelAiDefaults(rawDefaults: unknown): NovelAiDefaults {
  const raw = isRecord(rawDefaults) ? rawDefaults : {};
  return {
    promptPrefix: readString(raw.promptPrefix, DEFAULT_NOVELAI_DEFAULTS.promptPrefix),
    negativePromptPrefix: readString(raw.negativePromptPrefix, DEFAULT_NOVELAI_DEFAULTS.negativePromptPrefix),
    sampler: readString(raw.sampler, DEFAULT_NOVELAI_DEFAULTS.sampler),
    noiseSchedule: readString(raw.noiseSchedule, DEFAULT_NOVELAI_DEFAULTS.noiseSchedule),
    steps: readInteger(raw.steps, DEFAULT_NOVELAI_DEFAULTS.steps, 1, 150),
    promptGuidance: readNumber(raw.promptGuidance, DEFAULT_NOVELAI_DEFAULTS.promptGuidance, 0, 30),
    promptGuidanceRescale: readNumber(
      raw.promptGuidanceRescale,
      DEFAULT_NOVELAI_DEFAULTS.promptGuidanceRescale,
      0,
      1,
    ),
    undesiredContentPreset: readInteger(
      raw.undesiredContentPreset,
      DEFAULT_NOVELAI_DEFAULTS.undesiredContentPreset,
      0,
      4,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function readInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.trunc(Math.min(max, Math.max(min, value)));
}

function readNullableInteger(value: unknown, fallback: number | null, min: number, max: number): number | null {
  if (value === null || value === "" || value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.trunc(Math.min(max, Math.max(min, value)));
}
