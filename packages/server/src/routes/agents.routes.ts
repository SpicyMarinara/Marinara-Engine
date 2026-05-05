// ──────────────────────────────────────────────
// Routes: Agents
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import {
  createAgentConfigSchema,
  updateAgentConfigSchema,
  BUILT_IN_AGENTS,
  getDefaultBuiltInAgentSettings,
} from "@marinara-engine/shared";
import { createAgentsStorage } from "../services/storage/agents.storage.js";
import { z } from "zod";

const updateAgentRunSchema = z.object({
  resultData: z.unknown(),
});

const secretPlotArcSchema = z
  .object({
    description: z.string().optional(),
    protagonistArc: z.string().optional(),
    completed: z.boolean().optional(),
  })
  .passthrough();

const secretPlotMemoryPatchSchema = z
  .object({
    overarchingArc: z.union([z.string(), secretPlotArcSchema, z.null()]).optional(),
    sceneDirections: z
      .union([
        z.array(
          z.object({
            direction: z.string(),
            fulfilled: z.boolean().optional(),
          }),
        ),
        z.null(),
      ])
      .optional(),
    recentlyFulfilled: z.union([z.array(z.string()), z.null()]).optional(),
    staleDetected: z.union([z.boolean(), z.null()]).optional(),
    pacing: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();

function normalizeSecretPlotMemoryPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const parsed = secretPlotMemoryPatchSchema.parse(patch);
  const normalized: Record<string, unknown> = { ...parsed };
  if ("sceneDirections" in parsed) normalized.sceneDirections = parsed.sceneDirections ?? [];
  if ("recentlyFulfilled" in parsed) normalized.recentlyFulfilled = parsed.recentlyFulfilled ?? [];
  if ("staleDetected" in parsed) normalized.staleDetected = parsed.staleDetected === true;
  return normalized;
}

export async function agentsRoutes(app: FastifyInstance) {
  const storage = createAgentsStorage(app.db);
  const getOrCreateConfigByType = async (agentType: string) => {
    const existing = await storage.getByType(agentType);
    if (existing) return existing;
    const builtIn = BUILT_IN_AGENTS.find((a) => a.id === agentType);
    if (!builtIn) return null;
    return storage.create({
      type: builtIn.id,
      name: builtIn.name,
      description: builtIn.description,
      phase: builtIn.phase,
      enabled: builtIn.enabledByDefault,
      connectionId: null,
      promptTemplate: "",
      settings: getDefaultBuiltInAgentSettings(builtIn.id),
    });
  };

  app.get("/", async () => {
    return storage.list();
  });

  /** Get editable custom-agent outputs for a roleplay chat. */
  app.get<{ Params: { chatId: string }; Querystring: { limit?: string } }>("/runs/:chatId/custom", async (req) => {
    const parsedLimit = req.query.limit ? Number.parseInt(req.query.limit, 10) : undefined;
    return storage.listCustomRunsForChat(req.params.chatId, parsedLimit);
  });

  /** Edit the persisted output of a custom agent run. */
  app.patch<{ Params: { runId: string } }>("/runs/:runId", async (req, reply) => {
    const input = updateAgentRunSchema.parse(req.body);
    const run = await storage.getRunWithConfig(req.params.runId);
    if (!run) return reply.status(404).send({ error: "Agent run not found" });
    if (BUILT_IN_AGENTS.some((agent) => agent.id === run.agentType)) {
      return reply.status(403).send({ error: "Built-in agent runs are not editable here" });
    }
    return storage.updateRunResultData(req.params.runId, input.resultData);
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const agent = await storage.getById(req.params.id);
    if (!agent) return reply.status(404).send({ error: "Agent not found" });
    return agent;
  });

  app.post("/", async (req) => {
    const input = createAgentConfigSchema.parse(req.body);
    return storage.create(input);
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    const data = updateAgentConfigSchema.parse(req.body);
    return storage.update(req.params.id, data);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    try {
      await storage.remove(req.params.id);
      return reply.status(204).send();
    } catch (err) {
      req.log.error(err, "Failed to delete agent %s", req.params.id);
      return reply.status(500).send({ error: "Failed to delete agent. Try restarting the server and retrying." });
    }
  });

  /** Toggle a built-in agent by type. Creates config if first toggle. */
  app.put<{ Params: { agentType: string } }>("/toggle/:agentType", async (req, reply) => {
    const { agentType } = req.params;
    const builtIn = BUILT_IN_AGENTS.find((a) => a.id === agentType);
    if (!builtIn) {
      return reply.status(404).send({ error: "Unknown agent type" });
    }

    const existing = await storage.getByType(agentType);
    if (existing) {
      const currentEnabled = existing.enabled === "true";
      return storage.update(existing.id, { enabled: !currentEnabled });
    }

    // First toggle — create with opposite of default
    return storage.create({
      type: builtIn.id,
      name: builtIn.name,
      description: builtIn.description,
      phase: builtIn.phase,
      enabled: !builtIn.enabledByDefault,
      connectionId: null,
      promptTemplate: "",
      settings: builtIn.defaultInjectAsSection ? { injectAsSection: true } : {},
    });
  });

  /** Get echo chamber messages for a chat (for persistence across refreshes). */
  app.get<{ Params: { chatId: string } }>("/echo-messages/:chatId", async (req) => {
    return storage.getEchoMessages(req.params.chatId);
  });

  /** Clear all echo chamber messages for a chat. */
  app.delete<{ Params: { chatId: string } }>("/echo-messages/:chatId", async (req, reply) => {
    await storage.clearEchoMessages(req.params.chatId);
    return reply.status(204).send();
  });

  /** Clear all agent runs and memory for a specific chat. */
  app.delete<{ Params: { chatId: string } }>("/runs/:chatId", async (req, reply) => {
    const chatId = req.params.chatId;

    // Before wiping all memory, preserve the secret-plot-driver's overarching arc.
    // Scene directions + pacing are cleared (ephemeral per-generation), but the arc
    // is a long-term structure that only clears when the agent is removed from the chat.
    let preservedArc: unknown = null;
    let secretPlotConfigId: string | null = null;
    try {
      const secretPlotConfig = await storage.getByType("secret-plot-driver");
      if (secretPlotConfig) {
        secretPlotConfigId = secretPlotConfig.id;
        const mem = await storage.getMemory(secretPlotConfigId, chatId);
        if (mem.overarchingArc) preservedArc = mem.overarchingArc;
      }
    } catch {
      /* non-critical */
    }

    await storage.clearRunsForChat(chatId);
    await storage.clearMemoryForChat(chatId);

    // Restore the overarching arc
    if (preservedArc && secretPlotConfigId) {
      try {
        await storage.setMemory(secretPlotConfigId, chatId, "overarchingArc", preservedArc);
      } catch {
        /* non-critical */
      }
    }

    return reply.status(204).send();
  });

  /** Read persistent memory for an agent in a chat (JSON values). */
  app.get<{ Params: { agentType: string; chatId: string } }>("/memory/:agentType/:chatId", async (req, reply) => {
    const config = await getOrCreateConfigByType(req.params.agentType);
    if (!config) {
      return reply.status(404).send({ error: "Agent is not configured" });
    }
    const memory = await storage.getMemory(config.id, req.params.chatId);
    return { agentConfigId: config.id, memory };
  });

  /** Patch memory keys for an agent in a chat. Body: { patch: { key: value, ... } } */
  app.patch<{
    Params: { agentType: string; chatId: string };
    Body: { patch?: Record<string, unknown> };
  }>("/memory/:agentType/:chatId", async (req, reply) => {
    const config = await getOrCreateConfigByType(req.params.agentType);
    if (!config) {
      return reply.status(404).send({ error: "Agent is not configured" });
    }
    const body = (req.body ?? {}) as { patch?: Record<string, unknown> };
    const patch = body.patch;
    if (!patch || typeof patch !== "object") {
      return reply.status(400).send({ error: "Body must be { patch: { key: value, ... } }" });
    }
    let normalizedPatch: Record<string, unknown>;
    try {
      normalizedPatch =
        req.params.agentType === "secret-plot-driver" ? normalizeSecretPlotMemoryPatch(patch) : patch;
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          error: "Invalid Secret Plot memory patch",
          issues: err.issues,
        });
      }
      throw err;
    }
    for (const [key, value] of Object.entries(normalizedPatch)) {
      if (value === undefined) continue;
      await storage.setMemory(config.id, req.params.chatId, key, value);
    }
    const memory = await storage.getMemory(config.id, req.params.chatId);
    return { agentConfigId: config.id, memory };
  });

  /** Clear all memory for a specific agent in a specific chat (used when removing an agent from a chat). */
  app.delete<{ Params: { agentType: string; chatId: string } }>("/memory/:agentType/:chatId", async (req, reply) => {
    const config = await storage.getByType(req.params.agentType);
    if (config) {
      await storage.clearMemoryForAgentInChat(config.id, req.params.chatId);
    }
    return reply.status(204).send();
  });
}
