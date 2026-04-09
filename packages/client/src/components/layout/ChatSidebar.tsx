// ──────────────────────────────────────────────
// Layout: Chat Sidebar (polished with rich buttons)
// ──────────────────────────────────────────────
import {
  Plus,
  MessageSquare,
  Search,
  Trash2,
  BookOpen,
  Theater,
  GitBranch,
  AlertTriangle,
  X,
  Circle,
  Moon,
  MinusCircle,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import { useChats, useCreateChat, useDeleteChat, useDeleteChatGroup } from "../../hooks/use-chats";
import {
  useChatFolders,
  useCreateFolder,
  useUpdateFolder,
  useDeleteFolder,
  useReorderFolders,
  useMoveChat,
} from "../../hooks/use-chat-folders";
import { useCharacters } from "../../hooks/use-characters";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore, type UserStatus } from "../../stores/ui.store";
import { cn } from "../../lib/utils";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { ChatFolder, ChatMode } from "@marinara-engine/shared";
import { Modal } from "../ui/Modal";
import { Reorder, useDragControls } from "framer-motion";

const MODE_CONFIG: Record<
  string,
  { icon: React.ReactNode; label: string; shortLabel: string; bg: string; description: string; comingSoon?: boolean }
> = {
  conversation: {
    icon: <MessageSquare size="0.875rem" />,
    label: "Conversation",
    shortLabel: "Chat",
    bg: "linear-gradient(135deg, #4de5dd, #3ab8b1)",
    description: "A straightforward AI conversation — no roleplay elements.",
  },
  roleplay: {
    icon: <BookOpen size="0.875rem" />,
    label: "Roleplay",
    shortLabel: "RP",
    bg: "linear-gradient(135deg, #eb8951, #d97530)",
    description: "Immersive roleplay with characters, game state tracking, and world simulation.",
  },
  visual_novel: {
    icon: <Theater size="0.875rem" />,
    label: "Game",
    shortLabel: "GM",
    bg: "linear-gradient(135deg, #e15c8c, #c94776)",
    description: "A full game experience with backgrounds, sprites, text boxes, and choices.",
    comingSoon: true,
  },
};

