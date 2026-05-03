// ──────────────────────────────────────────────
// React Query: Generation (streaming + agent pipeline)
// ──────────────────────────────────────────────
import { useCallback } from "react";
import { useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api-client";
import type { PendingCardUpdate } from "../stores/agent.store";
import {
  EDITABLE_CHARACTER_CARD_FIELDS,
  type CharacterCardFieldUpdate,
  type EditableCharacterCardField,
} from "@marinara-engine/shared";

/** Show a persistent, copyable error toast and log to console */
function showError(msg: string) {
  console.error("[Generation]", msg);
  toast.error(msg, { duration: 15000 });
}

const editableCharacterCardFieldSet = new Set<string>(EDITABLE_CHARACTER_CARD_FIELDS);
/**
 * Validate one entry in the Card Evolution Auditor's `updates` array and coerce
 * it to a typed CharacterCardFieldUpdate. LLM output can be messy, so we drop
 * anything that doesn't parse cleanly.
 */
function parseCardFieldUpdate(raw: unknown): CharacterCardFieldUpdate | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  if (u.action !== "update") return null;
  if (typeof u.characterId !== "string" || u.characterId.trim().length === 0) return null;
  if (typeof u.field !== "string" || !editableCharacterCardFieldSet.has(u.field)) return null;
  if (typeof u.oldText !== "string") return null;
  if (typeof u.newText !== "string") return null;
  if (u.oldText === u.newText) return null;
  return {
    characterId: u.characterId.trim(),
    action: "update",
    field: u.field as EditableCharacterCardField,
    oldText: u.oldText,
    newText: u.newText,
    reason: typeof u.reason === "string" ? u.reason : "",
  };
}

function parseCharacterRowData(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return null;
}

/**
 * Build one or more PendingCardUpdate batches from a character_card_update
 * agent result. Each batch is scoped to a single characterId so the approval
 * modal can review and apply updates without ownership heuristics.
 */
async function buildPendingCardUpdates(
  qc: QueryClient,
  chatId: string,
  agentName: string,
  rawData: unknown,
): Promise<PendingCardUpdate[]> {
  const data = rawData && typeof rawData === "object" ? (rawData as Record<string, unknown>) : null;
  const rawUpdates = data && Array.isArray(data.updates) ? (data.updates as unknown[]) : [];
  const updates = rawUpdates.map(parseCardFieldUpdate).filter((u): u is CharacterCardFieldUpdate => u !== null);
  if (updates.length === 0) return [];

  const chat = qc.getQueryData<Chat>(chatKeys.detail(chatId));
  // characterIds is sometimes serialized as a JSON string on the wire —
  // accept either shape to avoid a .map crash on group chats.
  const rawChatCharIds = (chat as { characterIds?: unknown })?.characterIds;
  let chatCharacterIds: string[] = [];
  if (Array.isArray(rawChatCharIds)) {
    chatCharacterIds = rawChatCharIds.filter((v): v is string => typeof v === "string");
  } else if (typeof rawChatCharIds === "string") {
    try {
      const parsed = JSON.parse(rawChatCharIds);
      if (Array.isArray(parsed)) chatCharacterIds = parsed.filter((v): v is string => typeof v === "string");
    } catch {
      /* leave empty */
    }
  }
  if (chatCharacterIds.length === 0) return [];
  const chatCharacterIdSet = new Set(chatCharacterIds);

  // Prime the characters list cache if empty so we can resolve names.
  let characters = qc.getQueryData<Array<{ id: string; data?: unknown; name?: string }>>(characterKeys.list());
  if (!characters) {
    try {
      characters = await qc.fetchQuery({
        queryKey: characterKeys.list(),
        queryFn: () => api.get<Array<{ id: string; data?: unknown; name?: string }>>("/characters"),
      });
    } catch {
      characters = undefined;
    }
  }
  const chatCharacters = new Map(
    chatCharacterIds.map((id) => {
      const row = characters?.find((character) => character.id === id);
      const parsed = parseCharacterRowData(row?.data);
      return [id, { row, parsed }] as const;
    }),
  );

  const groupedUpdates = new Map<string, CharacterCardFieldUpdate[]>();
  for (const update of updates) {
    if (!chatCharacterIdSet.has(update.characterId)) continue;

    const existing = groupedUpdates.get(update.characterId) ?? [];
    existing.push(update);
    groupedUpdates.set(update.characterId, existing);
  }

  if (groupedUpdates.size === 0) return [];

  const timestamp = Date.now();
  return chatCharacterIds.flatMap((characterId, index) => {
    const grouped = groupedUpdates.get(characterId);
    if (!grouped || grouped.length === 0) return [];

    const character = chatCharacters.get(characterId);
    const characterName =
      (character?.parsed && typeof character.parsed.name === "string" && character.parsed.name) ||
      character?.row?.name ||
      "Character";

    return [
      {
        id: `card-update-${characterId}-${timestamp}-${index}`,
        characterId,
        characterName,
        updates: grouped,
        agentName,
        timestamp: timestamp + index,
      },
    ];
  });
}
import { useChatStore } from "../stores/chat.store";
import { useAgentStore } from "../stores/agent.store";
import { useGameModeStore } from "../stores/game-mode.store";
import { useGameStateStore } from "../stores/game-state.store";
import { useTranslationStore } from "../stores/translation.store";
import { useUIStore } from "../stores/ui.store";
import { chatKeys } from "./use-chats";
import { characterKeys } from "./use-characters";
import { playNotificationPing } from "../lib/notification-sound";
import { stripGmTagsKeepReadables } from "../lib/game-tag-parser";
import type { Chat, GameMap, Message } from "@marinara-engine/shared";

function sortMessagesByCreatedAt(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    const createdAtOrder = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (createdAtOrder !== 0) return createdAtOrder;
    return 0;
  });
}

function upsertPersistedMessages(qc: QueryClient, chatId: string, incoming: Message[]) {
  if (incoming.length === 0) return;

  const sortedIncoming = sortMessagesByCreatedAt(incoming);

  qc.setQueryData<InfiniteData<Message[]>>(chatKeys.messages(chatId), (old) => {
    if (!old?.pages) {
      return {
        pageParams: [undefined],
        pages: [sortedIncoming],
      };
    }

    const persistedById = new Map(sortedIncoming.map((msg) => [msg.id, msg]));
    const existingIds = new Set<string>();

    const pages = old.pages.map((page) =>
      page.map((msg) => {
        existingIds.add(msg.id);
        const persisted = persistedById.get(msg.id);
        return persisted ? { ...msg, ...persisted } : msg;
      }),
    );

    const missing = sortedIncoming.filter((msg) => !existingIds.has(msg.id));
    if (missing.length > 0) {
      if (pages.length === 0) {
        pages.push(missing);
      } else {
        pages[0] = sortMessagesByCreatedAt([...pages[0], ...missing]);
      }
    }

    return { ...old, pages };
  });
}

function appendMissingPersistedMessages(qc: QueryClient, chatId: string, incoming: Message[]) {
  if (incoming.length === 0) return;

  const sortedIncoming = sortMessagesByCreatedAt(incoming);

  qc.setQueryData<InfiniteData<Message[]>>(chatKeys.messages(chatId), (old) => {
    if (!old?.pages) {
      return {
        pageParams: [undefined],
        pages: [sortedIncoming],
      };
    }

    const existingIds = new Set(old.pages.flatMap((page) => page.map((msg) => msg.id)));
    const missing = sortedIncoming.filter((msg) => !existingIds.has(msg.id));
    if (missing.length === 0) return old;

    const pages = [...old.pages];
    if (pages.length === 0) {
      pages.push(missing);
    } else {
      pages[0] = sortMessagesByCreatedAt([...pages[0], ...missing]);
    }

    return { ...old, pages };
  });
}

async function refreshMessagesAuthoritatively(
  qc: QueryClient,
  chatId: string,
  persistedMessages: Iterable<Message> = [],
) {
  const msgKey = chatKeys.messages(chatId);
  const persisted = [...persistedMessages];
  let refetchSucceeded = false;

  // Also refresh the total message count used for absolute numbering
  qc.invalidateQueries({ queryKey: chatKeys.messageCount(chatId) });

  await qc.cancelQueries({ queryKey: msgKey, exact: true });

  try {
    await qc.refetchQueries({ queryKey: msgKey, exact: true, type: "all" });
    refetchSucceeded = true;
  } catch {
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await qc.refetchQueries({ queryKey: msgKey, exact: true, type: "all" });
      refetchSucceeded = true;
    } catch {
      /* best-effort — keep any persisted messages we already have */
    }
  }

  if (persisted.length > 0) {
    if (refetchSucceeded) {
      // After a fresh refetch, only append rows that are still missing.
      // Do not overwrite fetched rows with the earlier message_saved snapshot,
      // because later agent work can add attachments or extra fields.
      appendMissingPersistedMessages(qc, chatId, persisted);
    } else {
      upsertPersistedMessages(qc, chatId, persisted);
    }
  }
}

