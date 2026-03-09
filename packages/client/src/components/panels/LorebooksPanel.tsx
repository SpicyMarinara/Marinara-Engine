// ──────────────────────────────────────────────
// Panel: Lorebooks (overhauled)
// Category tabs, search, click-to-edit, AI generate
// ──────────────────────────────────────────────
import { useState, useMemo } from "react";
import {
  Plus,
  Upload,
  Sparkles,
  BookOpen,
  Search,
  Globe,
  Users,
  UserRound,
  ScrollText,
  Layers,
  ArrowUpDown,
} from "lucide-react";
import { useUIStore } from "../../stores/ui.store";
import { useLorebooks, useDeleteLorebook } from "../../hooks/use-lorebooks";
import type { Lorebook, LorebookCategory } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";

const CATEGORIES: Array<{ id: LorebookCategory | "all"; label: string; icon: typeof Globe }> = [
  { id: "all", label: "All", icon: Layers },
  { id: "world", label: "World", icon: Globe },
  { id: "character", label: "Character", icon: Users },
  { id: "npc", label: "NPC", icon: UserRound },
  { id: "summary", label: "Summary", icon: ScrollText },
  { id: "uncategorized", label: "Other", icon: BookOpen },
];

const CATEGORY_COLORS: Record<string, string> = {
  world: "from-emerald-400 to-teal-500",
  character: "from-violet-400 to-purple-500",
  npc: "from-rose-400 to-pink-500",
  summary: "from-sky-400 to-blue-500",
  uncategorized: "from-amber-400 to-orange-500",
  all: "from-amber-400 to-orange-500",
};

export function LorebooksPanel() {
  const [activeCategory, setActiveCategory] = useState<LorebookCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<"name-asc" | "name-desc" | "newest" | "oldest" | "tokens">("name-asc");

  const { data: lorebooks, isLoading } = useLorebooks(activeCategory === "all" ? undefined : activeCategory);
  const deleteLorebook = useDeleteLorebook();
  const openModal = useUIStore((s) => s.openModal);
  const openLorebookDetail = useUIStore((s) => s.openLorebookDetail);

  // Filter by search
  const filtered = useMemo(() => {
    if (!lorebooks) return [];
    if (!searchQuery) return lorebooks;
    const q = searchQuery.toLowerCase();
    return lorebooks.filter(
      (lb: Lorebook) => lb.name.toLowerCase().includes(q) || lb.description.toLowerCase().includes(q),
    );
  }, [lorebooks, searchQuery]);

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
  }, [filtered, activeCategory]);

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => openModal("create-lorebook")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-3 py-2.5 text-xs font-medium text-white shadow-md shadow-amber-400/15 transition-all hover:shadow-lg hover:shadow-amber-400/25 active:scale-[0.98]"
        >
          <Plus size={13} /> New
        </button>
        <button
          onClick={() => openModal("import-lorebook")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
        >
          <Upload size={13} /> Import
        </button>
        <button
          onClick={() => openModal("lorebook-maker")}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
          title="AI Generate"
        >
          <Sparkles size={13} />
        </button>
      </div>

      {/* Search + Sort */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            type="text"
            placeholder="Search lorebooks\u2026"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl bg-[var(--secondary)] py-2 pl-8 pr-3 text-xs text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </div>
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="h-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--secondary)] py-2 pl-2.5 pr-7 text-[11px] outline-none transition-colors focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            title="Sort order"
          >
            <option value="name-asc">A-Z</option>
            <option value="name-desc">Z-A</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="tokens">Token Budget</option>
          </select>
          <ArrowUpDown
            size={10}
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
                "flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all",
                isActive
                  ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
              )}
            >
              <Icon size={12} />
              {cat.label}
            </button>
          );
        })}
      </div>

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
            <BookOpen size={20} className="text-amber-400" />
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
                    <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      <CatIcon size={11} />
                      {catMeta.label}
                      <span className="ml-auto text-[10px] font-normal">{books.length}</span>
                    </div>
                    {books.map((lb) => (
                      <LorebookRow
                        key={lb.id}
                        lorebook={lb}
                        onClick={() => openLorebookDetail(lb.id)}
                        onDelete={() => deleteLorebook.mutate(lb.id)}
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
                  onClick={() => openLorebookDetail(lb.id)}
                  onDelete={() => deleteLorebook.mutate(lb.id)}
                />
              ))}
        </div>
      )}
    </div>
  );
}

function LorebookRow({
  lorebook,
  onClick,
  onDelete,
}: {
  lorebook: Lorebook;
  onClick: () => void;
  onDelete: () => void;
}) {
  const gradient = CATEGORY_COLORS[lorebook.category] ?? CATEGORY_COLORS.uncategorized;
  const CatIcon = CATEGORIES.find((c) => c.id === lorebook.category)?.icon ?? BookOpen;

  return (
    <div
      className="group flex cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-all hover:bg-[var(--sidebar-accent)]"
      onClick={onClick}
    >
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm",
          gradient,
        )}
      >
        <CatIcon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{lorebook.name}</span>
          {!lorebook.enabled && (
            <span className="rounded bg-[var(--muted)]/50 px-1 py-0.5 text-[9px] text-[var(--muted-foreground)]">
              OFF
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-[var(--muted-foreground)]">
          {lorebook.description || "No description"}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="rounded-lg p-1.5 opacity-0 transition-all hover:bg-[var(--destructive)]/15 group-hover:opacity-100 active:scale-90"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[var(--destructive)]"
        >
          <path d="M3 6h18" />
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
}
