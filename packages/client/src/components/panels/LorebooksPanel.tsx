// ──────────────────────────────────────────────
// Panel: Lorebooks (overhauled)
// Category tabs, search, click-to-edit, AI generate
// ──────────────────────────────────────────────
import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus,
  Download,
  Check,
  Sparkles,
  BookOpen,
  Search,
  Globe,
  Users,
  UserRound,
  Layers,
  ArrowUpDown,
  Tag,
  ChevronDown,
  ChevronUp,
  X,
  Wand2,
  Trash2,
} from "lucide-react";
import { useUIStore } from "../../stores/ui.store";
import { useLorebooks, useDeleteLorebook, useUpdateLorebook } from "../../hooks/use-lorebooks";
import { useCharacters } from "../../hooks/use-characters";
import type { Lorebook, LorebookCategory } from "@marinara-engine/shared";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api-client";

const CATEGORIES: Array<{ id: LorebookCategory | "all"; label: string; icon: typeof Globe }> = [
  { id: "all", label: "All", icon: Layers },
  { id: "world", label: "World", icon: Globe },
  { id: "character", label: "Character", icon: Users },
  { id: "npc", label: "NPC", icon: UserRound },
  { id: "spellbook", label: "Spellbook", icon: Wand2 },
  { id: "uncategorized", label: "Other", icon: BookOpen },
];

const CATEGORY_COLORS: Record<string, string> = {
  world: "from-emerald-400 to-teal-500",
  character: "from-violet-400 to-purple-500",
  npc: "from-rose-400 to-pink-500",
  spellbook: "from-blue-400 to-indigo-500",
  uncategorized: "from-amber-400 to-orange-500",
  all: "from-amber-400 to-orange-500",
};

