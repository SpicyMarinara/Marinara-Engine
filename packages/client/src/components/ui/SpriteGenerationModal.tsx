// ──────────────────────────────────────────────
// Sprite Generation Modal
// ──────────────────────────────────────────────
// Generates a character expression sheet via image generation,
// slices it into individual sprites, and lets the user label/save them.
import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { X, Loader2, Check, ImagePlus, Sparkles, ArrowLeft } from "lucide-react";
import { Modal } from "./Modal";
import { cn } from "../../lib/utils";
import { useConnections } from "../../hooks/use-connections";
import { useSpriteCapabilities } from "../../hooks/use-characters";
import { api } from "../../lib/api-client";

// ── Types ──

interface SpriteGenerationModalProps {
  open: boolean;
  onClose: () => void;
  /** Entity ID — character or persona */
  entityId: string;
  /** Optional initial mode shown when opening */
  initialSpriteType?: "expressions" | "full-body";
  /** Pre-filled appearance description */
  defaultAppearance?: string;
  /** Pre-filled avatar (base64 data URL) for reference */
  defaultAvatarUrl?: string | null;
  /** Callback after sprites are saved */
  onSpritesGenerated?: () => void;
}

interface SlicedCell {
  expression: string;
  rawDataUrl: string;
  dataUrl: string;
  selected: boolean;
}

// ── Constants ──

const EXPRESSION_PRESETS = {
  "6 (2×3)": {
    cols: 2,
    rows: 3,
    expressions: ["neutral", "happy", "sad", "angry", "surprised", "smirk"],
  },
  "9 (3×3)": {
    cols: 3,
    rows: 3,
    expressions: ["neutral", "happy", "sad", "angry", "surprised", "scared", "disgusted", "thinking", "laughing"],
  },
  "12 (3×4)": {
    cols: 3,
    rows: 4,
    expressions: [
      "neutral",
      "happy",
      "sad",
      "angry",
      "surprised",
      "scared",
      "disgusted",
      "thinking",
      "laughing",
      "crying",
      "determined",
      "confused",
    ],
  },
} as const;

type PresetKey = keyof typeof EXPRESSION_PRESETS;

type SpriteType = "expressions" | "full-body";

const FULL_BODY_POSE_PRESETS: Record<PresetKey, string[]> = {
  "6 (2×3)": ["idle", "walk", "battle_stance", "casting", "defend", "victory"],
  "9 (3×3)": ["idle", "walk", "run", "battle_stance", "attack", "defend", "casting", "hurt", "victory"],
  "12 (3×4)": [
    "idle",
    "walk",
    "run",
    "battle_stance",
    "attack",
    "defend",
    "casting",
    "hurt",
    "jump",
    "thinking",
    "cheer",
    "victory",
  ],
};

const ALL_EXPRESSIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "scared",
  "disgusted",
  "thinking",
  "laughing",
  "crying",
  "blushing",
  "smirk",
  "embarrassed",
  "determined",
  "confused",
  "sleepy",
];

const ALL_FULL_BODY_POSES = [
  "idle",
  "walk",
  "run",
  "battle_stance",
  "attack",
  "defend",
  "casting",
  "hurt",
  "jump",
  "thinking",
  "cheer",
  "victory",
  "wave",
  "sit",
  "kneel",
  "point",
];

// ── Component ──

