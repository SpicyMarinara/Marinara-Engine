import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/utils";

export interface QuickReplyAction {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void | Promise<void>;
}

interface QuickReplyMenuProps {
  actions: QuickReplyAction[];
  disabled?: boolean;
}

export function QuickReplyMenu({ actions, disabled = false }: QuickReplyMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusRef = useRef<"first" | "last" | null>(null);
  const isDisabled = disabled || actions.length === 0;
  const singleAction = actions.length === 1 ? actions[0] : null;
  const visibleActions = actions.slice().reverse();

  const focusMenuItem = useCallback((target: "first" | "last" | { fromIndex: number; delta: 1 | -1 }) => {
    const focusable = itemRefs.current
      .map((button, index) => ({ button, index }))
      .filter(
        (entry): entry is { button: HTMLButtonElement; index: number } =>
          !!entry.button && !entry.button.disabled,
      );
    if (focusable.length === 0) return;

    const next =
      target === "first"
        ? focusable[0]
        : target === "last"
          ? focusable[focusable.length - 1]
          : (() => {
              const current = focusable.findIndex((entry) => entry.index === target.fromIndex);
              const base = current === -1 ? (target.delta > 0 ? -1 : 0) : current;
              return focusable[(base + target.delta + focusable.length) % focusable.length];
            })();
    next?.button.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !pendingFocusRef.current) return;
    const target = pendingFocusRef.current;
    const frame = requestAnimationFrame(() => {
      focusMenuItem(target);
      pendingFocusRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [focusMenuItem, open, visibleActions.length]);

  useEffect(() => {
    if (actions.length <= 1 && open) setOpen(false);
  }, [actions.length, open]);

  const handleSelect = async (action: QuickReplyAction) => {
    if (disabled || action.disabled) return;
    setOpen(false);
    await action.onSelect();
  };

  const formatActionTitle = (action: QuickReplyAction) =>
    action.disabled ? `${action.label}: ${action.disabledReason ?? action.description}` : `${action.label}: ${action.description}`;

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const target = event.key === "ArrowUp" ? "last" : "first";
    if (open) {
      focusMenuItem(target);
    } else {
      pendingFocusRef.current = target;
      setOpen(true);
    }
  };

  const handleItemKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        focusMenuItem({ fromIndex: index, delta: 1 });
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        focusMenuItem({ fromIndex: index, delta: -1 });
        break;
      case "Home":
        event.preventDefault();
        focusMenuItem("first");
        break;
      case "End":
        event.preventDefault();
        focusMenuItem("last");
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
    }
  };

  if (singleAction) {
    const singleDisabled = disabled || singleAction.disabled;
    return (
      <button
        type="button"
        onClick={() => void handleSelect(singleAction)}
        disabled={singleDisabled}
        aria-label={`${singleAction.label}: ${singleAction.description}`}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
          !singleDisabled
            ? "text-foreground/70 hover:bg-foreground/10 hover:text-[var(--primary)] active:scale-90"
            : "cursor-not-allowed text-foreground/20",
        )}
        title={formatActionTitle(singleAction)}
      >
        {singleAction.icon}
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative flex h-8 w-8 shrink-0 items-center justify-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
        disabled={isDisabled}
        aria-label="Quick replies"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200",
          open
            ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
            : !isDisabled
              ? "text-foreground/70 hover:bg-foreground/10 hover:text-foreground active:scale-90"
              : "text-foreground/20",
        )}
        title="Quick replies"
      >
        <MoreHorizontal size="1rem" />
      </button>

      <AnimatePresence>
        {open && (
          <div className="absolute bottom-full left-1/2 z-[60] mb-2 -translate-x-1/2">
            <motion.div
              key="quick-replies-rail"
              role="menu"
              aria-label="Quick replies"
              aria-orientation="vertical"
              className="flex flex-col items-center gap-1.5"
              initial="closed"
              animate="open"
              exit="closed"
              variants={{
                open: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
                closed: { transition: { staggerChildren: 0.025, staggerDirection: -1 } },
              }}
            >
              {visibleActions.map((action, index) => (
                <motion.button
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  key={action.id}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => void handleSelect(action)}
                  onKeyDown={(event) => handleItemKeyDown(event, index)}
                  aria-label={`${action.label}: ${action.description}`}
                  className={cn(
                    "group relative flex h-10 w-10 items-center justify-center rounded-full border shadow-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                    action.disabled
                      ? "cursor-not-allowed border-[var(--border)] bg-[var(--card)]/75 opacity-45"
                      : "border-[var(--primary)]/25 bg-[var(--card)] text-[var(--primary)] hover:border-[var(--primary)]/45 hover:bg-[var(--primary)] hover:text-[var(--primary-foreground)] active:scale-95",
                  )}
                  title={formatActionTitle(action)}
                  variants={{
                    open: {
                      opacity: 1,
                      scale: 1,
                      y: 0,
                      filter: "blur(0px)",
                      transition: {
                        type: "spring",
                        stiffness: 520,
                        damping: 28,
                        mass: 0.75,
                        delay: index * 0.015,
                      },
                    },
                    closed: {
                      opacity: 0,
                      scale: 0.55,
                      y: 36 + index * 10,
                      filter: "blur(2px)",
                      transition: { duration: 0.12, ease: "easeOut" },
                    },
                  }}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 transition-colors",
                      action.disabled
                        ? "bg-foreground/5 text-foreground/40 ring-transparent"
                        : "bg-[var(--primary)]/12 ring-[var(--primary)]/20 group-hover:bg-transparent group-hover:ring-transparent",
                    )}
                  >
                    {action.icon}
                  </span>
                </motion.button>
              ))}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
