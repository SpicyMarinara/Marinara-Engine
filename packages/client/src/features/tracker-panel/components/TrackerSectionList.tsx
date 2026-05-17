import { useCallback } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import type { GameState, Persona, PresentCharacter } from "@marinara-engine/shared";
import { useUpdateAgent, type AgentConfigRow } from "../../../hooks/use-agents";
import type { GameStatePatchField } from "../../../hooks/use-game-state-patcher";
import type {
  TrackerPanelCollapsedSections,
  TrackerPanelSide,
  TrackerPanelSizeProfile,
  TrackerTemperatureUnit,
  TrackerThoughtBubbleDisplay,
} from "../../../stores/ui.store";
import { useFeaturedCharacterCards } from "../hooks/use-featured-character-cards";
import { useTrackerMutations } from "../hooks/use-tracker-mutations";
import { useTrackerRerun } from "../hooks/use-tracker-rerun";
import {
  TRACKER_SECTION_AGENT_TYPES,
  TRACKER_SECTION_RERUN_TITLES,
} from "../lib/tracker-panel.constants";
import type { TrackerPanelSection, TrackerSpriteLookup } from "../tracker-panel.types";
import { SectionIconButton } from "./controls/SectionControls";
import { CharacterTrackerPanel } from "./sections/CharacterTrackerPanel";
import { CustomTrackerPanel } from "./sections/CustomTrackerPanel";
import { PersonaInventoryPanel } from "./sections/PersonaTrackerPanel";
import { QuestTrackerPanel } from "./sections/quest-tracker/QuestTrackerPanel";
import { WorldStatePanel } from "./sections/WorldStatePanel";

