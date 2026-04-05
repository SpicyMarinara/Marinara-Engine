// ──────────────────────────────────────────────
// Chat: Conversation View — Discord-style composite
// ──────────────────────────────────────────────
import { Suspense, lazy, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ChevronUp, Settings2, FolderOpen, Image as ImageIcon, ArrowRightLeft } from "lucide-react";
import { ConversationMessage } from "./ConversationMessage";
import { ConversationInput } from "./ConversationInput";
import { SceneBanner, EndSceneBar } from "./SceneBanner";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { playNotificationPing } from "../../lib/notification-sound";
import { characterKeys } from "../../hooks/use-characters";
import { api } from "../../lib/api-client";
import type { CharacterMap, PersonaInfo } from "./chat-area.types";
import type { Message } from "@marinara-engine/shared";

const ConversationAutonomousEffects = lazy(async () => {
  const module = await import("./ConversationAutonomousEffects");
  return { default: module.ConversationAutonomousEffects };
});

interface ConversationViewProps {
  chatId: string;
  messages: Message[] | undefined;
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  pageCount: number;
  characterMap: CharacterMap;
  characterNames: string[];
  personaInfo?: PersonaInfo;
  chatMeta: Record<string, any>;
  chatCharIds: string[];
  onDelete: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
  onEdit: (messageId: string, content: string) => void;
  onPeekPrompt: () => void;
  lastAssistantMessageId: string | null;
  onOpenSettings: () => void;
  onOpenFiles: () => void;
  onOpenGallery: () => void;
  multiSelectMode?: boolean;
  selectedMessageIds?: Set<string>;
  onToggleSelectMessage?: (messageId: string) => void;
  connectedChatName?: string;
  onSwitchChat?: () => void;
  sceneInfo?: {
    variant: "origin" | "scene";
    sceneChatId?: string;
    originChatId?: string;
    description?: string;
  };
  onConcludeScene?: (sceneChatId: string) => void;
  onAbandonScene?: (sceneChatId: string) => void;
}

/** Return a display label for a day separator */
function formatDaySeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** Group messages by day for day separators */
function getDayKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Check if a message's content uses "Name: text" format with known character names */
function hasNamePrefixFormat(msg: Message, characterMap: CharacterMap): boolean {
  if (!msg.content) return false;
  const lines = msg.content.split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(": ");
    if (colonIdx > 0) {
      const name = line.slice(0, colonIdx).trim();
      // Check if this name matches any character in the character map
      for (const [, charInfo] of characterMap) {
        if (charInfo && charInfo.name.toLowerCase() === name.toLowerCase()) return true;
      }
    }
  }
  return false;
}

// Module-level set that remembers which message keys have been "seen" across
// component remounts. This prevents stagger animations and notification sounds
// from replaying when the user navigates away from a chat and comes back.
const globalSeenKeys = new Set<string>();

