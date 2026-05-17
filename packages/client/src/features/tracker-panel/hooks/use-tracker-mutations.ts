import { useCallback, useRef, useState, type ChangeEvent } from "react";
import type {
  CharacterStat,
  CustomTrackerField,
  InventoryItem,
  PlayerStats,
  PresentCharacter,
  QuestProgress,
} from "@marinara-engine/shared";
import { api } from "../../../lib/api-client";
import { useGameStateStore } from "../../../stores/game-state.store";
import type { GameStatePatchField } from "../../../hooks/use-game-state-patcher";
import { getCharacterFeatureKey } from "../lib/character-tracker-data";

function makeManualTrackerId() {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `manual-${id}`;
}

export function useTrackerMutations({
  activeChatId,
  inventory,
  personaStats,
  presentCharacters,
  quests,
  patchField,
  patchPlayerStats,
  removeFeaturedCharacterCard,
}: {
  activeChatId: string | null;
  inventory: InventoryItem[];
  personaStats: CharacterStat[];
  presentCharacters: PresentCharacter[];
  quests: QuestProgress[];
  patchField: (field: GameStatePatchField, value: unknown) => void;
  patchPlayerStats: (field: keyof PlayerStats, value: unknown) => void;
  removeFeaturedCharacterCard: (key: string) => void;
}) {
  const [avatarUploadIndex, setAvatarUploadIndex] = useState<number | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const avatarUploadSerialRef = useRef(0);
  const avatarUploadTokenByCharacterRef = useRef(new Map<string, number>());

  const openAvatarUpload = useCallback((index: number) => {
    setAvatarUploadIndex(index);
    avatarFileInputRef.current?.click();
  }, []);

  const handleAvatarUpload = useCallback(
    (index: number, file: File) => {
      if (!activeChatId) return;
      const currentState = useGameStateStore.getState().current;
      const currentCharacters = currentState?.chatId === activeChatId ? (currentState.presentCharacters ?? []) : [];
      const character = currentCharacters[index];
      if (!character) return;

      const targetCharacterId = character.characterId;
      const uploadToken = avatarUploadSerialRef.current + 1;
      avatarUploadSerialRef.current = uploadToken;
      avatarUploadTokenByCharacterRef.current.set(targetCharacterId, uploadToken);

      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl) {
          if (avatarUploadTokenByCharacterRef.current.get(targetCharacterId) === uploadToken) {
            avatarUploadTokenByCharacterRef.current.delete(targetCharacterId);
          }
          return;
        }
        if (avatarUploadTokenByCharacterRef.current.get(targetCharacterId) !== uploadToken) return;

        try {
          const response = await api.post<{ avatarPath: string }>(`/avatars/npc/${activeChatId}`, {
            name: character.name,
            avatar: dataUrl,
          });
          if (avatarUploadTokenByCharacterRef.current.get(targetCharacterId) !== uploadToken) return;

          const latestState = useGameStateStore.getState().current;
          const latestCharacters = latestState?.chatId === activeChatId ? (latestState.presentCharacters ?? []) : [];
          const targetIndex = latestCharacters.findIndex((candidate) => candidate.characterId === targetCharacterId);
          if (targetIndex < 0) return;

          const nextCharacters = [...latestCharacters];
          nextCharacters[targetIndex] = { ...latestCharacters[targetIndex]!, avatarPath: response.avatarPath };
          patchField("presentCharacters", nextCharacters);
        } catch {
          // Match the original HUD widget behavior: failed avatar uploads leave tracker data unchanged.
        } finally {
          if (avatarUploadTokenByCharacterRef.current.get(targetCharacterId) === uploadToken) {
            avatarUploadTokenByCharacterRef.current.delete(targetCharacterId);
          }
        }
      };
      reader.onerror = () => {
        if (avatarUploadTokenByCharacterRef.current.get(targetCharacterId) === uploadToken) {
          avatarUploadTokenByCharacterRef.current.delete(targetCharacterId);
        }
      };
      reader.readAsDataURL(file);
    },
    [activeChatId, patchField],
  );

  const handleAvatarFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const index = avatarUploadIndex;
      setAvatarUploadIndex(null);
      if (file && index !== null) handleAvatarUpload(index, file);
      event.target.value = "";
    },
    [avatarUploadIndex, handleAvatarUpload],
  );

  const updateCharacter = useCallback(
    (index: number, character: PresentCharacter) => {
      const next = [...presentCharacters];
      next[index] = character;
      patchField("presentCharacters", next);
    },
    [patchField, presentCharacters],
  );

  const removeCharacter = useCallback(
    (index: number) => {
      const removed = presentCharacters[index];
      if (removed) {
        removeFeaturedCharacterCard(getCharacterFeatureKey(removed, index));
      }
      patchField(
        "presentCharacters",
        presentCharacters.filter((_, characterIndex) => characterIndex !== index),
      );
    },
    [patchField, presentCharacters, removeFeaturedCharacterCard],
  );

  const addCharacter = useCallback(() => {
    patchField("presentCharacters", [
      ...presentCharacters,
      {
        characterId: makeManualTrackerId(),
        name: "New Character",
        emoji: "?",
        mood: "",
        appearance: null,
        outfit: null,
        customFields: {},
        stats: [],
        thoughts: null,
      },
    ]);
  }, [patchField, presentCharacters]);

  const updateInventory = useCallback(
    (items: InventoryItem[]) => patchPlayerStats("inventory", items),
    [patchPlayerStats],
  );

  const updateInventoryItem = useCallback(
    (index: number, item: InventoryItem) => {
      const next = [...inventory];
      next[index] = item;
      updateInventory(next);
    },
    [inventory, updateInventory],
  );

  const removeInventoryItem = useCallback(
    (index: number) => {
      updateInventory(inventory.filter((_, itemIndex) => itemIndex !== index));
    },
    [inventory, updateInventory],
  );

  const addInventoryItem = useCallback(() => {
    updateInventory([...inventory, { name: "New Item", description: "", quantity: 1, location: "on_person" }]);
  }, [inventory, updateInventory]);

  const updateQuests = useCallback(
    (nextQuests: QuestProgress[]) => patchPlayerStats("activeQuests", nextQuests),
    [patchPlayerStats],
  );

  const updateQuest = useCallback(
    (index: number, quest: QuestProgress) => {
      const next = [...quests];
      next[index] = quest;
      updateQuests(next);
    },
    [quests, updateQuests],
  );

  const removeQuest = useCallback(
    (index: number) => {
      updateQuests(quests.filter((_, questIndex) => questIndex !== index));
    },
    [quests, updateQuests],
  );

  const addQuest = useCallback(() => {
    updateQuests([
      ...quests,
      {
        questEntryId: makeManualTrackerId(),
        name: "New Quest",
        currentStage: 0,
        objectives: [{ text: "Objective 1", completed: false }],
        completed: false,
      },
    ]);
  }, [quests, updateQuests]);

  const savePersonaStatus = useCallback(
    (status: string) => patchPlayerStats("status", status),
    [patchPlayerStats],
  );

  const updatePersonaStats = useCallback(
    (stats: CharacterStat[]) => patchField("personaStats", stats),
    [patchField],
  );

  const addPersonaStat = useCallback(() => {
    patchField("personaStats", [
      ...personaStats,
      { name: "New Stat", value: 0, max: 100, color: "var(--primary)" },
    ]);
  }, [patchField, personaStats]);

  const updateCustomFields = useCallback(
    (fields: CustomTrackerField[]) => patchPlayerStats("customTrackerFields", fields),
    [patchPlayerStats],
  );

  return {
    addCharacter,
    addInventoryItem,
    addPersonaStat,
    addQuest,
    avatarFileInputRef,
    handleAvatarFileInputChange,
    openAvatarUpload,
    removeCharacter,
    removeInventoryItem,
    removeQuest,
    savePersonaStatus,
    updateCharacter,
    updateCustomFields,
    updateInventoryItem,
    updatePersonaStats,
    updateQuest,
  };
}