export function TrackerSectionList({
  activeChatId,
  activePersona,
  autoGenerateCharacterAvatars,
  characterSpriteLookup,
  characterTrackerConfig,
  characterTrackerSettings,
  currentGameState,
  enabledAgentTypes,
  expressionSpritesEnabled,
  featuredCharacterCardKeys,
  flushPatch,
  gameStateRefreshing,
  orderedTrackerSections,
  patchField,
  patchPlayerStats,
  resolveSpriteCharacterId,
  spriteExpressions,
  trackerPanelCollapsedSections,
  trackerPanelSide,
  trackerPanelSizeProfile,
  trackerPanelThoughtBubbleDisplay,
  trackerPanelDockedThoughtsAlwaysVisible,
  trackerTemperatureUnit,
  toggleTrackerPanelSectionCollapsed,
  deleteMode,
  addMode,
}: {
  activeChatId: string;
  activePersona: Persona | null;
  autoGenerateCharacterAvatars: boolean;
  characterSpriteLookup: TrackerSpriteLookup;
  characterTrackerConfig: AgentConfigRow | null;
  characterTrackerSettings: Record<string, unknown>;
  currentGameState: GameState;
  enabledAgentTypes: Set<string>;
  expressionSpritesEnabled: boolean;
  featuredCharacterCardKeys: Set<string>;
  flushPatch: () => Promise<void>;
  gameStateRefreshing: boolean;
  orderedTrackerSections: TrackerPanelSection[];
  patchField: (field: GameStatePatchField, value: unknown) => void;
  patchPlayerStats: (field: keyof NonNullable<GameState["playerStats"]>, value: unknown) => void;
  resolveSpriteCharacterId: (character: PresentCharacter) => string | null;
  spriteExpressions: Record<string, string>;
  trackerPanelCollapsedSections: TrackerPanelCollapsedSections;
  trackerPanelSide: TrackerPanelSide;
  trackerPanelSizeProfile: TrackerPanelSizeProfile;
  trackerPanelThoughtBubbleDisplay: TrackerThoughtBubbleDisplay;
  trackerPanelDockedThoughtsAlwaysVisible: boolean;
  trackerTemperatureUnit: TrackerTemperatureUnit;
  toggleTrackerPanelSectionCollapsed: (section: TrackerPanelSection) => void;
  deleteMode: boolean;
  addMode: boolean;
}) {
  const updateAgent = useUpdateAgent();
  const { featuredCharacterCards, removeFeaturedCharacterCard, toggleFeaturedCharacterCard } = useFeaturedCharacterCards({
    activeChatId,
    featuredCharacterCardKeys,
  });
  const { rerunTracker, trackerRetryBusy } = useTrackerRerun({
    activeChatId,
    enabledAgentTypes,
    flushPatch,
    gameStateRefreshing,
  });

  const playerStats = currentGameState.playerStats ?? null;
  const personaStats = currentGameState.personaStats ?? [];
  const presentCharacters = currentGameState.presentCharacters ?? [];
  const inventory = playerStats?.inventory ?? [];
  const quests = playerStats?.activeQuests ?? [];
  const customFields = playerStats?.customTrackerFields ?? [];
  const {
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
  } = useTrackerMutations({
    activeChatId,
    inventory,
    personaStats,
    presentCharacters,
    quests,
    patchField,
    patchPlayerStats,
    removeFeaturedCharacterCard,
  });
  const isPanelCollapsed = (section: TrackerPanelSection) => trackerPanelCollapsedSections[section] === true;
  const toggleAutoGenerateCharacterAvatars = useCallback(() => {
    if (!characterTrackerConfig) return;
    const nextSettings = { ...characterTrackerSettings };
    if (autoGenerateCharacterAvatars) {
      delete nextSettings.autoGenerateAvatars;
    } else {
      nextSettings.autoGenerateAvatars = true;
    }
    updateAgent.mutate({ id: characterTrackerConfig.id, settings: nextSettings });
  }, [autoGenerateCharacterAvatars, characterTrackerConfig, characterTrackerSettings, updateAgent]);

  const renderRerunAction = (section: TrackerPanelSection) => {
    const agentType = TRACKER_SECTION_AGENT_TYPES[section];
    if (!agentType || !enabledAgentTypes.has(agentType)) return null;
    const title = trackerRetryBusy
      ? "A tracker or reply is already running"
      : (TRACKER_SECTION_RERUN_TITLES[section] ?? `Re-run ${agentType} tracker`);
    return (
      <SectionIconButton onClick={() => void rerunTracker(agentType)} disabled={trackerRetryBusy} title={title}>
        <RefreshCw size="0.75rem" className={trackerRetryBusy ? "animate-spin" : ""} />
      </SectionIconButton>
    );
  };
  const renderCharacterHeaderAction = () => {
    const autoAvatarTitle = autoGenerateCharacterAvatars
      ? "Auto-generate character avatars: ON"
      : "Auto-generate character avatars: OFF";
    return (
      <>
        {characterTrackerConfig && (
          <SectionIconButton
            onClick={toggleAutoGenerateCharacterAvatars}
            disabled={updateAgent.isPending}
            title={autoAvatarTitle}
            pressed={autoGenerateCharacterAvatars}
            tone="feature"
          >
            <Sparkles size="0.6875rem" />
          </SectionIconButton>
        )}
        {renderRerunAction("characters")}
      </>
    );
  };
  const renderTrackerSection = (section: TrackerPanelSection) => {
    switch (section) {
      case "world":
        return (
          <WorldStatePanel
            key="world"
            state={currentGameState}
            trackerPanelSizeProfile={trackerPanelSizeProfile}
            trackerTemperatureUnit={trackerTemperatureUnit}
            action={renderRerunAction("world")}
            onSaveField={patchField}
            collapsed={isPanelCollapsed("world")}
            onToggleCollapsed={() => toggleTrackerPanelSectionCollapsed("world")}
          />
        );
      case "persona":
        return (
          <PersonaInventoryPanel
            key="persona"
            persona={activePersona}
            status={playerStats?.status ?? ""}
            trackerPanelSide={trackerPanelSide}
            trackerPanelSizeProfile={trackerPanelSizeProfile}
            spriteExpression={
              expressionSpritesEnabled && activePersona
                ? (spriteExpressions[activePersona.id] ?? spriteExpressions[activePersona.name] ?? "neutral")
                : undefined
            }
            personaStats={personaStats}
            inventory={inventory}
            action={renderRerunAction("persona")}
            onSaveStatus={savePersonaStatus}
            onUpdatePersonaStats={updatePersonaStats}
            onAddPersonaStat={addPersonaStat}
            onAddInventoryItem={addInventoryItem}
            onUpdateInventoryItem={updateInventoryItem}
            onRemoveInventoryItem={removeInventoryItem}
            deleteMode={deleteMode}
            addMode={addMode}
            collapsed={isPanelCollapsed("persona")}
            onToggleCollapsed={() => toggleTrackerPanelSectionCollapsed("persona")}
          />
        );
      case "characters":
        return (
          <CharacterTrackerPanel
            key="characters"
            activeChatId={activeChatId}
            characters={presentCharacters}
            featuredCharacterCards={featuredCharacterCards}
            spriteExpressions={spriteExpressions}
            expressionSpritesEnabled={expressionSpritesEnabled}
            characterPictures={characterSpriteLookup.pictureById}
            characterProfileColors={characterSpriteLookup.profileColorsById}
            resolveSpriteCharacterId={resolveSpriteCharacterId}
            trackerPanelSide={trackerPanelSide}
            trackerPanelSizeProfile={trackerPanelSizeProfile}
            thoughtBubbleDisplay={trackerPanelThoughtBubbleDisplay}
            dockedThoughtsAlwaysVisible={trackerPanelDockedThoughtsAlwaysVisible}
            action={renderCharacterHeaderAction()}
            onUpdateCharacter={updateCharacter}
            onRemoveCharacter={removeCharacter}
            onAddCharacter={addCharacter}
            onUploadAvatar={openAvatarUpload}
            onToggleFeatured={toggleFeaturedCharacterCard}
            deleteMode={deleteMode}
            addMode={addMode}
            collapsed={isPanelCollapsed("characters")}
            onToggleCollapsed={() => toggleTrackerPanelSectionCollapsed("characters")}
          />
        );
      case "quests":
        return (
          <QuestTrackerPanel
            key="quests"
            quests={quests}
            action={renderRerunAction("quests")}
            onAddQuest={addQuest}
            onUpdateQuest={updateQuest}
            onRemoveQuest={removeQuest}
            deleteMode={deleteMode}
            addMode={addMode}
            trackerPanelSizeProfile={trackerPanelSizeProfile}
            collapsed={isPanelCollapsed("quests")}
            onToggleCollapsed={() => toggleTrackerPanelSectionCollapsed("quests")}
          />
        );
      case "custom":
        return (
          <CustomTrackerPanel
            key="custom"
            fields={customFields}
            action={renderRerunAction("custom")}
            onUpdateFields={updateCustomFields}
            deleteMode={deleteMode}
            addMode={addMode}
            trackerPanelSizeProfile={trackerPanelSizeProfile}
            collapsed={isPanelCollapsed("custom")}
            onToggleCollapsed={() => toggleTrackerPanelSectionCollapsed("custom")}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <input
        ref={avatarFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarFileInputChange}
      />
      {orderedTrackerSections.map((section) => renderTrackerSection(section))}
    </>
  );
}
