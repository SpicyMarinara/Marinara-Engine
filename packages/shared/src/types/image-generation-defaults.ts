export type ImageDefaultsService = "automatic1111" | "comfyui" | "novelai";

export interface Automatic1111Defaults {
  promptPrefix: string;
  negativePromptPrefix: string;
  sampler: string;
  scheduler: string;
  steps: number;
  cfgScale: number;
  clipSkip: number | null;
  restoreFaces: boolean;
  denoisingStrength: number;
}

export interface ComfyUiDefaults {
  promptPrefix: string;
  negativePromptPrefix: string;
  sampler: string;
  scheduler: string;
  steps: number;
  cfgScale: number;
  denoisingStrength: number;
  clipSkip: number | null;
}

export interface NovelAiDefaults {
  promptPrefix: string;
  negativePromptPrefix: string;
  sampler: string;
  noiseSchedule: string;
  steps: number;
  promptGuidance: number;
  promptGuidanceRescale: number;
  undesiredContentPreset: number;
}

export interface ImageGenerationDefaultsProfile {
  version: 1;
  service: ImageDefaultsService;
  seed: number;
  automatic1111?: Automatic1111Defaults;
  comfyui?: ComfyUiDefaults;
  novelai?: NovelAiDefaults;
}
