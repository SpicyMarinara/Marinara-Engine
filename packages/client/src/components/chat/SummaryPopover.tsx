// ──────────────────────────────────────────────
// Summary Popover — View / edit / generate chat summary
// Shown via the scroll icon in the chat header bar.
// ──────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useGenerateSummary, useUpdateChatMetadata } from "../../hooks/use-chats";
import { Info, Loader2, Save, ScrollText, Settings2, Sparkles, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { useUIStore } from "../../stores/ui.store";

interface SummaryPopoverProps {
  chatId: string;
  summary: string | null;
  contextSize: number;
  totalMessageCount: number;
  messageIdByOrderIndex: Map<number, string>;
  onClose: () => void;
}

type SummarySourceMode = "last" | "range";

const MIN_SUMMARY_MESSAGES = 5;
const MAX_SUMMARY_MESSAGES = 200;

function clampSummaryCount(value: number): number {
  return Math.max(MIN_SUMMARY_MESSAGES, Math.min(MAX_SUMMARY_MESSAGES, value));
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function SummaryPopover({
  chatId,
  summary,
  contextSize,
  totalMessageCount,
  messageIdByOrderIndex,
  onClose,
}: SummaryPopoverProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary ?? "");
  const summaryPopoverSettings = useUIStore((s) => s.summaryPopoverSettings);
  const setSummaryPopoverSettings = useUIStore((s) => s.setSummaryPopoverSettings);
  const persistedContextSize = summaryPopoverSettings.contextSize ?? contextSize;
  const [localSize, setLocalSize] = useState(String(persistedContextSize || ""));
  const sourceMode = summaryPopoverSettings.sourceMode;
  const [scopeSettingsOpen, setScopeSettingsOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState(() =>
    String(summaryPopoverSettings.rangeStart ?? Math.max(1, totalMessageCount - persistedContextSize + 1)),
  );
  const [rangeEnd, setRangeEnd] = useState(() =>
    String(summaryPopoverSettings.rangeEnd ?? Math.max(1, totalMessageCount)),
  );
  const sizeInputFocused = useRef(false);
  const rangeInputFocused = useRef(false);
  const generateSummary = useGenerateSummary();
  const updateMeta = useUpdateChatMetadata();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside — defer by one frame so the synthesised
  // mousedown from the tap that *opened* the popover doesn't
  // immediately close it on touch devices (Android / iPadOS).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const raf = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handler);
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Sync draft when summary changes (e.g. after generation)
  useEffect(() => {
    setDraft(summary ?? "");
  }, [summary]);

  // Sync local size when the persisted/default context size changes externally.
  useEffect(() => {
    if (!sizeInputFocused.current) {
      setLocalSize(persistedContextSize ? String(persistedContextSize) : "");
    }
  }, [persistedContextSize]);

  // Keep the default custom range aligned to the currently selected "last" window.
  useEffect(() => {
    if (rangeInputFocused.current || sourceMode === "range") return;
    setRangeStart(String(Math.max(1, totalMessageCount - persistedContextSize + 1)));
    setRangeEnd(String(Math.max(1, totalMessageCount)));
  }, [persistedContextSize, sourceMode, totalMessageCount]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [editing]);

  const normalizedLastSize = clampSummaryCount(parsePositiveInteger(localSize) ?? persistedContextSize ?? 50);
  const normalizedRangeStart = Math.max(1, Math.min(totalMessageCount || 1, parsePositiveInteger(rangeStart) ?? 1));
  const normalizedRangeEnd = Math.max(
    1,
    Math.min(totalMessageCount || 1, parsePositiveInteger(rangeEnd) ?? (totalMessageCount || 1)),
  );
  const rangeLow = Math.min(normalizedRangeStart, normalizedRangeEnd);
  const rangeHigh = Math.max(normalizedRangeStart, normalizedRangeEnd);
  const selectedRangeCount = rangeHigh - rangeLow + 1;
  const hasMessages = totalMessageCount > 0;
  const rangeTooLarge = sourceMode === "range" && selectedRangeCount > MAX_SUMMARY_MESSAGES;
  const rangeStartMessageId = messageIdByOrderIndex.get(rangeLow - 1);
  const rangeEndMessageId = messageIdByOrderIndex.get(rangeHigh - 1);
  const rangeMessagesLoaded = sourceMode !== "range" || (!!rangeStartMessageId && !!rangeEndMessageId);
  const canGenerate = hasMessages && !rangeTooLarge && rangeMessagesLoaded;
  const sourceSummary =
    sourceMode === "range"
      ? `Messages ${rangeLow}-${rangeHigh}`
      : `Last ${normalizedLastSize} ${normalizedLastSize === 1 ? "message" : "messages"}`;
  const sourceDetail =
    sourceMode === "range"
      ? `${selectedRangeCount} ${selectedRangeCount === 1 ? "message" : "messages"} selected`
      : totalMessageCount > 0
        ? `Using ${Math.min(normalizedLastSize, totalMessageCount)} of ${totalMessageCount} messages`
        : "No messages yet";
  const rangeStatusText = !rangeMessagesLoaded
    ? "Load this range in the chat before generating."
    : rangeTooLarge
      ? `Choose ${MAX_SUMMARY_MESSAGES} messages or fewer.`
      : `${selectedRangeCount} ${selectedRangeCount === 1 ? "message" : "messages"} selected.`;

  const handleSourceModeChange = useCallback(
    (mode: SummarySourceMode) => {
      if (mode === "range") {
        setRangeStart(String(rangeLow));
        setRangeEnd(String(rangeHigh));
        setSummaryPopoverSettings({ sourceMode: mode, rangeStart: rangeLow, rangeEnd: rangeHigh });
        return;
      }
      setSummaryPopoverSettings({ sourceMode: mode });
    },
    [rangeHigh, rangeLow, setSummaryPopoverSettings],
  );

  const handleGenerate = useCallback(() => {
    if (!canGenerate) return;
    if (sourceMode === "range") {
      setRangeStart(String(rangeLow));
      setRangeEnd(String(rangeHigh));
      if (!rangeStartMessageId || !rangeEndMessageId) return;
      generateSummary.mutate(
        { chatId, rangeStartMessageId, rangeEndMessageId },
        {
          onSuccess: (data) => {
            setDraft(data.summary);
            setEditing(false);
          },
        },
      );
      return;
    }
    setLocalSize(String(normalizedLastSize));
    setSummaryPopoverSettings({ contextSize: normalizedLastSize });
    generateSummary.mutate(
      { chatId, contextSize: normalizedLastSize },
      {
        onSuccess: (data) => {
          setDraft(data.summary);
          setEditing(false);
        },
      },
    );
  }, [
    canGenerate,
    chatId,
    generateSummary,
    normalizedLastSize,
    rangeHigh,
    rangeLow,
    rangeEndMessageId,
    rangeStartMessageId,
    setSummaryPopoverSettings,
    sourceMode,
  ]);

  const handleSave = useCallback(() => {
    updateMeta.mutate({ id: chatId, summary: draft || null });
    setEditing(false);
  }, [chatId, draft, updateMeta]);

  const isGenerating = generateSummary.isPending;

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const content = (
    <div
      ref={panelRef}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        isMobile
          ? "fixed inset-0 z-[9999] flex items-center justify-center p-4 max-md:pt-[max(1rem,env(safe-area-inset-top))]"
          : "absolute right-0 top-full z-[100] mt-1",
      )}
    >
      {/* Mobile backdrop */}
      {isMobile && <div className="absolute inset-0 bg-black/30" onClick={onClose} />}
      <div
        className={cn(
          "relative rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl shadow-black/40",
          isMobile ? "relative w-full max-w-sm max-h-[calc(100dvh-4rem)] overflow-y-auto" : "w-80",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <ScrollText size="0.8125rem" className="text-amber-400" />
            Chat Summary
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setScopeSettingsOpen((open) => !open)}
              className={cn(
                "rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]",
                scopeSettingsOpen && "bg-[var(--accent)] text-amber-300",
              )}
              title="Summary source settings"
              aria-label="Summary source settings"
              aria-expanded={scopeSettingsOpen}
            >
              <Settings2 size="0.75rem" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              aria-label="Close summary"
            >
              <X size="0.75rem" />
            </button>
          </div>
        </div>

        {scopeSettingsOpen && (
          <div className="absolute right-2 top-10 z-10 w-[calc(100%-1rem)] max-w-72 rounded-xl border border-[var(--border)] bg-[var(--popover)] p-2 text-[var(--popover-foreground)] shadow-xl shadow-black/30 ring-1 ring-white/5">
            <div className="mb-2 flex items-start justify-between gap-3 px-1">
              <div className="min-w-0">
                <p className="text-[0.625rem] font-semibold uppercase text-[var(--muted-foreground)]">
                  Summary Scope
                </p>
                <p className="truncate text-xs font-semibold text-[var(--popover-foreground)]">{sourceSummary}</p>
              </div>
              <span className="shrink-0 pt-0.5 text-right text-[0.625rem] text-[var(--muted-foreground)]">
                {sourceDetail}
              </span>
            </div>

            <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 p-2">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--background)]/30 p-1">
                {(["last", "range"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => handleSourceModeChange(mode)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[0.625rem] font-semibold transition-colors",
                      sourceMode === mode
                        ? "bg-amber-400/20 text-amber-200 ring-1 ring-amber-300/30"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                    )}
                  >
                    {mode === "last" ? "Last" : "Range"}
                  </button>
                ))}
              </div>

              {sourceMode === "last" ? (
                <label className="flex items-center justify-between gap-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                  <span>Messages</span>
                  <input
                    type="number"
                    min={MIN_SUMMARY_MESSAGES}
                    max={MAX_SUMMARY_MESSAGES}
                    value={localSize}
                    onFocus={() => {
                      sizeInputFocused.current = true;
                    }}
                    onChange={(e) => {
                      setLocalSize(e.target.value);
                      const next = parsePositiveInteger(e.target.value);
                      if (next !== null) {
                        setSummaryPopoverSettings({ contextSize: clampSummaryCount(next) });
                      }
                    }}
                    onBlur={() => {
                      sizeInputFocused.current = false;
                      const clamped = clampSummaryCount(parsePositiveInteger(localSize) ?? 50);
                      setLocalSize(String(clamped));
                      setSummaryPopoverSettings({ contextSize: clamped });
                    }}
                    className="w-16 rounded-md bg-[var(--card)] px-2 py-1 text-center text-xs tabular-nums text-[var(--foreground)] ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  />
                </label>
              ) : (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                      From
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, totalMessageCount)}
                        value={rangeStart}
                        onFocus={() => {
                          rangeInputFocused.current = true;
                        }}
                        onChange={(e) => {
                          setRangeStart(e.target.value);
                          const next = parsePositiveInteger(e.target.value);
                          if (next !== null) {
                            setSummaryPopoverSettings({
                              rangeStart: Math.max(1, Math.min(totalMessageCount || 1, next)),
                            });
                          }
                        }}
                        onBlur={() => {
                          rangeInputFocused.current = false;
                          setRangeStart(String(normalizedRangeStart));
                          setSummaryPopoverSettings({ rangeStart: normalizedRangeStart });
                        }}
                        className="w-full rounded-md bg-[var(--card)] px-2 py-1 text-center text-xs tabular-nums text-[var(--foreground)] ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                      />
                    </label>
                    <label className="space-y-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                      To
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, totalMessageCount)}
                        value={rangeEnd}
                        onFocus={() => {
                          rangeInputFocused.current = true;
                        }}
                        onChange={(e) => {
                          setRangeEnd(e.target.value);
                          const next = parsePositiveInteger(e.target.value);
                          if (next !== null) {
                            setSummaryPopoverSettings({
                              rangeEnd: Math.max(1, Math.min(totalMessageCount || 1, next)),
                            });
                          }
                        }}
                        onBlur={() => {
                          rangeInputFocused.current = false;
                          setRangeEnd(String(normalizedRangeEnd));
                          setSummaryPopoverSettings({ rangeEnd: normalizedRangeEnd });
                        }}
                        className="w-full rounded-md bg-[var(--card)] px-2 py-1 text-center text-xs tabular-nums text-[var(--foreground)] ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                      />
                    </label>
                  </div>
                  <p
                    className={cn(
                      "text-[0.625rem]",
                      rangeTooLarge || !rangeMessagesLoaded ? "text-red-300" : "text-[var(--muted-foreground)]",
                    )}
                  >
                    {rangeStatusText}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-1.5 pt-1">
              <SummarySettingsToggle
                label="Hide summarised messages"
                checked={summaryPopoverSettings.hideSummarisedMessages}
                onChange={(checked) => setSummaryPopoverSettings({ hideSummarisedMessages: checked })}
              />
              <SummarySettingsToggle
                label="Collapse hidden messages"
                checked={summaryPopoverSettings.collapseHiddenMessages}
                onChange={(checked) => setSummaryPopoverSettings({ collapseHiddenMessages: checked })}
              />
            </div>
          </div>
        )}

        {/* Body */}
        <div className="max-h-72 overflow-y-auto p-3">
          {editing ? (
            <div className="space-y-2">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={6}
                className="max-h-48 w-full resize-y rounded-lg bg-[var(--secondary)] p-2.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                placeholder="Write or paste a summary of this chat…"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={() => {
                    setDraft(summary ?? "");
                    setEditing(false);
                  }}
                  className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={updateMeta.isPending}
                  className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-amber-400 to-orange-500 px-2.5 py-1 text-[0.625rem] font-medium text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98] disabled:opacity-50"
                >
                  <Save size="0.625rem" />
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div>
              {draft ? (
                <div
                  className="cursor-pointer rounded-lg p-2 transition-colors hover:bg-[var(--accent)]"
                  onClick={() => setEditing(true)}
                  title="Click to edit"
                >
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--foreground)]/80">{draft}</p>
                </div>
              ) : (
                <div
                  className="cursor-pointer rounded-lg p-4 transition-colors hover:bg-[var(--accent)]"
                  onClick={() => setEditing(true)}
                >
                  <p className="text-center text-xs italic text-[var(--muted-foreground)]">
                    No summary yet. Click to write one, or press Generate.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Source controls */}
        <div className="border-t border-[var(--border)] px-3 py-2">
          <div className="mb-2 flex items-center justify-between gap-2 px-2 text-[0.625rem] text-[var(--muted-foreground)]">
            <span className="truncate">Source: {sourceSummary}</span>
            <span className="shrink-0">{sourceDetail}</span>
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !canGenerate}
            className={cn(
              "mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all",
              isGenerating || !canGenerate
                ? "cursor-not-allowed bg-[var(--secondary)] text-[var(--muted-foreground)]"
                : "bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-sm hover:shadow-md active:scale-[0.98]",
            )}
            title="Generate summary with AI"
          >
            {isGenerating ? <Loader2 size="0.8125rem" className="animate-spin" /> : <Sparkles size="0.8125rem" />}
            {isGenerating ? "Generating..." : "Generate"}
          </button>
        </div>

        {/* Info tip */}
        <div className="border-t border-[var(--border)] px-3 py-2">
          <p className="flex items-start gap-1.5 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
            <Info size="0.6875rem" className="mt-0.5 shrink-0 text-amber-400/70" />
            <span>
              Use the Generate button above to update the summary manually. Add an{" "}
              <strong className="font-medium text-[var(--foreground)]/70">Automated Chat Summary</strong> agent to the
              chat if you&apos;d like it to be updated automatically every X messages.
            </span>
          </p>
        </div>
      </div>
    </div>
  );

  return isMobile ? createPortal(content, document.body) : content;
}

interface SummarySettingsToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function SummarySettingsToggle({ label, checked, onChange }: SummarySettingsToggleProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1.5 py-1 text-[0.6875rem] text-[var(--popover-foreground)] transition-colors hover:bg-[var(--accent)]/50">
      <span className="min-w-0 truncate">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 shrink-0 accent-amber-400"
      />
    </label>
  );
}
