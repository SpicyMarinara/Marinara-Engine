import { useCallback, useMemo } from "react";
import type { PresentCharacter } from "@marinara-engine/shared";
import { useCharacters } from "../../../hooks/use-characters";
import { parseCharacterDisplayData } from "../../../lib/character-display";
import type { TrackerSpriteLookup } from "../tracker-panel.types";
import { isSpriteLookupCharacterId } from "../lib/sprite-expressions";
import { normalizeLookupText } from "../lib/tracker-metadata";
import { getCharacterProfileColors } from "../lib/tracker-profile-style";

interface UseTrackerSpriteLookupOptions {
  enabled: boolean;
  chatCharacterIds: string[];
}

export function useTrackerSpriteLookup({ enabled, chatCharacterIds }: UseTrackerSpriteLookupOptions) {
  const { data: charactersData } = useCharacters(enabled);
  const characterSpriteLookup = useMemo<TrackerSpriteLookup>(() => {
    const rows = (
      Array.isArray(charactersData)
        ? (charactersData as Array<{ id: string; data: unknown; comment?: string | null; avatarPath?: string | null }>)
        : []
    ).filter((character) => typeof character.id === "string" && character.id.length > 0);
    const chatIdSet = new Set(chatCharacterIds);
    const orderedRows = [
      ...rows.filter((character) => chatIdSet.has(character.id)),
      ...rows.filter((character) => !chatIdSet.has(character.id)),
    ];
    const knownIds = new Set(rows.map((character) => character.id));
    const idByName = new Map<string, string>();
    const pictureById: Record<string, string> = {};
    const profileColorsById: TrackerSpriteLookup["profileColorsById"] = {};
    for (const character of orderedRows) {
      if (character.avatarPath) pictureById[character.id] = character.avatarPath;
      const profileColors = getCharacterProfileColors(character.data);
      if (profileColors) profileColorsById[character.id] = profileColors;
      const display = parseCharacterDisplayData(character);
      const nameKey = normalizeLookupText(display.name);
      if (nameKey && !idByName.has(nameKey)) idByName.set(nameKey, character.id);
      const commentKey = normalizeLookupText(display.comment);
      if (commentKey && !idByName.has(commentKey)) idByName.set(commentKey, character.id);
    }
    return { knownIds, idByName, pictureById, profileColorsById };
  }, [charactersData, chatCharacterIds]);

  const resolveSpriteCharacterId = useCallback(
    (character: PresentCharacter) => {
      const rawId = character.characterId?.trim() ?? "";
      if (rawId && characterSpriteLookup.knownIds.has(rawId)) return rawId;
      const idNameMatch = characterSpriteLookup.idByName.get(normalizeLookupText(rawId));
      if (idNameMatch) return idNameMatch;
      const nameMatch = characterSpriteLookup.idByName.get(normalizeLookupText(character.name));
      if (nameMatch) return nameMatch;
      return isSpriteLookupCharacterId(rawId) ? rawId : null;
    },
    [characterSpriteLookup],
  );

  return { characterSpriteLookup, resolveSpriteCharacterId };
}
