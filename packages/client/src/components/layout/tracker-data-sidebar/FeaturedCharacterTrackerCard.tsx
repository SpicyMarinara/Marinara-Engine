import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  HeartPulse,
  ImagePlus,
  Minimize2,
  Shirt,
  X,
} from "lucide-react";
import type { CharacterStat, PresentCharacter } from "@marinara-engine/shared";
import type { TrackerPanelSide } from "../../../stores/ui.store";
import { useCharacterSprites, type SpriteInfo } from "../../../hooks/use-characters";
import { cn } from "../../../lib/utils";
import {
  FEATURED_CHARACTER_PORTRAIT_ROOMY_STAGE_REM,
  FEATURED_CHARACTER_PORTRAIT_STAGE_REM,
  FEATURED_CHARACTER_ROOMY_WIDTH,
  FEATURED_PORTRAIT_DEFAULT_FOCUS_X,
  FEATURED_PORTRAIT_DEFAULT_FOCUS_Y,
  FEATURED_PORTRAIT_FOCUS_STEP,
  TRACKER_SPLIT_WIDTH,
  type TrackerStatDensity,
} from "./tracker-data-sidebar.constants";
import {
  clampNumber,
  getCharacterAmbienceStyle,
  getCharacterExpressionHint,
  getCharacterPortraitFallback,
  getFeaturedCharacterStatDensity,
  isSpriteLookupCharacterId,
  resolveSpriteUrl,
  trackerStatStackHeight,
  visibleText,
  type TrackerProfileColors,
} from "./tracker-data-sidebar.helpers";
import {
  FittedText,
  InlineEdit,
  TrackerProfileDisplayWash,
  TrackerProfileEdgeHighlight,
  TrackerReadabilityVeil,
  TrackerPortraitStageBackdrop,
} from "./tracker-data-sidebar.controls";
import { StatList } from "./tracker-data-sidebar.stats";
import { ExternalThoughtBubble, InlineThoughtBubble } from "./CharacterThoughtBubbles";

