import type { FastifyInstance } from "fastify";
import { logger } from "../../lib/logger.js";
import {
  BUILT_IN_AGENTS,
  LOCAL_SIDECAR_CONNECTION_ID,
  type AgentContext,
  type AgentResult,
} from "@marinara-engine/shared";
import { eq } from "drizzle-orm";
import { listCharacterSprites } from "../../services/game/sprite.service.js";
import { DATA_DIR } from "../../utils/data-dir.js";
import type { ResolvedAgent } from "../../services/agents/agent-pipeline.js";
import { executeAgent, executeAgentBatch } from "../../services/agents/agent-executor.js";
import { getLocalSidecarProvider, LOCAL_SIDECAR_MODEL } from "../../services/llm/local-sidecar.js";
import { createLLMProvider } from "../../services/llm/provider-registry.js";
import { sidecarModelService } from "../../services/sidecar/sidecar-model.service.js";
import { createAgentsStorage } from "../../services/storage/agents.storage.js";
import { createCharactersStorage } from "../../services/storage/characters.storage.js";
import { createChatsStorage } from "../../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../../services/storage/connections.storage.js";
import { createGameStateStorage } from "../../services/storage/game-state.storage.js";
import { createLorebooksStorage } from "../../services/storage/lorebooks.storage.js";
import { syncGameMapMetaPartyPosition } from "../../services/game/map-position.service.js";
import { gameStateSnapshots as gameStateSnapshotsTable } from "../../db/schema/index.js";
import { parseExtra, parseGameStateRow, resolveBaseUrl } from "./generate-route-utils.js";
import {
  buildHistoricalLorebookKeeperContext,
  getLorebookKeeperBackfillTargets,
  getLorebookKeeperSettings,
  loadLorebookKeeperExistingEntries,
  persistLorebookKeeperUpdates,
  resolveLorebookKeeperTarget,
} from "./lorebook-keeper-utils.js";
import { sendSseEvent, startSseReply } from "./sse.js";
import type { GameMap } from "@marinara-engine/shared";

