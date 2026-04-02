import type { FastifyInstance } from "fastify";
import { BUILT_IN_AGENTS, type AgentContext, type AgentResult } from "@marinara-engine/shared";
import { eq } from "drizzle-orm";
import type { ResolvedAgent } from "../../services/agents/agent-pipeline.js";
import { executeAgentBatch } from "../../services/agents/agent-executor.js";
import { createLLMProvider } from "../../services/llm/provider-registry.js";
import { createAgentsStorage } from "../../services/storage/agents.storage.js";
import { createCharactersStorage } from "../../services/storage/characters.storage.js";
import { createChatsStorage } from "../../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../../services/storage/connections.storage.js";
import { createGameStateStorage } from "../../services/storage/game-state.storage.js";
import { createLorebooksStorage } from "../../services/storage/lorebooks.storage.js";
import { gameStateSnapshots as gameStateSnapshotsTable } from "../../db/schema/index.js";
import { parseExtra, parseGameStateRow, resolveBaseUrl } from "./generate-route-utils.js";
import { sendSseEvent, startSseReply } from "./sse.js";

type PersonaContext = {
  personaName: string;
  personaDescription: string;
  personaFields: { personality?: string; scenario?: string; backstory?: string; appearance?: string };
  personaStats: any;
  rpgStats: any;
};

type ResolvedRetryAgent = {
  cfg: any;
  resolved: ResolvedAgent;
  agentProvider: any;
  agentModel: string;
};

function parseJsonIfString<T>(value: T | string): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

async function resolvePersonaContext(chars: ReturnType<typeof createCharactersStorage>, chat: any): Promise<PersonaContext> {
  let personaName = "User";
  let personaDescription = "";
  let personaFields: PersonaContext["personaFields"] = {};
  let personaStats: any = null;
  let rpgStats: any = null;

  const allPersonas = await chars.listPersonas();
  const persona =
    (chat.personaId ? allPersonas.find((p: any) => p.id === chat.personaId) : null) ??
    allPersonas.find((p: any) => p.isActive === "true");

  if (!persona) {
    return { personaName, personaDescription, personaFields, personaStats, rpgStats };
  }

  personaName = persona.name;
  personaDescription = persona.description;
  personaFields = {
    personality: persona.personality ?? "",
    scenario: persona.scenario ?? "",
    backstory: persona.backstory ?? "",
    appearance: persona.appearance ?? "",
  };

  if (persona.altDescriptions) {
    try {
      const altDescs = parseJsonIfString<Array<{ active: boolean; content: string }>>(persona.altDescriptions);
      for (const ext of altDescs) {
        if (ext.active && ext.content) {
          personaDescription += "\n" + ext.content;
        }
      }
    } catch {
      // Ignore malformed JSON in legacy rows.
    }
  }

  if (persona.personaStats) {
    try {
      const parsed = parseJsonIfString<any>(persona.personaStats);
      if (parsed?.enabled) personaStats = parsed;
      if (parsed?.rpgStats?.enabled) rpgStats = parsed.rpgStats;
    } catch {
      // Ignore malformed JSON in legacy rows.
    }
  }

  return { personaName, personaDescription, personaFields, personaStats, rpgStats };
}

