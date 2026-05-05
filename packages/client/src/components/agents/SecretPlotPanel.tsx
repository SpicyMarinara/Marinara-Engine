// Secret Plot memory editor: read/write agent memory used for prompt injection.
// Shown in the roleplay Agents menu on the opt-in Secret plot tab.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, RefreshCw, Save } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Message } from "@marinara-engine/shared";
import { api } from "../../lib/api-client";
import { cn } from "../../lib/utils";
import { useGenerate } from "../../hooks/use-generate";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { HelpTooltip } from "../ui/HelpTooltip";

const AGENT_TYPE = "secret-plot-driver";
const SECRET_PLOT_HELP =
  "Hidden story memory used before replies. Turn guidance can be re-run without replacing the long-term arc.";

function findLastAssistant(messages: Message[] | undefined): Message | null {
  if (!messages?.length) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") return messages[i]!;
  }
  return null;
}

type SceneDir = { direction: string; fulfilled?: boolean };

function normalizeSceneDirections(raw: unknown): SceneDir[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as { direction?: unknown; fulfilled?: unknown };
    if (typeof candidate.direction !== "string") return [];
    return [{ direction: candidate.direction, fulfilled: candidate.fulfilled === true }];
  });
}

function normalizeFulfilledDirections(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

function memoryToDraft(mem: Record<string, unknown>) {
  const arcRaw = mem.overarchingArc as Record<string, unknown> | string | undefined;
  let arcDescription = "";
  let arcProtagonist = "";
  let arcCompleted = false;
  if (arcRaw != null) {
    if (typeof arcRaw === "object") {
      arcDescription = String(arcRaw.description ?? "");
      arcProtagonist = String(arcRaw.protagonistArc ?? "");
      arcCompleted = arcRaw.completed === true;
    } else {
      arcDescription = String(arcRaw);
    }
  }
  const dirs = normalizeSceneDirections(mem.sceneDirections);
  const staleDetected = mem.staleDetected === true;
  const fulfilled = normalizeFulfilledDirections(mem.recentlyFulfilled);
  return {
    arcDescription,
    arcProtagonist,
    arcCompleted,
    sceneDirections: dirs.map((d) => ({
      direction: d.direction ?? "",
      fulfilled: !!d.fulfilled,
    })),
    staleDetected,
    recentlyFulfilledText: fulfilled.join("\n"),
  };
}

type SecretPlotDraft = ReturnType<typeof memoryToDraft>;

function draftFingerprint(draft: SecretPlotDraft): string {
  return JSON.stringify(draft);
}

export function SecretPlotPanel({
  chatId,
  messages,
  isAgentProcessing,
  isGenerationBusy = isAgentProcessing,
}: {
  chatId: string | null;
  messages: Message[] | undefined;
  isAgentProcessing: boolean;
  isGenerationBusy?: boolean;
}) {
  const qc = useQueryClient();
  const { retryAgents } = useGenerate();
  const [open, setOpen] = useState(true);
  const [rerollingMode, setRerollingMode] = useState<"full" | "turn_only" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showTurnState, setShowTurnState] = useState(true);
  const [showArcState, setShowArcState] = useState(false);
  const [draft, setDraft] = useState<SecretPlotDraft>(() => memoryToDraft({}));
  const [savedFingerprint, setSavedFingerprint] = useState(() => draftFingerprint(memoryToDraft({})));

  const queryKey = useMemo(() => ["agent-memory", AGENT_TYPE, chatId ?? ""] as const, [chatId]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    enabled: !!chatId,
    queryFn: async () => {
      const res = await api.get<{ agentConfigId: string; memory: Record<string, unknown> }>(
        `/agents/memory/${AGENT_TYPE}/${chatId}`,
      );
      return res;
    },
  });

  const target = useMemo(() => findLastAssistant(messages), [messages]);
  const draftSignature = useMemo(() => draftFingerprint(draft), [draft]);
  const hasUnsavedChanges = draftSignature !== savedFingerprint;
  const hasArcMemory = !!(draft.arcDescription.trim() || draft.arcProtagonist.trim());
  const saveLabel =
    saved && !hasUnsavedChanges
      ? "Secret plot state saved"
      : hasUnsavedChanges
        ? "Save secret plot changes"
        : "Save secret plot state";

  useEffect(() => {
    if (!data?.memory) return;
    const nextDraft = memoryToDraft(data.memory);
    setDraft(nextDraft);
    setSavedFingerprint(draftFingerprint(nextDraft));
    setSaved(false);
  }, [data?.memory, data?.agentConfigId]);

  const patchMemory = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!chatId) return;
      await api.patch<{ memory: Record<string, unknown> }>(`/agents/memory/${AGENT_TYPE}/${chatId}`, { patch });
      await qc.invalidateQueries({ queryKey });
    },
    [chatId, qc, queryKey],
  );

  const handleSave = useCallback(async () => {
    if (!chatId || saving) return;
    setSaving(true);
    try {
      const overarchingArc =
        draft.arcDescription.trim() || draft.arcProtagonist.trim() || draft.arcCompleted
          ? {
              description: draft.arcDescription.trim() || undefined,
              protagonistArc: draft.arcProtagonist.trim() || undefined,
              completed: draft.arcCompleted,
            }
          : null;
      const sceneDirections = draft.sceneDirections
        .filter((d) => d.direction.trim())
        .map((d) => ({ direction: d.direction.trim(), fulfilled: d.fulfilled }));
      const recentlyFulfilled = draft.recentlyFulfilledText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      await patchMemory({
        ...(overarchingArc ? { overarchingArc } : { overarchingArc: null }),
        sceneDirections,
        staleDetected: draft.staleDetected,
        recentlyFulfilled,
      });
      setSavedFingerprint(draftFingerprint(draft));
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }, [chatId, draft, patchMemory, saving]);

  const handleReroll = useCallback(
    async (mode: "full" | "turn_only") => {
      if (!chatId || !target || isGenerationBusy || rerollingMode) return;
      if (mode === "full") {
        const ok = await showConfirmDialog({
          title: "Re-run Arc Memory",
          message:
            "Replace the current Secret Plot arc and scene directions? This will rewrite the hidden long-term plot structure for this chat.",
          confirmLabel: "Re-run Arc",
          cancelLabel: "Keep Current Arc",
          tone: "destructive",
        });
        if (!ok) return;
      }
      setRerollingMode(mode);
      try {
        await retryAgents(chatId, [AGENT_TYPE], { forMessageId: target.id, secretPlotRerollMode: mode });
        await qc.invalidateQueries({ queryKey });
        await refetch();
      } finally {
        setRerollingMode(null);
      }
    },
    [chatId, target, isGenerationBusy, rerollingMode, retryAgents, qc, queryKey, refetch],
  );

  if (!chatId) return null;
  const turnRerollBusy = isGenerationBusy || rerollingMode === "turn_only";
  const fullRerollBusy = isGenerationBusy || rerollingMode === "full";

  return (
    <div className="bg-[var(--popover)]/35 text-[var(--popover-foreground)]">
      <div className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[0.625rem]">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="group flex min-h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-[var(--accent)]/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] max-md:min-h-7"
          aria-expanded={open}
        >
          <ChevronDown
            size="0.75rem"
            className={cn("shrink-0 text-[var(--primary)] transition-transform", open && "rotate-180")}
          />
          <span className="min-w-0 truncate font-semibold text-[var(--popover-foreground)]/75 group-hover:text-[var(--popover-foreground)]">
            Story guidance
          </span>
          {hasUnsavedChanges && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" title="Unsaved edit" />
          )}
        </button>
        <span className="flex shrink-0 items-center gap-1.5">
          <HelpTooltip
            text={SECRET_PLOT_HELP}
            wide
            side="left"
            size="0.75rem"
            className="text-[var(--muted-foreground)]"
          />
          <button
            type="button"
            disabled={saving || isAgentProcessing}
            onClick={handleSave}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-40 max-md:h-7 max-md:w-7"
            title={saveLabel}
            aria-label={saveLabel}
          >
            {saved && !hasUnsavedChanges ? (
              <Check size="0.625rem" />
            ) : (
              <Save size="0.625rem" className={saving ? "animate-pulse" : ""} />
            )}
          </button>
        </span>
      </div>

      {open && (
        <div className="border-t border-[var(--border)] px-2 pb-2 pt-1.5">
          {isLoading && (
            <p className="py-3 text-center text-[0.625rem] text-[var(--muted-foreground)]">Loading plot state...</p>
          )}
          {isError && (
            <p className="rounded-lg border border-[var(--destructive)]/25 bg-[var(--destructive)]/10 px-3 py-2 text-center text-[0.625rem] text-[var(--destructive)]">
              Could not load agent memory.
            </p>
          )}

          {!isLoading && (
            <div className="space-y-1.5 text-[0.625rem]">
              <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]/55">
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setShowTurnState((value) => !value)}
                    className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
                    title={showTurnState ? "Collapse direction" : "Expand direction"}
                    aria-expanded={showTurnState}
                  >
                    <ChevronDown
                      size="0.75rem"
                      className={cn(
                        "shrink-0 text-[var(--primary)] transition-transform",
                        showTurnState ? "rotate-180" : "-rotate-90",
                      )}
                    />
                    <span className="truncate text-[0.625rem] font-semibold text-[var(--popover-foreground)]">
                      Scene direction
                    </span>
                    {draft.staleDetected && (
                      <span className="rounded bg-[var(--secondary)]/55 px-1 py-0.5 text-[0.5rem] text-[var(--muted-foreground)]">
                        Motion
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={isGenerationBusy || !!rerollingMode || !target}
                    onClick={() => handleReroll("turn_only")}
                    title={
                      target
                        ? "Re-run scene directions for this turn but keep the current arc"
                        : "No assistant message yet"
                    }
                    aria-label="Re-run scene directions"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/55 hover:text-[var(--accent-foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-40 max-md:h-7 max-md:w-7"
                  >
                    <RefreshCw size="0.625rem" className={cn(turnRerollBusy && "animate-spin")} />
                  </button>
                </div>

                {showTurnState && (
                  <div className="space-y-1.5 border-t border-[var(--border)] px-1.5 py-1.5">
                    {draft.sceneDirections.length === 0 && (
                      <p className="rounded-md border border-[var(--border)] bg-[var(--secondary)]/35 px-2 py-1.5 text-[0.5625rem] text-[var(--muted-foreground)]">
                        No direction currently set.
                      </p>
                    )}
                    {draft.sceneDirections.map((row, idx) => (
                      <div
                        key={idx}
                        className="rounded-md border border-[var(--border)]/60 bg-[var(--secondary)]/30 p-1"
                      >
                        {(draft.sceneDirections.length > 1 || row.fulfilled) && (
                          <div className="mb-1 flex items-center justify-between gap-2 px-1 text-[0.5rem] text-[var(--muted-foreground)]">
                            <span>Direction {idx + 1}</span>
                            <label className="flex shrink-0 items-center gap-1">
                              <input
                                type="checkbox"
                                checked={row.fulfilled}
                                onChange={(e) => {
                                  const next = [...draft.sceneDirections];
                                  next[idx] = { ...next[idx]!, fulfilled: e.target.checked };
                                  setSaved(false);
                                  setDraft((current) => ({ ...current, sceneDirections: next }));
                                }}
                                className="h-2.5 w-2.5 rounded border-[var(--input)] accent-[var(--primary)]"
                              />
                              Fulfilled
                            </label>
                          </div>
                        )}
                        <textarea
                          value={row.direction}
                          onChange={(e) => {
                            const next = [...draft.sceneDirections];
                            next[idx] = { ...next[idx]!, direction: e.target.value };
                            setSaved(false);
                            setDraft((current) => ({ ...current, sceneDirections: next }));
                          }}
                          placeholder="Direction..."
                          rows={2}
                          spellCheck={false}
                          className="min-h-12 w-full resize-y rounded-md border border-[var(--input)] bg-[var(--secondary)]/45 px-2 py-1.5 font-mono text-[0.625rem] leading-relaxed text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]"
                        />
                      </div>
                    ))}
                    <label className="flex min-h-6 items-center justify-between gap-2 rounded-md border border-[var(--border)]/60 bg-[var(--secondary)]/25 px-2 py-1 text-[0.5625rem] text-[var(--muted-foreground)]">
                      <span>Needs momentum shift</span>
                      <input
                        type="checkbox"
                        checked={draft.staleDetected}
                        onChange={(e) => {
                          setSaved(false);
                          setDraft((current) => ({ ...current, staleDetected: e.target.checked }));
                        }}
                        className="h-3 w-3 rounded border-[var(--input)] accent-[var(--primary)]"
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]/55">
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setShowArcState((value) => !value)}
                    className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
                    title={showArcState ? "Collapse arc memory" : "Expand arc memory"}
                    aria-expanded={showArcState}
                  >
                    <ChevronDown
                      size="0.75rem"
                      className={cn(
                        "shrink-0 text-[var(--primary)] transition-transform",
                        showArcState ? "rotate-180" : "-rotate-90",
                      )}
                    />
                    <span className="truncate text-[0.625rem] font-semibold text-[var(--popover-foreground)]">
                      Arc memory
                    </span>
                    {draft.arcCompleted && (
                      <span className="rounded bg-[var(--primary)]/15 px-1 py-0.5 text-[0.5rem] font-medium text-[var(--primary)]">
                        Complete
                      </span>
                    )}
                    {!draft.arcCompleted && hasArcMemory && (
                      <span className="rounded bg-[var(--secondary)]/55 px-1 py-0.5 text-[0.5rem] text-[var(--muted-foreground)]">
                        Active
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={isGenerationBusy || !!rerollingMode || !target}
                    onClick={() => handleReroll("full")}
                    title={target ? "Re-run full secret plot state" : "No assistant message yet"}
                    aria-label="Re-run full secret plot state"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/55 hover:text-[var(--accent-foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-40 max-md:h-7 max-md:w-7"
                  >
                    <RefreshCw size="0.625rem" className={cn(fullRerollBusy && "animate-spin")} />
                  </button>
                </div>

                {showArcState && (
                  <div className="space-y-1.5 border-t border-[var(--border)] px-1.5 py-1.5">
                    <p className="flex items-start gap-1.5 rounded-md border border-[var(--destructive)]/20 bg-[var(--destructive)]/10 px-2 py-1 text-[0.5625rem] leading-snug text-[var(--destructive)]">
                      <AlertTriangle size="0.625rem" className="mt-0.5 shrink-0" />
                      <span>This section exposes hidden long-term plot structure.</span>
                    </p>
                    <div>
                      <div className="mb-0.5 flex min-h-5 items-center justify-between gap-2 text-[0.5625rem] font-medium text-[var(--muted-foreground)]">
                        <span>Arc description</span>
                        <label
                          className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--border)]/70 bg-[var(--secondary)]/30 px-1.5 py-0.5 text-[0.5rem] font-medium transition-colors hover:bg-[var(--accent)]/45 hover:text-[var(--accent-foreground)]"
                          title="Mark this long-term arc as complete without deleting the arc notes."
                          aria-label="Mark this long-term arc as complete"
                        >
                          <input
                            type="checkbox"
                            checked={draft.arcCompleted}
                            onChange={(e) => {
                              setSaved(false);
                              setDraft((current) => ({ ...current, arcCompleted: e.target.checked }));
                            }}
                            className="h-2.5 w-2.5 rounded border-[var(--input)] accent-[var(--primary)]"
                          />
                          Complete
                        </label>
                      </div>
                      <textarea
                        value={draft.arcDescription}
                        onChange={(e) => {
                          setSaved(false);
                          setDraft((current) => ({ ...current, arcDescription: e.target.value }));
                        }}
                        rows={3}
                        spellCheck={false}
                        className="w-full resize-y rounded-md border border-[var(--input)] bg-[var(--secondary)]/45 px-2 py-1.5 font-mono text-[0.625rem] leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[0.5625rem] font-medium text-[var(--muted-foreground)]">
                        Protagonist arc
                      </label>
                      <textarea
                        value={draft.arcProtagonist}
                        onChange={(e) => {
                          setSaved(false);
                          setDraft((current) => ({ ...current, arcProtagonist: e.target.value }));
                        }}
                        rows={2}
                        spellCheck={false}
                        className="w-full resize-y rounded-md border border-[var(--input)] bg-[var(--secondary)]/45 px-2 py-1.5 font-mono text-[0.625rem] leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
