import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { PresentCharacter } from "@marinara-engine/shared";
import type {
  TrackerPanelSide,
  TrackerPanelSizeProfile,
  TrackerThoughtBubbleDisplay,
} from "../../../../stores/ui.store";
import { cn } from "../../../../lib/utils";
import {
  FEATURED_CHARACTER_PORTRAIT_ROOMY_STAGE_REM,
  FEATURED_CHARACTER_PORTRAIT_STAGE_REM,
  TRACKER_PROFILE_PORTRAIT_FRAME_STAGE_MAX_CLASS,
} from "../../lib/tracker-panel.constants";
import {
  TRACKER_PROFILE_GRID_CLASS,
  TRACKER_PROFILE_GRID_CLASS_BY_PORTRAIT_SIDE,
  TRACKER_PROFILE_DETAILS_SEAM_BORDER_CLASS_BY_SIDE,
  TRACKER_PROFILE_ORDER_CLASS_BY_SIDE,
  getOppositeTrackerProfileSide,
  getTrackerProfilePortraitSide,
} from "../../lib/tracker-profile-layout";
import { getFeaturedCharacterStatDensity, trackerStatStackHeight } from "../../lib/tracker-stat-layout";
import { getCharacterAmbienceStyle, type TrackerProfileColors } from "../../lib/tracker-profile-style";
import { InlineEdit } from "../controls/InlineControls";
import {
  TRACKER_PROFILE_BODY_BOTTOM_RULE_CLASS,
  TRACKER_PROFILE_BODY_TONE_OVERLAY_CLASS,
  TRACKER_PROFILE_CARD_FRAME_CLASS,
  TRACKER_PROFILE_MATERIAL_PANEL_CLASS,
  TRACKER_PROFILE_SURFACE_TEXTURE_CLASS,
  TRACKER_PROFILE_SURFACE_TOP_RULE_CLASS,
  TrackerProfileDisplayWash,
  TrackerProfileEdgeHighlight,
  TrackerReadabilityVeil,
} from "../controls/TrackerProfileChrome";
import { FeaturedFieldList, FeaturedStatGrid } from "./FeaturedCharacterFields";
import { FeaturedCharacterNameplate } from "./FeaturedCharacterNameplate";
import { FeaturedCharacterPortrait } from "./FeaturedCharacterPortrait";
import { ExternalThoughtBubble, InlineThoughtBubble } from "./CharacterThoughtBubbles";

const FEATURED_CARD_CLASS = cn(
  TRACKER_PROFILE_CARD_FRAME_CLASS,
  "group/character mx-1 hover:border-[var(--primary)]/30",
);
const FEATURED_COCKPIT_SHELF_CLASS = cn(
  "pointer-events-none absolute inset-x-0 top-5 z-0 h-[9rem] overflow-hidden border-b border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_42%,transparent)] shadow-[inset_0_9px_16px_color-mix(in_srgb,var(--background)_18%,transparent),inset_0_-10px_18px_color-mix(in_srgb,var(--background)_38%,transparent)] @min-[380px]:h-[10.5rem]",
  TRACKER_PROFILE_MATERIAL_PANEL_CLASS,
);
const FEATURED_REMOVE_BUTTON_CLASS =
  "rounded p-1 text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-90";
const FEATURED_PORTRAIT_COLUMN_CLASS = "relative z-[1] min-w-0 self-start";
const FEATURED_PORTRAIT_ANCHOR_CLASS = "relative min-w-0";
const FEATURED_DETAILS_COLUMN_CLASS =
  "relative z-[1] flex min-h-0 min-w-0 flex-col self-start overflow-hidden border-[color-mix(in_srgb,var(--tracker-profile-dialogue-border)_46%,transparent)]";
const FEATURED_DETAILS_FIELDS_CLASS = "relative min-h-0 flex-1 overflow-hidden";
const FEATURED_DOCKED_THOUGHT_CLASS = "mx-0 mb-0.5 mt-0 shrink-0";
const FEATURED_DOCKED_THOUGHT_SURFACE_CLASS =
  "scrollbar-hide overflow-hidden";