async function buildRetryAgentContext(args: {
  chatId: string;
  chat: any;
  chatMeta: Record<string, unknown>;
  recentMessages: any[];
  enabledConfigs: any[];
  lastAssistant: any;
  chars: ReturnType<typeof createCharactersStorage>;
  gameStateStore: ReturnType<typeof createGameStateStorage>;
  lorebooksStore: ReturnType<typeof createLorebooksStorage>;
}) {
  const { chatId, chat, chatMeta, recentMessages, enabledConfigs, lastAssistant, chars, gameStateStore, lorebooksStore } = args;

  const characterIds: string[] =
    typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : (chat.characterIds ?? []);
  const charInfo: Array<{ id: string; name: string; description: string }> = [];
  for (const cid of characterIds) {
    const charRow = await chars.getById(cid);
    if (!charRow) continue;
    const charData = parseJsonIfString<Record<string, unknown>>(charRow.data as string);
    charInfo.push({
      id: cid,
      name: (charData.name as string | undefined) ?? "Unknown",
      description: (charData.description as string | undefined) ?? "",
    });
  }

  const personaContext = await resolvePersonaContext(chars, chat);
  const agentContextSize =
    enabledConfigs.length > 0
      ? Math.max(
          ...enabledConfigs.map((c: any) => {
            const settings = typeof c.settings === "string" ? JSON.parse(c.settings) : (c.settings ?? {});
            return (settings.contextSize as number) || 5;
          }),
        )
      : 5;

  const agentSlice = recentMessages.slice(-agentContextSize);
  const retryAssistantMsgIds = agentSlice
    .filter((message: any) => message.role === "assistant")
    .map((message: any) => message.id as string);
  const retryCommittedSnapshots = await gameStateStore.getCommittedForMessages(retryAssistantMsgIds);

  const agentContext: AgentContext = {
    chatId,
    chatMode: (chat as any).mode ?? "conversation",
    recentMessages: agentSlice.map((message: any) => {
      const nextMessage: AgentContext["recentMessages"][number] = {
        role: message.role,
        content: message.content,
        characterId: message.characterId ?? undefined,
      };
      if (message.role === "assistant") {
        const snapRow = retryCommittedSnapshots.get(message.id as string);
        if (snapRow) {
          nextMessage.gameState = parseGameStateRow(snapRow as Record<string, unknown>);
        }
      }
      return nextMessage;
    }),
    mainResponse: lastAssistant?.content ?? "",
    gameState: null,
    characters: charInfo,
    persona:
      personaContext.personaName !== "User"
        ? {
            name: personaContext.personaName,
            description: personaContext.personaDescription,
            personality: personaContext.personaFields.personality || undefined,
            backstory: personaContext.personaFields.backstory || undefined,
            appearance: personaContext.personaFields.appearance || undefined,
            scenario: personaContext.personaFields.scenario || undefined,
            ...(personaContext.personaStats ? { personaStats: personaContext.personaStats } : {}),
            ...(personaContext.rpgStats ? { rpgStats: personaContext.rpgStats } : {}),
          }
        : null,
    activatedLorebookEntries: null,
    writableLorebookIds: null,
    chatSummary: ((chatMeta.summary as string) ?? "").trim() || null,
    memory: {},
  };

  const enabledBooks = await lorebooksStore.list();
  agentContext.writableLorebookIds = enabledBooks
    .filter((book: any) => book.enabled === true || book.enabled === "true")
    .map((book: any) => book.id);

  const latestGS = await gameStateStore.getLatestCommitted(chatId);
  if (latestGS) {
    agentContext.gameState = parseGameStateRow(latestGS as Record<string, unknown>);
  }

  return agentContext;
}

