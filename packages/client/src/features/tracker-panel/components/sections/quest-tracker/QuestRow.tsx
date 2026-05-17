import { CheckCircle2, Plus, Target, X } from "lucide-react";
import type { QuestProgress } from "@marinara-engine/shared";
import { cn } from "../../../../../lib/utils";
import { TRACKER_BAR } from "../../../lib/tracker-panel.constants";
import { visibleText } from "../../../lib/tracker-display";
import { InlineEdit } from "../../controls/InlineControls";
import { getQuestTextWrapClass, type QuestTextLineCount } from "./quest-layout";
import { QuestObjectiveRow } from "./QuestObjectiveRow";

const QUEST_CARD_CLASS =
  "group/quest relative mx-1 overflow-hidden rounded-sm border border-[var(--border)]/30 bg-[color-mix(in_srgb,var(--background)_22%,transparent)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)]";
const QUEST_CARD_TOP_RULE_CLASS = "pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--primary)]/16";
const QUEST_HEADER_CLASS =
  "relative grid min-h-5 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-1 px-1 py-0.5";
const QUEST_HEADER_DELETE_CLASS = "grid-cols-[1rem_minmax(0,1fr)_auto_1rem]";
const QUEST_TOGGLE_BUTTON_CLASS =
  "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/10 hover:text-emerald-300";
const QUEST_STATIC_ICON_CLASS = "flex h-4 w-4 shrink-0 items-center justify-center text-[var(--muted-foreground)]";
const QUEST_TITLE_EDIT_CLASS =
  "w-full min-w-0 overflow-hidden px-0.5 py-0 text-[0.75rem] font-semibold text-[var(--foreground)]/92 hover:bg-[var(--accent)]/20";
const QUEST_TITLE_EDIT_WRAPPED_CLASS = "min-h-5 py-0.5 leading-[1.12]";
const QUEST_TITLE_EDIT_SINGLE_LINE_CLASS = "h-5 leading-5";
const QUEST_TITLE_TEXT_CLASS = "min-w-0 text-[0.75rem] font-semibold";
const QUEST_COMPLETION_BADGE_CLASS =
  "shrink-0 rounded-sm border border-[var(--border)]/32 bg-[var(--background)]/18 px-1 py-0.5 text-[0.5625rem] font-semibold uppercase leading-none tabular-nums text-[var(--foreground)]/68";
const QUEST_REMOVE_BUTTON_CLASS =
  "flex h-4 w-4 items-center justify-center rounded-sm text-[var(--destructive)] transition-all hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-90";
const QUEST_PROGRESS_TRACK_CLASS = cn("relative mx-1 overflow-hidden bg-[var(--border)]/28", TRACKER_BAR);
const QUEST_PROGRESS_FILL_CLASS = "h-full rounded-[1px] transition-[width] duration-200";
const OBJECTIVE_LIST_CLASS = "relative mx-1 mb-0.5 mt-0.5 grid gap-px pl-4";
const OBJECTIVE_RAIL_CLASS = "pointer-events-none absolute left-[0.4375rem] top-1 w-px bg-[var(--border)]/28";
const ADD_OBJECTIVE_BUTTON_CLASS =
  "relative grid h-4 w-full grid-cols-[0.875rem_minmax(0,1fr)] items-center gap-1 rounded-[2px] px-0.5 text-left text-[0.6875rem] leading-4 text-[var(--foreground)]/35 transition-colors hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]";

