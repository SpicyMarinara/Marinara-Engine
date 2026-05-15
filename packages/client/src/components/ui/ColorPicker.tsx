// ──────────────────────────────────────────────
// Color Picker — supports single colors & gradients
// ──────────────────────────────────────────────
import { useState, useRef, useCallback, useEffect } from "react";
import { Pipette, Sparkles, X, Plus, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";

interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Allow gradient mode (for name colors) */
  gradient?: boolean;
  /** Label displayed above the picker */
  label: string;
  /** Help text beneath the label */
  helpText?: string;
}

/** Preset palette colors */
const PRESETS = [
  "#ff6b6b",
  "#ee5a24",
  "#f0932b",
  "#ffd93d",
  "#6ab04c",
  "#22a6b3",
  "#4834d4",
  "#6c5ce7",
  "#e056fd",
  "#fd79a8",
  "#fdcb6e",
  "#00cec9",
  "#2ed573",
  "#1e90ff",
  "#a29bfe",
  "#ff7979",
  "#badc58",
  "#7ed6df",
  "#e17055",
  "#d63031",
];

/** Preset gradients */
const GRADIENT_PRESETS = [
  "linear-gradient(90deg, #ff6b6b, #ffd93d)",
  "linear-gradient(90deg, #a29bfe, #fd79a8)",
  "linear-gradient(90deg, #6c5ce7, #00cec9)",
  "linear-gradient(90deg, #e056fd, #4834d4)",
  "linear-gradient(90deg, #f0932b, #ee5a24)",
  "linear-gradient(90deg, #22a6b3, #6ab04c)",
  "linear-gradient(90deg, #1e90ff, #a29bfe)",
  "linear-gradient(90deg, #ff7979, #e056fd)",
  "linear-gradient(135deg, #667eea, #764ba2)",
  "linear-gradient(135deg, #f093fb, #f5576c)",
  "linear-gradient(135deg, #4facfe, #00f2fe)",
  "linear-gradient(135deg, #43e97b, #38f9d7)",
];

/** Parse gradient into stops: "linear-gradient(90deg, #ff6b6b, #ffd93d)" → ["#ff6b6b","#ffd93d"] */
function parseGradientStops(value: string): string[] {
  const match = value.match(/linear-gradient\([^,]+,\s*(.+)\)/);
  if (!match) return ["#ff6b6b", "#ffd93d"];
  return match[1].split(",").map((s) => s.trim());
}

function buildGradient(angle: number, stops: string[]): string {
  return `linear-gradient(${angle}deg, ${stops.join(", ")})`;
}

function getNativeColorValue(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#6c5ce7";
}

