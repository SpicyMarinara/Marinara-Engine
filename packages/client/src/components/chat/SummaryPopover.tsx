// ──────────────────────────────────────────────
// Summary Popover — View / edit / generate chat summary
// Shown via the scroll icon in the chat header bar.
// ──────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useBulkSetMessagesHiddenFromAI, useGenerateSummary, useUpdateChatMetadata } from "../../hooks/use-chats";
import {
  Check,
  ChevronDown,
  Copy,
  Info,
  Loader2,
  PenLine,
  Plus,
  Save,
  ScrollText,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { cn, generateClientId } from "../../lib/utils";
import { useUIStore } from "../../stores/ui.store";
import { DEFAULT_AGENT_PROMPTS, type ChatSummaryPromptTemplate } from "@marinara-engine/shared";
import { showConfirmDialog } from "../../lib/app-dialogs";

interface SummaryPopoverProps {
  chatId: string;
  summary: string | null;
  contextSize: number;
  promptTemplates?: ChatSummaryPromptTemplate[];
  activePromptTemplateId?: string | null;
  totalMessageCount: number;
  onClose: () => void;
}

type SummarySourceMode = "last" | "range";

const MIN_SUMMARY_MESSAGES = 5;
const MAX_SUMMARY_MESSAGES = 200;
const SUMMARY_HEADING_PATTERN = /^(?:#{1,6}\s*)?(?:\*\*)?([^:\n]{3,80})(?:\*\*)?:\s*$/;
const SUMMARY_BULLET_PATTERN = /^[-*•]\s+/;

interface SummarySection {
  title: string | null;
  lines: string[];
}

function clampSummaryCount(value: number): number {
  return Math.max(MIN_SUMMARY_MESSAGES, Math.min(MAX_SUMMARY_MESSAGES, value));
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatSummaryHeading(value: string): string {
  return value
    .replace(/^#+\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .trim();
}

function parseSummarySections(value: string): SummarySection[] {
  const sections: SummarySection[] = [];
  let current: SummarySection = { title: null, lines: [] };

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (current.lines.length > 0 && current.lines[current.lines.length - 1] !== "") {
        current.lines.push("");
      }
      continue;
    }

    const headingMatch = line.match(SUMMARY_HEADING_PATTERN);
    if (headingMatch && !SUMMARY_BULLET_PATTERN.test(line)) {
      if (current.title || current.lines.some(Boolean)) sections.push(current);
      current = { title: formatSummaryHeading(headingMatch[1] ?? line), lines: [] };
      continue;
    }

    current.lines.push(line);
  }

  if (current.title || current.lines.some(Boolean)) sections.push(current);

  if (sections.length === 0 && value.trim()) {
    return [{ title: null, lines: [value.trim()] }];
  }

  return sections;
}

export function SummaryPopover({
  chatId,
  summary,
  contextSize,
  promptTemplates = [],
  activePromptTemplateId = null,
  totalMessageCount,
  onClose,
}: SummaryPopoverProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary ?? "");
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [templateSelectOpen, setTemplateSelectOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateNameDraft, setTemplateNameDraft] = useState("");
  const [templatePromptDraft, setTemplatePromptDraft] = useState("");
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
  const bulkSetMessagesHiddenFromAI = useBulkSetMessagesHiddenFromAI();
  const updateMeta = useUpdateChatMetadata();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const persistSummaryContextSize = useCallback(
    (size: number) => {
      const clamped = clampSummaryCount(size);
      setSummaryPopoverSettings({ contextSize: clamped });
      if (contextSize !== clamped) {
        updateMeta.mutate({ id: chatId, summaryContextSize: clamped });
      }
    },
    [chatId, contextSize, setSummaryPopoverSettings, updateMeta],
  );

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
  const canGenerate = hasMessages && !rangeTooLarge;
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
  const rangeStatusText = rangeTooLarge
    ? `Choose ${MAX_SUMMARY_MESSAGES} messages or fewer.`
    : `${selectedRangeCount} ${selectedRangeCount === 1 ? "message" : "messages"} selected.`;
  const cleanedPromptTemplates = promptTemplates.filter(
    (template) =>
      typeof template.id === "string" &&
      template.id.trim().length > 0 &&
      typeof template.name === "string" &&
      typeof template.prompt === "string" &&
      template.prompt.trim().length > 0,
  );
  const activePromptTemplate = activePromptTemplateId
    ? cleanedPromptTemplates.find((template) => template.id === activePromptTemplateId)
    : null;
  const promptTemplateSummary = activePromptTemplate?.name ?? "Built-in default";
  const isEditingExistingTemplate = !!editingTemplateId;
  const hasTemplateDraft = templateNameDraft.trim().length > 0 && templatePromptDraft.trim().length > 0;
  const summarySections = parseSummarySections(draft);

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
    const maybeHideSummarisedMessages = (messageIds: string[] | undefined) => {
      if (!summaryPopoverSettings.hideSummarisedMessages || !messageIds?.length) return;
      bulkSetMessagesHiddenFromAI.mutate({ chatId, messageIds, hidden: true });
    };
    if (sourceMode === "range") {
      setRangeStart(String(rangeLow));
      setRangeEnd(String(rangeHigh));
      generateSummary.mutate(
        { chatId, rangeStartIndex: rangeLow, rangeEndIndex: rangeHigh, promptTemplateId: activePromptTemplateId },
        {
          onSuccess: (data) => {
            setDraft(data.summary ?? "");
            setEditing(false);
            maybeHideSummarisedMessages(data.messageIds);
          },
        },
      );
      return;
    }
    setLocalSize(String(normalizedLastSize));
    persistSummaryContextSize(normalizedLastSize);
    generateSummary.mutate(
      { chatId, contextSize: normalizedLastSize, promptTemplateId: activePromptTemplateId },
      {
        onSuccess: (data) => {
          setDraft(data.summary ?? "");
          setEditing(false);
          maybeHideSummarisedMessages(data.messageIds);
        },
      },
    );
  }, [
    bulkSetMessagesHiddenFromAI,
    canGenerate,
    chatId,
    generateSummary,
    normalizedLastSize,
    rangeHigh,
    rangeLow,
    persistSummaryContextSize,
    sourceMode,
    activePromptTemplateId,
    summaryPopoverSettings.hideSummarisedMessages,
  ]);

  const handleSave = useCallback(() => {
    updateMeta.mutate({ id: chatId, summary: draft || null });
    setEditing(false);
  }, [chatId, draft, updateMeta]);

  const persistPromptTemplates = useCallback(
    (templates: ChatSummaryPromptTemplate[], activeId: string | null) => {
      updateMeta.mutate({
        id: chatId,
        summaryPromptTemplates: templates,
        activeSummaryPromptTemplateId: activeId,
      });
    },
    [chatId, updateMeta],
  );

  const handleSelectPromptTemplate = useCallback(
    (templateId: string | null) => {
      persistPromptTemplates(cleanedPromptTemplates, templateId);
      setTemplateSelectOpen(false);
    },
    [cleanedPromptTemplates, persistPromptTemplates],
  );

  const resetTemplateDraft = useCallback(() => {
    setEditingTemplateId(null);
    setTemplateNameDraft("");
    setTemplatePromptDraft("");
  }, []);

  const handleEditPromptTemplate = useCallback((template: ChatSummaryPromptTemplate) => {
    setEditingTemplateId(template.id);
    setTemplateNameDraft(template.name);
    setTemplatePromptDraft(template.prompt);
    setTemplateEditorOpen(true);
  }, []);

  const handleNewPromptTemplate = useCallback(() => {
    setEditingTemplateId(null);
    setTemplateNameDraft(`Summary Style ${cleanedPromptTemplates.length + 1}`);
    setTemplatePromptDraft(DEFAULT_AGENT_PROMPTS["chat-summary"] ?? "");
    setTemplateEditorOpen(true);
  }, [cleanedPromptTemplates.length]);

  const handleDuplicatePromptTemplate = useCallback((template: ChatSummaryPromptTemplate | null) => {
    setEditingTemplateId(null);
    setTemplateNameDraft(`${template?.name ?? "Built-in default"} copy`);
    setTemplatePromptDraft(template?.prompt ?? DEFAULT_AGENT_PROMPTS["chat-summary"] ?? "");
    setTemplateEditorOpen(true);
  }, []);

  const handleSavePromptTemplate = useCallback(() => {
    if (!hasTemplateDraft) return;
    const trimmedName = templateNameDraft.trim().slice(0, 80);
    const trimmedPrompt = templatePromptDraft.trim();
    const nextTemplates = isEditingExistingTemplate
      ? cleanedPromptTemplates.map((template) =>
          template.id === editingTemplateId ? { ...template, name: trimmedName, prompt: trimmedPrompt } : template,
        )
      : [
          ...cleanedPromptTemplates,
          {
            id: generateClientId(),
            name: trimmedName,
            prompt: trimmedPrompt,
          },
        ];
    const nextActiveId = isEditingExistingTemplate
      ? activePromptTemplateId
      : nextTemplates[nextTemplates.length - 1]!.id;
    persistPromptTemplates(nextTemplates, nextActiveId ?? null);
    resetTemplateDraft();
  }, [
    activePromptTemplateId,
    cleanedPromptTemplates,
    editingTemplateId,
    hasTemplateDraft,
    isEditingExistingTemplate,
    persistPromptTemplates,
    resetTemplateDraft,
    templateNameDraft,
    templatePromptDraft,
  ]);

  const handleDeletePromptTemplate = useCallback(
    async (templateId: string) => {
      const target = cleanedPromptTemplates.find((template) => template.id === templateId);
      if (!target) return;
      const confirmed = await showConfirmDialog({
        title: "Delete summary template?",
        message: `Delete "${target.name}" from this chat? Existing summaries will stay unchanged.`,
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        tone: "destructive",
      });
      if (!confirmed) return;
      const nextTemplates = cleanedPromptTemplates.filter((template) => template.id !== templateId);
      persistPromptTemplates(nextTemplates, activePromptTemplateId === templateId ? null : activePromptTemplateId);
      if (editingTemplateId === templateId) resetTemplateDraft();
    },
    [activePromptTemplateId, cleanedPromptTemplates, editingTemplateId, persistPromptTemplates, resetTemplateDraft],
  );

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
          isMobile ? "relative w-full max-w-sm max-h-[calc(100dvh-4rem)] overflow-y-auto" : "w-[22rem]",
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5">
          <div className="min-w-0 space-y-0.5">
            <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
              <ScrollText size="0.8125rem" className="shrink-0 text-[var(--muted-foreground)]" />
              <span className="truncate">Chat Summary</span>
            </div>
            <p className="truncate text-[0.625rem] text-[var(--muted-foreground)]">{sourceSummary}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setScopeSettingsOpen((open) => !open)}
              className={cn(
                "rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]",
                scopeSettingsOpen && "bg-[var(--accent)] text-[var(--foreground)] ring-1 ring-[var(--border)]",
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
          <div className="absolute right-2 top-12 z-10 max-h-[min(34rem,calc(100vh-7rem))] w-[calc(100%-1rem)] max-w-80 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--popover)] p-2.5 text-[var(--popover-foreground)] shadow-xl shadow-black/30 ring-1 ring-white/5">
            <div className="mb-2.5 flex items-start justify-between gap-3 px-1">
              <div className="min-w-0">
                <p className="text-[0.625rem] font-semibold uppercase text-[var(--muted-foreground)]">Summary Scope</p>
                <p className="truncate text-xs font-semibold text-[var(--popover-foreground)]">{sourceSummary}</p>
              </div>
              <span className="shrink-0 pt-0.5 text-right text-[0.625rem] text-[var(--muted-foreground)]">
                {sourceDetail}
              </span>
            </div>

            <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 p-2.5">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--background)]/30 p-1">
                {(["last", "range"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => handleSourceModeChange(mode)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[0.625rem] font-semibold transition-colors",
                      sourceMode === mode
                        ? "bg-[var(--accent)] text-[var(--foreground)] ring-1 ring-[var(--border)]"
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
                      persistSummaryContextSize(clamped);
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
                    className={cn("text-[0.625rem]", rangeTooLarge ? "text-red-300" : "text-[var(--muted-foreground)]")}
                  >
                    {rangeStatusText}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2 pt-2">
              <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/35 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[0.625rem] font-semibold uppercase text-[var(--muted-foreground)]">
                      Summary Prompt
                    </p>
                    <p className="truncate text-xs font-semibold text-[var(--popover-foreground)]">
                      {promptTemplateSummary}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setTemplateEditorOpen((open) => !open);
                      if (templateEditorOpen) resetTemplateDraft();
                    }}
                    className={cn(
                      "shrink-0 rounded-md px-2 py-1 text-[0.625rem] font-semibold transition-colors",
                      templateEditorOpen
                        ? "bg-[var(--accent)] text-[var(--foreground)] ring-1 ring-[var(--border)]"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                    )}
                  >
                    {templateEditorOpen ? "Done" : "Manage"}
                  </button>
                </div>

                <div className="grid grid-cols-[1fr_auto] gap-1">
                  <div className="relative min-w-0">
                    <button
                      type="button"
                      onClick={() => setTemplateSelectOpen((open) => !open)}
                      className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md bg-[var(--card)] py-1 pl-2 pr-2 text-left text-[0.6875rem] text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                      aria-haspopup="listbox"
                      aria-expanded={templateSelectOpen}
                      aria-label="Summary prompt template"
                    >
                      <span className="min-w-0 truncate">{promptTemplateSummary}</span>
                      <ChevronDown
                        size="0.75rem"
                        className={cn(
                          "shrink-0 text-[var(--muted-foreground)] transition-transform",
                          templateSelectOpen && "rotate-180",
                        )}
                      />
                    </button>
                    {templateSelectOpen && (
                      <div
                        role="listbox"
                        className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-20 max-h-40 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--popover)] p-1 text-[var(--popover-foreground)] shadow-xl shadow-black/25"
                      >
                        <SummaryPromptSelectOption
                          active={!activePromptTemplateId}
                          label="Built-in default"
                          onSelect={() => handleSelectPromptTemplate(null)}
                        />
                        {cleanedPromptTemplates.map((template) => (
                          <SummaryPromptSelectOption
                            key={template.id}
                            active={activePromptTemplateId === template.id}
                            label={template.name}
                            onSelect={() => handleSelectPromptTemplate(template.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDuplicatePromptTemplate(activePromptTemplate ?? null)}
                    className="rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                    title="Copy current prompt to a new template"
                    aria-label="Copy current prompt to a new template"
                  >
                    <Copy size="0.75rem" />
                  </button>
                </div>

                {templateEditorOpen && (
                  <div className="space-y-2 border-t border-[var(--border)] pt-2">
                    <div className="max-h-28 space-y-1 overflow-y-auto pr-0.5">
                      <SummaryPromptTemplateRow
                        active={!activePromptTemplateId}
                        name="Built-in default"
                        detail="App default"
                        onSelect={() => persistPromptTemplates(cleanedPromptTemplates, null)}
                        onCopy={() => handleDuplicatePromptTemplate(null)}
                      />
                      {cleanedPromptTemplates.map((template) => (
                        <SummaryPromptTemplateRow
                          key={template.id}
                          active={activePromptTemplateId === template.id}
                          name={template.name}
                          detail={`${Math.ceil(template.prompt.length / 4)} tokens est.`}
                          onSelect={() => persistPromptTemplates(cleanedPromptTemplates, template.id)}
                          onCopy={() => handleDuplicatePromptTemplate(template)}
                          onEdit={() => handleEditPromptTemplate(template)}
                          onDelete={() => void handleDeletePromptTemplate(template.id)}
                        />
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={handleNewPromptTemplate}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border)] bg-[var(--accent)]/35 px-2 py-1.5 text-[0.625rem] font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
                    >
                      <Plus size="0.6875rem" />
                      New template
                    </button>

                    {(templateNameDraft || templatePromptDraft) && (
                      <div className="space-y-1.5 rounded-lg bg-[var(--background)]/30 p-2 ring-1 ring-[var(--border)]">
                        <input
                          value={templateNameDraft}
                          onChange={(event) => setTemplateNameDraft(event.target.value)}
                          maxLength={80}
                          placeholder="Template name"
                          className="w-full rounded-md bg-[var(--card)] px-2 py-1 text-[0.6875rem] font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        />
                        <textarea
                          value={templatePromptDraft}
                          onChange={(event) => setTemplatePromptDraft(event.target.value)}
                          rows={8}
                          placeholder="Prompt instructions for manual summary generation..."
                          className="max-h-48 w-full resize-y rounded-md bg-[var(--card)] px-2 py-1.5 font-mono text-[0.625rem] leading-relaxed text-[var(--foreground)] ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        />
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={resetTemplateDraft}
                            className="rounded-md px-2 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSavePromptTemplate}
                            disabled={!hasTemplateDraft || updateMeta.isPending}
                            className="flex items-center gap-1 rounded-md bg-[var(--secondary)] px-2 py-1 text-[0.625rem] font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Save size="0.625rem" />
                            {isEditingExistingTemplate ? "Save" : "Add"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/25 p-2">
                <p className="px-1 text-[0.625rem] font-semibold uppercase text-[var(--muted-foreground)]">Display</p>
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
          </div>
        )}

        {/* Body */}
        <div className="max-h-80 overflow-y-auto p-3">
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
                  className="flex items-center gap-1 rounded-lg bg-[var(--secondary)] px-2.5 py-1 text-[0.625rem] font-medium text-[var(--foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98] disabled:opacity-50"
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
                  className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--secondary)]/25 p-3 transition-colors hover:bg-[var(--accent)]/45"
                  onClick={() => setEditing(true)}
                  title="Click to edit"
                >
                  <div className="space-y-3">
                    {summarySections.map((section, sectionIndex) => (
                      <SummaryReadableSection
                        key={`${section.title ?? "summary"}-${sectionIndex}`}
                        section={section}
                        sectionIndex={sectionIndex}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  className="cursor-pointer rounded-lg border border-dashed border-[var(--border)] bg-[var(--secondary)]/20 p-5 transition-colors hover:bg-[var(--accent)]/35"
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
        <div className="border-t border-[var(--border)] px-3 py-2.5">
          <div className="mb-2 grid grid-cols-[1fr_auto] items-center gap-2 rounded-lg bg-[var(--secondary)]/25 px-2.5 py-1.5 text-[0.625rem] text-[var(--muted-foreground)]">
            <span className="min-w-0 truncate">Source: {sourceSummary}</span>
            <span className="shrink-0 text-right">{sourceDetail}</span>
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !canGenerate}
            className={cn(
              "mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all",
              isGenerating || !canGenerate
                ? "cursor-not-allowed bg-[var(--secondary)] text-[var(--muted-foreground)]"
                : "bg-[var(--secondary)] text-[var(--foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)] active:scale-[0.98]",
            )}
            title="Generate summary with AI"
          >
            {isGenerating ? <Loader2 size="0.8125rem" className="animate-spin" /> : <Sparkles size="0.8125rem" />}
            {isGenerating ? "Generating..." : "Generate"}
          </button>
        </div>

        {/* Info tip */}
        <div className="border-t border-[var(--border)] bg-[var(--secondary)]/15 px-3 py-2">
          <p className="flex items-start gap-1.5 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
            <Info size="0.6875rem" className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" />
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
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-1.5 py-1.5 text-[0.6875rem] text-[var(--popover-foreground)] transition-colors hover:bg-[var(--accent)]/50">
      <span className="min-w-0 truncate">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 shrink-0 accent-[var(--muted-foreground)]"
      />
    </label>
  );
}

interface SummaryReadableSectionProps {
  section: SummarySection;
  sectionIndex: number;
}

function SummaryReadableSection({ section, sectionIndex }: SummaryReadableSectionProps) {
  const paragraphs = section.lines
    .join("\n")
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph.trim().length > 0);

  return (
    <section className="space-y-1.5">
      {section.title && (
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[0.625rem] font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)]">
            {sectionIndex + 1}
          </span>
          <h3 className="min-w-0 truncate text-[0.6875rem] font-semibold uppercase text-[var(--muted-foreground)]">
            {section.title}
          </h3>
        </div>
      )}
      <div className={cn("space-y-2", section.title && "pl-7")}>
        {paragraphs.map((paragraph, paragraphIndex) => {
          const lines = paragraph.split("\n").filter((line) => line.trim().length > 0);
          const isBulletList = lines.length > 0 && lines.every((line) => SUMMARY_BULLET_PATTERN.test(line.trim()));

          if (isBulletList) {
            return (
              <ul key={paragraphIndex} className="space-y-1 text-xs leading-relaxed text-[var(--foreground)]/85">
                {lines.map((line, lineIndex) => (
                  <li key={lineIndex} className="grid grid-cols-[0.75rem_1fr] gap-1.5">
                    <span className="pt-[0.1875rem] text-[var(--muted-foreground)]">•</span>
                    <span>{line.replace(SUMMARY_BULLET_PATTERN, "")}</span>
                  </li>
                ))}
              </ul>
            );
          }

          return (
            <p key={paragraphIndex} className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--foreground)]/85">
              {paragraph}
            </p>
          );
        })}
      </div>
    </section>
  );
}

interface SummaryPromptSelectOptionProps {
  active: boolean;
  label: string;
  onSelect: () => void;
}

function SummaryPromptSelectOption({ active, label, onSelect }: SummaryPromptSelectOptionProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1.5 text-left text-[0.6875rem] transition-colors",
        active
          ? "bg-[var(--accent)] text-[var(--popover-foreground)] ring-1 ring-[var(--border)]"
          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
      )}
    >
      <Check size="0.625rem" className={cn("shrink-0", active ? "opacity-100" : "opacity-0")} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

interface SummaryPromptTemplateRowProps {
  active: boolean;
  name: string;
  detail: string;
  onSelect: () => void;
  onCopy: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

function SummaryPromptTemplateRow({
  active,
  name,
  detail,
  onSelect,
  onCopy,
  onEdit,
  onDelete,
}: SummaryPromptTemplateRowProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors",
        active
          ? "bg-[var(--accent)] text-[var(--foreground)] ring-1 ring-[var(--border)]"
          : "hover:bg-[var(--accent)]/45",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        title={`Use ${name}`}
      >
        <span
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1",
            active
              ? "bg-[var(--accent)] text-[var(--foreground)] ring-[var(--border)]"
              : "text-transparent ring-[var(--border)]",
          )}
        >
          <Check size="0.625rem" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[0.6875rem] font-semibold text-[var(--popover-foreground)]">{name}</span>
          <span className="block truncate text-[0.5625rem] text-[var(--muted-foreground)]">{detail}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onCopy}
        className="shrink-0 rounded p-1 text-[var(--muted-foreground)] opacity-80 transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        title="Duplicate template"
        aria-label="Duplicate template"
      >
        <Copy size="0.625rem" />
      </button>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded p-1 text-[var(--muted-foreground)] opacity-80 transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          title="Edit template"
          aria-label="Edit template"
        >
          <PenLine size="0.625rem" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 rounded p-1 text-[var(--muted-foreground)] opacity-80 transition-colors hover:bg-[var(--destructive)]/15 hover:text-[var(--destructive)]"
          title="Delete template"
          aria-label="Delete template"
        >
          <Trash2 size="0.625rem" />
        </button>
      )}
    </div>
  );
}
