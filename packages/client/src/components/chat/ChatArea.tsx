// ──────────────────────────────────────────────
// Chat: Main chat area — mode-aware rendering
// ──────────────────────────────────────────────
import { useEffect, useLayoutEffect, useRef, useCallback, useMemo, useState } from "react";
import {
  useChatMessages,
  useChat,
  useDeleteMessage,
  useUpdateMessage,
  useUpdateMessageExtra,
  usePeekPrompt,
  useCreateChat,
  useSetActiveSwipe,
  useUpdateChatMetadata,
  useBranchChat,
} from "../../hooks/use-chats";

import { useChatStore } from "../../stores/chat.store";
import { useGenerate } from "../../hooks/use-generate";
import { useCharacters, usePersonas } from "../../hooks/use-characters";
import { useAgentConfigs, type AgentConfigRow } from "../../hooks/use-agents";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { ChatSettingsDrawer } from "./ChatSettingsDrawer";
import { ChatFilesDrawer } from "./ChatFilesDrawer";
import { ChatGalleryDrawer } from "./ChatGalleryDrawer";
import { PeekPromptModal } from "./PeekPromptModal";
import { RoleplayHUD } from "./RoleplayHUD";
import { WeatherEffects } from "./WeatherEffects";
import { useGameStateStore } from "../../stores/game-state.store";
import { SpriteOverlay } from "./SpriteOverlay";
import { SpriteSidebar } from "./SpriteSidebar";
import { AgentThoughtBubbles } from "../agents/AgentThoughtBubbles";
import { PinnedImageOverlay } from "./PinnedImageOverlay";
import {
  MessageSquare,
  BookOpen,
  Theater,
  Settings2,
  FolderOpen,
  Image,
  Swords,
  ChevronUp,
  Loader2,
  ScrollText,
  FlipHorizontal2,
  HelpCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useUIStore } from "../../stores/ui.store";
import { useAgentStore } from "../../stores/agent.store";
import { cn } from "../../lib/utils";
import { EncounterModal } from "./EncounterModal";
import { useEncounter } from "../../hooks/use-encounter";
import { useEncounterStore } from "../../stores/encounter.store";
import { SummaryPopover } from "./SummaryPopover";
import { APP_VERSION } from "@marinara-engine/shared";

/** Map characterId → { name, avatarUrl, colors } */
export type CharacterMap = Map<
  string,
  {
    name: string;
    avatarUrl: string | null;
    nameColor?: string;
    dialogueColor?: string;
    boxColor?: string;
  }
>;

/** Weather effects connected to the game state store. */
function WeatherEffectsConnected() {
  const gs = useGameStateStore((s) => s.current);
  return <WeatherEffects weather={gs?.weather ?? null} timeOfDay={gs?.time ?? null} />;
}

