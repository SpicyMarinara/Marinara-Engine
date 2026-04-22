// ──────────────────────────────────────────────
// Full-Page Preset Editor
// Tabs: Overview · Sections · Parameters · Review
// ──────────────────────────────────────────────
import { useState, useCallback, useEffect, useMemo, useRef, type FC } from "react";
import { useUIStore } from "../../stores/ui.store";
import { toast } from "sonner";
import { showConfirmDialog } from "../../lib/app-dialogs";
import {
  usePresetFull,
  useUpdatePreset,
  useDeletePreset,
  useCreateSection,
  useUpdateSection,
  useDeleteSection,
  useReorderSections,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
  useCreateVariable,
  useUpdateVariable,
  useDeleteVariable,
  useReorderVariables,
} from "../../hooks/use-presets";
import {
  ArrowLeft,
  Save,
  Trash2,
  FileText,
  Settings2,
  Layers,
  Sparkles,
  Plus,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Code2,
  Hash,
  Type,
  Eye,
  EyeOff,
  FolderOpen,
  MessageSquare,
  User,
  Bot,
  X,
  Maximize2,
  BookOpen,
  ListChecks,
  Shuffle,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";
import { DraftNumberInput } from "../ui/DraftNumberInput";
import { api } from "../../lib/api-client";
import { useAgentConfigs, type AgentConfigRow } from "../../hooks/use-agents";
import type { WrapFormat, MarkerType } from "@marinara-engine/shared";

/** Intercept Tab in a textarea to insert 2 spaces instead of changing focus. */
function handleTextareaTab(e: React.KeyboardEvent<HTMLTextAreaElement>, value: string, setValue: (v: string) => void) {
  if (e.key !== "Tab") return;
  e.preventDefault();
  const ta = e.currentTarget;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const newValue = value.substring(0, start) + "  " + value.substring(end);
  setValue(newValue);
  // Restore cursor position after React re-renders
  requestAnimationFrame(() => {
    ta.selectionStart = ta.selectionEnd = start + 2;
  });
}

// ── Tab definitions ──

const TABS = [
  { id: "overview", label: "Overview", icon: FileText },
  { id: "sections", label: "Sections", icon: Layers },
  { id: "review", label: "AI Review", icon: Sparkles },
] as const;
type TabId = (typeof TABS)[number]["id"];

const ROLE_COLORS: Record<string, string> = {
  system: "text-blue-400",
  user: "text-green-400",
  assistant: "text-purple-400",
};

const ROLE_ICONS: Record<string, FC<{ size: string | number; className?: string }>> = {
  system: Settings2,
  user: User,
  assistant: Bot,
};

const MARKER_LABELS: Record<MarkerType, string> = {
  character: "Character Info",
  lorebook: "Lorebook (All)",
  persona: "Persona",
  chat_history: "Chat History",
  chat_summary: "Chat Summary",
  world_info_before: "World Info (Before)",
  world_info_after: "World Info (After)",
  dialogue_examples: "Dialogue Examples",
  agent_data: "Agent Data",
};

// ═══════════════════════════════════════════════
//  Main Editor
// ═══════════════════════════════════════════════

export function PresetEditor() {
  const presetDetailId = useUIStore((s) => s.presetDetailId);
  const closePresetDetail = useUIStore((s) => s.closePresetDetail);

  const { data, isLoading } = usePresetFull(presetDetailId);
  const updatePreset = useUpdatePreset();
  const deletePreset = useDeletePreset();
  const createSection = useCreateSection();
  const updateSection = useUpdateSection();
  const deleteSection = useDeleteSection();
  const reorderSections = useReorderSections();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const createVariable = useCreateVariable();
  const updateVariable = useUpdateVariable();
  const deleteVariable = useDeleteVariable();
  const reorderVariables = useReorderVariables();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [dirty, setDirty] = useState(false);
  const setEditorDirty = useUIStore((s) => s.setEditorDirty);
  useEffect(() => {
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  // Local editable state
  const [localName, setLocalName] = useState("");
  const [localDescription, setLocalDescription] = useState("");
  const [localWrapFormat, setLocalWrapFormat] = useState<WrapFormat>("xml");
  const [localAuthor, setLocalAuthor] = useState("");
  const [localParams, setLocalParams] = useState<Record<string, unknown>>({});

  // Populate local state when data loads
  useEffect(() => {
    if (!data) return;
    const p = data.preset as any;
    setLocalName(p.name ?? "");
    setLocalDescription(p.description ?? "");
    setLocalWrapFormat((p.wrapFormat ?? "xml") as WrapFormat);
    setLocalAuthor(p.author ?? "");
    try {
      setLocalParams(typeof p.parameters === "string" ? JSON.parse(p.parameters) : (p.parameters ?? {}));
    } catch {
      setLocalParams({});
    }
  }, [data]);

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowUnsavedWarning(true);
      return;
    }
    closePresetDetail();
  }, [dirty, closePresetDetail]);

  const handleSave = useCallback(() => {
    if (!presetDetailId) return;
    updatePreset.mutate(
      {
        id: presetDetailId,
        name: localName,
        description: localDescription,
        wrapFormat: localWrapFormat,
        author: localAuthor,
        parameters: localParams,
      },
      {
        onSuccess: () => {
          setDirty(false);
          setShowSaved(true);
          setTimeout(() => setShowSaved(false), 1500);
        },
      },
    );
  }, [presetDetailId, localName, localDescription, localWrapFormat, localAuthor, localParams, updatePreset]);

  const handleDelete = useCallback(async () => {
    if (!presetDetailId) return;
    if (
      !(await showConfirmDialog({
        title: "Delete Preset",
        message: "Delete this preset?",
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }
    deletePreset.mutate(presetDetailId, { onSuccess: () => closePresetDetail() });
  }, [presetDetailId, deletePreset, closePresetDetail]);

  const markDirty = useCallback(() => setDirty(true), []);

  // Parse sections in order
  const sectionOrder = useMemo(() => {
    if (!data?.preset) return [];
    const p = data.preset as any;
    try {
      return typeof p.sectionOrder === "string" ? JSON.parse(p.sectionOrder) : (p.sectionOrder ?? []);
    } catch {
      return [];
    }
  }, [data]);

  const orderedSections = useMemo(() => {
    if (!data?.sections) return [];
    const map = new Map((data.sections as any[]).map((s) => [s.id, s]));
    return sectionOrder.map((id: string) => map.get(id)).filter(Boolean) as any[];
  }, [data?.sections, sectionOrder]);

  const groupMap = useMemo(() => {
    if (!data?.groups) return new Map<string, any>();
    return new Map((data.groups as any[]).map((g) => [g.id, g]));
  }, [data?.groups]);

  const choiceBlocks = useMemo(() => {
    if (!data?.choiceBlocks) return [] as any[];
    return data.choiceBlocks as any[];
  }, [data?.choiceBlocks]);

  if (!presetDetailId) return null;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="shimmer h-8 w-48 rounded-xl" />
          <div className="shimmer h-4 w-32 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[var(--muted-foreground)]">Preset not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 max-md:gap-2 max-md:px-3">
        <button
          onClick={handleClose}
          className="rounded-xl p-2 transition-all hover:bg-[var(--accent)] active:scale-95"
        >
          <ArrowLeft size="1.125rem" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-400 to-violet-500 text-white shadow-sm max-md:h-8 max-md:w-8">
          <FileText size="1.125rem" className="max-md:!h-[0.875rem] max-md:!w-[0.875rem]" />
        </div>
        <input
          value={localName}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            setLocalName(e.target.value);
            markDirty();
          }}
          className="h-10 min-w-0 flex-1 self-stretch bg-transparent text-lg font-semibold outline-none placeholder:text-[var(--muted-foreground)] max-md:text-base"
          placeholder="Preset name…"
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSave}
            disabled={updatePreset.isPending}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            <Save size="0.8125rem" /> Save
          </button>
          <button
            onClick={() => api.download(`/prompts/${presetDetailId}/export`)}
            className="rounded-xl p-2 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Export preset"
          >
            <svg
              width="0.9375rem"
              height="0.9375rem"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10 13V3m0 0l-4 4m4-4l4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect x="3" y="15" width="14" height="2" rx="1" fill="currentColor" />
            </svg>
          </button>
          <button
            onClick={handleDelete}
            className="rounded-xl p-2 transition-all hover:bg-[var(--destructive)]/15 active:scale-95"
          >
            <Trash2 size="0.9375rem" className="text-[var(--destructive)]" />
          </button>
        </div>
      </div>

      {/* Saved toast */}
      {showSaved && (
        <div className="absolute left-1/2 top-14 z-50 -translate-x-1/2 animate-fade-in-up rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-400 shadow-lg backdrop-blur-sm">
          Changes saved
        </div>
      )}

      {/* Unsaved warning */}
      {showUnsavedWarning && (
        <div className="flex items-center justify-between bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
          <span>You have unsaved changes.</span>
          <div className="flex gap-2">
            <button
              onClick={() => setShowUnsavedWarning(false)}
              className="rounded-lg px-3 py-1 hover:bg-[var(--accent)]"
            >
              Keep editing
            </button>
            <button
              onClick={() => closePresetDetail()}
              className="rounded-lg px-3 py-1 text-[var(--destructive)] hover:bg-[var(--destructive)]/15"
            >
              Discard
            </button>
            <button
              onClick={() => {
                handleSave();
                closePresetDetail();
              }}
              className="rounded-lg bg-amber-500/20 px-3 py-1 hover:bg-amber-500/30"
            >
              Save & close
            </button>
          </div>
        </div>
      )}

      {/* ── Body: Tab rail + Content ── */}
      <div className="flex flex-1 overflow-hidden @max-5xl:flex-col">
        {/* Tab rail */}
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--border)] bg-[var(--card)] p-2 @max-5xl:w-full @max-5xl:flex-row @max-5xl:overflow-x-auto @max-5xl:border-r-0 @max-5xl:border-b @max-5xl:p-1.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium transition-all @max-5xl:whitespace-nowrap @max-5xl:px-2.5 @max-5xl:py-1.5",
                  activeTab === tab.id
                    ? "bg-gradient-to-r from-purple-400/15 to-violet-500/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/20"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                )}
              >
                <Icon size="0.875rem" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6 @max-5xl:p-4">
          <div className="mx-auto max-w-2xl space-y-6">
            {/* ── Overview Tab ── */}
            {activeTab === "overview" && (
              <OverviewTab
                name={localName}
                onNameChange={(v) => {
                  setLocalName(v);
                  markDirty();
                }}
                description={localDescription}
                onDescriptionChange={(v) => {
                  setLocalDescription(v);
                  markDirty();
                }}
                wrapFormat={localWrapFormat}
                onWrapFormatChange={(v) => {
                  setLocalWrapFormat(v);
                  markDirty();
                }}
                author={localAuthor}
                onAuthorChange={(v) => {
                  setLocalAuthor(v);
                  markDirty();
                }}
                sectionCount={orderedSections.length}
                groupCount={data.groups?.length ?? 0}
              />
            )}

            {/* ── Sections Tab ── */}
            {activeTab === "sections" && (
              <SectionsTab
                presetId={presetDetailId}
                sections={orderedSections}
                groupMap={groupMap}
                choiceBlocks={choiceBlocks}
                wrapFormat={localWrapFormat}
                onCreateSection={createSection}
                onUpdateSection={updateSection}
                onDeleteSection={deleteSection}
                onReorderSections={reorderSections}
                onCreateGroup={createGroup}
                onUpdateGroup={updateGroup}
                onDeleteGroup={deleteGroup}
                onCreateVariable={createVariable}
                onUpdateVariable={updateVariable}
                onDeleteVariable={deleteVariable}
                onReorderVariables={reorderVariables}
              />
            )}

            {/* ── Review Tab ── */}
            {activeTab === "review" && <ReviewTab presetId={presetDetailId} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Overview Tab
// ═══════════════════════════════════════════════

function OverviewTab({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  wrapFormat,
  onWrapFormatChange,
  author,
  onAuthorChange,
  sectionCount,
  groupCount,
}: {
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  wrapFormat: WrapFormat;
  onWrapFormatChange: (v: WrapFormat) => void;
  author: string;
  onAuthorChange: (v: string) => void;
  sectionCount: number;
  groupCount: number;
}) {
  return (
    <>
      <FieldGroup label="Name" help="The display name for this preset. Used in the Presets panel and chat settings.">
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Preset name…"
          className="w-full rounded-xl bg-[var(--secondary)] p-3 text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      </FieldGroup>

      <FieldGroup
        label="Description"
        help="A short summary of what this preset is designed for. Helps you remember its purpose when choosing between presets."
      >
        <textarea
          value={description}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="What does this preset do?"
          className="min-h-[5rem] w-full rounded-xl bg-[var(--secondary)] p-3 text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      </FieldGroup>

      <FieldGroup
        label="Wrap Format"
        help="Controls how prompt sections are formatted when sent to the AI. XML uses <tags>, Markdown uses ## headings, None sends raw content."
      >
        <div className="flex gap-2">
          {(["xml", "markdown", "none"] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => onWrapFormatChange(fmt)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium transition-all",
                wrapFormat === fmt
                  ? "bg-purple-400/15 text-purple-400 ring-1 ring-purple-400/30"
                  : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
              )}
            >
              {fmt === "xml" ? (
                <Code2 size="0.875rem" />
              ) : fmt === "markdown" ? (
                <Hash size="0.875rem" />
              ) : (
                <Type size="0.875rem" />
              )}
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[0.6875rem] text-[var(--muted-foreground)]">
          {wrapFormat === "xml"
            ? "Sections wrapped in <xml_tags>. Groups become parent tags."
            : wrapFormat === "markdown"
              ? "Sections wrapped with ## Headings. Groups become # Headings."
              : "No automatic wrapping. Section content is sent as-is."}
        </p>
      </FieldGroup>

      <FieldGroup label="Author" help="Optional creator name, useful if you share presets with others.">
        <input
          value={author}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onAuthorChange(e.target.value)}
          placeholder="Your name (optional)"
          className="w-full rounded-xl bg-[var(--secondary)] p-2.5 text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      </FieldGroup>

      <div className="flex gap-4">
        <StatCard label="Sections" value={sectionCount} />
        <StatCard label="Groups" value={groupCount} />
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════
//  Sections Tab (with drag-reorder, groups management, choice editing)
// ═══════════════════════════════════════════════

function SectionsTab({
  presetId,
  sections,
  groupMap,
  choiceBlocks,
  wrapFormat: _wrapFormat,
  onCreateSection,
  onUpdateSection,
  onDeleteSection,
  onReorderSections,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
  onCreateVariable,
  onUpdateVariable,
  onDeleteVariable,
  onReorderVariables,
}: {
  presetId: string;
  sections: any[];
  groupMap: Map<string, any>;
  choiceBlocks: any[];
  wrapFormat: WrapFormat;
  onCreateSection: any;
  onUpdateSection: any;
  onDeleteSection: any;
  onReorderSections: any;
  onCreateGroup: any;
  onUpdateGroup: any;
  onDeleteGroup: any;
  onCreateVariable: any;
  onUpdateVariable: any;
  onDeleteVariable: any;
  onReorderVariables: any;
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showGroupsPanel, setShowGroupsPanel] = useState(false);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dragReady, setDragReady] = useState<number | null>(null); // index of section ready to drag (grip held)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");

  // Fetch agent configs and filter to those with injectAsSection enabled
  const { data: agentConfigs } = useAgentConfigs();
  const injectableAgents = useMemo(() => {
    if (!agentConfigs) return [];
    return (agentConfigs as AgentConfigRow[]).filter((a) => {
      const settings = typeof a.settings === "string" ? JSON.parse(a.settings) : a.settings;
      return settings?.injectAsSection === true;
    });
  }, [agentConfigs]);

  const toggleExpanded = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddSection = (opts?: {
    isMarker?: boolean;
    markerType?: MarkerType;
    agentType?: string;
    agentName?: string;
  }) => {
    setShowAddMenu(false);
    if (opts?.agentType) {
      // Agent data marker — pre-fill content with macro
      onCreateSection.mutate({
        presetId,
        identifier: `agent_${opts.agentType}`,
        name: `${opts.agentName ?? opts.agentType} (Agent)`,
        content: `{{agent::${opts.agentType}}}`,
        role: "system",
        isMarker: true,
        markerConfig: { type: "agent_data" as MarkerType, agentType: opts.agentType },
      });
    } else {
      onCreateSection.mutate({
        presetId,
        identifier: opts?.isMarker ? opts.markerType : `section_${Date.now()}`,
        name: opts?.isMarker ? MARKER_LABELS[opts.markerType!] : "New Section",
        content: "",
        role: "system",
        isMarker: opts?.isMarker ?? false,
        markerConfig: opts?.isMarker ? { type: opts.markerType! } : null,
      });
    }
  };

  const handleAddGroup = () => {
    onCreateGroup.mutate({ presetId, name: "New Group" });
  };

  // ── Drag & Drop ──
  // dropIdx represents the *gap* the item will be inserted at:
  //   0 = before first, 1 = between 0 and 1, N = after last, etc.
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const handleDragStart = (idx: number, e: React.DragEvent) => {
    setDraggingIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const calcDropIdx = (cardIdx: number, e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    return e.clientY < midY ? cardIdx : cardIdx + 1;
  };

  const handleDragOver = (cardIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIdx(calcDropIdx(cardIdx, e));
  };

  const containerRef = useRef<HTMLDivElement>(null);

  const handleContainerDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Only snap to end-of-list when the cursor is below all cards.
    // Card-level onDragOver calls stopPropagation, so this only fires
    // when the cursor is in container padding/gaps outside any card.
    // Double-check: if there are cards, only set end-of-list when cursor
    // is below the last card's bottom edge.
    if (containerRef.current && sections.length > 0) {
      const lastCard = containerRef.current.lastElementChild as HTMLElement | null;
      if (lastCard) {
        const lastRect = lastCard.getBoundingClientRect();
        if (e.clientY > lastRect.bottom) {
          setDropIdx(sections.length);
        }
        // If cursor is above the first card, set to 0
        const firstCard = containerRef.current.firstElementChild as HTMLElement | null;
        if (firstCard) {
          const firstRect = firstCard.getBoundingClientRect();
          if (e.clientY < firstRect.top) {
            setDropIdx(0);
          }
        }
        return;
      }
    }
    setDropIdx(sections.length);
  };

  const commitDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const sourceIdx = draggingIdx;
    const target = dropIdx;
    setDraggingIdx(null);
    setDropIdx(null);
    if (sourceIdx === null || target === null) return;
    // Adjust for removal: if source is before target, target shifts down by 1
    let insertAt = target;
    if (sourceIdx < insertAt) insertAt--;
    if (sourceIdx === insertAt) return;

    const ids = sections.map((s: any) => s.id);
    const [moved] = ids.splice(sourceIdx, 1);
    ids.splice(insertAt, 0, moved);
    onReorderSections.mutate({ presetId, sectionIds: ids });
  };

  const handleDragEnd = () => {
    setDraggingIdx(null);
    setDropIdx(null);
  };

  return (
    <>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2">
        <HelpTooltip
          text="Everything we send to a model is just text. A prompt is a formatted, written instruction we send to the model. Each section below becomes part of the final prompt."
          side="right"
        />
        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-3 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98]"
          >
            <Plus size="0.8125rem" /> Add Section
          </button>
          {showAddMenu && (
            <>
              {/* Backdrop to close menu */}
              <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
              <div className="absolute left-0 top-full z-50 mt-1 w-56 max-h-80 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-xl">
                <button
                  onClick={() => handleAddSection()}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--accent)]"
                >
                  <MessageSquare size="0.8125rem" /> Prompt Block
                </button>
                <div className="my-1 border-t border-[var(--border)]" />
                <p className="px-3 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">Markers</p>
                {(Object.keys(MARKER_LABELS) as MarkerType[])
                  .filter((t) => t !== "agent_data")
                  .map((type) => (
                    <button
                      key={type}
                      onClick={() => handleAddSection({ isMarker: true, markerType: type })}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--accent)]"
                    >
                      <Layers size="0.8125rem" className="text-purple-400" /> {MARKER_LABELS[type]}
                    </button>
                  ))}
                {injectableAgents.length > 0 && (
                  <>
                    <div className="my-1 border-t border-[var(--border)]" />
                    <p className="px-3 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                      Agent Sections
                    </p>
                    {injectableAgents.map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => handleAddSection({ agentType: agent.type, agentName: agent.name })}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[var(--foreground)] hover:bg-[var(--accent)]"
                      >
                        <Sparkles size="0.8125rem" className="text-[var(--primary)]" /> {agent.name} (Agent)
                      </button>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setShowGroupsPanel(!showGroupsPanel)}
          className={cn(
            "flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium ring-1 ring-[var(--border)] transition-all active:scale-[0.98]",
            showGroupsPanel
              ? "bg-sky-400/10 text-sky-400 ring-sky-400/30"
              : "bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:bg-[var(--accent)]",
          )}
        >
          <FolderOpen size="0.8125rem" /> Groups ({groupMap.size})
        </button>
      </div>

      {/* ── Groups Management Panel ── */}
      {showGroupsPanel && (
        <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-sky-400">Groups</h4>
            <button
              onClick={handleAddGroup}
              className="flex items-center gap-1 rounded-lg bg-sky-400/15 px-2 py-1 text-[0.625rem] font-medium text-sky-400 hover:bg-sky-400/25 active:scale-95"
            >
              <Plus size="0.625rem" /> New Group
            </button>
          </div>
          <p className="text-[0.625rem] text-[var(--muted-foreground)]">
            Groups wrap adjacent sections in a single XML/Markdown container. Assign sections to groups below.
          </p>
          {groupMap.size === 0 ? (
            <p className="py-2 text-center text-[0.625rem] text-[var(--muted-foreground)]">
              No groups yet. Create one to organize sections.
            </p>
          ) : (
            <div className="space-y-1">
              {[...groupMap.values()].map((g: any) => (
                <div
                  key={g.id}
                  className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 ring-1 ring-[var(--border)]"
                >
                  {editingGroupId === g.id ? (
                    <input
                      value={editingGroupName}
                      onChange={(e) => setEditingGroupName(e.target.value)}
                      onBlur={() => {
                        if (editingGroupName.trim()) {
                          onUpdateGroup.mutate({ presetId, groupId: g.id, name: editingGroupName.trim() });
                        }
                        setEditingGroupId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setEditingGroupId(null);
                      }}
                      className="flex-1 rounded bg-[var(--background)] px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                      autoFocus
                    />
                  ) : (
                    <span
                      className="flex-1 cursor-pointer truncate text-xs font-medium"
                      onClick={() => {
                        setEditingGroupId(g.id);
                        setEditingGroupName(g.name);
                      }}
                      title="Click to rename"
                    >
                      {g.name}
                    </span>
                  )}
                  <span className="text-[0.5625rem] text-[var(--muted-foreground)]">
                    {sections.filter((s: any) => s.groupId === g.id).length} sections
                  </span>
                  <button
                    onClick={async () => {
                      if (
                        await showConfirmDialog({
                          title: "Delete Group",
                          message: `Delete group "${g.name}"? Sections will be ungrouped.`,
                          confirmLabel: "Delete",
                          tone: "destructive",
                        })
                      ) {
                        onDeleteGroup.mutate({ presetId, groupId: g.id });
                      }
                    }}
                    className="rounded p-0.5 hover:bg-[var(--destructive)]/15"
                  >
                    <Trash2 size="0.625rem" className="text-[var(--destructive)]" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Section list with drag & drop ── */}
      <div ref={containerRef} className="space-y-1" onDragOver={handleContainerDragOver} onDrop={commitDrop}>
        {sections.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Layers size="1.5rem" className="text-[var(--muted-foreground)]" />
            <p className="text-xs text-[var(--muted-foreground)]">No sections yet. Add one to get started.</p>
          </div>
        ) : (
          sections.map((section: any, idx: number) => {
            const isExpanded = expandedSections.has(section.id);
            const isEnabled = section.enabled === "true" || section.enabled === true;
            const isMarker = section.isMarker === "true" || section.isMarker === true;
            const role = (section.role ?? "system") as string;
            const group = section.groupId ? groupMap.get(section.groupId) : null;
            const RoleIcon = ROLE_ICONS[role] ?? Settings2;
            // Show drop indicator line above this card when dropIdx matches
            const showDropBefore =
              dropIdx === idx && draggingIdx !== null && draggingIdx !== idx && draggingIdx !== idx - 1;
            const showDropAfter =
              idx === sections.length - 1 && dropIdx === sections.length && draggingIdx !== null && draggingIdx !== idx;

            return (
              <div key={section.id}>
                {showDropBefore && <div className="mx-2 mb-1 h-0.5 rounded-full bg-purple-400" />}
                <div
                  draggable={dragReady === idx}
                  onDragStart={(e) => handleDragStart(idx, e)}
                  onDragOver={(e) => {
                    e.stopPropagation();
                    handleDragOver(idx, e);
                  }}
                  onDrop={(e) => {
                    e.stopPropagation();
                    commitDrop(e);
                  }}
                  onDragEnd={() => {
                    handleDragEnd();
                    setDragReady(null);
                  }}
                  className={cn(
                    "rounded-xl border transition-all",
                    isEnabled ? "border-[var(--border)]" : "border-[var(--border)]/50 opacity-50",
                    draggingIdx === idx && "opacity-40",
                  )}
                >
                  {/* Section header */}
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div
                      className="cursor-grab shrink-0 rounded p-0.5 hover:bg-[var(--accent)] active:cursor-grabbing"
                      title="Drag to reorder"
                      onMouseDown={() => setDragReady(idx)}
                      onMouseUp={() => setDragReady(null)}
                    >
                      <GripVertical size="0.875rem" className="text-[var(--muted-foreground)]" />
                    </div>
                    <button
                      onClick={() => toggleExpanded(section.id)}
                      className="shrink-0 rounded p-0.5 hover:bg-[var(--accent)]"
                    >
                      {isExpanded ? (
                        <ChevronDown size="0.875rem" className="text-[var(--muted-foreground)]" />
                      ) : (
                        <ChevronRight size="0.875rem" className="text-[var(--muted-foreground)]" />
                      )}
                    </button>
                    <RoleIcon size="0.875rem" className={cn("shrink-0", ROLE_COLORS[role])} />
                    <span
                      className="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium"
                      onClick={() => toggleExpanded(section.id)}
                    >
                      {section.name}
                    </span>

                    {isMarker && (
                      <span className="shrink-0 rounded bg-violet-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-violet-400">
                        MARKER
                      </span>
                    )}
                    {group && (
                      <span className="shrink-0 rounded bg-sky-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-sky-400">
                        {group.name}
                      </span>
                    )}
                    <span className="shrink-0 text-[0.625rem] text-[var(--muted-foreground)]">{role}</span>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={() =>
                          onUpdateSection.mutate({
                            presetId,
                            sectionId: section.id,
                            enabled: !isEnabled,
                          })
                        }
                        className="rounded-lg p-1 hover:bg-[var(--accent)]"
                        title={isEnabled ? "Disable" : "Enable"}
                      >
                        {isEnabled ? (
                          <Eye size="0.75rem" className="text-green-400" />
                        ) : (
                          <EyeOff size="0.75rem" className="text-[var(--muted-foreground)]" />
                        )}
                      </button>
                      <button
                        onClick={() => onDeleteSection.mutate({ presetId, sectionId: section.id })}
                        className="rounded-lg p-1 hover:bg-[var(--destructive)]/15"
                        title="Delete"
                      >
                        <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">
                      {/* Name & Role */}
                      <div className="flex gap-2">
                        <SectionNameInput
                          value={section.name}
                          onCommit={(name) =>
                            onUpdateSection.mutate({
                              presetId,
                              sectionId: section.id,
                              name,
                            })
                          }
                        />
                        <select
                          value={role}
                          onChange={(e) =>
                            onUpdateSection.mutate({
                              presetId,
                              sectionId: section.id,
                              role: e.target.value,
                            })
                          }
                          className="rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none"
                        >
                          <option value="system">System</option>
                          <option value="user">User</option>
                          <option value="assistant">Assistant</option>
                        </select>
                      </div>

                      {/* Content (not for markers) */}
                      {!isMarker && (
                        <SectionContentTextarea
                          value={section.content}
                          sectionName={section.name}
                          onCommit={(content) =>
                            onUpdateSection.mutate({
                              presetId,
                              sectionId: section.id,
                              content,
                            })
                          }
                        />
                      )}

                      {/* Marker config */}
                      {isMarker &&
                        section.markerConfig &&
                        (() => {
                          const mc =
                            typeof section.markerConfig === "string"
                              ? JSON.parse(section.markerConfig)
                              : section.markerConfig;
                          const isAgentMarker = mc.type === "agent_data";
                          return isAgentMarker ? (
                            <div className="space-y-2">
                              <div className="rounded-lg bg-[var(--primary)]/5 p-3 text-xs text-[var(--primary)]">
                                Agent section: <strong>{section.name}</strong>
                                <p className="mt-1 text-[var(--muted-foreground)]">
                                  The{" "}
                                  <code className="rounded bg-black/20 px-1 py-0.5 text-[0.625rem] font-mono text-pink-300">
                                    {"{{agent::" + (mc.agentType ?? "agent") + "}}"}
                                  </code>{" "}
                                  macro will be replaced with the latest output from the agent at assembly time. You can
                                  add additional instructions around it.
                                </p>
                              </div>
                              <SectionContentTextarea
                                value={section.content || `{{agent::${mc.agentType ?? "agent"}}}`}
                                sectionName={section.name}
                                onCommit={(content) =>
                                  onUpdateSection.mutate({
                                    presetId,
                                    sectionId: section.id,
                                    content,
                                  })
                                }
                              />
                            </div>
                          ) : (
                            <div className="rounded-lg bg-violet-400/5 p-3 text-xs text-violet-300">
                              Marker type: <strong>{MARKER_LABELS[mc.type as MarkerType] ?? "Unknown"}</strong>
                              <p className="mt-1 text-[var(--muted-foreground)]">
                                Content is auto-generated at assembly time from your characters, lorebook, etc.
                              </p>
                            </div>
                          );
                        })()}

                      {/* Position & Depth */}
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <label className="text-[var(--muted-foreground)]">Position:</label>
                        <select
                          value={section.injectionPosition ?? "ordered"}
                          onChange={(e) =>
                            onUpdateSection.mutate({
                              presetId,
                              sectionId: section.id,
                              injectionPosition: e.target.value,
                            })
                          }
                          className="rounded-lg bg-[var(--secondary)] px-2 py-1 text-xs ring-1 ring-[var(--border)]"
                        >
                          <option value="ordered">Ordered (in sequence)</option>
                          <option value="depth">Depth (from end of chat)</option>
                        </select>
                        {section.injectionPosition === "depth" && (
                          <>
                            <label className="text-[var(--muted-foreground)]">Depth:</label>
                            <DraftNumberInput
                              value={section.injectionDepth ?? 0}
                              min={0}
                              selectOnFocus
                              onCommit={(nextValue) =>
                                onUpdateSection.mutate({
                                  presetId,
                                  sectionId: section.id,
                                  injectionDepth: nextValue,
                                })
                              }
                              className="w-16 rounded-lg bg-[var(--secondary)] px-2 py-1 text-xs ring-1 ring-[var(--border)]"
                            />
                            <span className="text-[var(--muted-foreground)]">(0 = after last message)</span>
                          </>
                        )}
                      </div>

                      {/* Group assignment */}
                      <div className="flex items-center gap-3 text-xs">
                        <label className="text-[var(--muted-foreground)]">Group:</label>
                        <select
                          value={section.groupId ?? ""}
                          onChange={(e) =>
                            onUpdateSection.mutate({
                              presetId,
                              sectionId: section.id,
                              groupId: e.target.value || null,
                            })
                          }
                          className="rounded-lg bg-[var(--secondary)] px-2 py-1 text-xs ring-1 ring-[var(--border)]"
                        >
                          <option value="">No group</option>
                          {[...groupMap.values()].map((g: any) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                        {groupMap.size === 0 && (
                          <span className="text-[0.625rem] text-[var(--muted-foreground)]">
                            (open Groups panel to create one)
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {showDropAfter && <div className="mx-2 mt-1 h-0.5 rounded-full bg-purple-400" />}
              </div>
            );
          })
        )}
      </div>

      {sections.length > 0 && (
        <p className="text-center text-[0.625rem] text-[var(--muted-foreground)]">
          Drag sections to reorder · Click to expand · Sections are assembled top-to-bottom
        </p>
      )}

      {/* ── Preset Variables ── */}
      <PresetVariablesEditor
        presetId={presetId}
        variables={choiceBlocks}
        onCreateVariable={onCreateVariable}
        onUpdateVariable={onUpdateVariable}
        onDeleteVariable={onDeleteVariable}
        onReorderVariables={onReorderVariables}
      />
    </>
  );
}

// ── Preset Variables Editor (preset-level, supports multiple) ──

function PresetVariablesEditor({
  presetId,
  variables,
  onCreateVariable,
  onUpdateVariable,
  onDeleteVariable,
  onReorderVariables,
}: {
  presetId: string;
  variables: any[];
  onCreateVariable: any;
  onUpdateVariable: any;
  onDeleteVariable: any;
  onReorderVariables: any;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [dragReady, setDragReady] = useState<number | null>(null);

  const handleDragStart = (idx: number, e: React.DragEvent) => {
    setDraggingIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const calcDropIdx = (cardIdx: number, e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    return e.clientY < midY ? cardIdx : cardIdx + 1;
  };

  const handleDragOver = (cardIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIdx(calcDropIdx(cardIdx, e));
  };

  const handleContainerDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIdx(variables.length);
  };

  const commitDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const sourceIdx = draggingIdx;
    const target = dropIdx;
    setDraggingIdx(null);
    setDropIdx(null);
    if (sourceIdx === null || target === null) return;
    let insertAt = target;
    if (sourceIdx < insertAt) insertAt--;
    if (sourceIdx === insertAt) return;
    const ids = variables.map((v: any) => v.id);
    const [moved] = ids.splice(sourceIdx, 1);
    ids.splice(insertAt, 0, moved);
    onReorderVariables.mutate({ presetId, variableIds: ids });
  };

  const handleDragEnd = () => {
    setDraggingIdx(null);
    setDropIdx(null);
  };

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hash size="0.875rem" className="text-amber-400" />
          <span className="text-sm font-semibold">Preset Variables</span>
          <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-amber-400">
            {variables.length}
          </span>
        </div>
        <button
          onClick={() =>
            onCreateVariable.mutate({
              presetId,
              variableName: `VAR_${Date.now()}`,
              question: "Choose an option",
              options: [
                { id: `opt_${Date.now()}_a`, label: "Option A", value: "value_a" },
                { id: `opt_${Date.now()}_b`, label: "Option B", value: "value_b" },
              ],
            })
          }
          className="flex items-center gap-1.5 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[0.6875rem] font-medium text-amber-400 hover:bg-amber-400/20 active:scale-[0.98]"
        >
          <Plus size="0.6875rem" /> Add Variable
        </button>
      </div>

      <p className="text-[0.625rem] text-[var(--muted-foreground)]">
        Define variables that users select when assigning this preset to a chat. Use{" "}
        <code className="rounded bg-[var(--secondary)] px-1 text-amber-400">{"{{variable_name}}"}</code> in any section
        to insert the selected value.
      </p>

      {variables.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] py-6 text-center">
          <Hash size="1.25rem" className="text-[var(--muted-foreground)]" />
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
            No variables yet. Add one to let users customize prompts per chat.
          </p>
        </div>
      ) : (
        <div className="space-y-2" onDragOver={handleContainerDragOver} onDrop={commitDrop}>
          {variables.map((variable: any, idx: number) => {
            const showDropBefore =
              dropIdx === idx && draggingIdx !== null && draggingIdx !== idx && draggingIdx !== idx - 1;
            const showDropAfter =
              idx === variables.length - 1 &&
              dropIdx === variables.length &&
              draggingIdx !== null &&
              draggingIdx !== idx;
            return (
              <div key={variable.id}>
                {showDropBefore && <div className="mx-2 mb-1 h-0.5 rounded-full bg-amber-400" />}
                <div
                  draggable={dragReady === idx}
                  onDragStart={(e) => handleDragStart(idx, e)}
                  onDragOver={(e) => {
                    e.stopPropagation();
                    handleDragOver(idx, e);
                  }}
                  onDrop={(e) => {
                    e.stopPropagation();
                    commitDrop(e);
                  }}
                  onDragEnd={() => {
                    handleDragEnd();
                    setDragReady(null);
                  }}
                  className={cn(draggingIdx === idx && "opacity-40")}
                >
                  <VariableCard
                    presetId={presetId}
                    variable={variable}
                    isExpanded={expandedId === variable.id}
                    onToggle={() => setExpandedId(expandedId === variable.id ? null : variable.id)}
                    onUpdateVariable={onUpdateVariable}
                    onDeleteVariable={onDeleteVariable}
                    onGripDown={() => setDragReady(idx)}
                    onGripUp={() => setDragReady(null)}
                  />
                </div>
                {showDropAfter && <div className="mx-2 mt-1 h-0.5 rounded-full bg-amber-400" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Single Variable Card ──

function VariableCard({
  presetId,
  variable,
  isExpanded,
  onToggle,
  onUpdateVariable,
  onDeleteVariable,
  onGripDown,
  onGripUp,
}: {
  presetId: string;
  variable: any;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateVariable: any;
  onDeleteVariable: any;
  onGripDown: () => void;
  onGripUp: () => void;
}) {
  // Parse options
  let opts: Array<{ id: string; label: string; value: string }> = [];
  try {
    opts = typeof variable.options === "string" ? JSON.parse(variable.options) : (variable.options ?? []);
  } catch {
    /* empty */
  }

  const varName = variable.variableName ?? variable.variable_name ?? "";
  const question = variable.question ?? "";
  const isMultiSelect = variable.multiSelect === "true" || variable.multiSelect === true;
  const isRandomPick = variable.randomPick === "true" || variable.randomPick === true;
  const separatorValue = variable.separator ?? ", ";

  // Track which option is expanded in the big editor (index or null)
  const [expandedOptIdx, setExpandedOptIdx] = useState<number | null>(null);

  const update = (data: Record<string, unknown>) => {
    onUpdateVariable.mutate({ presetId, variableId: variable.id, ...data });
  };

  const updateOpts = (newOpts: typeof opts) => {
    update({ options: newOpts });
  };

  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 transition-all">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div
          className="cursor-grab shrink-0 rounded p-0.5 hover:bg-[var(--accent)] active:cursor-grabbing"
          title="Drag to reorder"
          onMouseDown={onGripDown}
          onMouseUp={onGripUp}
        >
          <GripVertical size="0.875rem" className="text-[var(--muted-foreground)]" />
        </div>
        <button onClick={onToggle} className="shrink-0 rounded p-0.5 hover:bg-[var(--accent)]">
          {isExpanded ? (
            <ChevronDown size="0.875rem" className="text-[var(--muted-foreground)]" />
          ) : (
            <ChevronRight size="0.875rem" className="text-[var(--muted-foreground)]" />
          )}
        </button>
        <Hash size="0.875rem" className="shrink-0 text-amber-400" />
        <span className="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium text-amber-400" onClick={onToggle}>
          {varName}
        </span>
        <span className="shrink-0 rounded bg-amber-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-amber-400">
          {opts.length} options
        </span>
        {isMultiSelect && (
          <span className="shrink-0 rounded bg-purple-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-purple-400">
            {isRandomPick ? "random" : "multi"}
          </span>
        )}
        <code className="shrink-0 text-[0.625rem] text-[var(--muted-foreground)]">{`{{${varName}}}`}</code>
        <button
          onClick={async () => {
            if (
              await showConfirmDialog({
                title: "Delete Variable",
                message: `Delete variable "${varName}"?`,
                confirmLabel: "Delete",
                tone: "destructive",
              })
            ) {
              onDeleteVariable.mutate({ presetId, variableId: variable.id });
            }
          }}
          className="shrink-0 rounded-lg p-1 hover:bg-[var(--destructive)]/15"
          title="Delete variable"
        >
          <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
        </button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="space-y-3 border-t border-amber-400/20 px-3 py-3">
          {/* Variable Name */}
          <div className="space-y-1">
            <label className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Variable Name</label>
            <VariableNameInput value={varName} onCommit={(v) => update({ variableName: v })} />
            <p className="text-[0.5625rem] text-[var(--muted-foreground)]">
              Use <code className="text-amber-400">{`{{${varName}}}`}</code> in any prompt section to insert the
              selected value. Must be alphanumeric/underscores only.
            </p>
          </div>

          {/* Question */}
          <div className="space-y-1">
            <label className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">
              Question (shown to user)
            </label>
            <VariableQuestionInput value={question} onCommit={(v) => update({ question: v })} />
          </div>

          {/* Multi-Select & Random Pick */}
          <div className="space-y-2 rounded-lg bg-[var(--secondary)] p-2.5 ring-1 ring-[var(--border)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ListChecks size="0.75rem" className="text-purple-400" />
                <span className="text-[0.625rem] font-medium text-[var(--foreground)]">Multi-Select</span>
              </div>
              <button
                onClick={() => update({ multiSelect: !isMultiSelect })}
                className={cn(
                  "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors",
                  isMultiSelect ? "bg-purple-400" : "bg-[var(--border)]",
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-3 w-3 translate-y-0.5 rounded-full bg-white shadow transition-transform",
                    isMultiSelect ? "translate-x-3.5" : "translate-x-0.5",
                  )}
                />
              </button>
            </div>
            <p className="text-[0.5625rem] text-[var(--muted-foreground)]">
              Allow users to select multiple options instead of just one.
            </p>

            {isMultiSelect && (
              <div className="space-y-2 border-t border-[var(--border)] pt-2">
                {/* Random Pick Toggle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Shuffle size="0.75rem" className="text-amber-400" />
                    <span className="text-[0.625rem] font-medium text-[var(--foreground)]">Random Pick</span>
                  </div>
                  <button
                    onClick={() => update({ randomPick: !isRandomPick })}
                    className={cn(
                      "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors",
                      isRandomPick ? "bg-amber-400" : "bg-[var(--border)]",
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-3 w-3 translate-y-0.5 rounded-full bg-white shadow transition-transform",
                        isRandomPick ? "translate-x-3.5" : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>
                <p className="text-[0.5625rem] text-[var(--muted-foreground)]">
                  {isRandomPick
                    ? "One of the user's selected options will be randomly picked each generation."
                    : "All selected options will be joined together with the separator below."}
                </p>

                {/* Separator (only shown when not random pick) */}
                {!isRandomPick && (
                  <div className="flex items-center gap-2">
                    <label className="shrink-0 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                      Separator
                    </label>
                    <input
                      value={separatorValue}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => update({ separator: e.target.value })}
                      className="w-20 rounded bg-[var(--background)] px-1.5 py-0.5 text-center font-mono text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-1 focus:ring-purple-400/50"
                      placeholder=", "
                    />
                    <span className="text-[0.5625rem] text-[var(--muted-foreground)]">
                      e.g. ", " → Romance, Fantasy, Action
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Options */}
          <div className="space-y-1.5">
            <label className="text-[0.625rem] font-medium text-[var(--muted-foreground)]">Options</label>
            {opts.map((opt, oi) => (
              <div
                key={opt.id}
                className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 ring-1 ring-[var(--border)]"
              >
                <span className="shrink-0 text-[0.625rem] font-medium text-amber-400">{oi + 1}.</span>
                <OptionFieldInput
                  value={opt.label}
                  onCommit={(v) => {
                    const next = [...opts];
                    next[oi] = { ...next[oi], label: v };
                    updateOpts(next);
                  }}
                  className="flex-1 rounded bg-[var(--background)] px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                  placeholder="Label…"
                />
                <OptionFieldInput
                  value={opt.value}
                  onCommit={(v) => {
                    const next = [...opts];
                    next[oi] = { ...next[oi], value: v };
                    updateOpts(next);
                  }}
                  className="flex-1 rounded bg-[var(--background)] px-1.5 py-0.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                  placeholder="Value…"
                />
                <button
                  onClick={() => setExpandedOptIdx(oi)}
                  className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                  title="Expand value editor"
                >
                  <Maximize2 size="0.625rem" />
                </button>
                <button
                  onClick={() => {
                    if (opts.length <= 2) return toast.error("A variable needs at least 2 options.");
                    updateOpts(opts.filter((_, i) => i !== oi));
                  }}
                  className="shrink-0 rounded p-0.5 hover:bg-[var(--destructive)]/15"
                  title="Remove option"
                >
                  <X size="0.625rem" className="text-[var(--destructive)]" />
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                const newOpt = {
                  id: `opt_${Date.now()}`,
                  label: `Option ${String.fromCharCode(65 + opts.length)}`,
                  value: "",
                };
                updateOpts([...opts, newOpt]);
              }}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[0.625rem] font-medium text-amber-400 hover:bg-amber-400/10 active:scale-[0.98]"
            >
              <Plus size="0.625rem" /> Add Option
            </button>
          </div>

          {/* Expanded value editor for a single option */}
          {expandedOptIdx !== null && opts[expandedOptIdx] && (
            <ExpandedEditorModal
              title={`Edit Value: ${opts[expandedOptIdx].label || `Option ${expandedOptIdx + 1}`}`}
              value={opts[expandedOptIdx].value}
              onChange={(v) => {
                const next = [...opts];
                next[expandedOptIdx] = { ...next[expandedOptIdx], value: v };
                updateOpts(next);
              }}
              onClose={() => setExpandedOptIdx(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Variable Name Input (local state, commits on blur/Enter) ──
function VariableNameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);
  return (
    <input
      value={local}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setLocal(e.target.value.replace(/[^\w]/g, ""))}
      onBlur={() => {
        if (local !== value) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-full rounded bg-[var(--background)] px-2 py-1 font-mono text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-1 focus:ring-amber-400/50"
      placeholder="VARIABLE_NAME"
    />
  );
}

// ── Option field input (local state, debounced commit + commit on blur) ──
function OptionFieldInput({
  value,
  onCommit,
  className,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setLocal(value);
  }, [value]);
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );
  return (
    <input
      value={local}
      onFocus={(e) => {
        focusedRef.current = true;
        e.target.select();
      }}
      onChange={(e) => {
        setLocal(e.target.value);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          onCommit(e.target.value);
        }, 600);
      }}
      onBlur={() => {
        focusedRef.current = false;
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        if (local !== value) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={className}
      placeholder={placeholder}
    />
  );
}

// ── Variable Question Input (local state, commits on blur/Enter) ──
function VariableQuestionInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);
  return (
    <input
      value={local}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-full rounded bg-[var(--background)] px-2 py-1 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-1 focus:ring-amber-400/50"
      placeholder="What should the user choose?"
    />
  );
}

// ── Locally-controlled section content textarea (commits on blur) ──
function SectionContentTextarea({
  value,
  sectionName,
  onCommit,
}: {
  value: string;
  sectionName?: string;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const [expanded, setExpanded] = useState(false);
  const [showMacroRef, setShowMacroRef] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRef = useRef(false);

  // Only sync from parent when not actively editing
  useEffect(() => {
    if (!focusedRef.current) setLocal(value);
  }, [value]);

  const commit = useCallback(() => {
    if (local !== value) onCommit(local);
  }, [local, value, onCommit]);

  // Debounced auto-save while typing (800ms)
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocal(e.target.value);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const val = e.target.value;
      if (val !== value) onCommit(val);
    }, 800);
  };

  // Commit on blur immediately
  const handleBlur = () => {
    focusedRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    commit();
  };

  const handleFocus = () => {
    focusedRef.current = true;
  };

  // Cleanup timer on unmount
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  return (
    <>
      <div className="relative">
        <textarea
          value={local}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          onKeyDown={(e) =>
            handleTextareaTab(e, local, (v) => {
              setLocal(v);
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
              timeoutRef.current = setTimeout(() => {
                if (v !== value) onCommit(v);
              }, 800);
            })
          }
          className="min-h-[7.5rem] w-full rounded-lg bg-[var(--secondary)] p-2.5 pr-8 font-mono text-xs text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          placeholder="Prompt content… (supports {{user}}, {{char}}, {{// comment}}, {{trim}} macros)"
        />
        <div className="absolute right-1.5 top-1.5 flex flex-col gap-0.5">
          <button
            onClick={() => setExpanded(true)}
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Expand editor"
          >
            <Maximize2 size="0.75rem" />
          </button>
          <button
            onClick={() => setShowMacroRef(true)}
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            title="Macros reference"
          >
            <BookOpen size="0.75rem" />
          </button>
        </div>
      </div>

      {/* Macros reference modal */}
      {showMacroRef && <MacrosReferenceModal onClose={() => setShowMacroRef(false)} />}

      {/* Expanded editor modal */}
      {expanded && (
        <ExpandedEditorModal
          title={sectionName ? `Edit: ${sectionName}` : "Edit Prompt"}
          value={local}
          onChange={(v) => {
            setLocal(v);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => {
              if (v !== value) onCommit(v);
            }, 800);
          }}
          onClose={() => {
            setExpanded(false);
            if (local !== value) onCommit(local);
          }}
        />
      )}
    </>
  );
}

// ── Expanded prompt editor modal ──
function ExpandedEditorModal({
  title,
  value,
  onChange,
  onClose,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [local, setLocal] = useState(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from parent only on initial mount (not on every re-render)
  useEffect(() => {
    setLocal(value);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the textarea on mount
  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (local !== value) onChange(local);
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, onChange, local, value]);

  // Cleanup timer on unmount
  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setLocal(v);
    // Debounced commit so the parent stays in sync without cursor jumps
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      onChange(v);
    }, 600);
  };

  const handleClose = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (local !== value) onChange(local);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 max-md:pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={handleClose} className="rounded-lg p-1.5 hover:bg-[var(--accent)]">
            <X size="1rem" />
          </button>
        </div>
        {/* Editor */}
        <div className="flex-1 overflow-hidden p-4">
          <textarea
            ref={textareaRef}
            value={local}
            onChange={handleChange}
            onKeyDown={(e) =>
              handleTextareaTab(e, local, (v) => {
                setLocal(v);
                if (timeoutRef.current) clearTimeout(timeoutRef.current);
                timeoutRef.current = setTimeout(() => {
                  onChange(v);
                }, 600);
              })
            }
            className="h-full w-full resize-none rounded-lg bg-[var(--secondary)] p-4 font-mono text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder="Prompt content… (supports macros like {{user}}, {{char}}, etc.)"
          />
        </div>
        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
          <p className="text-[0.625rem] text-[var(--muted-foreground)]">Changes auto-save. Press Escape to close.</p>
          <button
            onClick={handleClose}
            className="rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-4 py-1.5 text-xs font-medium text-white shadow-md hover:shadow-lg active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Macros reference data ──
const MACRO_REFERENCE = [
  {
    category: "Identity",
    macros: [
      { macro: "{{user}}", desc: "User's display name (persona name)" },
      { macro: "{{persona}}", desc: "Alias for {{user}}" },
      { macro: "{{char}}", desc: "Current character's name" },
      { macro: "{{characters}}", desc: "Comma-separated list of all character names" },
    ],
  },
  {
    category: "Context",
    macros: [
      { macro: "{{input}}", desc: "Last user message" },
      { macro: "{{model}}", desc: "Current model name" },
      { macro: "{{chatId}}", desc: "Current chat ID" },
    ],
  },
  {
    category: "Date & Time",
    macros: [
      { macro: "{{date}}", desc: "Current date (YYYY-MM-DD)" },
      { macro: "{{time}}", desc: "Current time (HH:MM)" },
      { macro: "{{datetime}}", desc: "Full ISO datetime" },
      { macro: "{{weekday}}", desc: "Day name (Monday, etc.)" },
      { macro: "{{isotime}}", desc: "ISO timestamp" },
    ],
  },
  {
    category: "Random",
    macros: [
      { macro: "{{random}}", desc: "Random number 0-100" },
      { macro: "{{random:X:Y}}", desc: "Random number between X and Y" },
      { macro: "{{roll:XdY}}", desc: "Dice roll (e.g. {{roll:2d6}})" },
    ],
  },
  {
    category: "Variables",
    macros: [
      { macro: "{{variable_name}}", desc: "Insert a preset variable's selected value" },
      { macro: "{{getvar::name}}", desc: "Read a dynamic variable" },
      { macro: "{{setvar::name::value}}", desc: "Set a variable value" },
      { macro: "{{addvar::name::value}}", desc: "Append to a variable" },
      { macro: "{{incvar::name}}", desc: "Increment numeric variable by 1" },
      { macro: "{{decvar::name}}", desc: "Decrement numeric variable by 1" },
    ],
  },
  {
    category: "Formatting",
    macros: [
      { macro: "{{newline}}", desc: "Literal newline character" },
      { macro: "{{trim}}", desc: "Remove surrounding whitespace" },
      { macro: "{{trimStart}}", desc: "Remove leading whitespace" },
      { macro: "{{trimEnd}}", desc: "Remove trailing whitespace" },
      { macro: "{{uppercase}}...{{/uppercase}}", desc: "Convert text to UPPERCASE" },
      { macro: "{{lowercase}}...{{/lowercase}}", desc: "Convert text to lowercase" },
    ],
  },
  {
    category: "Utility",
    macros: [
      { macro: "{{// comment}}", desc: "Author comment (stripped at assembly)" },
      { macro: "{{noop}}", desc: "No operation (removed)" },
      { macro: '{{banned "text"}}', desc: "Content filter stub (removed)" },
    ],
  },
];

// ── Macros Reference Modal ──
function MacrosReferenceModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 max-md:pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <BookOpen size="1rem" className="text-purple-400" />
            <h3 className="text-sm font-semibold">Macros Reference</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-[var(--accent)]">
            <X size="1rem" />
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
            Use these macros in your prompt sections. They will be replaced with actual values at generation time.
          </p>
          {MACRO_REFERENCE.map((cat) => (
            <div key={cat.category}>
              <h4 className="mb-1.5 text-[0.6875rem] font-semibold text-purple-400">{cat.category}</h4>
              <div className="space-y-1">
                {cat.macros.map((m) => (
                  <div key={m.macro} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--accent)]">
                    <code className="shrink-0 rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-400">
                      {m.macro}
                    </code>
                    <span className="text-[0.6875rem] text-[var(--muted-foreground)]">{m.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* Footer */}
        <div className="border-t border-[var(--border)] px-4 py-2.5 text-center">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Locally-controlled section name input (commits on blur / Enter) ──
function SectionNameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);

  // Sync when the external value changes (e.g. after refetch)
  useEffect(() => {
    setLocal(value);
  }, [value]);

  const commit = () => {
    const trimmed = local.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    else setLocal(value); // revert if empty
  };

  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="flex-1 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
      placeholder="Section name"
    />
  );
}

// ═══════════════════════════════════════════════
//  Review Tab (placeholder — wires to prompt reviewer)
// ═══════════════════════════════════════════════

function ReviewTab({ presetId }: { presetId: string }) {
  const [reviewing, setReviewing] = useState(false);
  const [reviewOutput, setReviewOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const enableStreaming = useUIStore((s) => s.enableStreaming);

  const startReview = async (connectionId: string) => {
    setReviewing(true);
    setReviewOutput("");
    setError(null);

    try {
      const res = await fetch("/api/prompt-reviewer/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId,
          connectionId,
          streaming: enableStreaming,
          focusAreas: ["clarity", "consistency", "coverage", "token_efficiency"],
        }),
      });

      if (!res.ok) throw new Error("Failed to start review");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "token") {
              setReviewOutput((prev) => prev + event.data);
            } else if (event.type === "error") {
              setError(event.data);
            }
          } catch {
            /* skip */
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setReviewing(false);
    }
  };

  return (
    <>
      <FieldGroup label="AI Prompt Review">
        <p className="mb-3 text-xs text-[var(--muted-foreground)]">
          Have an AI analyze your prompt preset for clarity, consistency, coverage, and efficiency. This requires an
          active API connection.
        </p>
        <ConnectionSelector
          onSelect={(connId) => startReview(connId)}
          disabled={reviewing}
          label={reviewing ? "Reviewing…" : "Start Review"}
        />
      </FieldGroup>

      {error && (
        <div className="rounded-xl bg-[var(--destructive)]/10 p-3 text-xs text-[var(--destructive)]">{error}</div>
      )}

      {reviewOutput && (
        <div className="rounded-xl bg-[var(--secondary)] p-4 ring-1 ring-[var(--border)]">
          <pre className="whitespace-pre-wrap text-xs text-[var(--foreground)]">{reviewOutput}</pre>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════
//  Shared UI Components
// ═══════════════════════════════════════════════

function FieldGroup({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
        {label}
        {help && <HelpTooltip text={help} />}
      </label>
      {children}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-1 flex-col items-center rounded-xl bg-[var(--secondary)] p-3 ring-1 ring-[var(--border)]">
      <span className="text-xl font-bold text-[var(--foreground)]">{value}</span>
      <span className="text-[0.625rem] text-[var(--muted-foreground)]">{label}</span>
    </div>
  );
}

/** Simple connection selector — queries the connections API */
function ConnectionSelector({
  onSelect,
  disabled,
  label,
}: {
  onSelect: (connectionId: string) => void;
  disabled: boolean;
  label: string;
}) {
  const [connId, setConnId] = useState("");

  // Quick inline fetch of connections
  const [connections, setConnections] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    fetch("/api/connections")
      .then((r) => r.json())
      .then((data) => setConnections(data))
      .catch(() => {});
  }, []);

  return (
    <div className="flex gap-2">
      <select
        value={connId}
        onChange={(e) => setConnId(e.target.value)}
        className="flex-1 rounded-xl bg-[var(--secondary)] px-2.5 py-2 text-xs ring-1 ring-[var(--border)] focus:outline-none"
      >
        <option value="">Select connection…</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        disabled={disabled || !connId}
        onClick={() => onSelect(connId)}
        className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
      >
        <Sparkles size="0.8125rem" /> {label}
      </button>
    </div>
  );
}