function FeaturedCharacterPortrait({
  character,
  spriteCharacterId,
  spriteExpression,
  expressionSpritesEnabled,
  characterPicture,
  thoughtControlSide = "left",
  headerAttachmentSide,
  thoughtsOpen = false,
  onSaveMood,
  onToggleThoughts,
  onUploadAvatar,
  onPortraitFocusChange,
}: {
  character: PresentCharacter;
  spriteCharacterId?: string | null;
  spriteExpression?: string;
  expressionSpritesEnabled: boolean;
  characterPicture?: string | null;
  thoughtControlSide?: "left" | "right";
  headerAttachmentSide?: "left" | "right";
  thoughtsOpen?: boolean;
  onSaveMood?: (value: string) => void;
  onToggleThoughts?: () => void;
  onUploadAvatar?: () => void;
  onPortraitFocusChange?: (focusX: number, focusY: number) => void;
}) {
  const resolvedSpriteCharacterId =
    expressionSpritesEnabled && isSpriteLookupCharacterId(spriteCharacterId) ? (spriteCharacterId ?? null) : null;
  const expression = expressionSpritesEnabled ? getCharacterExpressionHint(character, spriteExpression) : null;
  const { data: sprites } = useCharacterSprites(resolvedSpriteCharacterId);
  const spriteUrl = expression ? resolveSpriteUrl(sprites as SpriteInfo[] | undefined, expression) : null;
  const media = spriteUrl ?? characterPicture ?? character.avatarPath ?? null;
  const usingAdjustablePortrait = !spriteUrl && !!media;
  const portraitFocusX = clampNumber(
    typeof character.portraitFocusX === "number" ? character.portraitFocusX : FEATURED_PORTRAIT_DEFAULT_FOCUS_X,
    0,
    100,
  );
  const portraitFocusY = clampNumber(
    typeof character.portraitFocusY === "number" ? character.portraitFocusY : FEATURED_PORTRAIT_DEFAULT_FOCUS_Y,
    0,
    100,
  );
  const setPortraitFocus = onPortraitFocusChange
    ? (nextFocusX: number, nextFocusY: number) =>
        onPortraitFocusChange(clampNumber(Math.round(nextFocusX), 0, 100), clampNumber(Math.round(nextFocusY), 0, 100))
    : undefined;
  const thoughtButtonLabel = thoughtsOpen ? "Stop reading thoughts" : "Read thoughts";
  const brainButton = onToggleThoughts ? (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggleThoughts();
      }}
      title={thoughtButtonLabel}
      aria-label={thoughtButtonLabel}
      aria-expanded={thoughtsOpen}
      className={cn(
        "relative z-[1] flex h-5 min-h-5 w-full items-center justify-center bg-transparent text-[var(--tracker-profile-display-solid)]/72 transition-all hover:bg-[var(--primary)]/12 hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--primary)] active:scale-95",
        thoughtControlSide === "left"
          ? "border-r border-[var(--tracker-profile-rule)]"
          : "border-l border-[var(--tracker-profile-rule)]",
        thoughtsOpen && "bg-[var(--primary)]/16 text-[var(--primary)]",
      )}
    >
      <Brain size="0.6875rem" />
    </button>
  ) : null;

  return (
    <div className="relative min-w-0">
      <div
        className={cn(
          "relative z-[2] grid min-h-5 overflow-hidden rounded-t-md border border-b-0 border-[var(--tracker-profile-rule)] bg-[image:var(--tracker-profile-panel)] text-[0.625rem] text-[var(--muted-foreground)] [background-blend-mode:var(--tracker-profile-panel-blend)]",
          headerAttachmentSide === "left" && "rounded-tl-none",
          headerAttachmentSide === "right" && "rounded-tr-none",
          brainButton
            ? thoughtControlSide === "left"
              ? "grid-cols-[1.2rem_minmax(0,1fr)]"
              : "grid-cols-[minmax(0,1fr)_1.2rem]"
            : "grid-cols-1",
        )}
      >
        <TrackerProfileDisplayWash />
        {thoughtControlSide === "left" && brainButton}
        <div className="relative z-[1] grid min-w-0 grid-cols-[0.8rem_minmax(0,1fr)] items-center gap-0.5 px-1 py-0.5">
          <HeartPulse size="0.625rem" className="shrink-0 text-[var(--primary)]/76" />
          {onSaveMood ? (
            <InlineEdit
              value={character.mood ?? ""}
              onSave={onSaveMood}
              placeholder="Mood"
              className="h-4 min-w-0 overflow-hidden px-0 py-0 text-[0.625rem] font-semibold leading-4 text-[color-mix(in_srgb,var(--foreground)_82%,var(--primary)_18%)] hover:bg-[var(--accent)]/20"
              showEditHint={false}
            />
          ) : (
            <span className="truncate font-semibold text-[color-mix(in_srgb,var(--foreground)_82%,var(--primary)_18%)]">
              {visibleText(character.mood, "Mood")}
            </span>
          )}
        </div>
        {thoughtControlSide === "right" && brainButton}
        <TrackerProfileEdgeHighlight />
      </div>
      <div
        className={cn(
          "group/portrait relative flex h-[7.75rem] min-h-[7.75rem] w-full min-w-0 items-end justify-center overflow-hidden rounded-b-md rounded-t-none bg-[var(--background)]/18 text-left shadow-[0_0_10px_var(--tracker-profile-dialogue-glow),inset_0_-14px_22px_color-mix(in_srgb,var(--background)_58%,transparent)] ring-1 ring-[var(--tracker-profile-dialogue-border)] transition-all @min-[380px]:h-[9.25rem] @min-[380px]:min-h-[9.25rem]",
          onUploadAvatar && "hover:ring-[var(--primary)]/45",
          !onUploadAvatar && "cursor-default",
        )}
      >
        <TrackerPortraitStageBackdrop media={media} />
        <div
          className={cn(
            "pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--tracker-profile-accent)_16%,transparent)_0%,transparent_42%,color-mix(in_srgb,var(--background)_55%,transparent)_100%)]",
            spriteUrl ? "opacity-95" : "opacity-80",
          )}
        />
        {media ? (
          <img
            src={media}
            alt=""
            className={cn(
              "z-[1]",
              spriteUrl &&
                "relative h-full w-full object-contain object-bottom drop-shadow-[0_8px_14px_rgba(0,0,0,0.38)]",
              usingAdjustablePortrait && "absolute inset-0 h-full w-full max-h-none object-cover",
            )}
            style={usingAdjustablePortrait ? { objectPosition: `${portraitFocusX}% ${portraitFocusY}%` } : undefined}
            draggable={false}
          />
        ) : (
          <div className="relative z-[1] flex h-full w-full items-center justify-center px-2 py-3">
            <div className="pointer-events-none absolute inset-x-3 bottom-2 h-px bg-[color-mix(in_srgb,var(--tracker-profile-rule)_42%,transparent)]" />
            <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-[var(--tracker-profile-dialogue-border)] bg-[color-mix(in_srgb,var(--background)_54%,var(--card)_42%,transparent)] text-lg font-semibold leading-none text-[var(--tracker-profile-icon)] shadow-[0_8px_18px_rgba(0,0,0,0.24),0_0_10px_var(--tracker-profile-dialogue-glow),inset_0_1px_0_color-mix(in_srgb,var(--foreground)_8%,transparent)]">
              <span className="translate-y-px">{getCharacterPortraitFallback(character)}</span>
              {onUploadAvatar && (
                <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--tracker-profile-dialogue-border)] bg-[color-mix(in_srgb,var(--background)_82%,var(--primary)_18%)] text-[var(--tracker-profile-icon)] shadow-[0_4px_10px_rgba(0,0,0,0.28)]">
                  <ImagePlus size="0.6875rem" />
                </span>
              )}
            </div>
          </div>
        )}
        {usingAdjustablePortrait && setPortraitFocus && (
          <div className="absolute left-1 top-1 z-[2] grid grid-cols-2 gap-0.5 opacity-0 transition-opacity group-hover/portrait:opacity-100 group-focus-within/portrait:opacity-100">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setPortraitFocus(portraitFocusX, portraitFocusY - FEATURED_PORTRAIT_FOCUS_STEP);
              }}
              title="Move portrait up"
              aria-label="Move portrait up"
              className="col-span-2 mx-auto flex h-5 w-5 items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tracker-profile-rule)_70%,transparent)] bg-[color-mix(in_srgb,var(--background)_62%,transparent)] text-[var(--tracker-profile-icon)] backdrop-blur-sm transition-colors hover:bg-[var(--primary)]/14 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-90"
            >
              <ChevronUp size="0.75rem" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setPortraitFocus(portraitFocusX - FEATURED_PORTRAIT_FOCUS_STEP, portraitFocusY);
              }}
              title="Move portrait left"
              aria-label="Move portrait left"
              className="flex h-5 w-5 items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tracker-profile-rule)_70%,transparent)] bg-[color-mix(in_srgb,var(--background)_62%,transparent)] text-[var(--tracker-profile-icon)] backdrop-blur-sm transition-colors hover:bg-[var(--primary)]/14 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-90"
            >
              <ChevronLeft size="0.75rem" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setPortraitFocus(portraitFocusX + FEATURED_PORTRAIT_FOCUS_STEP, portraitFocusY);
              }}
              title="Move portrait right"
              aria-label="Move portrait right"
              className="flex h-5 w-5 items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tracker-profile-rule)_70%,transparent)] bg-[color-mix(in_srgb,var(--background)_62%,transparent)] text-[var(--tracker-profile-icon)] backdrop-blur-sm transition-colors hover:bg-[var(--primary)]/14 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-90"
            >
              <ChevronRight size="0.75rem" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setPortraitFocus(portraitFocusX, portraitFocusY + FEATURED_PORTRAIT_FOCUS_STEP);
              }}
              title="Move portrait down"
              aria-label="Move portrait down"
              className="col-span-2 mx-auto flex h-5 w-5 items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tracker-profile-rule)_70%,transparent)] bg-[color-mix(in_srgb,var(--background)_62%,transparent)] text-[var(--tracker-profile-icon)] backdrop-blur-sm transition-colors hover:bg-[var(--primary)]/14 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-90"
            >
              <ChevronDown size="0.75rem" />
            </button>
          </div>
        )}
        {onUploadAvatar && (
          <>
            <button
              type="button"
              onClick={onUploadAvatar}
              title={media ? "Change avatar" : "Upload avatar"}
              aria-label={
                media
                  ? `Change ${visibleText(character.name, "character")} avatar`
                  : `Upload ${visibleText(character.name, "character")} avatar`
              }
              className="absolute inset-0 z-[1] cursor-pointer rounded-b-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--primary)] active:scale-[0.99]"
            />
            <span className="pointer-events-none absolute right-1 top-1 z-[3] flex h-5 w-5 items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tracker-profile-rule)_70%,transparent)] bg-[color-mix(in_srgb,var(--background)_52%,transparent)] text-[var(--muted-foreground)]/70 opacity-0 backdrop-blur-sm transition-opacity group-hover/portrait:opacity-100 group-focus-within/portrait:opacity-100">
              <ImagePlus size="0.6875rem" />
            </span>
          </>
        )}
      </div>
    </div>
  );
}

