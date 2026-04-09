// ──────────────────────────────────────────────
// Summary Popover — View / edit / generate chat summary
// Shown via the scroll icon in the chat header bar.
// ──────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useGenerateSummary, useUpdateChatMetadata } from "../../hooks/use-chats";
import { ScrollText, Sparkles, X, Save, Loader2, Info } from "lucide-react";
import { cn } from "../../lib/utils";

interface SummaryPopoverProps {
  chatId: string;
  summary: string | null;
  contextSize: number;
  onContextSizeChange: (size: number) => void;
  onClose: () => void;
}

export function SummaryPopover({ chatId, summary, contextSize, onContextSizeChange, onClose }: SummaryPopoverProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary ?? "");
  const [localSize, setLocalSize] = useState(String(contextSize || ""));
  const sizeInputFocused = useRef(false);
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

  // Sync local size when contextSize prop changes externally
  useEffect(() => {
    if (!sizeInputFocused.current) {
      setLocalSize(contextSize ? String(contextSize) : "");
    }
  }, [contextSize]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [editing]);

  const handleGenerate = useCallback(() => {
    generateSummary.mutate(
      { chatId, contextSize },
      {
        onSuccess: (data) => {
          setDraft(data.summary);
          setEditing(false);
        },
      },
    );
  }, [chatId, contextSize, generateSummary]);

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
          "rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl shadow-black/40",
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
            <div
              className="flex items-center gap-1 mr-1"
              title="Context size — number of recent messages used for summary generation"
            >
              <input
                type="number"
                min={5}
                max={200}
                value={localSize}
                onFocus={() => {
                  sizeInputFocused.current = true;
                }}
                onChange={(e) => setLocalSize(e.target.value)}
                onBlur={() => {
                  sizeInputFocused.current = false;
                  const parsed = parseInt(localSize);
                  if (!localSize || isNaN(parsed)) {
                    setLocalSize("50");
                    onContextSizeChange(50);
                  } else {
                    const clamped = Math.max(5, Math.min(200, parsed));
                    setLocalSize(String(clamped));
                    onContextSizeChange(clamped);
                  }
                }}
                className="w-12 rounded-md bg-[var(--secondary)] px-1.5 py-0.5 text-center text-[0.625rem] tabular-nums ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2 py-1 text-[0.625rem] font-medium transition-all",
                isGenerating
                  ? "cursor-wait text-amber-300/60"
                  : "text-amber-300 hover:bg-amber-400/15 hover:text-amber-200",
              )}
              title="Generate summary with AI"
            >
              {isGenerating ? <Loader2 size="0.6875rem" className="animate-spin" /> : <Sparkles size="0.6875rem" />}
              {isGenerating ? "Generating…" : "Generate"}
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <X size="0.75rem" />
            </button>
          </div>
        </div>

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
