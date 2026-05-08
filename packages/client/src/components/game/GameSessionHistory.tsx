// ──────────────────────────────────────────────
// Game: Session History Panel (view past sessions)
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  GitBranch,
  History,
  ChevronDown,
  ChevronRight,
  ScrollText,
  Users,
  Sparkles,
  X,
  RefreshCw,
} from "lucide-react";
import type { GameMap, GameNpc, PartyArc, SessionSummary } from "@marinara-engine/shared";
import { toast } from "sonner";
import { AnimatedText } from "./AnimatedText";

function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function normalizeTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function normalizeStatsSnapshot(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function deriveResumePointFallback(summary: string): string {
  const paragraphs = summary
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return paragraphs[paragraphs.length - 1] ?? summary;
}

function formatListDraft(items: string[]): string {
  return items.join("\n");
}

function parseListDraft(value: string): string[] {
  return value
    .split("\n")
    .map((item) => normalizeText(item))
    .filter((item) => item.length > 0);
}

interface SessionSummaryDraft {
  summary: string;
  resumePoint: string;
  partyDynamics: string;
  partyState: string;
  keyDiscoveries: string;
  characterMoments: string;
  littleDetails: string;
  npcUpdates: string;
  statsSnapshot: string;
}

export interface CurrentSessionSecrets {
  worldOverview: string;
  storyArc: string;
  plotTwists: string[];
  partyArcs: PartyArc[];
  npcs: GameNpc[];
  maps: GameMap[];
  characterCards: Array<Record<string, unknown>>;
}

interface CurrentSessionSecretDraft {
  worldOverview: string;
  storyArc: string;
  plotTwists: string;
  partyArcs: string;
  npcs: string;
  maps: string;
  characterCards: string;
}

type LorebookKeeperRunStatus = "running" | "success" | "failed";

interface LorebookKeeperLastRun {
  sessionNumber: number;
  status: LorebookKeeperRunStatus;
  updatedAt: string;
  entryCount?: number;
  error?: string;
}

function formatJsonDraft(value: unknown): string {
  return JSON.stringify(value ?? [], null, 2);
}

function buildCurrentSecretsDraft(secrets: CurrentSessionSecrets): CurrentSessionSecretDraft {
  return {
    worldOverview: secrets.worldOverview,
    storyArc: secrets.storyArc,
    plotTwists: formatListDraft(secrets.plotTwists),
    partyArcs: formatJsonDraft(secrets.partyArcs),
    npcs: formatJsonDraft(secrets.npcs),
    maps: formatJsonDraft(secrets.maps),
    characterCards: formatJsonDraft(secrets.characterCards),
  };
}

function parseJsonArrayDraft<T>(label: string, value: string): T[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`);
  }
  return parsed as T[];
}

function SpoilerTextSection({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2">
      <div className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </div>
      <div className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--foreground)]">{value}</div>
    </div>
  );
}

function SpoilerListSection({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2">
      <div className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </div>
      <ul className="flex flex-col gap-1 pl-4">
        {values.map((value, index) => (
          <li key={index} className="list-disc text-xs text-[var(--foreground)]">
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpoilerJsonSection({ label, value }: { label: string; value: unknown[] }) {
  if (!value.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2">
      <div className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[0.6875rem] leading-relaxed text-[var(--foreground)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

interface GameSessionHistoryProps {
  summaries: SessionSummary[];
  currentSessionNumber: number;
  currentSessionDate?: string | null;
  currentSecrets?: CurrentSessionSecrets | null;
  savingSessionNumber?: number | null;
  savingCurrentSecrets?: boolean;
  regeneratingSessionNumber?: number | null;
  lorebookKeeperEnabled?: boolean;
  lorebookKeeperLastRun?: LorebookKeeperLastRun | null;
  regeneratingLorebookSessionNumber?: number | null;
  updatingPlotArcsSessionNumber?: number | null;
  onSaveCurrentSecrets?: (secrets: CurrentSessionSecrets) => Promise<void> | void;
  onSaveSession?: (sessionNumber: number, session: SessionSummary) => Promise<void> | void;
  onRegenerateSession?: (sessionNumber: number) => Promise<void> | void;
  onRegenerateLorebook?: (sessionNumber: number) => Promise<void> | void;
  onUpdatePlotArcs?: (sessionNumber: number) => Promise<void> | void;
  onClose: () => void;
}

export function GameSessionHistory({
  summaries,
  currentSessionNumber,
  currentSessionDate = null,
  currentSecrets = null,
  savingSessionNumber = null,
  savingCurrentSecrets = false,
  regeneratingSessionNumber = null,
  lorebookKeeperEnabled = false,
  lorebookKeeperLastRun = null,
  regeneratingLorebookSessionNumber = null,
  updatingPlotArcsSessionNumber = null,
  onSaveCurrentSecrets,
  onSaveSession,
  onRegenerateSession,
  onRegenerateLorebook,
  onUpdatePlotArcs,
  onClose,
}: GameSessionHistoryProps) {
  const [expandedSession, setExpandedSession] = useState<number | null>(null);
  const [editingSession, setEditingSession] = useState<number | null>(null);
  const [draft, setDraft] = useState<SessionSummaryDraft | null>(null);
  const [spoilersVisible, setSpoilersVisible] = useState(false);
  const [editingSecrets, setEditingSecrets] = useState(false);
  const [secretDraft, setSecretDraft] = useState<CurrentSessionSecretDraft | null>(() =>
    currentSecrets ? buildCurrentSecretsDraft(currentSecrets) : null,
  );

  const sorted = useMemo(() => {
    const normalized = (Array.isArray(summaries) ? summaries : []).map((session, index) => {
      const raw = (session ?? {}) as Partial<SessionSummary> & Record<string, unknown>;
      const summary = normalizeText(raw.summary, `Session ${index + 1} concluded.`);
      return {
        sessionNumber: index + 1,
        summary,
        resumePoint: normalizeText(raw.resumePoint, deriveResumePointFallback(summary)),
        partyDynamics: normalizeText(raw.partyDynamics),
        partyState: normalizeText(raw.partyState),
        keyDiscoveries: [...normalizeTextList(raw.keyDiscoveries), ...normalizeTextList(raw.revelations)],
        characterMoments: normalizeTextList(raw.characterMoments),
        littleDetails: normalizeTextList(raw.littleDetails),
        npcUpdates: normalizeTextList(raw.npcUpdates),
        statsSnapshot: normalizeStatsSnapshot(raw.statsSnapshot),
        timestamp: normalizeText(raw.timestamp, new Date().toISOString()),
        nextSessionRequest: normalizeText(raw.nextSessionRequest) || null,
      } satisfies SessionSummary;
    });

    return normalized.sort((a, b) => b.sessionNumber - a.sessionNumber);
  }, [summaries]);
  const latestCompletedSessionNumber = sorted[0]?.sessionNumber ?? 0;

  useEffect(() => {
    if (!editingSecrets) {
      setSecretDraft(currentSecrets ? buildCurrentSecretsDraft(currentSecrets) : null);
    }
  }, [currentSecrets, editingSecrets]);

  const handleStartEditing = (session: SessionSummary) => {
    setEditingSession(session.sessionNumber);
    setDraft({
      summary: session.summary,
      resumePoint: session.resumePoint,
      partyDynamics: session.partyDynamics,
      partyState: session.partyState,
      keyDiscoveries: formatListDraft(session.keyDiscoveries),
      characterMoments: formatListDraft(session.characterMoments),
      littleDetails: formatListDraft(session.littleDetails),
      npcUpdates: formatListDraft(session.npcUpdates),
      statsSnapshot: JSON.stringify(session.statsSnapshot, null, 2),
    });
  };

  const handleCancelEditing = () => {
    setEditingSession(null);
    setDraft(null);
  };

  const handleSaveSession = async (session: SessionSummary) => {
    if (!onSaveSession || !draft) return;

    let statsSnapshot: Record<string, unknown> = {};
    const statsSnapshotInput = draft.statsSnapshot.trim();
    if (statsSnapshotInput) {
      try {
        const parsed = JSON.parse(statsSnapshotInput);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Stats snapshot must be a JSON object.");
        }
        statsSnapshot = parsed as Record<string, unknown>;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Stats snapshot must be valid JSON.");
        return;
      }
    }

    try {
      await onSaveSession(session.sessionNumber, {
        sessionNumber: session.sessionNumber,
        summary: draft.summary.trim(),
        resumePoint: draft.resumePoint.trim(),
        partyDynamics: draft.partyDynamics.trim(),
        partyState: draft.partyState.trim(),
        keyDiscoveries: parseListDraft(draft.keyDiscoveries),
        characterMoments: parseListDraft(draft.characterMoments),
        littleDetails: parseListDraft(draft.littleDetails),
        npcUpdates: parseListDraft(draft.npcUpdates),
        nextSessionRequest: session.nextSessionRequest ?? null,
        statsSnapshot,
        timestamp: session.timestamp,
      });
      setEditingSession(null);
      setDraft(null);
    } catch {
      // The parent handles the error toast and keeps the draft intact.
    }
  };

  const handleStartEditingSecrets = () => {
    if (!currentSecrets) return;
    setSecretDraft(buildCurrentSecretsDraft(currentSecrets));
    setEditingSecrets(true);
  };

  const handleCancelEditingSecrets = () => {
    setSecretDraft(currentSecrets ? buildCurrentSecretsDraft(currentSecrets) : null);
    setEditingSecrets(false);
  };

  const handleSaveCurrentSecrets = async () => {
    if (!onSaveCurrentSecrets || !secretDraft) return;

    try {
      await onSaveCurrentSecrets({
        worldOverview: secretDraft.worldOverview.trim(),
        storyArc: secretDraft.storyArc.trim(),
        plotTwists: parseListDraft(secretDraft.plotTwists),
        partyArcs: parseJsonArrayDraft<PartyArc>("Party arcs", secretDraft.partyArcs),
        npcs: parseJsonArrayDraft<GameNpc>("NPCs", secretDraft.npcs),
        maps: parseJsonArrayDraft<GameMap>("Maps", secretDraft.maps),
        characterCards: parseJsonArrayDraft<Record<string, unknown>>("Character cards", secretDraft.characterCards),
      });
      setEditingSecrets(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save current session spoilers.");
    }
  };

  const currentSessionDateStr = currentSessionDate
    ? new Date(currentSessionDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : new Date().toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[var(--card)]/95 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <History size={16} className="text-[var(--muted-foreground)]" />
          <span className="text-sm font-semibold text-[var(--foreground)]">Session History</span>
          <span className="text-xs text-[var(--muted-foreground)]">
            ({sorted.length} past session{sorted.length !== 1 ? "s" : ""})
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-col gap-2">
          <div className="rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="text-sm font-semibold text-[var(--foreground)]">
                Session {currentSessionNumber} (Current)
              </span>
              <span className="text-xs text-[var(--muted-foreground)]">{currentSessionDateStr}</span>
              <button
                type="button"
                onClick={() => {
                  setSpoilersVisible((visible) => !visible);
                  if (!spoilersVisible && currentSecrets) {
                    setSecretDraft(buildCurrentSecretsDraft(currentSecrets));
                  }
                }}
                className="ml-auto rounded-md bg-amber-500/15 px-2.5 py-1 text-[0.6875rem] font-semibold text-amber-500 ring-1 ring-amber-500/25 transition-colors hover:bg-amber-500/25"
              >
                {spoilersVisible ? "Hide Spoilers" : "Show Spoilers"}
              </button>
            </div>

            {spoilersVisible && (
              <div className="border-t border-[var(--border)] px-4 py-3">
                {!currentSecrets ? (
                  <p className="text-xs text-[var(--muted-foreground)]">No GM spoiler state has been generated yet.</p>
                ) : editingSecrets ? (
                  <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                        World Overview
                      </span>
                      <textarea
                        value={secretDraft?.worldOverview ?? ""}
                        onChange={(event) =>
                          setSecretDraft((prev) => (prev ? { ...prev, worldOverview: event.target.value } : prev))
                        }
                        rows={5}
                        disabled={savingCurrentSecrets}
                        className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                        Story Arc
                      </span>
                      <textarea
                        value={secretDraft?.storyArc ?? ""}
                        onChange={(event) =>
                          setSecretDraft((prev) => (prev ? { ...prev, storyArc: event.target.value } : prev))
                        }
                        rows={5}
                        disabled={savingCurrentSecrets}
                        className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                        Plot Twists
                      </span>
                      <textarea
                        value={secretDraft?.plotTwists ?? ""}
                        onChange={(event) =>
                          setSecretDraft((prev) => (prev ? { ...prev, plotTwists: event.target.value } : prev))
                        }
                        rows={5}
                        disabled={savingCurrentSecrets}
                        placeholder="One plot twist per line"
                        className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                        Party Arcs JSON
                      </span>
                      <textarea
                        value={secretDraft?.partyArcs ?? ""}
                        onChange={(event) =>
                          setSecretDraft((prev) => (prev ? { ...prev, partyArcs: event.target.value } : prev))
                        }
                        rows={8}
                        disabled={savingCurrentSecrets}
                        className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                        NPCs JSON
                      </span>
                      <textarea
                        value={secretDraft?.npcs ?? ""}
                        onChange={(event) =>
                          setSecretDraft((prev) => (prev ? { ...prev, npcs: event.target.value } : prev))
                        }
                        rows={8}
                        disabled={savingCurrentSecrets}
                        className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                        Maps JSON
                      </span>
                      <textarea
                        value={secretDraft?.maps ?? ""}
                        onChange={(event) =>
                          setSecretDraft((prev) => (prev ? { ...prev, maps: event.target.value } : prev))
                        }
                        rows={10}
                        disabled={savingCurrentSecrets}
                        className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                        Character Cards JSON
                      </span>
                      <textarea
                        value={secretDraft?.characterCards ?? ""}
                        onChange={(event) =>
                          setSecretDraft((prev) => (prev ? { ...prev, characterCards: event.target.value } : prev))
                        }
                        rows={8}
                        disabled={savingCurrentSecrets}
                        className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                      />
                    </label>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleCancelEditingSecrets}
                        disabled={savingCurrentSecrets}
                        className="rounded-md bg-[var(--secondary)] px-2.5 py-1.5 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveCurrentSecrets()}
                        disabled={savingCurrentSecrets}
                        className="rounded-md bg-[var(--primary)] px-2.5 py-1.5 text-[0.6875rem] font-medium text-white transition-colors hover:bg-[var(--primary)]/90 disabled:opacity-50"
                      >
                        {savingCurrentSecrets ? "Saving..." : "Save Spoilers"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-end">
                      {onSaveCurrentSecrets && (
                        <button
                          type="button"
                          onClick={handleStartEditingSecrets}
                          className="rounded-md bg-[var(--secondary)] px-2.5 py-1.5 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                        >
                          Edit Spoilers
                        </button>
                      )}
                    </div>
                    <SpoilerTextSection label="World Overview" value={currentSecrets.worldOverview} />
                    <SpoilerTextSection label="Story Arc" value={currentSecrets.storyArc} />
                    <SpoilerListSection label="Plot Twists" values={currentSecrets.plotTwists} />
                    <SpoilerJsonSection label="Party Arcs" value={currentSecrets.partyArcs} />
                    <SpoilerJsonSection label="NPCs" value={currentSecrets.npcs} />
                    <SpoilerJsonSection label="Maps" value={currentSecrets.maps} />
                    <SpoilerJsonSection label="Character Cards" value={currentSecrets.characterCards} />
                  </div>
                )}
              </div>
            )}
          </div>

          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-[var(--muted-foreground)]">
              <ScrollText size={24} className="opacity-50" />
              <span className="text-sm">No completed sessions yet</span>
              <span className="text-xs">Conclude your current session to see a summary here.</span>
            </div>
          ) : (
            sorted.map((session) => {
              const isExpanded = expandedSession === session.sessionNumber;
              const isEditing = editingSession === session.sessionNumber;
              const isSaving = savingSessionNumber === session.sessionNumber;
              const isRegenerating = regeneratingSessionNumber === session.sessionNumber;
              const isUpdatingPlotArcs = updatingPlotArcsSessionNumber === session.sessionNumber;
              const isLatestCompletedSession = session.sessionNumber === latestCompletedSessionNumber;
              const isRegeneratingLorebook = regeneratingLorebookSessionNumber === session.sessionNumber;
              const canRegenerateLorebook =
                lorebookKeeperEnabled && isLatestCompletedSession && typeof onRegenerateLorebook === "function";
              const lorebookRun =
                lorebookKeeperLastRun?.sessionNumber === session.sessionNumber ? lorebookKeeperLastRun : null;
              const date = new Date(session.timestamp);
              const dateStr = date.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              });

              return (
                <div key={session.sessionNumber} className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
                  <button
                    onClick={() => setExpandedSession(isExpanded ? null : session.sessionNumber)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--accent)]"
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} className="text-[var(--muted-foreground)]" />
                    ) : (
                      <ChevronRight size={14} className="text-[var(--muted-foreground)]" />
                    )}
                    <span className="text-sm font-medium text-[var(--foreground)]">
                      Session {session.sessionNumber}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">{dateStr}</span>
                    <span className="ml-auto text-xs text-[var(--muted-foreground)]">
                      {session.keyDiscoveries.length} discoveries
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-[var(--border)] px-4 py-3">
                      <div className="mb-3">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                            <ScrollText size={12} />
                            Summary
                          </div>
                          {!isEditing && (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {canRegenerateLorebook && lorebookRun && (
                                <span
                                  title={lorebookRun.error}
                                  className="inline-flex items-center gap-1 rounded-md bg-[var(--secondary)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)]"
                                >
                                  {lorebookRun.status === "failed" ? (
                                    <AlertTriangle size={11} className="text-[var(--destructive)]" />
                                  ) : lorebookRun.status === "success" ? (
                                    <CheckCircle2 size={11} className="text-emerald-500" />
                                  ) : (
                                    <RefreshCw size={11} className="animate-spin" />
                                  )}
                                  {lorebookRun.status === "failed"
                                    ? "Lorebook failed"
                                    : lorebookRun.status === "success"
                                      ? `Lorebook ${lorebookRun.entryCount ?? 0}`
                                      : "Lorebook running"}
                                </span>
                              )}
                              {canRegenerateLorebook && (
                                <button
                                  onClick={() => void onRegenerateLorebook?.(session.sessionNumber)}
                                  disabled={isRegeneratingLorebook}
                                  title="Regenerate the Game Lorebook Keeper entries for this latest session"
                                  className="inline-flex items-center gap-1 rounded-md bg-[var(--secondary)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <BookOpen
                                    size={11}
                                    className={isRegeneratingLorebook ? "animate-pulse" : undefined}
                                  />
                                  {isRegeneratingLorebook ? "Regenerating Lorebook..." : "Regenerate Lorebook"}
                                </button>
                              )}
                              {onUpdatePlotArcs && (
                                <button
                                  onClick={() => void onUpdatePlotArcs(session.sessionNumber)}
                                  disabled={isUpdatingPlotArcs || isRegenerating}
                                  title="Update game plot arcs from this session"
                                  className="inline-flex items-center gap-1 rounded-md bg-[var(--secondary)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <GitBranch size={11} className={isUpdatingPlotArcs ? "animate-pulse" : undefined} />
                                  {isUpdatingPlotArcs ? "Updating..." : "Update Plot Arcs"}
                                </button>
                              )}
                              {onRegenerateSession && (
                                <button
                                  onClick={() => void onRegenerateSession(session.sessionNumber)}
                                  disabled={isRegenerating}
                                  title="Regenerate this session conclusion"
                                  className="inline-flex items-center gap-1 rounded-md bg-[var(--secondary)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <RefreshCw size={11} className={isRegenerating ? "animate-spin" : undefined} />
                                  {isRegenerating ? "Regenerating..." : "Regenerate"}
                                </button>
                              )}
                              {onSaveSession && (
                                <button
                                  onClick={() => handleStartEditing(session)}
                                  disabled={isRegenerating}
                                  className="rounded-md bg-[var(--secondary)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Edit Details
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {isEditing ? (
                          <div className="flex flex-col gap-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                                Summary
                              </span>
                              <textarea
                                value={draft?.summary ?? ""}
                                onChange={(event) =>
                                  setDraft((prev) => (prev ? { ...prev, summary: event.target.value } : prev))
                                }
                                disabled={isSaving}
                                rows={8}
                                className="min-h-32 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                                Resume Point
                              </span>
                              <textarea
                                value={draft?.resumePoint ?? ""}
                                onChange={(event) =>
                                  setDraft((prev) => (prev ? { ...prev, resumePoint: event.target.value } : prev))
                                }
                                disabled={isSaving}
                                rows={4}
                                placeholder="How the next session should resume"
                                className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                                Party Dynamics
                              </span>
                              <textarea
                                value={draft?.partyDynamics ?? ""}
                                onChange={(event) =>
                                  setDraft((prev) => (prev ? { ...prev, partyDynamics: event.target.value } : prev))
                                }
                                disabled={isSaving}
                                rows={4}
                                className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                                Party State
                              </span>
                              <textarea
                                value={draft?.partyState ?? ""}
                                onChange={(event) =>
                                  setDraft((prev) => (prev ? { ...prev, partyState: event.target.value } : prev))
                                }
                                disabled={isSaving}
                                rows={3}
                                className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                                Key Discoveries
                              </span>
                              <textarea
                                value={draft?.keyDiscoveries ?? ""}
                                onChange={(event) =>
                                  setDraft((prev) => (prev ? { ...prev, keyDiscoveries: event.target.value } : prev))
                                }
                                disabled={isSaving}
                                rows={4}
                                placeholder="One continuity fact per line, including discoveries, twists, and reveals"
                                className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                                Character Moments
                              </span>
                              <textarea
                                value={draft?.characterMoments ?? ""}
                                onChange={(event) =>
                                  setDraft((prev) => (prev ? { ...prev, characterMoments: event.target.value } : prev))
                                }
                                disabled={isSaving}
                                rows={4}
                                placeholder="One moment per line"
                                className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                                Little Details To Recall
                              </span>
                              <textarea
                                value={draft?.littleDetails ?? ""}
                                onChange={(event) =>
                                  setDraft((prev) => (prev ? { ...prev, littleDetails: event.target.value } : prev))
                                }
                                disabled={isSaving}
                                rows={4}
                                placeholder="One small preference, habit, promise, or past detail per line"
                                className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                                NPC Updates
                              </span>
                              <textarea
                                value={draft?.npcUpdates ?? ""}
                                onChange={(event) =>
                                  setDraft((prev) => (prev ? { ...prev, npcUpdates: event.target.value } : prev))
                                }
                                disabled={isSaving}
                                rows={4}
                                placeholder="One update per line"
                                className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                                Stats Snapshot JSON
                              </span>
                              <textarea
                                value={draft?.statsSnapshot ?? ""}
                                onChange={(event) =>
                                  setDraft((prev) => (prev ? { ...prev, statsSnapshot: event.target.value } : prev))
                                }
                                disabled={isSaving}
                                rows={8}
                                className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--primary)]"
                              />
                            </label>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={handleCancelEditing}
                                disabled={isSaving}
                                className="rounded-md bg-[var(--secondary)] px-2.5 py-1.5 text-[0.6875rem] font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => void handleSaveSession(session)}
                                disabled={isSaving || !(draft?.summary ?? "").trim()}
                                className="rounded-md bg-[var(--primary)] px-2.5 py-1.5 text-[0.6875rem] font-medium text-white transition-colors hover:bg-[var(--primary)]/90 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isSaving ? "Saving..." : "Save Details"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <AnimatedText
                              html={session.summary}
                              className="text-sm leading-relaxed text-[var(--foreground)]"
                            />
                            {session.resumePoint && (
                              <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2">
                                <div className="mb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                                  Resume Point
                                </div>
                                <AnimatedText
                                  html={session.resumePoint}
                                  className="text-xs leading-relaxed text-[var(--foreground)]"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {session.partyDynamics && (
                        <div className="mb-3">
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                            <Users size={12} />
                            Party Dynamics
                          </div>
                          <AnimatedText html={session.partyDynamics} className="text-sm text-[var(--foreground)]" />
                        </div>
                      )}

                      {session.keyDiscoveries.length > 0 && (
                        <div className="mb-3">
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                            <Sparkles size={12} />
                            Key Discoveries
                          </div>
                          <ul className="flex flex-col gap-1 pl-4">
                            {session.keyDiscoveries.map((discovery, i) => (
                              <li key={i} className="list-disc text-xs text-[var(--foreground)]">
                                <AnimatedText html={discovery} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {session.characterMoments.length > 0 && (
                        <div className="mb-3">
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                            <Users size={12} />
                            Character Moments
                          </div>
                          <ul className="flex flex-col gap-1 pl-4">
                            {session.characterMoments.map((moment, i) => (
                              <li key={i} className="list-disc text-xs text-[var(--foreground)]">
                                <AnimatedText html={moment} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {session.littleDetails.length > 0 && (
                        <div className="mb-3">
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                            <Sparkles size={12} />
                            Little Details To Recall
                          </div>
                          <ul className="flex flex-col gap-1 pl-4">
                            {session.littleDetails.map((detail, i) => (
                              <li key={i} className="list-disc text-xs text-[var(--foreground)]">
                                <AnimatedText html={detail} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {session.npcUpdates.length > 0 && (
                        <div className="mb-3">
                          <div className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">NPC Updates</div>
                          <ul className="flex flex-col gap-1 pl-4">
                            {session.npcUpdates.map((update, i) => (
                              <li key={i} className="list-disc text-xs text-[var(--foreground)]">
                                <AnimatedText html={update} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {session.nextSessionRequest && (
                        <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                          <div className="mb-1 text-xs font-medium text-amber-500">Next Session Request</div>
                          <div className="text-xs leading-relaxed text-[var(--foreground)]">
                            {session.nextSessionRequest}
                          </div>
                        </div>
                      )}

                      {Object.keys(session.statsSnapshot).length > 0 && (
                        <div className="mb-3">
                          <div className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">Stats Snapshot</div>
                          <pre className="overflow-x-auto rounded-lg bg-[var(--secondary)] p-3 font-mono text-[0.6875rem] leading-relaxed text-[var(--foreground)] whitespace-pre-wrap break-words">
                            {JSON.stringify(session.statsSnapshot, null, 2)}
                          </pre>
                        </div>
                      )}

                      {session.partyState && (
                        <div className="mt-3 rounded bg-[var(--card)] p-2 text-xs text-[var(--muted-foreground)]">
                          <span className="font-medium">Party Status:</span> <AnimatedText html={session.partyState} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="border-t border-[var(--border)] px-4 py-2 text-center text-xs text-[var(--muted-foreground)]">
        Currently in Session {currentSessionNumber}
      </div>
    </div>
  );
}