type FeaturedFieldFillMode = "spacious" | "balanced";

function FeaturedFieldTile({
  icon,
  accessibleLabel,
  value,
  placeholder,
  onSave,
  stacked = false,
  fillAvailable = false,
  fillMode = "spacious",
}: {
  icon: ReactNode;
  accessibleLabel: string;
  value: string | null | undefined;
  placeholder: string;
  onSave?: (value: string) => void;
  stacked?: boolean;
  fillAvailable?: boolean;
  fillMode?: FeaturedFieldFillMode;
}) {
  const displayValue = visibleText(value, placeholder);
  const balancedFill = fillAvailable && fillMode === "balanced";

  return (
    <div
      className={cn(
        fillAvailable
          ? cn(
              "grid min-h-0 min-w-0 items-center gap-1 overflow-hidden rounded-sm border border-[var(--tracker-profile-rule)] bg-[image:var(--tracker-profile-muted-panel)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_6%,transparent)] [background-blend-mode:var(--tracker-profile-muted-panel-blend)]",
              balancedFill
                ? "grid-cols-[1.25rem_minmax(0,1fr)] px-1 py-1"
                : "grid-cols-[1.5rem_minmax(0,1fr)] px-1.5 py-1.5",
            )
          : "grid min-h-5 min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-1 border-b border-[var(--tracker-profile-rule)] px-0.5 py-0.5 last:border-b-0",
        !fillAvailable && !stacked && "@min-[220px]:border-b-0",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center text-[var(--tracker-profile-icon)]/78",
          fillAvailable
            ? balancedFill
              ? "h-4 w-4 rounded-sm bg-[var(--primary)]/8"
              : "h-5 w-5 rounded-sm bg-[var(--primary)]/8"
            : "h-4 w-4",
        )}
        aria-label={accessibleLabel}
        title={accessibleLabel}
      >
        {icon}
      </span>
      {onSave ? (
        <InlineEdit
          value={value ?? ""}
          onSave={onSave}
          placeholder={placeholder}
          className={cn(
            "w-full min-w-0 px-0 py-0 text-[color:var(--tracker-profile-text)] hover:bg-[var(--accent)]/25",
            fillAvailable
              ? balancedFill
                ? "min-h-5 text-[0.625rem] leading-[1.08]"
                : "min-h-8 text-[0.6875rem] leading-[1.15]"
              : "h-4 text-[0.625rem] leading-4",
          )}
          editHintMode={fillAvailable ? "overlay" : "inline"}
          scrollOnHover={!fillAvailable}
          twoLinePreview={fillAvailable}
        />
      ) : (
        <span
          className={cn(
            "text-[color:var(--tracker-profile-text)]",
            fillAvailable
              ? balancedFill
                ? "line-clamp-2 min-h-5 break-words text-[0.625rem] leading-[1.08]"
                : "line-clamp-2 min-h-8 break-words text-[0.6875rem] leading-[1.15]"
              : "block truncate text-[0.625rem]",
          )}
        >
          {displayValue}
        </span>
      )}
    </div>
  );
}

