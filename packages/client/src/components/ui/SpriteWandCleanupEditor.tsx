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
  Eraser,
  Hand,
  Loader2,
  Minus,
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
  removeConnectedColor,
  removeConnectedColorDecontaminate,
  removeConnectedColorSoftEdge,
  rgbaAt,
  type BrushMode,
  type CanvasPoint,
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
  color: [number, number, number, number];
}

type CleanupTool = "wand" | "erase" | "restore" | "blur" | "pan";
type PreviewBackground = "checker" | "dark" | "light" | "pink";

interface PaintGesture {
  pointerId: number;
  before: ImageData;
  lastPoint: CanvasPoint;
  changedPixels: number;
  mode: BrushMode;
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

const DEFAULT_TOLERANCE = 36;
const DEFAULT_BRUSH_SIZE = 18;
const DEFAULT_ERASER_HARDNESS = 100;
const DEFAULT_BLUR_STRENGTH = 65;
const DEFAULT_EDGE_SOFTNESS = 60;
const DEFAULT_EDGE_DECONTAMINATE = 0;
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
  { key: "checker", label: "Grid" },
  { key: "dark", label: "Dark" },
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
  { tool: "erase", label: "Erase", title: "Paint pixels transparent", Icon: Eraser },
  { tool: "restore", label: "Restore", title: "Paint original pixels back in", Icon: Brush },
  { tool: "blur", label: "Blur", title: "Paint alpha smoothing over jagged edges", Icon: Blend },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
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
  className = "min-w-0 flex-1",
  inputClassName = "min-w-24",
  before,
  after,
}: RangeControlProps) {
  return (
    <label className={`flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs ${className}`} title={title}>
      <span className="shrink-0 font-medium text-[var(--foreground)]">{label}</span>
      {before}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={disabled}
        className={`${inputClassName} flex-1 accent-[var(--primary)] disabled:opacity-50`}
      />
      {after}
      <span className="w-8 shrink-0 text-right tabular-nums text-[var(--muted-foreground)]">{value}</span>
    </label>
  );
}

