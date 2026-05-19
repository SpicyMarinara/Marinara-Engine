import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  Blend,
  Brush,
  Crosshair,
  Eraser,
  Hand,
  Loader2,
  Minus,
  Pipette,
  Plus,
  RotateCcw,
  Undo2,
  Wand2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import {
  applyBrushLine,
  applyBrushStamp,
  cloneImageData,
  formatRgba,
  removeWandSelection,
  rgbaAt,
  type BrushMode,
  type BrushStrokeOptions,
  type CanvasPoint,
  type Rgba,
  type WandResult,
} from "../../lib/sprite-cleanup-tools";
import { Modal } from "./Modal";

interface SpriteWandCleanupEditorProps {
  imageUrl: string;
  label: string;
  applying?: boolean;
  onApply: (cleanedDataUrl: string) => Promise<void> | void;
  onClose: () => void;
}

interface HoverPoint extends CanvasPoint {
  color: Rgba;
}

type CleanupTool = "wand" | "clean" | "erase" | "brush" | "blur" | "pan";
type BrushToolMode = "paint" | "restore";
type PreviewBackground = "checker" | "dark" | "light" | "pink";

interface BrushGesture {
  pointerId: number;
  before: ImageData;
  lastPoint: CanvasPoint;
  changedPixels: number;
  options: BrushStrokeOptions;
}

interface PanGesture {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
}

interface RangeControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
  step?: number;
  title?: string;
  className?: string;
  inputClassName?: string;
  before?: ReactNode;
  after?: ReactNode;
}

interface ToggleControlProps {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
}

interface BrushStrokeBuildInput {
  mode: BrushMode;
  radius: number;
  brushHardness: number;
  brushOpacity: number;
  blurStrength: number;
  cleanTarget: Rgba;
  cleanTolerance: number;
  cleanEdgeGuard: number;
  cleanFeather: number;
  brushColor: string;
}

const DEFAULT_TOLERANCE = 36;
const DEFAULT_BRUSH_SIZE = 18;
const DEFAULT_BRUSH_HARDNESS = 100;
const DEFAULT_BRUSH_OPACITY = 100;
const DEFAULT_BRUSH_COLOR = "#ffffff";
const DEFAULT_BLUR_STRENGTH = 65;
const DEFAULT_CLEAN_TOLERANCE = 36;
const DEFAULT_CLEAN_EDGE_GUARD = 45;
const DEFAULT_CLEAN_FEATHER = 8;
const DEFAULT_WAND_STRONG = false;
const DEFAULT_WAND_SOFTNESS = 55;
const DEFAULT_WAND_FEATHER = 12;
const WAND_EDGE_GUARD = 55;
const STRONG_WAND_EDGE_GUARD = 28;
const WAND_EXPAND = 1;
const STRONG_WAND_EXPAND = 2;
const MAX_HISTORY = 12;
const MIN_ZOOM = 0.125;
const MAX_ZOOM = 8;

const checkerboardStyle: CSSProperties = {
  backgroundColor: "var(--secondary)",
  backgroundImage:
    "linear-gradient(45deg, var(--border) 25%, transparent 25%), linear-gradient(-45deg, var(--border) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--border) 75%), linear-gradient(-45deg, transparent 75%, var(--border) 75%)",
  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
  backgroundSize: "20px 20px",
};

const previewBackgroundStyles: Record<PreviewBackground, CSSProperties> = {
  checker: checkerboardStyle,
  dark: { backgroundColor: "#161321" },
  light: { backgroundColor: "#f3eef8" },
  pink: { backgroundColor: "#ff4fa3" },
};

const previewBackgroundOptions: Array<{ key: PreviewBackground; label: string }> = [
  { key: "dark", label: "Dark" },
  { key: "checker", label: "Grid" },
  { key: "light", label: "Light" },
  { key: "pink", label: "Pink" },
];

const cleanupToolOptions: Array<{
  tool: Exclude<CleanupTool, "pan">;
  label: string;
  title: string;
  Icon: LucideIcon;
}> = [
  { tool: "wand", label: "Wand", title: "Select connected pixels", Icon: Wand2 },
  { tool: "clean", label: "Clean", title: "Brush away pixels matching the sampled color", Icon: Crosshair },
  { tool: "erase", label: "Erase", title: "Paint pixels transparent", Icon: Eraser },
  { tool: "brush", label: "Brush", title: "Paint color or restore original pixels", Icon: Brush },
  { tool: "blur", label: "Blur", title: "Paint alpha smoothing over jagged edges", Icon: Blend },
];

