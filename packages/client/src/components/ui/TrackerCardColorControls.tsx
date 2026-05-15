import { useState, type CSSProperties } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  Image,
  Layers,
  MessageSquareText,
  Package,
  Palette,
  Sparkles,
  Square,
} from "lucide-react";
import type {
  TrackerCardColorConfig,
  TrackerCardColorMode,
  TrackerCardPortraitStageBackground,
} from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import {
  applyTrackerCardPaintOpacity,
  cleanTrackerCardColorConfig,
  getTrackerCardFinish,
  getTrackerCardPaintOpacity,
  getTrackerCardPortraitStageBackground,
  getTrackerCardPortraitStageVars,
  getTrackerCardSkinFinish,
  normalizeTrackerCardColorMode,
  parseTrackerCardColorConfig,
  type TrackerCardFinish,
  type TrackerCardPaintOpacity,
} from "../../lib/tracker-card-colors";
import { ColorPicker } from "./ColorPicker";

interface TrackerCardColorControlsProps {
  value: TrackerCardColorConfig | string | null | undefined;
  onChange: (value: TrackerCardColorConfig) => void;
  chatColors: {
    nameColor?: string | null;
    dialogueColor?: string | null;
    boxColor?: string | null;
  };
  entityLabel: "Character" | "Persona";
  previewName: string;
}

const MODE_OPTIONS: Array<{
  mode: TrackerCardColorMode;
  label: string;
  icon: typeof Palette;
}> = [
  { mode: "default", label: "Default", icon: Palette },
  { mode: "chat", label: "Chat colors", icon: MessageSquareText },
  { mode: "custom", label: "Custom", icon: Sparkles },
];

const FINISH_OPTIONS: Array<{
  key: "tintIntensity" | "glowIntensity" | "contrastIntensity";
  label: string;
}> = [
  { key: "tintIntensity", label: "Tint" },
  { key: "glowIntensity", label: "Glow" },
  { key: "contrastIntensity", label: "Contrast" },
];

const FINISH_PRESETS: Array<{
  label: string;
  finish: TrackerCardFinish;
}> = [
  { label: "Clean", finish: { tintIntensity: 12, glowIntensity: 24, contrastIntensity: 58 } },
  { label: "Tinted", finish: { tintIntensity: 48, glowIntensity: 46, contrastIntensity: 64 } },
  { label: "Dramatic", finish: { tintIntensity: 86, glowIntensity: 82, contrastIntensity: 86 } },
];

const PAINT_OPACITY_OPTIONS: Array<{
  key: keyof TrackerCardPaintOpacity;
  label: string;
}> = [
  { key: "nameColorOpacity", label: "Display" },
  { key: "dialogueColorOpacity", label: "Accent" },
  { key: "boxColorOpacity", label: "Surface" },
];

const PORTRAIT_STAGE_BACKGROUND_OPTIONS: Array<{
  value: TrackerCardPortraitStageBackground;
  label: string;
  icon: typeof Palette;
  title: string;
}> = [
  { value: "ambient", label: "Ambient", icon: Layers, title: "Balanced color wash" },
  { value: "spotlight", label: "Spotlight", icon: Circle, title: "Focused center glow" },
  { value: "soft", label: "Haze", icon: Image, title: "Diffused portrait glow" },
  { value: "plain", label: "Plain", icon: Square, title: "Quiet neutral stage" },
];

const TRACKER_CARD_PREVIEW_STATS = [
  { label: "Satiety", value: "58", width: "58%", color: "#55c860" },
  { label: "Energy", value: "67", width: "67%", color: "#ffb01f" },
  { label: "Hygiene", value: "70", width: "70%", color: "#2ea7f7" },
  { label: "Morale", value: "83", width: "83%", color: "#ff5555" },
];

function getDisplayStyle(value: string | null | undefined) {
  if (!value) {
    return {
      backgroundImage: "repeating-conic-gradient(var(--border) 0% 25%, transparent 0% 50%)",
      backgroundSize: "0.5rem 0.5rem",
    };
  }

  return value.includes("gradient(") ? { background: value } : { backgroundColor: value };
}

