// ──────────────────────────────────────────────
// CYOA Choices — interactive choice buttons after assistant messages
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Dices, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { useUpdateMessageExtra } from "../../hooks/use-chats";
import { useAgentStore } from "../../stores/agent.store";
import { useGenerate } from "../../hooks/use-generate";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import type { Message } from "@marinara-engine/shared";

type CyoaChoice = {
  label: string;
  text: string;
};

interface Props {
  messages?: Message[];
}

function normalizeChoices(choices: CyoaChoice[]) {
  return choices
    .map((choice, index) => ({
      label: choice.label.trim() || `Choice ${index + 1}`,
      text: choice.text.trim(),
    }))
    .filter((choice) => choice.text.length > 0);
}

export function CyoaChoices({ messages }: Props) {
  const choices = useAgentStore((s) => s.cyoaChoices);
  const choicesChatId = useAgentStore((s) => s.cyoaChoicesChatId);
  const setCyoaChoices = useAgentStore((s) => s.setCyoaChoices);
  const clearCyoaChoices = useAgentStore((s) => s.clearCyoaChoices);
  const { generate, retryAgents } = useGenerate();
  const activeChatId = useChatStore((s) => s.activeChatId);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const impersonateCyoaChoices = useUIStore((s) => s.impersonateCyoaChoices);
  const updateMessageExtra = useUpdateMessageExtra(activeChatId);
  const [isEditing, setIsEditing] = useState(false);
  const [isRerolling, setIsRerolling] = useState(false);
  const [draftChoices, setDraftChoices] = useState<CyoaChoice[]>([]);
  const hydratedChatIdRef = useRef<string | null>(null);
  const previousChatIdRef = useRef<string | null>(null);

  const setChoicesForActiveChat = useCallback(
    (nextChoices: CyoaChoice[]) => {
      setCyoaChoices(nextChoices, activeChatId);
    },
    [activeChatId, setCyoaChoices],
  );

  const clearChoicesForActiveChat = useCallback(() => {
    clearCyoaChoices();
  }, [clearCyoaChoices]);

  // Hydrate CYOA choices from the last assistant message's extras on mount / chat switch
  const persistedChoiceState = useMemo(() => {
    if (!messages) return null;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant?.extra) return null;
    let extra: Record<string, unknown>;
    try {
      extra = typeof lastAssistant.extra === "string" ? JSON.parse(lastAssistant.extra) : lastAssistant.extra;
    } catch {
      return null;
    }
    const saved = extra.cyoaChoices as CyoaChoice[] | undefined;
    return saved && saved.length > 0 ? { messageId: lastAssistant.id, choices: saved } : null;
  }, [messages]);

  useEffect(() => {
    const switchedChats = previousChatIdRef.current !== activeChatId;
    previousChatIdRef.current = activeChatId;

    if (!activeChatId) {
      hydratedChatIdRef.current = null;
      setIsEditing(false);
      setDraftChoices([]);
      clearCyoaChoices();
      return;
    }

    if (switchedChats) {
      hydratedChatIdRef.current = null;
    }

    setIsEditing(false);
    setDraftChoices([]);

    const hasLiveChoicesForActiveChat = choicesChatId === activeChatId && choices.length > 0;

    // Wait until the messages query has produced a value for this chat; otherwise
    // we would mark hydrated too early and skip re-running when extras arrive.
    if (messages === undefined) {
      if (switchedChats && !hasLiveChoicesForActiveChat) clearCyoaChoices();
      return;
    }

    // On chat switch, clear any previous chat's choices and hydrate from the
    // new chat's last assistant extra (if present).
    if (isStreaming) {
      if (switchedChats) clearCyoaChoices();
      return;
    }

    if (persistedChoiceState?.choices?.length) {
      setChoicesForActiveChat(persistedChoiceState.choices);
      hydratedChatIdRef.current = activeChatId;
      return;
    }

    if (hasLiveChoicesForActiveChat) {
      return;
    }

    if (hydratedChatIdRef.current === activeChatId) {
      return;
    }

    if (switchedChats) {
      clearCyoaChoices();
    } else {
      clearChoicesForActiveChat();
    }

    hydratedChatIdRef.current = activeChatId;
  }, [
    activeChatId,
    choices.length,
    choicesChatId,
    clearChoicesForActiveChat,
    clearCyoaChoices,
    isStreaming,
    messages,
    persistedChoiceState,
    setChoicesForActiveChat,
  ]);

  const handleChoice = useCallback(
    async (text: string) => {
      if (!activeChatId || isStreaming || isEditing) return;
      clearChoicesForActiveChat();
      if (impersonateCyoaChoices) {
        const { impersonatePresetId, impersonateConnectionId, impersonateBlockAgents, impersonatePromptTemplate } =
          useUIStore.getState();
        const trimmedPromptTemplate = impersonatePromptTemplate.trim();
        await generate({
          chatId: activeChatId,
          connectionId: null,
          impersonate: true,
          userMessage: text,
          ...(impersonatePresetId ? { impersonatePresetId } : {}),
          ...(impersonateConnectionId ? { impersonateConnectionId } : {}),
          ...(impersonateBlockAgents ? { impersonateBlockAgents: true } : {}),
          ...(trimmedPromptTemplate ? { impersonatePromptTemplate: trimmedPromptTemplate } : {}),
        });
        return;
      }

      await generate({
        chatId: activeChatId,
        connectionId: null,
        userMessage: text,
      });
    },
    [activeChatId, isStreaming, isEditing, impersonateCyoaChoices, clearChoicesForActiveChat, generate],
  );

  const handleReroll = useCallback(async () => {
    if (!activeChatId || isStreaming || isEditing || isRerolling) return;
    setIsRerolling(true);
    try {
      // Re-runs ONLY the CYOA agent with fresh context (latest messages + last
      // assistant's extras). The retry route persists the new choices to the
      // message's extra and the SSE handler swaps them into the store.
      await retryAgents(activeChatId, ["cyoa"]);
    } finally {
      setIsRerolling(false);
    }
  }, [activeChatId, isStreaming, isEditing, isRerolling, retryAgents]);

  const handleStartEdit = useCallback(() => {
    setDraftChoices(choices.map((choice) => ({ ...choice })));
    setIsEditing(true);
  }, [choices]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setDraftChoices([]);
  }, []);

  const updateDraftChoice = useCallback((index: number, field: keyof CyoaChoice, value: string) => {
    setDraftChoices((prev) =>
      prev.map((choice, choiceIndex) => (choiceIndex === index ? { ...choice, [field]: value } : choice)),
    );
  }, []);

  const handleSaveChoices = useCallback(async () => {
    const normalizedChoices = normalizeChoices(draftChoices);
    if (normalizedChoices.length === 0) return;

    setChoicesForActiveChat(normalizedChoices);
    if (persistedChoiceState?.messageId) {
      await updateMessageExtra.mutateAsync({
        messageId: persistedChoiceState.messageId,
        extra: { cyoaChoices: normalizedChoices },
      });
    }

    setIsEditing(false);
    setDraftChoices([]);
  }, [draftChoices, persistedChoiceState?.messageId, setChoicesForActiveChat, updateMessageExtra]);

  if (choices.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-2 px-4 py-3 animate-message-in">
      <div className="flex items-center gap-2 text-[0.625rem] text-[var(--muted-foreground)]/60">
        <div className="flex items-center gap-1.5">
          <Sparkles size="0.625rem" />
          <span>What will you do?</span>
        </div>
        {impersonateCyoaChoices && (
          <span className="rounded-full border border-purple-400/20 bg-purple-500/10 px-1.5 py-0.5 text-[0.5625rem] font-semibold text-purple-700 dark:text-purple-200">
            Impersonate
          </span>
        )}
        <button
          type="button"
          onClick={isEditing ? handleCancelEdit : handleStartEdit}
          disabled={isStreaming || isRerolling || updateMessageExtra.isPending}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)]/20 px-2 py-1 text-[0.5625rem] text-[var(--foreground)]/60 transition-all hover:border-[var(--border)] hover:bg-[var(--muted)]/40 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-black/35 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/80"
          title={isEditing ? "Cancel editing choices" : "Edit CYOA choices"}
        >
          <Pencil size="0.625rem" />
          <span>{isEditing ? "Cancel" : "Edit"}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            void handleReroll();
          }}
          disabled={isStreaming || isEditing || isRerolling || updateMessageExtra.isPending}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)]/20 px-2 py-1 text-[0.5625rem] text-[var(--foreground)]/60 transition-all hover:border-[var(--border)] hover:bg-[var(--muted)]/40 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-black/35 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/80"
          title="Re-roll CYOA choices using the latest chat context"
        >
          {isRerolling ? <Loader2 size="0.625rem" className="animate-spin" /> : <Dices size="0.625rem" />}
          <span>{isRerolling ? "Rolling" : "Re-roll"}</span>
        </button>
      </div>
      {isEditing ? (
        <div className="w-full max-w-[85%] space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--card)]/90 p-3 backdrop-blur-md dark:border-white/10 dark:bg-black/45">
          {draftChoices.map((choice, index) => (
            <div
              key={index}
              className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-3 dark:border-white/8 dark:bg-black/30"
            >
              <input
                type="text"
                value={choice.label}
                onChange={(e) => updateDraftChoice(index, "label", e.target.value)}
                placeholder={`Choice ${index + 1}`}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2 text-[0.6875rem] font-semibold text-purple-700 outline-none transition-colors focus:border-purple-400/40 dark:border-white/10 dark:bg-black/35 dark:text-purple-200"
              />
              <textarea
                value={choice.text}
                onChange={(e) => updateDraftChoice(index, "text", e.target.value)}
                rows={Math.min(Math.max(choice.text.split("\n").length, 2), 6)}
                placeholder="Describe the action or dialogue sent when this choice is clicked."
                className="mt-2 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2 text-[0.6875rem] leading-relaxed text-[var(--foreground)]/80 outline-none transition-colors focus:border-purple-400/40 dark:border-white/10 dark:bg-black/35 dark:text-white/75"
              />
            </div>
          ))}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleCancelEdit}
              disabled={updateMessageExtra.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-1.5 text-[0.625rem] text-[var(--foreground)]/70 transition-colors hover:bg-[var(--muted)]/40 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-black/35 dark:text-white/60"
            >
              <X size="0.75rem" />
              <span>Cancel</span>
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSaveChoices();
              }}
              disabled={updateMessageExtra.isPending || normalizeChoices(draftChoices).length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-[0.625rem] text-emerald-200 transition-colors hover:bg-emerald-500/15 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {updateMessageExtra.isPending ? (
                <Loader2 size="0.75rem" className="animate-spin" />
              ) : (
                <Check size="0.75rem" />
              )}
              <span>{updateMessageExtra.isPending ? "Saving" : "Save Choices"}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex max-w-[85%] flex-wrap justify-center gap-2">
          {choices.map((choice, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleChoice(choice.text)}
              disabled={isStreaming || isRerolling}
              className="group relative rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-4 py-2.5 text-left backdrop-blur-md transition-all hover:border-purple-400/40 hover:bg-purple-500/10 hover:shadow-lg hover:shadow-purple-500/5 active:scale-[0.98] disabled:opacity-50 dark:border-white/10 dark:bg-black/50"
            >
              <span className="block text-[0.6875rem] font-semibold text-purple-700 group-hover:text-purple-600 dark:text-purple-300/90 dark:group-hover:text-purple-200">
                {choice.label}
              </span>
              <span className="mt-0.5 block text-[0.625rem] leading-relaxed text-[var(--foreground)]/60 group-hover:text-[var(--foreground)]/80 dark:text-white/50 dark:group-hover:text-white/70">
                {choice.text}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
