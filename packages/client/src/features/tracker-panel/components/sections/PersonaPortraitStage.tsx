import type { Persona } from "@marinara-engine/shared";
import { cn } from "../../../../lib/utils";
import { visibleText } from "../../lib/tracker-display";
import { TRACKER_PROFILE_ORDER_CLASS_BY_SIDE, type TrackerProfileSide } from "../../lib/tracker-profile-layout";
import { getPersonaInitial } from "../../lib/tracker-profile-style";
import { TrackerPortraitStage, type TrackerPortraitStageMediaKind } from "../controls/TrackerPortraitStage";

export function PersonaPortraitStage({
  persona,
  media,
  mediaKind,
  defaultPortraitFocusY,
  portraitFocusX,
  portraitFocusY,
  portraitZoom,
  side,
  onPortraitFocusChange,
}: {
  persona: Persona | null;
  media: string | null;
  mediaKind: TrackerPortraitStageMediaKind | null;
  defaultPortraitFocusY?: number;
  portraitFocusX?: number;
  portraitFocusY?: number;
  portraitZoom?: number;
  side: TrackerProfileSide;
  onPortraitFocusChange?: (focusX: number, focusY: number, zoom: number) => void;
}) {
  const personaName = visibleText(persona?.name, "Persona");

  return (
    <TrackerPortraitStage
      accessibleLabel={media ? `${personaName} portrait art` : `${personaName} portrait placeholder`}
      className={cn("relative z-[1]", TRACKER_PROFILE_ORDER_CLASS_BY_SIDE[side])}
      view={
        onPortraitFocusChange
          ? {
              defaultY: defaultPortraitFocusY,
              onChange: onPortraitFocusChange,
              x: portraitFocusX,
              y: portraitFocusY,
              zoom: portraitZoom,
            }
          : undefined
      }
      media={media}
      mediaKind={mediaKind}
      outsideSide={side}
      frameTone="persona"
      placeholder={getPersonaInitial(persona)}
    />
  );
}
