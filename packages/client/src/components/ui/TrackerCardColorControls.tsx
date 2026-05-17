import { useState } from "react";
import { Check, ChevronDown, Circle, Image, Layers, MessageSquareText, Palette, Sparkles, Square } from "lucide-react";
import type {
  TrackerCardColorConfig,
  TrackerCardColorMode,
  TrackerCardPortraitStageBackground,
} from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import {
  cleanTrackerCardColorConfig,
  getTrackerCardFinish,
  getTrackerCardPaintEnabled,
  getTrackerCardPaintOpacity,
  getTrackerCardPortraitStageBackground,
  normalizeTrackerCardColorMode,
  parseTrackerCardColorConfig,
  type TrackerCardFinish,
  type TrackerCardPaintColors,
  type TrackerCardPaintEnabled,
  type TrackerCardPaintOpacity,
} from "../../lib/tracker-card-colors";
import { ColorPicker } from "./ColorPicker";

export type TrackerCardColorEntityLabel = "Character" | "Persona";

interface TrackerCardColorControlsProps {
  value: TrackerCardColorConfig | string | null | undefined;
  onChange: (value: TrackerCardColorConfig) => void;
  chatColors: TrackerCardPaintColors;
  entityLabel: TrackerCardColorEntityLabel;
  disabled?: boolean;
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
  key: "materialBrightness" | "glowIntensity" | "contrastIntensity";
  label: string;
  title: string;
}> = [
  {
    key: "materialBrightness",
    label: "Material",
    title: "Brightness of neutral and Surface card material",
  },
  { key: "glowIntensity", label: "Glow", title: "Light from edges, portrait, stats, and nameplate" },
  { key: "contrastIntensity", label: "Contrast", title: "Text readability and neutral panel separation" },
];

const FINISH_PRESETS: Array<{
  label: string;
  title: string;
  finish: TrackerCardFinish;
}> = [
  {
    label: "Soft",
    title: "Brighter material with gentle glow and mild separation",
    finish: { tintIntensity: 100, materialBrightness: 54, glowIntensity: 24, contrastIntensity: 58 },
  },
  {
    label: "Crisp",
    title: "Neutral material with clearer edges and medium glow",
    finish: { tintIntensity: 100, materialBrightness: 50, glowIntensity: 46, contrastIntensity: 64 },
  },
  {
    label: "Vivid",
    title: "Darker material with strong glow and high contrast",
    finish: { tintIntensity: 100, materialBrightness: 44, glowIntensity: 82, contrastIntensity: 86 },
  },
];

