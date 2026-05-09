import type { FastifyInstance } from "fastify";
import { logger } from "../../lib/logger.js";
import {
  BUILT_IN_AGENTS,
  getDefaultBuiltInAgentSettings,
  type AgentContext,
  type AgentResult,
} from "@marinara-engine/shared";
import { eq } from "drizzle-orm";
import { buildSpriteExpressionChoices, listCharacterSprites } from "../../services/game/sprite.service.js";
import { DATA_DIR } from "../../utils/data-dir.js";
import type { ResolvedAgent } from "../../services/agents/agent-pipeline.js";
import { executeAgent, executeAgentBatch, normalizeAgentContextSize } from "../../services/agents/agent-executor.js";
import { getLocalSidecarProvider, LOCAL_SIDECAR_MODEL } from "../../services/llm/local-sidecar.js";
import { createLLMProvider } from "../../services/llm/provider-registry.js";
import { sidecarModelService } from "../../services/sidecar/sidecar-model.service.js";
import { createAgentsStorage } from "../../services/storage/agents.storage.js";
import { createCharactersStorage } from "../../services/storage/characters.storage.js";
import { createChatsStorage } from "../../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../../services/storage/connections.storage.js";
import { resolveConnectionImageDefaults } from "../../services/image/image-generation-defaults.js";
import { loadImageGenerationUserSettings } from "../../services/image/image-generation-settings.js";
import { createGameStateStorage } from "../../services/storage/game-state.storage.js";
import { createLorebooksStorage } from "../../services/storage/lorebooks.storage.js";
import { syncGameMapMetaPartyPosition } from "../../services/game/map-position.service.js";
import { gameStateSnapshots as gameStateSnapshotsTable } from "../../db/schema/index.js";
import { isMessageHiddenFromAI, parseExtra, parseGameStateRow, resolveBaseUrl } from "./generate-route-utils.js";
import {
  buildHistoricalLorebookKeeperContext,
  getLorebookKeeperBackfillTargets,
  getLorebookKeeperSettings,
  loadLorebookKeeperExistingEntries,
  persistLorebookKeeperUpdates,
  resolveLorebookKeeperTarget,
} from "./lorebook-keeper-utils.js";
import { sendSseEvent, startSseReply } from "./sse.js";
import {
  buildDefaultAgentConnectionWarning,
  buildLocalSidecarUnavailableWarning,
  isLocalSidecarConnectionId,
  resolveAgentConnectionId,
  type AgentConnectionWarning,
} from "./agent-connection-guards.js";
import { validateSpriteExpressionEntries } from "./expression-agent-utils.js";
import {
  normalizeContextInjections,
  normalizeSecretPlotSceneDirections,
  normalizeStringArray,
} from "./agent-normalizers.js";
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

