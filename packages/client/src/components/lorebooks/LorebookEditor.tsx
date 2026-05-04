// ──────────────────────────────────────────────
// Lorebook Editor — Full-page detail view
// Replaces the chat area when editing a lorebook.
// Tabs: Overview, Entries
//
// Entries use compact inline rows with an expandable drawer (see
// LorebookEntryRow). The previous "click an entry → navigate to a sub-view"
// flow has been replaced so users can edit row-level params without leaving
// the list. Inspired by SillyTavern's World Info layout.
// ──────────────────────────────────────────────
import { useState, useEffect, useCallback, useMemo, useRef, type DragEvent as ReactDragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useLorebook,
  useUpdateLorebook,
  useLorebookEntries,
  useCreateLorebookEntry,
  useDeleteLorebook,
  useReorderLorebookEntries,
  useLorebookFolders,
  useCreateLorebookFolder,
  useUpdateLorebookEntry,
  useReorderLorebookFolders,
  lorebookKeys,
} from "../../hooks/use-lorebooks";
import { useCharacters, usePersonas } from "../../hooks/use-characters";
import { useConnections } from "../../hooks/use-connections";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { useUIStore } from "../../stores/ui.store";
import {
  ArrowLeft,
  Save,
  BookOpen,
  FileText,
  Plus,
  Trash2,
  Search,
  Settings2,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Globe,
  Users,
  UserRound,
  X,
  ArrowUpDown,
  Hash,
  Sparkles,
  Loader2,
  Check,
  Tag,
  Wand2,
  FolderPlus,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";
import { api } from "../../lib/api-client";
import type { Lorebook, LorebookEntry, LorebookFolder, LorebookCategory } from "@marinara-engine/shared";
import { LorebookEntryRow } from "./LorebookEntryRow";
import { LorebookFolderRow } from "./LorebookFolderRow";
import { estimateTokens } from "./LorebookFormFields";

// ──────────────────────────────────────────────
// Folder collapse state lives in localStorage — purely a UI preference, not
// worth a server round-trip on every toggle. Keyed per-lorebook so collapse
// state is independent across books.
// ──────────────────────────────────────────────
const FOLDER_COLLAPSE_KEY_PREFIX = "lorebook-folder-collapsed:";

function readCollapsedFolderIds(lorebookId: string | null): Set<string> {
  if (!lorebookId || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(`${FOLDER_COLLAPSE_KEY_PREFIX}${lorebookId}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function writeCollapsedFolderIds(lorebookId: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${FOLDER_COLLAPSE_KEY_PREFIX}${lorebookId}`, JSON.stringify(Array.from(ids)));
  } catch {
    /* localStorage unavailable / quota exceeded — silently degrade */
  }
}

// ── Types ──
const TABS = [
  { id: "overview", label: "Overview", icon: Settings2 },
  { id: "entries", label: "Entries", icon: FileText },
] as const;
type TabId = (typeof TABS)[number]["id"];

const CATEGORY_OPTIONS: Array<{ value: LorebookCategory; label: string; icon: typeof Globe }> = [
  { value: "world", label: "World", icon: Globe },
  { value: "character", label: "Character", icon: Users },
  { value: "npc", label: "NPC", icon: UserRound },
  { value: "spellbook", label: "Spellbook", icon: Wand2 },
  { value: "uncategorized", label: "Uncategorized", icon: BookOpen },
];

type EntrySortKey = "order" | "name-asc" | "name-desc" | "tokens" | "keys" | "newest" | "oldest";

const SORT_OPTIONS: Array<{ value: EntrySortKey; label: string }> = [
  { value: "order", label: "Order" },
  { value: "name-asc", label: "Name A→Z" },
  { value: "name-desc", label: "Name Z→A" },
  { value: "tokens", label: "Tokens ↓" },
  { value: "keys", label: "Keys ↓" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

export function LorebookEditor() {
  const lorebookId = useUIStore((s) => s.lorebookDetailId);
  const closeDetail = useUIStore((s) => s.closeLorebookDetail);
  const { data: rawLorebook, isLoading } = useLorebook(lorebookId);
  const { data: rawEntries } = useLorebookEntries(lorebookId);
  const { data: rawFolders } = useLorebookFolders(lorebookId);
  const { data: rawCharacters } = useCharacters();
  const { data: rawPersonas } = usePersonas();
  const updateLorebook = useUpdateLorebook();
  const deleteLorebook = useDeleteLorebook();
  const createEntry = useCreateLorebookEntry();
  const updateEntry = useUpdateLorebookEntry();
  const reorderEntries = useReorderLorebookEntries();
  const createFolder = useCreateLorebookFolder();
  const reorderFolders = useReorderLorebookFolders();

  const lorebook = rawLorebook as Lorebook | undefined;
  const entries = useMemo(() => (rawEntries ?? []) as LorebookEntry[], [rawEntries]);
  const folders = useMemo(() => (rawFolders ?? []) as LorebookFolder[], [rawFolders]);
  const characters = useMemo(() => {
    if (!rawCharacters) return [] as Array<{ id: string; name: string }>;
    return (rawCharacters as Array<{ id: string; data: string | Record<string, unknown> }>).map((c) => {
      try {
        const parsed = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
        return { id: c.id, name: parsed?.name ?? "Unknown" };
      } catch {
        return { id: c.id, name: "Unknown" };
      }
    });
  }, [rawCharacters]);
  const personas = useMemo(() => {
    if (!rawPersonas) return [] as Array<{ id: string; name: string; comment?: string | null }>;
    return (rawPersonas as Array<{ id: string; name: string; comment?: string | null }>).map((p) => ({
      id: p.id,
      name: p.name || "Unknown",
      comment: p.comment ?? null,
    }));
  }, [rawPersonas]);

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [lorebookDirty, setLorebookDirty] = useState(false);
  const setEditorDirty = useUIStore((s) => s.setEditorDirty);
  useEffect(() => {
    setEditorDirty(lorebookDirty);
  }, [lorebookDirty, setEditorDirty]);
  const [saving, setSaving] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [entrySearch, setEntrySearch] = useState("");
  const [entrySort, setEntrySort] = useState<EntrySortKey>("order");
  const [draggingEntryIdx, setDraggingEntryIdx] = useState<number | null>(null);
  const [entryDragReadyIdx, setEntryDragReadyIdx] = useState<number | null>(null);
  const [entryDropIdx, setEntryDropIdx] = useState<number | null>(null);

  // ── Folder UI state ──
  // Collapse state: persisted in localStorage, keyed per-lorebook. Loaded
  // synchronously on mount so the initial render reflects the user's prior
  // preference instead of a flash-of-everything-expanded.
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => readCollapsedFolderIds(lorebookId));
  // When the user opens a different lorebook, reload its collapse state.
  useEffect(() => {
    setCollapsedFolderIds(readCollapsedFolderIds(lorebookId));
  }, [lorebookId]);
  const toggleFolderCollapsed = useCallback(
    (folderId: string) => {
      if (!lorebookId) return;
      setCollapsedFolderIds((prev) => {
        const next = new Set<string>(prev);
        if (next.has(folderId)) next.delete(folderId);
        else next.add(folderId);
        writeCollapsedFolderIds(lorebookId, next);
        return next;
      });
    },
    [lorebookId],
  );

  // Cross-container drag-and-drop state. The "container" is null for the root
  // group or a folder.id for entries inside a folder. We track the source
  // container so a drop can detect a cross-container move and update the
  // entry's folderId before reordering.
  const [dragSourceContainer, setDragSourceContainer] = useState<string | null | undefined>(undefined);
  const [dropTargetContainer, setDropTargetContainer] = useState<string | null | undefined>(undefined);
  // Folder reorder uses its own pair so it doesn't entangle with entry DnD.
  const [draggingFolderIdx, setDraggingFolderIdx] = useState<number | null>(null);
  const [folderDragReadyIdx, setFolderDragReadyIdx] = useState<number | null>(null);
  const [folderDropIdx, setFolderDropIdx] = useState<number | null>(null);

  // ── Form state for lorebook overview ──
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState<LorebookCategory>("uncategorized");
  const [formEnabled, setFormEnabled] = useState(true);
  const [formScanDepth, setFormScanDepth] = useState(2);
  const [formTokenBudget, setFormTokenBudget] = useState(2048);
  const [formRecursive, setFormRecursive] = useState(false);
  const [formMaxRecursionDepth, setFormMaxRecursionDepth] = useState(3);
  const [formCharacterId, setFormCharacterId] = useState<string | null>(null);
  const [formPersonaId, setFormPersonaId] = useState<string | null>(null);
  const [formTags, setFormTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");

  const loadedLorebookIdRef = useRef<string | null>(null);

  // Load lorebook data into form
  useEffect(() => {
    if (!lorebook) return;
    const hasSwitchedLorebooks = loadedLorebookIdRef.current !== lorebook.id;
    if (!hasSwitchedLorebooks && lorebookDirty) return;

    setFormName(lorebook.name);
    setFormDescription(lorebook.description);
    setFormCategory(lorebook.category);
    setFormEnabled(lorebook.enabled);
    setFormScanDepth(lorebook.scanDepth);
    setFormTokenBudget(lorebook.tokenBudget);
    setFormRecursive(lorebook.recursiveScanning);
    setFormMaxRecursionDepth(lorebook.maxRecursionDepth ?? 3);
    setFormCharacterId(lorebook.characterId ?? null);
    setFormPersonaId(lorebook.personaId ?? null);
    setFormTags(lorebook.tags ?? []);
    setLorebookDirty(false);
    loadedLorebookIdRef.current = lorebook.id;
  }, [lorebook, lorebookDirty]);

  // Filtered + sorted entries (flat list — used when search is active or
  // a non-Order sort is selected, both of which suppress folder grouping).
  const filteredEntries = useMemo(() => {
    let result = entries;
    if (entrySearch) {
      const q = entrySearch.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.keys.some((k) => k.toLowerCase().includes(q)) ||
          e.content.toLowerCase().includes(q),
      );
    }
    switch (entrySort) {
      case "name-asc":
        return [...result].sort((a, b) => a.name.localeCompare(b.name));
      case "name-desc":
        return [...result].sort((a, b) => b.name.localeCompare(a.name));
      case "tokens":
        return [...result].sort((a, b) => estimateTokens(b.content) - estimateTokens(a.content));
      case "keys":
        return [...result].sort((a, b) => b.keys.length - a.keys.length);
      case "newest":
        return [...result].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
      case "oldest":
        return [...result].sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
      case "order":
      default:
        return [...result].sort((a, b) => a.order - b.order);
    }
  }, [entries, entrySearch, entrySort]);

  // Folder grouping is only meaningful when the user is sorting by Order with
  // no search — any other state would put entries out of their containers
  // (e.g. "Name A→Z" interleaves entries from different folders).
  const showFolderGrouping = entrySort === "order" && entrySearch.trim().length === 0;

  /** Entries for a given container (null = root, string = folder.id), sorted by Order. */
  const entriesByContainer = useMemo(() => {
    const map = new Map<string | null, LorebookEntry[]>();
    map.set(null, []);
    for (const f of folders) map.set(f.id, []);
    for (const e of entries) {
      const key = e.folderId ?? null;
      const list = map.get(key);
      // If an entry's folderId points to a deleted folder, fall back to root.
      if (list) list.push(e);
      else map.get(null)!.push(e);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [entries, folders]);

  const canReorderEntries = showFolderGrouping && entries.length > 1 && !reorderEntries.isPending;
  const canReorderFolders = showFolderGrouping && folders.length > 1 && !reorderFolders.isPending;

  // ── Handlers ──
  const markLorebookDirty = useCallback(() => setLorebookDirty(true), []);

  // Toggle the inline drawer for an entry. Single-expand keeps the page
  // tidy; users can collapse the open one and click another to jump.
  const toggleEntryExpanded = useCallback((entryId: string) => {
    setExpandedEntryId((current) => (current === entryId ? null : entryId));
  }, []);

  const entryListRef = useRef<HTMLDivElement | null>(null);

  const resetEntryDragState = useCallback(() => {
    setDraggingEntryIdx(null);
    setEntryDragReadyIdx(null);
    setEntryDropIdx(null);
    setDragSourceContainer(undefined);
    setDropTargetContainer(undefined);
  }, []);

  const resetFolderDragState = useCallback(() => {
    setDraggingFolderIdx(null);
    setFolderDragReadyIdx(null);
    setFolderDropIdx(null);
  }, []);

  const calcEntryDropIdx = useCallback((cardIdx: number, e: ReactDragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    return e.clientY < midY ? cardIdx : cardIdx + 1;
  }, []);

  // Drag start on an entry inside a specific container. We capture the
  // source container so commitEntryDrop can detect a cross-container move.
  const handleEntryDragStart = useCallback(
    (containerId: string | null, idxInContainer: number, entryId: string, e: ReactDragEvent<HTMLDivElement>) => {
      if (!canReorderEntries) {
        e.preventDefault();
        return;
      }
      setDraggingEntryIdx(idxInContainer);
      setDragSourceContainer(containerId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", entryId);
    },
    [canReorderEntries],
  );

  const handleEntryDragOver = useCallback(
    (containerId: string | null, idxInContainer: number, e: ReactDragEvent<HTMLDivElement>) => {
      if (!canReorderEntries || draggingEntryIdx === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setEntryDropIdx(calcEntryDropIdx(idxInContainer, e));
      setDropTargetContainer(containerId);
    },
    [calcEntryDropIdx, canReorderEntries, draggingEntryIdx],
  );

  // Dropping on a folder header drops the entry at the top of that folder.
  const handleFolderHeaderDragOver = useCallback(
    (folderId: string, e: ReactDragEvent<HTMLDivElement>) => {
      // If we're dragging an entry, this becomes a cross-container drop target.
      if (draggingEntryIdx !== null) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropTargetContainer(folderId);
        setEntryDropIdx(0);
      }
    },
    [draggingEntryIdx],
  );

  // Empty folder → still need to accept drops to land an entry inside.
  const handleFolderBodyDragOver = useCallback(
    (folderId: string, e: ReactDragEvent<HTMLDivElement>) => {
      if (!canReorderEntries || draggingEntryIdx === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTargetContainer(folderId);
      // If hovering empty folder body, drop at end.
      const containerEntries = entriesByContainer.get(folderId) ?? [];
      setEntryDropIdx(containerEntries.length);
    },
    [canReorderEntries, draggingEntryIdx, entriesByContainer],
  );

  const handleRootListDragOver = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      if (!canReorderEntries || draggingEntryIdx === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const container = entryListRef.current;
      const rootEntries = entriesByContainer.get(null) ?? [];
      if (!container || rootEntries.length === 0) {
        setDropTargetContainer(null);
        setEntryDropIdx(rootEntries.length);
        return;
      }

      const firstCard = container.firstElementChild as HTMLElement | null;
      const lastCard = container.lastElementChild as HTMLElement | null;
      if (!firstCard || !lastCard) return;

      const firstRect = firstCard.getBoundingClientRect();
      if (e.clientY < firstRect.top) {
        setDropTargetContainer(null);
        setEntryDropIdx(0);
        return;
      }

      const lastRect = lastCard.getBoundingClientRect();
      if (e.clientY > lastRect.bottom) {
        setDropTargetContainer(null);
        setEntryDropIdx(rootEntries.length);
      }
    },
    [canReorderEntries, draggingEntryIdx, entriesByContainer],
  );

  const commitEntryDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const sourceIdx = draggingEntryIdx;
      const targetIdx = entryDropIdx;
      const sourceContainer = dragSourceContainer;
      const targetContainer = dropTargetContainer;
      resetEntryDragState();
      if (
        !lorebookId ||
        !canReorderEntries ||
        sourceIdx === null ||
        targetIdx === null ||
        sourceContainer === undefined ||
        targetContainer === undefined
      ) {
        return;
      }

      const sourceList = (entriesByContainer.get(sourceContainer) ?? []).slice();
      const moved = sourceList[sourceIdx];
      if (!moved) return;

      // Same-container reorder — preserves the existing reorder semantic.
      if (sourceContainer === targetContainer) {
        let insertAt = targetIdx;
        if (sourceIdx < insertAt) insertAt--;
        if (sourceIdx === insertAt) return;
        const ids = sourceList.map((entry) => entry.id);
        ids.splice(sourceIdx, 1);
        ids.splice(insertAt, 0, moved.id);
        reorderEntries.mutate({ lorebookId, entryIds: ids, folderId: sourceContainer });
        return;
      }

      // Cross-container move. Only update folderId — leave the entry's Order
      // untouched. The entry will slot into its sorted position in the new
      // container based on its existing Order value, and the user can change
      // Order explicitly via the inline editor if they want to reposition it.
      // (Within-container drags renumber Order because the drag *is* how you
      // change Order in that case; cross-container drags express folder
      // membership only.)
      updateEntry.mutate({ lorebookId, entryId: moved.id, folderId: targetContainer });
    },
    [
      canReorderEntries,
      draggingEntryIdx,
      dragSourceContainer,
      dropTargetContainer,
      entriesByContainer,
      entryDropIdx,
      lorebookId,
      reorderEntries,
      resetEntryDragState,
      updateEntry,
    ],
  );

  // ── Folder reorder DnD ──
  const handleFolderDragStart = useCallback(
    (idx: number, folderId: string, e: ReactDragEvent<HTMLDivElement>) => {
      if (!canReorderFolders) {
        e.preventDefault();
        return;
      }
      setDraggingFolderIdx(idx);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", folderId);
    },
    [canReorderFolders],
  );

  const handleFolderDragOverHeader = useCallback(
    (idx: number, e: ReactDragEvent<HTMLDivElement>) => {
      if (!canReorderFolders || draggingFolderIdx === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      setFolderDropIdx(e.clientY < midY ? idx : idx + 1);
    },
    [canReorderFolders, draggingFolderIdx],
  );

  const commitFolderDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const sourceIdx = draggingFolderIdx;
      const targetIdx = folderDropIdx;
      resetFolderDragState();
      if (!lorebookId || !canReorderFolders || sourceIdx === null || targetIdx === null) return;
      let insertAt = targetIdx;
      if (sourceIdx < insertAt) insertAt--;
      if (sourceIdx === insertAt) return;
      const ids = folders.map((f) => f.id);
      const [moved] = ids.splice(sourceIdx, 1);
      if (!moved) return;
      ids.splice(insertAt, 0, moved);
      reorderFolders.mutate({ lorebookId, folderIds: ids });
    },
    [canReorderFolders, draggingFolderIdx, folderDropIdx, folders, lorebookId, reorderFolders, resetFolderDragState],
  );

  const handleAddFolder = useCallback(async () => {
    if (!lorebookId) return;
    await createFolder.mutateAsync({ lorebookId, name: "New Folder", enabled: true });
  }, [lorebookId, createFolder]);

  const handleSaveLorebook = useCallback(async () => {
    if (!lorebookId) return;
    setSaving(true);
    try {
      await updateLorebook.mutateAsync({
        id: lorebookId,
        name: formName,
        description: formDescription,
        category: formCategory,
        enabled: formEnabled,
        scanDepth: formScanDepth,
        tokenBudget: formTokenBudget,
        recursiveScanning: formRecursive,
        maxRecursionDepth: formMaxRecursionDepth,
        characterId: formCharacterId,
        personaId: formPersonaId,
        tags: formTags,
      });
      setLorebookDirty(false);
    } finally {
      setSaving(false);
    }
  }, [
    lorebookId,
    formName,
    formDescription,
    formCategory,
    formEnabled,
    formScanDepth,
    formTokenBudget,
    formRecursive,
    formMaxRecursionDepth,
    formCharacterId,
    formPersonaId,
    formTags,
    updateLorebook,
  ]);

  const handleAddEntry = useCallback(async () => {
    if (!lorebookId) return;
    const result = await createEntry.mutateAsync({
      lorebookId,
      name: "New Entry",
      content: "",
      keys: [],
    });
    if (result && typeof result === "object" && "id" in result) {
      // Auto-expand the new entry's drawer so the user can fill it in.
      setExpandedEntryId((result as LorebookEntry).id);
      setActiveTab("entries");
    }
  }, [lorebookId, createEntry]);

  const handleClose = useCallback(() => {
    if (lorebookDirty) {
      setShowUnsavedWarning(true);
    } else {
      closeDetail();
    }
  }, [lorebookDirty, closeDetail]);

  const handleDelete = useCallback(async () => {
    if (!lorebookId) return;
    if (
      !(await showConfirmDialog({
        title: "Delete Lorebook",
        message: "Delete this lorebook? All entries will be lost.",
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }
    await deleteLorebook.mutateAsync(lorebookId);
    closeDetail();
  }, [lorebookId, deleteLorebook, closeDetail]);

  // ── Loading ──
  if (isLoading || !lorebook) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="shimmer h-8 w-48 rounded-xl" />
      </div>
    );
  }

  // ── Main editor ──
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Unsaved warning banner */}
      {showUnsavedWarning && (
        <div className="flex items-center gap-3 bg-amber-500/10 px-4 py-2.5 text-xs">
          <AlertTriangle size="0.875rem" className="text-amber-400" />
          <span className="flex-1 text-amber-200">You have unsaved changes</span>
          <button
            onClick={() => setShowUnsavedWarning(false)}
            className="rounded-lg px-3 py-1 text-[0.6875rem] font-medium text-amber-300 ring-1 ring-amber-400/30 transition-colors hover:bg-amber-400/10"
          >
            Keep editing
          </button>
          <button
            onClick={() => {
              setShowUnsavedWarning(false);
              setLorebookDirty(false);
              closeDetail();
            }}
            className="rounded-lg px-3 py-1 text-[0.6875rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
          >
            Discard & close
          </button>
          <button
            onClick={async () => {
              await handleSaveLorebook();
              setShowUnsavedWarning(false);
              closeDetail();
            }}
            className="rounded-lg bg-amber-500 px-3 py-1 text-[0.6875rem] font-medium text-white transition-colors hover:bg-amber-600"
          >
            Save & close
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <button onClick={handleClose} className="rounded-lg p-1.5 transition-colors hover:bg-[var(--accent)]">
          <ArrowLeft size="1rem" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm">
          <BookOpen size="1.125rem" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{lorebook.name}</h2>
          <p className="truncate text-[0.6875rem] text-[var(--muted-foreground)]">
            {entries.length} entries • {lorebook.category}
          </p>
        </div>
        <button
          onClick={handleSaveLorebook}
          disabled={!lorebookDirty || saving}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
        >
          <Save size="0.8125rem" />
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => api.download(`/lorebooks/${lorebookId}/export`)}
          className="rounded-lg p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          title="Export lorebook"
        >
          <svg width="0.875rem" height="0.875rem" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
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
          className="rounded-lg p-2 text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/15"
          title="Delete lorebook"
        >
          <Trash2 size="0.875rem" />
        </button>
      </div>

      {/* Body: Side-tabs + Content */}
      <div className="flex flex-1 overflow-hidden @max-5xl:flex-col">
        {/* Tab Rail */}
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--border)] bg-[var(--card)] p-2 @max-5xl:w-full @max-5xl:flex-row @max-5xl:overflow-x-auto @max-5xl:border-r-0 @max-5xl:border-b @max-5xl:p-1.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all text-left @max-5xl:whitespace-nowrap @max-5xl:px-2.5 @max-5xl:py-1.5",
                  activeTab === tab.id
                    ? "bg-gradient-to-r from-amber-400/15 to-orange-500/15 text-amber-400 ring-1 ring-amber-400/20"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                )}
              >
                <Icon size="0.875rem" />
                {tab.label}
                {tab.id === "entries" && (
                  <span className="ml-auto rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[0.625rem] @max-5xl:ml-1">
                    {entries.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 @max-5xl:p-4">
          <div className="mx-auto max-w-3xl">
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Name */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium">Name</label>
                  <input
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      markLorebookDirty();
                    }}
                    className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium">Description</label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => {
                      setFormDescription(e.target.value);
                      markLorebookDirty();
                    }}
                    rows={3}
                    className="w-full resize-y rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  />
                </div>

                {/* Tags */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                    <Tag size="0.75rem" /> Tags
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {formTags.map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-1 rounded-lg bg-amber-400/15 px-2 py-1 text-[0.6875rem] font-medium text-amber-400"
                      >
                        {tag}
                        <button
                          onClick={() => {
                            setFormTags(formTags.filter((t) => t !== tag));
                            markLorebookDirty();
                          }}
                          className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-amber-400/20"
                        >
                          <X size="0.625rem" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newTag.trim()) {
                          e.preventDefault();
                          const t = newTag.trim();
                          if (!formTags.includes(t)) {
                            setFormTags([...formTags, t]);
                            markLorebookDirty();
                          }
                          setNewTag("");
                        }
                      }}
                      placeholder="Add tag…"
                      className="flex-1 rounded-xl bg-[var(--secondary)] px-3 py-2 text-xs ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    />
                    <button
                      onClick={() => {
                        const t = newTag.trim();
                        if (t && !formTags.includes(t)) {
                          setFormTags([...formTags, t]);
                          markLorebookDirty();
                        }
                        setNewTag("");
                      }}
                      className="rounded-xl bg-[var(--secondary)] px-3 py-2 text-xs font-medium ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]"
                    >
                      <Plus size="0.75rem" />
                    </button>
                  </div>
                </div>

                {/* Category */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium">Category</label>
                  <div className="flex gap-2">
                    {CATEGORY_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setFormCategory(opt.value);
                            markLorebookDirty();
                          }}
                          className={cn(
                            "flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all",
                            formCategory === opt.value
                              ? "bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30"
                              : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
                          )}
                        >
                          <Icon size="0.8125rem" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Character Link */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                    Linked Character{" "}
                    <HelpTooltip text="When linked to a character, this lorebook will only activate in chats that include that character." />
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={formCharacterId ?? ""}
                      onChange={(e) => {
                        const nextCharacterId = e.target.value || null;
                        setFormCharacterId(nextCharacterId);
                        if (nextCharacterId) setFormPersonaId(null);
                        markLorebookDirty();
                      }}
                      className="flex-1 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    >
                      <option value="">None</option>
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {formCharacterId && (
                      <button
                        onClick={() => {
                          setFormCharacterId(null);
                          markLorebookDirty();
                        }}
                        className="rounded-xl bg-[var(--secondary)] p-2.5 text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)]"
                        title="Unlink character"
                      >
                        <X size="0.875rem" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Persona Link */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                    Linked Persona{" "}
                    <HelpTooltip text="When linked to a persona, this lorebook will only activate in chats that use that persona." />
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={formPersonaId ?? ""}
                      onChange={(e) => {
                        const nextPersonaId = e.target.value || null;
                        setFormPersonaId(nextPersonaId);
                        if (nextPersonaId) setFormCharacterId(null);
                        markLorebookDirty();
                      }}
                      className="flex-1 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    >
                      <option value="">None</option>
                      {personas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.comment ? `${p.name} — ${p.comment}` : p.name}
                        </option>
                      ))}
                    </select>
                    {formPersonaId && (
                      <button
                        onClick={() => {
                          setFormPersonaId(null);
                          markLorebookDirty();
                        }}
                        className="rounded-xl bg-[var(--secondary)] p-2.5 text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:text-[var(--foreground)]"
                        title="Unlink persona"
                      >
                        <X size="0.875rem" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Enabled toggle */}
                <div className="flex items-center justify-between rounded-xl bg-[var(--secondary)] px-4 py-3 ring-1 ring-[var(--border)]">
                  <div>
                    <p className="text-xs font-medium">Enabled</p>
                    <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
                      When off, entries in this lorebook won't activate
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setFormEnabled(!formEnabled);
                      markLorebookDirty();
                    }}
                    className="transition-colors"
                  >
                    {formEnabled ? (
                      <ToggleRight size="1.75rem" className="text-amber-400" />
                    ) : (
                      <ToggleLeft size="1.75rem" className="text-[var(--muted-foreground)]" />
                    )}
                  </button>
                </div>

                {/* Scan settings */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                      Scan Depth{" "}
                      <HelpTooltip text="How many recent messages to scan for keyword matches. Higher = searches further back in chat history, but uses more processing." />
                    </label>
                    <input
                      type="number"
                      value={formScanDepth}
                      onChange={(e) => {
                        setFormScanDepth(parseInt(e.target.value) || 0);
                        markLorebookDirty();
                      }}
                      min={0}
                      className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                      Token Budget{" "}
                      <HelpTooltip text="Maximum number of tokens this lorebook can inject per generation. Prevents a lorebook from consuming too much of the context window." />
                    </label>
                    <input
                      type="number"
                      value={formTokenBudget}
                      onChange={(e) => {
                        setFormTokenBudget(parseInt(e.target.value) || 0);
                        markLorebookDirty();
                      }}
                      min={0}
                      className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex items-center justify-between rounded-xl bg-[var(--secondary)] px-3 py-2.5 ring-1 ring-[var(--border)]">
                      <span className="mr-2 text-xs">Recursive</span>
                      <button
                        onClick={() => {
                          setFormRecursive(!formRecursive);
                          markLorebookDirty();
                        }}
                      >
                        {formRecursive ? (
                          <ToggleRight size="1.375rem" className="text-amber-400" />
                        ) : (
                          <ToggleLeft size="1.375rem" className="text-[var(--muted-foreground)]" />
                        )}
                      </button>
                    </div>
                    {formRecursive && (
                      <div>
                        <label className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                          Max Depth{" "}
                          <HelpTooltip text="Maximum number of recursive passes. Each pass scans activated entry content for additional keyword matches. Higher values find more connections but use more processing." />
                        </label>
                        <input
                          type="number"
                          value={formMaxRecursionDepth}
                          onChange={(e) => {
                            setFormMaxRecursionDepth(Math.max(1, Math.min(10, parseInt(e.target.value) || 3)));
                            markLorebookDirty();
                          }}
                          min={1}
                          max={10}
                          className="w-20 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Vectorize (Embeddings) */}
                <VectorizeSection lorebookId={lorebookId!} entries={entries} />
              </div>
            )}

            {activeTab === "entries" && (
              <div className="space-y-3">
                {/* Search + Sort + Add — flex-wrap so the row collapses
                    gracefully on narrow viewports. Search keeps a 12rem
                    (~192px) flex-basis so it stays usable; the buttons tile
                    onto the next row instead of being clipped at ~400px. */}
                <div className="flex flex-wrap items-stretch gap-2">
                  <div className="relative min-w-0 flex-[1_1_12rem]">
                    <Search
                      size="0.8125rem"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
                    />
                    <input
                      type="text"
                      placeholder="Search entries…"
                      value={entrySearch}
                      onChange={(e) => setEntrySearch(e.target.value)}
                      className="w-full rounded-xl bg-[var(--secondary)] py-2.5 pl-8 pr-3 text-xs ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    />
                  </div>
                  <div className="relative shrink-0">
                    <ArrowUpDown
                      size="0.8125rem"
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
                    />
                    <select
                      value={entrySort}
                      onChange={(e) => setEntrySort(e.target.value as EntrySortKey)}
                      className="h-full appearance-none rounded-xl bg-[var(--secondary)] py-2.5 pl-8 pr-6 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={handleAddFolder}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)]"
                    title="Create a new folder to group entries"
                  >
                    <FolderPlus size="0.8125rem" />
                    Add Folder
                  </button>
                  <button
                    onClick={handleAddEntry}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2.5 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98]"
                  >
                    <Plus size="0.8125rem" />
                    Add Entry
                  </button>
                </div>

                {/* Total tokens summary */}
                {entries.length > 0 && (
                  <div className="flex items-center gap-3 text-[0.6875rem] text-[var(--muted-foreground)]">
                    <span>
                      {entries.length} {entries.length === 1 ? "entry" : "entries"}
                    </span>
                    {folders.length > 0 && (
                      <>
                        <span>•</span>
                        <span>
                          {folders.length} {folders.length === 1 ? "folder" : "folders"}
                        </span>
                      </>
                    )}
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Hash size="0.625rem" />
                      {entries.reduce((sum, e) => sum + estimateTokens(e.content), 0).toLocaleString()} tokens (est.)
                    </span>
                    {!showFolderGrouping && folders.length > 0 && (
                      <span className="ml-auto italic">Folder view paused (clear search and sort by Order)</span>
                    )}
                  </div>
                )}

                {/* Empty state */}
                {entries.length === 0 && folders.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <FileText size="1.5rem" className="text-[var(--muted-foreground)]" />
                    <p className="text-xs text-[var(--muted-foreground)]">No entries yet — add one to get started</p>
                  </div>
                )}

                {/* Entries — folder-grouped view (default sort, no search) */}
                {lorebookId && showFolderGrouping && (entries.length > 0 || folders.length > 0) && (
                  <div className="space-y-3">
                    {/* Folder block */}
                    {folders.length > 0 && (
                      <div className="space-y-1.5">
                        {folders.map((folder, fIdx) => {
                          const folderEntries = entriesByContainer.get(folder.id) ?? [];
                          const isCollapsed = collapsedFolderIds.has(folder.id);
                          const showFolderDropBefore =
                            folderDropIdx === fIdx &&
                            draggingFolderIdx !== null &&
                            draggingFolderIdx !== fIdx &&
                            draggingFolderIdx !== fIdx - 1;
                          const showFolderDropAfter =
                            fIdx === folders.length - 1 &&
                            folderDropIdx === folders.length &&
                            draggingFolderIdx !== null &&
                            draggingFolderIdx !== fIdx;
                          return (
                            <div key={folder.id} className="space-y-1">
                              {showFolderDropBefore && <div className="mx-2 mb-1 h-0.5 rounded-full bg-amber-400" />}
                              {/*
                                When an entry from a different container is being
                                dragged toward this folder, paint a faint amber ring
                                around the header to mirror the root drop-zone hint.
                                The ring goes ON the wrapper div above the folder row
                                because LorebookFolderRow already manages its own ring
                                state for collapse/dragging visuals.
                              */}
                              <LorebookFolderRow
                                folder={folder}
                                lorebookId={lorebookId}
                                entryCount={folderEntries.length}
                                isCollapsed={isCollapsed}
                                onToggleCollapse={() => toggleFolderCollapsed(folder.id)}
                                draggable={canReorderFolders}
                                isDragging={draggingFolderIdx === fIdx}
                                isDragReady={folderDragReadyIdx === fIdx}
                                onDragHandleMouseDown={() => {
                                  if (canReorderFolders) setFolderDragReadyIdx(fIdx);
                                }}
                                onDragHandleMouseUp={() => setFolderDragReadyIdx(null)}
                                onDragStart={(e) => handleFolderDragStart(fIdx, folder.id, e)}
                                onDragOver={(e) => {
                                  e.stopPropagation();
                                  // Two roles for the same dragOver: if the user is dragging
                                  // an entry, this header is a cross-container drop target;
                                  // otherwise it's a sibling for folder reorder.
                                  if (draggingEntryIdx !== null) handleFolderHeaderDragOver(folder.id, e);
                                  else handleFolderDragOverHeader(fIdx, e);
                                }}
                                onDrop={(e) => {
                                  e.stopPropagation();
                                  if (draggingEntryIdx !== null) commitEntryDrop(e);
                                  else commitFolderDrop(e);
                                }}
                                onDragEnd={() => {
                                  resetFolderDragState();
                                  resetEntryDragState();
                                }}
                              />
                              {!isCollapsed && (
                                <div
                                  className="ml-4 space-y-1.5 border-l border-[var(--border)] pl-3"
                                  onDragOver={(e) => handleFolderBodyDragOver(folder.id, e)}
                                  onDrop={(e) => {
                                    e.stopPropagation();
                                    commitEntryDrop(e);
                                  }}
                                >
                                  {folderEntries.length === 0 && (
                                    <p className="py-2 text-[0.625rem] italic text-[var(--muted-foreground)]">
                                      Empty — drag an entry here or pick this folder from an entry's folder selector.
                                    </p>
                                  )}
                                  {folderEntries.map((entry, eIdx) => {
                                    const isDropTarget = dropTargetContainer === folder.id && draggingEntryIdx !== null;
                                    const sameContainer = dragSourceContainer === folder.id;
                                    // Position bars only render for SAME-container drops because
                                    // cross-container moves deliberately preserve the entry's
                                    // existing Order (per the user's spec). Showing a bar
                                    // between two entries during a cross-container drag would
                                    // promise a position the move won't honor — the folder
                                    // header's amber ring carries the "drop into this folder"
                                    // affordance instead.
                                    const showDropBefore =
                                      isDropTarget &&
                                      sameContainer &&
                                      entryDropIdx === eIdx &&
                                      draggingEntryIdx !== eIdx &&
                                      draggingEntryIdx !== eIdx - 1;
                                    const showDropAfter =
                                      isDropTarget &&
                                      sameContainer &&
                                      eIdx === folderEntries.length - 1 &&
                                      entryDropIdx === folderEntries.length &&
                                      draggingEntryIdx !== eIdx;
                                    return (
                                      <div key={entry.id}>
                                        {showDropBefore && (
                                          <div className="mx-2 mb-1 h-0.5 rounded-full bg-amber-400" />
                                        )}
                                        <LorebookEntryRow
                                          entry={entry}
                                          lorebookId={lorebookId}
                                          isExpanded={expandedEntryId === entry.id}
                                          onToggleExpand={() => toggleEntryExpanded(entry.id)}
                                          folders={folders}
                                          draggable={canReorderEntries}
                                          isDragging={sameContainer && draggingEntryIdx === eIdx}
                                          isDragReady={sameContainer && entryDragReadyIdx === eIdx}
                                          onDragHandleMouseDown={() => {
                                            if (canReorderEntries) {
                                              setEntryDragReadyIdx(eIdx);
                                              setDragSourceContainer(folder.id);
                                            }
                                          }}
                                          onDragHandleMouseUp={() => setEntryDragReadyIdx(null)}
                                          onDragStart={(e) => handleEntryDragStart(folder.id, eIdx, entry.id, e)}
                                          onDragOver={(e) => {
                                            e.stopPropagation();
                                            handleEntryDragOver(folder.id, eIdx, e);
                                          }}
                                          onDrop={(e) => {
                                            e.stopPropagation();
                                            commitEntryDrop(e);
                                          }}
                                          onDragEnd={resetEntryDragState}
                                        />
                                        {showDropAfter && <div className="mx-2 mt-1 h-0.5 rounded-full bg-amber-400" />}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {showFolderDropAfter && <div className="mx-2 mt-1 h-0.5 rounded-full bg-amber-400" />}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Root entries (entries with no folder).
                        Always rendered when grouping is active so it acts as
                        a permanent drop target — otherwise a user with all
                        entries inside folders has no place to drop a folder
                        entry to bring it back to root. */}
                    <div
                      ref={entryListRef}
                      className={cn(
                        "space-y-1.5",
                        // Highlight the zone when an entry from another
                        // container is being dragged toward it.
                        draggingEntryIdx !== null &&
                          dragSourceContainer !== null &&
                          dropTargetContainer === null &&
                          "rounded-xl ring-1 ring-amber-400/40 bg-amber-400/5 transition-colors",
                      )}
                      onDragOver={handleRootListDragOver}
                      onDrop={commitEntryDrop}
                    >
                      {(entriesByContainer.get(null) ?? []).length === 0 && (
                        <p
                          className={cn(
                            "py-3 text-center text-[0.625rem] italic text-[var(--muted-foreground)] transition-opacity",
                            // Only call out the empty-root zone while the user
                            // is actively dragging an entry from a folder; in
                            // the steady state it would just be visual noise.
                            draggingEntryIdx !== null && dragSourceContainer !== null ? "opacity-100" : "opacity-50",
                          )}
                        >
                          {draggingEntryIdx !== null && dragSourceContainer !== null
                            ? "Drop here to move out of the folder"
                            : "No entries at the root level"}
                        </p>
                      )}
                      {(entriesByContainer.get(null) ?? []).map((entry, idx) => {
                        const rootList = entriesByContainer.get(null) ?? [];
                        const isDropTarget = dropTargetContainer === null && draggingEntryIdx !== null;
                        const sameContainer = dragSourceContainer === null;
                        // Same rule as inside folders: only show the position bar for
                        // same-container drops because cross-container moves preserve
                        // Order. The amber ring on the root drop zone (added for Issue
                        // 2) handles the cross-container affordance.
                        const showDropBefore =
                          isDropTarget &&
                          sameContainer &&
                          entryDropIdx === idx &&
                          draggingEntryIdx !== idx &&
                          draggingEntryIdx !== idx - 1;
                        const showDropAfter =
                          isDropTarget &&
                          sameContainer &&
                          idx === rootList.length - 1 &&
                          entryDropIdx === rootList.length &&
                          draggingEntryIdx !== idx;
                        return (
                          <div key={entry.id}>
                            {showDropBefore && <div className="mx-2 mb-1 h-0.5 rounded-full bg-amber-400" />}
                            <LorebookEntryRow
                              entry={entry}
                              lorebookId={lorebookId}
                              isExpanded={expandedEntryId === entry.id}
                              onToggleExpand={() => toggleEntryExpanded(entry.id)}
                              folders={folders}
                              draggable={canReorderEntries}
                              isDragging={sameContainer && draggingEntryIdx === idx}
                              isDragReady={sameContainer && entryDragReadyIdx === idx}
                              onDragHandleMouseDown={() => {
                                if (canReorderEntries) {
                                  setEntryDragReadyIdx(idx);
                                  setDragSourceContainer(null);
                                }
                              }}
                              onDragHandleMouseUp={() => setEntryDragReadyIdx(null)}
                              onDragStart={(e) => handleEntryDragStart(null, idx, entry.id, e)}
                              onDragOver={(e) => {
                                e.stopPropagation();
                                handleEntryDragOver(null, idx, e);
                              }}
                              onDrop={(e) => {
                                e.stopPropagation();
                                commitEntryDrop(e);
                              }}
                              onDragEnd={resetEntryDragState}
                            />
                            {showDropAfter && <div className="mx-2 mt-1 h-0.5 rounded-full bg-amber-400" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Entries — flat view (search active or non-Order sort) */}
                {lorebookId && !showFolderGrouping && filteredEntries.length > 0 && (
                  <div ref={entryListRef} className="space-y-1.5">
                    {filteredEntries.map((entry) => (
                      <LorebookEntryRow
                        key={entry.id}
                        entry={entry}
                        lorebookId={lorebookId}
                        isExpanded={expandedEntryId === entry.id}
                        onToggleExpand={() => toggleEntryExpanded(entry.id)}
                        folders={folders}
                        draggable={false}
                        isDragging={false}
                        isDragReady={false}
                        onDragHandleMouseDown={() => undefined}
                        onDragHandleMouseUp={() => undefined}
                        onDragStart={() => undefined}
                        onDragOver={() => undefined}
                        onDrop={() => undefined}
                        onDragEnd={() => undefined}
                      />
                    ))}
                  </div>
                )}

                {/* Search-with-no-matches */}
                {lorebookId && !showFolderGrouping && filteredEntries.length === 0 && entries.length > 0 && (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <FileText size="1.5rem" className="text-[var(--muted-foreground)]" />
                    <p className="text-xs text-[var(--muted-foreground)]">No entries match your search</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Vectorize lorebook entries for semantic matching. */
function VectorizeSection({ lorebookId, entries }: { lorebookId: string; entries: LorebookEntry[] }) {
  const queryClient = useQueryClient();
  const { data: rawConnections } = useConnections();
  const connections = (rawConnections ?? []) as Array<{ id: string; name: string; embeddingModel?: string }>;
  const embeddingConnections = connections.filter((c) => c.embeddingModel);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [vectorizing, setVectorizing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const entryCount = entries.length;
  const vectorizedCount = entries.filter(
    (entry) => Array.isArray(entry.embedding) && entry.embedding.length > 0,
  ).length;
  const missingCount = Math.max(0, entryCount - vectorizedCount);
  const allVectorized = entryCount > 0 && missingCount === 0;

  // Auto-select first embedding connection
  useEffect(() => {
    if (!selectedConnectionId && embeddingConnections.length > 0) {
      setSelectedConnectionId(embeddingConnections[0].id);
    }
  }, [embeddingConnections, selectedConnectionId]);

  const handleVectorize = async () => {
    if (!selectedConnectionId) return;
    setVectorizing(true);
    setResult(null);
    try {
      const conn = embeddingConnections.find((c) => c.id === selectedConnectionId);
      const res = await api.post(`/lorebooks/${lorebookId}/vectorize`, {
        connectionId: selectedConnectionId,
        model: conn?.embeddingModel ?? "",
        onlyMissing: !allVectorized,
      });
      const data = res as { vectorized: number; total?: number; skipped?: number };
      await queryClient.invalidateQueries({ queryKey: lorebookKeys.entries(lorebookId) });
      setResult({
        success: true,
        message: allVectorized
          ? `Re-vectorized ${data.vectorized} entries`
          : `Vectorized ${data.vectorized} missing entries`,
      });
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Vectorization failed" });
    } finally {
      setVectorizing(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size="0.875rem" className="text-violet-400" />
        <h4 className="text-xs font-semibold">Semantic Search (Embeddings)</h4>
        <HelpTooltip text="Vectorize entries to enable semantic matching. Entries will be found by meaning, not just keywords. Requires a connection with an Embedding Model configured." />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[0.625rem] text-[var(--muted-foreground)]">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 ring-1",
            allVectorized
              ? "bg-emerald-400/10 text-emerald-400 ring-emerald-400/20"
              : "bg-[var(--background)]/70 ring-[var(--border)]",
          )}
        >
          {allVectorized ? <Check size="0.625rem" /> : <AlertTriangle size="0.625rem" />}
          {vectorizedCount}/{entryCount} entries vectorized
        </span>
        {missingCount > 0 && <span>{missingCount} still need embeddings.</span>}
      </div>
      {embeddingConnections.length === 0 ? (
        <p className="text-[0.625rem] text-[var(--muted-foreground)]">
          No connections with an embedding model configured. Set an Embedding Model on a connection first.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <select
              value={selectedConnectionId}
              onChange={(e) => setSelectedConnectionId(e.target.value)}
              className="flex-1 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            >
              {embeddingConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.embeddingModel})
                </option>
              ))}
            </select>
            <button
              onClick={handleVectorize}
              disabled={vectorizing || entryCount === 0}
              className="flex items-center gap-1.5 rounded-xl bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-400 ring-1 ring-violet-500/30 transition-all hover:bg-violet-500/25 active:scale-[0.98] disabled:opacity-50"
            >
              {vectorizing ? <Loader2 size="0.75rem" className="animate-spin" /> : <Sparkles size="0.75rem" />}
              {vectorizing
                ? "Vectorizing..."
                : allVectorized
                  ? `Re-vectorize ${entryCount} entries`
                  : `Vectorize ${missingCount} missing`}
            </button>
          </div>
          {result && (
            <p
              className={cn(
                "text-[0.625rem] flex items-center gap-1",
                result.success ? "text-emerald-400" : "text-red-400",
              )}
            >
              {result.success ? <Check size="0.625rem" /> : <AlertTriangle size="0.625rem" />}
              {result.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
