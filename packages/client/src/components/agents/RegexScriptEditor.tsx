// ──────────────────────────────────────────────
// Full-Page Regex Script Editor
// ──────────────────────────────────────────────
import { useState, useCallback, useEffect, useMemo } from "react";
import { useUIStore } from "../../stores/ui.store";
import { showConfirmDialog } from "../../lib/app-dialogs";
import {
  useRegexScripts,
  useUpdateRegexScript,
  useCreateRegexScript,
  useDeleteRegexScript,
  type RegexScriptRow,
} from "../../hooks/use-regex-scripts";
import {
  ArrowLeft,
  Save,
  Check,
  AlertCircle,
  X,
  Trash2,
  Info,
  Regex,
  Play,
  ToggleLeft,
  ToggleRight,
  Plus,
  Minus,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";
import type { RegexPlacement } from "@marinara-engine/shared";

// ═══════════════════════════════════════════════
//  Placement metadata
// ═══════════════════════════════════════════════
const PLACEMENT_META: Record<RegexPlacement, { label: string; description: string }> = {
  ai_output: {
    label: "AI Output",
    description: "Applied to AI responses before they are displayed.",
  },
  user_input: {
    label: "User Input",
    description: "Applied to your messages before they are sent.",
  },
};

// ═══════════════════════════════════════════════
//  Main Editor
// ═══════════════════════════════════════════════
export function RegexScriptEditor() {
  const regexDetailId = useUIStore((s) => s.regexDetailId);
  const closeRegexDetail = useUIStore((s) => s.closeRegexDetail);
  const openRegexDetail = useUIStore((s) => s.openRegexDetail);

  const { data: regexScripts } = useRegexScripts();
  const updateScript = useUpdateRegexScript();
  const createScript = useCreateRegexScript();
  const deleteScript = useDeleteRegexScript();

  const isNew = regexDetailId === "__new__";

  // Find existing DB row
  const dbRow = useMemo(() => {
    if (!regexDetailId || isNew || !regexScripts) return null;
    return (regexScripts as RegexScriptRow[]).find((r) => r.id === regexDetailId) ?? null;
  }, [regexDetailId, isNew, regexScripts]);

  // ── Local editable state ──
  const [localName, setLocalName] = useState("");
  const [localEnabled, setLocalEnabled] = useState(true);
  const [localFindRegex, setLocalFindRegex] = useState("");
  const [localReplaceString, setLocalReplaceString] = useState("");
  const [localTrimStrings, setLocalTrimStrings] = useState<string[]>([]);
  const [localPlacement, setLocalPlacement] = useState<RegexPlacement[]>(["ai_output"]);
  const [localFlags, setLocalFlags] = useState("gi");
  const [localPromptOnly, setLocalPromptOnly] = useState(false);
  const [localOrder, setLocalOrder] = useState(0);
  const [localMinDepth, setLocalMinDepth] = useState<number | null>(null);
  const [localMaxDepth, setLocalMaxDepth] = useState<number | null>(null);

  const [dirty, setDirty] = useState(false);
  const setEditorDirty = useUIStore((s) => s.setEditorDirty);
  useEffect(() => {
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // ── Test area ──
  const [testInput, setTestInput] = useState("");

  // Populate from DB row or defaults for new
  useEffect(() => {
    if (!regexDetailId) return;
    if (dbRow) {
      setLocalName(dbRow.name);
      setLocalEnabled(dbRow.enabled === "true");
      setLocalFindRegex(dbRow.findRegex);
      setLocalReplaceString(dbRow.replaceString);
      try {
        setLocalTrimStrings(JSON.parse(dbRow.trimStrings));
      } catch {
        setLocalTrimStrings([]);
      }
      try {
        setLocalPlacement(JSON.parse(dbRow.placement));
      } catch {
        setLocalPlacement(["ai_output"]);
      }
      setLocalFlags(dbRow.flags);
      setLocalPromptOnly(dbRow.promptOnly === "true");
      setLocalOrder(dbRow.order);
      setLocalMinDepth(dbRow.minDepth);
      setLocalMaxDepth(dbRow.maxDepth);
    } else {
      // New script defaults
      setLocalName("New Regex Script");
      setLocalEnabled(true);
      setLocalFindRegex("");
      setLocalReplaceString("");
      setLocalTrimStrings([]);
      setLocalPlacement(["ai_output"]);
      setLocalFlags("gi");
      setLocalPromptOnly(false);
      setLocalOrder(0);
      setLocalMinDepth(null);
      setLocalMaxDepth(null);
    }
    setDirty(false);
    setSaveError(null);
    setTestInput("");
  }, [regexDetailId, dbRow]);

  // Regex validity check
  const regexError = useMemo(() => {
    if (!localFindRegex) return null;
    try {
      new RegExp(localFindRegex, localFlags);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [localFindRegex, localFlags]);

  // Test result
  const testResult = useMemo(() => {
    if (!testInput || !localFindRegex || regexError) return testInput;
    try {
      const re = new RegExp(localFindRegex, localFlags);
      let result = testInput.replace(re, localReplaceString);
      // Apply trim strings
      for (const trim of localTrimStrings) {
        if (trim) result = result.split(trim).join("");
      }
      return result;
    } catch {
      return testInput;
    }
  }, [testInput, localFindRegex, localReplaceString, localFlags, localTrimStrings, regexError]);

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowUnsavedWarning(true);
      return;
    }
    closeRegexDetail();
  }, [dirty, closeRegexDetail]);

  const handleSave = useCallback(async () => {
    if (!regexDetailId) return;
    setSaveError(null);

    const payload = {
      name: localName,
      enabled: localEnabled,
      findRegex: localFindRegex,
      replaceString: localReplaceString,
      trimStrings: localTrimStrings,
      placement: localPlacement,
      flags: localFlags,
      promptOnly: localPromptOnly,
      order: localOrder,
      minDepth: localMinDepth,
      maxDepth: localMaxDepth,
    };

    try {
      if (dbRow) {
        await updateScript.mutateAsync({ id: dbRow.id, ...payload });
      } else {
        const created = (await createScript.mutateAsync(payload)) as RegexScriptRow | undefined;
        if (created?.id) {
          openRegexDetail(created.id);
        }
      }
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save regex script");
    }
  }, [
    regexDetailId,
    localName,
    localEnabled,
    localFindRegex,
    localReplaceString,
    localTrimStrings,
    localPlacement,
    localFlags,
    localPromptOnly,
    localOrder,
    localMinDepth,
    localMaxDepth,
    dbRow,
    updateScript,
    createScript,
    openRegexDetail,
  ]);

  const markDirty = useCallback(() => setDirty(true), []);

  const handleDelete = async () => {
    if (!dbRow) return;
    if (
      !(await showConfirmDialog({
        title: "Delete Regex Script",
        message: "Delete this regex script? This cannot be undone.",
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    ) {
      return;
    }
    await deleteScript.mutateAsync(dbRow.id);
    closeRegexDetail();
  };

  const togglePlacement = (p: RegexPlacement) => {
    setLocalPlacement((prev) => {
      const has = prev.includes(p);
      if (has && prev.length <= 1) return prev; // Must have at least one
      return has ? prev.filter((x) => x !== p) : [...prev, p];
    });
    markDirty();
  };

  // ── Loading / not found ──
  if (!regexDetailId || (!dbRow && !isNew)) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">
        Regex script not found.
      </div>
    );
  }

  const isPending = updateScript.isPending || createScript.isPending;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--background)]">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <button
          type="button"
          onClick={handleClose}
          aria-label="Back to regex scripts"
          className="rounded-xl p-2 transition-all hover:bg-[var(--accent)] active:scale-95"
        >
          <ArrowLeft size="1.125rem" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-red-500 text-white shadow-sm">
          <Regex size="1.125rem" />
        </div>
        <input
          value={localName}
          onChange={(e) => {
            setLocalName(e.target.value);
            markDirty();
          }}
          className="flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-[var(--muted-foreground)]"
          placeholder="Script name…"
        />
        <div className="flex items-center gap-1.5">
          {saveError && (
            <span className="mr-2 flex items-center gap-1 text-[0.625rem] font-medium text-red-400">
              <AlertCircle size="0.6875rem" /> Save failed
            </span>
          )}
          {savedFlash && !dirty && (
            <span className="mr-2 flex items-center gap-1 text-[0.625rem] font-medium text-emerald-400">
              <Check size="0.6875rem" /> Saved
            </span>
          )}
          {dirty && !saveError && <span className="mr-2 text-[0.625rem] font-medium text-amber-400">Unsaved</span>}
          {/* Enable/Disable toggle */}
          <button
            onClick={() => {
              setLocalEnabled((e) => !e);
              markDirty();
            }}
            className="flex items-center gap-1 rounded-xl px-2 py-2 text-xs font-medium transition-all hover:bg-[var(--accent)]"
            title={localEnabled ? "Enabled" : "Disabled"}
          >
            {localEnabled ? (
              <ToggleRight size="1.125rem" className="text-emerald-400" />
            ) : (
              <ToggleLeft size="1.125rem" className="text-[var(--muted-foreground)]" />
            )}
          </button>
          {dbRow && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-[var(--destructive)] transition-all hover:bg-[var(--destructive)]/15 active:scale-[0.98]"
            >
              <Trash2 size="0.8125rem" /> Delete
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={isPending || !!regexError}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-400 to-red-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            <Save size="0.8125rem" /> Save
          </button>
        </div>
      </div>

      {/* Unsaved warning */}
      {showUnsavedWarning && (
        <div className="flex items-center justify-between bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
          <span>You have unsaved changes.</span>
          <div className="flex gap-2">
            <button
              onClick={() => setShowUnsavedWarning(false)}
              className="rounded-lg px-3 py-1 hover:bg-[var(--accent)]"
            >
              Keep editing
            </button>
            <button
              onClick={() => closeRegexDetail()}
              className="rounded-lg px-3 py-1 text-[var(--destructive)] hover:bg-[var(--destructive)]/15"
            >
              Discard
            </button>
            <button
              onClick={async () => {
                await handleSave();
                closeRegexDetail();
              }}
              className="rounded-lg bg-amber-500/20 px-3 py-1 hover:bg-amber-500/30"
            >
              Save & close
            </button>
          </div>
        </div>
      )}

      {/* Save error banner */}
      {saveError && (
        <div className="flex items-center gap-2 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          <AlertCircle size="0.8125rem" />
          <span className="flex-1">{saveError}</span>
          <button onClick={() => setSaveError(null)} className="rounded-lg px-2 py-0.5 hover:bg-red-500/20">
            <X size="0.75rem" />
          </button>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* ── Find Regex ── */}
          <FieldGroup
            label="Find Pattern (Regex)"
            icon={<Regex size="0.875rem" className="text-orange-400" />}
            help="The regular expression pattern to search for. Written without delimiters — e.g. \\*([^*]+)\\* to match text between asterisks."
          >
            <div className="relative">
              <input
                value={localFindRegex}
                onChange={(e) => {
                  setLocalFindRegex(e.target.value);
                  markDirty();
                }}
                className={cn(
                  "w-full rounded-xl bg-[var(--secondary)] px-4 py-2.5 font-mono text-sm ring-1 placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2",
                  regexError ? "ring-red-500/50 focus:ring-red-500" : "ring-[var(--border)] focus:ring-[var(--ring)]",
                )}
                placeholder="e.g. \\*([^*]+)\\*"
              />
              {regexError && <p className="mt-1 text-[0.625rem] text-red-400">{regexError}</p>}
            </div>
          </FieldGroup>

          {/* ── Replace String ── */}
          <FieldGroup
            label="Replace With"
            icon={<Info size="0.875rem" className="text-orange-400" />}
            help="The replacement string. Supports capture groups: $1, $2, etc. Leave empty to delete matched text."
          >
            <input
              value={localReplaceString}
              onChange={(e) => {
                setLocalReplaceString(e.target.value);
                markDirty();
              }}
              className="w-full rounded-xl bg-[var(--secondary)] px-4 py-2.5 font-mono text-sm ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              placeholder="e.g. $1 or leave empty to remove"
            />
          </FieldGroup>

          {/* ── Flags ── */}
          <FieldGroup
            label="Regex Flags"
            icon={<Info size="0.875rem" className="text-orange-400" />}
            help="Standard regex flags: g (global), i (case-insensitive), m (multiline), s (dotAll), u (unicode)."
          >
            <div className="flex items-center gap-2">
              {["g", "i", "m", "s", "u"].map((flag) => {
                const active = localFlags.includes(flag);
                return (
                  <button
                    key={flag}
                    onClick={() => {
                      setLocalFlags((prev) => (active ? prev.replace(flag, "") : prev + flag));
                      markDirty();
                    }}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg font-mono text-sm font-bold ring-1 transition-all",
                      active
                        ? "bg-orange-400/15 text-orange-400 ring-orange-400/50"
                        : "text-[var(--muted-foreground)] ring-[var(--border)] hover:bg-[var(--accent)]",
                    )}
                  >
                    {flag}
                  </button>
                );
              })}
            </div>
          </FieldGroup>

          {/* ── Placement ── */}
          <FieldGroup
            label="Apply To"
            icon={<Play size="0.875rem" className="text-orange-400" />}
            help="Where this regex is applied. AI Output transforms incoming responses; User Input transforms your messages before sending."
          >
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(PLACEMENT_META) as [RegexPlacement, { label: string; description: string }][]).map(
                ([placement, meta]) => {
                  const active = localPlacement.includes(placement);
                  return (
                    <button
                      key={placement}
                      onClick={() => togglePlacement(placement)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-xl p-3 text-xs ring-1 transition-all",
                        active
                          ? "bg-orange-400/10 ring-orange-400/50 text-orange-400"
                          : "ring-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                      )}
                    >
                      <span className="font-medium">{meta.label}</span>
                      <span className="text-[0.5625rem] opacity-70">{meta.description}</span>
                    </button>
                  );
                },
              )}
            </div>
          </FieldGroup>

          {/* ── Trim Strings ── */}
          <FieldGroup
            label="Trim Strings"
            icon={<Minus size="0.875rem" className="text-orange-400" />}
            help="Additional strings to remove from the result after the regex replacement. One per row."
          >
            <div className="flex flex-col gap-1.5">
              {localTrimStrings.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={s}
                    onChange={(e) => {
                      const updated = [...localTrimStrings];
                      updated[i] = e.target.value;
                      setLocalTrimStrings(updated);
                      markDirty();
                    }}
                    className="flex-1 rounded-lg bg-[var(--secondary)] px-3 py-1.5 font-mono text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    placeholder="String to trim…"
                  />
                  <button
                    onClick={() => {
                      setLocalTrimStrings((prev) => prev.filter((_, j) => j !== i));
                      markDirty();
                    }}
                    className="rounded-md p-1 text-[var(--destructive)] hover:bg-[var(--destructive)]/15"
                  >
                    <X size="0.75rem" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  setLocalTrimStrings((prev) => [...prev, ""]);
                  markDirty();
                }}
                className="flex items-center gap-1 self-start rounded-lg px-2.5 py-1.5 text-[0.625rem] font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
              >
                <Plus size="0.625rem" /> Add trim string
              </button>
            </div>
          </FieldGroup>

          {/* ── Advanced Options ── */}
          <FieldGroup
            label="Advanced Options"
            icon={<Info size="0.875rem" className="text-orange-400" />}
            help="Fine-tune when and how the regex runs."
          >
            <div className="space-y-3">
              {/* Prompt Only */}
              <label className="flex items-center gap-2.5 cursor-pointer">
                <button
                  type="button"
                  onClick={() => {
                    setLocalPromptOnly((v) => !v);
                    markDirty();
                  }}
                  className="shrink-0"
                >
                  {localPromptOnly ? (
                    <ToggleRight size="1.125rem" className="text-orange-400" />
                  ) : (
                    <ToggleLeft size="1.125rem" className="text-[var(--muted-foreground)]" />
                  )}
                </button>
                <div>
                  <div className="text-xs font-medium">Prompt Only</div>
                  <div className="text-[0.625rem] text-[var(--muted-foreground)]">
                    Only apply in the prompt context sent to the AI, not in the displayed message.
                  </div>
                </div>
              </label>

              {/* Order */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium w-24">Execution Order</span>
                <input
                  type="number"
                  value={localOrder}
                  onChange={(e) => {
                    setLocalOrder(parseInt(e.target.value) || 0);
                    markDirty();
                  }}
                  className="w-20 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
                <span className="text-[0.625rem] text-[var(--muted-foreground)]">Lower numbers run first</span>
              </div>

              {/* Depth range */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium w-24">Depth Range</span>
                <input
                  type="number"
                  value={localMinDepth ?? ""}
                  onChange={(e) => {
                    setLocalMinDepth(e.target.value ? parseInt(e.target.value) : null);
                    markDirty();
                  }}
                  className="w-16 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  placeholder="Min"
                />
                <span className="text-[0.625rem] text-[var(--muted-foreground)]">to</span>
                <input
                  type="number"
                  value={localMaxDepth ?? ""}
                  onChange={(e) => {
                    setLocalMaxDepth(e.target.value ? parseInt(e.target.value) : null);
                    markDirty();
                  }}
                  className="w-16 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  placeholder="Max"
                />
                <span className="text-[0.625rem] text-[var(--muted-foreground)]">
                  message depth (empty = unlimited)
                </span>
              </div>
            </div>
          </FieldGroup>

          {/* ── Live Test ── */}
          <FieldGroup
            label="Live Test"
            icon={<Play size="0.875rem" className="text-orange-400" />}
            help="Test your regex pattern against sample text. The result updates in real-time."
          >
            <div className="space-y-2">
              <textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                rows={3}
                className="w-full resize-y rounded-xl bg-[var(--secondary)] px-4 py-3 font-mono text-xs leading-relaxed ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                placeholder="Paste sample text to test…"
              />
              {testInput && (
                <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
                  <div className="mb-1 text-[0.625rem] font-medium text-[var(--muted-foreground)]">Result:</div>
                  <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-emerald-400">
                    {testResult}
                  </pre>
                </div>
              )}
            </div>
          </FieldGroup>

          {/* ── Info Card ── */}
          <div className="rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
            <h3 className="mb-2 text-xs font-semibold text-[var(--foreground)]">About Regex Scripts</h3>
            <div className="space-y-1.5 text-[0.6875rem] text-[var(--muted-foreground)]">
              <p>
                Regex scripts are applied to text during chat — either transforming AI responses before display, or
                modifying your input before it's sent.
              </p>
              <p>
                Scripts run in order (lowest first). Use capture groups (
                <code className="rounded bg-[var(--secondary)] px-1">$1</code>,{" "}
                <code className="rounded bg-[var(--secondary)] px-1">$2</code>) in the replacement to reference matched
                groups.
              </p>
              <p>
                <strong className="text-[var(--foreground)]">Examples:</strong>
              </p>
              <ul className="ml-4 list-disc space-y-0.5">
                <li>
                  Remove asterisks: <code className="rounded bg-[var(--secondary)] px-1">\\*([^*]+)\\*</code> →{" "}
                  <code className="rounded bg-[var(--secondary)] px-1">$1</code>
                </li>
                <li>
                  Remove OOC: <code className="rounded bg-[var(--secondary)] px-1">\\(OOC:.*?\\)</code> → (empty)
                </li>
                <li>
                  Censor words: <code className="rounded bg-[var(--secondary)] px-1">\\bbadword\\b</code> →{" "}
                  <code className="rounded bg-[var(--secondary)] px-1">***</code>
                </li>
              </ul>
              {dbRow && (
                <p className="mt-2">
                  <strong className="text-[var(--foreground)]">ID:</strong> {dbRow.id}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
//  Field Group wrapper (same pattern as AgentEditor)
// ═══════════════════════════════════════════════
function FieldGroup({
  label,
  icon,
  help,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold">{label}</span>
        {help && <HelpTooltip text={help} />}
      </div>
      {children}
    </div>
  );
}
