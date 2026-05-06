// ──────────────────────────────────────────────
// Agent Loadout Cost Estimator
// ──────────────────────────────────────────────
// Pure function that estimates the per-turn cost of an enabled agent set,
// so the UI can show "~N tokens · ~M extra calls" alongside the agent picker.
//
// The estimate is intentionally rough. It is meant to help users sense when
// a loadout is starting to get heavy, not to predict billing.
//
// Two axes:
//   - instructionTokens: sum of agents' prompt-template tokens (chars/4).
//     Does NOT include the chat context (recent messages, character cards,
//     persona, lorebook, summary) that each call also carries — real per-turn
//     usage will be substantially higher. UI copy should make that clear.
//   - extraCalls: count of distinct (phase × connection) groups. This mirrors
//     the server-side batching in
//     `packages/server/src/services/agents/agent-pipeline.ts`: agents that
//     share a phase AND connection batch into a single LLM call. v1 ignores
//     the tool-extraction nuance (tool-using agents technically run alone,
//     adding 1 call each beyond the batch) — fine for a soft signal.
// ──────────────────────────────────────────────

import type { AgentPhase } from "../types/agent.js";
import { BUILT_IN_AGENT_IDS } from "../types/agent.js";

/** Minimal shape needed to estimate an agent's contribution. */
export interface AgentCostInput {
  /** Agent type identifier, e.g. "world-state". Used to special-case static agents. */
  type: string;
  phase: AgentPhase;
  /** Per-agent connection override; falls back to the chat default when null. */
  connectionId: string | null;
  /** Resolved prompt template (custom override OR built-in default). */
  promptTemplate: string;
}

export interface AgentLoadCost {
  instructionTokens: number;
  extraCalls: number;
  /** Soft warning level. "high" when the loadout crosses a threshold likely to
   *  matter on small-context (~8k) local models. */
  level: "ok" | "high";
}

// v1 thresholds, tunable via user feedback:
//   - 4 extra calls roughly doubles a typical 2-call baseline.
//   - 4000 instruction tokens fills ~50% of an 8k local-model context.
export const AGENT_COST_HIGH_CALLS = 4;
export const AGENT_COST_HIGH_TOKENS = 4000;

/**
 * Agents whose template contributes to the main prompt but do NOT trigger an
 * extra LLM call. Currently just `html`, which is statically injected.
 *
 * `knowledge-retrieval` and `knowledge-router` ARE separate inference calls
 * (they ask the LLM to pick or summarize lorebook entries), so they are not
 * in this set.
 */
const NO_EXTRA_CALL_AGENT_TYPES = new Set<string>([BUILT_IN_AGENT_IDS.HTML]);

// TODO: replace chars/4 with a real tokenizer when the project picks one up.
// Matches the existing `estimateTokens` helpers scattered across the client
// (PeekPromptModal, LorebookFormFields, etc.).
function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateAgentLoadCost(enabled: AgentCostInput[], defaultConnectionId: string | null): AgentLoadCost {
  let instructionTokens = 0;
  const callKeys = new Set<string>();

  for (const a of enabled) {
    instructionTokens += approximateTokens(a.promptTemplate);
    if (NO_EXTRA_CALL_AGENT_TYPES.has(a.type)) continue;
    const connection = a.connectionId ?? defaultConnectionId ?? "default";
    callKeys.add(`${a.phase}::${connection}`);
  }

  const extraCalls = callKeys.size;
  const level: "ok" | "high" =
    extraCalls >= AGENT_COST_HIGH_CALLS || instructionTokens >= AGENT_COST_HIGH_TOKENS ? "high" : "ok";

  return { instructionTokens, extraCalls, level };
}