const brushActionLabels: Record<BrushMode, string> = {
  clean: "target-cleaned",
  erase: "erased",
  paint: "painted",
  restore: "restored",
  blur: "edge-blurred",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function cleanupToolToBrushMode(tool: CleanupTool, brushToolMode: BrushToolMode): BrushMode | null {
  switch (tool) {
    case "clean":
    case "erase":
    case "blur":
      return tool;
    case "brush":
      return brushToolMode;
    default:
      return null;
  }
}

function usesOpacityHardnessControls(tool: CleanupTool): boolean {
  return tool === "erase" || tool === "brush";
}

function brushOpacityTitle(mode: BrushMode | null): string {
  switch (mode) {
    case "paint":
      return "How much color each brush stroke applies";
    case "restore":
      return "How strongly each stroke restores the original sprite";
    default:
      return "How much alpha each eraser stroke removes";
  }
}

function brushHardnessTitle(mode: BrushMode | null): string {
  switch (mode) {
    case "paint":
      return "How crisp the brush edge should be";
    case "restore":
      return "How crisp the restore brush edge should be";
    default:
      return "How crisp the eraser edge should be";
  }
}

function colorComponentToHex(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
}

function rgbaToHex(color: Rgba): string {
  return `#${colorComponentToHex(color[0])}${colorComponentToHex(color[1])}${colorComponentToHex(color[2])}`;
}

function hexToRgba(hex: string): Rgba {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_BRUSH_COLOR;
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
    255,
  ];
}

function createBrushStrokeOptions({
  mode,
  radius,
  brushHardness,
  brushOpacity,
  blurStrength,
  cleanTarget,
  cleanTolerance,
  cleanEdgeGuard,
  cleanFeather,
  brushColor,
}: BrushStrokeBuildInput): BrushStrokeOptions {
  switch (mode) {
    case "clean":
      return {
        mode,
        radius,
        clean: {
          target: cleanTarget,
          tolerance: cleanTolerance,
          edgeGuard: cleanEdgeGuard,
          feather: cleanFeather,
        },
      };
    case "paint":
      return {
        mode,
        radius,
        hardness: brushHardness,
        opacity: brushOpacity,
        paint: { color: hexToRgba(brushColor) },
      };
    case "blur":
      return { mode, radius, blurStrength };
    case "erase":
    case "restore":
      return { mode, radius, hardness: brushHardness, opacity: brushOpacity };
  }
}

function clampZoom(value: number): number {
  return clamp(value, MIN_ZOOM, MAX_ZOOM);
}

function RangeControl({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
  step = 1,
  title,
  className = "min-w-[12rem] flex-[1_1_12rem]",
  inputClassName = "min-w-0",
  before,
  after,
}: RangeControlProps) {
  return (
    <label
      className={`flex min-w-0 items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs ${className}`}
      title={title}
    >
      <span className="shrink-0 whitespace-nowrap font-medium text-[var(--foreground)]">{label}</span>
      {before}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={disabled}
        className={`${inputClassName} min-w-0 flex-1 accent-[var(--primary)] disabled:opacity-50`}
      />
      {after}
      <span className="w-8 shrink-0 text-right tabular-nums text-[var(--muted-foreground)]">{value}</span>
    </label>
  );
}

function ToggleControl({ label, checked, disabled, onChange, title }: ToggleControlProps) {
  return (
    <label
      className="flex min-w-fit items-center gap-2 whitespace-nowrap rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium text-[var(--foreground)]"
      title={title}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="h-4 w-4 accent-[var(--primary)] disabled:opacity-50"
      />
      {label}
    </label>
  );
}