function ToggleControl({ label, checked, disabled, onChange, title }: ToggleControlProps) {
  return (
    <label
      className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs font-medium text-[var(--foreground)]"
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
  const paintGestureRef = useRef<PaintGesture | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);

  const [tool, setTool] = useState<CleanupTool>("wand");
  const [classicStrong, setClassicStrong] = useState(false);
  const [cleanEdge, setCleanEdge] = useState(false);
  const [previewBackground, setPreviewBackground] = useState<PreviewBackground>("checker");
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [edgeSoftness, setEdgeSoftness] = useState(DEFAULT_EDGE_SOFTNESS);
  const [edgeDecontaminate, setEdgeDecontaminate] = useState(DEFAULT_EDGE_DECONTAMINATE);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [eraserHardness, setEraserHardness] = useState(DEFAULT_ERASER_HARDNESS);
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
      let result: WandResult;
      if (cleanEdge) {
        const cleanupTolerance = classicStrong ? Math.min(224, Math.round(tolerance * 1.65)) : tolerance;
        result =
          edgeDecontaminate > 0
            ? removeConnectedColorDecontaminate(
                next,
                point.x,
                point.y,
                cleanupTolerance,
                edgeDecontaminate,
                edgeSoftness,
              )
            : removeConnectedColorSoftEdge(next, point.x, point.y, cleanupTolerance, edgeSoftness, edgeSoftness);
      } else {
        const selectionTolerance = classicStrong ? Math.min(224, Math.round(tolerance * 1.65)) : tolerance;
        result = removeConnectedColor(next, point.x, point.y, selectionTolerance, classicStrong ? "all" : "cardinal");
      }

      if (result.removed === 0) {
        setStatus("No opaque pixels selected");
        return;
      }

      pushHistory(before);
      currentImageRef.current = next;
      putCurrentImage();
      setHasChanges(true);
      const optionLabel = [
        classicStrong ? "strong" : null,
        cleanEdge
          ? `clean edge (${edgeSoftness}% softness${edgeDecontaminate > 0 ? `, ${edgeDecontaminate}% decontaminate` : ""})`
          : null,
      ]
        .filter(Boolean)
        .join(", ");
      const modeLabel = optionLabel ? `wand (${optionLabel})` : "wand";
      setStatus(`${result.removed.toLocaleString()} px removed with ${modeLabel} from ${formatRgba(result.target)}`);
      setError(null);
    },
    [
      classicStrong,
      cleanEdge,
      edgeDecontaminate,
      edgeSoftness,
      pushHistory,
      putCurrentImage,
      tolerance,
    ],
  );

  const commitPaintGesture = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      const gesture = paintGestureRef.current;
      if (!gesture) return;

      paintGestureRef.current = null;
      if (canvas?.hasPointerCapture(gesture.pointerId)) {
        canvas.releasePointerCapture(gesture.pointerId);
      }

      if (gesture.changedPixels === 0) {
        setStatus("No pixels changed");
        return;
      }

      pushHistory(gesture.before);
      setHasChanges(true);
      const actionLabel =
        gesture.mode === "erase" ? "erased" : gesture.mode === "restore" ? "restored" : "edge-blurred";
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

      if (tool === "wand") {
        applyWandAtPoint(point);
        return;
      }

      const current = currentImageRef.current;
      if (!current) return;

      const mode: BrushMode = tool === "erase" ? "erase" : tool === "restore" ? "restore" : "blur";
      const radius = Math.max(1, brushSize / 2);
      const before = cloneImageData(current);
      const changedPixels = applyBrushStamp(
        current,
        originalImageRef.current,
        point.x,
        point.y,
        radius,
        mode,
        eraserHardness,
        blurStrength,
      );
      putCurrentImage();

      paintGestureRef.current = {
        pointerId: event.pointerId,
        before,
        lastPoint: point,
        changedPixels,
        mode,
      };
      canvas.setPointerCapture(event.pointerId);
    },
    [applyWandAtPoint, applying, blurStrength, brushSize, eraserHardness, loading, putCurrentImage, tool, updateHoverPoint],
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
      const paintGesture = paintGestureRef.current;
      const current = currentImageRef.current;
      if (!point || !paintGesture || paintGesture.pointerId !== event.pointerId || !current) return;

      const radius = Math.max(1, brushSize / 2);
      paintGesture.changedPixels += applyBrushLine(
        current,
        originalImageRef.current,
        paintGesture.lastPoint,
        point,
        radius,
        paintGesture.mode,
        eraserHardness,
        blurStrength,
      );
      paintGesture.lastPoint = point;
      putCurrentImage();
    },
    [blurStrength, brushSize, eraserHardness, putCurrentImage, updateHoverPoint],
  );

  const handleCanvasPointerUp = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    commitPaintGesture(event.currentTarget);
    commitPanGesture(event.currentTarget);
  }, [commitPaintGesture, commitPanGesture]);

  const handleCanvasPointerCancel = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    commitPaintGesture(event.currentTarget);
    commitPanGesture(event.currentTarget);
  }, [commitPaintGesture, commitPanGesture]);

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

  const reticleStyle = useMemo<CSSProperties | null>(() => {
    if (!hoverPoint) return null;
    const diameter =
      tool === "erase" || tool === "restore" || tool === "blur"
        ? Math.max(8, brushSize * zoom)
        : Math.max(12, 12 * zoom);
    return {
      width: `${diameter}px`,
      height: `${diameter}px`,
      left: `${(hoverPoint.x + 0.5) * zoom}px`,
      top: `${(hoverPoint.y + 0.5) * zoom}px`,
      transform: "translate(-50%, -50%)",
    };
  }, [brushSize, hoverPoint, tool, zoom]);

  const cursorClass =
    tool === "pan"
      ? "cursor-grab active:cursor-grabbing"
      : tool === "wand"
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
              onClick={() => setTool(optionTool)}
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
              onClick={() => setTool("pan")}
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
                <RangeControl
                  label="Tolerance"
                  min={4}
                  max={128}
                  value={tolerance}
                  onChange={setTolerance}
                  disabled={loading || applying}
                  inputClassName="min-w-28"
                />
                <ToggleControl
                  label="Strong"
                  checked={classicStrong}
                  onChange={setClassicStrong}
                  disabled={loading || applying}
                  title="Use diagonal fill with boosted tolerance"
                />
                <ToggleControl
                  label="Clean Edge"
                  checked={cleanEdge}
                  onChange={setCleanEdge}
                  disabled={loading || applying}
                  title="Run edge cleanup after clearing the wand selection"
                />
                {cleanEdge && (
                  <>
                    <RangeControl
                      label="Softness"
                      min={0}
                      max={100}
                      value={edgeSoftness}
                      onChange={setEdgeSoftness}
                      disabled={loading || applying}
                      title="How much alpha smoothing to apply near the kept edge"
                      className="min-w-48 flex-1"
                    />
                    <RangeControl
                      label="Decontaminate"
                      min={0}
                      max={100}
                      value={edgeDecontaminate}
                      onChange={setEdgeDecontaminate}
                      disabled={loading || applying}
                      title="How much dirty matte color to pull out of anti-aliased edge pixels"
                      className="min-w-48 flex-1"
                    />
                  </>
                )}
              </>
            )}

            {(tool === "erase" || tool === "restore" || tool === "blur") && (
              <>
                <RangeControl
                  label="Brush"
                  min={2}
                  max={96}
                  value={brushSize}
                  onChange={setBrushSize}
                  disabled={loading || applying}
                  inputClassName="min-w-28"
                  before={<Minus size="0.75rem" className="text-[var(--muted-foreground)]" />}
                  after={<Plus size="0.75rem" className="text-[var(--muted-foreground)]" />}
                />
                {tool === "erase" && (
                  <RangeControl
                    label="Hardness"
                    min={0}
                    max={100}
                    value={eraserHardness}
                    onChange={setEraserHardness}
                    disabled={loading || applying}
                    title="How crisp the eraser edge should be"
                    className="min-w-48 flex-1"
                  />
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
                title="Edit sprite transparency"
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
