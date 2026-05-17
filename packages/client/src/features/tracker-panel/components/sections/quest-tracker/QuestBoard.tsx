import type { ReactNode } from "react";
import { Target } from "lucide-react";
import type { QuestProgress } from "@marinara-engine/shared";
import type { TrackerPanelSizeProfile } from "../../../../../stores/ui.store";
import { cn } from "../../../../../lib/utils";
import { TRACKER_TEXT_ROW } from "../../../lib/tracker-panel.constants";
import { AddRowButton, SectionHeader } from "../../controls/SectionControls";
import { getQuestTextLineCount } from "./quest-layout";
import { QuestRow } from "./QuestRow";

export function QuestBoard({
  quests,
  action,
  onAddQuest,
  onUpdateQuest,
  onRemoveQuest,
  deleteMode,
  addMode,
  trackerPanelSizeProfile,
  collapsed = false,
  onToggleCollapsed,
}: {
  quests: QuestProgress[];
  action?: ReactNode;
  onAddQuest: () => void;
  onUpdateQuest: (index: number, quest: QuestProgress) => void;
  onRemoveQuest: (index: number) => void;
  deleteMode: boolean;
  addMode: boolean;
  trackerPanelSizeProfile: TrackerPanelSizeProfile;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const completedQuests = quests.filter((quest) => quest.completed).length;
  const activeQuests = quests.length - completedQuests;
  const questTextLineCount = getQuestTextLineCount(trackerPanelSizeProfile, quests.length);

  return (
    <div className="relative z-10 overflow-hidden pb-0.5">
      <SectionHeader
        icon={<Target size="0.6875rem" />}
        title="Quest Board"
        badge={`${completedQuests}/${quests.length}`}
        badgeTitle={`${completedQuests} done, ${activeQuests} active`}
        action={action}
        addAction={
          addMode ? <AddRowButton title="Add quest" onClick={onAddQuest} className="rounded-sm" /> : undefined
        }
        collapsed={collapsed}
        onToggle={onToggleCollapsed}
      />

      {!collapsed &&
        (quests.length === 0 ? (
          <div className={cn("relative px-1 py-1 text-[var(--foreground)]/35", TRACKER_TEXT_ROW)}>
            Quest board empty.
          </div>
        ) : (
          <div className="relative grid gap-0.5 pt-0.5">
            {quests.map((quest, index) => (
              <QuestRow
                key={`${quest.questEntryId}-${index}`}
                quest={quest}
                onUpdate={(updated) => onUpdateQuest(index, updated)}
                onRemove={() => onRemoveQuest(index)}
                deleteMode={deleteMode}
                addMode={addMode}
                textLineCount={questTextLineCount}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