export function ChatSidebar() {
  const { data: chats, isLoading } = useChats();
  const createChat = useCreateChat();
  const deleteChat = useDeleteChat();
  const deleteChatGroup = useDeleteChatGroup();
  const activeChatId = useChatStore((s) => s.activeChatId);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const { data: allCharacters } = useCharacters();
  const hasAnyDetailOpen = useUIStore((s) => s.hasAnyDetailOpen);
  const editorDirty = useUIStore((s) => s.editorDirty);
  const closeAllDetails = useUIStore((s) => s.closeAllDetails);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  // Folder hooks
  const { data: folders } = useChatFolders();
  const createFolderMut = useCreateFolder();
  const updateFolderMut = useUpdateFolder();
  const deleteFolderMut = useDeleteFolder();
  const reorderFoldersMut = useReorderFolders();
  const moveChatMut = useMoveChat();

  // Build character lookup: id → { name, avatarUrl, conversationStatus }
  const charLookup = useMemo(() => {
    const map = new Map<string, { name: string; avatarUrl: string | null; conversationStatus?: string }>();
    if (!allCharacters) return map;
    for (const char of allCharacters as Array<{ id: string; data: string; avatarPath: string | null }>) {
      try {
        const parsed = typeof char.data === "string" ? JSON.parse(char.data) : char.data;
        map.set(char.id, {
          name: parsed.name ?? "Unknown",
          avatarUrl: char.avatarPath ?? null,
          conversationStatus: parsed.extensions?.conversationStatus || undefined,
        });
      } catch {
        map.set(char.id, { name: "Unknown", avatarUrl: null });
      }
    }
    return map;
  }, [allCharacters]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"conversation" | "roleplay">("conversation");
  const [deleteTarget, setDeleteTarget] = useState<{
    chatId: string;
    groupId: string | null;
    branchCount: number;
  } | null>(null);

  // Folder UI state
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [movingChatId, setMovingChatId] = useState<string | null>(null);

  const filtered = chats?.filter(
    (c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()) && c.mode === activeTab,
  );

  // ── Collapse chats that share a groupId into one entry ──
  const displayChats = useMemo(() => {
    if (!filtered) return [];

    // Total group sizes from unfiltered chats (for accurate branch count)
    const totalGroupSizes = new Map<string, number>();
    if (chats) {
      for (const chat of chats) {
        if (chat.groupId) {
          totalGroupSizes.set(chat.groupId, (totalGroupSizes.get(chat.groupId) ?? 0) + 1);
        }
      }
    }

    // Sort by most recently updated first
    const sorted = [...filtered].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const seenGroups = new Set<string>();
    const result: { chat: (typeof filtered)[0]; branchCount: number }[] = [];

    for (const chat of sorted) {
      if (chat.groupId) {
        if (seenGroups.has(chat.groupId)) continue;
        seenGroups.add(chat.groupId);
        result.push({ chat, branchCount: totalGroupSizes.get(chat.groupId) ?? 1 });
      } else {
        result.push({ chat, branchCount: 1 });
      }
    }

    return result;
  }, [chats, filtered]);

  // ── Folder grouping ──
  const modeFolders = useMemo(() => {
    if (!folders) return [] as ChatFolder[];
    return folders.filter((f) => f.mode === activeTab).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [folders, activeTab]);

  const { unfiledChats, folderChatsMap } = useMemo(() => {
    if (!displayChats.length)
      return { unfiledChats: displayChats, folderChatsMap: new Map<string, typeof displayChats>() };
    const unfiled: typeof displayChats = [];
    const map = new Map<string, typeof displayChats>();
    for (const entry of displayChats) {
      const fid = entry.chat.folderId;
      if (!fid) {
        unfiled.push(entry);
        continue;
      }
      if (!map.has(fid)) map.set(fid, []);
      map.get(fid)!.push(entry);
    }
    return { unfiledChats: unfiled, folderChatsMap: map };
  }, [displayChats]);

  const [localFolderOrder, setLocalFolderOrder] = useState<string[]>([]);
  useEffect(() => {
    setLocalFolderOrder(modeFolders.map((f) => f.id));
  }, [modeFolders]);

  // Detect if active chat belongs to a group (so its group row highlights)
  const activeChat = chats?.find((c) => c.id === activeChatId);
  const activeGroupId = activeChat?.groupId ?? null;

  // ── Sync sidebar tab + folder with the currently active chat ──
  // Covers: recent-chat clicks, page refresh, connected-chat switch,
  // scene navigation, notification bubbles, branch switch, import, etc.
  //
  // Uses a structured ref so each concern (tab, folder, scroll) resolves
  // independently — folder expansion retries when folders load late, and
  // scroll waits until both tab and folder are settled.
  const syncRef = useRef<{ chatId: string | null; tabSynced: boolean; folderSynced: boolean }>({
    chatId: null,
    tabSynced: false,
    folderSynced: false,
  });
  // When true the next sync skips clearing the search query — set by
  // the sidebar's own click handler so clicking a search result doesn't
  // wipe the filter the user is actively browsing.
  const internalNavRef = useRef(false);
  useEffect(() => {
    if (!activeChatId || !chats?.length) return;

    const chat = chats.find((c) => c.id === activeChatId);
    if (!chat) return;

    const s = syncRef.current;
    const isNewChat = s.chatId !== activeChatId;
    let needsScroll = false;

    if (isNewChat) {
      s.chatId = activeChatId;
      s.tabSynced = false;
      s.folderSynced = false;
    }

    // 1. Tab sync — once per chat switch
    if (!s.tabSynced) {
      const chatMode = chat.mode as "conversation" | "roleplay";
      if (chatMode === "conversation" || chatMode === "roleplay") {
        setActiveTab(chatMode);
      }
      // Clear search so the active chat isn't hidden by a stale filter.
      // Skip when the navigation originated from a sidebar click (the
      // user is actively browsing search results and shouldn't lose them).
      if (!internalNavRef.current) {
        setSearchQuery("");
      }
      internalNavRef.current = false;
      s.tabSynced = true;
      needsScroll = true;
    }

    // 2. Folder expansion — waits for folders data; if the folder is
    //    collapsed we fire a mutation and stay !folderSynced so the effect
    //    re-runs after the query delivers the expanded state.
    if (!s.folderSynced) {
      if (!chat.folderId) {
        s.folderSynced = true;
      } else if (folders) {
        const folder = folders.find((f) => f.id === chat.folderId);
        if (folder?.collapsed) {
          updateFolderMut.mutate({ id: folder.id, collapsed: false });
          // folderSynced stays false — re-runs after query invalidation
        } else {
          s.folderSynced = true;
          needsScroll = true;
        }
      }
      // else: folders not loaded yet — effect re-runs when they arrive
    }

    // 3. Scroll active chat row into view once both tab + folder are settled
    if (needsScroll && s.tabSynced && s.folderSynced) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-chat-id="${activeChatId}"]`);
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [activeChatId, chats, folders, updateFolderMut]);

  const handleNewChat = useCallback(
    (mode: ChatMode) => {
      createChat.mutate(
        { name: `New ${MODE_CONFIG[mode]?.label ?? mode}`, mode, characterIds: [] },
        {
          onSuccess: (chat) => {
            setActiveChatId(chat.id);
            useChatStore.getState().setShouldOpenSettings(true);
            useChatStore.getState().setShouldOpenWizard(true);
          },
        },
      );
    },
    [createChat, setActiveChatId],
  );

  const handleNewChatFromTab = useCallback(() => {
    handleNewChat(activeTab);
  }, [handleNewChat, activeTab]);

  // ── Folder handlers ──
  const handleCreateFolder = useCallback(() => {
    if (!newFolderName.trim()) return;
    createFolderMut.mutate({ name: newFolderName.trim(), mode: activeTab });
    setNewFolderName("");
    setCreatingFolder(false);
  }, [newFolderName, activeTab, createFolderMut]);

  const handleToggleCollapse = useCallback(
    (folder: ChatFolder) => {
      updateFolderMut.mutate({ id: folder.id, collapsed: !folder.collapsed });
    },
    [updateFolderMut],
  );

  const handleRenameFolder = useCallback(
    (id: string, name: string) => {
      if (!name.trim()) return;
      updateFolderMut.mutate({ id, name: name.trim() });
    },
    [updateFolderMut],
  );

  const handleDeleteFolder = useCallback(
    (id: string) => {
      if (confirm("Delete this folder? Chats will be moved to the top level.")) {
        deleteFolderMut.mutate(id);
      }
    },
    [deleteFolderMut],
  );

  const handleFolderReorder = useCallback(
    (newOrder: string[]) => {
      setLocalFolderOrder(newOrder);
      reorderFoldersMut.mutate(newOrder);
    },
    [reorderFoldersMut],
  );

  const handleMoveToFolder = useCallback(
    (chatId: string, folderId: string | null) => {
      moveChatMut.mutate({ chatId, folderId });
      setMovingChatId(null);
    },
    [moveChatMut],
  );

  // ── Chat row renderer (shared between unfiled + folder sections) ──
  const renderChatRow = ({ chat, branchCount }: (typeof displayChats)[number]) => {
    const cfg = MODE_CONFIG[chat.mode] ?? MODE_CONFIG.conversation;
    const isActive = activeChatId === chat.id || (chat.groupId != null && chat.groupId === activeGroupId);
    return (
      <div
        role="button"
        tabIndex={0}
        key={chat.groupId ?? chat.id}
        data-chat-id={chat.id}
        onClick={() => {
          if (hasAnyDetailOpen()) {
            if (editorDirty) {
              if (!window.confirm("You have unsaved changes. Discard and continue?")) return;
            }
            closeAllDetails();
          }
          internalNavRef.current = true;
          setActiveChatId(chat.id);
          if (window.innerWidth < 768) setSidebarOpen(false);
        }}
        className={cn(
          "group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-all duration-150",
          isActive ? "bg-[var(--sidebar-accent)] shadow-sm" : "hover:bg-[var(--sidebar-accent)]/60",
        )}
      >
        {/* Active indicator */}
        {isActive && (
          <span
            className="absolute -left-0.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full"
            style={{ background: cfg.bg }}
          />
        )}

        {/* Chat avatar(s) or mode icon fallback — with unread badge overlay */}
        <div className="relative flex-shrink-0">
          {(() => {
            const charIds: string[] =
              typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : (chat.characterIds ?? []);
            const avatars = charIds
              .slice(0, 3)
              .map((id) => charLookup.get(id))
              .filter(Boolean) as { name: string; avatarUrl: string | null; conversationStatus?: string }[];

            const isConvoMode = chat.mode === "conversation";
            const statusDot = (status?: string) => {
              if (!isConvoMode) return null;
              const s = status ?? "online";
              const color =
                s === "online"
                  ? "bg-green-500"
                  : s === "idle"
                    ? "bg-yellow-500"
                    : s === "dnd"
                      ? "bg-red-500"
                      : "bg-gray-400";
              return (
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-[1.5px] ring-[var(--sidebar-background)] ${color}`}
                />
              );
            };

            if (avatars.length === 0) {
              return (
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg text-xs transition-transform group-active:scale-90",
                    isActive ? "text-white shadow-sm" : "bg-[var(--secondary)] text-[var(--muted-foreground)]",
                  )}
                  style={isActive ? { background: cfg.bg } : undefined}
                >
                  {cfg.icon}
                </div>
              );
            }

            if (avatars.length === 1) {
              const a = avatars[0]!;
              return a.avatarUrl ? (
                <div className="relative h-7 w-7 flex-shrink-0 transition-transform group-active:scale-90">
                  <img src={a.avatarUrl} alt={a.name} className="h-7 w-7 rounded-full object-cover" />
                  {statusDot(a.conversationStatus)}
                </div>
              ) : (
                <div className="relative h-7 w-7 flex-shrink-0 transition-transform group-active:scale-90">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--secondary)] text-[0.625rem] font-bold text-[var(--muted-foreground)]">
                    {a.name[0]}
                  </div>
                  {statusDot(a.conversationStatus)}
                </div>
              );
            }

            // Multiple characters — stacked avatars
            return (
              <div className="relative h-7 w-7 flex-shrink-0 transition-transform group-active:scale-90">
                {avatars.slice(0, 2).map((a, i) =>
                  a.avatarUrl ? (
                    <img
                      key={i}
                      src={a.avatarUrl}
                      alt={a.name}
                      className={cn(
                        "absolute h-5 w-5 rounded-full object-cover ring-2 ring-[var(--sidebar-background)]",
                        i === 0 ? "top-0 left-0 z-10" : "bottom-0 right-0",
                      )}
                    />
                  ) : (
                    <div
                      key={i}
                      className={cn(
                        "absolute flex h-5 w-5 items-center justify-center rounded-full bg-[var(--secondary)] text-[0.5rem] font-bold text-[var(--muted-foreground)] ring-2 ring-[var(--sidebar-background)]",
                        i === 0 ? "top-0 left-0 z-10" : "bottom-0 right-0",
                      )}
                    >
                      {a.name[0]}
                    </div>
                  ),
                )}
              </div>
            );
          })()}

          {/* Unread count badge */}
          {(() => {
            const count = unreadCounts.get(chat.id) || 0;
            if (count === 0 || isActive) return null;
            return (
              <span className="absolute -top-1 -right-1 z-20 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[0.5625rem] font-bold leading-none text-white shadow-sm ring-2 ring-[var(--sidebar-background)]">
                {count > 99 ? "99+" : count}
              </span>
            );
          })()}
        </div>

        {/* Name */}
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm",
              isActive ? "font-medium text-[var(--sidebar-accent-foreground)]" : "text-[var(--sidebar-foreground)]",
            )}
          >
            {chat.name}
          </span>
        </div>

        {/* Branch count badge */}
        {branchCount > 1 && (
          <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
            <GitBranch size="0.625rem" />
            {branchCount}
          </span>
        )}

        {/* Mode badge on hover */}
        <span className="shrink-0 text-[0.625rem] text-[var(--muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
          {cfg.shortLabel}
        </span>

        {/* Move to folder */}
        {modeFolders.length > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMovingChatId(chat.id);
            }}
            className="shrink-0 rounded-md p-1 opacity-0 transition-all hover:bg-[var(--accent)] group-hover:opacity-100 max-md:opacity-100"
            title="Move to folder"
          >
            <FolderOpen size="0.75rem" className="text-[var(--muted-foreground)]" />
          </button>
        )}

        {/* Delete button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (branchCount > 1 && chat.groupId) {
              setDeleteTarget({ chatId: chat.id, groupId: chat.groupId, branchCount });
            } else {
              if (confirm("Delete this chat?")) {
                deleteChat.mutate(chat.id);
                if (activeChatId === chat.id) setActiveChatId(null);
              }
            }
          }}
          className="shrink-0 rounded-md p-1 opacity-0 transition-all hover:bg-[var(--destructive)]/20 group-hover:opacity-100 max-md:opacity-100"
        >
          <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
        </button>
      </div>
    );
  };

  return (
    <nav data-component="ChatSidebar" aria-label="Chat navigation" className="mari-chat-sidebar flex h-full flex-col">
      {/* Header */}
      <div className="relative flex h-12 items-center justify-between bg-[var(--card)]/80 px-4 backdrop-blur-sm">
        <div className="absolute inset-x-0 bottom-0 h-px bg-[var(--border)]/30" />
        <h2 className="retro-glow-text text-sm font-bold tracking-tight">✧ Chats</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChatFromTab}
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--sidebar-accent)] hover:text-[var(--primary)] active:scale-90"
            title={`New ${activeTab === "conversation" ? "Conversation" : "Roleplay"}`}
          >
            <Plus size="1rem" />
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--sidebar-accent)] hover:text-[var(--primary)] active:scale-90 md:hidden"
            title="Close"
          >
            <X size="1rem" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-3 pt-2">
        {(["conversation", "roleplay"] as const).map((tab) => {
          const cfg = MODE_CONFIG[tab];
          const isActive = activeTab === tab;
          const tabUnread =
            chats?.filter((c) => c.mode === tab).reduce((sum, c) => sum + (unreadCounts.get(c.id) || 0), 0) ?? 0;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "relative flex min-h-[2.125rem] flex-1 items-center justify-center gap-1.5 overflow-visible rounded-lg px-2 py-2 text-xs leading-normal font-medium transition-all",
                isActive
                  ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)]/50 hover:text-[var(--sidebar-foreground)]",
              )}
            >
              <span className="shrink-0 leading-none">{cfg.icon}</span>
              <span className="inline-flex min-h-[1rem] items-center whitespace-nowrap pb-px leading-normal">
                {cfg.label}s
              </span>
              {tabUnread > 0 && !isActive && (
                <span className="absolute -top-1 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[0.5rem] font-bold leading-none text-white">
                  {tabUnread > 99 ? "99+" : tabUnread}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] px-3 py-2 ring-1 ring-transparent transition-all focus-within:ring-[var(--primary)]/40">
          <Search size="0.8125rem" className="text-[var(--muted-foreground)]" />
          <input
            type="text"
            placeholder={`Search ${activeTab === "conversation" ? "conversations" : "roleplays"}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none"
          />
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {isLoading && (
          <div className="flex flex-col gap-2 px-2 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-10 rounded-lg" />
            ))}
          </div>
        )}

        {displayChats.length === 0 && !isLoading && (
          <div className="flex flex-col items-center gap-2 px-3 py-12 text-center">
            <div className="animate-float flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--secondary)]">
              {activeTab === "conversation" ? (
                <MessageSquare size="1.25rem" className="text-[var(--muted-foreground)]" />
              ) : (
                <BookOpen size="1.25rem" className="text-[var(--muted-foreground)]" />
              )}
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              No {activeTab === "conversation" ? "conversations" : "roleplays"} yet
            </p>
            <button
              onClick={handleNewChatFromTab}
              className="mt-1 rounded-lg bg-[var(--primary)]/15 px-3 py-1.5 text-[0.6875rem] font-medium text-[var(--primary)] transition-all hover:bg-[var(--primary)]/25"
            >
              + New {activeTab === "conversation" ? "Conversation" : "Roleplay"}
            </button>
          </div>
        )}

        <div className="stagger-children flex flex-col gap-0.5">
          {/* New folder */}
          {creatingFolder ? (
            <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5">
              <FolderPlus size="0.75rem" className="text-[var(--muted-foreground)]" />
              <input
                autoFocus
                placeholder="Folder name..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                  if (e.key === "Escape") {
                    setCreatingFolder(false);
                    setNewFolderName("");
                  }
                }}
                onBlur={() => {
                  if (newFolderName.trim()) handleCreateFolder();
                  else {
                    setCreatingFolder(false);
                    setNewFolderName("");
                  }
                }}
                className="flex-1 bg-transparent text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
              />
            </div>
          ) : (
            <button
              onClick={() => setCreatingFolder(true)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.6875rem] text-[var(--muted-foreground)] transition-all hover:bg-[var(--sidebar-accent)]/40 hover:text-[var(--foreground)]"
            >
              <FolderPlus size="0.75rem" />
              New Folder
            </button>
          )}

          {/* Folders (drag-to-reorder) */}
          {localFolderOrder.length > 0 && (
            <Reorder.Group
              axis="y"
              values={localFolderOrder}
              onReorder={handleFolderReorder}
              as="div"
              className="flex flex-col gap-0.5 mt-1"
            >
              {localFolderOrder.map((folderId) => {
                const folder = modeFolders.find((f) => f.id === folderId);
                if (!folder) return null;
                const folderEntries = folderChatsMap.get(folderId) ?? [];
                return (
                  <FolderRow
                    key={folderId}
                    folder={folder}
                    entries={folderEntries}
                    renderChatRow={renderChatRow}
                    onToggleCollapse={handleToggleCollapse}
                    onRename={handleRenameFolder}
                    onDelete={handleDeleteFolder}
                  />
                );
              })}
            </Reorder.Group>
          )}

          {/* Unfiled chats */}
          {unfiledChats.map(renderChatRow)}
        </div>
      </div>

      {/* ── User Status Selector ── */}
      <UserStatusFooter />

      {/* ── Delete Branch Modal ── */}
      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Delete Chat" width="max-w-sm">
        {deleteTarget && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--destructive)]/10">
                <AlertTriangle size="1.125rem" className="text-[var(--destructive)]" />
              </div>
              <p className="text-sm text-[var(--muted-foreground)]">
                This conversation has{" "}
                <strong className="text-[var(--foreground)]">{deleteTarget.branchCount} branches</strong>. What would
                you like to delete?
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  deleteChat.mutate(deleteTarget.chatId);
                  if (activeChatId === deleteTarget.chatId) setActiveChatId(null);
                  setDeleteTarget(null);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
              >
                <Trash2 size="0.8125rem" />
                Delete This Branch Only
              </button>
              <button
                onClick={() => {
                  if (deleteTarget.groupId) {
                    deleteChatGroup.mutate(deleteTarget.groupId);
                    if (activeGroupId === deleteTarget.groupId) setActiveChatId(null);
                  }
                  setDeleteTarget(null);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--destructive)]/10 px-3 py-2.5 text-xs font-medium text-[var(--destructive)] ring-1 ring-[var(--destructive)]/20 transition-all hover:bg-[var(--destructive)]/20 active:scale-[0.98]"
              >
                <Trash2 size="0.8125rem" />
                Delete All {deleteTarget.branchCount} Branches
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Move to Folder Modal ── */}
      <Modal open={movingChatId !== null} onClose={() => setMovingChatId(null)} title="Move to Folder" width="max-w-xs">
        {movingChatId && (
          <div className="flex flex-col gap-1">
            <button
              onClick={() => handleMoveToFolder(movingChatId, null)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-all hover:bg-[var(--accent)]",
                !chats?.find((c) => c.id === movingChatId)?.folderId && "bg-[var(--accent)] font-medium",
              )}
            >
              <MessageSquare size="0.75rem" className="text-[var(--muted-foreground)]" />
              Unfiled
            </button>
            {modeFolders.map((f) => (
              <button
                key={f.id}
                onClick={() => handleMoveToFolder(movingChatId, f.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-all hover:bg-[var(--accent)]",
                  chats?.find((c) => c.id === movingChatId)?.folderId === f.id && "bg-[var(--accent)] font-medium",
                )}
              >
                <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: f.color || "#6b7280" }} />
                {f.name}
              </button>
            ))}
          </div>
        )}
      </Modal>
    </nav>
  );
}

// ── FolderRow (self-contained state for menu/rename) ──
function FolderRow({
  folder,
  entries,
  renderChatRow,
  onToggleCollapse,
  onRename,
  onDelete,
}: {
  folder: ChatFolder;
  entries: { chat: any; branchCount: number }[];
  renderChatRow: (entry: any) => React.ReactNode;
  onToggleCollapse: (folder: ChatFolder) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const dragControls = useDragControls();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);

  return (
    <Reorder.Item value={folder.id} dragListener={false} dragControls={dragControls} as="div" className="flex flex-col">
      {/* Folder header */}
      <div className="group relative flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-[var(--sidebar-accent)]/40">
        <div
          onPointerDown={(e) => dragControls.start(e)}
          className="cursor-grab touch-none opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100 max-md:opacity-100"
        >
          <GripVertical size="0.625rem" className="text-[var(--muted-foreground)]" />
        </div>
        <button onClick={() => onToggleCollapse(folder)} className="p-0.5 text-[var(--muted-foreground)]">
          <ChevronRight size="0.75rem" className={cn("transition-transform", !folder.collapsed && "rotate-90")} />
        </button>
        <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: folder.color || "#6b7280" }} />
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onRename(folder.id, renameValue);
                setRenaming(false);
              }
              if (e.key === "Escape") {
                setRenaming(false);
                setRenameValue(folder.name);
              }
            }}
            onBlur={() => {
              onRename(folder.id, renameValue);
              setRenaming(false);
            }}
            className="flex-1 bg-transparent text-xs font-medium text-[var(--foreground)] outline-none"
          />
        ) : (
          <span
            onClick={() => {
              setRenameValue(folder.name);
              setRenaming(true);
            }}
            className="flex-1 cursor-text truncate text-xs font-medium text-[var(--muted-foreground)]"
          >
            {folder.name}
          </span>
        )}
        {entries.length > 0 && (
          <span className="text-[0.5625rem] text-[var(--muted-foreground)]">{entries.length}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(folder.id);
          }}
          className="shrink-0 rounded-md p-1 opacity-0 transition-all hover:bg-[var(--destructive)]/20 group-hover:opacity-100 max-md:opacity-100"
        >
          <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
        </button>
      </div>
      {/* Folder contents */}
      {!folder.collapsed && entries.length > 0 && (
        <div className="ml-4 flex flex-col gap-0.5 border-l border-[var(--border)]/20 pl-1">
          {entries.map(renderChatRow)}
        </div>
      )}
    </Reorder.Item>
  );
}

// ── Status config ──
const STATUS_OPTIONS: Array<{
  value: UserStatus;
  label: string;
  description: string;
  color: string;
  icon: React.ReactNode;
}> = [
  {
    value: "active",
    label: "Active",
    description: "You're online and available",
    color: "bg-green-500",
    icon: <Circle size="0.625rem" className="fill-green-500 text-green-500" />,
  },
  {
    value: "idle",
    label: "Idle",
    description: "Automatic when you're away",
    color: "bg-yellow-500",
    icon: <Moon size="0.625rem" className="text-yellow-500" />,
  },
  {
    value: "dnd",
    label: "Do Not Disturb",
    description: "Suppress auto messages",
    color: "bg-red-500",
    icon: <MinusCircle size="0.625rem" className="text-red-500" />,
  },
];

function UserStatusFooter() {
  const userStatus = useUIStore((s) => s.userStatus);
  const setUserStatusManual = useUIStore((s) => s.setUserStatusManual);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = STATUS_OPTIONS.find((s) => s.value === userStatus) ?? STATUS_OPTIONS[0]!;

  return (
    <div ref={ref} className="relative border-t border-[var(--border)]/30 px-3 py-2">
      {/* Popup */}
      {open && (
        <div className="absolute bottom-full left-2 right-2 mb-1 rounded-xl bg-[var(--popover)] p-1.5 shadow-xl ring-1 ring-[var(--border)]/40">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setUserStatusManual(opt.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all hover:bg-[var(--accent)]",
                userStatus === opt.value && "bg-[var(--accent)]",
              )}
            >
              <span className={`h-2 w-2 rounded-full ${opt.color}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-[var(--foreground)]">{opt.label}</div>
                <div className="text-[0.625rem] text-[var(--muted-foreground)]">{opt.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Status button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-all hover:bg-[var(--sidebar-accent)]/60"
      >
        <span className={`h-2 w-2 rounded-full ${current.color}`} />
        <span className="text-xs text-[var(--sidebar-foreground)]">{current.label}</span>
        <span className="ml-auto text-[0.625rem] text-[var(--muted-foreground)]">
          {userStatus === "idle" ? "Away" : ""}
        </span>
      </button>
    </div>
  );
}
