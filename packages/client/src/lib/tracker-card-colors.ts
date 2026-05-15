import type {
  TrackerCardColorConfig,
  TrackerCardColorMode,
  TrackerCardPortraitStageBackground,
} from "@marinara-engine/shared";

export const DEFAULT_TRACKER_CARD_COLOR_MODE: TrackerCardColorMode = "chat";
export const DEFAULT_TRACKER_CARD_PORTRAIT_STAGE_BACKGROUND: TrackerCardPortraitStageBackground = "ambient";

export interface TrackerCardFinish {
  tintIntensity: number;
  glowIntensity: number;
  contrastIntensity: number;
}

export interface TrackerCardPaintOpacity {
  nameColorOpacity: number;
  dialogueColorOpacity: number;
  boxColorOpacity: number;
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

export interface TrackerCardSkinFinish {
  accentPanelMix: number;
  borderOpacity: number;
  displayOpacity: string;
  glowMix: number;
  mutedTextMix: number;
  numberTextMix: number;
  panelBoxMix: number;
  panelDisplayMix: number;
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
  surfaceDisplayMix: number;
  textMix: number;
  tintOpacity: string;
}

export const TRACKER_CARD_FINISH_DEFAULTS: Record<TrackerCardColorMode, TrackerCardFinish> = {
  default: {
    tintIntensity: 0,
    glowIntensity: 25,
    contrastIntensity: 55,
  },
  chat: {
    tintIntensity: 35,
    glowIntensity: 45,
    contrastIntensity: 55,
  },
  custom: {
    tintIntensity: 35,
    glowIntensity: 45,
    contrastIntensity: 55,
  },
};

export const TRACKER_CARD_PAINT_OPACITY_DEFAULTS: TrackerCardPaintOpacity = {
  nameColorOpacity: 100,
  dialogueColorOpacity: 100,
  boxColorOpacity: 100,
};

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

function getClampedFinishValue(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numberValue)) return undefined;
  return Math.max(0, Math.min(100, Math.round(numberValue)));
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
  const nameColorOpacity = getClampedFinishValue(config?.nameColorOpacity);
  const dialogueColorOpacity = getClampedFinishValue(config?.dialogueColorOpacity);
  const boxColorOpacity = getClampedFinishValue(config?.boxColorOpacity);
  const tintIntensity = getClampedFinishValue(config?.tintIntensity);
  const glowIntensity = getClampedFinishValue(config?.glowIntensity);
  const contrastIntensity = getClampedFinishValue(config?.contrastIntensity);
  const portraitStageBackground = normalizeTrackerCardPortraitStageBackground(config?.portraitStageBackground);

  return {
    mode: normalizeTrackerCardColorMode(config?.mode),
    ...(config?.nameColor ? { nameColor: config.nameColor } : {}),
    ...(nameColorOpacity !== undefined && { nameColorOpacity }),
    ...(config?.dialogueColor ? { dialogueColor: config.dialogueColor } : {}),
    ...(dialogueColorOpacity !== undefined && { dialogueColorOpacity }),
    ...(config?.boxColor ? { boxColor: config.boxColor } : {}),
    ...(boxColorOpacity !== undefined && { boxColorOpacity }),
    ...(tintIntensity !== undefined && { tintIntensity }),
    ...(glowIntensity !== undefined && { glowIntensity }),
    ...(contrastIntensity !== undefined && { contrastIntensity }),
    ...(portraitStageBackground !== DEFAULT_TRACKER_CARD_PORTRAIT_STAGE_BACKGROUND && { portraitStageBackground }),
  };
}

