import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { cn } from "../../../../lib/utils";
import { visibleText } from "../../lib/tracker-display";

export function WorldTileShell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative min-h-[3.125rem] min-w-0 overflow-hidden rounded-[5px] border border-[var(--border)]/36 bg-[color-mix(in_srgb,var(--background)_43%,transparent)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_9%,transparent),inset_0_-10px_20px_color-mix(in_srgb,var(--background)_18%,transparent)] transition-[border-color,box-shadow] duration-200",
        className,
      )}
      title={label}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--foreground)_5%,transparent),transparent_42%,color-mix(in_srgb,var(--primary)_10%,transparent))]" />
      <div className="pointer-events-none absolute inset-x-1 top-1 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--foreground)_18%,transparent),transparent)]" />
      <div className="pointer-events-none absolute inset-x-1 bottom-1 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--primary)_16%,transparent),transparent)] opacity-70" />
      <span className="sr-only">{label}</span>
      <div className="relative z-[1] h-full min-w-0">{children}</div>
    </div>
  );
}

export function WorldRenderedEdit({
  label,
  value,
  onSave,
  placeholder,
  className,
  inputClassName,
  showEditHint = true,
  editHintClassName,
  children,
}: {
  label: string;
  value: string | null | undefined;
  onSave?: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  showEditHint?: boolean;
  editHintClassName?: string;
  children: ReactNode;
}) {
  const currentValue = value === null || value === undefined ? "" : String(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedRef = useRef(false);
  const title = `${label}: ${visibleText(value)}`;

  useEffect(() => {
    if (!editing) setDraft(currentValue);
  }, [currentValue, editing]);

  useEffect(() => {
    if (!editing) return;
    committedRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = draft.trim();
    if (trimmed !== currentValue) onSave?.(trimmed);
    setEditing(false);
  };

  if (!onSave) {
    return (
      <div className={cn("h-full min-w-0", className)} title={title}>
        {children}
      </div>
    );
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setDraft(currentValue);
            setEditing(false);
          }
        }}
        onBlur={commit}
        className={cn(
          "h-full w-full min-w-0 rounded-sm border border-[var(--primary)]/35 bg-[var(--background)]/68 px-1 text-[0.6875rem] font-semibold text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--primary)]",
          inputClassName,
        )}
        placeholder={placeholder ?? `Set ${label.toLowerCase()}`}
        aria-label={label}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={title}
      aria-label={`${title}. Click to edit.`}
      className={cn(
        "group/world-edit relative h-full w-full min-w-0 text-left transition-colors hover:bg-[var(--accent)]/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--primary)]",
        className,
      )}
    >
      {children}
      {showEditHint && (
        <span
          className={cn(
            "pointer-events-none absolute right-0.5 top-0.5 z-[12] flex h-3 w-3 translate-y-0.5 items-center justify-center rounded-[2px] bg-[var(--background)]/58 text-[var(--primary)] opacity-0 shadow-[0_0_6px_color-mix(in_srgb,var(--primary)_16%,transparent)] ring-1 ring-[var(--primary)]/18 transition-[opacity,transform] duration-150 group-hover/world-edit:translate-y-0 group-hover/world-edit:opacity-70 group-focus-visible/world-edit:translate-y-0 group-focus-visible/world-edit:opacity-80 max-md:translate-y-0 max-md:opacity-45",
            editHintClassName,
          )}
          aria-hidden="true"
        >
          <Pencil size="0.5rem" />
        </span>
      )}
    </button>
  );
}
