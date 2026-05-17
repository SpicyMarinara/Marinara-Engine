import type { TrackerDataPanelSection } from "../../stores/ui.store";
import type { TrackerProfileColors } from "./lib/tracker-profile-style";

export type TrackerPanelSection = TrackerDataPanelSection;
export type TrackerStatDensity = "normal" | "compact" | "tight";
export type TrackerStatDisplayScale = "standard" | "roomy" | "spacious";

export interface TrackerSpriteLookup {
  knownIds: Set<string>;
  idByName: Map<string, string>;
  pictureById: Record<string, string>;
  profileColorsById: Record<string, TrackerProfileColors>;
}
