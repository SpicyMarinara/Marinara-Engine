// ──────────────────────────────────────────────
// Game: Session History Panel (view past sessions)
// ──────────────────────────────────────────────
import { useMemo, useState } from "react";
import { History, ChevronDown, ChevronRight, ScrollText, Users, Sparkles, X } from "lucide-react";
import type { SessionSummary } from "@marinara-engine/shared";
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

interface GameSessionHistoryProps {
  summaries: SessionSummary[];
  currentSessionNumber: number;
  onClose: () => void;
}

export function GameSessionHistory({ summaries, currentSessionNumber, onClose }: GameSessionHistoryProps) {
  const [expandedSession, setExpandedSession] = useState<number | null>(null);

  const sorted = useMemo(() => {
    const normalized = (Array.isArray(summaries) ? summaries : []).map((session, index) => {
      const raw = (session ?? {}) as Partial<SessionSummary> & Record<string, unknown>;
      return {
        sessionNumber: index + 1,
        summary: normalizeText(raw.summary, `Session ${index + 1} concluded.`),
        partyDynamics: normalizeText(raw.partyDynamics),
        partyState: normalizeText(raw.partyState),
        keyDiscoveries: normalizeTextList(raw.keyDiscoveries),
        npcUpdates: normalizeTextList(raw.npcUpdates),
        timestamp: normalizeText(raw.timestamp, new Date().toISOString()),
      };
    });

    return normalized.sort((a, b) => b.sessionNumber - a.sessionNumber);
  }, [summaries]);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[var(--card)]/95 backdrop-blur-sm">
      {/* Header */}
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
          className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-[var(--muted-foreground)]">
            <ScrollText size={24} className="opacity-50" />
            <span className="text-sm">No completed sessions yet</span>
            <span className="text-xs">Conclude your current session to see a summary here.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((session) => {
              const isExpanded = expandedSession === session.sessionNumber;
              const date = new Date(session.timestamp);
              const dateStr = date.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              });

              return (
                <div key={session.sessionNumber} className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
                  {/* Session header (clickable) */}
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

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="border-t border-[var(--border)] px-4 py-3">
                      {/* Narrative summary */}
                      <div className="mb-3">
                        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                          <ScrollText size={12} />
                          Summary
                        </div>
                        <AnimatedText
                          html={session.summary}
                          className="text-sm leading-relaxed text-[var(--foreground)]"
                        />
                      </div>

                      {/* Party dynamics */}
                      {session.partyDynamics && (
                        <div className="mb-3">
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                            <Users size={12} />
                            Party Dynamics
                          </div>
                          <AnimatedText html={session.partyDynamics} className="text-sm text-[var(--foreground)]" />
                        </div>
                      )}

                      {/* Key discoveries */}
                      {session.keyDiscoveries.length > 0 && (
                        <div className="mb-3">
                          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                            <Sparkles size={12} />
                            Key Discoveries
                          </div>
                          <ul className="flex flex-col gap-1 pl-4">
                            {session.keyDiscoveries.map((d, i) => (
                              <li key={i} className="list-disc text-xs text-[var(--foreground)]">
                                <AnimatedText html={d} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* NPC updates */}
                      {session.npcUpdates.length > 0 && (
                        <div>
                          <div className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">NPC Updates</div>
                          <ul className="flex flex-col gap-1 pl-4">
                            {session.npcUpdates.map((u, i) => (
                              <li key={i} className="list-disc text-xs text-[var(--foreground)]">
                                <AnimatedText html={u} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Party state */}
                      {session.partyState && (
                        <div className="mt-3 rounded bg-[var(--card)] p-2 text-xs text-[var(--muted-foreground)]">
                          <span className="font-medium">Party Status:</span> <AnimatedText html={session.partyState} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer — current session note */}
      <div className="border-t border-[var(--border)] px-4 py-2 text-center text-xs text-[var(--muted-foreground)]">
        Currently in Session {currentSessionNumber}
      </div>
    </div>
  );
}
