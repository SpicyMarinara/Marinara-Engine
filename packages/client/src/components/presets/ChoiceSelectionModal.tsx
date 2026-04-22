// ──────────────────────────────────────────────
// Choice Selection Modal
// Shows when a preset with variables is assigned
// to a chat — user picks option(s) per variable.
// Supports single-select and multi-select modes.
// ──────────────────────────────────────────────
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Modal } from "../ui/Modal";
import { usePresetFull, useUpdatePreset } from "../../hooks/use-presets";
import { useUpdateChatMetadata } from "../../hooks/use-chats";
import { CheckCircle2, Circle, CheckSquare2, Square, Sparkles, ListChecks, Shuffle, Save } from "lucide-react";
import { cn } from "../../lib/utils";

interface ChoiceSelectionModalProps {
  open: boolean;
  onClose: () => void;
  presetId: string | null;
  chatId: string;
  /** Existing selections to pre-populate (variableName → value or values) */
  existingChoices?: Record<string, string | string[]>;
}

interface ChoiceOption {
  id: string;
  label: string;
  value: string;
}

interface VariableData {
  id: string;
  variableName: string;
  question: string;
  options: ChoiceOption[];
  multiSelect: boolean;
  randomPick: boolean;
}

export function ChoiceSelectionModal({
  open,
  onClose,
  presetId,
  chatId,
  existingChoices = {},
}: ChoiceSelectionModalProps) {
  const { data } = usePresetFull(presetId);
  const isLoading = !data && !!presetId;
  const updateMetadata = useUpdateChatMetadata();
  const updatePreset = useUpdatePreset();

  const [saveAsDefault, setSaveAsDefault] = useState(false);

  // Parse variables from preset data
  const variables = useMemo<VariableData[]>(() => {
    if (!data?.choiceBlocks) return [];
    return (data.choiceBlocks as any[]).map((cb: any) => {
      let opts: ChoiceOption[] = [];
      try {
        opts = typeof cb.options === "string" ? JSON.parse(cb.options) : (cb.options ?? []);
      } catch {
        /* empty */
      }
      return {
        id: cb.id,
        variableName: cb.variableName ?? cb.variable_name ?? "unknown",
        question: cb.question ?? "Choose an option",
        options: opts,
        multiSelect: cb.multiSelect === "true" || cb.multiSelect === true || cb.multi_select === "true",
        randomPick: cb.randomPick === "true" || cb.randomPick === true || cb.random_pick === "true",
      };
    });
  }, [data?.choiceBlocks]);

  // Parse saved default choices from preset
  const defaultChoices = useMemo<Record<string, string | string[]>>(() => {
    if (!data?.preset) return {};
    try {
      const raw = (data.preset as any).defaultChoices ?? (data.preset as any).default_choices;
      return typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
    } catch {
      return {};
    }
  }, [data?.preset]);

  // Base selections derived from existing choices / defaults / first option.
  // Pure derivation — no setState, no flicker on open.
  const baseSelections = useMemo<Record<string, string | string[]>>(() => {
    if (!variables.length) return {};
    const initial: Record<string, string | string[]> = {};
    for (const v of variables) {
      const existing = existingChoices[v.variableName];
      const saved = defaultChoices[v.variableName];
      if (existing !== undefined) {
        initial[v.variableName] = existing;
      } else if (saved !== undefined) {
        initial[v.variableName] = saved;
      } else if (v.multiSelect) {
        initial[v.variableName] = [];
      } else if (v.options.length > 0) {
        initial[v.variableName] = v.options[0].value;
      }
    }
    return initial;
  }, [variables, existingChoices, defaultChoices]);

  // User overrides (only written when user clicks an option).
  // Reset when modal re-opens so stale overrides don't persist.
  const [overrides, setOverrides] = useState<Record<string, string | string[]>>({});
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setOverrides({});
    }
    prevOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open || isLoading || !presetId) return;
    if (variables.length === 0) {
      onClose();
    }
  }, [open, isLoading, onClose, presetId, variables.length]);

  // Merged view: base + user overrides
  const selections = useMemo(() => ({ ...baseSelections, ...overrides }), [baseSelections, overrides]);

  const allSelected = variables.every((v) => {
    const sel = selections[v.variableName];
    if (v.multiSelect) return Array.isArray(sel) && sel.length > 0;
    return sel !== undefined && sel !== "";
  });

  const handleConfirm = useCallback(() => {
    // Save selections to chat metadata
    updateMetadata.mutate({ id: chatId, presetChoices: selections }, { onSuccess: () => onClose() });
    // Optionally save as default for this preset
    if (saveAsDefault && presetId) {
      updatePreset.mutate({ id: presetId, defaultChoices: selections });
    }
  }, [chatId, presetId, selections, saveAsDefault, updateMetadata, updatePreset, onClose]);

  // Toggle a single option in a multi-select variable
  const toggleMulti = useCallback(
    (varName: string, value: string) => {
      setOverrides((prev) => {
        const current = Array.isArray(prev[varName])
          ? (prev[varName] as string[])
          : Array.isArray(baseSelections[varName])
            ? (baseSelections[varName] as string[])
            : [];
        const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
        return { ...prev, [varName]: next };
      });
    },
    [baseSelections],
  );

  return (
    <Modal open={open} onClose={onClose} title="Configure Preset Variables" width="max-w-lg">
      {variables.length === 0 ? (
        isLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
          </div>
        ) : null
      ) : (
        <div className="space-y-4 p-4">
          <p className="text-xs text-[var(--muted-foreground)]">
            This preset has configurable variables. Select option(s) for each to customize your experience.
          </p>

          {variables.map((v) => (
            <div key={v.id} className="rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-3">
              <h4 className="mb-1 text-xs font-semibold text-[var(--foreground)]">{v.question}</h4>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[0.625rem] text-[var(--muted-foreground)]">
                  Variable: <code className="text-amber-400">{`{{${v.variableName}}}`}</code>
                </p>
                {v.multiSelect && (
                  <span className="flex items-center gap-0.5 rounded bg-purple-400/15 px-1.5 py-0.5 text-[0.5625rem] font-medium text-purple-400">
                    {v.randomPick ? (
                      <>
                        <Shuffle size="0.5625rem" /> Random pick
                      </>
                    ) : (
                      <>
                        <ListChecks size="0.5625rem" /> Multi-select
                      </>
                    )}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {v.multiSelect
                  ? // ── Multi-select: checkboxes ──
                    v.options.map((opt) => {
                      const selected = Array.isArray(selections[v.variableName])
                        ? (selections[v.variableName] as string[])
                        : [];
                      const isSelected = selected.includes(opt.value);
                      return (
                        <button
                          key={opt.id}
                          onClick={() => toggleMulti(v.variableName, opt.value)}
                          className={cn(
                            "flex w-full items-start gap-2.5 rounded-lg p-2.5 text-left transition-all",
                            isSelected ? "bg-purple-400/10 ring-1 ring-purple-400/30" : "hover:bg-[var(--accent)]",
                          )}
                        >
                          {isSelected ? (
                            <CheckSquare2 size="0.875rem" className="mt-0.5 shrink-0 text-purple-400" />
                          ) : (
                            <Square size="0.875rem" className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" />
                          )}
                          <div className="min-w-0 flex-1">
                            <span className={cn("text-xs font-medium", isSelected && "text-purple-400")}>
                              {opt.label}
                            </span>
                            {opt.value && (
                              <p className="mt-0.5 line-clamp-2 text-[0.625rem] text-[var(--muted-foreground)]">
                                {opt.value.slice(0, 150)}
                                {opt.value.length > 150 ? "…" : ""}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })
                  : // ── Single-select: radio-style ──
                    v.options.map((opt) => {
                      const isSelected = selections[v.variableName] === opt.value;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => setOverrides((prev) => ({ ...prev, [v.variableName]: opt.value }))}
                          className={cn(
                            "flex w-full items-start gap-2.5 rounded-lg p-2.5 text-left transition-all",
                            isSelected ? "bg-purple-400/10 ring-1 ring-purple-400/30" : "hover:bg-[var(--accent)]",
                          )}
                        >
                          {isSelected ? (
                            <CheckCircle2 size="0.875rem" className="mt-0.5 shrink-0 text-purple-400" />
                          ) : (
                            <Circle size="0.875rem" className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" />
                          )}
                          <div className="min-w-0 flex-1">
                            <span className={cn("text-xs font-medium", isSelected && "text-purple-400")}>
                              {opt.label}
                            </span>
                            {opt.value && (
                              <p className="mt-0.5 line-clamp-2 text-[0.625rem] text-[var(--muted-foreground)]">
                                {opt.value.slice(0, 150)}
                                {opt.value.length > 150 ? "…" : ""}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between gap-2 pt-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-[0.6875rem] text-[var(--muted-foreground)]">
              <button
                type="button"
                role="switch"
                aria-checked={saveAsDefault}
                onClick={() => setSaveAsDefault((v) => !v)}
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${saveAsDefault ? "bg-purple-500" : "bg-[var(--border)]"}`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${saveAsDefault ? "translate-x-3.5" : "translate-x-0.5"}`}
                />
              </button>
              <Save size="0.75rem" />
              Save as default
            </label>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
              >
                Skip
              </button>
              <button
                onClick={handleConfirm}
                disabled={!allSelected || updateMetadata.isPending}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-400 to-violet-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
              >
                <Sparkles size="0.8125rem" />
                {updateMetadata.isPending ? "Saving…" : "Confirm Choices"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
