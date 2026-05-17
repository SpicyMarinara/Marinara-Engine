import type { ReactNode } from "react";
import { Users } from "lucide-react";
import type { PresentCharacter } from "@marinara-engine/shared";
import type {
  TrackerPanelSide,
  TrackerPanelSizeProfile,
  TrackerThoughtBubbleDisplay,
} from "../../../../stores/ui.store";
import { cn } from "../../../../lib/utils";
import { getCharacterFeatureKey } from "../../lib/character-tracker-data";
import { getSpriteExpressionForCharacter } from "../../lib/sprite-expressions";
import type { TrackerProfileColors } from "../../lib/tracker-profile-style";
import { AddRowButton, EmptySection, SectionHeader } from "../controls/SectionControls";
import { CharacterTrackerCard } from "../character-card/CharacterTrackerCard";

const COMPACT_CHARACTER_GHOST_SLOT_CLASS =
  "pointer-events-none relative hidden min-h-0 self-stretch overflow-hidden rounded-md border border-[color-mix(in_srgb,var(--border)_28%,transparent)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--card)_18%,transparent),color-mix(in_srgb,var(--background)_12%,transparent)_48%,transparent)] opacity-55 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_3%,transparent),inset_0_-1px_0_color-mix(in_srgb,var(--background)_18%,transparent)] @min-[260px]:block before:pointer-events-none before:absolute before:left-0 before:right-2 before:top-0.5 before:h-5 before:rounded-l-[4px] before:rounded-r-[2px] before:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_78%,var(--card)_22%),color-mix(in_srgb,var(--card)_42%,transparent))] before:opacity-65 after:pointer-events-none after:absolute after:inset-1 after:rounded-[4px] after:bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--border)_12%,transparent)_0_1px,transparent_1px_7px)] after:opacity-35";
const COMPACT_CHARACTER_CARD_SLOT_CLASS = "min-h-0 h-full";

export function CharacterTrackerPanel({
  activeChatId,
  characters,
  featuredCharacterCards,
  spriteExpressions,
  expressionSpritesEnabled,
  characterPictures,
  characterProfileColors,
  resolveSpriteCharacterId,
  trackerPanelSide,
  trackerPanelSizeProfile,
  thoughtBubbleDisplay,
  dockedThoughtsAlwaysVisible,
  onUpdateCharacter,
  onRemoveCharacter,
  onAddCharacter,
  onToggleFeatured,
  onUploadAvatar,
  deleteMode,
  addMode,
  action,
  collapsed = false,
  onToggleCollapsed,
}: {
  activeChatId: string | null;
  characters: PresentCharacter[];
  featuredCharacterCards: Set<string>;
  spriteExpressions: Record<string, string>;
  expressionSpritesEnabled: boolean;
  characterPictures: Record<string, string>;
  characterProfileColors: Record<string, TrackerProfileColors>;
  resolveSpriteCharacterId: (character: PresentCharacter) => string | null;
  trackerPanelSide: TrackerPanelSide;
  trackerPanelSizeProfile: TrackerPanelSizeProfile;
  thoughtBubbleDisplay: TrackerThoughtBubbleDisplay;
  dockedThoughtsAlwaysVisible: boolean;
  onUpdateCharacter: (index: number, character: PresentCharacter) => void;
  onRemoveCharacter: (index: number) => void;
  onAddCharacter: () => void;
  onToggleFeatured: (key: string) => void;
  onUploadAvatar: (index: number) => void;
  deleteMode: boolean;
  addMode: boolean;
  action?: ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const renderCharacterCards = () => {
    if (characters.length === 0) {
      return (
        <div className="p-1">
          <EmptySection>No characters tracked.</EmptySection>
        </div>
      );
    }

    const characterEntries = characters.map((character, index) => {
      const cardKey = getCharacterFeatureKey(character, index);
      const spriteCharacterId = resolveSpriteCharacterId(character);
      return {
        character,
        cardKey,
        spriteCharacterId,
        spriteExpression: expressionSpritesEnabled
          ? getSpriteExpressionForCharacter(spriteExpressions, character, spriteCharacterId)
          : undefined,
        characterPicture: spriteCharacterId ? characterPictures[spriteCharacterId] : undefined,
        profileColors: spriteCharacterId ? characterProfileColors[spriteCharacterId] : undefined,
        featured: featuredCharacterCards.has(cardKey),
        index,
      };
    });
    const featuredEntries = characterEntries.filter((entry) => entry.featured);
    const compactEntries = characterEntries.filter((entry) => !entry.featured);
    const renderCharacterCard = ({
      character,
      cardKey,
      spriteCharacterId,
      spriteExpression,
      characterPicture,
      profileColors,
      featured,
      index,
    }: (typeof characterEntries)[number]) => (
      <CharacterTrackerCard
        key={`${activeChatId ?? "chat"}-${character.characterId}-${index}`}
        character={character}
        spriteCharacterId={spriteCharacterId}
        spriteExpression={spriteExpression}
        expressionSpritesEnabled={expressionSpritesEnabled}
        characterPicture={characterPicture}
        profileColors={profileColors}
        trackerPanelSide={trackerPanelSide}
        trackerPanelSizeProfile={trackerPanelSizeProfile}
        thoughtBubbleDisplay={thoughtBubbleDisplay}
        dockedThoughtsAlwaysVisible={dockedThoughtsAlwaysVisible}
        onUpdate={(updated) => onUpdateCharacter(index, updated)}
        onRemove={() => onRemoveCharacter(index)}
        deleteMode={deleteMode}
        addMode={addMode}
        featured={featured}
        onToggleFeatured={() => onToggleFeatured(cardKey)}
        onUploadAvatar={() => onUploadAvatar(index)}
      />
    );
    const useCompactCardColumns = trackerPanelSizeProfile !== "compact";
    const shouldRenderCompactGhostSlot = useCompactCardColumns && compactEntries.length % 2 === 1;
    const renderCompactCharacterCard = (entry: (typeof characterEntries)[number]) => (
      <div
        key={`${activeChatId ?? "chat"}-${entry.character.characterId}-${entry.index}`}
        className={COMPACT_CHARACTER_CARD_SLOT_CLASS}
      >
        {renderCharacterCard(entry)}
      </div>
    );

    return (
      <div className="space-y-1">
        {featuredEntries.map(renderCharacterCard)}
        {compactEntries.length > 0 && (
          <div
            className={cn(
              "grid auto-rows-auto grid-cols-1 items-stretch gap-1 px-1 pb-1",
              useCompactCardColumns && "@min-[260px]:grid-cols-2",
              featuredEntries.length === 0 && "pt-1",
            )}
          >
            {compactEntries.map(renderCompactCharacterCard)}
            {shouldRenderCompactGhostSlot && <div aria-hidden="true" className={COMPACT_CHARACTER_GHOST_SLOT_CLASS} />}
          </div>
        )}
      </div>
    );
  };

  return (
    <section
      className="group/characters relative z-10 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_5%,transparent)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)]"
      aria-label="Characters"
    >
      <SectionHeader
        icon={<Users size="0.6875rem" />}
        title="Present Characters"
        action={action}
        addAction={
          addMode ? (
            <AddRowButton title="Add character" onClick={onAddCharacter} className="rounded-sm" />
          ) : undefined
        }
        collapsed={collapsed}
        onToggle={onToggleCollapsed}
      />

      {!collapsed && renderCharacterCards()}
    </section>
  );
}
