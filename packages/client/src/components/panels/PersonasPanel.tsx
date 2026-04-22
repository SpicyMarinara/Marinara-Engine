// ──────────────────────────────────────────────
// Panel: User Personas
// ──────────────────────────────────────────────
import { useState, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  usePersonas,
  useDeletePersona,
  useActivatePersona,
  useUploadPersonaAvatar,
  usePersonaGroups,
  useCreatePersonaGroup,
  useUpdatePersonaGroup,
  useDeletePersonaGroup,
  useUpdatePersona,
  useDuplicatePersona,
} from "../../hooks/use-characters";
import { useUIStore } from "../../stores/ui.store";
import {
  Plus,
  Trash2,
  User,
  Pencil,
  Camera,
  Star,
  ArrowUpDown,
  Download,
  Search,
  Sparkles,
  FolderPlus,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Copy,
  Users,
  X,
  Check,
  UserPlus,
  UserMinus,
  Tag,
} from "lucide-react";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";
import { api } from "../../lib/api-client";

type PersonaRow = {
  id: string;
  name: string;
  comment?: string;
  description: string;
  personality: string;
  scenario: string;
  backstory: string;
  appearance: string;
  avatarPath: string | null;
  isActive: string | boolean;
  createdAt: string;
  tags?: string;
};

type PersonaGroupRow = { id: string; name: string; description: string; personaIds: string };

type SortOption = "name-asc" | "name-desc" | "newest" | "oldest" | "tokens";

function estimateTokens(p: PersonaRow): number {
  const text = [p.description, p.personality, p.scenario, p.backstory, p.appearance].join("");
  return Math.ceil(text.length / 4);
}

