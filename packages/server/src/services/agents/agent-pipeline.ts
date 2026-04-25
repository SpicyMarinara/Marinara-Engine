// ──────────────────────────────────────────────
// Agent Pipeline — Phase Orchestration (Batched)
// ──────────────────────────────────────────────
// Coordinates the 3 agent phases around the main generation:
//   1. pre_generation  → inject context before the LLM call
//   2. parallel        → fire alongside the main generation (no mainResponse)
//   3. post_processing → analyze/modify the completed response (has mainResponse)
//
// Agents that share the same provider+model are BATCHED into a
// single LLM call to reduce total requests. Agents with different
// connections are grouped separately and run in parallel.
// ──────────────────────────────────────────────
import type { AgentResult, AgentContext, AgentPhase } from "@marinara-engine/shared";
import type { BaseLLMProvider } from "../llm/base-provider.js";
import { executeAgent, executeAgentBatch, type AgentExecConfig, type AgentToolContext } from "./agent-executor.js";
import { logger } from "../../lib/logger.js";

/** A fully resolved agent ready for execution. */
export interface ResolvedAgent extends AgentExecConfig {
  provider: BaseLLMProvider;
  model: string;
  /** Optional tool context for agents that need function calling (e.g., Spotify). */
  toolContext?: AgentToolContext;
}

export interface AgentInjection {
  agentType: string;
  text: string;
}

/** Callback fired whenever an agent produces a result. */
export type AgentResultCallback = (result: AgentResult) => void;

// ──────────────────────────────────────────────
// Grouping — batch agents by (provider instance, model)
// ──────────────────────────────────────────────

interface AgentGroup {
  provider: BaseLLMProvider;
  model: string;
  agents: ResolvedAgent[];
}

/**
 * Group agents by shared provider+model so they can be batched.
 * We use the provider reference + model string as the key.
 */
function groupByProviderModel(agents: ResolvedAgent[]): AgentGroup[] {
  const groups = new Map<string, AgentGroup>();

  for (const agent of agents) {
    // Use a composite key: object reference hash + model
    // Two agents share a group if they have the same provider instance and model
    const key = `${providerKey(agent.provider)}::${agent.model}`;
    let group = groups.get(key);
    if (!group) {
      group = { provider: agent.provider, model: agent.model, agents: [] };
      groups.set(key, group);
    }
    group.agents.push(agent);
  }

  return Array.from(groups.values());
}

// Simple provider identity via a WeakMap-backed counter
const providerIds = new WeakMap<BaseLLMProvider, number>();
let nextProviderId = 0;
function providerKey(provider: BaseLLMProvider): number {
  let id = providerIds.get(provider);
  if (id === undefined) {
    id = nextProviderId++;
    providerIds.set(provider, id);
  }
  return id;
}

/**
 * Execute a group of agents — batch if >1, single if 1.
 * Tool-using agents are extracted from batches and run individually.
 * Returns results and fires the onResult callback per agent.
 */
async function executeGroup(
  group: AgentGroup,
  context: AgentContext,
  onResult?: AgentResultCallback,
): Promise<AgentResult[]> {
  // Separate tool-using agents (can't be batched) from regular agents
  const toolAgents = group.agents.filter((a) => a.toolContext?.tools.length);
  const batchAgents = group.agents.filter((a) => !a.toolContext?.tools.length);

  logger.debug(
    "[agent-pipeline] executeGroup: %d batchable, %d tool-using %j",
    batchAgents.length,
    toolAgents.length,
    batchAgents.map((a) => a.type),
  );

  // Safe callback wrapper — errors in the callback (e.g. writing to a
  // closed SSE stream) must never crash the group and silently drop results.
  const safeOnResult = (result: AgentResult) => {
    try {
      onResult?.(result);
    } catch {
      /* swallow */
    }
  };

  const allResults: AgentResult[] = [];

  // Run regular agents as a batch
  if (batchAgents.length > 0) {
    const batchResults = await executeAgentBatch(batchAgents, context, group.provider, group.model);
    for (const result of batchResults) {
      safeOnResult(result);
    }
    allResults.push(...batchResults);
  }

  // Run tool-using agents individually (they need the tool loop)
  for (const agent of toolAgents) {
    const result = await executeAgent(agent, context, agent.provider, agent.model, agent.toolContext);
    safeOnResult(result);
    allResults.push(result);
  }

  return allResults;
}

/**
 * Execute all agents for a given phase, grouped + batched.
 */
