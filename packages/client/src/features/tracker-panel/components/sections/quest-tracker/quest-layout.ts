import type { TrackerPanelSizeProfile } from "../../../../../stores/ui.store";

export type QuestTextLineCount = 1 | 2 | 3;

export function getQuestTextLineCount(profile: TrackerPanelSizeProfile, questCount: number): QuestTextLineCount {
  if (profile === "expanded") return questCount <= 1 ? 3 : 2;
  if (profile === "standard") return 2;
  return questCount <= 1 ? 2 : 1;
}

export function getQuestTextWrapClass(lineCount: QuestTextLineCount) {
  if (lineCount === 3) return "line-clamp-3 break-words";
  if (lineCount === 2) return "line-clamp-2 break-words";
  return "truncate";
}