export function ChatArea() {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const setActiveChat = useChatStore((s) => s.setActiveChat);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamBuffer = useChatStore((s) => s.streamBuffer);
  const regenerateMessageId = useChatStore((s) => s.regenerateMessageId);
  const chatBackground = useUIStore((s) => s.chatBackground);
  const weatherEffects = useUIStore((s) => s.weatherEffects);
  const hudPosition = useUIStore((s) => s.hudPosition);
  const messagesPerPage = useUIStore((s) => s.messagesPerPage);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const { data: chat } = useChat(activeChatId);
  const {
    data: msgData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useChatMessages(activeChatId, messagesPerPage);
  const messages = useMemo(() => (msgData ? [...msgData.pages].reverse().flat() : undefined), [msgData]);
  const { data: allCharacters } = useCharacters();
  const { data: allPersonas } = usePersonas();
  const deleteMessage = useDeleteMessage(activeChatId);
  const updateMessage = useUpdateMessage(activeChatId);
  const updateMessageExtra = useUpdateMessageExtra(activeChatId);
  const peekPrompt = usePeekPrompt();
  const createChat = useCreateChat();
  const branchChat = useBranchChat();
  const { generate, retryAgents } = useGenerate();
  const setActiveSwipe = useSetActiveSwipe(activeChatId);
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const failedAgentTypes = useAgentStore((s) => s.failedAgentTypes);
  const agentProcessing = useAgentStore((s) => s.isProcessing);

  const setShouldOpenSettings = useChatStore((s) => s.setShouldOpenSettings);

  const handleQuickStart = useCallback(
    (mode: "conversation" | "roleplay") => {
      const label = mode === "conversation" ? "Conversation" : "Roleplay";
      createChat.mutate(
        { name: `New ${label}`, mode, characterIds: [] },
        {
          onSuccess: (chat) => {
            setActiveChatId(chat.id);
            setShouldOpenSettings(true);
          },
        },
      );
    },
    [createChat, setActiveChatId, setShouldOpenSettings],
  );

  // Build character lookup map
  const characterMap: CharacterMap = useMemo(() => {
    const map = new Map<
      string,
      { name: string; avatarUrl: string | null; nameColor?: string; dialogueColor?: string; boxColor?: string }
    >();
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
        });
      } catch {
        map.set(char.id, { name: "Unknown", avatarUrl: null });
      }
    }
    return map;
  }, [allCharacters]);

  const characterNames = useMemo(() => Array.from(characterMap.values()).map((c) => c.name), [characterMap]);

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
    const chatPersonaId = (chat as unknown as { personaId?: string | null })?.personaId;
    const persona =
      (chatPersonaId ? personas.find((p) => p.id === chatPersonaId) : null) ??
      personas.find((p) => p.isActive === "true" || p.isActive === true);
    if (!persona) return undefined;
    return {
      name: persona.name,
      avatarUrl: persona.avatarPath || undefined,
      nameColor: persona.nameColor || undefined,
      dialogueColor: persona.dialogueColor || undefined,
      boxColor: persona.boxColor || undefined,
    };
  }, [allPersonas, chat]);

  const chatMode = (chat as unknown as { mode?: string })?.mode ?? "conversation";
  const isRoleplay = chatMode === "roleplay" || chatMode === "visual_novel";
  const { startEncounter } = useEncounter();
  const encounterActive = useEncounterStore((s) => s.active || s.showConfigModal);
  const { data: agentConfigs } = useAgentConfigs();

  // Count characters in this chat
  const chatCharIds: string[] = chat
    ? typeof (chat as unknown as { characterIds: unknown }).characterIds === "string"
      ? JSON.parse((chat as unknown as { characterIds: string }).characterIds)
      : (chat.characterIds ?? [])
    : [];

  // Sprite sidebar settings from chat metadata
  const chatMeta = useMemo(() => {
    if (!chat) return {};
    const raw = (chat as unknown as { metadata?: string | Record<string, unknown> }).metadata;
    return typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
  }, [chat]);
  const spriteCharacterIds: string[] = chatMeta.spriteCharacterIds ?? [];
  const spritePosition: "left" | "right" = chatMeta.spritePosition ?? "left";
  const spriteExpressions: Record<string, string> = chatMeta.spriteExpressions ?? {};
  const groupChatMode: string | undefined = chatCharIds.length > 1 ? (chatMeta.groupChatMode ?? "merged") : undefined;
  const streamingCharacterId = useChatStore((s) => s.streamingCharacterId);
  const updateMeta = useUpdateChatMetadata();

  const expressionSaveTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const pendingExpressions = useRef<Record<string, string>>(spriteExpressions);

  useEffect(() => {
    pendingExpressions.current = spriteExpressions;
  }, [spriteExpressions]);

  const handleExpressionChange = useCallback(
    (characterId: string, expression: string) => {
      if (!chat?.id) return;
      pendingExpressions.current = { ...pendingExpressions.current, [characterId]: expression };
      if (expressionSaveTimer.current) clearTimeout(expressionSaveTimer.current);
      expressionSaveTimer.current = setTimeout(() => {
        updateMeta.mutate({ id: chat!.id, spriteExpressions: pendingExpressions.current });
      }, 1000);
    },
    [chat?.id, updateMeta],
  );

  const handleToggleSpritePosition = useCallback(() => {
    if (!chat?.id) return;
    const newSide = spritePosition === "left" ? "right" : "left";
    updateMeta.mutate({ id: chat.id, spritePosition: newSide });
  }, [chat?.id, spritePosition, updateMeta]);

  // Set of enabled agent type IDs (respects both global enableAgents toggle and per-agent config)
  const enabledAgentTypes = useMemo(() => {
    const set = new Set<string>();
    if (!chatMeta.enableAgents) return set;
    if (agentConfigs) {
      for (const a of agentConfigs as AgentConfigRow[]) {
        if (a.enabled === "true") set.add(a.type);
      }
    }
    return set;
  }, [chatMeta.enableAgents, agentConfigs]);

  const combatAgentEnabled = enabledAgentTypes.has("combat");
  const expressionAgentEnabled = enabledAgentTypes.has("expression");

  const handleDelete = useCallback(
    (messageId: string) => {
      deleteMessage.mutate(messageId);
    },
    [deleteMessage],
  );

  const handleRegenerate = useCallback(
    async (messageId: string) => {
      if (!activeChatId || isStreaming) return;
      try {
        // Regenerate as a new swipe on the existing message
        await generate({ chatId: activeChatId, connectionId: null, regenerateMessageId: messageId });
      } catch {
        // Error toast is shown by the generate hook
      }
    },
    [activeChatId, isStreaming, generate],
  );

  const handleRetryAgents = useCallback(async () => {
    if (!activeChatId || isStreaming || agentProcessing || failedAgentTypes.length === 0) return;
    await retryAgents(activeChatId, failedAgentTypes);
  }, [activeChatId, isStreaming, agentProcessing, failedAgentTypes, retryAgents]);

  const handleSetActiveSwipe = useCallback(
    (messageId: string, index: number) => {
      setActiveSwipe.mutate({ messageId, index });
    },
    [setActiveSwipe],
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
            if (newChat) setActiveChatId(newChat.id);
          },
        },
      );
    },
    [activeChatId, branchChat, setActiveChatId],
  );

  // Peek prompt state
  const [peekPromptData, setPeekPromptData] = useState<{
    messages: Array<{ role: string; content: string }>;
    parameters: unknown;
    agentNote?: string;
  } | null>(null);

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
    if (chat) setActiveChat(chat);
  }, [chat, setActiveChat]);

  // Auto-open settings drawer for newly created chats
  const shouldOpenSettings = useChatStore((s) => s.shouldOpenSettings);
  useEffect(() => {
    if (shouldOpenSettings && activeChatId) {
      setSettingsOpen(true);
      setShouldOpenSettings(false);
    }
  }, [shouldOpenSettings, activeChatId, setShouldOpenSettings]);

  // Auto-scroll on new messages / streaming (but not on "load more")
  // Only scroll if user is already near the bottom (within 150px)
  const isNearBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const newestMsgId = msgData?.pages[0]?.[msgData.pages[0].length - 1]?.id;
  useEffect(() => {
    if (!isLoadingMoreRef.current && isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [newestMsgId, streamBuffer, isStreaming]);

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
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
        {/* Central hero */}
        <div className="relative">
          <div className="animate-pulse-ring bunny-glow flex h-20 w-20 items-center justify-center rounded-2xl shadow-xl shadow-orange-500/20 overflow-hidden">
            <img src="/logo-splash.gif" alt="Marinara Engine" className="h-full w-full object-cover" />
          </div>
        </div>

        <div className="text-center">
          <h3 className="retro-glow-text text-xl font-bold tracking-tight">✧ Marinara Engine ✧</h3>
          <p className="mt-2 max-w-xs text-sm text-[var(--muted-foreground)]">
            To get started, choose the type of chat you'd like to have with the AI
          </p>
        </div>

        <div className="stagger-children flex gap-3">
          <QuickStartCard
            icon={<MessageSquare size={18} />}
            label="Conversation"
            bg="linear-gradient(135deg, #4de5dd, #3ab8b1)"
            shadowColor="rgba(77,229,221,0.15)"
            tooltip="General chat with one or more characters, or a model itself"
            onClick={() => handleQuickStart("conversation")}
          />
          <QuickStartCard
            icon={<BookOpen size={18} />}
            label="Roleplay"
            bg="linear-gradient(135deg, #eb8951, #d97530)"
            shadowColor="rgba(235,137,81,0.15)"
            tooltip="For roleplaying or creative writing with one or more characters"
            onClick={() => handleQuickStart("roleplay")}
          />
          <QuickStartCard
            icon={<Theater size={18} />}
            label="Visual Novel"
            bg="linear-gradient(135deg, #e15c8c, #c94776)"
            shadowColor="rgba(225,92,140,0.15)"
            tooltip="Coming soon"
            comingSoon
          />
        </div>

        <div className="retro-divider w-48" />

        {/* Footer */}
        <div className="mt-2 flex flex-col items-center gap-3">
          <p className="text-xs text-[var(--muted-foreground)]/60">
            Created by{" "}
            <a
              href="https://spicymarinara.github.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[var(--muted-foreground)]/30 hover:text-[var(--y2k-pink)] hover:decoration-[var(--y2k-pink)]/40 transition-colors"
            >
              Marinara
            </a>
          </p>
          <p className="text-[10px] text-[var(--muted-foreground)]/50">
            Partnered with{" "}
            <a
              href="https://linkapi.ai/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[var(--muted-foreground)]/30 hover:text-[var(--y2k-pink)] hover:decoration-[var(--y2k-pink)]/40 transition-colors"
            >
              LinkAPI
            </a>
          </p>
          <p className="text-[10px] text-[var(--muted-foreground)]/50">
            Art and logo by{" "}
            <a
              href="https://huntercolliex.carrd.co/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[var(--muted-foreground)]/30 hover:text-[var(--y2k-pink)] hover:decoration-[var(--y2k-pink)]/40 transition-colors"
            >
              Huntercolliex
            </a>
          </p>
          <div className="flex gap-2">
            <a
              href="https://discord.com/invite/KdAkTg94ME"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--y2k-purple)]/20 bg-[var(--secondary)]/60 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:border-[var(--y2k-pink)]/40 hover:text-[var(--y2k-pink)]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
              </svg>
              Discord
            </a>
            <a
              href="https://ko-fi.com/marinara_spaghetti"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--y2k-purple)]/20 bg-[var(--secondary)]/60 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:border-[var(--y2k-pink)]/40 hover:text-[var(--y2k-pink)]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              Support
            </a>
          </div>

          {/* Special thanks */}
          <p className="mt-1 max-w-xs text-center text-[10px] leading-relaxed text-[var(--muted-foreground)]/40">
            Special thanks to Kuc0, Exalted, Yang Best Girl, MidnightSleeper, Geechan, TheLonelyDevil, Artus, and you!
          </p>

          {/* Restart tutorial */}
          <button
            onClick={() => useUIStore.getState().setHasCompletedOnboarding(false)}
            className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-[var(--muted-foreground)]/40 transition-colors hover:text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/60"
            title="Replay tutorial"
          >
            <HelpCircle size={12} />
            Replay Tutorial
          </button>

          <p className="mt-2 text-[10px] tracking-wide text-[var(--muted-foreground)]/30">v{APP_VERSION}</p>
        </div>
      </div>
    );
  }

  // Helper: is this message grouped with the previous one?
  const isGrouped = (i: number) => {
    if (i === 0 || !messages) return false;
    const prev = messages[i - 1];
    const curr = messages[i];
    return prev.role === curr.role && prev.characterId === curr.characterId;
  };

  // ═══════════════════════════════════════════════
  // Roleplay Mode — immersive dark atmosphere
  // ═══════════════════════════════════════════════
  if (isRoleplay) {
    const msgPayload = (messages ?? []).map((m) => ({ role: m.role, characterId: m.characterId, content: m.content }));
    return (
      <div className="flex flex-1 overflow-hidden">
        {/* Sprite sidebar — left (only if expression agent enabled) */}
        {expressionAgentEnabled && spritePosition === "left" && spriteCharacterIds.length > 0 && (
          <SpriteSidebar
            characterIds={spriteCharacterIds}
            messages={msgPayload}
            characterMap={characterMap}
            isRoleplay
          />
        )}
        <div className="rpg-chat-area relative flex flex-1 flex-col overflow-hidden">
          {/* Background layer */}
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={chatBackground ? { backgroundImage: `url(${chatBackground})` } : undefined}
          />
          {/* Dark atmospheric overlay */}
          <div className="absolute inset-0 rpg-overlay" />
          {/* Vignette effect */}
          <div className="absolute inset-0 rpg-vignette pointer-events-none" />

          {/* Dynamic weather effects — reads from game state store */}
          {weatherEffects && <WeatherEffectsConnected />}

          {/* VN-style character sprites (only if expression agent enabled) */}
          {expressionAgentEnabled && (
            <SpriteOverlay
              characterIds={chatCharIds}
              messages={msgPayload}
              side={spritePosition}
              spriteExpressions={spriteExpressions}
              onExpressionChange={handleExpressionChange}
            />
          )}

          {/* Chat header with settings */}
          <div className="relative z-40 flex items-center justify-end border-b border-white/5 bg-black/30 px-4 py-2 backdrop-blur-md">
            <div className="flex items-center gap-1">
              {/* Summary popover toggle */}
              <SummaryButton chatId={chat?.id ?? null} summary={chatMeta.summary ?? null} />
              <button
                onClick={() => setFilesOpen(true)}
                className="rounded-lg p-1.5 text-white/50 transition-all hover:bg-white/10 hover:text-white/80"
                title="Manage Chat Files"
              >
                <FolderOpen size={16} />
              </button>
              {/* Sprite side toggle */}
              {expressionAgentEnabled && chatCharIds.length > 0 && (
                <button
                  onClick={handleToggleSpritePosition}
                  className="rounded-lg p-1.5 text-white/50 transition-all hover:bg-white/10 hover:text-white/80"
                  title={`Sprite: ${spritePosition} side (click to flip)`}
                >
                  <FlipHorizontal2 size={16} />
                </button>
              )}
              <button
                onClick={() => setGalleryOpen(true)}
                className="rounded-lg p-1.5 text-white/50 transition-all hover:bg-white/10 hover:text-white/80"
                title="Gallery"
              >
                <Image size={16} />
              </button>
              {chatMeta.enableAgents && enabledAgentTypes.size > 0 && (
                <AgentsHeaderButton agentConfigs={agentConfigs as AgentConfigRow[] | undefined} variant="roleplay" />
              )}
              {failedAgentTypes.length > 0 && (
                <button
                  onClick={handleRetryAgents}
                  disabled={agentProcessing}
                  className="rounded-lg p-1.5 text-amber-400/80 transition-all hover:bg-white/10 hover:text-amber-300 disabled:opacity-50"
                  title="Retry failed agents"
                >
                  <RefreshCw size={16} className={agentProcessing ? "animate-spin" : ""} />
                </button>
              )}
              <button
                onClick={() => setSettingsOpen(true)}
                className="rounded-lg p-1.5 text-white/50 transition-all hover:bg-white/10 hover:text-white/80"
                title="Chat Settings"
              >
                <Settings2 size={16} />
              </button>
            </div>
          </div>

          {/* HUD overlay — top: h-0 so it doesn't consume flex space; left/right: absolute full-height */}
          {chat && chatMeta.enableAgents && (
            <div
              className={cn(
                "z-30",
                hudPosition === "left" || hudPosition === "right"
                  ? "pointer-events-none absolute top-10 bottom-20 left-0 right-0"
                  : "relative h-0 overflow-visible",
              )}
            >
              <RoleplayHUD chatId={chat.id} characterCount={chatCharIds.length} layout={hudPosition} />
            </div>
          )}

          {/* Combat Encounter Modal */}
          {encounterActive && <EncounterModal />}

          {/* Messages scroll area */}
          <div
            ref={scrollRef}
            className={cn(
              "rpg-chat-messages-mobile relative z-10 flex-1 overflow-y-auto py-4",
              chatCharIds.length > 0 ? "px-[15%]" : "px-3",
            )}
          >
            {/* Load More button */}
            {hasNextPage && (
              <div className="mb-3 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={isFetchingNextPage}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-medium text-white/70 backdrop-blur-sm transition-all hover:bg-white/10 hover:text-white/90 disabled:opacity-50"
                >
                  {isFetchingNextPage ? <Loader2 size={12} className="animate-spin" /> : <ChevronUp size={12} />}
                  Load More
                </button>
              </div>
            )}

            {isLoading && (
              <div className="flex flex-col items-center gap-3 py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
              </div>
            )}

            {/* Extra space before first message so HUD widgets don't cover it */}
            {messages && messages.length <= 2 && chatMeta.enableAgents && <div className="h-16" />}

            {messages?.map((msg, i) => {
              const isRegenerating = isStreaming && regenerateMessageId === msg.id;
              const displayMsg = isRegenerating ? { ...msg, content: streamBuffer || "" } : msg;
              return (
                <div key={msg.id}>
                  <ChatMessage
                    message={displayMsg}
                    isStreaming={isRegenerating}
                    index={i}
                    onDelete={handleDelete}
                    onRegenerate={handleRegenerate}
                    onEdit={handleEdit}
                    onSetActiveSwipe={handleSetActiveSwipe}
                    onToggleConversationStart={handleToggleConversationStart}
                    onPeekPrompt={handlePeekPrompt}
                    onBranch={handleBranch}
                    isLastAssistantMessage={msg.id === lastAssistantMessageId}
                    characterMap={characterMap}
                    personaInfo={personaInfo}
                    chatMode={chatMode}
                    isGrouped={isGrouped(i)}
                    groupChatMode={groupChatMode}
                    chatCharacterIds={chatCharIds}
                  />
                </div>
              );
            })}

            {/* Streaming / typing indicator (new message only, not regeneration) */}
            {isStreaming && !regenerateMessageId && (
              <div className="animate-message-in">
                <ChatMessage
                  message={{
                    id: "__streaming__",
                    chatId: activeChatId,
                    role: "assistant",
                    characterId: streamingCharacterId ?? null,
                    content: streamBuffer || "",
                    activeSwipeIndex: 0,
                    extra: { displayText: null, isGenerated: true, tokenCount: 0, generationInfo: null },
                    createdAt: new Date().toISOString(),
                  }}
                  isStreaming
                  index={-1}
                  characterMap={characterMap}
                  personaInfo={personaInfo}
                  chatMode={chatMode}
                  groupChatMode={groupChatMode}
                  chatCharacterIds={chatCharIds}
                />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area — matches top bar style, full-width */}
          <div className="relative z-20 border-t border-white/5 bg-black/30 backdrop-blur-md">
            <div className={cn("relative", chatCharIds.length > 0 && "px-[12%]")}>
              {combatAgentEnabled && (
                <div className="flex justify-center py-1">
                  <button
                    onClick={() => startEncounter()}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs text-white/50 transition-all hover:bg-white/10 hover:text-orange-300"
                    title="Start Combat Encounter"
                  >
                    <Swords size={14} />
                    <span>Encounter</span>
                  </button>
                </div>
              )}
              <ChatInput mode="roleplay" characterNames={characterNames} />
            </div>
          </div>

          {/* Settings drawer */}
          {chat && <ChatSettingsDrawer chat={chat} open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
          {/* Chat files drawer */}
          {chat && <ChatFilesDrawer chat={chat} open={filesOpen} onClose={() => setFilesOpen(false)} />}
          {/* Gallery drawer */}
          {chat && <ChatGalleryDrawer chat={chat} open={galleryOpen} onClose={() => setGalleryOpen(false)} />}
        </div>

        {/* Sprite sidebar — right (only if expression agent enabled) */}
        {expressionAgentEnabled && spritePosition === "right" && spriteCharacterIds.length > 0 && (
          <SpriteSidebar
            characterIds={spriteCharacterIds}
            messages={msgPayload}
            characterMap={characterMap}
            isRoleplay
          />
        )}

        {/* Pinned gallery images */}
        <PinnedImageOverlay />

        {/* Peek Prompt Modal */}
        {peekPromptData && <PeekPromptModal data={peekPromptData} onClose={() => setPeekPromptData(null)} />}
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // Conversation Mode — clean texting style
  // ═══════════════════════════════════════════════
  const convMsgPayload = (messages ?? []).map((m) => ({
    role: m.role,
    characterId: m.characterId,
    content: m.content,
  }));
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sprite sidebar — left (only if expression agent enabled) */}
      {expressionAgentEnabled && spritePosition === "left" && spriteCharacterIds.length > 0 && (
        <SpriteSidebar characterIds={spriteCharacterIds} messages={convMsgPayload} characterMap={characterMap} />
      )}
      <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--background)]">
        {/* Chat header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            {/* Character avatar stack or icon */}
            {chatCharIds.length > 0 ? (
              <div className="flex -space-x-2">
                {chatCharIds.slice(0, 3).map((cid) => {
                  const info = characterMap.get(cid);
                  return info?.avatarUrl ? (
                    <img
                      key={cid}
                      src={info.avatarUrl}
                      alt={info.name}
                      className="h-7 w-7 rounded-full object-cover ring-2 ring-[var(--background)]"
                    />
                  ) : (
                    <div
                      key={cid}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold ring-2 ring-[var(--background)]"
                    >
                      {(info?.name ?? "?")[0]}
                    </div>
                  );
                })}
                {chatCharIds.length > 3 && (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--secondary)] text-[9px] font-bold ring-2 ring-[var(--background)]">
                    +{chatCharIds.length - 3}
                  </div>
                )}
              </div>
            ) : (
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-white"
                style={{ background: "linear-gradient(135deg, #4de5dd, #3ab8b1)" }}
              >
                <MessageSquare size={12} />
              </div>
            )}
            <div>
              <span className="text-sm font-semibold text-[var(--foreground)]">{chat?.name ?? "Conversation"}</span>
              {chatCharIds.length > 0 && (
                <p className="text-[10px] text-[var(--muted-foreground)]">
                  {chatCharIds
                    .map((cid) => characterMap.get(cid)?.name)
                    .filter(Boolean)
                    .join(", ")}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilesOpen(true)}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              title="Manage Chat Files"
            >
              <FolderOpen size={16} />
            </button>
            <button
              onClick={() => setGalleryOpen(true)}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              title="Gallery"
            >
              <Image size={16} />
            </button>
            {chatMeta.enableAgents && enabledAgentTypes.size > 0 && (
              <AgentsHeaderButton agentConfigs={agentConfigs as AgentConfigRow[] | undefined} variant="conversation" />
            )}
            {failedAgentTypes.length > 0 && (
              <button
                onClick={handleRetryAgents}
                disabled={agentProcessing}
                className="rounded-lg p-1.5 text-amber-500 transition-all hover:bg-[var(--accent)] hover:text-amber-400 disabled:opacity-50"
                title="Retry failed agents"
              >
                <RefreshCw size={16} className={agentProcessing ? "animate-spin" : ""} />
              </button>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              title="Chat Settings"
            >
              <Settings2 size={16} />
            </button>
          </div>
        </div>

        {/* HUD overlay — tracker widgets (when agents enabled) */}
        {chat && chatMeta.enableAgents && (
          <div className="relative z-30 h-0 overflow-visible">
            <RoleplayHUD chatId={chat.id} characterCount={chatCharIds.length} layout="top" />
          </div>
        )}

        {/* Combat Encounter Modal */}
        {encounterActive && <EncounterModal />}

        {/* Messages area */}
        <div className="relative flex-1 overflow-hidden">
          {chatBackground && (
            <>
              <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                style={{ backgroundImage: `url(${chatBackground})` }}
              />
              <div className="absolute inset-0 bg-[var(--background)]/60" />
            </>
          )}
          <div ref={scrollRef} className="relative h-full overflow-y-auto px-4 py-4">
            {/* Load More button */}
            {hasNextPage && (
              <div className="mb-3 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={isFetchingNextPage}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/80 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:bg-[var(--secondary)] hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  {isFetchingNextPage ? <Loader2 size={12} className="animate-spin" /> : <ChevronUp size={12} />}
                  Load More
                </button>
              </div>
            )}

            {isLoading && (
              <div className="flex flex-col items-center gap-3 py-12">
                <div className="shimmer h-12 w-12 rounded-xl" />
                <div className="shimmer h-3 w-32 rounded-full" />
              </div>
            )}

            {messages?.map((msg, i) => {
              const isRegenerating = isStreaming && regenerateMessageId === msg.id;
              const displayMsg = isRegenerating ? { ...msg, content: streamBuffer || "" } : msg;
              return (
                <div key={msg.id}>
                  <ChatMessage
                    message={displayMsg}
                    isStreaming={isRegenerating}
                    index={i}
                    onDelete={handleDelete}
                    onRegenerate={handleRegenerate}
                    onEdit={handleEdit}
                    onSetActiveSwipe={handleSetActiveSwipe}
                    onToggleConversationStart={handleToggleConversationStart}
                    onPeekPrompt={handlePeekPrompt}
                    onBranch={handleBranch}
                    isLastAssistantMessage={msg.id === lastAssistantMessageId}
                    characterMap={characterMap}
                    personaInfo={personaInfo}
                    chatMode={chatMode}
                    isGrouped={isGrouped(i)}
                    groupChatMode={groupChatMode}
                    chatCharacterIds={chatCharIds}
                  />
                </div>
              );
            })}

            {/* Streaming / typing indicator (new message only, not regeneration) */}
            {isStreaming && !regenerateMessageId && (
              <div className="animate-message-in">
                <ChatMessage
                  message={{
                    id: "__streaming__",
                    chatId: activeChatId,
                    role: "assistant",
                    characterId: streamingCharacterId ?? null,
                    content: streamBuffer || "",
                    activeSwipeIndex: 0,
                    extra: { displayText: null, isGenerated: true, tokenCount: 0, generationInfo: null },
                    createdAt: new Date().toISOString(),
                  }}
                  isStreaming
                  index={-1}
                  characterMap={characterMap}
                  personaInfo={personaInfo}
                  chatMode={chatMode}
                  groupChatMode={groupChatMode}
                  chatCharacterIds={chatCharIds}
                />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input area */}
        <div className="relative">
          {combatAgentEnabled && (
            <div className="flex justify-center py-1">
              <button
                onClick={() => startEncounter()}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] hover:text-orange-400"
                title="Start Combat Encounter"
              >
                <Swords size={14} />
                <span>Encounter</span>
              </button>
            </div>
          )}
          <ChatInput mode="conversation" characterNames={characterNames} />
        </div>

        {/* Settings drawer */}
        {chat && <ChatSettingsDrawer chat={chat} open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
        {/* Chat files drawer */}
        {chat && <ChatFilesDrawer chat={chat} open={filesOpen} onClose={() => setFilesOpen(false)} />}
        {/* Gallery drawer */}
        {chat && <ChatGalleryDrawer chat={chat} open={galleryOpen} onClose={() => setGalleryOpen(false)} />}
      </div>

      {/* Sprite sidebar — right (only if expression agent enabled) */}
      {expressionAgentEnabled && spritePosition === "right" && spriteCharacterIds.length > 0 && (
        <SpriteSidebar characterIds={spriteCharacterIds} messages={convMsgPayload} characterMap={characterMap} />
      )}

      {/* Agent thought bubbles */}
      <AgentThoughtBubbles />

      {/* Pinned gallery images */}
      <PinnedImageOverlay />

      {/* Peek Prompt Modal */}
      {peekPromptData && <PeekPromptModal data={peekPromptData} onClose={() => setPeekPromptData(null)} />}
    </div>
  );
}

/** Animated typing indicator — three bouncing dots */
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
  icon: React.ReactNode;
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
        "group card-3d-tilt btn-scanlines relative flex w-28 flex-col items-center justify-center gap-2 rounded-xl border-2 border-[var(--y2k-purple)]/20 bg-[var(--card)] p-4 text-center transition-all",
        "cursor-pointer hover:-translate-y-1 hover:border-[var(--y2k-pink)]/40 hover:shadow-lg",
      )}
      style={shadowColor ? { ["--tw-shadow-color" as string]: shadowColor } : undefined}
    >
      {showComingSoon && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] shadow-md animate-fade-in-up">
          Coming Soon
        </span>
      )}
      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm transition-transform group-hover:scale-110"
        style={{ background: bg }}
      >
        {icon}
      </div>
      <span className="text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
    </div>
  );
}

