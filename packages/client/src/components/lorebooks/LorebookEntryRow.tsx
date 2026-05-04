// ──────────────────────────────────────────────
// Lorebook Entry Row
// Compact one-line row with inline controls + expandable drawer.
// Replaces the previous "click to navigate to entry sub-view" pattern.
// Inspired by SillyTavern's World Info card layout.
// ──────────────────────────────────────────────
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ChevronDown,
  CheckCircle2,
  CircleDashed,
  FileText,
  GripVertical,
  Hash,
  Key,
  Lock,
  Regex,
  Save,
  Settings2,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { useUpdateLorebookEntry, useDeleteLorebookEntry } from "../../hooks/use-lorebooks";
import type {
  LorebookEntry,
  LorebookFilterMode,
  LorebookFolder,
  LorebookMatchingSource,
} from "@marinara-engine/shared";
import {
  ExpandableTextarea,
  FieldGroup,
  KeysEditor,
  NumberField,
  ToggleButton,
  estimateTokens,
} from "./LorebookFormFields";

interface Props {
  entry: LorebookEntry;
  lorebookId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  characters: Array<{ id: string; name: string; tags: string[] }>;
  characterTags: string[];
  /**
   * All folders in the parent lorebook. Used to populate the folder selector
   * on the row. May be empty — when empty, the selector is hidden because
   * "(none)" → "(none)" is meaningless.
   */
  folders: LorebookFolder[];
  // Drag-and-drop wiring (lifted in the parent because cross-row state).
  draggable: boolean;
  isDragging: boolean;
  isDragReady: boolean;
  onDragHandleMouseDown: () => void;
  onDragHandleMouseUp: () => void;
  onDragStart: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragOver: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

/** Maps the (constant, selective) boolean pair into a single status enum for the inline select. */
type EntryStatus = "constant" | "selective" | "normal";

function deriveStatus(entry: LorebookEntry): EntryStatus {
  if (entry.constant) return "constant";
  if (entry.selective) return "selective";
  return "normal";
}

function statusToFlags(status: EntryStatus): { constant: boolean; selective: boolean } {
  switch (status) {
    case "constant":
      return { constant: true, selective: false };
    case "selective":
      return { constant: false, selective: true };
    case "normal":
    default:
      return { constant: false, selective: false };
  }
}

const STATUS_LABEL: Record<EntryStatus, string> = {
  constant: "Constant",
  selective: "Selective",
  normal: "Normal",
};

const STATUS_DESCRIPTION: Record<EntryStatus, string> = {
  normal: "This entry is currently set to trigger normally, when key words are detected.",
  constant: "This entry is constantly injected into the context.",
  selective:
    "This entry uses selective matching: primary keys must match with the secondary-key logic below before it is injected.",
};

const STATUS_DOT_COLOR: Record<EntryStatus, string> = {
  constant: "bg-amber-400",
  selective: "bg-violet-400",
  normal: "bg-emerald-400",
};

const ENTRY_STATUS_ORDER: EntryStatus[] = ["normal", "constant", "selective"];

const FILTER_MODE_LABEL: Record<LorebookFilterMode, string> = {
  any: "Any",
  include: "Only",
  exclude: "Exclude",
};

const MATCHING_SOURCE_OPTIONS: Array<{ value: LorebookMatchingSource; label: string }> = [
  { value: "character_name", label: "Character name" },
  { value: "character_description", label: "Character description" },
  { value: "character_personality", label: "Personality" },
  { value: "character_scenario", label: "Scenario" },
  { value: "character_tags", label: "Character tags" },
  { value: "persona_description", label: "Persona description" },
  { value: "persona_tags", label: "Persona tags" },
];

const GENERATION_TRIGGER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "conversation", label: "Conversation" },
  { value: "roleplay", label: "Roleplay" },
  { value: "visual_novel", label: "VN" },
  { value: "game", label: "Game" },
  { value: "chat", label: "Chat reply" },
  { value: "continue", label: "Continue" },
  { value: "autonomous", label: "Autonomous" },
  { value: "swipe", label: "Swipe" },
  { value: "impersonate", label: "Impersonate" },
  { value: "prompt_preview", label: "Prompt preview" },
  { value: "test_scan", label: "Test scan" },
  { value: "game_setup", label: "Game setup" },
  { value: "lorebook_assistant", label: "Lorebook Assistant" },
];