const PAINT_OPACITY_OPTIONS: Array<{
  key: keyof TrackerCardPaintOpacity;
  enabledKey: keyof TrackerCardPaintEnabled;
  colorKey: "nameColor" | "dialogueColor" | "boxColor";
  emptyText: string;
  label: string;
  title: string;
}> = [
  {
    key: "nameColorOpacity",
    enabledKey: "displayEnabled",
    colorKey: "nameColor",
    emptyText: "No display color set",
    label: "Display",
    title: "Names, readable field tint, and identity emphasis",
  },
  {
    key: "dialogueColorOpacity",
    enabledKey: "accentEnabled",
    colorKey: "dialogueColor",
    emptyText: "No accent color set",
    label: "Accent",
    title: "Borders, icons, highlights, buttons, and glow",
  },
  {
    key: "boxColorOpacity",
    enabledKey: "surfaceEnabled",
    colorKey: "boxColor",
    emptyText: "No surface color — neutral card",
    label: "Surface",
    title: "Card body, panels, shelves, and field material",
  },
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

function getDisplayStyle(value: string | null | undefined) {
  if (!value) {
    return {
      backgroundImage: "repeating-conic-gradient(var(--border) 0% 25%, transparent 0% 50%)",
      backgroundSize: "0.5rem 0.5rem",
    };
  }

  return value.includes("gradient(") ? { background: value } : { backgroundColor: value };
}

function getEffectiveColors(
  mode: TrackerCardColorMode,
  config: TrackerCardColorConfig,
  chatColors: TrackerCardPaintColors,
): TrackerCardPaintColors {
  if (mode === "custom") return config;
  if (mode === "chat") return chatColors;
  return {};
}

function hasPaintForChannel(colors: TrackerCardPaintColors, colorKey: "nameColor" | "dialogueColor" | "boxColor") {
  const hasDisplayPaint = !!colors.nameColor?.trim();
  const hasAccentPaint = !!colors.dialogueColor?.trim();
  const hasSurfacePaint = !!colors.boxColor?.trim();

  if (colorKey === "boxColor") return hasSurfacePaint;
  if (colorKey === "nameColor") return hasDisplayPaint || hasAccentPaint;
  return hasAccentPaint || hasDisplayPaint;
}

function getPaintOpacitySummary(opacity: TrackerCardPaintOpacity, enabled: TrackerCardPaintEnabled) {
  return [
    enabled.displayEnabled ? opacity.nameColorOpacity : "off",
    enabled.accentEnabled ? opacity.dialogueColorOpacity : "off",
    enabled.surfaceEnabled ? opacity.boxColorOpacity : "off",
  ].join("/");
}

function getChannelValueLabel(enabled: boolean, hasPaint: boolean, value: number) {
  if (!enabled) return "off";
  return hasPaint ? `${value}%` : "none";
}

function ChannelToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full bg-[var(--background)] p-0.5 ring-1 ring-[var(--border)] transition-colors",
        checked && "bg-[var(--primary)]/22 ring-[var(--primary)]/40",
        disabled && "cursor-not-allowed opacity-55",
      )}
      title={`${checked ? "Disable" : "Enable"} ${label}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={`${label} channel`}
        className="peer sr-only"
      />
      <span className="h-3 w-3 rounded-full bg-[var(--muted-foreground)] transition-transform peer-checked:translate-x-3 peer-checked:bg-[var(--primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--primary)]/60 peer-disabled:cursor-not-allowed" />
    </label>
  );
}

export function TrackerCardColorControls({
  value,
  onChange,
  chatColors,
  entityLabel,
  disabled = false,
}: TrackerCardColorControlsProps) {
  const config = typeof value === "string" ? parseTrackerCardColorConfig(value) : cleanTrackerCardColorConfig(value);
  const mode = normalizeTrackerCardColorMode(config.mode);
  const finish = getTrackerCardFinish(config, mode);
  const paintEnabled = getTrackerCardPaintEnabled(config);
  const paintOpacity = getTrackerCardPaintOpacity(config);
  const portraitStageBackground = getTrackerCardPortraitStageBackground(config);
  const effectiveColors = getEffectiveColors(mode, config, chatColors);
  const [collapsed, setCollapsed] = useState(false);
  const modeLabel = MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? "Chat colors";
  const portraitStageBackgroundLabel =
    PORTRAIT_STAGE_BACKGROUND_OPTIONS.find((option) => option.value === portraitStageBackground)?.label ?? "Ambient";
  const finishSummary = `${finish.materialBrightness}/${finish.glowIntensity}/${finish.contrastIntensity}`;
  const paintOpacitySummary = getPaintOpacitySummary(paintOpacity, paintEnabled);

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

  const updateFinish = (key: "materialBrightness" | "glowIntensity" | "contrastIntensity", nextValue: number) => {
    onChange(cleanTrackerCardColorConfig({ ...config, [key]: nextValue }));
  };

  const updateFinishPreset = (nextFinish: TrackerCardFinish) => {
    onChange(cleanTrackerCardColorConfig({ ...config, ...nextFinish }));
  };

  const updatePaintOpacity = (key: keyof TrackerCardPaintOpacity, nextValue: number) => {
    onChange(cleanTrackerCardColorConfig({ ...config, [key]: nextValue }));
  };

  const updatePaintEnabled = (key: keyof TrackerCardPaintEnabled, enabled: boolean) => {
    onChange(cleanTrackerCardColorConfig({ ...config, [key]: enabled }));
  };

  const updatePortraitStageBackground = (nextBackground: TrackerCardPortraitStageBackground) => {
    onChange(cleanTrackerCardColorConfig({ ...config, portraitStageBackground: nextBackground }));
  };

  return (
    <div className={cn("rounded-xl border border-[var(--border)] bg-[var(--card)] p-2.5", disabled && "opacity-75")}>
      <button
        type="button"
        onClick={() => setCollapsed((open) => !open)}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand tracker card colors" : "Collapse tracker card colors"}
        className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-[var(--accent)]/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]/60"
      >
        <h4 className="min-w-0 truncate text-xs font-semibold text-[var(--foreground)]">{entityLabel} card</h4>
        <div className="flex shrink-0 items-center gap-1.5" aria-hidden="true">
          <span
            className={cn("h-4 w-4 rounded ring-1 ring-[var(--border)]", !paintEnabled.displayEnabled && "opacity-35")}
            style={getDisplayStyle(effectiveColors.nameColor)}
          />
          <span
            className={cn("h-4 w-4 rounded ring-1 ring-[var(--border)]", !paintEnabled.accentEnabled && "opacity-35")}
            style={getDisplayStyle(effectiveColors.dialogueColor)}
          />
          <span
            className={cn("h-4 w-4 rounded ring-1 ring-[var(--border)]", !paintEnabled.surfaceEnabled && "opacity-35")}
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
        <p className="col-span-2 text-[0.625rem] text-[var(--muted-foreground)]">
          {modeLabel}, {portraitStageBackgroundLabel.toLowerCase()} stage, finish M/G/C {finishSummary}.
        </p>
      </button>

      {!collapsed && (
        <div className="mt-2 space-y-2">
          <div className="grid gap-1.5 rounded-lg bg-[var(--secondary)]/65 p-1.5 ring-1 ring-[var(--border)]/40">
            <div className="grid min-w-0 gap-1">
              <span className="px-0.5 text-[0.5625rem] font-semibold uppercase text-[var(--muted-foreground)]">
                Source
              </span>
              <div className="grid grid-cols-3 gap-0.5 rounded-md bg-[var(--background)]/35 p-0.5">
                {MODE_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = option.mode === mode;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      onClick={() => updateMode(option.mode)}
                      disabled={disabled}
                      className={cn(
                        "flex min-h-6 min-w-0 items-center justify-center gap-1 rounded-sm px-1 text-[0.5625rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55",
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

            <div className="grid min-w-0 gap-1">
              <span className="px-0.5 text-[0.5625rem] font-semibold uppercase text-[var(--muted-foreground)]">
                Stage
              </span>
              <div className="grid grid-cols-4 gap-0.5 rounded-md bg-[var(--background)]/35 p-0.5">
                {PORTRAIT_STAGE_BACKGROUND_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = option.value === portraitStageBackground;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      title={option.title}
                      onClick={() => updatePortraitStageBackground(option.value)}
                      disabled={disabled}
                      className={cn(
                        "flex min-h-6 min-w-0 items-center justify-center gap-1 rounded-sm px-1 text-[0.5625rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55",
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
          </div>

          <div className="grid gap-1.5 rounded-lg bg-[var(--secondary)]/65 p-1.5 ring-1 ring-[var(--border)]/40">
            <div className="grid min-w-0 gap-1">
              <span className="px-0.5 text-[0.5625rem] font-semibold uppercase text-[var(--muted-foreground)]">
                Finish
              </span>
              <div className="grid grid-cols-3 gap-0.5 rounded-md bg-[var(--background)]/35 p-0.5">
                {FINISH_PRESETS.map((preset) => {
                  const selected =
                    finish.materialBrightness === preset.finish.materialBrightness &&
                    finish.glowIntensity === preset.finish.glowIntensity &&
                    finish.contrastIntensity === preset.finish.contrastIntensity;

                  return (
                    <button
                      key={preset.label}
                      type="button"
                      title={preset.title}
                      onClick={() => updateFinishPreset(preset.finish)}
                      disabled={disabled}
                      className={cn(
                        "min-h-6 rounded-sm px-1 text-[0.5625rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55",
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
            </div>

            <div className="grid min-w-0 gap-1">
              {FINISH_OPTIONS.map((option) => {
                const value = finish[option.key];
                return (
                  <label
                    key={option.key}
                    className="grid min-w-0 grid-cols-[3.45rem_minmax(0,1fr)_2rem] items-center gap-1.5 rounded-md bg-[var(--background)]/24 px-1.5 py-1 ring-1 ring-[var(--border)]/25"
                    title={option.title}
                  >
                    <span className="truncate text-[0.5625rem] font-semibold text-[var(--foreground)]/80">
                      {option.label}
                    </span>
                    <input
                      type="range"
                      aria-label={`${option.label}: ${option.title}`}
                      title={option.title}
                      min={0}
                      max={100}
                      value={value}
                      onChange={(event) => updateFinish(option.key, Number(event.target.value))}
                      disabled={disabled}
                      className="h-1.5 w-full min-w-0 cursor-pointer accent-[var(--primary)]"
                    />
                    <span className="justify-self-end font-mono text-[0.5625rem] tabular-nums text-[var(--muted-foreground)]">
                      {value}%
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {mode === "chat" && (
            <div className="grid gap-1.5 rounded-lg bg-[var(--secondary)]/55 p-1.5 ring-1 ring-[var(--border)]/35">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.5625rem] font-semibold uppercase text-[var(--muted-foreground)]">
                  Source strength
                </span>
                <span className="font-mono text-[0.5625rem] tabular-nums text-[var(--muted-foreground)]">
                  {paintOpacitySummary}
                </span>
              </div>
              <div className="grid gap-1">
                {PAINT_OPACITY_OPTIONS.map((option) => {
                  const value = paintOpacity[option.key];
                  const channelEnabled = paintEnabled[option.enabledKey];
                  const hasSourcePaint = hasPaintForChannel(effectiveColors, option.colorKey);
                  const sliderEnabled = channelEnabled && hasSourcePaint;
                  return (
                    <div
                      key={option.key}
                      className="grid min-w-0 grid-cols-[minmax(5rem,auto)_minmax(0,1fr)_2.1rem] items-center gap-1 rounded-md bg-[var(--background)]/18 px-1 py-0.5"
                      title={channelEnabled ? option.title : `${option.label} channel is off.`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate text-[0.5625rem] text-[var(--muted-foreground)]">
                          {option.label}
                        </span>
                        <ChannelToggle
                          checked={channelEnabled}
                          disabled={disabled}
                          label={option.label}
                          onChange={(checked) => updatePaintEnabled(option.enabledKey, checked)}
                        />
                      </span>
                      <input
                        type="range"
                        aria-label={`${option.label}: ${option.title}`}
                        title={option.title}
                        min={0}
                        max={100}
                        value={sliderEnabled ? value : 0}
                        onChange={(event) => updatePaintOpacity(option.key, Number(event.target.value))}
                        disabled={disabled || !sliderEnabled}
                        className="h-1.5 w-full min-w-0 cursor-pointer accent-[var(--primary)]"
                      />
                      <span className="justify-self-end font-mono text-[0.5625rem] tabular-nums text-[var(--muted-foreground)]">
                        {getChannelValueLabel(channelEnabled, hasSourcePaint, value)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {mode === "custom" && (
            <div className="rounded-lg bg-[var(--secondary)]/55 p-1.5 ring-1 ring-[var(--border)]/35">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[0.5625rem] font-semibold uppercase text-[var(--muted-foreground)]">
                  Custom paint
                </span>
                <span className="font-mono text-[0.5625rem] tabular-nums text-[var(--muted-foreground)]">
                  {paintOpacitySummary}
                </span>
              </div>
              <div className="grid gap-1.5">
                {PAINT_OPACITY_OPTIONS.map((option) => {
                  const value = paintOpacity[option.key];
                  const channelEnabled = paintEnabled[option.enabledKey];
                  const hasCustomPaint = hasPaintForChannel(config, option.colorKey);
                  const sliderEnabled = channelEnabled && hasCustomPaint;
                  return (
                    <div
                      key={option.key}
                      className={cn(
                        "min-w-0 space-y-1.5 rounded-lg bg-[var(--background)]/25 p-1.5 ring-1 ring-[var(--border)]/30",
                        !channelEnabled && "bg-[var(--background)]/12 ring-[var(--border)]/18",
                        disabled && "pointer-events-none",
                      )}
                    >
                      <ColorPicker
                        value={config[option.colorKey] ?? ""}
                        onChange={(color) => updateCustomColor(option.colorKey, color)}
                        gradient
                        compact
                        label={option.label}
                        emptyText={option.emptyText}
                        helpText={option.title}
                        headerAction={
                          <ChannelToggle
                            checked={channelEnabled}
                            disabled={disabled}
                            label={option.label}
                            onChange={(checked) => updatePaintEnabled(option.enabledKey, checked)}
                          />
                        }
                      />
                      <label className="grid min-w-0 gap-1">
                        <span className="flex min-w-0 items-center justify-between gap-2 text-[0.5625rem] text-[var(--muted-foreground)]">
                          <span className="min-w-0 truncate">{option.label} strength</span>
                          <span className="shrink-0 font-mono tabular-nums">
                            {getChannelValueLabel(channelEnabled, hasCustomPaint, value)}
                          </span>
                        </span>
                        <input
                          type="range"
                          aria-label={`${option.label}: ${option.title}`}
                          title={option.title}
                          min={0}
                          max={100}
                          value={sliderEnabled ? value : 0}
                          onChange={(event) => updatePaintOpacity(option.key, Number(event.target.value))}
                          disabled={disabled || !sliderEnabled}
                          className="h-1.5 w-full min-w-0 cursor-pointer accent-[var(--primary)]"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
