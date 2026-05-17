import { X } from "lucide-react";
import type { InventoryItem } from "@marinara-engine/shared";
import { cn } from "../../../../lib/utils";
import { visibleText } from "../../lib/tracker-display";
import { InlineEdit, InlineNumber } from "../controls/InlineControls";

export function PersonaInventoryRow({
  item,
  onUpdate,
  onRemove,
  deleteMode,
  fullWidth = false,
}: {
  item: InventoryItem;
  onUpdate: (item: InventoryItem) => void;
  onRemove: () => void;
  deleteMode: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative min-w-0 rounded-[2px] border border-[var(--tracker-profile-slot-rule)] bg-[image:var(--tracker-profile-slot-surface)] px-1 py-px shadow-[inset_0_1px_2px_var(--tracker-profile-slot-shadow)] [background-blend-mode:var(--tracker-profile-slot-surface-blend)]",
        fullWidth && "col-span-full",
        deleteMode && "pr-5",
      )}
    >
      <div className="grid min-h-4 grid-cols-[minmax(0,1fr)_max-content] items-center gap-0.5">
        <InlineEdit
          value={item.name}
          onSave={(name) => onUpdate({ ...item, name: name || "Item" })}
          className="h-4 w-full min-w-0 px-0.5 py-0 text-[0.625rem] font-medium leading-4 text-[color:var(--tracker-profile-text)] hover:bg-[var(--accent)]/25"
          placeholder="Item"
          title={visibleText(item.name, "Item")}
          scrollOnHover
          showEditHint={false}
        />
        <div className="flex h-4 min-w-0 items-center justify-end">
          <InlineNumber
            value={item.quantity}
            onChange={(quantity) => onUpdate({ ...item, quantity })}
            min={0}
            className="justify-self-end px-0 text-right text-[0.625rem] leading-4 text-[color:var(--tracker-profile-number-text)] hover:bg-transparent focus:bg-transparent focus:ring-0"
            title={`${item.name} quantity`}
          />
        </div>
      </div>
      {deleteMode && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-0.5 top-1/2 flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center rounded text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10"
          title={`Remove ${item.name}`}
          aria-label={`Remove ${item.name}`}
        >
          <X size="0.65rem" />
        </button>
      )}
    </div>
  );
}
