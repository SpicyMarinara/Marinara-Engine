// ──────────────────────────────────────────────
// Chat: Main chat area — mode-aware rendering
// ──────────────────────────────────────────────
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useChatMessages,
  useChatMessageCount,
  useChat,
  useDeleteMessage,
  useDeleteMessages,
  useDeleteSwipe,
  useUpdateMessage,
  useUpdateMessageExtra,
  usePeekPrompt,
  useCreateChat,
  useSetActiveSwipe,
  useUpdateChatMetadata,
  useBranchChat,
  useChats,
} from "../../hooks/use-chats";

import { useChatStore } from "../../stores/chat.store";
import { useGenerate } from "../../hooks/use-generate";
import { useCharacters, usePersonas } from "../../hooks/use-characters";
import { useConnections } from "../../hooks/use-connections";
import { usePageActivity } from "../../hooks/use-page-activity";
import { api } from "../../lib/api-client";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { useGameStateStore } from "../../stores/game-state.store";
import { BookOpen, HelpCircle, MessageSquare, Theater } from "lucide-react";
import type { SpritePlacement, SpriteSide } from "@marinara-engine/shared";
import { useUIStore } from "../../stores/ui.store";
import { useAgentStore } from "../../stores/agent.store";
import { cn } from "../../lib/utils";
import { useEncounter } from "../../hooks/use-encounter";
import { useScene } from "../../hooks/use-scene";
import { useEncounterStore } from "../../stores/encounter.store";
import { APP_VERSION } from "@marinara-engine/shared";
import { BUILT_IN_AGENTS } from "@marinara-engine/shared";
import { useTranslationStore } from "../../stores/translation.store";
import { mirrorSpritePlacements, normalizeSpritePlacements } from "./sprite-placement";
import type { CharacterMap, MessageSelectionToggle, MessageWithSwipes, PeekPromptData } from "./chat-area.types";
import { RecentChats } from "./RecentChats";
import { NewChatConnectionGate } from "./NewChatConnectionGate";
import { ChatCommonOverlays } from "./ChatCommonOverlays";

export type { CharacterMap };

const ChatConversationSurface = lazy(async () => {
  const module = await import("./ChatConversationSurface");
  return { default: module.ChatConversationSurface };
});

const ChatRoleplaySurface = lazy(async () => {
  const module = await import("./ChatRoleplaySurface");
  return { default: module.ChatRoleplaySurface };
});

const GameSurface = lazy(async () => {
  const module = await import("../game/GameSurface");
  return { default: module.GameSurface };
});