function FeaturedFieldList({
  character,
  onUpdate,
  placement = "footer",
  fillAvailable = false,
  fillMode = "spacious",
}: {
  character: PresentCharacter;
  onUpdate?: (character: PresentCharacter) => void;
  placement?: "inline" | "footer";
  fillAvailable?: boolean;
  fillMode?: FeaturedFieldFillMode;
}) {
  const showAppearance = !!(character.appearance || onUpdate);
  const showOutfit = !!(character.outfit || onUpdate);
  if (!showAppearance && !showOutfit) return null;

  const stacked = placement === "inline";
  const filled = stacked && fillAvailable;
  const balancedFill = filled && fillMode === "balanced";

  return (
    <div
      className={cn(
        "relative z-[1] grid border-t border-[var(--tracker-profile-rule)]",
        filled
          ? cn(
              "mt-1 min-h-0 flex-1 auto-rows-fr grid-cols-1 gap-1 overflow-hidden px-1",
              balancedFill ? "py-0.5" : "py-1",
            )
          : stacked
            ? "mt-1 grid-cols-1"
            : "mx-1 mb-1 mt-1 @min-[220px]:grid-cols-2",
      )}
    >
      {showAppearance && (
        <FeaturedFieldTile
          icon={<Eye size="0.75rem" />}
          accessibleLabel="Look"
          value={character.appearance}
          placeholder="Appearance"
          onSave={onUpdate ? (appearance) => onUpdate({ ...character, appearance: appearance || null }) : undefined}
          stacked={stacked}
          fillAvailable={filled}
          fillMode={fillMode}
        />
      )}
      {showOutfit && (
        <FeaturedFieldTile
          icon={<Shirt size="0.75rem" />}
          accessibleLabel="Outfit"
          value={character.outfit}
          placeholder="Outfit"
          onSave={onUpdate ? (outfit) => onUpdate({ ...character, outfit: outfit || null }) : undefined}
          stacked={stacked}
          fillAvailable={filled}
          fillMode={fillMode}
        />
      )}
    </div>
  );
}

