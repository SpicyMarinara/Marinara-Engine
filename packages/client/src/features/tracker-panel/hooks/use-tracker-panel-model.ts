import { useCallback, useMemo } from "react";
import type { Persona } from "@marinara-engine/shared";
import { useAgentConfigs, type AgentConfigRow } from "../../../hooks/use-agents";
import { usePersonas } from "../../../hooks/use-characters";
import { useChat, useChatMessages } from "../../../hooks/use-chats";
import type { TrackerDataPanelSection } from "../../../stores/ui.store";
import { TRACKER_FEATURED_CHARACTER_META_KEY, TRACKER_SECTION_AGENT_TYPES } from "../lib/tracker-panel.constants";
import {
  normalizeMaybeJsonStringArray,
  normalizeStringArray,
  parseAgentSettings,
  parseMetadataRecord,
} from "../lib/tracker-metadata";
import { getLatestSpriteExpressionsFromMessages, normalizeSpriteExpressionMap } from "../lib/sprite-expressions";
import { useTrackerSpriteLookup } from "./use-tracker-sprite-lookup";

interface UseTrackerPanelModelOptions {
  activeChatId: string | null;
  trackerPanelSectionOrder: TrackerDataPanelSection[];
  trackerPanelUseExpressionSprites: boolean;
}

export function useTrackerPanelModel({
  activeChatId,
  trackerPanelSectionOrder,
  trackerPanelUseExpressionSprites,
}: UseTrackerPanelModelOptions) {
  const { data: chat } = useChat(activeChatId);
  const chatMeta = useMemo(() => {
    const raw = (chat as unknown as { metadata?: string | Record<string, unknown> } | undefined)?.metadata;
    return parseMetadataRecord(raw);
  }, [chat]);
  const chatCharacterIds = useMemo(
    () => normalizeMaybeJsonStringArray((chat as unknown as { characterIds?: unknown } | undefined)?.characterIds),
    [chat],
  );
  const enabledAgentTypes = useMemo(() => {
    const set = new Set<string>();
    if (!chatMeta.enableAgents) return set;
    const activeAgentIds = Array.isArray(chatMeta.activeAgentIds) ? chatMeta.activeAgentIds : [];
    for (const id of activeAgentIds) {
      if (typeof id === "string") set.add(id);
    }
    return set;
  }, [chatMeta]);
  const expressionAgentEnabled = enabledAgentTypes.has("expression");
  const isSectionEnabled = useCallback(
    (section: TrackerDataPanelSection) => {
      const agentType = TRACKER_SECTION_AGENT_TYPES[section];
      return !!agentType && enabledAgentTypes.has(agentType);
    },
    [enabledAgentTypes],
  );
  const personaTrackerEnabled = isSectionEnabled("persona");
  const characterTrackerEnabled = isSectionEnabled("characters");
  const orderedTrackerSections = useMemo(
    () => trackerPanelSectionOrder.filter(isSectionEnabled),
    [isSectionEnabled, trackerPanelSectionOrder],
  );
  const spriteExpressionLookupEnabled =
    !!activeChatId &&
    trackerPanelUseExpressionSprites &&
    expressionAgentEnabled &&
    (personaTrackerEnabled || characterTrackerEnabled);
  const characterDataLookupEnabled = !!activeChatId && characterTrackerEnabled;
  const personaDataLookupEnabled = !!activeChatId && personaTrackerEnabled;
  const agentConfigLookupEnabled = !!activeChatId && characterTrackerEnabled;
  const { data: messageData } = useChatMessages(activeChatId, 20, spriteExpressionLookupEnabled);
  const { data: agentConfigs } = useAgentConfigs(agentConfigLookupEnabled);
  const { data: personasData } = usePersonas(personaDataLookupEnabled);
  const { characterSpriteLookup, resolveSpriteCharacterId } = useTrackerSpriteLookup({
    enabled: characterDataLookupEnabled,
    chatCharacterIds,
  });
  const characterTrackerConfig = useMemo(() => {
    if (!Array.isArray(agentConfigs)) return null;
    return (agentConfigs as AgentConfigRow[]).find((agent) => agent.type === "character-tracker") ?? null;
  }, [agentConfigs]);
  const characterTrackerSettings = useMemo(
    () => parseAgentSettings(characterTrackerConfig?.settings),
    [characterTrackerConfig],
  );
  const autoGenerateCharacterAvatars = characterTrackerSettings.autoGenerateAvatars === true;
  const cachedMessages = useMemo(() => messageData?.pages.flat() ?? [], [messageData]);
  const spriteExpressions = useMemo(
    () =>
      getLatestSpriteExpressionsFromMessages(cachedMessages as Array<{ role?: string; extra?: unknown }>) ??
      normalizeSpriteExpressionMap(chatMeta.spriteExpressions),
    [cachedMessages, chatMeta.spriteExpressions],
  );
  const featuredCharacterCardKeys = useMemo(
    () => new Set(normalizeStringArray(chatMeta[TRACKER_FEATURED_CHARACTER_META_KEY])),
    [chatMeta],
  );
  const personas = useMemo(() => (Array.isArray(personasData) ? (personasData as Persona[]) : []), [personasData]);
  const activePersona = useMemo(() => {
    const chatPersonaId = (chat as unknown as { personaId?: unknown } | undefined)?.personaId;
    const selectedPersonaId = typeof chatPersonaId === "string" ? chatPersonaId : null;
    return (
      (selectedPersonaId ? personas.find((persona) => persona.id === selectedPersonaId) : null) ??
      personas.find((persona) => persona.isActive) ??
      null
    );
  }, [chat, personas]);
  const expressionSpritesEnabled = trackerPanelUseExpressionSprites && expressionAgentEnabled;

  return {
    activePersona,
    autoGenerateCharacterAvatars,
    characterSpriteLookup,
    characterTrackerConfig,
    characterTrackerSettings,
    enabledAgentTypes,
    expressionSpritesEnabled,
    featuredCharacterCardKeys,
    orderedTrackerSections,
    resolveSpriteCharacterId,
    spriteExpressions,
  };
}