/** Summary button with popover — lives in the chat header */
/** Agents header button — shows agent activity grouped by phase */
function AgentsHeaderButton({
  agentConfigs,
  variant,
}: {
  agentConfigs: AgentConfigRow[] | undefined;
  variant: "roleplay" | "conversation";
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const thoughtBubbles = useAgentStore((s) => s.thoughtBubbles);
  const isProcessing = useAgentStore((s) => s.isProcessing);
  const clearThoughtBubbles = useAgentStore((s) => s.clearThoughtBubbles);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Build phase map from agentConfigs
  const phaseMap = useMemo(() => {
    const map = new Map<string, string>();
    if (agentConfigs) {
      for (const a of agentConfigs) {
        map.set(a.type, a.phase);
      }
    }
    return map;
  }, [agentConfigs]);

  // Group thought bubbles by phase
  const grouped = useMemo(() => {
    const groups: Record<string, typeof thoughtBubbles> = {
      pre_generation: [],
      parallel: [],
      post_processing: [],
    };
    for (const b of thoughtBubbles) {
      const phase = phaseMap.get(b.agentId) ?? "parallel";
      (groups[phase] ??= []).push(b);
    }
    return groups;
  }, [thoughtBubbles, phaseMap]);

  const phaseLabels: Record<string, string> = {
    pre_generation: "Pre-Generation",
    parallel: "Parallel",
    post_processing: "Post-Processing",
  };

  const isRP = variant === "roleplay";
  const btnBase = "rounded-lg p-1.5 transition-all";
  const btnIdle = isRP
    ? "text-purple-400/60 hover:bg-white/10 hover:text-purple-300"
    : "text-purple-500/60 hover:bg-[var(--accent)] hover:text-purple-400";
  const btnActive = isRP ? "bg-white/15 text-purple-300" : "bg-[var(--accent)] text-purple-400";
  const dropdownBg = isRP ? "border-white/10 bg-black/80 backdrop-blur-xl" : "border-[var(--border)] bg-[var(--card)]";
  const textMuted = isRP ? "text-white/40" : "text-[var(--muted-foreground)]";
  const bubbleBg = isRP ? "bg-white/5" : "bg-[var(--primary)]/8";
  const badgeBg = isRP ? "bg-purple-500/80" : "bg-purple-500";

  return (
    <div className="relative" ref={dropdownRef}>
      <button onClick={() => setOpen(!open)} className={cn(btnBase, open ? btnActive : btnIdle)} title="Agent activity">
        <Sparkles size={16} className={isProcessing ? "animate-pulse" : ""} />
        {thoughtBubbles.length > 0 && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full px-0.5 text-[8px] font-bold text-white",
              badgeBg,
            )}
          >
            {thoughtBubbles.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute right-0 top-full mt-1 w-80 max-h-80 overflow-y-auto rounded-xl border shadow-xl z-50 animate-message-in",
            dropdownBg,
          )}
        >
          {/* Processing indicator */}
          {isProcessing && (
            <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
              <Sparkles size={12} className="text-purple-400 animate-pulse" />
              <span className={cn("text-[10px]", textMuted)}>Agents thinking…</span>
            </div>
          )}

          {/* Empty state */}
          {thoughtBubbles.length === 0 && !isProcessing && (
            <div className={cn("px-3 py-4 text-center text-[10px]", textMuted)}>No agent activity yet</div>
          )}

          {/* Grouped results */}
          {thoughtBubbles.length > 0 && (
            <>
              <div
                className={cn(
                  "flex items-center justify-between border-b px-3 py-1.5",
                  isRP ? "border-white/5" : "border-[var(--border)]",
                )}
              >
                <span className={cn("text-[10px]", textMuted)}>
                  {thoughtBubbles.length} result{thoughtBubbles.length !== 1 ? "s" : ""}
                </span>
                <button
                  onClick={clearThoughtBubbles}
                  className={cn(
                    "text-[10px] transition-colors",
                    textMuted,
                    isRP ? "hover:text-white/60" : "hover:text-[var(--foreground)]",
                  )}
                >
                  Clear all
                </button>
              </div>
              <div className="p-2 flex flex-col gap-2">
                {(["pre_generation", "parallel", "post_processing"] as const).map((phase) => {
                  const items = grouped[phase];
                  if (!items || items.length === 0) return null;
                  return (
                    <div key={phase}>
                      <div className={cn("text-[9px] font-semibold uppercase tracking-wider px-1 mb-1", textMuted)}>
                        {phaseLabels[phase]}
                      </div>
                      <div className="flex flex-col gap-1">
                        {items.map((bubble, i) => (
                          <div
                            key={`${bubble.agentId}-${bubble.timestamp}-${i}`}
                            className={cn("rounded-lg p-2 text-[10px]", bubbleBg)}
                          >
                            <span className="font-semibold text-purple-400">{bubble.agentName}</span>
                            <p className={cn("mt-0.5 whitespace-pre-wrap leading-relaxed", textMuted)}>
                              {bubble.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryButton({ chatId, summary }: { chatId: string | null; summary: string | null }) {
  const [open, setOpen] = useState(false);
  if (!chatId) return null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "rounded-lg p-1.5 transition-all",
          open
            ? "bg-white/15 text-white/90"
            : summary
              ? "text-amber-400/70 hover:bg-white/10 hover:text-amber-300"
              : "text-white/50 hover:bg-white/10 hover:text-white/80",
        )}
        title="Chat Summary"
      >
        <ScrollText size={16} />
      </button>
      {open && <SummaryPopover chatId={chatId} summary={summary} onClose={() => setOpen(false)} />}
    </div>
  );
}
