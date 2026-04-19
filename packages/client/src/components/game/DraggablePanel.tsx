// ──────────────────────────────────────────────
// Game: Lock + drag helpers for HUD panels
//
// Each panel (widget cards, map) uses `useDraggablePanel`
// to persist a lock flag and {x,y} offset under its id.
// `PanelLockButton` renders the lock toggle in headers.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { useMotionValue } from "framer-motion";
import { Lock, Unlock } from "lucide-react";
import { cn } from "../../lib/utils";

const STORAGE_PREFIX = "marinara-game-panel:";

interface PanelState {
  locked: boolean;
  x: number;
  y: number;
}

function readPanelState(id: string): PanelState {
  if (typeof window === "undefined") return { locked: true, x: 0, y: 0 };
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return { locked: true, x: 0, y: 0 };
    const parsed = JSON.parse(raw) as Partial<PanelState>;
    return {
      locked: parsed.locked !== false,
      x: Number.isFinite(parsed.x) ? (parsed.x as number) : 0,
      y: Number.isFinite(parsed.y) ? (parsed.y as number) : 0,
    };
  } catch {
    return { locked: true, x: 0, y: 0 };
  }
}

function writePanelState(id: string, state: PanelState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(state));
  } catch {
    // quota / unavailable — best-effort only
  }
}

/** Returns motion values + lock state for a draggable HUD panel, persisted by id. */
export function useDraggablePanel(id: string) {
  const [locked, setLocked] = useState(true);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    const s = readPanelState(id);
    setLocked(s.locked);
    x.set(s.x);
    y.set(s.y);
  }, [id, x, y]);

  const toggleLocked = useCallback(() => {
    setLocked((prev) => {
      const next = !prev;
      writePanelState(id, { locked: next, x: x.get(), y: y.get() });
      return next;
    });
  }, [id, x, y]);

  const handleDragEnd = useCallback(() => {
    writePanelState(id, { locked, x: x.get(), y: y.get() });
  }, [id, locked, x, y]);

  return { locked, toggleLocked, x, y, handleDragEnd };
}

interface PanelLockButtonProps {
  locked: boolean;
  onToggle: () => void;
  /** Icon size in px. Matches the adjacent collapse indicator. */
  size?: number;
  className?: string;
}

/** Small lock toggle styled to match collapse/chevron buttons in HUD panels. */
export function PanelLockButton({ locked, onToggle, size = 10, className }: PanelLockButtonProps) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      title={locked ? "Unlock to move" : "Lock in place"}
      aria-label={locked ? "Unlock panel" : "Lock panel"}
      aria-pressed={!locked}
      className={cn(
        "flex shrink-0 items-center justify-center text-white/30 transition-colors hover:text-white/70",
        className,
      )}
    >
      {locked ? <Lock size={size} /> : <Unlock size={size} />}
    </button>
  );
}
