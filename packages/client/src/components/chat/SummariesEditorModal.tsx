// ──────────────────────────────────────────────
// Summaries Editor Modal — edit auto-generated day/week summaries
// ──────────────────────────────────────────────
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X, Plus, Trash2, CalendarClock, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Chat, ChatMetadata, DaySummaryEntry, WeekSummaryEntry } from "@marinara-engine/shared";
import { useQueryClient } from "@tanstack/react-query";
import { chatKeys, useUpdateChatSummaries } from "../../hooks/use-chats";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function fmtTokens(n: number): string {
  return n.toLocaleString();
}

function entryTokenText(entry: DaySummaryEntry | WeekSummaryEntry): string {
  return [entry.summary, ...entry.keyDetails].join("\n");
}

interface AutoSizingTextareaProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

function AutoSizingTextarea({ value, onChange, className }: AutoSizingTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className={cn("resize-none overflow-hidden", className)}
    />
  );
}

interface SummariesEditorModalProps {
  chat: Chat;
  open: boolean;
  onClose: () => void;
}

// ── Date helpers (mirror generate.routes.ts week-consolidation logic) ──

function parseDateKey(key: string): Date {
  const [dd, mm, yyyy] = key.split(".");
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

function fmtDateKey(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function weekRangeLabel(mondayKey: string): string {
  const monday = parseDateKey(mondayKey);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return `Week of ${mondayKey} – ${fmtDateKey(sunday)}`;
}

// ── Entry discriminator ──

type EntryKind = "week" | "day";

interface EntryRef {
  kind: EntryKind;
  key: string;
  label: string;
}

// ── Draft state ──

interface Drafts {
  daySummaries: Record<string, DaySummaryEntry>;
  weekSummaries: Record<string, WeekSummaryEntry>;
}

function cloneDrafts(metadata: ChatMetadata): Drafts {
  return {
    daySummaries: JSON.parse(JSON.stringify(metadata.daySummaries ?? {})),
    weekSummaries: JSON.parse(JSON.stringify(metadata.weekSummaries ?? {})),
  };
}

function computeDelta(
  current: Drafts,
  snapshot: Drafts,
): { daySummaries?: Record<string, DaySummaryEntry>; weekSummaries?: Record<string, WeekSummaryEntry> } {
  const dayDelta: Record<string, DaySummaryEntry> = {};
  const weekDelta: Record<string, WeekSummaryEntry> = {};
  for (const [k, v] of Object.entries(current.daySummaries)) {
    if (JSON.stringify(v) !== JSON.stringify(snapshot.daySummaries[k])) dayDelta[k] = v;
  }
  for (const [k, v] of Object.entries(current.weekSummaries)) {
    if (JSON.stringify(v) !== JSON.stringify(snapshot.weekSummaries[k])) weekDelta[k] = v;
  }
  const out: { daySummaries?: Record<string, DaySummaryEntry>; weekSummaries?: Record<string, WeekSummaryEntry> } = {};
  if (Object.keys(dayDelta).length > 0) out.daySummaries = dayDelta;
  if (Object.keys(weekDelta).length > 0) out.weekSummaries = weekDelta;
  return out;
}

export function SummariesEditorModal({ chat, open, onClose }: SummariesEditorModalProps) {
  const metadata = useMemo(
    () => (typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {})),
    [chat.metadata],
  );

  const [drafts, setDrafts] = useState<Drafts>(() => cloneDrafts(metadata));
  const snapshotRef = useRef<Drafts>(drafts);
  const updateSummaries = useUpdateChatSummaries();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Reinitialize drafts whenever the modal opens, refetching the chat first so
  // auto-summaries written during a prior generation show up without a page refresh.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      await qc.refetchQueries({ queryKey: chatKeys.detail(chat.id) });
      if (cancelled) return;
      const latest = qc.getQueryData<Chat>(chatKeys.detail(chat.id));
      const latestMeta: ChatMetadata = latest
        ? typeof latest.metadata === "string"
          ? JSON.parse(latest.metadata)
          : (latest.metadata ?? {})
        : metadata;
      const fresh = cloneDrafts(latestMeta);
      setDrafts(fresh);
      snapshotRef.current = fresh;
      setExpanded(new Set());
      updateSummaries.reset();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Build the ordered entry list: weeks first (chronological), then non-consolidated days.
  const entries = useMemo<EntryRef[]>(() => {
    const list: EntryRef[] = [];

    // 1. Weeks, sorted by Monday key ascending.
    const weekKeys = Object.keys(drafts.weekSummaries).sort(
      (a, b) => parseDateKey(a).getTime() - parseDateKey(b).getTime(),
    );
    for (const wk of weekKeys) {
      list.push({ kind: "week", key: wk, label: weekRangeLabel(wk) });
    }

    // 2. Days that are NOT covered by a consolidated week.
    const dayToWeek = new Map<string, string>();
    for (const wk of weekKeys) {
      const monday = parseDateKey(wk);
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        dayToWeek.set(fmtDateKey(d), wk);
      }
    }
    const dayKeys = Object.keys(drafts.daySummaries)
      .filter((k) => !dayToWeek.has(k))
      .sort((a, b) => parseDateKey(a).getTime() - parseDateKey(b).getTime());
    for (const dk of dayKeys) {
      list.push({ kind: "day", key: dk, label: dk });
    }

    return list;
  }, [drafts]);

  const delta = useMemo(() => computeDelta(drafts, snapshotRef.current), [drafts]);
  const isDirty = !!(delta.daySummaries || delta.weekSummaries);

  const totalTokens = useMemo(() => {
    let text = "";
    for (const entry of entries) {
      const e = entry.kind === "week" ? drafts.weekSummaries[entry.key] : drafts.daySummaries[entry.key];
      if (e) text += entryTokenText(e);
    }
    return estimateTokens(text);
  }, [entries, drafts]);

  const allExpanded = entries.length > 0 && expanded.size === entries.length;
  const toggleEntry = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (allExpanded) setExpanded(new Set());
    else setExpanded(new Set(entries.map((e) => `${e.kind}:${e.key}`)));
  };

  const updateEntry = (kind: EntryKind, key: string, next: DaySummaryEntry | WeekSummaryEntry) => {
    setDrafts((prev) => {
      if (kind === "week") {
        return { ...prev, weekSummaries: { ...prev.weekSummaries, [key]: next as WeekSummaryEntry } };
      }
      return { ...prev, daySummaries: { ...prev.daySummaries, [key]: next as DaySummaryEntry } };
    });
  };

  const handleSave = () => {
    if (!isDirty) return;
    updateSummaries.mutate(
      { id: chat.id, ...delta },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <div className="flex items-center gap-2">
            <CalendarClock size="1rem" className="text-[var(--muted-foreground)]" />
            <h3 className="text-sm font-bold">Automatic Summarization</h3>
            <span className="text-[0.625rem] text-[var(--muted-foreground)]">
              {entries.length} {entries.length === 1 ? "entry" : "entries"} &middot; ~{fmtTokens(totalTokens)} token
              {totalTokens !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)]"
          >
            <X size="1rem" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/30 px-3 py-2 text-[0.6875rem] text-[var(--muted-foreground)]">
            Days from the current week are automatically consolidated into a weekly summary once the week ends. Edits to
            the current week&apos;s days may be rewritten by that consolidation.
          </div>

          {entries.length === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-[0.75rem] text-[var(--muted-foreground)]">
              No summaries yet — come back after your first day of chatting has ended.
            </div>
          )}

          {entries.length > 0 && (
            <div className="flex items-center justify-end">
              <button
                onClick={toggleAll}
                title={allExpanded ? "Collapse all" : "Expand all"}
                aria-label={allExpanded ? "Collapse all" : "Expand all"}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              >
                {allExpanded ? <ChevronsDownUp size="0.85rem" /> : <ChevronsUpDown size="0.85rem" />}
                {allExpanded ? "Collapse all" : "Expand all"}
              </button>
            </div>
          )}

          {entries.map((entry) => {
            const current = entry.kind === "week" ? drafts.weekSummaries[entry.key]! : drafts.daySummaries[entry.key]!;
            const id = `${entry.kind}:${entry.key}`;
            const isOpen = expanded.has(id);
            const entryTokens = estimateTokens(entryTokenText(current));

            return (
              <div key={id} className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/20">
                <button
                  onClick={() => toggleEntry(id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]/50"
                >
                  <ChevronRight
                    size="0.85rem"
                    className={cn(
                      "shrink-0 text-[var(--muted-foreground)] transition-transform",
                      isOpen && "rotate-90",
                    )}
                  />
                  <span className="text-[0.75rem] font-semibold">{entry.label}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[0.5625rem] font-medium uppercase tracking-wider max-md:hidden",
                      entry.kind === "week" ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-blue-400",
                    )}
                  >
                    {entry.kind}
                  </span>
                  <span className="ml-auto shrink-0 text-[0.625rem] text-[var(--muted-foreground)]">
                    ~{fmtTokens(entryTokens)} token{entryTokens !== 1 ? "s" : ""}
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-2 border-t border-[var(--border)] px-3 py-2">
                    {/* Summary textarea */}
                    <div className="space-y-1">
                      <label className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Summary</label>
                      <AutoSizingTextarea
                        value={current.summary}
                        onChange={(next) => updateEntry(entry.kind, entry.key, { ...current, summary: next })}
                        className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[0.75rem] leading-relaxed text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                      />
                    </div>

                    {/* Key details rows */}
                    <div className="space-y-1">
                      <label className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Key Details</label>
                      {current.keyDetails.length === 0 && (
                        <p className="text-[0.6875rem] italic text-[var(--muted-foreground)]">No key details.</p>
                      )}
                      <div className="space-y-1.5">
                        {current.keyDetails.map((detail, i) => (
                          <div key={i} className="flex gap-1.5">
                            <AutoSizingTextarea
                              value={detail}
                              onChange={(next) => {
                                const nextDetails = [...current.keyDetails];
                                nextDetails[i] = next;
                                updateEntry(entry.kind, entry.key, { ...current, keyDetails: nextDetails });
                              }}
                              className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[0.75rem] leading-relaxed text-[var(--foreground)] focus:border-[var(--primary)] focus:outline-none"
                            />
                            <button
                              onClick={() => {
                                const nextDetails = current.keyDetails.filter((_, idx) => idx !== i);
                                updateEntry(entry.kind, entry.key, { ...current, keyDetails: nextDetails });
                              }}
                              className="shrink-0 self-start rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
                              title="Delete key detail"
                            >
                              <Trash2 size="0.75rem" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() =>
                          updateEntry(entry.kind, entry.key, { ...current, keyDetails: [...current.keyDetails, ""] })
                        }
                        className="mt-1 flex items-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                      >
                        <Plus size="0.75rem" />
                        Add key detail
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3">
          <div className="text-[0.6875rem] text-[var(--destructive)]">
            {updateSummaries.isError ? "Save failed — try again." : ""}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={updateSummaries.isPending}
              className="rounded-lg px-3 py-1.5 text-[0.75rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty || updateSummaries.isPending}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[0.75rem] font-medium text-[var(--primary-foreground)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {updateSummaries.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
