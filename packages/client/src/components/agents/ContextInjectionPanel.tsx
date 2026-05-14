// ──────────────────────────────────────────────
// Editable cached agent prompt injections (message.extra.contextInjections)
// Shown in the roleplay Agents menu — survives clearing thought bubbles.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Minus, Plus, RefreshCw, Save } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BUILT_IN_AGENTS, getDefaultBuiltInAgentSettings } from "@marinara-engine/shared";
import type { Message } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api-client";
import { chatKeys, useUpdateMessageExtra } from "../../hooks/use-chats";
import { useGenerate } from "../../hooks/use-generate";
import { HelpTooltip } from "../ui/HelpTooltip";
import { useUpdateAgentByType, type AgentConfigRow } from "../../hooks/use-agents";
import { getAgentRunIntervalMeta, stepCadenceValue } from "../../lib/agent-cadence";

const CACHED_INJECTIONS_HELP =
  "Troubleshooting view for text that certain writer agents added before the current reply, usually Prose Guardian, Narrative Director, or custom injected text. Edits and re-runs are only used if you regenerate this same assistant message. Re-runs use the original transcript slice and tracker snapshot, not newer chat.";
const DIRECTOR_CADENCE_HELP =
  "Shows when Narrative Director will add guidance again. Interval changes affect future replies, not the cached injection on this message.";
const NON_REROLLABLE_INJECTION_AGENTS = new Set(["knowledge-retrieval", "knowledge-router"]);

const INJECTION_LABEL: Record<string, string> = Object.fromEntries(BUILT_IN_AGENTS.map((a) => [a.id, a.name]));

function parseExtra(raw: Message["extra"]): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") return raw as unknown as Record<string, unknown>;
  return {};
}

function findLastAssistant(messages: Message[] | undefined): Message | null {
  if (!messages?.length) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") return messages[i]!;
  }
  return null;
}

function agentLabel(agentType: string, agentName?: string): string {
  return agentName?.trim() || INJECTION_LABEL[agentType] || agentType;
}

type CachedInjection = { agentType: string; agentName?: string; text: string };

type AgentCadenceStatus = {
  agentType: string;
  runInterval: number;
  lastSuccessfulRun: { messageId: string; createdAt: string } | null;
  assistantMessagesSinceLastRun: number | null;
  remainingAssistantMessages: number;
  runsNextAssistantMessage: boolean;
  lastRunMessageFound: boolean | null;
};

function normalizeContextInjections(raw: unknown): CachedInjection[] {
  if (!Array.isArray(raw)) return [];
  const normalized: CachedInjection[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      normalized.push({ agentType: "prose-guardian", text: entry });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { agentType?: unknown; agentName?: unknown; text?: unknown };
    if (typeof candidate.agentType !== "string" || typeof candidate.text !== "string") continue;
    normalized.push({
      agentType: candidate.agentType,
      agentName: typeof candidate.agentName === "string" ? candidate.agentName : undefined,
      text: candidate.text,
    });
  }
  return normalized;
}