export function ColorPicker({ value, onChange, gradient = false, label, helpText }: ColorPickerProps) {
  const isGradient = value.startsWith("linear-gradient");
  const [mode, setMode] = useState<"solid" | "gradient">(isGradient ? "gradient" : "solid");
  const [gradientStops, setGradientStops] = useState<string[]>(
    isGradient ? parseGradientStops(value) : ["#ff6b6b", "#ffd93d"],
  );
  const [gradientAngle, setGradientAngle] = useState(90);
  const [expanded, setExpanded] = useState(false);
  const nativeRef = useRef<HTMLInputElement>(null);
  const activeStopRef = useRef<number>(0);

  // Sync value → local state when value changes externally
  useEffect(() => {
    if (value.startsWith("linear-gradient")) {
      setMode("gradient");
      setGradientStops(parseGradientStops(value));
      const angleMatch = value.match(/linear-gradient\((\d+)deg/);
      if (angleMatch) setGradientAngle(parseInt(angleMatch[1]));
    } else if (value) {
      setMode("solid");
    }
  }, [value]);

  const handleSolidChange = useCallback(
    (color: string) => {
      onChange(color);
    },
    [onChange],
  );

  const handleGradientStopChange = useCallback(
    (index: number, color: string) => {
      setGradientStops((prev) => {
        const updated = [...prev];
        updated[index] = color;
        onChange(buildGradient(gradientAngle, updated));
        return updated;
      });
    },
    [onChange, gradientAngle],
  );

  const addStop = useCallback(() => {
    setGradientStops((prev) => {
      const updated = [...prev, "#ffffff"];
      onChange(buildGradient(gradientAngle, updated));
      return updated;
    });
  }, [onChange, gradientAngle]);

  const removeStop = useCallback(
    (index: number) => {
      if (gradientStops.length <= 2) return;
      setGradientStops((prev) => {
        const updated = prev.filter((_, i) => i !== index);
        onChange(buildGradient(gradientAngle, updated));
        return updated;
      });
    },
    [onChange, gradientAngle, gradientStops.length],
  );

  const handleAngleChange = useCallback(
    (angle: number) => {
      setGradientAngle(angle);
      onChange(buildGradient(angle, gradientStops));
    },
    [onChange, gradientStops],
  );

  const clearColor = useCallback(() => {
    onChange("");
    setExpanded(false);
  }, [onChange]);

  const displayStyle = value
    ? value.startsWith("linear-gradient")
      ? { background: value }
      : { backgroundColor: value }
    : { backgroundColor: "transparent" };

  return (
    <div className="space-y-2">
      {/* Label */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
        {value && (
          <button
            type="button"
            onClick={clearColor}
            className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] transition-all hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
          >
            <X size="0.625rem" />
            Clear
          </button>
        )}
      </div>
      {helpText && <p className="text-[0.625rem] text-[var(--muted-foreground)]/70">{helpText}</p>}

      {/* Preview + trigger */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-2.5 transition-all hover:border-[var(--primary)]/30",
          expanded && "border-[var(--primary)]/40 ring-1 ring-[var(--primary)]/20",
        )}
      >
        <div
          className="h-8 w-8 shrink-0 rounded-lg ring-1 ring-[var(--border)]"
          style={{
            ...displayStyle,
            ...(!value && {
              backgroundImage: "repeating-conic-gradient(var(--border) 0% 25%, transparent 0% 50%)",
              backgroundSize: "0.5rem 0.5rem",
            }),
          }}
        />
        <span className="flex-1 text-left text-xs text-[var(--muted-foreground)] truncate">
          {value || "No color set — uses default"}
        </span>
        <Pipette size="0.8125rem" className="shrink-0 text-[var(--muted-foreground)]" />
      </button>

      {/* Expanded picker */}
      {expanded && (
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 animate-in slide-in-from-top-2 duration-200">
          {/* Mode toggle (only if gradient is allowed) */}
          {gradient && (
            <div className="flex rounded-lg bg-[var(--secondary)] p-0.5">
              <button
                type="button"
                onClick={() => {
                  setMode("solid");
                  if (gradientStops[0]) handleSolidChange(gradientStops[0]);
                }}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-[0.6875rem] font-medium transition-all",
                  mode === "solid"
                    ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                )}
              >
                <Pipette size="0.6875rem" className="mr-1 inline" />
                Solid
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("gradient");
                  onChange(buildGradient(gradientAngle, gradientStops));
                }}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-[0.6875rem] font-medium transition-all",
                  mode === "gradient"
                    ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                )}
              >
                <Sparkles size="0.6875rem" className="mr-1 inline" />
                Gradient
              </button>
            </div>
          )}

          {/* Solid color mode */}
          {mode === "solid" && (
            <>
              {/* Native color picker + typed CSS value */}
              <div className="grid gap-2">
                <label className="group relative flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 transition-all hover:border-[var(--primary)]/35 hover:bg-[var(--accent)]/25">
                  <span
                    className="h-6 w-6 shrink-0 rounded-md ring-1 ring-[var(--border)]"
                    style={{
                      backgroundColor: value && !value.startsWith("linear-gradient") ? value : "#6c5ce7",
                    }}
                  />
                  <span className="min-w-0 text-xs font-medium text-[var(--foreground)]">Pick color</span>
                  <Pipette size="0.75rem" className="ml-auto shrink-0 text-[var(--muted-foreground)]" />
                  <input
                    ref={nativeRef}
                    type="color"
                    aria-label={`Pick ${label} color`}
                    value={value && !value.startsWith("linear-gradient") ? getNativeColorValue(value) : "#6c5ce7"}
                    onChange={(e) => handleSolidChange(e.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </label>

                <label className="min-w-0 space-y-1">
                  <span className="block text-[0.625rem] font-medium text-[var(--muted-foreground)]">Hex / CSS</span>
                  <input
                    aria-label={`${label} hex or CSS color`}
                    value={value && !value.startsWith("linear-gradient") ? value : ""}
                    onChange={(e) => handleSolidChange(e.target.value)}
                    placeholder="#hex or color name"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-1.5 font-mono text-xs outline-none transition-colors focus:border-[var(--primary)]/50"
                  />
                </label>
              </div>

              {/* Preset palette */}
              <div>
                <p className="mb-1.5 text-[0.625rem] text-[var(--muted-foreground)]">Presets</p>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => handleSolidChange(color)}
                      className={cn(
                        "h-6 w-6 rounded-md ring-1 ring-[var(--border)] transition-all hover:scale-110 hover:ring-2 hover:ring-[var(--primary)]/50",
                        value === color && "ring-2 ring-[var(--primary)] scale-110",
                      )}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Gradient mode */}
          {mode === "gradient" && (
            <>
              {/* Gradient preview bar */}
              <div
                className="h-8 w-full rounded-lg ring-1 ring-[var(--border)]"
                style={{ background: buildGradient(gradientAngle, gradientStops) }}
              />

              {/* Stops */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Color Stops</p>
                  <button
                    type="button"
                    onClick={addStop}
                    className="flex items-center gap-0.5 rounded-md bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] transition-all hover:text-[var(--foreground)]"
                  >
                    <Plus size="0.625rem" /> Add
                  </button>
                </div>
                {gradientStops.map((stop, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={stop}
                      onChange={(e) => {
                        activeStopRef.current = i;
                        handleGradientStopChange(i, e.target.value);
                      }}
                      className="h-7 w-7 cursor-pointer rounded-md border-0 bg-transparent p-0"
                    />
                    <input
                      value={stop}
                      onChange={(e) => handleGradientStopChange(i, e.target.value)}
                      className="flex-1 rounded-md border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 font-mono text-[0.6875rem] outline-none focus:border-[var(--primary)]/40"
                    />
                    {gradientStops.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeStop(i)}
                        className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
                      >
                        <Trash2 size="0.6875rem" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Angle */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.625rem] text-[var(--muted-foreground)]">Angle</span>
                  <span className="min-w-[2.75rem] text-right font-mono text-[0.625rem] tabular-nums text-[var(--muted-foreground)]">
                    {gradientAngle}°
                  </span>
                </div>
                <input
                  aria-label="Gradient angle"
                  type="range"
                  min={0}
                  max={360}
                  value={gradientAngle}
                  onChange={(e) => handleAngleChange(parseInt(e.target.value))}
                  className="h-1.5 w-full cursor-pointer accent-[var(--primary)]"
                />
              </div>

              {/* Gradient presets */}
              <div>
                <p className="mb-1.5 text-[0.625rem] text-[var(--muted-foreground)]">Presets</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {GRADIENT_PRESETS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        setGradientStops(parseGradientStops(g));
                        const angleMatch = g.match(/linear-gradient\((\d+)deg/);
                        if (angleMatch) setGradientAngle(parseInt(angleMatch[1]));
                        onChange(g);
                      }}
                      className={cn(
                        "h-6 rounded-md ring-1 ring-[var(--border)] transition-all hover:scale-105 hover:ring-2 hover:ring-[var(--primary)]/50",
                        value === g && "ring-2 ring-[var(--primary)] scale-105",
                      )}
                      style={{ background: g }}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
