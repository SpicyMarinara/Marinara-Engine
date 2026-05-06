// ──────────────────────────────────────────────
// Hook: Autonomous Messaging
// ──────────────────────────────────────────────
// Polls the server to check if any character should send an
// unprompted message based on user inactivity and character schedules.
// Also handles busy delays and triggers generation.

import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useChatStore } from "../stores/chat.store";
import { useUIStore } from "../stores/ui.store";
import { useGenerate } from "./use-generate";
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

/**
 * Polls the autonomous messaging endpoint and triggers generation
 * when a character wants to send a message unprompted.
 *
 * Returns helpers to record user & assistant activity.
 */
export function useAutonomousMessaging(
  chatId: string | null,
  enabled: boolean,
  exchangesEnabled: boolean,
  onAutonomousMessage?: (characterId: string) => void,
) {
  const { generate } = useGenerate();
  const qc = useQueryClient();
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatingRef = useRef(false);
  const onAutonomousMessageRef = useRef(onAutonomousMessage);
  onAutonomousMessageRef.current = onAutonomousMessage;

  // Record that the user sent a message
  const recordUserActivity = useCallback(async () => {
    if (!chatId) return;
    try {
      await api.post("/conversation/activity/user", {
        chatId,
        preserveGenerationInProgress: useChatStore.getState().abortControllers.has(chatId),
      });
    } catch {
      // non-critical
    }
  }, [chatId]);

  // Record that an assistant message was received
  const recordAssistantActivity = useCallback(
    async (characterId?: string) => {
      if (!chatId) return;
      try {
        await api.post("/conversation/activity/assistant", { chatId, characterId });
      } catch {
        // non-critical
      }
    },
    [chatId],
  );

  // Generate a schedule on first use (if none exists yet)
  const ensureSchedules = useCallback(
    async (characterIds?: string[]) => {
      if (!chatId) return;
      try {
        const scheduleGenerationPreferences = useUIStore.getState().scheduleGenerationPreferences;
        await api.post("/conversation/schedule/generate", {
          chatId,
          characterIds,
          scheduleGenerationPreferences,
        });
      } catch {
        // non-critical — schedule generation may fail if no connection
      }
    },
    [chatId],
  );

  // ── Polling logic ──
  useEffect(() => {
    if (!chatId || !enabled) return;

    const poll = async () => {
      // Skip API calls while tab is hidden to prevent a burst of requests on return.
      // Server-side inactivity tracking is unaffected; the next visible poll picks up correctly.
      if (document.hidden) {
        schedulePoll();
        return;
      }

      // Don't poll if already generating or streaming this chat
      if (generatingRef.current || useChatStore.getState().abortControllers.has(chatId)) {
        schedulePoll();
        return;
      }

      // Don't trigger autonomous messages when user is DND
      if (useUIStore.getState().userStatus === "dnd") {
        schedulePoll();
        return;
      }

      try {
        const result = await api.post<AutonomousCheckResult>("/conversation/autonomous/check", { chatId });

        // Refresh character data so sidebar status dots update
        qc.invalidateQueries({ queryKey: characterKeys.list() });

        if (result.shouldTrigger && result.characterIds.length > 0) {
          const characterId = result.characterIds[0]!;

          // Check for busy delay
          const delay = await api.post<BusyDelayResult>("/conversation/busy-delay", { chatId, characterId });

          if (delay.delayMs > 0) {
            // Wait for the busy delay, then generate
            busyTimerRef.current = setTimeout(() => {
              // Re-check guards after delay — user may have started a manual generation
              if (generatingRef.current || useChatStore.getState().abortControllers.has(chatId)) {
                schedulePoll();
                return;
              }
              triggerAutonomousGeneration(characterId);
            }, delay.delayMs);
            return; // Don't schedule next poll until generation completes
          }

          await triggerAutonomousGeneration(characterId);
          return; // Generation will schedule next poll when done
        }
      } catch {
        // non-critical — keep polling
      }

      schedulePoll();
    };

    const triggerAutonomousGeneration = async (characterId: string) => {
      generatingRef.current = true;
      let produced: boolean | undefined = false;
      let shouldSchedulePoll = true;
      try {
        produced = await generate({
          chatId,
          connectionId: null,
        });
        if (produced) {
          // Re-sort sidebar so this chat floats to the top
          qc.invalidateQueries({ queryKey: chatKeys.list() });
          // Fire notification callback
          onAutonomousMessageRef.current?.(characterId);
        }
      } catch {
        // generation failed — non-critical
      } finally {
        // Successful generations are recorded by the server when it saves the
        // assistant message. On failure/empty response, clear the in-progress
        // autonomous flag so polling does not get stuck until timeout.
        if (!produced) {
          await recordAssistantActivity(undefined);
        }
        generatingRef.current = false;
      }

      // In group chats: check if another character wants to reply to what was just said
      if (produced && exchangesEnabled) {
        try {
          const exchange = await api.post<AutonomousCheckResult>("/conversation/autonomous/exchange", {
            chatId,
            lastSpeakerCharId: characterId,
          });
          if (exchange.shouldTrigger && exchange.characterIds.length > 0) {
            // Short delay to feel natural, then trigger the exchange
            shouldSchedulePoll = false;
            busyTimerRef.current = setTimeout(
              () => {
                if (!useChatStore.getState().abortControllers.has(chatId)) {
                  triggerAutonomousGeneration(exchange.characterIds[0]!);
                } else {
                  schedulePoll();
                }
              },
              2000 + Math.random() * 3000,
            );
          }
        } catch {
          // non-critical
        }
      }

      if (shouldSchedulePoll) {
        schedulePoll();
      }
    };

    const schedulePoll = () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(poll, 30_000); // Poll every 30 seconds
    };

    // Start polling after a short initial delay
    pollTimerRef.current = setTimeout(poll, 10_000);

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (busyTimerRef.current) clearTimeout(busyTimerRef.current);
    };
  }, [chatId, enabled, exchangesEnabled, generate, recordAssistantActivity, qc]);

  return {
    recordUserActivity,
    recordAssistantActivity,
    ensureSchedules,
  };
}
