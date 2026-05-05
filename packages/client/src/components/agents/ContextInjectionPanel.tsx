// ──────────────────────────────────────────────
// Editable cached agent prompt injections (message.extra.contextInjections)
// Shown in the roleplay Agents menu — survives clearing thought bubbles.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, RefreshCw, Save } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { BUILT_IN_AGENTS } from "@marinara-engine/shared";
import type { Message } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { chatKeys, useUpdateMessageExtra } from "../../hooks/use-chats";
import { useGenerate } from "../../hooks/use-generate";
import { HelpTooltip } from "../ui/HelpTooltip";

const CACHED_INJECTIONS_HELP =
  "Troubleshooting view for text that certain writer agents added before the current reply, usually Prose Guardian, Narrative Director, or custom injected text. Edits and re-runs are only used if you regenerate this same assistant message. Re-runs use the original transcript slice and tracker snapshot, not newer chat.";
const NON_REROLLABLE_INJECTION_AGENTS = new Set(["knowledge-retrieval", "knowledge-router"]);

const INJECTION_LABEL: Record<string, string> = Object.fromEntries(
  BUILT_IN_AGENTS.map((a) => [a.id, a.name]),
);

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

function agentLabel(agentType: string): string {
  return INJECTION_LABEL[agentType] ?? agentType;
}

type CachedInjection = { agentType: string; text: string };

function normalizeContextInjections(raw: unknown): CachedInjection[] {
  if (!Array.isArray(raw)) return [];
  const normalized: CachedInjection[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      normalized.push({ agentType: "prose-guardian", text: entry });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { agentType?: unknown; text?: unknown };
    if (typeof candidate.agentType !== "string" || typeof candidate.text !== "string") continue;
    normalized.push({ agentType: candidate.agentType, text: candidate.text });
  }
  return normalized;
}

export function ContextInjectionPanel({
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
  const updateExtra = useUpdateMessageExtra(chatId);
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
        inj.agentType === agentType ? { agentType, text } : { ...inj },
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
      } finally {
        setRerollingType(null);
      }
    },
    [chatId, target, isGenerationBusy, qc, rerollingType, retryAgents],
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
                      onClick={() =>
                        setExpandedInjections((m) => ({ ...m, [inj.agentType]: !m[inj.agentType] }))
                      }
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
                        {agentLabel(inj.agentType)}
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
                          title={`Re-run ${agentLabel(inj.agentType)} injection`}
                          aria-label={`Re-run ${agentLabel(inj.agentType)} injection`}
                        >
                          <RefreshCw size="0.625rem" className={cn(rerollBusy && "animate-spin")} />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={updateExtra.isPending || isAgentProcessing}
                        onClick={() => handleSaveOne(inj.agentType)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:opacity-40 max-md:h-7 max-md:w-7"
                        title={saved ? `${agentLabel(inj.agentType)} injection saved` : `Save ${agentLabel(inj.agentType)} injection`}
                        aria-label={
                          saved ? `${agentLabel(inj.agentType)} injection saved` : `Save ${agentLabel(inj.agentType)} injection`
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
