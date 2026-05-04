// ──────────────────────────────────────────────
// Panel: Characters (overhauled — search, groups, avatars)
// ──────────────────────────────────────────────
import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import {
  useCharacters,
  useDeleteCharacter,
  useCharacterGroups,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
  useUpdateCharacter,
  useDuplicateCharacter,
} from "../../hooks/use-characters";
import { useUpdateChat, useCreateMessage, useCreateChat, chatKeys } from "../../hooks/use-chats";
import { useChatPresets, useApplyChatPreset } from "../../hooks/use-chat-presets";
import { api } from "../../lib/api-client";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { useChatStore } from "../../stores/chat.store";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Download,
  User,
  Check,
  Search,
  Sparkles,
  FolderPlus,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Copy,
  Users,
  X,
  UserPlus,
  UserMinus,
  ArrowUpDown,
  Pencil,
  Tag,
  MessageCircle,
  Star,
  Wand2,
} from "lucide-react";
import { getCharacterTitle } from "../../lib/character-display";
import { useUIStore } from "../../stores/ui.store";
import { cn, getAvatarCropStyle } from "../../lib/utils";

type CharacterRow = {
  id: string;
  data: string;
  comment?: string | null;
  avatarPath: string | null;
  createdAt: string;
  updatedAt: string;
};
type GroupRow = { id: string; name: string; description: string; characterIds: string; avatarPath: string | null };
type ParsedCharacterRow = CharacterRow & { parsed: Record<string, any> };

type SortOption = "name-asc" | "name-desc" | "newest" | "oldest" | "favorites";

function getCharacterPreviewMetadata(char: ParsedCharacterRow): string | null {
  const parts: string[] = [];
  const creator = typeof char.parsed.creator === "string" ? char.parsed.creator.trim() : "";
  const version = typeof char.parsed.character_version === "string" ? char.parsed.character_version.trim() : "";
  const importMetadata =
    char.parsed.extensions?.importMetadata && typeof char.parsed.extensions.importMetadata === "object"
      ? (char.parsed.extensions.importMetadata as Record<string, unknown>)
      : {};
  const cardMetadata =
    importMetadata.card && typeof importMetadata.card === "object"
      ? (importMetadata.card as Record<string, unknown>)
      : {};
  const spec = typeof cardMetadata.spec === "string" ? cardMetadata.spec.trim() : "";
  const specVersion = typeof cardMetadata.specVersion === "string" ? cardMetadata.specVersion.trim() : "";
  const tags = Array.isArray(char.parsed.tags) ? (char.parsed.tags as string[]).filter(Boolean) : [];

  if (creator) parts.push(`by ${creator}`);
  if (version) parts.push(`v${version}`);
  if (spec) parts.push(spec);
  if (specVersion) parts.push(`spec ${specVersion}`);
  if (parts.length > 0) return parts.join(" · ");
  if (tags.length > 0) return tags.slice(0, 3).join(" · ");
  return null;
}