export function PersonasPanel() {
  const { data: personas, isLoading } = usePersonas();
  const deletePersona = useDeletePersona();
  const duplicatePersona = useDuplicatePersona();
  const updatePersona = useUpdatePersona();
  const activatePersona = useActivatePersona();
  const uploadAvatar = useUploadPersonaAvatar();
  const { data: personaGroupsRaw } = usePersonaGroups();
  const createPGroup = useCreatePersonaGroup();
  const updatePGroup = useUpdatePersonaGroup();
  const deletePGroup = useDeletePersonaGroup();
  const openPersonaDetail = useUIStore((s) => s.openPersonaDetail);
  const openModal = useUIStore((s) => s.openModal);

  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarTargetId, setAvatarTargetId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("name-asc");
  const [search, setSearch] = useState("");
  const [favFilter, setFavFilter] = useState<"all" | "active" | "inactive">("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<Set<string>>(new Set());
  const [exportingSelected, setExportingSelected] = useState(false);

  // Groups state
  const [groupsExpanded, setGroupsExpanded] = useState(true);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [assigningToGroup, setAssigningToGroup] = useState<string | null>(null);

  const isActive = (p: PersonaRow) => p.isActive === true || p.isActive === "true";

  const handleCreate = () => {
    openModal("create-persona");
  };

  const handleAvatarClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setAvatarTargetId(id);
    fileRef.current?.click();
  };

  const handleAvatarUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !avatarTargetId) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        uploadAvatar.mutate({
          id: avatarTargetId,
          avatar: dataUrl,
          filename: `persona-${avatarTargetId}-${Date.now()}.${file.name.split(".").pop()}`,
        });
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [avatarTargetId, uploadAvatar],
  );

  const rawList = useMemo(() => (personas as PersonaRow[] | undefined) ?? [], [personas]);

  const parseTags = (p: PersonaRow): string[] => {
    try {
      return p.tags ? JSON.parse(p.tags) : [];
    } catch {
      return [];
    }
  };

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const p of rawList) {
      for (const t of parseTags(p)) tagSet.add(t);
    }
    return [...tagSet].sort((a, b) => a.localeCompare(b));
  }, [rawList]);

  const handleDeleteTag = useCallback(
    async (tag: string) => {
      if (
        !(await showConfirmDialog({
          title: "Remove Tag",
          message: `Remove tag "${tag}" from all personas?`,
          confirmLabel: "Remove",
          tone: "destructive",
        }))
      ) {
        return;
      }
      try {
        const affected = rawList.filter((p) => parseTags(p).includes(tag));
        for (const p of affected) {
          const newTags = parseTags(p).filter((t) => t !== tag);
          await updatePersona.mutateAsync({ id: p.id, tags: JSON.stringify(newTags) });
        }
        if (activeTag === tag) setActiveTag(null);
      } catch {
        toast.error("Failed to remove tag from some personas");
      }
    },
    [rawList, updatePersona, activeTag],
  );

  const personaMap = useMemo(() => {
    const map = new Map<string, PersonaRow>();
    for (const p of rawList) map.set(p.id, p);
    return map;
  }, [rawList]);

  const parsedGroups = useMemo(() => {
    if (!personaGroupsRaw) return [];
    return (personaGroupsRaw as PersonaGroupRow[]).map((g) => ({
      ...g,
      memberIds: (() => {
        try {
          return JSON.parse(g.personaIds);
        } catch {
          return [];
        }
      })() as string[],
    }));
  }, [personaGroupsRaw]);

  const handleCreateGroup = useCallback(() => {
    const name = newGroupName.trim();
    if (!name) return;
    createPGroup.mutate({ name, personaIds: [] });
    setNewGroupName("");
    setCreatingGroup(false);
  }, [newGroupName, createPGroup]);

  const handleRenameGroup = useCallback(
    (groupId: string) => {
      const name = editGroupName.trim();
      if (!name) return;
      updatePGroup.mutate({ id: groupId, name });
      setEditingGroupId(null);
      setEditGroupName("");
    },
    [editGroupName, updatePGroup],
  );

  const toggleGroupMember = useCallback(
    (groupId: string, personaId: string, currentMembers: string[]) => {
      const isMember = currentMembers.includes(personaId);
      const newMembers = isMember ? currentMembers.filter((id) => id !== personaId) : [...currentMembers, personaId];
      updatePGroup.mutate({ id: groupId, personaIds: newMembers });
    },
    [updatePGroup],
  );

  const filteredList = useMemo(() => {
    let arr = rawList;
    // Filter by active status
    if (favFilter === "active") {
      arr = arr.filter((p) => p.isActive === true || p.isActive === "true");
    } else if (favFilter === "inactive") {
      arr = arr.filter((p) => p.isActive !== true && p.isActive !== "true");
    }
    // Filter by search text
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q) ||
          (p.comment ?? "").toLowerCase().includes(q) ||
          parseTags(p).some((t) => t.toLowerCase().includes(q)),
      );
    }
    // Filter by active tag
    if (activeTag) {
      arr = arr.filter((p) => parseTags(p).includes(activeTag));
    }
    return arr;
  }, [rawList, favFilter, search, activeTag]);

  const list = useMemo(() => {
    const arr = [...filteredList];
    switch (sort) {
      case "name-asc":
        return arr.sort((a, b) => a.name.localeCompare(b.name));
      case "name-desc":
        return arr.sort((a, b) => b.name.localeCompare(a.name));
      case "newest":
        return arr.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      case "oldest":
        return arr.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      case "tokens":
        return arr.sort((a, b) => estimateTokens(b) - estimateTokens(a));
      default:
        return arr;
    }
  }, [filteredList, sort]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedPersonaIds(new Set());
  }, []);

  const toggleSelection = useCallback((personaId: string) => {
    setSelectedPersonaIds((prev) => {
      const next = new Set(prev);
      if (next.has(personaId)) next.delete(personaId);
      else next.add(personaId);
      return next;
    });
  }, []);

  const handleExportSelected = useCallback(async () => {
    if (selectedPersonaIds.size === 0) return;
    setExportingSelected(true);
    try {
      await api.downloadPost(
        "/characters/personas/export-bulk",
        { ids: [...selectedPersonaIds] },
        "marinara-personas.zip",
      );
      toast.success(`Exported ${selectedPersonaIds.size} persona${selectedPersonaIds.size === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export personas");
    } finally {
      setExportingSelected(false);
    }
  }, [selectedPersonaIds]);

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Header help */}
      <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        Your personas
        <HelpTooltip text="Personas are your different identities. The active persona determines how the AI refers to you and sees your description, personality, backstory, and appearance. Great for switching between different player characters!" />
      </div>

      {/* Search + Sort */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search
            size="0.8125rem"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search personas"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--secondary)] py-2 pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-[var(--muted-foreground)]/50 focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
          />
        </div>
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="h-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--secondary)] py-2 pl-2.5 pr-7 text-[0.6875rem] outline-none transition-colors focus:border-[var(--primary)]/40 focus:ring-1 focus:ring-[var(--primary)]/20"
            title="Sort order"
          >
            <option value="name-asc">A-Z</option>
            <option value="name-desc">Z-A</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="tokens">Tokens</option>
          </select>
          <ArrowUpDown
            size="0.625rem"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
        </div>
      </div>

      {/* Active / Inactive filter */}
      <div className="flex gap-1">
        {(["all", "active", "inactive"] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setFavFilter(opt)}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2 py-1 text-[0.625rem] font-medium transition-all",
              favFilter === opt
                ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
                : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
            )}
          >
            {opt === "active" && <Star size="0.5625rem" />}
            {opt === "all" ? "All" : opt === "active" ? "Active" : "Inactive"}
          </button>
        ))}
      </div>

      {/* Tag filter bar */}
      {allTags.length > 0 && (
        <div className="space-y-1">
          <button
            onClick={() => setTagsExpanded(!tagsExpanded)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.625rem] font-medium transition-all",
              activeTag
                ? "bg-emerald-400/15 text-emerald-400"
                : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
            )}
          >
            <Tag size="0.625rem" />
            Tags ({allTags.length}){activeTag && <span className="ml-0.5 opacity-70">· {activeTag}</span>}
            <ChevronDown size="0.625rem" className={cn("transition-transform", tagsExpanded && "rotate-180")} />
          </button>
          {tagsExpanded && (
            <div className="flex flex-wrap gap-1">
              {activeTag && (
                <button
                  onClick={() => setActiveTag(null)}
                  className="flex items-center gap-1 rounded-full bg-[var(--destructive)]/10 px-2 py-0.5 text-[0.625rem] font-medium text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/20"
                >
                  <X size="0.5rem" /> Clear
                </button>
              )}
              {allTags.map((tag) => (
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
                    "group/tag flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.625rem] font-medium transition-all cursor-pointer",
                    activeTag === tag
                      ? "bg-emerald-400/20 text-emerald-400 ring-1 ring-emerald-400/30"
                      : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                  )}
                >
                  <Tag size="0.5rem" />
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
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 px-3 py-2.5 text-xs font-medium text-white shadow-md shadow-emerald-400/15 transition-all hover:shadow-lg hover:shadow-emerald-400/25 active:scale-[0.98]"
          title="New"
        >
          <Plus size="0.8125rem" />
          <span className="md:hidden">New</span>
        </button>
        <button
          onClick={() => openModal("import-persona")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
          title="Import"
        >
          <Download size="0.8125rem" /> <span className="md:hidden">Import</span>
        </button>
        <button
          onClick={() => openModal("persona-maker")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
          title="AI Maker"
        >
          <Sparkles size="0.8125rem" /> <span className="md:hidden">Maker</span>
        </button>
        <button
          onClick={() => {
            if (selectionMode) exitSelectionMode();
            else {
              setAssigningToGroup(null);
              setSelectionMode(true);
            }
          }}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all",
            selectionMode
              ? "bg-emerald-400/15 text-emerald-400 ring-1 ring-emerald-400/30"
              : "bg-[var(--secondary)] text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
          )}
          title="Select"
        >
          <Check size="0.8125rem" />
          <span className="md:hidden">Select</span>
        </button>
      </div>

      {selectionMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/60 px-3 py-2">
          <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
            {selectedPersonaIds.size} selected
          </span>
          <button
            onClick={() => setSelectedPersonaIds(new Set(list.map((persona) => persona.id)))}
            disabled={list.length === 0}
            className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-emerald-400 transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
          >
            Select visible
          </button>
          <button
            onClick={() => setSelectedPersonaIds(new Set())}
            disabled={selectedPersonaIds.size === 0}
            className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
          >
            Clear
          </button>
          <button
            onClick={handleExportSelected}
            disabled={selectedPersonaIds.size === 0 || exportingSelected}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[0.625rem] font-medium text-white transition-all hover:opacity-90 disabled:opacity-40"
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

      {/* Hidden file input for avatar uploads */}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />

      {/* ── Groups Section ── */}
      <div className="mt-1">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setGroupsExpanded(!groupsExpanded)}
            className="flex items-center gap-1.5 px-1 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]"
          >
            {groupsExpanded ? <ChevronDown size="0.75rem" /> : <ChevronRight size="0.75rem" />}
            <Users size="0.6875rem" />
            Groups ({parsedGroups.length})
          </button>
          <button
            onClick={() => {
              setCreatingGroup(true);
              setGroupsExpanded(true);
            }}
            className="rounded-lg p-1 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--primary)]"
            title="Create group"
          >
            <FolderPlus size="0.8125rem" />
          </button>
        </div>

        {groupsExpanded && (
          <div className="flex flex-col gap-1 pt-1">
            {/* Inline create */}
            {creatingGroup && (
              <div className="flex items-center gap-1.5 rounded-xl bg-[var(--secondary)] p-2 ring-1 ring-[var(--border)]">
                <FolderOpen size="0.8125rem" className="shrink-0 text-[var(--muted-foreground)]" />
                <input
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateGroup();
                    if (e.key === "Escape") {
                      setCreatingGroup(false);
                      setNewGroupName("");
                    }
                  }}
                  placeholder="Group name…"
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]/50"
                />
                <button onClick={handleCreateGroup} className="rounded p-0.5 text-emerald-400 hover:bg-emerald-400/10">
                  <Plus size="0.75rem" />
                </button>
                <button
                  onClick={() => {
                    setCreatingGroup(false);
                    setNewGroupName("");
                  }}
                  className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                >
                  <X size="0.75rem" />
                </button>
              </div>
            )}

            {/* Group rows */}
            {parsedGroups.map((group) => {
              const isExpanded = expandedGroupId === group.id;
              return (
                <div key={group.id} className="rounded-xl bg-[var(--secondary)]/60 ring-1 ring-[var(--border)]/50">
                  {/* Group header */}
                  <div className="flex items-center gap-1.5 px-2.5 py-2">
                    <button
                      onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                      className="shrink-0 text-[var(--muted-foreground)]"
                    >
                      {isExpanded ? <ChevronDown size="0.75rem" /> : <ChevronRight size="0.75rem" />}
                    </button>

                    {editingGroupId === group.id ? (
                      <input
                        autoFocus
                        value={editGroupName}
                        onChange={(e) => setEditGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameGroup(group.id);
                          if (e.key === "Escape") {
                            setEditingGroupId(null);
                            setEditGroupName("");
                          }
                        }}
                        onBlur={() => handleRenameGroup(group.id)}
                        className="min-w-0 flex-1 bg-transparent text-xs font-medium outline-none"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {group.name} <span className="text-[var(--muted-foreground)]">({group.memberIds.length})</span>
                      </span>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => {
                          if (assigningToGroup !== group.id) exitSelectionMode();
                          setAssigningToGroup(assigningToGroup === group.id ? null : group.id);
                        }}
                        className={cn(
                          "rounded-lg p-1 transition-colors",
                          assigningToGroup === group.id
                            ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                            : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                        )}
                        title="Assign personas"
                      >
                        <UserPlus size="0.75rem" />
                      </button>
                      <button
                        onClick={() => {
                          setEditingGroupId(group.id);
                          setEditGroupName(group.name);
                        }}
                        className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                        title="Rename"
                      >
                        <Pencil size="0.75rem" />
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            !(await showConfirmDialog({
                              title: "Delete Group",
                              message: `Delete group "${group.name}"?`,
                              confirmLabel: "Delete",
                              tone: "destructive",
                            }))
                          ) {
                            return;
                          }
                          deletePGroup.mutate(group.id);
                          if (expandedGroupId === group.id) setExpandedGroupId(null);
                          if (assigningToGroup === group.id) setAssigningToGroup(null);
                        }}
                        className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
                        title="Delete group"
                      >
                        <Trash2 size="0.75rem" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded member list */}
                  {isExpanded && (
                    <div className="border-t border-[var(--border)]/50 px-2.5 py-1.5">
                      {group.memberIds.length === 0 ? (
                        <p className="py-1 text-[0.625rem] italic text-[var(--muted-foreground)]">
                          No members — use <UserPlus size="0.5rem" className="inline" /> to assign personas
                        </p>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {group.memberIds.map((pid) => {
                            const p = personaMap.get(pid);
                            if (!p) return null;
                            return (
                              <div key={pid} className="flex items-center gap-2 rounded-lg px-1 py-1 text-xs">
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
                                  {p.avatarPath ? (
                                    <img src={p.avatarPath} alt="" className="h-full w-full rounded-lg object-cover" />
                                  ) : (
                                    <User size="0.625rem" />
                                  )}
                                </div>
                                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                <button
                                  onClick={() => toggleGroupMember(group.id, pid, group.memberIds)}
                                  className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
                                  title="Remove from group"
                                >
                                  <UserMinus size="0.625rem" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {parsedGroups.length === 0 && !creatingGroup && (
              <p className="px-1 py-1 text-[0.625rem] italic text-[var(--muted-foreground)]">No groups yet</p>
            )}
          </div>
        )}
      </div>

      {/* Assign-to-group banner */}
      {assigningToGroup && (
        <div className="flex items-center gap-2 rounded-xl bg-[var(--primary)]/10 px-3 py-2 text-xs ring-1 ring-[var(--primary)]/30">
          <Users size="0.8125rem" className="text-[var(--primary)]" />
          <span className="flex-1">
            Click personas to add/remove from{" "}
            <strong>{parsedGroups.find((g) => g.id === assigningToGroup)?.name}</strong>
          </span>
          <button onClick={() => setAssigningToGroup(null)} className="rounded p-0.5 hover:bg-[var(--accent)]">
            <X size="0.8125rem" />
          </button>
        </div>
      )}

      {isLoading && (
        <div className="flex flex-col gap-2 py-2">
          {[1, 2].map((i) => (
            <div key={i} className="shimmer h-16 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && list.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="animate-float flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/20 to-teal-500/20">
            <User size="1.25rem" className="text-emerald-400" />
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">No personas yet — create one!</p>
        </div>
      )}

      <div className="stagger-children flex flex-col gap-1">
        {list.map((persona) => {
          const active = isActive(persona);
          const isBulkSelected = selectedPersonaIds.has(persona.id);
          const targetGroup = assigningToGroup ? parsedGroups.find((g) => g.id === assigningToGroup) : null;
          const isInTargetGroup = targetGroup ? targetGroup.memberIds.includes(persona.id) : false;

          return (
            <div
              key={persona.id}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl p-2.5 transition-all hover:bg-[var(--sidebar-accent)] cursor-pointer",
                selectionMode && isBulkSelected && "ring-1 ring-emerald-400/40 bg-emerald-400/8",
                active && "ring-1 ring-emerald-400/40 bg-emerald-400/5",
                assigningToGroup && isInTargetGroup && "ring-1 ring-violet-500/50 bg-violet-500/10",
                assigningToGroup && !isInTargetGroup && "opacity-60 hover:opacity-100",
              )}
              onClick={() => {
                if (selectionMode) {
                  toggleSelection(persona.id);
                } else if (assigningToGroup && targetGroup) {
                  toggleGroupMember(assigningToGroup, persona.id, targetGroup.memberIds);
                } else {
                  openPersonaDetail(persona.id);
                }
              }}
            >
              {selectionMode && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelection(persona.id);
                  }}
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
                    isBulkSelected
                      ? "border-emerald-400 bg-emerald-400 text-white"
                      : "border-[var(--muted-foreground)]/40 bg-[var(--secondary)] text-transparent",
                  )}
                  aria-label={isBulkSelected ? "Deselect persona" : "Select persona"}
                >
                  <Check size="0.75rem" />
                </button>
              )}
              {/* Avatar */}
              <button
                onClick={(e) => handleAvatarClick(e, persona.id)}
                className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm group/avatar"
                title="Change avatar"
              >
                {persona.avatarPath ? (
                  <img
                    src={persona.avatarPath}
                    alt=""
                    loading="lazy"
                    className="h-full w-full rounded-xl object-cover"
                  />
                ) : (
                  <User size="1rem" />
                )}
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 opacity-0 transition-opacity group-hover/avatar:opacity-100">
                  <Camera size="0.75rem" className="text-white" />
                </div>
                {active && (
                  <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400 shadow-sm">
                    <Star size="0.5rem" className="text-white" />
                  </div>
                )}
              </button>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{persona.name}</div>
                {persona.comment && (
                  <div className="truncate text-[0.625rem] italic text-[var(--muted-foreground)]">
                    {persona.comment}
                  </div>
                )}
                <div className="truncate text-[0.6875rem] text-[var(--muted-foreground)]">
                  {assigningToGroup
                    ? isInTargetGroup
                      ? "In group — click to remove"
                      : "Click to add to group"
                    : persona.description || "No description"}
                </div>
              </div>

              {/* Actions */}
              {!selectionMode && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--sidebar)] px-1 py-0.5 opacity-0 shadow-sm ring-1 ring-[var(--border)] transition-opacity group-hover:opacity-100 max-md:opacity-100">
                  {!active && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        activatePersona.mutate(persona.id);
                      }}
                      className="rounded-lg p-1.5 text-emerald-400 transition-all active:scale-90 hover:bg-emerald-400/10"
                      title="Set as active"
                    >
                      <Star size="0.75rem" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicatePersona.mutate(persona.id, {
                        onSuccess: () => {
                          toast.success(`Duplicated "${persona.name}"`);
                        },
                      });
                    }}
                    className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all active:scale-90 hover:bg-sky-400/10 hover:text-sky-400"
                    title="Duplicate"
                  >
                    <Copy size="0.75rem" />
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (
                        !(await showConfirmDialog({
                          title: "Delete Persona",
                          message: `Delete "${persona.name}"? This cannot be undone.`,
                          confirmLabel: "Delete",
                          tone: "destructive",
                        }))
                      ) {
                        return;
                      }
                      deletePersona.mutate(persona.id);
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
        })}
      </div>
    </div>
  );
}
