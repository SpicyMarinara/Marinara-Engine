import type { PresentCharacter } from "@marinara-engine/shared";
import { useCharacterSprites, type SpriteInfo } from "../../../../hooks/use-characters";
import {
  FEATURED_PORTRAIT_DEFAULT_FOCUS_X,
  FEATURED_PORTRAIT_DEFAULT_FOCUS_Y,
  TRACKER_PORTRAIT_DEFAULT_ZOOM,
  TRACKER_PORTRAIT_EXPRESSION_DEFAULT_FOCUS_Y,
  TRACKER_PORTRAIT_EXPRESSION_FOCUS_Y_MAX,
  TRACKER_PORTRAIT_MAX_ZOOM,
  TRACKER_PORTRAIT_MIN_ZOOM,
} from "../../lib/tracker-panel.constants";
import { getCharacterPortraitFallback } from "../../lib/character-tracker-data";
import { clampNumber, visibleText } from "../../lib/tracker-display";
import { getOppositeTrackerProfileSide, type TrackerProfileSide } from "../../lib/tracker-profile-layout";
import { getCharacterExpressionHint, isSpriteLookupCharacterId, resolveSpriteUrl } from "../../lib/sprite-expressions";
import { TrackerPortraitStage, type TrackerPortraitStageMediaKind } from "../controls/TrackerPortraitStage";

export function FeaturedCharacterPortrait({
  character,
  spriteCharacterId,
  spriteExpression,
  expressionSpritesEnabled,
  characterPicture,
  detailsSide,
  onUploadAvatar,
  onPortraitFocusChange,
}: {
  character: PresentCharacter;
  spriteCharacterId?: string | null;
  spriteExpression?: string;
  expressionSpritesEnabled: boolean;
  characterPicture?: string | null;
  detailsSide: TrackerProfileSide;
  onUploadAvatar?: () => void;
  onPortraitFocusChange?: (focusX: number, focusY: number, zoom: number) => void;
}) {
  const resolvedSpriteCharacterId =
    expressionSpritesEnabled && isSpriteLookupCharacterId(spriteCharacterId) ? (spriteCharacterId ?? null) : null;
  const expression = expressionSpritesEnabled ? getCharacterExpressionHint(character, spriteExpression) : null;
  const { data: sprites } = useCharacterSprites(resolvedSpriteCharacterId);
  const spriteUrl = expression ? resolveSpriteUrl(sprites as SpriteInfo[] | undefined, expression) : null;
  const media = spriteUrl ?? characterPicture ?? character.avatarPath ?? null;
  const mediaKind: TrackerPortraitStageMediaKind | null = spriteUrl ? "expression" : media ? "art" : null;
  const canUploadTrackerArt = !!onUploadAvatar && !spriteUrl && !characterPicture;
  const defaultPortraitFocusY =
    mediaKind === "expression" ? TRACKER_PORTRAIT_EXPRESSION_DEFAULT_FOCUS_Y : FEATURED_PORTRAIT_DEFAULT_FOCUS_Y;
  const portraitFocusYMax = mediaKind === "expression" ? TRACKER_PORTRAIT_EXPRESSION_FOCUS_Y_MAX : 100;
  const portraitFocusX = clampNumber(
    typeof character.portraitFocusX === "number" ? character.portraitFocusX : FEATURED_PORTRAIT_DEFAULT_FOCUS_X,
    0,
    100,
  );
  const portraitFocusY = clampNumber(
    typeof character.portraitFocusY === "number" ? character.portraitFocusY : defaultPortraitFocusY,
    0,
    portraitFocusYMax,
  );
  const portraitZoom = clampNumber(
    typeof character.portraitZoom === "number" ? character.portraitZoom : TRACKER_PORTRAIT_DEFAULT_ZOOM,
    TRACKER_PORTRAIT_MIN_ZOOM,
    TRACKER_PORTRAIT_MAX_ZOOM,
  );
  const setPortraitFocus = onPortraitFocusChange
    ? (nextFocusX: number, nextFocusY: number, nextZoom: number) =>
        onPortraitFocusChange(
          clampNumber(Math.round(nextFocusX), 0, 100),
          clampNumber(Math.round(nextFocusY), 0, portraitFocusYMax),
          Math.round(clampNumber(nextZoom, TRACKER_PORTRAIT_MIN_ZOOM, TRACKER_PORTRAIT_MAX_ZOOM) * 100) / 100,
        )
    : undefined;
  const portraitOutsideSide = getOppositeTrackerProfileSide(detailsSide);
  const characterName = visibleText(character.name, "character");

  return (
    <div className="relative min-w-0">
      <TrackerPortraitStage
        accessibleLabel={media ? `${characterName} portrait` : `${characterName} portrait placeholder`}
        media={media}
        mediaKind={mediaKind}
        outsideSide={portraitOutsideSide}
        frameTone="featured"
        placeholder={getCharacterPortraitFallback(character)}
        placeholderVariant="avatar"
        uploadAction={
          canUploadTrackerArt && onUploadAvatar
            ? {
                ariaLabel: media ? `Change ${characterName} tracker art` : `Upload ${characterName} tracker art`,
                onClick: onUploadAvatar,
                title: media ? "Change tracker art" : "Upload tracker art",
              }
            : undefined
        }
        view={
          setPortraitFocus
            ? {
                defaultY: defaultPortraitFocusY,
                onChange: setPortraitFocus,
                x: portraitFocusX,
                y: portraitFocusY,
                zoom: portraitZoom,
              }
            : undefined
        }
      />
    </div>
  );
}