export function parseTrackerCardColorConfig(raw: unknown): TrackerCardColorConfig {
  const record = parseRecord(raw);
  if (!record) return { mode: DEFAULT_TRACKER_CARD_COLOR_MODE };

  return cleanTrackerCardColorConfig({
    mode: normalizeTrackerCardColorMode(record.mode),
    nameColor: getString(record.nameColor),
    nameColorOpacity: getClampedFinishValue(record.nameColorOpacity),
    dialogueColor: getString(record.dialogueColor),
    dialogueColorOpacity: getClampedFinishValue(record.dialogueColorOpacity),
    boxColor: getString(record.boxColor),
    boxColorOpacity: getClampedFinishValue(record.boxColorOpacity),
    tintIntensity: getClampedFinishValue(record.tintIntensity),
    glowIntensity: getClampedFinishValue(record.glowIntensity),
    contrastIntensity: getClampedFinishValue(record.contrastIntensity),
    portraitStageBackground: normalizeTrackerCardPortraitStageBackground(record.portraitStageBackground),
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
    tintIntensity: getClampedFinishValue(config?.tintIntensity) ?? defaults.tintIntensity,
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

export function getTrackerCardPortraitStageBackground(
  config: TrackerCardColorConfig | null | undefined,
): TrackerCardPortraitStageBackground {
  return normalizeTrackerCardPortraitStageBackground(config?.portraitStageBackground);
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
  return (
    text.startsWith("to ") ||
    text.startsWith("in ") ||
    /^[-+]?(?:\d+|\d*\.\d+)(?:deg|grad|rad|turn)$/.test(text)
  );
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
          `linear-gradient(180deg, color-mix(in srgb, ${displaySolid} 18%, transparent) 0%, transparent 24%), ` +
          `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${accent} 34%, transparent) 48%, transparent 100%)`,
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
          `radial-gradient(ellipse at 24% 36%, color-mix(in srgb, ${accent} ${accentSoftMix}%, transparent) 0%, transparent 46%), ` +
          `radial-gradient(ellipse at 76% 64%, color-mix(in srgb, ${displaySolid} ${displayWashMix}%, transparent) 0%, transparent 52%)`,
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
        veil:
          "linear-gradient(180deg, color-mix(in srgb, var(--background) 12%, transparent) 0%, transparent 48%, color-mix(in srgb, var(--background) 48%, transparent) 100%)",
        light:
          `radial-gradient(ellipse at 50% 86%, color-mix(in srgb, ${accent} ${Math.round(accentSoftMix * 0.45)}%, transparent) 0%, transparent 46%)`,
        lightOpacity: "0.22",
        rim:
          `linear-gradient(180deg, color-mix(in srgb, var(--foreground) 5%, transparent) 0%, transparent 20%), ` +
          `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${displaySolid} 10%, transparent) 50%, transparent 100%)`,
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
          `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${accent} 28%, transparent) 50%, transparent 100%), ` +
          `linear-gradient(180deg, color-mix(in srgb, var(--foreground) 7%, transparent) 0%, transparent 28%)`,
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
    borderOpacity: Math.min(86, Math.round(20 + glow * 0.38 + contrast * 0.24)),
    displayOpacity: getOpacity(0.035, tint + glow, 0.00062, 0.18),
    glowMix: getRange(12, glow, 0.42, 56),
    mutedTextMix: getRange(54, contrast, 0.38, 92),
    numberTextMix: getRange(62, contrast, 0.34, 96),
    panelBoxMix: getMix(tint, 0.28, 32),
    panelDisplayMix: getMix(tint, 0.2, 22),
    rowRuleOpacity: Math.min(66, Math.round(10 + contrast * 0.48 + glow * 0.08)),
    softContrastBottom: getRange(14, contrast, 0.48, 70),
    softContrastMid: getRange(9, contrast, 0.38, 56),
    softContrastTop: getRange(12, contrast, 0.44, 64),
    slotBackgroundBottomMix: getRange(38, contrast, 0.4, 78),
    slotBackgroundTopMix: getRange(30, contrast, 0.36, 70),
    slotBoxBottomMix: getMix(tint, 0.18, 20),
    slotBoxTopMix: getMix(tint, 0.22, 24),
    slotRuleOpacity: getRange(18, contrast, 0.42, 64),
    slotShadowOpacity: getOpacity(0.06, contrast, 0.0022, 0.28),
    statTrackAccentMix: Math.min(24, Math.round(2 + tint * 0.08 + glow * 0.12)),
    statFillGlowMix: Math.min(32, Math.round(5 + contrast * 0.12 + glow * 0.12)),
    statFillHighlightMix: getRange(8, contrast, 0.18, 28),
    statTrackBackgroundMix: getRange(55, contrast, 0.38, 94),
    statTrackBoxMix: getMix(tint, 0.18, 20),
    statTrackRingOpacity: getRange(8, contrast, 0.3, 42),
    statTrackShadowOpacity: getOpacity(0.18, contrast, 0.004, 0.56),
    strongContrastBottom: getRange(24, contrast, 0.55, 82),
    strongContrastMid: getRange(16, contrast, 0.46, 68),
    strongContrastTop: getRange(20, contrast, 0.52, 76),
    surfaceBoxMix: getMix(tint, 0.3, 34),
    surfaceDisplayMix: getMix(tint, 0.26, 30),
    textMix: getRange(74, contrast, 0.26, 98),
    tintOpacity: getOpacity(0.03, tint, 0.0014, 0.2),
  };
}
