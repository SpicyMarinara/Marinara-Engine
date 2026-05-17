import type {
  TrackerCardColorConfig,
  TrackerCardColorMode,
  TrackerCardPortraitStageBackground,
} from "@marinara-engine/shared";

export const DEFAULT_TRACKER_CARD_COLOR_MODE: TrackerCardColorMode = "chat";
export const DEFAULT_TRACKER_CARD_PORTRAIT_STAGE_BACKGROUND: TrackerCardPortraitStageBackground = "ambient";
export const DEFAULT_TRACKER_CARD_PORTRAIT_FOCUS_X = 50;
export const DEFAULT_TRACKER_CARD_PORTRAIT_FOCUS_Y = 36;
export const MAX_TRACKER_CARD_PORTRAIT_FOCUS_Y = 140;
export const DEFAULT_TRACKER_CARD_PORTRAIT_ZOOM = 1;
export const MIN_TRACKER_CARD_PORTRAIT_ZOOM = 0.75;
export const MAX_TRACKER_CARD_PORTRAIT_ZOOM = 2.35;
export const TRACKER_CARD_COLOR_PREVIEW_BASE_FIELD = "__trackerCardColorPreviewBase";
const DEFAULT_TRACKER_CARD_SURFACE = "var(--card)";
const TRACKER_CARD_FIXED_TINT_INTENSITY = 100;
const DEFAULT_TRACKER_CARD_MATERIAL_BRIGHTNESS = 50;

export interface TrackerCardFinish {
  tintIntensity: number;
  materialBrightness: number;
  glowIntensity: number;
  contrastIntensity: number;
}

export interface TrackerCardPaintOpacity {
  nameColorOpacity: number;
  dialogueColorOpacity: number;
  boxColorOpacity: number;
}

export interface TrackerCardPaintEnabled {
  displayEnabled: boolean;
  accentEnabled: boolean;
  surfaceEnabled: boolean;
}

export interface TrackerCardPortraitStageVars {
  base: string;
  veil: string;
  light: string;
  lightOpacity: string;
  rim: string;
  rimOpacity: string;
  mediaOpacity: string;
  mediaBlur: string;
  mediaSaturate: string;
  sideMaskOpacity: string;
  bottomGlowOpacity: string;
  bottomRuleOpacity: string;
}

export interface TrackerCardPortraitStagePalette {
  background: TrackerCardPortraitStageBackground;
  displaySolid: string;
  accent: string;
  box: string;
  opacity: TrackerCardPaintOpacity;
}

export interface TrackerCardPortraitView {
  x: number;
  y: number;
  zoom: number;
}

export interface TrackerCardPaintColors {
  dialogueColor?: string | null;
  nameColor?: string | null;
  boxColor?: string | null;
}

export interface TrackerCardStylePalette {
  accent: string;
  accentLayer: string;
  accentGradientLayer: string | null;
  displayLayer: string;
  displayGradientLayer: string | null;
  displaySolid: string;
  box: string;
  boxLayer: string;
  boxGradientLayer: string | null;
  finish: TrackerCardFinish;
  hasSurfacePaint: boolean;
  opacity: TrackerCardPaintOpacity;
  portraitStageBackground: TrackerCardPortraitStageBackground;
}

export interface TrackerCardStyleVars {
  accent: string;
  accentHighlightOpacity: string;
  accentLayer: string;
  accentSolid: string;
  accentWashOpacity: string;
  bodyRuleOpacity: string;
  bodyWashOpacity: string;
  box: string;
  boxLayer: string;
  dialogueBorder: string;
  dialogueGlow: string;
  displayLayer: string;
  displayOpacity: string;
  displayRailOpacity: string;
  displaySolid: string;
  frame: string;
  frameBlend: string;
  fieldMaterial: string;
  fieldMaterialBlend: string;
  glowOpacity: string;
  icon: string;
  labelIcon: string;
  labelMutedText: string;
  labelText: string;
  material: string;
  materialBlend: string;
  mutedPanel: string;
  mutedPanelBlend: string;
  nameplate: string;
  nameplateGlow: string;
  nameplateRule: string;
  nameplateText: string;
  panel: string;
  panelBlend: string;
  panelMaterial: string;
  panelMaterialBlend: string;
  panelStrong: string;
  panelStrongBlend: string;
  portraitBase: string;
  portraitBottomGlowOpacity: string;
  portraitBottomRuleOpacity: string;
  portraitMediaBlur: string;
  portraitMediaOpacity: string;
  portraitMediaSaturate: string;
  portraitLight: string;
  portraitLightOpacity: string;
  portraitRim: string;
  portraitRimOpacity: string;
  portraitSideMaskOpacity: string;
  portraitVeil: string;
  rule: string;
  surface: string;
  surfaceBlend: string;
  surfaceLayer: string;
  surfaceSolid: string;
  slotRule: string;
  slotShadow: string;
  slotSurface: string;
  slotSurfaceBlend: string;
  tintOpacity: string;
  contrastSoftTop: string;
  contrastSoftMid: string;
  contrastSoftBottom: string;
  contrastStrongTop: string;
  contrastStrongMid: string;
  contrastStrongBottom: string;
  mutedText: string;
  numberText: string;
  rowRule: string;
  statFillGlow: string;
  statFillHighlight: string;
  statTrack: string;
  statTrackBlend: string;
  statTrackRing: string;
  statTrackShadow: string;
  text: string;
  background: string;
  backgroundBlendMode: string;
}

export interface TrackerCardSkinFinish {
  accentPanelMix: number;
  borderOpacity: number;
  displayOpacity: string;
  glowMix: number;
  mutedTextMix: number;
  numberTextMix: number;
  panelBoxMix: number;
  rowRuleOpacity: number;
  softContrastBottom: number;
  softContrastMid: number;
  softContrastTop: number;
  slotBackgroundBottomMix: number;
  slotBackgroundTopMix: number;
  slotBoxBottomMix: number;
  slotBoxTopMix: number;
  slotRuleOpacity: number;
  slotShadowOpacity: string;
  statTrackAccentMix: number;
  statFillGlowMix: number;
  statFillHighlightMix: number;
  statTrackBackgroundMix: number;
  statTrackBoxMix: number;
  statTrackRingOpacity: number;
  statTrackShadowOpacity: string;
  strongContrastBottom: number;
  strongContrastMid: number;
  strongContrastTop: number;
  surfaceBoxMix: number;
  textMix: number;
  tintOpacity: string;
}

export const TRACKER_CARD_FINISH_DEFAULTS: Record<TrackerCardColorMode, TrackerCardFinish> = {
  default: {
    tintIntensity: TRACKER_CARD_FIXED_TINT_INTENSITY,
    materialBrightness: DEFAULT_TRACKER_CARD_MATERIAL_BRIGHTNESS,
    glowIntensity: 25,
    contrastIntensity: 55,
  },
  chat: {
    tintIntensity: TRACKER_CARD_FIXED_TINT_INTENSITY,
    materialBrightness: DEFAULT_TRACKER_CARD_MATERIAL_BRIGHTNESS,
    glowIntensity: 45,
    contrastIntensity: 55,
  },
  custom: {
    tintIntensity: TRACKER_CARD_FIXED_TINT_INTENSITY,
    materialBrightness: DEFAULT_TRACKER_CARD_MATERIAL_BRIGHTNESS,
    glowIntensity: 45,
    contrastIntensity: 55,
  },
};

export const TRACKER_CARD_PAINT_OPACITY_DEFAULTS: TrackerCardPaintOpacity = {
  nameColorOpacity: 100,
  dialogueColorOpacity: 100,
  boxColorOpacity: 100,
};

export const TRACKER_CARD_PAINT_ENABLED_DEFAULTS: TrackerCardPaintEnabled = {
  displayEnabled: true,
  accentEnabled: true,
  surfaceEnabled: true,
};

export const DEFAULT_TRACKER_CARD_ACCENT = "var(--primary)";
const TRACKER_CARD_NEUTRAL_SURFACE_TOP =
  "var(--tracker-card-neutral-surface-top, color-mix(in srgb, color-mix(in srgb, var(--secondary) 66%, var(--accent) 34%) 91%, var(--primary) 9%))";
const TRACKER_CARD_NEUTRAL_SURFACE_BOTTOM =
  "var(--tracker-card-neutral-surface-bottom, color-mix(in srgb, color-mix(in srgb, var(--secondary) 78%, var(--accent) 22%) 94%, var(--muted-foreground) 6%))";