export function CharactersPanel() {
  const { data: characters, isLoading } = useCharacters();
  const { data: groups } = useCharacterGroups();
  const deleteCharacter = useDeleteCharacter();
  const duplicateCharacter = useDuplicateCharacter();
  const updateCharacter = useUpdateCharacter();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const openModal = useUIStore((s) => s.openModal);
  const openCharacterDetail = useUIStore((s) => s.openCharacterDetail);
  const openCharacterLibrary = useUIStore((s) => s.openCharacterLibrary);
  const activeChat = useChatStore((s) => s.activeChat);
  const updateChat = useUpdateChat();
  const createMessage = useCreateMessage(activeChat?.id ?? null);
  const createChat = useCreateChat();
  const queryClient = useQueryClient();
  const { data: chatPresetsData } = useChatPresets();
  const applyChatPreset = useApplyChatPreset();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    charId: string;
    charName: string;
    firstMes?: string;
    altGreetings?: string[];
  } | null>(null);

  const quickStartFromCharacter = useCallback(
    (
      charId: string,
      charName: string,
      mode: "roleplay" | "conversation",
      firstMes?: string,
      altGreetings?: string[],
    ) => {
      const label = mode === "conversation" ? "Conversation" : "Roleplay";
      // Resolve the user's starred default preset for this mode (skip the built-in Default — it's a no-op).
      const presets = chatPresetsData ?? [];
      const presetMode = mode === "conversation" ? "conversation" : "roleplay";
      const starred = presets.find((p) => p.mode === presetMode && p.isActive && !p.isDefault);
      createChat.mutate(
        { name: charName ? `${charName} — ${label}` : `New ${label}`, mode, characterIds: [charId] },
        {
          onSuccess: async (chat) => {
            useChatStore.getState().setActiveChatId(chat.id);
            // Apply the user's starred default preset to the new chat so its
            // settings start where they want them.
            if (starred) {
              try {
                await applyChatPreset.mutateAsync({ presetId: starred.id, chatId: chat.id });
              } catch {
                /* non-fatal — chat still opens with system defaults */
              }
            }
            // Mirror the wizard's roleplay first-message behavior — without this,
            // a quick-started roleplay would open with no greeting from the character.
            if (mode === "roleplay" && firstMes?.trim()) {
              try {
                const msg = await api.post<{ id: string }>(`/chats/${chat.id}/messages`, {
                  role: "assistant",
                  content: firstMes,
                  characterId: charId,
                });
                if (msg?.id && altGreetings?.length) {
                  for (const greeting of altGreetings) {
                    if (greeting.trim()) {
                      await api.post(`/chats/${chat.id}/messages/${msg.id}/swipes`, {
                        content: greeting,
                        silent: true,
                      });
                    }
                  }
                }
                queryClient.invalidateQueries({ queryKey: chatKeys.messages(chat.id) });
              } catch {
                /* swallow — don't block the chat from opening if greeting injection fails */
              }
            }
            useChatStore.getState().setShouldOpenSettings(true);
            useChatStore.getState().setShouldOpenWizard(true);
            useChatStore.getState().setShouldOpenWizardInShortcutMode(true);
          },
        },
      );
    },
    [createChat, queryClient, chatPresetsData, applyChatPreset],
  );

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("name-asc");
  const [groupsExpanded, setGroupsExpanded] = useState(true);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  // When non-null, clicking a character adds/removes it from this group
  const [assigningToGroup, setAssigningToGroup] = useState<string | null>(null);
  const [firstMesConfirm, setFirstMesConfirm] = useState<{
    charId: string;
    charName: string;
    message: string;
    alternateGreetings: string[];
  } | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [favFilter, setFavFilter] = useState<"all" | "favorites" | "non-favorites">("all");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set());
  const [exportingSelected, setExportingSelected] = useState(false);

  const chatCharacterIds: string[] = activeChat
    ? ((typeof activeChat.characterIds === "string" ? JSON.parse(activeChat.characterIds) : activeChat.characterIds) ??
      [])
    : [];

  const isConversation = (activeChat as unknown as { mode?: string })?.mode === "conversation";

  // Parse character data and filter by search
  const parsedCharacters = useMemo(() => {
    if (!characters) return [];
    return (characters as CharacterRow[]).map((char) => {
      try {
        const parsed = typeof char.data === "string" ? JSON.parse(char.data) : char.data;
        return { ...char, parsed };
      } catch {
        return { ...char, parsed: { name: "Unknown", description: "" } };
      }
    });
  }, [characters]) as ParsedCharacterRow[];

  const charMap = useMemo(() => {
    const map = new Map<string, { name: string; comment?: string | null; avatarPath: string | null }>();
    for (const c of parsedCharacters) {
      map.set(c.id, { name: c.parsed.name ?? "Unknown", comment: c.comment, avatarPath: c.avatarPath });
    }
    return map;
  }, [parsedCharacters]);

  const filteredCharacters = useMemo(() => {
    let list = parsedCharacters;
    // Filter by favorites
    if (favFilter === "favorites") {
      list = list.filter((c) => c.parsed.extensions?.fav);
    } else if (favFilter === "non-favorites") {
      list = list.filter((c) => !c.parsed.extensions?.fav);
    }
    // Filter by active tag
    if (activeTag) {
      list = list.filter((c) => (c.parsed.tags ?? []).some((t: string) => t === activeTag));
    }
    // Filter by search text
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          (c.parsed.name ?? "").toLowerCase().includes(q) ||
          (typeof c.comment === "string" && c.comment.toLowerCase().includes(q)) ||
          (c.parsed.description ?? "").toLowerCase().includes(q) ||
          (c.parsed.tags ?? []).some((t: string) => t.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [parsedCharacters, search, activeTag, favFilter]);

  // Collect all unique tags across characters for the filter bar
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const c of parsedCharacters) {
      for (const t of (c.parsed.tags ?? []) as string[]) {
        tagSet.add(t);
      }
    }
    return [...tagSet].sort((a, b) => a.localeCompare(b));
  }, [parsedCharacters]);

  const handleDeleteTag = useCallback(
    async (tag: string) => {
      if (
        !(await showConfirmDialog({
          title: "Remove Tag",
          message: `Remove tag "${tag}" from all characters?`,
          confirmLabel: "Remove",
          tone: "destructive",
        }))
      ) {
        return;
      }
      try {
        const affected = parsedCharacters.filter((c) => ((c.parsed.tags ?? []) as string[]).includes(tag));
        for (const c of affected) {
          const newTags = ((c.parsed.tags ?? []) as string[]).filter((t) => t !== tag);
          await updateCharacter.mutateAsync({ id: c.id, data: { tags: newTags } });
        }
        if (activeTag === tag) setActiveTag(null);
      } catch {
        toast.error("Failed to remove tag from some characters");
      }
    },
    [parsedCharacters, updateCharacter, activeTag],
  );

  const sortedCharacters = useMemo(() => {
    const list = [...filteredCharacters];
    switch (sort) {
      case "name-asc":
        return list.sort((a, b) => (a.parsed.name ?? "").localeCompare(b.parsed.name ?? ""));
      case "name-desc":
        return list.sort((a, b) => (b.parsed.name ?? "").localeCompare(a.parsed.name ?? ""));
      case "newest":
        return list.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      case "oldest":
        return list.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      case "favorites":
        return list.sort((a, b) => {
          const aFav = a.parsed.extensions?.fav ? 1 : 0;
          const bFav = b.parsed.extensions?.fav ? 1 : 0;
          if (bFav !== aFav) return bFav - aFav;
          return (a.parsed.name ?? "").localeCompare(b.parsed.name ?? "");
        });
      default:
        return list;
    }
  }, [filteredCharacters, sort]);

  const parsedGroups = useMemo(() => {
    if (!groups) return [];
    return (groups as GroupRow[]).map((g) => ({
      ...g,
      memberIds: (() => {
        try {
          return JSON.parse(g.characterIds);
        } catch {
          return [];
        }
      })() as string[],
    }));
  }, [groups]);

  const toggleCharacter = (charId: string) => {
    if (!activeChat) return;
    const isActive = chatCharacterIds.includes(charId);
    const newIds = isActive ? chatCharacterIds.filter((id: string) => id !== charId) : [...chatCharacterIds, charId];
    if (newIds.length === 0) return;
    updateChat.mutate(
      { id: activeChat.id, characterIds: newIds },
      {
        onSuccess: () => {
          if (isActive) return; // removing, not adding
          if (isConversation) return; // no greeting in conversation mode
          const charList = (characters ?? []) as CharacterRow[];
          const char = charList.find((c) => c.id === charId);
          if (!char) return;
          try {
            const parsed = typeof char.data === "string" ? JSON.parse(char.data) : char.data;
            const firstMes = (parsed as { first_mes?: string }).first_mes;
            const altGreetings = (parsed as { alternate_greetings?: string[] }).alternate_greetings ?? [];
            const name = (parsed as { name?: string }).name ?? "Unknown";
            if (firstMes) {
              setFirstMesConfirm({ charId, charName: name, message: firstMes, alternateGreetings: altGreetings });
            }
          } catch {
            /* ignore */
          }
        },
      },
    );
  };

  const addGroupToChat = (memberIds: string[]) => {
    if (!activeChat || memberIds.length === 0) return;
    const merged = [...new Set([...chatCharacterIds, ...memberIds])];
    const newlyAdded = memberIds.filter((id) => !chatCharacterIds.includes(id));
    updateChat.mutate(
      { id: activeChat.id, characterIds: merged },
      {
        onSuccess: () => {
          // Skip greeting for conversation mode
          if (isConversation) return;
          // Find the first newly-added character with a first_mes
          const charList = (characters ?? []) as CharacterRow[];
          for (const charId of newlyAdded) {
            const char = charList.find((c) => c.id === charId);
            if (!char) continue;
            try {
              const parsed = typeof char.data === "string" ? JSON.parse(char.data) : char.data;
              const firstMes = (parsed as { first_mes?: string }).first_mes;
              const altGreetings = (parsed as { alternate_greetings?: string[] }).alternate_greetings ?? [];
              const name = (parsed as { name?: string }).name ?? "Unknown";
              if (firstMes) {
                setFirstMesConfirm({ charId, charName: name, message: firstMes, alternateGreetings: altGreetings });
                break; // show one at a time
              }
            } catch {
              /* ignore */
            }
          }
        },
      },
    );
  };

  const handleCreateGroup = useCallback(() => {
    const name = newGroupName.trim();
    if (!name) return;
    createGroup.mutate({ name, characterIds: [] });
    setNewGroupName("");
    setCreatingGroup(false);
  }, [newGroupName, createGroup]);

  const handleRenameGroup = useCallback(
    (groupId: string) => {
      const name = editGroupName.trim();
      if (!name) return;
      updateGroup.mutate({ id: groupId, name });
      setEditingGroupId(null);
      setEditGroupName("");
    },
    [editGroupName, updateGroup],
  );

  const toggleGroupMember = useCallback(
    (groupId: string, charId: string, currentMembers: string[]) => {
      const isMember = currentMembers.includes(charId);
      const newMembers = isMember ? currentMembers.filter((id) => id !== charId) : [...currentMembers, charId];
      updateGroup.mutate({ id: groupId, characterIds: newMembers });
    },
    [updateGroup],
  );

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedCharacterIds(new Set());
  }, []);

  const toggleSelection = useCallback((characterId: string) => {
    setSelectedCharacterIds((prev) => {
      const next = new Set(prev);
      if (next.has(characterId)) next.delete(characterId);
      else next.add(characterId);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedCharacterIds(new Set(sortedCharacters.map((char) => char.id)));
  }, [sortedCharacters]);

  const handleExportSelected = useCallback(async () => {
    if (selectedCharacterIds.size === 0) return;
    setExportingSelected(true);
    try {
      await api.downloadPost("/characters/export-bulk", { ids: [...selectedCharacterIds] }, "marinara-characters.zip");
      toast.success(`Exported ${selectedCharacterIds.size} character${selectedCharacterIds.size === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export characters");
    } finally {
      setExportingSelected(false);
    }
  }, [selectedCharacterIds]);

  const handleDeleteSelected = useCallback(async () => {
    const ids = [...selectedCharacterIds];
    if (ids.length === 0) return;

    if (
      !(await showConfirmDialog({
        title: "Delete Characters",
        message: `Delete ${ids.length} character${ids.length === 1 ? "" : "s"}?`,
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }

    const results = await Promise.allSettled(ids.map((id) => deleteCharacter.mutateAsync(id)));
    const failedIds = ids.filter((_, index) => results[index]?.status === "rejected");
    const deletedCount = ids.length - failedIds.length;

    if (deletedCount > 0) {
      toast.success(`Deleted ${deletedCount} character${deletedCount === 1 ? "" : "s"}`);
    }

    if (failedIds.length > 0) {
      setSelectedCharacterIds(new Set(failedIds));
      toast.error(`Failed to delete ${failedIds.length} character${failedIds.length === 1 ? "" : "s"}`);
      return;
    }

    exitSelectionMode();
  }, [selectedCharacterIds, deleteCharacter, exitSelectionMode]);

  return (
    <div className="flex flex-col gap-2 p-3">
      <button
        onClick={openCharacterLibrary}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-xs font-medium text-[var(--foreground)] transition-all hover:border-[var(--primary)]/35 hover:bg-[var(--accent)]"
        title="Open full library"
      >
        <Users size="0.875rem" className="text-[var(--primary)]" />
        Open Full Library
      </button>

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
            placeholder="Search characters"
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
            <option value="favorites">Favorites</option>
          </select>
          <ArrowUpDown
            size="0.625rem"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
        </div>
      </div>

      {/* Favorites filter */}
      <div className="flex gap-1">
        {(["all", "favorites", "non-favorites"] as const).map((opt) => (
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
            {opt === "favorites" && <Star size="0.5625rem" />}
            {opt === "all" ? "All" : opt === "favorites" ? "Favorites" : "Non-favorites"}
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
                ? "bg-[var(--primary)]/15 text-[var(--primary)]"
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
                      ? "bg-[var(--primary)]/20 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
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
          onClick={() => openModal("create-character")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-pink-400 to-purple-500 px-3 py-2.5 text-xs font-medium text-white shadow-md shadow-pink-500/15 transition-all hover:shadow-lg hover:shadow-pink-500/25 active:scale-[0.98]"
          title="New"
        >
          <Plus size="0.8125rem" /> <span className="md:hidden">New</span>
        </button>
        <button
          onClick={() => openModal("import-character")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
          title="Import"
        >
          <Download size="0.8125rem" /> <span className="md:hidden">Import</span>
        </button>
        <button
          onClick={() => openModal("character-maker")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
          title="AI Maker"
        >
          <Sparkles size="0.8125rem" /> <span className="md:hidden">Maker</span>
        </button>
        <button
          onClick={() => {
            if (selectionMode) {
              exitSelectionMode();
            } else {
              setAssigningToGroup(null);
              setSelectionMode(true);
            }
          }}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all",
            selectionMode
              ? "bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/30"
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
            {selectedCharacterIds.size} selected
          </span>
          <button
            onClick={selectAllVisible}
            disabled={sortedCharacters.length === 0}
            className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
          >
            Select visible
          </button>
          <button
            onClick={() => setSelectedCharacterIds(new Set())}
            disabled={selectedCharacterIds.size === 0}
            className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
          >
            Clear
          </button>
          <button
            onClick={handleDeleteSelected}
            disabled={selectedCharacterIds.size === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--destructive)]/12 px-2.5 py-1 text-[0.625rem] font-medium text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/20 disabled:opacity-40"
          >
            <Trash2 size="0.6875rem" />
            Delete
          </button>
          <button
            onClick={handleExportSelected}
            disabled={selectedCharacterIds.size === 0 || exportingSelected}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[0.625rem] font-medium text-[var(--primary-foreground)] transition-all hover:opacity-90 disabled:opacity-40"
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
          <div className="flex flex-col gap-1 mt-1">
            {/* Inline create group */}
            {creatingGroup && (
              <div className="flex items-center gap-1.5 rounded-xl bg-[var(--secondary)] p-2 ring-1 ring-[var(--primary)]/30">
                <FolderOpen size="0.875rem" className="shrink-0 text-[var(--primary)]" />
                <input
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateGroup();
                    if (e.key === "Escape") setCreatingGroup(false);
                  }}
                  placeholder="Group name…"
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--muted-foreground)]/50"
                />
                <button
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                  className="rounded-md p-0.5 text-emerald-400 hover:bg-emerald-500/15 disabled:opacity-30"
                >
                  <Check size="0.8125rem" />
                </button>
                <button
                  onClick={() => {
                    setCreatingGroup(false);
                    setNewGroupName("");
                  }}
                  className="rounded-md p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                >
                  <X size="0.8125rem" />
                </button>
              </div>
            )}

            {parsedGroups.map((group) => {
              const isExpanded = expandedGroupId === group.id;
              const isEditing = editingGroupId === group.id;
              const isAssigning = assigningToGroup === group.id;

              return (
                <div
                  key={group.id}
                  className="rounded-xl border border-transparent transition-all hover:border-[var(--border)]/50"
                >
                  {/* Group header */}
                  <div
                    className="group relative flex items-center gap-2.5 rounded-xl p-2 transition-all hover:bg-[var(--sidebar-accent)] cursor-pointer"
                    onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-purple-600 text-white shadow-sm">
                      {isExpanded ? <ChevronDown size="0.875rem" /> : <FolderOpen size="0.875rem" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editGroupName}
                          onChange={(e) => setEditGroupName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameGroup(group.id);
                            if (e.key === "Escape") setEditingGroupId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-transparent text-xs font-medium outline-none ring-1 ring-[var(--primary)]/30 rounded px-1 py-0.5"
                        />
                      ) : (
                        <>
                          <div className="truncate text-xs font-medium">{group.name}</div>
                          <div className="truncate text-[0.625rem] text-[var(--muted-foreground)]">
                            {group.memberIds.length} character{group.memberIds.length !== 1 ? "s" : ""}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--sidebar)] px-1 py-0.5 opacity-0 shadow-sm ring-1 ring-[var(--border)] transition-opacity group-hover:opacity-100 max-md:opacity-100">
                      {activeChat && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            addGroupToChat(group.memberIds);
                          }}
                          className="rounded-lg p-1 transition-all hover:bg-[var(--accent)]"
                          title="Add all to chat"
                        >
                          <UserPlus size="0.6875rem" className="text-[var(--primary)]" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isAssigning) {
                            exitSelectionMode();
                          }
                          setAssigningToGroup(isAssigning ? null : group.id);
                        }}
                        className={cn(
                          "rounded-lg p-1 transition-all hover:bg-[var(--accent)]",
                          isAssigning && "bg-[var(--primary)]/15 text-[var(--primary)]",
                        )}
                        title={isAssigning ? "Done assigning" : "Add/remove members"}
                      >
                        <Users size="0.6875rem" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingGroupId(group.id);
                          setEditGroupName(group.name);
                        }}
                        className="rounded-lg p-1 transition-all hover:bg-[var(--accent)]"
                        title="Rename group"
                      >
                        <Pencil size="0.6875rem" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteGroup.mutate(group.id);
                        }}
                        className="rounded-lg p-1 transition-all hover:bg-[var(--destructive)]/15"
                        title="Delete group"
                      >
                        <Trash2 size="0.6875rem" className="text-[var(--destructive)]" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded: show members */}
                  {isExpanded && (
                    <div className="ml-5 flex flex-col gap-0.5 border-l border-[var(--border)]/40 pl-3 pb-2">
                      {group.memberIds.length === 0 && (
                        <div className="py-2 text-[0.625rem] text-[var(--muted-foreground)] italic">
                          No members — click <Users size="0.625rem" className="inline" /> to add characters
                        </div>
                      )}
                      {group.memberIds.map((memberId) => {
                        const member = charMap.get(memberId);
                        if (!member) return null;
                        return (
                          <div
                            key={memberId}
                            onClick={() => openCharacterDetail(memberId)}
                            onContextMenu={(e) => {
                              if (selectionMode || assigningToGroup) return;
                              e.preventDefault();
                              const fullMember = parsedCharacters.find((c) => c.id === memberId);
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                charId: memberId,
                                charName: member.name,
                                firstMes: fullMember?.parsed?.first_mes as string | undefined,
                                altGreetings: (fullMember?.parsed?.alternate_greetings ?? []) as string[],
                              });
                            }}
                            className="group/member flex cursor-pointer items-center gap-2 rounded-lg p-1.5 transition-all hover:bg-[var(--sidebar-accent)]"
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg overflow-hidden bg-gradient-to-br from-pink-400 to-rose-500 text-white">
                              {member.avatarPath ? (
                                <img
                                  src={member.avatarPath}
                                  alt={member.name}
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <User size="0.75rem" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-[0.6875rem]">{member.name}</span>
                              {getCharacterTitle(member) && (
                                <span className="block truncate text-[0.5625rem] italic text-[var(--muted-foreground)]">
                                  {getCharacterTitle(member)}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleGroupMember(group.id, memberId, group.memberIds);
                              }}
                              className="rounded p-0.5 opacity-0 transition-all hover:bg-[var(--destructive)]/15 group-hover/member:opacity-100"
                              title="Remove from group"
                            >
                              <UserMinus size="0.6875rem" className="text-[var(--destructive)]" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {parsedGroups.length === 0 && !creatingGroup && (
              <div className="py-2 text-center text-[0.625rem] text-[var(--muted-foreground)]">
                No groups yet — click <FolderPlus size="0.625rem" className="inline" /> to create one
              </div>
            )}
          </div>
        )}
      </div>

      {/* Assign-to-group banner */}
      {assigningToGroup && (
        <div className="flex items-center gap-2 rounded-xl bg-[var(--primary)]/10 px-3 py-2 text-xs ring-1 ring-[var(--primary)]/30">
          <Users size="0.8125rem" className="text-[var(--primary)]" />
          <span className="flex-1">
            Click characters to add/remove from{" "}
            <strong>{parsedGroups.find((g) => g.id === assigningToGroup)?.name}</strong>
          </span>
          <button onClick={() => setAssigningToGroup(null)} className="rounded p-0.5 hover:bg-[var(--accent)]">
            <X size="0.8125rem" />
          </button>
        </div>
      )}

      {/* Characters Section Header */}
      <div className="flex items-center gap-1.5 px-1 pt-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        <User size="0.6875rem" />
        Characters ({filteredCharacters.length})
        {selectionMode && (
          <span className="text-[0.625rem] font-normal normal-case">· {selectedCharacterIds.size} selected</span>
        )}
      </div>

      {/* Character list */}
      {isLoading && (
        <div className="flex flex-col gap-2 py-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-14 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && filteredCharacters.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="animate-float flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-400/20 to-rose-500/20">
            <User size="1.25rem" className="text-[var(--primary)]" />
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">{search ? "No matches found" : "No characters yet"}</p>
        </div>
      )}

      <div className="stagger-children flex flex-col gap-1">
        {sortedCharacters.map((char) => {
          const charName = char.parsed.name ?? "Unnamed";
          const charTitle = getCharacterTitle({ name: charName, comment: char.comment });
          const charTags = (char.parsed.tags ?? []) as string[];
          const charNameColor = (char.parsed.extensions?.nameColor as string) || undefined;
          const isSelected = chatCharacterIds.includes(char.id);
          const isBulkSelected = selectedCharacterIds.has(char.id);
          const avatarUrl = char.avatarPath;
          // If assigning to a group, highlight members of that group
          const targetGroup = assigningToGroup ? parsedGroups.find((g) => g.id === assigningToGroup) : null;
          const isInTargetGroup = targetGroup?.memberIds.includes(char.id) ?? false;
          const previewMetadata = getCharacterPreviewMetadata(char);

          return (
            <div
              key={char.id}
              onClick={() => {
                if (selectionMode) {
                  toggleSelection(char.id);
                } else if (assigningToGroup && targetGroup) {
                  toggleGroupMember(assigningToGroup, char.id, targetGroup.memberIds);
                } else {
                  openCharacterDetail(char.id);
                }
              }}
              onContextMenu={(e) => {
                if (selectionMode || assigningToGroup) return;
                e.preventDefault();
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  charId: char.id,
                  charName,
                  firstMes: char.parsed?.first_mes as string | undefined,
                  altGreetings: (char.parsed?.alternate_greetings ?? []) as string[],
                });
              }}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-xl p-2 transition-all hover:bg-[var(--sidebar-accent)] cursor-pointer",
                selectionMode && isBulkSelected && "ring-1 ring-[var(--primary)]/40 bg-[var(--primary)]/8",
                isSelected && !assigningToGroup && "ring-1 ring-[var(--primary)]/40 bg-[var(--primary)]/5",
                assigningToGroup && isInTargetGroup && "ring-1 ring-violet-500/50 bg-violet-500/10",
                assigningToGroup && !isInTargetGroup && "opacity-60 hover:opacity-100",
              )}
            >
              {selectionMode && (
                <button
                  type="button"
                  aria-label={isBulkSelected ? "Deselect character" : "Select character"}
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
                    isBulkSelected
                      ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                      : "border-[var(--muted-foreground)]/40 bg-[var(--secondary)] text-transparent",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelection(char.id);
                  }}
                >
                  <Check size="0.75rem" />
                </button>
              )}
              {/* Avatar */}
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 text-white shadow-sm">
                {avatarUrl ? (
                  <div className="absolute inset-0 overflow-hidden rounded-xl">
                    <img
                      src={avatarUrl}
                      alt={charName}
                      className="h-full w-full object-cover"
                      style={getAvatarCropStyle(
                        char.parsed.extensions?.avatarCrop as
                          | { zoom: number; offsetX: number; offsetY: number }
                          | undefined,
                      )}
                    />
                  </div>
                ) : (
                  <User size="1rem" />
                )}
                {isSelected && !assigningToGroup && (
                  <div className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--primary)] shadow-sm">
                    <Check size="0.5625rem" className="text-white" />
                  </div>
                )}
                {assigningToGroup && isInTargetGroup && (
                  <div className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 shadow-sm">
                    <Check size="0.5625rem" className="text-white" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-sm font-medium"
                  style={
                    charNameColor
                      ? charNameColor.startsWith("linear-gradient")
                        ? {
                            background: charNameColor,
                            backgroundRepeat: "no-repeat",
                            backgroundSize: "100% 100%",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                            backgroundClip: "text",
                            color: "transparent",
                            display: "inline-block",
                          }
                        : { color: charNameColor }
                      : undefined
                  }
                >
                  {charName}
                </div>
                {charTitle && (
                  <div className="truncate text-[0.625rem] italic text-[var(--muted-foreground)]">{charTitle}</div>
                )}
                {(assigningToGroup || previewMetadata) && (
                  <div className="truncate text-[0.625rem] text-[var(--muted-foreground)]">
                    {assigningToGroup
                      ? isInTargetGroup
                        ? "In group — click to remove"
                        : "Click to add to group"
                      : previewMetadata}
                  </div>
                )}
                {!assigningToGroup && charTags.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-0.5">
                    {charTags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveTag(activeTag === tag ? null : tag);
                        }}
                        className="cursor-pointer rounded-full bg-[var(--primary)]/8 px-1.5 py-px text-[0.5rem] font-medium text-[var(--primary)]/70 transition-all hover:bg-[var(--primary)]/15 hover:text-[var(--primary)]"
                      >
                        {tag}
                      </span>
                    ))}
                    {charTags.length > 3 && (
                      <span className="rounded-full bg-[var(--secondary)] px-1.5 py-px text-[0.5rem] text-[var(--muted-foreground)]">
                        +{charTags.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Actions (hidden during group assign mode) */}
              {!assigningToGroup && !selectionMode && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--sidebar)] px-1 py-0.5 opacity-0 shadow-sm ring-1 ring-[var(--border)] transition-opacity group-hover:opacity-100 max-md:opacity-100">
                  {activeChat && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCharacter(char.id);
                      }}
                      className={cn(
                        "rounded-lg p-1.5 transition-all active:scale-90",
                        isSelected
                          ? "text-[var(--destructive)] hover:bg-[var(--destructive)]/15"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--primary)]/10 hover:text-[var(--primary)]",
                      )}
                      title={isSelected ? "Remove from chat" : "Add to chat"}
                    >
                      {isSelected ? <X size="0.75rem" /> : <Check size="0.75rem" />}
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicateCharacter.mutate(char.id, {
                        onSuccess: () => {
                          toast.success(`Duplicated "${char.parsed?.name ?? "character"}"`);
                        },
                      });
                    }}
                    className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-sky-400/10 hover:text-sky-400 active:scale-90"
                    title="Duplicate"
                  >
                    <Copy size="0.75rem" />
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (
                        !(await showConfirmDialog({
                          title: "Delete Character",
                          message: `Delete "${char.parsed?.name ?? "this character"}"? This cannot be undone.`,
                          confirmLabel: "Delete",
                          tone: "destructive",
                        }))
                      ) {
                        return;
                      }
                      deleteCharacter.mutate(char.id);
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

      {activeChat && !assigningToGroup && !selectionMode && (
        <p className="px-1 text-[0.625rem] text-[var(--muted-foreground)]/60">
          Click to edit · Use ✓ to assign/remove from chat
        </p>
      )}

      {contextMenu &&
        (() => {
          const items: ContextMenuItem[] = [
            {
              label: "Quick Start Roleplay",
              icon: <Wand2 size="0.75rem" />,
              onSelect: () =>
                quickStartFromCharacter(
                  contextMenu.charId,
                  contextMenu.charName,
                  "roleplay",
                  contextMenu.firstMes,
                  contextMenu.altGreetings,
                ),
            },
            {
              label: "Quick Start Conversation",
              icon: <MessageCircle size="0.75rem" />,
              onSelect: () => quickStartFromCharacter(contextMenu.charId, contextMenu.charName, "conversation"),
            },
          ];
          return <ContextMenu x={contextMenu.x} y={contextMenu.y} items={items} onClose={() => setContextMenu(null)} />;
        })()}

      {/* First message confirmation dialog */}
      {firstMesConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 max-md:pt-[env(safe-area-inset-top)]"
          onClick={() => setFirstMesConfirm(null)}
        >
          <div
            className="relative mx-4 flex w-full max-w-sm flex-col rounded-xl bg-[var(--card)] shadow-2xl ring-1 ring-[var(--border)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
              <MessageCircle size="0.875rem" className="text-[var(--muted-foreground)]" />
              <span className="text-sm font-semibold text-[var(--foreground)]">First Message</span>
            </div>
            <div className="px-4 py-3">
              <p className="text-sm text-[var(--foreground)]">
                Add <strong>{firstMesConfirm.charName}</strong>'s first message to the chat?
              </p>
              <p className="mt-2 max-h-32 overflow-y-auto rounded-lg bg-[var(--accent)]/50 px-3 py-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
                {firstMesConfirm.message.length > 300
                  ? firstMesConfirm.message.slice(0, 300) + "\u2026"
                  : firstMesConfirm.message}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
              <button
                onClick={() => setFirstMesConfirm(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
              >
                Skip
              </button>
              <button
                onClick={async () => {
                  const msg = await createMessage.mutateAsync({
                    role: "assistant",
                    content: firstMesConfirm.message,
                    characterId: firstMesConfirm.charId,
                  });
                  // Add alternate greetings as swipes on the first message
                  if (msg?.id && firstMesConfirm.alternateGreetings.length > 0) {
                    for (const greeting of firstMesConfirm.alternateGreetings) {
                      if (greeting.trim()) {
                        await api.post(`/chats/${activeChat!.id}/messages/${msg.id}/swipes`, {
                          content: greeting,
                          silent: true,
                        });
                      }
                    }
                    queryClient.invalidateQueries({ queryKey: chatKeys.messages(activeChat!.id) });
                  }
                  setFirstMesConfirm(null);
                }}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-colors hover:opacity-90"
              >
                Add Message
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