export function LorebooksPanel() {
  const [activeCategory, setActiveCategory] = useState<LorebookCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<"name-asc" | "name-desc" | "newest" | "oldest" | "tokens">("name-asc");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedLorebookIds, setSelectedLorebookIds] = useState<Set<string>>(new Set());
  const [exportingSelected, setExportingSelected] = useState(false);

  const { data: lorebooks, isLoading } = useLorebooks(activeCategory === "all" ? undefined : activeCategory);
  const { data: rawCharacters } = useCharacters();
  const deleteLorebook = useDeleteLorebook();
  const updateLorebook = useUpdateLorebook();
  const openModal = useUIStore((s) => s.openModal);
  const openLorebookDetail = useUIStore((s) => s.openLorebookDetail);

  const characterNameById = useMemo(() => {
    const map = new Map<string, string>();
    if (!rawCharacters) return map;
    for (const c of rawCharacters as Array<{ id: string; data: string | Record<string, unknown> }>) {
      try {
        const d = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
        map.set(c.id, d?.name ?? "Unknown");
      } catch {
        map.set(c.id, "Unknown");
      }
    }
    return map;
  }, [rawCharacters]);

  const parseTags = (lb: Lorebook): string[] => {
    const raw = lb.tags;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string")
      try {
        return JSON.parse(raw);
      } catch {
        return [];
      }
    return [];
  };

  const allTags = useMemo(() => {
    if (!lorebooks) return [] as string[];
    const tagSet = new Set<string>();
    for (const lb of lorebooks as Lorebook[]) {
      for (const t of parseTags(lb)) tagSet.add(t);
    }
    return Array.from(tagSet).sort();
  }, [lorebooks]);

  const handleDeleteTag = useCallback(
    async (tag: string) => {
      if (
        !(await showConfirmDialog({
          title: "Remove Tag",
          message: `Remove tag "${tag}" from all lorebooks?`,
          confirmLabel: "Remove",
          tone: "destructive",
        }))
      ) {
        return;
      }
      try {
        if (!lorebooks) return;
        const affected = (lorebooks as Lorebook[]).filter((lb) => parseTags(lb).includes(tag));
        for (const lb of affected) {
          const newTags = parseTags(lb).filter((t) => t !== tag);
          await updateLorebook.mutateAsync({ id: lb.id, tags: newTags });
        }
        if (activeTag === tag) setActiveTag(null);
      } catch {
        toast.error("Failed to remove tag from some lorebooks");
      }
    },
    [lorebooks, updateLorebook, activeTag],
  );

  // Filter by search
  const filtered = useMemo(() => {
    if (!lorebooks) return [];
    let list = lorebooks as Lorebook[];
    if (activeTag) {
      list = list.filter((lb) => parseTags(lb).includes(activeTag));
    }
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (lb: Lorebook) =>
        lb.name.toLowerCase().includes(q) ||
        lb.description.toLowerCase().includes(q) ||
        parseTags(lb).some((t) => t.toLowerCase().includes(q)),
    );
  }, [lorebooks, searchQuery, activeTag]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    switch (sort) {
      case "name-asc":
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case "name-desc":
        return list.sort((a, b) => b.name.localeCompare(a.name));
      case "newest":
        return list.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      case "oldest":
        return list.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      case "tokens":
        return list.sort((a, b) => (b.tokenBudget ?? 0) - (a.tokenBudget ?? 0));
      default:
        return list;
    }
  }, [filtered, sort]);

  // Group by category for "all" view
  const grouped = useMemo(() => {
    if (activeCategory !== "all") return null;
    const map = new Map<string, Lorebook[]>();
    for (const lb of sorted) {
      const cat = lb.category || "uncategorized";
      const list = map.get(cat) ?? [];
      list.push(lb);
      map.set(cat, list);
    }
    return map;
  }, [sorted, activeCategory]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedLorebookIds(new Set());
  }, []);

  const toggleSelection = useCallback((lorebookId: string) => {
    setSelectedLorebookIds((prev) => {
      const next = new Set(prev);
      if (next.has(lorebookId)) next.delete(lorebookId);
      else next.add(lorebookId);
      return next;
    });
  }, []);

  const handleExportSelected = useCallback(async () => {
    if (selectedLorebookIds.size === 0) return;
    setExportingSelected(true);
    try {
      await api.downloadPost("/lorebooks/export-bulk", { ids: [...selectedLorebookIds] }, "marinara-lorebooks.zip");
      toast.success(`Exported ${selectedLorebookIds.size} lorebook${selectedLorebookIds.size === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export lorebooks");
    } finally {
      setExportingSelected(false);
    }
  }, [selectedLorebookIds]);

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => openModal("create-lorebook")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-2.5 text-xs font-medium text-white shadow-md shadow-amber-400/15 transition-all hover:shadow-lg hover:shadow-amber-400/25 active:scale-[0.98]"
          title="New"
        >
          <Plus size="0.8125rem" /> <span className="md:hidden">New</span>
        </button>
        <button
          onClick={() => openModal("import-lorebook")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
          title="Import"
        >
          <Download size="0.8125rem" /> <span className="md:hidden">Import</span>
        </button>
        <button
          onClick={() => openModal("lorebook-maker")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
          title="AI Maker"
        >
          <Sparkles size="0.8125rem" /> <span className="md:hidden">Maker</span>
        </button>
        <button
          onClick={() => {
            if (selectionMode) exitSelectionMode();
            else setSelectionMode(true);
          }}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all",
            selectionMode
              ? "bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30"
              : "bg-[var(--secondary)] text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
          )}
          title="Select"
        >
          <Check size="0.8125rem" /> <span className="md:hidden">Select</span>
        </button>
      </div>

      {selectionMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/60 px-3 py-2">
          <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
            {selectedLorebookIds.size} selected
          </span>
          <button
            onClick={() => setSelectedLorebookIds(new Set(sorted.map((lb) => lb.id)))}
            disabled={sorted.length === 0}
            className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-amber-400 transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
          >
            Select visible
          </button>
          <button
            onClick={() => setSelectedLorebookIds(new Set())}
            disabled={selectedLorebookIds.size === 0}
            className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
          >
            Clear
          </button>
          <button
            onClick={handleExportSelected}
            disabled={selectedLorebookIds.size === 0 || exportingSelected}
            className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-[0.625rem] font-medium text-white transition-all hover:opacity-90 disabled:opacity-40"
          >
            <Download size="0.6875rem" />
            {exportingSelected ? "Exporting..." : "Export ZIP"}
          </button>
          <button
            onClick={exitSelectionMode}
            className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            Done
          </button>
        </div>
      )}

      {/* Search + Sort */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search
            size="0.8125rem"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            type="text"
            placeholder="Search lorebooks"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl bg-[var(--secondary)] py-2 pl-8 pr-3 text-xs text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </div>
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="h-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--secondary)] py-2 pl-2.5 pr-7 text-[0.6875rem] outline-none transition-colors focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            title="Sort order"
          >
            <option value="name-asc">A-Z</option>
            <option value="name-desc">Z-A</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="tokens">Token Budget</option>
          </select>
          <ArrowUpDown
            size="0.625rem"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[0.6875rem] font-medium transition-all",
                isActive
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
              )}
            >
              <Icon size="0.75rem" />
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setTagsExpanded(!tagsExpanded)}
            className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            title={tagsExpanded ? "Collapse tags" : "Expand tags"}
          >
            <Tag size="0.6875rem" />
            {tagsExpanded ? <ChevronUp size="0.625rem" /> : <ChevronDown size="0.625rem" />}
          </button>
          {(tagsExpanded ? allTags : allTags.slice(0, 5)).map((tag) => (
            <div
              key={tag}
              role="button"
              tabIndex={0}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveTag(activeTag === tag ? null : tag);
                }
              }}
              className={cn(
                "group/tag flex items-center gap-1 rounded-lg px-2 py-1 text-[0.625rem] font-medium transition-all cursor-pointer",
                activeTag === tag
                  ? "bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30"
                  : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:text-[var(--foreground)]",
              )}
            >
              {tag}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteTag(tag);
                }}
                className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-[var(--destructive)]/20 hover:text-[var(--destructive)]"
                title={`Delete tag "${tag}"`}
              >
                <X size="0.5rem" />
              </button>
            </div>
          ))}
          {!tagsExpanded && allTags.length > 5 && (
            <button
              onClick={() => setTagsExpanded(true)}
              className="rounded-lg px-2 py-1 text-[0.625rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              +{allTags.length - 5} more
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col gap-2 py-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-14 rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && sorted.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="animate-float flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/20 to-orange-500/20">
            <BookOpen size="1.25rem" className="text-amber-400" />
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            {searchQuery ? "No lorebooks match your search" : "No lorebooks yet"}
          </p>
        </div>
      )}

      {/* Lorebook list */}
      {!isLoading && sorted.length > 0 && (
        <div className="stagger-children flex flex-col gap-1">
          {activeCategory === "all" && grouped
            ? // Grouped view
              Array.from(grouped.entries()).map(([category, books]) => {
                const catMeta = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[5];
                const CatIcon = catMeta.icon;
                return (
                  <div key={category} className="mb-2">
                    <div className="mb-1 flex items-center gap-1.5 px-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      <CatIcon size="0.6875rem" />
                      {catMeta.label}
                      <span className="ml-auto text-[0.625rem] font-normal">{books.length}</span>
                    </div>
                    {books.map((lb) => (
                      <LorebookRow
                        key={lb.id}
                        lorebook={lb}
                        characterName={lb.characterId ? characterNameById.get(lb.characterId) : undefined}
                        onClick={() => {
                          if (selectionMode) toggleSelection(lb.id);
                          else openLorebookDetail(lb.id);
                        }}
                        onDelete={async () => {
                          if (
                            await showConfirmDialog({
                              title: "Delete Lorebook",
                              message: `Delete "${lb.name}"? All entries will be lost.`,
                              confirmLabel: "Delete",
                              tone: "destructive",
                            })
                          ) {
                            deleteLorebook.mutate(lb.id);
                          }
                        }}
                        selectionMode={selectionMode}
                        isSelected={selectedLorebookIds.has(lb.id)}
                        onToggleSelect={() => toggleSelection(lb.id)}
                      />
                    ))}
                  </div>
                );
              })
            : // Flat view
              sorted.map((lb: Lorebook) => (
                <LorebookRow
                  key={lb.id}
                  lorebook={lb}
                  characterName={lb.characterId ? characterNameById.get(lb.characterId) : undefined}
                  onClick={() => {
                    if (selectionMode) toggleSelection(lb.id);
                    else openLorebookDetail(lb.id);
                  }}
                  onDelete={async () => {
                    if (
                      await showConfirmDialog({
                        title: "Delete Lorebook",
                        message: `Delete "${lb.name}"? All entries will be lost.`,
                        confirmLabel: "Delete",
                        tone: "destructive",
                      })
                    ) {
                      deleteLorebook.mutate(lb.id);
                    }
                  }}
                  selectionMode={selectionMode}
                  isSelected={selectedLorebookIds.has(lb.id)}
                  onToggleSelect={() => toggleSelection(lb.id)}
                />
              ))}
        </div>
      )}
    </div>
  );
}

function LorebookRow({
  lorebook,
  characterName,
  onClick,
  onDelete,
  selectionMode,
  isSelected,
  onToggleSelect,
}: {
  lorebook: Lorebook;
  characterName?: string;
  onClick: () => void;
  onDelete: () => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const gradient = CATEGORY_COLORS[lorebook.category] ?? CATEGORY_COLORS.uncategorized;
  const CatIcon = CATEGORIES.find((c) => c.id === lorebook.category)?.icon ?? BookOpen;

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-all hover:bg-[var(--sidebar-accent)]",
        selectionMode && isSelected && "ring-1 ring-amber-400/40 bg-amber-400/10",
      )}
      onClick={onClick}
    >
      {selectionMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
            isSelected
              ? "border-amber-400 bg-amber-400 text-white"
              : "border-[var(--muted-foreground)]/40 bg-[var(--secondary)] text-transparent",
          )}
          aria-label={isSelected ? "Deselect lorebook" : "Select lorebook"}
        >
          <span className="text-[0.75rem]">✓</span>
        </button>
      )}
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm",
          gradient,
        )}
      >
        <CatIcon size="1rem" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{lorebook.name}</span>
          {!lorebook.enabled && (
            <span className="rounded bg-[var(--muted)]/50 px-1 py-0.5 text-[0.5625rem] text-[var(--muted-foreground)]">
              OFF
            </span>
          )}
        </div>
        <div className="truncate text-[0.6875rem] text-[var(--muted-foreground)]">
          {characterName ? (
            <span className="inline-flex items-center gap-1">
              <UserRound size="0.625rem" className="shrink-0" />
              {characterName}
              {lorebook.description ? ` · ${lorebook.description}` : ""}
            </span>
          ) : (
            lorebook.description || "No description"
          )}
        </div>
      </div>
      {!selectionMode && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--sidebar)] px-1 py-0.5 opacity-0 shadow-sm ring-1 ring-[var(--border)] transition-opacity group-hover:opacity-100 max-md:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded-lg p-1.5 transition-all hover:bg-[var(--destructive)]/15 active:scale-90"
            title="Delete"
          >
            <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
          </button>
        </div>
      )}
    </div>
  );
}