const TRACKER_CARD_NEUTRAL_MATERIAL =
  "var(--tracker-card-neutral-material, color-mix(in srgb, color-mix(in srgb, var(--secondary) 68%, var(--accent) 32%) 89%, var(--primary) 11%))";
const TRACKER_CARD_NEUTRAL_LIFT =
  "var(--tracker-card-neutral-lift, color-mix(in srgb, var(--muted-foreground) 72%, var(--primary) 28%))";
const TRACKER_CARD_ACTIVE_SURFACE_TOP =
  "var(--tracker-card-active-surface-top, color-mix(in srgb, var(--card) 72%, var(--background) 28%))";
const TRACKER_CARD_ACTIVE_SURFACE_BOTTOM =
  "var(--tracker-card-active-surface-bottom, color-mix(in srgb, var(--background) 74%, var(--card) 26%))";
const TRACKER_CARD_ACTIVE_SURFACE_MATERIAL =
  "var(--tracker-card-active-surface-material, color-mix(in srgb, var(--card) 52%, var(--background) 48%))";
const TRACKER_CARD_ACTIVE_SURFACE_LIFT =
  "var(--tracker-card-active-surface-lift, color-mix(in srgb, var(--card) 90%, var(--card-foreground) 10%))";
const TRACKER_CARD_NAMEPLATE_BASE_TOP =
  "var(--tracker-card-nameplate-base-top, color-mix(in srgb, var(--card) 72%, var(--background) 28%))";
const TRACKER_CARD_NAMEPLATE_BASE_MID =
  "var(--tracker-card-nameplate-base-mid, color-mix(in srgb, var(--card) 56%, var(--background) 44%))";
const TRACKER_CARD_NAMEPLATE_BASE_BOTTOM =
  "var(--tracker-card-nameplate-base-bottom, color-mix(in srgb, var(--background) 82%, var(--card) 18%))";
const TRACKER_CARD_NAMEPLATE_TEXT_BASE =
  "var(--tracker-card-nameplate-text-base, color-mix(in srgb, var(--card-foreground) 92%, var(--primary) 8%))";
const TRACKER_CARD_MATERIAL_BRIGHT_TARGET =
  "var(--tracker-card-material-bright-target, oklch(0.975 0.012 315))";
const TRACKER_CARD_MATERIAL_DARK_TARGET =
  "var(--tracker-card-material-dark-target, oklch(0.055 0.014 300))";
const TRACKER_CARD_READABLE_LIGHT_INK = "var(--tracker-card-readable-light-ink, oklch(0.94 0.012 315))";
const TRACKER_CARD_READABLE_DARK_INK = "var(--tracker-card-readable-dark-ink, oklch(0.18 0.024 300))";
const TRACKER_CARD_MUTED_LIGHT_INK = "var(--tracker-card-muted-light-ink, oklch(0.76 0.018 315))";
const TRACKER_CARD_MUTED_DARK_INK = "var(--tracker-card-muted-dark-ink, oklch(0.36 0.026 300))";

export function normalizeTrackerCardColorMode(value: unknown): TrackerCardColorMode {
  return value === "default" || value === "chat" || value === "custom" ? value : DEFAULT_TRACKER_CARD_COLOR_MODE;
}

export function normalizeTrackerCardPortraitStageBackground(value: unknown): TrackerCardPortraitStageBackground {
  return value === "ambient" || value === "spotlight" || value === "soft" || value === "plain"
    ? value
    : DEFAULT_TRACKER_CARD_PORTRAIT_STAGE_BACKGROUND;
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function getClampedFinishValue(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numberValue)) return undefined;
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function getClampedPortraitFocusYValue(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numberValue)) return undefined;
  return Math.max(0, Math.min(MAX_TRACKER_CARD_PORTRAIT_FOCUS_Y, Math.round(numberValue)));
}

function getClampedPortraitZoomValue(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numberValue)) return undefined;
  const clamped = Math.max(MIN_TRACKER_CARD_PORTRAIT_ZOOM, Math.min(MAX_TRACKER_CARD_PORTRAIT_ZOOM, numberValue));
  return Math.round(clamped * 100) / 100;
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function cleanTrackerCardColorConfig(config: TrackerCardColorConfig | null | undefined): TrackerCardColorConfig {
  const displayEnabled = getBoolean(config?.displayEnabled);
  const accentEnabled = getBoolean(config?.accentEnabled);
  const surfaceEnabled = getBoolean(config?.surfaceEnabled);
  const nameColorOpacity = getClampedFinishValue(config?.nameColorOpacity);
  const dialogueColorOpacity = getClampedFinishValue(config?.dialogueColorOpacity);
  const rawBoxColorOpacity = getClampedFinishValue(config?.boxColorOpacity);
  const legacyTintIntensity = getClampedFinishValue(config?.tintIntensity);
  const materialBrightness = getClampedFinishValue(config?.materialBrightness);
  // Legacy Tint controlled how much Surface paint entered material; preserve that as Surface strength.
  const boxColorOpacity =
    materialBrightness === undefined && legacyTintIntensity !== undefined
      ? Math.round(((rawBoxColorOpacity ?? TRACKER_CARD_PAINT_OPACITY_DEFAULTS.boxColorOpacity) * legacyTintIntensity) / 100)
      : rawBoxColorOpacity;
  const glowIntensity = getClampedFinishValue(config?.glowIntensity);
  const contrastIntensity = getClampedFinishValue(config?.contrastIntensity);
  const portraitStageBackground = normalizeTrackerCardPortraitStageBackground(config?.portraitStageBackground);
  const portraitFocusX = getClampedFinishValue(config?.portraitFocusX);
  const portraitFocusY = getClampedPortraitFocusYValue(config?.portraitFocusY);
  const portraitZoom = getClampedPortraitZoomValue(config?.portraitZoom);

  return {
    mode: normalizeTrackerCardColorMode(config?.mode),
    ...(displayEnabled === false && { displayEnabled }),
    ...(config?.nameColor ? { nameColor: config.nameColor } : {}),
    ...(nameColorOpacity !== undefined && { nameColorOpacity }),
    ...(accentEnabled === false && { accentEnabled }),
    ...(config?.dialogueColor ? { dialogueColor: config.dialogueColor } : {}),
    ...(dialogueColorOpacity !== undefined && { dialogueColorOpacity }),
    ...(surfaceEnabled === false && { surfaceEnabled }),
    ...(config?.boxColor ? { boxColor: config.boxColor } : {}),
    ...(boxColorOpacity !== undefined && { boxColorOpacity }),
    ...(materialBrightness !== undefined && { materialBrightness }),
    ...(glowIntensity !== undefined && { glowIntensity }),
    ...(contrastIntensity !== undefined && { contrastIntensity }),
    ...(portraitStageBackground !== DEFAULT_TRACKER_CARD_PORTRAIT_STAGE_BACKGROUND && { portraitStageBackground }),
    ...(portraitFocusX !== undefined && portraitFocusX !== DEFAULT_TRACKER_CARD_PORTRAIT_FOCUS_X && { portraitFocusX }),
    ...(portraitFocusY !== undefined && portraitFocusY !== DEFAULT_TRACKER_CARD_PORTRAIT_FOCUS_Y && { portraitFocusY }),
    ...(portraitZoom !== undefined && portraitZoom !== DEFAULT_TRACKER_CARD_PORTRAIT_ZOOM && { portraitZoom }),
  };
}

export function parseTrackerCardColorConfig(raw: unknown): TrackerCardColorConfig {
  const record = parseRecord(raw);
  if (!record) return { mode: DEFAULT_TRACKER_CARD_COLOR_MODE };

  return cleanTrackerCardColorConfig({
    mode: normalizeTrackerCardColorMode(record.mode),
    displayEnabled: getBoolean(record.displayEnabled),
    nameColor: getString(record.nameColor),
    nameColorOpacity: getClampedFinishValue(record.nameColorOpacity),
    accentEnabled: getBoolean(record.accentEnabled),
    dialogueColor: getString(record.dialogueColor),
    dialogueColorOpacity: getClampedFinishValue(record.dialogueColorOpacity),
    surfaceEnabled: getBoolean(record.surfaceEnabled),
    boxColor: getString(record.boxColor),
    boxColorOpacity: getClampedFinishValue(record.boxColorOpacity),
    tintIntensity: getClampedFinishValue(record.tintIntensity),
    materialBrightness: getClampedFinishValue(record.materialBrightness),
    glowIntensity: getClampedFinishValue(record.glowIntensity),
    contrastIntensity: getClampedFinishValue(record.contrastIntensity),
    portraitStageBackground: normalizeTrackerCardPortraitStageBackground(record.portraitStageBackground),
    portraitFocusX: getClampedFinishValue(record.portraitFocusX),
    portraitFocusY: getClampedPortraitFocusYValue(record.portraitFocusY),
    portraitZoom: getClampedPortraitZoomValue(record.portraitZoom),
  });
}

