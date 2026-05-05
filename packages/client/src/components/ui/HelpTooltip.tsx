// ──────────────────────────────────────────────
// Reusable help tooltip — hover ? icon to see explanation
// ──────────────────────────────────────────────
import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";
import { cn } from "../../lib/utils";

interface HelpTooltipProps {
  /** The help text to display */
  text: string;
  /** Optional size of the icon (default "0.75rem") */
  size?: string | number;
  /** Preferred position */
  side?: "top" | "bottom" | "left" | "right";
  /** Extra class on the icon wrapper */
  className?: string;
  /** Use a wider tooltip panel (long explanations) */
  wide?: boolean;
}

export function HelpTooltip({
  text,
  size = "0.75rem",
  side = "top",
  className,
  wide,
}: HelpTooltipProps) {
  const [show, setShow] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; ready: boolean }>({ top: 0, left: 0, ready: false });

  // Compute position before paint so the tooltip never flickers
  useLayoutEffect(() => {
    if (!show || !wrapRef.current || !tipRef.current) {
      setPos({ top: 0, left: 0, ready: false });
      return;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const pad = 8;
    let top = 0;
    let left = 0;

    if (side === "top") {
      top = rect.top - 6 - tip.height;
      left = rect.left + rect.width / 2 - tip.width / 2;
    } else if (side === "bottom") {
      top = rect.bottom + 6;
      left = rect.left + rect.width / 2 - tip.width / 2;
    } else if (side === "left") {
      top = rect.top + rect.height / 2 - tip.height / 2;
      left = rect.left - 6 - tip.width;
    } else {
      top = rect.top + rect.height / 2 - tip.height / 2;
      left = rect.right + 6;
    }

    // Clamp to viewport
    left = Math.max(pad, Math.min(left, window.innerWidth - pad - tip.width));
    top = Math.max(pad, Math.min(top, window.innerHeight - pad - tip.height));

    setPos({ top, left, ready: true });
  }, [show, side]);

  useEffect(() => {
    if (!show) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setShow(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShow(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [show]);

  return (
    <span ref={wrapRef} className={cn("relative inline-flex", className)} onMouseLeave={() => setShow(false)}>
      <button
        type="button"
        aria-label="Show help"
        className="inline-flex cursor-help items-center rounded-full text-[var(--muted-foreground)] opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]/40"
        onMouseEnter={() => setShow(true)}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setShow((current) => !current);
        }}
      >
        <HelpCircle size={size} />
      </button>
      {show &&
        createPortal(
          <div
            ref={tipRef}
            className={cn(
              "pointer-events-none fixed z-[9999] rounded-lg bg-[var(--popover)] px-3 py-2 text-[0.6875rem] leading-relaxed text-[var(--popover-foreground)] shadow-xl ring-1 ring-[var(--border)]",
              wide
                ? "w-[min(22rem,calc(100vw-1.5rem))] max-w-[22rem]"
                : "w-56",
            )}
            style={{ top: pos.top, left: pos.left, visibility: pos.ready ? "visible" : "hidden" }}
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** Helper: label text followed by a help tooltip icon */
export function LabelWithHelp({ label, help, className }: { label: string; help: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {label}
      <HelpTooltip text={help} />
    </span>
  );
}
