// Game: Inventory Panel
import { useState, useCallback, useEffect } from "react";
import { Check, Package, Plus, Trash2, Wand2, X } from "lucide-react";
import { cn } from "../../lib/utils";

export interface InventoryItem {
  name: string;
  description?: string;
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
  onRemoveItem?: (itemName: string) => void;
  /** Whether the player can interact (input phase) */
  canInteract?: boolean;
}

export function GameInventory({
  items,
  open,
  onClose,
  onAddItem,
  onUseItem,
  onRenameItem,
  onRemoveItem,
  canInteract,
}: GameInventoryProps) {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const [addPending, setAddPending] = useState(false);

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

  useEffect(() => {
    setRenameDraft(selectedInventoryItem?.name ?? "");
  }, [selectedInventoryItem?.name]);

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
      }
    } finally {
      setAddPending(false);
    }
  }, [onAddItem]);

  if (!open) return null;

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
            <div className="flex flex-col gap-1.5">
              {items.map((item, i) => (
                <button
                  key={`${item.name}-${i}`}
                  onClick={() => handleItemClick(item)}
                  title={item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name}
                  aria-label={item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name}
                  className={cn(
                    "group flex min-h-12 w-full items-center gap-3 rounded border px-3 py-2 text-left transition-all",
                    selectedItem === item.name
                      ? "border-amber-500/50 bg-amber-500/10 shadow-[inset_0_0_12px_rgba(245,158,11,0.08)]"
                      : "border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
                  )}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gradient-to-b from-white/8 to-white/[0.02] text-sm font-bold text-amber-400/80 ring-1 ring-white/8">
                    {item.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[0.75rem] font-medium leading-tight text-white/80">
                        {item.name}
                      </span>
                      {item.quantity > 1 && (
                        <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[0.55rem] font-semibold tabular-nums text-white/80">
                          x{item.quantity}
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="mt-0.5 line-clamp-2 text-[0.65rem] leading-snug text-white/45">
                        {item.description}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
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
              <div className="mb-2 text-[0.7rem] font-medium text-white/60">
                {selectedInventoryItem?.description || selectedItem}
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
            {onRemoveItem && selectedInventoryItem && (
              <button
                onClick={() => onRemoveItem(selectedInventoryItem.name)}
                className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-rose-500/20 bg-rose-500/10 py-1.5 text-[0.7rem] font-semibold text-rose-300 transition-colors hover:bg-rose-500/15"
              >
                <Trash2 size={12} />
                {selectedInventoryItem.quantity > 1 ? "Remove 1" : "Delete"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
