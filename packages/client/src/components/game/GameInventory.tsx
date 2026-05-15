// Game: Inventory Panel
import { useState, useCallback, useEffect } from "react";
import {
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Check, ChevronLeft, ChevronRight, Minus, Package, Plus, Wand2, X } from "lucide-react";
import { cn } from "../../lib/utils";

export interface InventoryItem {
  name: string;
  quantity: number;
}

interface GameInventoryProps {
  items: InventoryItem[];
  open: boolean;
  onClose: () => void;
  /** Called when the user wants to add a new item */
  onAddItem?: () => Promise<string | null> | string | null;
  /** Called when the user wants to use an item during input phase */
  onUseItem?: (itemName: string) => void;
  /** Called when the user wants to rename an item */
  onRenameItem?: (currentName: string, nextName: string) => Promise<string | null> | string | null;
  /** Called when the user wants to manually remove one unit of an item */
  onRemoveItem?: (itemName: string) => void | Promise<void>;
  /** Called when the user wants to manually add one unit of an item */
  onIncrementItem?: (itemName: string) => void | Promise<void>;
  /** Called when the user drags one item onto another to swap their positions */
  onReorderItem?: (fromIndex: number, toIndex: number) => void | Promise<void>;
  /** Whether the player can interact (input phase) */
  canInteract?: boolean;
}

const ITEMS_PER_PAGE = 20;