const FEATURED_STAT_BAND_CLASS = "order-3 col-span-full mt-0 rounded-b-[5px]";
const FEATURED_CUSTOM_FIELD_LIST_CLASS =
  "relative z-[1] mx-1 mb-1 mt-1 grid gap-px border-t border-[var(--tracker-profile-rule)] pt-0.5 text-[0.625rem]";
const FEATURED_CUSTOM_FIELD_ROW_CLASS =
  "grid min-w-0 grid-cols-[minmax(3rem,0.42fr)_minmax(0,1fr)] items-center gap-1 border-b border-[var(--tracker-profile-rule)] px-0.5 py-px last:border-b-0";

export function FeaturedCharacterTrackerCard({
  character,
  spriteCharacterId,
  spriteExpression,
  expressionSpritesEnabled,
  characterPicture,
  profileColors,
  trackerPanelSide,
  trackerPanelSizeProfile,
  thoughtBubbleDisplay,
  dockedThoughtsAlwaysVisible,
  action,
  onUpdate,
  onRemove,
  deleteMode,
  addMode,
  onToggleFeatured,
  onUploadAvatar,
}: {
  character: PresentCharacter;
  spriteCharacterId?: string | null;
  spriteExpression?: string;
  expressionSpritesEnabled: boolean;
  characterPicture?: string | null;
  profileColors?: TrackerProfileColors | null;
  trackerPanelSide: TrackerPanelSide;
  trackerPanelSizeProfile: TrackerPanelSizeProfile;
  thoughtBubbleDisplay: TrackerThoughtBubbleDisplay;
  dockedThoughtsAlwaysVisible: boolean;
  action?: ReactNode;
  onUpdate?: (character: PresentCharacter) => void;
  onRemove?: () => void;
  deleteMode: boolean;
  addMode: boolean;
  onToggleFeatured?: () => void;
  onUploadAvatar?: () => void;
}) {
  const thoughtAnchorRef = useRef<HTMLDivElement | null>(null);
  const thoughtBubbleRef = useRef<HTMLDivElement | null>(null);
  const thoughtControlRef = useRef<HTMLButtonElement | null>(null);
  const [thoughtsOpen, setThoughtsOpen] = useState(false);
  const customFields = Object.entries(character.customFields ?? {});
  const characterStats = character.stats ?? [];
  const hasEditableStatAdd = !!onUpdate && addMode;
  const featuredStatColumnHeightRem =
    trackerPanelSizeProfile === "expanded"
      ? FEATURED_CHARACTER_PORTRAIT_ROOMY_STAGE_REM
      : FEATURED_CHARACTER_PORTRAIT_STAGE_REM;
  const characterStatDensity = getFeaturedCharacterStatDensity(
    characterStats.length,
    hasEditableStatAdd,
    featuredStatColumnHeightRem,
  );
  const characterStatsOverflowPortrait =
    trackerStatStackHeight(characterStats.length, "tight", hasEditableStatAdd) > featuredStatColumnHeightRem;
  const hasDeleteAction = !!onRemove && deleteMode;
  const hasThoughtsControl = !!(character.thoughts || onUpdate);
  const hasFeaturedFields = !!(character.mood || character.appearance || character.outfit || onUpdate);
  const hasCharacterStatBlock = characterStats.length > 0 || (onUpdate && addMode);
  const useFeaturedStatColumns = characterStats.length >= 2;
  const featuredPortraitSide = getTrackerProfilePortraitSide(trackerPanelSide);
  const featuredDetailsSide = getOppositeTrackerProfileSide(featuredPortraitSide);

  const useInlineThoughtBubble = thoughtBubbleDisplay === "inline";
  const showDockedThoughts = hasThoughtsControl && useInlineThoughtBubble && (dockedThoughtsAlwaysVisible || thoughtsOpen);
  const showFloatingThoughts = hasThoughtsControl && !useInlineThoughtBubble && thoughtsOpen;
  const thoughtsVisible = showDockedThoughts || showFloatingThoughts;
  const canToggleThoughts = hasThoughtsControl && !(useInlineThoughtBubble && dockedThoughtsAlwaysVisible);

  useEffect(() => {
    if (!hasThoughtsControl) setThoughtsOpen(false);
  }, [hasThoughtsControl]);

  useEffect(() => {
    if (!thoughtsOpen || useInlineThoughtBubble || typeof document === "undefined") return;

    let queuedClose: number | undefined;
    const isInsideThoughtSurface = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      return !!(
        thoughtAnchorRef.current?.contains(target) ||
        thoughtBubbleRef.current?.contains(target) ||
        thoughtControlRef.current?.contains(target)
      );
    };
    const closeAfterCurrentBlur = () => {
      if (queuedClose !== undefined) window.clearTimeout(queuedClose);
      queuedClose = window.setTimeout(() => {
        setThoughtsOpen(false);
      }, 0);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!isInsideThoughtSurface(event.target)) closeAfterCurrentBlur();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!isInsideThoughtSurface(event.target)) setThoughtsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setThoughtsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      if (queuedClose !== undefined) window.clearTimeout(queuedClose);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [thoughtsOpen, useInlineThoughtBubble]);

  const addCharacterStat = () => {
    if (!onUpdate) return;
    onUpdate({
      ...character,
      stats: [...characterStats, { name: "New Stat", value: 0, max: 100, color: "var(--primary)" }],
    });
  };
  const updateCustomField = (oldName: string, nextName: string, nextValue: string) => {
    if (!onUpdate) return;
    const nextFields = { ...(character.customFields ?? {}) };
    const trimmedName = nextName.trim();
    if (trimmedName && trimmedName !== oldName && Object.prototype.hasOwnProperty.call(nextFields, trimmedName)) {
      return;
    }
    delete nextFields[oldName];
    if (trimmedName) nextFields[trimmedName] = nextValue;
    onUpdate({ ...character, customFields: nextFields });
  };

  return (
    <article
      data-tracker-size-profile={trackerPanelSizeProfile}
      className={FEATURED_CARD_CLASS}
      style={getCharacterAmbienceStyle(character, profileColors)}
    >
      <div className={TRACKER_PROFILE_BODY_TONE_OVERLAY_CLASS} />
      <TrackerReadabilityVeil
        strength={hasCharacterStatBlock || hasFeaturedFields || customFields.length > 0 ? "strong" : "soft"}
      />
      <TrackerProfileDisplayWash />
      <div className={TRACKER_PROFILE_BODY_BOTTOM_RULE_CLASS} />
      <TrackerProfileEdgeHighlight className="opacity-45" showBottom={false} />

      {hasDeleteAction && (
        <div className="absolute right-1 top-1 z-10">
          <button
            type="button"
            onClick={onRemove}
            className={FEATURED_REMOVE_BUTTON_CLASS}
            title="Remove character"
            aria-label={`Remove ${character.name.trim() || "character"}`}
          >
            <X size="0.6875rem" />
          </button>
        </div>
      )}

      <div
        className={cn(
          TRACKER_PROFILE_GRID_CLASS,
          hasDeleteAction && "pr-5",
          TRACKER_PROFILE_GRID_CLASS_BY_PORTRAIT_SIDE[featuredPortraitSide],
        )}
      >
        <FeaturedCharacterNameplate
          character={character}
          onUpdate={onUpdate}
          hasThoughtsControl={hasThoughtsControl}
          thoughtsOpen={thoughtsVisible}
          thoughtButtonRef={thoughtControlRef}
          thoughtControlSide={featuredPortraitSide}
          onToggleThoughts={canToggleThoughts ? () => setThoughtsOpen((open) => !open) : undefined}
          onToggleFeatured={onToggleFeatured}
          action={action}
        />
        <div aria-hidden="true" className={FEATURED_COCKPIT_SHELF_CLASS}>
          <div className={TRACKER_PROFILE_SURFACE_TEXTURE_CLASS} />
          <div className={TRACKER_PROFILE_SURFACE_TOP_RULE_CLASS} />
        </div>

        <div className={cn(FEATURED_PORTRAIT_COLUMN_CLASS, TRACKER_PROFILE_ORDER_CLASS_BY_SIDE[featuredPortraitSide])}>
          <div ref={thoughtAnchorRef} className={FEATURED_PORTRAIT_ANCHOR_CLASS}>
            <FeaturedCharacterPortrait
              character={character}
              spriteCharacterId={spriteCharacterId}
              spriteExpression={spriteExpression}
              expressionSpritesEnabled={expressionSpritesEnabled}
              characterPicture={characterPicture}
              detailsSide={featuredDetailsSide}
              onUploadAvatar={onUploadAvatar}
              onPortraitFocusChange={
                onUpdate
                  ? (portraitFocusX, portraitFocusY, portraitZoom) =>
                      onUpdate({ ...character, portraitFocusX, portraitFocusY, portraitZoom })
                  : undefined
              }
            />
          </div>
        </div>

        <div
          className={cn(
            FEATURED_DETAILS_COLUMN_CLASS,
            TRACKER_PROFILE_PORTRAIT_FRAME_STAGE_MAX_CLASS,
            TRACKER_PROFILE_ORDER_CLASS_BY_SIDE[featuredDetailsSide],
            TRACKER_PROFILE_DETAILS_SEAM_BORDER_CLASS_BY_SIDE[featuredDetailsSide],
          )}
        >
          {showDockedThoughts && (
            <InlineThoughtBubble
              bubbleRef={thoughtBubbleRef}
              value={character.thoughts}
              onSave={onUpdate ? (thoughts) => onUpdate({ ...character, thoughts: thoughts || null }) : undefined}
              className={FEATURED_DOCKED_THOUGHT_CLASS}
              surfaceClassName={FEATURED_DOCKED_THOUGHT_SURFACE_CLASS}
              tailSide={featuredPortraitSide}
              variant="featured"
            />
          )}
          <div className={FEATURED_DETAILS_FIELDS_CLASS}>
            <FeaturedFieldList
              character={character}
              onUpdate={onUpdate}
              readableRows={!showDockedThoughts}
              sizeProfile={trackerPanelSizeProfile}
            />
          </div>
        </div>

        {hasCharacterStatBlock && (
          <FeaturedStatGrid
            stats={characterStats}
            onUpdate={onUpdate ? (stats) => onUpdate({ ...character, stats }) : undefined}
            onAdd={onUpdate ? addCharacterStat : undefined}
            deleteMode={deleteMode}
            addMode={addMode}
            density={characterStatDensity}
            scrollable={characterStatsOverflowPortrait}
            wideColumns={useFeaturedStatColumns}
            className={FEATURED_STAT_BAND_CLASS}
          />
        )}
      </div>

      {showFloatingThoughts && (
        <ExternalThoughtBubble
          anchorRef={thoughtAnchorRef}
          bubbleRef={thoughtBubbleRef}
          value={character.thoughts}
          onSave={onUpdate ? (thoughts) => onUpdate({ ...character, thoughts: thoughts || null }) : undefined}
          panelSide={trackerPanelSide}
        />
      )}

      {customFields.length > 0 && (
        <div className={FEATURED_CUSTOM_FIELD_LIST_CLASS}>
          {customFields.map(([name, value]) => (
            <div key={name} className={FEATURED_CUSTOM_FIELD_ROW_CLASS}>
              {onUpdate ? (
                <InlineEdit
                  value={name}
                  onSave={(nextName) => updateCustomField(name, nextName, value)}
                  placeholder="Field"
                  className="min-w-0 px-0.5 py-0 font-medium"
                  scrollOnHover
                />
              ) : (
                <span className="truncate font-medium text-[color:var(--tracker-profile-muted-text)]">{name}</span>
              )}
              {onUpdate ? (
                <InlineEdit
                  value={value}
                  onSave={(nextValue) => updateCustomField(name, name, nextValue)}
                  placeholder="Value"
                  className="min-w-0 px-0.5 py-0"
                  scrollOnHover
                />
              ) : (
                <span className="min-w-0 truncate text-[color:var(--tracker-profile-text)]">{value}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
