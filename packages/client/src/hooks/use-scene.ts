// ──────────────────────────────────────────────
// Hook: Scene API calls
// ──────────────────────────────────────────────
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api-client";
import { useChatStore } from "../stores/chat.store";
import { chatKeys } from "./use-chats";
import type {
  SceneCreateRequest,
  SceneCreateResponse,
  SceneConcludeRequest,
  SceneConcludeResponse,
  SceneForkMode,
  SceneForkRequest,
  SceneForkResponse,
  ScenePlanRequest,
  ScenePlanResponse,
  SceneFullPlan,
} from "@marinara-engine/shared";

/** Provides scene lifecycle mutations and the scene-to-roleplay fork action. */
export function useScene() {
  const qc = useQueryClient();
  const setActiveChatId = useChatStore((s) => s.setActiveChatId);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const isForkingRef = useRef(false);
  const [isForking, setIsForking] = useState(false);

  /** Plan a scene from a user prompt (used by /scene slash command). */
  const planScene = useCallback(
    async (prompt: string, connectionId?: string | null): Promise<ScenePlanResponse | null> => {
      if (!activeChatId) return null;
      try {
        return await api.post<ScenePlanResponse>("/scene/plan", {
          chatId: activeChatId,
          prompt,
          connectionId: connectionId ?? null,
        } satisfies ScenePlanRequest);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to plan scene";
        toast.error(msg);
        return null;
      }
    },
    [activeChatId],
  );

  /** Create a scene branching from the current conversation using a full plan. */
  const createScene = useCallback(
    async (opts: {
      plan: SceneFullPlan;
      initiatorCharId?: string | null;
      connectionId?: string | null;
    }): Promise<SceneCreateResponse | null> => {
      if (!activeChatId) return null;
      try {
        const res = await api.post<SceneCreateResponse>("/scene/create", {
          originChatId: activeChatId,
          initiatorCharId: opts.initiatorCharId ?? null,
          plan: opts.plan,
          connectionId: opts.connectionId ?? null,
        } satisfies SceneCreateRequest);

        // Invalidate chats so the new scene appears in the sidebar
        qc.invalidateQueries({ queryKey: chatKeys.all });

        // Navigate to the scene chat
        setActiveChatId(res.chatId);

        toast.success(`Scene started: ${res.chatName}`, { icon: "🎬" });
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create scene";
        toast.error(msg);
        return null;
      }
    },
    [activeChatId, qc, setActiveChatId],
  );

  /** Conclude an active scene — generates summary, injects memory, returns to origin. */
  const concludeScene = useCallback(
    async (sceneChatId: string, connectionId?: string | null): Promise<void> => {
      try {
        toast("Generating scene summary...", { icon: "✍️" });

        const res = await api.post<SceneConcludeResponse>("/scene/conclude", {
          sceneChatId,
          connectionId: connectionId ?? null,
        } satisfies SceneConcludeRequest);

        // Invalidate both chats
        qc.invalidateQueries({ queryKey: chatKeys.all });
        qc.invalidateQueries({ queryKey: chatKeys.messages(sceneChatId) });
        qc.invalidateQueries({ queryKey: chatKeys.messages(res.originChatId) });

        // Navigate back to the origin conversation
        setActiveChatId(res.originChatId);

        toast.success("Scene concluded — summary added as a memory", { icon: "📖" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to conclude scene";
        toast.error(msg);
      }
    },
    [qc, setActiveChatId],
  );

  /** Abandon a scene — clean up and delete without generating a summary. */
  const abandonScene = useCallback(
    async (sceneChatId: string): Promise<void> => {
      try {
        const res = await api.post<{ originChatId: string }>("/scene/abandon", { sceneChatId });

        // Optimistically clear scene pointer from the cached origin chat
        // so the banner disappears immediately (invalidation refetches async).
        qc.setQueryData(chatKeys.detail(res.originChatId), (old: any) => {
          if (!old) return old;
          const meta = typeof old.metadata === "string" ? JSON.parse(old.metadata) : { ...(old.metadata ?? {}) };
          delete meta.activeSceneChatId;
          delete meta.sceneBusyCharIds;
          return { ...old, metadata: meta };
        });

        // Remove deleted scene chat from cache & invalidate list
        qc.removeQueries({ queryKey: chatKeys.detail(sceneChatId) });
        qc.invalidateQueries({ queryKey: chatKeys.all });

        setActiveChatId(res.originChatId);

        toast.success("Scene discarded", { icon: "🗑️" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to discard scene";
        toast.error(msg);
      }
    },
    [qc, setActiveChatId],
  );

  /**
   * Fork a scene into a standalone roleplay chat.
   *
   * The ref guard prevents duplicate clone/convert requests from rapid clicks
   * while `isForking` lets the UI disable the relevant controls.
   */
  const forkScene = useCallback(
    async (
      sceneChatId: string,
      mode: SceneForkMode,
      opts?: { upToMessageId?: string },
    ): Promise<SceneForkResponse | null> => {
      if (isForkingRef.current) return null;
      isForkingRef.current = true;
      setIsForking(true);
      try {
        const res = await api.post<SceneForkResponse>("/scene/fork", {
          sceneChatId,
          mode,
          upToMessageId: opts?.upToMessageId,
          includePreSceneSummary: true,
          includeParticipationGuide: true,
        } satisfies SceneForkRequest);

        qc.invalidateQueries({ queryKey: chatKeys.all });
        qc.invalidateQueries({ queryKey: chatKeys.messages(sceneChatId) });
        if (res.originChatId) qc.invalidateQueries({ queryKey: chatKeys.detail(res.originChatId) });
        qc.invalidateQueries({ queryKey: chatKeys.detail(res.chatId) });
        qc.invalidateQueries({ queryKey: chatKeys.messages(res.chatId) });
        qc.invalidateQueries({ queryKey: chatKeys.messageCount(res.chatId) });

        if (mode === "convert") {
          qc.removeQueries({ queryKey: chatKeys.detail(sceneChatId) });
        }

        setActiveChatId(res.chatId);
        toast.success(mode === "convert" ? "Scene converted to roleplay" : "Scene cloned as roleplay", {
          icon: "RP",
        });
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fork scene";
        toast.error(msg);
        return null;
      } finally {
        isForkingRef.current = false;
        setIsForking(false);
      }
    },
    [qc, setActiveChatId],
  );

  return { planScene, createScene, concludeScene, abandonScene, forkScene, isForking };
}