async function loadImageToCanvas(imageUrl: string, canvas: HTMLCanvasElement): Promise<ImageData> {
  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("Sprite image could not be loaded");

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Sprite image could not be decoded"));
      img.src = objectUrl;
    });

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    if (canvas.width <= 0 || canvas.height <= 0) throw new Error("Sprite image has no usable size");

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas is unavailable");

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function SpriteWandCleanupEditor({
  imageUrl,
  label,
  applying = false,
  onApply,
  onClose,
}: SpriteWandCleanupEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalImageRef = useRef<ImageData | null>(null);
  const currentImageRef = useRef<ImageData | null>(null);
  const brushGestureRef = useRef<BrushGesture | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);

  const [tool, setTool] = useState<CleanupTool>("wand");
  const [previewBackground, setPreviewBackground] = useState<PreviewBackground>("dark");
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [wandStrong, setWandStrong] = useState(DEFAULT_WAND_STRONG);
  const [wandSoftness, setWandSoftness] = useState(DEFAULT_WAND_SOFTNESS);
  const [wandFeather, setWandFeather] = useState(DEFAULT_WAND_FEATHER);
  const [cleanTolerance, setCleanTolerance] = useState(DEFAULT_CLEAN_TOLERANCE);
  const [cleanEdgeGuard, setCleanEdgeGuard] = useState(DEFAULT_CLEAN_EDGE_GUARD);
  const [cleanFeather, setCleanFeather] = useState(DEFAULT_CLEAN_FEATHER);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [brushHardness, setBrushHardness] = useState(DEFAULT_BRUSH_HARDNESS);
  const [brushOpacity, setBrushOpacity] = useState(DEFAULT_BRUSH_OPACITY);
  const [brushToolMode, setBrushToolMode] = useState<BrushToolMode>("paint");
  const [brushColor, setBrushColor] = useState(DEFAULT_BRUSH_COLOR);
  const [pickingBrushColor, setPickingBrushColor] = useState(false);
  const [blurStrength, setBlurStrength] = useState(DEFAULT_BLUR_STRENGTH);
  const [zoom, setZoom] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [hoverPoint, setHoverPoint] = useState<HoverPoint | null>(null);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const putCurrentImage = useCallback(() => {
    const canvas = canvasRef.current;
    const imageData = currentImageRef.current;
    if (!canvas || !imageData) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.putImageData(imageData, 0, 0);
  }, []);

  const restoreImageData = useCallback(
    (imageData: ImageData) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const next = cloneImageData(imageData);
      canvas.width = next.width;
      canvas.height = next.height;
      currentImageRef.current = next;
      setCanvasSize({ width: next.width, height: next.height });
      putCurrentImage();
    },
    [putCurrentImage],
  );

  const fitCanvasToStage = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || canvas.width <= 0 || canvas.height <= 0) return;

    const availableWidth = Math.max(1, stage.clientWidth - 32);
    const availableHeight = Math.max(1, stage.clientHeight - 32);
    const nextZoom = Math.min(1, availableWidth / canvas.width, availableHeight / canvas.height);
    setZoom(clampZoom(nextZoom));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let frameId: number | null = null;

    setLoading(true);
    setError(null);
    setStatus(null);
    setHasChanges(false);
    setHistory([]);
    setHoverPoint(null);
    setPickingBrushColor(false);
    setZoom(1);
    originalImageRef.current = null;
    currentImageRef.current = null;

    const loadWhenCanvasMounts = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        frameId = requestAnimationFrame(loadWhenCanvasMounts);
        return;
      }

      loadImageToCanvas(imageUrl, canvas)
        .then((imageData) => {
          if (cancelled) return;
          originalImageRef.current = cloneImageData(imageData);
          restoreImageData(imageData);
          setLoading(false);
          requestAnimationFrame(fitCanvasToStage);
        })
        .catch((err: any) => {
          if (cancelled) return;
          setError(err?.message || "Sprite image could not be loaded");
          setLoading(false);
        });
    };

    frameId = requestAnimationFrame(loadWhenCanvasMounts);

    return () => {
      cancelled = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [fitCanvasToStage, imageUrl, restoreImageData]);

  const canvasPointFromClient = useCallback((clientX: number, clientY: number): CanvasPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const normalizedX = (clientX - rect.left) / rect.width;
    const normalizedY = (clientY - rect.top) / rect.height;
    if (normalizedX < 0 || normalizedY < 0 || normalizedX > 1 || normalizedY > 1) return null;

    return {
      x: clamp(Math.floor(normalizedX * canvas.width), 0, canvas.width - 1),
      y: clamp(Math.floor(normalizedY * canvas.height), 0, canvas.height - 1),
    };
  }, []);

  const updateHoverPoint = useCallback(
    (event: PointerEvent<HTMLCanvasElement>): CanvasPoint | null => {
      const point = canvasPointFromClient(event.clientX, event.clientY);
      const imageData = currentImageRef.current;

      if (!point || !imageData) {
        setHoverPoint(null);
        return null;
      }

      setHoverPoint({ ...point, color: rgbaAt(imageData, point) });
      return point;
    },
    [canvasPointFromClient],
  );

  const pushHistory = useCallback((snapshot: ImageData) => {
    setHistory((prev) => [...prev.slice(Math.max(0, prev.length - MAX_HISTORY + 1)), snapshot]);
  }, []);

  const applyWandAtPoint = useCallback(
    (point: CanvasPoint) => {
      const current = currentImageRef.current;
      if (!current) return;

      const before = cloneImageData(current);
      const next = cloneImageData(current);
      const selectionTolerance = wandStrong ? Math.min(224, Math.round(tolerance * 1.55)) : tolerance;
      const result: WandResult = removeWandSelection(next, point.x, point.y, selectionTolerance, {
        mode: "connected",
        radius: 0,
        edgeGuard: wandStrong ? STRONG_WAND_EDGE_GUARD : WAND_EDGE_GUARD,
        expand: wandStrong ? STRONG_WAND_EXPAND : WAND_EXPAND,
        softness: wandSoftness,
        feather: wandFeather,
      });

      if (result.removed === 0) {
        setStatus("No opaque pixels selected");
        return;
      }

      pushHistory(before);
      currentImageRef.current = next;
      putCurrentImage();
      setHasChanges(true);
      const modeLabel = `${wandStrong ? "strong " : ""}wand (${wandSoftness}% softness, ${wandFeather}% feather)`;
      setStatus(`${result.removed.toLocaleString()} px removed with ${modeLabel} from ${formatRgba(result.target)}`);
      setError(null);
    },
    [
      pushHistory,
      putCurrentImage,
      tolerance,
      wandFeather,
      wandSoftness,
      wandStrong,
    ],
  );

  const commitBrushGesture = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      const gesture = brushGestureRef.current;
      if (!gesture) return;

      brushGestureRef.current = null;
      if (canvas?.hasPointerCapture(gesture.pointerId)) {
        canvas.releasePointerCapture(gesture.pointerId);
      }

      if (gesture.changedPixels === 0) {
        setStatus("No pixels changed");
        return;
      }

      pushHistory(gesture.before);
      setHasChanges(true);
      const actionLabel = brushActionLabels[gesture.options.mode];
      setStatus(`${gesture.changedPixels.toLocaleString()} px ${actionLabel}`);
      setError(null);
    },
    [pushHistory],
  );

  const commitPanGesture = useCallback((canvas: HTMLCanvasElement | null) => {
    const gesture = panGestureRef.current;
    if (!gesture) return;

    panGestureRef.current = null;
    if (canvas?.hasPointerCapture(gesture.pointerId)) {
      canvas.releasePointerCapture(gesture.pointerId);
    }
  }, []);

  const handleCanvasPointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (loading || applying) return;

      event.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (tool === "pan") {
        const stage = stageRef.current;
        if (!stage) return;

        panGestureRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startScrollLeft: stage.scrollLeft,
          startScrollTop: stage.scrollTop,
        };
        canvas.setPointerCapture(event.pointerId);
        setStatus("Panning");
        return;
      }

      const point = updateHoverPoint(event);
      if (!point) return;

      const current = currentImageRef.current;
      if (tool === "brush" && brushToolMode === "paint" && pickingBrushColor) {
        if (!current) return;

        const sampledColor = rgbaAt(current, point);
        setBrushColor(rgbaToHex(sampledColor));
        setPickingBrushColor(false);
        setStatus(`Brush color picked: ${formatRgba(sampledColor)}`);
        setError(null);
        return;
      }

      if (tool === "wand") {
        applyWandAtPoint(point);
        return;
      }

      if (!current) return;

      const mode = cleanupToolToBrushMode(tool, brushToolMode);
      if (!mode) return;

      const radius = Math.max(1, brushSize / 2);
      const brushOptions = createBrushStrokeOptions({
        mode,
        radius,
        brushHardness,
        brushOpacity,
        blurStrength,
        cleanTarget: rgbaAt(current, point),
        cleanTolerance,
        cleanEdgeGuard,
        cleanFeather,
        brushColor,
      });
      const before = cloneImageData(current);
      const changedPixels = applyBrushStamp(
        current,
        originalImageRef.current,
        point.x,
        point.y,
        brushOptions,
      );
      putCurrentImage();

      brushGestureRef.current = {
        pointerId: event.pointerId,
        before,
        lastPoint: point,
        changedPixels,
        options: brushOptions,
      };
      canvas.setPointerCapture(event.pointerId);
    },
    [
      applyWandAtPoint,
      applying,
      blurStrength,
      brushColor,
      brushSize,
      brushToolMode,
      cleanEdgeGuard,
      cleanFeather,
      cleanTolerance,
      brushHardness,
      brushOpacity,
      loading,
      pickingBrushColor,
      putCurrentImage,
      tool,
      updateHoverPoint,
    ],
  );

  const handleCanvasPointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const panGesture = panGestureRef.current;
      if (panGesture && panGesture.pointerId === event.pointerId) {
        const stage = stageRef.current;
        if (stage) {
          stage.scrollLeft = panGesture.startScrollLeft - (event.clientX - panGesture.startClientX);
          stage.scrollTop = panGesture.startScrollTop - (event.clientY - panGesture.startClientY);
        }
        return;
      }

      const point = updateHoverPoint(event);
      const brushGesture = brushGestureRef.current;
      const current = currentImageRef.current;
      if (!point || !brushGesture || brushGesture.pointerId !== event.pointerId || !current) return;

      brushGesture.changedPixels += applyBrushLine(
        current,
        originalImageRef.current,
        brushGesture.lastPoint,
        point,
        brushGesture.options,
      );
      brushGesture.lastPoint = point;
      putCurrentImage();
    },
    [putCurrentImage, updateHoverPoint],
  );

  const handleCanvasPointerUp = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    commitBrushGesture(event.currentTarget);
    commitPanGesture(event.currentTarget);
  }, [commitBrushGesture, commitPanGesture]);

  const handleCanvasPointerCancel = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    commitBrushGesture(event.currentTarget);
    commitPanGesture(event.currentTarget);
  }, [commitBrushGesture, commitPanGesture]);

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      const previous = prev[prev.length - 1];
      if (!previous) return prev;

      restoreImageData(previous);
      const nextHistory = prev.slice(0, -1);
      setHasChanges(nextHistory.length > 0);
      setStatus("Undo applied");
      setError(null);
      return nextHistory;
    });
  }, [restoreImageData]);

  const handleReset = useCallback(() => {
    if (!originalImageRef.current) return;
    restoreImageData(originalImageRef.current);
    setHistory([]);
    setHasChanges(false);
    setStatus("Reset");
    setError(null);
  }, [restoreImageData]);

  const handleResetWandDefaults = useCallback(() => {
    setTolerance(DEFAULT_TOLERANCE);
    setWandStrong(DEFAULT_WAND_STRONG);
    setWandSoftness(DEFAULT_WAND_SOFTNESS);
    setWandFeather(DEFAULT_WAND_FEATHER);
    setStatus("Wand settings reset");
    setError(null);
  }, []);

  const handleSelectTool = useCallback((nextTool: CleanupTool) => {
    setTool(nextTool);
    if (nextTool !== "brush") {
      setPickingBrushColor(false);
    }
  }, []);

  const handleSelectBrushToolMode = useCallback((nextMode: BrushToolMode) => {
    setBrushToolMode(nextMode);
    if (nextMode !== "paint") {
      setPickingBrushColor(false);
    }
  }, []);

  const handleToggleBrushColorPicker = useCallback(() => {
    setPickingBrushColor((value) => {
      const next = !value;
      setStatus(next ? "Click the sprite to pick a brush color" : "Brush color picker canceled");
      setError(null);
      return next;
    });
  }, []);

  const handleApply = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      setError(null);
      await onApply(canvas.toDataURL("image/png"));
    } catch (err: any) {
      setError(err?.message || "Failed to save sprite cleanup");
    }
  }, [onApply]);

  const handleStageWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom((value) => clampZoom(value * factor));
  }, []);

  const zoomIn = useCallback(() => setZoom((value) => clampZoom(value * 1.25)), []);
  const zoomOut = useCallback(() => setZoom((value) => clampZoom(value / 1.25)), []);

  const canvasDisplayStyle = useMemo<CSSProperties>(
    () => ({
      width: canvasSize.width > 0 ? `${canvasSize.width * zoom}px` : undefined,
      height: canvasSize.height > 0 ? `${canvasSize.height * zoom}px` : undefined,
      imageRendering: zoom >= 2 ? "pixelated" : "auto",
    }),
    [canvasSize.height, canvasSize.width, zoom],
  );
  const activeBrushMode = cleanupToolToBrushMode(tool, brushToolMode);

  const reticleStyle = useMemo<CSSProperties | null>(() => {
    if (!hoverPoint) return null;
    const diameter =
      activeBrushMode && !pickingBrushColor ? Math.max(8, brushSize * zoom) : Math.max(12, 12 * zoom);
    return {
      width: `${diameter}px`,
      height: `${diameter}px`,
      left: `${(hoverPoint.x + 0.5) * zoom}px`,
      top: `${(hoverPoint.y + 0.5) * zoom}px`,
      transform: "translate(-50%, -50%)",
    };
  }, [activeBrushMode, brushSize, hoverPoint, pickingBrushColor, zoom]);

  const cursorClass =
    tool === "pan"
      ? "cursor-grab active:cursor-grabbing"
      : tool === "wand" || pickingBrushColor
        ? "cursor-crosshair"
        : "cursor-none";

  const toolButtonClass = (active: boolean) =>
    [
      "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ring-1 disabled:opacity-45",
      active
        ? "bg-[var(--primary)] text-[var(--primary-foreground)] ring-transparent"
        : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)] hover:text-[var(--foreground)]",
    ].join(" ");

  const navigationButtonClass = (active = false) =>
    [
      "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-45",
      active
        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
        : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
    ].join(" ");

  const hoverReadout = hoverPoint
    ? `x ${hoverPoint.x}, y ${hoverPoint.y} · ${formatRgba(hoverPoint.color)}`
    : "Move over the sprite to sample pixels";

  return (
    <Modal open onClose={onClose} title={`Clean ${label}`} width="max-w-6xl">
      <div className="flex h-[calc(100dvh-7rem)] min-h-0 flex-col gap-3 overflow-hidden sm:h-[min(44rem,calc(90dvh-6rem))]">
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {cleanupToolOptions.map(({ tool: optionTool, label: optionLabel, title, Icon }) => (
            <button
              key={optionTool}
              type="button"
              onClick={() => handleSelectTool(optionTool)}
              disabled={loading || applying}
              className={toolButtonClass(tool === optionTool)}
              title={title}
            >
              <Icon size="0.875rem" />
              {optionLabel}
            </button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-1 rounded-lg bg-[var(--secondary)] px-1.5 py-1">
            <button
              type="button"
              onClick={() => handleSelectTool("pan")}
              disabled={loading || applying}
              className={navigationButtonClass(tool === "pan")}
              aria-label="Pan"
              aria-pressed={tool === "pan"}
              title="Drag around while zoomed in"
            >
              <Hand size="0.875rem" />
            </button>
            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--border)]" />
            <button
              type="button"
              onClick={zoomOut}
              disabled={loading || applying}
              className={navigationButtonClass()}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOut size="0.875rem" />
            </button>
            <button
              type="button"
              onClick={fitCanvasToStage}
              disabled={loading || applying}
              className="h-7 rounded-md px-2 text-[0.6875rem] font-medium tabular-nums text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-45"
              title="Fit to view"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={zoomIn}
              disabled={loading || applying}
              className={navigationButtonClass()}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <ZoomIn size="0.875rem" />
            </button>
          </div>
        </div>

        <div className="grid shrink-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-wrap items-center gap-2">
            {tool === "wand" && (
              <>
                <button
                  type="button"
                  onClick={handleResetWandDefaults}
                  disabled={loading || applying}
                  className="inline-flex min-w-fit items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)] disabled:opacity-45"
                  title="Reset wand controls to their defaults"
                >
                  <RotateCcw size="0.875rem" />
                  Defaults
                </button>
                <RangeControl
                  label="Tolerance"
                  min={4}
                  max={128}
                  value={tolerance}
                  onChange={setTolerance}
                  disabled={loading || applying}
                  className="min-w-[12rem] flex-[1_1_12rem]"
                />
                <ToggleControl
                  label="Strong"
                  checked={wandStrong}
                  onChange={setWandStrong}
                  disabled={loading || applying}
                  title="Reach farther into matching debris"
                />
                <RangeControl
                  label="Softness"
                  min={0}
                  max={100}
                  value={wandSoftness}
                  onChange={setWandSoftness}
                  disabled={loading || applying}
                  title="0 is a hard cut; higher values leave a softer low-alpha edge"
                  className="min-w-[14rem] flex-[1_1_14rem]"
                />
                <RangeControl
                  label="Feather"
                  min={0}
                  max={100}
                  value={wandFeather}
                  onChange={setWandFeather}
                  disabled={loading || applying}
                  title="How much soft border the wand leaves behind, and how gradually it fades"
                  className="min-w-[14rem] flex-[1_1_14rem]"
                />
              </>
            )}

            {activeBrushMode && (
              <>
                <RangeControl
                  label="Brush"
                  min={2}
                  max={96}
                  value={brushSize}
                  onChange={setBrushSize}
                  disabled={loading || applying}
                  inputClassName="min-w-20"
                  before={<Minus size="0.75rem" className="text-[var(--muted-foreground)]" />}
                  after={<Plus size="0.75rem" className="text-[var(--muted-foreground)]" />}
                />
                {tool === "brush" && (
                  <div className="flex min-w-fit items-center gap-1 rounded-lg bg-[var(--secondary)] p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => handleSelectBrushToolMode("paint")}
                      disabled={loading || applying}
                      className={[
                        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors disabled:opacity-45",
                        brushToolMode === "paint"
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                      ].join(" ")}
                      aria-pressed={brushToolMode === "paint"}
                      title="Paint with the selected color"
                    >
                      <Brush size="0.75rem" />
                      Color
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectBrushToolMode("restore")}
                      disabled={loading || applying}
                      className={[
                        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors disabled:opacity-45",
                        brushToolMode === "restore"
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                      ].join(" ")}
                      aria-pressed={brushToolMode === "restore"}
                      title="Paint original pixels back in"
                    >
                      <Undo2 size="0.75rem" />
                      Restore
                    </button>
                  </div>
                )}
                {tool === "clean" && (
                  <>
                    <RangeControl
                      label="Tolerance"
                      min={4}
                      max={128}
                      value={cleanTolerance}
                      onChange={setCleanTolerance}
                      disabled={loading || applying}
                      title="How closely pixels must match the sampled cleanup color"
                      className="min-w-[12rem] flex-[1_1_12rem]"
                    />
                    <RangeControl
                      label="Edge Guard"
                      min={0}
                      max={100}
                      value={cleanEdgeGuard}
                      onChange={setCleanEdgeGuard}
                      disabled={loading || applying}
                      title="How strongly the brush avoids character-like edge pixels"
                      className="min-w-[16rem] flex-[1_1_16rem]"
                    />
                    <RangeControl
                      label="Feather"
                      min={0}
                      max={100}
                      value={cleanFeather}
                      onChange={setCleanFeather}
                      disabled={loading || applying}
                      title="Soften the edge of the cleaned brush stroke"
                      className="min-w-[14rem] flex-[1_1_14rem]"
                    />
                  </>
                )}
                {tool === "brush" && brushToolMode === "paint" && (
                  <div
                    className="flex min-w-fit items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs"
                    title="Brush color"
                  >
                    <span className="shrink-0 whitespace-nowrap font-medium text-[var(--foreground)]">Color</span>
                    <input
                      type="color"
                      value={brushColor}
                      onChange={(event) => {
                        setBrushColor(event.target.value);
                        setPickingBrushColor(false);
                      }}
                      disabled={loading || applying}
                      className="h-7 w-9 cursor-pointer rounded-md border border-[var(--border)] bg-transparent p-0.5 disabled:opacity-45"
                      aria-label="Brush color"
                    />
                    <span className="font-mono text-[0.6875rem] uppercase text-[var(--muted-foreground)]">
                      {brushColor}
                    </span>
                    <button
                      type="button"
                      onClick={handleToggleBrushColorPicker}
                      disabled={loading || applying}
                      className={[
                        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium ring-1 transition-colors disabled:opacity-45",
                        pickingBrushColor
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)] ring-transparent"
                          : "text-[var(--muted-foreground)] ring-[var(--border)] hover:text-[var(--foreground)]",
                      ].join(" ")}
                      aria-pressed={pickingBrushColor}
                      title="Pick brush color from the sprite"
                    >
                      <Pipette size="0.75rem" />
                      Pick
                    </button>
                  </div>
                )}
                {usesOpacityHardnessControls(tool) && (
                  <>
                    <RangeControl
                      label="Opacity"
                      min={0}
                      max={100}
                      value={brushOpacity}
                      onChange={setBrushOpacity}
                      disabled={loading || applying}
                      title={brushOpacityTitle(activeBrushMode)}
                      className="min-w-48 flex-1"
                    />
                    <RangeControl
                      label="Hardness"
                      min={0}
                      max={100}
                      value={brushHardness}
                      onChange={setBrushHardness}
                      disabled={loading || applying}
                      title={brushHardnessTitle(activeBrushMode)}
                      className="min-w-48 flex-1"
                    />
                  </>
                )}
                {tool === "blur" && (
                  <RangeControl
                    label="Strength"
                    min={0}
                    max={100}
                    value={blurStrength}
                    onChange={setBlurStrength}
                    disabled={loading || applying}
                    title="How strongly the blur brush smooths alpha edges"
                    className="min-w-48 flex-1"
                  />
                )}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[var(--secondary)] p-1">
            {previewBackgroundOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setPreviewBackground(option.key)}
                className={[
                  "rounded-md px-2 py-1 text-[0.6875rem] font-medium transition-colors",
                  previewBackground === option.key
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                ].join(" ")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div
            ref={stageRef}
            onWheel={handleStageWheel}
            className="relative flex h-full min-h-0 items-start justify-start overflow-auto rounded-xl border border-[var(--border)] p-3"
            style={previewBackgroundStyles[previewBackground]}
          >
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--background)]/60">
                <Loader2 size="1.5rem" className="animate-spin text-[var(--primary)]" />
              </div>
            )}
            <div
              className="relative mx-auto my-auto shrink-0 rounded-lg shadow-xl shadow-black/30"
              style={{
                width: canvasDisplayStyle.width,
                height: canvasDisplayStyle.height,
              }}
            >
              <canvas
                ref={canvasRef}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerCancel}
                onPointerLeave={() => setHoverPoint(null)}
                className={`block rounded-lg [touch-action:none] ${cursorClass}`}
                style={canvasDisplayStyle}
                aria-label={`Wand cleanup canvas for ${label}`}
                title={pickingBrushColor ? "Pick brush color" : "Edit sprite transparency"}
              />
              {reticleStyle && !loading && (
                <span
                  className="pointer-events-none absolute rounded-full border border-[var(--primary)] shadow-[0_0_0_1px_rgba(0,0,0,0.65),0_0_14px_rgba(255,179,217,0.35)]"
                  style={reticleStyle}
                />
              )}
            </div>
          </div>

        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 space-y-0.5 text-xs text-[var(--muted-foreground)]">
            <div>{error ? <span className="text-[var(--destructive)]">{error}</span> : (status ?? "Wand ready")}</div>
            <div className="font-mono text-[0.6875rem] text-[var(--muted-foreground)]/85">{hoverReadout}</div>
          </div>
          <button
            type="button"
            onClick={handleUndo}
            disabled={loading || applying || history.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)] disabled:opacity-45"
          >
            <Undo2 size="0.875rem" />
            Undo
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={loading || applying || !hasChanges}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)] disabled:opacity-45"
          >
            <RotateCcw size="0.875rem" />
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={loading || applying || !hasChanges}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {applying ? <Loader2 size="0.875rem" className="animate-spin" /> : <Eraser size="0.875rem" />}
            Apply Cleanup
          </button>
        </div>
      </div>
    </Modal>
  );
}