export function ConversationView({
  chatId,
  messages,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  pageCount,
  characterMap,
  characterNames,
  personaInfo,
  chatMeta,
  chatCharIds,
  onDelete,
  onRegenerate,
  onEdit,
  onPeekPrompt,
  lastAssistantMessageId,
  onOpenSettings,
  onOpenFiles,
  onOpenGallery,
  multiSelectMode,
  selectedMessageIds,
  onToggleSelectMessage,
  connectedChatName,
  onSwitchChat,
  sceneInfo,
  onConcludeScene,
  onAbandonScene,
}: ConversationViewProps) {
  const qc = useQueryClient();
  const streamingChatId = useChatStore((s) => s.streamingChatId);
  const isStreaming = useChatStore((s) => s.isStreaming) && streamingChatId === chatId;
  const streamBuffer = useChatStore((s) => s.streamBuffer);
  const regenerateMessageId = useChatStore((s) => s.regenerateMessageId);
  const streamingCharacterId = useChatStore((s) => s.streamingCharacterId);
  const typingCharacterName = useChatStore((s) => s.typingCharacterName);
  const delayedCharacterInfo = useChatStore((s) => s.delayedCharacterInfo);

  // ── Periodic status refresh (every 60s) ──
  // Keeps status dots in sync with the character's schedule regardless of autonomous messaging
  useEffect(() => {
    if (!chatId) return;
    const refreshStatus = async () => {
      // Skip while tab is hidden to avoid a burst of requests on return
      if (document.hidden) return;
      try {
        await api.get(`/conversation/status/${chatId}`);
        qc.invalidateQueries({ queryKey: characterKeys.list() });
      } catch {
        /* non-critical */
      }
    };
    const timer = setInterval(refreshStatus, 60_000);
    return () => clearInterval(timer);
  }, [chatId, qc]);

  // Global conversation gradient from settings
  const convoGradientFrom = useUIStore((s) => s.convoGradientFrom);
  const convoGradientTo = useUIStore((s) => s.convoGradientTo);
  const gradientStyle = useMemo(
    () => ({ background: `linear-gradient(135deg, ${convoGradientFrom}, ${convoGradientTo})` }),
    [convoGradientFrom, convoGradientTo],
  );
  const hasAutonomousMessaging = !!chatMeta.autonomousMessages || !!chatMeta.characterExchanges;

  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const userScrolledAwayRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const userScrolledAtRef = useRef(0);

  // ── Scroll tracking ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distFromBottom < 150;
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
    el.addEventListener("scroll", onScroll, { passive: true });
    const onUserScroll = () => {
      if (isStreaming) {
        userScrolledAwayRef.current = true;
        userScrolledAtRef.current = Date.now();
      }
    };
    el.addEventListener("wheel", onUserScroll, { passive: true });
    el.addEventListener("touchmove", onUserScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onUserScroll);
      el.removeEventListener("touchmove", onUserScroll);
    };
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming) userScrolledAwayRef.current = false;
  }, [isStreaming]);

  // Auto-scroll on new messages / streaming / staggered reveals
  const newestMsgId = messages?.[messages.length - 1]?.id;
  const isOptimistic = newestMsgId?.startsWith("__optimistic_");
  useEffect(() => {
    if (isLoadingMoreRef.current) return;
    // Always scroll when the user just sent a message (optimistic msg)
    if (isOptimistic || (isNearBottomRef.current && !userScrolledAwayRef.current)) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [newestMsgId, streamBuffer, isStreaming, delayedCharacterInfo, typingCharacterName, isOptimistic]);

  // Preserve scroll on load-more
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

  // ── Build message list with day separators ──
  // Assistant messages with multiple lines are split into separate visual
  // messages so each line appears as its own bubble (Discord-style).
  // They stay as one record in the DB — only the display is split.
  // Strip leaked timestamps like [16:08] or [18.03.2026] from assistant content.
  const stripTimestamps = (text: string) =>
    text
      .replace(/^(\s*\[\d{1,2}[:.:]\d{2}\]\s*)+/gm, "")
      .replace(/^(\s*\[\d{1,2}\.\d{1,2}\.\d{4}\]\s*)+/gm, "")
      .trim();

  const renderedItems = useMemo(() => {
    if (!messages) return [];
    const items: Array<
      | { type: "separator"; key: string; label: string }
      | { type: "message"; key: string; msg: Message; isGrouped: boolean; index: number }
    > = [];
    let lastDay = "";
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      const day = getDayKey(msg.createdAt);
      if (day !== lastDay) {
        items.push({ type: "separator", key: `sep-${day}`, label: formatDaySeparator(msg.createdAt) });
        lastDay = day;
      }
      const prev = i > 0 ? messages[i - 1]! : null;
      // Break grouping if >5 minutes apart (like Discord)
      const TIME_GAP_MS = 5 * 60 * 1000;
      const timeTooFar = prev
        ? new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() > TIME_GAP_MS
        : false;
      const grouped =
        !!prev &&
        !timeTooFar &&
        prev.role === msg.role &&
        prev.characterId === msg.characterId &&
        getDayKey(prev.createdAt) === day;

      // Split multi-line assistant messages into separate visual rows
      // Skip splitting for messages with <speaker> tags or Name: text format
      // (group chat merged mode) — those are handled by ConversationMessage's group renderer.
      const hasGroupFormat = msg.content.includes("<speaker=") || hasNamePrefixFormat(msg, characterMap);
      if (msg.role === "assistant" && msg.content && !hasGroupFormat) {
        const cleaned = stripTimestamps(msg.content);
        // Strip lines that are just the character's name (LLM prefixing in group individual mode)
        const charName = msg.characterId ? characterMap.get(msg.characterId)?.name : null;
        const lines = cleaned.split("\n").filter((l) => {
          const t = l.trim();
          if (!t) return false;
          // Skip lines that are just the character name (with optional colon)
          if (charName && (t === charName || t === `${charName}:`)) return false;
          return true;
        });
        if (lines.length > 1) {
          lines.forEach((line, li) => {
            const isLast = li === lines.length - 1;
            items.push({
              type: "message",
              key: `${msg.id}__line${li}`,
              msg: isLast
                ? { ...msg, content: line }
                : {
                    ...msg,
                    content: line,
                    extra: { displayText: null, isGenerated: false, tokenCount: null, generationInfo: null },
                  },
              isGrouped: li === 0 ? grouped : true,
              index: i,
            });
          });
          continue;
        }
      }

      // For single-line assistant messages, also strip timestamps and character name prefix
      let displayContent = msg.role === "assistant" && msg.content ? stripTimestamps(msg.content) : msg.content;
      if (msg.role === "assistant" && msg.characterId) {
        const cName = characterMap.get(msg.characterId)?.name;
        if (cName) {
          // Strip leading "CharacterName\n" or "CharacterName:\n" prefix
          const nameRe = new RegExp(`^\\s*${cName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*\\n`, "i");
          displayContent = displayContent.replace(nameRe, "");
        }
      }
      const displayMsg = displayContent !== msg.content ? { ...msg, content: displayContent } : msg;
      items.push({ type: "message", key: msg.id, msg: displayMsg, isGrouped: grouped, index: i });
    }
    return items;
  }, [messages, characterMap]);

  // ── Staggered reveal for split assistant lines ──
  // When a new multi-line assistant message arrives, show lines one by one
  // with a small delay between each to feel like real messaging.
  const [hiddenLineKeys, setHiddenLineKeys] = useState<Set<string>>(new Set());
  const prevRenderedKeysRef = useRef<Set<string>>(new Set());
  // Track whether the initial data load has settled. Until it has, we treat
  // all arriving keys as "already seen" so re-mounting the component (or the
  // first async page of messages landing) never replays stagger/sounds.
  const initialLoadSettledRef = useRef(false);
  // Keep a persistent set of message keys we've already processed across
  // component remounts. This prevents sounds/stagger replaying when the user
  // navigates away and comes back to the same chat.
  const globalSeenKeysRef = useRef(globalSeenKeys);

  // Reset stagger state when the active chat changes so no cross-chat leakage
  const prevChatIdRef = useRef(chatId);
  if (prevChatIdRef.current !== chatId) {
    prevChatIdRef.current = chatId;
    initialLoadSettledRef.current = false;
    prevRenderedKeysRef.current = new Set();
    setHiddenLineKeys(new Set());
  }

  useEffect(() => {
    const currentKeys = new Set(renderedItems.filter((i) => i.type === "message").map((i) => i.key));

    // On the very first render that has messages, just snapshot the keys and
    // mark the initial load as settled — don't stagger or play sounds.
    if (!initialLoadSettledRef.current) {
      if (currentKeys.size > 0) {
        prevRenderedKeysRef.current = currentKeys;
        // Mark all current keys as globally seen so remount won't replay them
        for (const k of currentKeys) globalSeenKeysRef.current.add(k);
        initialLoadSettledRef.current = true;
      }
      return;
    }

    const prevKeys = prevRenderedKeysRef.current;
    const seenGlobal = globalSeenKeysRef.current;
    const now = Date.now();

    // Build a key → createdAt map for freshness checks.
    // Only messages created within the last 15 seconds are considered "live" —
    // older ones arrived via a cache refetch and should not trigger animation/sound.
    const FRESHNESS_MS = 15_000;
    const keyTimestampMap = new Map<string, number>();
    for (const item of renderedItems) {
      if (item.type === "message") {
        keyTimestampMap.set(item.key, new Date(item.msg.createdAt).getTime());
      }
    }

    // Find newly arrived split child lines (key has __line1, __line2, etc.)
    const newSplitChildren: string[] = [];
    // Find newly arrived non-split assistant messages (for notification sound)
    let hasNewAssistantMessage = false;

    for (const key of currentKeys) {
      if (!prevKeys.has(key) && !seenGlobal.has(key)) {
        // Check if this message is fresh (created recently, meaning it was
        // generated while the user is actively in this chat)
        const ts = keyTimestampMap.get(key) ?? 0;
        const isFresh = now - ts < FRESHNESS_MS;

        if (!isFresh) {
          // Stale message from cache refetch — silently mark as seen, skip animation
          continue;
        }

        if (/__line[1-9]\d*$/.test(key)) {
          newSplitChildren.push(key);
        } else if (/__line0$/.test(key)) {
          // First line of a split message — counts as new assistant message
          hasNewAssistantMessage = true;
        } else {
          // Check if it's a new assistant message (not a split)
          const item = renderedItems.find((i) => i.type === "message" && i.key === key);
          if (item && item.type === "message" && item.msg.role === "assistant") {
            hasNewAssistantMessage = true;
          }
        }
      }
    }

    // Mark all current keys as globally seen
    for (const k of currentKeys) seenGlobal.add(k);
    prevRenderedKeysRef.current = currentKeys;

    // Play notification for the first new message appearance
    if (hasNewAssistantMessage && useUIStore.getState().convoNotificationSound) {
      playNotificationPing();
    }

    if (newSplitChildren.length === 0) {
      // Clear any orphaned hidden keys left by a previous stagger whose
      // reveal timers were cancelled (e.g. by a query refetch mid-stagger).
      setHiddenLineKeys((prev) => (prev.size > 0 ? new Set() : prev));
      return;
    }

    // Hide all new split children initially
    setHiddenLineKeys((prev) => {
      const next = new Set(prev);
      for (const k of newSplitChildren) next.add(k);
      return next;
    });

    // Reveal each one with a staggered delay (1.5s between each)
    const timers: ReturnType<typeof setTimeout>[] = [];
    newSplitChildren.forEach((key, idx) => {
      const delay = (idx + 1) * 1500;
      timers.push(
        setTimeout(() => {
          setHiddenLineKeys((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          // Play ping for each revealed line
          if (useUIStore.getState().convoNotificationSound) {
            playNotificationPing();
          }
        }, delay),
      );
    });

    return () => timers.forEach(clearTimeout);
  }, [renderedItems]);

  // Auto-scroll when staggered lines are revealed
  const hiddenCount = hiddenLineKeys.size;
  useEffect(() => {
    if (!isLoadingMoreRef.current && isNearBottomRef.current && !userScrolledAwayRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [hiddenCount]);

  return (
    <div className="mari-chat-area relative flex flex-1 flex-col overflow-hidden" style={gradientStyle}>
      {/* ── Messages scroll area ── */}
      <div ref={scrollRef} className="mari-messages-scroll flex-1 overflow-y-auto overflow-x-hidden">
        {/* Floating header — character info + action buttons */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2">
          {/* Character identity pill */}
          {(() => {
            const chars = chatCharIds.map((id) => characterMap.get(id)).filter(Boolean) as Array<{
              name: string;
              avatarUrl: string | null;
              conversationStatus?: "online" | "idle" | "dnd" | "offline";
            }>;
            if (chars.length === 0) return <div />;

            const statusColor = (s?: string) => {
              const st = s ?? "online";
              return st === "online"
                ? "bg-green-500"
                : st === "idle"
                  ? "bg-yellow-500"
                  : st === "dnd"
                    ? "bg-red-500"
                    : "bg-gray-400";
            };

            if (chars.length === 1) {
              const c = chars[0]!;
              return (
                <div className="flex items-center gap-2 rounded-lg bg-black/30 px-2.5 py-1.5 backdrop-blur-sm">
                  <div className="relative flex-shrink-0">
                    {c.avatarUrl ? (
                      <img src={c.avatarUrl} alt={c.name} className="h-5 w-5 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/20 text-[0.5rem] font-bold text-foreground">
                        {c.name[0]}
                      </div>
                    )}
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-[1.5px] ring-black/30 ${statusColor(c.conversationStatus)}`}
                    />
                  </div>
                  <span className="text-[0.75rem] font-medium text-foreground/90">{c.name}</span>
                </div>
              );
            }

            // Multiple characters — show stacked avatars + names
            return (
              <div className="flex items-center gap-2 rounded-lg bg-black/30 px-2.5 py-1.5 backdrop-blur-sm">
                <div
                  className="relative flex-shrink-0"
                  style={{ width: `${Math.min(chars.length, 3) * 12 + 8}px`, height: 20 }}
                >
                  {chars.slice(0, 3).map((c, i) => (
                    <div key={i} className="absolute top-0" style={{ left: i * 12 }}>
                      <div className="relative">
                        {c.avatarUrl ? (
                          <img
                            src={c.avatarUrl}
                            alt={c.name}
                            className="h-5 w-5 rounded-full object-cover ring-1 ring-black/30"
                          />
                        ) : (
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/20 text-[0.5rem] font-bold text-foreground ring-1 ring-black/30">
                            {c.name[0]}
                          </div>
                        )}
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-[1px] ring-black/30 ${statusColor(c.conversationStatus)}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <span className="text-[0.75rem] font-medium text-white/90">
                  {chars.length <= 2 ? chars.map((c) => c.name).join(" & ") : `${chars[0]!.name} + ${chars.length - 1}`}
                </span>
              </div>
            );
          })()}

          <div className="flex items-center gap-1.5">
            <button
              onClick={onOpenFiles}
              className="flex items-center justify-center rounded-lg bg-black/30 p-1.5 text-foreground/80 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-foreground"
              title="Chat Files"
            >
              <FolderOpen size="0.875rem" />
            </button>
            <button
              onClick={onOpenGallery}
              className="flex items-center justify-center rounded-lg bg-black/30 p-1.5 text-foreground/80 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-foreground"
              title="Gallery"
            >
              <ImageIcon size="0.875rem" />
            </button>
            {onSwitchChat && (
              <button
                onClick={onSwitchChat}
                className="flex items-center justify-center rounded-lg bg-black/30 p-1.5 text-foreground/80 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-foreground"
                title={connectedChatName ? `Switch to ${connectedChatName}` : "Switch to connected chat"}
              >
                <ArrowRightLeft size="0.875rem" />
              </button>
            )}
            <button
              onClick={onOpenSettings}
              className="flex items-center justify-center rounded-lg bg-black/30 p-1.5 text-foreground/80 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-foreground"
              title="Chat Settings"
            >
              <Settings2 size="0.875rem" />
            </button>
          </div>
        </div>

        {/* Load More */}
        {hasNextPage && (
          <div className="flex justify-center py-3">
            <button
              onClick={handleLoadMore}
              disabled={isFetchingNextPage}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-all hover:bg-[var(--accent)] disabled:opacity-50"
            >
              {isFetchingNextPage ? <Loader2 size="0.75rem" className="animate-spin" /> : <ChevronUp size="0.75rem" />}
              Load More
            </button>
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--muted-foreground)]/20 border-t-[var(--muted-foreground)]/60" />
          </div>
        )}

        {/* Welcome message at the start of a conversation */}
        {!isLoading && !hasNextPage && messages && messages.length === 0 && (
          <div className="px-4 pt-2">
            <p className="text-xs text-[var(--muted-foreground)]">
              This is the start of your conversation with{" "}
              <span className="font-medium text-[var(--foreground)]">
                {(() => {
                  const names = chatCharIds.map((id) => characterMap.get(id)?.name).filter(Boolean) as string[];
                  if (names.length === 0) return "this group";
                  if (names.length === 1) return names[0];
                  return names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
                })()}
              </span>
              . Say hi!
            </p>
          </div>
        )}

        {/* Messages with day separators */}
        {(() => {
          const filtered = renderedItems.filter((item) => item.type !== "message" || !hiddenLineKeys.has(item.key));
          const elements: React.ReactNode[] = [];
          let i = 0;
          while (i < filtered.length) {
            const item = filtered[i]!;
            if (item.type === "separator") {
              elements.push(
                <div key={item.key} className="relative my-4 flex items-center px-4">
                  <div className="flex-1 border-t border-[var(--border)]/40" />
                  <span className="mx-4 text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">
                    {item.label}
                  </span>
                  <div className="flex-1 border-t border-[var(--border)]/40" />
                </div>,
              );
              i++;
              continue;
            }

            // Check if this starts a split-line group
            const isSplitStart = item.key.endsWith("__line0");
            if (isSplitStart) {
              const baseId = item.key.replace("__line0", "");
              const groupItems = [item];
              let j = i + 1;
              while (
                j < filtered.length &&
                filtered[j]!.type === "message" &&
                filtered[j]!.key.startsWith(baseId + "__line")
              ) {
                groupItems.push(filtered[j]! as typeof item);
                j++;
              }
              elements.push(
                <SplitMessageGroup
                  key={`split-${baseId}`}
                  items={groupItems}
                  isStreaming={isStreaming}
                  regenerateMessageId={regenerateMessageId}
                  streamBuffer={streamBuffer}
                  lastAssistantMessageId={lastAssistantMessageId}
                  characterMap={characterMap}
                  personaInfo={personaInfo}
                  onDelete={onDelete}
                  onRegenerate={onRegenerate}
                  onEdit={onEdit}
                  onPeekPrompt={onPeekPrompt}
                />,
              );
              i = j;
              continue;
            }

            // Regular single message
            const { msg, isGrouped } = item;
            const isRegenerating = isStreaming && regenerateMessageId === msg.id;
            // During regeneration, don't pass isStreaming until content arrives — the
            // "X is typing..." indicator at the bottom provides visual feedback instead
            // of showing bouncing dots inside the message bubble.
            const hasStreamContent = isRegenerating && !!streamBuffer;
            // Strip old-swipe attachments during regeneration so a previous
            // illustration doesn't linger while new text is streaming in.
            const displayMsg = isRegenerating
              ? (() => {
                  const parsed = typeof msg.extra === "string" ? JSON.parse(msg.extra) : (msg.extra ?? {});
                  return { ...msg, content: streamBuffer || msg.content, extra: { ...parsed, attachments: null } };
                })()
              : msg;
            elements.push(
              <ConversationMessage
                key={item.key}
                message={displayMsg as any}
                isStreaming={hasStreamContent}
                isGrouped={isGrouped}
                onDelete={onDelete}
                onRegenerate={onRegenerate}
                onEdit={onEdit}
                onPeekPrompt={onPeekPrompt}
                isLastAssistantMessage={msg.id === lastAssistantMessageId}
                characterMap={characterMap}
                personaInfo={personaInfo as any}
                messageIndex={item.index + 1}
                multiSelectMode={multiSelectMode}
                isSelected={selectedMessageIds?.has(msg.id)}
                onToggleSelect={onToggleSelectMessage}
              />,
            );
            i++;
          }
          return elements;
        })()}

        {/* Delayed indicator (DND/idle — waiting for character to become available) */}
        {delayedCharacterInfo && isStreaming && !streamBuffer && (
          <div className="flex items-center gap-2 px-4 py-1.5 text-[0.8125rem] text-[var(--text-secondary)]">
            <span className="italic">
              {delayedCharacterInfo.status === "dnd"
                ? `${delayedCharacterInfo.name} ${delayedCharacterInfo.name.includes(",") ? "are" : "is"} busy — they'll respond when they're back`
                : `${delayedCharacterInfo.name} ${delayedCharacterInfo.name.includes(",") ? "are" : "is"} away — they'll respond in a moment`}
            </span>
          </div>
        )}

        {/* Typing indicator — shown when generation is actively running */}
        {isStreaming && !streamBuffer && typingCharacterName && (
          <div className="flex items-center gap-2 px-4 py-1.5 text-[0.8125rem] text-[var(--text-secondary)]">
            <span className="flex gap-0.5">
              <span
                className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-secondary)]"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-secondary)]"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-secondary)]"
                style={{ animationDelay: "300ms" }}
              />
            </span>
            <span className="italic">{typingCharacterName} is typing...</span>
          </div>
        )}

        {/* Streaming message — only shown once actual content starts arriving */}
        {isStreaming && !regenerateMessageId && streamBuffer && (
          <ConversationMessage
            message={{
              id: "__streaming__",
              chatId,
              role: "assistant",
              characterId: streamingCharacterId ?? chatCharIds[0] ?? null,
              content: streamBuffer,
              activeSwipeIndex: 0,
              extra: {
                displayText: null,
                isGenerated: true,
                tokenCount: 0,
                generationInfo: null,
              },
              createdAt: new Date().toISOString(),
            }}
            isStreaming
            characterMap={characterMap}
            personaInfo={personaInfo as any}
          />
        )}

        {/* Scene banner — inline at bottom of messages (origin variant only) */}
        {sceneInfo?.variant === "origin" && <SceneBanner variant="origin" sceneChatId={sceneInfo.sceneChatId} />}

        <div ref={messagesEndRef} className="h-1" />
      </div>

      {/* ── Autonomous message toast notification ── */}
      {hasAutonomousMessaging && (
        <Suspense fallback={null}>
          <ConversationAutonomousEffects
            key={chatId}
            chatId={chatId}
            chatCharIds={chatCharIds}
            messages={messages}
            characterMap={characterMap}
            chatMeta={chatMeta}
          />
        </Suspense>
      )}

      {/* ── End Scene bar (above input) ── */}
      {sceneInfo?.variant === "scene" && sceneInfo.sceneChatId && onConcludeScene && (
        <EndSceneBar
          sceneChatId={sceneInfo.sceneChatId}
          originChatId={sceneInfo.originChatId}
          onConclude={onConcludeScene}
          onAbandon={onAbandonScene}
        />
      )}

      {/* ── Input area ── */}
      <ConversationInput characterNames={characterNames} />
    </div>
  );
}

// ── Split-line group wrapper — manages shared tap-to-show-actions state ──
function SplitMessageGroup({
  items,
  isStreaming,
  regenerateMessageId,
  streamBuffer,
  lastAssistantMessageId,
  characterMap,
  personaInfo,
  onDelete,
  onRegenerate,
  onEdit,
  onPeekPrompt,
}: {
  items: Array<{ key: string; msg: Message; isGrouped: boolean; index: number }>;
  isStreaming: boolean;
  regenerateMessageId: string | null;
  streamBuffer: string;
  lastAssistantMessageId: string | undefined | null;
  characterMap: CharacterMap;
  personaInfo: PersonaInfo | undefined;
  onDelete: (id: string) => void;
  onRegenerate: (id: string) => void;
  onEdit: (id: string, content: string) => void;
  onPeekPrompt: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);

  const fullContent = items.map((gi) => gi.msg.content).join("\n");
  const messageId = items[0]!.msg.id;

  const handleStartEdit = useCallback(() => {
    setEditing(true);
    setEditValue(fullContent);
    requestAnimationFrame(() => editRef.current?.focus());
  }, [fullContent]);

  const handleSaveEdit = useCallback(() => {
    if (editValue.trim() !== fullContent) {
      onEdit(messageId, editValue.trim());
    }
    setEditing(false);
  }, [editValue, fullContent, messageId, onEdit]);

  if (editing) {
    // Show the first message header + a single textarea for the full content
    const firstItem = items[0]!;
    const { msg } = firstItem;
    return (
      <div className="group relative">
        <ConversationMessage
          key={firstItem.key}
          message={{ ...msg, content: "" } as any}
          isStreaming={false}
          isGrouped={firstItem.isGrouped}
          noHoverGroup
          hideActions
          onDelete={onDelete}
          onRegenerate={onRegenerate}
          onEdit={onEdit}
          onPeekPrompt={onPeekPrompt}
          isLastAssistantMessage={false}
          characterMap={characterMap}
          personaInfo={personaInfo as any}
        />
        <div className="space-y-2 pl-14 pr-4 -mt-1">
          <textarea
            ref={editRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="w-full resize-none rounded-lg border border-white/25 bg-[var(--secondary)] p-2.5 text-[0.9375rem] leading-relaxed outline-none"
            rows={Math.min(editValue.split("\n").length + 1, 16)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && editValue === "") {
                e.preventDefault();
                setEditing(false);
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSaveEdit();
              }
            }}
          />
          <div className="flex items-center gap-2 text-[0.6875rem] text-[var(--muted-foreground)]">
            backspace (empty) to{" "}
            <button
              onClick={() => setEditing(false)}
              className="text-foreground/70 hover:underline hover:text-foreground"
            >
              cancel
            </button>{" "}
            · enter to{" "}
            <button onClick={handleSaveEdit} className="text-foreground/70 hover:underline hover:text-foreground">
              save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative" onClick={() => setShowActions((v) => !v)}>
      {(() => {
        // During regeneration, the split lines all belong to the same message ID.
        // Collapse them into a single ConversationMessage showing the streamed content
        // (or "X is typing…" via the indicator below) rather than repeating dots/content per line.
        const firstItem = items[0]!;
        const isRegen = isStreaming && regenerateMessageId === firstItem.msg.id;
        // Strip old-swipe attachments during regeneration so a previous
        // illustration doesn't linger while new text is streaming in.
        const regenExtra = isRegen
          ? (() => {
              const p =
                typeof firstItem.msg.extra === "string" ? JSON.parse(firstItem.msg.extra) : (firstItem.msg.extra ?? {});
              return { ...p, attachments: null };
            })()
          : undefined;
        if (isRegen) {
          // While waiting for content, don't render — the "X is typing..." indicator
          // at the bottom of the message list provides the visual feedback.
          if (!streamBuffer) {
            return (
              <ConversationMessage
                key={firstItem.key}
                message={{ ...firstItem.msg, content: "", extra: regenExtra } as any}
                isStreaming={false}
                isGrouped={firstItem.isGrouped}
                hideActions
                noHoverGroup
                onDelete={onDelete}
                onRegenerate={onRegenerate}
                onEdit={onEdit}
                onPeekPrompt={onPeekPrompt}
                isLastAssistantMessage={false}
                characterMap={characterMap}
                personaInfo={personaInfo as any}
              />
            );
          }
          const dMsg = { ...firstItem.msg, content: streamBuffer, extra: regenExtra };
          return (
            <ConversationMessage
              key={firstItem.key}
              message={dMsg as any}
              isStreaming
              isGrouped={firstItem.isGrouped}
              hideActions={false}
              noHoverGroup
              forceShowActions={showActions}
              onDelete={onDelete}
              onRegenerate={onRegenerate}
              onEdit={onEdit}
              onPeekPrompt={onPeekPrompt}
              onEditClick={handleStartEdit}
              isLastAssistantMessage={firstItem.msg.id === lastAssistantMessageId}
              characterMap={characterMap}
              personaInfo={personaInfo as any}
              messageIndex={firstItem.index + 1}
            />
          );
        }

        return items.map((gi) => {
          const { msg, isGrouped: grp } = gi;
          const isChild = !gi.key.endsWith("__line0");
          return (
            <ConversationMessage
              key={gi.key}
              message={msg as any}
              isStreaming={false}
              isGrouped={grp}
              hideActions={isChild}
              noHoverGroup
              forceShowActions={showActions}
              onDelete={onDelete}
              onRegenerate={onRegenerate}
              onEdit={onEdit}
              onPeekPrompt={onPeekPrompt}
              onEditClick={handleStartEdit}
              isLastAssistantMessage={msg.id === lastAssistantMessageId}
              characterMap={characterMap}
              personaInfo={personaInfo as any}
              messageIndex={gi.index + 1}
            />
          );
        });
      })()}
    </div>
  );
}