export function serializeTrackerCardColorConfig(config: TrackerCardColorConfig): string {
  return JSON.stringify(cleanTrackerCardColorConfig(config));
}

export function getTrackerCardFinish(
  config: TrackerCardColorConfig | null | undefined,
  mode = normalizeTrackerCardColorMode(config?.mode),
): TrackerCardFinish {
  const defaults = TRACKER_CARD_FINISH_DEFAULTS[mode];

  return {
    tintIntensity: TRACKER_CARD_FIXED_TINT_INTENSITY,
    materialBrightness: getClampedFinishValue(config?.materialBrightness) ?? defaults.materialBrightness,
    glowIntensity: getClampedFinishValue(config?.glowIntensity) ?? defaults.glowIntensity,
    contrastIntensity: getClampedFinishValue(config?.contrastIntensity) ?? defaults.contrastIntensity,
  };
}

export function getTrackerCardPaintOpacity(config: TrackerCardColorConfig | null | undefined): TrackerCardPaintOpacity {
  if (normalizeTrackerCardColorMode(config?.mode) === "default") {
    return TRACKER_CARD_PAINT_OPACITY_DEFAULTS;
  }

  return {
    nameColorOpacity:
      getClampedFinishValue(config?.nameColorOpacity) ?? TRACKER_CARD_PAINT_OPACITY_DEFAULTS.nameColorOpacity,
    dialogueColorOpacity:
      getClampedFinishValue(config?.dialogueColorOpacity) ?? TRACKER_CARD_PAINT_OPACITY_DEFAULTS.dialogueColorOpacity,
    boxColorOpacity:
      getClampedFinishValue(config?.boxColorOpacity) ?? TRACKER_CARD_PAINT_OPACITY_DEFAULTS.boxColorOpacity,
  };
}

export function getTrackerCardPaintEnabled(config: TrackerCardColorConfig | null | undefined): TrackerCardPaintEnabled {
  return {
    displayEnabled: getBoolean(config?.displayEnabled) ?? TRACKER_CARD_PAINT_ENABLED_DEFAULTS.displayEnabled,
    accentEnabled: getBoolean(config?.accentEnabled) ?? TRACKER_CARD_PAINT_ENABLED_DEFAULTS.accentEnabled,
    surfaceEnabled: getBoolean(config?.surfaceEnabled) ?? TRACKER_CARD_PAINT_ENABLED_DEFAULTS.surfaceEnabled,
  };
}

export function getTrackerCardPortraitStageBackground(
  config: TrackerCardColorConfig | null | undefined,
): TrackerCardPortraitStageBackground {
  return normalizeTrackerCardPortraitStageBackground(config?.portraitStageBackground);
}

export function getTrackerCardPortraitView(
  config: TrackerCardColorConfig | null | undefined,
  defaults: Partial<TrackerCardPortraitView> = {},
): TrackerCardPortraitView {
  return {
    x: getClampedFinishValue(config?.portraitFocusX) ?? defaults.x ?? DEFAULT_TRACKER_CARD_PORTRAIT_FOCUS_X,
    y: getClampedPortraitFocusYValue(config?.portraitFocusY) ?? defaults.y ?? DEFAULT_TRACKER_CARD_PORTRAIT_FOCUS_Y,
    zoom: getClampedPortraitZoomValue(config?.portraitZoom) ?? defaults.zoom ?? DEFAULT_TRACKER_CARD_PORTRAIT_ZOOM,
  };
}

function opacityWeight(value: number) {
  return Math.max(0, Math.min(100, Math.round(value))) / 100;
}

function scalePercent(value: number, opacity: number) {
  return Math.round(value * opacityWeight(opacity));
}

function splitCssArgs(value: string) {
  const args: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);

    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