function parseChatMetadata(metadata: Chat["metadata"] | string | null | undefined): Record<string, unknown> {
  if (!metadata) return {};
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return metadata as Record<string, unknown>;
}

function slugifyGameMapId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getGameMapId(map: GameMap | null | undefined, fallbackIndex = 0): string | null {
  if (!map) return null;
  const explicit = map.id?.trim();
  if (explicit) return explicit;
  return slugifyGameMapId(map.name || "") || `map-${fallbackIndex + 1}`;
}

function withGameMapCollection(metadata: Record<string, unknown>, map: GameMap): Record<string, unknown> {
  const mapId = getGameMapId(map);
  const existingMaps = Array.isArray(metadata.gameMaps) ? (metadata.gameMaps as GameMap[]) : [];
  const nextMaps = [...existingMaps];
  const existingIndex = nextMaps.findIndex((entry, index) => getGameMapId(entry, index) === mapId);

  if (existingIndex >= 0) {
    nextMaps[existingIndex] = map;
  } else {
    nextMaps.push(map);
  }

  return {
    ...metadata,
    gameMap: map,
    gameMaps: nextMaps,
    activeGameMapId: mapId,
  };
}

function applyGameMapUpdate(qc: QueryClient, chatId: string, map: GameMap) {
  qc.setQueryData<Chat | undefined>(chatKeys.detail(chatId), (current) => {
    if (!current) return current;
    const metadata = withGameMapCollection(parseChatMetadata(current.metadata as Chat["metadata"] | string), map);
    return {
      ...current,
      metadata: metadata as Chat["metadata"],
    };
  });

  const chatStore = useChatStore.getState();
  if (chatStore.activeChat?.id === chatId) {
    const metadata = withGameMapCollection(
      parseChatMetadata(chatStore.activeChat.metadata as Chat["metadata"] | string),
      map,
    );
    chatStore.setActiveChat({
      ...chatStore.activeChat,
      metadata: metadata as Chat["metadata"],
    });
    useGameModeStore.getState().upsertMap(map, true);
  }
}

/**
 * Hook that handles streaming generation.
 * Returns a function to trigger generation which streams tokens
 * into the chat store, dispatches agent results to the agent store,
 * and invalidates messages on completion.
 */
