import type { CharacterStat } from "@marinara-engine/shared";
import {
  FEATURED_CHARACTER_PORTRAIT_STAGE_REM,
  PERSONA_ADD_STAT_DENSITY_HEIGHT_REM,
  PERSONA_STAT_DENSITY_HEIGHT_REM,
  TRACKER_PROFILE_PORTRAIT_MEDIA_STAGE_REM,
} from "./tracker-panel.constants";
import type { TrackerStatDensity, TrackerStatDisplayScale } from "../tracker-panel.types";

export function trackerStatStackHeight(statCount: number, density: TrackerStatDensity, includeAdd: boolean) {
  return (
    statCount * PERSONA_STAT_DENSITY_HEIGHT_REM[density] +
    (includeAdd ? PERSONA_ADD_STAT_DENSITY_HEIGHT_REM[density] : 0)
  );
}

export function personaStatStackHeight(statCount: number, density: TrackerStatDensity, includeAdd: boolean) {
  return trackerStatStackHeight(statCount, density, includeAdd);
}

export function getPersonaStatDensity(
  statCount: number,
  includeAdd: boolean,
  allowance = TRACKER_PROFILE_PORTRAIT_MEDIA_STAGE_REM,
): TrackerStatDensity {
  if (personaStatStackHeight(statCount, "normal", includeAdd) <= allowance) return "normal";
  if (personaStatStackHeight(statCount, "compact", includeAdd) <= allowance) return "compact";
  return "tight";
}

export function getFeaturedCharacterStatDensity(
  statCount: number,
  includeAdd: boolean,
  allowance = FEATURED_CHARACTER_PORTRAIT_STAGE_REM,
): TrackerStatDensity {
  if (trackerStatStackHeight(statCount, "normal", includeAdd) <= allowance) return "normal";
  if (trackerStatStackHeight(statCount, "compact", includeAdd) <= allowance) return "compact";
  return "tight";
}

export function getTrackerStatDisplayScale(
  statCount: number,
  density: TrackerStatDensity,
  fillAvailable: boolean,
  includeAdd: boolean,
): TrackerStatDisplayScale {
  if (!fillAvailable || density !== "normal") return "standard";
  return statCount + (includeAdd ? 1 : 0) <= 4 ? "spacious" : "roomy";
}

export function getStatPercent(stat: CharacterStat) {
  if (!Number.isFinite(stat.max) || stat.max <= 0) return 0;
  return Math.max(0, Math.min(100, (stat.value / stat.max) * 100));
}