type PersonaContext = {
  personaId: string | null;
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

async function resolvePersonaContext(
  chars: ReturnType<typeof createCharactersStorage>,
  chat: any,
): Promise<PersonaContext> {
  let personaName = "User";
  let personaId: string | null = null;
  let personaDescription = "";
  let personaFields: PersonaContext["personaFields"] = {};
  let personaStats: any = null;
  let rpgStats: any = null;

  const allPersonas = await chars.listPersonas();
  const persona =
    (chat.personaId ? allPersonas.find((p: any) => p.id === chat.personaId) : null) ??
    allPersonas.find((p: any) => p.isActive === "true");

  if (!persona) {
    return { personaId, personaName, personaDescription, personaFields, personaStats, rpgStats };
  }

  personaId = persona.id as string;
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

  return { personaId, personaName, personaDescription, personaFields, personaStats, rpgStats };
}

async function buildRetryAgentContext(args: {
  chatId: string;
  chat: any;
  chatMeta: Record<string, unknown>;
  recentMessages: any[];
  enabledConfigs: any[];
  resolvedAgentTypes: Set<string>;
  lastAssistant: any;
  chars: ReturnType<typeof createCharactersStorage>;
  gameStateStore: ReturnType<typeof createGameStateStorage>;
  lorebooksStore: ReturnType<typeof createLorebooksStorage>;
  streaming: boolean;
}) {
  const {
    chatId,
    chat,
    chatMeta,
    recentMessages,
    enabledConfigs,
    resolvedAgentTypes,
    lastAssistant,
    chars,
    gameStateStore,
    lorebooksStore,
    streaming,
  } = args;

  const characterIds: string[] =
    typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : (chat.characterIds ?? []);
  const activeLorebookIds: string[] = Array.isArray(chatMeta.activeLorebookIds)
    ? (chatMeta.activeLorebookIds as string[])
    : [];
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
    streaming,
    memory: {},
  };

  const lorebookKeeperSettings = getLorebookKeeperSettings(chatMeta);
  const { writableLorebookIds, targetLorebookId, targetLorebookName } = await resolveLorebookKeeperTarget({
    lorebooksStore,
    chatId,
    characterIds,
    personaId: personaContext.personaId,
    activeLorebookIds,
    preferredTargetLorebookId: lorebookKeeperSettings.targetLorebookId,
  });
  agentContext.writableLorebookIds = writableLorebookIds;
  if (targetLorebookId) {
    agentContext.memory._lorebookKeeperTargetLorebookId = targetLorebookId;
  }
  if (targetLorebookName) {
    agentContext.memory._lorebookKeeperTargetLorebookName = targetLorebookName;
  }
  const existingEntries = await loadLorebookKeeperExistingEntries(lorebooksStore, targetLorebookId);
  if (existingEntries.length > 0) {
    agentContext.memory._existingLorebookEntries = existingEntries;
  }

  const latestGS = await gameStateStore.getLatestCommitted(chatId);
  if (latestGS) {
    agentContext.gameState = parseGameStateRow(latestGS as Record<string, unknown>);
  }

  // If the expression agent is being retried, load available sprite expressions per character
  if (resolvedAgentTypes.has("expression")) {
    try {
      const perChar: Array<{ characterId: string; characterName: string; expressions: string[] }> = [];
      for (const char of agentContext.characters) {
        const sprites = listCharacterSprites(char.id);
        if (sprites && sprites.expressions.length > 0) {
          perChar.push({ characterId: char.id, characterName: char.name, expressions: sprites.expressions });
        }
      }
      if (perChar.length > 0) {
        agentContext.memory._availableSprites = perChar;
      }
    } catch {
      /* non-critical */
    }
  }

  // If the background agent is being retried, load available backgrounds into context
  if (resolvedAgentTypes.has("background")) {
    try {
      const { readdirSync, readFileSync, existsSync } = await import("fs");
      const { join, extname } = await import("path");
      const bgDir = join(DATA_DIR, "backgrounds");
      if (existsSync(bgDir)) {
        const exts = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
        const files = readdirSync(bgDir).filter((f: string) => exts.has(extname(f).toLowerCase()));
        let meta: Record<string, { originalName?: string; tags: string[] }> = {};
        const metaPath = join(bgDir, "meta.json");
        if (existsSync(metaPath)) {
          try {
            meta = JSON.parse(readFileSync(metaPath, "utf-8"));
          } catch {
            /* */
          }
        }
        agentContext.memory._availableBackgrounds = files.map((f: string) => ({
          filename: f,
          originalName: meta[f]?.originalName ?? null,
          tags: meta[f]?.tags ?? [],
        }));
        agentContext.memory._currentBackground = chatMeta.background ?? null;
      }
    } catch {
      /* non-critical */
    }
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

  const provider = createLLMProvider(
    conn.provider,
    baseUrl,
    conn.apiKey,
    conn.maxContext,
    conn.openrouterProvider,
    conn.maxTokensOverride,
  );
  const resolvedAgents: ResolvedRetryAgent[] = [];
  const localSidecarAvailableForTrackers =
    sidecarModelService.getConfig().useForTrackers && sidecarModelService.getConfiguredModelRef() !== null;

  for (const cfg of enabledConfigs) {
    let agentProvider = provider;
    let agentModel = conn.model;

    if (cfg.connectionId) {
      if (cfg.connectionId === LOCAL_SIDECAR_CONNECTION_ID && localSidecarAvailableForTrackers) {
        agentProvider = getLocalSidecarProvider();
        agentModel = LOCAL_SIDECAR_MODEL;
      } else if (cfg.connectionId !== LOCAL_SIDECAR_CONNECTION_ID) {
        const agentConn = await conns.getWithKey(cfg.connectionId as string);
        if (agentConn) {
          const agentBaseUrl = resolveBaseUrl(agentConn);
          if (agentBaseUrl) {
            agentProvider = createLLMProvider(
              agentConn.provider,
              agentBaseUrl,
              agentConn.apiKey,
              agentConn.maxContext,
              agentConn.openrouterProvider,
              agentConn.maxTokensOverride,
            );
            agentModel = agentConn.model;
          }
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
      logger.error(outcome.reason, "[retry-agents] Group failed");
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

async function executeLorebookKeeperRetries(args: {
  lorebookKeeperAgent: ResolvedRetryAgent;
  baseContext: AgentContext;
  messages: any[];
  readBehindMessages: number;
  lastProcessedMessageId: string | null;
  backfillUnprocessed: boolean;
  lorebooksStore: ReturnType<typeof createLorebooksStorage>;
  chatId: string;
  chatName: string | null | undefined;
}): Promise<Array<{ messageId: string; result: AgentResult }>> {
  const {
    lorebookKeeperAgent,
    baseContext,
    messages,
    readBehindMessages,
    lastProcessedMessageId,
    backfillUnprocessed,
    lorebooksStore,
    chatId,
    chatName,
  } = args;

  const eligibleTargets = getLorebookKeeperBackfillTargets(messages, readBehindMessages, lastProcessedMessageId);
  const targets = backfillUnprocessed ? eligibleTargets : eligibleTargets.slice(-1);
  if (targets.length === 0) return [];

  let preferredTargetLorebookId =
    typeof baseContext.memory._lorebookKeeperTargetLorebookId === "string"
      ? (baseContext.memory._lorebookKeeperTargetLorebookId as string)
      : null;

  const results: Array<{ messageId: string; result: AgentResult }> = [];
  for (const target of targets) {
    const retryContext = buildHistoricalLorebookKeeperContext(baseContext, messages, target.id);
    if (!retryContext) continue;

    if (preferredTargetLorebookId) {
      retryContext.memory._lorebookKeeperTargetLorebookId = preferredTargetLorebookId;
    }
    const existingEntries = await loadLorebookKeeperExistingEntries(lorebooksStore, preferredTargetLorebookId);
    if (existingEntries.length > 0) {
      retryContext.memory._existingLorebookEntries = existingEntries;
    }

    const result = await executeAgent(
      lorebookKeeperAgent.resolved,
      retryContext,
      lorebookKeeperAgent.agentProvider,
      lorebookKeeperAgent.agentModel,
    );
    results.push({ messageId: target.id, result });

    if (result.success && result.type === "lorebook_update" && result.data && typeof result.data === "object") {
      const lkData = result.data as Record<string, unknown>;
      const updates = (lkData.updates as Array<Record<string, unknown>>) ?? [];
      if (updates.length > 0) {
        preferredTargetLorebookId = await persistLorebookKeeperUpdates({
          lorebooksStore,
          chatId,
          chatName,
          preferredTargetLorebookId,
          writableLorebookIds: retryContext.writableLorebookIds,
          updates,
        });
      }
    }
  }

  return results;
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
  conns: ReturnType<typeof createConnectionsStorage>;
  chars: ReturnType<typeof createCharactersStorage>;
  resolvedAgents: ResolvedRetryAgent[];
}) {
  const {
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
    conns,
    chars,
    resolvedAgents,
  } = args;
  const sortedResults = [...results].sort(
    (a, b) => (a.type === "game_state_update" ? 0 : 1) - (b.type === "game_state_update" ? 0 : 1),
  );
  const chats = createChatsStorage(app.db);
  const chatMeta = parseExtra(chat.metadata) as Record<string, unknown>;

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

        const nextLocation = typeof worldStatePatch.location === "string" ? worldStatePatch.location : null;
        const existingGameMap = (chatMeta.gameMap as GameMap | null) ?? null;
        const syncedMeta = syncGameMapMetaPartyPosition(chatMeta, nextLocation);
        const syncedGameMap = (syncedMeta.gameMap as GameMap | null) ?? null;
        if (syncedGameMap && syncedGameMap !== existingGameMap) {
          Object.assign(chatMeta, syncedMeta);
          await chats.updateMetadata(chatId, chatMeta);
          sendSseEvent(reply, { type: "game_map_update", data: syncedGameMap });
        }

        sendSseEvent(reply, { type: "game_state_patch", data: worldStatePatch });
      } catch {
        // Non-critical patching failure.
      }
    }

    if (
      result.success &&
      result.type === "character_tracker_update" &&
      result.data &&
      typeof result.data === "object"
    ) {
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
          (await gameStateStore.getByMessage(retryMessageId, retrySwipeIndex)) ??
          (await gameStateStore.getLatest(chatId));
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
          await persistLorebookKeeperUpdates({
            lorebooksStore,
            chatId,
            chatName: (chat as any).name,
            preferredTargetLorebookId:
              typeof agentContext.memory._lorebookKeeperTargetLorebookId === "string"
                ? (agentContext.memory._lorebookKeeperTargetLorebookId as string)
                : null,
            writableLorebookIds: agentContext.writableLorebookIds,
            updates: retryUpdates,
          });
        }
      } catch {
        // Non-critical patching failure.
      }
    }

    if (result.success && result.type === "quest_update" && result.data && typeof result.data === "object") {
      try {
        const qData = result.data as Record<string, unknown>;
        const updates = (qData.updates as any[]) ?? [];
        logger.debug(
          "[retry-agents] Quest agent result — updates: %d, data keys: %s %s",
          updates.length,
          Object.keys(qData).join(","),
          JSON.stringify(qData).slice(0, 500),
        );
        if (updates.length > 0) {
          const snap =
            (await gameStateStore.getByMessage(retryMessageId, retrySwipeIndex)) ??
            (await gameStateStore.getLatest(chatId));
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
            (await gameStateStore.getByMessage(retryMessageId, retrySwipeIndex)) ??
            (await gameStateStore.getLatest(chatId));
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

    // ── ILLUSTRATOR: generate image from agent prompt ──
    if (result.success && result.type === "image_prompt" && result.data && typeof result.data === "object") {
      try {
        const illData = result.data as Record<string, unknown>;
        const shouldGenerate = illData.shouldGenerate === true;
        const imagePrompt = ((illData.prompt as string) ?? "").trim();
        const negativePrompt = ((illData.negativePrompt as string) ?? "").trim();
        const style = ((illData.style as string) ?? "").trim();
        const aspectRatio = ((illData.aspectRatio as string) ?? "portrait").trim();
        const illCharacters = Array.isArray(illData.characters) ? (illData.characters as string[]) : [];

        if (shouldGenerate && imagePrompt) {
          const illustratorAgent = resolvedAgents.find(
            (a) => a.resolved.id === result.agentId || a.resolved.type === "illustrator",
          );
          let imgConnId = (illustratorAgent?.resolved.settings?.imageConnectionId as string) ?? null;
          if (!imgConnId) {
            const defaultImageConn = (await conns.list()).find(
              (c) =>
                c.provider === "image_generation" && (c.defaultForAgents === true || c.defaultForAgents === "true"),
            );
            imgConnId = defaultImageConn?.id ?? null;
          }
          if (imgConnId) {
            const imgConnFull = await conns.getWithKey(imgConnId);
            if (imgConnFull) {
              const { generateImage, saveImageToDisk } = await import("../../services/image/image-generation.js");
              const { createGalleryStorage } = await import("../../services/storage/gallery.storage.js");
              const galleryStore = createGalleryStorage(app.db);

              const imgModel = imgConnFull.model || "";
              const imgBaseUrl = imgConnFull.baseUrl || "https://image.pollinations.ai";
              const imgApiKey = imgConnFull.apiKey || "";
              const imgSource = (imgConnFull as any).imageGenerationSource || imgModel;
              const imgServiceHint = imgConnFull.imageService || imgSource;

              const chatMeta = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});
              const selfieRes = (chatMeta.selfieResolution as string) ?? "";
              const resParts = selfieRes.split("x").map(Number);
              const parsedW = resParts[0] ?? 0;
              const parsedH = resParts[1] ?? 0;
              let imgWidth: number;
              let imgHeight: number;
              if (parsedW > 0 && parsedH > 0) {
                imgWidth = parsedW;
                imgHeight = parsedH;
              } else if (aspectRatio === "portrait") {
                imgWidth = 512;
                imgHeight = 768;
              } else if (aspectRatio === "square") {
                imgWidth = 512;
                imgHeight = 512;
              } else {
                imgWidth = 768;
                imgHeight = 512;
              }

              let fullPrompt = style ? `${style}, ${imagePrompt}` : imagePrompt;

              // Collect character avatar references when enabled
              const useAvatarRefs = illustratorAgent?.resolved.settings?.useAvatarReferences === true;
              let referenceImage: string | undefined;
              let referenceImages: string[] | undefined;
              if (useAvatarRefs && agentContext.characters.length > 0) {
                const illCharLower = illCharacters.map((n: string) => n.toLowerCase().trim());
                const refChars =
                  illCharLower.length > 0
                    ? agentContext.characters.filter((c) =>
                        illCharLower.some((n: string) => c.name.toLowerCase() === n),
                      )
                    : agentContext.characters;
                const refs: string[] = [];
                const { readFileSync, existsSync } = await import("node:fs");
                const { join } = await import("node:path");
                const DATA_DIR = join(process.cwd(), "packages", "server", "data");
                for (const c of refChars) {
                  const charRow = await chars.getById(c.id);
                  const avatarPath = charRow?.avatarPath as string | null;
                  if (!avatarPath) continue;
                  const filename = avatarPath.split("?")[0]?.split("/").pop();
                  if (!filename) continue;
                  const diskPath = join(DATA_DIR, "avatars", filename);
                  try {
                    if (existsSync(diskPath)) refs.push(readFileSync(diskPath).toString("base64"));
                  } catch {
                    /* skip */
                  }
                }
                if (refs.length > 0) referenceImages = refs;
              } else if (agentContext.characters.length > 0) {
                const firstChar = agentContext.characters[0];
                if (firstChar) {
                  const charRow = await chars.getById(firstChar.id);
                  const avatarPath = charRow?.avatarPath as string | null;
                  if (avatarPath) {
                    const { readFileSync, existsSync } = await import("node:fs");
                    const { join } = await import("node:path");
                    const DATA_DIR = join(process.cwd(), "packages", "server", "data");
                    const filename = avatarPath.split("?")[0]?.split("/").pop();
                    if (filename) {
                      const diskPath = join(DATA_DIR, "avatars", filename);
                      try {
                        if (existsSync(diskPath)) referenceImage = readFileSync(diskPath).toString("base64");
                      } catch {
                        /* skip */
                      }
                    }
                  }
                }
              }

              const imageResult = await generateImage(imgModel, imgBaseUrl, imgApiKey, imgServiceHint, {
                prompt: fullPrompt,
                negativePrompt: negativePrompt || undefined,
                model: imgModel,
                width: imgWidth,
                height: imgHeight,
                comfyWorkflow: (imgConnFull as any).comfyuiWorkflow || undefined,
                referenceImage,
                referenceImages,
              });

              const filePath = saveImageToDisk(chatId, imageResult.base64, imageResult.ext);
              const galleryEntry = await galleryStore.create({
                chatId,
                filePath,
                prompt: fullPrompt,
                provider: "image_generation",
                model: imgModel || "unknown",
                width: imgWidth,
                height: imgHeight,
              });

              const filename = filePath.split("/").pop()!;
              const imageUrl = `/api/gallery/file/${chatId}/${encodeURIComponent(filename)}`;

              // Attach to message
              if (retryMessageId) {
                const chatsDb = createChatsStorage(app.db);
                const attachment = { type: "image", url: imageUrl, filename: `illustration.${imageResult.ext}` };
                const swipeRow = (await chatsDb.getSwipes(retryMessageId)).find(
                  (s: any) => s.index === retrySwipeIndex,
                );
                if (swipeRow) {
                  const swipeExtra =
                    typeof swipeRow.extra === "string" ? JSON.parse(swipeRow.extra) : (swipeRow.extra ?? {});
                  const swipeAtts = (swipeExtra.attachments as any[]) ?? [];
                  swipeAtts.push(attachment);
                  await chatsDb.updateSwipeExtra(retryMessageId, retrySwipeIndex, { attachments: swipeAtts });
                }
                const msgRow = await chatsDb.getMessage(retryMessageId);
                if (msgRow && (msgRow.activeSwipeIndex ?? 0) === retrySwipeIndex) {
                  const msgExtra = msgRow.extra
                    ? typeof msgRow.extra === "string"
                      ? JSON.parse(msgRow.extra)
                      : msgRow.extra
                    : {};
                  const existingAttachments = (msgExtra.attachments as any[]) ?? [];
                  existingAttachments.push(attachment);
                  await chatsDb.updateMessageExtra(retryMessageId, { attachments: existingAttachments });
                }
              }

              sendSseEvent(reply, {
                type: "illustration",
                data: {
                  messageId: retryMessageId,
                  imageUrl,
                  prompt: fullPrompt,
                  reason: illData.reason,
                  galleryId: (galleryEntry as any)?.id,
                },
              });
              logger.info(
                `[retry-agents] Illustrator generated: ${(illData.reason as string)?.slice(0, 80) ?? imagePrompt.slice(0, 80)}...`,
              );
            }
          }
        }
      } catch (illErr) {
        logger.error(illErr, "[retry-agents] Illustrator image generation failed");
        sendSseEvent(reply, {
          type: "agent_error",
          data: {
            agentType: "illustrator",
            error: illErr instanceof Error ? illErr.message : "Image generation failed",
          },
        });
      }
    }

    // ── EXPRESSION ENGINE: persist validated sprite expressions ──
    // Validation already happened before SSE send; here we just persist to DB.
    if (result.success && result.type === "sprite_change" && result.data && typeof result.data === "object") {
      const spriteData = result.data as { expressions?: Array<{ characterId: string; expression: string }> };
      const exprMap: Record<string, string> = {};
      if (Array.isArray(spriteData.expressions)) {
        for (const e of spriteData.expressions) exprMap[e.characterId] = e.expression;
      }
      try {
        const chatsDb = createChatsStorage(app.db);
        await chatsDb.updateMessageExtra(retryMessageId, { spriteExpressions: exprMap });
        await chatsDb.updateSwipeExtra(retryMessageId, retrySwipeIndex, { spriteExpressions: exprMap });
      } catch {
        /* non-critical */
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

  app.post<{ Body: { chatId: string; agentTypes: string[]; streaming?: boolean; lorebookKeeperBackfill?: boolean } }>(
    "/retry-agents",
    async (request, reply) => {
      const { chatId, agentTypes, streaming = true, lorebookKeeperBackfill = false } = request.body;
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
        const allMessages = await chats.listMessages(chatId);
        let startIdx = 0;
        for (let index = allMessages.length - 1; index >= 0; index--) {
          const extra = parseExtra(allMessages[index]!.extra);
          if (extra.isConversationStart) {
            startIdx = index;
            break;
          }
        }
        const recentMessages = startIdx > 0 ? allMessages.slice(startIdx) : allMessages;
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
          resolvedAgentTypes: new Set(resolvedAgents.map((a) => a.resolved.type)),
          lastAssistant,
          chars,
          gameStateStore,
          lorebooksStore,
          streaming,
        });

        sendSseEvent(reply, { type: "agent_start", data: { phase: "retry" } });
        const lorebookKeeperAgent = resolvedAgents.find((entry) => entry.resolved.type === "lorebook-keeper") ?? null;
        const nonLorebookAgents = resolvedAgents.filter((entry) => entry.resolved.type !== "lorebook-keeper");
        const results = nonLorebookAgents.length > 0 ? await executeRetryBatches(agentContext, nonLorebookAgents) : [];
        const lorebookKeeperRunEntries = lorebookKeeperAgent
          ? await executeLorebookKeeperRetries({
              lorebookKeeperAgent,
              baseContext: agentContext,
              messages: recentMessages,
              readBehindMessages: getLorebookKeeperSettings(chatMeta).readBehindMessages,
              lastProcessedMessageId:
                (await agentsStore.getLastSuccessfulRunByType("lorebook-keeper", chatId))?.messageId ?? null,
              backfillUnprocessed: lorebookKeeperBackfill,
              lorebooksStore,
              chatId,
              chatName: (chat as any).name,
            })
          : [];

        // ── Pre-validate expression results before sending SSE events ──
        // Validation must happen before the SSE send, otherwise the client receives
        // unvalidated expressions that may not have matching sprite files.
        for (const result of results) {
          if (result.success && result.type === "sprite_change" && result.data && typeof result.data === "object") {
            const spriteData = result.data as { expressions?: Array<{ characterId: string; characterName?: string; expression: string; transition?: string }> };
            const availableSprites = agentContext.memory._availableSprites as
              | Array<{ characterId: string; characterName: string; expressions: string[] }>
              | undefined;
            if (Array.isArray(spriteData.expressions) && Array.isArray(availableSprites)) {
              spriteData.expressions = spriteData.expressions.filter((entry) => {
                if (typeof entry.characterId !== "string" || typeof entry.expression !== "string") {
                  logger.warn(`[retry-agents] Malformed expression entry — skipping`);
                  return false;
                }
                let charSprites = availableSprites.find((s) => s.characterId === entry.characterId);
                if (!charSprites) {
                  const entryLower = entry.characterId.toLowerCase().replace(/[^a-z0-9]/g, "");
                  charSprites = availableSprites.find((s) => {
                    const nameLower = s.characterName.toLowerCase().replace(/[^a-z0-9]/g, "");
                    return nameLower === entryLower || nameLower.includes(entryLower) || entryLower.includes(nameLower);
                  });
                  if (charSprites) {
                    logger.warn(
                      `[retry-agents] Expression agent used "${entry.characterId}" — resolved to ${charSprites.characterName} (${charSprites.characterId})`,
                    );
                    entry.characterId = charSprites.characterId;
                  }
                }
                if (!charSprites) {
                  logger.warn(
                    `[retry-agents] Expression agent returned unknown character "${entry.characterId}" — removing`,
                  );
                  return false;
                }
                const exprLower = entry.expression.toLowerCase();
                const exactMatch = charSprites.expressions.find((e) => e.toLowerCase() === exprLower);
                if (exactMatch) {
                  entry.expression = exactMatch;
                  return true;
                }
                const fallback = charSprites.expressions.find(
                  (e) => e.toLowerCase().includes(exprLower) || exprLower.includes(e.toLowerCase()),
                );
                if (fallback) {
                  logger.warn(
                    `[retry-agents] Expression agent chose "${entry.expression}" — correcting to closest match "${fallback}"`,
                  );
                  entry.expression = fallback;
                } else {
                  logger.warn(
                    `[retry-agents] Expression agent chose "${entry.expression}" for ${charSprites.characterName} which doesn't exist — removing`,
                  );
                  return false;
                }
                return true;
              });
            } else if (!Array.isArray(availableSprites)) {
              // No sprite catalog loaded — drop expressions entirely so unvalidated data is never forwarded
              spriteData.expressions = [];
            }
          }
        }

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

        for (const entry of lorebookKeeperRunEntries) {
          const cfg = lorebookKeeperAgent?.cfg;
          sendSseEvent(reply, {
            type: "agent_result",
            data: {
              agentType: entry.result.agentType,
              agentName: cfg?.name ?? entry.result.agentType,
              resultType: entry.result.type,
              data: entry.result.data,
              success: entry.result.success,
              error: entry.result.error,
              durationMs: entry.result.durationMs,
            },
          });
        }

        const retryMessageId = lastAssistant?.id ?? "";
        const retrySwipeIndex = lastAssistant?.activeSwipeIndex ?? 0;
        await persistRetryResults(agentsStore, chatId, retryMessageId, results);
        for (const entry of lorebookKeeperRunEntries) {
          try {
            await agentsStore.saveRun({
              agentConfigId: entry.result.agentId,
              chatId,
              messageId: entry.messageId,
              result: entry.result,
            });
          } catch {
            // Non-critical write; keep processing remaining results.
          }
        }
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
          conns,
          chars,
          resolvedAgents: nonLorebookAgents,
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
    },
  );
}