function parseAgentSettings(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeDirectorInterval(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(max, Math.floor(parsed)) : fallback;
}

export function ContextInjectionPanel({
  chatId,
  messages,
  isAgentProcessing,
  isGenerationBusy = isAgentProcessing,
  agentConfigs,
  enabledAgentTypes,
}: {
  chatId: string | null;
  messages: Message[] | undefined;
  isAgentProcessing: boolean;
  isGenerationBusy?: boolean;
  agentConfigs?: AgentConfigRow[];
  enabledAgentTypes?: Set<string>;
}) {
  const qc = useQueryClient();
  const { retryAgents } = useGenerate();
  const updateExtra = useUpdateMessageExtra(chatId);
  const updateDirectorAgent = useUpdateAgentByType();
  const [open, setOpen] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rerollingType, setRerollingType] = useState<string | null>(null);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [savedType, setSavedType] = useState<string | null>(null);
  /** When true, the textarea for that agent is visible */
  const [expandedInjections, setExpandedInjections] = useState<Record<string, boolean>>({});

  const target = useMemo(() => findLastAssistant(messages), [messages]);
  const parsedExtra = useMemo(() => (target ? parseExtra(target.extra) : {}), [target]);
  const injections = useMemo(() => {
    return normalizeContextInjections(parsedExtra.contextInjections).filter(
      (entry) => entry.agentType !== "secret-plot-driver",
    );
  }, [parsedExtra.contextInjections]);
  const hasDirectorInjection = injections.some((entry) => entry.agentType === "director");
  const showDirectorCadence = (enabledAgentTypes?.has("director") ?? false) || hasDirectorInjection;
  const directorConfig = useMemo(
    () => (agentConfigs ?? []).find((config) => config.type === "director") ?? null,
    [agentConfigs],
  );
  const directorCadenceQueryKey = useMemo(() => ["agent-cadence", "director", chatId ?? ""] as const, [chatId]);
  const directorCadence = useQuery({
    queryKey: directorCadenceQueryKey,
    enabled: !!chatId && showDirectorCadence,
    queryFn: () => api.get<AgentCadenceStatus>(`/agents/cadence/director/${chatId}`),
    staleTime: 15_000,
  });
  const directorIntervalMeta = getAgentRunIntervalMeta("director");
  const directorSettings = useMemo(
    () => ({ ...getDefaultBuiltInAgentSettings("director"), ...parseAgentSettings(directorConfig?.settings) }),
    [directorConfig?.settings],
  );
  const directorInterval = directorIntervalMeta
    ? normalizeDirectorInterval(
        directorCadence.data?.runInterval ?? directorSettings.runInterval,
        directorIntervalMeta.defaultValue,
        directorIntervalMeta.max,
      )
    : 1;

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const inj of injections) {
      next[inj.agentType] = inj.text ?? "";
    }
    setDrafts(next);
  }, [target?.id, injections]);

  useEffect(() => {
    setExpandedInjections({});
  }, [target?.id]);

  const handleSaveOne = useCallback(
    (agentType: string) => {
      const text = drafts[agentType] ?? "";
      const list = injections.map((inj) =>
        inj.agentType === agentType ? { agentType, agentName: inj.agentName, text } : { ...inj },
      );
      if (!target || !chatId) return;
      setSavingType(agentType);
      setSavedType(null);
      updateExtra.mutate(
        { messageId: target.id, extra: { contextInjections: list } },
        {
          onSuccess: () => setSavedType(agentType),
          onSettled: () => setSavingType(null),
        },
      );
    },
    [chatId, drafts, injections, target, updateExtra],
  );

  const handleReroll = useCallback(
    async (agentType: string) => {
      if (!chatId || !target || isGenerationBusy || rerollingType) return;
      setRerollingType(agentType);
      try {
        await retryAgents(chatId, [agentType], { forMessageId: target.id });
        await qc.invalidateQueries({ queryKey: chatKeys.messages(chatId) });
        if (agentType === "director") {
          await qc.invalidateQueries({ queryKey: directorCadenceQueryKey });
        }
      } finally {
        setRerollingType(null);
      }
    },
    [chatId, target, isGenerationBusy, qc, rerollingType, retryAgents, directorCadenceQueryKey],
  );

  const handleDirectorIntervalStep = useCallback(
    async (delta: number) => {
      if (!directorIntervalMeta || updateDirectorAgent.isPending) return;
      const next = stepCadenceValue(directorInterval, delta, directorIntervalMeta.max);
      if (next === directorInterval) return;
      await updateDirectorAgent.mutateAsync({
        agentType: "director",
        settings: { ...directorSettings, runInterval: next },
      });
      await qc.invalidateQueries({ queryKey: directorCadenceQueryKey });
    },
    [directorInterval, directorIntervalMeta, directorSettings, directorCadenceQueryKey, qc, updateDirectorAgent],
  );

  if (!chatId) return null;

  return (
    <div className="bg-[var(--popover)]/35 text-[var(--popover-foreground)]">
      <div className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[0.625rem]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="group flex min-h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-[var(--accent)]/45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] max-md:min-h-7"
          aria-expanded={open}
        >
          <ChevronDown
            size="0.75rem"
            className={cn("shrink-0 text-[var(--primary)] transition-transform", open && "rotate-180")}
          />
          <span className="min-w-0 truncate font-semibold text-[var(--popover-foreground)]/75 group-hover:text-[var(--popover-foreground)]">
            Cached prompt injections
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-1.5">
          <HelpTooltip
            text={CACHED_INJECTIONS_HELP}
            wide
            side="left"
            size="0.75rem"
            className="text-[var(--muted-foreground)]"
          />
          {injections.length > 0 && (
            <span className="rounded-full bg-[var(--primary)]/15 px-1.5 py-px text-[0.5rem] font-semibold text-[var(--primary)] ring-1 ring-[var(--primary)]/25">
              {injections.length}
            </span>
          )}
        </span>
      </div>
      {open && (
        <div className="border-t border-[var(--border)] px-2 pb-2 pt-1.5">
          {showDirectorCadence && directorIntervalMeta && (
            <DirectorCadenceCard
              status={directorCadence.data}
              loading={directorCadence.isLoading}
              error={directorCadence.isError}
              interval={directorInterval}
              maxInterval={directorIntervalMeta.max}
              canEdit
              saving={updateDirectorAgent.isPending}
              onStep={handleDirectorIntervalStep}
            />
          )}
          {!target && (
            <p className="py-2 text-center text-[0.625rem] text-[var(--muted-foreground)]">
              No assistant message loaded yet.
            </p>
          )}
          {target && injections.length === 0 && (
            <p className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/35 px-3 py-2 text-center text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
              No cached injections on this assistant message yet.
            </p>
          )}
          {target &&
            injections.map((inj) => {
              const expanded = !!expandedInjections[inj.agentType];
              const canReroll = !NON_REROLLABLE_INJECTION_AGENTS.has(inj.agentType);
              const dirty = (drafts[inj.agentType] ?? "") !== (inj.text ?? "");
              const saving = savingType === inj.agentType && updateExtra.isPending;
              const saved = savedType === inj.agentType && !dirty && !saving;
              const rerollBusy = isGenerationBusy || rerollingType === inj.agentType;
              return (
                <div
                  key={inj.agentType}
                  className="mb-1 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]/55 last:mb-0"
                >
                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => setExpandedInjections((m) => ({ ...m, [inj.agentType]: !m[inj.agentType] }))}
                      className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]"
                      title={expanded ? "Collapse output" : "Expand output"}
                      aria-expanded={expanded}
                    >
                      <ChevronDown
                        size="0.75rem"
                        className={cn(
                          "shrink-0 text-[var(--primary)] transition-transform",
                          expanded ? "rotate-180" : "-rotate-90",
                        )}
                      />
                      <span className="truncate text-[0.625rem] font-semibold text-[var(--popover-foreground)]">
                        {agentLabel(inj.agentType, inj.agentName)}
                      </span>
                      {dirty && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" title="Unsaved edit" />
                      )}
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {canReroll && (
                        <button
                          type="button"
                          disabled={isGenerationBusy || !!rerollingType || updateExtra.isPending}
                          onClick={() => handleReroll(inj.agentType)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/55 hover:text-[var(--accent-foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-40 max-md:h-7 max-md:w-7"
                          title={`Re-run ${agentLabel(inj.agentType, inj.agentName)} injection`}
                          aria-label={`Re-run ${agentLabel(inj.agentType, inj.agentName)} injection`}
                        >
                          <RefreshCw size="0.625rem" className={cn(rerollBusy && "animate-spin")} />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={updateExtra.isPending || isAgentProcessing}
                        onClick={() => handleSaveOne(inj.agentType)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-40 max-md:h-7 max-md:w-7"
                        title={
                          saved
                            ? `${agentLabel(inj.agentType, inj.agentName)} injection saved`
                            : `Save ${agentLabel(inj.agentType, inj.agentName)} injection`
                        }
                        aria-label={
                          saved
                            ? `${agentLabel(inj.agentType, inj.agentName)} injection saved`
                            : `Save ${agentLabel(inj.agentType, inj.agentName)} injection`
                        }
                      >
                        {saved ? (
                          <Check size="0.625rem" />
                        ) : (
                          <Save size="0.625rem" className={saving ? "animate-pulse" : ""} />
                        )}
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="border-t border-[var(--border)] px-1.5 pb-1.5">
                      <textarea
                        value={drafts[inj.agentType] ?? ""}
                        onChange={(e) =>
                          setDrafts((d) => ({
                            ...d,
                            [inj.agentType]: e.target.value,
                          }))
                        }
                        rows={4}
                        className="mt-1.5 min-h-24 w-full resize-y rounded-md border border-[var(--input)] bg-[var(--secondary)]/45 px-2 py-1.5 font-mono text-[0.625rem] leading-relaxed text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]"
                        spellCheck={false}
                      />
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

function DirectorCadenceCard({
  status,
  loading,
  error,
  interval,
  maxInterval,
  canEdit,
  saving,
  onStep,
}: {
  status: AgentCadenceStatus | undefined;
  loading: boolean;
  error: boolean;
  interval: number;
  maxInterval: number;
  canEdit: boolean;
  saving: boolean;
  onStep: (delta: number) => void;
}) {
  const remaining = status?.remainingAssistantMessages ?? 0;
  const statusLabel =
    interval <= 1
      ? "Every reply"
      : loading
        ? "Checking"
        : error
          ? "Unavailable"
          : remaining <= 0
            ? "Ready"
            : `${remaining} left`;
  const detail =
    interval <= 1
      ? "Narrative Director can run on every eligible assistant reply."
      : loading
        ? "Checking the latest saved Director run."
        : error
          ? "Could not load the countdown. The interval setting still saves normally."
          : !status?.lastSuccessfulRun
            ? "No saved Director run yet. The next eligible reply can run it."
            : remaining <= 0
              ? "Ready for the next eligible assistant reply."
              : `Next run after ${remaining} assistant ${remaining === 1 ? "reply" : "replies"}.`;
  const intervalLabel = interval <= 1 ? "assistant reply" : `${interval} replies`;

  return (
    <div className="mb-1 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]/55">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[0.625rem] font-semibold text-[var(--popover-foreground)]">
              Narrative Director
            </span>
            <span className="shrink-0 rounded-full bg-[var(--primary)]/15 px-1.5 py-px text-[0.5rem] font-semibold text-[var(--primary)] ring-1 ring-[var(--primary)]/25">
              {statusLabel}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[0.5625rem] leading-snug text-[var(--muted-foreground)]">{detail}</p>
        </div>
        <HelpTooltip
          text={DIRECTOR_CADENCE_HELP}
          wide
          side="left"
          size="0.75rem"
          className="shrink-0 text-[var(--muted-foreground)]"
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-2 py-1.5">
        <span className="min-w-0 text-[0.5625rem] text-[var(--muted-foreground)]">
          Runs every <span className="font-medium text-[var(--popover-foreground)]">{intervalLabel}</span>
        </span>
        <div className="flex shrink-0 items-center rounded-md border border-[var(--border)] bg-[var(--secondary)]/35">
          <button
            type="button"
            onClick={() => onStep(-1)}
            disabled={!canEdit || saving || interval <= 1}
            className="inline-flex h-6 w-6 items-center justify-center rounded-l-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/55 hover:text-[var(--accent-foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-40 max-md:h-7 max-md:w-7"
            title="Decrease Narrative Director interval"
            aria-label="Decrease Narrative Director interval"
          >
            <Minus size="0.625rem" />
          </button>
          <span className="min-w-8 px-1 text-center text-[0.5625rem] font-semibold tabular-nums text-[var(--popover-foreground)]">
            {interval === 1 ? "Every" : interval}
          </span>
          <button
            type="button"
            onClick={() => onStep(1)}
            disabled={!canEdit || saving || interval >= maxInterval}
            className="inline-flex h-6 w-6 items-center justify-center rounded-r-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]/55 hover:text-[var(--accent-foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-40 max-md:h-7 max-md:w-7"
            title="Increase Narrative Director interval"
            aria-label="Increase Narrative Director interval"
          >
            <Plus size="0.625rem" />
          </button>
        </div>
      </div>
    </div>
  );
}