function FeaturedStatGrid({
  stats,
  onUpdate,
  onAdd,
  deleteMode,
  addMode,
  density,
  fillAvailable,
  displayRoomy = false,
  scrollable,
  wideColumns = false,
}: {
  stats: CharacterStat[];
  onUpdate?: (stats: CharacterStat[]) => void;
  onAdd?: () => void;
  deleteMode: boolean;
  addMode: boolean;
  density: TrackerStatDensity;
  fillAvailable: boolean;
  displayRoomy?: boolean;
  scrollable: boolean;
  wideColumns?: boolean;
}) {
  return (
    <div
      className={cn(
        "group/statbox relative flex min-h-0 flex-col overflow-x-hidden border-t border-[var(--tracker-profile-rule)] px-1 max-h-[7.75rem] @min-[380px]:max-h-[9.25rem]",
        fillAvailable && "h-[7.75rem] @min-[380px]:h-[9.25rem]",
        scrollable ? "overflow-y-auto" : "overflow-y-hidden",
      )}
    >
      <StatList
        stats={stats}
        onUpdate={onUpdate}
        onAdd={onAdd}
        deleteMode={deleteMode}
        addMode={addMode}
        nameMode="truncate"
        density={density}
        fillAvailable={fillAvailable}
        displayRoomy={displayRoomy}
        wideColumns={wideColumns}
      />
    </div>
  );
}

