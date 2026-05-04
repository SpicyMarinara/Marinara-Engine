// ──────────────────────────────────────────────
// Lorebook Form Fields
// Shared sub-components used by both LorebookEditor (overview tab)
// and LorebookEntryRow (the per-entry inline drawer).
// Extracted from LorebookEditor.tsx so styling stays consistent.
// ──────────────────────────────────────────────
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { FileText, Maximize2, ToggleLeft, ToggleRight, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";

export function FieldGroup({
  label,
  icon: Icon,
  help,
  children,
}: {
  label: string;
  icon: typeof FileText;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
        <Icon size="0.8125rem" className="text-amber-400" />
        {label}
        {help && <HelpTooltip text={help} />}
      </div>
      {children}
    </div>
  );
}

export function KeysEditor({ keys, onChange }: { keys: string[]; onChange: (keys: string[]) => void }) {
  const [input, setInput] = useState("");

  const addKey = () => {
    const trimmed = input.trim();
    if (trimmed && !keys.includes(trimmed)) {
      onChange([...keys, trimmed]);
      setInput("");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {keys.map((key, i) => (
          <span
            key={i}
            className="flex items-center gap-1 rounded-lg bg-amber-400/15 px-2 py-1 text-[0.6875rem] text-amber-300"
          >
            {key}
            <button
              onClick={() => onChange(keys.filter((_, j) => j !== i))}
              className="ml-0.5 rounded-sm hover:text-[var(--destructive)]"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKey())}
          className="flex-1 rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          placeholder="Type a keyword and press Enter…"
        />
        <button
          onClick={addKey}
          className="rounded-lg bg-[var(--accent)] px-2 py-1.5 text-[0.6875rem] font-medium transition-colors hover:bg-[var(--accent)]/80"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function ToggleButton({
  label,
  value,
  onChange,
  tooltip,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  tooltip?: string;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      title={tooltip}
      className={cn(
        "flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium ring-1 transition-all",
        value
          ? "bg-amber-400/15 text-amber-400 ring-amber-400/30"
          : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)]",
      )}
    >
      {label}
      {value ? <ToggleRight size="1.125rem" /> : <ToggleLeft size="1.125rem" />}
    </button>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        min={min}
        max={max}
        className="w-full rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
      />
    </div>
  );
}

export function insertTabAtSelection(
  element: HTMLTextAreaElement,
  value: string,
  applyValue: (nextValue: string) => void,
) {
  const start = element.selectionStart;
  const end = element.selectionEnd;
  const nextValue = `${value.slice(0, start)}\t${value.slice(end)}`;
  applyValue(nextValue);

  requestAnimationFrame(() => {
    element.selectionStart = element.selectionEnd = start + 1;
  });
}

export function handleTextareaTabKeyDown(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  value: string,
  applyValue: (nextValue: string) => void,
) {
  if (event.key !== "Tab" || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
  event.preventDefault();
  insertTabAtSelection(event.currentTarget, value, applyValue);
}

/** Textarea with an expand button that opens a fullscreen modal editor. */
export function ExpandableTextarea({
  value,
  onChange,
  rows,
  placeholder,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  title?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => handleTextareaTabKeyDown(e, value, onChange)}
          rows={rows ?? 6}
          className="w-full resize-y rounded-lg bg-[var(--secondary)] p-2.5 pr-9 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          placeholder={placeholder}
        />
        <button
          onClick={() => setExpanded(true)}
          className="absolute right-2 top-2 rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          title="Expand editor"
        >
          <Maximize2 size="0.8125rem" />
        </button>
      </div>

      {expanded && (
        <ExpandedContentModal
          title={title ?? "Edit"}
          value={value}
          onChange={onChange}
          onClose={() => setExpanded(false)}
          placeholder={placeholder}
        />
      )}
    </>
  );
}

/** Fullscreen modal editor for lorebook entry fields. */
export function ExpandedContentModal({
  title,
  value,
  onChange,
  onClose,
  placeholder,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onChange(local);
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, onChange, local]);

  const handleClose = () => {
    onChange(local);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 max-md:pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={handleClose} className="rounded-lg p-1.5 hover:bg-[var(--accent)]">
            <X size="1rem" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden p-4">
          <textarea
            ref={textareaRef}
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onKeyDown={(e) => handleTextareaTabKeyDown(e, local, setLocal)}
            className="h-full w-full resize-none rounded-lg bg-[var(--secondary)] p-4 text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder={placeholder}
          />
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
          <p className="text-[0.625rem] text-[var(--muted-foreground)]">
            Changes auto-save on close. Press Escape to close.
          </p>
          <button
            onClick={handleClose}
            className="rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-1.5 text-xs font-medium text-white shadow-md hover:shadow-lg active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