type ResolvedRetryAgents = {
  conn: any;
  enabledConfigs: any[];
  resolvedAgents: ResolvedRetryAgent[];
  warnings: AgentConnectionWarning[];
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
  cyoaAgentWillRun: boolean;
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
  /**
   * When retrying agents for a specific assistant message (e.g. refreshing cached prompt injections),
   * use the game-state snapshot committed for that message+swipe — not the latest chat snapshot.
   */
  historicalGameStateAnchor?: { messageId: string; swipeIndex: number } | null;
  /** When false, do not fall back to the current latest snapshot if no historical anchor exists. */
  useLatestGameStateFallback?: boolean;
}) {
  const {
    cyoaAgentWillRun,
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
    historicalGameStateAnchor,
    useLatestGameStateFallback = true,
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
            return normalizeAgentContextSize(settings.contextSize);
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

  if (historicalGameStateAnchor) {
    const snap = await gameStateStore.getByChatAndMessage(
      chatId,
      historicalGameStateAnchor.messageId,
      historicalGameStateAnchor.swipeIndex,
    );
    if (snap) {
      agentContext.gameState = parseGameStateRow(snap as Record<string, unknown>);
    } else {
      agentContext.gameState = null;
    }
  } else if (useLatestGameStateFallback) {
    const latestGS = await gameStateStore.getLatestCommitted(chatId);
    if (latestGS) {
      agentContext.gameState = parseGameStateRow(latestGS as Record<string, unknown>);
    }
  }

  // CYOA re-rolls: inject the previous choices so the agent generates a fresh,
  // meaningfully different set instead of repeating the last batch. Mirrors
  // the same injection in the main generate route.
  if (cyoaAgentWillRun && lastAssistant) {
    const lastExtra = parseExtra((lastAssistant as any).extra);
    if (lastExtra.cyoaChoices) {
      agentContext.memory._lastCyoaChoices = lastExtra.cyoaChoices;
    }
  }

  // If the expression agent is being retried, load available sprite expressions per character
  if (resolvedAgentTypes.has("expression")) {
    try {
      const perChar: Array<{
        characterId: string;
        characterName: string;
        expressions: string[];
        expressionChoices: string[];
      }> = [];
      for (const char of agentContext.characters) {
        const sprites = listCharacterSprites(char.id);
        if (sprites && sprites.expressions.length > 0) {
          perChar.push({
            characterId: char.id,
            characterName: char.name,
            expressions: sprites.expressions,
            expressionChoices: buildSpriteExpressionChoices(sprites.expressions),
          });
        }
      }
      if (perChar.length > 0) {
        agentContext.memory._availableSprites = perChar;
      }
    } catch (err) {
      logger.warn(err, "[retry-agents] Failed to load available sprites for retry");
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
    } catch (err) {
      logger.warn(err, "[retry-agents] Failed to load available backgrounds for retry");
    }
  }

  return agentContext;
}

async function resolveRetryAgents(args: {
  agentTypes: string[];
  chat: any;
  conns: ReturnType<typeof createConnectionsStorage>;
  agentsStore: ReturnType<typeof createAgentsStorage>;
}): Promise<ResolvedRetryAgents> {
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
  const skippedLocalSidecarAgents: string[] = [];
  const defaultAgentConnectionAgents: string[] = [];
  const defaultAgentConn = await conns.getDefaultForAgents();
  const defaultAgentConnection = defaultAgentConn
    ? (() => {
        const baseUrl = resolveBaseUrl(defaultAgentConn);
        if (!baseUrl) return null;
        return {
          connectionId: defaultAgentConn.id as string,
          provider: createLLMProvider(
            defaultAgentConn.provider,
            baseUrl,
            defaultAgentConn.apiKey,
            defaultAgentConn.maxContext,
            defaultAgentConn.openrouterProvider,
            defaultAgentConn.maxTokensOverride,
          ),
          model: defaultAgentConn.model,
        };
      })()
    : null;
  const localSidecarAvailableForTrackers =
    sidecarModelService.getConfig().useForTrackers && sidecarModelService.getConfiguredModelRef() !== null;

  for (const cfg of enabledConfigs) {
    let agentProvider = provider;
    let agentModel = conn.model;
    const effectiveConnectionId = resolveAgentConnectionId({
      requestedConnectionId: cfg.connectionId as string | null,
      defaultAgentConnectionId: defaultAgentConn?.id ?? null,
      localSidecarAvailable: localSidecarAvailableForTrackers,
    });

    if (effectiveConnectionId === "skip-local-sidecar") {
      skippedLocalSidecarAgents.push(cfg.name ?? cfg.type);
      logger.warn(
        "[retry-agents] Skipping agent %s because Local Model was requested but the sidecar is unavailable",
        cfg.type,
      );
      continue;
    }

    if (effectiveConnectionId) {
      if (isLocalSidecarConnectionId(effectiveConnectionId) && localSidecarAvailableForTrackers) {
        agentProvider = getLocalSidecarProvider();
        agentModel = LOCAL_SIDECAR_MODEL;
      } else if (defaultAgentConnection && effectiveConnectionId === defaultAgentConnection.connectionId) {
        agentProvider = defaultAgentConnection.provider;
        agentModel = defaultAgentConnection.model;
        defaultAgentConnectionAgents.push(cfg.name ?? cfg.type);
      } else {
        const agentConn = await conns.getWithKey(effectiveConnectionId);
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
        connectionId: effectiveConnectionId,
        settings: typeof cfg.settings === "string" ? JSON.parse(cfg.settings) : (cfg.settings ?? {}),
        provider: agentProvider,
        model: agentModel,
      },
      agentProvider,
      agentModel,
    });
  }

  const warnings =
    skippedLocalSidecarAgents.length > 0 ? [buildLocalSidecarUnavailableWarning(skippedLocalSidecarAgents)] : [];

  for (const builtIn of builtInFallbackConfigs) {
    const builtInProvider = defaultAgentConnection ?? { provider, model: conn.model, connectionId: null };
    if (defaultAgentConnection) {
      defaultAgentConnectionAgents.push(builtIn.name);
    }

    resolvedAgents.push({
      cfg: { id: `builtin:${builtIn.id}`, type: builtIn.id, name: builtIn.name } as any,
      resolved: {
        id: `builtin:${builtIn.id}`,
        type: builtIn.id,
        name: builtIn.name,
        phase: builtIn.phase,
        promptTemplate: "",
        connectionId: builtInProvider.connectionId,
        settings: getDefaultBuiltInAgentSettings(builtIn.id),
        provider: builtInProvider.provider,
        model: builtInProvider.model,
      },
      agentProvider: builtInProvider.provider,
      agentModel: builtInProvider.model,
    });
  }

  if (defaultAgentConn && defaultAgentConnectionAgents.length > 0) {
    warnings.push(
      buildDefaultAgentConnectionWarning({
        agentNames: defaultAgentConnectionAgents,
        connectionName: defaultAgentConn.name,
        model: defaultAgentConn.model,
      }),
    );
  }

  return { conn, enabledConfigs, resolvedAgents, warnings };
}