export function GameInventory({
  items,
  open,
  onClose,
  onAddItem,
  onUseItem,
  onRenameItem,
  onRemoveItem,
  onIncrementItem,
  onReorderItem,
  canInteract,
}: GameInventoryProps) {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const [addPending, setAddPending] = useState(false);
  const [amountPending, setAmountPending] = useState<"increment" | "decrement" | null>(null);
  const [pageIndex, setPageIndex] = useState(0);

  // Mouse: 4px distance threshold so quick clicks still select.
  // Touch: 200ms hold within 5px so swipe-to-scroll still works on mobile.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleItemClick = useCallback(
    (item: InventoryItem) => {
      if (!canInteract) {
        // Just toggle inspect
        setSelectedItem((prev) => (prev === item.name ? null : item.name));
        return;
      }
      setSelectedItem((prev) => (prev === item.name ? null : item.name));
    },
    [canInteract],
  );

  const handleUse = useCallback(
    (itemName: string) => {
      onUseItem?.(itemName);
      setSelectedItem(null);
    },
    [onUseItem],
  );

  // Clear selection if the selected item was removed
  useEffect(() => {
    if (selectedItem && !items.some((i) => i.name === selectedItem)) {
      setSelectedItem(null);
    }
  }, [items, selectedItem]);

  const selectedInventoryItem = selectedItem ? (items.find((item) => item.name === selectedItem) ?? null) : null;
  const pageCount = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const pageStart = pageIndex * ITEMS_PER_PAGE;
  const pageItems = items.slice(pageStart, pageStart + ITEMS_PER_PAGE);

  useEffect(() => {
    setRenameDraft(selectedInventoryItem?.name ?? "");
  }, [selectedInventoryItem?.name]);

  useEffect(() => {
    setPageIndex((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  useEffect(() => {
    if (!selectedItem) return;
    const selectedIndex = items.findIndex((item) => item.name === selectedItem);
    if (selectedIndex >= 0) {
      setPageIndex(Math.floor(selectedIndex / ITEMS_PER_PAGE));
    }
  }, [items, selectedItem]);

  const handleRename = useCallback(
    async (itemName: string) => {
      if (!onRenameItem) return;

      const nextName = renameDraft.trim().replace(/\s+/g, " ");
      if (!nextName || nextName === itemName.trim()) return;

      setRenamePending(true);
      try {
        const resolvedName = await onRenameItem(itemName, nextName);
        if (resolvedName) {
          setSelectedItem(resolvedName);
        }
      } finally {
        setRenamePending(false);
      }
    },
    [onRenameItem, renameDraft],
  );

  const handleAdd = useCallback(async () => {
    if (!onAddItem) return;

    setAddPending(true);
    try {
      const addedItemName = await onAddItem();
      if (addedItemName) {
        setSelectedItem(addedItemName);
        setPageIndex(Math.floor(items.length / ITEMS_PER_PAGE));
      }
    } finally {
      setAddPending(false);
    }
  }, [items.length, onAddItem]);

  const handleIncrement = useCallback(
    async (itemName: string) => {
      if (!onIncrementItem) return;

      setAmountPending("increment");
      try {
        await onIncrementItem(itemName);
      } finally {
        setAmountPending(null);
      }
    },
    [onIncrementItem],
  );

  const handleDecrement = useCallback(
    async (itemName: string) => {
      if (!onRemoveItem) return;

      setAmountPending("decrement");
      try {
        await onRemoveItem(itemName);
      } finally {
        setAmountPending(null);
      }
    },
    [onRemoveItem],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!onReorderItem) return;
      const fromIndex = event.active.data.current?.index;
      const toIndex = event.over?.data.current?.index;
      if (typeof fromIndex !== "number" || typeof toIndex !== "number") return;
      if (fromIndex === toIndex) return;
      void onReorderItem(fromIndex, toIndex);
    },
    [onReorderItem],
  );

  if (!open) return null;

  const slots: Array<InventoryItem | null> = [];
  for (let i = 0; i < ITEMS_PER_PAGE; i++) {
    slots.push(pageItems[i] ?? null);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative mx-4 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-white/10 bg-black shadow-[0_0_40px_rgba(0,0,0,0.8)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.02] px-4 py-3">
          <div className="flex items-center gap-2">
            <Package size={15} className="text-amber-400/80" />
            <h2 className="text-sm font-semibold tracking-wide text-white/90">Inventory</h2>
            <span className="rounded bg-white/8 px-1.5 py-0.5 text-[0.6rem] tabular-nums text-white/40">
              {items.length} {items.length === 1 ? "item" : "items"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
          >
            <X size={14} />
          </button>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto p-3">
          {items.length > 0 ? (
            <>
              {pageCount > 1 && (
                <div className="mb-2 flex items-center justify-between gap-2 text-[0.625rem] text-white/45">
                  <button
                    onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
                    disabled={pageIndex === 0}
                    className="flex h-6 w-6 items-center justify-center rounded border border-white/8 bg-white/[0.03] transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
                    title="Previous inventory page"
                  >
                    <ChevronLeft size={12} />
                  </button>
                  <span className="tabular-nums">
                    Page {pageIndex + 1} / {pageCount}
                  </span>
                  <button
                    onClick={() => setPageIndex((page) => Math.min(pageCount - 1, page + 1))}
                    disabled={pageIndex >= pageCount - 1}
                    className="flex h-6 w-6 items-center justify-center rounded border border-white/8 bg-white/[0.03] transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
                    title="Next inventory page"
                  >
                    <ChevronRight size={12} />
                  </button>
                </div>
              )}
              <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                <div className="grid grid-cols-5 gap-1.5">
                  {slots.map((item, i) => {
                    const globalIndex = pageStart + i;
                    return (
                      <InventorySlot
                        key={`slot-${globalIndex}`}
                        item={item}
                        globalIndex={globalIndex}
                        selected={Boolean(item && selectedItem === item.name)}
                        reorderEnabled={Boolean(onReorderItem)}
                        onClick={() => item && handleItemClick(item)}
                      />
                    );
                  })}
                </div>
              </DndContext>
            </>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center rounded border border-dashed border-white/10 bg-white/[0.02] px-4 text-center">
              <Package size={18} className="mb-2 text-white/25" />
              <div className="text-[0.75rem] font-medium text-white/55">Inventory empty</div>
              <div className="mt-1 text-[0.65rem] text-white/35">Add an item to start tracking supplies.</div>
            </div>
          )}
        </div>

        {/* Action bar */}
        {(selectedItem || onAddItem) && (
          <div className="border-t border-white/8 bg-white/[0.02] px-4 py-2.5">
            {selectedItem ? (
              <div className="mb-2 whitespace-normal break-words text-[0.7rem] font-medium text-white/60 [overflow-wrap:anywhere]">
                {selectedItem}
              </div>
            ) : (
              <div className="mb-2 text-[0.7rem] font-medium text-white/45">Add a new item, then rename it.</div>
            )}
            {onRenameItem && selectedInventoryItem && (
              <div className="mb-2.5 flex gap-1.5">
                <input
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setRenameDraft(selectedInventoryItem.name);
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleRename(selectedInventoryItem.name);
                    }
                  }}
                  disabled={renamePending}
                  className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[0.7rem] text-white/85 outline-none transition-colors focus:border-amber-400/40"
                  placeholder="Item name"
                />
                <button
                  onClick={() => void handleRename(selectedInventoryItem.name)}
                  disabled={
                    renamePending || !renameDraft.trim() || renameDraft.trim() === selectedInventoryItem.name.trim()
                  }
                  className="flex shrink-0 items-center justify-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[0.7rem] font-semibold text-amber-300 transition-colors hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Check size={12} />
                  Save
                </button>
              </div>
            )}
            <div className="flex gap-1.5">
              {onAddItem && (
                <button
                  onClick={() => void handleAdd()}
                  disabled={addPending}
                  className="flex flex-1 items-center justify-center gap-1 rounded border border-white/8 bg-white/[0.03] py-1.5 text-[0.7rem] text-white/70 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus size={12} />
                  Add
                </button>
              )}
              {selectedInventoryItem && (onRemoveItem || onIncrementItem) && (
                <div
                  className="flex h-7 shrink-0 items-center overflow-hidden rounded border border-white/8 bg-white/[0.03]"
                  aria-label={`${selectedInventoryItem.name} amount controls`}
                >
                  {onRemoveItem && (
                    <button
                      type="button"
                      onClick={() => void handleDecrement(selectedInventoryItem.name)}
                      disabled={amountPending !== null}
                      className="flex h-full w-7 items-center justify-center text-white/65 transition-colors hover:bg-white/[0.07] hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={
                        selectedInventoryItem.quantity > 1
                          ? `Decrease ${selectedInventoryItem.name} amount`
                          : `Delete ${selectedInventoryItem.name}`
                      }
                      title={selectedInventoryItem.quantity > 1 ? "Decrease amount" : "Delete item"}
                    >
                      <Minus size={12} />
                    </button>
                  )}
                  <span className="min-w-8 border-x border-white/8 px-2 text-center text-[0.7rem] font-semibold tabular-nums text-white/80">
                    {selectedInventoryItem.quantity}
                  </span>
                  {onIncrementItem && (
                    <button
                      type="button"
                      onClick={() => void handleIncrement(selectedInventoryItem.name)}
                      disabled={amountPending !== null}
                      className="flex h-full w-7 items-center justify-center text-white/65 transition-colors hover:bg-white/[0.07] hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Increase ${selectedInventoryItem.name} amount`}
                      title="Increase amount"
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </div>
              )}
              {selectedItem && canInteract && onUseItem && (
                <button
                  onClick={() => handleUse(selectedItem)}
                  className="flex flex-1 items-center justify-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 py-1.5 text-[0.7rem] font-semibold text-amber-400 transition-colors hover:bg-amber-500/15"
                >
                  <Wand2 size={12} />
                  Use
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface InventorySlotProps {
  item: InventoryItem | null;
  globalIndex: number;
  selected: boolean;
  reorderEnabled: boolean;
  onClick: () => void;
}

function InventorySlot({ item, globalIndex, selected, reorderEnabled, onClick }: InventorySlotProps) {
  const enabled = reorderEnabled && Boolean(item);
  const slotData = { index: globalIndex };
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: `slot-drag-${globalIndex}`, data: slotData, disabled: !enabled });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `slot-drop-${globalIndex}`,
    data: slotData,
    disabled: !enabled,
  });
  const setRefs = useCallback(
    (node: HTMLButtonElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  return (
    <button
      ref={setRefs}
      {...attributes}
      {...listeners}
      onClick={onClick}
      disabled={!item}
      title={item ? (item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name) : undefined}
      aria-label={item ? (item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name) : undefined}
      aria-pressed={enabled ? isDragging : undefined}
      className={cn(
        "group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded border transition-all",
        // touch-action: none lets the TouchSensor activate without browser scroll-gestures stealing the touch.
        // Scrolling the inventory panel is still possible by touching the modal background / pagination row.
        enabled && "touch-none",
        item
          ? selected
            ? "border-amber-500/50 bg-amber-500/10 shadow-[inset_0_0_12px_rgba(245,158,11,0.08)]"
            : "border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]"
          : "cursor-default border-white/5 bg-white/[0.015]",
        enabled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
        isOver && !isDragging && "border-amber-400/70 ring-2 ring-amber-400/60",
      )}
    >
      {item && (
        <>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gradient-to-b from-white/8 to-white/[0.02] text-sm font-bold text-amber-400/80 ring-1 ring-white/8">
            {item.name.charAt(0).toUpperCase()}
          </div>
          <div className="mt-1 flex min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center px-1">
            <div className="flex max-h-full min-h-0 w-full min-w-0 flex-col items-center gap-0.5 overflow-hidden max-md:overflow-y-auto max-md:overscroll-contain max-md:touch-pan-y">
              <span className="block w-full whitespace-normal break-words text-center text-[0.58rem] font-medium leading-tight text-white/80 [overflow-wrap:anywhere]">
                {item.name}
              </span>
              {item.quantity > 1 && (
                <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[0.55rem] font-semibold tabular-nums text-white/80">
                  x{item.quantity}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </button>
  );
}