function getNextStatus(status: EntryStatus): EntryStatus {
  const index = ENTRY_STATUS_ORDER.indexOf(status);
  return ENTRY_STATUS_ORDER[(index + 1) % ENTRY_STATUS_ORDER.length] ?? "normal";
}

/** A compact lorebook-entry list row with inline-editable status / position / depth / order /
 *  probability / enable, plus an expandable drawer with the rest of the entry editor.
 */
export function LorebookEntryRow({
  entry,
  lorebookId,
  isExpanded,
  onToggleExpand,
  characters,
  characterTags,
  folders,
  draggable,
  isDragging,
  isDragReady,
  onDragHandleMouseDown,
  onDragHandleMouseUp,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: Props) {
  const updateEntry = useUpdateLorebookEntry();
  const deleteEntry = useDeleteLorebookEntry();

  // ── Inline-control optimistic state ──
  // We keep a local mirror of the entry's fields so the inputs feel snappy
  // while the mutation flushes. React Query invalidation will reconcile.
  const [localEnabled, setLocalEnabled] = useState(entry.enabled);
  const [localStatus, setLocalStatus] = useState<EntryStatus>(deriveStatus(entry));
  const [localPosition, setLocalPosition] = useState(entry.position);
  const [localDepth, setLocalDepth] = useState(entry.depth);
  const [localOrder, setLocalOrder] = useState(entry.order);
  const [localProbability, setLocalProbability] = useState<number>(entry.probability ?? 100);
  const [localName, setLocalName] = useState(entry.name);
  const [localUseRegex, setLocalUseRegex] = useState(entry.useRegex ?? false);

  // Re-sync local state when the upstream entry changes (e.g. after refetch)
  // so we don't show stale values, but avoid clobbering an in-flight edit.
  const lastSyncedRef = useRef(entry);
  useEffect(() => {
    if (lastSyncedRef.current === entry) return;
    lastSyncedRef.current = entry;
    setLocalEnabled(entry.enabled);
    setLocalStatus(deriveStatus(entry));
    setLocalPosition(entry.position);
    setLocalDepth(entry.depth);
    setLocalOrder(entry.order);
    setLocalProbability(entry.probability ?? 100);
    setLocalName(entry.name);
    setLocalUseRegex(entry.useRegex ?? false);
  }, [entry]);

  const patch = useCallback(
    (changes: Partial<LorebookEntry>) => {
      updateEntry.mutate({ lorebookId, entryId: entry.id, ...changes });
    },
    [lorebookId, entry.id, updateEntry],
  );

  const handleStatusChange = useCallback(
    (next: EntryStatus) => {
      setLocalStatus(next);
      patch(statusToFlags(next));
    },
    [patch],
  );

  const handleStatusCycle = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      handleStatusChange(getNextStatus(localStatus));
    },
    [handleStatusChange, localStatus],
  );

  const handleEnableToggle = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      const next = !localEnabled;
      setLocalEnabled(next);
      patch({ enabled: next });
    },
    [localEnabled, patch],
  );

  const handleUseRegexToggle = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      const next = !localUseRegex;
      setLocalUseRegex(next);
      patch({ useRegex: next });
    },
    [localUseRegex, patch],
  );

  const handleNameCommit = useCallback(() => {
    if (localName.trim() && localName !== entry.name) {
      patch({ name: localName.trim() });
    } else if (!localName.trim()) {
      // Don't allow empty names — revert.
      setLocalName(entry.name);
    }
  }, [localName, entry.name, patch]);

  const handleDelete = useCallback(
    async (e: ReactMouseEvent) => {
      e.stopPropagation();
      if (
        !(await showConfirmDialog({
          title: "Delete Entry",
          message: "Delete this lorebook entry?",
          confirmLabel: "Delete",
          tone: "destructive",
        }))
      ) {
        return;
      }
      deleteEntry.mutate({ lorebookId, entryId: entry.id });
    },
    [lorebookId, entry.id, deleteEntry],
  );

  const showDepthInput = localPosition === 2;
  const isVectorized = Array.isArray(entry.embedding) && entry.embedding.length > 0;

  return (
    <div
      className={cn(
        "rounded-xl bg-[var(--secondary)] ring-1 ring-[var(--border)] transition-all",
        isExpanded ? "ring-amber-400/40" : "hover:ring-amber-400/30",
        isDragging && "opacity-40",
      )}
      draggable={draggable && isDragReady}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {/* ── Compact row ── */}
      <div className="group flex cursor-pointer items-center gap-2 px-2 py-1.5" onClick={onToggleExpand}>
        {/* Drag handle */}
        <button
          type="button"
          className={cn(
            "shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition-colors",
            draggable
              ? "cursor-grab hover:bg-[var(--accent)] hover:text-[var(--foreground)] active:cursor-grabbing"
              : "cursor-not-allowed opacity-40",
          )}
          title={draggable ? "Drag to reorder" : "Use Order sort and clear search to reorder"}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (draggable) onDragHandleMouseDown();
          }}
          onMouseUp={(e) => {
            e.stopPropagation();
            onDragHandleMouseUp();
          }}
        >
          <GripVertical size="0.875rem" />
        </button>

        {/* Expand chevron */}
        <button
          type="button"
          aria-label={isExpanded ? "Collapse entry" : "Expand entry"}
          className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition-transform hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
        >
          <ChevronDown size="0.875rem" className={cn("transition-transform", isExpanded ? "rotate-0" : "-rotate-90")} />
        </button>

        {/* Enable toggle */}
        <button
          type="button"
          aria-label={localEnabled ? "Disable entry" : "Enable entry"}
          title={localEnabled ? "Entry enabled" : "Entry disabled"}
          onClick={handleEnableToggle}
          className="shrink-0"
        >
          {localEnabled ? (
            <ToggleRight size="1.125rem" className="text-amber-400" />
          ) : (
            <ToggleLeft size="1.125rem" className="text-[var(--muted-foreground)]" />
          )}
        </button>

        {/* Regex key matching toggle */}
        <button
          type="button"
          aria-label={localUseRegex ? "Disable regex key matching" : "Enable regex key matching"}
          title={localUseRegex ? "Regex key matching enabled" : "Plain-text key matching"}
          onClick={handleUseRegexToggle}
          className={cn(
            "shrink-0 rounded p-0.5 transition-colors",
            localUseRegex
              ? "bg-orange-400/15 text-orange-300 ring-1 ring-orange-400/25"
              : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
          )}
        >
          <Regex size="0.875rem" />
        </button>

        {/* Status dot + name */}
        <button
          type="button"
          onClick={handleStatusCycle}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          title={`${STATUS_LABEL[localStatus]} entry. Tap to switch to ${STATUS_LABEL[getNextStatus(localStatus)]}.`}
          aria-label={`${STATUS_LABEL[localStatus]} entry. Tap to switch to ${STATUS_LABEL[getNextStatus(localStatus)]}.`}
        >
          <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_DOT_COLOR[localStatus])} />
        </button>
        <input
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={handleNameCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          placeholder="Untitled entry"
          className="min-w-0 flex-1 truncate bg-transparent px-1 text-sm font-medium outline-none transition-colors hover:bg-[var(--accent)]/40 focus:bg-[var(--accent)]/40 focus:ring-1 focus:ring-[var(--ring)] rounded"
        />

        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[0.5625rem] font-medium ring-1",
            isVectorized
              ? "bg-emerald-400/10 text-emerald-400 ring-emerald-400/20"
              : "bg-[var(--background)]/55 text-[var(--muted-foreground)] ring-[var(--border)]",
          )}
          title={isVectorized ? "This entry has been vectorized" : "This entry has not been vectorized yet"}
          aria-label={isVectorized ? "Entry vectorized" : "Entry not vectorized"}
        >
          {isVectorized ? <CheckCircle2 size="0.625rem" /> : <CircleDashed size="0.625rem" />}
          <span className="hidden sm:inline">{isVectorized ? "Vectorized" : "Not vectorized"}</span>
        </span>

        {/* Lock badge (display-only on the row; toggled inside the drawer) */}
        {entry.locked && (
          <span className="hidden shrink-0 items-center rounded bg-sky-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-sky-400 sm:inline-flex">
            <Lock size="0.5rem" className="mr-0.5" />
            LOCKED
          </span>
        )}

        {/* ── Inline editable controls cluster ── */}
        {/* Hidden on very narrow viewports to keep the row from overflowing.
            Users on mobile can expand the drawer to access them. */}
        <div className="hidden shrink-0 items-center gap-1 md:flex" onClick={(e) => e.stopPropagation()}>
          <CompactSelect
            value={String(localPosition)}
            onChange={(v) => {
              const n = Number(v);
              setLocalPosition(n);
              patch({ position: n });
            }}
            title="Position in the prompt: Before Chat, After Chat, or @ Depth (injected into chat history)."
            options={[
              { value: "0", label: "↑Char" },
              { value: "1", label: "↓Char" },
              { value: "2", label: "@Depth" },
            ]}
          />
          {showDepthInput && (
            <CompactNumber
              value={localDepth}
              onCommit={(n) => {
                setLocalDepth(n);
                patch({ depth: n });
              }}
              title="Depth (messages back from the latest) where this entry is injected."
              ariaLabel="Depth"
              prefix="d"
              min={0}
              max={9999}
            />
          )}
          <CompactNumber
            value={localOrder}
            onCommit={(n) => {
              setLocalOrder(n);
              patch({ order: n });
            }}
            title="Insertion order when multiple entries activate (lower = earlier in prompt)."
            ariaLabel="Order"
            prefix="ord"
          />
          <CompactNumber
            value={localProbability}
            onCommit={(n) => {
              const clamped = Math.max(0, Math.min(100, n));
              setLocalProbability(clamped);
              // null = always-fire is the schema default. Save 100 as null
              // for parity with how new entries are created.
              patch({ probability: clamped === 100 ? null : clamped });
            }}
            title="Trigger probability (0–100%). 100% always fires when keys match."
            ariaLabel="Trigger probability"
            prefix="p"
            suffix="%"
            min={0}
            max={100}
          />
          {folders.length > 0 && (
            <CompactSelect
              value={entry.folderId ?? ""}
              onChange={(v) => patch({ folderId: v === "" ? null : v })}
              title="Move this entry to a different folder. (none) = root level."
              options={[{ value: "", label: "(none)" }, ...folders.map((f) => ({ value: f.id, label: f.name }))]}
            />
          )}
        </div>

        {/* Token estimate (compact) */}
        <span
          className="hidden shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] lg:inline-flex"
          title={`~${estimateTokens(entry.content).toLocaleString()} tokens (estimated)`}
        >
          <Hash size="0.5625rem" />
          {estimateTokens(entry.content).toLocaleString()}
        </span>

        {/* Delete button (visible on hover, always on mobile) */}
        <button
          type="button"
          aria-label="Delete entry"
          onClick={handleDelete}
          className="shrink-0 rounded p-1 opacity-0 transition-all hover:bg-[var(--destructive)]/15 group-hover:opacity-100 max-md:opacity-100"
        >
          <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
        </button>
      </div>

      {/* ── Expanded drawer ── */}
      {isExpanded && (
        <ExpandedDrawer entry={entry} lorebookId={lorebookId} characters={characters} characterTags={characterTags} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────

function CompactSelect({
  value,
  onChange,
  options,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  title?: string;
}) {
  return (
    <select
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      className="h-6 rounded-md bg-[var(--secondary)] px-1.5 text-[0.6875rem] ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] hover:ring-amber-400/40 transition-colors"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function CompactNumber({
  value,
  onCommit,
  title,
  ariaLabel,
  prefix,
  suffix,
  min,
  max,
}: {
  value: number;
  onCommit: (v: number) => void;
  title?: string;
  ariaLabel: string;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  // Keep draft synced when external value changes
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    let clamped = parsed;
    if (min !== undefined && clamped < min) clamped = min;
    if (max !== undefined && clamped > max) clamped = max;
    if (clamped !== value) {
      setDraft(String(clamped));
      onCommit(clamped);
    } else if (clamped !== parsed) {
      setDraft(String(clamped));
    }
  };

  return (
    <label
      className="flex h-6 items-center gap-0.5 rounded-md bg-[var(--secondary)] px-1.5 text-[0.6875rem] ring-1 ring-[var(--border)] hover:ring-amber-400/40 transition-colors focus-within:ring-2 focus-within:ring-[var(--ring)]"
      title={title}
    >
      {prefix && <span className="text-[var(--muted-foreground)]">{prefix}:</span>}
      <input
        type="number"
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        min={min}
        max={max}
        className="w-10 bg-transparent text-right tabular-nums outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && <span className="text-[var(--muted-foreground)]">{suffix}</span>}
    </label>
  );
}

function toggleStringValue(values: string[] | undefined, value: string) {
  const current = values ?? [];
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function FilterModeSelect({
  value,
  onChange,
}: {
  value: LorebookFilterMode;
  onChange: (value: LorebookFilterMode) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as LorebookFilterMode)}
      className="h-7 rounded-lg bg-[var(--secondary)] px-2 text-[0.6875rem] ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
    >
      {(["any", "include", "exclude"] as LorebookFilterMode[]).map((mode) => (
        <option key={mode} value={mode}>
          {FILTER_MODE_LABEL[mode]}
        </option>
      ))}
    </select>
  );
}

function FilterPills({
  values,
  selected,
  onChange,
  emptyLabel,
}: {
  values: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
}) {
  if (values.length === 0) {
    return <p className="text-[0.625rem] text-[var(--muted-foreground)]">{emptyLabel}</p>;
  }

  return (
    <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto pr-1">
      {values.map((item) => {
        const active = selected.includes(item.value);
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(toggleStringValue(selected, item.value))}
            className={cn(
              "rounded-full px-2 py-0.5 text-[0.625rem] ring-1 transition-colors",
              active
                ? "bg-amber-400/15 text-amber-300 ring-amber-400/30"
                : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)] hover:text-[var(--foreground)]",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Expanded drawer — keys, content, advanced toggles, timing, group/tag.
// Manages its own dirty state and Save button so users see explicit commit
// for the heavier fields (especially the content textarea).
// ─────────────────────────────────────────────────────

function ExpandedDrawer({
  entry,
  lorebookId,
  characters,
  characterTags,
}: {
  entry: LorebookEntry;
  lorebookId: string;
  characters: Array<{ id: string; name: string; tags: string[] }>;
  characterTags: string[];
}) {
  const updateEntry = useUpdateLorebookEntry();
  const [form, setForm] = useState<Partial<LorebookEntry>>(() => ({ ...entry }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadedEntryIdRef = useRef(entry.id);
  const drawerStatus = deriveStatus(entry);

  // If the underlying entry changes (e.g. due to an inline-control patch), refresh
  // the drawer form unless the user is in the middle of editing.
  useEffect(() => {
    const switched = loadedEntryIdRef.current !== entry.id;
    if (switched || !dirty) {
      setForm({ ...entry });
      setDirty(false);
      loadedEntryIdRef.current = entry.id;
    }
  }, [entry, dirty]);

  const update = useCallback((patch: Partial<LorebookEntry>) => {
    setDirty(true);
    setForm((curr) => ({ ...curr, ...patch }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateEntry.mutateAsync({
        lorebookId,
        entryId: entry.id,
        name: form.name,
        content: form.content,
        description: form.description,
        keys: form.keys,
        secondaryKeys: form.secondaryKeys,
        selectiveLogic: form.selectiveLogic,
        matchWholeWords: form.matchWholeWords,
        caseSensitive: form.caseSensitive,
        useRegex: form.useRegex,
        characterFilterMode: form.characterFilterMode,
        characterFilterIds: form.characterFilterIds,
        characterTagFilterMode: form.characterTagFilterMode,
        characterTagFilters: form.characterTagFilters,
        generationTriggerFilterMode: form.generationTriggerFilterMode,
        generationTriggerFilters: form.generationTriggerFilters,
        additionalMatchingSources: form.additionalMatchingSources,
        role: form.role,
        sticky: form.sticky,
        cooldown: form.cooldown,
        delay: form.delay,
        ephemeral: form.ephemeral,
        group: form.group,
        tag: form.tag,
        locked: form.locked,
        preventRecursion: form.preventRecursion,
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [form, entry.id, lorebookId, updateEntry]);

  return (
    <div className="space-y-4 border-t border-[var(--border)] px-3 py-3 sm:px-4">
      <div className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/55 px-3 py-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
        <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", STATUS_DOT_COLOR[drawerStatus])} />
        <p>{STATUS_DESCRIPTION[drawerStatus]}</p>
      </div>

      {/* Description */}
      <FieldGroup
        label="Description"
        icon={FileText}
        help="Brief summary of what this entry is about. Used by the Knowledge Router agent to decide whether to inject this entry — not sent to the main AI as content."
      >
        <textarea
          value={form.description ?? ""}
          onChange={(e) => update({ description: e.target.value })}
          rows={2}
          className="w-full resize-y rounded-lg bg-[var(--secondary)] px-2.5 py-2 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          placeholder="Brief summary of what this entry is about (used by Knowledge Router agent)."
        />
      </FieldGroup>

      {/* Keys */}
      <FieldGroup
        label="Primary Keys"
        icon={Key}
        help="Keywords that trigger this entry. When any of these words appear in the chat, this entry's content is injected into the AI's context."
      >
        <KeysEditor keys={form.keys ?? []} onChange={(keys) => update({ keys })} />
      </FieldGroup>

      {/* Secondary Keys + Logic */}
      <FieldGroup
        label="Secondary Keys"
        icon={Key}
        help="Additional keywords used with AND/OR/NOT logic. 'AND' means both primary AND secondary must match. 'NOT' means primary must match but secondary must NOT."
      >
        <KeysEditor keys={form.secondaryKeys ?? []} onChange={(keys) => update({ secondaryKeys: keys })} />
        <div className="mt-2 flex items-center gap-3">
          <label className="text-[0.6875rem] text-[var(--muted-foreground)]">Logic:</label>
          {(["and", "or", "not"] as const).map((logic) => (
            <button
              key={logic}
              onClick={() => update({ selectiveLogic: logic })}
              className={cn(
                "rounded-md px-2 py-0.5 text-[0.6875rem] font-medium transition-colors",
                form.selectiveLogic === logic
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
              )}
            >
              {logic.toUpperCase()}
            </button>
          ))}
        </div>
      </FieldGroup>

      <details className="rounded-lg border border-[var(--border)] bg-[var(--card)]/40 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-[var(--foreground)]">
          Context filters & matching sources
        </summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-2 rounded-lg bg-[var(--secondary)]/45 p-2 ring-1 ring-[var(--border)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.6875rem] font-medium">Characters</span>
                <FilterModeSelect
                  value={form.characterFilterMode ?? "any"}
                  onChange={(value) => update({ characterFilterMode: value })}
                />
              </div>
              <FilterPills
                values={characters.map((character) => ({ value: character.id, label: character.name }))}
                selected={form.characterFilterIds ?? []}
                onChange={(next) => update({ characterFilterIds: next })}
                emptyLabel="No characters available."
              />
            </div>

            <div className="space-y-2 rounded-lg bg-[var(--secondary)]/45 p-2 ring-1 ring-[var(--border)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.6875rem] font-medium">Character tags</span>
                <FilterModeSelect
                  value={form.characterTagFilterMode ?? "any"}
                  onChange={(value) => update({ characterTagFilterMode: value })}
                />
              </div>
              <FilterPills
                values={characterTags.map((tag) => ({ value: tag, label: tag }))}
                selected={form.characterTagFilters ?? []}
                onChange={(next) => update({ characterTagFilters: next })}
                emptyLabel="No character tags available."
              />
            </div>

            <div className="space-y-2 rounded-lg bg-[var(--secondary)]/45 p-2 ring-1 ring-[var(--border)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.6875rem] font-medium">Generation</span>
                <FilterModeSelect
                  value={form.generationTriggerFilterMode ?? "any"}
                  onChange={(value) => update({ generationTriggerFilterMode: value })}
                />
              </div>
              <FilterPills
                values={GENERATION_TRIGGER_OPTIONS}
                selected={form.generationTriggerFilters ?? []}
                onChange={(next) => update({ generationTriggerFilters: next })}
                emptyLabel="No trigger filters available."
              />
            </div>
          </div>

          <div className="space-y-2 rounded-lg bg-[var(--secondary)]/45 p-2 ring-1 ring-[var(--border)]">
            <div>
              <p className="text-[0.6875rem] font-medium">Additional matching sources</p>
              <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                Optional card fields to scan for this entry&apos;s keywords in addition to recent chat.
              </p>
            </div>
            <FilterPills
              values={MATCHING_SOURCE_OPTIONS}
              selected={form.additionalMatchingSources ?? []}
              onChange={(next) => update({ additionalMatchingSources: next as LorebookMatchingSource[] })}
              emptyLabel="No sources available."
            />
          </div>
        </div>
      </details>

      {/* Content */}
      <FieldGroup
        label="Content"
        icon={FileText}
        help="The text that gets injected into the AI's context when this entry activates. Write it as you'd want the AI to know it."
      >
        <ExpandableTextarea
          value={form.content ?? ""}
          onChange={(v) => update({ content: v })}
          rows={5}
          placeholder="The content that will be injected into the prompt when this entry activates…"
          title="Edit Content"
        />
        <p className="mt-1 flex items-center gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
          <Hash size="0.5625rem" />~{estimateTokens(form.content ?? "").toLocaleString()} tokens
        </p>
      </FieldGroup>

      {/* Toggles row — note: enable / regex / trigger mode are now on the row header,
          so they are intentionally omitted from this block to avoid duplication. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ToggleButton
          label="Whole Words"
          value={form.matchWholeWords ?? false}
          onChange={(v) => update({ matchWholeWords: v })}
        />
        <ToggleButton
          label="Case Sensitive"
          value={form.caseSensitive ?? false}
          onChange={(v) => update({ caseSensitive: v })}
        />
        <ToggleButton
          label="Locked"
          value={form.locked ?? false}
          onChange={(v) => update({ locked: v })}
          tooltip="Prevents the Lorebook Keeper agent from modifying this entry."
        />
        <ToggleButton
          label="No Recursion"
          value={form.preventRecursion ?? false}
          onChange={(v) => update({ preventRecursion: v })}
          tooltip="When enabled, this entry's content won't trigger additional entries during recursive scanning."
        />
      </div>

      {/* Role (position/depth/order/probability live on the row header). */}
      <FieldGroup
        label="Role"
        icon={Settings2}
        help="Which role this entry's content is attributed to in the prompt (only meaningful when injected at depth)."
      >
        <select
          value={form.role ?? "system"}
          onChange={(e) => update({ role: e.target.value as "system" | "user" | "assistant" })}
          className="w-full max-w-xs rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        >
          <option value="system">System</option>
          <option value="user">User</option>
          <option value="assistant">Assistant</option>
        </select>
      </FieldGroup>

      {/* Timing */}
      <FieldGroup
        label="Timing"
        icon={Settings2}
        help="Sticky = stays active for N messages after triggering. Cooldown = waits N messages before it can trigger again. Delay = waits N messages before first activation. Ephemeral = auto-disables after N activations (0 = unlimited)."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <NumberField
            label="Sticky"
            value={form.sticky ?? 0}
            onChange={(v) => update({ sticky: v || null })}
            min={0}
          />
          <NumberField
            label="Cooldown"
            value={form.cooldown ?? 0}
            onChange={(v) => update({ cooldown: v || null })}
            min={0}
          />
          <NumberField label="Delay" value={form.delay ?? 0} onChange={(v) => update({ delay: v || null })} min={0} />
          <NumberField
            label="Ephemeral"
            value={form.ephemeral ?? 0}
            onChange={(v) => update({ ephemeral: v || null })}
            min={0}
          />
        </div>
      </FieldGroup>

      {/* Group & Tag */}
      <FieldGroup
        label="Group & Tag"
        icon={Settings2}
        help="Group entries together so only one from the group activates at a time. Tags are for your own organization."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">Group</label>
            <input
              value={form.group ?? ""}
              onChange={(e) => update({ group: e.target.value })}
              className="w-full rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              placeholder="Group name"
            />
          </div>
          <div>
            <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">Tag</label>
            <input
              value={form.tag ?? ""}
              onChange={(e) => update({ tag: e.target.value })}
              className="w-full rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              placeholder="e.g. location, item, lore"
            />
          </div>
        </div>
      </FieldGroup>

      {/* Save bar — only shows when there are unsaved changes in this drawer. */}
      <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
        {dirty && <span className="text-[0.6875rem] text-[var(--muted-foreground)]">Unsaved changes</span>}
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98] disabled:opacity-50"
        >
          <Save size="0.75rem" />
          {saving ? "Saving…" : "Save Entry"}
        </button>
      </div>
    </div>
  );
}
