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

interface SliceAdjustments {
  marginX: number;
  marginY: number;
  gapX: number;
  gapY: number;
}

// ── Constants ──

const EXPRESSION_PRESETS = {
  "1 (1×1)": {
    cols: 1,
    rows: 1,
    expressions: ["neutral"],
  },
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
  "16 (4×4)": {
    cols: 4,
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
      "blushing",
      "smirk",
      "embarrassed",
      "determined",
      "confused",
      "sleepy",
    ],
  },
} as const;

type PresetKey = keyof typeof EXPRESSION_PRESETS;

type SpriteType = "expressions" | "full-body";

const DEFAULT_SPRITE_PRESET: PresetKey = "6 (2×3)";

const FULL_BODY_POSE_PRESETS: Record<PresetKey, string[]> = {
  "1 (1×1)": ["idle"],
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
  "16 (4×4)": [
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

const DEFAULT_SLICE_ADJUSTMENTS: SliceAdjustments = {
  marginX: 0,
  marginY: 0,
  gapX: 0,
  gapY: 0,
};

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
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [useCurrentAvatarReference, setUseCurrentAvatarReference] = useState(false);
  const [preset, setPreset] = useState<PresetKey>(DEFAULT_SPRITE_PRESET);
  const [selectedExpressions, setSelectedExpressions] = useState<string[]>([
    ...EXPRESSION_PRESETS[DEFAULT_SPRITE_PRESET].expressions,
  ]);
  const [noBackground, setNoBackground] = useState(true);
  const [cleanupStrength, setCleanupStrength] = useState(50);
  const [connectionId, setConnectionId] = useState<string | null>(null);

  // Generation state
  const [generatedSheet, setGeneratedSheet] = useState<string | null>(null);
  const [cells, setCells] = useState<SlicedCell[]>([]);
  const [cleanupApplying, setCleanupApplying] = useState(false);
  const [cleanupApplied, setCleanupApplied] = useState(false);
  const [sliceAdjustments, setSliceAdjustments] = useState<SliceAdjustments>(DEFAULT_SLICE_ADJUSTMENTS);
  const [sliceApplying, setSliceApplying] = useState(false);
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
  const selectedTargetCount = EXPRESSION_PRESETS[preset].cols * EXPRESSION_PRESETS[preset].rows;
  const singleImageMode = selectedTargetCount === 1;
  const cappedSelectedExpressions = useMemo(
    () => selectedExpressions.slice(0, selectedTargetCount),
    [selectedExpressions, selectedTargetCount],
  );
  const hasCurrentAvatarReference = !!defaultAvatarUrl;
  const maxUploadedReferenceImages = useCurrentAvatarReference && hasCurrentAvatarReference ? 3 : 4;
  const effectiveReferenceImages = useMemo(
    () =>
      [useCurrentAvatarReference && defaultAvatarUrl ? defaultAvatarUrl : null, ...referenceImages]
        .filter((img): img is string => !!img)
        .slice(0, 4),
    [defaultAvatarUrl, referenceImages, useCurrentAvatarReference],
  );

  // Auto-select first image connection
  const effectiveConnectionId = connectionId ?? imageConnections[0]?.id ?? null;

  useEffect(() => {
    if (!open) return;
    setSpriteType(initialSpriteType);
    setPreset(DEFAULT_SPRITE_PRESET);
    setSelectedExpressions(
      initialSpriteType === "full-body"
        ? [...FULL_BODY_POSE_PRESETS[DEFAULT_SPRITE_PRESET]]
        : [...EXPRESSION_PRESETS[DEFAULT_SPRITE_PRESET].expressions],
    );
  }, [open, initialSpriteType]);

  // Reset reference image & appearance when the target character changes
  useEffect(() => {
    setAppearance(defaultAppearance ?? "");
    setReferenceImages([]);
    setUseCurrentAvatarReference(!!defaultAvatarUrl);
    setStep(0);
    setGeneratedSheet(null);
    setCells([]);
    setSliceAdjustments(DEFAULT_SLICE_ADJUSTMENTS);
    setError(null);
  }, [entityId, defaultAvatarUrl, defaultAppearance]);

  // ── Handlers ──

  const handleReferenceUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () =>
        setReferenceImages((prev) =>
          prev.length < maxUploadedReferenceImages ? [...prev, reader.result as string] : prev,
        );
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [maxUploadedReferenceImages],
  );

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

  const toggleExpression = useCallback(
    (expr: string) => {
      setSelectedExpressions((prev) => {
        if (prev.includes(expr)) {
          return prev.filter((entry) => entry !== expr);
        }
        if (singleImageMode) {
          return [expr];
        }
        if (prev.length >= selectedTargetCount) {
          return [...prev.slice(1), expr];
        }
        return [...prev, expr];
      });
    },
    [selectedTargetCount, singleImageMode],
  );

  const handleGenerate = useCallback(async () => {
    if (spriteGenerationUnavailable || !effectiveConnectionId || cappedSelectedExpressions.length === 0) return;

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
        referenceImages: effectiveReferenceImages.length > 0 ? effectiveReferenceImages : undefined,
        expressions: cappedSelectedExpressions,
        cols,
        rows,
        spriteType,
        // Always return raw generation output first.
        // Cleanup is applied in preview so users can retry with different strengths.
        noBackground: false,
      });

      setGeneratedSheet(result.sheetBase64 ? `data:image/png;base64,${result.sheetBase64}` : null);
      setSliceAdjustments(DEFAULT_SLICE_ADJUSTMENTS);
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
    effectiveReferenceImages,
    cappedSelectedExpressions,
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

  const handleSliceAdjustmentChange = useCallback((key: keyof SliceAdjustments, value: number) => {
    setSliceAdjustments((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleResetSliceAdjustments = useCallback(() => {
    setSliceAdjustments(DEFAULT_SLICE_ADJUSTMENTS);
  }, []);

  const handleApplySliceAdjustments = useCallback(async () => {
    if (!generatedSheet || singleImageMode || cells.length === 0) return;

    setSliceApplying(true);
    setError(null);

    try {
      const image = new Image();
      image.src = generatedSheet;
      await image.decode();

      const { cols, rows } = EXPRESSION_PRESETS[preset];
      const marginXPx = Math.round((image.naturalWidth * sliceAdjustments.marginX) / 100);
      const marginYPx = Math.round((image.naturalHeight * sliceAdjustments.marginY) / 100);
      const gapXPx = Math.round((image.naturalWidth * sliceAdjustments.gapX) / 100);
      const gapYPx = Math.round((image.naturalHeight * sliceAdjustments.gapY) / 100);
      const cellWidth = Math.floor((image.naturalWidth - marginXPx * 2 - gapXPx * (cols - 1)) / cols);
      const cellHeight = Math.floor((image.naturalHeight - marginYPx * 2 - gapYPx * (rows - 1)) / rows);

      if (cellWidth <= 0 || cellHeight <= 0) {
        throw new Error("Slice settings leave no usable cell area");
      }

      const canvas = document.createElement("canvas");
      canvas.width = cellWidth;
      canvas.height = cellHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is unavailable");

      const nextCells = cells.map((cell, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const sx = marginXPx + col * (cellWidth + gapXPx);
        const sy = marginYPx + row * (cellHeight + gapYPx);

        ctx.clearRect(0, 0, cellWidth, cellHeight);
        ctx.drawImage(image, sx, sy, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);
        const dataUrl = canvas.toDataURL("image/png");

        return {
          ...cell,
          rawDataUrl: dataUrl,
          dataUrl,
        };
      });

      setCells(nextCells);
      setCleanupApplied(false);
    } catch (err: any) {
      setError(err?.message || "Failed to adjust sprite slices");
    } finally {
      setSliceApplying(false);
    }
  }, [cells, generatedSheet, preset, singleImageMode, sliceAdjustments]);

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
    setSliceAdjustments(DEFAULT_SLICE_ADJUSTMENTS);
    setSliceApplying(false);
    setError(null);
  }, []);

  const selectedCount = cells.filter((c) => c.selected).length;

  // ── Render ──

  return (
    <Modal open={open} onClose={onClose} title="Generate Sprites" width="max-w-2xl">
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
            {hasCurrentAvatarReference && (
              <label className="mb-2 flex items-center gap-3 rounded-lg bg-[var(--secondary)]/60 p-2.5 text-xs text-[var(--foreground)] ring-1 ring-[var(--border)]/60">
                <input
                  type="checkbox"
                  checked={useCurrentAvatarReference}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setUseCurrentAvatarReference(enabled);
                    if (enabled) {
                      setReferenceImages((prev) => prev.slice(0, 3));
                    }
                  }}
                  className="accent-[var(--primary)]"
                />
                <img
                  src={defaultAvatarUrl ?? ""}
                  alt="Current avatar reference"
                  className="h-12 w-12 rounded-lg object-cover ring-1 ring-[var(--border)]"
                />
                <span className="flex-1">Use current avatar as a reference image</span>
              </label>
            )}
            <div className="flex items-start gap-3">
              <div className="flex flex-wrap gap-2">
                {useCurrentAvatarReference && defaultAvatarUrl && (
                  <div className="relative">
                    <img
                      src={defaultAvatarUrl}
                      alt="Current avatar reference"
                      className="h-20 w-20 rounded-lg object-cover ring-2 ring-[var(--primary)]/40"
                    />
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[0.5625rem] text-white">
                      Avatar
                    </span>
                  </div>
                )}
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
                {referenceImages.length < maxUploadedReferenceImages && (
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
                <div className="flex flex-wrap gap-2">
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
                  {singleImageMode
                    ? "Generate one portrait sprite. Pick the expression you want to render."
                    : `Select exactly ${selectedTargetCount} expressions for a ${EXPRESSION_PRESETS[preset].cols}×${EXPRESSION_PRESETS[preset].rows} grid. Extra or fewer expressions will be adjusted.`}
                </p>
              </div>
            </>
          )}

          {/* Full-body options */}
          {spriteType === "full-body" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--foreground)]">Pose Count</label>
                <div className="flex flex-wrap gap-2">
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
                  {singleImageMode
                    ? "Generate one full-body pose image. Pick the pose you want to render."
                    : `Select exactly ${selectedTargetCount} general poses for a ${EXPRESSION_PRESETS[preset].cols}×${EXPRESSION_PRESETS[preset].rows} full-body sheet.`}
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
              {spriteType === "full-body"
                ? singleImageMode
                  ? "Generate Pose"
                  : "Generate Pose Sheet"
                : singleImageMode
                  ? "Generate Sprite"
                  : "Generate Sheet"}
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
              {spriteType === "full-body"
                ? singleImageMode
                  ? "Generating full-body pose…"
                  : "Generating full-body pose sheet…"
                : singleImageMode
                  ? "Generating portrait sprite…"
                  : "Generating expression sheet…"}
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {spriteType === "full-body"
                ? singleImageMode
                  ? "This may take 30–60 seconds depending on the provider."
                  : "This may take 30–60 seconds depending on the provider. The sheet will be sliced into poses after generation."
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
                {singleImageMode ? "View generated source image" : "View full generated sheet"}
              </summary>
              <img
                src={generatedSheet}
                alt={
                  singleImageMode
                    ? "Generated sprite source image"
                    : spriteType === "full-body"
                      ? "Generated full-body pose sheet"
                      : "Generated expression sheet"
                }
                className="mt-2 w-full rounded-lg ring-1 ring-[var(--border)]"
              />
            </details>
          )}

          {generatedSheet && !singleImageMode && (
            <div className="rounded-lg bg-[var(--secondary)]/60 p-2.5 ring-1 ring-[var(--border)]/60">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium text-[var(--foreground)]">Adjust Slice</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleResetSliceAdjustments}
                    disabled={sliceApplying}
                    className="rounded-lg px-2.5 py-1 text-[0.6875rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={handleApplySliceAdjustments}
                    disabled={sliceApplying}
                    className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[0.6875rem] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                  >
                    {sliceApplying ? "Applying..." : "Apply Slice"}
                  </button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["marginX", "Side margin"],
                    ["marginY", "Top/bottom margin"],
                    ["gapX", "Column gap"],
                    ["gapY", "Row gap"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                    <span className="w-24 shrink-0 text-[var(--foreground)]">{label}</span>
                    <input
                      type="range"
                      min={0}
                      max={8}
                      step={0.1}
                      value={sliceAdjustments[key]}
                      onChange={(e) => handleSliceAdjustmentChange(key, Number(e.target.value))}
                      className="min-w-0 flex-1 accent-[var(--primary)]"
                    />
                    <span className="w-10 text-right tabular-nums">{sliceAdjustments[key].toFixed(1)}%</span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[0.625rem] text-[var(--muted-foreground)]">
                Use this when the generated sheet has borders, gutters, or uneven spacing. Applying re-slices the
                original sheet without regenerating.
              </p>
            </div>
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
