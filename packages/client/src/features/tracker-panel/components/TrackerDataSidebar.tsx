import { useState } from "react";
import { useUIStore } from "../../../stores/ui.store";
import { useChatStore } from "../../../stores/chat.store";
import { useGameStatePatcher } from "../../../hooks/use-game-state-patcher";
import { cn } from "../../../lib/utils";
import { useTrackerGameState } from "../hooks/use-tracker-game-state";
import { useTrackerPanelModel } from "../hooks/use-tracker-panel-model";
import { EmptySection } from "./controls/SectionControls";
import { TrackerSectionList } from "./TrackerSectionList";
import { TrackerSkeleton } from "./TrackerSkeleton";
import { TrackerSidebarHeader } from "./TrackerSidebarHeader";

export function TrackerDataSidebar({ fillHeight = false }: { fillHeight?: boolean } = {}) {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const { patchField, patchPlayerStats, flushPatch } = useGameStatePatcher(activeChatId, "tracker-data-sidebar");
  const trackerPanelSide = useUIStore((s) => s.trackerPanelSide);
  const trackerPanelCollapsedSections = useUIStore((s) => s.trackerPanelCollapsedSections);
  const trackerPanelSectionOrder = useUIStore((s) => s.trackerPanelSectionOrder);
  const trackerPanelUseExpressionSprites = useUIStore((s) => s.trackerPanelUseExpressionSprites);
  const trackerPanelThoughtBubbleDisplay = useUIStore((s) => s.trackerPanelThoughtBubbleDisplay);
  const trackerPanelDockedThoughtsAlwaysVisible = useUIStore((s) => s.trackerPanelDockedThoughtsAlwaysVisible);
  const trackerPanelSizeProfile = useUIStore((s) => s.trackerPanelSizeProfile);
  const trackerTemperatureUnit = useUIStore((s) => s.trackerTemperatureUnit);
  const toggleTrackerPanelSectionCollapsed = useUIStore((s) => s.toggleTrackerPanelSectionCollapsed);
  const setTrackerPanelOpen = useUIStore((s) => s.setTrackerPanelOpen);
  const setTrackerPanelSide = useUIStore((s) => s.setTrackerPanelSide);
  const setTrackerPanelSizeProfile = useUIStore((s) => s.setTrackerPanelSizeProfile);
  const { currentGameState, gameStateRefreshing, isLoadingGameState } = useTrackerGameState(activeChatId);
  const {
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
  } = useTrackerPanelModel({
    activeChatId,
    trackerPanelSectionOrder,
    trackerPanelUseExpressionSprites,
  });
  const [deleteMode, setDeleteMode] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const hasFixedTrackerPanel = orderedTrackerSections.length > 0;
  const showTrackerSections = !!activeChatId && !isLoadingGameState && !!currentGameState && hasFixedTrackerPanel;

  return (
    <section
      data-component="TrackerDataSidebar"
      data-tracker-size-profile={trackerPanelSizeProfile}
      className={cn(
        "@container relative flex flex-col bg-[color-mix(in_srgb,var(--background)_8%,transparent)] backdrop-blur-sm",
        fillHeight ? "overflow-hidden" : "overflow-visible",
        fillHeight ? "h-full" : "min-h-0",
      )}
    >
      <div className="pointer-events-none absolute inset-0 z-0 opacity-[0.08] [background-image:linear-gradient(color-mix(in_srgb,var(--foreground)_12%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_srgb,var(--foreground)_9%,transparent)_1px,transparent_1px)] [background-size:8px_8px]" />
      <TrackerSidebarHeader
        trackerPanelSide={trackerPanelSide}
        sizeProfile={trackerPanelSizeProfile}
        addMode={addMode}
        deleteMode={deleteMode}
        onSetAddMode={setAddMode}
        onSetDeleteMode={setDeleteMode}
        onSetSide={setTrackerPanelSide}
        onSetSizeProfile={setTrackerPanelSizeProfile}
        onClose={() => setTrackerPanelOpen(false)}
      />

      <div className={cn("relative z-10", fillHeight && "min-h-0 flex-1 overflow-y-auto")}>
        {showTrackerSections ? (
          <TrackerSectionList
            activeChatId={activeChatId}
            activePersona={activePersona}
            autoGenerateCharacterAvatars={autoGenerateCharacterAvatars}
            characterSpriteLookup={characterSpriteLookup}
            characterTrackerConfig={characterTrackerConfig}
            characterTrackerSettings={characterTrackerSettings}
            currentGameState={currentGameState}
            enabledAgentTypes={enabledAgentTypes}
            expressionSpritesEnabled={expressionSpritesEnabled}
            featuredCharacterCardKeys={featuredCharacterCardKeys}
            flushPatch={flushPatch}
            gameStateRefreshing={gameStateRefreshing}
            orderedTrackerSections={orderedTrackerSections}
            patchField={patchField}
            patchPlayerStats={patchPlayerStats}
            resolveSpriteCharacterId={resolveSpriteCharacterId}
            spriteExpressions={spriteExpressions}
            trackerPanelCollapsedSections={trackerPanelCollapsedSections}
            trackerPanelSide={trackerPanelSide}
            trackerPanelSizeProfile={trackerPanelSizeProfile}
            trackerPanelThoughtBubbleDisplay={trackerPanelThoughtBubbleDisplay}
            trackerPanelDockedThoughtsAlwaysVisible={trackerPanelDockedThoughtsAlwaysVisible}
            trackerTemperatureUnit={trackerTemperatureUnit}
            toggleTrackerPanelSectionCollapsed={toggleTrackerPanelSectionCollapsed}
            deleteMode={deleteMode}
            addMode={addMode}
          />
        ) : null}

        {!activeChatId ? (
          <EmptySection>Select a chat to view tracker data.</EmptySection>
        ) : isLoadingGameState ? (
          <TrackerSkeleton />
        ) : !currentGameState ? (
          <EmptySection>No tracker data yet.</EmptySection>
        ) : !hasFixedTrackerPanel ? (
          <EmptySection>No enabled tracker panels.</EmptySection>
        ) : null}
      </div>
    </section>
  );
}
