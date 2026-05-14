import { createPortal } from "react-dom";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Globe, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { useActiveLorebookEntries } from "../../hooks/use-lorebooks";
import { useUIStore } from "../../stores/ui.store";

const WorldInfoPanel = lazy(async () => {
  const module = await import("./ChatRoleplayPanels");
  return { default: module.WorldInfoPanel };
});

const PANEL_BACKDROP =
  "fixed inset-0 z-[9999] flex items-center justify-center p-4 max-md:pt-[max(1rem,env(safe-area-inset-top))]";
const PANEL_CONTAINER =
  "relative max-h-[calc(100dvh-4rem)] w-full max-w-sm overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-2xl shadow-black/40 animate-message-in";

type ButtonClassNameInput = {
  open: boolean;
  hasEntries: boolean;
  hasSkippedEntries: boolean;
  isLoading: boolean;
  compact: boolean;
};

type ActiveWorldInfoButtonProps = {
  chatId: string | null;
  buttonClassName?: string | ((state: ButtonClassNameInput) => string);
  iconSize?: number | string;
  title?: string;
};

function WorldInfoLoadingFallback() {
  return (
    <div className="flex items-center gap-2 py-4 text-xs text-[var(--muted-foreground)]">
      <Loader2 size="0.75rem" className="animate-spin" />
      Loading world info...
    </div>
  );
}

export function ActiveWorldInfoModal({
  chatId,
  open,
  onClose,
}: {
  chatId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!open || !chatId) return null;

  return createPortal(
    <div className={PANEL_BACKDROP} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={PANEL_CONTAINER} onClick={(e) => e.stopPropagation()}>
        <Suspense fallback={<WorldInfoLoadingFallback />}>
          <WorldInfoPanel chatId={chatId} isMobile onClose={onClose} />
        </Suspense>
      </div>
    </div>,
    document.body,
  );
}

export function ActiveWorldInfoButton({
  chatId,
  buttonClassName,
  iconSize = "0.875rem",
  title = "Active World Info",
}: ActiveWorldInfoButtonProps) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useActiveLorebookEntries(chatId, true);
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const compact = useUIStore((s) => s.centerCompact);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!chatId) return null;

  const entries = data?.entries ?? [];
  const skippedEntries = data?.budgetSkippedEntries ?? [];
  const hasEntries = entries.length > 0;
  const hasSkippedEntries = skippedEntries.length > 0;
  const resolvedButtonClassName =
    typeof buttonClassName === "function"
      ? buttonClassName({ open, hasEntries, hasSkippedEntries, isLoading, compact })
      : (buttonClassName ??
        cn(
          "flex items-center justify-center rounded-full border backdrop-blur-md transition-all",
          compact ? "p-1" : "p-1.5",
          open
            ? "bg-foreground/15 border-foreground/20 text-foreground/90"
            : (hasEntries || hasSkippedEntries) && !isLoading
              ? "bg-foreground/10 border-foreground/25 text-foreground/80 hover:bg-foreground/15 hover:text-foreground"
              : "bg-foreground/5 border-foreground/10 text-foreground/60 hover:bg-foreground/10 hover:text-foreground",
        ));

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen(!open)} className={resolvedButtonClassName} title={title} aria-label={title}>
        <Globe size={iconSize} />
      </button>
      {open &&
        (isMobile ? (
          <ActiveWorldInfoModal chatId={chatId} open={open} onClose={() => setOpen(false)} />
        ) : (
          <div className="absolute right-0 top-full z-50 mt-2 max-h-[60vh] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-2xl shadow-black/40 animate-message-in">
            <Suspense fallback={<WorldInfoLoadingFallback />}>
              <WorldInfoPanel chatId={chatId} isMobile={isMobile} onClose={() => setOpen(false)} />
            </Suspense>
          </div>
        ))}
    </div>
  );
}
