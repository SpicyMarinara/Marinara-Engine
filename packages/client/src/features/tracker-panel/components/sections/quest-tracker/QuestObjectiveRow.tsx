import { CheckCircle2, Circle, X } from "lucide-react";
import type { QuestProgress } from "@marinara-engine/shared";
import { cn } from "../../../../../lib/utils";
import { visibleText } from "../../../lib/tracker-display";
import { InlineEdit } from "../../controls/InlineControls";

type QuestObjective = QuestProgress["objectives"][number];

const OBJECTIVE_ROW_CLASS =
  "relative grid min-h-4 gap-1 rounded-[2px] px-0.5 text-[0.6875rem] transition-colors hover:bg-[var(--accent)]/14";
const OBJECTIVE_ROW_WRAPPED_CLASS = "items-start py-0.5 leading-[1.15]";
const OBJECTIVE_ROW_SINGLE_LINE_CLASS = "items-center leading-4";
const OBJECTIVE_TOGGLE_BUTTON_CLASS =
  "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/10 hover:text-emerald-300";
const OBJECTIVE_EDIT_CLASS =
  "w-full min-w-0 overflow-hidden px-0.5 py-0 text-[0.6875rem] hover:bg-[var(--accent)]/20";
const OBJECTIVE_EDIT_WRAPPED_CLASS = "min-h-4 py-0.5 leading-[1.15]";
const OBJECTIVE_EDIT_SINGLE_LINE_CLASS = "h-4 leading-4";
const OBJECTIVE_REMOVE_BUTTON_CLASS =
  "flex h-4 w-4 items-center justify-center rounded-sm text-[var(--destructive)] transition-all hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] active:scale-90";

export function QuestObjectiveRow({
  objective,
  deleteMode,
  objectiveGridColumns,
  previewLineCount,
  wrapClass,
  wrapsText,
  onToggle,
  onUpdateText,
  onRemove,
}: {
  objective: QuestObjective;
  deleteMode: boolean;
  objectiveGridColumns: string;
  previewLineCount: 2 | 3 | undefined;
  wrapClass: string;
  wrapsText: boolean;
  onToggle?: () => void;
  onUpdateText?: (text: string) => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={cn(
        OBJECTIVE_ROW_CLASS,
        objectiveGridColumns,
        wrapsText ? OBJECTIVE_ROW_WRAPPED_CLASS : OBJECTIVE_ROW_SINGLE_LINE_CLASS,
      )}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            OBJECTIVE_TOGGLE_BUTTON_CLASS,
            wrapsText && "mt-px",
            objective.completed && "text-emerald-300",
          )}
          title={objective.completed ? "Mark incomplete" : "Mark complete"}
          aria-label={objective.completed ? "Mark objective incomplete" : "Mark objective complete"}
        >
          {objective.completed ? <CheckCircle2 size="0.6875rem" /> : <Circle size="0.6875rem" />}
        </button>
      ) : objective.completed ? (
        <CheckCircle2 size="0.6875rem" className={cn("shrink-0 text-emerald-300", wrapsText && "mt-0.5")} />
      ) : (
        <Circle size="0.6875rem" className={cn("shrink-0 text-[var(--muted-foreground)]", wrapsText && "mt-0.5")} />
      )}
      {onUpdateText ? (
        <InlineEdit
          value={objective.text}
          onSave={(text) => onUpdateText(text || "Objective")}
          placeholder="Objective"
          title={`Objective: ${visibleText(objective.text, "Objective")}`}
          showEditHint={false}
          previewLineCount={previewLineCount}
          editHintMode={wrapsText ? "overlay" : "inline"}
          className={cn(
            OBJECTIVE_EDIT_CLASS,
            wrapsText ? OBJECTIVE_EDIT_WRAPPED_CLASS : OBJECTIVE_EDIT_SINGLE_LINE_CLASS,
            objective.completed && "line-through opacity-60",
          )}
        />
      ) : (
        <span
          className={cn(
            "min-w-0",
            wrapsText ? cn(wrapClass, "leading-[1.15]") : "truncate",
            objective.completed ? "text-[var(--muted-foreground)] line-through" : "text-[var(--foreground)]",
          )}
        >
          {visibleText(objective.text, "Objective")}
        </span>
      )}
      {onRemove && deleteMode && (
        <button
          type="button"
          onClick={onRemove}
          className={OBJECTIVE_REMOVE_BUTTON_CLASS}
          title="Remove objective"
          aria-label="Remove objective"
        >
          <X size="0.5rem" />
        </button>
      )}
    </div>
  );
}
