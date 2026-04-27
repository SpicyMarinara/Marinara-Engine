// ──────────────────────────────────────────────
// React Query: Chat hooks
// ──────────────────────────────────────────────
import { useQuery, useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useChatStore } from "../stores/chat.store";
import { useAgentStore } from "../stores/agent.store";
import { useGameStateStore } from "../stores/game-state.store";
import { useEncounterStore } from "../stores/encounter.store";
import { useUIStore } from "../stores/ui.store";
import { clearBrowserRuntimeCaches } from "../lib/browser-runtime";
import type { Chat, Message, MessageSwipe, DaySummaryEntry, WeekSummaryEntry } from "@marinara-engine/shared";

export const chatKeys = {
  all: ["chats"] as const,
  list: () => [...chatKeys.all, "list"] as const,
  detail: (id: string) => [...chatKeys.all, "detail", id] as const,
  messages: (chatId: string) => [...chatKeys.all, "messages", chatId] as const,
  messageCount: (chatId: string) => [...chatKeys.all, "messageCount", chatId] as const,
  group: (groupId: string) => [...chatKeys.all, "group", groupId] as const,
};

export type ExpungeScope =
  | "chats"
  | "characters"
  | "personas"
  | "lorebooks"
  | "presets"
  | "connections"
  | "automation"
  | "media";

async function resetClientAfterExpunge(qc: ReturnType<typeof useQueryClient>) {
  await clearBrowserRuntimeCaches();
  useChatStore.getState().reset();
  useAgentStore.getState().reset();
  useGameStateStore.getState().reset();
  useEncounterStore.getState().reset();
  const ui = useUIStore.getState();
  ui.closeModal();
  ui.closeAllDetails();
  ui.closeRightPanel();
  ui.closeBotBrowser();
  ui.setChatBackground(null);
  qc.clear();
}

export function useChats() {
  return useQuery({
    queryKey: chatKeys.list(),
    queryFn: () => api.get<Chat[]>("/chats"),
    staleTime: 2 * 60_000,
  });
}