export function useGenerate() {
  const qc = useQueryClient();
  // Use individual selectors to avoid re-rendering on every store change
  const setStreaming = useChatStore((s) => s.setStreaming);
  const setMariPhase = useChatStore((s) => s.setMariPhase);
  const setStreamBuffer = useChatStore((s) => s.setStreamBuffer);
  const clearStreamBuffer = useChatStore((s) => s.clearStreamBuffer);
  const setRegenerateMessageId = useChatStore((s) => s.setRegenerateMessageId);
  const setStreamingCharacterId = useChatStore((s) => s.setStreamingCharacterId);
  const setTypingCharacterName = useChatStore((s) => s.setTypingCharacterName);
  const setDelayedCharacterInfo = useChatStore((s) => s.setDelayedCharacterInfo);
  const setProcessing = useAgentStore((s) => s.setProcessing);
  const addResult = useAgentStore((s) => s.addResult);
  const addThoughtBubble = useAgentStore((s) => s.addThoughtBubble);
  const clearThoughtBubbles = useAgentStore((s) => s.clearThoughtBubbles);
  const addEchoMessage = useAgentStore((s) => s.addEchoMessage);
  const setCyoaChoices = useAgentStore((s) => s.setCyoaChoices);
  const clearCyoaChoices = useAgentStore((s) => s.clearCyoaChoices);
  const enqueuePendingCardUpdate = useAgentStore((s) => s.enqueuePendingCardUpdate);
  const setFailedAgentTypes = useAgentStore((s) => s.setFailedAgentTypes);
  const clearFailedAgentTypes = useAgentStore((s) => s.clearFailedAgentTypes);
  const setGameState = useGameStateStore((s) => s.setGameState);

  const generate = useCallback(
    async (params: {
      chatId: string;
      connectionId: string | null;
      presetId?: string;
      lorebookIds?: string[];
      userMessage?: string;
      regenerateMessageId?: string;
      impersonate?: boolean;
      attachments?: Array<{ type: string; data: string }>;
      mentionedCharacterNames?: string[];
      forCharacterId?: string;
      generationGuide?: string;
    }) => {
      // Prevent concurrent generations for the SAME chat — stops race conditions
      // where autonomous messaging + user input both fire generate at once.
      // Different chats CAN generate concurrently (e.g. idle/DnD delay in chat A
      // while the user sends in chat B).
      // Uses the shared abortControllers map as the source of truth so ALL callers
      // of useGenerate() coordinate (the old per-instance useRef could diverge).
      if (useChatStore.getState().abortControllers.has(params.chatId)) {
        console.warn("[Generate] Skipped — generation already in progress for this chat");
        return false;
      }

      // Abort any in-progress generation for the SAME chat before starting a new one.
      const prev = useChatStore.getState().abortControllers.get(params.chatId);
      if (prev) prev.abort();

      // Create an AbortController so the stop button can cancel this generation
      const abortController = new AbortController();
      useChatStore.getState().setAbortController(params.chatId, abortController);

      // Helper: returns true when this generation's chat is the one the user is viewing.
      // Used to guard global UI state updates (typing indicator, delayed info, stream
      // buffer, etc.) so that a background chat's events don't corrupt the active view.
      const isActiveChat = () => useChatStore.getState().activeChatId === params.chatId;

      // Only touch global streaming UI state if the user is viewing this chat.
      // Background generations (e.g. autonomous messaging) run silently,
      // tracked only by abortControllers.
      if (isActiveChat()) {
        setStreaming(true, params.chatId);
        clearStreamBuffer(params.chatId);
        clearThoughtBubbles();
        clearCyoaChoices();
        clearFailedAgentTypes();
        setRegenerateMessageId(params.regenerateMessageId ?? null);
      }
      console.warn("[Generate] Starting generation for chat:", params.chatId);

      // A stale in-flight message refetch can overwrite the saved assistant
      // message after it is upserted into the cache. Cancel early so the
      // post-save refresh owns the query lifecycle for this generation.
      await qc.cancelQueries({ queryKey: chatKeys.messages(params.chatId), exact: true });

      // Optimistically show the user message in the chat immediately
      if (params.userMessage && !params.impersonate) {
        // Build persona snapshot for per-message persona tracking
        const cachedPersonas = qc.getQueryData<
          Array<{
            id: string;
            isActive: string | boolean;
            name: string;
            description?: string;
            personality?: string;
            scenario?: string;
            backstory?: string;
            appearance?: string;
            avatarPath?: string | null;
            nameColor?: string;
            dialogueColor?: string;
            boxColor?: string;
          }>
        >(characterKeys.personas);
        const activeChat =
          qc.getQueryData<any>(chatKeys.detail(params.chatId)) ??
          (qc.getQueryData<any[]>(chatKeys.list()) ?? []).find((c: any) => c.id === params.chatId);
        const chatPersonaId = activeChat?.personaId as string | null | undefined;
        const snapshotPersona = cachedPersonas
          ? ((chatPersonaId ? cachedPersonas.find((p) => p.id === chatPersonaId) : null) ??
            cachedPersonas.find((p) => p.isActive === "true" || p.isActive === true))
          : null;
        const personaSnapshot = snapshotPersona
          ? {
              personaId: snapshotPersona.id,
              name: snapshotPersona.name,
              description: snapshotPersona.description || "",
              personality: snapshotPersona.personality || "",
              scenario: snapshotPersona.scenario || "",
              backstory: snapshotPersona.backstory || "",
              appearance: snapshotPersona.appearance || "",
              avatarUrl: snapshotPersona.avatarPath || null,
              nameColor: snapshotPersona.nameColor || null,
              dialogueColor: snapshotPersona.dialogueColor || null,
              boxColor: snapshotPersona.boxColor || null,
            }
          : null;

        const optimisticMsg: Message = {
          id: `__optimistic_${Date.now()}`,
          chatId: params.chatId,
          role: "user",
          characterId: null,
          content: params.userMessage,
          activeSwipeIndex: 0,
          extra: { displayText: null, isGenerated: false, tokenCount: null, generationInfo: null, personaSnapshot },
          createdAt: new Date().toISOString(),
        };
        qc.setQueryData<InfiniteData<Message[]>>(chatKeys.messages(params.chatId), (old) => {
          if (!old?.pages) return old;
          const pages = [...old.pages];
          // First page holds newest messages; merge and re-sort to guarantee order.
          pages[0] = sortMessagesByCreatedAt([...(pages[0] ?? []), optimisticMsg]);
          return { ...old, pages };
        });
      }

      // ── SillyTavern-style smooth streaming ──
      // Tokens arrive in bursts from the server. Instead of dumping them
      // immediately, we feed them character-by-character from a queue
      // at a controlled rate so the text "types out" smoothly.
      // Speed is controlled by the user's streamingSpeed setting (1–100).
      // Conversation mode still renders complete messages, but the transport
      // should follow the user's streaming preference.
      const isConversationMode = useChatStore.getState().activeChat?.mode === "conversation";
      const transportStreaming = useUIStore.getState().enableStreaming;
      const streamingEnabled = isConversationMode ? false : transportStreaming;
      let fullBuffer = ""; // What the user sees (or accumulates silently when streaming is off)
      let pendingText = ""; // Tokens waiting to be typed out
      let receivedContent = false; // Whether any actual message content was received
      let typingActive = false;
      let typewriterDone: (() => void) | null = null;
      let rafId = 0;
      const persistedMessages = new Map<string, Message>();

      // ── Streaming think-tag filter ──
      // Models may emit <think>...</think>, <thinking>...</thinking>, or
      // <|channel>thought ... <channel|> at the start of their response.
      // We intercept these tokens during streaming so
      // the user never sees the raw tags — the server will extract the content
      // into message.extra.thinking and emit a content_replace event.
      //
      // States: "detect" (start of response, looking for opening tag),
      //         "inside" (inside a think block, suppressing tokens),
      //         "done" (think block closed or no think tag found — passthrough).
      // Think-tag filtering disabled — skip straight to passthrough
      let thinkState: string = "done";
      let thinkBuf = ""; // Raw token accumulator during detect/inside phases
      let thinkCloseTag = "</think>";
      const THINK_OPEN_RE = /^(\s*)(<(think(?:ing)?)>|<\|channel>thought\b)/i;
      const THINK_OPEN_PREFIXES = ["<thinking>", "<think>", "<|channel>thought"];

      // Compute charsPerTick from the user's streamingSpeed setting (1–100).
      // Read per-tick so changes to the slider take effect immediately.
      // Uses an exponential curve so each notch on the slider feels perceptibly different.
      // speed 1   → 1 char/tick  → ~60 chars/sec   (slow typewriter effect)
      // speed 50  → 22 chars/tick → ~1300 chars/sec (fast but visible)
      // speed 100 → flush instantly (no typewriter)
      const EXP_RATE = Math.log(500) / 98;
      const getCharsPerTick = () => {
        const speed = useUIStore.getState().streamingSpeed;
        return speed >= 100 ? Infinity : Math.max(1, Math.round(Math.exp(EXP_RATE * (speed - 1))));
      };

      // Adaptive catch-up: when the queue gets very long, temporarily increase
      // chars-per-tick to prevent the typewriter lagging far behind real completion.
      const CATCHUP_THRESHOLD = 300;
      const CATCHUP_MULTIPLIER = 4;

      console.log(
        "[Typewriter] streaming=%s, speed=%d, charsPerTick=%d",
        streamingEnabled,
        useUIStore.getState().streamingSpeed,
        getCharsPerTick(),
      );

      const flushTypewriterBuffer = () => {
        cancelAnimationFrame(rafId);
        fullBuffer += pendingText;
        pendingText = "";
        typingActive = false;
        if (streamingEnabled && fullBuffer) setStreamBuffer(fullBuffer, params.chatId);
      };

      const startTypewriter = () => {
        if (typingActive) return;
        typingActive = true;
        const tick = () => {
          if (pendingText.length === 0) {
            typingActive = false;
            if (typewriterDone) {
              typewriterDone();
              typewriterDone = null;
            }
            return;
          }
          // Read speed per-tick so the slider has immediate effect
          const charsPerTick = getCharsPerTick();
          // Catch-up: if the pending queue is very long, increase speed to avoid
          // the typewriter still running long after the model finished.
          const effective = pendingText.length > CATCHUP_THRESHOLD ? charsPerTick * CATCHUP_MULTIPLIER : charsPerTick;
          const n = Math.min(effective, pendingText.length);
          const batch = pendingText.slice(0, n);
          pendingText = pendingText.slice(n);
          fullBuffer += batch;
          setStreamBuffer(fullBuffer, params.chatId);
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      };

      // Safety net: guarantees the Mari work-status pill clears for this
      // chat on every termination path (done, error, abort, unexpected
      // throw). The assistant_commands_end SSE event is still the primary
      // clear; this just keeps state sane when the stream dies mid-window.
      const clearMariPhaseForThisChat = () => {
        setMariPhase(params.chatId, "idle");
        window.dispatchEvent(
          new CustomEvent("marinara:mari-phase", {
            detail: { chatId: params.chatId, phase: "idle" },
          }),
        );
      };

      try {
        const { userStatus, debugMode } = useUIStore.getState();

        // Flush any pending game-state widget edits so the server sees them before committing
        const flushPatch = useGameStateStore.getState().flushPatch;
        if (flushPatch) await flushPatch();

        for await (const event of api.streamEvents(
          "/generate",
          { ...params, userStatus, debugMode, streaming: transportStreaming },
          abortController.signal,
        )) {
          switch (event.type) {
            case "token": {
              const isFirstToken = !receivedContent;
              receivedContent = true;
              // Always clear per-chat indicators so switching back shows nothing
              useChatStore.getState().setPerChatTyping(params.chatId, null);
              useChatStore.getState().setPerChatDelayed(params.chatId, null);
              if (isActiveChat()) {
                setTypingCharacterName(null); // Clear typing indicator once response starts
                setDelayedCharacterInfo(null); // Clear delayed indicator too
                useChatStore.getState().setGenerationPhase(null); // Clear phase indicator
              }
              // Fire the "Mari is thinking…" pill on the first token — that's
              // the same moment "X is typing…" clears, so the two indicators
              // never overlap. Also seed the per-chat phase in the store so
              // the indicator can restore the pill on chat-switch-back.
              if (isFirstToken) {
                setMariPhase(params.chatId, "thinking");
                window.dispatchEvent(
                  new CustomEvent("marinara:mari-phase", {
                    detail: { chatId: params.chatId, phase: "thinking" },
                  }),
                );
              }

              let chunk = event.data as string;

              // ── Think-tag streaming filter ──
              if (thinkState === "detect") {
                // Still at the start — accumulate and look for an opening tag
                thinkBuf += chunk;
                const openMatch = thinkBuf.match(THINK_OPEN_RE);
                if (openMatch) {
                  // Found opening tag — enter suppression mode
                  thinkState = "inside";
                  thinkBuf = thinkBuf.slice(openMatch[0].length);
                  thinkCloseTag = openMatch[3] ? `</${openMatch[3].toLowerCase()}>` : "<channel|>";
                  chunk = ""; // suppress
                } else if (
                  thinkBuf.length > 30 ||
                  (!THINK_OPEN_PREFIXES.some((prefix) => prefix.startsWith(thinkBuf.trimStart().toLowerCase())) &&
                    thinkBuf.trimStart().length > 0)
                ) {
                  // Not a think tag — flush accumulated buffer as regular content
                  thinkState = "done";
                  chunk = thinkBuf;
                  thinkBuf = "";
                } else {
                  // Still ambiguous (partial tag like "<thi") — keep buffering
                  chunk = "";
                }
              }

              if (thinkState === "inside") {
                thinkBuf += chunk;
                const closeIdx = thinkBuf.toLowerCase().indexOf(thinkCloseTag.toLowerCase());
                if (closeIdx !== -1) {
                  // Found closing tag — everything after it is visible content
                  thinkState = "done";
                  chunk = thinkBuf.slice(closeIdx + thinkCloseTag.length).trimStart();
                  thinkBuf = "";
                } else {
                  chunk = ""; // still inside — suppress
                }
              }

              if (!chunk) break;

              if (streamingEnabled) {
                pendingText += chunk;
                startTypewriter();
              } else {
                // Accumulate silently — don't update the UI until done
                fullBuffer += chunk;
              }
              break;
            }

            case "agent_start": {
              if (isActiveChat()) setProcessing(true);
              break;
            }

            case "progress": {
              if (!isActiveChat()) break;
              const phase = (event.data as { phase?: string })?.phase;
              const labels: Record<string, string> = {
                embedding: "Preparing context...",
                assembling: "Building prompt...",
                lorebooks: "Scanning lorebooks...",
                memory_recall: "Recalling memories...",
                agents: "Running agents...",
                knowledge_retrieval: "Retrieving knowledge...",
                generating: "Generating...",
              };
              const label = phase ? (labels[phase] ?? null) : null;
              if (label) {
                useChatStore.getState().setGenerationPhase(label);
              }
              break;
            }

            case "agent_result": {
              const result = event.data as {
                agentType: string;
                agentName: string;
                resultType: string;
                data: unknown;
                success: boolean;
                error: string | null;
                durationMs: number;
              };

              // Always log agent results to console for visibility (use warn so it shows even if Info is filtered)
              if (result.success) {
                console.warn(
                  `[Agent] ✓ ${result.agentName} (${result.agentType}) — ${(result.durationMs / 1000).toFixed(1)}s`,
                  result.data,
                );
              } else {
                console.warn(
                  `[Agent] ✗ ${result.agentName} (${result.agentType}) — ${result.error ?? "unknown error"}`,
                  result.data,
                );
              }

              // Only update agent/game/UI stores for the active chat so a
              // background generation doesn't corrupt what the user sees.
              if (!isActiveChat()) break;

              // Store the result
              addResult(result.agentType, {
                agentId: result.agentType,
                agentType: result.agentType,
                type: result.resultType as any,
                data: result.data,
                tokensUsed: 0,
                durationMs: result.durationMs,
                success: result.success,
                error: result.error,
              });

              // Display as thought bubble for informational agents
              if (result.success && result.data) {
                const bubble = formatAgentBubble(result.agentType, result.agentName, result.data);
                if (bubble) {
                  addThoughtBubble(result.agentType, result.agentName, bubble);
                }

                // Push echo-chamber reactions to the dedicated echo store
                if (result.agentType === "echo-chamber") {
                  const d = result.data as Record<string, unknown>;
                  const reactions = (d.reactions as Array<{ characterName: string; reaction: string }>) ?? [];
                  for (const r of reactions) {
                    addEchoMessage(r.characterName, r.reaction);
                  }
                }

                // Push CYOA choices to the dedicated store
                if (result.agentType === "cyoa") {
                  const d = result.data as Record<string, unknown>;
                  const choices = (d.choices as Array<{ label: string; text: string }>) ?? [];
                  if (choices.length > 0) {
                    setCyoaChoices(choices);
                  }
                }
              }

              // Character card updates are never applied automatically — enqueue
              // them for the user-approval modal. (Card Evolution Auditor.)
              if (result.success && result.resultType === "character_card_update") {
                buildPendingCardUpdates(qc, params.chatId, result.agentName, result.data)
                  .then((pendingEntries) => {
                    if (pendingEntries.length > 0) {
                      for (const pending of pendingEntries) {
                        enqueuePendingCardUpdate(pending);
                      }
                      useUIStore.getState().openModal("character-card-update");
                    }
                  })
                  .catch((err) => console.warn("[Agent] Failed to build card update entry:", err));
              }

              // Apply background change — validate filename exists before applying
              if (result.success && result.resultType === "background_change" && result.data) {
                const bg = result.data as { chosen?: string | null };
                if (bg.chosen) {
                  // Validate background exists before setting it (prevents 404s from hallucinated filenames)
                  fetch(`/api/backgrounds/file/${encodeURIComponent(bg.chosen)}`, { method: "HEAD" })
                    .then((res) => {
                      if (res.ok) {
                        useUIStore
                          .getState()
                          .setChatBackground(`/api/backgrounds/file/${encodeURIComponent(bg.chosen!)}`);
                      } else {
                        console.warn(`[Agent] Background "${bg.chosen}" does not exist — skipping`);
                      }
                    })
                    .catch(() => {});
                }
              }

              // Apply quest updates directly so the widget updates immediately
              if (result.success && result.agentType === "quest" && result.data) {
                const qd = result.data as Record<string, unknown>;
                const updates = (qd.updates as any[]) ?? [];
                console.warn(`[Agent] Quest data:`, qd);
                console.warn(`[Agent] Quest updates: ${updates.length} update(s)`, updates);
                if (updates.length > 0) {
                  const cur = useGameStateStore.getState().current;
                  console.warn(`[Agent] Quest merge — current gameState:`, cur);
                  const existing = cur?.playerStats ?? {
                    stats: [],
                    attributes: null,
                    skills: {},
                    inventory: [],
                    activeQuests: [],
                    status: "",
                  };
                  const quests: any[] = [...(existing.activeQuests ?? [])];
                  for (const u of updates) {
                    const idx = quests.findIndex((q: any) => q.name === u.questName);
                    if (u.action === "create" && idx === -1) {
                      quests.push({
                        questEntryId: u.questName,
                        name: u.questName,
                        currentStage: 0,
                        objectives: u.objectives ?? [],
                        completed: false,
                      });
                    } else if (idx !== -1) {
                      if (u.action === "update" && u.objectives) quests[idx].objectives = u.objectives;
                      else if (u.action === "complete") {
                        quests[idx].completed = true;
                        if (u.objectives) quests[idx].objectives = u.objectives;
                      } else if (u.action === "fail") quests.splice(idx, 1);
                    }
                  }
                  const merged = cur
                    ? { ...cur, playerStats: { ...existing, activeQuests: quests } }
                    : { playerStats: { ...existing, activeQuests: quests } };
                  console.warn(`[Agent] Quest merge result — activeQuests:`, quests);
                  setGameState(merged as any);
                } else {
                  console.warn(`[Agent] Quest agent returned success but 0 updates — data shape:`, Object.keys(qd));
                }
              }
              break;
            }

            case "tool_result": {
              // Already handled by existing tool display — pass through
              break;
            }

            case "thinking": {
              // Thinking chunks are streamed from the server but persisted in message extra
              // — the UI picks them up after query invalidation on "done". Nothing to buffer here.
              break;
            }

            case "group_turn": {
              const turn = event.data as { characterId: string; characterName: string; index: number };

              // If this isn't the first character, flush the previous one's content
              if (turn.index > 0) {
                // Drain typewriter for the previous character (only if streaming)
                if (streamingEnabled && (pendingText.length > 0 || typingActive)) {
                  await new Promise<void>((resolve) => {
                    if (pendingText.length === 0 && !typingActive) {
                      resolve();
                      return;
                    }
                    typewriterDone = resolve;
                    startTypewriter();
                  });
                }
                // Pick up the just-saved message from the previous character
                await refreshMessagesAuthoritatively(qc, params.chatId, persistedMessages.values());
                // Increment unread if user navigated away during group generation
                const activeNow = useChatStore.getState().activeChatId;
                if (activeNow !== params.chatId) {
                  useChatStore.getState().incrementUnread(params.chatId);
                  // Show floating avatar notification bubble
                  const charDetail = qc.getQueryData<{ avatarPath?: string | null }>(
                    characterKeys.detail(turn.characterId),
                  );
                  // Detail cache may be empty — fall back to list cache
                  let avatarPath = charDetail?.avatarPath ?? null;
                  if (!avatarPath) {
                    const charList = qc.getQueryData<Array<{ id: string; avatarPath?: string | null }>>(
                      characterKeys.list(),
                    );
                    avatarPath = charList?.find((c) => c.id === turn.characterId)?.avatarPath ?? null;
                  }
                  useChatStore.getState().addNotification(params.chatId, turn.characterName, avatarPath);
                  const chatList = qc.getQueryData<Chat[]>(chatKeys.list());
                  const thisChat = chatList?.find((c) => c.id === params.chatId);
                  const isRpMode = thisChat?.mode === "roleplay" || thisChat?.mode === "visual_novel";
                  const soundOn = isRpMode
                    ? useUIStore.getState().rpNotificationSound
                    : useUIStore.getState().convoNotificationSound;
                  if (soundOn) {
                    playNotificationPing();
                  }
                }
                // Reset the stream buffer for the new character
                fullBuffer = "";
                pendingText = "";
                thinkState = "done";
                thinkBuf = "";
                thinkCloseTag = "</think>";
                setStreamBuffer("", params.chatId);
              }

              if (isActiveChat()) setStreamingCharacterId(turn.characterId);
              break;
            }

            case "game_state":
            case "game_state_patch": {
              const patch = event.data as Record<string, unknown>;
              console.warn(`[Generate] ${event.type} received:`, patch);
              if (!isActiveChat()) break;
              const current = useGameStateStore.getState().current;
              if (current) {
                const merged = { ...current, ...patch };
                // Deep-merge playerStats so partial updates don't clobber sibling fields
                if (patch.playerStats && typeof patch.playerStats === "object" && current.playerStats) {
                  const mergedPS = { ...current.playerStats, ...(patch.playerStats as object) };
                  // Don't let an empty activeQuests overwrite existing quests
                  const patchPS = patch.playerStats as Record<string, unknown>;
                  if (
                    Array.isArray(patchPS.activeQuests) &&
                    patchPS.activeQuests.length === 0 &&
                    current.playerStats.activeQuests?.length > 0
                  ) {
                    mergedPS.activeQuests = current.playerStats.activeQuests;
                  }
                  (merged as any).playerStats = mergedPS;
                }
                setGameState(merged as any);
              } else {
                // Agent data may arrive before the base game state is loaded —
                // seed a minimal state so data isn't lost. Include chatId so the
                // RoleplayHUD mount-guard (`existing?.chatId === chatId`) recognises
                // this state belongs to the active chat and skips a redundant fetch.
                setGameState({ chatId: params.chatId, ...patch } as any);
              }
              break;
            }

            case "game_map_update": {
              const map = event.data as GameMap | null;
              if (map) applyGameMapUpdate(qc, params.chatId, map);
              break;
            }

            case "chat_summary": {
              // Refresh the chat detail so the summary popover picks up the new value
              qc.invalidateQueries({ queryKey: chatKeys.detail(params.chatId) });
              break;
            }

            case "text_rewrite": {
              // Consistency Editor replaced the message — update displayed text
              const rw = event.data as { editedText?: string; changes?: Array<{ description: string }> };
              if (rw.editedText) {
                if (streamingEnabled) {
                  // Drain any pending typewriter first
                  if (pendingText.length > 0 || typingActive) {
                    cancelAnimationFrame(rafId);
                    pendingText = "";
                    typingActive = false;
                  }
                }
                fullBuffer = rw.editedText;
                if (streamingEnabled) setStreamBuffer(rw.editedText, params.chatId);
              }
              break;
            }

            case "content_replace": {
              // Server stripped character commands — replace the displayed content
              const cleanContent = event.data as string;
              if (streamingEnabled) {
                cancelAnimationFrame(rafId);
                pendingText = "";
                typingActive = false;
              }
              fullBuffer = cleanContent;
              if (streamingEnabled) setStreamBuffer(cleanContent, params.chatId);
              break;
            }

            case "message_saved": {
              const savedMessage = event.data as Message;
              await qc.cancelQueries({ queryKey: chatKeys.messages(params.chatId), exact: true });
              persistedMessages.set(savedMessage.id, savedMessage);
              // During non-regeneration streaming, defer the cache upsert until
              // streaming ends. Otherwise the saved message appears in the list
              // while the StreamingIndicator is still visible — causing a
              // duplicate message that vanishes on refresh.
              if (params.regenerateMessageId || !streamingEnabled) {
                upsertPersistedMessages(qc, params.chatId, [savedMessage]);
              }
              break;
            }

            case "schedule_updated": {
              const schedData = event.data as { characterId: string; status?: string; activity?: string };
              const charName = schedData.activity || schedData.status || "schedule";
              console.log(`[commands] Schedule updated for ${schedData.characterId}: ${charName}`);
              break;
            }

            case "cross_post": {
              const cpData = event.data as {
                targetChatId: string;
                targetChatName: string;
                sourceChatId: string;
                characterId: string;
              };
              toast(`Message redirected to ${cpData.targetChatName}`, { icon: "↗️" });
              // Invalidate both chats: target got a new message, source had it removed
              qc.invalidateQueries({ queryKey: ["chats", "messages", cpData.targetChatId] });
              qc.invalidateQueries({ queryKey: ["chats", "messages", cpData.sourceChatId] });
              break;
            }

            case "selfie": {
              if (isActiveChat()) setTypingCharacterName(null);
              const selfieData = event.data as {
                characterId: string;
                characterName: string;
                messageId: string;
                imageUrl: string;
              };
              toast(`${selfieData.characterName} sent a selfie 📸`);
              // During streaming the real message is deferred — refreshing now
              // would insert it into the cache alongside the StreamingIndicator,
              // causing a duplicate flash. The finally block's authoritative
              // refresh will pick up the selfie attachment from DB.
              if (!streamingEnabled) {
                await refreshMessagesAuthoritatively(qc, params.chatId, persistedMessages.values());
              }
              break;
            }

            case "selfie_error": {
              if (isActiveChat()) setTypingCharacterName(null);
              const errData = event.data as { characterId: string; error: string };
              console.warn("[selfie] Generation failed:", errData.error);
              toast.error(`Selfie generation failed: ${errData.error}`);
              break;
            }

            case "illustration": {
              const illData = event.data as {
                messageId: string;
                imageUrl: string;
                reason?: string;
              };
              toast(illData.reason ? `🎨 ${illData.reason}` : "🎨 Scene illustration generated");
              // During streaming the real message is deferred — refreshing now
              // would insert it into the cache alongside the StreamingIndicator,
              // causing a duplicate flash. The finally block's authoritative
              // refresh will pick up the illustration attachment from DB.
              if (!streamingEnabled) {
                await refreshMessagesAuthoritatively(qc, params.chatId, persistedMessages.values());
              }
              break;
            }

            case "agent_error": {
              const errData = event.data as { agentType: string; error: string };
              toast.error(errData.error);
              break;
            }

            case "scene_created": {
              const sceneData = event.data as {
                sceneChatId: string;
                sceneChatName: string;
                description: string;
                background?: string | null;
                initiatorCharId: string;
                initiatorCharName: string;
              };
              toast(`${sceneData.initiatorCharName} started a scene: ${sceneData.sceneChatName}`, { icon: "🎬" });
              // Invalidate chat list so the new scene chat appears
              qc.invalidateQueries({ queryKey: ["chats"] });
              // Apply background if the scene chose one
              if (sceneData.background) {
                useUIStore
                  .getState()
                  .setChatBackground(`/api/backgrounds/file/${encodeURIComponent(sceneData.background)}`);
              }
              break;
            }

            case "haptic_command": {
              const hapData = event.data as {
                action?: string;
                intensity?: number;
                duration?: number;
                commands?: unknown[];
                reasoning?: string;
              };
              if (hapData.commands) {
                console.log(
                  `[haptic] Agent sent ${(hapData.commands as unknown[]).length} command(s): ${hapData.reasoning ?? ""}`,
                );
              } else {
                console.log(
                  `[haptic] ${hapData.action} intensity=${hapData.intensity ?? "?"} duration=${hapData.duration ?? "indefinite"}`,
                );
              }
              break;
            }

            case "assistant_commands_start": {
              const commandData = event.data as { professorMariCommandCount?: number } | undefined;
              if ((commandData?.professorMariCommandCount ?? 0) <= 0) break;
              setMariPhase(params.chatId, "updating");
              window.dispatchEvent(
                new CustomEvent("marinara:mari-phase", {
                  detail: { chatId: params.chatId, phase: "updating" },
                }),
              );
              break;
            }

            case "assistant_commands_end": {
              clearMariPhaseForThisChat();
              break;
            }

            case "assistant_action": {
              const actionData = event.data as { action: string; [key: string]: unknown };
              if (actionData.action === "persona_created") {
                toast(`Created persona: ${actionData.name}`, { icon: "🎭" });
                qc.invalidateQueries({ queryKey: ["personas"] });
              } else if (actionData.action === "persona_updated") {
                toast(`Updated persona: ${actionData.name}`, { icon: "🎭" });
                qc.invalidateQueries({ queryKey: ["personas"] });
              } else if (actionData.action === "character_created") {
                toast(`Created character: ${actionData.name}`, { icon: "✨" });
                qc.invalidateQueries({ queryKey: characterKeys.list() });
              } else if (actionData.action === "character_updated") {
                toast(`Updated character: ${actionData.name}`, { icon: "✏️" });
                qc.invalidateQueries({ queryKey: characterKeys.list() });
              } else if (actionData.action === "chat_created") {
                toast(`Started ${actionData.mode} chat with ${actionData.characterName}`, { icon: "💬" });
                qc.invalidateQueries({ queryKey: ["chats"] });
              } else if (actionData.action === "navigate") {
                const panel = actionData.panel as string;
                const tab = actionData.tab as string | null;
                useUIStore.getState().openRightPanel(panel as any);
                if (panel === "settings" && tab) {
                  useUIStore.getState().setSettingsTab(tab as any);
                }
              }
              break;
            }

            case "done": {
              if (isActiveChat()) setProcessing(false);
              clearMariPhaseForThisChat();
              break;
            }

            case "typing": {
              // Generation is about to start — show "X is typing..."
              const typingNames = (event as any).characters as string[] | undefined;
              const typingLabel = typingNames?.length === 1 ? typingNames[0] : (typingNames?.join(", ") ?? "Character");
              useChatStore.getState().setPerChatTyping(params.chatId, typingLabel);
              if (isActiveChat()) setTypingCharacterName(typingLabel);
              break;
            }

            case "delayed": {
              // Character is busy (DND/idle) — show waiting indicator
              const delayedNames = (event as any).characters as string[] | undefined;
              const delayedLabel =
                delayedNames?.length === 1 ? delayedNames[0] : (delayedNames?.join(", ") ?? "Character");
              const delayedStatus = ((event as any).status as string) ?? "idle";
              useChatStore.getState().setPerChatDelayed(params.chatId, { name: delayedLabel, status: delayedStatus });
              if (isActiveChat()) setDelayedCharacterInfo({ name: delayedLabel, status: delayedStatus });
              // Refresh character data so sidebar status dots update immediately
              qc.invalidateQueries({ queryKey: characterKeys.list() });
              break;
            }

            case "offline": {
              // Character is offline — message was saved but no generation
              const names = (event as any).characters as string[] | undefined;
              const label = names?.length === 1 ? names[0] : "Characters";
              toast(`${label} is offline. They'll respond when they're back online.`, { icon: "💤" });
              if (isActiveChat()) setProcessing(false);
              break;
            }

            case "ooc_posted": {
              // OOC messages were posted to the connected conversation — invalidate its messages
              const oocData = event.data as { chatId: string; count: number };
              if (oocData.chatId) {
                qc.invalidateQueries({ queryKey: chatKeys.messages(oocData.chatId) });
              }
              break;
            }

            case "error": {
              // Flush pending text so the user sees what arrived before the error
              flushTypewriterBuffer();
              if (isActiveChat()) setProcessing(false);
              clearMariPhaseForThisChat();
              showError((event.data as string) || "Generation failed");
              window.dispatchEvent(new CustomEvent("marinara:generation-error", { detail: { chatId: params.chatId } }));
              break;
            }

            case "agents_retry_failed": {
              const failedList = event.data as Array<{ agentType: string; error: string | null }>;
              const types = failedList.map((f) => f.agentType);
              setFailedAgentTypes(types);
              showError(
                `${types.length} agent${types.length > 1 ? "s" : ""} failed after retry. Use the retry button in the chat header to try again.`,
              );
              break;
            }
          }
        }

        // Wait for typewriter to finish draining pending text (streaming mode only)
        if (streamingEnabled && isActiveChat() && (pendingText.length > 0 || typingActive)) {
          await new Promise<void>((resolve) => {
            if (pendingText.length === 0 && !typingActive) {
              resolve();
              return;
            }
            typewriterDone = resolve;
            startTypewriter();
          });
        }
        // Final flush — ensure full content is set (only for the viewed chat)
        if (streamingEnabled) setStreamBuffer(fullBuffer + pendingText, params.chatId);
      } catch (error) {
        // Flush everything instantly on error so user sees what arrived
        flushTypewriterBuffer();
        // Abort is intentional — don't log or toast
        if (error instanceof DOMException && error.name === "AbortError") return receivedContent;
        const msg = error instanceof Error ? error.message : "Generation failed";
        showError(msg);
        window.dispatchEvent(new CustomEvent("marinara:generation-error", { detail: { chatId: params.chatId } }));
      } finally {
        // Stream has terminated (done, error, abort, or unexpected throw) —
        // guarantee the Mari indicator clears even if the end SSE never arrived.
        clearMariPhaseForThisChat();
        // Cancel any pending animation frame to prevent leaks
        cancelAnimationFrame(rafId);

        // Refresh game state from DB so the HUD shows the correct tracker data
        // for the active swipe. SSE game_state_patch events update the store
        // during generation, but React scheduling / streaming can cause them
        // to not fully propagate — this authoritative DB fetch ensures the
        // final state is always correct (especially after swipe regeneration).
        try {
          const gs = await api.get<import("@marinara-engine/shared").GameState | null>(
            `/chats/${params.chatId}/game-state`,
          );
          if (gs) useGameStateStore.getState().setGameState(gs);
        } catch {
          /* best-effort — SSE patches already populated the store */
        }
        // Re-sort sidebar so this chat floats to the top
        qc.invalidateQueries({ queryKey: chatKeys.list() });
        // If the user navigated away from this chat during generation,
        // increment unread badge + play notification sound so they know.
        // Only notify if actual content was produced (skip offline/error cases).
        const currentActive = useChatStore.getState().activeChatId;
        if (receivedContent && currentActive !== params.chatId) {
          useChatStore.getState().incrementUnread(params.chatId);
          // Show floating avatar notification bubble — look up character from cache
          const chatList = qc.getQueryData<Chat[]>(chatKeys.list());
          const chat = chatList?.find((c) => c.id === params.chatId);
          const rawIds = chat?.characterIds;
          const parsedIds: string[] =
            typeof rawIds === "string"
              ? (() => {
                  try {
                    return JSON.parse(rawIds);
                  } catch {
                    return [];
                  }
                })()
              : Array.isArray(rawIds)
                ? rawIds
                : [];
          const firstCharId = parsedIds[0];
          if (firstCharId) {
            const charDetail = qc.getQueryData<{ data?: { name?: string } | string; avatarPath?: string | null }>(
              characterKeys.detail(firstCharId),
            );
            // Detail cache may be empty — fall back to the always-populated list cache
            let charAvatar = charDetail?.avatarPath ?? null;
            let charName = "Character";
            if (charDetail) {
              const parsed = typeof charDetail.data === "string" ? JSON.parse(charDetail.data) : charDetail.data;
              charName = parsed?.name ?? "Character";
            }
            if (!charAvatar || charName === "Character") {
              const charList = qc.getQueryData<
                Array<{ id: string; data?: string | { name?: string }; avatarPath?: string | null }>
              >(characterKeys.list());
              const fromList = charList?.find((c) => c.id === firstCharId);
              if (fromList) {
                if (!charAvatar) charAvatar = fromList.avatarPath ?? null;
                if (charName === "Character") {
                  const p = typeof fromList.data === "string" ? JSON.parse(fromList.data) : fromList.data;
                  charName = p?.name ?? "Character";
                }
              }
            }
            useChatStore.getState().addNotification(params.chatId, charName, charAvatar);
          }
          const isRp = chat?.mode === "roleplay" || chat?.mode === "visual_novel";
          const soundEnabled = isRp
            ? useUIStore.getState().rpNotificationSound
            : useUIStore.getState().convoNotificationSound;
          if (soundEnabled) {
            playNotificationPing();
          }
        }
        // Only clean up global streaming state if this generation still
        // "owns" it. We check AbortController identity rather than chatId
        // because two generations can target the same chat (e.g. autonomous
        // + user send). The latest generation replaces the AbortController,
        // so the superseded one knows it no longer owns the state.
        const stillOwner = useChatStore.getState().abortControllers.get(params.chatId) === abortController;
        if (stillOwner) {
          // Only clear global streaming/UI state if this chat is still the one
          // being displayed, to avoid corrupting another chat's active generation.
          if (useChatStore.getState().streamingChatId === params.chatId) {
            // Authoritative refresh BEFORE clearing streaming state. This
            // fetches the latest messages from DB (including illustrations and
            // other post-processing attachments). React 19 batches the React
            // Query cache update and the Zustand streaming state update into
            // one commit since they happen in the same microtask after the
            // await resolves — preventing both duplicate-flash and empty-flash.
            await refreshMessagesAuthoritatively(qc, params.chatId, persistedMessages.values());
            setStreaming(false);
            clearStreamBuffer(params.chatId);
          } else {
            await refreshMessagesAuthoritatively(qc, params.chatId, persistedMessages.values());
            clearStreamBuffer(params.chatId);
          }
          if (isActiveChat()) {
            setProcessing(false);
            setRegenerateMessageId(null);
            setStreamingCharacterId(null);
            setTypingCharacterName(null);
            setDelayedCharacterInfo(null);
          }
          // Always clean up per-chat tracking for this generation
          useChatStore.getState().clearPerChatState(params.chatId);
          useChatStore.getState().setAbortController(params.chatId, null);
        } else {
          // Not the owner but still need messages up to date
          await refreshMessagesAuthoritatively(qc, params.chatId, persistedMessages.values());
        }

        // Always notify game surface that generation completed for this chat.
        // Dispatched unconditionally — GameSurface uses lastProcessedMsgRef
        // to prevent duplicate processing.
        console.warn("[use-generate] dispatching generation-complete for chat:", params.chatId);
        window.dispatchEvent(new CustomEvent("marinara:generation-complete", { detail: { chatId: params.chatId } }));

        // Auto-translate newly generated assistant messages if enabled
        if (receivedContent) {
          try {
            const chatData = qc.getQueryData<Chat>(chatKeys.detail(params.chatId));
            const meta =
              chatData?.metadata != null
                ? typeof chatData.metadata === "string"
                  ? JSON.parse(chatData.metadata)
                  : chatData.metadata
                : {};
            if (meta.autoTranslate) {
              const store = useTranslationStore.getState();
              for (const [id, msg] of persistedMessages) {
                const textToTranslate =
                  chatData?.mode === "game" ? stripGmTagsKeepReadables(msg.content ?? "").trim() : (msg.content ?? "");
                if (msg.role === "assistant" && textToTranslate && !store.translations[id]) {
                  store.setTranslating(id, true);
                  api
                    .post<{ translatedText: string }>("/translate", {
                      text: textToTranslate,
                      provider: store.config.provider,
                      targetLanguage: store.config.targetLanguage,
                      connectionId: store.config.connectionId,
                      deeplApiKey: store.config.deeplApiKey,
                      deeplxUrl: store.config.deeplxUrl,
                    })
                    .then((result) => {
                      store.setTranslation(id, result.translatedText);
                      store.setTranslating(id, false);
                      // Persist to message extra
                      api
                        .patch(`/chats/${params.chatId}/messages/${id}/extra`, {
                          translation: result.translatedText,
                        })
                        .catch(() => {});
                    })
                    .catch(() => {
                      store.setTranslating(id, false);
                    });
                }
              }
            }
          } catch {
            /* non-critical — don't block generation cleanup */
          }
        }
      }
      return receivedContent;
    },
    [
      qc,
      setStreaming,
      setMariPhase,
      setStreamBuffer,
      clearStreamBuffer,
      setRegenerateMessageId,
      setStreamingCharacterId,
      setTypingCharacterName,
      setDelayedCharacterInfo,
      setProcessing,
      addResult,
      addThoughtBubble,
      clearThoughtBubbles,
      addEchoMessage,
      setCyoaChoices,
      clearCyoaChoices,
      enqueuePendingCardUpdate,
      clearFailedAgentTypes,
      setFailedAgentTypes,
      setGameState,
    ],
  );

  const retryAgents = useCallback(
    async (chatId: string, agentTypes: string[], options?: { lorebookKeeperBackfill?: boolean }) => {
      const isActiveChat = () => useChatStore.getState().activeChatId === chatId;
      const abortController = new AbortController();
      useChatStore.getState().setAbortController(chatId, abortController);
      setProcessing(true);
      clearFailedAgentTypes();
      clearThoughtBubbles();

      try {
        let hasError = false;
        for await (const event of api.streamEvents(
          "/generate/retry-agents",
          {
            chatId,
            agentTypes,
            streaming: useUIStore.getState().enableStreaming,
            lorebookKeeperBackfill: options?.lorebookKeeperBackfill === true,
          },
          abortController.signal,
        )) {
          switch (event.type) {
            case "agent_result": {
              const result = event.data as {
                agentType: string;
                agentName: string;
                resultType: string;
                data: unknown;
                success: boolean;
                error: string | null;
                durationMs: number;
              };

              // Log agent results (same as main generate handler)
              if (result.success) {
                console.warn(
                  `[Retry Agent] ✓ ${result.agentName} (${result.agentType}) — ${(result.durationMs / 1000).toFixed(1)}s`,
                  result.data,
                );
              } else {
                console.warn(
                  `[Retry Agent] ✗ ${result.agentName} (${result.agentType}) — ${result.error ?? "unknown error"}`,
                  result.data,
                );
              }

              addResult(result.agentType, {
                agentId: result.agentType,
                agentType: result.agentType,
                type: result.resultType as any,
                data: result.data,
                tokensUsed: 0,
                durationMs: result.durationMs,
                success: result.success,
                error: result.error,
              });
              if (result.success && result.resultType === "character_card_update") {
                buildPendingCardUpdates(qc, chatId, result.agentName, result.data)
                  .then((pendingEntries) => {
                    if (pendingEntries.length > 0) {
                      for (const pending of pendingEntries) {
                        enqueuePendingCardUpdate(pending);
                      }
                      useUIStore.getState().openModal("character-card-update");
                    }
                  })
                  .catch((err) => console.warn("[Agent] Failed to build card update entry:", err));
              }
              if (result.success && result.data) {
                const bubble = formatAgentBubble(result.agentType, result.agentName, result.data);
                if (bubble) addThoughtBubble(result.agentType, result.agentName, bubble);
                if (result.agentType === "echo-chamber") {
                  const d = result.data as Record<string, unknown>;
                  const reactions = (d.reactions as Array<{ characterName: string; reaction: string }>) ?? [];
                  for (const r of reactions) addEchoMessage(r.characterName, r.reaction);
                }
                if (result.resultType === "background_change") {
                  const bg = result.data as { chosen?: string | null };
                  if (bg.chosen) {
                    fetch(`/api/backgrounds/file/${encodeURIComponent(bg.chosen)}`, { method: "HEAD" })
                      .then((res) => {
                        if (res.ok) {
                          useUIStore
                            .getState()
                            .setChatBackground(`/api/backgrounds/file/${encodeURIComponent(bg.chosen!)}`);
                        } else {
                          console.warn(`[Agent] Background "${bg.chosen}" does not exist — skipping`);
                        }
                      })
                      .catch(() => {});
                  }
                }
                // Apply quest updates directly so the widget updates immediately
                if (result.agentType === "quest") {
                  const qd = result.data as Record<string, unknown>;
                  const updates = (qd.updates as any[]) ?? [];
                  if (updates.length > 0) {
                    const cur = useGameStateStore.getState().current;
                    const existing = cur?.playerStats ?? {
                      stats: [],
                      attributes: null,
                      skills: {},
                      inventory: [],
                      activeQuests: [],
                      status: "",
                    };
                    const quests: any[] = [...(existing.activeQuests ?? [])];
                    for (const u of updates) {
                      const idx = quests.findIndex((q: any) => q.name === u.questName);
                      if (u.action === "create" && idx === -1) {
                        quests.push({
                          questEntryId: u.questName,
                          name: u.questName,
                          currentStage: 0,
                          objectives: u.objectives ?? [],
                          completed: false,
                        });
                      } else if (idx !== -1) {
                        if (u.action === "update" && u.objectives) quests[idx].objectives = u.objectives;
                        else if (u.action === "complete") {
                          quests[idx].completed = true;
                          if (u.objectives) quests[idx].objectives = u.objectives;
                        } else if (u.action === "fail") quests.splice(idx, 1);
                      }
                    }
                    const merged = cur
                      ? { ...cur, playerStats: { ...existing, activeQuests: quests } }
                      : { playerStats: { ...existing, activeQuests: quests } };
                    setGameState(merged as any);
                  }
                }
              }
              if (!result.success && result.error) {
                showError(`${result.agentName ?? result.agentType} failed: ${result.error}`);
              }
              break;
            }
            case "agents_retry_failed": {
              const failedList = event.data as Array<{ agentType: string; error: string | null }>;
              const types = failedList.map((f) => f.agentType);
              setFailedAgentTypes(types);
              showError(
                `${types.length} agent${types.length > 1 ? "s" : ""} failed after retry. Use the retry button in the chat header to try again.`,
              );
              break;
            }
            case "game_state":
            case "game_state_patch": {
              const patch = event.data as Record<string, unknown>;
              console.warn(`[Retry] ${event.type} received:`, patch);
              if (!isActiveChat()) break;
              const current = useGameStateStore.getState().current;
              if (current) {
                const merged = { ...current, ...patch };
                if (patch.playerStats && typeof patch.playerStats === "object" && current.playerStats) {
                  const mergedPS = { ...current.playerStats, ...(patch.playerStats as object) };
                  // Don't let an empty activeQuests overwrite existing quests
                  const patchPS = patch.playerStats as Record<string, unknown>;
                  if (
                    Array.isArray(patchPS.activeQuests) &&
                    patchPS.activeQuests.length === 0 &&
                    current.playerStats.activeQuests?.length > 0
                  ) {
                    mergedPS.activeQuests = current.playerStats.activeQuests;
                  }
                  (merged as any).playerStats = mergedPS;
                }
                setGameState(merged as any);
              } else {
                setGameState(patch as any);
              }
              break;
            }
            case "game_map_update": {
              const map = event.data as GameMap | null;
              if (map) applyGameMapUpdate(qc, chatId, map);
              break;
            }
            case "illustration": {
              const illData = event.data as { messageId: string; imageUrl: string; reason?: string };
              toast(illData.reason ? `🎨 ${illData.reason}` : "🎨 Scene illustration generated");
              // Refresh messages so the illustration attachment appears
              if (isActiveChat()) {
                qc.invalidateQueries({ queryKey: ["messages", chatId] });
                qc.invalidateQueries({ queryKey: ["gallery", chatId] });
              }
              break;
            }
            case "error": {
              hasError = true;
              showError((event.data as string) || "Agent retry failed");
              break;
            }
            case "done": {
              break;
            }
          }
        }
        if (!hasError) {
          toast.success(
            options?.lorebookKeeperBackfill ? "Lorebook Keeper backfill completed" : "Agent retry completed",
          );
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const msg =
          error instanceof Error
            ? (error as { cause?: unknown }).cause instanceof Error
              ? `${error.message}: ${(error as { cause?: Error }).cause!.message}`
              : error.message
            : "Agent retry failed";
        showError(msg);
      } finally {
        setProcessing(false);
        useChatStore.getState().setAbortController(chatId, null);
        // Refresh game state from DB for the same reason as normal generation
        api
          .get<import("@marinara-engine/shared").GameState | null>(`/chats/${chatId}/game-state`)
          .then((gs) => {
            if (gs) useGameStateStore.getState().setGameState(gs);
          })
          .catch(() => {});
      }
    },
    [
      addResult,
      addThoughtBubble,
      addEchoMessage,
      enqueuePendingCardUpdate,
      clearFailedAgentTypes,
      clearThoughtBubbles,
      setFailedAgentTypes,
      setProcessing,
      setGameState,
      qc,
    ],
  );

  return { generate, retryAgents };
}

/**
 * Format agent result data into a human-readable thought bubble string.
 * Returns null if the result shouldn't generate a bubble.
 */
function formatAgentBubble(agentType: string, agentName: string, data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  switch (agentType) {
    case "continuity": {
      const issues = (d.issues as any[]) ?? [];
      if (!issues.length) return null;
      return issues.map((i: any) => `${i.severity === "error" ? "🔴" : "🟡"} ${i.description}`).join("\n");
    }

    case "prompt-reviewer": {
      const issues = (d.issues as any[]) ?? [];
      if (!issues.length) return `✅ ${d.summary ?? "Prompt looks good"}`;
      return issues
        .map((i: any) => `${i.severity === "error" ? "🔴" : i.severity === "warning" ? "🟡" : "💡"} ${i.description}`)
        .join("\n");
    }

    case "director": {
      const text = d.text as string;
      if (!text || text.includes("No intervention needed")) return null;
      return text;
    }

    case "quest": {
      const updates = (d.updates as any[]) ?? [];
      if (!updates.length) return null;
      return updates.map((u: any) => `${u.action === "complete" ? "✅" : "📜"} ${u.questName}`).join("\n");
    }

    case "expression": {
      const expressions = (d.expressions as any[]) ?? [];
      if (!expressions.length) return null;
      return expressions
        .map((e: any) => {
          const t = e.transition && e.transition !== "crossfade" ? ` (${e.transition})` : "";
          return `🎭 ${e.characterName}: ${e.expression}${t}`;
        })
        .join("\n");
    }

    case "world-state": {
      // Compact summary of what changed
      const parts: string[] = [];
      if (d.location) parts.push(`📍 ${d.location}`);
      if (d.time) parts.push(`🕐 ${d.time}`);
      if (d.weather) parts.push(`🌤 ${d.weather}`);
      if (parts.length === 0) return null;
      return parts.join(" · ");
    }

    case "character-tracker": {
      const chars = (d.presentCharacters as any[]) ?? [];
      if (!chars.length) return null;
      return chars
        .map((c: any) => {
          const emoji = c.emoji ? `${c.emoji} ` : "👤 ";
          return `${emoji}${c.name}`;
        })
        .join(", ");
    }

    case "background": {
      const chosen = d.chosen as string | null;
      if (!chosen) return null;
      return `🖼️ ${chosen}`;
    }

    case "echo-chamber": {
      const reactions = (d.reactions as any[]) ?? [];
      if (!reactions.length) return null;
      return reactions.map((r: any) => `💬 ${r.characterName}: ${r.reaction}`).join("\n");
    }

    case "spotify": {
      const action = d.action as string;
      if (action === "none") return null;
      const mood = (d.mood as string) ?? "";
      if (action === "play") {
        // Support both array and singular formats
        const trackNames: string[] = Array.isArray(d.trackNames)
          ? (d.trackNames as string[])
          : d.trackName
            ? [d.trackName as string]
            : [];
        if (trackNames.length === 0) return mood ? `🎵 ${mood}` : null;
        if (trackNames.length === 1) {
          return `🎵 ${trackNames[0]}${mood ? ` — ${mood}` : ""}`;
        }
        const list = trackNames.map((t, i) => `${i + 1}. ${t}`).join("\n");
        return `🎵 Queued ${trackNames.length} tracks${mood ? ` — ${mood}` : ""}\n${list}`;
      }
      if (action === "volume") {
        return `🔊 Volume → ${d.volume}%${mood ? ` (${mood})` : ""}`;
      }
      return mood ? `🎵 ${mood}` : null;
    }

    case "prose-guardian": {
      const text = d.text as string;
      if (!text) return null;
      // Show a compact summary — first ~120 chars
      const trimmed = text.trim();
      const preview = trimmed.length > 120 ? trimmed.slice(0, 120) + "…" : trimmed;
      return `✍️ ${preview}`;
    }

    case "persona-stats": {
      const stats = (d.stats as any[]) ?? [];
      const status = d.status as string;
      if (!stats.length && !status) return null;
      const parts: string[] = [];
      if (status) parts.push(status);
      for (const s of stats) {
        parts.push(`${s.name}: ${s.value}/${s.max ?? 100}`);
      }
      return `📊 ${parts.join(" · ")}`;
    }

    case "illustrator": {
      const shouldGenerate = d.shouldGenerate as boolean;
      if (!shouldGenerate) return null;
      const style = d.style as string;
      const reason = d.reason as string;
      return `🎨 ${reason || "Generating scene illustration"}${style ? ` (${style})` : ""}`;
    }

    case "lorebook-keeper": {
      const updates = (d.updates as any[]) ?? [];
      if (!updates.length) return null;
      return updates.map((u: any) => `📖 ${u.action === "create" ? "New" : "Updated"}: ${u.entryName}`).join("\n");
    }

    case "editor": {
      const changes = (d.changes as any[]) ?? [];
      if (!changes.length) return `✅ No edits needed`;
      return changes.map((c: any) => `✏️ ${c.description}`).join("\n");
    }

    case "html": {
      const text = d.text as string;
      return `🎨 ${text || "HTML formatting active"}`;
    }

    case "chat-summary": {
      const text = d.text as string;
      return `📝 ${text || "Chat summary active"}`;
    }

    case "secret-plot-driver": {
      return `🎭 The roleplay is following a secret plotline…`;
    }

    default:
      return null;
  }
}