function splitCssWhitespace(value: string) {
  const parts: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);

    if (/\s/.test(char) && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function isLinearGradientPrelude(value: string) {
  const text = value.trim().toLowerCase();
  return text.startsWith("to ") || text.startsWith("in ") || /^[-+]?(?:\d+|\d*\.\d+)(?:deg|grad|rad|turn)$/.test(text);
}

function isGradientPositionHint(value: string) {
  const text = value.trim().toLowerCase();
  return (
    text === "0" ||
    /^[-+]?(?:\d+|\d*\.\d+)(?:%|px|rem|em|vh|vw|vmin|vmax|ch|ex|lh|rlh|cm|mm|q|in|pt|pc)?$/.test(text) ||
    text.startsWith("calc(")
  );
}

function applyOpacityToLinearGradientStop(stop: string, paintOpacity: number) {
  const parts = splitCssWhitespace(stop);
  if (parts.length === 0 || isGradientPositionHint(parts[0]!)) return stop;

  const [color, ...positions] = parts;
  return [`color-mix(in srgb, ${color} ${paintOpacity}%, transparent)`, ...positions].join(" ");
}

export function applyTrackerCardPaintOpacity(value: string, opacity: number) {
  const paintOpacity = Math.max(0, Math.min(100, Math.round(opacity)));
  if (paintOpacity >= 100) return value;

  const linearGradientMatch = value.match(/^linear-gradient\((.*)\)$/i);
  if (!linearGradientMatch) {
    return value.toLowerCase().includes("gradient(")
      ? value
      : `color-mix(in srgb, ${value} ${paintOpacity}%, transparent)`;
  }

  const args = splitCssArgs(linearGradientMatch[1] ?? "");
  if (args.length < 2) return value;

  const firstArg = args[0]!;
  const hasPrelude = isLinearGradientPrelude(firstArg);
  const stops = hasPrelude ? args.slice(1) : args;
  if (stops.length < 2) return value;

  const transparentStops = stops.map((stop) => applyOpacityToLinearGradientStop(stop, paintOpacity));
  return `linear-gradient(${hasPrelude ? `${firstArg}, ` : ""}${transparentStops.join(", ")})`;
}

function getMaterialBrightnessAdjustment(brightness: number) {
  const clampedBrightness = Math.max(0, Math.min(100, Math.round(brightness)));
  if (clampedBrightness === DEFAULT_TRACKER_CARD_MATERIAL_BRIGHTNESS) return null;

  const distanceFromNeutral =
    Math.abs(clampedBrightness - DEFAULT_TRACKER_CARD_MATERIAL_BRIGHTNESS) /
    DEFAULT_TRACKER_CARD_MATERIAL_BRIGHTNESS;

  if (clampedBrightness > DEFAULT_TRACKER_CARD_MATERIAL_BRIGHTNESS) {
    return {
      mix: Math.round(distanceFromNeutral * 96),
      target: TRACKER_CARD_MATERIAL_BRIGHT_TARGET,
    };
  }

  return {
    mix: Math.round(distanceFromNeutral * 98),
    target: TRACKER_CARD_MATERIAL_DARK_TARGET,
  };
}

function applyMaterialBrightnessToColor(color: string, target: string, mix: number) {
  return `color-mix(in srgb, ${color} ${100 - mix}%, ${target} ${mix}%)`;
}

function applyMaterialBrightnessToLinearGradientStop(stop: string, target: string, mix: number) {
  const parts = splitCssWhitespace(stop);
  if (parts.length === 0 || isGradientPositionHint(parts[0]!)) return stop;

  const [color, ...positions] = parts;
  return [applyMaterialBrightnessToColor(color, target, mix), ...positions].join(" ");
}

function applyTrackerCardMaterialBrightness(value: string, brightness: number) {
  const adjustment = getMaterialBrightnessAdjustment(brightness);
  if (!adjustment || adjustment.mix <= 0) return value;

  const linearGradientMatch = value.match(/^linear-gradient\((.*)\)$/i);
  if (!linearGradientMatch) {
    return value.toLowerCase().includes("gradient(")
      ? value
      : applyMaterialBrightnessToColor(value, adjustment.target, adjustment.mix);
  }

  const args = splitCssArgs(linearGradientMatch[1] ?? "");
  if (args.length < 2) return value;

  const firstArg = args[0]!;
  const hasPrelude = isLinearGradientPrelude(firstArg);
  const stops = hasPrelude ? args.slice(1) : args;
  if (stops.length < 2) return value;

  const adjustedStops = stops.map((stop) =>
    applyMaterialBrightnessToLinearGradientStop(stop, adjustment.target, adjustment.mix),
  );
  return `linear-gradient(${hasPrelude ? `${firstArg}, ` : ""}${adjustedStops.join(", ")})`;
}

export function getTrackerCardCssPaintValue(value: string | null | undefined) {
  const text = value?.trim();
  if (!text || /url\(|;|expression\(/i.test(text)) return null;
  return text;
}

export function getTrackerCardSolidColor(value: string | null | undefined) {
  const text = getTrackerCardCssPaintValue(value);
  if (!text || text.toLowerCase().includes("gradient(")) return null;
  return text;
}

function scaleOpacity(value: string, opacity: number) {
  return (Number(value) * opacityWeight(opacity)).toFixed(3);
}

function getTrackerCardBackgroundPaintLayer(value: string, opacity = 100) {
  return value.toLowerCase().includes("gradient(")
    ? applyTrackerCardPaintOpacity(value, opacity)
    : `linear-gradient(${applyTrackerCardPaintOpacity(value, opacity)}, ${applyTrackerCardPaintOpacity(value, opacity)})`;
}

function getTrackerCardGradientPaintLayer(value: string | null | undefined, opacity = 100) {
  const text = getTrackerCardCssPaintValue(value);
  return text?.toLowerCase().includes("gradient(") ? applyTrackerCardPaintOpacity(text, opacity) : null;
}

function getTrackerCardPaintedBackground(base: string, layers: Array<string | null | undefined>) {
  const activeLayers = layers.filter((layer): layer is string => !!layer);
  return activeLayers.length ? `${activeLayers.join(", ")}, ${base}` : base;
}

function getTrackerCardBackgroundBlendMode(layers: Array<string | null | undefined>, mode = "soft-light") {
  const activeLayerCount = layers.filter(Boolean).length;
  return activeLayerCount ? `${Array.from({ length: activeLayerCount }, () => mode).join(", ")}, normal` : "normal";
}

function getTrackerCardPaintSolidFallback(value: string | null | undefined) {
  const solidColor = getTrackerCardSolidColor(value);
  if (solidColor) return solidColor;

  const text = getTrackerCardCssPaintValue(value);
  if (!text) return null;

  return (
    text.match(
      /#[0-9a-f]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|oklch\([^)]+\)|oklab\([^)]+\)|lch\([^)]+\)|lab\([^)]+\)|var\(--[\w-]+\)/i,
    )?.[0] ?? null
  );
}

function getFallbackAwarePaintOpacity(
  ownOpacity: number,
  hasOwnPaint: boolean,
  fallbackSources: Array<{ hasPaint: boolean; opacity: number }>,
) {
  if (hasOwnPaint) return ownOpacity;
  const borrowedSource = fallbackSources.find((source) => source.hasPaint);
  return borrowedSource ? Math.min(ownOpacity, borrowedSource.opacity) : ownOpacity;
}

function getStrengthAdjustedColor(color: string, opacity: number, neutral: string) {
  const clampedOpacity = Math.max(0, Math.min(100, Math.round(opacity)));
  if (clampedOpacity >= 100) return color;
  if (clampedOpacity <= 0) return neutral;
  return `color-mix(in srgb, ${neutral} ${100 - clampedOpacity}%, ${color} ${clampedOpacity}%)`;
}

function getMaterialPolarityMix(materialBrightness: number, contrastIntensity: number) {
  const brightnessDistance =
    Math.abs(materialBrightness - DEFAULT_TRACKER_CARD_MATERIAL_BRIGHTNESS) /
    DEFAULT_TRACKER_CARD_MATERIAL_BRIGHTNESS;
  const contrastBoost = 58 + opacityWeight(contrastIntensity) * 38;
  return Math.round(Math.min(1, brightnessDistance) * contrastBoost);
}

function getMaterialReadableColor({
  base,
  materialBrightness,
  contrastIntensity,
  lightInk,
  darkInk,
}: {
  base: string;
  materialBrightness: number;
  contrastIntensity: number;
  lightInk: string;
  darkInk: string;
}) {
  const mix = getMaterialPolarityMix(materialBrightness, contrastIntensity);
  if (mix <= 0) return base;

  const target = materialBrightness > DEFAULT_TRACKER_CARD_MATERIAL_BRIGHTNESS ? darkInk : lightInk;

  return `color-mix(in srgb, ${base} ${100 - mix}%, ${target} ${mix}%)`;
}

export function getTrackerCardStylePalette({
  colors,
  enabled = TRACKER_CARD_PAINT_ENABLED_DEFAULTS,
  finish,
  opacity,
  portraitStageBackground,
  fallbackAccent = DEFAULT_TRACKER_CARD_ACCENT,
}: {
  colors: TrackerCardPaintColors | null | undefined;
  enabled?: TrackerCardPaintEnabled;
  finish: TrackerCardFinish;
  opacity: TrackerCardPaintOpacity;
  portraitStageBackground: TrackerCardPortraitStageBackground;
  fallbackAccent?: string;
}): TrackerCardStylePalette {
  const displayPaint = enabled.displayEnabled ? getTrackerCardCssPaintValue(colors?.nameColor) : null;
  const accentPaint = enabled.accentEnabled ? getTrackerCardCssPaintValue(colors?.dialogueColor) : null;
  const surfacePaint = enabled.surfaceEnabled ? getTrackerCardCssPaintValue(colors?.boxColor) : null;
  const displayColor = getTrackerCardPaintSolidFallback(displayPaint);
  const accentColor = getTrackerCardPaintSolidFallback(accentPaint);
  const displaySolid = displayColor ?? accentColor ?? fallbackAccent;
  const accent = accentColor ?? displayColor ?? fallbackAccent;
  // Surface is material, not identity. Leave it neutral when unset so Display/Accent
  // cannot silently repaint the whole card body through the Surface channel.
  const box = getTrackerCardPaintSolidFallback(surfacePaint) ?? DEFAULT_TRACKER_CARD_SURFACE;
  const materialBox = applyTrackerCardMaterialBrightness(box, finish.materialBrightness);
  const materialSurfacePaint = surfacePaint
    ? applyTrackerCardMaterialBrightness(surfacePaint, finish.materialBrightness)
    : null;
  const effectiveOpacity: TrackerCardPaintOpacity = {
    nameColorOpacity: getFallbackAwarePaintOpacity(opacity.nameColorOpacity, !!displayPaint, [
      { hasPaint: !!accentPaint, opacity: opacity.dialogueColorOpacity },
    ]),
    dialogueColorOpacity: getFallbackAwarePaintOpacity(opacity.dialogueColorOpacity, !!accentPaint, [
      { hasPaint: !!displayPaint, opacity: opacity.nameColorOpacity },
    ]),
    boxColorOpacity: opacity.boxColorOpacity,
  };
  const surfaceFillOpacity = scalePercent(effectiveOpacity.boxColorOpacity, finish.tintIntensity);

  return {
    accent,
    accentLayer: getTrackerCardBackgroundPaintLayer(accentPaint ?? accent, effectiveOpacity.dialogueColorOpacity),
    accentGradientLayer: getTrackerCardGradientPaintLayer(accentPaint, effectiveOpacity.dialogueColorOpacity),
    displayLayer: getTrackerCardBackgroundPaintLayer(displayPaint ?? displaySolid, effectiveOpacity.nameColorOpacity),
    displayGradientLayer: getTrackerCardGradientPaintLayer(displayPaint, effectiveOpacity.nameColorOpacity),
    displaySolid,
    box: materialBox,
    boxLayer: getTrackerCardBackgroundPaintLayer(materialSurfacePaint ?? materialBox, effectiveOpacity.boxColorOpacity),
    boxGradientLayer: getTrackerCardGradientPaintLayer(materialSurfacePaint, surfaceFillOpacity),
    finish,
    hasSurfacePaint: !!surfacePaint,
    opacity: effectiveOpacity,
    portraitStageBackground,
  };
}

export function getTrackerCardStyleVars({
  palette,
  background,
}: {
  palette: TrackerCardStylePalette;
  background?: string;
}): TrackerCardStyleVars {
  const finish = getTrackerCardSkinFinish(palette.finish);
  const displayOpacity = palette.opacity.nameColorOpacity;
  const accentOpacity = palette.opacity.dialogueColorOpacity;
  const boxOpacity = palette.opacity.boxColorOpacity;
  const surfaceOpacity = palette.hasSurfacePaint ? boxOpacity : 0;
  const hasSurfacePaint = palette.hasSurfacePaint;
  const materialBrightness = palette.finish.materialBrightness;
  const surfaceNeutralTop = applyTrackerCardMaterialBrightness(
    hasSurfacePaint ? TRACKER_CARD_ACTIVE_SURFACE_TOP : TRACKER_CARD_NEUTRAL_SURFACE_TOP,
    materialBrightness,
  );
  const surfaceNeutralBottom = applyTrackerCardMaterialBrightness(
    hasSurfacePaint ? TRACKER_CARD_ACTIVE_SURFACE_BOTTOM : TRACKER_CARD_NEUTRAL_SURFACE_BOTTOM,
    materialBrightness,
  );
  const surfaceNeutralMaterial = applyTrackerCardMaterialBrightness(
    hasSurfacePaint ? TRACKER_CARD_ACTIVE_SURFACE_MATERIAL : TRACKER_CARD_NEUTRAL_MATERIAL,
    materialBrightness,
  );
  const surfaceNeutralLift = applyTrackerCardMaterialBrightness(
    hasSurfacePaint ? TRACKER_CARD_ACTIVE_SURFACE_LIFT : TRACKER_CARD_NEUTRAL_LIFT,
    materialBrightness,
  );
  const bodyDisplayOpacity = Math.min(displayOpacity, surfaceOpacity) * 0.22;
  const bodyAccentOpacity = Math.min(accentOpacity, surfaceOpacity);
  const borderOpacity = scalePercent(finish.borderOpacity, Math.max(accentOpacity, surfaceOpacity));
  const chromeBorderOpacity = Math.max(24, Math.round(borderOpacity * 0.92));
  const dialogueBorderOpacity = Math.max(24, Math.round(borderOpacity * 0.96));
  const rowRuleOpacity = scalePercent(finish.rowRuleOpacity, Math.max(accentOpacity, surfaceOpacity));
  const rowChromeOpacity = Math.max(18, Math.round(rowRuleOpacity * 0.9));
  const effectiveAccent = getStrengthAdjustedColor(palette.accent, accentOpacity, "var(--border)");
  const effectiveBox = getStrengthAdjustedColor(palette.box, surfaceOpacity, surfaceNeutralMaterial);
  const effectiveDisplaySolid = getStrengthAdjustedColor(palette.displaySolid, displayOpacity, "var(--foreground)");
  const identityChromePaint = `color-mix(in srgb, ${effectiveDisplaySolid} 72%, ${effectiveAccent} 28%)`;
  const nameplateChromePaint = `color-mix(in srgb, ${effectiveDisplaySolid} 72%, ${effectiveAccent} 28%)`;
  const broadChromePaint = `color-mix(in srgb, ${effectiveBox} 42%, ${effectiveAccent} 58%)`;
  const dialogueChromePaint = `color-mix(in srgb, ${effectiveDisplaySolid} 28%, ${effectiveAccent} 72%)`;
  const hasActiveSurface = surfaceOpacity > 0;
  const surfaceMaterialPaint = hasActiveSurface
    ? `color-mix(in srgb, ${effectiveBox} 88%, ${surfaceNeutralLift} 12%)`
    : effectiveBox;
  const materialTopBase = surfaceNeutralTop;
  const materialDepthBase = surfaceNeutralBottom;
  const panelTopBase = surfaceNeutralTop;
  const panelBottomBase = surfaceNeutralBottom;
  const fieldTopBase = `color-mix(in srgb, ${surfaceNeutralTop} 76%, var(--background) 24%)`;
  const fieldBottomBase = `color-mix(in srgb, ${surfaceNeutralBottom} 70%, var(--background) 30%)`;
  const surfaceBoxMix = scalePercent(finish.surfaceBoxMix, surfaceOpacity);
  const panelBoxMix = scalePercent(finish.panelBoxMix, surfaceOpacity);
  const mutedBoxMix = Math.round(panelBoxMix * 0.55);
  const surfaceBackMix = Math.round(surfaceBoxMix * 0.65);
  const panelBackMix = Math.round(panelBoxMix * 0.6);
  const mutedBackMix = Math.round(mutedBoxMix * 0.55);
  const strongPanelBoxMix = Math.min(62, Math.round(panelBoxMix * 1.25));
  const strongPanelBackMix = Math.round(strongPanelBoxMix * 0.62);
  const nameplateDisplayMix = scalePercent(9, displayOpacity);
  const nameplateAccentMix = scalePercent(Math.min(4, 1 + Math.round(finish.accentPanelMix * 0.1)), accentOpacity);
  const nameplateBoxMix = scalePercent(Math.min(5, 2 + Math.round(finish.panelBoxMix * 0.08)), surfaceOpacity);
  const nameplateHighlightMix = Math.max(1, Math.round((nameplateDisplayMix + nameplateAccentMix) * 0.16));
  const nameplateBaseTop = TRACKER_CARD_NAMEPLATE_BASE_TOP;
  const nameplateBaseMid = TRACKER_CARD_NAMEPLATE_BASE_MID;
  const nameplateBaseBottom = TRACKER_CARD_NAMEPLATE_BASE_BOTTOM;
  const statTrackAccentMix = scalePercent(finish.statTrackAccentMix, accentOpacity);
  const statTrackBoxMix = scalePercent(finish.statTrackBoxMix, surfaceOpacity);
  const framePaintLayers = [palette.boxGradientLayer];
  const mutedPanelPaintLayers = [palette.boxGradientLayer];
  const panelPaintLayers = [palette.boxGradientLayer];
  const panelStrongPaintLayers = [palette.boxGradientLayer];
  const statTrackPaintLayers = [palette.boxGradientLayer];
  const surfacePaintLayers = [palette.boxGradientLayer];
  const slotPaintLayers = [palette.displayGradientLayer];
  const slotTopBoxMix = scalePercent(finish.slotBoxTopMix, surfaceOpacity);
  const slotBottomBoxMix = scalePercent(finish.slotBoxBottomMix, surfaceOpacity);
  const slotTopDisplayMix = scalePercent(26, displayOpacity);
  const slotBottomDisplayMix = scalePercent(31, displayOpacity);
  const fieldInsetTopDepthMix = Math.min(56, Math.round(18 + finish.strongContrastTop * 0.45));
  const fieldInsetBottomDepthMix = Math.min(68, Math.round(22 + finish.strongContrastBottom * 0.52));
  const fieldInsetOpacity = Math.min(99, Math.round(90 + finish.strongContrastMid * 0.12));
  const slotTopSurfaceBase = `color-mix(in srgb, ${fieldTopBase} ${100 - Math.round(slotTopBoxMix * 0.22)}%, ${surfaceMaterialPaint} ${Math.round(slotTopBoxMix * 0.22)}%)`;
  const slotBottomSurfaceBase = `color-mix(in srgb, ${fieldBottomBase} ${100 - Math.round(slotBottomBoxMix * 0.18)}%, ${surfaceMaterialPaint} ${Math.round(slotBottomBoxMix * 0.18)}%)`;
  const slotTopBase = `color-mix(in srgb, ${slotTopSurfaceBase} ${100 - slotTopDisplayMix}%, ${effectiveDisplaySolid} ${slotTopDisplayMix}%)`;
  const slotBottomBase = `color-mix(in srgb, ${slotBottomSurfaceBase} ${100 - slotBottomDisplayMix}%, ${effectiveDisplaySolid} ${slotBottomDisplayMix}%)`;
  const portraitStage = getTrackerCardPortraitStageVars({
    background: palette.portraitStageBackground,
    displaySolid: effectiveDisplaySolid,
    accent: effectiveAccent,
    box: effectiveBox,
    opacity: palette.opacity,
  });
  const ambienceBoxMix = scalePercent(Math.min(34, Math.round(finish.surfaceBoxMix * 0.95)), surfaceOpacity);
  const ambienceBackMix = Math.round(ambienceBoxMix * 0.68);
  const backgroundBase =
    background ??
    `linear-gradient(135deg, color-mix(in srgb, ${materialTopBase} ${100 - ambienceBoxMix}%, ${surfaceMaterialPaint} ${ambienceBoxMix}%), ` +
      `color-mix(in srgb, ${materialDepthBase} ${100 - ambienceBackMix}%, ${surfaceMaterialPaint} ${ambienceBackMix}%))`;
  const frameBackground = getTrackerCardPaintedBackground(
    `linear-gradient(135deg, ` +
      `color-mix(in srgb, ${materialTopBase} ${100 - surfaceBoxMix}%, ${surfaceMaterialPaint} ${surfaceBoxMix}%), ` +
      `color-mix(in srgb, ${materialDepthBase} ${100 - surfaceBackMix}%, ${surfaceMaterialPaint} ${surfaceBackMix}%))`,
    framePaintLayers,
  );
  const mutedPanelBackground = getTrackerCardPaintedBackground(
    `linear-gradient(135deg, ` +
      `color-mix(in srgb, ${panelTopBase} ${100 - mutedBoxMix}%, ${surfaceMaterialPaint} ${mutedBoxMix}%), ` +
      `color-mix(in srgb, ${panelBottomBase} ${100 - mutedBackMix}%, ${surfaceMaterialPaint} ${mutedBackMix}%))`,
    mutedPanelPaintLayers,
  );
  const panelBackground = getTrackerCardPaintedBackground(
    `linear-gradient(135deg, ` +
      `color-mix(in srgb, ${panelTopBase} ${100 - panelBoxMix}%, ${surfaceMaterialPaint} ${panelBoxMix}%), ` +
      `color-mix(in srgb, ${panelBottomBase} ${100 - panelBackMix}%, ${surfaceMaterialPaint} ${panelBackMix}%))`,
    panelPaintLayers,
  );
  const panelStrongBackground = getTrackerCardPaintedBackground(
    `linear-gradient(135deg, ` +
      `color-mix(in srgb, ${panelTopBase} ${100 - strongPanelBoxMix}%, ${surfaceMaterialPaint} ${strongPanelBoxMix}%), ` +
      `color-mix(in srgb, ${panelBottomBase} ${100 - strongPanelBackMix}%, ${surfaceMaterialPaint} ${strongPanelBackMix}%))`,
    panelStrongPaintLayers,
  );
  const surfaceBackground = getTrackerCardPaintedBackground(
    `linear-gradient(135deg, ` +
      `color-mix(in srgb, ${materialTopBase} ${100 - surfaceBackMix}%, ${surfaceMaterialPaint} ${surfaceBackMix}%), ` +
      `color-mix(in srgb, ${materialDepthBase} ${100 - surfaceBoxMix}%, ${surfaceMaterialPaint} ${surfaceBoxMix}%))`,
    surfacePaintLayers,
  );
  const fieldInsetBackground = getTrackerCardPaintedBackground(
    `linear-gradient(180deg, ` +
      `color-mix(in srgb, color-mix(in srgb, ${slotTopBase} ${100 - fieldInsetTopDepthMix}%, var(--background) ${fieldInsetTopDepthMix}%) ${fieldInsetOpacity}%, transparent), ` +
      `color-mix(in srgb, color-mix(in srgb, ${slotBottomBase} ${100 - fieldInsetBottomDepthMix}%, var(--background) ${fieldInsetBottomDepthMix}%) ${fieldInsetOpacity}%, transparent))`,
    slotPaintLayers,
  );
  const statTrackBackground = getTrackerCardPaintedBackground(
    `linear-gradient(90deg, ` +
      `color-mix(in srgb, color-mix(in srgb, var(--background) ${finish.statTrackBackgroundMix}%, ${effectiveBox} ${100 - finish.statTrackBackgroundMix}%) ${100 - statTrackBoxMix}%, ${effectiveBox} ${statTrackBoxMix}%), ` +
      `color-mix(in srgb, color-mix(in srgb, var(--secondary) ${finish.statTrackBackgroundMix}%, ${effectiveAccent} ${100 - finish.statTrackBackgroundMix}%) ${100 - statTrackAccentMix}%, ${palette.accent} ${statTrackAccentMix}%))`,
    statTrackPaintLayers,
  );
  const glowStrength = Math.min(1, Math.max(0, finish.glowMix / 56));
  const glowOpacity = (glowStrength * opacityWeight(Math.max(displayOpacity, accentOpacity))).toFixed(3);
  const accentStrength = opacityWeight(accentOpacity);
  const accentHighlightOpacity =
    accentStrength <= 0 ? "0.000" : Math.min(0.68, glowStrength * accentStrength * 0.68).toFixed(3);
  const displayStrength = opacityWeight(displayOpacity);
  const displayRailOpacity =
    displayStrength <= 0
      ? "0.000"
      : Math.min(0.44, 0.05 + displayStrength * 0.16 + displayStrength * (finish.glowMix / 56) * 0.22).toFixed(3);
  const materialReadableForeground = getMaterialReadableColor({
    base: "var(--foreground)",
    materialBrightness,
    contrastIntensity: palette.finish.contrastIntensity,
    lightInk: TRACKER_CARD_READABLE_LIGHT_INK,
    darkInk: TRACKER_CARD_READABLE_DARK_INK,
  });
  const materialReadableMutedForeground = getMaterialReadableColor({
    base: "var(--muted-foreground)",
    materialBrightness,
    contrastIntensity: palette.finish.contrastIntensity,
    lightInk: TRACKER_CARD_MUTED_LIGHT_INK,
    darkInk: TRACKER_CARD_MUTED_DARK_INK,
  });
  const readableText = `color-mix(in srgb, var(--foreground) ${finish.textMix}%, var(--muted-foreground) ${100 - finish.textMix}%)`;
  const readableNumberText = `color-mix(in srgb, var(--foreground) ${finish.numberTextMix}%, var(--muted-foreground) ${100 - finish.numberTextMix}%)`;
  const mutedReadableText = `color-mix(in srgb, var(--foreground) ${finish.mutedTextMix}%, var(--muted-foreground) ${100 - finish.mutedTextMix}%)`;
  const materialReadableText = `color-mix(in srgb, ${materialReadableForeground} ${finish.textMix}%, ${materialReadableMutedForeground} ${100 - finish.textMix}%)`;
  const materialMutedReadableText = `color-mix(in srgb, ${materialReadableForeground} ${finish.mutedTextMix}%, ${materialReadableMutedForeground} ${100 - finish.mutedTextMix}%)`;
  const iconInkMix = Math.min(
    46,
    Math.round(getMaterialPolarityMix(materialBrightness, palette.finish.contrastIntensity) * 0.48),
  );
  const readableLabelText = `color-mix(in srgb, ${materialReadableText} 94%, ${effectiveDisplaySolid} 6%)`;
  const readableLabelMutedText = `color-mix(in srgb, ${materialMutedReadableText} 92%, ${effectiveDisplaySolid} 8%)`;
  const readableLabelIcon = `color-mix(in srgb, ${effectiveAccent} ${100 - iconInkMix}%, ${readableLabelText} ${iconInkMix}%)`;

  return {
    accent: effectiveAccent,
    accentHighlightOpacity,
    accentLayer: palette.accentLayer,
    accentSolid: effectiveAccent,
    accentWashOpacity: scaleOpacity((finish.glowMix / 74).toFixed(3), bodyAccentOpacity),
    bodyRuleOpacity: scaleOpacity("0.45", bodyDisplayOpacity),
    bodyWashOpacity: scaleOpacity(finish.displayOpacity, bodyDisplayOpacity),
    box: effectiveBox,
    boxLayer: palette.boxLayer,
    dialogueBorder: `color-mix(in srgb, ${dialogueChromePaint} ${dialogueBorderOpacity}%, transparent)`,
    dialogueGlow: `color-mix(in srgb, ${identityChromePaint} ${scalePercent(Math.min(16, Math.round(finish.glowMix * 0.46)), accentOpacity)}%, transparent)`,
    displayLayer: palette.displayLayer,
    displayOpacity: scaleOpacity(finish.displayOpacity, displayOpacity),
    displayRailOpacity,
    displaySolid: effectiveDisplaySolid,
    frame: frameBackground,
    frameBlend: getTrackerCardBackgroundBlendMode(framePaintLayers),
    fieldMaterial: fieldInsetBackground,
    fieldMaterialBlend: getTrackerCardBackgroundBlendMode(slotPaintLayers, "soft-light"),
    glowOpacity,
    icon: effectiveAccent,
    labelIcon: readableLabelIcon,
    labelMutedText: readableLabelMutedText,
    labelText: readableLabelText,
    material: frameBackground,
    materialBlend: getTrackerCardBackgroundBlendMode(framePaintLayers),
    mutedPanel: mutedPanelBackground,
    mutedPanelBlend: getTrackerCardBackgroundBlendMode(mutedPanelPaintLayers),
    nameplate:
      `radial-gradient(ellipse at 50% 0%, color-mix(in srgb, ${effectiveDisplaySolid} ${nameplateHighlightMix}%, transparent) 0%, transparent 46%), ` +
      `linear-gradient(180deg, ` +
      `color-mix(in srgb, ${nameplateBaseTop} ${100 - nameplateDisplayMix}%, ${effectiveDisplaySolid} ${nameplateDisplayMix}%) 0%, ` +
      `color-mix(in srgb, ${nameplateBaseMid} ${100 - nameplateAccentMix}%, ${nameplateChromePaint} ${nameplateAccentMix}%) 50%, ` +
      `color-mix(in srgb, ${nameplateBaseBottom} ${100 - nameplateBoxMix}%, ${effectiveBox} ${nameplateBoxMix}%) 100%)`,
    nameplateGlow: `color-mix(in srgb, ${effectiveAccent} ${scalePercent(Math.min(12, Math.round(finish.glowMix * 0.22)), accentOpacity)}%, transparent)`,
    nameplateRule: `color-mix(in srgb, ${nameplateChromePaint} ${Math.max(20, Math.round(borderOpacity * 0.48))}%, transparent)`,
    nameplateText: `color-mix(in srgb, ${TRACKER_CARD_NAMEPLATE_TEXT_BASE} 78%, ${effectiveDisplaySolid} 22%)`,
    panel: panelBackground,
    panelBlend: getTrackerCardBackgroundBlendMode(panelPaintLayers, "overlay"),
    panelMaterial: panelBackground,
    panelMaterialBlend: getTrackerCardBackgroundBlendMode(panelPaintLayers, "overlay"),
    panelStrong: panelStrongBackground,
    panelStrongBlend: getTrackerCardBackgroundBlendMode(panelStrongPaintLayers, "overlay"),
    portraitBase: portraitStage.base,
    portraitBottomGlowOpacity: portraitStage.bottomGlowOpacity,
    portraitBottomRuleOpacity: portraitStage.bottomRuleOpacity,
    portraitMediaBlur: portraitStage.mediaBlur,
    portraitMediaOpacity: portraitStage.mediaOpacity,
    portraitMediaSaturate: portraitStage.mediaSaturate,
    portraitLight: portraitStage.light,
    portraitLightOpacity: portraitStage.lightOpacity,
    portraitRim: portraitStage.rim,
    portraitRimOpacity: portraitStage.rimOpacity,
    portraitSideMaskOpacity: portraitStage.sideMaskOpacity,
    portraitVeil: portraitStage.veil,
    rule: `color-mix(in srgb, ${broadChromePaint} ${chromeBorderOpacity}%, transparent)`,
    surface: surfaceBackground,
    surfaceBlend: getTrackerCardBackgroundBlendMode(surfacePaintLayers),
    surfaceLayer: palette.boxLayer,
    surfaceSolid: effectiveBox,
    slotRule: `color-mix(in srgb, color-mix(in srgb, ${effectiveBox} 50%, var(--foreground) 50%) ${finish.slotRuleOpacity}%, transparent)`,
    slotShadow: `rgba(0, 0, 0, ${finish.slotShadowOpacity})`,
    slotSurface: fieldInsetBackground,
    slotSurfaceBlend: getTrackerCardBackgroundBlendMode(slotPaintLayers, "soft-light"),
    tintOpacity: scaleOpacity(finish.tintOpacity, surfaceOpacity),
    contrastSoftTop: `${finish.softContrastTop}%`,
    contrastSoftMid: `${finish.softContrastMid}%`,
    contrastSoftBottom: `${finish.softContrastBottom}%`,
    contrastStrongTop: `${finish.strongContrastTop}%`,
    contrastStrongMid: `${finish.strongContrastMid}%`,
    contrastStrongBottom: `${finish.strongContrastBottom}%`,
    mutedText: `color-mix(in srgb, ${mutedReadableText} 92%, ${effectiveDisplaySolid} 8%)`,
    numberText: `color-mix(in srgb, ${readableNumberText} 94%, ${effectiveDisplaySolid} 6%)`,
    rowRule: `color-mix(in srgb, ${dialogueChromePaint} ${rowChromeOpacity}%, transparent)`,
    statFillGlow: `color-mix(in srgb, color-mix(in srgb, ${palette.accent} 42%, var(--foreground) 58%) ${scalePercent(finish.statFillGlowMix, accentOpacity)}%, transparent)`,
    statFillHighlight: `color-mix(in srgb, var(--foreground) ${finish.statFillHighlightMix}%, transparent)`,
    statTrack: statTrackBackground,
    statTrackBlend: getTrackerCardBackgroundBlendMode(statTrackPaintLayers, "overlay"),
    statTrackRing: `color-mix(in srgb, color-mix(in srgb, ${palette.accent} 52%, var(--foreground) 48%) ${scalePercent(finish.statTrackRingOpacity, accentOpacity)}%, transparent)`,
    statTrackShadow: `rgba(0, 0, 0, ${finish.statTrackShadowOpacity})`,
    text: `color-mix(in srgb, ${readableText} 94%, ${effectiveDisplaySolid} 6%)`,
    background: getTrackerCardPaintedBackground(backgroundBase, framePaintLayers),
    backgroundBlendMode: getTrackerCardBackgroundBlendMode(framePaintLayers),
  };
}

export function getTrackerCardPortraitStageVars({
  background,
  displaySolid,
  accent,
  box,
  opacity,
}: TrackerCardPortraitStagePalette): TrackerCardPortraitStageVars {
  const displayMix = scalePercent(18, opacity.nameColorOpacity);
  const displaySoftMix = scalePercent(12, opacity.nameColorOpacity);
  const displayGlowMix = scalePercent(28, opacity.nameColorOpacity);
  const boxMix = scalePercent(30, opacity.boxColorOpacity);
  const boxSoftMix = scalePercent(18, opacity.boxColorOpacity);
  const accentMix = scalePercent(16, opacity.dialogueColorOpacity);
  const softBoxMix = boxMix > 0 ? Math.max(boxMix, 12) : 0;
  const softDisplayMix = displaySoftMix > 0 ? Math.max(displaySoftMix, 10) : 0;
  const plainBoxMix = scalePercent(8, opacity.boxColorOpacity);
  const plainDisplayMix = scalePercent(4, opacity.nameColorOpacity);
  const accentSoftMix = accentMix > 0 ? Math.max(accentMix, 8) : 0;
  const accentKeyMix = accentMix > 0 ? Math.max(accentMix, 12) : 0;
  const displayKeyMix = displayGlowMix > 0 ? Math.max(displayGlowMix, 14) : 0;
  const displayWashMix = displaySoftMix > 0 ? Math.max(displaySoftMix, 8) : 0;
  const boxKeyMix = boxSoftMix > 0 ? Math.max(boxSoftMix, 10) : 0;

  switch (background) {
    case "spotlight":
      return {
        base:
          `radial-gradient(ellipse at 50% 38%, color-mix(in srgb, ${displaySolid} ${displayKeyMix}%, transparent) 0%, transparent 32%), ` +
          `radial-gradient(ellipse at 50% 108%, color-mix(in srgb, ${accent} ${accentKeyMix}%, transparent) 0%, transparent 48%), ` +
          `linear-gradient(180deg, color-mix(in srgb, var(--card) ${100 - boxKeyMix}%, ${box} ${boxKeyMix}%) 0%, ` +
          `color-mix(in srgb, var(--background) 92%, ${box} 8%) 100%)`,
        veil:
          "radial-gradient(ellipse at 50% 39%, transparent 0%, transparent 28%, " +
          "color-mix(in srgb, var(--background) 46%, transparent) 68%, " +
          "color-mix(in srgb, var(--background) 84%, transparent) 100%), " +
          "linear-gradient(90deg, color-mix(in srgb, var(--background) 62%, transparent) 0%, transparent 24%, transparent 76%, color-mix(in srgb, var(--background) 62%, transparent) 100%)",
        light:
          `radial-gradient(ellipse at 50% 22%, color-mix(in srgb, ${displaySolid} ${displayKeyMix}%, transparent) 0%, transparent 34%), ` +
          `radial-gradient(ellipse at 50% 94%, color-mix(in srgb, ${accent} ${accentKeyMix}%, transparent) 0%, transparent 44%)`,
        lightOpacity: "0.88",
        rim:
          `linear-gradient(180deg, color-mix(in srgb, ${displaySolid} 26%, transparent) 0%, transparent 28%), ` +
          `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${displaySolid} 18%, ${accent} 82%) 48%, transparent 100%)`,
        rimOpacity: "0.64",
        mediaOpacity: "0.16",
        mediaBlur: "1.8rem",
        mediaSaturate: "1.12",
        sideMaskOpacity: "0.84",
        bottomGlowOpacity: "0.7",
        bottomRuleOpacity: "0.9",
      };
    case "soft":
      return {
        base:
          `radial-gradient(circle at 18% 24%, color-mix(in srgb, ${box} ${softBoxMix}%, transparent) 0%, transparent 46%), ` +
          `radial-gradient(circle at 82% 18%, color-mix(in srgb, ${displaySolid} ${softDisplayMix}%, transparent) 0%, transparent 48%), ` +
          `linear-gradient(145deg, color-mix(in srgb, var(--card) ${100 - softBoxMix}%, ${box} ${softBoxMix}%) 0%, ` +
          `color-mix(in srgb, var(--background) ${100 - softDisplayMix}%, ${displaySolid} ${softDisplayMix}%) 100%)`,
        veil:
          `radial-gradient(circle at 50% 48%, color-mix(in srgb, ${accent} ${accentSoftMix}%, transparent) 0%, transparent 64%), ` +
          "linear-gradient(180deg, color-mix(in srgb, var(--background) 18%, transparent) 0%, transparent 44%, " +
          "color-mix(in srgb, var(--background) 38%, transparent) 100%)",
        light:
          `radial-gradient(ellipse at 24% 28%, color-mix(in srgb, ${displaySolid} ${displayWashMix}%, transparent) 0%, transparent 42%), ` +
          `radial-gradient(ellipse at 76% 64%, color-mix(in srgb, ${accent} ${Math.round(accentSoftMix * 0.72)}%, transparent) 0%, transparent 52%)`,
        lightOpacity: "0.56",
        rim:
          `linear-gradient(90deg, color-mix(in srgb, ${box} 16%, transparent) 0%, transparent 38%, color-mix(in srgb, ${displaySolid} 14%, transparent) 100%), ` +
          `linear-gradient(180deg, color-mix(in srgb, var(--foreground) 6%, transparent) 0%, transparent 36%)`,
        rimOpacity: "0.42",
        mediaOpacity: "0.34",
        mediaBlur: "2.25rem",
        mediaSaturate: "1.32",
        sideMaskOpacity: "0.34",
        bottomGlowOpacity: "0.46",
        bottomRuleOpacity: "0.46",
      };
    case "plain":
      return {
        base:
          `linear-gradient(180deg, color-mix(in srgb, var(--card) ${100 - plainBoxMix}%, ${box} ${plainBoxMix}%) 0%, ` +
          `color-mix(in srgb, var(--background) ${100 - plainDisplayMix}%, ${displaySolid} ${plainDisplayMix}%) 100%)`,
        veil: "linear-gradient(180deg, color-mix(in srgb, var(--background) 12%, transparent) 0%, transparent 48%, color-mix(in srgb, var(--background) 48%, transparent) 100%)",
        light: `radial-gradient(ellipse at 50% 86%, color-mix(in srgb, ${accent} ${Math.round(accentSoftMix * 0.45)}%, transparent) 0%, transparent 46%)`,
        lightOpacity: "0.22",
        rim:
          `linear-gradient(180deg, color-mix(in srgb, var(--foreground) 5%, transparent) 0%, transparent 20%), ` +
          `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${displaySolid} 16%, transparent) 50%, transparent 100%)`,
        rimOpacity: "0.28",
        mediaOpacity: "0.03",
        mediaBlur: "1rem",
        mediaSaturate: "0.9",
        sideMaskOpacity: "0.22",
        bottomGlowOpacity: "0.16",
        bottomRuleOpacity: "0.24",
      };
    case "ambient":
    default:
      return {
        base:
          `radial-gradient(ellipse at 16% 18%, color-mix(in srgb, ${displaySolid} ${displayWashMix}%, transparent) 0%, transparent 42%), ` +
          `radial-gradient(ellipse at 84% 82%, color-mix(in srgb, ${accent} ${accentSoftMix}%, transparent) 0%, transparent 48%), ` +
          `linear-gradient(150deg, color-mix(in srgb, ${box} ${boxMix}%, var(--background) ${100 - boxMix}%) 0%, ` +
          `color-mix(in srgb, var(--background) ${100 - displaySoftMix}%, ${displaySolid} ${displaySoftMix}%) 48%, ` +
          `color-mix(in srgb, var(--card) ${100 - boxMix}%, ${box} ${boxMix}%) 100%)`,
        veil:
          `linear-gradient(180deg, color-mix(in srgb, ${displaySolid} ${displayMix}%, transparent) 0%, transparent 34%, ` +
          "color-mix(in srgb, var(--background) 48%, transparent) 100%), " +
          "linear-gradient(115deg, transparent 0%, color-mix(in srgb, var(--foreground) 5%, transparent) 44%, transparent 66%)",
        light:
          `radial-gradient(ellipse at 28% 30%, color-mix(in srgb, ${displaySolid} ${displayKeyMix}%, transparent) 0%, transparent 42%), ` +
          `radial-gradient(ellipse at 76% 70%, color-mix(in srgb, ${accent} ${accentKeyMix}%, transparent) 0%, transparent 46%)`,
        lightOpacity: "0.7",
        rim:
          `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${displaySolid} 16%, ${accent} 84%) 50%, transparent 100%), ` +
          `linear-gradient(180deg, color-mix(in srgb, ${displaySolid} 14%, var(--foreground) 86%) 0%, transparent 28%)`,
        rimOpacity: "0.52",
        mediaOpacity: "0.22",
        mediaBlur: "1.45rem",
        mediaSaturate: "1.22",
        sideMaskOpacity: "0.82",
        bottomGlowOpacity: "0.82",
        bottomRuleOpacity: "0.78",
      };
  }
}

function getMix(value: number, scale: number, max: number) {
  return Math.min(max, Math.round(value * scale));
}

function getRange(base: number, value: number, scale: number, max: number) {
  return Math.min(max, Math.round(base + value * scale));
}

function getOpacity(base: number, value: number, scale: number, max: number) {
  return Math.min(max, base + value * scale).toFixed(3);
}

export function getTrackerCardSkinFinish(finish: TrackerCardFinish): TrackerCardSkinFinish {
  const tint = finish.tintIntensity;
  const glow = finish.glowIntensity;
  const contrast = finish.contrastIntensity;

  return {
    accentPanelMix: getMix(glow, 0.2, 22),
    borderOpacity: Math.min(78, Math.round(14 + glow * 0.58)),
    displayOpacity: "0.075",
    glowMix: getRange(0, glow, 0.56, 56),
    mutedTextMix: getRange(54, contrast, 0.38, 92),
    numberTextMix: getRange(62, contrast, 0.34, 96),
    panelBoxMix: getMix(tint, 0.46, 54),
    rowRuleOpacity: Math.min(58, Math.round(8 + glow * 0.42)),
    softContrastBottom: getRange(8, contrast, 0.58, 72),
    softContrastMid: getRange(5, contrast, 0.46, 58),
    softContrastTop: getRange(7, contrast, 0.52, 66),
    slotBackgroundBottomMix: getRange(30, contrast, 0.52, 82),
    slotBackgroundTopMix: getRange(24, contrast, 0.46, 72),
    slotBoxBottomMix: getMix(tint, 0.38, 40),
    slotBoxTopMix: getMix(tint, 0.42, 44),
    slotRuleOpacity: getRange(12, contrast, 0.52, 66),
    slotShadowOpacity: getOpacity(0.025, contrast, 0.0028, 0.3),
    statTrackAccentMix: Math.min(24, Math.round(2 + tint * 0.08 + glow * 0.12)),
    statFillGlowMix: Math.min(32, Math.round(5 + contrast * 0.12 + glow * 0.12)),
    statFillHighlightMix: getRange(8, contrast, 0.18, 28),
    statTrackBackgroundMix: getRange(55, contrast, 0.38, 94),
    statTrackBoxMix: getMix(tint, 0.32, 34),
    statTrackRingOpacity: getRange(4, glow, 0.34, 38),
    statTrackShadowOpacity: getOpacity(0.08, contrast, 0.0048, 0.56),
    strongContrastBottom: getRange(14, contrast, 0.68, 84),
    strongContrastMid: getRange(9, contrast, 0.56, 70),
    strongContrastTop: getRange(12, contrast, 0.64, 78),
    surfaceBoxMix: getMix(tint, 0.62, 64),
    textMix: getRange(74, contrast, 0.26, 98),
    tintOpacity: getOpacity(0, tint, 0.0024, 0.28),
  };
}
