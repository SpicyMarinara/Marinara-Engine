// ──────────────────────────────────────────────
// Hook: Background Autonomous Polling
// ──────────────────────────────────────────────
// Polls for autonomous messages on inactive conversation chats.
// Lives at the AppShell level so it persists across chat switches.
// The active chat's autonomous messaging is handled by ConversationView.

import { useEffect, useRef } from "react";
import type { Chat } from "@marinara-engine/shared";
import type { AvatarCropValue } from "../lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api-client";
import { useChatStore } from "../stores/chat.store";
import { useUIStore } from "../stores/ui.store";
import { playNotificationPing } from "../lib/notification-sound";
import { chatKeys } from "./use-chats";
import { characterKeys } from "./use-characters";

interface AutonomousCheckResult {
  shouldTrigger: boolean;
  characterIds: string[];
  reason: string;
  inactivityMs: number;
}

interface BusyDelayResult {
  delayMs: number;
  status: string;
  activity: string;
}

interface RawChat {
  id: string;
  name: string;
  mode?: string;
  metadata?: string | Record<string, unknown>;
}

interface RawCharacter {
  id: string;
  data?: string | { name?: string };
  avatarPath?: string | null;
}

/**
 * Parse chat metadata safely from either a JSON string or an object.
 */
function parseMeta(chat: RawChat): Record<string, unknown> {
  const raw = chat.metadata;
  if (!raw) return {};
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

/**
 * Background polling for autonomous messages on inactive conversation chats.
 * Fetches the chat list on each tick so the effect doesn't depend on
 * external React state (which would reset the timer on every re-render).
 */
export function useBackgroundAutonomousPolling() {
  const qc = useQueryClient();
  const pollTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const busyDelayTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const generatingForRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const delayTimers = busyDelayTimers.current;

    const poll = async () => {
      if (!mountedRef.current) return;

      // Skip API calls while tab is hidden to prevent a burst of requests on return.
      // Server-side inactivity tracking is unaffected; the next visible poll picks up correctly.
      if (document.hidden) {
        schedulePoll();
        return;
      }

      const activeChatId = useChatStore.getState().activeChatId;

      // Fetch the current chat list directly from the API each tick.
      // This avoids the effect depending on useChats() data which would
      // cause frequent timer restarts.
      let allChats: RawChat[];
      try {
        allChats = await api.get<RawChat[]>("/chats");
      } catch {
        schedulePoll();
        return;
      }

      // Find conversation chats with autonomous messaging enabled, excluding active chat
      const backgroundChats = allChats.filter((chat) => {
        if (chat.id === activeChatId) return false;
        if (generatingForRef.current.has(chat.id)) return false;
        if (chat.mode !== "conversation") return false;
        try {
          const meta = parseMeta(chat);
          return !!meta.autonomousMessages;
        } catch {
          return false;
        }
      });

      // Don't trigger autonomous messages when user is DND
      if (useUIStore.getState().userStatus === "dnd" || backgroundChats.length === 0) {
        schedulePoll();
        return;
      }

      // Check each background chat (sequentially to avoid hammering the server)
      for (const chat of backgroundChats) {
        // Don't proceed if this chat already has an in-flight generation
        if (useChatStore.getState().abortControllers.has(chat.id)) continue;

        try {
          const result = await api.post<AutonomousCheckResult>("/conversation/autonomous/check", { chatId: chat.id });

          if (result.shouldTrigger && result.characterIds.length > 0) {
            const characterId = result.characterIds[0]!;

            // Check busy delay
            const delay = await api.post<BusyDelayResult>("/conversation/busy-delay", { chatId: chat.id, characterId });

            // Generate in background (after optional delay)
            generatingForRef.current.add(chat.id);
            const doGenerate = async () => {
              let receivedTokens = false;
              let shouldClearAutonomousFlag = true;
              try {
                // Re-check guard — a generation may have started for this chat
                // during the busy delay.
                if (useChatStore.getState().abortControllers.has(chat.id)) {
                  shouldClearAutonomousFlag = false;
                  generatingForRef.current.delete(chat.id);
                  return;
                }

                // Use streamEvents to drain the SSE — tokens aren't needed for background chats
                for await (const _event of api.streamEvents("/generate", {
                  chatId: chat.id,
                  connectionId: null,
                  streaming: useUIStore.getState().enableStreaming,
                })) {
                  if ((_event as { type: string }).type === "token") receivedTokens = true;
                }

                // Only notify if the generation actually produced a message
                if (!receivedTokens) return;

                // Reset + refetch messages so the cache has fresh data when the
                // user navigates to this chat. Without this, TanStack Query
                // would show stale cached data (missing the new message) until
                // the background refetch completes — making it look like the
                // message isn't there even though it was saved.
                qc.resetQueries({ queryKey: chatKeys.messages(chat.id) });
                qc.invalidateQueries({ queryKey: characterKeys.list() });
                void api
                  .post<Chat>(`/chats/${chat.id}/autonomous-unread`, { characterId })
                  .then((updatedChat) => {
                    qc.setQueryData(chatKeys.detail(chat.id), updatedChat);
                    qc.invalidateQueries({ queryKey: chatKeys.list() });
                  })
                  .catch(() => {
                    /* persistence is best-effort; keep the local notification */
                  });

                // Resolve character name for the notification
                let charName = "Someone";
                let charAvatar: string | null = null;
                let charAvatarCrop: AvatarCropValue | null = null;
                try {
                  // Find the triggering character's name
                  const charRow = await api.get<RawCharacter>(`/characters/${characterId}`);
                  if (charRow) {
                    const data = typeof charRow.data === "string" ? JSON.parse(charRow.data) : charRow.data;
                    if (data?.name) charName = data.name;
                    charAvatarCrop = data?.extensions?.avatarCrop ?? null;
                    charAvatar = charRow.avatarPath ?? null;
                  }
                } catch {
                  /* use fallback name */
                }

                // Play notification sound
                if (useUIStore.getState().convoNotificationSound) {
                  playNotificationPing();
                }

                // Increment unread badge
                useChatStore.getState().incrementUnread(chat.id);

                // Add floating avatar notification bubble
                useChatStore.getState().addNotification(chat.id, charName, charAvatar, charAvatarCrop);

                // Show a global toast so the user knows even from a different chat
                toast(`${charName} sent you a message`, { icon: "💬" });
              } catch {
                // generation failed — non-critical
              } finally {
                if (!receivedTokens && shouldClearAutonomousFlag) {
                  try {
                    await api.post("/conversation/activity/assistant", { chatId: chat.id });
                  } catch {
                    /* non-critical */
                  }
                }
                generatingForRef.current.delete(chat.id);
              }
            };

            if (delay.delayMs > 0) {
              const timerId = setTimeout(() => {
                busyDelayTimers.current.delete(timerId);
                doGenerate();
              }, delay.delayMs);
              busyDelayTimers.current.add(timerId);
            } else {
              doGenerate();
            }
          }
        } catch {
          // Check failed — skip this chat, try next
        }
      }

      schedulePoll();
    };

    const schedulePoll = () => {
      if (!mountedRef.current) return;
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(poll, 30_000);
    };

    // Start polling after an initial delay (staggered from active autonomous polling at 10s)
    pollTimerRef.current = setTimeout(poll, 20_000);

    return () => {
      mountedRef.current = false;
      clearTimeout(pollTimerRef.current);
      for (const t of delayTimers) clearTimeout(t);
      delayTimers.clear();
    };
  }, [qc]); // Only depends on qc (which is stable) — timer lifecycle is self-managed
}