export function useChat(id: string | null) {
  return useQuery({
    queryKey: chatKeys.detail(id ?? ""),
    queryFn: () => api.get<Chat>(`/chats/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useChatMessages(chatId: string | null, pageSize: number = 0) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(chatId ?? ""),
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (pageSize > 0) params.set("limit", String(pageSize));
      if (pageParam) params.set("before", pageParam);
      const qs = params.toString();
      return api.get<Message[]>(`/chats/${chatId}/messages${qs ? `?${qs}` : ""}`, { signal });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (pageSize <= 0 || lastPage.length < pageSize) return undefined;
      return lastPage[0]?.createdAt;
    },
    enabled: !!chatId,
  });
}

export function useChatMessageCount(chatId: string | null) {
  return useQuery({
    queryKey: chatKeys.messageCount(chatId ?? ""),
    queryFn: () => api.get<{ count: number }>(`/chats/${chatId}/message-count`),
    enabled: !!chatId,
    staleTime: 30_000,
  });
}

export function useChatGroup(groupId: string | null) {
  return useQuery({
    queryKey: chatKeys.group(groupId ?? ""),
    queryFn: () => api.get<Chat[]>(`/chats/group/${groupId}`),
    enabled: !!groupId,
  });
}

export function useCreateChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      mode: string;
      characterIds?: string[];
      groupId?: string | null;
      connectionId?: string | null;
      personaId?: string | null;
      promptPresetId?: string | null;
    }) => api.post<Chat>("/chats", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.list() }),
  });
}

export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/chats/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: chatKeys.list() });
      const previous = qc.getQueryData<Chat[]>(chatKeys.list());
      qc.setQueryData<Chat[]>(chatKeys.list(), (old) => old?.filter((c) => c.id !== id));
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(chatKeys.list(), context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: chatKeys.list() }),
  });
}

export function useDeleteChatGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => api.delete(`/chats/group/${groupId}`),
    onMutate: async (groupId) => {
      await qc.cancelQueries({ queryKey: chatKeys.list() });
      const previous = qc.getQueryData<Chat[]>(chatKeys.list());
      qc.setQueryData<Chat[]>(chatKeys.list(), (old) => old?.filter((c) => c.groupId !== groupId));
      return { previous };
    },
    onError: (_err, _groupId, context) => {
      if (context?.previous) qc.setQueryData(chatKeys.list(), context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: chatKeys.list() }),
  });
}

export function useUpdateChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      mode?: string;
      connectionId?: string | null;
      promptPresetId?: string | null;
      personaId?: string | null;
      characterIds?: string[];
    }) => api.patch<Chat>(`/chats/${id}`, data),
    onSuccess: (updatedChat, vars) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });

      // Patch the group cache so the branch selector dropdown reflects renames
      // (and any other field changes) without waiting for a chat switch.
      if (updatedChat?.groupId) {
        qc.setQueryData<Chat[]>(chatKeys.group(updatedChat.groupId), (existing) =>
          existing?.map((chat) => (chat.id === vars.id ? updatedChat : chat)),
        );
      }
      qc.invalidateQueries({ queryKey: [...chatKeys.all, "group"] });
    },
  });
}

export function useUpdateChatMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...metadata }: { id: string; [key: string]: unknown }) =>
      api.patch<Chat>(`/chats/${id}/metadata`, metadata),
    onSuccess: (updatedChat, vars) => {
      qc.setQueryData(chatKeys.detail(vars.id), updatedChat);
      qc.setQueryData<Chat[]>(chatKeys.list(), (existing) =>
        existing?.map((chat) => (chat.id === vars.id ? updatedChat : chat)),
      );

      const chatStore = useChatStore.getState();
      if (chatStore.activeChatId === vars.id) {
        chatStore.setActiveChat(updatedChat);
      }

      qc.invalidateQueries({ queryKey: chatKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
    },
  });
}

/** Patch day/week summaries via entry-level merge (concurrent-edit safe). */
export function useUpdateChatSummaries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      daySummaries?: Record<string, DaySummaryEntry>;
      weekSummaries?: Record<string, WeekSummaryEntry>;
    }) => api.patch<Chat>(`/chats/${id}/summaries`, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(vars.id) });
    },
  });
}

export function useCreateMessage(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { role: string; content: string; characterId?: string | null }) =>
      api.post<Message>(`/chats/${chatId}/messages`, data),
    onSuccess: () => {
      if (chatId) {
        qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
        qc.invalidateQueries({ queryKey: chatKeys.messageCount(chatId) });
        qc.invalidateQueries({ queryKey: chatKeys.list() });
      }
    },
  });
}

export function useDeleteMessage(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => api.delete(`/chats/${chatId}/messages/${messageId}`),
    onSuccess: () => {
      if (chatId) {
        qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
        qc.invalidateQueries({ queryKey: chatKeys.messageCount(chatId) });
      }
    },
  });
}

export function useDeleteMessages(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageIds: string[]) => api.post(`/chats/${chatId}/messages/bulk-delete`, { messageIds }),
    onSuccess: () => {
      if (chatId) {
        qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
        qc.invalidateQueries({ queryKey: chatKeys.messageCount(chatId) });
      }
    },
  });
}

/** Edit a message's content */
export function useUpdateMessage(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, content }: { messageId: string; content: string }) =>
      api.patch<Message>(`/chats/${chatId}/messages/${messageId}`, { content }),
    onMutate: async ({ messageId, content }) => {
      if (!chatId) return;
      // Cancel in-flight refetches (e.g. from generation events) so they
      // don't overwrite the optimistic value with stale server data.
      await qc.cancelQueries({ queryKey: chatKeys.messages(chatId) });
      const previous = qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages(chatId));
      qc.setQueryData<InfiniteData<Message[]>>(chatKeys.messages(chatId), (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page) => page.map((msg) => (msg.id === messageId ? { ...msg, content } : msg))),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (chatId && context?.previous) {
        qc.setQueryData(chatKeys.messages(chatId), context.previous);
      }
    },
    onSettled: () => {
      if (chatId) {
        // Skip invalidation while this chat is actively streaming — a refetch
        // could pick up the just-saved assistant message while the streaming
        // overlay is still visible, causing the response to appear doubled.
        // The generation's finally block will invalidate after streaming ends.
        const { streamingChatId, isStreaming } = useChatStore.getState();
        if (isStreaming && streamingChatId === chatId) return;
        qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
      }
    },
  });
}

/** Update a message's extra metadata (partial merge) */
export function useUpdateMessageExtra(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, extra }: { messageId: string; extra: Record<string, unknown> }) =>
      api.patch<Message>(`/chats/${chatId}/messages/${messageId}/extra`, extra),
    onSuccess: () => {
      if (chatId) {
        qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
      }
    },
  });
}

/** Peek at the assembled prompt for a chat */
export function usePeekPrompt() {
  return useMutation({
    mutationFn: (chatId: string) =>
      api.post<{
        messages: Array<{ role: string; content: string }>;
        parameters: unknown;
        generationInfo: {
          model?: string;
          provider?: string;
          temperature?: number | null;
          maxTokens?: number | null;
          showThoughts?: boolean | null;
          reasoningEffort?: string | null;
          verbosity?: string | null;
          tokensPrompt?: number | null;
          tokensCompletion?: number | null;
          tokensCachedPrompt?: number | null;
          tokensCacheWritePrompt?: number | null;
          durationMs?: number | null;
          finishReason?: string | null;
        } | null;
      }>(`/chats/${chatId}/peek-prompt`, {}),
  });
}

/** Export a chat as JSONL or plain text */
export function useExportChat() {
  return useMutation({
    mutationFn: async ({ chatId, format = "jsonl" }: { chatId: string; format?: "jsonl" | "text" }) => {
      const res = await fetch(`/api/chats/${chatId}/export?format=${format}`);
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+?)"/);
      const ext = format === "text" ? ".txt" : ".jsonl";
      const filename = match?.[1] ? decodeURIComponent(match[1]) : `chat-${chatId}${ext}`;
      // Download via blob
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
}

/** Create a branch (copy) of an existing chat */
export function useBranchChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, upToMessageId }: { chatId: string; upToMessageId?: string }) =>
      api.post<Chat>(`/chats/${chatId}/branch`, { upToMessageId }),
    onSuccess: (newChat, { chatId }) => {
      qc.invalidateQueries({ queryKey: chatKeys.list() });
      qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      // Pre-populate the new branch's cache so settings are immediately available
      if (newChat) {
        qc.setQueryData(chatKeys.detail(newChat.id), newChat);
      }
    },
  });
}

/** Generate a rolling summary for a chat via the LLM */
export function useGenerateSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, contextSize }: { chatId: string; contextSize?: number }) =>
      api.post<{ summary: string }>(`/chats/${chatId}/generate-summary`, { contextSize }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(vars.chatId) });
    },
  });
}

/** Clear all user data */
export function useExpungeData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scopes: ExpungeScope[]) => api.post<{ success: boolean }>("/admin/expunge", { confirm: true, scopes }),
    onSuccess: async () => {
      await resetClientAfterExpunge(qc);
    },
  });
}

/** Clear all user data */
export function useClearAllData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ success: boolean }>("/admin/clear-all", { confirm: true }),
    onSuccess: async () => {
      await resetClientAfterExpunge(qc);
    },
  });
}

/** Fetch swipes for a message */
export function useSwipes(chatId: string | null, messageId: string | null) {
  return useQuery({
    queryKey: [...chatKeys.all, "swipes", messageId ?? ""],
    queryFn: () => api.get<MessageSwipe[]>(`/chats/${chatId}/messages/${messageId}/swipes`),
    enabled: !!chatId && !!messageId,
  });
}

/** Set the active swipe for a message */
export function useSetActiveSwipe(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, index }: { messageId: string; index: number }) =>
      api.put<Message>(`/chats/${chatId}/messages/${messageId}/active-swipe`, { index }),
    onSuccess: () => {
      if (chatId) qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
    },
  });
}

/** Delete a single swipe while keeping the parent message */
export function useDeleteSwipe(chatId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, index }: { messageId: string; index: number }) =>
      api.delete<Message>(`/chats/${chatId}/messages/${messageId}/swipes/${index}`),
    onSuccess: (_data, { messageId }) => {
      if (!chatId) return;
      qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
      qc.invalidateQueries({ queryKey: [...chatKeys.all, "swipes", messageId] });
    },
  });
}

/** Connect two chats bidirectionally (conversation ↔ roleplay) */
export function useConnectChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, targetChatId }: { chatId: string; targetChatId: string }) =>
      api.post<{ connected: boolean }>(`/chats/${chatId}/connect`, { targetChatId }),
    onSuccess: (_data, { chatId, targetChatId }) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.detail(targetChatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
    },
  });
}

/** Disconnect a chat from its linked partner */
export function useDisconnectChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => api.post<{ disconnected: boolean }>(`/chats/${chatId}/disconnect`, {}),
    onSuccess: (_data, chatId) => {
      qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      qc.invalidateQueries({ queryKey: chatKeys.list() });
    },
  });
}
