import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useChatStore } from "../stores/chat.store";
import { chatKeys, useCreateChat } from "./use-chats";
import { useApplyChatPreset, useChatPresets } from "./use-chat-presets";

type ChatMode = "roleplay" | "conversation";

interface StartChatFromCharacterOptions {
  characterId: string;
  characterName: string;
  mode: ChatMode;
  firstMessage?: string;
  alternateGreetings?: string[];
}

export function useStartChatFromCharacter() {
  const createChat = useCreateChat();
  const queryClient = useQueryClient();
  const { data: chatPresetsData } = useChatPresets();
  const applyChatPreset = useApplyChatPreset();

  const startChatFromCharacter = useCallback(
    ({ characterId, characterName, mode, firstMessage, alternateGreetings }: StartChatFromCharacterOptions) => {
      const label = mode === "conversation" ? "Conversation" : "Roleplay";
      const presets = chatPresetsData ?? [];
      const presetMode = mode === "conversation" ? "conversation" : "roleplay";
      const starred = presets.find((preset) => preset.mode === presetMode && preset.isActive && !preset.isDefault);

      createChat.mutate(
        {
          name: characterName ? `${characterName} - ${label}` : `New ${label}`,
          mode,
          characterIds: [characterId],
        },
        {
          onSuccess: async (chat) => {
            useChatStore.getState().setActiveChatId(chat.id);

            if (starred) {
              try {
                await applyChatPreset.mutateAsync({ presetId: starred.id, chatId: chat.id });
              } catch {
                /* non-fatal: chat still opens with system defaults */
              }
            }

            if (mode === "roleplay" && firstMessage?.trim()) {
              try {
                const msg = await api.post<{ id: string }>(`/chats/${chat.id}/messages`, {
                  role: "assistant",
                  content: firstMessage,
                  characterId,
                });

                if (msg?.id && alternateGreetings?.length) {
                  for (const greeting of alternateGreetings) {
                    if (greeting.trim()) {
                      await api.post(`/chats/${chat.id}/messages/${msg.id}/swipes`, {
                        content: greeting,
                        silent: true,
                      });
                    }
                  }
                }

                queryClient.invalidateQueries({ queryKey: chatKeys.messages(chat.id) });
              } catch {
                /* non-fatal: don't block the new chat if greeting injection fails */
              }
            }

            useChatStore.getState().setShouldOpenSettings(true);
            useChatStore.getState().setShouldOpenWizard(true);
            useChatStore.getState().setShouldOpenWizardInShortcutMode(true);
          },
        },
      );
    },
    [applyChatPreset, chatPresetsData, createChat, queryClient],
  );

  return {
    startChatFromCharacter,
    isStartingChat: createChat.isPending,
  };
}