async function resolveRetryAgents(args: {
  agentTypes: string[];
  chat: any;
  conns: ReturnType<typeof createConnectionsStorage>;
  agentsStore: ReturnType<typeof createAgentsStorage>;
}) {
  const { agentTypes, chat, conns, agentsStore } = args;
  const agentTypeSet = new Set(agentTypes);
  const configs = await agentsStore.list();
  const enabledConfigs = configs.filter((config: any) => agentTypeSet.has(config.type));
  const resolvedTypeSet = new Set(enabledConfigs.map((config: any) => config.type));
  const builtInFallbackConfigs = BUILT_IN_AGENTS.filter(
    (agent) => agentTypeSet.has(agent.id) && !resolvedTypeSet.has(agent.id),
  );

  let connId = chat.connectionId;
  if (connId === "random") {
    const pool = await conns.listRandomPool();
    if (!pool.length) {
      throw new Error("No connections are marked for the random pool");
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    connId = picked.id;
  }

  const conn = connId ? await conns.getWithKey(connId) : null;
  if (!conn) {
    throw new Error("No connection configured");
  }

  const baseUrl = resolveBaseUrl(conn);
  if (!baseUrl) {
    throw new Error("Cannot resolve provider URL");
  }

  const provider = createLLMProvider(conn.provider, baseUrl, conn.apiKey);
  const resolvedAgents: ResolvedRetryAgent[] = [];

  for (const cfg of enabledConfigs) {
    let agentProvider = provider;
    let agentModel = conn.model;

    if (cfg.connectionId) {
      const agentConn = await conns.getWithKey(cfg.connectionId as string);
      if (agentConn) {
        const agentBaseUrl = resolveBaseUrl(agentConn);
        if (agentBaseUrl) {
          agentProvider = createLLMProvider(agentConn.provider, agentBaseUrl, agentConn.apiKey);
          agentModel = agentConn.model;
        }
      }
    }

    resolvedAgents.push({
      cfg,
      resolved: {
        id: cfg.id,
        type: cfg.type,
        name: cfg.name,
        phase: cfg.phase as string,
        promptTemplate: cfg.promptTemplate as string,
        connectionId: cfg.connectionId as string | null,
        settings: typeof cfg.settings === "string" ? JSON.parse(cfg.settings) : (cfg.settings ?? {}),
        provider: agentProvider,
        model: agentModel,
      },
      agentProvider,
      agentModel,
    });
  }

  for (const builtIn of builtInFallbackConfigs) {
    resolvedAgents.push({
      cfg: { id: `builtin:${builtIn.id}`, type: builtIn.id, name: builtIn.name } as any,
      resolved: {
        id: `builtin:${builtIn.id}`,
        type: builtIn.id,
        name: builtIn.name,
        phase: builtIn.phase,
        promptTemplate: "",
        connectionId: null,
        settings: {},
        provider,
        model: conn.model,
      },
      agentProvider: provider,
      agentModel: conn.model,
    });
  }

  return { conn, enabledConfigs, resolvedAgents };
}

async function executeRetryBatches(agentContext: AgentContext, resolvedAgents: ResolvedRetryAgent[]) {
  const providerModelGroups = new Map<string, { agents: ResolvedRetryAgent[]; provider: any; model: string }>();

  for (const entry of resolvedAgents) {
    const key = `${entry.agentProvider.constructor.name}::${entry.agentModel}`;
    if (!providerModelGroups.has(key)) {
      providerModelGroups.set(key, { agents: [], provider: entry.agentProvider, model: entry.agentModel });
    }
    providerModelGroups.get(key)!.agents.push(entry);
  }

  const results: AgentResult[] = [];
  const groupSettled = await Promise.allSettled(
    [...providerModelGroups.values()].map(async (group) => {
      const configs = group.agents.map((agent) => agent.resolved);
      return executeAgentBatch(configs, agentContext, group.provider, group.model);
    }),
  );

  for (const outcome of groupSettled) {
    if (outcome.status === "fulfilled") {
      results.push(...outcome.value);
    } else {
      console.error("[retry-agents] Group failed:", outcome.reason);
    }
  }

  return results;
}

async function persistRetryResults(
  agentsStore: ReturnType<typeof createAgentsStorage>,
  chatId: string,
  messageId: string,
  results: AgentResult[],
) {
  for (const result of results) {
    try {
      await agentsStore.saveRun({
        agentConfigId: result.agentId,
        chatId,
        messageId,
        result,
      });
    } catch {
      // Non-critical write; keep streaming the rest of the results.
    }
  }
}

async function applyRetryResultEffects(args: {
  app: FastifyInstance;
  reply: any;
  chatId: string;
  chat: any;
  retryMessageId: string;
  retrySwipeIndex: number;
  results: AgentResult[];
  agentContext: AgentContext;
  lorebooksStore: ReturnType<typeof createLorebooksStorage>;
  gameStateStore: ReturnType<typeof createGameStateStorage>;
}) {
  const { app, reply, chatId, chat, retryMessageId, retrySwipeIndex, results, agentContext, lorebooksStore, gameStateStore } = args;
  const sortedResults = [...results].sort((a, b) => (a.type === "game_state_update" ? 0 : 1) - (b.type === "game_state_update" ? 0 : 1));

  for (const result of sortedResults) {
    if (result.success && result.type === "game_state_update" && result.data && typeof result.data === "object") {
      try {
        const gs = result.data as Record<string, unknown>;
        const worldStatePatch: Record<string, unknown> = {};
        if (gs.date != null) worldStatePatch.date = gs.date as string;
        if (gs.time != null) worldStatePatch.time = gs.time as string;
        if (gs.location != null) worldStatePatch.location = gs.location as string;
        if (gs.weather != null) worldStatePatch.weather = gs.weather as string;
        if (gs.temperature != null) worldStatePatch.temperature = gs.temperature as string;
        if (Object.keys(worldStatePatch).length > 0) {
          await gameStateStore.updateByMessage(retryMessageId, retrySwipeIndex, chatId, worldStatePatch as any);
        }
        sendSseEvent(reply, { type: "game_state_patch", data: worldStatePatch });
      } catch {
        // Non-critical patching failure.
      }
    }

    if (result.success && result.type === "character_tracker_update" && result.data && typeof result.data === "object") {
      try {
        const ctData = result.data as Record<string, unknown>;
        const presentCharacters = (ctData.presentCharacters as any[]) ?? [];
        await gameStateStore.updateByMessage(retryMessageId, retrySwipeIndex, chatId, {
          presentCharacters,
        });
        sendSseEvent(reply, { type: "game_state_patch", data: { presentCharacters } });
      } catch {
        // Non-critical patching failure.
      }
    }

    if (result.success && result.type === "persona_stats_update" && result.data && typeof result.data === "object") {
      try {
        const psData = result.data as Record<string, unknown>;
        const bars = (psData.stats as any[]) ?? [];
        const status = (psData.status as string) ?? "";
        const inventory = (psData.inventory as any[]) ?? [];
        const latest =
          (await gameStateStore.getByMessage(retryMessageId, retrySwipeIndex)) ?? (await gameStateStore.getLatest(chatId));
        if (latest) {
          const updates: Record<string, unknown> = {};
          if (bars.length > 0) updates.personaStats = JSON.stringify(bars);
          const existingPS = latest.playerStats
            ? typeof latest.playerStats === "string"
              ? JSON.parse(latest.playerStats)
              : latest.playerStats
            : { stats: [], attributes: null, skills: {}, inventory: [], activeQuests: [], status: "" };
          const mergedPS = { ...existingPS };
          if (status) mergedPS.status = status;
          if (inventory.length > 0) mergedPS.inventory = inventory;
          updates.playerStats = JSON.stringify(mergedPS);
          await app.db.update(gameStateSnapshotsTable).set(updates).where(eq(gameStateSnapshotsTable.id, latest.id));
        }
        const patchData: Record<string, unknown> = {};
        if (bars.length > 0) patchData.personaStats = bars;
        if (status || inventory.length > 0) {
          patchData.playerStats = {
            status: status || undefined,
            inventory: inventory.length > 0 ? inventory : undefined,
          };
        }
        sendSseEvent(reply, { type: "game_state_patch", data: patchData });
      } catch {
        // Non-critical patching failure.
      }
    }

    if (result.success && result.type === "lorebook_update" && result.data && typeof result.data === "object") {
      try {
        const lkData = result.data as Record<string, unknown>;
        const retryUpdates = (lkData.updates as any[]) ?? [];
        if (retryUpdates.length > 0) {
          let targetLorebookId: string | null = null;
          if (agentContext.writableLorebookIds && agentContext.writableLorebookIds.length > 0) {
            targetLorebookId = agentContext.writableLorebookIds[0] ?? null;
          } else {
            const created = await lorebooksStore.create({
              name: `Auto-generated (${(chat as any).name || chatId})`,
              description: "Automatically created by the Lorebook Keeper agent",
              category: "uncategorized",
              chatId: chatId ?? null,
              enabled: true,
              generatedBy: "agent",
              sourceAgentId: "lorebook-keeper",
            });
            if (created) targetLorebookId = (created as any).id;
          }
          if (targetLorebookId) {
            const existingEntries = await lorebooksStore.listEntries(targetLorebookId);
            const entryByName = new Map(existingEntries.map((entry: any) => [entry.name?.toLowerCase(), entry]));
            for (const update of retryUpdates) {
              const name = (update.entryName as string) ?? "";
              const content = (update.content as string) ?? "";
              const keys = (update.keys as string[]) ?? [];
              const tag = (update.tag as string) ?? "";
              const action = (update.action as string) ?? "create";
              const existing = entryByName.get(name.toLowerCase());

              if (existing && (existing.locked === true || existing.locked === "true")) {
                continue;
              }

              if (action === "create" && existing) {
                await lorebooksStore.updateEntry(existing.id, { content, keys, tag });
              } else if (action === "update" && existing) {
                await lorebooksStore.updateEntry(existing.id, { content, keys, tag });
              } else {
                await lorebooksStore.createEntry({
                  lorebookId: targetLorebookId,
                  name,
                  content,
                  keys,
                  tag,
                  enabled: true,
                });
              }
            }
          }
        }
      } catch {
        // Non-critical patching failure.
      }
    }

    if (result.success && result.type === "quest_update" && result.data && typeof result.data === "object") {
      try {
        const qData = result.data as Record<string, unknown>;
        const updates = (qData.updates as any[]) ?? [];
        console.log(
          `[retry-agents] Quest agent result — updates: ${updates.length}, data keys: ${Object.keys(qData).join(",")}`,
          JSON.stringify(qData).slice(0, 500),
        );
        if (updates.length > 0) {
          const snap =
            (await gameStateStore.getByMessage(retryMessageId, retrySwipeIndex)) ?? (await gameStateStore.getLatest(chatId));
          const existingPS = snap?.playerStats
            ? typeof snap.playerStats === "string"
              ? JSON.parse(snap.playerStats)
              : snap.playerStats
            : { stats: [], attributes: null, skills: {}, inventory: [], activeQuests: [], status: "" };
          const originalQuests: any[] = existingPS.activeQuests ?? [];
          const quests: any[] = [...originalQuests];
          for (const update of updates) {
            const idx = quests.findIndex((quest: any) => quest.name === update.questName);
            if (update.action === "create" && idx === -1) {
              quests.push({
                questEntryId: update.questName,
                name: update.questName,
                currentStage: 0,
                objectives: update.objectives ?? [],
                completed: false,
              });
            } else if (idx !== -1) {
              if (update.action === "update") {
                if (update.objectives) quests[idx].objectives = update.objectives;
              } else if (update.action === "complete") {
                quests[idx].completed = true;
                if (update.objectives) quests[idx].objectives = update.objectives;
              } else if (update.action === "fail") {
                quests.splice(idx, 1);
              }
            }
          }
          const changed = JSON.stringify(quests) !== JSON.stringify(originalQuests);
          if (changed) {
            const mergedPS = { ...existingPS, activeQuests: quests };
            if (snap) {
              await app.db
                .update(gameStateSnapshotsTable)
                .set({ playerStats: JSON.stringify(mergedPS) })
                .where(eq(gameStateSnapshotsTable.id, snap.id));
            }
            sendSseEvent(reply, { type: "game_state_patch", data: { playerStats: { activeQuests: quests } } });
          }
        }
      } catch {
        // Non-critical patching failure.
      }
    }

    if (result.success && result.type === "custom_tracker_update" && result.data && typeof result.data === "object") {
      try {
        const ctData = result.data as Record<string, unknown>;
        const fields = (ctData.fields as any[]) ?? [];
        if (fields.length > 0) {
          const snap =
            (await gameStateStore.getByMessage(retryMessageId, retrySwipeIndex)) ?? (await gameStateStore.getLatest(chatId));
          if (snap) {
            const existingPS = snap.playerStats
              ? typeof snap.playerStats === "string"
                ? JSON.parse(snap.playerStats)
                : snap.playerStats
              : { stats: [], attributes: null, skills: {}, inventory: [], activeQuests: [], status: "" };
            const mergedPS = { ...existingPS, customTrackerFields: fields };
            await app.db
              .update(gameStateSnapshotsTable)
              .set({ playerStats: JSON.stringify(mergedPS) })
              .where(eq(gameStateSnapshotsTable.id, snap.id));
          }
          sendSseEvent(reply, { type: "game_state_patch", data: { playerStats: { customTrackerFields: fields } } });
        }
      } catch {
        // Non-critical patching failure.
      }
    }
  }
}

export async function registerRetryAgentsRoute(app: FastifyInstance) {
  const chats = createChatsStorage(app.db);
  const conns = createConnectionsStorage(app.db);
  const chars = createCharactersStorage(app.db);
  const agentsStore = createAgentsStorage(app.db);
  const gameStateStore = createGameStateStorage(app.db);
  const lorebooksStore = createLorebooksStorage(app.db);

  app.post<{ Body: { chatId: string; agentTypes: string[] } }>("/retry-agents", async (request, reply) => {
    const { chatId, agentTypes } = request.body;
    if (!chatId || !agentTypes?.length) {
      return reply.status(400).send({ error: "chatId and agentTypes are required" });
    }

    startSseReply(reply);

    try {
      const chat = await chats.getById(chatId);
      if (!chat) {
        throw new Error("Chat not found");
      }

      const chatMeta = parseExtra(chat.metadata);
      const recentMessages = await chats.listMessages(chatId);
      const lastAssistant = [...recentMessages].reverse().find((message: any) => message.role === "assistant");
      const { enabledConfigs, resolvedAgents } = await resolveRetryAgents({
        agentTypes,
        chat,
        conns,
        agentsStore,
      });
      const agentContext = await buildRetryAgentContext({
        chatId,
        chat,
        chatMeta,
        recentMessages,
        enabledConfigs,
        lastAssistant,
        chars,
        gameStateStore,
        lorebooksStore,
      });

      sendSseEvent(reply, { type: "agent_start", data: { phase: "retry" } });
      const results = await executeRetryBatches(agentContext, resolvedAgents);

      for (const result of results) {
        const cfg = resolvedAgents.find((entry) => entry.resolved.type === result.agentType)?.cfg;
        sendSseEvent(reply, {
          type: "agent_result",
          data: {
            agentType: result.agentType,
            agentName: cfg?.name ?? result.agentType,
            resultType: result.type,
            data: result.data,
            success: result.success,
            error: result.error,
            durationMs: result.durationMs,
          },
        });
      }

      const retryMessageId = lastAssistant?.id ?? "";
      const retrySwipeIndex = lastAssistant?.activeSwipeIndex ?? 0;
      await persistRetryResults(agentsStore, chatId, retryMessageId, results);
      await applyRetryResultEffects({
        app,
        reply,
        chatId,
        chat,
        retryMessageId,
        retrySwipeIndex,
        results,
        agentContext,
        lorebooksStore,
        gameStateStore,
      });

      sendSseEvent(reply, { type: "done", data: "" });
    } catch (err) {
      const message =
        err instanceof Error
          ? (err as { cause?: unknown }).cause instanceof Error
            ? `${err.message}: ${(err as { cause?: Error }).cause!.message}`
            : err.message
          : "Agent retry failed";
      sendSseEvent(reply, { type: "error", data: message });
    } finally {
      reply.raw.end();
    }
  });
}