async function executePhase(
  agents: ResolvedAgent[],
  phase: string,
  context: AgentContext,
  onResult?: AgentResultCallback,
): Promise<AgentResult[]> {
  const phaseAgents = agents.filter((a) => a.phase === phase);
  if (phaseAgents.length === 0) return [];

  const groups = groupByProviderModel(phaseAgents);

  logger.debug(
    '[agent-pipeline] Phase "%s": %d agents → %d group(s) %j',
    phase,
    phaseAgents.length,
    groups.length,
    groups.map((g) => `[${g.agents.map((a) => a.type).join(", ")}] (model: ${g.model})`),
  );

  // Run groups in parallel (different providers/models can work concurrently)
  const settled = await Promise.allSettled(groups.map((group) => executeGroup(group, context, onResult)));

  const results: AgentResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const entry = settled[i]!;
    if (entry.status === "fulfilled") {
      results.push(...entry.value);
    } else {
      // Group rejected — log and produce error results so they're visible
      const group = groups[i]!;
      if (entry.reason instanceof Error) {
        logger.error(
          entry.reason,
          '[agent-pipeline] Group REJECTED in phase "%s": [%s]',
          phase,
          group.agents.map((a) => a.type).join(", "),
        );
      } else {
        logger.error(
          '[agent-pipeline] Group REJECTED in phase "%s": [%s] %s',
          phase,
          group.agents.map((a) => a.type).join(", "),
          String(entry.reason),
        );
      }
      for (const agent of group.agents) {
        const errorResult: AgentResult = {
          agentId: agent.id,
          agentType: agent.type,
          type: "context_injection",
          data: null,
          tokensUsed: 0,
          durationMs: 0,
          success: false,
          error: entry.reason instanceof Error ? entry.reason.message : "Agent group execution failed",
        };
        try {
          onResult?.(errorResult);
        } catch {
          /* swallow */
        }
        results.push(errorResult);
      }
    }
  }
  return results;
}

// ──────────────────────────────────────────────
// Phase Runners
// ──────────────────────────────────────────────

/**
 * Run pre-generation agents (batched per provider+model).
 * Returns text snippets to inject into the main prompt.
 */
export async function runPreGenerationAgents(
  agents: ResolvedAgent[],
  context: AgentContext,
  onResult?: AgentResultCallback,
  agentTypeFilter?: (agentType: string) => boolean,
): Promise<AgentInjection[]> {
  const filtered = agentTypeFilter ? agents.filter((a) => agentTypeFilter(a.type)) : agents;
  const results = await executePhase(filtered, "pre_generation", context, onResult);

  const injections: AgentInjection[] = [];
  for (const result of results) {
    if (!result.success) continue;

    // prose-guardian & director produce text to inject
    if (result.type === "context_injection" || result.type === "director_event") {
      const text = typeof result.data === "string" ? result.data : ((result.data as any)?.text ?? "");
      if (text) injections.push({ agentType: result.agentType, text });
    }
    // prompt_review is informational — the onResult callback streams it
  }

  return injections;
}

/**
 * Run post-processing agents (batched per provider+model).
 * Returns all results for the caller to apply.
 */
export async function runPostProcessingAgents(
  agents: ResolvedAgent[],
  context: AgentContext,
  onResult?: AgentResultCallback,
): Promise<AgentResult[]> {
  return executePhase(agents, "post_processing", context, onResult);
}

/**
 * Run parallel-phase agents (batched per provider+model).
 */
export async function runParallelAgents(
  agents: ResolvedAgent[],
  context: AgentContext,
  onResult?: AgentResultCallback,
): Promise<AgentResult[]> {
  return executePhase(agents, "parallel", context, onResult);
}

// ──────────────────────────────────────────────
// Full Pipeline (convenience wrapper)
// ──────────────────────────────────────────────

export interface AgentPipelineResult {
  /** Text snippets injected before generation (from pre-gen agents) */
  contextInjections: string[];
  /** All agent results from every phase */
  allResults: AgentResult[];
}

/**
 * Run ALL enabled agents across the full pipeline.
 * Call `runPreGeneration` before generating, fire `runParallel` concurrently
 * with the main generation, then call `postGenerate` after the response is
 * complete, passing the final response text.
 *
 * Within each phase, agents that share the same provider+model are
 * batched into a single LLM call.
 */
export function createAgentPipeline(
  agents: ResolvedAgent[],
  baseContext: AgentContext,
  onResult?: AgentResultCallback,
) {
  const allResults: AgentResult[] = [];

  const wrappedOnResult: AgentResultCallback = (result) => {
    allResults.push(result);
    onResult?.(result);
  };

  return {
    /**
     * Phase 1: Run pre-generation agents.
     * Returns context injection strings to prepend to the prompt.
     */
    async preGenerate(agentTypeFilter?: (agentType: string) => boolean): Promise<AgentInjection[]> {
      return runPreGenerationAgents(agents, baseContext, wrappedOnResult, agentTypeFilter);
    },

    /**
     * Phase 2: Run parallel agents alongside the main generation.
     * Called concurrently with the main LLM call — agents use the
     * base context without mainResponse (since it doesn't exist yet).
     */
    async runParallel(): Promise<AgentResult[]> {
      return runParallelAgents(agents, baseContext, wrappedOnResult);
    },

    /**
     * Phase 3: Run post-processing agents after the main response.
     * Must be called after the main response is available.
     */
    async postGenerate(mainResponse: string): Promise<AgentResult[]> {
      const fullContext: AgentContext = {
        ...baseContext,
        mainResponse,
      };

      return runPostProcessingAgents(agents, fullContext, wrappedOnResult);
    },

    /** All results collected so far. */
    get results() {
      return allResults;
    },
  };
}