export function QuestRow({
  quest,
  onUpdate,
  onRemove,
  deleteMode = false,
  addMode = false,
  textLineCount = 1,
}: {
  quest: QuestProgress;
  onUpdate?: (quest: QuestProgress) => void;
  onRemove?: () => void;
  deleteMode?: boolean;
  addMode?: boolean;
  textLineCount?: QuestTextLineCount;
}) {
  const completed = quest.objectives.filter((objective) => objective.completed).length;
  const totalObjectives = quest.objectives.length;
  const completionPercent = quest.completed ? 100 : totalObjectives > 0 ? (completed / totalObjectives) * 100 : 0;
  const completionLabel = totalObjectives > 0 ? `${completed}/${totalObjectives}` : quest.completed ? "done" : "open";
  const objectiveGridColumns = deleteMode
    ? "grid-cols-[0.875rem_minmax(0,1fr)_1rem]"
    : "grid-cols-[0.875rem_minmax(0,1fr)]";
  const questTitle = visibleText(quest.name, "Quest");
  const wrapsText = textLineCount > 1;
  const previewLineCount: 2 | 3 | undefined = textLineCount === 1 ? undefined : textLineCount;
  const wrapClass = getQuestTextWrapClass(textLineCount);
  const updateObjective = (index: number, nextText: string) => {
    if (!onUpdate) return;
    const nextObjectives = [...quest.objectives];
    nextObjectives[index] = { ...nextObjectives[index]!, text: nextText };
    onUpdate({ ...quest, objectives: nextObjectives });
  };
  const toggleObjective = (index: number) => {
    if (!onUpdate) return;
    const nextObjectives = [...quest.objectives];
    nextObjectives[index] = { ...nextObjectives[index]!, completed: !nextObjectives[index]!.completed };
    onUpdate({ ...quest, objectives: nextObjectives });
  };
  const removeObjective = (index: number) => {
    if (!onUpdate) return;
    onUpdate({ ...quest, objectives: quest.objectives.filter((_, objectiveIndex) => objectiveIndex !== index) });
  };
  const addObjective = () => {
    if (!onUpdate) return;
    onUpdate({ ...quest, objectives: [...quest.objectives, { text: "New objective", completed: false }] });
  };

  return (
    <article className={cn(QUEST_CARD_CLASS, quest.completed && "opacity-75")}>
      <div className={QUEST_CARD_TOP_RULE_CLASS} />
      <div
        className={cn(
          QUEST_HEADER_CLASS,
          deleteMode && QUEST_HEADER_DELETE_CLASS,
        )}
      >
        {onUpdate && (
          <button
            type="button"
            onClick={() => onUpdate({ ...quest, completed: !quest.completed })}
            className={cn(
              QUEST_TOGGLE_BUTTON_CLASS,
              quest.completed && "text-emerald-300",
            )}
            title={quest.completed ? "Mark incomplete" : "Mark complete"}
            aria-label={quest.completed ? "Mark quest incomplete" : "Mark quest complete"}
          >
            {quest.completed ? <CheckCircle2 size="0.75rem" /> : <Target size="0.75rem" />}
          </button>
        )}
        {!onUpdate && (
          <span className={QUEST_STATIC_ICON_CLASS}>
            {quest.completed ? <CheckCircle2 size="0.75rem" /> : <Target size="0.75rem" />}
          </span>
        )}
        {onUpdate ? (
          <InlineEdit
            value={quest.name}
            onSave={(name) => onUpdate({ ...quest, name: name || "Quest" })}
            placeholder="Quest"
            title={`Quest: ${questTitle}`}
            showEditHint={false}
            fitPreview={!wrapsText}
            previewLineCount={previewLineCount}
            editHintMode={wrapsText ? "overlay" : "inline"}
            className={cn(
              QUEST_TITLE_EDIT_CLASS,
              wrapsText ? QUEST_TITLE_EDIT_WRAPPED_CLASS : QUEST_TITLE_EDIT_SINGLE_LINE_CLASS,
              quest.completed && "line-through opacity-60",
            )}
          />
        ) : (
          <div
            className={cn(
              QUEST_TITLE_TEXT_CLASS,
              wrapsText ? cn(wrapClass, "leading-[1.12]") : "truncate",
              quest.completed && "text-[var(--muted-foreground)] line-through",
            )}
          >
            {questTitle}
          </div>
        )}
        <span className={QUEST_COMPLETION_BADGE_CLASS}>{completionLabel}</span>
        {onRemove && deleteMode && (
          <button
            type="button"
            onClick={onRemove}
            className={QUEST_REMOVE_BUTTON_CLASS}
            title="Remove quest"
            aria-label={`Remove ${visibleText(quest.name, "quest")}`}
          >
            <X size="0.625rem" />
          </button>
        )}
      </div>

      <div className={QUEST_PROGRESS_TRACK_CLASS}>
        <div
          className={cn(
            QUEST_PROGRESS_FILL_CLASS,
            quest.completed ? "bg-emerald-300/85" : "bg-[var(--primary)]/85",
          )}
          style={{ width: `${completionPercent}%` }}
        />
      </div>

      {(quest.objectives.length > 0 || (onUpdate && addMode)) && (
        <div className={OBJECTIVE_LIST_CLASS}>
          <span
            className={cn(
              OBJECTIVE_RAIL_CLASS,
              addMode ? "bottom-4" : "bottom-1",
            )}
          />
          {quest.objectives.map((objective, index) => (
            <QuestObjectiveRow
              key={`${objective.text}-${index}`}
              objective={objective}
              deleteMode={deleteMode}
              objectiveGridColumns={objectiveGridColumns}
              previewLineCount={previewLineCount}
              wrapClass={wrapClass}
              wrapsText={wrapsText}
              onToggle={onUpdate ? () => toggleObjective(index) : undefined}
              onUpdateText={onUpdate ? (text) => updateObjective(index, text) : undefined}
              onRemove={onUpdate && deleteMode ? () => removeObjective(index) : undefined}
            />
          ))}
          {onUpdate && addMode && (
            <button
              type="button"
              onClick={addObjective}
              className={ADD_OBJECTIVE_BUTTON_CLASS}
              title="Add objective"
              aria-label="Add objective"
            >
              <Plus size="0.625rem" className="justify-self-center" />
              <span className="truncate font-medium">Objective</span>
            </button>
          )}
        </div>
      )}
    </article>
  );
}