export function ChatArea() {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const streamingChatId = useChatStore((s) => s.streamingChatId);
  const isStreamingGlobal = useChatStore((s) => s.isStreaming);
  const isStreaming = isStreamingGlobal && streamingChatId === activeChatId;
  const isPageActive = usePageActivity();
  const regenerateMessageId = useChatStore((s) => s.regenerateMessageId);
  const chatBackground = useUIStore((s) => s.chatBackground);
  const weatherEffects = useUIStore((s) => s.weatherEffects);
  const messagesPerPage = useUIStore((s) => s.messagesPerPage);
  const centerCompact = useUIStore((s) => s.centerCompact);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  // Tracks whether the initial load stagger animation has played.
  // After the first render with messages, new/re-mounted messages
  // skip the entry animation to avoid a visible flash on refetch.
  const hasAnimatedRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [spriteArrangeMode, setSpriteArrangeMode] = useState(false);

  // Delete dialog & multi-select state
  const [deleteDialogMessageId, setDeleteDialogMessageId] = useState<string | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<number | null>(null);

  const { data: chat } = useChat(activeChatId);
  const { data: allChats } = useChats();
  // Game mode loads ALL messages (no pagination) so the in-game log
  // shows the full session history instead of only the latest page.
  const isGameChat = (chat as unknown as { mode?: string })?.mode === "game";
  const {
    data: msgData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useChatMessages(activeChatId, isGameChat ? 0 : messagesPerPage);
  const messages = useMemo<MessageWithSwipes[] | undefined>(
    () => (msgData ? [...msgData.pages].reverse().flat() : undefined),
    [msgData],
  );
  const { data: messageCountData } = useChatMessageCount(activeChatId);
  const totalMessageCount = messageCountData?.count ?? messages?.length ?? 0;
  const messageOffset = messages ? totalMessageCount - messages.length : 0;
  const messageIdByOrderIndex = useMemo(() => {
    const map = new Map<number, string>();
    if (!messages) return map;
    messages.forEach((message, index) => {
      map.set(messageOffset + index, message.id);
    });
    return map;
  }, [messageOffset, messages]);
  const _messageOrderIndexById = useMemo(() => {
    const map = new Map<string, number>();
    if (!messages) return map;
    messages.forEach((message, index) => {
      map.set(message.id, messageOffset + index);
    });
    return map;
  }, [messageOffset, messages]);
  const { data: allCharacters } = useCharacters();
  const { data: allPersonas } = usePersonas();
  const { data: connections } = useConnections();
  const deleteMessage = useDeleteMessage(activeChatId);
  const deleteMessages = useDeleteMessages(activeChatId);
  const deleteSwipe = useDeleteSwipe(activeChatId);
  const updateMessage = useUpdateMessage(activeChatId);
  const updateMessageExtra = useUpdateMessageExtra(activeChatId);
  const peekPrompt = usePeekPrompt();
  const createChat = useCreateChat();
  const branchChat = useBranchChat();
  const { generate, retryAgents } = useGenerate();
  const setActiveSwipe = useSetActiveSwipe(activeChatId);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const pendingNewChatMode = useChatStore((s) => s.pendingNewChatMode);
  const failedAgentTypes = useAgentStore((s) => s.failedAgentTypes);
  const agentProcessing = useAgentStore((s) => s.isProcessing);

  const handleQuickStart = useCallback(
    (mode: "conversation" | "roleplay" | "game") => {
      const connectionRows = ((connections ?? []) as Array<{ id: string }>).filter((connection) => !!connection.id);
      if (connectionRows.length === 0) {
        useChatStore.getState().setPendingNewChatMode(mode);
        return;
      }

      const label = mode === "conversation" ? "Conversation" : mode === "game" ? "Game" : "Roleplay";
      createChat.mutate(
        { name: `New ${label}`, mode, characterIds: [] },
        {
          onSuccess: (chat) => {
            useChatStore.getState().setActiveChatId(chat.id);
            useChatStore.getState().setShouldOpenSettings(true);
            useChatStore.getState().setShouldOpenWizard(true);
          },
        },
      );
    },
    [connections, createChat],
  );

  // Build character lookup map
  const characterMap: CharacterMap = useMemo(() => {
    const map: CharacterMap = new Map();
    if (!allCharacters) return map;
    for (const char of allCharacters as Array<{ id: string; data: string; avatarPath: string | null }>) {
      try {
        const parsed = typeof char.data === "string" ? JSON.parse(char.data) : char.data;
        map.set(char.id, {
          name: parsed.name ?? "Unknown",
          avatarUrl: char.avatarPath ?? null,
          nameColor: parsed.extensions?.nameColor || undefined,
          dialogueColor: parsed.extensions?.dialogueColor || undefined,
          boxColor: parsed.extensions?.boxColor || undefined,
          avatarCrop: parsed.extensions?.avatarCrop || null,
          conversationStatus: parsed.extensions?.conversationStatus || undefined,
          conversationActivity: parsed.extensions?.conversationActivity || undefined,
        });
      } catch {
        map.set(char.id, { name: "Unknown", avatarUrl: null });
      }
    }
    return map;
  }, [allCharacters]);

  // Character IDs in the active chat
  const chatCharIds: string[] = useMemo(
    () =>
      chat
        ? typeof (chat as unknown as { characterIds: unknown }).characterIds === "string"
          ? JSON.parse((chat as unknown as { characterIds: string }).characterIds)
          : (chat.characterIds ?? [])
        : [],
    [chat],
  );

  const characterNames = useMemo(
    () => chatCharIds.map((id) => characterMap.get(id)?.name).filter((n): n is string => !!n),
    [characterMap, chatCharIds],
  );

  // Active persona info (for user message styling: name, avatar, colors)
  const personaInfo = useMemo(() => {
    if (!allPersonas) return undefined;
    const personas = allPersonas as Array<{
      id: string;
      isActive: string | boolean;
      name: string;
      avatarPath?: string | null;
      nameColor?: string;
      dialogueColor?: string;
      boxColor?: string;
    }>;
    // Prefer per-chat personaId, fall back to globally active persona
    // (Game mode skips the fallback — persona must be explicitly selected)
    const chatPersonaId = (chat as unknown as { personaId?: string | null })?.personaId;
    const isGame = (chat as unknown as { mode?: string })?.mode === "game";
    const persona =
      (chatPersonaId ? personas.find((p) => p.id === chatPersonaId) : null) ??
      (!isGame ? personas.find((p) => p.isActive === "true" || p.isActive === true) : null);
    if (!persona) return undefined;
    return {
      name: persona.name,
      avatarUrl: persona.avatarPath || undefined,
      nameColor: persona.nameColor || undefined,
      dialogueColor: persona.dialogueColor || undefined,
      boxColor: persona.boxColor || undefined,
    };
  }, [allPersonas, chat]);

  // Remember the last known chat mode so that a transient `undefined` from
  // React Query (cache invalidation, Suspense remount, concurrent batching)
  // doesn't reset the layout from roleplay to conversation mid-session.
  const lastModeRef = useRef<string>("conversation");
  const rawMode = (chat as unknown as { mode?: string })?.mode;
  if (rawMode) lastModeRef.current = rawMode;
  const chatMode = rawMode ?? lastModeRef.current;
  const isRoleplay = chatMode === "roleplay" || chatMode === "visual_novel";
  const { startEncounter } = useEncounter();
  const { concludeScene, abandonScene } = useScene();
  const encounterActive = useEncounterStore((s) => s.active || s.showConfigModal);

  // Sprite sidebar settings from chat metadata
  const chatMeta = useMemo(() => {
    if (!chat) return {};
    const raw = (chat as unknown as { metadata?: string | Record<string, unknown> }).metadata;
    return typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
  }, [chat]);
  const spriteCharacterIds: string[] = Array.isArray(chatMeta.spriteCharacterIds) ? chatMeta.spriteCharacterIds : [];
  const spritePosition: SpriteSide = chatMeta.spritePosition === "right" ? "right" : "left";
  const spritePlacements = useMemo(
    () => normalizeSpritePlacements(chatMeta.spritePlacements),
    [chatMeta.spritePlacements],
  );
  const hasCustomSpritePlacements = Object.keys(spritePlacements).length > 0;
  // Prefer per-swipe expressions from the last assistant message's extra (survives swipe switching),
  // falling back to chat-level metadata for backward compatibility.
  const spriteExpressions: Record<string, string> = useMemo(() => {
    if (messages?.length) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]!;
        if (m.role === "assistant") {
          const extra = typeof m.extra === "string" ? JSON.parse(m.extra) : (m.extra ?? {});
          if (extra.spriteExpressions && Object.keys(extra.spriteExpressions).length > 0) {
            return extra.spriteExpressions as Record<string, string>;
          }
          break; // only check the last assistant message
        }
      }
    }
    return chatMeta.spriteExpressions ?? {};
  }, [messages, chatMeta.spriteExpressions]);
  const groupChatMode: string | undefined = chatCharIds.length > 1 ? (chatMeta.groupChatMode ?? "merged") : undefined;

  const updateMeta = useUpdateChatMetadata();
  const summaryContextSize: number = (chatMeta.summaryContextSize as number) ?? 50;
  const handleSummaryContextSizeChange = useCallback(
    (size: number) => {
      if (chat?.id) updateMeta.mutate({ id: chat.id, summaryContextSize: size });
    },
    [chat?.id, updateMeta],
  );

  // Sync translation config from chat metadata to the translation store
  useEffect(() => {
    if (!chat?.id) return;
    useTranslationStore.getState().setConfig({
      provider: chatMeta.translationProvider ?? "google",
      targetLanguage: chatMeta.translationTargetLang ?? "en",
      connectionId: chatMeta.translationConnectionId,
      deeplApiKey: chatMeta.translationDeeplApiKey,
      deeplxUrl: chatMeta.translationDeeplxUrl,
    });
  }, [
    chat?.id,
    chatMeta.translationProvider,
    chatMeta.translationTargetLang,
    chatMeta.translationConnectionId,
    chatMeta.translationDeeplApiKey,
    chatMeta.translationDeeplxUrl,
  ]);

  // On chat switch, clear in-memory translations and seed from persisted extras.
  // Also re-seed when new pages are fetched (pagination) so older persisted
  // translations become visible.
  const msgPageCount = msgData?.pages.length ?? 0;
  const prevChatIdRef = useRef(chat?.id);
  useEffect(() => {
    if (!messages) return;
    // Clear on actual chat switch
    if (prevChatIdRef.current !== chat?.id) {
      useTranslationStore.getState().clearAll();
      prevChatIdRef.current = chat?.id;
    }
    useTranslationStore
      .getState()
      .seedFromMessages(messages as unknown as Array<{ id: string; extra?: string | Record<string, unknown> | null }>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id, msgPageCount]);

  // Restore per-chat background from metadata when switching chats.
  // If the new chat has a saved background, apply it; otherwise keep the current
  // background so newly-created chats don't flash to black.
  useEffect(() => {
    const bg = chatMeta.background as string | undefined;
    if (bg) {
      useUIStore.getState().setChatBackground(`/api/backgrounds/file/${encodeURIComponent(bg)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id]);

  // Persist background choice to chat metadata so it survives page refresh.
  // Catches all sources: manual picker, background agent, scene commands, slash commands.
  // Only persist non-null backgrounds — never write null to metadata (avoids wiping
  // the user's background when opening a new chat that hasn't had one set yet).
  const bgPersistTimer = useRef<ReturnType<typeof setTimeout>>(null);
  useEffect(() => {
    if (!chat?.id || !chatBackground) return;
    const filename = decodeURIComponent(chatBackground.replace(/^\/api\/backgrounds\/file\//, ""));
    // Skip if metadata already matches (avoids pointless writes on restore)
    if (filename === (chatMeta.background ?? null)) return;
    if (bgPersistTimer.current) clearTimeout(bgPersistTimer.current);
    bgPersistTimer.current = setTimeout(() => {
      updateMeta.mutate({ id: chat!.id, background: filename });
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatBackground, chat?.id]);
  useEffect(() => {
    return () => {
      if (bgPersistTimer.current) clearTimeout(bgPersistTimer.current);
    };
  }, []);

  const expressionSaveTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const spritePlacementSaveTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const pendingExpressions = useRef<Record<string, string>>(spriteExpressions);
  const pendingSpritePlacements = useRef<Record<string, SpritePlacement>>(spritePlacements);

  useEffect(() => {
    pendingExpressions.current = spriteExpressions;
  }, [spriteExpressions]);

  useEffect(() => {
    pendingSpritePlacements.current = spritePlacements;
  }, [spritePlacements]);

  useEffect(() => {
    setSpriteArrangeMode(false);
  }, [chat?.id]);

  // Clean up expression save timer on unmount
  useEffect(() => {
    return () => {
      if (expressionSaveTimer.current) clearTimeout(expressionSaveTimer.current);
      if (spritePlacementSaveTimer.current) clearTimeout(spritePlacementSaveTimer.current);
    };
  }, []);

  const handleExpressionChange = useCallback(
    (characterId: string, expression: string) => {
      if (!chat?.id) return;
      pendingExpressions.current = { ...pendingExpressions.current, [characterId]: expression };
      if (expressionSaveTimer.current) clearTimeout(expressionSaveTimer.current);
      expressionSaveTimer.current = setTimeout(() => {
        updateMeta.mutate({ id: chat!.id, spriteExpressions: pendingExpressions.current });
        // Also persist to the last assistant message's extra so it's per-swipe
        if (messages?.length) {
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i]!;
            if (m.role === "assistant") {
              updateMessageExtra.mutate({
                messageId: m.id,
                extra: { spriteExpressions: pendingExpressions.current },
              });
              break;
            }
          }
        }
      }, 1000);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat?.id, updateMeta, messages, updateMessageExtra],
  );

  const handleSpritePlacementChange = useCallback(
    (characterId: string, placement: SpritePlacement) => {
      if (!chat?.id) return;
      pendingSpritePlacements.current = { ...pendingSpritePlacements.current, [characterId]: placement };
      if (spritePlacementSaveTimer.current) clearTimeout(spritePlacementSaveTimer.current);
      spritePlacementSaveTimer.current = setTimeout(() => {
        updateMeta.mutate({ id: chat.id, spritePlacements: pendingSpritePlacements.current });
      }, 250);
    },
    [chat?.id, updateMeta],
  );

  const handleResetSpritePlacements = useCallback(() => {
    if (!chat?.id) return;
    pendingSpritePlacements.current = {};
    if (spritePlacementSaveTimer.current) clearTimeout(spritePlacementSaveTimer.current);
    updateMeta.mutate({ id: chat.id, spritePlacements: {} });
  }, [chat?.id, updateMeta]);

  const handleSetSpritePosition = useCallback(
    (nextSide: SpriteSide) => {
      if (!chat?.id || nextSide === spritePosition) return;
      const nextPlacements = hasCustomSpritePlacements ? mirrorSpritePlacements(spritePlacements) : spritePlacements;
      pendingSpritePlacements.current = nextPlacements;
      if (spritePlacementSaveTimer.current) clearTimeout(spritePlacementSaveTimer.current);
      updateMeta.mutate({
        id: chat.id,
        spritePosition: nextSide,
        spritePlacements: nextPlacements,
      });
    },
    [chat?.id, hasCustomSpritePlacements, spritePlacements, spritePosition, updateMeta],
  );

  const handleToggleSpritePosition = useCallback(() => {
    handleSetSpritePosition(spritePosition === "left" ? "right" : "left");
  }, [handleSetSpritePosition, spritePosition]);

  // Set of enabled agent type IDs (respects both global enableAgents toggle and per-chat agent list)
  const enabledAgentTypes = useMemo(() => {
    const set = new Set<string>();
    if (!chatMeta.enableAgents) return set;
    const activeAgentIds: string[] = Array.isArray(chatMeta.activeAgentIds) ? chatMeta.activeAgentIds : [];
    // Only show widgets for agents explicitly added to this chat
    for (const id of activeAgentIds) set.add(id);
    return set;
  }, [chatMeta.enableAgents, chatMeta.activeAgentIds]);

  const combatAgentEnabled = enabledAgentTypes.has("combat");
  const expressionAgentEnabled = enabledAgentTypes.has("expression");

  const handleDelete = useCallback((messageId: string) => {
    setDeleteDialogMessageId(messageId);
  }, []);

  const deleteDialogMessage = useMemo(
    () => messages?.find((message) => message.id === deleteDialogMessageId) ?? null,
    [deleteDialogMessageId, messages],
  );
  const deleteDialogCanDeleteSwipe = (deleteDialogMessage?.swipeCount ?? 0) > 1;
  const deleteDialogActiveSwipeIndex = deleteDialogMessage?.activeSwipeIndex ?? 0;
  const deleteDialogSwipeCount = deleteDialogMessage?.swipeCount ?? 0;

  const handleDeleteConfirm = useCallback(() => {
    if (deleteDialogMessageId) {
      deleteMessage.mutate(deleteDialogMessageId);
    }
    setDeleteDialogMessageId(null);
  }, [deleteDialogMessageId, deleteMessage]);

  const handleDeleteSwipe = useCallback(() => {
    if (deleteDialogMessageId && deleteDialogCanDeleteSwipe) {
      deleteSwipe.mutate({ messageId: deleteDialogMessageId, index: deleteDialogActiveSwipeIndex });
    }
    setDeleteDialogMessageId(null);
  }, [deleteDialogActiveSwipeIndex, deleteDialogCanDeleteSwipe, deleteDialogMessageId, deleteSwipe]);

  const handleDeleteMore = useCallback(() => {
    if (deleteDialogMessageId) {
      const startIdx = messages?.findIndex((m) => m.id === deleteDialogMessageId) ?? -1;
      if (messages && startIdx >= 0) {
        const ids = new Set<string>();
        for (let i = startIdx; i < messages.length; i++) ids.add(messages[i]!.id);
        setSelectedMessageIds(ids);
      } else {
        setSelectedMessageIds(new Set([deleteDialogMessageId]));
      }
    }
    setDeleteDialogMessageId(null);
    setMultiSelectMode(true);
  }, [deleteDialogMessageId, messages]);

  const handleToggleSelectMessage = useCallback(
    (toggle: MessageSelectionToggle) => {
      const { messageId, orderIndex, checked, shiftKey } = toggle;
      setSelectedMessageIds((prev) => {
        const next = new Set(prev);
        if (shiftKey && selectionAnchorIndex != null) {
          const start = Math.min(selectionAnchorIndex, orderIndex);
          const end = Math.max(selectionAnchorIndex, orderIndex);
          for (let current = start; current <= end; current++) {
            const rangeMessageId = messageIdByOrderIndex.get(current);
            if (!rangeMessageId) continue;
            if (checked) next.add(rangeMessageId);
            else next.delete(rangeMessageId);
          }
        } else {
          if (checked) next.add(messageId);
          else next.delete(messageId);
        }
        return next;
      });
      if (!shiftKey || selectionAnchorIndex == null) {
        setSelectionAnchorIndex(orderIndex);
      }
    },
    [messageIdByOrderIndex, selectionAnchorIndex],
  );

  const handleBulkDelete = useCallback(() => {
    if (selectedMessageIds.size > 0) {
      deleteMessages.mutate([...selectedMessageIds]);
    }
    setMultiSelectMode(false);
    setSelectedMessageIds(new Set());
    setSelectionAnchorIndex(null);
  }, [selectedMessageIds, deleteMessages]);

  const handleCancelMultiSelect = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedMessageIds(new Set());
    setSelectionAnchorIndex(null);
  }, []);

  useEffect(() => {
    setMultiSelectMode(false);
    setSelectedMessageIds(new Set());
    setSelectionAnchorIndex(null);
  }, [activeChatId]);

  const handleUnselectAllMessages = useCallback(() => {
    setSelectedMessageIds(new Set());
  }, []);

  const handleSelectAllAboveSelection = useCallback(() => {
    if (!messages || messages.length === 0) return;
    setSelectedMessageIds((prev) => {
      if (prev.size === 0) return prev;
      let firstIdx = -1;
      for (let i = 0; i < messages.length; i++) {
        if (prev.has(messages[i]!.id)) {
          firstIdx = i;
          break;
        }
      }
      if (firstIdx <= 0) return prev;
      const next = new Set(prev);
      for (let i = 0; i < firstIdx; i++) next.add(messages[i]!.id);
      return next;
    });
  }, [messages]);

  const handleSelectAllBelowSelection = useCallback(() => {
    if (!messages || messages.length === 0) return;
    setSelectedMessageIds((prev) => {
      if (prev.size === 0) return prev;
      let lastIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (prev.has(messages[i]!.id)) {
          lastIdx = i;
          break;
        }
      }
      if (lastIdx < 0 || lastIdx >= messages.length - 1) return prev;
      const next = new Set(prev);
      for (let i = lastIdx + 1; i < messages.length; i++) next.add(messages[i]!.id);
      return next;
    });
  }, [messages]);

  const handleRegenerate = useCallback(
    async (messageId: string) => {
      if (!activeChatId || isStreaming) return;
      // On touch devices, confirm to prevent accidental taps
      if (
        matchMedia("(pointer: coarse)").matches &&
        !(await showConfirmDialog({
          title: "Regenerate Message",
          message: "Regenerate this message as a new swipe?",
          confirmLabel: "Regenerate",
        }))
      ) {
        return;
      }
      try {
        // Regenerate as a new swipe on the existing message
        await generate({ chatId: activeChatId, connectionId: null, regenerateMessageId: messageId });
      } catch {
        // Error toast is shown by the generate hook
      }
    },
    [activeChatId, isStreaming, generate],
  );

  const _handleRetryAgents = useCallback(async () => {
    if (!activeChatId || isStreaming || agentProcessing || failedAgentTypes.length === 0) return;
    await retryAgents(activeChatId, failedAgentTypes);
  }, [activeChatId, isStreaming, agentProcessing, failedAgentTypes, retryAgents]);

  const handleRerunTrackers = useCallback(async () => {
    if (!activeChatId || isStreaming || agentProcessing) return;
    const trackerIds = new Set(BUILT_IN_AGENTS.filter((a) => a.category === "tracker").map((a) => a.id));
    const types = Array.from(enabledAgentTypes).filter((t) => trackerIds.has(t));
    if (types.length === 0) return;
    await retryAgents(activeChatId, types);
  }, [activeChatId, isStreaming, agentProcessing, enabledAgentTypes, retryAgents]);

  const handleSetActiveSwipe = useCallback(
    (messageId: string, index: number) => {
      setActiveSwipe.mutate(
        { messageId, index },
        {
          onSuccess: () => {
            // Refetch game state so the HUD shows trackers for the active swipe
            if (activeChatId) {
              api
                .get<import("@marinara-engine/shared").GameState | null>(`/chats/${activeChatId}/game-state`)
                .then((gs) => {
                  useGameStateStore.getState().setGameState(gs ?? null);
                })
                .catch(() => {});
            }
          },
        },
      );
    },
    [setActiveSwipe, activeChatId],
  );

  const handleEdit = useCallback(
    (messageId: string, content: string) => {
      updateMessage.mutate({ messageId, content });
    },
    [updateMessage],
  );

  const handleToggleConversationStart = useCallback(
    (messageId: string, current: boolean) => {
      updateMessageExtra.mutate({ messageId, extra: { isConversationStart: !current } });
    },
    [updateMessageExtra],
  );

  const handleBranch = useCallback(
    (messageId: string) => {
      if (!activeChatId) return;
      branchChat.mutate(
        { chatId: activeChatId, upToMessageId: messageId },
        {
          onSuccess: (newChat) => {
            if (newChat) useChatStore.getState().setActiveChatId(newChat.id);
          },
        },
      );
    },
    [activeChatId, branchChat],
  );

  // Peek prompt state
  const [peekPromptData, setPeekPromptData] = useState<PeekPromptData | null>(null);

  const handlePeekPrompt = useCallback(() => {
    if (!activeChatId) return;
    peekPrompt.mutate(activeChatId, {
      onSuccess: (data) => setPeekPromptData(data),
    });
  }, [activeChatId, peekPrompt]);

  // Find the last assistant message for peek-prompt eligibility
  const lastAssistantMessageId = useMemo(() => {
    if (!messages) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "assistant") return messages[i]!.id;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (chat) useChatStore.getState().setActiveChat(chat);
  }, [chat]);

  // Reset stagger animation flag when switching chats
  useEffect(() => {
    hasAnimatedRef.current = false;
  }, [activeChatId]);

  // Auto-open settings drawer for newly created chats
  const shouldOpenSettings = useChatStore((s) => s.shouldOpenSettings);
  const shouldOpenWizard = useChatStore((s) => s.shouldOpenWizard);
  useEffect(() => {
    if (shouldOpenSettings && activeChatId) {
      if (shouldOpenWizard) {
        setWizardOpen(true);
        useChatStore.getState().setShouldOpenWizard(false);
      } else {
        setSettingsOpen(true);
      }
      useChatStore.getState().setShouldOpenSettings(false);
    }
  }, [shouldOpenSettings, shouldOpenWizard, activeChatId]);

  // Auto-scroll on new messages / streaming (but not on "load more")
  // Only scroll if user is already near the bottom (within 150px).
  // During streaming, if the user scrolls (wheel, touch, or upward scroll),
  // stop auto-scrolling until they manually scroll back to the bottom.
  const isNearBottomRef = useRef(true);
  const userScrolledAwayRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const userScrolledAtRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distFromBottom < 150;

      // Detect intentional upward scroll during streaming
      if (isStreaming && el.scrollTop < lastScrollTopRef.current - 10) {
        userScrolledAwayRef.current = true;
      }
      // Re-engage auto-scroll when the user returns to the bottom,
      // but only if enough time has passed since their last wheel/touch
      // input. Without this cooldown, in-flight smooth-scroll animations
      // fire scroll events that immediately re-engage auto-scroll.
      if (nearBottom && Date.now() - userScrolledAtRef.current > 300) {
        userScrolledAwayRef.current = false;
      }

      lastScrollTopRef.current = el.scrollTop;
      isNearBottomRef.current = nearBottom;
    };

    // Wheel / touch: immediately disengage auto-scroll during streaming
    // so the user can read without being dragged to the bottom.
    const onUserScroll = () => {
      if (isStreaming) {
        userScrolledAwayRef.current = true;
        userScrolledAtRef.current = Date.now();
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onUserScroll, { passive: true });
    el.addEventListener("touchmove", onUserScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onUserScroll);
      el.removeEventListener("touchmove", onUserScroll);
    };
  }, [isStreaming]);

  // Reset scroll-away flag when streaming ends
  useEffect(() => {
    if (!isStreaming) userScrolledAwayRef.current = false;
  }, [isStreaming]);

  const newestMsgId = msgData?.pages[0]?.[msgData.pages[0].length - 1]?.id;
  const newestMsgSwipeIndex = msgData?.pages[0]?.[msgData.pages[0].length - 1]?.activeSwipeIndex;
  const isOptimistic = newestMsgId?.startsWith("__optimistic_");
  useEffect(() => {
    if (isLoadingMoreRef.current) return;
    // Always scroll when the user just sent a message (optimistic msg)
    if (isOptimistic || (isNearBottomRef.current && !userScrolledAwayRef.current)) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [newestMsgId, newestMsgSwipeIndex, isStreaming, isOptimistic]);

  // Auto-scroll on streamBuffer changes without causing ChatArea re-render.
  // Uses a store subscription so the hot per-token updates bypass React.
  useEffect(() => {
    let prev = useChatStore.getState().streamBuffer;
    const unsub = useChatStore.subscribe((state) => {
      if (state.streamBuffer !== prev) {
        prev = state.streamBuffer;
        if (!isLoadingMoreRef.current && isNearBottomRef.current && !userScrolledAwayRef.current) {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      }
    });
    return unsub;
  }, []);

  // Preserve scroll position when older messages are prepended
  const pageCount = msgData?.pages.length ?? 0;
  useLayoutEffect(() => {
    if (isLoadingMoreRef.current && scrollRef.current && !isFetchingNextPage) {
      const newScrollHeight = scrollRef.current.scrollHeight;
      scrollRef.current.scrollTop += newScrollHeight - prevScrollHeightRef.current;
      isLoadingMoreRef.current = false;
    }
  }, [pageCount, isFetchingNextPage]);

  const handleLoadMore = useCallback(() => {
    if (!scrollRef.current || !hasNextPage || isFetchingNextPage) return;
    prevScrollHeightRef.current = scrollRef.current.scrollHeight;
    isLoadingMoreRef.current = true;
    fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // ═══════════════════════════════════════════════
  // Empty state (no active chat)
  // ═══════════════════════════════════════════════
  if (!activeChatId) {
    const showEmptyStateEffects = isPageActive;

    return (
      <>
        <div
          data-component="ChatArea.EmptyState"
          className="flex flex-1 flex-col items-center overflow-y-auto p-4 sm:p-8"
        >
          <div className="flex w-full max-w-md flex-col items-center gap-4 sm:gap-6 my-auto py-4">
            {/* Central hero */}
            <div className="relative">
              <div
                className={cn(
                  "flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl shadow-xl shadow-orange-500/20 sm:h-20 sm:w-20",
                  showEmptyStateEffects && "animate-pulse-ring bunny-glow",
                )}
              >
                <img
                  src={showEmptyStateEffects ? "/logo-splash.gif" : "/logo.png"}
                  alt="Marinara Engine"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>

            <div className="text-center">
              <h3 className="retro-glow-text text-base sm:text-xl font-bold tracking-tight">✧ Marinara Engine ✧</h3>
              <p className="mt-1.5 sm:mt-2 max-w-xs text-xs sm:text-sm text-[var(--muted-foreground)]">
                To get started, choose the type of chat you'd like to have with the AI
              </p>
            </div>

            <div
              className={cn(
                "flex flex-wrap justify-center gap-2 sm:gap-3",
                showEmptyStateEffects && "stagger-children",
              )}
            >
              <QuickStartCard
                icon={<MessageSquare size="1.125rem" />}
                label="Conversation"
                bg="linear-gradient(135deg, #4de5dd, #3ab8b1)"
                shadowColor="rgba(77,229,221,0.15)"
                tooltip="General chat with one or more characters, or a model itself"
                onClick={() => handleQuickStart("conversation")}
              />
              <QuickStartCard
                icon={<BookOpen size="1.125rem" />}
                label="Roleplay"
                bg="linear-gradient(135deg, #eb8951, #d97530)"
                shadowColor="rgba(235,137,81,0.15)"
                tooltip="For roleplaying or creative writing with one or more characters"
                onClick={() => handleQuickStart("roleplay")}
              />
              <QuickStartCard
                icon={<Theater size="1.125rem" />}
                label="Game"
                bg="linear-gradient(135deg, #e15c8c, #c94776)"
                shadowColor="rgba(225,92,140,0.15)"
                tooltip="AI-managed singleplayer RPG with a Game Master, party, dice, maps, and quests"
                onClick={() => handleQuickStart("game")}
              />
            </div>

            {/* Recent Chats */}
            <RecentChats />

            <div
              className={cn(
                "w-48",
                showEmptyStateEffects ? "retro-divider" : "h-px rounded-[1px] bg-[var(--border)]/40",
              )}
            />

            {/* Footer */}
            <div className="mt-2 flex flex-col items-center gap-3">
              <p className="text-xs text-[var(--muted-foreground)]/60">
                Created by{" "}
                <a
                  href="https://spicymarinara.github.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-[var(--muted-foreground)]/30 hover:text-[var(--primary)] hover:decoration-[var(--primary)]/40 transition-colors"
                >
                  Marinara
                </a>
              </p>
              <p className="text-[0.625rem] text-[var(--muted-foreground)]/50">
                Partnered with{" "}
                <a
                  href="https://linkapi.ai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-[var(--muted-foreground)]/30 hover:text-[var(--primary)] hover:decoration-[var(--primary)]/40 transition-colors"
                >
                  LinkAPI
                </a>
              </p>
              <p className="text-[0.625rem] text-[var(--muted-foreground)]/50">
                Art and logo by{" "}
                <a
                  href="https://huntercolliex.carrd.co/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-[var(--muted-foreground)]/30 hover:text-[var(--primary)] hover:decoration-[var(--primary)]/40 transition-colors"
                >
                  Huntercolliex
                </a>
              </p>
              <div className="flex gap-2">
                <a
                  href="https://discord.com/invite/KdAkTg94ME"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                >
                  <svg width="0.875rem" height="0.875rem" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
                  </svg>
                  Discord
                </a>
                <a
                  href="https://ko-fi.com/marinara_spaghetti"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/60 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)]/40 hover:text-[var(--primary)]"
                >
                  <svg width="0.875rem" height="0.875rem" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                  </svg>
                  Support
                </a>
              </div>

              {/* Special thanks */}
              <p className="mt-1 max-w-xs text-center text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]/40">
                Special thanks to MuniMuni, Guybrush01, Joshellis625, LukaTheHero, Coxde, JorgeLTE, Seele The Seal King,
                Loungemeister, Kale, Tabris, GREGOR OVECH, Coins, Tacoman, Jorge, Promansis, Kitsumiro, Sheep, Pod042,
                Prolix, PlutoMayhem, Mezzeh, Kuc0, Exalted, Yang Best Girl, MidnightSleeper, Geechan, TheLonelyDevil,
                Artus, and you!
              </p>

              {/* Restart tutorial */}
              <button
                onClick={() => useUIStore.getState().setHasCompletedOnboarding(false)}
                className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.625rem] text-[var(--muted-foreground)]/40 transition-colors hover:text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/60"
                title="Replay tutorial"
              >
                <HelpCircle size="0.75rem" />
                Replay Tutorial
              </button>

              <p className="mt-2 text-[0.625rem] tracking-wide text-[var(--muted-foreground)]/30">v{APP_VERSION}</p>
            </div>
          </div>
        </div>
        {pendingNewChatMode && (
          <NewChatConnectionGate
            mode={pendingNewChatMode}
            onClose={() => useChatStore.getState().setPendingNewChatMode(null)}
          />
        )}
      </>
    );
  }

  // Helper: is this message grouped with the previous one?
  const isGrouped = (i: number) => {
    if (i === 0 || !messages) return false;
    const prev = messages[i - 1];
    const curr = messages[i];
    if (prev.role !== curr.role || prev.characterId !== curr.characterId) return false;
    // Break grouping when persona changes between consecutive user messages
    if (prev.role === "user" && curr.role === "user") {
      const prevExtra = typeof prev.extra === "string" ? JSON.parse(prev.extra) : (prev.extra ?? {});
      const currExtra = typeof curr.extra === "string" ? JSON.parse(curr.extra) : (curr.extra ?? {});
      const prevId = prevExtra.personaSnapshot?.personaId;
      const currId = currExtra.personaSnapshot?.personaId;
      if (prevId && currId && prevId !== currId) return false;
    }
    return true;
  };

  // ═══════════════════════════════════════════════
  // Unified layout — mode-aware rendering
  // ═══════════════════════════════════════════════
  const msgPayload = (messages ?? []).map((m) => ({ role: m.role, characterId: m.characterId, content: m.content }));
  const chatList = (allChats as Array<{ id: string; name: string }> | undefined) ?? [];
  const connectedChatName = chat?.connectedChatId
    ? chatList.find((item) => item.id === chat.connectedChatId)?.name
    : undefined;
  const isSceneChat = chatMeta.sceneStatus === "active" || Boolean(chatMeta.sceneOriginChatId);
  const conversationSceneInfo =
    chatMeta.activeSceneChatId && chatList.some((item) => item.id === chatMeta.activeSceneChatId)
      ? { variant: "origin" as const, sceneChatId: chatMeta.activeSceneChatId }
      : chatMeta.sceneStatus === "active"
        ? {
            variant: "scene" as const,
            sceneChatId: activeChatId,
            originChatId: chatMeta.sceneOriginChatId,
            description: chatMeta.sceneDescription,
          }
        : undefined;
  const surfaceFallback = <div className="flex flex-1 overflow-hidden" />;

  // ═══════════════════════════════════════════════
  // Game mode — RPG surface with GM narration, map, party chat
  // ═══════════════════════════════════════════════
  if (chatMode === "game") {
    const gameCharacters = allCharacters
      ? (allCharacters as Array<{ id: string; data: string; avatarPath: string | null }>).map((c) => {
          try {
            const parsed = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
            return {
              id: c.id,
              name: parsed.name ?? "Unknown",
              avatarUrl: c.avatarPath ?? undefined,
              description: parsed.description ?? "",
              personality: parsed.personality ?? "",
              backstory: parsed.extensions?.backstory ?? "",
              appearance: parsed.extensions?.appearance ?? "",
              tags: parsed.tags ?? [],
            };
          } catch {
            return { id: c.id, name: "Unknown" };
          }
        })
      : [];

    return (
      <Suspense fallback={surfaceFallback}>
        <>
          <GameSurface
            activeChatId={activeChatId}
            chat={chat!}
            chatMeta={chatMeta}
            messages={messages ?? []}
            isStreaming={isStreaming}
            isMessagesLoading={isLoading}
            characterMap={characterMap}
            characters={gameCharacters}
            personaInfo={personaInfo}
            chatBackground={chatBackground}
            onOpenSettings={() => setSettingsOpen(true)}
            onDeleteMessage={handleDelete}
          />

          <ChatCommonOverlays
            chat={chat}
            activeChatId={activeChatId}
            settingsOpen={settingsOpen}
            filesOpen={filesOpen}
            galleryOpen={galleryOpen}
            wizardOpen={wizardOpen}
            peekPromptData={peekPromptData}
            deleteDialogMessageId={deleteDialogMessageId}
            deleteDialogCanDeleteSwipe={deleteDialogCanDeleteSwipe}
            deleteDialogActiveSwipeIndex={deleteDialogActiveSwipeIndex}
            deleteDialogSwipeCount={deleteDialogSwipeCount}
            multiSelectMode={multiSelectMode}
            selectedMessageCount={selectedMessageIds.size}
            sceneSettings={{
              spriteArrangeMode,
              onToggleSpriteArrange: () => setSpriteArrangeMode((prev) => !prev),
              onResetSpritePlacements: handleResetSpritePlacements,
              onSpriteSideChange: handleSetSpritePosition,
            }}
            onCloseSettings={() => setSettingsOpen(false)}
            onCloseFiles={() => setFilesOpen(false)}
            onCloseGallery={() => setGalleryOpen(false)}
            onIllustrate={() => retryAgents(activeChatId, ["illustrator"])}
            onWizardFinish={() => {
              setWizardOpen(false);
              setSettingsOpen(true);
            }}
            onClosePeekPrompt={() => setPeekPromptData(null)}
            onDeleteConfirm={handleDeleteConfirm}
            onDeleteSwipe={handleDeleteSwipe}
            onDeleteMore={handleDeleteMore}
            onCloseDeleteDialog={() => setDeleteDialogMessageId(null)}
            onBulkDelete={handleBulkDelete}
            onCancelMultiSelect={handleCancelMultiSelect}
            onUnselectAllMessages={handleUnselectAllMessages}
            onSelectAllAboveSelection={handleSelectAllAboveSelection}
            onSelectAllBelowSelection={handleSelectAllBelowSelection}
          />
        </>
      </Suspense>
    );
  }

  // ═══════════════════════════════════════════════
  // Conversation mode — Discord-style layout
  // ═══════════════════════════════════════════════
  if (chatMode === "conversation") {
    return (
      <>
        <Suspense fallback={surfaceFallback}>
          <ChatConversationSurface
            activeChatId={activeChatId}
            chat={chat}
            messages={messages}
            isLoading={isLoading}
            hasNextPage={!!hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
            pageCount={pageCount}
            totalMessageCount={totalMessageCount}
            characterMap={characterMap}
            characterNames={characterNames}
            personaInfo={personaInfo}
            chatMeta={chatMeta}
            chatCharIds={chatCharIds}
            connectedChatName={connectedChatName}
            sceneInfo={conversationSceneInfo}
            settingsOpen={settingsOpen}
            filesOpen={filesOpen}
            galleryOpen={galleryOpen}
            wizardOpen={wizardOpen}
            peekPromptData={peekPromptData}
            deleteDialogMessageId={deleteDialogMessageId}
            deleteDialogCanDeleteSwipe={deleteDialogCanDeleteSwipe}
            deleteDialogActiveSwipeIndex={deleteDialogActiveSwipeIndex}
            deleteDialogSwipeCount={deleteDialogSwipeCount}
            multiSelectMode={multiSelectMode}
            selectedMessageIds={selectedMessageIds}
            spriteArrangeMode={spriteArrangeMode}
            onDelete={handleDelete}
            onRegenerate={handleRegenerate}
            onEdit={handleEdit}
            onSetActiveSwipe={handleSetActiveSwipe}
            onPeekPrompt={handlePeekPrompt}
            onToggleSelectMessage={handleToggleSelectMessage}
            onSwitchChat={chat?.connectedChatId ? () => setActiveChatId(chat.connectedChatId!) : undefined}
            onConcludeScene={chatMeta.sceneStatus === "active" ? () => concludeScene(activeChatId) : undefined}
            onAbandonScene={chatMeta.sceneStatus === "active" ? () => abandonScene(activeChatId) : undefined}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenFiles={() => setFilesOpen(true)}
            onOpenGallery={() => setGalleryOpen(true)}
            onCloseSettings={() => setSettingsOpen(false)}
            onCloseFiles={() => setFilesOpen(false)}
            onCloseGallery={() => setGalleryOpen(false)}
            onWizardFinish={() => {
              setWizardOpen(false);
              setSettingsOpen(true);
            }}
            onClosePeekPrompt={() => setPeekPromptData(null)}
            onResetSpritePlacements={handleResetSpritePlacements}
            onSpriteSideChange={handleSetSpritePosition}
            onToggleSpriteArrange={() => setSpriteArrangeMode((prev) => !prev)}
            onDeleteConfirm={handleDeleteConfirm}
            onDeleteSwipe={handleDeleteSwipe}
            onDeleteMore={handleDeleteMore}
            onCloseDeleteDialog={() => setDeleteDialogMessageId(null)}
            onBulkDelete={handleBulkDelete}
            onCancelMultiSelect={handleCancelMultiSelect}
            onUnselectAllMessages={handleUnselectAllMessages}
            onSelectAllAboveSelection={handleSelectAllAboveSelection}
            onSelectAllBelowSelection={handleSelectAllBelowSelection}
            lastAssistantMessageId={lastAssistantMessageId}
          />
        </Suspense>
        {pendingNewChatMode && (
          <NewChatConnectionGate
            mode={pendingNewChatMode}
            onClose={() => useChatStore.getState().setPendingNewChatMode(null)}
          />
        )}
      </>
    );
  }

  // ═══════════════════════════════════════════════
  // Roleplay / Visual Novel mode — existing layout
  // ═══════════════════════════════════════════════
  const shouldAnimateMessages = !hasAnimatedRef.current;
  if (messages?.length) hasAnimatedRef.current = true;

  return (
    <>
      <Suspense fallback={surfaceFallback}>
        <ChatRoleplaySurface
          activeChatId={activeChatId}
          chat={chat}
          allChats={chatList}
          chatMeta={chatMeta}
          chatMode={chatMode}
          isRoleplay={isRoleplay}
          centerCompact={centerCompact}
          chatBackground={chatBackground}
          weatherEffects={weatherEffects}
          expressionAgentEnabled={expressionAgentEnabled}
          combatAgentEnabled={combatAgentEnabled}
          encounterActive={encounterActive}
          spritePosition={spritePosition}
          spriteCharacterIds={spriteCharacterIds}
          spriteExpressions={spriteExpressions}
          spritePlacements={spritePlacements}
          hasCustomSpritePlacements={hasCustomSpritePlacements}
          spriteArrangeMode={spriteArrangeMode}
          enabledAgentTypes={enabledAgentTypes}
          chatCharIds={chatCharIds}
          characterMap={characterMap}
          characterNames={characterNames}
          personaInfo={personaInfo}
          messages={messages}
          msgPayload={msgPayload}
          isLoading={isLoading}
          hasNextPage={!!hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          isStreaming={isStreaming}
          regenerateMessageId={regenerateMessageId}
          shouldAnimateMessages={shouldAnimateMessages}
          summaryContextSize={summaryContextSize}
          totalMessageCount={totalMessageCount}
          lastAssistantMessageId={lastAssistantMessageId}
          settingsOpen={settingsOpen}
          filesOpen={filesOpen}
          galleryOpen={galleryOpen}
          wizardOpen={wizardOpen}
          peekPromptData={peekPromptData}
          deleteDialogMessageId={deleteDialogMessageId}
          deleteDialogCanDeleteSwipe={deleteDialogCanDeleteSwipe}
          deleteDialogActiveSwipeIndex={deleteDialogActiveSwipeIndex}
          deleteDialogSwipeCount={deleteDialogSwipeCount}
          multiSelectMode={multiSelectMode}
          selectedMessageIds={selectedMessageIds}
          groupChatMode={groupChatMode}
          scrollRef={scrollRef}
          messagesEndRef={messagesEndRef}
          onLoadMore={handleLoadMore}
          onDelete={handleDelete}
          onRegenerate={handleRegenerate}
          onEdit={handleEdit}
          onSetActiveSwipe={handleSetActiveSwipe}
          onToggleConversationStart={handleToggleConversationStart}
          onPeekPrompt={handlePeekPrompt}
          onBranch={isSceneChat ? undefined : handleBranch}
          onToggleSelectMessage={handleToggleSelectMessage}
          onSummaryContextSizeChange={handleSummaryContextSizeChange}
          onRerunTrackers={handleRerunTrackers}
          onStartEncounter={() => startEncounter()}
          onConcludeScene={() => concludeScene(activeChatId)}
          onAbandonScene={() => abandonScene(activeChatId)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenFiles={() => setFilesOpen(true)}
          onOpenGallery={() => setGalleryOpen(true)}
          onCloseSettings={() => setSettingsOpen(false)}
          onCloseFiles={() => setFilesOpen(false)}
          onCloseGallery={() => setGalleryOpen(false)}
          onIllustrate={() => retryAgents(activeChatId, ["illustrator"])}
          onWizardFinish={() => {
            setWizardOpen(false);
            setSettingsOpen(true);
          }}
          onClosePeekPrompt={() => setPeekPromptData(null)}
          onResetSpritePlacements={handleResetSpritePlacements}
          onSpriteSideChange={handleSetSpritePosition}
          onToggleSpriteArrange={() => setSpriteArrangeMode((prev) => !prev)}
          onToggleSpritePosition={handleToggleSpritePosition}
          onExpressionChange={handleExpressionChange}
          onSpritePlacementChange={handleSpritePlacementChange}
          onDeleteConfirm={handleDeleteConfirm}
          onDeleteSwipe={handleDeleteSwipe}
          onDeleteMore={handleDeleteMore}
          onCloseDeleteDialog={() => setDeleteDialogMessageId(null)}
          onBulkDelete={handleBulkDelete}
          onCancelMultiSelect={handleCancelMultiSelect}
          onUnselectAllMessages={handleUnselectAllMessages}
          onSelectAllAboveSelection={handleSelectAllAboveSelection}
          onSelectAllBelowSelection={handleSelectAllBelowSelection}
          isGrouped={isGrouped}
        />
      </Suspense>
      {pendingNewChatMode && (
        <NewChatConnectionGate
          mode={pendingNewChatMode}
          onClose={() => useChatStore.getState().setPendingNewChatMode(null)}
        />
      )}
    </>
  );
}

/** Animated typing indicator — three bouncing dots (currently unused, kept for future) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      <div className="flex items-center gap-1 rounded-xl bg-[var(--secondary)] px-4 py-2.5">
        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--muted-foreground)]/60 [animation-delay:0ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--muted-foreground)]/60 [animation-delay:150ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--muted-foreground)]/60 [animation-delay:300ms]" />
      </div>
    </div>
  );
}

function QuickStartCard({
  icon,
  label,
  bg,
  shadowColor,
  onClick,
  comingSoon,
  tooltip,
}: {
  icon: ReactNode;
  label: string;
  bg: string;
  shadowColor?: string;
  onClick?: () => void;
  comingSoon?: boolean;
  tooltip?: string;
}) {
  const [showComingSoon, setShowComingSoon] = useState(false);

  const handleClick = () => {
    if (comingSoon && !onClick) {
      setShowComingSoon(true);
      setTimeout(() => setShowComingSoon(false), 1500);
      return;
    }
    onClick?.();
  };

  return (
    <div
      onClick={handleClick}
      title={tooltip}
      className={cn(
        "group card-3d-tilt btn-scanlines relative flex w-20 sm:w-28 flex-col items-center justify-center gap-1.5 sm:gap-2 rounded-xl border-2 border-[var(--border)] bg-[var(--card)] p-2.5 sm:p-4 text-center transition-all",
        "cursor-pointer hover:-translate-y-1 hover:border-[var(--primary)]/40 hover:shadow-lg",
      )}
      style={shadowColor ? { ["--tw-shadow-color" as string]: shadowColor } : undefined}
    >
      {showComingSoon && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] shadow-md animate-fade-in-up">
          Coming Soon
        </span>
      )}
      <div
        className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl text-white shadow-sm transition-transform group-hover:scale-110"
        style={{ background: bg }}
      >
        {icon}
      </div>
      <span className="text-[0.625rem] sm:text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
    </div>
  );
}
