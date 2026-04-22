// ──────────────────────────────────────────────
// Panel: Presets (overhauled — search, assign, edit, duplicate)
// ──────────────────────────────────────────────
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { usePresets, useDeletePreset, useDuplicatePreset, useSetDefaultPreset } from "../../hooks/use-presets";
import { useUpdateChat, useUpdateChatMetadata } from "../../hooks/use-chats";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { api } from "../../lib/api-client";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { ChoiceSelectionModal } from "../presets/ChoiceSelectionModal";
import { Plus, Download, FileText, Trash2, Check, Copy, Search, Code2, Hash, Star } from "lucide-react";
import { cn } from "../../lib/utils";

type PresetRow = {
  id: string;
  name: string;
  description: string;
  wrapFormat?: string;
  isDefault?: string | boolean;
  author?: string;
  sectionOrder?: string | string[];
};

export function PresetsPanel() {
  const { data: presets, isLoading } = usePresets();
  const deletePreset = useDeletePreset();
  const duplicatePreset = useDuplicatePreset();
  const setDefaultPreset = useSetDefaultPreset();
  const openModal = useUIStore((s) => s.openModal);
  const openPresetDetail = useUIStore((s) => s.openPresetDetail);
  const activeChat = useChatStore((s) => s.activeChat);
  const updateChat = useUpdateChat();
  const updateMetadata = useUpdateChatMetadata();
  const [search, setSearch] = useState("");
  const [choiceModalPresetId, setChoiceModalPresetId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPresetIds, setSelectedPresetIds] = useState<Set<string>>(new Set());
  const [exportingSelected, setExportingSelected] = useState(false);

  const activePresetId = activeChat?.promptPresetId ?? null;

  const filteredPresets = useMemo(() => {
    if (!presets) return [];
    if (!search.trim()) return presets as unknown as PresetRow[];
    const q = search.toLowerCase();
    return (presets as unknown as PresetRow[]).filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.author ?? "").toLowerCase().includes(q),
    );
  }, [presets, search]);

  const selectPreset = (presetId: string) => {
    if (!activeChat) return;
    const newId = activePresetId === presetId ? null : presetId;
    // Clear stale preset choices from the previous preset before switching
    updateMetadata.mutate({ id: activeChat.id, presetChoices: {} });
    updateChat.mutate(
      { id: activeChat.id, promptPresetId: newId },
      {
        onSuccess: async () => {
          if (!newId) {
            setChoiceModalPresetId(null);
            return;
          }

          try {
            const presetFull = await api.get<{ choiceBlocks?: unknown[] }>(`/prompts/${newId}/full`);
            if ((presetFull.choiceBlocks?.length ?? 0) > 0) {
              setChoiceModalPresetId(newId);
            } else {
              setChoiceModalPresetId(null);
            }
          } catch {
            setChoiceModalPresetId(null);
          }
        },
      },
    );
  };

  const getSectionCount = (preset: PresetRow) => {
    try {
      const order = preset.sectionOrder;
      if (Array.isArray(order)) return order.length;
      return JSON.parse(order ?? "[]").length;
    } catch {
      return 0;
    }
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedPresetIds(new Set());
  };

  const toggleSelection = (presetId: string) => {
    setSelectedPresetIds((prev) => {
      const next = new Set(prev);
      if (next.has(presetId)) next.delete(presetId);
      else next.add(presetId);
      return next;
    });
  };

  const handleExportSelected = async () => {
    if (selectedPresetIds.size === 0) return;
    setExportingSelected(true);
    try {
      await api.downloadPost("/prompts/export-bulk", { ids: [...selectedPresetIds] }, "marinara-presets.zip");
      toast.success(`Exported ${selectedPresetIds.size} preset${selectedPresetIds.size === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export presets");
    } finally {
      setExportingSelected(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => openModal("create-preset")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-3 py-2.5 text-xs font-medium text-white shadow-md shadow-purple-400/15 transition-all hover:shadow-lg hover:shadow-purple-400/25 active:scale-[0.98]"
          title="New"
        >
          <Plus size="0.8125rem" /> <span className="md:hidden">New</span>
        </button>
        <button
          onClick={() => openModal("import-preset")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-xs font-medium text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] transition-all hover:bg-[var(--accent)] active:scale-[0.98]"
          title="Import"
        >
          <Download size="0.8125rem" /> <span className="md:hidden">Import</span>
        </button>
        <button
          onClick={() => {
            if (selectionMode) exitSelectionMode();
            else setSelectionMode(true);
          }}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all",
            selectionMode
              ? "bg-purple-400/15 text-purple-400 ring-1 ring-purple-400/30"
              : "bg-[var(--secondary)] text-[var(--secondary-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
          )}
          title="Select"
        >
          <Check size="0.8125rem" /> <span className="md:hidden">Select</span>
        </button>
      </div>

      {selectionMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/60 px-3 py-2">
          <span className="text-[0.6875rem] font-medium text-[var(--muted-foreground)]">
            {selectedPresetIds.size} selected
          </span>
          <button
            onClick={() => setSelectedPresetIds(new Set(filteredPresets.map((preset) => preset.id)))}
            disabled={filteredPresets.length === 0}
            className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-purple-400 transition-colors hover:bg-[var(--accent)] disabled:opacity-40"
          >
            Select visible
          </button>
          <button
            onClick={() => setSelectedPresetIds(new Set())}
            disabled={selectedPresetIds.size === 0}
            className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-40"
          >
            Clear
          </button>
          <button
            onClick={handleExportSelected}
            disabled={selectedPresetIds.size === 0 || exportingSelected}
            className="inline-flex items-center gap-1 rounded-lg bg-purple-500 px-2.5 py-1 text-[0.625rem] font-medium text-white transition-all hover:opacity-90 disabled:opacity-40"
          >
            <Download size="0.6875rem" />
            {exportingSelected ? "Exporting..." : "Export ZIP"}
          </button>
          <button
            onClick={exitSelectionMode}
            className="rounded-lg px-2.5 py-1 text-[0.625rem] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            Done
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search
          size="0.8125rem"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
        />
        <input
          type="text"
          placeholder="Search presets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl bg-[var(--secondary)] py-2 pl-8 pr-3 text-xs text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col gap-2 py-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-16 rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredPresets.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <div className="animate-float flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-400/20 to-violet-500/20">
            <FileText size="1.25rem" className="text-purple-400" />
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">{search ? "No matching presets" : "No presets yet"}</p>
        </div>
      )}

      {/* Preset list */}
      <div className="stagger-children flex flex-col gap-1">
        {filteredPresets.map((preset) => {
          const isSelected = activePresetId === preset.id;
          const isBulkSelected = selectedPresetIds.has(preset.id);
          const sectionCount = getSectionCount(preset);
          const wrapFormat = (preset.wrapFormat ?? "xml") as string;
          const isDefault = preset.isDefault === "true";

          return (
            <div
              key={preset.id}
              className={cn(
                "group relative flex cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-all hover:bg-[var(--sidebar-accent)]",
                selectionMode && isBulkSelected && "ring-1 ring-purple-400/40 bg-purple-400/10",
                isSelected && "ring-1 ring-purple-400/40 bg-purple-400/5",
              )}
            >
              {/* Click to open editor */}
              <div
                className="flex min-w-0 flex-1 items-center gap-3"
                onClick={() => {
                  if (selectionMode) toggleSelection(preset.id);
                  else openPresetDetail(preset.id);
                }}
              >
                {selectionMode && (
                  <div
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
                      isBulkSelected
                        ? "border-purple-400 bg-purple-400 text-white"
                        : "border-[var(--muted-foreground)]/40 bg-[var(--secondary)] text-transparent",
                    )}
                  >
                    <Check size="0.75rem" />
                  </div>
                )}
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-400 to-violet-500 text-white shadow-sm">
                  <FileText size="1rem" />
                  {isSelected && (
                    <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-400 shadow-sm">
                      <Check size="0.625rem" className="text-white" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{preset.name}</span>
                    {isDefault && (
                      <span className="shrink-0 rounded bg-purple-400/15 px-1 py-0.5 text-[0.5625rem] font-medium text-purple-400">
                        DEFAULT
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[0.6875rem] text-[var(--muted-foreground)]">
                    <span className="flex items-center gap-0.5">
                      {wrapFormat === "xml" ? <Code2 size="0.5625rem" /> : <Hash size="0.5625rem" />}
                      {wrapFormat.toUpperCase()}
                    </span>
                    <span>{sectionCount} sections</span>
                    {preset.author && <span className="truncate">by {preset.author}</span>}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              {!selectionMode && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--sidebar)] px-1 py-0.5 opacity-0 shadow-sm ring-1 ring-[var(--border)] transition-opacity group-hover:opacity-100 max-md:opacity-100">
                  {activeChat && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        selectPreset(preset.id);
                      }}
                      className={cn(
                        "rounded-lg p-1.5 transition-all active:scale-90",
                        isSelected
                          ? "bg-purple-400/15 text-purple-400"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--primary)]/10 hover:text-[var(--primary)]",
                      )}
                      title={isSelected ? "Unassign from chat" : "Assign to chat"}
                    >
                      <Check size="0.75rem" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDefaultPreset.mutate(preset.id);
                    }}
                    className={cn(
                      "rounded-lg p-1.5 transition-all active:scale-90",
                      isDefault
                        ? "text-yellow-500"
                        : "text-[var(--muted-foreground)] hover:bg-yellow-500/10 hover:text-yellow-500",
                    )}
                    title={isDefault ? "Default preset" : "Set as default"}
                  >
                    <Star size="0.75rem" className={isDefault ? "fill-yellow-500" : ""} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicatePreset.mutate(preset.id);
                    }}
                    className="rounded-lg p-1.5 text-[var(--muted-foreground)] transition-all hover:bg-sky-400/10 hover:text-sky-400 active:scale-90"
                    title="Duplicate"
                  >
                    <Copy size="0.75rem" />
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (
                        await showConfirmDialog({
                          title: "Delete Preset",
                          message: `Delete "${preset.name}"?`,
                          confirmLabel: "Delete",
                          tone: "destructive",
                        })
                      ) {
                        deletePreset.mutate(preset.id);
                      }
                    }}
                    className="rounded-lg p-1.5 transition-all hover:bg-[var(--destructive)]/15 active:scale-90"
                    title="Delete"
                  >
                    <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {activeChat && !selectionMode && (
        <p className="px-1 text-[0.625rem] text-[var(--muted-foreground)]/60">
          Click a preset to edit · hover → "Use" to assign to chat
        </p>
      )}

      {/* Choice selection modal */}
      {activeChat && (
        <ChoiceSelectionModal
          open={!!choiceModalPresetId}
          onClose={() => setChoiceModalPresetId(null)}
          presetId={choiceModalPresetId}
          chatId={activeChat.id}
          existingChoices={
            typeof activeChat.metadata === "string"
              ? (JSON.parse(activeChat.metadata).presetChoices ?? {})
              : ((activeChat.metadata as any)?.presetChoices ?? {})
          }
        />
      )}
    </div>
  );
}