export function SpriteGenerationModal({
  open,
  onClose,
  entityId,
  initialSpriteType = "expressions",
  defaultAppearance,
  defaultAvatarUrl,
  onSpritesGenerated,
}: SpriteGenerationModalProps) {
  // Step: 0 = configure, 1 = generating, 2 = preview & label
  const [step, setStep] = useState<0 | 1 | 2>(0);

  // Sprite type: expressions (portrait) or full-body
  const [spriteType, setSpriteType] = useState<SpriteType>(initialSpriteType);

  // Config state
  const [appearance, setAppearance] = useState(defaultAppearance ?? "");
  const [referenceImages, setReferenceImages] = useState<string[]>(defaultAvatarUrl ? [defaultAvatarUrl] : []);
  const [preset, setPreset] = useState<PresetKey>("6 (2×3)");
  const [selectedExpressions, setSelectedExpressions] = useState<string[]>([
    ...EXPRESSION_PRESETS["6 (2×3)"].expressions,
  ]);
  const [noBackground, setNoBackground] = useState(true);
  const [cleanupStrength, setCleanupStrength] = useState(50);
  const [connectionId, setConnectionId] = useState<string | null>(null);

  // Generation state
  const [generatedSheet, setGeneratedSheet] = useState<string | null>(null);
  const [cells, setCells] = useState<SlicedCell[]>([]);
  const [cleanupApplying, setCleanupApplying] = useState(false);
  const [cleanupApplied, setCleanupApplied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Connections
  const { data: connectionsList } = useConnections();
  const { data: spriteCapabilities } = useSpriteCapabilities();
  const imageConnections = useMemo(() => {
    if (!connectionsList) return [];
    return (connectionsList as Array<{ id: string; name: string; model?: string; provider?: string }>).filter(
      (c) => c.provider === "image_generation",
    );
  }, [connectionsList]);
  const spriteGenerationUnavailable = spriteCapabilities?.spriteGenerationAvailable === false;
  const spriteGenerationReason = spriteCapabilities?.reason ?? "Sprite generation is unavailable on this platform.";

  // Auto-select first image connection
  const effectiveConnectionId = connectionId ?? imageConnections[0]?.id ?? null;

  useEffect(() => {
    if (!open) return;
    setSpriteType(initialSpriteType);
    setSelectedExpressions(
      initialSpriteType === "full-body"
        ? [...FULL_BODY_POSE_PRESETS[preset]]
        : [...EXPRESSION_PRESETS[preset].expressions],
    );
  }, [open, initialSpriteType, preset]);

  // Reset reference image & appearance when the target character changes
  useEffect(() => {
    setAppearance(defaultAppearance ?? "");
    setReferenceImages(defaultAvatarUrl ? [defaultAvatarUrl] : []);
    setStep(0);
    setGeneratedSheet(null);
    setCells([]);
    setError(null);
  }, [entityId, defaultAvatarUrl, defaultAppearance]);

  // ── Handlers ──

  const handleReferenceUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setReferenceImages((prev) => (prev.length < 4 ? [...prev, reader.result as string] : prev));
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const removeReferenceImage = useCallback((idx: number) => {
    setReferenceImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handlePresetChange = useCallback(
    (key: PresetKey) => {
      setPreset(key);
      setSelectedExpressions(
        spriteType === "full-body" ? [...FULL_BODY_POSE_PRESETS[key]] : [...EXPRESSION_PRESETS[key].expressions],
      );
    },
    [spriteType],
  );

  const toggleExpression = useCallback((expr: string) => {
    setSelectedExpressions((prev) => (prev.includes(expr) ? prev.filter((e) => e !== expr) : [...prev, expr]));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (spriteGenerationUnavailable || !effectiveConnectionId || selectedExpressions.length === 0) return;

    setStep(1);
    setError(null);

    try {
      const { cols, rows } = EXPRESSION_PRESETS[preset];

      const result = await api.post<{
        sheetBase64: string;
        cells: Array<{ expression: string; base64: string }>;
        failedExpressions?: Array<{ expression: string; error: string }>;
      }>("/sprites/generate-sheet", {
        connectionId: effectiveConnectionId,
        appearance,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        expressions: selectedExpressions,
        cols,
        rows,
        spriteType,
        // Always return raw generation output first.
        // Cleanup is applied in preview so users can retry with different strengths.
        noBackground: false,
      });

      setGeneratedSheet(result.sheetBase64 ? `data:image/png;base64,${result.sheetBase64}` : null);
      setCells(
        result.cells.map((c) => ({
          expression: c.expression,
          rawDataUrl: `data:image/png;base64,${c.base64}`,
          dataUrl: `data:image/png;base64,${c.base64}`,
          selected: true,
        })),
      );
      setCleanupApplied(false);
      setStep(2);

      if (result.failedExpressions?.length) {
        const names = result.failedExpressions.map((f) => f.expression).join(", ");
        setError(`Some poses failed to generate: ${names}. You can regenerate them individually.`);
      }
    } catch (err: any) {
      setError(err?.message || "Image generation failed");
      setStep(0);
    }
  }, [
    spriteGenerationUnavailable,
    effectiveConnectionId,
    appearance,
    referenceImages,
    selectedExpressions,
    preset,
    spriteType,
  ]);

  const handleApplyCleanup = useCallback(async () => {
    if (!noBackground || cells.length === 0) return;

    setCleanupApplying(true);
    setError(null);

    try {
      const result = await api.post<{ cells: Array<{ expression: string; base64: string }> }>("/sprites/cleanup", {
        cleanupStrength,
        cells: cells.map((cell) => ({
          expression: cell.expression,
          base64: cell.rawDataUrl,
        })),
      });

      setCells((prev) =>
        prev.map((cell, i) => ({
          ...cell,
          dataUrl: `data:image/png;base64,${result.cells[i]?.base64 ?? ""}`,
        })),
      );
      setCleanupApplied(true);
    } catch (err: any) {
      setError(err?.message || "Failed to apply background cleanup");
    } finally {
      setCleanupApplying(false);
    }
  }, [cells, cleanupStrength, noBackground]);

  const handleUseOriginal = useCallback(() => {
    setCells((prev) => prev.map((cell) => ({ ...cell, dataUrl: cell.rawDataUrl })));
    setCleanupApplied(false);
  }, []);

  const handleCellToggle = useCallback((idx: number) => {
    setCells((prev) => prev.map((c, i) => (i === idx ? { ...c, selected: !c.selected } : c)));
  }, []);

  const handleCellRename = useCallback((idx: number, name: string) => {
    setCells((prev) =>
      prev.map((c, i) =>
        i === idx
          ? {
              ...c,
              expression: name
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, "_"),
            }
          : c,
      ),
    );
  }, []);

  const handleSave = useCallback(async () => {
    const toSave = cells.filter((c) => c.selected && c.expression);
    if (toSave.length === 0) return;

    setSaving(true);
    setError(null);

    try {
      for (const cell of toSave) {
        const cleaned = cell.expression
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "_");
        const expression =
          spriteType === "full-body"
            ? cleaned.startsWith("full_")
              ? cleaned
              : `full_${cleaned}`
            : cleaned.replace(/^full_/, "");
        await api.post(`/sprites/${entityId}`, {
          expression,
          image: cell.dataUrl,
        });
      }
      onSpritesGenerated?.();
      onClose();
      // Reset for next use
      setStep(0);
      setGeneratedSheet(null);
      setCells([]);
    } catch (err: any) {
      setError(err?.message || "Failed to save sprites");
    } finally {
      setSaving(false);
    }
  }, [cells, entityId, onSpritesGenerated, onClose, spriteType]);

  const handleReset = useCallback(() => {
    setStep(0);
    setGeneratedSheet(null);
    setCells([]);
    setCleanupApplied(false);
    setCleanupApplying(false);
    setError(null);
  }, []);

  const selectedCount = cells.filter((c) => c.selected).length;

  // ── Render ──

  return (
    <Modal open={open} onClose={onClose} title="Generate Expression Sprites" width="max-w-2xl">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleReferenceUpload} />

      {/* Step 0: Configuration */}
      {step === 0 && (
        <div className="space-y-4">
          {/* Sprite Type Tabs */}
          <div className="flex gap-2">
            <button
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ring-1",
                spriteType === "expressions"
                  ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-[var(--primary)]/40"
                  : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)] hover:ring-[var(--primary)]/20",
              )}
              onClick={() => {
                setSpriteType("expressions");
                setSelectedExpressions([...EXPRESSION_PRESETS[preset].expressions]);
              }}
            >
              Expressions (Portrait)
            </button>
            <button
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ring-1",
                spriteType === "full-body"
                  ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-[var(--primary)]/40"
                  : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)] hover:ring-[var(--primary)]/20",
              )}
              onClick={() => {
                setSpriteType("full-body");
                setSelectedExpressions([...FULL_BODY_POSE_PRESETS[preset]]);
              }}
            >
              Full-body
            </button>
          </div>
          {error && (
            <div className="rounded-lg bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
              {error}
            </div>
          )}
          {spriteGenerationUnavailable && (
            <div className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
              {spriteGenerationReason}
            </div>
          )}

          {/* Image Generation Connection */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
              Image Generation Connection
            </label>
            {imageConnections.length === 0 ? (
              <p className="text-xs text-[var(--destructive)]">
                No image generation connections found. Add one in Settings → Connections with the &quot;Image
                Generation&quot; provider type.
              </p>
            ) : (
              <select
                value={effectiveConnectionId ?? ""}
                onChange={(e) => setConnectionId(e.target.value || null)}
                className="w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none ring-1 ring-transparent transition-all focus:ring-[var(--primary)]/40"
              >
                {imageConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.model ? ` — ${c.model}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Reference Image */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
              Reference Images <span className="text-[var(--muted-foreground)]">(optional, up to 4)</span>
            </label>
            <div className="flex items-start gap-3">
              <div className="flex flex-wrap gap-2">
                {referenceImages.map((img, idx) => (
                  <div key={idx} className="group relative">
                    <img
                      src={img}
                      alt={`Reference ${idx + 1}`}
                      className="h-20 w-20 rounded-lg object-cover ring-1 ring-[var(--border)]"
                    />
                    <button
                      onClick={() => removeReferenceImage(idx)}
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-[var(--destructive)] p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
                {referenceImages.length < 4 && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-[var(--border)] text-[var(--muted-foreground)] transition-colors hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                  >
                    <ImagePlus size={18} />
                    <span className="text-[0.5625rem]">Upload</span>
                  </button>
                )}
              </div>
              <p className="flex-1 text-[0.625rem] text-[var(--muted-foreground)]">
                Upload reference images of the character to improve consistency. Multiple angles or the existing avatar
                work well.
              </p>
            </div>
          </div>

          {/* Appearance Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Appearance Description</label>
            <textarea
              value={appearance}
              onChange={(e) => setAppearance(e.target.value)}
              placeholder="blue eyes, blonde hair, anime style, wearing a hoodie, female, chubby..."
              rows={3}
              className="w-full resize-none rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs text-[var(--foreground)] outline-none ring-1 ring-transparent transition-all placeholder:text-[var(--muted-foreground)] focus:ring-[var(--primary)]/40"
            />
          </div>

          {/* Preset and Expression Selection (Expressions mode) */}
          {spriteType === "expressions" && (
            <>
              {/* Expression Preset */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Expression Count</label>
                <div className="flex gap-2">
                  {(Object.keys(EXPRESSION_PRESETS) as PresetKey[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => handlePresetChange(key)}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs transition-colors ring-1",
                        preset === key
                          ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-[var(--primary)]/40"
                          : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)] hover:ring-[var(--primary)]/20",
                      )}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </div>

              {/* Expression Selection */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
                  Expressions ({selectedExpressions.length} selected)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_EXPRESSIONS.map((expr) => (
                    <button
                      key={expr}
                      onClick={() => toggleExpression(expr)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[0.6875rem] capitalize transition-colors",
                        selectedExpressions.includes(expr)
                          ? "bg-[var(--primary)]/20 text-[var(--primary)] ring-1 ring-[var(--primary)]/40"
                          : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                      )}
                    >
                      {expr}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                  Select exactly {EXPRESSION_PRESETS[preset].cols * EXPRESSION_PRESETS[preset].rows} expressions for a{" "}
                  {EXPRESSION_PRESETS[preset].cols}×{EXPRESSION_PRESETS[preset].rows} grid. Extra or fewer expressions
                  will be adjusted.
                </p>
              </div>
            </>
          )}

          {/* Full-body options */}
          {spriteType === "full-body" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Pose Count</label>
                <div className="flex gap-2">
                  {(Object.keys(EXPRESSION_PRESETS) as PresetKey[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => handlePresetChange(key)}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs transition-colors ring-1",
                        preset === key
                          ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-[var(--primary)]/40"
                          : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)] hover:ring-[var(--primary)]/20",
                      )}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">
                  Poses ({selectedExpressions.length} selected)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_FULL_BODY_POSES.map((pose) => (
                    <button
                      key={pose}
                      onClick={() => toggleExpression(pose)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[0.6875rem] capitalize transition-colors",
                        selectedExpressions.includes(pose)
                          ? "bg-[var(--primary)]/20 text-[var(--primary)] ring-1 ring-[var(--primary)]/40"
                          : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                      )}
                    >
                      {pose.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                  Select roughly {EXPRESSION_PRESETS[preset].cols * EXPRESSION_PRESETS[preset].rows} general poses.
                  These are generated one-by-one for clean full-body sprites.
                </p>
              </div>
            </>
          )}

          {/* Generate Button */}
          <div className="flex items-center justify-between border-t border-[var(--border)]/30 pt-4">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] hover:bg-[var(--secondary)]"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={
                spriteGenerationUnavailable ||
                !effectiveConnectionId ||
                selectedExpressions.length === 0 ||
                !appearance.trim()
              }
              title={spriteGenerationUnavailable ? spriteGenerationReason : undefined}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles size={14} />
              {spriteType === "full-body" ? "Generate Poses" : "Generate Sheet"}
            </button>
          </div>
        </div>
      )}

      {/* Step 1: Generating */}
      {step === 1 && (
        <div className="flex flex-col items-center gap-4 py-12">
          <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
          <div className="text-center">
            <p className="text-sm font-medium">
              {spriteType === "full-body" ? "Generating full-body poses…" : "Generating expression sheet…"}
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {spriteType === "full-body"
                ? "This may take longer because each pose is generated separately for better quality."
                : "This may take 30–60 seconds depending on the provider."}
            </p>
          </div>
        </div>
      )}

      {/* Step 2: Preview & Label */}
      {step === 2 && (
        <div className="space-y-4">
          {error && (
            <div className="rounded-lg bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
              {error}
            </div>
          )}

          {/* Full sheet preview (collapsed) */}
          {generatedSheet && (
            <details className="group">
              <summary className="cursor-pointer text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                View full generated sheet
              </summary>
              <img
                src={generatedSheet}
                alt="Generated expression sheet"
                className="mt-2 w-full rounded-lg ring-1 ring-[var(--border)]"
              />
            </details>
          )}

          {/* Cell grid */}
          <div>
            <div className="mb-3 rounded-lg bg-[var(--secondary)]/60 p-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
                  <input
                    type="checkbox"
                    checked={noBackground}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setNoBackground(enabled);
                      if (!enabled) {
                        handleUseOriginal();
                      }
                    }}
                    className="accent-[var(--primary)]"
                  />
                  Transparent background
                </label>
                {noBackground && (
                  <>
                    <div className="flex min-w-52 flex-1 items-center gap-2">
                      <span className="text-[0.6875rem] text-[var(--muted-foreground)]">Soft</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={cleanupStrength}
                        onChange={(e) => setCleanupStrength(Number(e.target.value))}
                        className="w-full accent-[var(--primary)]"
                      />
                      <span className="text-[0.6875rem] text-[var(--muted-foreground)]">Aggressive</span>
                    </div>
                    <span className="text-[0.6875rem] text-[var(--muted-foreground)]">{cleanupStrength}</span>
                    <button
                      onClick={handleApplyCleanup}
                      disabled={cleanupApplying || cells.length === 0}
                      className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[0.6875rem] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                    >
                      {cleanupApplying ? "Applying..." : cleanupApplied ? "Reapply Cleanup" : "Apply Cleanup"}
                    </button>
                    {cleanupApplied && (
                      <button
                        onClick={handleUseOriginal}
                        disabled={cleanupApplying}
                        className="rounded-lg px-2.5 py-1 text-[0.6875rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)]"
                      >
                        Use Original
                      </button>
                    )}
                  </>
                )}
              </div>
              <p className="mt-1 text-[0.625rem] text-[var(--muted-foreground)]">
                Cleanup now runs on the same generated sprites, so you can retry until it looks right without
                regenerating.
              </p>
            </div>
            <label className="mb-2 block text-xs font-medium text-[var(--foreground)]">
              Review & Label {spriteType === "full-body" ? "Poses" : "Sprites"} ({selectedCount} selected)
            </label>
            <p className="mb-3 text-[0.625rem] text-[var(--muted-foreground)]">
              Click an item to toggle selection. Edit names as needed. Only selected items will be saved.
            </p>
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${EXPRESSION_PRESETS[preset].cols}, 1fr)`,
              }}
            >
              {cells.map((cell, i) => (
                <div
                  key={i}
                  className={cn(
                    "group relative overflow-hidden rounded-xl border-2 transition-all",
                    cell.selected ? "border-[var(--primary)] shadow-md" : "border-[var(--border)] opacity-50",
                  )}
                >
                  {/* Image */}
                  <button onClick={() => handleCellToggle(i)} className="block w-full">
                    <div className="aspect-square bg-[var(--secondary)]">
                      <img src={cell.dataUrl} alt={cell.expression} className="h-full w-full object-contain" />
                    </div>
                  </button>

                  {/* Selected indicator */}
                  <div
                    className={cn(
                      "absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full transition-colors",
                      cell.selected ? "bg-[var(--primary)] text-white" : "bg-black/40 text-white/60",
                    )}
                  >
                    {cell.selected ? <Check size={12} /> : <X size={12} />}
                  </div>

                  {/* Expression label */}
                  <div className="p-1.5">
                    <input
                      value={cell.expression}
                      onChange={(e) => handleCellRename(i, e.target.value)}
                      className="w-full rounded bg-[var(--secondary)] px-2 py-1 text-center text-[0.6875rem] capitalize text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--primary)]/40"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between border-t border-[var(--border)]/30 pt-4">
            <button
              onClick={handleReset}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] hover:bg-[var(--secondary)]"
            >
              <ArrowLeft size={14} />
              Regenerate
            </button>
            <button
              onClick={handleSave}
              disabled={saving || selectedCount === 0}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Check size={14} />
                  Save {selectedCount} Sprites
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
