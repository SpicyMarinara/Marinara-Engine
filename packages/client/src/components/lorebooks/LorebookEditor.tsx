// ──────────────────────────────────────────────
// Lorebook Editor — Full-page detail view
// Replaces the chat area when editing a lorebook.
// Tabs: Overview, Entries, Entry Editor
// ──────────────────────────────────────────────
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  useLorebook,
  useUpdateLorebook,
  useLorebookEntries,
  useCreateLorebookEntry,
  useUpdateLorebookEntry,
  useDeleteLorebookEntry,
  useDeleteLorebook,
} from "../../hooks/use-lorebooks";
import { useCharacters } from "../../hooks/use-characters";
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
  Key,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  ChevronRight,
  Globe,
  Users,
  UserRound,
  Maximize2,
  X,
  ArrowUpDown,
  Hash,
  Sparkles,
  Loader2,
  Check,
  Lock,
  Tag,
  Wand2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";
import { api } from "../../lib/api-client";
import type { Lorebook, LorebookEntry, LorebookCategory } from "@marinara-engine/shared";

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

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

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
  const { data: rawCharacters } = useCharacters();
  const updateLorebook = useUpdateLorebook();
  const deleteLorebook = useDeleteLorebook();
  const createEntry = useCreateLorebookEntry();
  const updateEntry = useUpdateLorebookEntry();
  const deleteEntry = useDeleteLorebookEntry();

  const lorebook = rawLorebook as Lorebook | undefined;
  const entries = useMemo(() => (rawEntries ?? []) as LorebookEntry[], [rawEntries]);
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

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [lorebookDirty, setLorebookDirty] = useState(false);
  const [entryDirty, setEntryDirty] = useState(false);
  const setEditorDirty = useUIStore((s) => s.setEditorDirty);
  useEffect(() => {
    setEditorDirty(lorebookDirty || entryDirty);
  }, [lorebookDirty, entryDirty, setEditorDirty]);
  const [saving, setSaving] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [entrySearch, setEntrySearch] = useState("");
  const [entrySort, setEntrySort] = useState<EntrySortKey>("order");

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
  const [formTags, setFormTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");

  // ── Form state for entry editor ──
  const [entryForm, setEntryForm] = useState<Partial<LorebookEntry> | null>(null);
  const loadedLorebookIdRef = useRef<string | null>(null);
  const loadedEntryIdRef = useRef<string | null>(null);

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
    setFormTags(lorebook.tags ?? []);
    setLorebookDirty(false);
    loadedLorebookIdRef.current = lorebook.id;
  }, [lorebook, lorebookDirty]);

  // Load entry data into form
  useEffect(() => {
    if (!editingEntryId) {
      setEntryForm(null);
      setEntryDirty(false);
      loadedEntryIdRef.current = null;
      return;
    }
    const entry = entries.find((e) => e.id === editingEntryId);
    if (!entry) return;

    const hasSwitchedEntries = loadedEntryIdRef.current !== editingEntryId;
    if (!hasSwitchedEntries && entryDirty) return;

    setEntryForm({ ...entry });
    setEntryDirty(false);
    loadedEntryIdRef.current = editingEntryId;
  }, [editingEntryId, entries, entryDirty]);

  // Filtered + sorted entries
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

  // ── Handlers ──
  const markLorebookDirty = useCallback(() => setLorebookDirty(true), []);
  const updateEntryForm = useCallback((patch: Partial<LorebookEntry>) => {
    setEntryDirty(true);
    setEntryForm((current) => (current ? { ...current, ...patch } : current));
  }, []);

  // Preserve main scroll position across entry editor sub-view so returning
  // from an entry doesn't reset a long entry list (e.g. 250 entries on mobile).
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const savedScrollTopRef = useRef(0);
  const openEntry = useCallback((entryId: string) => {
    savedScrollTopRef.current = mainScrollRef.current?.scrollTop ?? 0;
    setEditingEntryId(entryId);
  }, []);
  useLayoutEffect(() => {
    if (editingEntryId || !mainScrollRef.current) return;
    mainScrollRef.current.scrollTop = savedScrollTopRef.current;
  }, [editingEntryId, activeTab]);

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
    formTags,
    updateLorebook,
  ]);

  const handleSaveEntry = useCallback(async () => {
    if (!lorebookId || !editingEntryId || !entryForm) return;
    setSaving(true);
    try {
      await updateEntry.mutateAsync({
        lorebookId,
        entryId: editingEntryId,
        name: entryForm.name,
        content: entryForm.content,
        description: entryForm.description,
        keys: entryForm.keys,
        secondaryKeys: entryForm.secondaryKeys,
        enabled: entryForm.enabled,
        constant: entryForm.constant,
        selective: entryForm.selective,
        selectiveLogic: entryForm.selectiveLogic,
        matchWholeWords: entryForm.matchWholeWords,
        caseSensitive: entryForm.caseSensitive,
        useRegex: entryForm.useRegex,
        position: entryForm.position,
        depth: entryForm.depth,
        order: entryForm.order,
        role: entryForm.role,
        sticky: entryForm.sticky,
        cooldown: entryForm.cooldown,
        delay: entryForm.delay,
        ephemeral: entryForm.ephemeral,
        group: entryForm.group,
        tag: entryForm.tag,
        locked: entryForm.locked,
        preventRecursion: entryForm.preventRecursion,
      });
      setEntryDirty(false);
    } finally {
      setSaving(false);
    }
  }, [lorebookId, editingEntryId, entryForm, updateEntry]);

  const handleAddEntry = useCallback(async () => {
    if (!lorebookId) return;
    const result = await createEntry.mutateAsync({
      lorebookId,
      name: "New Entry",
      content: "",
      keys: [],
    });
    if (result && typeof result === "object" && "id" in result) {
      setEditingEntryId((result as LorebookEntry).id);
    }
  }, [lorebookId, createEntry]);

  const handleDeleteEntry = useCallback(
    async (entryId: string) => {
      if (!lorebookId) return;
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
      if (editingEntryId === entryId) setEditingEntryId(null);
      await deleteEntry.mutateAsync({ lorebookId, entryId });
    },
    [lorebookId, editingEntryId, deleteEntry],
  );

  const handleExitEntry = useCallback(async () => {
    if (
      entryDirty &&
      !(await showConfirmDialog({
        title: "Unsaved Changes",
        message: "You have unsaved changes. Discard them and leave this entry?",
        confirmLabel: "Discard",
        tone: "destructive",
      }))
    ) {
      return;
    }
    setEntryDirty(false);
    setEditingEntryId(null);
  }, [entryDirty]);

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

  // ── Entry editor sub-view ──
  if (editingEntryId && entryForm) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Entry editor header */}
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <button onClick={handleExitEntry} className="rounded-lg p-1.5 transition-colors hover:bg-[var(--accent)]">
            <ArrowLeft size="1rem" />
          </button>
          <div className="min-w-0 flex-1">
            <input
              value={entryForm.name ?? ""}
              onChange={(e) => updateEntryForm({ name: e.target.value })}
              className="w-full rounded-lg bg-transparent px-1.5 text-base font-semibold outline-none transition-colors hover:bg-[var(--secondary)] focus:bg-[var(--secondary)] focus:ring-1 focus:ring-[var(--ring)]"
              placeholder="Entry name"
            />
          </div>
          <button
            onClick={handleSaveEntry}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            <Save size="0.8125rem" />
            {saving ? "Saving…" : "Save Entry"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl space-y-6">
            {/* Name */}
            <FieldGroup
              label="Name"
              icon={FileText}
              help="A display name for this entry. This is only for your own organization — it's not sent to the AI."
            >
              <input
                value={entryForm.name ?? ""}
                onChange={(e) => updateEntryForm({ name: e.target.value })}
                className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                placeholder="Entry name"
              />
            </FieldGroup>

            {/* Description */}
            <FieldGroup
              label="Description"
              icon={FileText}
              help="Brief summary of what this entry is about. Used by the Knowledge Router agent to decide whether to inject this entry — not sent to the main AI as content."
            >
              <textarea
                value={entryForm.description ?? ""}
                onChange={(e) => updateEntryForm({ description: e.target.value })}
                rows={2}
                className="w-full resize-y rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                placeholder="Brief summary of what this entry is about (used by Knowledge Router agent)."
              />
            </FieldGroup>

            {/* Keys */}
            <FieldGroup
              label="Primary Keys"
              icon={Key}
              help="Keywords that trigger this entry. When any of these words appear in the chat, this entry's content is injected into the AI's context."
            >
              <KeysEditor keys={entryForm.keys ?? []} onChange={(keys) => updateEntryForm({ keys })} />
            </FieldGroup>

            {/* Secondary Keys */}
            <FieldGroup
              label="Secondary Keys"
              icon={Key}
              help="Additional keywords used with AND/OR/NOT logic. 'AND' means both primary AND secondary must match. 'NOT' means primary must match but secondary must NOT."
            >
              <KeysEditor
                keys={entryForm.secondaryKeys ?? []}
                onChange={(keys) => updateEntryForm({ secondaryKeys: keys })}
              />
              <div className="mt-2 flex items-center gap-3">
                <label className="text-[0.6875rem] text-[var(--muted-foreground)]">Logic:</label>
                {(["and", "or", "not"] as const).map((logic) => (
                  <button
                    key={logic}
                    onClick={() => updateEntryForm({ selectiveLogic: logic })}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[0.6875rem] font-medium transition-colors",
                      entryForm.selectiveLogic === logic
                        ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                    )}
                  >
                    {logic.toUpperCase()}
                  </button>
                ))}
              </div>
            </FieldGroup>

            {/* Content */}
            <FieldGroup
              label="Content"
              icon={FileText}
              help="The text that gets injected into the AI's context when this entry activates. Write it as you'd want the AI to know it."
            >
              <ExpandableTextarea
                value={entryForm.content ?? ""}
                onChange={(v) => updateEntryForm({ content: v })}
                rows={8}
                placeholder="The content that will be injected into the prompt when this entry activates…"
                title="Edit Content"
              />
              <p className="mt-1 flex items-center gap-1 text-[0.625rem] text-[var(--muted-foreground)]">
                <Hash size="0.5625rem" />~{estimateTokens(entryForm.content ?? "").toLocaleString()} tokens
              </p>
            </FieldGroup>

            {/* Toggles row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ToggleButton
                label="Enabled"
                value={entryForm.enabled ?? true}
                onChange={(v) => updateEntryForm({ enabled: v })}
              />
              <ToggleButton
                label="Constant"
                value={entryForm.constant ?? false}
                onChange={(v) => updateEntryForm({ constant: v })}
              />
              <ToggleButton
                label="Selective"
                value={entryForm.selective ?? false}
                onChange={(v) => updateEntryForm({ selective: v })}
              />
              <ToggleButton
                label="Regex"
                value={entryForm.useRegex ?? false}
                onChange={(v) => updateEntryForm({ useRegex: v })}
              />
              <ToggleButton
                label="Whole Words"
                value={entryForm.matchWholeWords ?? false}
                onChange={(v) => updateEntryForm({ matchWholeWords: v })}
              />
              <ToggleButton
                label="Case Sensitive"
                value={entryForm.caseSensitive ?? false}
                onChange={(v) => updateEntryForm({ caseSensitive: v })}
              />
              <ToggleButton
                label="Locked"
                value={entryForm.locked ?? false}
                onChange={(v) => updateEntryForm({ locked: v })}
                tooltip="Prevents the Lorebook Keeper agent from modifying this entry."
              />
              <ToggleButton
                label="No Recursion"
                value={entryForm.preventRecursion ?? false}
                onChange={(v) => updateEntryForm({ preventRecursion: v })}
                tooltip="When enabled, this entry's content won't trigger additional entries during recursive scanning."
              />
            </div>

            {/* Injection settings */}
            <FieldGroup
              label="Injection"
              icon={Settings2}
              help="Position controls where in the prompt this entry appears. 'Before Chat' and 'After Chat' place it in the lore section. 'At Depth' injects it into the chat history at the specified depth."
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">Position</label>
                  <select
                    value={entryForm.position ?? 0}
                    onChange={(e) => updateEntryForm({ position: Number(e.target.value) })}
                    className="w-full rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  >
                    <option value={0}>Before Chat</option>
                    <option value={1}>After Chat</option>
                    <option value={2}>At Depth</option>
                  </select>
                </div>
                {(entryForm.position ?? 0) >= 2 && (
                  <NumberField
                    label="Depth"
                    value={entryForm.depth ?? 4}
                    onChange={(v) => updateEntryForm({ depth: v })}
                    min={0}
                  />
                )}
                <NumberField
                  label="Order"
                  value={entryForm.order ?? 100}
                  onChange={(v) => updateEntryForm({ order: v })}
                />
                <div>
                  <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">Role</label>
                  <select
                    value={entryForm.role ?? "system"}
                    onChange={(e) => updateEntryForm({ role: e.target.value as "system" | "user" | "assistant" })}
                    className="w-full rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  >
                    <option value="system">System</option>
                    <option value="user">User</option>
                    <option value="assistant">Assistant</option>
                  </select>
                </div>
              </div>
            </FieldGroup>

            {/* Timing */}
            <FieldGroup
              label="Timing"
              icon={Settings2}
              help="Sticky = stays active for N messages after triggering. Cooldown = waits N messages before it can trigger again. Delay = waits N messages before first activation. Ephemeral = auto-disables after N activations (0 = unlimited)."
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <NumberField
                  label="Sticky"
                  value={entryForm.sticky ?? 0}
                  onChange={(v) => updateEntryForm({ sticky: v || null })}
                  min={0}
                />
                <NumberField
                  label="Cooldown"
                  value={entryForm.cooldown ?? 0}
                  onChange={(v) => updateEntryForm({ cooldown: v || null })}
                  min={0}
                />
                <NumberField
                  label="Delay"
                  value={entryForm.delay ?? 0}
                  onChange={(v) => updateEntryForm({ delay: v || null })}
                  min={0}
                />
                <NumberField
                  label="Ephemeral"
                  value={entryForm.ephemeral ?? 0}
                  onChange={(v) => updateEntryForm({ ephemeral: v || null })}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">Group</label>
                  <input
                    value={entryForm.group ?? ""}
                    onChange={(e) => updateEntryForm({ group: e.target.value })}
                    className="w-full rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    placeholder="Group name"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">Tag</label>
                  <input
                    value={entryForm.tag ?? ""}
                    onChange={(e) => updateEntryForm({ tag: e.target.value })}
                    className="w-full rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    placeholder="e.g. location, item, lore"
                  />
                </div>
              </div>
            </FieldGroup>
          </div>
        </div>
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
        <div ref={mainScrollRef} className="flex-1 overflow-y-auto p-6 @max-5xl:p-4">
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
                        setFormCharacterId(e.target.value || null);
                        markLorebookDirty();
                      }}
                      className="flex-1 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    >
                      <option value="">None (global)</option>
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
                <VectorizeSection lorebookId={lorebookId!} entryCount={entries.length} />
              </div>
            )}

            {activeTab === "entries" && (
              <div className="space-y-3">
                {/* Search + Sort + Add */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
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
                  <div className="relative">
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
                    onClick={handleAddEntry}
                    className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2.5 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98]"
                  >
                    <Plus size="0.8125rem" />
                    Add Entry
                  </button>
                </div>

                {/* Total tokens summary */}
                {filteredEntries.length > 0 && (
                  <div className="flex items-center gap-3 text-[0.6875rem] text-[var(--muted-foreground)]">
                    <span>{filteredEntries.length} entries</span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Hash size="0.625rem" />
                      {filteredEntries.reduce((sum, e) => sum + estimateTokens(e.content), 0).toLocaleString()} tokens
                      (est.)
                    </span>
                  </div>
                )}

                {/* Entry list */}
                {filteredEntries.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <FileText size="1.5rem" className="text-[var(--muted-foreground)]" />
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {entrySearch ? "No entries match your search" : "No entries yet — add one to get started"}
                    </p>
                  </div>
                )}

                {filteredEntries.map((entry) => (
                  <div
                    key={entry.id}
                    onClick={() => openEntry(entry.id)}
                    className="group flex cursor-pointer items-center gap-3 rounded-xl bg-[var(--secondary)] p-3 ring-1 ring-[var(--border)] transition-all hover:ring-amber-400/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn("h-2 w-2 rounded-full", entry.enabled ? "bg-emerald-400" : "bg-zinc-500")}
                        />
                        <span className="truncate text-sm font-medium">{entry.name}</span>
                        {entry.constant && (
                          <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-amber-400">
                            CONST
                          </span>
                        )}
                        {entry.locked && (
                          <span className="rounded bg-sky-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-sky-400">
                            <Lock size="0.5rem" className="inline mr-0.5" />
                            LOCKED
                          </span>
                        )}
                        {entry.tag && (
                          <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[0.5625rem] text-[var(--muted-foreground)]">
                            {entry.tag}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                        <span className="flex items-center gap-1">
                          <Key size="0.625rem" />
                          {entry.keys.length > 0 ? entry.keys.slice(0, 3).join(", ") : "No keys"}
                          {entry.keys.length > 3 && ` +${entry.keys.length - 3}`}
                        </span>
                        <span>•</span>
                        <span>Order {entry.order}</span>
                        <span>•</span>
                        <span>Depth {entry.depth}</span>
                        <span>•</span>
                        <span className="flex items-center gap-0.5">
                          <Hash size="0.5625rem" />
                          {estimateTokens(entry.content).toLocaleString()} tk
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteEntry(entry.id);
                      }}
                      className="rounded-lg p-1.5 opacity-0 transition-all hover:bg-[var(--destructive)]/15 group-hover:opacity-100 max-md:opacity-100"
                    >
                      <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
                    </button>
                    <ChevronRight size="0.875rem" className="text-[var(--muted-foreground)]" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reusable sub-components ──

function FieldGroup({
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
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
        <Icon size="0.8125rem" className="text-amber-400" />
        {label}
        {help && <HelpTooltip text={help} />}
      </div>
      {children}
    </div>
  );
}

function KeysEditor({ keys, onChange }: { keys: string[]; onChange: (keys: string[]) => void }) {
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

function ToggleButton({
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
        "flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium ring-1 transition-all",
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

function NumberField({
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

/** Vectorize lorebook entries for semantic matching. */
function VectorizeSection({ lorebookId, entryCount }: { lorebookId: string; entryCount: number }) {
  const { data: rawConnections } = useConnections();
  const connections = (rawConnections ?? []) as Array<{ id: string; name: string; embeddingModel?: string }>;
  const embeddingConnections = connections.filter((c) => c.embeddingModel);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [vectorizing, setVectorizing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

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
      });
      const data = res as { vectorized: number };
      setResult({ success: true, message: `Vectorized ${data.vectorized} entries` });
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
              Vectorize {entryCount} entries
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

function insertTabAtSelection(element: HTMLTextAreaElement, value: string, applyValue: (nextValue: string) => void) {
  const start = element.selectionStart;
  const end = element.selectionEnd;
  const nextValue = `${value.slice(0, start)}\t${value.slice(end)}`;
  applyValue(nextValue);

  requestAnimationFrame(() => {
    element.selectionStart = element.selectionEnd = start + 1;
  });
}

function handleTextareaTabKeyDown(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  value: string,
  applyValue: (nextValue: string) => void,
) {
  if (event.key !== "Tab" || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
  event.preventDefault();
  insertTabAtSelection(event.currentTarget, value, applyValue);
}

/** Textarea with an expand button that opens a fullscreen modal editor. */
function ExpandableTextarea({
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
          className="w-full resize-y rounded-xl bg-[var(--secondary)] p-3 pr-9 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
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
function ExpandedContentModal({
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