export function FeaturedCharacterTrackerCard({
  character,
  spriteCharacterId,
  spriteExpression,
  expressionSpritesEnabled,
  characterPicture,
  profileColors,
  trackerPanelSide,
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
  action?: ReactNode;
  onUpdate?: (character: PresentCharacter) => void;
  onRemove?: () => void;
  deleteMode: boolean;
  addMode: boolean;
  onToggleFeatured?: () => void;
  onUploadAvatar?: () => void;
}) {
  const thoughtAnchorRef = useRef<HTMLDivElement | null>(null);
  const statCoreRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const [thoughtsOpen, setThoughtsOpen] = useState(false);
  const [fieldsInStatColumn, setFieldsInStatColumn] = useState(false);
  const [isNarrowCard, setIsNarrowCard] = useState(false);
  const [isRoomyCard, setIsRoomyCard] = useState(false);
  const customFields = Object.entries(character.customFields ?? {});
  const characterStats = character.stats ?? [];
  const hasEditableStatAdd = !!onUpdate && addMode;
  const featuredPortraitStageRem = isRoomyCard
    ? FEATURED_CHARACTER_PORTRAIT_ROOMY_STAGE_REM
    : FEATURED_CHARACTER_PORTRAIT_STAGE_REM;
  const characterStatDensity = getFeaturedCharacterStatDensity(
    characterStats.length,
    hasEditableStatAdd,
    featuredPortraitStageRem,
  );
  const characterStatsOverflowPortrait =
    trackerStatStackHeight(characterStats.length, "tight", hasEditableStatAdd) > featuredPortraitStageRem;
  const hasDeleteAction = !!onRemove && deleteMode;
  const hasThoughtsControl = !!(character.thoughts || onUpdate);
  const hasFeaturedFields = !!(character.appearance || character.outfit || onUpdate);
  const hasCharacterStatBlock = characterStats.length > 0 || (onUpdate && addMode);
  const useWideCharacterStatColumns = characterStats.length >= 4;
  const displayRoomyCharacterStats =
    isRoomyCard && hasFeaturedFields && useWideCharacterStatColumns && !characterStatsOverflowPortrait;
  const fillCharacterStats =
    !characterStatsOverflowPortrait &&
    characterStats.length >= 3 &&
    !(isRoomyCard && hasFeaturedFields && useWideCharacterStatColumns);
  const featuredFieldCount = (character.appearance || onUpdate ? 1 : 0) + (character.outfit || onUpdate ? 1 : 0);
  const shouldFillFeaturedFields =
    !hasCharacterStatBlock || (isRoomyCard && useWideCharacterStatColumns && !characterStatsOverflowPortrait);
  const canPromoteWideCharacterFields =
    hasFeaturedFields && shouldFillFeaturedFields && useWideCharacterStatColumns && isRoomyCard && !isNarrowCard;
  const showFieldsInStatColumn =
    hasFeaturedFields &&
    !isNarrowCard &&
    (!hasCharacterStatBlock || fieldsInStatColumn || canPromoteWideCharacterFields);
  const fillFeaturedFields = showFieldsInStatColumn && shouldFillFeaturedFields && !isNarrowCard;
  const featuredFieldFillMode: FeaturedFieldFillMode = hasCharacterStatBlock ? "balanced" : "spacious";
  const hasHeaderControls = !!(action || onToggleFeatured);
  const hasPairedHeaderControls = !!(action && onToggleFeatured);
  useLayoutEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const updateWidth = () => {
      const width = node.getBoundingClientRect().width;
      const nextIsNarrowCard = width < TRACKER_SPLIT_WIDTH;
      const nextIsRoomyCard = width >= FEATURED_CHARACTER_ROOMY_WIDTH;
      setIsNarrowCard((previous) => (previous === nextIsNarrowCard ? previous : nextIsNarrowCard));
      setIsRoomyCard((previous) => (previous === nextIsRoomyCard ? previous : nextIsRoomyCard));
    };
    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, []);

  const useInlineThoughtBubble = isNarrowCard;

  useEffect(() => {
    if (!hasThoughtsControl) setThoughtsOpen(false);
  }, [hasThoughtsControl]);

  useLayoutEffect(() => {
    if (!hasFeaturedFields || featuredFieldCount === 0 || typeof window === "undefined") {
      setFieldsInStatColumn((previous) => (previous ? false : previous));
      return;
    }

    const updatePlacement = () => {
      const portraitNode = thoughtAnchorRef.current;
      const statCoreNode = statCoreRef.current;
      if (!portraitNode || !statCoreNode || isNarrowCard) {
        setFieldsInStatColumn((previous) => (previous ? false : previous));
        return;
      }

      const availableHeight = portraitNode.getBoundingClientRect().height - statCoreNode.getBoundingClientRect().height;
      const requiredHeight = featuredFieldCount * 20 + 10;
      const nextFieldsInStatColumn = availableHeight >= requiredHeight;
      setFieldsInStatColumn((previous) => (previous === nextFieldsInStatColumn ? previous : nextFieldsInStatColumn));
    };

    updatePlacement();
    const resizeObserver = new ResizeObserver(updatePlacement);
    if (thoughtAnchorRef.current) resizeObserver.observe(thoughtAnchorRef.current);
    if (statCoreRef.current) resizeObserver.observe(statCoreRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [
    character.appearance,
    character.outfit,
    characterStatDensity,
    characterStats.length,
    addMode,
    displayRoomyCharacterStats,
    featuredFieldCount,
    fillCharacterStats,
    hasFeaturedFields,
    isNarrowCard,
    shouldFillFeaturedFields,
    canPromoteWideCharacterFields,
  ]);

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
      ref={cardRef}
      className="group/character relative min-w-0 overflow-hidden rounded-md border border-[var(--tracker-profile-rule)] bg-[image:var(--tracker-profile-frame)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_10%,transparent)] transition-colors duration-200 hover:border-[var(--primary)]/34 [background-blend-mode:var(--tracker-profile-frame-blend)] @min-[380px]:mx-1"
      style={getCharacterAmbienceStyle(character, profileColors)}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--tracker-profile-accent)_10%,transparent)_0%,transparent_34%,color-mix(in_srgb,var(--background)_22%,transparent)_100%)]" />
      <TrackerProfileDisplayWash />
      <TrackerReadabilityVeil strength={hasCharacterStatBlock || customFields.length > 0 ? "strong" : "soft"} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[image:var(--tracker-profile-display-layer)] opacity-45" />
      <TrackerProfileEdgeHighlight />

      {hasDeleteAction && (
        <div className="absolute right-1 top-1 z-10">
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-90"
            title="Remove character"
          >
            <X size="0.6875rem" />
          </button>
        </div>
      )}

      <div
        className={cn(
          "relative z-[1] grid gap-y-1 gap-x-0",
          hasDeleteAction && "pr-5",
          trackerPanelSide === "left"
            ? "grid-cols-[minmax(0,1fr)_clamp(5.25rem,38cqw,6.75rem)] @min-[380px]:grid-cols-[minmax(0,1fr)_9.25rem]"
            : "grid-cols-[clamp(5.25rem,38cqw,6.75rem)_minmax(0,1fr)] @min-[380px]:grid-cols-[9.25rem_minmax(0,1fr)]",
        )}
      >
        <div
          ref={thoughtAnchorRef}
          className={cn("relative min-w-0 self-start space-y-1", trackerPanelSide === "left" && "order-2")}
        >
          <FeaturedCharacterPortrait
            character={character}
            spriteCharacterId={spriteCharacterId}
            spriteExpression={spriteExpression}
            expressionSpritesEnabled={expressionSpritesEnabled}
            characterPicture={characterPicture}
            thoughtControlSide={trackerPanelSide === "left" ? "right" : "left"}
            headerAttachmentSide={trackerPanelSide === "left" ? "left" : "right"}
            thoughtsOpen={thoughtsOpen}
            onSaveMood={onUpdate ? (mood) => onUpdate({ ...character, mood }) : undefined}
            onToggleThoughts={hasThoughtsControl ? () => setThoughtsOpen((open) => !open) : undefined}
            onUploadAvatar={onUploadAvatar}
            onPortraitFocusChange={
              onUpdate
                ? (portraitFocusX, portraitFocusY) => onUpdate({ ...character, portraitFocusX, portraitFocusY })
                : undefined
            }
          />
        </div>

        <div
          className={cn(
            "relative flex min-w-0 flex-col gap-1 h-full",
            fillFeaturedFields &&
              "h-[9rem] max-h-[9rem] overflow-hidden @min-[380px]:h-[10.5rem] @min-[380px]:max-h-[10.5rem]",
            trackerPanelSide === "left" && "order-1",
          )}
        >
          <div ref={statCoreRef} className="relative flex min-w-0 flex-col gap-0">
            <div
              className={cn(
                "relative min-h-5 overflow-hidden rounded-t-md border border-[var(--tracker-profile-rule)] bg-[image:var(--tracker-profile-panel-strong)] px-1 py-0 [background-blend-mode:var(--tracker-profile-panel-strong-blend)]",
                trackerPanelSide === "left" ? "rounded-tr-none border-r-0" : "rounded-tl-none border-l-0",
                hasHeaderControls &&
                  (trackerPanelSide === "left"
                    ? hasPairedHeaderControls
                      ? "pl-10 @min-[380px]:pr-10"
                      : "pl-5 @min-[380px]:pr-5"
                    : hasPairedHeaderControls
                      ? "pr-10 @min-[380px]:pl-10"
                      : "pr-5 @min-[380px]:pl-5"),
              )}
            >
              <TrackerProfileDisplayWash />
              <TrackerProfileEdgeHighlight strength="strong" />
              {hasHeaderControls && (
                <div
                  className={cn(
                    "absolute inset-y-0 z-20 flex items-center gap-0.5 opacity-75 transition-opacity focus-within:opacity-100 hover:opacity-100",
                    trackerPanelSide === "left" ? "left-0.5" : "right-0.5",
                  )}
                >
                  {onToggleFeatured && (
                    <button
                      type="button"
                      onClick={onToggleFeatured}
                      title="Use compact character card"
                      aria-label="Use compact character card"
                      aria-pressed
                      className="flex h-4 w-4 items-center justify-center rounded-sm text-[var(--muted-foreground)]/45 opacity-70 transition-all hover:bg-[var(--primary)]/6 hover:text-[var(--tracker-profile-display-solid)]/70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]/55 focus-visible:opacity-100 active:scale-95"
                    >
                      <Minimize2 size="0.6875rem" />
                    </button>
                  )}
                  {action}
                </div>
              )}
              {onUpdate ? (
                <InlineEdit
                  value={character.name}
                  onSave={(name) => onUpdate({ ...character, name: name || "Character" })}
                  placeholder="Character"
                  className="relative z-[1] h-5 w-full min-w-0 overflow-hidden px-0 py-0 text-[0.75rem] font-semibold leading-5 text-[color:var(--tracker-profile-text)] @min-[340px]:text-[0.875rem] @min-[340px]:font-bold @min-[380px]:justify-center @min-[380px]:text-center"
                  showEditHint={false}
                  fitPreview
                  fitAlign="center"
                  fitMinScale={0.6}
                />
              ) : (
                <FittedText
                  className="relative z-[1] w-full text-[0.75rem] font-semibold leading-5 text-[color:var(--tracker-profile-text)] @min-[340px]:text-[0.875rem] @min-[340px]:font-bold"
                  title={visibleText(character.name, "Character")}
                  align="center"
                  minScale={0.6}
                >
                  {visibleText(character.name, "Character")}
                </FittedText>
              )}
            </div>

            {hasCharacterStatBlock && (
              <FeaturedStatGrid
                stats={characterStats}
                onUpdate={onUpdate ? (stats) => onUpdate({ ...character, stats }) : undefined}
                onAdd={onUpdate ? addCharacterStat : undefined}
                deleteMode={deleteMode}
                addMode={addMode}
                density={characterStatDensity}
                fillAvailable={fillCharacterStats}
                displayRoomy={displayRoomyCharacterStats}
                scrollable={characterStatsOverflowPortrait}
                wideColumns={useWideCharacterStatColumns}
              />
            )}
          </div>

          {showFieldsInStatColumn && (
            <FeaturedFieldList
              character={character}
              onUpdate={onUpdate}
              placement="inline"
              fillAvailable={fillFeaturedFields}
              fillMode={featuredFieldFillMode}
            />
          )}
        </div>
      </div>

      {hasThoughtsControl && thoughtsOpen && useInlineThoughtBubble && (
        <InlineThoughtBubble
          value={character.thoughts}
          onSave={onUpdate ? (thoughts) => onUpdate({ ...character, thoughts: thoughts || null }) : undefined}
        />
      )}

      {hasThoughtsControl && thoughtsOpen && !useInlineThoughtBubble && (
        <ExternalThoughtBubble
          anchorRef={thoughtAnchorRef}
          value={character.thoughts}
          onSave={onUpdate ? (thoughts) => onUpdate({ ...character, thoughts: thoughts || null }) : undefined}
          panelSide={trackerPanelSide}
        />
      )}

      {!showFieldsInStatColumn && <FeaturedFieldList character={character} onUpdate={onUpdate} placement="footer" />}

      {customFields.length > 0 && (
        <div className="relative z-[1] mx-1 mb-1 mt-1 grid gap-px border-t border-[var(--tracker-profile-rule)] pt-0.5 text-[0.625rem]">
          {customFields.map(([name, value]) => (
            <div
              key={name}
              className="grid min-w-0 grid-cols-[minmax(3rem,0.42fr)_minmax(0,1fr)] items-center gap-1 border-b border-[var(--tracker-profile-rule)] px-0.5 py-px last:border-b-0"
            >
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