const retryProviderIds = new WeakMap<object, number>();
let nextRetryProviderId = 0;

function retryProviderKey(provider: unknown): string {
  if ((typeof provider !== "object" && typeof provider !== "function") || provider === null) {
    return `primitive:${String(provider)}`;
  }
  let id = retryProviderIds.get(provider);
  if (id === undefined) {
    id = nextRetryProviderId++;
    retryProviderIds.set(provider, id);
  }
  return `provider:${id}`;
}

async function executeRetryBatches(
  agentContext: AgentContext,
  resolvedAgents: ResolvedRetryAgent[],
  preGenerationContext?: AgentContext | null,
) {
  const providerModelGroups = new Map<
    string,
    { agents: ResolvedRetryAgent[]; provider: any; model: string; context: AgentContext }
  >();

  for (const entry of resolvedAgents) {
    const context =
      preGenerationContext && entry.resolved.phase === "pre_generation" ? preGenerationContext : agentContext;
    const contextKind = context === preGenerationContext ? "pre_generation" : "default";
    const key = `${retryProviderKey(entry.agentProvider)}::${entry.agentModel}::${contextKind}`;
    if (!providerModelGroups.has(key)) {
      providerModelGroups.set(key, { agents: [], provider: entry.agentProvider, model: entry.agentModel, context });
    }
    providerModelGroups.get(key)!.agents.push(entry);
  }

  const results: AgentResult[] = [];
  const groupSettled = await Promise.allSettled(
    [...providerModelGroups.values()].map(async (group) => {
      const configs = group.agents.map((agent) => agent.resolved);
      return executeAgentBatch(configs, group.context, group.provider, group.model);
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
  secretPlotRerollMode?: "full" | "turn_only";
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
    secretPlotRerollMode,
  } = args;
  const sortedResults = [...results].sort(
    (a, b) => (a.type === "game_state_update" ? 0 : 1) - (b.type === "game_state_update" ? 0 : 1),
  );
  const chats = createChatsStorage(app.db);
  const agentsStore = createAgentsStorage(app.db);
  const chatMeta = parseExtra(chat.metadata) as Record<string, unknown>;

  for (const result of sortedResults) {
    if (result.success && result.type === "text_rewrite" && result.data && typeof result.data === "object") {
      try {
        const rewriteData = result.data as Record<string, unknown>;
        const editedText = (rewriteData.editedText as string) ?? "";
        const changes = (rewriteData.changes as Array<{ description: string }>) ?? [];
        if (retryMessageId && editedText && changes.length > 0) {
          await chats.updateMessageContent(retryMessageId, editedText);
          sendSseEvent(reply, { type: "text_rewrite", data: { editedText, changes } });
        }
      } catch {
        // Non-critical patching failure.
      }
    }

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

    // Keep message.extra.contextInjections in sync when retrying agents that emit injectable text,
    // so regenerate/swipe replays the edited or re-run snippet instead of stale cache.
    if (retryMessageId && result.success && (result.type === "context_injection" || result.type === "director_event")) {
      const text =
        typeof result.data === "string"
          ? result.data
          : result.data && typeof result.data === "object"
            ? String((result.data as { text?: string }).text ?? "")
            : "";
      try {
        const msg = await chats.getMessage(retryMessageId);
        if (msg) {
          const extra = parseExtra(msg.extra) as Record<string, unknown>;
          let list = normalizeContextInjections(extra.contextInjections).filter(
            (entry) => entry.agentType !== "secret-plot-driver",
          );
          const trimmedText = text.trim();
          if (trimmedText) {
            const entry = { agentType: result.agentType, text: trimmedText };
            const idx = list.findIndex((e) => e.agentType === result.agentType);
            if (idx >= 0) list[idx] = entry;
            else list.push(entry);
          } else {
            list = list.filter((e) => e.agentType !== result.agentType);
          }
          await chats.updateMessageExtra(retryMessageId, { contextInjections: list });
          await chats.updateSwipeExtra(retryMessageId, retrySwipeIndex, { contextInjections: list });
        }
      } catch {
        /* non-critical */
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

    if (result.success && result.type === "secret_plot" && result.data && typeof result.data === "object") {
      try {
        const plotData = result.data as Record<string, unknown>;
        const agentConfigId =
          resolvedAgents.find((entry) => entry.resolved.type === "secret-plot-driver")?.resolved.id ?? null;
        if (agentConfigId) {
          // Turn-only re-run should preserve long-running arc memory while refreshing
          // per-turn guidance (scene directions/pacing/stale flags).
          if (secretPlotRerollMode !== "turn_only" && plotData.overarchingArc !== undefined) {
            await agentsStore.setMemory(agentConfigId, chatId, "overarchingArc", plotData.overarchingArc ?? null);
          }
          if (plotData.sceneDirections !== undefined) {
            const allDirections = normalizeSecretPlotSceneDirections(plotData.sceneDirections);
            const active = allDirections.filter((d) => !d.fulfilled);
            const justFulfilled = allDirections.filter((d) => d.fulfilled).map((d) => d.direction);
            await agentsStore.setMemory(agentConfigId, chatId, "sceneDirections", active);
            if (justFulfilled.length > 0) {
              const mem = await agentsStore.getMemory(agentConfigId, chatId);
              const prev = normalizeStringArray(mem.recentlyFulfilled);
              await agentsStore.setMemory(
                agentConfigId,
                chatId,
                "recentlyFulfilled",
                [...prev, ...justFulfilled].slice(-10),
              );
            }
          }
          if (plotData.pacing !== undefined) {
            await agentsStore.setMemory(agentConfigId, chatId, "pacing", plotData.pacing ?? null);
          }
          await agentsStore.setMemory(agentConfigId, chatId, "staleDetected", plotData.staleDetected === true);
        }
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

    // Persist re-rolled CYOA choices onto the last assistant message + active swipe
    // so they survive a page refresh, and broadcast them to the client store.
    if (result.success && result.type === "cyoa_choices" && result.data && typeof result.data === "object") {
      try {
        const cyoaData = result.data as { choices?: Array<{ label: string; text: string }> };
        if (retryMessageId && cyoaData.choices && cyoaData.choices.length > 0) {
          await chats.updateSwipeExtra(retryMessageId, retrySwipeIndex, { cyoaChoices: cyoaData.choices });
          const msgRow = await chats.getMessage(retryMessageId);
          if (msgRow && (msgRow.activeSwipeIndex ?? 0) === retrySwipeIndex) {
            await chats.updateMessageExtra(retryMessageId, { cyoaChoices: cyoaData.choices });
            logger.info(
              "[retry-agents] CYOA choices persisted chatId=%s messageId=%s choiceCount=%d",
              chatId,
              retryMessageId,
              cyoaData.choices.length,
            );
          } else {
            logger.info(
              "[retry-agents] CYOA choices persisted to swipe only (active swipe changed) chatId=%s messageId=%s retrySwipeIndex=%d activeSwipeIndex=%s choiceCount=%d",
              chatId,
              retryMessageId,
              retrySwipeIndex,
              msgRow?.activeSwipeIndex ?? "null",
              cyoaData.choices.length,
            );
          }
        }
      } catch (err) {
        logger.warn(
          err,
          "[retry-agents] CYOA choices persistence failed chatId=%s messageId=%s",
          chatId,
          retryMessageId,
        );
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
              const imageDefaults = resolveConnectionImageDefaults(imgConnFull);
              const imageSettings = await loadImageGenerationUserSettings(app.db);

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
              } else {
                imgWidth = imageSettings.selfie.width;
                imgHeight = imageSettings.selfie.height;
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
                imageDefaults,
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
                const attachment = {
                  type: "image",
                  url: imageUrl,
                  filename: `illustration.${imageResult.ext}`,
                  prompt: fullPrompt,
                  galleryId: (galleryEntry as any)?.id,
                };
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
                "[retry-agents] Illustrator generated: %s...",
                (illData.reason as string | undefined)?.slice(0, 80) ?? imagePrompt.slice(0, 80),
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
      } catch (err) {
        logger.warn(err, "[retry-agents] Failed to persist validated sprite expressions");
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

  app.post<{
    Body: {
      chatId: string;
      agentTypes: string[];
      streaming?: boolean;
      lorebookKeeperBackfill?: boolean;
      /** When set, scope history and game state to this assistant message (as at original generation), not the latest turn. */
      forMessageId?: string;
      /** Secret Plot re-run mode: full = refresh arc+turn data, turn_only = preserve arc and refresh only turn guidance. */
      secretPlotRerollMode?: "full" | "turn_only";
    };
  }>("/retry-agents", async (request, reply) => {
    const {
      chatId,
      agentTypes,
      streaming = true,
      lorebookKeeperBackfill = false,
      forMessageId,
      secretPlotRerollMode = "full",
    } = request.body;
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
      let recentMessages = startIdx > 0 ? allMessages.slice(startIdx) : allMessages;
      let lastAssistant = [...recentMessages].reverse().find((message: any) => message.role === "assistant");
      let historicalGameStateAnchor: { messageId: string; swipeIndex: number } | null = null;
      let preGenerationRecentMessages: any[] | null = null;
      let preGenerationGameStateAnchor: { messageId: string; swipeIndex: number } | null = null;

      if (forMessageId) {
        const anchor = allMessages.find((m) => m.id === forMessageId);
        if (!anchor || anchor.role !== "assistant") {
          throw new Error("forMessageId must refer to an assistant message in this chat");
        }
        const anchorIdx = allMessages.findIndex((m) => m.id === forMessageId);
        if (anchorIdx < startIdx) {
          throw new Error("Anchor message is before the conversation start marker");
        }
        preGenerationRecentMessages = allMessages.slice(startIdx, anchorIdx);
        recentMessages = allMessages.slice(startIdx, anchorIdx + 1);
        lastAssistant = anchor;
        historicalGameStateAnchor = {
          messageId: anchor.id,
          swipeIndex: anchor.activeSwipeIndex ?? 0,
        };
      }

      const supportsHiddenFromAI = chat.mode === "roleplay" || chat.mode === "visual_novel";
      if (supportsHiddenFromAI) {
        recentMessages = recentMessages.filter((message: any) => !isMessageHiddenFromAI(message));
        if (preGenerationRecentMessages) {
          preGenerationRecentMessages = preGenerationRecentMessages.filter(
            (message: any) => !isMessageHiddenFromAI(message),
          );
        }
        if (!forMessageId) {
          lastAssistant = [...recentMessages].reverse().find((message: any) => message.role === "assistant");
        }
      }
      const preGenerationLastAssistant = preGenerationRecentMessages
        ? [...preGenerationRecentMessages].reverse().find((message: any) => message.role === "assistant")
        : null;
      if (preGenerationLastAssistant) {
        preGenerationGameStateAnchor = {
          messageId: preGenerationLastAssistant.id,
          swipeIndex: preGenerationLastAssistant.activeSwipeIndex ?? 0,
        };
      }

      const { enabledConfigs, resolvedAgents, warnings } = await resolveRetryAgents({
        agentTypes,
        chat,
        conns,
        agentsStore,
      });
      const cyoaAgentWillRun = resolvedAgents.some((e) => e.resolved.type === "cyoa");
      const agentContext = await buildRetryAgentContext({
        cyoaAgentWillRun,
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
        historicalGameStateAnchor,
      });
      const hasPreGenerationRetries = resolvedAgents.some((entry) => entry.resolved.phase === "pre_generation");
      const preGenerationAgentContext =
        hasPreGenerationRetries && preGenerationRecentMessages
          ? await buildRetryAgentContext({
              cyoaAgentWillRun: false,
              chatId,
              chat,
              chatMeta,
              recentMessages: preGenerationRecentMessages,
              enabledConfigs,
              resolvedAgentTypes: new Set(resolvedAgents.map((a) => a.resolved.type)),
              lastAssistant: null,
              chars,
              gameStateStore,
              lorebooksStore,
              streaming,
              historicalGameStateAnchor: preGenerationGameStateAnchor,
              useLatestGameStateFallback: false,
            })
          : null;

      sendSseEvent(reply, { type: "agent_start", data: { phase: "retry" } });
      for (const warning of warnings) {
        sendSseEvent(reply, { type: "agent_warning", data: warning });
      }
      const lorebookKeeperAgent = resolvedAgents.find((entry) => entry.resolved.type === "lorebook-keeper") ?? null;
      const nonLorebookAgents = resolvedAgents.filter((entry) => entry.resolved.type !== "lorebook-keeper");
      if (cyoaAgentWillRun) {
        logger.info("[retry-agents] CYOA re-roll chatId=%s assistantMessageId=%s", chatId, lastAssistant?.id ?? "none");
      }
      const results =
        nonLorebookAgents.length > 0
          ? await executeRetryBatches(agentContext, nonLorebookAgents, preGenerationAgentContext)
          : [];
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
          const spriteData = result.data as {
            expressions?: Array<{
              characterId: string;
              characterName?: string;
              expression: string;
              transition?: string;
            }>;
          };
          const availableSprites = agentContext.memory._availableSprites as
            | Array<{ characterId: string; characterName: string; expressions: string[] }>
            | undefined;
          if (Array.isArray(spriteData.expressions) && Array.isArray(availableSprites)) {
            const validation = validateSpriteExpressionEntries(spriteData.expressions, availableSprites);
            spriteData.expressions = validation.expressions;
            for (const warning of validation.warnings) {
              logger.warn("[retry-agents] %s", warning.message);
            }
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

      if (cyoaAgentWillRun) {
        const cyoaRetry = results.find((r) => r.agentType === "cyoa");
        if (cyoaRetry && !cyoaRetry.success) {
          logger.warn("[retry-agents] CYOA re-roll failed chatId=%s: %s", chatId, cyoaRetry.error ?? "unknown");
        }
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
        secretPlotRerollMode,
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