function getCssPaintValue(value: string | null | undefined) {
  const text = value?.trim();
  if (!text || /url\(|;|expression\(/i.test(text)) return null;
  return text;
}

function getGradientPaintLayer(value: string | null | undefined, opacity = 100) {
  const text = getCssPaintValue(value);
  return text?.toLowerCase().includes("gradient(") ? applyTrackerCardPaintOpacity(text, opacity) : null;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function opacityWeight(value: number) {
  return clampPercent(value) / 100;
}

function scalePercent(value: number, opacity: number) {
  return Math.round(value * opacityWeight(opacity));
}

function scaleOpacity(value: string, opacity: number) {
  return (Number(value) * opacityWeight(opacity)).toFixed(3);
}

function getBackgroundPaintLayer(value: string, opacity = 100) {
  return value.toLowerCase().includes("gradient(")
    ? applyTrackerCardPaintOpacity(value, opacity)
    : `linear-gradient(${applyTrackerCardPaintOpacity(value, opacity)}, ${applyTrackerCardPaintOpacity(value, opacity)})`;
}

function getOpacityPaintLayer(value: string | null | undefined, opacity: number) {
  const text = getCssPaintValue(value);
  if (!text) return null;
  return getBackgroundPaintLayer(text, opacity);
}

function getPaintedBackground(base: string, layers: Array<string | null | undefined>) {
  const activeLayers = layers.filter((layer): layer is string => !!layer);
  return activeLayers.length ? `${activeLayers.join(", ")}, ${base}` : base;
}

function getBackgroundBlendMode(layers: Array<string | null | undefined>, mode = "soft-light") {
  const activeLayerCount = layers.filter(Boolean).length;
  return activeLayerCount ? `${Array.from({ length: activeLayerCount }, () => mode).join(", ")}, normal` : "normal";
}

function getPaintSolidFallback(value: string | null | undefined) {
  const text = getCssPaintValue(value);
  if (!text) return null;
  if (!text.toLowerCase().includes("gradient(")) return text;
  return (
    text.match(
      /#[0-9a-f]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)|oklch\([^)]+\)|oklab\([^)]+\)|lch\([^)]+\)|lab\([^)]+\)|var\(--[\w-]+\)/i,
    )?.[0] ?? null
  );
}

type TrackerPreviewStyle = CSSProperties & {
  "--tracker-preview-accent": string;
  "--tracker-preview-accent-layer": string;
  "--tracker-preview-box": string;
  "--tracker-preview-box-layer": string;
  "--tracker-preview-dialogue-glow": string;
  "--tracker-preview-display-layer": string;
  "--tracker-preview-display-opacity": string;
  "--tracker-preview-display-solid": string;
  "--tracker-preview-frame": string;
  "--tracker-preview-frame-blend": string;
  "--tracker-preview-muted-panel": string;
  "--tracker-preview-muted-panel-blend": string;
  "--tracker-preview-panel": string;
  "--tracker-preview-panel-blend": string;
  "--tracker-preview-panel-strong": string;
  "--tracker-preview-panel-strong-blend": string;
  "--tracker-preview-portrait-base": string;
  "--tracker-preview-portrait-bottom-glow-opacity": string;
  "--tracker-preview-portrait-bottom-rule-opacity": string;
  "--tracker-preview-portrait-media-blur": string;
  "--tracker-preview-portrait-media-opacity": string;
  "--tracker-preview-portrait-media-saturate": string;
  "--tracker-preview-portrait-light": string;
  "--tracker-preview-portrait-light-opacity": string;
  "--tracker-preview-portrait-rim": string;
  "--tracker-preview-portrait-rim-opacity": string;
  "--tracker-preview-portrait-side-mask-opacity": string;
  "--tracker-preview-portrait-veil": string;
  "--tracker-preview-rule": string;
  "--tracker-preview-surface": string;
  "--tracker-preview-surface-blend": string;
  "--tracker-preview-slot-rule": string;
  "--tracker-preview-slot-shadow": string;
  "--tracker-preview-slot-surface": string;
  "--tracker-preview-slot-surface-blend": string;
  "--tracker-preview-tint-opacity": string;
  "--tracker-preview-glow-opacity": string;
  "--tracker-preview-contrast-top": string;
  "--tracker-preview-contrast-mid": string;
  "--tracker-preview-contrast-bottom": string;
  "--tracker-preview-muted-text": string;
  "--tracker-preview-number-text": string;
  "--tracker-preview-row-rule": string;
  "--tracker-preview-stat-fill-glow": string;
  "--tracker-preview-stat-fill-highlight": string;
  "--tracker-preview-stat-track": string;
  "--tracker-preview-stat-track-blend": string;
  "--tracker-preview-stat-track-ring": string;
  "--tracker-preview-stat-track-shadow": string;
  "--tracker-preview-text": string;
};

function getTrackerPreviewStyle(
  colors: TrackerCardColorControlsProps["chatColors"],
  finish: ReturnType<typeof getTrackerCardFinish>,
  paintOpacity: TrackerCardPaintOpacity,
  portraitStageBackground: TrackerCardPortraitStageBackground,
): TrackerPreviewStyle {
  const skin = getTrackerCardSkinFinish(finish);
  const displayOpacity = paintOpacity.nameColorOpacity;
  const accentOpacity = paintOpacity.dialogueColorOpacity;
  const boxOpacity = paintOpacity.boxColorOpacity;
  const borderOpacity = scalePercent(skin.borderOpacity, Math.max(accentOpacity, boxOpacity));
  const rowRuleOpacity = scalePercent(skin.rowRuleOpacity, Math.max(accentOpacity, boxOpacity));
  const surfaceBoxMix = scalePercent(skin.surfaceBoxMix, boxOpacity);
  const surfaceDisplayMix = scalePercent(skin.surfaceDisplayMix, displayOpacity);
  const panelBoxMix = scalePercent(skin.panelBoxMix, boxOpacity);
  const panelDisplayMix = scalePercent(skin.panelDisplayMix, displayOpacity);
  const accentPanelMix = scalePercent(skin.accentPanelMix, accentOpacity);
  const statTrackAccentMix = scalePercent(skin.statTrackAccentMix, accentOpacity);
  const statTrackBoxMix = scalePercent(skin.statTrackBoxMix, boxOpacity);
  const displaySolid =
    getPaintSolidFallback(colors.nameColor) ??
    getPaintSolidFallback(colors.dialogueColor) ??
    getPaintSolidFallback(colors.boxColor) ??
    "var(--primary)";
  const accent = getPaintSolidFallback(colors.dialogueColor) ?? displaySolid;
  const box = getPaintSolidFallback(colors.boxColor) ?? displaySolid;
  const displayLayer =
    getOpacityPaintLayer(colors.nameColor, displayOpacity) ?? getBackgroundPaintLayer(displaySolid, displayOpacity);
  const accentLayer =
    getOpacityPaintLayer(colors.dialogueColor, accentOpacity) ?? getBackgroundPaintLayer(accent, accentOpacity);
  const boxLayer = getOpacityPaintLayer(colors.boxColor, boxOpacity) ?? getBackgroundPaintLayer(box, boxOpacity);
  const displayGradientLayer = getGradientPaintLayer(colors.nameColor, displayOpacity);
  const accentGradientLayer = getGradientPaintLayer(colors.dialogueColor, accentOpacity);
  const boxGradientLayer = getGradientPaintLayer(colors.boxColor, boxOpacity);
  const framePaintLayers = [boxGradientLayer, displayGradientLayer, accentGradientLayer];
  const mutedPanelPaintLayers = [boxGradientLayer, displayGradientLayer];
  const panelPaintLayers = [accentGradientLayer, boxGradientLayer, displayGradientLayer];
  const panelStrongPaintLayers = [displayGradientLayer, accentGradientLayer, boxGradientLayer];
  const statTrackPaintLayers = [boxGradientLayer, displayGradientLayer, accentGradientLayer];
  const surfacePaintLayers = [boxGradientLayer, displayGradientLayer, accentGradientLayer];
  const slotPaintLayers = [boxGradientLayer, displayGradientLayer];
  const slotTopBoxMix = scalePercent(skin.slotBoxTopMix, boxOpacity);
  const slotBottomBoxMix = scalePercent(skin.slotBoxBottomMix, boxOpacity);
  const slotTopLiftMix = Math.round(skin.slotBackgroundTopMix * 0.08);
  const slotBottomLiftMix = Math.round(skin.slotBackgroundBottomMix * 0.05);
  const slotTopBase = `color-mix(in srgb, var(--background) ${100 - slotTopBoxMix}%, ${box} ${slotTopBoxMix}%)`;
  const slotBottomBase = `color-mix(in srgb, var(--background) ${100 - slotBottomBoxMix}%, ${box} ${slotBottomBoxMix}%)`;
  const portraitStage = getTrackerCardPortraitStageVars({
    background: portraitStageBackground,
    displaySolid,
    accent,
    box,
    opacity: paintOpacity,
  });
  const ambienceBoxMix = scalePercent(Math.min(34, Math.round(skin.surfaceBoxMix * 0.95)), boxOpacity);
  const ambienceDisplayMix = scalePercent(Math.min(30, Math.round(skin.surfaceDisplayMix * 0.9)), displayOpacity);
  const ambienceRadialMix = scalePercent(Math.min(28, Math.round(skin.surfaceDisplayMix * 0.8)), displayOpacity);
  const mutedBoxMix = Math.round(panelBoxMix * 0.55);
  const mutedDisplayMix = Math.round(panelDisplayMix * 0.45);

  return {
    "--tracker-preview-accent": accent,
    "--tracker-preview-accent-layer": accentLayer,
    "--tracker-preview-box": box,
    "--tracker-preview-box-layer": boxLayer,
    "--tracker-preview-dialogue-glow": `color-mix(in srgb, ${accent} ${scalePercent(skin.glowMix, accentOpacity)}%, transparent)`,
    "--tracker-preview-display-layer": displayLayer,
    "--tracker-preview-display-opacity": scaleOpacity(skin.displayOpacity, displayOpacity),
    "--tracker-preview-display-solid": displaySolid,
    "--tracker-preview-frame": getPaintedBackground(
      `linear-gradient(135deg, ` +
        `color-mix(in srgb, var(--card) ${100 - surfaceBoxMix}%, ${box} ${surfaceBoxMix}%), ` +
        `color-mix(in srgb, var(--background) ${100 - surfaceDisplayMix}%, ${displaySolid} ${surfaceDisplayMix}%))`,
      framePaintLayers,
    ),
    "--tracker-preview-frame-blend": getBackgroundBlendMode(framePaintLayers),
    "--tracker-preview-muted-panel": getPaintedBackground(
      `linear-gradient(135deg, ` +
        `color-mix(in srgb, var(--background) ${100 - mutedBoxMix}%, ${box} ${mutedBoxMix}%), ` +
        `color-mix(in srgb, var(--card) ${100 - mutedDisplayMix}%, ${displaySolid} ${mutedDisplayMix}%))`,
      mutedPanelPaintLayers,
    ),
    "--tracker-preview-muted-panel-blend": getBackgroundBlendMode(mutedPanelPaintLayers),
    "--tracker-preview-panel": getPaintedBackground(
      `linear-gradient(135deg, ` +
        `color-mix(in srgb, var(--background) ${100 - panelBoxMix}%, ${box} ${panelBoxMix}%), ` +
        `color-mix(in srgb, var(--card) ${100 - panelDisplayMix}%, ${displaySolid} ${panelDisplayMix}%))`,
      panelPaintLayers,
    ),
    "--tracker-preview-panel-blend": getBackgroundBlendMode(panelPaintLayers, "overlay"),
    "--tracker-preview-panel-strong": getPaintedBackground(
      `linear-gradient(135deg, ` +
        `color-mix(in srgb, color-mix(in srgb, var(--background) ${100 - panelBoxMix}%, ${box} ${panelBoxMix}%) ${100 - accentPanelMix}%, ${accent} ${accentPanelMix}%), ` +
        `color-mix(in srgb, var(--card) ${100 - panelDisplayMix}%, ${displaySolid} ${panelDisplayMix}%))`,
      panelStrongPaintLayers,
    ),
    "--tracker-preview-panel-strong-blend": getBackgroundBlendMode(panelStrongPaintLayers, "overlay"),
    "--tracker-preview-portrait-base": portraitStage.base,
    "--tracker-preview-portrait-bottom-glow-opacity": portraitStage.bottomGlowOpacity,
    "--tracker-preview-portrait-bottom-rule-opacity": portraitStage.bottomRuleOpacity,
    "--tracker-preview-portrait-media-blur": portraitStage.mediaBlur,
    "--tracker-preview-portrait-media-opacity": portraitStage.mediaOpacity,
    "--tracker-preview-portrait-media-saturate": portraitStage.mediaSaturate,
    "--tracker-preview-portrait-light": portraitStage.light,
    "--tracker-preview-portrait-light-opacity": portraitStage.lightOpacity,
    "--tracker-preview-portrait-rim": portraitStage.rim,
    "--tracker-preview-portrait-rim-opacity": portraitStage.rimOpacity,
    "--tracker-preview-portrait-side-mask-opacity": portraitStage.sideMaskOpacity,
    "--tracker-preview-portrait-veil": portraitStage.veil,
    "--tracker-preview-rule": `color-mix(in srgb, color-mix(in srgb, ${box} 58%, ${accent} 42%) ${borderOpacity}%, transparent)`,
    "--tracker-preview-surface": getPaintedBackground(
      `linear-gradient(135deg, ` +
        `color-mix(in srgb, var(--card) ${100 - surfaceDisplayMix}%, ${displaySolid} ${surfaceDisplayMix}%), ` +
        `color-mix(in srgb, var(--background) ${100 - surfaceBoxMix}%, ${box} ${surfaceBoxMix}%))`,
      surfacePaintLayers,
    ),
    "--tracker-preview-surface-blend": getBackgroundBlendMode(surfacePaintLayers),
    "--tracker-preview-slot-rule": `color-mix(in srgb, color-mix(in srgb, ${box} 50%, var(--foreground) 50%) ${skin.slotRuleOpacity}%, transparent)`,
    "--tracker-preview-slot-shadow": `rgba(0, 0, 0, ${skin.slotShadowOpacity})`,
    "--tracker-preview-slot-surface": getPaintedBackground(
      `linear-gradient(180deg, ` +
        `color-mix(in srgb, ${slotTopBase} ${100 - slotTopLiftMix}%, var(--foreground) ${slotTopLiftMix}%), ` +
        `color-mix(in srgb, ${slotBottomBase} ${100 - slotBottomLiftMix}%, var(--foreground) ${slotBottomLiftMix}%))`,
      slotPaintLayers,
    ),
    "--tracker-preview-slot-surface-blend": getBackgroundBlendMode(slotPaintLayers, "soft-light"),
    "--tracker-preview-tint-opacity": scaleOpacity(skin.tintOpacity, boxOpacity),
    "--tracker-preview-glow-opacity": scaleOpacity(skin.displayOpacity, displayOpacity),
    "--tracker-preview-contrast-top": `${skin.strongContrastTop}%`,
    "--tracker-preview-contrast-mid": `${skin.strongContrastMid}%`,
    "--tracker-preview-contrast-bottom": `${skin.strongContrastBottom}%`,
    "--tracker-preview-muted-text": `color-mix(in srgb, var(--foreground) ${skin.mutedTextMix}%, var(--muted-foreground) ${100 - skin.mutedTextMix}%)`,
    "--tracker-preview-number-text": `color-mix(in srgb, var(--foreground) ${skin.numberTextMix}%, var(--muted-foreground) ${100 - skin.numberTextMix}%)`,
    "--tracker-preview-row-rule": `color-mix(in srgb, color-mix(in srgb, ${box} 54%, ${accent} 46%) ${rowRuleOpacity}%, transparent)`,
    "--tracker-preview-stat-fill-glow": `color-mix(in srgb, color-mix(in srgb, ${accent} 42%, var(--foreground) 58%) ${scalePercent(skin.statFillGlowMix, accentOpacity)}%, transparent)`,
    "--tracker-preview-stat-fill-highlight": `color-mix(in srgb, var(--foreground) ${skin.statFillHighlightMix}%, transparent)`,
    "--tracker-preview-stat-track": getPaintedBackground(
      `linear-gradient(90deg, ` +
        `color-mix(in srgb, color-mix(in srgb, var(--background) ${skin.statTrackBackgroundMix}%, ${box} ${100 - skin.statTrackBackgroundMix}%) ${100 - statTrackBoxMix}%, ${box} ${statTrackBoxMix}%), ` +
        `color-mix(in srgb, color-mix(in srgb, var(--secondary) ${skin.statTrackBackgroundMix}%, ${displaySolid} ${100 - skin.statTrackBackgroundMix}%) ${100 - statTrackAccentMix}%, ${accent} ${statTrackAccentMix}%))`,
      statTrackPaintLayers,
    ),
    "--tracker-preview-stat-track-blend": getBackgroundBlendMode(statTrackPaintLayers, "overlay"),
    "--tracker-preview-stat-track-ring": `color-mix(in srgb, color-mix(in srgb, ${accent} 52%, var(--foreground) 48%) ${scalePercent(skin.statTrackRingOpacity, accentOpacity)}%, transparent)`,
    "--tracker-preview-stat-track-shadow": `rgba(0, 0, 0, ${skin.statTrackShadowOpacity})`,
    "--tracker-preview-text": `color-mix(in srgb, var(--foreground) ${skin.textMix}%, var(--muted-foreground) ${100 - skin.textMix}%)`,
    background: getPaintedBackground(
      `radial-gradient(circle at 78% 18%, color-mix(in srgb, ${displaySolid} ${ambienceRadialMix}%, transparent) 0%, transparent 54%), ` +
        `linear-gradient(135deg, color-mix(in srgb, var(--card) ${100 - ambienceBoxMix}%, ${box} ${ambienceBoxMix}%), ` +
        `color-mix(in srgb, var(--background) ${100 - ambienceDisplayMix}%, ${displaySolid} ${ambienceDisplayMix}%))`,
      framePaintLayers,
    ),
    backgroundBlendMode: getBackgroundBlendMode(framePaintLayers),
  };
}

function getPreviewInitial(name: string, fallback: string) {
  return (name.trim() || fallback).slice(0, 1).toUpperCase();
}

function getEffectiveColors(
  mode: TrackerCardColorMode,
  config: TrackerCardColorConfig,
  chatColors: TrackerCardColorControlsProps["chatColors"],
) {
  if (mode === "custom") return config;
  if (mode === "chat") return chatColors;
  return {};
}

export function TrackerCardColorControls({
  value,
  onChange,
  chatColors,
  entityLabel,
  previewName,
}: TrackerCardColorControlsProps) {
  const config = typeof value === "string" ? parseTrackerCardColorConfig(value) : cleanTrackerCardColorConfig(value);
  const mode = normalizeTrackerCardColorMode(config.mode);
  const finish = getTrackerCardFinish(config, mode);
  const paintOpacity = getTrackerCardPaintOpacity(config);
  const portraitStageBackground = getTrackerCardPortraitStageBackground(config);
  const effectiveColors = getEffectiveColors(mode, config, chatColors);
  const previewStyle = getTrackerPreviewStyle(effectiveColors, finish, paintOpacity, portraitStageBackground);
  const [collapsed, setCollapsed] = useState(false);
  const modeLabel = MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? "Chat colors";
  const portraitStageBackgroundLabel =
    PORTRAIT_STAGE_BACKGROUND_OPTIONS.find((option) => option.value === portraitStageBackground)?.label ?? "Ambient";
  const previewInitial = getPreviewInitial(previewName, entityLabel === "Persona" ? "Y" : "C");
  const previewContrastStyle = {
    background:
      "linear-gradient(180deg,color-mix(in srgb,var(--background) var(--tracker-preview-contrast-top),transparent) 0%,color-mix(in srgb,var(--card) var(--tracker-preview-contrast-mid),transparent) 58%,color-mix(in srgb,var(--background) var(--tracker-preview-contrast-bottom),transparent) 100%)",
  };

  const updateMode = (nextMode: TrackerCardColorMode) => {
    onChange(
      cleanTrackerCardColorConfig({
        ...config,
        mode: nextMode,
        ...(nextMode === "custom" && {
          nameColor: config.nameColor || chatColors.nameColor || "",
          dialogueColor: config.dialogueColor || chatColors.dialogueColor || "",
          boxColor: config.boxColor || chatColors.boxColor || "",
        }),
      }),
    );
  };

  const updateCustomColor = (key: "nameColor" | "dialogueColor" | "boxColor", color: string) => {
    onChange(cleanTrackerCardColorConfig({ ...config, mode: "custom", [key]: color }));
  };

  const updateFinish = (key: "tintIntensity" | "glowIntensity" | "contrastIntensity", nextValue: number) => {
    onChange(cleanTrackerCardColorConfig({ ...config, [key]: nextValue }));
  };

  const updateFinishPreset = (nextFinish: TrackerCardFinish) => {
    onChange(cleanTrackerCardColorConfig({ ...config, ...nextFinish }));
  };

  const updatePaintOpacity = (key: keyof TrackerCardPaintOpacity, nextValue: number) => {
    onChange(cleanTrackerCardColorConfig({ ...config, [key]: nextValue }));
  };

  const updatePortraitStageBackground = (nextBackground: TrackerCardPortraitStageBackground) => {
    onChange(cleanTrackerCardColorConfig({ ...config, portraitStageBackground: nextBackground }));
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <button
        type="button"
        onClick={() => setCollapsed((open) => !open)}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand tracker card colors" : "Collapse tracker card colors"}
        className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg text-left transition-colors hover:bg-[var(--accent)]/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]/60"
      >
        <div className="min-w-0 px-1 py-0.5">
          <h4 className="text-xs font-semibold text-[var(--foreground)]">{entityLabel} Tracker Card</h4>
          <p className="mt-0.5 text-[0.625rem] text-[var(--muted-foreground)]">
            {modeLabel} source, {portraitStageBackgroundLabel.toLowerCase()} stage.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 px-1" aria-hidden="true">
          <span
            className="h-5 w-5 rounded-md ring-1 ring-[var(--border)]"
            style={getDisplayStyle(effectiveColors.nameColor)}
          />
          <span
            className="h-5 w-5 rounded-md ring-1 ring-[var(--border)]"
            style={getDisplayStyle(effectiveColors.dialogueColor)}
          />
          <span
            className="h-5 w-5 rounded-md ring-1 ring-[var(--border)]"
            style={getDisplayStyle(effectiveColors.boxColor)}
          />
          <ChevronDown
            size="0.875rem"
            className={cn(
              "ml-0.5 text-[var(--muted-foreground)] transition-transform duration-150",
              collapsed && "-rotate-90",
            )}
          />
        </div>
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-[var(--secondary)] p-1">
            {MODE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = option.mode === mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  onClick={() => updateMode(option.mode)}
                  className={cn(
                    "flex min-h-8 items-center justify-center gap-1 rounded-md px-1.5 text-[0.625rem] font-medium transition-all",
                    selected
                      ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm ring-1 ring-[var(--border)]"
                      : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/55 hover:text-[var(--foreground)]",
                  )}
                >
                  {selected ? <Check size="0.6875rem" /> : <Icon size="0.6875rem" />}
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>

          <div className="@container mx-auto w-full max-w-[32rem]">
            <div
              className="relative min-w-0 overflow-hidden rounded-md border border-[var(--tracker-preview-rule)] bg-[image:var(--tracker-preview-frame)] p-0 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_8%,transparent)] [background-blend-mode:var(--tracker-preview-frame-blend)]"
              style={previewStyle}
            >
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--foreground)_4%,transparent),transparent_46%,color-mix(in_srgb,var(--tracker-preview-accent)_6%,transparent))]" />
              <div
                className="pointer-events-none absolute inset-0 bg-[image:var(--tracker-preview-display-layer)]"
                style={{ opacity: "var(--tracker-preview-display-opacity)" }}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[image:var(--tracker-preview-display-layer)] opacity-45" />

              <div className="relative z-[1] overflow-hidden rounded-md border border-[var(--tracker-preview-rule)] bg-[image:var(--tracker-preview-surface)] [background-blend-mode:var(--tracker-preview-surface-blend)]">
                <div className="pointer-events-none absolute inset-0" style={previewContrastStyle} />
                <div className="relative z-[1] grid grid-cols-[minmax(0,1fr)_clamp(5.75rem,42cqw,7.35rem)] @min-[380px]:grid-cols-[minmax(0,1fr)_9rem]">
                  <div className="min-w-0 border-r border-[var(--tracker-preview-rule)]">
                    <div className="relative flex min-h-5 items-center justify-center overflow-hidden border-b border-[var(--tracker-preview-rule)] bg-[image:var(--tracker-preview-panel-strong)] px-1.5 py-0 [background-blend-mode:var(--tracker-preview-panel-strong-blend)]">
                      <span
                        className="pointer-events-none absolute inset-0 bg-[image:var(--tracker-preview-display-layer)]"
                        style={{ opacity: "var(--tracker-preview-display-opacity)" }}
                      />
                      <span className="relative z-[1] block truncate text-[0.75rem] font-semibold leading-5 text-[color:var(--tracker-preview-text)]">
                        {previewName || entityLabel}
                      </span>
                      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[image:var(--tracker-preview-accent-layer)] opacity-80" />
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[image:var(--tracker-preview-accent-layer)] opacity-35" />
                    </div>
                    <div className="space-y-1 px-1 py-1">
                      {TRACKER_CARD_PREVIEW_STATS.map((stat) => (
                        <div
                          key={stat.label}
                          className="grid gap-0.5 border-b border-[var(--tracker-preview-row-rule)] pb-0.5 last:border-b-0 last:pb-0"
                        >
                          <div className="flex items-center justify-between gap-2 text-[0.625rem] leading-none">
                            <span className="truncate text-[color:var(--tracker-preview-text)]">{stat.label}</span>
                            <span className="font-mono text-[color:var(--tracker-preview-number-text)]">
                              {stat.value} / 100
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-[image:var(--tracker-preview-stat-track)] shadow-[inset_0_1px_2px_var(--tracker-preview-stat-track-shadow)] ring-1 ring-[var(--tracker-preview-stat-track-ring)] [background-blend-mode:var(--tracker-preview-stat-track-blend)]">
                            <div
                              className="h-full rounded-full shadow-[inset_0_1px_0_var(--tracker-preview-stat-fill-highlight),0_0_6px_var(--tracker-preview-stat-fill-glow)]"
                              style={{ width: stat.width, backgroundColor: stat.color }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="relative flex min-w-0 flex-col overflow-hidden rounded-b-md bg-[image:var(--tracker-preview-surface)] ring-1 ring-[var(--tracker-preview-rule)] shadow-[0_0_10px_var(--tracker-preview-dialogue-glow),inset_0_-16px_24px_color-mix(in_srgb,var(--background)_58%,transparent)] [background-blend-mode:var(--tracker-preview-surface-blend)]">
                    <div className="relative flex h-5 shrink-0 items-center gap-1 overflow-hidden border-b border-[var(--tracker-preview-rule)] bg-[image:var(--tracker-preview-panel)] px-1 [background-blend-mode:var(--tracker-preview-panel-blend)]">
                      <span
                        className="pointer-events-none absolute inset-0 bg-[image:var(--tracker-preview-display-layer)]"
                        style={{ opacity: "var(--tracker-preview-display-opacity)" }}
                      />
                      <span
                        className="relative z-[1] h-1.5 w-1.5 rounded-full bg-[image:var(--tracker-preview-accent-layer)]"
                        style={{
                          boxShadow: "0 0 6px color-mix(in srgb,var(--tracker-preview-accent) 42%,transparent)",
                        }}
                      />
                      <span className="relative z-[1] min-w-0 truncate text-[0.5625rem] font-semibold leading-5 text-[color-mix(in_srgb,var(--foreground)_82%,var(--tracker-preview-accent)_18%)]">
                        Tracking
                      </span>
                    </div>
                    <div className="relative flex min-h-[8.75rem] flex-1 items-center justify-center overflow-hidden">
                      <div className="absolute inset-0 bg-[image:var(--tracker-preview-portrait-base)]" />
                      <div
                        className="absolute inset-0 bg-[image:var(--tracker-preview-box-layer)]"
                        style={{ opacity: "var(--tracker-preview-tint-opacity)" }}
                      />
                      <div
                        className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[image:var(--tracker-preview-display-layer)]"
                        style={{
                          filter:
                            "blur(var(--tracker-preview-portrait-media-blur)) saturate(var(--tracker-preview-portrait-media-saturate))",
                          opacity: "var(--tracker-preview-portrait-media-opacity)",
                        }}
                      />
                      <div
                        className="absolute inset-0 bg-[image:var(--tracker-preview-portrait-light)]"
                        style={{ opacity: "var(--tracker-preview-portrait-light-opacity)" }}
                      />
                      <div className="absolute inset-0 bg-[image:var(--tracker-preview-portrait-veil)]" />
                      <div
                        className="absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--background)_60%,transparent),transparent)]"
                        style={{ opacity: "var(--tracker-preview-portrait-side-mask-opacity)" }}
                      />
                      <div
                        className="absolute inset-y-0 right-0 w-1/3 bg-[linear-gradient(270deg,color-mix(in_srgb,var(--background)_60%,transparent),transparent)]"
                        style={{ opacity: "var(--tracker-preview-portrait-side-mask-opacity)" }}
                      />
                      <div
                        className="absolute inset-x-2 bottom-0 h-1/2 bg-[linear-gradient(0deg,color-mix(in_srgb,var(--tracker-preview-accent)_16%,transparent),transparent_72%)]"
                        style={{ opacity: "var(--tracker-preview-portrait-bottom-glow-opacity)" }}
                      />
                      <div
                        className="absolute inset-0 bg-[image:var(--tracker-preview-portrait-rim)]"
                        style={{ opacity: "var(--tracker-preview-portrait-rim-opacity)" }}
                      />
                      <div
                        className="absolute inset-x-3 bottom-2 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--tracker-preview-accent)_48%,transparent),transparent)]"
                        style={{ opacity: "var(--tracker-preview-portrait-bottom-rule-opacity)" }}
                      />
                      <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[var(--tracker-preview-rule)] bg-[color-mix(in_srgb,var(--background)_72%,transparent)] text-lg font-semibold leading-none text-[var(--tracker-preview-display-solid)] shadow-[0_0_10px_var(--tracker-preview-dialogue-glow)]">
                        {previewInitial}
                      </span>
                    </div>
                  </div>

                  <div className="col-span-2 border-t border-[var(--tracker-preview-rule)] px-1 pb-1 pt-0.5">
                    <div className="relative flex h-5 items-center gap-1 overflow-hidden bg-[image:var(--tracker-preview-panel)] px-0.5 text-[0.6875rem] leading-[0.875rem] [background-blend-mode:var(--tracker-preview-panel-blend)]">
                      <span
                        className="pointer-events-none absolute inset-0 bg-[image:var(--tracker-preview-display-layer)] [mask-image:linear-gradient(90deg,transparent_0%,black_13%,black_87%,transparent_100%)]"
                        style={{ opacity: "var(--tracker-preview-display-opacity)" }}
                      />
                      <Package
                        size="0.75rem"
                        className="relative z-[1] shrink-0 text-[var(--tracker-preview-accent)]/78"
                      />
                      <span className="relative z-[1] min-w-0 flex-1 truncate font-medium text-[color-mix(in_srgb,var(--tracker-preview-text)_78%,var(--tracker-preview-accent)_22%)]">
                        Inventory
                      </span>
                    </div>
                    <div className="relative mt-px grid min-h-4 grid-cols-[minmax(0,1fr)_max-content] items-center gap-0.5 rounded-[2px] border border-[var(--tracker-preview-slot-rule)] bg-[image:var(--tracker-preview-slot-surface)] px-1 py-px text-[0.625rem] leading-4 shadow-[inset_0_1px_2px_var(--tracker-preview-slot-shadow)] [background-blend-mode:var(--tracker-preview-slot-surface-blend)]">
                      <span className="truncate text-[color:var(--tracker-preview-text)]">None</span>
                      <span className="font-mono text-[color:var(--tracker-preview-number-text)]">1</span>
                    </div>
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-[var(--tracker-preview-rule)] shadow-[0_0_10px_var(--tracker-preview-dialogue-glow)]" />
              </div>
            </div>
          </div>

          <div className="grid gap-2 rounded-lg bg-[var(--secondary)]/70 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.625rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Portrait stage BG
              </span>
              <span className="text-[0.625rem] text-[var(--muted-foreground)]">{portraitStageBackgroundLabel}</span>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-md bg-[var(--background)]/35 p-0.5 sm:grid-cols-4">
              {PORTRAIT_STAGE_BACKGROUND_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = option.value === portraitStageBackground;

                return (
                  <button
                    key={option.value}
                    type="button"
                    title={option.title}
                    onClick={() => updatePortraitStageBackground(option.value)}
                    className={cn(
                      "flex min-h-6 min-w-0 items-center justify-center gap-1 rounded-sm px-1 text-[0.5625rem] font-semibold transition-colors",
                      selected
                        ? "bg-[var(--primary)]/12 text-[var(--primary)] ring-1 ring-[var(--primary)]/24"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/45 hover:text-[var(--foreground)]",
                    )}
                  >
                    {selected ? <Check size="0.625rem" /> : <Icon size="0.625rem" />}
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2 rounded-lg bg-[var(--secondary)]/70 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.625rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Card finish
              </span>
              <span className="text-[0.625rem] text-[var(--muted-foreground)]">
                {finish.tintIntensity}/{finish.glowIntensity}/{finish.contrastIntensity}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-md bg-[var(--background)]/35 p-0.5">
              {FINISH_PRESETS.map((preset) => {
                const selected =
                  finish.tintIntensity === preset.finish.tintIntensity &&
                  finish.glowIntensity === preset.finish.glowIntensity &&
                  finish.contrastIntensity === preset.finish.contrastIntensity;

                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => updateFinishPreset(preset.finish)}
                    className={cn(
                      "min-h-6 rounded-sm px-1 text-[0.5625rem] font-semibold transition-colors",
                      selected
                        ? "bg-[var(--primary)]/12 text-[var(--primary)] ring-1 ring-[var(--primary)]/24"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/45 hover:text-[var(--foreground)]",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {FINISH_OPTIONS.map((option) => {
                const value = finish[option.key];
                return (
                  <label key={option.key} className="min-w-0 space-y-1">
                    <span className="flex items-center justify-between gap-2 text-[0.625rem] text-[var(--muted-foreground)]">
                      <span>{option.label}</span>
                      <span className="font-mono tabular-nums">{value}%</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={value}
                      onChange={(event) => updateFinish(option.key, Number(event.target.value))}
                      className="h-1.5 w-full cursor-pointer accent-[var(--primary)]"
                    />
                  </label>
                );
              })}
            </div>
          </div>

          {mode !== "default" && (
            <div className="grid gap-2 rounded-lg bg-[var(--secondary)]/70 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.625rem] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  Color opacity
                </span>
                <span className="text-[0.625rem] text-[var(--muted-foreground)]">
                  {paintOpacity.nameColorOpacity}/{paintOpacity.dialogueColorOpacity}/{paintOpacity.boxColorOpacity}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {PAINT_OPACITY_OPTIONS.map((option) => {
                  const value = paintOpacity[option.key];
                  return (
                    <label key={option.key} className="min-w-0 space-y-1">
                      <span className="flex items-center justify-between gap-2 text-[0.625rem] text-[var(--muted-foreground)]">
                        <span>{option.label}</span>
                        <span className="font-mono tabular-nums">{value}%</span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={value}
                        onChange={(event) => updatePaintOpacity(option.key, Number(event.target.value))}
                        className="h-1.5 w-full cursor-pointer accent-[var(--primary)]"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {mode === "custom" && (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <ColorPicker
                  value={config.nameColor ?? ""}
                  onChange={(color) => updateCustomColor("nameColor", color)}
                  gradient
                  label="Display"
                />
                <ColorPicker
                  value={config.dialogueColor ?? ""}
                  onChange={(color) => updateCustomColor("dialogueColor", color)}
                  gradient
                  label="Accent"
                />
                <ColorPicker
                  value={config.boxColor ?? ""}
                  onChange={(color) => updateCustomColor("boxColor", color)}
                  gradient
                  label="Surface"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
