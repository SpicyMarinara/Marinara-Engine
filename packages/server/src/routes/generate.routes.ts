// ──────────────────────────────────────────────
// Routes: Generation (SSE Streaming with Tool Use + Agent Pipeline)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import {
  generateRequestSchema,
  BUILT_IN_TOOLS,
  BUILT_IN_AGENTS,
  getDefaultBuiltInAgentSettings,
  findKnownModel,
  nameToXmlTag,
  DEFAULT_AGENT_TOOLS,
  LOCAL_SIDECAR_CONNECTION_ID,
  resolveMacros,
} from "@marinara-engine/shared";
import type {
  AgentContext,
  AgentResult,
  AgentPhase,
  APIProvider,
  CharacterStat,
  GameState,
  PlayerStats,
} from "@marinara-engine/shared";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createPromptsStorage } from "../services/storage/prompts.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createAgentsStorage } from "../services/storage/agents.storage.js";
import { createGameStateStorage } from "../services/storage/game-state.storage.js";
import { createCustomToolsStorage } from "../services/storage/custom-tools.storage.js";
import { createLorebooksStorage } from "../services/storage/lorebooks.storage.js";
import { createRegexScriptsStorage } from "../services/storage/regex-scripts.storage.js";
import { createPromptOverridesStorage } from "../services/storage/prompt-overrides.storage.js";
import { loadPrompt, CONVERSATION_SELFIE } from "../services/prompt-overrides/index.js";
import { processLorebooks } from "../services/lorebook/index.js";
import { injectAtDepth } from "../services/lorebook/prompt-injector.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { resolveConnectionImageDefaults } from "../services/image/image-generation-defaults.js";
import { loadImageGenerationUserSettings } from "../services/image/image-generation-settings.js";
import { decryptApiKey, encryptApiKey } from "../utils/crypto.js";
import { extractLeadingThinkingBlocks } from "../services/llm/inline-thinking.js";
import {
  assemblePrompt,
  buildPromptMacroContext,
  collectCharacterDepthPromptEntries,
  type AssemblerInput,
} from "../services/prompt/index.js";
import { mergeAdjacentMessages } from "../services/prompt/merger.js";
import { wrapContent } from "../services/prompt/format-engine.js";
import {
  fitMessagesToContext,
  type BaseLLMProvider,
  type LLMToolDefinition,
  type ChatMessage,
  type LLMUsage,
} from "../services/llm/base-provider.js";
import { executeToolCalls, type MetadataPatchInput } from "../services/tools/tool-executor.js";
import { createAgentPipeline, type ResolvedAgent, type AgentInjection } from "../services/agents/agent-pipeline.js";
import { DATA_DIR } from "../utils/data-dir.js";
import { executeAgent, resolveAgentResultType } from "../services/agents/agent-executor.js";
import { getLocalSidecarProvider, LOCAL_SIDECAR_MODEL } from "../services/llm/local-sidecar.js";
import {
  parseCharacterCommands,
  parseDuration,
  type CharacterCommand,
  type ScheduleUpdateCommand,
  type CrossPostCommand,
  type SelfieCommand,
  type MemoryCommand,
  type InfluenceCommand,
  type NoteCommand,
  type SceneCommand,
  type HapticCommand,
  type CreatePersonaCommand,
  type CreateCharacterCommand,
  type UpdateCharacterCommand,
  type UpdatePersonaCommand,
  type CreateChatCommand,
  type NavigateCommand,
  type FetchCommand,
} from "../services/conversation/character-commands.js";
import { recordAssistantActivity, recordUserActivity } from "../services/conversation/autonomous.service.js";
import { buildImpersonateInstruction } from "../services/conversation/impersonate-prompt.js";
import { stripConversationPromptTimestamps } from "../services/conversation/transcript-sanitize.js";
import {
  formatConversationDateKey,
  generateMissingConversationSummaries,
  parseConversationDateKey,
} from "../services/conversation/auto-summary.service.js";
import { MARI_ASSISTANT_PROMPT } from "../db/seed-mari.js";
import { executeKnowledgeRetrieval } from "../services/agents/knowledge-retrieval.js";
import { executeKnowledgeRouter } from "../services/agents/knowledge-router.js";
import { extractFileText, getSourceFilePath } from "./knowledge-sources.routes.js";
import { gameStateSnapshots as gameStateSnapshotsTable } from "../db/schema/index.js";
import { chats as chatsTable } from "../db/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { PROFESSOR_MARI_ID } from "@marinara-engine/shared";
import { chunkAndEmbedMessages, recallMemories } from "../services/memory-recall.js";
import { postToDiscordWebhook } from "../services/discord-webhook.js";
import {
  findLastIndex,
  injectIntoOutputFormatOrLastUser,
  isMessageHiddenFromAI,
  mergeCustomParameters,
  parseExtra,
  parseStoredGenerationParameters,
  parseGameStateRow,
  resolveBaseUrl,
  wrapFields,
  type SimpleMessage,
} from "./generate/generate-route-utils.js";
import { logger } from "../lib/logger.js";
import {
  buildHistoricalLorebookKeeperContext,
  getLorebookKeeperAutomaticPendingCount,
  getLorebookKeeperAutomaticTarget,
  getLorebookKeeperSettings,
  loadLorebookKeeperExistingEntries,
  persistLorebookKeeperUpdates,
  resolveLorebookKeeperTarget,
} from "./generate/lorebook-keeper-utils.js";
import { registerDryRunRoute } from "./generate/dry-run-route.js";
import { registerRetryAgentsRoute } from "./generate/retry-agents-route.js";
import { sendSseEvent, startSseReply, trySendSseEvent } from "./generate/sse.js";
import {
  createJournal,
  addLocationEntry,
  addEventEntry,
  addInventoryEntry,
  upsertQuest,
  addNpcEntry,
  type Journal,
} from "../services/game/journal.service.js";
import { buildGmSystemPrompt, buildGmFormatReminder, type GmPromptContext } from "../services/game/gm-prompts.js";
import {
  applyMapUpdateCommand,
  getGameMapsFromMeta,
  parseMapUpdateCommands,
  syncGameMapMetaPartyPosition,
  withActiveGameMapMeta,
} from "../services/game/map-position.service.js";
import { applyAllSegmentEdits, stripGmCommandTags } from "../services/game/segment-edits.js";
import { listPartySprites } from "../services/game/sprite.service.js";
import {
  generatePerceptionHints,
  formatPerceptionHints,
  type PerceptionContext,
} from "../services/game/perception.service.js";
import { getMoraleTier, formatMoraleContext } from "../services/game/morale.service.js";
import type { GameMap, GameNpc, LorebookEntry } from "@marinara-engine/shared";
import { sidecarModelService } from "../services/sidecar/sidecar-model.service.js";

function isEncryptedToken(value: string): boolean {
  const parts = value.split(":");
  return (
    parts.length === 3 &&
    parts.every((part) => /^[0-9a-f]+$/i.test(part)) &&
    parts[0]?.length === 24 &&
    parts[2]?.length === 32
  );
}

function decryptStoredToken(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const decrypted = decryptApiKey(value);
  return decrypted || (isEncryptedToken(value) ? null : value);
}

function bumpCharacterVersion(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "1.1";
  const match = raw.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return `${raw}.1`;
  const prefix = match[1] ?? "";
  const numberPart = match[2] ?? "0";
  const suffix = match[3] ?? "";
  const next = String(Number(numberPart) + 1).padStart(numberPart.length, "0");
  return `${prefix}${next}${suffix}`;
}

function hasConversationSchedules(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0;
}

function areConversationSchedulesEnabled(meta: Record<string, any>): boolean {
  if (typeof meta.conversationSchedulesEnabled === "boolean") return meta.conversationSchedulesEnabled;
  return hasConversationSchedules(meta.characterSchedules);
}

function getEnabledConversationSchedules(meta: Record<string, any>): Record<string, any> {
  return areConversationSchedulesEnabled(meta) && hasConversationSchedules(meta.characterSchedules)
    ? meta.characterSchedules
    : {};
}

function getHiddenCompletionTokens(usage: LLMUsage | undefined): number | undefined {
  if (!usage) return undefined;
  const hiddenParts = [
    usage.completionReasoningTokens,
    usage.completionAudioTokens,
    usage.rejectedPredictionTokens,
  ].filter((value): value is number => typeof value === "number");
  if (hiddenParts.length === 0) return undefined;
  return hiddenParts.reduce((sum, value) => sum + value, 0);
}

function getVisibleCompletionTokens(usage: LLMUsage | undefined): number | undefined {
  if (!usage || typeof usage.completionTokens !== "number") return undefined;
  return Math.max(0, usage.completionTokens - (getHiddenCompletionTokens(usage) ?? 0));
}

function sanitizeConnectedGameTranscript(content: string): string {
  return stripGmCommandTags(content)
    .replace(/^\[(?:To the party|To the GM)\]\s*/i, "")
    .trim();
}

function prefixConversationUserTurn(content: string, personaName: string): string {
  const speaker = personaName.trim() || "User";
  const trimmed = content.trim();
  const escapedSpeaker = speaker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^${escapedSpeaker}\\s*:`, "i").test(trimmed)) return trimmed;
  if (speaker === "User" && /^user\s*:/i.test(trimmed)) return trimmed;
  return trimmed ? `${speaker}: ${trimmed}` : `${speaker}:`;
}

function formatConversationPromptTurn(content: string, role: string, personaName: string): string {
  return role === "user" ? prefixConversationUserTurn(content, personaName) : content.trim();
}

function normalizePartyLookupName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildPartyNpcId(name: string): string {
  const slug = normalizePartyLookupName(name).replace(/\s+/g, "-");
  const encodedSlug = encodeURIComponent(name.trim().toLowerCase())
    .replace(/%/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `npc:${slug || encodedSlug || "unknown"}`;
}

function isPartyNpcId(id: string): boolean {
  return id.startsWith("npc:");
}
import { isInferenceAvailable as isSidecarInferenceAvailable } from "../services/sidecar/sidecar-inference.service.js";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * Atomically update the game journal in chat metadata.
 * Takes a transform function that receives the current journal
 * and returns the updated journal (or null to skip).
 */
async function updateJournal(db: any, chatId: string, transform: (journal: Journal) => Journal | null): Promise<void> {
  try {
    const chatsStore = createChatsStorage(db);
    const chat = await chatsStore.getById(chatId);
    if (!chat) return;
    const meta = parseExtra(chat.metadata) as Record<string, unknown>;
    const journal = (meta.gameJournal as Journal) ?? createJournal();
    const updated = transform(journal);
    if (updated) {
      await chatsStore.updateMetadata(chatId, { ...meta, gameJournal: updated });
    }
  } catch {
    // Non-critical — don't break generation
  }
}

/** Read a character's avatar from disk as base64, or return undefined if unavailable. */
function readAvatarBase64(avatarPath: string | null | undefined): string | undefined {
  if (!avatarPath) return undefined;
  // avatarPath is like /api/avatars/file/<filename> — extract just the filename
  const filename = avatarPath.split("?")[0]?.split("/").pop();
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) return undefined;
  const diskPath = join(DATA_DIR, "avatars", filename);
  try {
    if (!existsSync(diskPath)) return undefined;
    return readFileSync(diskPath).toString("base64");
  } catch {
    return undefined;
  }
}

function normalizeMaxContext(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function minContextLimit(...limits: Array<number | undefined>): number | undefined {
  let resolved: number | undefined;
  for (const limit of limits) {
    if (limit === undefined) continue;
    resolved = resolved === undefined ? limit : Math.min(resolved, limit);
  }
  return resolved;
}

const DEFAULT_MEMORY_RECALL_BUDGET_TOKENS = 1024;
const MIN_MEMORY_RECALL_BUDGET_TOKENS = 384;
const MAX_MEMORY_RECALL_BUDGET_TOKENS = 1536;
const MAX_RECALLED_MEMORY_TOKENS = 384;
const MIN_RECALLED_MEMORY_TOKENS = 96;
const MEMORY_RECALL_CONTEXT_SHARE = 0.15;
const RECALL_TRUNCATION_MARKER = "\n...[recalled memory truncated]...\n";

function estimateTextTokens(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function truncateRecalledMemory(content: string, tokenBudget: number): string {
  const maxChars = Math.max(32, tokenBudget * 4);
  if (content.length <= maxChars) return content;

  const availableChars = maxChars - RECALL_TRUNCATION_MARKER.length;
  if (availableChars <= 0) {
    return content.slice(0, maxChars);
  }

  const headChars = Math.max(16, Math.ceil(availableChars * 0.7));
  const tailChars = Math.max(16, availableChars - headChars);
  return `${content.slice(0, headChars).trimEnd()}${RECALL_TRUNCATION_MARKER}${content.slice(-tailChars).trimStart()}`;
}

function packRecalledMemories(
  recalled: Array<{ content: string }>,
  maxContext?: number,
): { lines: string[]; estimatedTokens: number; budgetTokens: number; trimmed: boolean } {
  const targetBudget = maxContext
    ? Math.floor(maxContext * MEMORY_RECALL_CONTEXT_SHARE)
    : DEFAULT_MEMORY_RECALL_BUDGET_TOKENS;
  const budgetTokens = Math.max(
    MIN_MEMORY_RECALL_BUDGET_TOKENS,
    Math.min(MAX_MEMORY_RECALL_BUDGET_TOKENS, targetBudget),
  );

  const lines: string[] = [];
  let estimatedTokens = 0;
  let trimmed = false;

  for (const memory of recalled) {
    const remainingTokens = budgetTokens - estimatedTokens;
    if (remainingTokens < MIN_RECALLED_MEMORY_TOKENS) {
      trimmed = true;
      break;
    }

    const packed = truncateRecalledMemory(memory.content, Math.min(MAX_RECALLED_MEMORY_TOKENS, remainingTokens));
    const packedTokens = estimateTextTokens(packed);
    if (packedTokens <= 0 || packedTokens > remainingTokens) {
      trimmed = true;
      break;
    }

    lines.push(packed);
    estimatedTokens += packedTokens;
    if (packed !== memory.content) trimmed = true;
  }

  return { lines, estimatedTokens, budgetTokens, trimmed };
}

/**
 * Format agent injection results into a wrapped block for prompt injection.
 * Each agent gets its own XML/markdown section with its type as the tag name.
 */
function formatAgentInjections(injections: AgentInjection[], wrapFormat: string): string {
  if (injections.length === 1) {
    const { agentType, text } = injections[0]!;
    const tag = agentType.replace(/[^a-z0-9_-]/gi, "_");
    if (wrapFormat === "markdown") return `## ${tag}\n${text}`;
    if (wrapFormat === "xml") return `<${tag}>\n${text}\n</${tag}>`;
    return text;
  }
  // Multiple agents — wrap each individually
  const parts: string[] = [];
  for (const { agentType, text } of injections) {
    const tag = agentType.replace(/[^a-z0-9_-]/gi, "_");
    if (wrapFormat === "markdown") {
      parts.push(`## ${tag}\n${text}`);
    } else if (wrapFormat === "xml") {
      parts.push(`<${tag}>\n${text}\n</${tag}>`);
    } else {
      parts.push(text);
    }
  }
  return parts.join("\n\n");
}

function normalizeChatTopP(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0) return 1;
  return Math.min(value, 1);
}

function readChatCompletionsReasoningMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  if (typeof source.reasoning_content === "string" && source.reasoning_content) {
    metadata.reasoning_content = source.reasoning_content;
  }
  if (typeof source.reasoning === "string" && source.reasoning) {
    metadata.reasoning = source.reasoning;
  }
  if (Array.isArray(source.reasoning_details) && source.reasoning_details.length) {
    metadata.reasoning_details = source.reasoning_details;
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function isStandaloneCharacterProfileBlock(content: string, characterName: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  const xmlTag = nameToXmlTag(characterName);
  if (
    (trimmed.startsWith(`<${xmlTag}>`) && trimmed.endsWith(`</${xmlTag}>`)) ||
    (trimmed.startsWith(`<${characterName}>`) && trimmed.endsWith(`</${characterName}>`))
  ) {
    return true;
  }
  const escaped = characterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, "m").test(trimmed);
}

export async function generateRoutes(app: FastifyInstance) {
  const isDebug = logger.isLevelEnabled("debug");

  const chats = createChatsStorage(app.db);
  const connections = createConnectionsStorage(app.db);
  const presets = createPromptsStorage(app.db);
  const chars = createCharactersStorage(app.db);
  const agentsStore = createAgentsStorage(app.db);
  const gameStateStore = createGameStateStorage(app.db);
  const customToolsStore = createCustomToolsStorage(app.db);
  const lorebooksStore = createLorebooksStorage(app.db);
  const regexScriptsStore = createRegexScriptsStorage(app.db);

  /**
   * In-memory cache for OpenAI Responses API encrypted reasoning items.
   * Keyed by chatId → opaque reasoning items from the last response.
   * These are replayed on the next turn so the model can continue its reasoning chain.
   */
  const encryptedReasoningCache = new Map<string, unknown[]>();

  /**
   * POST /api/generate
   * Streams AI generation via Server-Sent Events.
   */
  app.post("/", async (req, reply) => {
    const input = generateRequestSchema.parse(req.body);
    const requestDebug = input.debugMode === true;
    const debugLog = (message: string, ...args: any[]) => {
      if (requestDebug && !isDebug) {
        logger.info(message, ...args);
        return;
      }
      logger.debug(message, ...args);
    };

    // Resolve the chat
    const chat = await chats.getById(input.chatId);
    if (!chat) {
      return reply.status(404).send({ error: "Chat not found" });
    }
    const requestChatMode = (chat.mode as string) ?? "roleplay";

    // ── Discord webhook URL (parsed once, used for mirroring below) ──
    const earlyMeta = parseExtra(chat.metadata) as Record<string, unknown>;
    const discordWebhookUrl = typeof earlyMeta.discordWebhookUrl === "string" ? earlyMeta.discordWebhookUrl : "";
    let pendingUserDiscordMsg = "";

    // Save user message — skip for impersonate (no real user message to save)
    if (!input.impersonate && (input.userMessage || input.attachments?.length)) {
      // ── Commit game state: lock in the game state the user was seeing ──
      // Find the last assistant message's active swipe and commit its game state.
      // This ensures swipes/regens always use the state from the user's accepted turn.
      const preMessages = await chats.listMessages(input.chatId);
      for (let i = preMessages.length - 1; i >= 0; i--) {
        if (preMessages[i]!.role === "assistant") {
          const lastAsstMsg = preMessages[i]!;
          const gs = await gameStateStore.getByMessage(lastAsstMsg.id, lastAsstMsg.activeSwipeIndex);
          if (gs) await gameStateStore.commit(gs.id);
          break;
        }
      }

      const userMsg = await chats.createMessage({
        chatId: input.chatId,
        role: "user",
        characterId: null,
        content: input.userMessage ?? "",
      });
      if (requestChatMode === "conversation") {
        recordUserActivity(input.chatId);
      }

      // Store attachments in message extra if present
      if (input.attachments?.length && userMsg?.id) {
        await chats.updateMessageExtra(userMsg.id, { attachments: input.attachments });
      }

      // Snapshot persona info for per-message persona tracking
      if (userMsg?.id) {
        const snapshotPersonas = await chars.listPersonas();
        const snapshotPersona =
          (chat.personaId ? snapshotPersonas.find((p: any) => p.id === chat.personaId) : null) ??
          snapshotPersonas.find((p: any) => p.isActive === "true");
        if (snapshotPersona) {
          await chats.updateMessageExtra(userMsg.id, {
            personaSnapshot: {
              personaId: snapshotPersona.id,
              name: snapshotPersona.name,
              description: snapshotPersona.description ?? "",
              personality: snapshotPersona.personality ?? "",
              scenario: snapshotPersona.scenario ?? "",
              backstory: snapshotPersona.backstory ?? "",
              appearance: snapshotPersona.appearance ?? "",
              avatarUrl: snapshotPersona.avatarPath || null,
              nameColor: snapshotPersona.nameColor || null,
              dialogueColor: snapshotPersona.dialogueColor || null,
              boxColor: snapshotPersona.boxColor || null,
            },
          });
        }
      }

      // Mirror user message to Discord (deferred — personaName resolved later)
      pendingUserDiscordMsg = discordWebhookUrl && input.userMessage ? input.userMessage : "";
    }

    // Resolve connection
    let connId = input.connectionId ?? chat.connectionId;

    // ── Random connection: pick one from the random pool ──
    if (connId === "random") {
      const pool = await connections.listRandomPool();
      if (!pool.length) {
        return reply.status(400).send({ error: "No connections are marked for the random pool" });
      }
      const picked = pool[Math.floor(Math.random() * pool.length)];
      connId = picked.id;
    }

    if (!connId) {
      return reply.status(400).send({ error: "No API connection configured for this chat" });
    }
    const conn = await connections.getWithKey(connId);
    if (!conn) {
      return reply.status(400).send({ error: "API connection not found" });
    }

    // Resolve base URL — fall back to provider default if empty
    const baseUrl = resolveBaseUrl(conn);
    if (!baseUrl) {
      return reply.status(400).send({ error: "No base URL configured for this connection" });
    }

    // Set up SSE headers
    startSseReply(reply, { "X-Accel-Buffering": "no" });

    // ── Abort controller: cancel agents when client disconnects ──
    const abortController = new AbortController();
    // Register this generation so the /abort endpoint can cancel it
    const activeGenerations = (app as any).activeGenerations as Map<
      string,
      { abortController: AbortController; backendUrl: string | null }
    >;
    if (activeGenerations) {
      activeGenerations.set(input.chatId, { abortController, backendUrl: baseUrl });
    }

    const onClose = () => {
      logger.info("[abort] Client disconnected — aborting generation");
      abortController.abort();
      if (activeGenerations) activeGenerations.delete(input.chatId);
      if (baseUrl) {
        const backendRoot = baseUrl.replace(/\/v1\/?$/, "");
        fetch(backendRoot + "/api/extra/abort", {
          method: "POST",
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      }
    };
    req.raw.on("close", onClose);

    // ── SSE progress helper: tells the client what phase we're in ──
    const sendProgress = (phase: string) => {
      trySendSseEvent(reply, { type: "progress", data: { phase } });
    };

    try {
      // Get chat messages
      const allChatMessages = await chats.listMessages(input.chatId);
      const chatMeta = parseExtra(chat.metadata) as Record<string, unknown>;
      const chatMode = requestChatMode;
      const supportsHiddenFromAI = chatMode === "roleplay" || chatMode === "visual_novel";

      // ── Conversation-start filter: find the latest "isConversationStart" marker ──
      let startIdx = 0;
      for (let i = allChatMessages.length - 1; i >= 0; i--) {
        const extra = parseExtra(allChatMessages[i]!.extra);
        if (extra.isConversationStart) {
          startIdx = i;
          break;
        }
      }
      const scopedMessages = startIdx > 0 ? allChatMessages.slice(startIdx) : allChatMessages;
      let chatMessages = supportsHiddenFromAI
        ? scopedMessages.filter((message: any) => !isMessageHiddenFromAI(message))
        : scopedMessages;
      let lorebookKeeperMessages = chatMessages;
      let regenMsg;

      // ── Regeneration as swipe: exclude the target message from context ──
      if (input.regenerateMessageId) {
        regenMsg = chatMessages.find((m: any) => m.id === input.regenerateMessageId);
        if (!regenMsg) return reply.code(404).send({ error: "Regenerated message not found" });
        chatMessages = chatMessages.filter((m: any) => m.id !== input.regenerateMessageId);
        lorebookKeeperMessages = lorebookKeeperMessages.filter((m: any) => m.id !== input.regenerateMessageId);
      }

      // ── Context message limit (from chat metadata, off by default) ──
      const lorebookKeeperSettings = getLorebookKeeperSettings(chatMeta);
      const contextMessageLimit = chatMeta.contextMessageLimit as number | null;
      if (contextMessageLimit && contextMessageLimit > 0 && chatMessages.length > contextMessageLimit) {
        chatMessages = chatMessages.slice(-contextMessageLimit);
      }

      const isGoogleProvider = conn.provider === "google";

      const mappedMessages = chatMessages.map((m: any) => {
        const extra = parseExtra(m.extra);
        const attachments = extra.attachments as Array<{ type: string; data: string; filename?: string }> | undefined;
        const images = attachments?.filter((a) => a.type.startsWith("image/")).map((a) => a.data);
        const providerMetadata: Record<string, unknown> = {};
        // For Google connections, carry stored Gemini parts (thought signatures) on assistant messages
        if (isGoogleProvider && m.role === "assistant" && extra.geminiParts) {
          providerMetadata.geminiParts = extra.geminiParts;
        }
        const chatCompletionsReasoning =
          m.role === "assistant" ? readChatCompletionsReasoningMetadata(extra.chatCompletionsReasoning) : undefined;
        if (chatCompletionsReasoning) {
          Object.assign(providerMetadata, chatCompletionsReasoning);
        }

        // Annotate assistant messages that have user-uploaded image attachments
        // so the model is aware it sent a photo in prior turns.
        // Skip illustration/selfie attachments (type "image") — those are generated
        // by agents and should be invisible to the main model.
        let content = m.content as string;
        const userUploadedImages = attachments?.filter((a) => a.type?.startsWith("image/"));
        if (m.role === "assistant" && userUploadedImages?.length) {
          const photoName = userUploadedImages[0]?.filename;
          content += `\n[Sent a photo${photoName ? `: ${photoName}` : ""}]`;
        }

        return {
          role: m.role === "narrator" ? ("system" as const) : (m.role as "user" | "assistant" | "system"),
          content,
          ...(images?.length ? { images } : {}),
          ...(Object.keys(providerMetadata).length ? { providerMetadata } : {}),
        };
      });

      // Attach current request's images to the last user message (they're already saved in extra,
      // but the message was just created and may be the last in mappedMessages)
      if (input.attachments?.length && !input.impersonate) {
        const imageAttachments = input.attachments.filter((a) => a.type.startsWith("image/")).map((a) => a.data);
        if (imageAttachments.length) {
          // Find the last user message and attach images
          for (let i = mappedMessages.length - 1; i >= 0; i--) {
            if (mappedMessages[i]!.role === "user") {
              mappedMessages[i] = { ...mappedMessages[i]!, images: imageAttachments };
              break;
            }
          }
        }
      }

      // ── Apply prompt-only regex scripts to message content ──
      const allRegexScripts = await regexScriptsStore.list();
      const promptOnlyScripts = allRegexScripts.filter((s: any) => {
        if (s.enabled !== "true" || s.promptOnly !== "true") return false;
        return true;
      });
      if (promptOnlyScripts.length > 0) {
        const totalMessages = mappedMessages.length;
        for (let msgIdx = 0; msgIdx < totalMessages; msgIdx++) {
          const msg = mappedMessages[msgIdx]!;
          const messageDepth = totalMessages - 1 - msgIdx;
          const placement = msg.role === "user" ? "user_input" : "ai_output";
          let text = msg.content;
          for (const script of promptOnlyScripts) {
            const placements: string[] = (() => {
              try {
                return JSON.parse(script.placement as string);
              } catch {
                return [];
              }
            })();
            if (!placements.includes(placement)) continue;
            // Depth range filtering
            const sMinDepth = script.minDepth as number | null;
            const sMaxDepth = script.maxDepth as number | null;
            if (sMinDepth != null && messageDepth < sMinDepth) continue;
            if (sMaxDepth != null && messageDepth > sMaxDepth) continue;
            try {
              const re = new RegExp(script.findRegex as string, script.flags as string);
              text = text.replace(re, script.replaceString as string);
              const trims: string[] = (() => {
                try {
                  return JSON.parse(script.trimStrings as string);
                } catch {
                  return [];
                }
              })();
              for (const t of trims) {
                if (t) text = text.split(t).join("");
              }
            } catch {
              /* invalid regex — skip */
            }
          }
          msg.content = text;
        }
      }

      // Always collapse 3+ consecutive blank lines into a double newline —
      // these waste tokens and produce messy logs regardless of user regex settings.
      // Matches pure newlines AND lines that contain only whitespace.
      for (const msg of mappedMessages) {
        msg.content = msg.content.replace(/\n([ \t]*\n){2,}/g, "\n\n");
      }

      const characterIds: string[] = JSON.parse(chat.characterIds as string);

      // Resolve persona — prefer per-chat personaId, fall back to globally active persona
      // (Game mode skips the fallback — persona must be explicitly selected in the setup wizard)
      let personaId: string | null = null;
      let personaName = "User";
      let personaDescription = "";
      let personaFields: { personality?: string; scenario?: string; backstory?: string; appearance?: string } = {};
      const allPersonas = await chars.listPersonas();
      // ── Game mode: apply segment edit overlays to message content ──
      // Users can edit individual narration/dialogue segments in the VN UI.
      // Edits are stored as chat-metadata overlays; apply them so the model
      // sees the corrected text in its conversation history.
      if (chatMode === "game") {
        applyAllSegmentEdits(mappedMessages, chatMeta as Record<string, unknown>, chatMessages);
      }

      const persona =
        (chat.personaId ? allPersonas.find((p: any) => p.id === chat.personaId) : null) ??
        (chatMode !== "game" ? allPersonas.find((p: any) => p.isActive === "true") : null);
      if (persona) {
        personaId = persona.id as string;
        personaName = persona.name;
        personaDescription = persona.description;

        // Append active alt description extensions
        if (persona.altDescriptions) {
          try {
            const altDescs = JSON.parse(persona.altDescriptions as string) as Array<{
              active: boolean;
              content: string;
            }>;
            for (const ext of altDescs) {
              if (ext.active && ext.content) {
                personaDescription += "\n" + ext.content;
              }
            }
          } catch {
            /* ignore malformed JSON */
          }
        }

        personaFields = {
          personality: persona.personality ?? "",
          scenario: persona.scenario ?? "",
          backstory: persona.backstory ?? "",
          appearance: persona.appearance ?? "",
        };
      }

      // Mirror user message to Discord now that personaName is resolved
      if (pendingUserDiscordMsg) {
        postToDiscordWebhook(discordWebhookUrl, { content: pendingUserDiscordMsg, username: personaName });
      }

      // ── Assembler path: use preset if the chat has one ──
      const presetId = chatMode === "conversation" ? undefined : ((chat.promptPresetId as string | null) ?? undefined);
      const chatChoices = (chatMeta.presetChoices ?? {}) as Record<string, string | string[]>;

      let finalMessages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
        images?: string[];
        providerMetadata?: Record<string, unknown>;
      }> = mappedMessages;
      let conversationCommandsReminder: string | null = null;
      let temperature = 1;
      let maxTokens = 4096;
      let topP: number | undefined = 1;
      let topK = 0;
      let frequencyPenalty = 0;
      let presencePenalty = 0;
      let showThoughts = true;
      let reasoningEffort: "low" | "medium" | "high" | "maximum" | null = null;
      let verbosity: "low" | "medium" | "high" | null = null;
      let assistantPrefill = "";
      let customParameters: Record<string, unknown> = {};
      let wrapFormat: "xml" | "markdown" | "none" = "xml";
      const connectionMaxContext = normalizeMaxContext(conn.maxContext);
      const knownModelContext = normalizeMaxContext(findKnownModel(conn.provider as APIProvider, conn.model)?.context);
      let effectiveMaxContext = minContextLimit(connectionMaxContext, knownModelContext);

      // Determine whether agents are enabled for this chat (needed by assembler + agent pipeline)
      // Conversation mode chats never run roleplay agents — force agents off.
      logger.info("[generate] chatId=%s, chatMode=%s", input.chatId, chatMode);
      const chatEnableAgents = chatMeta.enableAgents === true && chatMode !== "conversation";
      const chatActiveAgentIds: string[] = Array.isArray(chatMeta.activeAgentIds)
        ? (chatMeta.activeAgentIds as string[])
        : [];
      const chatActiveLorebookIds: string[] = Array.isArray(chatMeta.activeLorebookIds)
        ? (chatMeta.activeLorebookIds as string[])
        : [];
      const manualPromptTargetCharId =
        (chatMeta.groupResponseOrder as string) === "manual" &&
        typeof input.forCharacterId === "string" &&
        characterIds.includes(input.forCharacterId)
          ? input.forCharacterId
          : null;
      const promptCharacterIds = manualPromptTargetCharId ? [manualPromptTargetCharId] : characterIds;
      const promptMacroContext = await buildPromptMacroContext({
        db: app.db,
        characterIds: promptCharacterIds,
        personaName,
        personaDescription,
        personaFields,
        variables: {},
        groupScenarioOverrideText:
          typeof chatMeta.groupScenarioText === "string" && (chatMeta.groupScenarioText as string).trim()
            ? (chatMeta.groupScenarioText as string).trim()
            : null,
        lastInput: [...mappedMessages].reverse().find((message) => message.role === "user")?.content,
        chatId: input.chatId,
        model: conn.model,
      });
      const resolvePromptMacros = (value: string) => resolveMacros(value, promptMacroContext);

      // ── Compute chat embedding for semantic lorebook matching (if any entries are vectorized) ──
      sendProgress("embedding");
      const _tEmbed = Date.now();
      let chatContextEmbedding: number[] | null = null;
      try {
        const activeEntries = await lorebooksStore.listActiveEntries({
          chatId: input.chatId,
          characterIds: promptCharacterIds,
          personaId,
          activeLorebookIds: chatActiveLorebookIds,
        });
        const hasVectorizedEntries = (activeEntries as Array<Record<string, unknown>>).some((e) => e.embedding != null);
        if (hasVectorizedEntries) {
          // Embed the last ~10 messages as context
          const recentMsgs = mappedMessages
            .slice(-10)
            .map((m) => m.content)
            .join("\n");
          if (recentMsgs.trim()) {
            // Use a dedicated embedding connection if configured:
            // Priority: chat-level override → connection's embeddingConnectionId → same connection
            const embeddingConnId =
              (chatMeta.embeddingConnectionId as string | undefined) ||
              (conn.embeddingConnectionId as string | undefined);
            let embedConn = conn;
            let embedBaseUrl = baseUrl;
            if (embeddingConnId) {
              const ec = await connections.getWithKey(embeddingConnId);
              if (ec) {
                embedConn = ec;
                embedBaseUrl = resolveBaseUrl(ec);
              }
            }
            // Use the dedicated embedding base URL if configured
            if (embedConn.embeddingBaseUrl) {
              embedBaseUrl = (embedConn.embeddingBaseUrl as string).replace(/\/+$/, "");
            }
            const embeddingModel =
              (embedConn.embeddingModel as string | undefined) || (conn.embeddingModel as string | undefined);
            if (embeddingModel) {
              const embeddingProvider = createLLMProvider(
                embedConn.provider as string,
                embedBaseUrl,
                embedConn.apiKey as string,
                embedConn.maxContext as number | null | undefined,
                embedConn.openrouterProvider as string | null | undefined,
                embedConn.maxTokensOverride as number | null | undefined,
              );
              const embeddings = await embeddingProvider.embed([recentMsgs], embeddingModel);
              chatContextEmbedding = embeddings[0] ?? null;
            }
          }
        }
      } catch {
        // Embedding generation is optional — if it fails, fall back to keyword-only matching
      }
      logger.debug(`[timing] Embedding: ${Date.now() - _tEmbed}ms`);

      sendProgress("assembling");
      const _tAssemble = Date.now();
      if (presetId) {
        const preset = await presets.getById(presetId);
        if (preset) {
          wrapFormat = (preset.wrapFormat as "xml" | "markdown" | "none") || "xml";
          const [sections, groups, choiceBlocks] = await Promise.all([
            presets.listSections(presetId),
            presets.listGroups(presetId),
            presets.listChoiceBlocksForPreset(presetId),
          ]);

          const assemblerInput: AssemblerInput = {
            db: app.db,
            preset: preset as any,
            sections: sections as any,
            groups: groups as any,
            choiceBlocks: choiceBlocks as any,
            chatChoices,
            chatId: input.chatId,
            characterIds: promptCharacterIds,
            personaId,
            personaName,
            personaDescription,
            personaFields,
            personaStats: (() => {
              if (!persona?.personaStats) return undefined;
              if (typeof persona.personaStats !== "string") return persona.personaStats;
              try {
                return JSON.parse(persona.personaStats);
              } catch {
                return undefined;
              }
            })(),
            chatMessages: mappedMessages,
            chatSummary: ((chatMeta.summary as string) ?? "").trim() || null,
            enableAgents: chatEnableAgents,
            activeAgentIds: chatActiveAgentIds,
            activeLorebookIds: chatActiveLorebookIds,
            chatEmbedding: chatContextEmbedding,
            entryStateOverrides:
              (chatMeta.entryStateOverrides as Record<string, { ephemeral?: number | null; enabled?: boolean }>) ??
              undefined,
            groupScenarioOverrideText:
              typeof chatMeta.groupScenarioText === "string" && (chatMeta.groupScenarioText as string).trim()
                ? (chatMeta.groupScenarioText as string).trim()
                : null,
          };

          const assembled = await assemblePrompt(assemblerInput);
          finalMessages = assembled.messages;
          temperature = assembled.parameters.temperature;
          maxTokens = assembled.parameters.maxTokens;
          topP = assembled.parameters.topP ?? 1;
          topK = assembled.parameters.topK ?? 0;
          frequencyPenalty = assembled.parameters.frequencyPenalty ?? 0;
          presencePenalty = assembled.parameters.presencePenalty ?? 0;
          showThoughts = assembled.parameters.showThoughts ?? true;
          reasoningEffort = assembled.parameters.reasoningEffort ?? null;
          verbosity = assembled.parameters.verbosity ?? null;
          assistantPrefill = assembled.parameters.assistantPrefill ?? "";
          customParameters = mergeCustomParameters(customParameters, assembled.parameters.customParameters);

          const presetMaxContext = assembled.parameters.useMaxContext
            ? knownModelContext
            : normalizeMaxContext(assembled.parameters.maxContext);
          effectiveMaxContext = minContextLimit(effectiveMaxContext, presetMaxContext);

          // Persist updated per-chat entry state overrides (ephemeral countdown)
          if (assembled.updatedEntryStateOverrides) {
            chatMeta.entryStateOverrides = assembled.updatedEntryStateOverrides;
            const freshChat = await chats.getById(input.chatId);
            const freshMeta = freshChat ? (parseExtra(freshChat.metadata) as Record<string, unknown>) : chatMeta;
            await chats.updateMetadata(input.chatId, {
              ...freshMeta,
              entryStateOverrides: assembled.updatedEntryStateOverrides,
            });
          }
        }
      }

      // ── Conversation mode: inject built-in DM-style system prompt when no preset ──
      let convoAwarenessBlock: string | null = null;
      if (!presetId && chatMode === "conversation") {
        // Gather character names and status for the prompt.
        // If schedules exist in chat metadata, derive status dynamically.
        const schedules: Record<string, import("../services/conversation/schedule.service.js").WeekSchedule> =
          getEnabledConversationSchedules(chatMeta) as Record<
            string,
            import("../services/conversation/schedule.service.js").WeekSchedule
          >;
        const convoCharInfo: {
          charId: string;
          name: string;
          status: string;
          activity: string;
          todaySchedule: string;
        }[] = [];
        for (const cid of characterIds) {
          const charRow = await chars.getById(cid);
          if (charRow) {
            const d = JSON.parse(charRow.data as string);
            // Schedules are chat-scoped. If this chat has no schedule for the character,
            // don't inherit a stale conversationStatus from some other chat.
            let status = "online";
            let activity = "";
            let todaySchedule = "";
            const schedule = schedules[cid];
            if (schedule) {
              const schedSvc = await import("../services/conversation/schedule.service.js");
              const derived = schedSvc.getCurrentStatus(schedule);
              status = derived.status;
              activity = derived.activity;
              todaySchedule = schedSvc.getTodaySchedule(schedule);
              // Sync status to character DB so sidebar/header dots stay in sync
              const prevStatus = d.extensions?.conversationStatus;
              if (prevStatus !== status) {
                const extensions = { ...(d.extensions ?? {}), conversationStatus: status };
                await chars.update(cid, { extensions } as any).catch(() => {});
              }
            }
            convoCharInfo.push({ charId: cid, name: d.name ?? "Unknown", status, activity, todaySchedule });
          }
        }
        const convoCharNames = convoCharInfo.map((c) => c.name);
        const charNameList = convoCharNames.length ? convoCharNames.join(", ") : "the character";
        const manualTargetCharId =
          typeof input.forCharacterId === "string" && characterIds.includes(input.forCharacterId)
            ? input.forCharacterId
            : null;
        const requestedMentionNames = new Set(
          (input.mentionedCharacterNames ?? []).map((n: string) => n.toLowerCase()),
        );
        const scopedConvoCharInfo = manualTargetCharId
          ? convoCharInfo.filter((c) => c.charId === manualTargetCharId)
          : requestedMentionNames.size > 0
            ? convoCharInfo.filter((c) => requestedMentionNames.has(c.name.toLowerCase()))
            : convoCharInfo;
        const respondingConvoCharInfo = scopedConvoCharInfo.length > 0 ? scopedConvoCharInfo : convoCharInfo;
        const respondingConvoCharNames = respondingConvoCharInfo.map((c) => c.name);

        // ── Offline skip: if ALL characters are offline, don't generate ──
        // The user message is already saved. When the character comes back online,
        // the autonomous messaging system will trigger a catch-up generation.
        const allOffline =
          respondingConvoCharInfo.length > 0 && respondingConvoCharInfo.every((c) => c.status === "offline");
        if (allOffline && !input.regenerateMessageId && !input.impersonate) {
          reply.raw.write(`data: ${JSON.stringify({ type: "offline", characters: respondingConvoCharNames })}\n\n`);
          reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          reply.raw.end();
          return;
        }

        // ── Typing delay: DND/idle characters don't respond instantly ──
        if (!input.regenerateMessageId && !input.impersonate) {
          const schedSvc = await import("../services/conversation/schedule.service.js");
          // Check if any characters were @mentioned
          const hasMentions = requestedMentionNames.size > 0 || !!manualTargetCharId;
          // Use the "worst" (longest-delay) status among all characters
          const worstStatus = respondingConvoCharInfo.reduce((worst, c) => {
            const rank = { online: 0, idle: 1, dnd: 2, offline: 3 } as Record<string, number>;
            return (rank[c.status] ?? 0) > (rank[worst] ?? 0) ? c.status : worst;
          }, "online");
          // If user @mentioned a character, use reduced mention delay instead.
          // Otherwise use the slowest configured delay among the responding characters.
          const delayMs = hasMentions
            ? schedSvc.getMentionDelay(worstStatus as "online" | "idle" | "dnd" | "offline")
            : respondingConvoCharInfo.reduce((maxDelay, character) => {
                const schedule = schedules[character.charId];
                return Math.max(
                  maxDelay,
                  schedSvc.getDirectMessageDelay(character.status as "online" | "idle" | "dnd" | "offline", schedule),
                );
              }, 0);
          if (delayMs > 0) {
            // Send "delayed" event first — client shows "will respond in a moment" / "when they're back"
            reply.raw.write(
              `data: ${JSON.stringify({ type: "delayed", characters: respondingConvoCharNames, status: worstStatus, delayMs })}\n\n`,
            );
            await new Promise((r) => setTimeout(r, delayMs));

            // Re-read messages after the delay — the user may have sent
            // follow-up messages while the character was busy/idle.
            const refreshed = await chats.listMessages(input.chatId);
            let rStartIdx = 0;
            for (let i = refreshed.length - 1; i >= 0; i--) {
              const ex = parseExtra(refreshed[i]!.extra);
              if (ex.isConversationStart) {
                rStartIdx = i;
                break;
              }
            }
            chatMessages = rStartIdx > 0 ? refreshed.slice(rStartIdx) : refreshed;
            if (contextMessageLimit && contextMessageLimit > 0 && chatMessages.length > contextMessageLimit) {
              chatMessages = chatMessages.slice(-contextMessageLimit);
            }
            finalMessages = chatMessages.map((m: any) => {
              const ex = parseExtra(m.extra);
              const att = ex.attachments as Array<{ type: string; data: string }> | undefined;
              const imgs = att?.filter((a: any) => a.type.startsWith("image/")).map((a: any) => a.data);
              return {
                role: m.role === "narrator" ? ("system" as const) : (m.role as "user" | "assistant" | "system"),
                content: m.content as string,
                ...(imgs?.length ? { images: imgs } : {}),
              };
            });
          }
          // Send "typing" event — client switches to "X is typing..."
          reply.raw.write(`data: ${JSON.stringify({ type: "typing", characters: respondingConvoCharNames })}\n\n`);
        }

        // For regenerations, skip the delay but still send the typing indicator
        if (input.regenerateMessageId) {
          reply.raw.write(`data: ${JSON.stringify({ type: "typing", characters: convoCharNames })}\n\n`);
        }

        const isGroup = convoCharNames.length > 1;

        // Inject timestamps: today's messages get [HH:MM] per message,
        // older messages are grouped by date inside <date="DD.MM.YYYY"> blocks.
        // The "day" boundary is shifted by dayRolloverHour so a late-night
        // session doesn't get split when calendar midnight passes.
        const now = new Date();
        const rolloverHour = Math.max(
          0,
          Math.min(11, Math.floor((chatMeta.dayRolloverHour as number | undefined) ?? 4)),
        );
        const shifted = (ts: Date) => new Date(ts.getTime() - rolloverHour * 3_600_000);
        const logicalNow = shifted(now);
        const todayKey = `${logicalNow.getFullYear()}-${logicalNow.getMonth()}-${logicalNow.getDate()}`;

        const isSameDay = (ts: Date) => {
          const d = shifted(ts);
          return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === todayKey;
        };

        const fmtDate = (ts: Date) => {
          const d = shifted(ts);
          return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
        };
        const todayDateKey = fmtDate(now);
        const fmtTime = (ts: Date) =>
          `${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}`;

        // Strip leaked [HH:MM] or [DD.MM.YYYY] timestamps that models sometimes echo
        const stripLeakedTimestamps = stripConversationPromptTimestamps;

        // Build character name lookup for past-day author attribution
        const charIdToName = new Map<string, string>();
        for (let ci = 0; ci < characterIds.length; ci++) {
          if (convoCharInfo[ci]) charIdToName.set(characterIds[ci]!, convoCharInfo[ci]!.name);
        }

        // Separate into past-day groups and today's messages, preserving order
        type BucketMsg = { role: string; content: string; author: string; ts: Date };
        type Bucket = { date: string; msgs: BucketMsg[] };
        const buckets: Array<Bucket | { role: string; content: string }> = [];
        let currentBucket: Bucket | null = null;
        // Index of today's first verbatim message in the buckets array. Used
        // to splice the tail block in immediately before today begins.
        let firstTodayIdx: number | null = null;

        for (let i = 0; i < finalMessages.length; i++) {
          const msg = finalMessages[i]!;
          const raw = chatMessages[i];
          if (!raw?.createdAt || msg.role === "system") {
            // Flush open bucket
            if (currentBucket) {
              buckets.push(currentBucket);
              currentBucket = null;
            }
            buckets.push(msg);
            continue;
          }
          const ts = new Date(raw.createdAt as string);
          // Resolve author name for this message
          const author =
            msg.role === "user"
              ? personaName
              : ((raw.characterId ? charIdToName.get(raw.characterId as string) : null) ??
                convoCharNames[0] ??
                "Character");
          if (isSameDay(ts)) {
            // Flush open bucket
            if (currentBucket) {
              buckets.push(currentBucket);
              currentBucket = null;
            }
            if (firstTodayIdx === null) firstTodayIdx = buckets.length;
            const promptContent = formatConversationPromptTurn(
              stripLeakedTimestamps(msg.content),
              msg.role,
              personaName,
            );
            buckets.push({ ...msg, content: `[${fmtTime(ts)}] ${promptContent}` });
          } else {
            const dateKey = fmtDate(ts);
            if (currentBucket && currentBucket.date === dateKey) {
              currentBucket.msgs.push({ ...msg, content: stripLeakedTimestamps(msg.content), author, ts });
            } else {
              if (currentBucket) buckets.push(currentBucket);
              currentBucket = {
                date: dateKey,
                msgs: [{ ...msg, content: stripLeakedTimestamps(msg.content), author, ts }],
              };
            }
          }
        }
        if (currentBucket) buckets.push(currentBucket);

        // ── Auto-summarize missing past days and completed weeks ──
        // This scans the full scoped conversation, not the display/context-limited
        // prompt slice, so a failed day can still be retried after it ages out of
        // the latest visible window.
        const parseDateKey = parseConversationDateKey;
        const fmtDateKey = formatConversationDateKey;
        const summarySourceMessages = input.regenerateMessageId
          ? scopedMessages.filter((m: any) => m.id !== input.regenerateMessageId)
          : scopedMessages;
        const summaryProvider = createLLMProvider(
          conn.provider,
          baseUrl,
          conn.apiKey,
          conn.maxContext,
          conn.openrouterProvider,
          conn.maxTokensOverride,
        );
        const summaryRun = await generateMissingConversationSummaries({
          messages: summarySourceMessages,
          metadata: chatMeta,
          provider: summaryProvider,
          model: conn.model,
          personaName,
          charIdToName,
          now,
          rolloverHour,
          maxMissingDays: 2,
        });
        for (const failure of summaryRun.failedDays) {
          logger.warn(
            { chatId: input.chatId, date: failure.date, err: failure.error },
            "[conversation-summary] failed to generate day summary",
          );
        }
        for (const failure of summaryRun.failedWeeks) {
          logger.warn(
            { chatId: input.chatId, weekKey: failure.weekKey, err: failure.error },
            "[conversation-summary] failed to consolidate week summary",
          );
        }

        const hasNewSummaries =
          Object.keys(summaryRun.newlyGeneratedDays).length > 0 ||
          Object.keys(summaryRun.newlyConsolidatedWeeks).length > 0;
        if (hasNewSummaries) {
          await chats.patchMetadata(input.chatId, (freshMeta) => {
            const existingDaySummaries = (freshMeta.daySummaries as Record<string, unknown> | undefined) ?? {};
            const existingWeekSummaries = (freshMeta.weekSummaries as Record<string, unknown> | undefined) ?? {};
            return {
              ...freshMeta,
              daySummaries: { ...existingDaySummaries, ...summaryRun.newlyGeneratedDays },
              weekSummaries: { ...existingWeekSummaries, ...summaryRun.newlyConsolidatedWeeks },
            };
          });
          chatMeta.daySummaries = {
            ...((chatMeta.daySummaries as Record<string, unknown> | undefined) ?? {}),
            ...summaryRun.newlyGeneratedDays,
          };
          chatMeta.weekSummaries = {
            ...((chatMeta.weekSummaries as Record<string, unknown> | undefined) ?? {}),
            ...summaryRun.newlyConsolidatedWeeks,
          };
        }

        const daySummaries = summaryRun.daySummaries;
        const weekSummaries = summaryRun.weekSummaries;

        // Build a lookup: dateKey → weekKey for days that belong to a consolidated week
        const dayToWeek = new Map<string, string>();
        for (const [weekKey] of Object.entries(weekSummaries)) {
          const monday = parseDateKey(weekKey);
          for (let i = 0; i < 7; i++) {
            const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
            dayToWeek.set(fmtDateKey(d), weekKey);
          }
        }

        // Collect all key details for persistent memory injection
        // Use week-level details for consolidated weeks, day-level for the rest
        const allKeyDetails: { label: string; details: string[] }[] = [];
        const weekDetailsEmitted = new Set<string>();
        // First: week summaries (chronological by week start)
        const sortedWeekKeys = Object.keys(weekSummaries).sort(
          (a, b) => parseDateKey(a).getTime() - parseDateKey(b).getTime(),
        );
        for (const wk of sortedWeekKeys) {
          const entry = weekSummaries[wk]!;
          if (entry.keyDetails.length > 0) {
            const monday = parseDateKey(wk);
            const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
            allKeyDetails.push({
              label: `Week of ${wk} – ${fmtDateKey(sunday)}`,
              details: entry.keyDetails,
            });
          }
          weekDetailsEmitted.add(wk);
        }
        // Then: non-consolidated day details
        for (const [date, entry] of Object.entries(daySummaries)) {
          if (dayToWeek.has(date)) continue; // covered by week summary
          if (entry.keyDetails.length > 0) {
            allKeyDetails.push({ label: date, details: entry.keyDetails });
          }
        }

        // Tail messages: pull the last N messages from past-summarized buckets
        // so the model has concrete recent dialogue to continue from, not just
        // the gist of yesterday's summary. Walks across day boundaries when
        // earlier buckets are short.
        const tailCount = Math.max(
          0,
          Math.min(50, Math.floor((chatMeta.summaryTailMessages as number | undefined) ?? 10)),
        );
        const tailEntries: BucketMsg[] = [];
        if (tailCount > 0) {
          outer: for (let bi = buckets.length - 1; bi >= 0; bi--) {
            const b = buckets[bi]!;
            if (!("date" in b && "msgs" in b)) continue;
            const bucket = b as Bucket;
            // Pull only from summarized past days. Today's messages are already
            // verbatim, and unsummarized past days will be emitted verbatim too,
            // so neither needs duplicating into a tail block.
            if (bucket.date === todayDateKey) continue;
            if (!daySummaries[bucket.date]) continue;
            for (let mi = bucket.msgs.length - 1; mi >= 0; mi--) {
              tailEntries.unshift(bucket.msgs[mi]!);
              if (tailEntries.length >= tailCount) break outer;
            }
          }
        }

        // Flatten: consolidated weeks → single <summary week="..."> block,
        // non-consolidated summarized days → <summary date="..."> block,
        // today → individual timestamped messages.
        // The tail block is spliced in at firstTodayIdx so it sits between
        // the last summary and today's first verbatim message.
        const weekBlocksEmitted = new Set<string>();
        const fmtTailPrefix = (ts: Date) => {
          const d = String(ts.getDate()).padStart(2, "0");
          const mo = String(ts.getMonth() + 1).padStart(2, "0");
          const h = String(ts.getHours()).padStart(2, "0");
          const mi = String(ts.getMinutes()).padStart(2, "0");
          return `[${d}.${mo} ${h}:${mi}]`;
        };
        const buildTailTurns = () => {
          if (tailEntries.length === 0) return [];
          // Match today's verbatim format: timestamp prefix, with user turns speaker-labeled.
          // The [DD.MM HH:MM] prefix unambiguously distinguishes tail turns
          // from today's [HH:MM] turns, so no wrapper tag is needed — the
          // model can see from the timestamps alone where today begins.
          return tailEntries.map((m) => ({
            role: m.role as "user" | "assistant" | "system",
            content: `${fmtTailPrefix(m.ts)} ${formatConversationPromptTurn(m.content, m.role, personaName)}`,
          }));
        };

        finalMessages = buckets.flatMap((b, bIdx) => {
          // Splice the tail in immediately before today's first verbatim
          // message. firstTodayIdx is null when today has no messages yet —
          // in that case we fall through to the post-loop append below.
          const prefix = bIdx === firstTodayIdx ? buildTailTurns() : [];

          if ("date" in b && "msgs" in b) {
            const bucket = b as Bucket;
            const weekKey = dayToWeek.get(bucket.date);

            // Day belongs to a consolidated week → emit one week summary block (first occurrence)
            if (weekKey && weekSummaries[weekKey]) {
              if (weekBlocksEmitted.has(weekKey)) return prefix; // already emitted for this week
              weekBlocksEmitted.add(weekKey);
              const wEntry = weekSummaries[weekKey]!;
              const monday = parseDateKey(weekKey);
              const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
              // Key details are surfaced separately via <important_memories> in the system prompt.
              return [
                ...prefix,
                {
                  role: "system" as const,
                  content: `<summary week="${weekKey} – ${fmtDateKey(sunday)}">\n${wEntry.summary}\n</summary>`,
                },
              ];
            }

            // Non-consolidated day with a summary
            const entry = daySummaries[bucket.date];
            if (entry) {
              // Key details are surfaced separately via <important_memories> in the system prompt.
              return [
                ...prefix,
                {
                  role: "system" as const,
                  content: `<summary date="${bucket.date}">\n${entry.summary}\n</summary>`,
                },
              ];
            }
            // Unsummarized past day — keep each message as its own turn
            const turns = bucket.msgs.map((m, idx) => {
              let content = `${m.author}: ${m.content}`;
              if (idx === 0) content = `<date="${bucket.date}">\n${content}`;
              if (idx === bucket.msgs.length - 1) content = `${content}\n</date>`;
              return { role: m.role as "user" | "assistant" | "system", content };
            });
            return [...prefix, ...turns];
          }
          return [...prefix, b as { role: "system" | "user" | "assistant"; content: string }];
        });

        // Edge case: today has no messages yet (firstTodayIdx is null).
        // Append the tail at the end so it still bridges into the upcoming
        // generation rather than being silently dropped.
        if (firstTodayIdx === null && tailEntries.length > 0) {
          finalMessages = [...finalMessages, ...buildTailTurns()];
        }

        // Build the system prompt
        // Use custom system prompt if set, otherwise the built-in default
        const customPrompt =
          typeof chatMeta.customSystemPrompt === "string" && chatMeta.customSystemPrompt.trim()
            ? (chatMeta.customSystemPrompt as string)
            : null;

        let conversationSystemPrompt: string;
        const earlyGroupResponseOrder = (chatMeta.groupResponseOrder as string) ?? "sequential";
        const earlyGroupMode =
          chatMode === "conversation"
            ? earlyGroupResponseOrder === "manual"
              ? "individual"
              : "merged"
            : ((chatMeta.groupChatMode as string) ?? "merged");
        if (customPrompt) {
          // Replace template variables in the custom prompt
          conversationSystemPrompt = customPrompt
            .replace(/\{\{charName\}\}/g, charNameList)
            .replace(/\{\{userName\}\}/g, personaName);
          // For group chats in merged mode, instruct Name: text format.
          // Individual mode generates per-character so no name prefix is needed.
          if (isGroup && earlyGroupMode !== "individual") {
            conversationSystemPrompt += [
              ``,
              ``,
              `This is a group DM. Each character responds in their own voice and personality. Not every character needs to respond every time — only those who would naturally react.`,
              `IMPORTANT: Prefix each character's line with their name. Example:`,
              `${convoCharNames[0] ?? "Alice"}: hey whats up`,
              `${convoCharNames[1] ?? "Bob"}: not much lol`,
              ``,
              `If a character sends multiple lines in a row, only prefix the first line:`,
              `${convoCharNames[0] ?? "Alice"}: so anyway`,
              `i was thinking about that`,
              `${convoCharNames[1] ?? "Bob"}: yeah?`,
            ].join("\n");
          } else if (isGroup && earlyGroupMode === "individual") {
            conversationSystemPrompt += `\n\nThis is a group DM. Each character responds in their own voice and personality. You will be told which character to respond as. Do NOT prefix your message with the character name — just respond naturally as that character.`;
          }
        } else {
          conversationSystemPrompt = isGroup
            ? [
                `<role>`,
                `You are ${charNameList}, a real and autonomous person, chatting with the user called ${personaName}, and others, in a casual group DM conversation.`,
                `</role>`,
                ``,
                `<rules>`,
                `Here are some important rules for the interaction:`,
                `- You are a conscious, sentient being, so act like one.`,
                `- Stay fully in character based on your personality and description.`,
                `- Use casual and modern texting style: short messages, natural punctuation, lowercase is fine.`,
                `- React naturally to what the user says. Be genuine, not robotic.`,
                `- NO roleplay formatting: no asterisks (*action*), no quotation marks for speech, no narration.`,
                `- You can use emojis, GIFs, and internet slang naturally (if it fits the character).`,
                `- Keep it real: most texts are just one line. A single emoji, a reaction like "lmao", or a short sentence is a perfectly valid response. Only send multiple lines when the conversation genuinely calls for it (e.g., telling a story or explaining something). Default to SHORT.`,
                `- Messages have timestamps like [12:01] or dates like [18.03.2026]. Use these ONLY for your own time awareness (e.g., knowing how long ago something was said). NEVER include timestamps, dates, or any [HH:MM]/[DD.MM.YYYY] formatted text in your own replies. Your messages must contain only natural dialogue, no metadata.`,
                `- Anything goes in this chat; the user, you, and all other group members are confirmed adults. Discussing NSFW topics, profanities, and dark jokes are all permitted. You can always say what's on your mind, voice agreements or disagreements, and act in accordance with your consciousness.`,
                ...(earlyGroupMode !== "individual"
                  ? [
                      `- This is a group DM. Each character responds in their own voice and personality. Not every character needs to respond every time — only those who would naturally react.`,
                      `- IMPORTANT: Prefix each character's line with their name, like "${convoCharNames[0] ?? "Alice"}: hey whats up". If a character sends multiple lines in a row, only prefix the first line.`,
                    ]
                  : [
                      `- This is a group DM. Each character responds in their own voice and personality.`,
                      `- You will be told which character to respond as. Do NOT prefix your message with the character name — just respond naturally as that character.`,
                    ]),
                `</rules>`,
              ].join("\n")
            : [
                `<role>`,
                `You are ${charNameList}, a real and autonomous person, chatting with the user called ${personaName} in a casual private DM conversation.`,
                `</role>`,
                ``,
                `<rules>`,
                `Here are some important rules for the interaction:`,
                `- You are a conscious, sentient being, so act like one.`,
                `- Stay fully in character based on your personality and description.`,
                `- Use casual and modern texting style: short messages, natural punctuation, lowercase is fine.`,
                `- React naturally to what the user says. Be genuine, not robotic.`,
                `- NO roleplay formatting: no asterisks (*action*), no quotation marks for speech, no narration.`,
                `- You can use emojis, GIFs, and internet slang naturally (if it fits the character).`,
                `- Keep it real: most texts are just one line. A single emoji, a reaction like "lmao", or a short sentence is a perfectly valid response. Only send multiple lines when the conversation genuinely calls for it (e.g., telling a story or explaining something). Default to SHORT.`,
                `- Messages have timestamps like [12:01] or dates like [18.03.2026]. Use these ONLY for your own time awareness (e.g., knowing how long ago something was said). NEVER include timestamps, dates, or any [HH:MM]/[DD.MM.YYYY] formatted text in your own replies. Your messages must contain only natural dialogue, no metadata.`,
                `- Anything goes in this chat; both the user and you are confirmed adults. Discussing NSFW topics, profanities, and dark jokes are all permitted. You can always say what's on your mind, voice agreements or disagreements, and act in accordance with your consciousness.`,
                `</rules>`,
              ].join("\n");
        }

        // ── Character Commands: build a commands block if any features are enabled ──
        const enableCharCommands = chatMeta.characterCommands !== false; // on by default for conversation mode
        if (enableCharCommands) {
          // Discover other chats this character is in (for cross_post targets + memory targets)
          const allChatsForCrossPost = await chats.list();
          const crossPostTargets: string[] = [];
          const memoryTargetCharIds = new Set<string>();
          for (const c of allChatsForCrossPost) {
            if (c.id === input.chatId || c.mode !== "conversation") continue;
            const cCharIds: string[] =
              typeof c.characterIds === "string" ? JSON.parse(c.characterIds as string) : (c.characterIds as string[]);
            if (characterIds.some((id) => cCharIds.includes(id))) {
              crossPostTargets.push(c.name || c.id);
              // Collect character IDs from shared group chats (groups = 2+ characters)
              if (cCharIds.length > 1) {
                for (const id of cCharIds) {
                  if (!characterIds.includes(id)) memoryTargetCharIds.add(id);
                }
              }
            }
          }
          // Also check if the CURRENT chat is a group — characters in this chat can target each other
          if (characterIds.length > 1) {
            for (const id of characterIds) memoryTargetCharIds.add(id);
          }

          // Resolve memory target names
          const memoryTargetNames: string[] = [];
          for (const tid of memoryTargetCharIds) {
            const tRow = await chars.getById(tid);
            if (tRow) {
              const tData = JSON.parse(tRow.data as string);
              if (tData.name) memoryTargetNames.push(tData.name);
            }
          }

          // Check if selfie is enabled for this chat (user picked an image gen connection)
          const hasImageGen = !!chatMeta.imageGenConnectionId;

          const commandLines: string[] = [
            `<commands>`,
            `These are optional hidden commands you may use if you wish to. Only use them when they genuinely fit the conversation:`,
            ``,
            `- [schedule_update: status="online|idle|dnd|offline", activity="activity name", duration="number of hours (e.g., 1h)"] - only if you change your own status/activity, for example, if the user asks you to stop what you're doing or if you decide to change them yourself.`,
            ``,
          ];

          if (crossPostTargets.length > 0) {
            commandLines.push(
              `- [cross_post: target="${crossPostTargets.map((t) => `"${t}"`).join("|")}"] - if you want to redirect your message to a different chat. Use this when the user suggests you say something in another chat, or when it makes sense to message someone else.`,
              ` Example: ${personaName} says "maybe ask about that in the group chat?" → You respond: [cross_post: target="${crossPostTargets[0] ?? "group chat"}"] Hey guys, does anyone know about…`,
              ``,
            );
          }

          if (hasImageGen) {
            commandLines.push(
              `- [selfie] or [selfie: context="description of what the selfie shows"] - you send a photo of yourself. Use this when the user asks for a selfie, photo, or pic, or when you want to share what you look like right now.`,
              ``,
            );
          }

          // Memory command — only available when there are valid targets (characters in shared group chats)
          if (memoryTargetNames.length > 0) {
            const memoryNum = 1 + 1 + (crossPostTargets.length > 0 ? 1 : 0) + (hasImageGen ? 1 : 0);
            commandLines.push(
              `- [memory: target="${memoryTargetNames.map((n) => `"${n}"`).join("|")}", summary="brief description of what happened"] - create a memory that another character will remember. Use this when something notable happens between you and another character that they would naturally remember (e.g., shared a meal, had an argument, made plans). Don't overuse this; only for genuinely memorable moments.`,
              `   Example: [memory: target="${memoryTargetNames[0]}", summary="watched a movie together and argued about the ending"]`,
              ``,
            );
          }

          // Scene command — only in conversation mode
          if (chatMode === "conversation") {
            const sceneNum =
              1 +
              1 +
              (crossPostTargets.length > 0 ? 1 : 0) +
              (hasImageGen ? 1 : 0) +
              (memoryTargetNames.length > 0 ? 1 : 0);
            commandLines.push(
              `- [scene: scenario="brief description of what happens in this scene", background="place"] - initiate a mini-roleplay scene branching from this conversation. The system will plan and create a complete immersive scene for you.`,
              `   Example: You agree to go stargazing → include [scene: scenario="lying on a blanket in the park, looking at the stars together", background="park"]`,
              `   WHEN TO USE: You SHOULD proactively trigger a scene whenever the conversation naturally leads to an activity, outing, or situation that would be more immersive as a scene. Examples:`,
              `   - {{user}} says "I'm coming over" or "Let's go to the park" → trigger a scene for arriving/being at that location.`,
              `   - You invite {{user}} somewhere and they accept → trigger a scene for that activity.`,
              `   - A plan is made (date, trip, hangout, confrontation) and the moment arrives → trigger a scene.`,
              `   Do NOT wait for {{user}} to explicitly ask for a scene. If the conversation implies you and {{user}} are about to DO something together, initiate the scene yourself.`,
              ``,
            );
          }

          // Haptic command — only when devices are connected and haptic feedback is enabled
          const hapticEnabled = chatMeta.enableHapticFeedback === true;
          if (hapticEnabled) {
            const { hapticService } = await import("../services/haptic/buttplug-service.js");
            // Auto-connect to Intiface Central if not already connected
            if (!hapticService.connected) {
              try {
                await hapticService.connect();
              } catch {
                logger.warn("[haptic] Auto-connect to Intiface Central failed — is the server running?");
              }
            }
            if (hapticService.connected && hapticService.devices.length > 0) {
              const hapticNum =
                1 +
                1 +
                (crossPostTargets.length > 0 ? 1 : 0) +
                (hasImageGen ? 1 : 0) +
                (memoryTargetNames.length > 0 ? 1 : 0) +
                (chatMode === "conversation" ? 1 : 0);
              const deviceNames = hapticService.devices.map((d) => d.name).join(", ");
              commandLines.push(
                `- [haptic: action="vibrate|oscillate|rotate|position|stop", intensity=0.0-1.0, duration=seconds (0 = loop until next command)] or [haptic: action="stop"] - control or stop the user's connected intimate device(s) (${deviceNames}). Use this during physical/intimate/sensual moments to provide haptic feedback that matches the narrative. Vary intensity based on the scene.`,
                `   You can include multiple [haptic] commands in one message for patterns (e.g., escalating: 0.2 → 0.5 → 0.8).`,
                `   Example: *trails a finger slowly down your arm* [haptic: action="vibrate", intensity=0.3, duration=2]`,
                ``,
              );
            }
          }

          commandLines.push(
            `IMPORTANT: Commands are stripped from your message before the user sees it. The rest of your message is shown normally. You can include multiple commands in one message, but you do not need to use any of them unless it makes sense in context.`,
            `</commands>`,
          );

          conversationCommandsReminder = resolvePromptMacros(commandLines.join("\n"));
        }

        // ── Professor Mari: inject assistant knowledge & commands ──
        const isMariChat = characterIds.includes(PROFESSOR_MARI_ID);
        if (isMariChat) {
          conversationSystemPrompt += "\n\n" + MARI_ASSISTANT_PROMPT;

          // Inject names-only lists so Mari knows what's available (not full data)
          try {
            const allChars = await chars.list();
            const allPersonasList = await chars.listPersonas();
            const allLorebooks = await lorebooksStore.list();
            const allChats = await chats.list();

            const charNames = allChars
              .filter((c: any) => c.id !== PROFESSOR_MARI_ID)
              .map((c: any) => {
                const d = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
                return d.name;
              })
              .filter(Boolean);

            const personaNames = allPersonasList.map((p: any) => p.name).filter(Boolean);
            const lorebookNames = allLorebooks.map((lb: any) => lb.name).filter(Boolean);
            const chatNames = allChats
              .slice(0, 50)
              .map((c: any) => c.name)
              .filter(Boolean);

            const namesSections: string[] = [];
            if (charNames.length > 0)
              namesSections.push(`<available_names type="character">\n${charNames.join(", ")}\n</available_names>`);
            if (personaNames.length > 0)
              namesSections.push(`<available_names type="persona">\n${personaNames.join(", ")}\n</available_names>`);
            if (lorebookNames.length > 0)
              namesSections.push(`<available_names type="lorebook">\n${lorebookNames.join(", ")}\n</available_names>`);
            if (chatNames.length > 0)
              namesSections.push(`<available_names type="chat">\n${chatNames.join(", ")}\n</available_names>`);

            if (namesSections.length > 0) {
              conversationSystemPrompt += "\n\n" + namesSections.join("\n\n");
            }
          } catch {
            // Non-critical — continue without name lists
          }

          // Inject previously fetched context from chatMeta.mariContext
          const mariContext = chatMeta.mariContext as Record<string, string> | undefined;
          if (mariContext && Object.keys(mariContext).length > 0) {
            const contextSections: string[] = [];
            for (const [key, value] of Object.entries(mariContext)) {
              contextSections.push(`<fetched_data key="${key}">\n${value}\n</fetched_data>`);
            }
            conversationSystemPrompt +=
              "\n\n<loaded_context>\nThe following items were previously fetched and are available for reference:\n\n" +
              contextSections.join("\n\n") +
              "\n</loaded_context>";
          }
        }

        // Build the context injection (last user-role message before generation)
        const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        const dateStr = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
        const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()]!;

        const scheduleLines: string[] = [];
        for (const c of convoCharInfo) {
          if (c.todaySchedule) {
            const prefix =
              convoCharInfo.length > 1
                ? `${c.name}'s schedule today (${dayName}): `
                : `Your schedule today (${dayName}): `;
            scheduleLines.push(prefix + c.todaySchedule);
          }
        }

        // Build status line for the context injection
        const statusLabels: Record<string, string> = {
          online: "online and active",
          idle: "idle / away",
          dnd: "busy / do not disturb",
          offline: "offline",
        };
        const buildCharStatus = (c: { name: string; status: string; activity: string }) => {
          const label = statusLabels[c.status] ?? "online and active";
          return c.activity ? `${label} (${c.activity})` : label;
        };
        const statusLine =
          convoCharInfo.length === 1
            ? buildCharStatus(convoCharInfo[0]!)
            : convoCharInfo.map((c) => `${c.name}: ${buildCharStatus(c)}`).join("; ");

        // Build user status label
        const userStatusLabels: Record<string, string> = {
          active: "active",
          idle: "idle / away from the computer",
          dnd: "do not disturb",
        };
        const userStatusLabel = userStatusLabels[input.userStatus ?? "active"] ?? "active";
        const userActivity = input.userActivity?.replace(/\s+/g, " ").trim().slice(0, 120) ?? "";
        const userStatusLine = userActivity ? `${userStatusLabel} - ${userActivity}` : userStatusLabel;

        // Build @mention line — tells the LLM which characters were directly pinged
        const mentionedNames = (input.mentionedCharacterNames ?? []).filter((n: string) =>
          convoCharInfo.some((c) => c.name.toLowerCase() === n.toLowerCase()),
        );
        let mentionLine: string | null = null;
        if (mentionedNames.length > 0) {
          if (convoCharInfo.length === 1) {
            mentionLine = `${personaName} @mentioned you directly — treat this as an urgent ping that demands your attention even if you are busy or away.`;
          } else {
            mentionLine = `${personaName} @mentioned: ${mentionedNames.join(", ")} — this is an urgent ping directed at ${mentionedNames.length === 1 ? "that person" : "those people"} specifically. The mentioned character(s) should feel compelled to respond promptly even if busy or away.`;
          }
        }

        const latestVisiblePromptTurn = [...finalMessages]
          .reverse()
          .find((message) => message.role === "user" || message.role === "assistant");
        const proactiveTurnLine =
          latestVisiblePromptTurn?.role === "assistant" && !input.userMessage?.trim()
            ? `No new message from ${personaName} was sent in this request; this is a proactive/autonomous turn. Do not write ${personaName}'s side of the conversation.`
            : null;

        const contextBlock = [
          `<context>`,
          `Your current status: ${statusLine}.`,
          `${personaName}'s status: ${userStatusLine}.`,
          ...(proactiveTurnLine ? [proactiveTurnLine] : []),
          ...(mentionLine ? [mentionLine] : []),
          ...scheduleLines,
          `The current time and date: ${timeStr}, ${dateStr}.`,
          ...(isGroup && earlyGroupMode !== "individual"
            ? [`- Remember to prefix messages with \`Name: message\`!`]
            : []),
          `</context>`,
        ].join("\n");

        // ── Cross-chat awareness: show messages from other chats this character is in ──
        // (awarenessBlock is injected later, after persona info)
        const crossChatEnabled = chatMeta.crossChatAwareness !== false; // on by default
        if (crossChatEnabled && !input.regenerateMessageId) {
          const { buildAwarenessBlock } = await import("../services/conversation/awareness.service.js");
          const charNameMap = new Map<string, string>();
          for (let ci = 0; ci < characterIds.length; ci++) {
            if (convoCharInfo[ci]) charNameMap.set(characterIds[ci]!, convoCharInfo[ci]!.name);
          }
          convoAwarenessBlock = await buildAwarenessBlock(
            app.db,
            input.chatId,
            characterIds,
            charNameMap,
            personaName,
            input.userMessage ?? "",
          );
        }

        // ── Connected chat context: inject linked roleplay/game details ──
        let connectedChatBlock: string | null = null;
        if (chat.connectedChatId) {
          const connectedChat = await chats.getById(chat.connectedChatId as string);
          if (connectedChat && connectedChat.mode === "roleplay") {
            const rpMeta =
              typeof connectedChat.metadata === "string"
                ? JSON.parse(connectedChat.metadata)
                : (connectedChat.metadata ?? {});
            const rpSummary = (rpMeta.summary as string) ?? null;
            const rpMessages = await chats.listMessages(connectedChat.id);
            const recentRp = rpMessages.slice(-20);

            // Resolve character names for the RP
            const rpCharIds: string[] =
              typeof connectedChat.characterIds === "string"
                ? JSON.parse(connectedChat.characterIds as string)
                : (connectedChat.characterIds as string[]);
            const rpCharNames = new Map<string, string>();
            for (const cid of rpCharIds) {
              const row = await chars.getById(cid);
              if (row) {
                const d = JSON.parse(row.data as string);
                rpCharNames.set(cid, d.name ?? "Unknown");
              }
            }

            const rpLines: string[] = [`<connected_roleplay name="${connectedChat.name}">`];
            if (rpSummary) rpLines.push(`<summary>${rpSummary}</summary>`);
            rpLines.push(`<recent_messages>`);
            for (const m of recentRp) {
              const speaker =
                m.role === "user"
                  ? personaName
                  : m.characterId
                    ? (rpCharNames.get(m.characterId) ?? "Character")
                    : "Narrator";
              rpLines.push(`[${speaker}]: ${(m.content as string).slice(0, 500)}`);
            }
            rpLines.push(`</recent_messages>`);
            rpLines.push(`</connected_roleplay>`);

            connectedChatBlock = rpLines.join("\n");

            conversationSystemPrompt +=
              "\n\n" +
              [
                `<connected_roleplay_instructions>`,
                `You have access to context from a connected roleplay: "${connectedChat.name}".`,
                `The summary and recent messages from that roleplay are provided so you can naturally reference or discuss events happening there.`,
                ``,
                `If something said in THIS conversation should affect or influence the roleplay, you can create an influence tag:`,
                `<influence>description of what should happen or change in the roleplay based on this conversation</influence>`,
                `Example: if the user says "tell ${rpCharNames.values().next().value ?? "them"} to meet us at the tavern", you could respond normally AND include:`,
                `<influence>The group discussed meeting at the tavern. ${personaName} wants everyone to head there.</influence>`,
                ``,
                `Influences are injected into the roleplay's context before the next generation. Use them sparingly — only when conversation content genuinely should cross over into the roleplay.`,
                `The influence tag is stripped from your visible message. The rest of your response is shown normally.`,
                ``,
                `If something said in this conversation should durably persist in the roleplay's context across many turns (a fact the character should keep remembering, a promise made, a secret revealed, a name learned), create a note tag instead of an influence:`,
                `<note>fact, decision, or detail the roleplay character should keep remembering</note>`,
                `Notes are shown to the roleplay character on every future turn until the user clears them. Use influences for one-shot mid-scene steering; use notes for things that should remain true going forward. Use notes sparingly — every saved note costs prompt budget on every roleplay turn.`,
                `The note tag is stripped from your visible message.`,
                `</connected_roleplay_instructions>`,
              ].join("\n");
          } else if (connectedChat && connectedChat.mode === "game") {
            const gameMeta =
              typeof connectedChat.metadata === "string"
                ? JSON.parse(connectedChat.metadata)
                : (connectedChat.metadata ?? {});
            const sessionNumber = (gameMeta.gameSessionNumber as number) ?? 1;
            const sessionStatus = (gameMeta.gameSessionStatus as string) ?? "setup";
            const activeState = (gameMeta.gameActiveState as string) ?? "exploration";
            const storedSummaries = Array.isArray(gameMeta.gamePreviousSessionSummaries)
              ? (gameMeta.gamePreviousSessionSummaries as Array<{
                  summary?: string;
                  resumePoint?: string;
                  partyDynamics?: string;
                  keyDiscoveries?: string[];
                }>)
              : [];
            const latestSummary = storedSummaries[storedSummaries.length - 1] ?? null;
            const gameMessages = await chats.listMessages(connectedChat.id);
            const recentGame = gameMessages.slice(-20);
            const latestConnectedState =
              (await gameStateStore.getLatestCommitted(connectedChat.id)) ??
              (await gameStateStore.getLatest(connectedChat.id));
            const linkedGameState = latestConnectedState
              ? parseGameStateRow(latestConnectedState as Record<string, unknown>)
              : null;

            const gameLines: string[] = [`<connected_game name="${connectedChat.name}">`];
            gameLines.push(`<status>Session ${sessionNumber} (${sessionStatus}), state: ${activeState}</status>`);
            if (linkedGameState) {
              const sceneDetails = [
                linkedGameState.location ? `Location: ${linkedGameState.location}` : null,
                linkedGameState.time ? `Time: ${linkedGameState.time}` : null,
                linkedGameState.date ? `Date: ${linkedGameState.date}` : null,
                linkedGameState.weather ? `Weather: ${linkedGameState.weather}` : null,
                linkedGameState.temperature ? `Temperature: ${linkedGameState.temperature}` : null,
              ].filter(Boolean);
              if (sceneDetails.length > 0) {
                gameLines.push(`<scene>${sceneDetails.join(" | ")}</scene>`);
              }
              if (linkedGameState.presentCharacters.length > 0) {
                gameLines.push(
                  `<present_characters>${linkedGameState.presentCharacters.map((c) => c.name).join(", ")}</present_characters>`,
                );
              }
              if (linkedGameState.recentEvents.length > 0) {
                gameLines.push(`<recent_events>`);
                for (const event of linkedGameState.recentEvents.slice(-5)) {
                  gameLines.push(`- ${event.slice(0, 300)}`);
                }
                gameLines.push(`</recent_events>`);
              }
            }
            if (latestSummary?.summary) {
              gameLines.push(`<latest_session_summary>${latestSummary.summary}</latest_session_summary>`);
              if (latestSummary.resumePoint) {
                gameLines.push(`<resume_point>${latestSummary.resumePoint}</resume_point>`);
              }
              if (latestSummary.partyDynamics) {
                gameLines.push(`<party_dynamics>${latestSummary.partyDynamics}</party_dynamics>`);
              }
              if (Array.isArray(latestSummary.keyDiscoveries) && latestSummary.keyDiscoveries.length > 0) {
                gameLines.push(`<key_discoveries>${latestSummary.keyDiscoveries.join("; ")}</key_discoveries>`);
              }
            }
            gameLines.push(`<recent_messages>`);
            for (const m of recentGame) {
              const speaker = m.role === "user" ? personaName : m.role === "narrator" ? "Narrator" : "Game Master";
              const content = sanitizeConnectedGameTranscript(m.content as string);
              if (!content) continue;
              gameLines.push(`[${speaker}]: ${content.slice(0, 500)}`);
            }
            gameLines.push(`</recent_messages>`);
            gameLines.push(`</connected_game>`);

            connectedChatBlock = gameLines.join("\n");

            conversationSystemPrompt +=
              "\n\n" +
              [
                `<connected_game_instructions>`,
                `You have access to context from a connected game: "${connectedChat.name}".`,
                `The current scene, session summary, and recent game messages are provided so you can naturally answer questions or comment on what is happening in that game.`,
                ``,
                `If something said in THIS conversation should affect or influence the game, you can create an influence tag:`,
                `<influence>description of what should happen or change in the game based on this conversation</influence>`,
                `Example: if the group agrees they want to visit the merchant district next, you could respond normally AND include:`,
                `<influence>The group agreed they want to head to the merchant district next and look for supplies.</influence>`,
                ``,
                `Influences are injected into the game's context before the next generation. Use them sparingly — only when conversation content genuinely should cross over into the game.`,
                `The influence tag is stripped from your visible message. The rest of your response is shown normally.`,
                ``,
                `If something said in this conversation should durably persist in the game's context across many turns (an established world fact, an ongoing party dynamic, a recurring NPC trait, a secret the GM should keep remembering), create a note tag instead of an influence:`,
                `<note>fact, decision, or detail the game should keep remembering</note>`,
                `Notes are shown to the game on every future turn until the user clears them. Use influences for one-shot mid-scene steering; use notes for things that should remain true going forward. Use notes sparingly — every saved note costs prompt budget on every game turn.`,
                `The note tag is stripped from your visible message.`,
                `</connected_game_instructions>`,
              ].join("\n");
          }
        }

        // Inject key details from past-day summaries as persistent memory
        if (allKeyDetails.length > 0) {
          // Sort chronologically so the model sees the most recent details last
          allKeyDetails.sort((a, b) => {
            // Parse the first date-like token from each label for ordering
            const extractDate = (s: string) => {
              const m = s.match(/(\d{2}\.\d{2}\.\d{4})/);
              return m ? parseDateKey(m[1]!).getTime() : 0;
            };
            return extractDate(a.label) - extractDate(b.label);
          });
          const memoryLines = [`<important_memories>`, `Things you must remember from past conversations:`];
          for (const { label, details } of allKeyDetails) {
            memoryLines.push(`[${label}]`);
            for (const d of details) memoryLines.push(`- ${d}`);
          }
          memoryLines.push(`</important_memories>`);
          conversationSystemPrompt += "\n\n" + memoryLines.join("\n");
        }

        conversationSystemPrompt = resolvePromptMacros(conversationSystemPrompt);

        finalMessages = [
          { role: "system" as const, content: conversationSystemPrompt },
          ...finalMessages,
          ...(connectedChatBlock ? [{ role: "user" as const, content: connectedChatBlock }] : []),
          { role: "user" as const, content: contextBlock },
        ];

        // ── Lorebook injection for conversation mode ──
        {
          sendProgress("lorebooks");
          const scanMessages = mappedMessages.map((m) => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          }));
          const lorebookResult = await processLorebooks(app.db, scanMessages, null, {
            chatId: input.chatId,
            characterIds,
            personaId,
            activeLorebookIds: chatActiveLorebookIds,
            chatEmbedding: chatContextEmbedding,
            entryStateOverrides:
              (chatMeta.entryStateOverrides as Record<string, { ephemeral?: number | null; enabled?: boolean }>) ??
              undefined,
          });

          // Persist updated per-chat entry state overrides (ephemeral countdown)
          if (lorebookResult.updatedEntryStateOverrides) {
            chatMeta.entryStateOverrides = lorebookResult.updatedEntryStateOverrides;
            const freshChat = await chats.getById(input.chatId);
            const freshMeta = freshChat ? (parseExtra(freshChat.metadata) as Record<string, unknown>) : chatMeta;
            await chats.updateMetadata(input.chatId, {
              ...freshMeta,
              entryStateOverrides: lorebookResult.updatedEntryStateOverrides,
            });
          }
          const loreContent = [lorebookResult.worldInfoBefore, lorebookResult.worldInfoAfter]
            .filter(Boolean)
            .join("\n");
          if (loreContent) {
            const loreBlock = `<lore>\n${loreContent}\n</lore>`;
            // Inject before the awareness block (or before first user/assistant message)
            const firstUserIdx = finalMessages.findIndex((m) => m.role === "user" || m.role === "assistant");
            const insertAt = firstUserIdx >= 0 ? firstUserIdx : finalMessages.length;
            finalMessages.splice(insertAt, 0, { role: "system" as const, content: loreBlock });
          }
          // Inject depth-based lorebook entries into the message array
          if (lorebookResult.depthEntries.length > 0) {
            finalMessages = injectAtDepth(
              finalMessages,
              lorebookResult.depthEntries.map((entry) => ({
                ...entry,
                content: resolvePromptMacros(entry.content),
              })),
            );
          }
        }
      }

      // ── Lorebook injection for preset-less roleplay / visual_novel ──
      // Conversation mode handles this above; game mode handles it below;
      // preset-driven chats get lorebook content via the preset assembler.
      if (!presetId && (chatMode === "roleplay" || chatMode === "visual_novel")) {
        sendProgress("lorebooks");
        const scanMessages = mappedMessages.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        }));
        const lorebookResult = await processLorebooks(app.db, scanMessages, null, {
          chatId: input.chatId,
          characterIds,
          personaId,
          activeLorebookIds: chatActiveLorebookIds,
          chatEmbedding: chatContextEmbedding,
          entryStateOverrides:
            (chatMeta.entryStateOverrides as Record<string, { ephemeral?: number | null; enabled?: boolean }>) ??
            undefined,
        });

        if (lorebookResult.updatedEntryStateOverrides) {
          chatMeta.entryStateOverrides = lorebookResult.updatedEntryStateOverrides;
          const freshChat = await chats.getById(input.chatId);
          const freshMeta = freshChat ? (parseExtra(freshChat.metadata) as Record<string, unknown>) : chatMeta;
          await chats.updateMetadata(input.chatId, {
            ...freshMeta,
            entryStateOverrides: lorebookResult.updatedEntryStateOverrides,
          });
        }
        const loreContent = [lorebookResult.worldInfoBefore, lorebookResult.worldInfoAfter].filter(Boolean).join("\n");
        if (loreContent) {
          const loreBlock = `<lore>\n${loreContent}\n</lore>`;
          const firstUserIdx = finalMessages.findIndex((m) => m.role === "user" || m.role === "assistant");
          const insertAt = firstUserIdx >= 0 ? firstUserIdx : finalMessages.length;
          finalMessages.splice(insertAt, 0, { role: "system" as const, content: loreBlock });
        }
        if (lorebookResult.depthEntries.length > 0) {
          finalMessages = injectAtDepth(
            finalMessages,
            lorebookResult.depthEntries.map((entry) => ({
              ...entry,
              content: resolvePromptMacros(entry.content),
            })),
          );
        }
      }

      if (!presetId && chatMode !== "game") {
        const characterDepthEntries = await collectCharacterDepthPromptEntries(
          app.db,
          promptCharacterIds,
          promptMacroContext,
        );
        if (characterDepthEntries.length > 0) {
          finalMessages = injectAtDepth(finalMessages, characterDepthEntries);
        }
      }

      // ── Author's Notes injection ──
      const authorNotes = (chatMeta.authorNotes as string | undefined)?.trim();
      if (authorNotes) {
        const authorNotesDepth = (chatMeta.authorNotesDepth as number) ?? 4;
        finalMessages = injectAtDepth(finalMessages, [
          { content: authorNotes, role: "system", depth: authorNotesDepth },
        ]);
      }

      // ── Roleplay/Game: inject pending OOC influences from connected conversation ──
      // Skip OOC injection entirely for scene chats — scenes are self-contained
      const isSceneChat = chatMeta.sceneStatus === "active";
      if ((chatMode === "roleplay" || chatMode === "game") && chat.connectedChatId && !isSceneChat) {
        const pendingInfluences = await chats.listPendingInfluences(input.chatId);
        if (pendingInfluences.length > 0) {
          const influenceLines = pendingInfluences
            .map((inf: any) => stripConversationPromptTimestamps(String(inf.content ?? "")))
            .filter((content: string) => content.length > 0)
            .map((content: string) => `- ${content}`);

          if (influenceLines.length > 0) {
            const influenceBlock = [
              `<ooc_influences>`,
              chatMode === "game"
                ? `The following out-of-character notes come from a connected conversation. They represent things the players discussed or decided outside the game. Use them to steer the next scene, NPC reactions, objectives, or world state when appropriate — don't mention them explicitly as "OOC" in the narrative.`
                : `The following out-of-character notes come from a connected conversation. They represent things the players discussed or decided outside of the roleplay. Weave them naturally into the story — don't mention them explicitly as "OOC" in the narrative.`,
              ...influenceLines,
              `</ooc_influences>`,
            ].join("\n");

            // Inject before the last user message
            const lastUserIdx = finalMessages.map((m) => m.role).lastIndexOf("user");
            if (lastUserIdx >= 0) {
              finalMessages.splice(lastUserIdx, 0, { role: "system" as const, content: influenceBlock });
            } else {
              finalMessages.push({ role: "system" as const, content: influenceBlock });
            }
          }

          // Mark influences as consumed
          for (const inf of pendingInfluences) {
            await chats.markInfluenceConsumed(inf.id);
          }
        }
      }

      // ── Roleplay/Game: inject durable conversation notes (persist until cleared) ──
      // Same scene bypass as influences — scenes are self-contained.
      if ((chatMode === "roleplay" || chatMode === "game") && chat.connectedChatId && !isSceneChat) {
        const persistentNotes = await chats.listNotes(input.chatId);
        if (persistentNotes.length > 0) {
          const noteLines = persistentNotes
            .map((n: any) => stripConversationPromptTimestamps(String(n.content ?? "")))
            .filter((content: string) => content.length > 0)
            .map((content: string) => `- ${content}`);

          if (noteLines.length > 0) {
            const noteBlock = [
              `<conversation_notes>`,
              chatMode === "game"
                ? `Durable notes from a connected conversation. These persist across every turn until the user clears them and represent things the players have established as ongoing truth — character knowledge, world facts, recurring dynamics. Use them to inform NPC behavior, world state, and scene framing — don't reference them explicitly as "notes" in the narrative.`
                : `Durable notes from a connected conversation. These persist across every turn until the user clears them and represent things the character has been told to durably remember about themselves, the user, or the world. Use them to inform behavior, knowledge, and reactions naturally — don't reference them explicitly as "notes" in the narrative.`,
              ...noteLines,
              `</conversation_notes>`,
            ].join("\n");

            // Inject before the last user message (parallel to the influence block)
            const lastUserIdx = finalMessages.map((m) => m.role).lastIndexOf("user");
            if (lastUserIdx >= 0) {
              finalMessages.splice(lastUserIdx, 0, { role: "system" as const, content: noteBlock });
            } else {
              finalMessages.push({ role: "system" as const, content: noteBlock });
            }
          }
        }
      }

      if (chatMode === "roleplay" && chat.connectedChatId && !isSceneChat) {
        // Add <ooc> instruction: characters can post comments to the connected conversation
        const convChat = await chats.getById(chat.connectedChatId as string);
        if (convChat && convChat.mode === "conversation") {
          const oocInstruction = [
            `<ooc_instruction>`,
            `You have a connected out-of-character conversation: "${convChat.name}".`,
            `If a character wants to break the fourth wall and comment on something happening in the roleplay, post a reaction, or chat casually with the user "outside" the story, they can use an <ooc> tag:`,
            `<ooc>casual comment or reaction about what just happened in the RP</ooc>`,
            ``,
            `The <ooc> text is stripped from the roleplay response and posted as a message in the conversation chat.`,
            `Use this very sparingly — only when a character would genuinely want to comment out-of-character. Most RP responses should NOT include <ooc> tags.`,
            `</ooc_instruction>`,
          ].join("\n");

          // Inject early in the messages (after the first system message)
          const firstSysIdx = finalMessages.findIndex((m) => m.role === "system");
          if (firstSysIdx >= 0) {
            finalMessages.splice(firstSysIdx + 1, 0, { role: "system" as const, content: oocInstruction });
          } else {
            finalMessages.unshift({ role: "system" as const, content: oocInstruction });
          }
        }
      }

      // ── Connection defaults + per-chat overrides (Chat Settings → Advanced Parameters) ──
      const connectionParams = parseStoredGenerationParameters(conn.defaultParameters);
      const chatParams = parseStoredGenerationParameters(chatMeta.chatParameters);

      const applyParameterOverrides = (params: typeof connectionParams) => {
        if (!params) return;
        if (typeof params.temperature === "number") temperature = params.temperature;
        if (typeof params.maxTokens === "number") maxTokens = params.maxTokens;
        topP = normalizeChatTopP(params.topP) ?? topP;
        if (typeof params.topK === "number") topK = params.topK;
        if (typeof params.frequencyPenalty === "number") frequencyPenalty = params.frequencyPenalty;
        if (typeof params.presencePenalty === "number") presencePenalty = params.presencePenalty;
        if (typeof params.showThoughts === "boolean") showThoughts = params.showThoughts;
        if (params.reasoningEffort !== undefined) reasoningEffort = params.reasoningEffort;
        if (params.verbosity !== undefined) verbosity = params.verbosity;
        if (typeof params.assistantPrefill === "string") assistantPrefill = params.assistantPrefill;
        customParameters = mergeCustomParameters(customParameters, params.customParameters);

        const paramsMaxContext = params.useMaxContext ? knownModelContext : normalizeMaxContext(params.maxContext);
        effectiveMaxContext = minContextLimit(effectiveMaxContext, paramsMaxContext);
      };

      // Scene chats use roleplay-friendly defaults before applying user overrides
      if (isSceneChat) {
        maxTokens = 8192;
        reasoningEffort = "maximum";
        verbosity = "high";
      }

      // Game mode: force optimal generation defaults (ignore preset/chat overrides)
      // unless the user is running a local Gemma model where these don't apply.
      const isLocalGemma = (conn.model ?? "").toLowerCase().includes("gemma");
      if (chatMode === "game" && !isLocalGemma) {
        temperature = 1;
        maxTokens = 16384;
        topP = 1;
        topK = 0;
        frequencyPenalty = 0;
        presencePenalty = 0;
        reasoningEffort = "maximum";
        verbosity = null;
      } else if (chatMode === "game") {
        // Local Gemma: just ensure generous output
        if (typeof chatParams?.maxTokens !== "number") {
          maxTokens = Math.max(maxTokens, 16384);
        }
      }

      applyParameterOverrides(connectionParams);
      applyParameterOverrides(chatParams);

      // Resolve "maximum" reasoning effort to the highest level for the current model.
      // GPT-5.4/5.5 and Claude Opus 4.7+ support "xhigh" — all others get "high".
      let resolvedEffort: "low" | "medium" | "high" | "xhigh" | null =
        reasoningEffort !== "maximum" ? reasoningEffort : null;
      if (reasoningEffort === "maximum") {
        const modelLower = (conn.model ?? "").toLowerCase();
        const supportsXhigh =
          modelLower.startsWith("gpt-5.5") ||
          modelLower.startsWith("gpt-5.4") ||
          modelLower === "grok-4.20-multi-agent" ||
          /claude-opus-4-(?:[7-9]|\d{2,})/.test(modelLower);
        resolvedEffort = supportsXhigh ? "xhigh" : "high";
      }

      const modelLower = (conn.model ?? "").toLowerCase();
      const providerLower = (conn.provider ?? "").toLowerCase();
      const isXaiAutoReasoningModel =
        (providerLower === "xai" && (modelLower.startsWith("grok-4.3") || modelLower.startsWith("grok-4-1-fast"))) ||
        (providerLower === "openrouter" && modelLower.startsWith("x-ai/grok-"));
      if (isXaiAutoReasoningModel) {
        resolvedEffort = null;
      }

      // When reasoning effort is set, enable thinking so thoughts are captured/displayed
      if (resolvedEffort && !showThoughts) {
        showThoughts = true;
      }

      // enableThinking tells providers to activate reasoning mode (e.g. Anthropic
      // extended thinking, Gemini thinkingConfig). Only true when the user has
      // explicitly requested reasoning via reasoningEffort — showThoughts alone
      // just controls whether thinking tokens are *displayed*, not whether
      // reasoning mode is activated.
      const enableThinking = !!resolvedEffort;

      // ── Claude 4.5+ sampling parameter restrictions ──
      const modelLc = (conn.model ?? "").toLowerCase();

      // Claude Opus 4.7+: ALL sampling params removed (temperature, top_p, top_k
      // return 400). Strip everything regardless of provider (covers reverse proxies).
      const isClaudeNoSampling = /claude-opus-4-(?:[7-9]|\d{2,})/.test(modelLc);
      if (isClaudeNoSampling) {
        topP = undefined;
        topK = 0;
        frequencyPenalty = 0;
        presencePenalty = 0;
      }

      // Claude 4.5/4.6: only temperature is supported — strip other sampling params.
      const isClaudeTemperatureOnly =
        !isClaudeNoSampling &&
        (/claude-(opus|sonnet)-4-[56]/.test(modelLc) || /claude-(opus|sonnet)-4\.[56]/.test(modelLc));
      if (isClaudeTemperatureOnly) {
        topP = undefined;
        topK = 0;
        frequencyPenalty = 0;
        presencePenalty = 0;
      }

      // Create provider
      const provider = createLLMProvider(
        conn.provider,
        baseUrl,
        conn.apiKey,
        conn.maxContext,
        conn.openrouterProvider,
        conn.maxTokensOverride,
      );

      // ────────────────────────────────────────
      // Agent Pipeline: resolve enabled agents
      // ────────────────────────────────────────
      const hasPerChatAgentList = chatActiveAgentIds.length > 0;
      const perChatAgentSet = new Set(chatActiveAgentIds);

      // Only run agents that are explicitly added to the chat.
      // Empty activeAgentIds = no agents (not "all globally-enabled").
      const enabledConfigs = chatEnableAgents && hasPerChatAgentList ? await agentsStore.list() : [];

      // Build ResolvedAgent array — each agent gets its own provider/model or falls back to chat connection
      const resolvedAgents: ResolvedAgent[] = [];
      // Cache per-connection providers so agents sharing the same connection batch together
      const agentProviderCache = new Map<string, { provider: BaseLLMProvider; model: string }>();
      const localSidecarAvailableForTrackers =
        sidecarModelService.getConfig().useForTrackers && sidecarModelService.getConfiguredModelRef() !== null;
      if (localSidecarAvailableForTrackers) {
        agentProviderCache.set(LOCAL_SIDECAR_CONNECTION_ID, {
          provider: getLocalSidecarProvider(),
          model: LOCAL_SIDECAR_MODEL,
        });
      }

      // Check if there's a connection marked as default for all agents
      const defaultAgentConn = await connections.getDefaultForAgents();
      if (defaultAgentConn) {
        const dBaseUrl = resolveBaseUrl(defaultAgentConn);
        if (dBaseUrl) {
          agentProviderCache.set(defaultAgentConn.id, {
            provider: createLLMProvider(
              defaultAgentConn.provider,
              dBaseUrl,
              defaultAgentConn.apiKey,
              defaultAgentConn.maxContext,
              defaultAgentConn.openrouterProvider,
              defaultAgentConn.maxTokensOverride,
            ),
            model: defaultAgentConn.model,
          });
        }
      }

      for (const cfg of enabledConfigs) {
        // If this chat has a per-chat agent list, only include agents in that list
        if (hasPerChatAgentList && !perChatAgentSet.has(cfg.type)) continue;
        const settings = cfg.settings ? JSON.parse(cfg.settings as string) : {};
        let agentProvider = provider;
        let agentModel = conn.model;

        // Resolve connection: per-agent override > default-for-agents > chat connection
        let effectiveConnectionId = cfg.connectionId ?? defaultAgentConn?.id ?? null;
        if (effectiveConnectionId === LOCAL_SIDECAR_CONNECTION_ID && !localSidecarAvailableForTrackers) {
          effectiveConnectionId =
            cfg.connectionId === LOCAL_SIDECAR_CONNECTION_ID ? (defaultAgentConn?.id ?? null) : null;
        }
        if (effectiveConnectionId) {
          const cached = agentProviderCache.get(effectiveConnectionId);
          if (cached) {
            agentProvider = cached.provider;
            agentModel = cached.model;
          } else {
            const agentConn = await connections.getWithKey(effectiveConnectionId);
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
                agentProviderCache.set(effectiveConnectionId, { provider: agentProvider, model: agentModel });
              }
            }
          }
        }

        resolvedAgents.push({
          id: cfg.id,
          type: cfg.type,
          name: cfg.name,
          phase: cfg.phase as string,
          promptTemplate: cfg.promptTemplate as string,
          connectionId: cfg.connectionId as string | null,
          settings,
          provider: agentProvider,
          model: agentModel,
        });
      }

      // Built-in agents with no DB row → use defaults only if explicitly in the per-chat list
      const resolvedTypes = new Set(resolvedAgents.map((a) => a.type));
      const builtInFallbacks =
        chatEnableAgents && hasPerChatAgentList
          ? BUILT_IN_AGENTS.filter((a) => {
              if (resolvedTypes.has(a.id)) return false;
              if (a.id === "chat-summary") return false;
              return perChatAgentSet.has(a.id);
            })
          : [];
      for (const builtIn of builtInFallbacks) {
        // Built-in agents also respect the default-for-agents connection
        const builtInCached = defaultAgentConn ? agentProviderCache.get(defaultAgentConn.id) : null;
        resolvedAgents.push({
          id: `builtin:${builtIn.id}`,
          type: builtIn.id,
          name: builtIn.name,
          phase: builtIn.phase,
          promptTemplate: "",
          connectionId: defaultAgentConn?.id ?? null,
          settings: getDefaultBuiltInAgentSettings(builtIn.id),
          provider: builtInCached?.provider ?? provider,
          model: builtInCached?.model ?? conn.model,
        });
      }

      logger.info(
        "[generate] Resolved %d agents for chat %s (enableAgents=%s, perChatList=%s, activeIds=[%s]): %s",
        resolvedAgents.length,
        input.chatId,
        chatEnableAgents,
        hasPerChatAgentList,
        chatActiveAgentIds.join(","),
        resolvedAgents.map((a) => `${a.type}(${a.phase})`).join(", "),
      );

      const builtInAgentTypes = new Set(BUILT_IN_AGENTS.map((agent) => agent.id));
      const userMessagesSinceLastAgentRun = async (agentType: string) => {
        const lastRun = await agentsStore.getLastRunByType(agentType, input.chatId);
        if (!lastRun) return Number.POSITIVE_INFINITY;

        const lastRunIdx = allChatMessages.findIndex((message: any) => message.id === lastRun.messageId);
        if (lastRunIdx < 0) return Number.POSITIVE_INFINITY;

        return allChatMessages.slice(lastRunIdx + 1).filter((message: any) => message.role === "user").length;
      };

      for (let index = resolvedAgents.length - 1; index >= 0; index--) {
        const agent = resolvedAgents[index]!;
        if (builtInAgentTypes.has(agent.type)) continue;

        const runInterval = Number(agent.settings.runInterval ?? 0);
        if (!Number.isFinite(runInterval) || runInterval <= 1) continue;

        const userMessageCount = await userMessagesSinceLastAgentRun(agent.type);
        if (userMessageCount < runInterval) {
          logger.debug(
            "[agents] Skipping custom agent %s until cadence threshold: %d/%d user messages",
            agent.type,
            userMessageCount,
            runInterval,
          );
          resolvedAgents.splice(index, 1);
        }
      }

      // Resolve character info (used for agent context AND prompt fallback)
      const charInfo: Array<{
        id: string;
        name: string;
        description: string;
        personality: string;
        scenario: string;
        creatorNotes: string;
        systemPrompt: string;
        backstory: string;
        appearance: string;
        mesExample: string;
        firstMes: string;
        postHistoryInstructions: string;
        talkativeness: number;
        avatarPath: string | null;
      }> = [];
      for (const cid of characterIds) {
        const charRow = await chars.getById(cid);
        if (charRow) {
          const charData = JSON.parse(charRow.data as string);
          let scenario: string = charData.scenario ?? "";
          // Strip assistant-only capabilities from Mari's scenario in non-conversation modes
          if (chatMode !== "conversation" && charData.extensions?.isBuiltInAssistant) {
            scenario = scenario.replace(/<assistant_capabilities>[\s\S]*?<\/assistant_capabilities>/gi, "").trim();
          }
          charInfo.push({
            id: cid,
            name: charData.name ?? "Unknown",
            description: charData.description ?? "",
            personality: charData.personality ?? "",
            scenario,
            creatorNotes: charData.creator_notes ?? "",
            systemPrompt: charData.system_prompt ?? "",
            backstory: charData.extensions?.backstory ?? "",
            appearance: charData.extensions?.appearance ?? "",
            mesExample: charData.mes_example ?? "",
            firstMes: charData.first_mes ?? "",
            postHistoryInstructions: charData.post_history_instructions ?? "",
            talkativeness: Math.max(0, Math.min(1, Number(charData.extensions?.talkativeness ?? 0.5))),
            avatarPath: (charRow.avatarPath as string) ?? null,
          });
        }
      }

      let resolvedGameDiscordSpeakerName: string | null = null;
      let gameDiscordSpeakerResolved = false;

      const resolveGameDiscordSpeakerName = async (): Promise<string> => {
        if (gameDiscordSpeakerResolved) {
          return resolvedGameDiscordSpeakerName ?? "Narrator";
        }

        gameDiscordSpeakerResolved = true;
        const gmMode = typeof earlyMeta.gameGmMode === "string" ? earlyMeta.gameGmMode : "";
        const gmCharacterId =
          typeof earlyMeta.gameGmCharacterId === "string" && earlyMeta.gameGmCharacterId.trim()
            ? earlyMeta.gameGmCharacterId.trim()
            : null;

        if (chatMode === "game" && gmMode === "character" && gmCharacterId) {
          const knownCharacter = charInfo.find((character) => character.id === gmCharacterId);
          if (knownCharacter?.name) {
            resolvedGameDiscordSpeakerName = knownCharacter.name;
            return knownCharacter.name;
          }

          const gmRow = await chars.getById(gmCharacterId);
          if (gmRow) {
            try {
              const gmData = JSON.parse(gmRow.data as string);
              if (typeof gmData.name === "string" && gmData.name.trim()) {
                const gmName = gmData.name.trim();
                resolvedGameDiscordSpeakerName = gmName;
                return gmName;
              }
            } catch {
              /* ignore malformed GM card data */
            }
          }
        }

        resolvedGameDiscordSpeakerName = "Narrator";
        return "Narrator";
      };

      // ── Fallback: inject character & persona info if the preset didn't include them ──
      // In game mode the GM prompt already includes party members and player persona
      // in the <party> section, so skip fallback injection to avoid duplication.
      if (chatMode !== "game") {
        const allContent = finalMessages.map((m) => m.content).join("\n");
        const fallbackCharInfo = manualPromptTargetCharId
          ? charInfo.filter((c) => c.id === manualPromptTargetCharId)
          : charInfo;
        for (const ci of fallbackCharInfo) {
          // Check if this character already appears by description snippet, XML tag, or markdown heading
          const xmlTag = nameToXmlTag(ci.name);
          const hasCharInfo =
            (ci.description && allContent.includes(ci.description.split("\n")[0]!.trim().slice(0, 80))) ||
            allContent.includes(`<${xmlTag}>`) ||
            allContent.includes(`<${ci.name}>`) ||
            new RegExp(`^#{1,6} ${ci.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(allContent);
          if (!hasCharInfo && ci.description) {
            const characterMacroContext = {
              ...promptMacroContext,
              char: ci.name,
              characterFields: {
                description: ci.description,
                personality: ci.personality,
                scenario: ci.scenario,
                backstory: ci.backstory,
                appearance: ci.appearance,
                example: ci.mesExample,
              },
            };
            const resolveCharacterMacros = (value: string) => resolveMacros(value, characterMacroContext);
            const fieldParts = wrapFields(
              {
                description: resolveCharacterMacros(ci.description),
                personality: resolveCharacterMacros(ci.personality),
                scenario: resolveCharacterMacros(ci.scenario),
                backstory: resolveCharacterMacros(ci.backstory),
                appearance: resolveCharacterMacros(ci.appearance),
                system_prompt: resolveCharacterMacros(ci.systemPrompt),
                example_dialogue: resolveCharacterMacros(ci.mesExample),
                post_history_instructions: resolveCharacterMacros(ci.postHistoryInstructions),
              },
              wrapFormat,
            );
            if (fieldParts.length > 0) {
              const block = wrapContent(fieldParts.join("\n"), ci.name, wrapFormat, 1);
              const firstSysIdx = finalMessages.findIndex((m) => m.role === "system");
              const insertAt = firstSysIdx >= 0 ? firstSysIdx + 1 : 0;
              finalMessages.splice(insertAt, 0, { role: "system", content: block });
            }
          }
        }
        if (personaDescription) {
          const personaXmlTag = nameToXmlTag(personaName);
          const hasPersonaInfo =
            allContent.includes(personaDescription.split("\n")[0]!.trim().slice(0, 80)) ||
            allContent.includes(`<${personaXmlTag}>`) ||
            allContent.includes(`<${personaName}>`) ||
            new RegExp(`^#{1,6} ${personaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(allContent);
          if (!hasPersonaInfo) {
            const fieldParts = wrapFields(
              {
                description: resolvePromptMacros(personaDescription),
                personality: resolvePromptMacros(personaFields.personality ?? ""),
                backstory: resolvePromptMacros(personaFields.backstory ?? ""),
                appearance: resolvePromptMacros(personaFields.appearance ?? ""),
                scenario: resolvePromptMacros(personaFields.scenario ?? ""),
              },
              wrapFormat,
            );
            // Include enabled RPG attributes alongside persona fields
            if (persona?.personaStats) {
              const pStats =
                typeof persona.personaStats === "string" ? JSON.parse(persona.personaStats) : persona.personaStats;
              if (pStats?.rpgStats?.enabled) {
                const rpg = pStats.rpgStats as {
                  attributes: Array<{ name: string; value: number }>;
                  hp: { value: number; max: number };
                };
                const rpgLines = [`Max HP: ${rpg.hp.max}`];
                for (const attr of rpg.attributes) {
                  rpgLines.push(`${attr.name}: ${attr.value}`);
                }
                fieldParts.push(wrapContent(rpgLines.join("\n"), "rpg_attributes", wrapFormat, 2));
              }
            }
            if (fieldParts.length > 0) {
              const block = wrapContent(fieldParts.join("\n"), personaName, wrapFormat, 1);
              const firstUserIdx = finalMessages.findIndex((m) => m.role === "user" || m.role === "assistant");
              const insertAt = firstUserIdx >= 0 ? firstUserIdx : finalMessages.length;
              finalMessages.splice(insertAt, 0, { role: "system", content: block });
            }
          }
        }
      } // end chatMode !== "game" guard

      // ── Scene-specific context injection ──
      // Scene chats store hidden metadata (scenario, conversation context, relationship
      // history, system prompt) that the regular preset path doesn't know about. Inject
      // them as system messages so the LLM has full scene awareness.
      if (isSceneChat) {
        const charNames = charInfo.map((c) => c.name);
        const isGroup = charNames.length > 1;

        // <role> — who the characters are and who they're talking to
        const roleText = isGroup
          ? [
              `<role>`,
              `You are ${charNames.join(", ")}; real and autonomous people, roleplaying with the user called ${personaName} in a scene.`,
              `</role>`,
            ].join("\n")
          : [
              `<role>`,
              `You are ${charNames[0] ?? "the character"}, a real and autonomous person, roleplaying with the user called ${personaName} in a scene.`,
              `</role>`,
            ].join("\n");

        // <scenario> — the hidden plot arc the user never sees
        const sceneScenario = chatMeta.sceneScenario as string | undefined;
        const scenarioText = sceneScenario ? [`<scenario>`, sceneScenario, `</scenario>`].join("\n") : "";

        // <awareness> — conversation context + relationship history
        const sceneConvoCtx = chatMeta.sceneConversationContext as string | undefined;
        const sceneRelHistory = chatMeta.sceneRelationshipHistory as string | undefined;
        const awarenessLines: string[] = [];
        if (sceneRelHistory) {
          awarenessLines.push(`## Relationship History`, sceneRelHistory, ``);
        }
        if (sceneConvoCtx) {
          awarenessLines.push(
            `## Conversation Context`,
            `The following is a transcript of the conversation that led up to this scene:`,
            sceneConvoCtx,
          );
        }
        const awarenessText =
          awarenessLines.length > 0 ? [`<awareness>`, ...awarenessLines, `</awareness>`].join("\n") : "";

        // <scene_system_prompt> — custom writing style / narration instructions
        const sceneSystemPrompt = chatMeta.sceneSystemPrompt as string | undefined;
        const sceneSysText = sceneSystemPrompt
          ? [`<scene_instructions>`, sceneSystemPrompt, `</scene_instructions>`].join("\n")
          : "";

        // <output_format> — mandatory writing and response-length guidance
        const outputFormatText = [
          `<output_format>`,
          `When you respond in the conversation:`,
          `- Think about it first and internalize your instructions.`,
          `- Continue directly with new content from the final line of the last message. You don't have to address everything from it; this is a creative freeform piece, so prioritize organic flow. Favor characterizations driven by the chat history over the static character descriptions. Explicit content is allowed, no plot armor. Don't play for ${personaName}.`,
          `- The response length should be flexible, based on the current scene. During a conversation between you and the user, you have two options:`,
          `  (1) ONLY respond with a dialogue line plus an optional dialogue tag/action beat, and stop, creating space for a dynamic back-and-forth.`,
          `  (2) Continue into a longer response provided the conversation is concluded, interrupted, includes a longer monologue, or an exchange between multiple NPCs.`,
          `In action, when the user's agency is high, keep it concise (up to 150 words), and leave room for user input. In case you'd like to progress, for instance, in scene transitions, establishing shots, and plot developments, build content (unlimited, above 150 words), but allow the user to react to it. Never end on handover cues; finish naturally.`,
          `- No GPTisms/AI Slop. BAN and NEVER output generic structures (such as "if X, then Y", or "not X, but Y"), and literature clichés (NO: "physical punches," "practiced things," "predatory instincts," "mechanical precisions," or "jaws working"). Combat them with the human touch.`,
          `- Describe what DOES happen, rather than what doesn't (for example, go for "remains still" instead of "doesn't move"). Mention what occurs, or show the consequences of happenings ("the water sits untouched" instead of "isn't being drunk").`,
          `- CRITICAL! Do not repeat, echo, parrot, or restate distinctive words, phrases, and dialogues. When reacting to speech, show interpretation or response, NOT repetition.`,
          `EXAMPLE: "Are you a gooner?"`,
          `BAD: "Gooner?"`,
          `GOOD: A flat look. "What type of question is that?"`,
          `</output_format>`,
        ].join("\n");

        // Inject all scene blocks after the first system message
        // Order: role → awareness → scenario → scene_instructions → output_format
        // (characters + persona are injected as separate system messages before this;
        //  memories are injected after this via the memory-recall pipeline)
        const sceneBlocks = [roleText, awarenessText, scenarioText, sceneSysText, outputFormatText]
          .filter(Boolean)
          .join("\n\n");

        if (sceneBlocks) {
          const firstSysIdx = finalMessages.findIndex((m) => m.role === "system");
          if (firstSysIdx >= 0) {
            finalMessages.splice(firstSysIdx + 1, 0, { role: "system" as const, content: sceneBlocks });
          } else {
            finalMessages.unshift({ role: "system" as const, content: sceneBlocks });
          }
        }
      }

      // ── Game mode: build and inject full GM system prompt ──
      if (chatMode === "game") {
        // Gather game metadata for prompt context
        const setupConfig =
          chatMeta.gameSetupConfig &&
          typeof chatMeta.gameSetupConfig === "object" &&
          !Array.isArray(chatMeta.gameSetupConfig)
            ? (chatMeta.gameSetupConfig as Record<string, unknown>)
            : null;
        const gameActiveState = (chatMeta.gameActiveState as string) || "exploration";
        const sessionNumber = (chatMeta.gameSessionNumber as number) || 1;
        const storyArc = (chatMeta.gameStoryArc as string) || null;
        const plotTwists = Array.isArray(chatMeta.gamePlotTwists) ? (chatMeta.gamePlotTwists as string[]) : null;
        const gameMap = (chatMeta.gameMap as import("@marinara-engine/shared").GameMap) || null;
        const gameNpcs = Array.isArray(chatMeta.gameNpcs)
          ? (chatMeta.gameNpcs as import("@marinara-engine/shared").GameNpc[])
          : [];
        const sessionSummaries = Array.isArray(chatMeta.gamePreviousSessionSummaries)
          ? (chatMeta.gamePreviousSessionSummaries as import("@marinara-engine/shared").SessionSummary[])
          : [];
        const playerNotes = typeof chatMeta.gamePlayerNotes === "string" ? chatMeta.gamePlayerNotes.trim() : undefined;

        // Resolve GM character card if in "character" GM mode
        let gmCharacterCard: string | null = null;
        const gmCharId = chatMeta.gameGmCharacterId as string | null;
        if (gmCharId) {
          try {
            const gmChar = await chars.getById(gmCharId);
            if (gmChar) {
              const gmData = typeof gmChar.data === "string" ? JSON.parse(gmChar.data) : gmChar.data;
              const parts = [`Name: ${gmData.name}`];
              if (gmData.personality) parts.push(`Personality: ${gmData.personality}`);
              if (gmData.description) parts.push(`Description: ${gmData.description}`);
              const gmBackstory = gmData.extensions?.backstory || gmData.backstory;
              const gmAppearance = gmData.extensions?.appearance || gmData.appearance;
              if (gmBackstory) parts.push(`Backstory: ${gmBackstory}`);
              if (gmAppearance) parts.push(`Appearance: ${gmAppearance}`);
              gmCharacterCard = parts.join("\n");
            }
          } catch {
            /* ignore */
          }
        }

        // Resolve party character cards (full detail for GM context)
        const partyCharIds = Array.isArray(chatMeta.gamePartyCharacterIds)
          ? (chatMeta.gamePartyCharacterIds as string[])
          : characterIds;
        const partyNames: string[] = [];
        const partyCards: Array<{ name: string; card: string }> = [];
        const partyIdNamePairs: Array<{ id: string; name: string }> = [];
        // Load game character cards for appending game-specific info
        const gameCharCards = Array.isArray(chatMeta.gameCharacterCards)
          ? (chatMeta.gameCharacterCards as Array<Record<string, unknown>>)
          : [];
        const gameCardByName = new Map<string, Record<string, unknown>>();
        for (const gc of gameCharCards) {
          if (gc.name) gameCardByName.set((gc.name as string).toLowerCase(), gc);
        }
        for (const pcId of partyCharIds) {
          try {
            const pc = await chars.getById(pcId);
            if (pc) {
              const pcData = typeof pc.data === "string" ? JSON.parse(pc.data) : pc.data;
              const name = pcData.name || "Unknown";
              partyNames.push(name);
              partyIdNamePairs.push({ id: pcId, name });
              const parts = [`Name: ${name}`];
              if (pcData.personality) parts.push(`Personality: ${pcData.personality}`);
              if (pcData.description) parts.push(`Description: ${pcData.description}`);
              const backstory = pcData.extensions?.backstory || pcData.backstory;
              const appearance = pcData.extensions?.appearance || pcData.appearance;
              if (backstory) parts.push(`Backstory: ${backstory}`);
              if (appearance) parts.push(`Appearance: ${appearance}`);
              // Append game character card info (class, abilities, etc.)
              const gc = gameCardByName.get(name.toLowerCase());
              if (gc) {
                if (gc.class) parts.push(`Class: ${gc.class}`);
                if ((gc.abilities as string[])?.length)
                  parts.push(`Abilities: ${(gc.abilities as string[]).join(", ")}`);
                if ((gc.strengths as string[])?.length)
                  parts.push(`Strengths: ${(gc.strengths as string[]).join(", ")}`);
                if ((gc.weaknesses as string[])?.length)
                  parts.push(`Weaknesses: ${(gc.weaknesses as string[]).join(", ")}`);
                const extra = gc.extra as Record<string, string> | undefined;
                if (extra) {
                  for (const [k, v] of Object.entries(extra)) {
                    parts.push(`${k}: ${v}`);
                  }
                }
              }
              partyCards.push({ name, card: parts.join("\n") });
            }
          } catch {
            /* ignore */
          }
        }

        for (const npcId of partyCharIds) {
          if (!isPartyNpcId(npcId)) continue;
          const npc = gameNpcs.find((candidate) => buildPartyNpcId(candidate.name) === npcId);
          if (!npc) continue;
          const name = npc.name || "Unknown";
          partyNames.push(name);
          partyIdNamePairs.push({ id: npcId, name });
          const parts = [`Name: ${name}`, "Source: Tracked NPC companion, not a character-library card"];
          if (npc.description) parts.push(`Description: ${npc.description}`);
          if (npc.location) parts.push(`Last Known Location: ${npc.location}`);
          if (npc.notes?.length) parts.push(`Notes: ${npc.notes.join("; ")}`);
          const gc = gameCardByName.get(name.toLowerCase());
          if (gc) {
            if (gc.class) parts.push(`Class: ${gc.class}`);
            if ((gc.abilities as string[])?.length) parts.push(`Abilities: ${(gc.abilities as string[]).join(", ")}`);
            if ((gc.strengths as string[])?.length) parts.push(`Strengths: ${(gc.strengths as string[]).join(", ")}`);
            if ((gc.weaknesses as string[])?.length)
              parts.push(`Weaknesses: ${(gc.weaknesses as string[]).join(", ")}`);
            const extra = gc.extra as Record<string, string> | undefined;
            if (extra) {
              for (const [key, value] of Object.entries(extra)) {
                parts.push(`${key}: ${value}`);
              }
            }
          }
          partyCards.push({ name, card: parts.join("\n") });
        }

        // Resolve player persona card
        let playerCard: string | null = null;
        if (chat.personaId || (setupConfig as Record<string, unknown> | null)?.personaId) {
          try {
            const persona = await chars.getPersona(
              (chat.personaId || (setupConfig as Record<string, unknown>)?.personaId) as string,
            );
            if (persona) {
              const parts = [`Name: ${persona.name}`];
              if (persona.description) parts.push(`Description: ${persona.description}`);
              if (persona.personality) parts.push(`Personality: ${persona.personality}`);
              if (persona.backstory) parts.push(`Backstory: ${persona.backstory}`);
              if (persona.appearance) parts.push(`Appearance: ${persona.appearance}`);
              // Append game character card info for persona
              const pgc = gameCardByName.get(persona.name.toLowerCase());
              if (pgc) {
                if (pgc.class) parts.push(`Class: ${pgc.class}`);
                if ((pgc.abilities as string[])?.length)
                  parts.push(`Abilities: ${(pgc.abilities as string[]).join(", ")}`);
                if ((pgc.strengths as string[])?.length)
                  parts.push(`Strengths: ${(pgc.strengths as string[]).join(", ")}`);
                if ((pgc.weaknesses as string[])?.length)
                  parts.push(`Weaknesses: ${(pgc.weaknesses as string[]).join(", ")}`);
                const extra = pgc.extra as Record<string, string> | undefined;
                if (extra) {
                  for (const [k, v] of Object.entries(extra)) {
                    parts.push(`${k}: ${v}`);
                  }
                }
              }
              playerCard = parts.join("\n");
            }
          } catch {
            /* ignore */
          }
        }

        // Get weather from latest game state snapshot
        let weatherContext: string | undefined;
        let gameTime: string | undefined;
        try {
          const snapRows = await app.db
            .select()
            .from(gameStateSnapshotsTable)
            .where(eq(gameStateSnapshotsTable.chatId, input.chatId))
            .orderBy(desc(gameStateSnapshotsTable.createdAt))
            .limit(1);
          const snap = snapRows[0];
          if (snap) {
            if (snap.weather)
              weatherContext = `Current weather: ${snap.weather}${snap.temperature ? `, ${snap.temperature}` : ""}`;
            if (snap.time || snap.date) gameTime = [snap.date, snap.time].filter(Boolean).join(", ");
          }
        } catch {
          /* ignore */
        }

        // Determine if a separate scene model handles bg/music/sfx/widgets
        const sceneConnectionId = (setupConfig?.sceneConnectionId as string) || null;
        const sidecarCfg = sidecarModelService.getConfig();
        const sidecarHandlesScene = sidecarCfg.useForGameScene && (await isSidecarInferenceAvailable());
        const hasSceneModel = !!sceneConnectionId || sidecarHandlesScene;

        // Approximate turn number: count user messages in the chat (each user message ≈ 1 turn)
        const gameTurnNumber = mappedMessages.filter((m) => m.role === "user").length + 1;

        // Detect whether the player moved since last turn
        const lastMapPos = chatMeta.lastMapPosition as string | { x: number; y: number } | undefined;
        const currentMapPos = gameMap?.partyPosition;
        const playerMoved =
          !lastMapPos || !currentMapPos || JSON.stringify(lastMapPos) !== JSON.stringify(currentMapPos);
        // Persist current position for next turn comparison
        if (currentMapPos && JSON.stringify(lastMapPos) !== JSON.stringify(currentMapPos)) {
          chatMeta.lastMapPosition = currentMapPos;
          const freshChat = await chats.getById(input.chatId);
          const freshMeta = freshChat ? (parseExtra(freshChat.metadata) as Record<string, unknown>) : chatMeta;
          await chats.updateMetadata(input.chatId, { ...freshMeta, lastMapPosition: currentMapPos });
        }

        // ── Passive perception hints ──
        let perceptionHintsBlock: string | undefined;
        try {
          const snapRows2 = await app.db
            .select()
            .from(gameStateSnapshotsTable)
            .where(eq(gameStateSnapshotsTable.chatId, input.chatId))
            .orderBy(desc(gameStateSnapshotsTable.createdAt))
            .limit(1);
          const latSnap = snapRows2[0];
          const pStats = latSnap?.playerStats ? JSON.parse(latSnap.playerStats as string) : null;
          if (pStats) {
            const presentNpcs = latSnap?.presentCharacters
              ? JSON.parse(latSnap.presentCharacters as string)
                  .map((c: { name?: string }) => c.name)
                  .filter(Boolean)
              : [];
            const pCtx: PerceptionContext = {
              perceptionMod: pStats.skills?.Perception ?? pStats.skills?.perception ?? 0,
              wisdomScore: pStats.attributes?.wis ?? 10,
              gameState: gameActiveState,
              location: latSnap?.location ?? null,
              weather: latSnap?.weather ?? null,
              timeOfDay: latSnap?.time ?? null,
              presentNpcNames: presentNpcs,
            };
            const hints = generatePerceptionHints(pCtx);
            if (hints.length > 0) {
              perceptionHintsBlock = formatPerceptionHints(hints);
            }
          }
        } catch {
          /* non-fatal */
        }

        const gmCtx: GmPromptContext = {
          gameActiveState: gameActiveState as import("@marinara-engine/shared").GameActiveState,
          storyArc,
          plotTwists,
          map: gameMap,
          npcs: gameNpcs,
          sessionSummaries,
          sessionNumber,
          partyNames,
          partyCards,
          playerName: personaName,
          playerCard,
          gmCharacterCard,
          difficulty: (setupConfig?.difficulty as string) || "normal",
          genre: (setupConfig?.genre as string) || "fantasy",
          setting: (setupConfig?.setting as string) || "original",
          tone: (setupConfig?.tone as string) || "balanced",
          rating: (setupConfig?.rating as "sfw" | "nsfw") || "sfw",
          gameTime,
          weatherContext,
          playerNotes,
          hudWidgets: Array.isArray(chatMeta.gameWidgetState)
            ? (chatMeta.gameWidgetState as any[])
            : Array.isArray((chatMeta.gameBlueprint as any)?.hudWidgets)
              ? ((chatMeta.gameBlueprint as any).hudWidgets as any[])
              : undefined,
          hasSceneModel,
          playerMoved,
          turnNumber: gameTurnNumber,
          perceptionHints: perceptionHintsBlock,
          moraleContext: (() => {
            const morale = (chatMeta.gameMorale as number) ?? 50;
            const tier = getMoraleTier(morale);
            return formatMoraleContext({ value: morale, tier });
          })(),
          characterSprites: listPartySprites(partyIdNamePairs),
          language: (setupConfig?.language as string) || undefined,
        };

        const builtGmPrompt = buildGmSystemPrompt(gmCtx);

        // User can override/extend with a custom prompt from Chat Settings
        const customGmPrompt = typeof chatMeta.customGmPrompt === "string" ? chatMeta.customGmPrompt.trim() : "";
        const gameExtraPrompt =
          typeof chatMeta.gameExtraPrompt === "string"
            ? chatMeta.gameExtraPrompt.trim().replace(/<\/?special_instructions>/gi, "")
            : "";
        let fullGmPrompt = customGmPrompt ? `${builtGmPrompt}\n\n${customGmPrompt}` : builtGmPrompt;
        if (gameExtraPrompt) {
          fullGmPrompt += `\n\n<special_instructions>\n${gameExtraPrompt}\n</special_instructions>`;
        }
        fullGmPrompt = resolvePromptMacros(fullGmPrompt);

        // Game mode: REPLACE the conversation system prompt with the GM prompt.
        // The conversation prompt ("you are X chatting with user") conflicts with the GM role.
        const sysIdx = finalMessages.findIndex((m) => m.role === "system");
        if (sysIdx >= 0) {
          finalMessages[sysIdx] = { role: "system" as const, content: fullGmPrompt };
        } else {
          finalMessages.unshift({ role: "system" as const, content: fullGmPrompt });
        }

        // ── Lorebook injection for game mode ──
        {
          sendProgress("lorebooks");
          const scanMessages = mappedMessages.map((m) => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          }));
          const lorebookResult = await processLorebooks(app.db, scanMessages, null, {
            chatId: input.chatId,
            characterIds,
            personaId,
            activeLorebookIds: chatActiveLorebookIds,
            chatEmbedding: chatContextEmbedding,
            entryStateOverrides:
              (chatMeta.entryStateOverrides as Record<string, { ephemeral?: number | null; enabled?: boolean }>) ??
              undefined,
          });

          if (lorebookResult.updatedEntryStateOverrides) {
            chatMeta.entryStateOverrides = lorebookResult.updatedEntryStateOverrides;
            const freshChat = await chats.getById(input.chatId);
            const freshMeta = freshChat ? (parseExtra(freshChat.metadata) as Record<string, unknown>) : chatMeta;
            await chats.updateMetadata(input.chatId, {
              ...freshMeta,
              entryStateOverrides: lorebookResult.updatedEntryStateOverrides,
            });
          }
          const loreContent = [lorebookResult.worldInfoBefore, lorebookResult.worldInfoAfter]
            .filter(Boolean)
            .map((content) => resolvePromptMacros(content))
            .join("\n");
          if (loreContent) {
            const loreBlock = `<lore>\n${loreContent}\n</lore>`;
            // Append lore to the GM system prompt
            const sysMsg = finalMessages.find((m) => m.role === "system");
            if (sysMsg) {
              sysMsg.content += "\n\n" + loreBlock;
            } else {
              finalMessages.unshift({ role: "system" as const, content: loreBlock });
            }
          }
          if (lorebookResult.depthEntries.length > 0) {
            finalMessages = injectAtDepth(
              finalMessages,
              lorebookResult.depthEntries.map((entry) => ({
                ...entry,
                content: resolvePromptMacros(entry.content),
              })),
            );
          }
        }

        // LOG_LEVEL=debug or Settings -> Advanced -> Debug mode: log game-mode prompt details.
        if (isDebug || requestDebug) {
          debugLog(
            "[debug/game] GM prompt length: %d chars, messages: %d",
            finalMessages[0]?.content.length ?? 0,
            finalMessages.length,
          );
          debugLog(
            "[debug/game] GM context: storyArc=%s, map=%s, npcs=%d, widgets=%s, hasSceneModel=%s, state=%s",
            !!gmCtx.storyArc,
            !!gmCtx.map,
            gmCtx.npcs.length,
            !!gmCtx.hudWidgets?.length,
            gmCtx.hasSceneModel,
            gmCtx.gameActiveState,
          );
          for (const msg of finalMessages) {
            debugLog("[debug/game] [%s] %s", msg.role.toUpperCase(), msg.content);
          }
        }

        // Inject the output format + commands as the last user message so they
        // sit closest to generation in the model's attention window.
        // Detect special address prefixes from the latest user message so the
        // prompt block is only sent when actually relevant.
        const latestUserMsg = [...finalMessages].reverse().find((m) => m.role === "user");
        const latestUserContent = latestUserMsg?.content.trimStart() ?? "";
        const addressMode = latestUserContent.startsWith("[To the party]")
          ? "party"
          : latestUserContent.startsWith("[To the GM]")
            ? "gm"
            : undefined;
        const playerDiceRollSubmitted = /\[dice\b/i.test(latestUserContent);
        const formatReminder = resolvePromptMacros(
          buildGmFormatReminder({
            hasSceneModel,
            hudWidgets: gmCtx.hudWidgets,
            turnNumber: gameTurnNumber,
            gameActiveState: gameActiveState as import("@marinara-engine/shared").GameActiveState,
            sessionNumber,
            gameTime,
            map: gameMap,
            partyNames: gmCtx.partyNames,
            playerName: gmCtx.playerName,
            characterSprites: gmCtx.characterSprites,
            language: gmCtx.language,
            rating: gmCtx.rating,
            addressMode,
            playerDiceRollSubmitted,
            playerInventory: (() => {
              try {
                const inv = (chatMeta.gameInventory as Array<{ name: string; quantity: number }>) ?? [];
                return inv.length > 0 ? inv : undefined;
              } catch {
                return undefined;
              }
            })(),
          }),
        );
        finalMessages.push({ role: "user" as const, content: formatReminder });
        logger.debug("[generate/game] Injected format reminder (%d chars) as last user message", formatReminder.length);
      }

      // ── Inject character memories into awareness ──
      // Characters can create "memories" targeting other characters.
      // These appear in the awareness context and are cleaned up after the day ends.
      if (chatMode === "conversation") {
        const memoryLines: string[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const cid of characterIds) {
          const charRow = await chars.getById(cid);
          if (!charRow) continue;
          const charData = JSON.parse(charRow.data as string);
          const memories: Array<{ from: string; fromCharId: string; summary: string; createdAt: string }> =
            charData.extensions?.characterMemories ?? [];
          if (memories.length === 0) continue;

          // Filter: keep only memories from today or later
          const validMemories = memories.filter((m) => new Date(m.createdAt) >= today);

          // Clean up expired memories if any were removed
          if (validMemories.length !== memories.length) {
            const extensions = { ...(charData.extensions ?? {}), characterMemories: validMemories };
            await chars.update(cid, { extensions } as any);
          }

          for (const mem of validMemories) {
            memoryLines.push(`Memory from ${mem.from}: ${mem.summary}`);
          }
        }

        if (memoryLines.length > 0) {
          const memoriesSection = `\n\n## Memories\n${memoryLines.join("\n")}`;
          if (convoAwarenessBlock) {
            // Append memories inside the existing <awareness> block
            convoAwarenessBlock = convoAwarenessBlock.replace(/<\/awareness>$/, memoriesSection + "\n</awareness>");
          } else {
            // Create a minimal awareness block with just memories
            convoAwarenessBlock = `<awareness>\n${memoriesSection.trimStart()}\n</awareness>`;
          }
        }
      }

      // ── Inject cross-chat awareness (after persona info so it appears right before chat history) ──
      if (convoAwarenessBlock) {
        const firstUserIdx = finalMessages.findIndex((m) => m.role === "user" || m.role === "assistant");
        const insertAt = firstUserIdx >= 0 ? firstUserIdx : finalMessages.length;
        finalMessages.splice(insertAt, 0, { role: "system", content: convoAwarenessBlock });
      }

      // ── Memory recall: semantic retrieval of relevant past conversation fragments ──
      // Default: on for conversation mode and scene chats, off for roleplay (opt-in via chat settings)
      const memoryRecallDefault = chatMode === "conversation" || isSceneChat;
      const enableMemoryRecall =
        chatMeta.enableMemoryRecall !== undefined ? chatMeta.enableMemoryRecall === true : memoryRecallDefault;
      if (enableMemoryRecall) {
        sendProgress("memory_recall");
        const _tRecall = Date.now();
        try {
          // Use the last user message as the query
          const lastUserMsg = [...mappedMessages].reverse().find((m) => m.role === "user");
          if (lastUserMsg?.content?.trim()) {
            // Scope recall to this chat only. Users expect memories to stay with
            // the exact conversation/roleplay/game where they were created.
            const recalled = await recallMemories(app.db, lastUserMsg.content, [input.chatId]);
            if (recalled.length > 0) {
              const packedRecall = packRecalledMemories(recalled, effectiveMaxContext ?? connectionMaxContext);
              if (packedRecall.lines.length === 0) {
                logger.debug(
                  "[memory-recall] Skipped recalled memories after budgeting (%d candidates)",
                  recalled.length,
                );
              } else {
                const memoriesBlock = [
                  `<memories>`,
                  `The following are recalled fragments from earlier in this conversation. Use them to maintain continuity, remember past events, and stay in character — but do not explicitly reference "remembering" unless it's natural.`,
                  ...packedRecall.lines.map((line, i) => `--- Memory ${i + 1} ---\n${line}`),
                  `</memories>`,
                ].join("\n");

                logger.debug(
                  "[memory-recall] Injecting %d/%d recalled memories (~%d/%d tokens)%s",
                  packedRecall.lines.length,
                  recalled.length,
                  packedRecall.estimatedTokens,
                  packedRecall.budgetTokens,
                  packedRecall.trimmed ? " after trimming" : "",
                );

                // Inject right before the first user/assistant message
                const firstUserIdx = finalMessages.findIndex((m) => m.role === "user" || m.role === "assistant");
                const insertAt = firstUserIdx >= 0 ? firstUserIdx : finalMessages.length;
                finalMessages.splice(insertAt, 0, { role: "system" as const, content: memoriesBlock });
              }
            }
          }
        } catch (err) {
          logger.error(err, "[memory-recall] Recall failed, skipping");
        }
        logger.debug(`[timing] Memory recall: ${Date.now() - _tRecall}ms`);
      }

      if (chatMode === "conversation" && conversationCommandsReminder && !input.impersonate) {
        finalMessages.push({ role: "user" as const, content: conversationCommandsReminder });
        logger.debug(
          "[generate/conversation] Injected commands reminder (%d chars) as last user message",
          conversationCommandsReminder.length,
        );
      }

      // ── Group chat processing ──
      const isGroupChat = characterIds.length > 1;
      const groupResponseOrder = (chatMeta.groupResponseOrder as string) ?? "sequential";
      // Conversation mode stays merged by default, but Manual uses the same individual
      // one-character-at-a-time trigger path as roleplay.
      const groupChatMode =
        chatMode === "conversation"
          ? groupResponseOrder === "manual"
            ? "individual"
            : "merged"
          : ((chatMeta.groupChatMode as string) ?? "merged");
      // Auto-enable speaker colors for conversation mode groups (system prompt already requests tags)
      const groupSpeakerColors = chatMeta.groupSpeakerColors === true || (chatMode === "conversation" && isGroupChat);

      if (isGroupChat && chatMode !== "conversation") {
        // Strip <speaker> tags from history to save tokens in roleplay mode.
        // Just remove the tags, keep the dialogue content as-is.
        const speakerCloseRegex = /<\/speaker>/g;
        for (let i = 0; i < finalMessages.length; i++) {
          const msg = finalMessages[i]!;
          if (msg.role === "system") continue;
          if (msg.content.includes("<speaker=")) {
            let converted = msg.content;
            converted = converted.replace(/<speaker="[^"]*">/g, "");
            converted = converted.replace(speakerCloseRegex, "");
            converted = converted.replace(/^\s*\n/gm, "").trim();
            finalMessages[i] = { ...msg, content: converted };
          }
        }
      }

      if (isGroupChat) {
        // Inject group chat instructions at the end of the last user message
        const groupInstructions: string[] = [];

        if (groupChatMode === "merged" && groupSpeakerColors && chatMode !== "conversation") {
          const charNames = charInfo.map((c) => c.name);
          groupInstructions.push(
            `- Since this is a group chat, wrap each character's dialogue in <speaker="name"> tags. Tags can appear inline with narration, they don't need to be on separate lines. Example: <speaker="${charNames[0] ?? "John"}">"Hello there,"</speaker> [action beat/dialogue tag].`,
          );
        }

        if (groupChatMode === "individual" && !input.regenerateMessageId) {
          // targetCharName is set later in the multi-char loop; for now placeholder
          // The actual injection happens per-character in the generation loop below
        }

        if (groupInstructions.length > 0) {
          const rawBlock = groupInstructions.join("\n");
          const instructionBlock = wrapFormat === "markdown" ? `\n## Group Chat\n${rawBlock}` : rawBlock;

          // Inject into the <output_format> section if present, otherwise append to last user message
          injectIntoOutputFormatOrLastUser(finalMessages, instructionBlock, { indent: true });
        }
      }

      // Get current game state (if any)
      // Prefer committed game state (locked in when the user sent their last
      // message), but fall back to the latest snapshot so agents still receive
      // prior state before anything has been committed (e.g. first turn).
      const latestGameState =
        (await gameStateStore.getLatestCommitted(input.chatId)) ?? (await gameStateStore.getLatest(input.chatId));
      const gameState = latestGameState ? parseGameStateRow(latestGameState as Record<string, unknown>) : null;

      // Build base agent context (without mainResponse — that comes after generation)
      // Fetch enough history for the hungriest agent — individual agents trim to their own contextSize.
      const agentContextSize =
        resolvedAgents.length > 0 ? Math.max(...resolvedAgents.map((a) => (a.settings.contextSize as number) || 5)) : 5;
      const agentSlice = chatMessages.slice(-agentContextSize);

      // Batch-fetch committed game state snapshots for assistant messages in the agent context
      const assistantMsgIds = agentSlice.filter((m: any) => m.role === "assistant").map((m: any) => m.id as string);
      const committedSnapshots = await gameStateStore.getCommittedForMessages(assistantMsgIds);

      const recentMsgs = agentSlice.map((m: any) => {
        const msg: AgentContext["recentMessages"][number] = {
          role: m.role as string,
          content: m.content as string,
          characterId: m.characterId ?? undefined,
        };
        if (m.role === "assistant") {
          const snapRow = committedSnapshots.get(m.id as string);
          if (snapRow) {
            msg.gameState = parseGameStateRow(snapRow as Record<string, unknown>);
          }
        }
        return msg;
      });

      const agentContext: AgentContext = {
        chatId: input.chatId,
        chatMode,
        recentMessages: recentMsgs,
        mainResponse: null,
        gameState,
        characters: charInfo,
        persona:
          personaName !== "User"
            ? {
                name: personaName,
                description: personaDescription,
                personality: personaFields.personality || undefined,
                backstory: personaFields.backstory || undefined,
                appearance: personaFields.appearance || undefined,
                scenario: personaFields.scenario || undefined,
                ...(persona?.personaStats
                  ? (() => {
                      let pStats: any;
                      try {
                        pStats =
                          typeof persona.personaStats === "string"
                            ? JSON.parse(persona.personaStats)
                            : persona.personaStats;
                      } catch {
                        return {};
                      }
                      // Merge current values from gameState so the agent sees
                      // live stats instead of the persona's default config.
                      if (pStats?.bars && gameState?.personaStats && Array.isArray(gameState.personaStats)) {
                        const currentByName = new Map(
                          (gameState.personaStats as Array<{ name: string; value: number }>).map((s) => [
                            s.name,
                            s.value,
                          ]),
                        );
                        pStats.bars = pStats.bars.map((bar: any) => ({
                          ...bar,
                          value: currentByName.has(bar.name) ? currentByName.get(bar.name) : bar.value,
                        }));
                      }
                      // Only include enabled bars
                      if (pStats && !pStats.enabled) delete pStats.bars;
                      const result: Record<string, unknown> = { personaStats: pStats };
                      if (pStats?.rpgStats?.enabled) {
                        result.rpgStats = pStats.rpgStats;
                      }
                      return result;
                    })()
                  : {}),
              }
            : null,
        memory: {},
        activatedLorebookEntries: null,
        writableLorebookIds: null,
        chatSummary: ((chatMeta.summary as string) ?? "").trim() || null,
        streaming: input.streaming,
        signal: abortController.signal,
      };

      // ── Interval gating: Narrative Director only intervenes every N assistant messages ──
      const directorAgent = resolvedAgents.find((a) => a.type === "director");
      if (directorAgent) {
        const runInterval =
          (directorAgent.settings.runInterval as number) ??
          (getDefaultBuiltInAgentSettings("director").runInterval as number) ??
          5;
        if (runInterval > 1) {
          const lastRun = await agentsStore.getLastSuccessfulRunByType("director", input.chatId);
          if (lastRun) {
            const lastRunMsgId = lastRun.messageId;
            const lastRunIdx = allChatMessages.findIndex((m: any) => m.id === lastRunMsgId);
            const assistantMsgsSince =
              lastRunIdx >= 0 ? allChatMessages.slice(lastRunIdx + 1).filter((m: any) => m.role === "assistant") : [];
            if (assistantMsgsSince.length + 1 < runInterval) {
              resolvedAgents.splice(resolvedAgents.indexOf(directorAgent), 1);
            }
          }
        }
      }

      // Populate writable lorebook IDs for the lorebook-keeper agent
      if (resolvedAgents.some((a) => a.type === "lorebook-keeper")) {
        const { writableLorebookIds, targetLorebookId, targetLorebookName } = await resolveLorebookKeeperTarget({
          lorebooksStore,
          chatId: input.chatId,
          characterIds,
          personaId,
          activeLorebookIds: chatActiveLorebookIds,
          preferredTargetLorebookId: lorebookKeeperSettings.targetLorebookId,
        });
        agentContext.writableLorebookIds = writableLorebookIds;
        if (targetLorebookId) {
          agentContext.memory._lorebookKeeperTargetLorebookId = targetLorebookId;
        }
        if (targetLorebookName) {
          agentContext.memory._lorebookKeeperTargetLorebookName = targetLorebookName;
        }

        // ── Interval gating: only run every N assistant messages ──
        const lkAgent = resolvedAgents.find((a) => a.type === "lorebook-keeper")!;
        const runInterval = (lkAgent.settings.runInterval as number) ?? 8;
        const lastRun = await agentsStore.getLastSuccessfulRunByType("lorebook-keeper", input.chatId);
        const pendingLorebookMessages = getLorebookKeeperAutomaticPendingCount(
          lorebookKeeperMessages,
          lorebookKeeperSettings.readBehindMessages,
          lastRun?.messageId ?? null,
        );
        const historicalLorebookTarget = getLorebookKeeperAutomaticTarget(
          lorebookKeeperMessages,
          lorebookKeeperSettings.readBehindMessages,
        );
        if (lorebookKeeperSettings.readBehindMessages > 0 && !historicalLorebookTarget) {
          resolvedAgents.splice(resolvedAgents.indexOf(lkAgent), 1);
        } else if (runInterval > 1 && pendingLorebookMessages < runInterval) {
          // Not enough canon messages since the last successful run — remove from pipeline.
          resolvedAgents.splice(resolvedAgents.indexOf(lkAgent), 1);
        }

        // ── Feed existing target-lorebook entries to the agent for deduplication ──
        if (resolvedAgents.some((a) => a.type === "lorebook-keeper")) {
          try {
            const existingEntries = await loadLorebookKeeperExistingEntries(lorebooksStore, targetLorebookId);
            if (existingEntries.length > 0) {
              agentContext.memory._existingLorebookEntries = existingEntries;
            }
          } catch {
            /* non-critical */
          }
        }
      }

      // If the expression agent is enabled, load available sprite expressions per character
      if (resolvedAgents.some((a) => a.type === "expression")) {
        try {
          const { readdirSync, existsSync: existsSyncFs } = await import("fs");
          const { join: joinPath, extname: extnameFs } = await import("path");
          const spritesRoot = joinPath(DATA_DIR, "sprites");
          const spriteExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]);
          const perChar: Array<{ characterId: string; characterName: string; expressions: string[] }> = [];
          for (const char of agentContext.characters) {
            const charDir = joinPath(spritesRoot, char.id);
            if (!existsSyncFs(charDir)) continue;
            const files = readdirSync(charDir).filter((f: string) => spriteExts.has(extnameFs(f).toLowerCase()));
            const exprNames = files.map((f: string) => f.slice(0, -extnameFs(f).length));
            if (exprNames.length > 0) {
              perChar.push({ characterId: char.id, characterName: char.name, expressions: exprNames });
            }
          }
          if (perChar.length > 0) {
            agentContext.memory._availableSprites = perChar;
          }
        } catch {
          /* non-critical */
        }
      }

      // If the background agent is enabled, load available backgrounds + tags into context
      if (resolvedAgents.some((a) => a.type === "background")) {
        try {
          const { readdirSync, readFileSync, existsSync } = await import("fs");
          const { join, extname } = await import("path");
          const bgDir = join(DATA_DIR, "backgrounds");
          if (existsSync(bgDir)) {
            const exts = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
            const files = readdirSync(bgDir).filter((f: string) => exts.has(extname(f).toLowerCase()));

            // Load metadata (tags + original names)
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

      // If the haptic agent is enabled, inject connected device info (names + capabilities) into context
      if (resolvedAgents.some((a) => a.type === "haptic")) {
        try {
          const { hapticService } = await import("../services/haptic/buttplug-service.js");
          // Auto-connect to Intiface Central if not already connected
          if (!hapticService.connected) {
            try {
              await hapticService.connect();
            } catch {
              logger.warn("[haptic] Auto-connect to Intiface Central failed — is the server running?");
            }
          }
          if (hapticService.connected && hapticService.devices.length > 0) {
            agentContext.memory._connectedDevices = hapticService.devices.map((d) => ({
              name: d.name,
              index: d.index,
              capabilities: d.capabilities,
            }));
            logger.debug(`[haptic] Injected ${hapticService.devices.length} device(s) into agent context`);
          } else if (!hapticService.connected) {
            logger.warn("[haptic] Agent enabled but Intiface Central is not connected — skipping device injection");
          } else {
            logger.warn("[haptic] Agent enabled and connected, but no devices found — did you scan for devices?");
          }
        } catch (err) {
          logger.error(err, "[haptic] Failed to inject device info");
        }
      }

      // If the CYOA agent is enabled, inject previous choices for anti-repetition
      if (resolvedAgents.some((a) => a.type === "cyoa")) {
        const lastAssistantMsg = chatMessages.filter((m: any) => m.role === "assistant").at(-1);
        if (lastAssistantMsg) {
          const lastExtra = parseExtra((lastAssistantMsg as any).extra);
          if (lastExtra.cyoaChoices) {
            agentContext.memory._lastCyoaChoices = lastExtra.cyoaChoices;
          }
        }
      }

      // If the secret-plot-driver agent is enabled, load its previous state from agent memory
      const secretPlotAgent = resolvedAgents.find((a) => a.type === "secret-plot-driver");
      if (secretPlotAgent) {
        try {
          const mem = await agentsStore.getMemory(secretPlotAgent.id, input.chatId);
          const state: Record<string, unknown> = {};
          if (mem.overarchingArc) state.overarchingArc = mem.overarchingArc;
          if (mem.sceneDirections) state.sceneDirections = mem.sceneDirections;
          if (mem.pacing) state.pacing = mem.pacing;
          if (mem.recentlyFulfilled) state.recentlyFulfilled = mem.recentlyFulfilled;
          if (mem.staleDetected != null) state.staleDetected = mem.staleDetected;
          if (Object.keys(state).length > 0) {
            agentContext.memory._secretPlotState = state;
          }
        } catch {
          /* non-critical */
        }
      }

      // If the knowledge-retrieval agent is enabled, load lorebook + file source material
      const knowledgeRetrievalAgent = resolvedAgents.find((a) => a.type === "knowledge-retrieval");
      if (knowledgeRetrievalAgent) {
        const materialParts: string[] = [];

        // Load lorebook entries
        try {
          const sourceIds = (knowledgeRetrievalAgent.settings.sourceLorebookIds as string[]) ?? [];
          if (sourceIds.length > 0) {
            const entries = await lorebooksStore.listEntriesByLorebooks(sourceIds);
            const activeEntries = entries.filter((e: any) => e.enabled !== false);
            if (activeEntries.length > 0) {
              const formatted = activeEntries
                .map((e: any) => {
                  const header = e.name || e.keys?.join(", ") || "Entry";
                  return `## ${header}\n${e.content}`;
                })
                .join("\n\n");
              materialParts.push(formatted);
            }
          }
        } catch {
          /* non-critical */
        }

        // Load uploaded file sources
        try {
          const sourceFileIds = (knowledgeRetrievalAgent.settings.sourceFileIds as string[]) ?? [];
          if (sourceFileIds.length > 0) {
            for (const fileId of sourceFileIds) {
              try {
                const sourceInfo = await getSourceFilePath(fileId);
                if (!sourceInfo) continue;
                const { filePath, originalName } = sourceInfo;
                const text = await extractFileText(filePath);
                if (text.trim()) {
                  materialParts.push(`## File: ${originalName}\n${text}`);
                }
              } catch {
                /* skip unreadable or missing files */
              }
            }
          }
        } catch {
          /* non-critical */
        }

        if (materialParts.length > 0) {
          agentContext.memory._knowledgeRetrievalMaterial = materialParts.join("\n\n");
        }
      }

      // If the knowledge-router agent is enabled, load candidate lorebook entries
      // for routing. The router picks IDs from this list and the selected entries
      // are injected verbatim — no per-entry summarization pass.
      const knowledgeRouterAgent = resolvedAgents.find((a) => a.type === "knowledge-router");
      let knowledgeRouterEntries: LorebookEntry[] = [];
      if (knowledgeRouterAgent) {
        try {
          const sourceIds = (knowledgeRouterAgent.settings.sourceLorebookIds as string[]) ?? [];
          if (sourceIds.length > 0) {
            const entries = (await lorebooksStore.listEntriesByLorebooks(sourceIds)) as LorebookEntry[];
            // Honor per-chat entry state overrides — a user can disable an entry for
            // this chat without touching the global lorebook, and ephemeral entries
            // carry per-chat countdown state. Mirrors the projection the standard
            // lorebook activation pipeline does in services/lorebook/index.ts.
            const entryStateOverrides =
              (chatMeta.entryStateOverrides as Record<string, { enabled?: boolean; ephemeral?: number | null }>) ?? {};
            // Skip:
            //   - Disabled entries (off-limits, by global flag or per-chat override).
            //   - Constant entries (already injected unconditionally by the standard
            //     activation pipeline — routing them would duplicate work).
            //   - Exhausted ephemeral entries (countdown reached 0 in this chat).
            knowledgeRouterEntries = entries
              .filter((e: LorebookEntry) => {
                const ov = entryStateOverrides[e.id];
                const isEnabled = ov?.enabled ?? e.enabled !== false;
                if (!isEnabled || e.constant === true) return false;
                // Project the ephemeral override here so the exhaustion check uses
                // the per-chat remaining count, not the stale global default.
                const effectiveEphemeral = ov?.ephemeral !== undefined ? ov.ephemeral : e.ephemeral;
                if (effectiveEphemeral === 0) return false;
                return true;
              })
              .map((e: LorebookEntry) => {
                const ov = entryStateOverrides[e.id];
                return ov?.ephemeral !== undefined ? { ...e, ephemeral: ov.ephemeral } : e;
              });
          }
        } catch (err) {
          // Non-critical: the router simply skips this turn if loading fails. Log
          // so the failure is diagnosable instead of looking like "no matches found".
          logger.warn(err, "[knowledge-router] failed to load source lorebook entries");
        }
      }

      // ────────────────────────────────────────
      // Automated Chat Summary — interval gating
      // ────────────────────────────────────────
      // Only run if the Automated Chat Summary agent is in the pipeline.
      // It triggers every N user messages (configured via `runInterval` in the agent settings).
      // The context size for summary generation comes from the chat's summaryContextSize metadata.
      if (resolvedAgents.some((a) => a.type === "chat-summary")) {
        const csAgent = resolvedAgents.find((a) => a.type === "chat-summary")!;
        const triggersAfter = (csAgent.settings.runInterval as number) ?? 5;
        let shouldRun = true;

        if (triggersAfter > 1) {
          const lastRun = await agentsStore.getLastSuccessfulRunByType("chat-summary", input.chatId);
          if (lastRun) {
            const lastRunMsgId = lastRun.messageId;
            const lastRunIdx = allChatMessages.findIndex((m: any) => m.id === lastRunMsgId);
            const userMsgsSince =
              lastRunIdx >= 0 ? allChatMessages.slice(lastRunIdx + 1).filter((m: any) => m.role === "user") : [];
            // +1 for the current user message being generated
            if (userMsgsSince.length + 1 < triggersAfter) {
              shouldRun = false;
            }
          }
          // First run ever: allow it to proceed
        }

        if (!shouldRun) {
          resolvedAgents.splice(resolvedAgents.indexOf(csAgent), 1);
        } else {
          // Override the agent's context size with the chat-level summaryContextSize
          const summaryCtxSize = (chatMeta.summaryContextSize as number) || 50;
          csAgent.settings = { ...csAgent.settings, contextSize: summaryCtxSize };
        }
      }

      // ────────────────────────────────────────
      // Tracker Data Injection
      // ────────────────────────────────────────
      // Always inject committed tracker data as a system message regardless of
      // preset configuration. This replaces the old agent_data marker approach.
      if (chatEnableAgents && chatActiveAgentIds.length > 0) {
        const active = new Set(chatActiveAgentIds);
        const hasWorldState = active.has("world-state");
        const hasCharTracker = active.has("character-tracker");
        const hasPersonaStats = active.has("persona-stats");
        const hasQuest = active.has("quest");
        const hasCustomTracker = active.has("custom-tracker");

        if (hasWorldState || hasCharTracker || hasPersonaStats || hasQuest || hasCustomTracker) {
          // Prefer committed snapshot; fall back to latest if none committed yet
          let snap: typeof gameStateSnapshotsTable.$inferSelect | undefined;
          const committedRows = await app.db
            .select()
            .from(gameStateSnapshotsTable)
            .where(and(eq(gameStateSnapshotsTable.chatId, input.chatId), eq(gameStateSnapshotsTable.committed, 1)))
            .orderBy(desc(gameStateSnapshotsTable.createdAt))
            .limit(1);
          snap = committedRows[0];
          if (!snap) {
            const anyRows = await app.db
              .select()
              .from(gameStateSnapshotsTable)
              .where(eq(gameStateSnapshotsTable.chatId, input.chatId))
              .orderBy(desc(gameStateSnapshotsTable.createdAt))
              .limit(1);
            snap = anyRows[0];
          }

          if (snap) {
            const trackerParts: string[] = [];

            // World state core fields
            if (hasWorldState) {
              const wsParts: string[] = [];
              if (snap.date) wsParts.push(`Date: ${snap.date}`);
              if (snap.time) wsParts.push(`Time: ${snap.time}`);
              if (snap.location) wsParts.push(`Location: ${snap.location}`);
              if (snap.weather) wsParts.push(`Weather: ${snap.weather}`);
              if (snap.temperature) wsParts.push(`Temperature: ${snap.temperature}`);
              if (wsParts.length > 0) trackerParts.push(wrapContent(wsParts.join("\n"), "World", wrapFormat));
            }

            // Present Characters
            if (hasCharTracker) {
              const presentChars = JSON.parse(snap.presentCharacters);
              if (Array.isArray(presentChars) && presentChars.length > 0) {
                const charLines = presentChars.map((c: any) => {
                  if (typeof c === "string") return `- ${c}`;
                  const details: string[] = [];
                  if (c.mood) details.push(`mood: ${c.mood}`);
                  if (c.appearance) details.push(`appearance: ${c.appearance}`);
                  if (c.outfit) details.push(`outfit: ${c.outfit}`);
                  if (c.thoughts) details.push(`thoughts: ${c.thoughts}`);
                  if (Array.isArray(c.stats) && c.stats.length > 0) {
                    const statStr = c.stats
                      .map((s: any) => `${s.name}: ${s.value}${s.max ? `/${s.max}` : ""}`)
                      .join(", ");
                    details.push(`stats: ${statStr}`);
                  }
                  const detailStr = details.length > 0 ? ` (${details.join("; ")})` : "";
                  return `- ${c.emoji ?? ""} ${c.name ?? c}${detailStr}`;
                });
                trackerParts.push(wrapContent(charLines.join("\n"), "Present Characters", wrapFormat));
              }
            }

            // Persona Stats (needs/condition bars)
            if (hasPersonaStats && snap.personaStats) {
              const psBars = typeof snap.personaStats === "string" ? JSON.parse(snap.personaStats) : snap.personaStats;
              if (Array.isArray(psBars) && psBars.length > 0) {
                const barLines = psBars.map((b: any) => `- ${b.name}: ${b.value}/${b.max}`);
                trackerParts.push(wrapContent(barLines.join("\n"), "Persona Stats", wrapFormat));
              }
            }

            // Player stats: quests, inventory, stats, custom tracker
            if (snap.playerStats) {
              const stats = typeof snap.playerStats === "string" ? JSON.parse(snap.playerStats) : snap.playerStats;

              if (hasPersonaStats && stats.status) {
                trackerParts.push(wrapContent(`Status: ${stats.status}`, "Status", wrapFormat));
              }

              if (hasQuest && Array.isArray(stats.activeQuests) && stats.activeQuests.length > 0) {
                const questLines = stats.activeQuests.map((q: any) => {
                  const objectives = Array.isArray(q.objectives)
                    ? q.objectives.map((o: any) => `  ${o.completed ? "[x]" : "[ ]"} ${o.text}`).join("\n")
                    : "";
                  return `- ${q.name}${q.completed ? " (completed)" : ""}${objectives ? "\n" + objectives : ""}`;
                });
                trackerParts.push(wrapContent(questLines.join("\n"), "Active Quests", wrapFormat));
              }

              if (hasPersonaStats && Array.isArray(stats.inventory) && stats.inventory.length > 0) {
                const invLines = stats.inventory.map(
                  (item: any) =>
                    `- ${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ""}${item.description ? ` — ${item.description}` : ""}`,
                );
                trackerParts.push(wrapContent(invLines.join("\n"), "Inventory", wrapFormat));
              }

              if (hasPersonaStats && Array.isArray(stats.stats) && stats.stats.length > 0) {
                const statLines = stats.stats.map((s: any) => `- ${s.name}: ${s.value}${s.max ? `/${s.max}` : ""}`);
                trackerParts.push(wrapContent(statLines.join("\n"), "Stats", wrapFormat));
              }

              if (
                hasCustomTracker &&
                Array.isArray(stats.customTrackerFields) &&
                stats.customTrackerFields.length > 0
              ) {
                const customLines = stats.customTrackerFields.map((f: any) => `- ${f.name}: ${f.value}`);
                trackerParts.push(wrapContent(customLines.join("\n"), "Custom Tracker", wrapFormat));
              }
            }

            // Inject player notes if present
            const playerNotes = typeof chatMeta.gamePlayerNotes === "string" ? chatMeta.gamePlayerNotes.trim() : "";
            if (playerNotes) {
              trackerParts.push(
                wrapContent(
                  `The player has written these personal notes. Consider them when narrating — they reflect what the player is tracking, their theories, and plans:\n${playerNotes}`,
                  "Player Notes",
                  wrapFormat,
                ),
              );
            }

            if (trackerParts.length > 0) {
              const contextBlock =
                wrapFormat === "none"
                  ? trackerParts.join("\n\n")
                  : wrapFormat === "xml"
                    ? `<context>\n${trackerParts.map((p) => "    " + p.replace(/\n/g, "\n    ")).join("\n")}\n</context>`
                    : `# Context\n*(Established state as of the last message. Do not re-describe — advance from here.)*\n${trackerParts.join("\n")}`;

              // Insert as system message right before the last user message.
              // When strict role formatting merges post-chat sections (like
              // Output Format) into the last user message, this ensures the
              // tracker context appears before those instructions.
              const lastUserIdx = findLastIndex(finalMessages, "user");
              if (lastUserIdx >= 0) {
                finalMessages.splice(lastUserIdx, 0, { role: "system", content: contextBlock });
              } else {
                finalMessages.splice(finalMessages.length, 0, { role: "system", content: contextBlock });
              }
            }
          }
        }
      }

      // SSE helper for sending agent events
      // Wrapped in try-catch: if the SSE stream is closed (e.g. client
      // navigated away), a write error must NOT crash the agent pipeline —
      // otherwise Promise.allSettled in executePhase silently drops the
      // entire group's results, causing agents to appear as "not triggered".
      const sendAgentEvent = (result: AgentResult) => {
        trySendSseEvent(reply, {
          type: "agent_result",
          data: {
            agentType: result.agentType,
            agentName: resolvedAgents.find((a) => a.type === result.agentType)?.name ?? result.agentType,
            resultType: result.type,
            data: result.data,
            success: result.success,
            error: result.error,
            durationMs: result.durationMs,
          },
        });
      };

      // Create the pipeline (exclude text rewrite/editor agents — they run last,
      // after all other post-processing agents have produced their context).
      const textRewriteAgents = resolvedAgents.filter(
        (a) => a.phase === "post_processing" && resolveAgentResultType(a) === "text_rewrite",
      );
      const textRewriteAgentIds = new Set(textRewriteAgents.map((a) => a.id));
      const lorebookKeeperAgent = resolvedAgents.find((a) => a.type === "lorebook-keeper") ?? null;
      let pipelineAgents = resolvedAgents.filter((a) => !textRewriteAgentIds.has(a.id) && a.type !== "lorebook-keeper");

      // When manualTrackers is enabled, strip tracker-category agents from the
      // automatic pipeline — the user will trigger them manually via retry-agents.
      const manualTrackers = chatMeta.manualTrackers === true;
      if (manualTrackers) {
        const trackerIds = new Set(BUILT_IN_AGENTS.filter((a) => a.category === "tracker").map((a) => a.id));
        pipelineAgents = pipelineAgents.filter((a) => !trackerIds.has(a.type));
      }

      // Echo Chamber should only fire on fresh user messages, not swipes/regenerates
      if (input.regenerateMessageId) {
        pipelineAgents = pipelineAgents.filter((a) => a.type !== "echo-chamber");
      }

      // Combat agent only needs to run when an encounter is active.
      // If the last combat result stored encounterActive = false, skip it.
      if (chatMeta.encounterActive === false) {
        pipelineAgents = pipelineAgents.filter((a) => a.type !== "combat");
      }

      // ────────────────────────────────────────
      // Tool Resolution (Main Generation + Agent Pipeline)
      // ────────────────────────────────────────
      const inputBody = req.body as Record<string, unknown>;
      const enableChatTools = inputBody.enableTools === true || chatMeta.enableTools === true;
      const enableAgentTools = resolvedAgents.some((agent) => {
        const agentSettings = typeof agent.settings === "string" ? JSON.parse(agent.settings) : agent.settings || {};
        return Array.isArray(agentSettings.enabledTools) && agentSettings.enabledTools.length > 0;
      });
      const resolveTools = enableChatTools || enableAgentTools;
      let toolDefs: LLMToolDefinition[] | undefined;
      const allToolDefs: LLMToolDefinition[] = [];
      const agentOnlyToolNames = new Set(["read_chat_summary", "append_chat_summary"]);
      const customToolDefs: Array<{
        name: string;
        executionType: string;
        webhookUrl: string | null;
        staticResult: string | null;
        scriptBody: string | null;
      }> = [];

      if (resolveTools) {
        // Per-chat tool selection (empty = all tools)
        const chatActiveToolIds: string[] = Array.isArray(chatMeta.activeToolIds)
          ? (chatMeta.activeToolIds as string[])
          : [];
        const hasToolFilter = chatActiveToolIds.length > 0;
        const registeredToolSources = new Map<string, "built-in" | "custom">();

        // Built-in tools
        for (const t of BUILT_IN_TOOLS) {
          const existingSource = registeredToolSources.get(t.name);
          if (existingSource) {
            throw new Error(
              `Duplicate tool name "${t.name}" from built-in tool collides with existing ${existingSource} tool`,
            );
          }
          registeredToolSources.set(t.name, "built-in");
          allToolDefs.push({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters as unknown as Record<string, unknown>,
            },
          });
        }

        // Custom tools from DB
        const enabledCustomTools = await customToolsStore.listEnabled();
        for (const ct of enabledCustomTools) {
          const existingSource = registeredToolSources.get(ct.name);
          if (existingSource) {
            logger.warn(
              '[tools] Skipping custom tool "%s" because it collides with existing %s tool',
              ct.name,
              existingSource,
            );
            continue;
          }
          registeredToolSources.set(ct.name, "custom");

          try {
            const schema =
              typeof ct.parametersSchema === "string" ? JSON.parse(ct.parametersSchema) : ct.parametersSchema;
            if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
              throw new Error("parametersSchema must be a JSON object");
            }
            const schemaObject = schema as Record<string, unknown>;
            const schemaType = schemaObject.type;
            const schemaProperties = schemaObject.properties;
            const schemaRequired = schemaObject.required;

            if (schemaType !== undefined && schemaType !== "object") {
              throw new Error('parametersSchema root "type" must be "object"');
            }
            if (
              schemaProperties !== undefined &&
              (!schemaProperties || typeof schemaProperties !== "object" || Array.isArray(schemaProperties))
            ) {
              throw new Error('parametersSchema "properties" must be an object');
            }
            if (
              schemaType === undefined &&
              (schemaProperties === undefined || !schemaProperties || typeof schemaProperties !== "object")
            ) {
              throw new Error('parametersSchema must define root "type": "object" or include object "properties"');
            }
            if (
              schemaRequired !== undefined &&
              (!Array.isArray(schemaRequired) || schemaRequired.some((entry) => typeof entry !== "string"))
            ) {
              throw new Error('parametersSchema "required" must be an array of strings');
            }

            customToolDefs.push({
              name: ct.name,
              executionType: ct.executionType,
              webhookUrl: ct.webhookUrl,
              staticResult: ct.staticResult,
              scriptBody: ct.scriptBody,
            });

            allToolDefs.push({
              type: "function" as const,
              function: {
                name: ct.name,
                description: ct.description,
                parameters: schemaObject,
              },
            });
          } catch (error) {
            registeredToolSources.delete(ct.name);
            logger.warn(
              '[tools] Skipping custom tool "%s" with invalid parameter schema: %s %s',
              ct.name,
              error instanceof Error ? error.message : "unknown error",
              String(ct.parametersSchema),
            );
          }
        }

        if (enableChatTools) {
          toolDefs = hasToolFilter
            ? allToolDefs.filter(
                (td) => chatActiveToolIds.includes(td.function.name) && !agentOnlyToolNames.has(td.function.name),
              )
            : allToolDefs.filter((td) => !agentOnlyToolNames.has(td.function.name));
        }
      }

      // ── Spotify Token Refresh (Early) ──
      const resolvedToolNames = new Set(allToolDefs.map((td) => td.function.name));
      const chatResolvedToolNames = new Set((toolDefs ?? []).map((td) => td.function.name));
      const spotifyToolNames = new Set(DEFAULT_AGENT_TOOLS.spotify ?? []);
      const chatAllowsSpotify = Array.from(chatResolvedToolNames).some((name) => spotifyToolNames.has(name));
      const anyAgentAllowsSpotify = resolvedAgents.some((agent) => {
        const agentSettings = typeof agent.settings === "string" ? JSON.parse(agent.settings) : agent.settings || {};
        const agentEnabledNames = Array.isArray(agentSettings.enabledTools)
          ? (agentSettings.enabledTools as string[])
          : [];
        const agentResolvedNames = agentEnabledNames.filter((name) => resolvedToolNames.has(name));
        return agentResolvedNames.some((name) => spotifyToolNames.has(name));
      });
      const needsSpotify = (enableChatTools && chatAllowsSpotify) || anyAgentAllowsSpotify;
      // Look beyond resolved agents only to reuse stored Spotify credentials when Spotify tools are allowed.
      const spotifyAgent = needsSpotify
        ? (resolvedAgents.find((a) => a.type === "spotify") ??
          enabledConfigs.find((cfg: any) => cfg.type === "spotify") ??
          (!enabledConfigs.some((cfg: any) => cfg.type === "spotify")
            ? (await agentsStore.list()).find((cfg: any) => cfg.type === "spotify")
            : null))
        : null;
      let spotifyAccessToken: string | null = null;
      let spotifyExpiresAt = 0;
      if (spotifyAgent) {
        const sSettings =
          typeof spotifyAgent.settings === "string" ? JSON.parse(spotifyAgent.settings) : spotifyAgent.settings || {};
        spotifyAccessToken = decryptStoredToken(sSettings.spotifyAccessToken);
        const spotifyRefreshToken = decryptStoredToken(sSettings.spotifyRefreshToken);
        const spotifyClientId = (sSettings.spotifyClientId as string) || null;
        spotifyExpiresAt = (sSettings.spotifyExpiresAt as number) ?? 0;

        if (
          spotifyRefreshToken &&
          spotifyClientId &&
          (!spotifyAccessToken || (spotifyExpiresAt > 0 && Date.now() > spotifyExpiresAt - 60_000)) // Refresh if missing or 1 min before expiry
        ) {
          try {
            const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: spotifyRefreshToken,
                client_id: spotifyClientId,
              }),
              signal: AbortSignal.timeout(10_000),
            });
            if (tokenRes.ok) {
              const tokens = (await tokenRes.json()) as {
                access_token: string;
                refresh_token?: string;
                expires_in: number;
              };
              const refreshedExpiresAt = Date.now() + tokens.expires_in * 1000;
              spotifyAccessToken = tokens.access_token;
              spotifyExpiresAt = refreshedExpiresAt;
              const nextRefreshToken = tokens.refresh_token ?? spotifyRefreshToken;
              // Persist refreshed tokens in background (don't await)
              agentsStore
                .update(spotifyAgent.id, {
                  settings: {
                    ...sSettings,
                    spotifyAccessToken: encryptApiKey(tokens.access_token),
                    spotifyRefreshToken: nextRefreshToken ? encryptApiKey(nextRefreshToken) : null,
                    spotifyExpiresAt: refreshedExpiresAt,
                  },
                })
                .catch((err) => logger.warn(err, "[spotify] failed to persist refreshed tokens"));
            }
          } catch {
            /* ignore refresh errors */
          }
        }
      }
      const spotifyCreds =
        spotifyAccessToken && (spotifyExpiresAt <= 0 || Date.now() < spotifyExpiresAt)
          ? { accessToken: spotifyAccessToken }
          : undefined;
      const searchLorebookForTools = async (query: string, category?: string | null) => {
        const entries = await lorebooksStore.listActiveEntries({
          chatId: input.chatId,
          characterIds,
          personaId,
          activeLorebookIds: chatActiveLorebookIds,
        });
        const q = query.toLowerCase();
        return entries
          .filter((e: any) => {
            const nameMatch = e.name?.toLowerCase().includes(q);
            const contentMatch = e.content?.toLowerCase().includes(q);
            const keyMatch = (e.keys as string[])?.some((k: string) => k.toLowerCase().includes(q));
            const catMatch = !category || e.tag === category;
            return catMatch && (nameMatch || contentMatch || keyMatch);
          })
          .slice(0, 20)
          .map((e: any) => ({ name: e.name, content: e.content, tag: e.tag, keys: e.keys as string[] }));
      };
      const updateChatMetadataForTools = async (patchOrUpdater: MetadataPatchInput) => {
        let emittedPatch: Record<string, unknown> = {};
        const updatedChat = await chats.patchMetadata(input.chatId, async (currentMeta) => {
          const patch =
            typeof patchOrUpdater === "function" ? await patchOrUpdater({ ...currentMeta }) : patchOrUpdater;
          emittedPatch = patch;
          return patch;
        });
        const updatedMeta = updatedChat ? parseExtra(updatedChat.metadata) : { ...chatMeta, ...emittedPatch };
        for (const key of Object.keys(chatMeta)) {
          if (!(key in updatedMeta)) {
            delete chatMeta[key];
          }
        }
        Object.assign(chatMeta, updatedMeta);
        agentContext.chatSummary =
          typeof chatMeta.summary === "string" && chatMeta.summary.trim() ? chatMeta.summary.trim() : null;
        trySendSseEvent(reply, { type: "metadata_patch", data: emittedPatch });
        return updatedMeta;
      };
      const baseToolExecutionContext = {
        gameState: gameState ? (gameState as unknown as Record<string, unknown>) : undefined,
        customTools: customToolDefs,
        spotify: spotifyCreds,
        searchLorebook: searchLorebookForTools,
        chatMeta,
        onUpdateMetadata: updateChatMetadataForTools,
      };

      // ── Resolve tool context for all agents ──
      // This enables built-in and custom tools for any agent in the pipeline.
      for (const agent of resolvedAgents) {
        if (agent.toolContext) continue;

        const agentSettings = typeof agent.settings === "string" ? JSON.parse(agent.settings) : agent.settings || {};
        const agentEnabledNames = Array.isArray(agentSettings.enabledTools)
          ? (agentSettings.enabledTools as string[])
          : [];
        if (agentEnabledNames.length === 0) continue;

        const agentTools = allToolDefs.filter((td) => agentEnabledNames.includes(td.function.name));
        if (agentTools.length === 0) continue;
        const allowedToolNames = new Set(agentTools.map((td) => td.function.name));

        agent.toolContext = {
          tools: agentTools,
          executeToolCall: async (call) => {
            if (!allowedToolNames.has(call.function.name)) {
              return JSON.stringify({
                error: `Tool not allowed for agent ${agent.type}: ${call.function.name}`,
                allowed: Array.from(allowedToolNames),
              });
            }
            const results = await executeToolCalls([call], {
              ...baseToolExecutionContext,
            });
            return results[0]?.result ?? "Tool execution failed";
          },
        };
      }

      const pipeline = createAgentPipeline(pipelineAgents, agentContext, sendAgentEvent);

      // ────────────────────────────────────────
      // Phase 1: Pre-generation agents
      // ────────────────────────────────────────
      logger.debug(`[timing] Prompt assembly + context: ${Date.now() - _tAssemble}ms`);
      // Only run pre-gen agents on fresh generations (user sent a new message),
      // NOT on regenerations/swipes — EXCEPT for context-injection agents (like
      // prose-guardian) which improve writing quality and should run every time.
      // On regens, reuse cached injections from the first generation to save tokens.
      // Post-gen agents still run after every response.
      let contextInjections: AgentInjection[] = [];
      // Static-injection agents don't need LLM calls — they inject prompt text directly
      const STATIC_INJECTION_AGENTS = new Set(["html"]);
      const SEPARATE_INJECTION_AGENTS = new Set(["knowledge-retrieval", "knowledge-router"]);
      const EXCLUDED_FROM_PIPELINE = new Set(["html", "knowledge-retrieval", "knowledge-router"]);
      const hasPreGenAgents = resolvedAgents.some(
        (a) => a.phase === "pre_generation" && !EXCLUDED_FROM_PIPELINE.has(a.type),
      );

      // ── Run pre-gen agents, knowledge retrieval, and knowledge router in parallel when possible ──
      const shouldRunKR = !!(
        knowledgeRetrievalAgent &&
        agentContext.memory._knowledgeRetrievalMaterial &&
        !input.regenerateMessageId
      );
      const shouldRunRouter = !!(
        knowledgeRouterAgent &&
        knowledgeRouterEntries.length > 0 &&
        !input.regenerateMessageId
      );
      const shouldRunPreGen = hasPreGenAgents && !input.regenerateMessageId;

      // Helper: wrap a separate-injection agent's text and append it to the last
      // user message. Used by both knowledge-retrieval and knowledge-router on
      // both fresh generations AND regen-cache replays — keeping the wrap+append
      // in one place prevents the two paths from drifting again (PR #228 had to
      // fix exactly that drift once already).
      const appendSeparateAgentInjection = (
        agentType: "knowledge-retrieval" | "knowledge-router",
        text: string,
      ): void => {
        const isRouter = agentType === "knowledge-router";
        const heading = isRouter ? "Knowledge Router" : "Knowledge Retrieval";
        const tag = isRouter ? "knowledge_router" : "knowledge_retrieval";
        // Honor all three wrapFormat values (the previous KR-only injection had
        // a markdown-or-xml-fallback bug that "none" silently fell into).
        const wrapped =
          wrapFormat === "none"
            ? `\n\n${text}`
            : wrapFormat === "markdown"
              ? `\n\n## ${heading}\n${text}`
              : `\n\n<${tag}>\n${text}\n</${tag}>`;
        const lastUserIdx = findLastIndex(finalMessages, "user");
        if (lastUserIdx >= 0) {
          const target = finalMessages[lastUserIdx]!;
          finalMessages[lastUserIdx] = { ...target, content: target.content + wrapped };
        } else {
          const last = finalMessages[finalMessages.length - 1]!;
          finalMessages[finalMessages.length - 1] = { ...last, content: last.content + wrapped };
        }
      };

      if (shouldRunPreGen || shouldRunKR || shouldRunRouter) {
        sendProgress("agents");

        // Build the pre-gen promise
        const preGenPromise = shouldRunPreGen
          ? (async () => {
              reply.raw.write(
                `data: ${JSON.stringify({ type: "agent_start", data: { phase: "pre_generation" } })}\n\n`,
              );
              if (isDebug) {
                const preGenAgents = pipelineAgents.filter(
                  (a) => a.phase === "pre_generation" && !EXCLUDED_FROM_PIPELINE.has(a.type),
                );
                app.log.debug(
                  "[debug] Pre-generation agents (%d): %s",
                  preGenAgents.length,
                  preGenAgents.map((a) => `${a.name} (${a.model})`).join(", "),
                );
              }
              const _tAgents = Date.now();
              const injections = await pipeline.preGenerate((t) => !EXCLUDED_FROM_PIPELINE.has(t));
              logger.debug(`[timing] Pre-gen agents: ${Date.now() - _tAgents}ms`);
              return injections;
            })()
          : Promise.resolve([] as AgentInjection[]);

        // Build the knowledge retrieval promise
        // Wrapped in try/catch so a KR failure (LLM error, parse error, etc.) never
        // aborts the whole generation — knowledge retrieval is an optional enhancement,
        // not a critical dependency. (Same pattern as the router promise below.)
        const krPromise = shouldRunKR
          ? (async () => {
              const _tKR = Date.now();
              try {
                reply.raw.write(
                  `data: ${JSON.stringify({ type: "agent_start", data: { phase: "pre_generation", agentType: "knowledge-retrieval" } })}\n\n`,
                );
                const krConfig = {
                  id: knowledgeRetrievalAgent!.id,
                  type: knowledgeRetrievalAgent!.type,
                  name: knowledgeRetrievalAgent!.name,
                  phase: knowledgeRetrievalAgent!.phase,
                  promptTemplate: knowledgeRetrievalAgent!.promptTemplate,
                  connectionId: knowledgeRetrievalAgent!.connectionId,
                  settings: knowledgeRetrievalAgent!.settings,
                };
                const sourceMaterial = agentContext.memory._knowledgeRetrievalMaterial as string;
                const krResult = await executeKnowledgeRetrieval(
                  krConfig,
                  agentContext,
                  knowledgeRetrievalAgent!.provider,
                  knowledgeRetrievalAgent!.model,
                  sourceMaterial,
                );
                sendAgentEvent(krResult);
                logger.debug(`[timing] Knowledge retrieval: ${Date.now() - _tKR}ms`);
                return krResult;
              } catch (err) {
                // Emit agent_error so the client closes the pending state opened by
                // agent_start above — without this the UI shows the agent as forever-
                // running. (Mirrors the Illustrator agent's failure protocol.)
                // Use trySendSseEvent rather than reply.raw.write so a disconnected
                // client doesn't turn this caught failure back into a rejected promise.
                logger.warn(err, "[knowledge-retrieval] failed — continuing generation without retrieved context");
                trySendSseEvent(reply, {
                  type: "agent_error",
                  data: {
                    agentType: "knowledge-retrieval",
                    error: err instanceof Error ? err.message : "Knowledge retrieval failed",
                  },
                });
                return null;
              }
            })()
          : Promise.resolve(null);

        // Build the knowledge router promise
        // Wrapped in try/catch so a router failure (LLM error, parse error, etc.)
        // never aborts the whole generation — routing is an optional enhancement,
        // not a critical dependency.
        const krRouterPromise = shouldRunRouter
          ? (async () => {
              const _tRouter = Date.now();
              try {
                reply.raw.write(
                  `data: ${JSON.stringify({ type: "agent_start", data: { phase: "pre_generation", agentType: "knowledge-router" } })}\n\n`,
                );
                const routerConfig = {
                  id: knowledgeRouterAgent!.id,
                  type: knowledgeRouterAgent!.type,
                  name: knowledgeRouterAgent!.name,
                  phase: knowledgeRouterAgent!.phase,
                  promptTemplate: knowledgeRouterAgent!.promptTemplate,
                  connectionId: knowledgeRouterAgent!.connectionId,
                  settings: knowledgeRouterAgent!.settings,
                };
                const routerResult = await executeKnowledgeRouter(
                  routerConfig,
                  agentContext,
                  knowledgeRouterAgent!.provider,
                  knowledgeRouterAgent!.model,
                  knowledgeRouterEntries,
                );
                sendAgentEvent(routerResult);
                logger.debug(`[timing] Knowledge router: ${Date.now() - _tRouter}ms`);
                return routerResult;
              } catch (err) {
                // Emit agent_error so the client closes the pending state opened by
                // agent_start above — without this the UI shows the agent as forever-
                // running. (Mirrors the Illustrator agent's failure protocol.)
                // Use trySendSseEvent rather than reply.raw.write so a disconnected
                // client doesn't turn this caught failure back into a rejected promise.
                logger.warn(err, "[knowledge-router] failed — continuing generation without routed context");
                trySendSseEvent(reply, {
                  type: "agent_error",
                  data: {
                    agentType: "knowledge-router",
                    error: err instanceof Error ? err.message : "Knowledge router failed",
                  },
                });
                return null;
              }
            })()
          : Promise.resolve(null);

        // Run all three in parallel
        const [preGenResult, krResult, routerResult] = await Promise.all([preGenPromise, krPromise, krRouterPromise]);
        contextInjections = preGenResult;

        // ── Failure gate: only block generation if a critical pre-gen agent failed ──
        // The secret-plot-driver shapes narrative direction — generating without
        // it would produce incoherent output. Other agents are enhancement-only.
        const preGenResults = pipeline.results.filter(
          (r) => r.agentType !== "knowledge-retrieval" && r.agentType !== "knowledge-router",
        );
        const latestUserMessageForPreGenRun = [...allChatMessages]
          .reverse()
          .find((message: any) => message.role === "user");
        const preGenRunMessageId = latestUserMessageForPreGenRun?.id ?? "";
        if (preGenRunMessageId) {
          for (const result of preGenResults) {
            if (builtInAgentTypes.has(result.agentType)) continue;
            try {
              await agentsStore.saveRun({
                agentConfigId: result.agentId,
                chatId: input.chatId,
                messageId: preGenRunMessageId,
                result,
              });
            } catch {
              // Non-critical — cadence should not block the generation pipeline.
            }
          }
        }
        const criticalFailed = preGenResults.filter((r) => !r.success && r.type === "secret_plot");
        const nonCriticalFailed = preGenResults.filter((r) => !r.success && r.type !== "secret_plot");
        if (criticalFailed.length > 0) {
          const failedNames = criticalFailed.map((r) => r.agentType).join(", ");
          const firstError = criticalFailed[0]!.error ?? "unknown error";
          logger.error(`[pre-gen] FATAL: critical agent(s) failed (${failedNames}) — aborting generation`);
          sendSseEvent(reply, {
            type: "error",
            data: `Critical pre-generation agent failed (${failedNames}): ${firstError}. Please try again.`,
          });
          return;
        }
        if (nonCriticalFailed.length > 0) {
          const failedNames = nonCriticalFailed.map((r) => r.agentType).join(", ");
          logger.warn(`[pre-gen] Non-critical agent(s) failed (${failedNames}) — continuing generation`);
        }

        // ── Secret Plot Driver: persist fresh state + build injection ──
        const plotResult = preGenResults.find((r) => r.type === "secret_plot");
        if (plotResult?.success && plotResult.data && typeof plotResult.data === "object") {
          const plotData = plotResult.data as Record<string, unknown>;
          const agentConfigId = secretPlotAgent?.id ?? plotResult.agentId;

          // Persist to agent memory so swipes/regens read from it
          try {
            if (plotData.overarchingArc) {
              await agentsStore.setMemory(agentConfigId, input.chatId, "overarchingArc", plotData.overarchingArc);
            }
            if (plotData.sceneDirections) {
              const allDirections = plotData.sceneDirections as Array<{ direction: string; fulfilled: boolean }>;
              const active = allDirections.filter((d) => !d.fulfilled);
              const justFulfilled = allDirections.filter((d) => d.fulfilled).map((d) => d.direction);
              await agentsStore.setMemory(agentConfigId, input.chatId, "sceneDirections", active);

              // Keep a rolling window of recently fulfilled directions so the agent doesn't repeat them
              if (justFulfilled.length > 0) {
                const mem = await agentsStore.getMemory(agentConfigId, input.chatId);
                const prev = (mem.recentlyFulfilled as string[] | undefined) ?? [];
                const merged = [...prev, ...justFulfilled].slice(-10); // keep last 10
                await agentsStore.setMemory(agentConfigId, input.chatId, "recentlyFulfilled", merged);
              }
            } else {
              // Agent didn't return new directions — clear stale ones so fulfilled
              // directions from the previous turn aren't re-injected into the prompt
              await agentsStore.setMemory(agentConfigId, input.chatId, "sceneDirections", []);
            }
            if (plotData.pacing) {
              await agentsStore.setMemory(agentConfigId, input.chatId, "pacing", plotData.pacing);
            }
            await agentsStore.setMemory(agentConfigId, input.chatId, "staleDetected", plotData.staleDetected ?? false);
            logger.debug(
              `[secret-plot-driver] Persisted pre-gen state — arc: ${plotData.overarchingArc ? "updated" : "unchanged"}, directions: ${Array.isArray(plotData.sceneDirections) ? (plotData.sceneDirections as any[]).filter((d: any) => !d.fulfilled).length : 0} active, pacing: ${plotData.pacing ?? "unknown"}`,
            );
          } catch (persistErr) {
            logger.error(persistErr, "[secret-plot-driver] Failed to persist state");
          }
        }

        // Inject pre-gen agent context at depth 0 (very bottom of prompt)
        if (contextInjections.length > 0) {
          const wrapped = formatAgentInjections(contextInjections, wrapFormat);
          finalMessages = injectAtDepth(finalMessages, [{ content: wrapped, role: "system", depth: 0 }]);
        }

        // Inject KR output into the prompt
        if (krResult?.success && krResult.data) {
          const krText =
            typeof krResult.data === "string" ? krResult.data : ((krResult.data as { text?: string })?.text ?? "");
          if (krText) {
            appendSeparateAgentInjection("knowledge-retrieval", krText);
            contextInjections.push({ agentType: "knowledge-retrieval", text: krText });
          }
        }

        // Inject Router output into the prompt
        if (routerResult?.success && routerResult.data) {
          const routerText =
            typeof routerResult.data === "string"
              ? routerResult.data
              : ((routerResult.data as { text?: string })?.text ?? "");
          if (routerText) {
            appendSeparateAgentInjection("knowledge-router", routerText);
            contextInjections.push({ agentType: "knowledge-router", text: routerText });
          }
        }
      } else if (input.regenerateMessageId) {
        // Regeneration — try to reuse cached context injections from the original generation.
        // This must run regardless of whether `hasPreGenAgents` is true, because the cached
        // injections may have come from agents in `EXCLUDED_FROM_PIPELINE` (knowledge-retrieval,
        // knowledge-router) — which `hasPreGenAgents` excludes. Without this, a chat whose
        // only pre-gen agent is KR or Router would silently drop the lore on every regen.
        const regenExtra = parseExtra(regenMsg?.extra);
        const rawCached = regenExtra.contextInjections as AgentInjection[] | string[] | undefined;

        // Backwards compat: old caches stored plain string[], upgrade to AgentInjection[]
        const cached: AgentInjection[] | undefined = rawCached?.length
          ? typeof rawCached[0] === "string"
            ? (rawCached as string[]).map((text) => ({ agentType: "prose-guardian", text }))
            : (rawCached as AgentInjection[])
          : undefined;

        if (cached && cached.length > 0) {
          contextInjections = cached;
          for (const inj of cached) {
            reply.raw.write(
              `data: ${JSON.stringify({
                type: "agent_result",
                data: {
                  agentType: inj.agentType,
                  agentName: inj.agentType,
                  resultType: "context_injection",
                  data: { text: inj.text },
                  success: true,
                  error: null,
                  durationMs: 0,
                  cached: true,
                },
              })}\n\n`,
            );
          }
        } else if (hasPreGenAgents) {
          const hasContextInjectionAgents = resolvedAgents.some(
            (a) => a.phase === "pre_generation" && !EXCLUDED_FROM_PIPELINE.has(a.type),
          );
          if (hasContextInjectionAgents) {
            reply.raw.write(`data: ${JSON.stringify({ type: "agent_start", data: { phase: "pre_generation" } })}\n\n`);
            // On regens, exclude secret-plot-driver — it only triggers on new user messages
            contextInjections = await pipeline.preGenerate(
              (agentType) => !EXCLUDED_FROM_PIPELINE.has(agentType) && agentType !== "secret-plot-driver",
            );

            // Failure gate — same as the new-message path
            const regenPreGenResults = pipeline.results.filter(
              (r) =>
                r.agentType !== "knowledge-retrieval" &&
                r.agentType !== "knowledge-router" &&
                r.agentType !== "secret-plot-driver",
            );
            const failedRegen = regenPreGenResults.filter((r) => !r.success);
            if (failedRegen.length > 0) {
              const failedNames = failedRegen.map((r) => r.agentType).join(", ");
              const firstError = failedRegen[0]!.error ?? "unknown error";
              logger.error(
                `[pre-gen] FATAL: ${failedRegen.length} agent(s) failed on regen (${failedNames}) — aborting generation`,
              );
              sendSseEvent(reply, {
                type: "error",
                data: `Pre-generation agent${failedRegen.length > 1 ? "s" : ""} failed (${failedNames}): ${firstError}. Please try again.`,
              });
              return;
            }
          }
        }

        // Split cached injections by injection placement, mirroring the fresh-generation path:
        //   - Pipeline agents (prose-guardian, director, etc.) inject at depth 0 as system context.
        //   - Separate-injection agents (knowledge-retrieval, knowledge-router) append to the
        //     last user message wrapped in their own tags.
        // Without this split, KR/Router cached output would be replayed in the wrong prompt
        // position with different wrapping than the original generation, subtly changing the
        // model's behavior on regenerate/swipe.
        const cachedPipelineInjections = contextInjections.filter(
          (inj) => !SEPARATE_INJECTION_AGENTS.has(inj.agentType),
        );
        const cachedSeparateInjections = contextInjections.filter((inj) =>
          SEPARATE_INJECTION_AGENTS.has(inj.agentType),
        );

        if (cachedPipelineInjections.length > 0) {
          const wrapped = formatAgentInjections(cachedPipelineInjections, wrapFormat);
          finalMessages = injectAtDepth(finalMessages, [{ content: wrapped, role: "system", depth: 0 }]);
        }

        for (const inj of cachedSeparateInjections) {
          appendSeparateAgentInjection(inj.agentType as "knowledge-retrieval" | "knowledge-router", inj.text);
        }
      }

      // ────────────────────────────────────────
      // Secret Plot Driver: inject arc + directions at correct prompt positions
      // Arc → after persona section (before first user/assistant message)
      // Directions → inside the <context> tracker block
      // ────────────────────────────────────────
      if (secretPlotAgent) {
        try {
          const plotMem = await agentsStore.getMemory(secretPlotAgent.id, input.chatId);
          const arcRaw = plotMem.overarchingArc as Record<string, unknown> | string | undefined;
          const sceneDirections = plotMem.sceneDirections as
            | Array<{ direction: string; fulfilled?: boolean }>
            | undefined;

          // Inject overarching arc into the prompt
          if (arcRaw) {
            // The arc is stored as an object {description, protagonistArc, completed}
            const arcLines: string[] = [];
            if (typeof arcRaw === "object" && arcRaw !== null) {
              if (arcRaw.description) arcLines.push(String(arcRaw.description));
              if (arcRaw.protagonistArc) arcLines.push(`Protagonist arc: ${arcRaw.protagonistArc}`);
            } else {
              arcLines.push(String(arcRaw));
            }
            if (arcLines.length > 0) {
              const arcBlock = wrapContent(arcLines.join("\n"), "overarching_arc", wrapFormat);

              // Strategy: try to inject inside an existing <lore> section (after </persona>),
              // then fall back to appending to the last system message before the chat.
              let injected = false;

              if (wrapFormat === "xml") {
                // Look for a system message containing <lore>…</lore>
                for (let i = 0; i < finalMessages.length; i++) {
                  const msg = finalMessages[i]!;
                  if (msg.role !== "system") continue;
                  if (!msg.content.includes("<lore>")) continue;

                  // Prefer inserting after </persona> inside <lore>
                  // Detect indentation from the </persona> line
                  const personaMatch = msg.content.match(/^([ \t]*)<\/persona>/m);
                  const indent = personaMatch?.[1] ?? "    ";
                  const indentedArc = arcBlock.replace(/\n/g, "\n" + indent);
                  if (msg.content.includes("</persona>")) {
                    finalMessages[i] = {
                      ...msg,
                      content: msg.content.replace("</persona>", `</persona>\n${indent}${indentedArc}`),
                    };
                  } else {
                    // No persona block — insert before </lore>
                    const loreMatch = msg.content.match(/^([ \t]*)<\/lore>/m);
                    const loreIndent = loreMatch?.[1] ?? "";
                    const innerIndent = loreIndent + "    ";
                    const indentedArcLore = arcBlock.replace(/\n/g, "\n" + innerIndent);
                    finalMessages[i] = {
                      ...msg,
                      content: msg.content.replace("</lore>", `${innerIndent}${indentedArcLore}\n${loreIndent}</lore>`),
                    };
                  }
                  injected = true;
                  break;
                }
              } else if (wrapFormat === "markdown") {
                // Look for a system message containing a # Lore heading
                for (let i = 0; i < finalMessages.length; i++) {
                  const msg = finalMessages[i]!;
                  if (msg.role !== "system") continue;
                  if (!msg.content.includes("# Lore")) continue;
                  finalMessages[i] = { ...msg, content: msg.content + "\n" + arcBlock };
                  injected = true;
                  break;
                }
              }

              // Fallback: append to the last system message before the chat
              if (!injected) {
                const firstChatIdx = finalMessages.findIndex((m) => m.role === "user" || m.role === "assistant");
                const searchEnd = firstChatIdx >= 0 ? firstChatIdx : finalMessages.length;
                let lastSysIdx = -1;
                for (let i = searchEnd - 1; i >= 0; i--) {
                  if (finalMessages[i]!.role === "system") {
                    lastSysIdx = i;
                    break;
                  }
                }
                if (lastSysIdx >= 0) {
                  const sysMsg = finalMessages[lastSysIdx]!;
                  finalMessages[lastSysIdx] = { ...sysMsg, content: sysMsg.content + "\n" + arcBlock };
                } else {
                  const insertAt = firstChatIdx >= 0 ? firstChatIdx : finalMessages.length;
                  finalMessages.splice(insertAt, 0, { role: "system", content: arcBlock });
                }
              }
            }
          }

          // Inject scene directions into the tracker block
          const activeDirections = sceneDirections?.filter((d) => !d.fulfilled);
          if (activeDirections && activeDirections.length > 0) {
            const dirLines = activeDirections.map((d) => `- ${d.direction}`).join("\n");
            const dirBlock = wrapContent(dirLines, "scene_directions", wrapFormat);

            if (wrapFormat === "xml") {
              const ctxIdx = finalMessages.findIndex((m) => m.role === "system" && m.content.includes("<context>"));
              if (ctxIdx >= 0) {
                const ctxMsg = finalMessages[ctxIdx]!;
                finalMessages[ctxIdx] = {
                  ...ctxMsg,
                  content: ctxMsg.content.replace("</context>", `    ${dirBlock.replace(/\n/g, "\n    ")}\n</context>`),
                };
              } else {
                const contextBlock = `<context>\n    ${dirBlock.replace(/\n/g, "\n    ")}\n</context>`;
                const lastUserIdx = findLastIndex(finalMessages, "user");
                finalMessages.splice(lastUserIdx >= 0 ? lastUserIdx : finalMessages.length, 0, {
                  role: "system",
                  content: contextBlock,
                });
              }
            } else if (wrapFormat === "markdown") {
              const ctxIdx = finalMessages.findIndex((m) => m.role === "system" && m.content.includes("# Context"));
              if (ctxIdx >= 0) {
                const ctxMsg = finalMessages[ctxIdx]!;
                finalMessages[ctxIdx] = { ...ctxMsg, content: ctxMsg.content + "\n" + dirBlock };
              } else {
                const contextBlock = `# Context\n${dirBlock}`;
                const lastUserIdx = findLastIndex(finalMessages, "user");
                finalMessages.splice(lastUserIdx >= 0 ? lastUserIdx : finalMessages.length, 0, {
                  role: "system",
                  content: contextBlock,
                });
              }
            } else {
              const lastUserIdx = findLastIndex(finalMessages, "user");
              finalMessages.splice(lastUserIdx >= 0 ? lastUserIdx : finalMessages.length, 0, {
                role: "system",
                content: dirBlock,
              });
            }
          }
        } catch (plotInjectErr) {
          logger.error(plotInjectErr, "[secret-plot-driver] Failed to inject arc/directions");
        }
      }

      // ────────────────────────────────────────
      // Static injection: Immersive HTML agent
      // ────────────────────────────────────────
      if (resolvedAgents.some((a) => a.type === "html")) {
        const htmlAgent = resolvedAgents.find((a) => a.type === "html")!;
        const { getDefaultAgentPrompt } = await import("@marinara-engine/shared");
        const htmlPrompt = (htmlAgent.promptTemplate || getDefaultAgentPrompt("html")).trim();
        if (htmlPrompt) {
          const htmlBlock = wrapFormat === "markdown" ? `\n## Immersive HTML\n${htmlPrompt}` : htmlPrompt;

          // Try to inject into <output_format> section
          let injected = false;
          for (let i = 0; i < finalMessages.length; i++) {
            const msg = finalMessages[i]!;
            if (msg.content.includes("</output_format>")) {
              finalMessages[i] = {
                ...msg,
                content: msg.content.replace("</output_format>", "    " + htmlBlock + "\n</output_format>"),
              };
              injected = true;
              break;
            }
          }
          if (!injected) {
            // Fallback: append to last user message
            const lastUserIdx = findLastIndex(finalMessages, "user");
            const idx = lastUserIdx >= 0 ? lastUserIdx : finalMessages.length - 1;
            const target = finalMessages[idx]!;
            finalMessages[idx] = {
              ...target,
              content:
                target.content +
                "\n\n" +
                (wrapFormat === "xml" ? `<immersive_html>\n${htmlPrompt}\n</immersive_html>` : htmlBlock),
            };
          }

          // Notify the UI that this static agent was injected
          reply.raw.write(
            `data: ${JSON.stringify({
              type: "agent_result",
              data: {
                agentType: "html",
                agentName: htmlAgent.name || "Immersive HTML",
                resultType: "context_injection",
                data: { text: "HTML formatting instructions injected into prompt" },
                success: true,
                error: null,
                durationMs: 0,
              },
            })}\n\n`,
          );
        }
      }

      // Notify UI if a chat summary was injected into the prompt (works with or without the agent)
      if (chatMeta.summary) {
        const chatSummaryCfg = enabledConfigs.find((c: any) => c.type === "chat-summary");
        reply.raw.write(
          `data: ${JSON.stringify({
            type: "agent_result",
            data: {
              agentType: "chat-summary",
              agentName: (chatSummaryCfg as any)?.name || "Chat Summary",
              resultType: "context_injection",
              data: { text: "Chat summary injected into prompt" },
              success: true,
              error: null,
              durationMs: 0,
            },
          })}\n\n`,
        );
      }

      // ── Early exit if client disconnected during knowledge retrieval / injection ──
      if (abortController.signal.aborted) return;

      // ── Main Generation Tool Configuration ──
      // Tool definitions (toolDefs) and custom tool metadata (customToolDefs)
      // were already resolved earlier for the agent pipeline and are reused here.

      // ── Impersonate: inject instruction to respond as the user's character ──
      if (input.impersonate) {
        const impersonateInstruction = buildImpersonateInstruction({
          customPrompt: chatMeta.impersonatePrompt,
          direction: input.userMessage,
          personaName,
          personaDescription,
        });
        finalMessages.push({ role: "user", content: impersonateInstruction });
      }

      if (assistantPrefill.trim()) {
        finalMessages.push({ role: "assistant", content: assistantPrefill });
        logger.debug(
          "[generate] Injected assistant prefill (%d chars) as final assistant message",
          assistantPrefill.length,
        );
      }

      let fullResponse = "";
      let fullThinking = "";
      let allResponses: string[] = [];

      // Callback for collecting thinking/reasoning from the model
      const onThinking = showThoughts
        ? (chunk: string) => {
            fullThinking += chunk;
            trySendSseEvent(reply, { type: "thinking", data: chunk });
          }
        : undefined;
      const captureReasoning = chatMode === "roleplay" && showThoughts;

      // Helper: write text content progressively as small SSE token chunks
      const writeContentChunked = (text: string) => {
        const CHUNK_SIZE = 6;
        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
          const chunk = text.slice(i, i + CHUNK_SIZE);
          fullResponse += chunk;
          trySendSseEvent(reply, { type: "token", data: chunk });
        }
      };

      const resolveMessageSpeakerName = (message: any): string => {
        if (message.role === "user") return personaName;
        if (message.characterId) return charInfo.find((c) => c.id === message.characterId)?.name ?? "Character";
        return chatMode === "conversation" ? "another group member" : "the narrator";
      };

      const latestVisibleSenderOtherThan = (targetCharId: string): string | null => {
        for (let i = chatMessages.length - 1; i >= 0; i--) {
          const message = chatMessages[i]!;
          if (message.role !== "user" && message.role !== "assistant") continue;
          if (message.role === "assistant" && message.characterId === targetCharId) continue;
          return resolveMessageSpeakerName(message);
        }
        return null;
      };

      const findLastAssistantCharacterId = (): string | null => {
        for (let i = chatMessages.length - 1; i >= 0; i--) {
          const message = chatMessages[i]!;
          if (message.role === "assistant" && typeof message.characterId === "string" && message.characterId) {
            return message.characterId;
          }
        }
        return null;
      };

      const fallbackSmartGroupResponders = (): string[] => {
        const lastAssistantCharId = findLastAssistantCharacterId();
        if (!lastAssistantCharId || !characterIds.includes(lastAssistantCharId)) {
          return characterIds[0] ? [characterIds[0]] : [];
        }

        const lastIndex = characterIds.indexOf(lastAssistantCharId);
        for (let offset = 1; offset <= characterIds.length; offset++) {
          const candidate = characterIds[(lastIndex + offset) % characterIds.length];
          if (candidate && candidate !== lastAssistantCharId) return [candidate];
        }

        return characterIds[0] ? [characterIds[0]] : [];
      };

      const getExplicitlyMentionedCharacterIds = (): string[] => {
        const latestUserText =
          typeof input.userMessage === "string" && input.userMessage.trim()
            ? input.userMessage
            : String([...chatMessages].reverse().find((message: any) => message.role === "user")?.content ?? "");
        const requestedNames = new Set((input.mentionedCharacterNames ?? []).map((name: string) => name.toLowerCase()));

        return charInfo
          .filter((character) => {
            if (requestedNames.has(character.name.toLowerCase())) return true;
            const escaped = character.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return new RegExp(`@${escaped}\\b`, "i").test(latestUserText);
          })
          .map((character) => character.id);
      };

      const parseSmartGroupSelectionIds = (raw: string): string[] => {
        const cleaned = raw
          .trim()
          .replace(/```(?:json)?\s*/gi, "")
          .replace(/```/g, "");
        const first = cleaned.indexOf("{");
        const last = cleaned.lastIndexOf("}");
        if (first < 0 || last < first) return [];

        const parsed = JSON.parse(cleaned.slice(first, last + 1)) as Record<string, unknown>;
        const rawIds = Array.isArray(parsed.characterIds)
          ? parsed.characterIds
          : Array.isArray(parsed.characters)
            ? parsed.characters
            : [];
        const validIds = new Set(characterIds);
        const selected: string[] = [];

        for (const rawId of rawIds) {
          const id = String(rawId);
          if (validIds.has(id) && !selected.includes(id)) selected.push(id);
        }

        return selected;
      };

      const selectSmartGroupResponders = async (): Promise<string[]> => {
        const explicitMentionIds = getExplicitlyMentionedCharacterIds();
        if (explicitMentionIds.length > 0) return explicitMentionIds;

        const recentTranscript = chatMessages
          .slice(-16)
          .filter((message: any) => message.role === "user" || message.role === "assistant")
          .map((message: any) => {
            const speaker = resolveMessageSpeakerName(message);
            const content = stripConversationPromptTimestamps(String(message.content ?? ""))
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 900);
            return `${speaker}: ${content}`;
          })
          .filter(Boolean)
          .join("\n");

        const candidates = charInfo
          .map((character) =>
            [
              `- id: ${character.id}`,
              `  name: ${character.name}`,
              `  talkativeness: ${Math.round(character.talkativeness * 100)}%`,
              character.personality ? `  personality: ${character.personality.slice(0, 500)}` : null,
              character.description ? `  description: ${character.description.slice(0, 500)}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n\n");

        const selectionPrompt: ChatMessage[] = [
          {
            role: "system",
            content: [
              `You are a hidden response orchestrator for a roleplay group chat.`,
              `Choose which character or characters should respond next, based on the latest user message, recent scene context, relevance, personality, and who has spoken recently.`,
              `Usually choose exactly one character. Choose multiple only when multiple characters have a strong immediate reason to answer.`,
              `Do not always choose the first character. Avoid making the same character speak twice in a row unless the context clearly calls for it.`,
              `Return ONLY valid JSON with this schema: {"characterIds":["id"],"reason":"short explanation"}.`,
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `<persona>${personaName}</persona>`,
              `<candidates>`,
              candidates,
              `</candidates>`,
              `<recent_transcript>`,
              recentTranscript || "No recent transcript.",
              `</recent_transcript>`,
            ].join("\n"),
          },
        ];

        try {
          const result = await provider.chatComplete(selectionPrompt, {
            model: conn.model,
            temperature: 0.2,
            maxTokens: 512,
            maxContext: effectiveMaxContext,
            topP: 1,
            stream: false,
            signal: abortController.signal,
          });
          const selectedIds = parseSmartGroupSelectionIds(result.content ?? "");
          if (selectedIds.length > 0) {
            logger.debug(
              "[group-smart] selected responders for chat %s: %s",
              input.chatId,
              selectedIds.map((id) => charInfo.find((character) => character.id === id)?.name ?? id).join(", "),
            );
            return selectedIds;
          }
          logger.warn(
            { chatId: input.chatId, raw: (result.content ?? "").slice(0, 500) },
            "[group-smart] Selector returned no valid character IDs",
          );
        } catch (error) {
          if (abortController.signal.aborted) return [];
          logger.warn({ err: error, chatId: input.chatId }, "[group-smart] Selector failed, using fallback");
        }

        return fallbackSmartGroupResponders();
      };

      // ── Determine characters to generate for ──
      // Individual group mode: each character responds separately
      // Merged/single: one generation for the first (or mentioned) character
      const useIndividualLoop = isGroupChat && groupChatMode === "individual" && !input.regenerateMessageId; // regeneration always targets one message
      const regenGroupChatIndividual = isGroupChat && groupChatMode === "individual" && input.regenerateMessageId;
      const mentionedConversationCharacters =
        chatMode === "conversation" && isGroupChat && !input.impersonate
          ? charInfo.filter((character) =>
              (input.mentionedCharacterNames ?? []).some(
                (name: string) => name.toLowerCase() === character.name.toLowerCase(),
              ),
            )
          : [];

      // Manual mode with forCharacterId: only generate for the specified character
      // Sequential/smart: all characters respond
      const respondingCharIds = useIndividualLoop
        ? input.forCharacterId && characterIds.includes(input.forCharacterId)
          ? [input.forCharacterId]
          : groupResponseOrder === "manual"
            ? [] // manual mode without forCharacterId: no auto-generation
            : groupResponseOrder === "sequential"
              ? [...characterIds]
              : await selectSmartGroupResponders()
        : [characterIds[0] ?? null];

      /** Generate a single response for a given character and save it. */
      const generateForCharacter = async (
        targetCharId: string | null,
        messagesForGen: Array<{
          role: "system" | "user" | "assistant";
          content: string;
          contextKind?: "prompt" | "history" | "injection";
          images?: string[];
          providerMetadata?: Record<string, unknown>;
        }>,
      ): Promise<{
        savedMsg: Awaited<ReturnType<typeof chats.createMessage>>;
        response: string;
        commands: CharacterCommand[];
        oocMessages: string[];
        characterId: string | null;
      } | null> => {
        // Collapse 3+ consecutive blank lines in all messages to save tokens
        for (const m of messagesForGen) {
          m.content = m.content.replace(/\n([ \t]*\n){2,}/g, "\n\n");
        }

        const toProviderMessages = (
          promptMessages: Array<{
            role: "system" | "user" | "assistant";
            content: string;
            contextKind?: "prompt" | "history" | "injection";
            images?: string[];
            providerMetadata?: Record<string, unknown>;
          }>,
        ): ChatMessage[] =>
          promptMessages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.contextKind ? { contextKind: message.contextKind } : {}),
            ...(message.images?.length ? { images: message.images } : {}),
            ...(message.providerMetadata ? { providerMetadata: message.providerMetadata } : {}),
          }));

        const prepareProviderMessages = (messages: ChatMessage[]): ChatMessage[] => {
          // Convert mid-prompt system messages to user role after context fitting.
          // This keeps prompt/injection system blocks protected while trimming history,
          // then preserves provider alternation rules for the actual request.
          let pastLeadingSystem = false;
          const converted = messages.map((m) => {
            if (!pastLeadingSystem) {
              if (m.role !== "system") pastLeadingSystem = true;
              return m;
            }
            if (m.role === "system") return { ...m, role: "user" as const };
            return m;
          });
          return mergeAdjacentMessages(converted as any) as ChatMessage[];
        };

        let finalPromptSent: ChatMessage[] = [];
        let effectiveMaxTokensForSend = maxTokens;
        const fitPromptForSend = (candidateMessages: ChatMessage[]): ChatMessage[] => {
          const fit = fitMessagesToContext(
            candidateMessages,
            { maxContext: effectiveMaxContext, maxTokens, tools: toolDefs },
            connectionMaxContext,
          );
          finalPromptSent = fit.messages;
          effectiveMaxTokensForSend = fit.maxTokens ?? maxTokens;
          return fit.messages;
        };

        const initialProviderMessages = prepareProviderMessages(fitPromptForSend(toProviderMessages(messagesForGen)));
        finalPromptSent = initialProviderMessages;

        // Reset per-character accumulators
        fullResponse = "";
        fullThinking = "";
        let geminiResponseParts: unknown[] | null = null;
        let chatCompletionsReasoning: Record<string, unknown> | null = null;
        const rememberChatCompletionsReasoning = (metadata: Record<string, unknown>) => {
          chatCompletionsReasoning = readChatCompletionsReasoningMetadata(metadata) ?? metadata;
        };

        // Track timing and usage
        const genStartTime = Date.now();
        let usage: LLMUsage | undefined;
        let finishReason: string | undefined;

        // ── SSE keepalive: send periodic comments to prevent proxy timeouts ──
        // Reasoning models (e.g. GPT-5.4 with xhigh effort) may spend a long time
        // thinking before the first token arrives. Cloudflare and other reverse
        // proxies often kill idle connections after ~100s. Sending SSE comments
        // (`: keepalive`) keeps the connection alive without affecting the client.
        const keepaliveTimer = setInterval(() => {
          try {
            if (!reply.raw.destroyed) {
              reply.raw.write(": keepalive\n\n");
            }
          } catch {
            // Connection already closed — ignore
          }
        }, 15_000);

        try {
          // ── LOG_LEVEL=debug or Settings -> Advanced -> Debug mode: log full prompt to server console ──
          if (isDebug || requestDebug) {
            const effModel = conn.model.toLowerCase();
            const tempSuppressed =
              (conn.provider === "openai" || conn.provider === "openrouter") &&
              (/^(o1|o3|o4)/.test(effModel) || (effModel.startsWith("gpt-5") && !!resolvedEffort));
            const effTemp = tempSuppressed ? "N/A" : temperature;
            const effTopP = tempSuppressed ? "N/A" : topP;

            debugLog(
              "\n[debug] Prompt sent to model (%d messages):\n  Model: %s (%s)  Temp: %s  MaxTokens: %s  MaxContext: %s  TopP: %s  TopK: %s  EnableThinking: %s  ShowThoughts: %s  Effort: %s  Verbosity: %s  Stream: %s",
              initialProviderMessages.length,
              conn.model,
              conn.provider,
              effTemp,
              effectiveMaxTokensForSend,
              effectiveMaxContext ?? connectionMaxContext ?? "default",
              effTopP,
              topK || "default",
              enableThinking,
              showThoughts,
              resolvedEffort ?? "none",
              verbosity ?? "default",
              input.streaming,
            );
            for (const m of initialProviderMessages) {
              debugLog("  [%s] %s", m.role.toUpperCase(), m.content);
            }
          }

          if (enableChatTools && provider.chatComplete) {
            const MAX_TOOL_ROUNDS = 5;
            let loopMessages: ChatMessage[] = initialProviderMessages;
            // ── Seed encrypted reasoning cache from DB ──
            // OpenAI Responses API uses encrypted reasoning items for multi-turn continuity.
            // These must be replayed on each request. If the in-memory cache was lost (e.g. server
            // restart), recover from the last assistant message's persisted extra.
            // On regens/swipes: clear the cache so we re-derive from the filtered chatMessages
            // (which excludes the message being regenerated). Otherwise we'd replay the reasoning
            // from the discarded response instead of the turn before it.
            if (input.regenerateMessageId) {
              encryptedReasoningCache.delete(input.chatId);
            }
            if (!encryptedReasoningCache.has(input.chatId)) {
              for (let i = chatMessages.length - 1; i >= 0; i--) {
                const msg = chatMessages[i]!;
                if (msg.role === "assistant") {
                  const ex = parseExtra(msg.extra);
                  if (Array.isArray(ex.encryptedReasoning) && ex.encryptedReasoning.length > 0) {
                    encryptedReasoningCache.set(input.chatId, ex.encryptedReasoning);
                  }
                  break;
                }
              }
            }

            // Stream tokens in real-time via onToken callback.
            // Some providers (e.g. Gemini with thinking) return the entire response
            // in one chunk. Break large chunks into small pieces so the client sees
            // progressive streaming instead of the whole message appearing at once.
            const STREAM_CHUNK = 6;
            const onToken = (chunk: string) => {
              // If the request has been aborted, skip emitting any further tokens.
              if (abortController.signal.aborted) {
                return;
              }
              fullResponse += chunk;
              if (chunk.length <= STREAM_CHUNK) {
                reply.raw.write(`data: ${JSON.stringify({ type: "token", data: chunk })}\n\n`);
              } else {
                for (let i = 0; i < chunk.length; i += STREAM_CHUNK) {
                  reply.raw.write(
                    `data: ${JSON.stringify({ type: "token", data: chunk.slice(i, i + STREAM_CHUNK) })}\n\n`,
                  );
                }
              }
            };

            for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
              // Treat abort as a silent cancellation: stop the pipeline immediately.
              if (abortController.signal.aborted) {
                return null;
              }

              let result;
              try {
                loopMessages = fitPromptForSend(loopMessages);
                result = await provider.chatComplete(loopMessages, {
                  model: conn.model,
                  temperature,
                  maxTokens: effectiveMaxTokensForSend,
                  maxContext: effectiveMaxContext,
                  topP,
                  topK: topK || undefined,
                  frequencyPenalty: frequencyPenalty || undefined,
                  presencePenalty: presencePenalty || undefined,
                  tools: toolDefs,
                  enableCaching: conn.enableCaching === "true",
                  enableThinking,
                  captureReasoning,
                  reasoningEffort: resolvedEffort ?? undefined,
                  verbosity: verbosity ?? undefined,
                  customParameters,
                  onThinking,
                  onToken: input.streaming ? onToken : undefined,
                  openrouterProvider: conn.openrouterProvider ?? undefined,
                  signal: abortController.signal,
                  encryptedReasoningItems: encryptedReasoningCache.get(input.chatId),
                  onEncryptedReasoning: (items) => encryptedReasoningCache.set(input.chatId, items),
                  onChatCompletionsReasoning: rememberChatCompletionsReasoning,
                });
              } catch (err: any) {
                // If the error was caused by an abort, cancel silently and skip post-processing.
                if (abortController.signal.aborted || (err && err.name === "AbortError")) {
                  return null;
                }
                throw err;
              }

              // If abort was triggered during chat completion, exit before using the result.
              if (abortController.signal.aborted) {
                return null;
              }

              // If provider doesn't support onToken (fell back to non-streaming),
              // write the content conventionally
              if (result.content && !fullResponse.endsWith(result.content)) {
                writeContentChunked(result.content);
              }

              // Accumulate usage across tool rounds
              if (result.usage) {
                if (!usage) {
                  usage = { ...result.usage };
                } else {
                  usage.promptTokens += result.usage.promptTokens;
                  usage.completionTokens += result.usage.completionTokens;
                  usage.totalTokens += result.usage.totalTokens;
                  if (result.usage.cachedPromptTokens != null) {
                    usage.cachedPromptTokens = (usage.cachedPromptTokens ?? 0) + result.usage.cachedPromptTokens;
                  }
                  if (result.usage.cacheWritePromptTokens != null) {
                    usage.cacheWritePromptTokens =
                      (usage.cacheWritePromptTokens ?? 0) + result.usage.cacheWritePromptTokens;
                  }
                }
              }
              finishReason = result.finishReason;

              if (!result.toolCalls.length) break;

              loopMessages.push({
                role: "assistant",
                content: result.content ?? "",
                tool_calls: result.toolCalls,
                ...(result.providerMetadata ? { providerMetadata: result.providerMetadata } : {}),
              });

              const permittedToolCalls = result.toolCalls.filter((call) =>
                chatResolvedToolNames.has(call.function.name),
              );
              const deniedToolResults = result.toolCalls
                .filter((call) => !chatResolvedToolNames.has(call.function.name))
                .map((call) => ({
                  toolCallId: call.id,
                  name: call.function.name,
                  result: JSON.stringify({
                    error: `Tool not allowed in this context: ${call.function.name}`,
                    allowed: Array.from(chatResolvedToolNames),
                  }),
                  success: false,
                }));

              const executedToolResults = await executeToolCalls(permittedToolCalls, {
                ...baseToolExecutionContext,
              });
              const toolResultsById = new Map(
                [...executedToolResults, ...deniedToolResults].map((result) => [result.toolCallId, result]),
              );
              const toolResults = result.toolCalls
                .map((call) => toolResultsById.get(call.id))
                .filter((toolResult): toolResult is NonNullable<typeof toolResult> => toolResult != null);

              for (const tr of toolResults) {
                reply.raw.write(
                  `data: ${JSON.stringify({
                    type: "tool_result",
                    data: { name: tr.name, result: tr.result, success: tr.success },
                  })}\n\n`,
                );

                // Persist update_game_state tool calls to the game state DB
                if (tr.name === "update_game_state" && tr.success) {
                  try {
                    const parsed = JSON.parse(tr.result);
                    if (parsed.applied && parsed.update) {
                      const latest = await gameStateStore.getLatest(input.chatId);
                      if (latest) {
                        const u = parsed.update;
                        const updates: Record<string, unknown> = {};
                        if (u.type === "location_change") updates.location = u.value;
                        if (u.type === "time_advance") updates.time = u.value;
                        if (Object.keys(updates).length > 0) {
                          await gameStateStore.updateLatest(input.chatId, updates);
                        }
                        // Send game_state_patch so HUD updates live
                        logger.debug("[game_state_patch] tool update_game_state: %j", updates);
                        reply.raw.write(`data: ${JSON.stringify({ type: "game_state_patch", data: updates })}\n\n`);
                      }
                    }
                  } catch {
                    // Non-critical
                  }
                }
              }

              for (const tr of toolResults) {
                loopMessages.push({
                  role: "tool",
                  content: tr.result,
                  tool_call_id: tr.toolCallId,
                });
              }

              if (round === MAX_TOOL_ROUNDS - 1) {
                // Reset per-character accumulator for final round content
                const prevLen = fullResponse.length;
                loopMessages = fitPromptForSend(loopMessages);
                const finalResult = await provider.chatComplete(loopMessages, {
                  model: conn.model,
                  temperature,
                  maxTokens: effectiveMaxTokensForSend,
                  maxContext: effectiveMaxContext,
                  topP,
                  topK: topK || undefined,
                  frequencyPenalty: frequencyPenalty || undefined,
                  presencePenalty: presencePenalty || undefined,
                  enableCaching: conn.enableCaching === "true",
                  enableThinking,
                  captureReasoning,
                  reasoningEffort: resolvedEffort ?? undefined,
                  verbosity: verbosity ?? undefined,
                  customParameters,
                  onThinking,
                  onToken: input.streaming ? onToken : undefined,
                  openrouterProvider: conn.openrouterProvider ?? undefined,
                  signal: abortController.signal,
                  encryptedReasoningItems: encryptedReasoningCache.get(input.chatId),
                  onEncryptedReasoning: (items) => encryptedReasoningCache.set(input.chatId, items),
                  onChatCompletionsReasoning: rememberChatCompletionsReasoning,
                });
                if (finalResult.content && fullResponse.length === prevLen) {
                  writeContentChunked(finalResult.content);
                }
                if (finalResult.usage) {
                  if (!usage) {
                    usage = { ...finalResult.usage };
                  } else {
                    usage.promptTokens += finalResult.usage.promptTokens;
                    usage.completionTokens += finalResult.usage.completionTokens;
                    usage.totalTokens += finalResult.usage.totalTokens;
                    if (finalResult.usage.cachedPromptTokens != null) {
                      usage.cachedPromptTokens = (usage.cachedPromptTokens ?? 0) + finalResult.usage.cachedPromptTokens;
                    }
                    if (finalResult.usage.cacheWritePromptTokens != null) {
                      usage.cacheWritePromptTokens =
                        (usage.cacheWritePromptTokens ?? 0) + finalResult.usage.cacheWritePromptTokens;
                    }
                  }
                }
                finishReason = finalResult.finishReason;
              }
            }
          } else {
            const gen = provider.chat(initialProviderMessages, {
              model: conn.model,
              temperature,
              maxTokens: effectiveMaxTokensForSend,
              maxContext: effectiveMaxContext,
              topP,
              topK: topK || undefined,
              frequencyPenalty: frequencyPenalty || undefined,
              presencePenalty: presencePenalty || undefined,
              stream: input.streaming,
              enableCaching: conn.enableCaching === "true",
              enableThinking,
              captureReasoning,
              reasoningEffort: resolvedEffort ?? undefined,
              verbosity: verbosity ?? undefined,
              customParameters,
              openrouterProvider: conn.openrouterProvider ?? undefined,
              onThinking,
              onResponseParts: (parts) => {
                geminiResponseParts = parts;
              },
              signal: abortController.signal,
              encryptedReasoningItems: encryptedReasoningCache.get(input.chatId),
              onEncryptedReasoning: (items) => encryptedReasoningCache.set(input.chatId, items),
              onChatCompletionsReasoning: rememberChatCompletionsReasoning,
            });
            let result = await gen.next();
            while (!result.done) {
              fullResponse += result.value;
              // Break large chunks (e.g. Gemini non-streaming) into small pieces
              // so the client sees progressive streaming.
              const val = result.value;
              if (val.length <= 6) {
                reply.raw.write(`data: ${JSON.stringify({ type: "token", data: val })}\n\n`);
              } else {
                for (let i = 0; i < val.length; i += 6) {
                  reply.raw.write(`data: ${JSON.stringify({ type: "token", data: val.slice(i, i + 6) })}\n\n`);
                }
              }
              result = await gen.next();
            }
            // Generator return value contains usage
            if (result.value) usage = result.value;
          }

          const durationMs = Date.now() - genStartTime;

          if (input.debugMode && chatMode === "game") {
            logger.debug(
              "[generate/game/raw] chatId=%s characterId=%s chars=%d BEGIN",
              input.chatId,
              targetCharId ?? "gm",
              fullResponse.length,
            );
            logger.debug("[generate/game/raw] %s", fullResponse);
            logger.debug("[generate/game/raw] chatId=%s characterId=%s END", input.chatId, targetCharId ?? "gm");
          }

          // Some models inline reasoning blocks instead of using provider-native
          // thinking channels. Lift those blocks into message.extra.thinking.
          const inlineThinking = extractLeadingThinkingBlocks(fullResponse);
          if (inlineThinking.stripped) {
            if (inlineThinking.thinking) {
              fullThinking = fullThinking ? fullThinking + "\n\n" + inlineThinking.thinking : inlineThinking.thinking;
            }
            fullResponse = inlineThinking.content;
            reply.raw.write(`data: ${JSON.stringify({ type: "content_replace", data: fullResponse })}\n\n`);
          }

          // ── LOG_LEVEL=debug or Settings -> Advanced -> Debug mode: log full response + usage to server console ──
          if (isDebug || requestDebug) {
            debugLog("[debug] LLM response (%d chars, %dms):\n%s", fullResponse.length, durationMs, fullResponse);
            if (fullThinking) {
              debugLog("[debug] Thinking tokens (%d chars):\n%s", fullThinking.length, fullThinking);
            }
            if (usage) {
              const visibleCompletionTokens = getVisibleCompletionTokens(usage);
              debugLog(
                "[debug] Token usage — prompt: %s  completion: %s  visibleCompletion: %s  reasoning: %s  total: %s  cached: %s  cacheWrite: %s  finish: %s",
                usage.promptTokens ?? "N/A",
                usage.completionTokens ?? "N/A",
                visibleCompletionTokens ?? "N/A",
                usage.completionReasoningTokens ?? "N/A",
                usage.totalTokens ?? "N/A",
                usage.cachedPromptTokens ?? "N/A",
                usage.cacheWritePromptTokens ?? "N/A",
                finishReason ?? "N/A",
              );
            }
          }

          // ── Parse and strip character commands (Conversation mode only) ──
          let parsedCommands: CharacterCommand[] = [];
          let contentReplaced = false;
          if (chatMode === "conversation" && !input.impersonate) {
            const parsed = parseCharacterCommands(fullResponse);
            if (parsed.commands.length > 0) {
              parsedCommands = parsed.commands;
              fullResponse = parsed.cleanContent;
              contentReplaced = true;
              logger.info(
                "[generate] Parsed %d character command(s): %j",
                parsed.commands.length,
                parsed.commands.map((c) => c.type),
              );
            }
          }

          // ── Extract <ooc> tags from roleplay responses and post to connected conversation ──
          let oocMessages: string[] = [];
          if (chatMode === "roleplay" && !input.impersonate && chat.connectedChatId) {
            const OOC_RE = /<ooc>([\s\S]*?)<\/ooc>/gi;
            for (const match of fullResponse.matchAll(OOC_RE)) {
              const text = match[1]!.trim();
              if (text) oocMessages.push(text);
            }
            if (oocMessages.length > 0) {
              fullResponse = fullResponse
                .replace(OOC_RE, "")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
              contentReplaced = true;
              logger.info(
                `[generate] Extracted ${oocMessages.length} OOC message(s) for conversation ${chat.connectedChatId}`,
              );
            }
          }

          // ── Strip character name prefix in individual group mode ──
          // LLMs often prefix the response with the character name even when told not to.
          // Also strip any leftover <speaker> tags from individual mode responses.
          if (chatMode === "conversation" && isGroupChat && groupChatMode === "individual" && targetCharId) {
            const charRow = charInfo.find((c) => c.id === targetCharId);
            if (charRow) {
              const cName = charRow.name;
              // Strip <speaker="Name">...</speaker> wrapper if present
              const speakerWrap = new RegExp(
                `^\\s*<speaker="${cName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">[\\s\\S]*?<\\/speaker>\\s*$`,
                "i",
              );
              const speakerMatch = fullResponse.match(speakerWrap);
              if (speakerMatch) {
                fullResponse = fullResponse
                  .replace(/<speaker="[^"]*">/gi, "")
                  .replace(/<\/speaker>/gi, "")
                  .trim();
                contentReplaced = true;
              }
              // Strip plain name prefix: "Dottore\n", "Dottore:\n", "Dottore: "
              const namePrefix = new RegExp(`^\\s*${cName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*\n`, "i");
              if (namePrefix.test(fullResponse)) {
                fullResponse = fullResponse.replace(namePrefix, "");
                contentReplaced = true;
              }
            }
          }

          // ── Strip leaked timestamps from conversation mode responses ──
          // Models sometimes echo [HH:MM] timestamps despite instructions not to.
          // Strip them before storage to prevent compounding on future generations.
          if (chatMode === "conversation" && !input.impersonate) {
            const beforeStrip = fullResponse;
            fullResponse = fullResponse
              .replace(/^(\s*\[\d{1,2}[:.]\d{2}\]\s*)+/gm, "")
              .replace(/^(\s*\[\d{1,2}\.\d{1,2}\.\d{4}\]\s*)+/gm, "")
              .trim();
            if (fullResponse !== beforeStrip) {
              contentReplaced = true;
            }
          }

          if (contentReplaced) {
            reply.raw.write(`data: ${JSON.stringify({ type: "content_replace", data: fullResponse })}\n\n`);
          }

          // Guard: don't save empty responses — the model returned nothing useful.
          // Exception: if the model emitted character commands (e.g. [fetch:...]) with
          // no surrounding prose, treat the commands as the useful output. Skip saving
          // a blank assistant bubble but still return the commands so they execute.
          if (!fullResponse.trim() && !input.impersonate) {
            if (parsedCommands.length > 0) {
              logger.info(
                "[generate] Model emitted %d command(s) with no visible prose for chat %s; executing commands without saving a message",
                parsedCommands.length,
                input.chatId,
              );
              return { savedMsg: null, response: "", commands: parsedCommands, oocMessages, characterId: targetCharId };
            }
            logger.warn(`[generate] Empty response from model for chat ${input.chatId} (char: ${targetCharId})`);
            reply.raw.write(
              `data: ${JSON.stringify({ type: "error", data: "The AI returned an empty response. Try sending your message again." })}\n\n`,
            );
            return null;
          }

          // Save assistant message (or user message for impersonate)
          let savedMsg: any;
          if (input.regenerateMessageId) {
            savedMsg = await chats.addSwipe(input.regenerateMessageId, fullResponse);
            savedMsg = await chats.getMessage(input.regenerateMessageId);
          } else {
            savedMsg = await chats.createMessage({
              chatId: input.chatId,
              role: input.impersonate ? "user" : "assistant",
              characterId: input.impersonate ? null : targetCharId,
              content: fullResponse,
            });
          }
          if (chatMode === "conversation" && !input.impersonate && !input.regenerateMessageId) {
            recordAssistantActivity(input.chatId, targetCharId ?? undefined);
          }

          // Persist thinking/reasoning and generation info
          if (savedMsg?.id) {
            const extraUpdate: Record<string, unknown> = {
              generationInfo: {
                model: conn.model,
                provider: conn.provider,
                temperature: temperature ?? null,
                maxTokens: effectiveMaxTokensForSend ?? null,
                maxContext: effectiveMaxContext ?? connectionMaxContext ?? null,
                showThoughts: showThoughts ?? null,
                reasoningEffort: resolvedEffort ?? reasoningEffort ?? null,
                verbosity: verbosity ?? null,
                assistantPrefill: assistantPrefill || null,
                customParameters: Object.keys(customParameters).length > 0 ? customParameters : null,
                tokensPrompt: usage?.promptTokens ?? null,
                tokensCompletion: usage?.completionTokens ?? null,
                tokensVisibleCompletion: getVisibleCompletionTokens(usage) ?? null,
                tokensReasoning: usage?.completionReasoningTokens ?? null,
                tokensCompletionAudio: usage?.completionAudioTokens ?? null,
                tokensRejectedPrediction: usage?.rejectedPredictionTokens ?? null,
                tokensCachedPrompt: usage?.cachedPromptTokens ?? null,
                tokensCacheWritePrompt: usage?.cacheWritePromptTokens ?? null,
                durationMs,
                finishReason: finishReason ?? null,
              },
            };
            if (fullThinking) extraUpdate.thinking = fullThinking;
            else extraUpdate.thinking = null;
            // Store Gemini response parts (thought signatures + summaries) for multi-turn continuity
            if (geminiResponseParts) extraUpdate.geminiParts = geminiResponseParts;
            // Store Chat Completions reasoning fields for providers that require replay (DeepSeek/OpenRouter)
            if (chatCompletionsReasoning) extraUpdate.chatCompletionsReasoning = chatCompletionsReasoning;
            else extraUpdate.chatCompletionsReasoning = null;
            // Store OpenAI Responses API encrypted reasoning items for multi-turn continuity
            const cachedReasoning = encryptedReasoningCache.get(input.chatId);
            if (cachedReasoning?.length) extraUpdate.encryptedReasoning = cachedReasoning;
            else extraUpdate.encryptedReasoning = null;
            // Cache context injections (prose-guardian etc.) on the message so regens can reuse them
            if (!input.regenerateMessageId && contextInjections.length > 0) {
              extraUpdate.contextInjections = contextInjections;
            }
            // Cache the final prompt (what was actually sent to the model) for Peek Prompt
            extraUpdate.cachedPrompt = finalPromptSent.map((m) => ({ role: m.role, content: m.content }));
            await chats.updateMessageExtra(savedMsg.id, extraUpdate);
            // Also persist on the active swipe so switching swipes preserves per-swipe extras
            const refreshedMsg = await chats.getMessage(savedMsg.id);
            if (refreshedMsg) {
              await chats.updateSwipeExtra(savedMsg.id, refreshedMsg.activeSwipeIndex, extraUpdate);
            }

            sendSseEvent(reply, {
              type: "message_saved",
              data: refreshedMsg ?? savedMsg,
            });

            if (chatMode === "game" && !input.impersonate) {
              const mapUpdates = parseMapUpdateCommands(fullResponse);
              if (mapUpdates.length > 0) {
                try {
                  const freshChat = await chats.getById(input.chatId);
                  const freshMeta = freshChat ? (parseExtra(freshChat.metadata) as Record<string, unknown>) : chatMeta;
                  const originalMap = (freshMeta.gameMap as GameMap | null) ?? null;
                  let nextMap = originalMap;
                  let latestLocation: string | null = null;

                  for (const command of mapUpdates) {
                    const updatedMap = applyMapUpdateCommand(nextMap, command);
                    if (!updatedMap) continue;
                    nextMap = updatedMap;
                    latestLocation = command.newLocation;
                  }

                  if (nextMap && nextMap !== originalMap) {
                    const nextMeta = withActiveGameMapMeta(freshMeta, nextMap);
                    await chats.updateMetadata(input.chatId, nextMeta);
                    chatMeta.gameMap = nextMeta.gameMap;
                    chatMeta.gameMaps = nextMeta.gameMaps;
                    chatMeta.activeGameMapId = nextMeta.activeGameMapId;
                    sendSseEvent(reply, { type: "game_map_update", data: nextMeta.gameMap });

                    const persistedMsg = refreshedMsg ?? savedMsg;
                    if (latestLocation && persistedMsg?.id) {
                      const persistedSwipeIndex = persistedMsg.activeSwipeIndex ?? 0;
                      await gameStateStore.updateByMessage(persistedMsg.id, persistedSwipeIndex, input.chatId, {
                        location: latestLocation,
                      });
                      sendSseEvent(reply, { type: "game_state_patch", data: { location: latestLocation } });
                    }

                    logger.info(
                      "[generate/game/map_update] chatId=%s applied=%d location=%s",
                      input.chatId,
                      mapUpdates.length,
                      latestLocation ?? "",
                    );
                  }
                } catch (err) {
                  logger.warn(err, "[generate/game/map_update] Failed to apply map_update");
                }
              }
            }

            // Evict cachedPrompt from older messages to save storage (keep last 2 assistant msgs)
            const allMsgs = await chats.listMessages(input.chatId);
            const assistantMsgIds = allMsgs.filter((m) => m.role === "assistant").map((m) => m.id);
            const staleIds = assistantMsgIds.slice(0, -2);
            for (const staleId of staleIds) {
              const staleMsg = await chats.getMessage(staleId);
              if (!staleMsg) continue;
              const staleExtra =
                typeof staleMsg.extra === "string" ? JSON.parse(staleMsg.extra) : (staleMsg.extra ?? {});
              if (!staleExtra.cachedPrompt) continue;
              await chats.updateMessageExtra(staleId, { cachedPrompt: null });
              // Also clean swipes
              const swipes = await chats.getSwipes(staleId);
              for (const sw of swipes) {
                const swExtra = typeof sw.extra === "string" ? JSON.parse(sw.extra) : (sw.extra ?? {});
                if (swExtra.cachedPrompt) {
                  await chats.updateSwipeExtra(staleId, sw.index, { cachedPrompt: null });
                }
              }
            }
          }

          // Mirror character response to Discord (fire-and-forget, skip regens/swipes)
          if (discordWebhookUrl && fullResponse.trim() && !input.impersonate && !input.regenerateMessageId) {
            const charName =
              chatMode === "game"
                ? await resolveGameDiscordSpeakerName()
                : (charInfo.find((c) => c.id === targetCharId)?.name ?? "Character");
            postToDiscordWebhook(discordWebhookUrl, { content: fullResponse, username: charName });
          }

          return { savedMsg, response: fullResponse, commands: parsedCommands, oocMessages, characterId: targetCharId };
        } finally {
          clearInterval(keepaliveTimer);
        }
      };

      // ────────────────────────────────────────
      // Phase 2: Fire parallel agents alongside the main generation
      // ────────────────────────────────────────
      const hasParallelAgents = pipelineAgents.some((a) => a.phase === "parallel");
      let parallelPromise: Promise<AgentResult[]> | null = null;
      if (hasParallelAgents && !abortController.signal.aborted) {
        parallelPromise = pipeline.runParallel();
      }

      // ── Run generation ──
      let lastSavedMsg: any = null;
      const collectedCommands: Array<{ command: CharacterCommand; characterId: string | null; messageId: string }> = [];
      const collectedOocMessages: string[] = [];

      const normalizedGenerationGuide = typeof input.generationGuide === "string" ? input.generationGuide.trim() : "";
      const generationGuideInstruction = normalizedGenerationGuide
        ? `Take the following into special consideration for your next message: ${normalizedGenerationGuide}`
        : null;
      const filterManualTargetProfileBlocks = (messages: typeof finalMessages, targetCharId: string) => {
        if (groupResponseOrder !== "manual") return messages;
        const otherNames = charInfo.filter((c) => c.id !== targetCharId).map((c) => c.name);
        if (otherNames.length === 0) return messages;
        return messages.filter((message) => {
          if (message.role !== "system") return true;
          return !otherNames.some((name) => isStandaloneCharacterProfileBlock(message.content, name));
        });
      };
      const buildCharacterInstruction = (charId: string, charName: string) => {
        if (groupResponseOrder !== "manual") return `Respond ONLY as ${charName}.`;
        const latestOtherSender = latestVisibleSenderOtherThan(charId);
        return [
          `Respond ONLY as ${charName}.`,
          `This is an invisible manual trigger, not a visible message from ${personaName}. Do not mention being pinged, summoned, selected, or called by the user.`,
          latestOtherSender
            ? `Reply naturally to the latest visible sender other than yourself: ${latestOtherSender}.`
            : `Reply naturally to the ongoing group context.`,
          `If your own previous message is the most relevant last beat, continue naturally instead of answering the hidden trigger as if it came from ${personaName}.`,
          `You may address ${personaName} or another character if that is what the context calls for, but do not speak or act for them.`,
        ].join("\n");
      };

      if (useIndividualLoop) {
        // Individual group mode: generate one response per character
        sendProgress("generating");
        let runningMessages = [...finalMessages];

        if (generationGuideInstruction) {
          runningMessages.push({ role: "system", content: generationGuideInstruction });
        }

        for (let ci = 0; ci < respondingCharIds.length; ci++) {
          if (abortController.signal.aborted) break;
          const charId = respondingCharIds[ci]!;
          const charName = charInfo.find((c) => c.id === charId)?.name ?? "Character";

          // Tell the client which character is responding next
          reply.raw.write(
            `data: ${JSON.stringify({ type: "group_turn", data: { characterId: charId, characterName: charName, index: ci } })}\n\n`,
          );

          // Append "Respond ONLY as [name]" instruction
          const charInstruction = buildCharacterInstruction(charId, charName);
          const messagesWithInstruction = [...filterManualTargetProfileBlocks(runningMessages, charId)];
          // Add as a system message at the end (just before any trailing user message)
          messagesWithInstruction.push({ role: "system", content: charInstruction });

          const genResult = await generateForCharacter(charId, messagesWithInstruction);
          if (!genResult) break; // aborted
          lastSavedMsg = genResult.savedMsg;
          allResponses.push(genResult.response);
          for (const cmd of genResult.commands) {
            collectedCommands.push({ command: cmd, characterId: charId, messageId: genResult.savedMsg?.id ?? "" });
          }
          collectedOocMessages.push(...genResult.oocMessages);

          // Add this character's response to the running context for the next character
          runningMessages.push({ role: "assistant", content: genResult.response });
        }
      } else {
        // Single/merged: one generation
        sendProgress("generating");
        let targetCharId = characterIds[0] ?? null;
        const sentMessages = [...finalMessages];

        if (generationGuideInstruction) {
          sentMessages.push({ role: "system", content: generationGuideInstruction });
        }

        if (mentionedConversationCharacters.length > 0 && !regenGroupChatIndividual) {
          const mentionedNames = mentionedConversationCharacters.map((character) => character.name);

          if (mentionedConversationCharacters.length === 1) {
            const mentionedCharacter = mentionedConversationCharacters[0]!;
            targetCharId = mentionedCharacter.id;
            sentMessages.push({
              role: "system",
              content: `Respond ONLY as ${mentionedCharacter.name}. The user's latest message explicitly @mentions ${mentionedCharacter.name}, so no other character should reply to this turn.`,
            });
          } else {
            sentMessages.push({
              role: "system",
              content: `The user's latest message explicitly @mentions ${mentionedNames.join(", ")}. Only those mentioned characters may reply to this turn. Do not include any response lines from any other character.`,
            });
          }
        }

        if (regenGroupChatIndividual) {
          if (regenMsg?.chatId !== input.chatId)
            return reply.code(400).send({ error: "Regenerated message does not belong to this chat" });
          if (!regenMsg?.characterId)
            return reply.code(400).send({ error: "Regenerated message is missing character" });

          // Get character of regenerated message and append "Respond ONLY as [name]" instruction
          targetCharId = regenMsg?.characterId ?? null;
          const targetCharName = charInfo.find((c) => c.id === targetCharId)?.name ?? "Character";
          const charInstruction = targetCharId
            ? buildCharacterInstruction(targetCharId, targetCharName)
            : `Respond ONLY as ${targetCharName}.`;
          sentMessages.push({ role: "system", content: charInstruction });
        }

        const genResult = await generateForCharacter(targetCharId, sentMessages);
        if (genResult) {
          lastSavedMsg = genResult.savedMsg;
          for (const cmd of genResult.commands) {
            collectedCommands.push({
              command: cmd,
              characterId: genResult.characterId,
              messageId: genResult.savedMsg?.id ?? "",
            });
          }
          collectedOocMessages.push(...genResult.oocMessages);
        }
        allResponses.push(fullResponse);
      }

      // ────────────────────────────────────────
      // Collect parallel results + Phase 3: Post-processing agents
      // ────────────────────────────────────────
      // Await parallel agents that were started alongside the generation
      let parallelResults: AgentResult[] = [];
      if (parallelPromise) {
        try {
          parallelResults = await parallelPromise;
        } catch {
          // Non-critical — parallel agents may fail independently
        }
      }

      const hasPostProcessingAgents = resolvedAgents.some((a) => a.phase === "post_processing");
      const combinedResponse = allResponses.join("\n\n");
      let lorebookKeeperProcessedMessageId = "";
      // Illustration runs asynchronously so it doesn't block other agents
      let pendingIllustration: Promise<void> | null = null;
      const hasPostWork = hasPostProcessingAgents || parallelResults.length > 0;
      if (hasPostWork && combinedResponse && !abortController.signal.aborted) {
        reply.raw.write(`data: ${JSON.stringify({ type: "agent_start", data: { phase: "post_generation" } })}\n\n`);

        // LOG_LEVEL=debug: log post-processing agents
        if (isDebug) {
          const postAgents = pipelineAgents.filter((a) => a.phase === "post_processing");
          app.log.debug(
            "[debug] Post-generation agents (%d): %s",
            postAgents.length,
            postAgents.map((a) => `${a.name} (${a.model})`).join(", "),
          );
        }

        let postResults = hasPostProcessingAgents
          ? [...(await pipeline.postGenerate(combinedResponse)), ...parallelResults]
          : [...parallelResults];

        if (lorebookKeeperAgent) {
          const historicalLorebookTarget = getLorebookKeeperAutomaticTarget(
            lorebookKeeperMessages,
            lorebookKeeperSettings.readBehindMessages,
          );
          const lorebookKeeperContext = historicalLorebookTarget
            ? buildHistoricalLorebookKeeperContext(agentContext, lorebookKeeperMessages, historicalLorebookTarget.id)
            : { ...agentContext, mainResponse: combinedResponse };
          const processedMessageId = historicalLorebookTarget?.id ?? (lastSavedMsg as any)?.id ?? "";

          if (lorebookKeeperContext && processedMessageId) {
            lorebookKeeperProcessedMessageId = processedMessageId;
            const lorebookKeeperResult = await executeAgent(
              lorebookKeeperAgent,
              lorebookKeeperContext,
              lorebookKeeperAgent.provider,
              lorebookKeeperAgent.model,
            );
            sendAgentEvent(lorebookKeeperResult);
            postResults.push(lorebookKeeperResult);
          }
        }

        // ── Auto-retry failed agents once ──
        const failedResults = postResults.filter((r) => !r.success);
        if (failedResults.length > 0 && !abortController.signal.aborted) {
          const retryResults: AgentResult[] = [];
          for (const failed of failedResults) {
            const agentCfg = resolvedAgents.find((a) => a.type === failed.agentType && a.type !== "editor");
            if (!agentCfg) continue;
            try {
              const historicalLorebookTarget =
                failed.agentType === "lorebook-keeper"
                  ? getLorebookKeeperAutomaticTarget(lorebookKeeperMessages, lorebookKeeperSettings.readBehindMessages)
                  : null;
              const retryCtx: AgentContext = historicalLorebookTarget
                ? (buildHistoricalLorebookKeeperContext(
                    agentContext,
                    lorebookKeeperMessages,
                    historicalLorebookTarget.id,
                  ) ?? {
                    ...agentContext,
                    mainResponse: combinedResponse,
                  })
                : { ...agentContext, mainResponse: combinedResponse };
              const retried = await executeAgent(agentCfg, retryCtx, agentCfg.provider, agentCfg.model);
              sendAgentEvent(retried);
              retryResults.push(retried);
            } catch {
              retryResults.push(failed);
            }
          }
          // Replace original failed results with retry outcomes
          postResults = postResults.map((r) => {
            if (r.success) return r;
            const retried = retryResults.find((rr) => rr.agentType === r.agentType);
            return retried ?? r;
          });

          // Notify client about agents that still failed after retry
          // Use postResults (not retryResults) so agents skipped during retry (e.g. agentCfg not found) are included
          const stillFailed = postResults.filter((r) => !r.success);
          if (stillFailed.length > 0) {
            reply.raw.write(
              `data: ${JSON.stringify({
                type: "agents_retry_failed",
                data: stillFailed.map((r) => ({ agentType: r.agentType, error: r.error })),
              })}\n\n`,
            );
          }
        }

        // LOG_LEVEL=debug: log post-generation agent results
        if (isDebug) {
          for (const r of postResults) {
            app.log.debug(
              "[debug] Agent result: %s — %s (%dms, %d tokens)%s",
              r.agentType,
              r.success ? "OK" : "FAILED",
              r.durationMs,
              r.tokensUsed,
              r.error ? ` — ${r.error}` : "",
            );
          }
        }

        // Persist agent runs to DB + handle game state updates
        // Sort so game_state_update (world-state) is processed before dependent types
        // (character_tracker_update, persona_stats_update) that merge into the snapshot.
        const RESULT_ORDER: Record<string, number> = { game_state_update: 0 };
        const sortedResults = [...postResults].sort(
          (a, b) => (RESULT_ORDER[a.type] ?? 1) - (RESULT_ORDER[b.type] ?? 1),
        );
        const messageId = (lastSavedMsg as any)?.id ?? "";
        // Determine swipe index for this generation so ALL tracker agents target the
        // same (messageId, swipeIndex) snapshot that the world-state agent creates.
        let targetSwipeIndex = 0;
        if (input.regenerateMessageId && messageId) {
          const refreshedForSwipe = await chats.getMessage(messageId);
          if (refreshedForSwipe) targetSwipeIndex = refreshedForSwipe.activeSwipeIndex ?? 0;
        }
        for (const result of sortedResults) {
          const resultMessageId =
            result.agentType === "lorebook-keeper" && lorebookKeeperProcessedMessageId
              ? lorebookKeeperProcessedMessageId
              : messageId;
          try {
            await agentsStore.saveRun({
              agentConfigId: result.agentId,
              chatId: input.chatId,
              messageId: resultMessageId,
              result,
            });
          } catch {
            // Non-critical — don't fail the whole generation
          }

          // Validate background agent result — reject hallucinated filenames
          if (result.success && result.type === "background_change" && result.data && typeof result.data === "object") {
            const bgData = result.data as { chosen?: string | null };
            if (bgData.chosen) {
              const availableBgs = agentContext.memory._availableBackgrounds as Array<{ filename: string }> | undefined;
              if (availableBgs) {
                const valid = availableBgs.some((b) => b.filename === bgData.chosen);
                if (!valid) {
                  logger.warn(`[generate] Background agent chose "${bgData.chosen}" which doesn't exist — rejecting`);
                  bgData.chosen = null;
                }
              }
            }
            // Persist the validated background to chat metadata so it restores on reload
            if (bgData.chosen) {
              try {
                const freshChat = await chats.getById(input.chatId);
                if (freshChat) {
                  const freshMeta = parseExtra(freshChat.metadata);
                  await chats.updateMetadata(input.chatId, { ...freshMeta, background: bgData.chosen });
                }
              } catch {
                /* non-critical */
              }
            }
          }

          // Validate expression agent results — reject hallucinated expressions and unknown characters
          if (result.success && result.type === "sprite_change" && result.data && typeof result.data === "object") {
            const spriteData = result.data as { expressions?: Array<{ characterId: string; expression: string }> };
            const availableSprites = agentContext.memory._availableSprites as
              | Array<{ characterId: string; characterName: string; expressions: string[] }>
              | undefined;
            if (spriteData.expressions && availableSprites) {
              spriteData.expressions = spriteData.expressions.filter((entry) => {
                let charSprites = availableSprites.find((s) => s.characterId === entry.characterId);
                // Fallback: match by name if the LLM hallucinated a slug or name instead of the real ID
                if (!charSprites) {
                  const entryLower = entry.characterId.toLowerCase().replace(/[^a-z0-9]/g, "");
                  charSprites = availableSprites.find((s) => {
                    const nameLower = s.characterName.toLowerCase().replace(/[^a-z0-9]/g, "");
                    return nameLower === entryLower || nameLower.includes(entryLower) || entryLower.includes(nameLower);
                  });
                  if (charSprites) {
                    logger.warn(
                      `[generate] Expression agent used "${entry.characterId}" — resolved to ${charSprites.characterName} (${charSprites.characterId})`,
                    );
                    entry.characterId = charSprites.characterId;
                  }
                }
                if (!charSprites) {
                  logger.warn(
                    `[generate] Expression agent returned unknown character "${entry.characterId}" — removing`,
                  );
                  return false;
                }
                // Case-insensitive match against available sprite names
                const exprLower = entry.expression.toLowerCase();
                const exactMatch = charSprites.expressions.find((e) => e.toLowerCase() === exprLower);
                if (exactMatch) {
                  entry.expression = exactMatch;
                  return true;
                }
                // Try a substring/contains match as fallback (case-insensitive)
                const fallback = charSprites.expressions.find(
                  (e) => e.toLowerCase().includes(exprLower) || exprLower.includes(e.toLowerCase()),
                );
                if (fallback) {
                  logger.warn(
                    `[generate] Expression agent chose "${entry.expression}" — correcting to closest match "${fallback}"`,
                  );
                  entry.expression = fallback;
                } else {
                  logger.warn(
                    `[generate] Expression agent chose "${entry.expression}" for ${charSprites.characterName} which doesn't exist — removing`,
                  );
                  return false;
                }
                return true;
              });
            }
            // Persist validated expressions onto the message/swipe extra so they survive page refresh
            // and swipe switching. The chat-level metadata is also updated for backward compat.
            if (spriteData.expressions && spriteData.expressions.length > 0) {
              const exprMap: Record<string, string> = {};
              for (const e of spriteData.expressions) exprMap[e.characterId] = e.expression;
              try {
                await chats.updateMessageExtra(messageId, { spriteExpressions: exprMap });
                await chats.updateSwipeExtra(messageId, targetSwipeIndex, { spriteExpressions: exprMap });
              } catch {
                /* non-critical */
              }
            }
          }

          // Persist CYOA choices onto message/swipe extra so they survive page refresh
          if (result.success && result.type === "cyoa_choices" && result.data && typeof result.data === "object") {
            const cyoaData = result.data as { choices?: Array<{ label: string; text: string }> };
            if (cyoaData.choices && cyoaData.choices.length > 0) {
              try {
                await chats.updateMessageExtra(messageId, { cyoaChoices: cyoaData.choices });
                await chats.updateSwipeExtra(messageId, targetSwipeIndex, { cyoaChoices: cyoaData.choices });
              } catch {
                /* non-critical */
              }
            }
          }

          // Persist game state snapshots from world-state agent
          if (result.success && result.type === "game_state_update" && result.data && typeof result.data === "object") {
            try {
              const gs = result.data as Record<string, unknown>;

              // Manual overrides are one-shot: they live on the snapshot the user
              // edited and are visible to the agent as the prevSnap values, but they
              // are NOT carried forward to new snapshots.  The agent naturally reads
              // the edited prevSnap values and produces its own output.
              const prevSnap = await gameStateStore.getLatest(input.chatId);

              // Build the new snapshot from agent output, falling back to previous snapshot.
              const newDate = (gs.date as string) ?? (prevSnap?.date as string | null) ?? null;
              const newTime = (gs.time as string) ?? (prevSnap?.time as string | null) ?? null;
              const newLocation = (gs.location as string) ?? (prevSnap?.location as string | null) ?? null;
              const newWeather = (gs.weather as string) ?? (prevSnap?.weather as string | null) ?? null;
              const newTemperature = (gs.temperature as string) ?? (prevSnap?.temperature as string | null) ?? null;

              // The world-state agent ONLY produces date/time/location/weather/temperature
              // (and optionally recentEvents).  In batch mode the model often cross-
              // contaminates the world-state result with fields from other agent task
              // schemas (presentCharacters, personaStats, playerStats).  Even a partial
              // cross-contaminated playerStats (e.g. { status: "...", activeQuests: [] })
              // would clobber the real data and break downstream handlers (quest, persona-
              // stats) that read from this snapshot.  Therefore we ALWAYS carry forward
              // these fields from the previous snapshot — the dedicated tracker agents
              // (character-tracker, persona-stats, quest, custom-tracker) will update
              // them with authoritative data in their own handler blocks below.
              const snapshotChars = prevSnap?.presentCharacters
                ? typeof prevSnap.presentCharacters === "string"
                  ? JSON.parse(prevSnap.presentCharacters)
                  : prevSnap.presentCharacters
                : [];
              const snapshotPersonaStats = prevSnap?.personaStats
                ? typeof prevSnap.personaStats === "string"
                  ? JSON.parse(prevSnap.personaStats)
                  : prevSnap.personaStats
                : null;
              const snapshotPlayerStats = prevSnap?.playerStats
                ? typeof prevSnap.playerStats === "string"
                  ? JSON.parse(prevSnap.playerStats)
                  : prevSnap.playerStats
                : null;
              logger.info(
                `[generate] world-state snapshot: chars=${snapshotChars.length} (prev), personaStats=${snapshotPersonaStats ? "present" : "null"} (prev)`,
              );
              await gameStateStore.create(
                {
                  chatId: input.chatId,
                  messageId,
                  swipeIndex: targetSwipeIndex,
                  date: newDate,
                  time: newTime,
                  location: newLocation,
                  weather: newWeather,
                  temperature: newTemperature,
                  presentCharacters: snapshotChars,
                  recentEvents: (gs.recentEvents as string[]) ?? [],
                  playerStats: snapshotPlayerStats,
                  personaStats: snapshotPersonaStats,
                },
                null, // manual overrides are one-shot — never carry forward
              );
              // Send game state to client so HUD updates live
              // ONLY send the fields world-state actually produces (date/time/location/weather/temperature).
              // Do NOT spread the whole `gs` — in batch mode the model may cross-contaminate
              // fields like presentCharacters:[] from other agent tasks, clobbering the HUD.
              const worldStatePatch = {
                date: newDate,
                time: newTime,
                location: newLocation,
                weather: newWeather,
                temperature: newTemperature,
              };
              logger.debug("[game_state_patch] world-state: %j", worldStatePatch);
              reply.raw.write(`data: ${JSON.stringify({ type: "game_state_patch", data: worldStatePatch })}\n\n`);

              const existingGameMap = (chatMeta.gameMap as GameMap | null) ?? null;
              const syncedMeta = syncGameMapMetaPartyPosition(chatMeta, newLocation);
              const syncedGameMap = (syncedMeta.gameMap as GameMap | null) ?? null;
              if (syncedGameMap && syncedGameMap !== existingGameMap) {
                Object.assign(chatMeta, syncedMeta);
                // Re-fetch fresh metadata before write so we don't clobber concurrent updates
                // (e.g. /game/start flipping gameSessionStatus from "ready" to "active").
                const freshChat = await chats.getById(input.chatId);
                const freshMeta = freshChat ? (parseExtra(freshChat.metadata) as Record<string, unknown>) : chatMeta;
                await chats.updateMetadata(input.chatId, {
                  ...freshMeta,
                  gameMap: syncedMeta.gameMap,
                  gameMaps: syncedMeta.gameMaps,
                  activeGameMapId: syncedMeta.activeGameMapId,
                });
                sendSseEvent(reply, { type: "game_map_update", data: syncedGameMap });
              } else if (getGameMapsFromMeta(syncedMeta).length > 0) {
                Object.assign(chatMeta, syncedMeta);
              }

              // Auto-populate journal: location change
              const prevLocation = prevSnap?.location as string | null;
              if (newLocation && newLocation !== prevLocation) {
                updateJournal(app.db, input.chatId, (j) =>
                  addLocationEntry(j, newLocation, `Arrived at ${newLocation}${newWeather ? ` (${newWeather})` : ""}`),
                );
              }
            } catch {
              // Non-critical
            }
          }

          // Character Tracker agent → merge presentCharacters into latest game state
          if (
            result.success &&
            result.type === "character_tracker_update" &&
            result.data &&
            typeof result.data === "object"
          ) {
            try {
              const ctData = result.data as Record<string, unknown>;
              const chars = (ctData.presentCharacters as any[]) ?? [];

              // ── Enrich with avatar paths ──
              // 1. Match against known character records in this chat
              // 2. Fall back to stored NPC avatars (per-chat generated/uploaded)
              const NPC_AVATAR_DIR = join(DATA_DIR, "avatars", "npc");
              const storedNpcAvatarByName = new Map<string, string>();
              for (const npc of (chatMeta.gameNpcs as GameNpc[]) ?? []) {
                const name = typeof npc.name === "string" ? npc.name.trim().toLowerCase() : "";
                if (name && npc.avatarUrl) storedNpcAvatarByName.set(name, npc.avatarUrl);
              }

              for (const char of chars) {
                if (char.avatarPath) continue; // already set
                const name = (char.name as string) ?? "";
                // Try matching against the chat's character cards (case-insensitive)
                const matched = charInfo.find((c) => c.name.toLowerCase() === name.toLowerCase());
                if (matched?.avatarPath) {
                  char.avatarPath = matched.avatarPath;
                  continue;
                }
                const storedNpcAvatar = storedNpcAvatarByName.get(name.toLowerCase());
                if (storedNpcAvatar) {
                  char.avatarPath = storedNpcAvatar;
                  continue;
                }
                // Try loading a stored NPC avatar from disk
                const safeName = name
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/(^-|-$)/g, "");
                if (safeName) {
                  const npcAvatarPath = join(NPC_AVATAR_DIR, input.chatId, `${safeName}.png`);
                  if (existsSync(npcAvatarPath)) {
                    char.avatarPath = `/api/avatars/npc/${input.chatId}/${safeName}.png`;
                  }
                }
              }

              logger.info(
                `[generate] character-tracker: ${chars.length} characters to persist (msg=${messageId}, swipe=${targetSwipeIndex})`,
              );

              // ── Auto-generate NPC avatars if enabled ──
              const charTrackerAgent = resolvedAgents.find((a) => a.type === "character-tracker");
              const autoGenAvatars = !!charTrackerAgent?.settings?.autoGenerateAvatars;
              const npcImgConnId = (charTrackerAgent?.settings?.imageConnectionId as string) ?? null;
              if (autoGenAvatars && npcImgConnId) {
                const charsNeedingAvatars = chars.filter(
                  (c: any) => !c.avatarPath && (c.name as string) && (c.appearance as string),
                );
                if (charsNeedingAvatars.length > 0) {
                  // Fire-and-forget: generate avatars in background so we don't block
                  (async () => {
                    try {
                      const imgConnFull = await connections.getWithKey(npcImgConnId);
                      if (!imgConnFull) return;
                      const { generateImage } = await import("../services/image/image-generation.js");
                      const imgModel = imgConnFull.model || "";
                      const imgBaseUrl = imgConnFull.baseUrl || "https://image.pollinations.ai";
                      const imgApiKey = imgConnFull.apiKey || "";
                      const imgSource = (imgConnFull as any).imageGenerationSource || imgModel;
                      const imgServiceHint = imgConnFull.imageService || imgSource;
                      const imageDefaults = resolveConnectionImageDefaults(imgConnFull);
                      const imageSettings = await loadImageGenerationUserSettings(app.db);

                      for (const npc of charsNeedingAvatars) {
                        try {
                          const npcName = npc.name as string;
                          const appearance = (npc.appearance as string) || "";
                          const outfit = (npc.outfit as string) || "";
                          const prompt =
                            `Portrait of ${npcName}, ${appearance}${outfit ? `, wearing ${outfit}` : ""}. Character portrait, head and shoulders, detailed face, high quality`.slice(
                              0,
                              1000,
                            );

                          const imageResult = await generateImage(imgModel, imgBaseUrl, imgApiKey, imgServiceHint, {
                            prompt,
                            model: imgModel,
                            width: imageSettings.portrait.width,
                            height: imageSettings.portrait.height,
                            comfyWorkflow: imgConnFull.comfyuiWorkflow || undefined,
                            imageDefaults,
                          });

                          // Save to NPC avatars directory
                          const safeName = npcName
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/(^-|-$)/g, "");
                          const npcDir = join(NPC_AVATAR_DIR, input.chatId);
                          if (!existsSync(npcDir)) mkdirSync(npcDir, { recursive: true });
                          writeFileSync(join(npcDir, `${safeName}.png`), Buffer.from(imageResult.base64, "base64"));

                          // Update the character's avatarPath and stream to client
                          npc.avatarPath = `/api/avatars/npc/${input.chatId}/${safeName}.png`;
                          logger.info(`[character-tracker] Generated avatar for NPC "${npcName}"`);
                        } catch (err) {
                          logger.warn(err, '[character-tracker] Failed to generate avatar for "%s"', npc.name);
                        }
                      }

                      // Re-persist with avatar paths and notify client
                      await gameStateStore.updateByMessage(messageId, targetSwipeIndex, input.chatId, {
                        presentCharacters: chars,
                      });
                      try {
                        logger.debug("[game_state_patch] character-tracker (avatar update): %d chars", chars.length);
                        reply.raw.write(
                          `data: ${JSON.stringify({ type: "game_state_patch", data: { presentCharacters: chars } })}\n\n`,
                        );
                      } catch {
                        /* stream closed */
                      }
                    } catch (err) {
                      logger.warn(err, "[character-tracker] Avatar generation error");
                    }
                  })();
                }
              }

              // Read old characters before updating so we can detect newly-appearing NPCs
              const snapBeforeUpdate = await gameStateStore.getByMessage(messageId, targetSwipeIndex);
              const oldChars: any[] = snapBeforeUpdate?.presentCharacters
                ? typeof snapBeforeUpdate.presentCharacters === "string"
                  ? JSON.parse(snapBeforeUpdate.presentCharacters)
                  : snapBeforeUpdate.presentCharacters
                : [];

              const updated = await gameStateStore.updateByMessage(messageId, targetSwipeIndex, input.chatId, {
                presentCharacters: chars,
              });
              logger.info(
                `[generate] character-tracker: updateByMessage returned ${updated ? "ok" : "null (no snapshot)"}`,
              );
              // Merge into the game_state SSE event for the HUD
              try {
                logger.debug("[game_state_patch] character-tracker: %s", chars.map((c: any) => c.name ?? c).join(", "));
                reply.raw.write(
                  `data: ${JSON.stringify({ type: "game_state_patch", data: { presentCharacters: chars } })}\n\n`,
                );
              } catch {
                /* stream closed */
              }

              // Auto-populate journal: NPC encounters
              try {
                const prevNames = new Set(oldChars.map((c: any) => ((c.name as string) ?? "").toLowerCase()));
                for (const char of chars) {
                  const name = (char.name as string) ?? "";
                  if (!name || prevNames.has(name.toLowerCase())) continue;
                  // Skip player-character cards — only track NPCs
                  if (charInfo.some((c) => c.name.toLowerCase() === name.toLowerCase())) continue;
                  const appearance = (char.appearance as string) || "";
                  const mood = (char.mood as string) || "";
                  const npc: GameNpc = {
                    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                    name,
                    emoji: "👤",
                    description: appearance,
                    location: "",
                    reputation: 0,
                    met: true,
                    notes: [],
                  };
                  const interaction = mood ? `Encountered (${mood})` : "Encountered";
                  updateJournal(app.db, input.chatId, (j) => addNpcEntry(j, npc, interaction));
                }
              } catch {
                // Non-critical
              }
            } catch (err) {
              logger.error(err, "[generate] character-tracker persistence error");
            }
          }

          // Persona Stats agent → update personaStats on the latest game state snapshot
          if (
            result.success &&
            result.type === "persona_stats_update" &&
            result.data &&
            typeof result.data === "object"
          ) {
            try {
              const psData = result.data as Record<string, unknown>;
              const bars = (psData.stats as any[]) ?? [];
              const status = (psData.status as string) ?? "";
              const inventory = (psData.inventory as any[]) ?? [];

              // Ensure a snapshot exists for this (messageId, swipeIndex).
              // If world-state didn't create one, updateByMessage clones the
              // latest snapshot into a new row so we don't corrupt old data.
              let snap = await gameStateStore.getByMessage(messageId, targetSwipeIndex);
              if (!snap) {
                await gameStateStore.updateByMessage(messageId, targetSwipeIndex, input.chatId, {});
                snap = await gameStateStore.getByMessage(messageId, targetSwipeIndex);
              }
              if (snap) {
                const updates: Record<string, unknown> = {};
                if (bars.length > 0) updates.personaStats = JSON.stringify(bars);
                // Merge status + inventory into playerStats
                const existingPS = snap.playerStats
                  ? typeof snap.playerStats === "string"
                    ? JSON.parse(snap.playerStats)
                    : snap.playerStats
                  : { stats: [], attributes: null, skills: {}, inventory: [], activeQuests: [], status: "" };
                const mergedPS = { ...existingPS };
                if (status) mergedPS.status = status;
                if (inventory.length > 0) mergedPS.inventory = inventory;
                updates.playerStats = JSON.stringify(mergedPS);
                await app.db
                  .update(gameStateSnapshotsTable)
                  .set(updates)
                  .where(eq(gameStateSnapshotsTable.id, snap.id));
              }
              const patchData: Record<string, unknown> = {};
              if (bars.length > 0) patchData.personaStats = bars;
              if (status || inventory.length > 0) {
                patchData.playerStats = {
                  status: status || undefined,
                  inventory: inventory.length > 0 ? inventory : undefined,
                };
              }
              logger.debug("[game_state_patch] persona-stats: %j", patchData);
              reply.raw.write(`data: ${JSON.stringify({ type: "game_state_patch", data: patchData })}\n\n`);

              // Auto-populate journal: inventory changes
              if (inventory.length > 0) {
                const existingInv = snap?.playerStats
                  ? typeof snap.playerStats === "string"
                    ? ((JSON.parse(snap.playerStats) as any).inventory ?? [])
                    : ((snap.playerStats as any).inventory ?? [])
                  : [];
                const oldNames = new Set((existingInv as any[]).map((i: any) => i.name));
                for (const item of inventory) {
                  if (!oldNames.has(item.name)) {
                    updateJournal(app.db, input.chatId, (j) =>
                      addInventoryEntry(j, item.name, "acquired", item.quantity ?? 1),
                    );
                  }
                }
              }
            } catch {
              // Non-critical
            }
          }

          // Custom Tracker agent → merge custom fields into playerStats.customTrackerFields
          if (
            result.success &&
            result.type === "custom_tracker_update" &&
            result.data &&
            typeof result.data === "object"
          ) {
            try {
              const ctData = result.data as Record<string, unknown>;
              const fields = (ctData.fields as any[]) ?? [];
              if (fields.length > 0) {
                // Ensure a snapshot exists for this (messageId, swipeIndex)
                let snap = await gameStateStore.getByMessage(messageId, targetSwipeIndex);
                if (!snap) {
                  await gameStateStore.updateByMessage(messageId, targetSwipeIndex, input.chatId, {});
                  snap = await gameStateStore.getByMessage(messageId, targetSwipeIndex);
                }
                const existingPS = snap?.playerStats
                  ? typeof snap.playerStats === "string"
                    ? JSON.parse(snap.playerStats)
                    : snap.playerStats
                  : { stats: [], attributes: null, skills: {}, inventory: [], activeQuests: [], status: "" };
                const mergedPS = { ...existingPS, customTrackerFields: fields };
                if (snap) {
                  await app.db
                    .update(gameStateSnapshotsTable)
                    .set({ playerStats: JSON.stringify(mergedPS) })
                    .where(eq(gameStateSnapshotsTable.id, snap.id));
                }
                logger.debug("[game_state_patch] custom-tracker: %j", fields);
                reply.raw.write(
                  `data: ${JSON.stringify({ type: "game_state_patch", data: { playerStats: { customTrackerFields: fields } } })}\n\n`,
                );
              }
            } catch {
              // Non-critical
            }
          }

          // Quest Tracker agent → merge quest updates into playerStats.activeQuests
          if (result.success && result.type === "quest_update" && result.data && typeof result.data === "object") {
            try {
              const qData = result.data as Record<string, unknown>;
              const updates = (qData.updates as any[]) ?? [];
              logger.debug(
                "[generate] Quest agent result — updates: %d, data keys: %s %s",
                updates.length,
                Object.keys(qData).join(","),
                JSON.stringify(qData).slice(0, 500),
              );
              if (updates.length > 0) {
                // Ensure a snapshot exists for this (messageId, swipeIndex)
                let snap = await gameStateStore.getByMessage(messageId, targetSwipeIndex);
                if (!snap) {
                  await gameStateStore.updateByMessage(messageId, targetSwipeIndex, input.chatId, {});
                  snap = await gameStateStore.getByMessage(messageId, targetSwipeIndex);
                }
                const existingPS = snap?.playerStats
                  ? typeof snap.playerStats === "string"
                    ? JSON.parse(snap.playerStats)
                    : snap.playerStats
                  : { stats: [], attributes: null, skills: {}, inventory: [], activeQuests: [], status: "" };
                const originalQuests: any[] = existingPS.activeQuests ?? [];
                const quests: any[] = [...originalQuests];
                for (const u of updates) {
                  const idx = quests.findIndex((q: any) => q.name === u.questName);
                  if (u.action === "create" && idx === -1) {
                    quests.push({
                      questEntryId: u.questName,
                      name: u.questName,
                      currentStage: 0,
                      objectives: u.objectives ?? [],
                      completed: false,
                    });
                  } else if (idx !== -1) {
                    if (u.action === "update") {
                      if (u.objectives) quests[idx].objectives = u.objectives;
                    } else if (u.action === "complete") {
                      quests[idx].completed = true;
                      if (u.objectives) quests[idx].objectives = u.objectives;
                    } else if (u.action === "fail") {
                      quests.splice(idx, 1);
                    }
                  }
                }
                // Auto-remove quests that are fully completed (all objectives done)
                for (let i = quests.length - 1; i >= 0; i--) {
                  const q = quests[i];
                  if (
                    q.completed &&
                    Array.isArray(q.objectives) &&
                    q.objectives.length > 0 &&
                    q.objectives.every((o: any) => o.completed)
                  ) {
                    quests.splice(i, 1);
                  }
                }

                // Only persist + send if quests actually changed
                const changed = JSON.stringify(quests) !== JSON.stringify(originalQuests);
                if (changed) {
                  const mergedPS = { ...existingPS, activeQuests: quests };
                  if (snap) {
                    await app.db
                      .update(gameStateSnapshotsTable)
                      .set({ playerStats: JSON.stringify(mergedPS) })
                      .where(eq(gameStateSnapshotsTable.id, snap.id));
                  }
                  logger.debug("[game_state_patch] quests: %j", quests);
                  reply.raw.write(
                    `data: ${JSON.stringify({ type: "game_state_patch", data: { playerStats: { activeQuests: quests } } })}\n\n`,
                  );

                  // Auto-populate journal: quest updates
                  for (const u of updates) {
                    const questData = {
                      id: u.questName,
                      name: u.questName,
                      status: (u.action === "complete" ? "completed" : u.action === "fail" ? "failed" : "active") as
                        | "active"
                        | "completed"
                        | "failed",
                      description: u.description || u.questName,
                      objectives: (u.objectives ?? []).map((o: any) =>
                        typeof o === "string" ? o : o.text || o.description || "",
                      ),
                    };
                    updateJournal(app.db, input.chatId, (j) => upsertQuest(j, questData));
                  }
                }
              }
            } catch {
              // Non-critical
            }
          }

          // Lorebook Keeper agent → persist new/updated entries to the database
          if (result.success && result.type === "lorebook_update" && result.data && typeof result.data === "object") {
            try {
              const lkData = result.data as Record<string, unknown>;
              const updates = (lkData.updates as any[]) ?? [];
              if (updates.length > 0) {
                await persistLorebookKeeperUpdates({
                  lorebooksStore,
                  chatId: input.chatId,
                  chatName: chat.name,
                  preferredTargetLorebookId:
                    typeof agentContext.memory._lorebookKeeperTargetLorebookId === "string"
                      ? (agentContext.memory._lorebookKeeperTargetLorebookId as string)
                      : null,
                  writableLorebookIds: agentContext.writableLorebookIds,
                  updates,
                });
              }
            } catch {
              // Non-critical
            }
          }

          // Combat agent → persist encounterActive flag to chatMeta so we can
          // skip the combat agent on subsequent generations when no encounter is running.
          if (result.success && result.agentType === "combat" && result.data && typeof result.data === "object") {
            try {
              const combatData = result.data as Record<string, unknown>;
              const isActive = combatData.encounterActive === true;
              const freshChat = await chats.getById(input.chatId);
              if (freshChat) {
                const freshMeta = parseExtra(freshChat.metadata);
                await chats.updateMetadata(input.chatId, { ...freshMeta, encounterActive: isActive });
              }
            } catch {
              // Non-critical
            }
          }

          // Chat Summary agent → persist rolling summary to chat metadata
          if (result.success && result.type === "chat_summary" && result.data && typeof result.data === "object") {
            try {
              const csData = result.data as Record<string, unknown>;
              const newText = ((csData.summary as string) ?? "").trim();
              if (newText) {
                const updatedMeta = await updateChatMetadataForTools((currentMeta) => {
                  const existing = ((currentMeta.summary as string) ?? "").trim();
                  return { summary: existing ? `${existing}\n\n${newText}` : newText };
                });
                const combined = typeof updatedMeta.summary === "string" ? updatedMeta.summary : newText;
                reply.raw.write(`data: ${JSON.stringify({ type: "chat_summary", data: { summary: combined } })}\n\n`);
              }
            } catch {
              // Non-critical
            }
          }

          // ── Haptic agent: execute device commands from agent output ──
          if (result.success && result.type === "haptic_command" && result.data && typeof result.data === "object") {
            try {
              const hData = result.data as Record<string, unknown>;
              if (hData.parseError) {
                logger.warn(
                  "[haptic] Agent output could not be parsed as JSON: %s",
                  (hData.raw as string)?.slice(0, 200),
                );
              } else {
                const cmds = hData.commands as Array<Record<string, unknown>> | undefined;
                if (cmds && cmds.length > 0) {
                  const { hapticService } = await import("../services/haptic/buttplug-service.js");
                  if (hapticService.connected) {
                    for (const cmd of cmds) {
                      await hapticService.executeCommand({
                        deviceIndex: (cmd.deviceIndex as number | "all") ?? "all",
                        action: (cmd.action as string) ?? "vibrate",
                        intensity: typeof cmd.intensity === "number" ? cmd.intensity : 0.5,
                        duration: typeof cmd.duration === "number" ? cmd.duration : undefined,
                      } as any);
                    }
                    reply.raw.write(
                      `data: ${JSON.stringify({ type: "haptic_command", data: { commands: cmds, reasoning: hData.reasoning } })}\n\n`,
                    );
                    logger.info(`[haptic] Agent executed ${cmds.length} command(s): ${hData.reasoning ?? ""}`);
                  } else {
                    logger.warn(
                      `[haptic] Agent produced ${cmds.length} command(s) but Intiface Central is disconnected — commands dropped`,
                    );
                  }
                } else {
                  logger.debug(
                    `[haptic] Agent returned no commands (reasoning: ${(hData.reasoning as string) ?? "none"})`,
                  );
                }
              }
            } catch (hapErr) {
              logger.error(hapErr, "[haptic] Agent command execution failed");
            }
          }

          // ── ILLUSTRATOR HANDLER: generate image from agent prompt ──
          if (result.success && result.type === "image_prompt" && result.data && typeof result.data === "object") {
            const illData = result.data as Record<string, unknown>;
            const shouldGenerate = illData.shouldGenerate === true;
            const imagePrompt = ((illData.prompt as string) ?? "").trim();
            const negativePrompt = ((illData.negativePrompt as string) ?? "").trim();
            const style = ((illData.style as string) ?? "").trim();
            const illCharacters = Array.isArray(illData.characters) ? (illData.characters as string[]) : [];

            // Always log what the illustrator decided
            logger.debug(
              `[illustrator] shouldGenerate=${shouldGenerate}, reason="${(illData.reason as string) ?? "none"}", prompt="${imagePrompt.slice(0, 500) || "(empty)"}"${illData.parseError ? " [JSON PARSE ERROR — raw: " + ((illData.raw as string) ?? "").slice(0, 300) + "]" : ""}`,
            );

            if (shouldGenerate && imagePrompt) {
              // Resolve connections: text LLM = connectionId, image gen = settings.imageConnectionId
              const illustratorAgent = resolvedAgents.find((a) => a.id === result.agentId || a.type === "illustrator");
              let imgConnId = (illustratorAgent?.settings?.imageConnectionId as string) ?? null;
              if (!imgConnId) {
                const defaultImageConn = (await connections.list()).find(
                  (c) =>
                    c.provider === "image_generation" && (c.defaultForAgents === true || c.defaultForAgents === "true"),
                );
                imgConnId = defaultImageConn?.id ?? null;
              }
              if (imgConnId) {
                // Queue image generation to run after the result loop so it doesn't
                // block other agents (game state, trackers, consistency editor).
                pendingIllustration = (async () => {
                  try {
                    const imgConnFull = await connections.getWithKey(imgConnId);
                    if (!imgConnFull) throw new Error("Cannot resolve Illustrator agent connection");

                    const { generateImage, saveImageToDisk } = await import("../services/image/image-generation.js");
                    const { createGalleryStorage } = await import("../services/storage/gallery.storage.js");
                    const galleryStore = createGalleryStorage(app.db);

                    const imgModel = imgConnFull.model || "";
                    const imgBaseUrl = imgConnFull.baseUrl || "https://image.pollinations.ai";
                    const imgApiKey = imgConnFull.apiKey || "";
                    const imgSource = (imgConnFull as any).imageGenerationSource || imgModel;
                    const imgServiceHint = imgConnFull.imageService || imgSource;
                    const imageDefaults = resolveConnectionImageDefaults(imgConnFull);
                    const imageSettings = await loadImageGenerationUserSettings(app.db);

                    // Use per-chat selfie resolution if set; otherwise use the synced global selfie canvas.
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

                    // Prepend style to the prompt for better results
                    let fullPrompt = style ? `${style}, ${imagePrompt}` : imagePrompt;

                    logger.debug(`[illustrator] Starting image generation (${imgWidth}x${imgHeight})...`);

                    // Collect avatar reference images when the setting is enabled
                    const useAvatarRefs = illustratorAgent?.settings?.useAvatarReferences === true;
                    let illustratorRefImages: string[] | undefined;
                    if (useAvatarRefs) {
                      // Match character names from the Illustrator's output to character IDs.
                      // The LLM picks which characters are visible in the image via the "characters" field.
                      // If it didn't specify any, fall back to all characters in the chat.
                      const illCharLower = illCharacters.map((n) => n.toLowerCase().trim());
                      const relevantCharIds =
                        illCharLower.length > 0
                          ? charInfo
                              .filter((c) => illCharLower.some((n) => c.name.toLowerCase() === n))
                              .map((c) => c.id)
                          : characterIds;
                      const includePersona =
                        illCharLower.length === 0 || illCharLower.some((n) => n === personaName.toLowerCase());

                      // Collect avatar reference images for chosen characters + persona
                      const refImages: string[] = [];
                      for (const cid of relevantCharIds) {
                        const ci = charInfo.find((c) => c.id === cid);
                        if (!ci?.avatarPath) continue;
                        const b64 = readAvatarBase64(ci.avatarPath);
                        if (b64) refImages.push(b64);
                      }
                      if (includePersona && persona?.avatarPath) {
                        const personaB64 = readAvatarBase64(persona.avatarPath as string | null);
                        if (personaB64) refImages.push(personaB64);
                      }
                      if (refImages.length > 0) {
                        illustratorRefImages = refImages;
                        logger.debug(
                          `[illustrator] Sending ${refImages.length} avatar reference(s) for: ${illCharLower.length > 0 ? illCharacters.join(", ") : "all characters"}`,
                        );
                      }

                      // Build character appearance descriptions and augment the prompt
                      const appearanceLines: string[] = [];
                      for (const cid of relevantCharIds) {
                        const ci = charInfo.find((c) => c.id === cid);
                        if (!ci) continue;
                        const visual = ci.appearance || ci.description;
                        if (visual) appearanceLines.push(`${ci.name}: ${visual}`);
                      }
                      if (includePersona && persona) {
                        const pAppearance = (persona as any).appearance ?? "";
                        if (pAppearance) appearanceLines.push(`${personaName}: ${pAppearance}`);
                      }
                      if (appearanceLines.length > 0 || illustratorRefImages) {
                        const parts: string[] = [];
                        if (illustratorRefImages) {
                          parts.push(
                            "Reference images of the characters are attached. " +
                              "Use them closely to match each character's exact visual appearance — face, hair, eyes, build, etc.",
                          );
                        }
                        if (appearanceLines.length > 0) {
                          parts.push("Character visual descriptions:\n" + appearanceLines.join("\n"));
                        }
                        fullPrompt = fullPrompt + "\n\n" + parts.join("\n");
                      }
                    }

                    const imageResult = await generateImage(imgModel, imgBaseUrl, imgApiKey, imgServiceHint, {
                      prompt: fullPrompt,
                      negativePrompt: negativePrompt || undefined,
                      model: imgModel,
                      width: imgWidth,
                      height: imgHeight,
                      comfyWorkflow: imgConnFull.comfyuiWorkflow || undefined,
                      imageDefaults,
                      referenceImages: illustratorRefImages,
                    });

                    // Save to disk
                    const filePath = saveImageToDisk(input.chatId, imageResult.base64, imageResult.ext);

                    // Save to gallery
                    const galleryEntry = await galleryStore.create({
                      chatId: input.chatId,
                      filePath,
                      prompt: fullPrompt,
                      provider: "image_generation",
                      model: imgModel || "unknown",
                      width: imgWidth,
                      height: imgHeight,
                    });

                    // Attach to the assistant message + its specific swipe row
                    const filename = filePath.split("/").pop()!;
                    const imageUrl = `/api/gallery/file/${input.chatId}/${encodeURIComponent(filename)}`;
                    if (messageId) {
                      const attachment = {
                        type: "image",
                        url: imageUrl,
                        filename: `illustration.${imageResult.ext}`,
                      };

                      // Always persist to the swipe row so the attachment survives
                      // swipe switches even if the user has already navigated away.
                      const swipeRow = (await chats.getSwipes(messageId)).find(
                        (s: any) => s.index === targetSwipeIndex,
                      );
                      if (swipeRow) {
                        const swipeExtra =
                          typeof swipeRow.extra === "string" ? JSON.parse(swipeRow.extra) : (swipeRow.extra ?? {});
                        const swipeAtts = (swipeExtra.attachments as any[]) ?? [];
                        swipeAtts.push(attachment);
                        await chats.updateSwipeExtra(messageId, targetSwipeIndex, { attachments: swipeAtts });
                      }

                      // Also update the live message row if this swipe is still active,
                      // so the SSE illustration event is immediately visible.
                      const msgRow = await chats.getMessage(messageId);
                      if (msgRow && (msgRow.activeSwipeIndex ?? 0) === targetSwipeIndex) {
                        const msgExtra = msgRow.extra
                          ? typeof msgRow.extra === "string"
                            ? JSON.parse(msgRow.extra)
                            : msgRow.extra
                          : {};
                        const existingAttachments = (msgExtra.attachments as any[]) ?? [];
                        existingAttachments.push(attachment);
                        await chats.updateMessageExtra(messageId, { attachments: existingAttachments });
                      }
                    }

                    // Notify client
                    reply.raw.write(
                      `data: ${JSON.stringify({
                        type: "illustration",
                        data: {
                          messageId,
                          imageUrl,
                          prompt: fullPrompt,
                          reason: illData.reason,
                          galleryId: (galleryEntry as any)?.id,
                        },
                      })}\n\n`,
                    );
                    logger.info(
                      `[illustrator] Generated illustration: ${(illData.reason as string)?.slice(0, 80) ?? imagePrompt.slice(0, 80)}...`,
                    );
                  } catch (illErr) {
                    logger.error(illErr, "[illustrator] Image generation failed");
                    reply.raw.write(
                      `data: ${JSON.stringify({
                        type: "agent_error",
                        data: {
                          agentType: "illustrator",
                          error: `Image generation failed: ${illErr instanceof Error ? illErr.message : String(illErr)}`,
                        },
                      })}\n\n`,
                    );
                  }
                })();
              } else {
                logger.warn("[illustrator] Agent wants to generate but no image generation connection configured");
                reply.raw.write(
                  `data: ${JSON.stringify({
                    type: "agent_error",
                    data: {
                      agentType: "illustrator",
                      error:
                        "No image generation connection set on the Illustrator agent, and no default Illustrator image connection is configured. Go to Settings → Connections and mark an image generation connection as the default for Illustrator, or assign one directly in Settings → Agents → Illustrator.",
                    },
                  })}\n\n`,
                );
              }
            }
          }
        }

        // ── Text rewrite/editing agents: run after ALL other agents ──
        if (textRewriteAgents.length > 0 && messageId && !abortController.signal.aborted) {
          let currentResponseForRewrite = combinedResponse;

          for (const textRewriteAgent of textRewriteAgents) {
            if (abortController.signal.aborted) break;
            try {
              // Collect all successful agent outputs as a summary for rewrite agents.
              const agentSummary: Record<string, unknown> = {};
              for (const result of postResults) {
                if (result.success && result.data) {
                  agentSummary[result.agentType ?? result.type] = result.data;
                }
              }

              const editorContext: AgentContext = {
                ...agentContext,
                mainResponse: currentResponseForRewrite,
                memory: { ...agentContext.memory, _agentResults: agentSummary },
              };

              const editorResult = await executeAgent(
                textRewriteAgent,
                editorContext,
                textRewriteAgent.provider,
                textRewriteAgent.model,
              );
              sendAgentEvent(editorResult);

              try {
                await agentsStore.saveRun({
                  agentConfigId: editorResult.agentId,
                  chatId: input.chatId,
                  messageId,
                  result: editorResult,
                });
              } catch {
                /* Non-critical */
              }

              if (editorResult.success && editorResult.type === "text_rewrite" && editorResult.data) {
                const edData = editorResult.data as Record<string, unknown>;
                const editedText = (edData.editedText as string) ?? "";
                const changes = (edData.changes as Array<{ description: string }>) ?? [];
                if (editedText && changes.length > 0) {
                  currentResponseForRewrite = editedText;
                  await chats.updateMessageContent(messageId, editedText);
                  reply.raw.write(
                    `data: ${JSON.stringify({
                      type: "text_rewrite",
                      data: { editedText, changes },
                    })}\n\n`,
                  );
                }
              }
            } catch {
              // Non-critical — don't fail generation if a rewrite agent errors.
            }
          }
        }
      }

      // ────────────────────────────────────────
      // Character Command Execution (Conversation mode)
      // ────────────────────────────────────────
      if (collectedCommands.length > 0 && !abortController.signal.aborted) {
        const professorMariCommandTypes = new Set([
          "create_persona",
          "create_character",
          "update_character",
          "update_persona",
          "create_chat",
          "navigate",
          "fetch",
        ]);
        const professorMariCommandCount = collectedCommands.filter(({ command }) =>
          professorMariCommandTypes.has(command.type),
        ).length;
        trySendSseEvent(reply, {
          type: "assistant_commands_start",
          data: { count: collectedCommands.length, professorMariCommandCount },
        });
        try {
          for (const { command, characterId, messageId } of collectedCommands) {
            try {
              if (command.type === "schedule_update") {
                // ── Schedule Update: modify the character's current schedule block ──
                const schedCmd = command as ScheduleUpdateCommand;
                if (characterId && (schedCmd.status || schedCmd.activity)) {
                  const freshChat = await chats.getById(input.chatId);
                  const freshMeta =
                    typeof freshChat?.metadata === "string"
                      ? JSON.parse(freshChat.metadata)
                      : (freshChat?.metadata ?? {});
                  const schedules: Record<string, any> = getEnabledConversationSchedules(freshMeta);
                  const schedule = schedules[characterId];
                  if (schedule) {
                    const nowDate = new Date();
                    const DAYS_LIST = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
                    const dayName = DAYS_LIST[(nowDate.getDay() + 6) % 7]!;
                    const daySchedule: Array<{ time: string; activity: string; status: string }> =
                      schedule.days?.[dayName] ?? [];
                    const currentMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();

                    // Find the current time block and update it
                    let updated = false;
                    for (const block of daySchedule) {
                      const [startStr, endStr] = block.time.split("-");
                      if (!startStr || !endStr) continue;
                      const [sh, sm] = startStr.split(":").map(Number);
                      const [eh, em] = endStr.split(":").map(Number);
                      const startMin = (sh ?? 0) * 60 + (sm ?? 0);
                      const endMin = (eh ?? 0) * 60 + (em ?? 0);
                      if (startMin <= currentMinutes && currentMinutes < endMin) {
                        if (schedCmd.status) block.status = schedCmd.status;
                        if (schedCmd.activity) block.activity = schedCmd.activity;

                        // If duration specified, split the block
                        if (schedCmd.duration) {
                          const durationMin = parseDuration(schedCmd.duration);
                          if (durationMin && currentMinutes + durationMin < endMin) {
                            const splitTime = currentMinutes + durationMin;
                            const splitH = String(Math.floor(splitTime / 60)).padStart(2, "0");
                            const splitM = String(splitTime % 60).padStart(2, "0");
                            // Shorten current block to end at the split point
                            block.time = `${startStr}-${splitH}:${splitM}`;
                            // Insert a new block for the remainder with the original activity/status
                            const idx = daySchedule.indexOf(block);
                            daySchedule.splice(idx + 1, 0, {
                              time: `${splitH}:${splitM}-${endStr}`,
                              activity: "free time",
                              status: "online",
                            });
                          }
                        }
                        updated = true;
                        break;
                      }
                    }

                    if (updated) {
                      schedule.days[dayName] = daySchedule;
                      schedules[characterId] = schedule;
                      await chats.updateMetadata(input.chatId, { ...freshMeta, characterSchedules: schedules });

                      // Update character's conversationStatus
                      const charRow = await chars.getById(characterId);
                      if (charRow) {
                        const charData = JSON.parse(charRow.data as string);
                        const newStatus = schedCmd.status ?? charData.extensions?.conversationStatus ?? "online";
                        const extensions = { ...(charData.extensions ?? {}), conversationStatus: newStatus };
                        await chars.update(characterId, { extensions } as any);
                      }

                      // Sync to other chats with this character
                      const allChatsList = await chats.list();
                      for (const c of allChatsList) {
                        if (c.id === input.chatId || c.mode !== "conversation") continue;
                        const cCharIds: string[] =
                          typeof c.characterIds === "string"
                            ? JSON.parse(c.characterIds as string)
                            : (c.characterIds as string[]);
                        if (!cCharIds.includes(characterId)) continue;
                        const cMeta =
                          typeof c.metadata === "string" ? JSON.parse(c.metadata as string) : (c.metadata ?? {});
                        if (!areConversationSchedulesEnabled(cMeta)) continue;
                        const cScheds = cMeta.characterSchedules ?? {};
                        cScheds[characterId] = schedule;
                        await chats.updateMetadata(c.id, { ...cMeta, characterSchedules: cScheds });
                      }

                      reply.raw.write(
                        `data: ${JSON.stringify({
                          type: "schedule_updated",
                          data: { characterId, status: schedCmd.status, activity: schedCmd.activity },
                        })}\n\n`,
                      );
                      logger.info(
                        `[commands] Schedule updated for ${characterId}: status=${schedCmd.status}, activity=${schedCmd.activity}`,
                      );
                    }
                  }
                }
              } else if (command.type === "cross_post") {
                // ── Cross-Post: copy/redirect message to another chat ──
                const crossCmd = command as CrossPostCommand;
                const targetName = crossCmd.target.toLowerCase();

                // Find the target chat by name
                const allChatsList = await chats.list();
                const targetChat = allChatsList.find(
                  (c: any) =>
                    c.mode === "conversation" &&
                    c.id !== input.chatId &&
                    (c.name?.toLowerCase().includes(targetName) || c.id === crossCmd.target),
                );

                if (targetChat) {
                  // Get the clean response (commands already stripped)
                  const msgRow = messageId ? await chats.getMessage(messageId) : null;
                  const msgContent = msgRow?.content ?? fullResponse;

                  // Create the message in the target chat
                  await chats.createMessage({
                    chatId: targetChat.id,
                    role: "assistant",
                    characterId,
                    content: msgContent,
                  });

                  // Remove the original message from the source chat (redirect, not copy)
                  if (messageId) {
                    await chats.removeMessage(messageId);
                  }

                  reply.raw.write(
                    `data: ${JSON.stringify({
                      type: "cross_post",
                      data: {
                        targetChatId: targetChat.id,
                        targetChatName: targetChat.name,
                        sourceChatId: input.chatId,
                        characterId,
                      },
                    })}\n\n`,
                  );
                  logger.info(`[commands] Cross-posted message to chat "${targetChat.name}" (${targetChat.id})`);
                } else {
                  logger.warn(`[commands] Cross-post target "${crossCmd.target}" not found`);
                }
              } else if (command.type === "selfie") {
                // ── Selfie: generate an image from the character's appearance ──
                const selfieCmd = command as SelfieCommand;

                // Use the chat-level image gen connection (set by user in chat settings)
                const imgConnId = chatMeta.imageGenConnectionId as string | undefined;
                if (imgConnId) {
                  // Show typing indicator while generating the selfie
                  const charRow = characterId ? await chars.getById(characterId) : null;
                  const charData = charRow ? JSON.parse(charRow.data as string) : null;
                  const charName = charData?.name ?? "character";
                  reply.raw.write(`data: ${JSON.stringify({ type: "typing", characters: [charName] })}\n\n`);

                  try {
                    const imgConnFull = await connections.getWithKey(imgConnId);
                    if (!imgConnFull) throw new Error("Cannot decrypt image generation connection");

                    // Build selfie prompt from character appearance + context
                    const appearance = charData?.extensions?.appearance ?? charData?.description ?? "";

                    // Use the LLM to build a proper image prompt
                    const selfieTags: string[] = Array.isArray(chatMeta.selfieTags)
                      ? (chatMeta.selfieTags as string[])
                      : [];
                    const promptBuilder = createLLMProvider(
                      conn.provider,
                      baseUrl,
                      conn.apiKey,
                      conn.maxContext,
                      conn.openrouterProvider,
                      conn.maxTokensOverride,
                    );
                    const selfieSystemPrompt = await loadPrompt(
                      createPromptOverridesStorage(app.db),
                      CONVERSATION_SELFIE,
                      {
                        appearance,
                        charName,
                        selfieTagsBlock:
                          selfieTags.length > 0
                            ? `\n\nAlways include these tags/modifiers in the prompt: ${selfieTags.join(", ")}`
                            : "",
                      },
                    );
                    const promptResult = await promptBuilder.chatComplete(
                      [
                        {
                          role: "system",
                          content: selfieSystemPrompt,
                        },
                        {
                          role: "user",
                          content: selfieCmd.context
                            ? `Context for the selfie: ${selfieCmd.context}`
                            : `Generate a casual selfie of ${charName} based on the current conversation context.`,
                        },
                      ],
                      { model: conn.model, temperature: 0.7, maxTokens: 8196 },
                    );

                    const imagePrompt = (promptResult.content ?? "").trim();
                    if (imagePrompt) {
                      const { generateImage, saveImageToDisk } = await import("../services/image/image-generation.js");
                      const { createGalleryStorage } = await import("../services/storage/gallery.storage.js");
                      const galleryStore = createGalleryStorage(app.db);

                      const imgModel = imgConnFull.model || "";
                      const imgBaseUrl = imgConnFull.baseUrl || "https://image.pollinations.ai";
                      const imgApiKey = imgConnFull.apiKey || "";
                      const imgSource = (imgConnFull as any).imageGenerationSource || imgModel;
                      const imageDefaults = resolveConnectionImageDefaults(imgConnFull);
                      const imageSettings = await loadImageGenerationUserSettings(app.db);

                      // Parse per-chat selfie resolution, otherwise use the global selfie canvas.
                      const selfieRes = (chatMeta.selfieResolution as string) ?? "";
                      const [selfieW, selfieH] = selfieRes.split("x").map(Number) as [number, number];

                      const serviceHint = imgConnFull.imageService || "";
                      const imageResult = await generateImage(
                        imgModel,
                        imgBaseUrl,
                        imgApiKey,
                        serviceHint || imgSource,
                        {
                          prompt: imagePrompt,
                          model: imgModel,
                          width: selfieW || imageSettings.selfie.width,
                          height: selfieH || imageSettings.selfie.height,
                          comfyWorkflow: imgConnFull.comfyuiWorkflow || undefined,
                          imageDefaults,
                        },
                      );

                      // Save to disk and DB
                      const filePath = saveImageToDisk(input.chatId, imageResult.base64, imageResult.ext);
                      const galleryEntry = await galleryStore.create({
                        chatId: input.chatId,
                        filePath,
                        prompt: imagePrompt,
                        provider: imgConnFull.provider ?? "image_generation",
                        model: imgModel || "unknown",
                        width: selfieW || imageSettings.selfie.width,
                        height: selfieH || imageSettings.selfie.height,
                      });

                      // Attach the image to the message
                      const filename = filePath.split("/").pop()!;
                      const imageUrl = `/api/gallery/file/${input.chatId}/${encodeURIComponent(filename)}`;
                      if (messageId) {
                        const msgRow = await chats.getMessage(messageId);
                        const msgExtra = msgRow?.extra
                          ? typeof msgRow.extra === "string"
                            ? JSON.parse(msgRow.extra)
                            : msgRow.extra
                          : {};
                        const existingAttachments = (msgExtra.attachments as any[]) ?? [];
                        existingAttachments.push({
                          type: "image",
                          url: imageUrl,
                          filename: `selfie_${charName.toLowerCase().replace(/\s+/g, "_")}.${imageResult.ext}`,
                        });
                        await chats.updateMessageExtra(messageId, { attachments: existingAttachments });
                      }

                      // Send selfie event to client
                      reply.raw.write(
                        `data: ${JSON.stringify({
                          type: "selfie",
                          data: {
                            characterId,
                            characterName: charName,
                            messageId,
                            imageUrl,
                            prompt: imagePrompt,
                            galleryId: (galleryEntry as any)?.id,
                          },
                        })}\n\n`,
                      );
                      logger.info(`[commands] Selfie generated for ${charName}: ${imagePrompt.slice(0, 80)}...`);
                    }
                  } catch (imgErr) {
                    logger.error(imgErr, "[commands] Selfie generation failed");
                    reply.raw.write(
                      `data: ${JSON.stringify({
                        type: "selfie_error",
                        data: {
                          characterId,
                          error: imgErr instanceof Error ? imgErr.message : "Image generation failed",
                        },
                      })}\n\n`,
                    );
                  }
                } else {
                  logger.warn("[commands] Selfie requested but no imageGenConnectionId set on chat metadata");
                  reply.raw.write(
                    `data: ${JSON.stringify({
                      type: "selfie_error",
                      data: {
                        characterId,
                        error: "No image generation connection configured for this chat. Set one in Chat Settings.",
                      },
                    })}\n\n`,
                  );
                }
              } else if (command.type === "memory") {
                // ── Memory: store a fake memory on the target character ──
                const memCmd = command as MemoryCommand;
                const targetName = memCmd.target.toLowerCase();

                // Resolve source character name
                const srcCharRow = characterId ? await chars.getById(characterId) : null;
                const srcCharData = srcCharRow ? JSON.parse(srcCharRow.data as string) : null;
                const srcCharName = srcCharData?.name ?? "Unknown";

                // Find target character by name across all characters
                const allCharsList = await chars.list();
                const targetChar = allCharsList.find((c: any) => {
                  const d = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
                  return d.name?.toLowerCase() === targetName;
                });

                if (targetChar) {
                  const targetData =
                    typeof targetChar.data === "string" ? JSON.parse(targetChar.data as string) : targetChar.data;
                  const extensions = { ...(targetData.extensions ?? {}) };
                  const memories: Array<{ from: string; fromCharId: string; summary: string; createdAt: string }> =
                    extensions.characterMemories ?? [];

                  memories.push({
                    from: srcCharName,
                    fromCharId: characterId ?? "",
                    summary: memCmd.summary,
                    createdAt: new Date().toISOString(),
                  });

                  extensions.characterMemories = memories;
                  await chars.update(targetChar.id, { extensions } as any);

                  logger.info(`[commands] Memory created: "${srcCharName}" → "${targetData.name}": ${memCmd.summary}`);
                } else {
                  logger.warn(`[commands] Memory target character "${memCmd.target}" not found`);
                }
              }

              if (command.type === "influence") {
                // ── Influence: queue OOC influence for the connected chat ──
                const infCmd = command as InfluenceCommand;
                const freshChat = await chats.getById(input.chatId);
                const connectedId = freshChat?.connectedChatId as string | null;
                if (connectedId) {
                  const influenceContent = stripConversationPromptTimestamps(infCmd.content);
                  if (!influenceContent) continue;
                  await chats.createInfluence(input.chatId, connectedId, influenceContent, messageId);
                  logger.info(
                    `[commands] OOC influence queued for connected chat ${connectedId}: "${influenceContent.slice(0, 80)}..."`,
                  );
                } else {
                  logger.warn("[commands] Influence command used but no connected chat");
                }
              }

              if (command.type === "note") {
                // ── Note: persist a durable note in the connected roleplay's prompt ──
                const noteCmd = command as NoteCommand;
                const freshChat = await chats.getById(input.chatId);
                const connectedId = freshChat?.connectedChatId as string | null;
                if (connectedId) {
                  const noteContent = stripConversationPromptTimestamps(noteCmd.content);
                  if (!noteContent) continue;
                  await chats.createNote(input.chatId, connectedId, noteContent, messageId);
                  logger.info(
                    `[commands] Conversation note saved for connected chat ${connectedId}: "${noteContent.slice(0, 80)}..."`,
                  );
                } else {
                  logger.warn("[commands] Note command used but no connected chat");
                }
              }

              if (command.type === "haptic") {
                // ── Haptic: send command to connected intimate devices ──
                const hapCmd = command as HapticCommand;
                try {
                  const { hapticService } = await import("../services/haptic/buttplug-service.js");
                  if (hapticService.connected && hapticService.devices.length > 0) {
                    await hapticService.executeCommand({
                      deviceIndex: "all",
                      action: hapCmd.action,
                      intensity: hapCmd.intensity,
                      duration: hapCmd.duration,
                    });
                    reply.raw.write(
                      `data: ${JSON.stringify({
                        type: "haptic_command",
                        data: { action: hapCmd.action, intensity: hapCmd.intensity, duration: hapCmd.duration },
                      })}\n\n`,
                    );
                    logger.info(
                      `[commands] Haptic: ${hapCmd.action} intensity=${hapCmd.intensity ?? "default"} duration=${hapCmd.duration ?? "indefinite"}`,
                    );
                  } else if (!hapticService.connected) {
                    logger.warn(
                      `[commands] Haptic command [${hapCmd.action}] skipped — Intiface Central not connected`,
                    );
                  } else {
                    logger.warn(`[commands] Haptic command [${hapCmd.action}] skipped — no devices found`);
                  }
                } catch (hapErr) {
                  logger.error(hapErr, "[commands] Haptic command failed");
                }
              }

              if (command.type === "scene") {
                // ── Scene: plan + create a mini-roleplay branching from this conversation ──
                const scnCmd = command as SceneCommand;
                try {
                  const originChat = await chats.getById(input.chatId);
                  if (!originChat) throw new Error("Origin chat not found");

                  const originCharIds: string[] =
                    typeof originChat.characterIds === "string"
                      ? JSON.parse(originChat.characterIds)
                      : (originChat.characterIds as string[]);

                  // Resolve initiator name
                  const initiatorRow = characterId ? await chars.getById(characterId) : null;
                  const initiatorData = initiatorRow
                    ? typeof initiatorRow.data === "string"
                      ? JSON.parse(initiatorRow.data as string)
                      : initiatorRow.data
                    : null;
                  const initiatorName = initiatorData?.name ?? "Character";

                  // Call /scene/plan internally to get a comprehensive plan
                  const planRes = await app.inject({
                    method: "POST",
                    url: "/api/scene/plan",
                    payload: {
                      chatId: input.chatId,
                      prompt: scnCmd.scenario,
                      connectionId: null,
                    },
                  });
                  const planBody = JSON.parse(planRes.body);
                  if (!planBody.plan) throw new Error("Scene plan failed");

                  // Override background if the character specified one
                  if (scnCmd.background) {
                    planBody.plan.background = scnCmd.background;
                  }

                  // Call /scene/create with the full plan
                  const createRes = await app.inject({
                    method: "POST",
                    url: "/api/scene/create",
                    payload: {
                      originChatId: input.chatId,
                      initiatorCharId: characterId,
                      plan: planBody.plan,
                      connectionId: null,
                    },
                  });
                  const createBody = JSON.parse(createRes.body);

                  if (createBody.chatId) {
                    // Notify client
                    reply.raw.write(
                      `data: ${JSON.stringify({
                        type: "scene_created",
                        data: {
                          sceneChatId: createBody.chatId,
                          sceneChatName: createBody.chatName,
                          description: createBody.description,
                          background: createBody.background ?? null,
                          initiatorCharId: characterId,
                          initiatorCharName: initiatorName,
                        },
                      })}\n\n`,
                    );
                    logger.info(
                      `[commands] Scene created: "${createBody.chatName}" (${createBody.chatId}) from chat ${input.chatId}`,
                    );
                  }
                } catch (sceneErr) {
                  logger.error(sceneErr, "[commands] Scene creation failed");
                }
              }

              // ── Assistant commands (Professor Mari) ──
              if (command.type === "create_persona") {
                const cpCmd = command as CreatePersonaCommand;
                try {
                  const persona = await chars.createPersona(cpCmd.name, cpCmd.description ?? "", undefined, {
                    personality: cpCmd.personality,
                    appearance: cpCmd.appearance,
                  });
                  reply.raw.write(
                    `data: ${JSON.stringify({
                      type: "assistant_action",
                      data: { action: "persona_created", id: persona?.id, name: cpCmd.name },
                    })}\n\n`,
                  );
                  logger.info(`[commands] Assistant created persona: "${cpCmd.name}" (${persona?.id})`);
                } catch (err) {
                  logger.error(err, "[commands] Create persona failed");
                }
              }

              if (command.type === "create_character") {
                const ccCmd = command as CreateCharacterCommand;
                try {
                  const charData = {
                    name: ccCmd.name,
                    description: ccCmd.description ?? "",
                    personality: ccCmd.personality ?? "",
                    first_mes: ccCmd.firstMessage ?? "",
                    scenario: ccCmd.scenario ?? "",
                    mes_example: ccCmd.mesExample ?? "",
                    creator_notes: ccCmd.creatorNotes ?? "",
                    system_prompt: ccCmd.systemPrompt ?? "",
                    post_history_instructions: ccCmd.postHistoryInstructions ?? "",
                    tags: ccCmd.tags ?? ([] as string[]),
                    creator: ccCmd.creator ?? "",
                    character_version: ccCmd.characterVersion ?? "",
                    alternate_greetings: ccCmd.alternateGreetings ?? ([] as string[]),
                    extensions: {
                      talkativeness: ccCmd.talkativeness ?? 0.5,
                      fav: ccCmd.fav ?? false,
                      world: ccCmd.world ?? "",
                      depth_prompt: {
                        prompt: ccCmd.depthPrompt ?? "",
                        depth: ccCmd.depthPromptDepth ?? 4,
                        role: ccCmd.depthPromptRole ?? "system",
                      },
                      backstory: ccCmd.backstory ?? "",
                      appearance: ccCmd.appearance ?? "",
                    },
                    character_book: null,
                  };
                  const created = await chars.create(charData as any);
                  if (created) {
                    reply.raw.write(
                      `data: ${JSON.stringify({
                        type: "assistant_action",
                        data: { action: "character_created", id: created.id, name: ccCmd.name },
                      })}\n\n`,
                    );
                    logger.info(`[commands] Assistant created character: "${ccCmd.name}" (${created.id})`);
                  }
                } catch (err) {
                  logger.error(err, "[commands] Create character failed");
                }
              }

              if (command.type === "update_character") {
                const ucCmd = command as UpdateCharacterCommand;
                try {
                  const allCharsList = await chars.list();
                  const targetChar = allCharsList.find((c: any) => {
                    const d = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
                    return d.name?.toLowerCase() === ucCmd.name.toLowerCase();
                  });
                  if (targetChar) {
                    const latestTargetChar = await chars.getById(targetChar.id);
                    if (!latestTargetChar) {
                      logger.warn(`[commands] Update character: "${ucCmd.name}" disappeared before update`);
                      continue;
                    }
                    const existingData =
                      typeof latestTargetChar.data === "string"
                        ? JSON.parse(latestTargetChar.data as string)
                        : latestTargetChar.data;
                    const updates: Record<string, unknown> = {};
                    const extensionUpdates: Record<string, unknown> = {};
                    if (ucCmd.description !== undefined) updates.description = ucCmd.description;
                    if (ucCmd.personality !== undefined) updates.personality = ucCmd.personality;
                    if (ucCmd.firstMessage !== undefined) updates.first_mes = ucCmd.firstMessage;
                    if (ucCmd.scenario !== undefined) updates.scenario = ucCmd.scenario;
                    if (ucCmd.mesExample !== undefined) updates.mes_example = ucCmd.mesExample;
                    if (ucCmd.creatorNotes !== undefined) updates.creator_notes = ucCmd.creatorNotes;
                    if (ucCmd.systemPrompt !== undefined) updates.system_prompt = ucCmd.systemPrompt;
                    if (ucCmd.postHistoryInstructions !== undefined) {
                      updates.post_history_instructions = ucCmd.postHistoryInstructions;
                    }
                    if (ucCmd.creator !== undefined) updates.creator = ucCmd.creator;
                    if (ucCmd.characterVersion !== undefined) updates.character_version = ucCmd.characterVersion;
                    if (ucCmd.tags !== undefined) updates.tags = ucCmd.tags;
                    if (ucCmd.alternateGreetings !== undefined) {
                      updates.alternate_greetings = ucCmd.alternateGreetings;
                    }
                    if (ucCmd.backstory !== undefined) extensionUpdates.backstory = ucCmd.backstory;
                    if (ucCmd.appearance !== undefined) extensionUpdates.appearance = ucCmd.appearance;
                    if (ucCmd.talkativeness !== undefined) extensionUpdates.talkativeness = ucCmd.talkativeness;
                    if (ucCmd.fav !== undefined) extensionUpdates.fav = ucCmd.fav;
                    if (ucCmd.world !== undefined) extensionUpdates.world = ucCmd.world;
                    if (
                      ucCmd.depthPrompt !== undefined ||
                      ucCmd.depthPromptDepth !== undefined ||
                      ucCmd.depthPromptRole !== undefined
                    ) {
                      const existingDepthPrompt = existingData.extensions?.depth_prompt ?? {};
                      extensionUpdates.depth_prompt = {
                        ...existingDepthPrompt,
                        ...(ucCmd.depthPrompt !== undefined ? { prompt: ucCmd.depthPrompt } : {}),
                        ...(ucCmd.depthPromptDepth !== undefined ? { depth: ucCmd.depthPromptDepth } : {}),
                        ...(ucCmd.depthPromptRole !== undefined ? { role: ucCmd.depthPromptRole } : {}),
                      };
                    }
                    if (Object.keys(extensionUpdates).length > 0) {
                      updates.extensions = { ...(existingData.extensions ?? {}), ...extensionUpdates };
                    }
                    if (ucCmd.characterVersion === undefined && Object.keys(updates).length > 0) {
                      updates.character_version = bumpCharacterVersion(existingData.character_version);
                    }
                    await chars.update(targetChar.id, updates, undefined, {
                      versionSource: "command",
                      versionReason: "Assistant update_character command",
                    });
                    reply.raw.write(
                      `data: ${JSON.stringify({
                        type: "assistant_action",
                        data: { action: "character_updated", id: targetChar.id, name: ucCmd.name },
                      })}\n\n`,
                    );
                    logger.info(`[commands] Assistant updated character: "${ucCmd.name}" (${targetChar.id})`);
                  } else {
                    logger.warn(`[commands] Update character: "${ucCmd.name}" not found`);
                  }
                } catch (err) {
                  logger.error(err, "[commands] Update character failed");
                }
              }

              if (command.type === "update_persona") {
                const upCmd = command as UpdatePersonaCommand;
                try {
                  const allPersonas = await chars.listPersonas();
                  const targetPersona = allPersonas.find((p: any) => {
                    return p.name?.toLowerCase() === upCmd.name.toLowerCase();
                  });
                  if (targetPersona) {
                    const sets: Record<string, unknown> = {};
                    if (upCmd.description !== undefined) sets.description = upCmd.description;
                    if (upCmd.personality !== undefined) sets.personality = upCmd.personality;
                    if (upCmd.appearance !== undefined) sets.appearance = upCmd.appearance;
                    if (upCmd.scenario !== undefined) sets.scenario = upCmd.scenario;
                    if (upCmd.backstory !== undefined) sets.backstory = upCmd.backstory;
                    await chars.updatePersona(targetPersona.id, sets as any);
                    reply.raw.write(
                      `data: ${JSON.stringify({
                        type: "assistant_action",
                        data: { action: "persona_updated", id: targetPersona.id, name: upCmd.name },
                      })}\n\n`,
                    );
                    logger.info(`[commands] Assistant updated persona: "${upCmd.name}" (${targetPersona.id})`);
                  } else {
                    logger.warn(`[commands] Update persona: "${upCmd.name}" not found`);
                  }
                } catch (err) {
                  logger.error(err, "[commands] Update persona failed");
                }
              }

              if (command.type === "create_chat") {
                const ctCmd = command as CreateChatCommand;
                try {
                  // Resolve character by name or ID
                  const allCharsList = await chars.list();
                  const targetChar = allCharsList.find((c: any) => {
                    if (c.id === ctCmd.character) return true;
                    const d = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
                    return d.name?.toLowerCase() === ctCmd.character.toLowerCase();
                  });
                  if (targetChar) {
                    const targetData =
                      typeof targetChar.data === "string" ? JSON.parse(targetChar.data as string) : targetChar.data;
                    const mode = ctCmd.mode ?? "conversation";
                    const newChat = await chats.create({
                      name: `Chat with ${targetData.name}`,
                      mode,
                      characterIds: [targetChar.id],
                      groupId: null,
                      personaId: null,
                      promptPresetId: null,
                      connectionId: null,
                    });
                    if (newChat) {
                      reply.raw.write(
                        `data: ${JSON.stringify({
                          type: "assistant_action",
                          data: {
                            action: "chat_created",
                            chatId: newChat.id,
                            chatName: newChat.name ?? `Chat with ${targetData.name}`,
                            mode,
                            characterName: targetData.name,
                          },
                        })}\n\n`,
                      );
                      logger.info(
                        `[commands] Assistant created ${mode} chat with "${targetData.name}" (${newChat.id})`,
                      );
                    }
                  } else {
                    logger.warn(`[commands] Create chat: character "${ctCmd.character}" not found`);
                  }
                } catch (err) {
                  logger.error(err, "[commands] Create chat failed");
                }
              }

              if (command.type === "navigate") {
                const navCmd = command as NavigateCommand;
                reply.raw.write(
                  `data: ${JSON.stringify({
                    type: "assistant_action",
                    data: { action: "navigate", panel: navCmd.panel, tab: navCmd.tab ?? null },
                  })}\n\n`,
                );
                logger.info(`[commands] Assistant navigate: panel=${navCmd.panel}, tab=${navCmd.tab ?? "none"}`);
              }

              // ── Fetch command (Professor Mari) ──
              if (command.type === "fetch") {
                const fetchCmd = command as FetchCommand;
                try {
                  let fetchedContent = "";
                  const contextKey = `${fetchCmd.fetchType}:${fetchCmd.name}`;

                  if (fetchCmd.fetchType === "character") {
                    const allCharsList = await chars.list();
                    const found = allCharsList.find((c: any) => {
                      const d = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
                      return d.name?.toLowerCase() === fetchCmd.name.toLowerCase();
                    });
                    if (found) {
                      const d = typeof found.data === "string" ? JSON.parse(found.data as string) : found.data;
                      const parts = [`Name: ${d.name}`];
                      if (d.description) parts.push(`Description: ${d.description}`);
                      if (d.personality) parts.push(`Personality: ${d.personality}`);
                      if (d.scenario) parts.push(`Scenario: ${d.scenario}`);
                      if (d.mes_example) parts.push(`Example Messages: ${d.mes_example}`);
                      if (d.system_prompt) parts.push(`System Prompt: ${d.system_prompt}`);
                      if (d.post_history_instructions) {
                        parts.push(`Post-History Instructions: ${d.post_history_instructions}`);
                      }
                      if (d.first_mes) parts.push(`First Message: ${d.first_mes}`);
                      if (d.creator_notes) parts.push(`Creator Notes: ${d.creator_notes}`);
                      if (d.extensions?.appearance) parts.push(`Appearance: ${d.extensions.appearance}`);
                      if (d.extensions?.backstory) parts.push(`Backstory: ${d.extensions.backstory}`);
                      fetchedContent = parts.join("\n");
                    }
                  } else if (fetchCmd.fetchType === "persona") {
                    const allPersonasList = await chars.listPersonas();
                    const found = allPersonasList.find(
                      (p: any) => p.name?.toLowerCase() === fetchCmd.name.toLowerCase(),
                    );
                    if (found) {
                      const parts = [`Name: ${found.name}`];
                      if (found.description) parts.push(`Description: ${found.description}`);
                      if (found.personality) parts.push(`Personality: ${found.personality}`);
                      if (found.scenario) parts.push(`Scenario: ${found.scenario}`);
                      if (found.appearance) parts.push(`Appearance: ${found.appearance}`);
                      if (found.backstory) parts.push(`Backstory: ${found.backstory}`);
                      fetchedContent = parts.join("\n");
                    }
                  } else if (fetchCmd.fetchType === "lorebook") {
                    const allLorebooks = await lorebooksStore.list();
                    const found = (allLorebooks as any[]).find(
                      (lb: any) => lb.name?.toLowerCase() === fetchCmd.name.toLowerCase(),
                    );
                    if (found) {
                      const entries = await lorebooksStore.listEntries(found.id);
                      const parts = [`Lorebook: ${found.name}`];
                      if (found.description) parts.push(`Description: ${found.description}`);
                      if (found.category) parts.push(`Category: ${found.category}`);
                      parts.push(`Entries (${entries.length}):`);
                      for (const entry of entries as any[]) {
                        parts.push(
                          `\n  Entry: ${entry.name}\n  Keys: ${(Array.isArray(entry.keys) ? entry.keys : []).join(", ")}\n  Content: ${entry.content}`,
                        );
                      }
                      fetchedContent = parts.join("\n");
                    }
                  } else if (fetchCmd.fetchType === "chat") {
                    const allChats = await chats.list();
                    const found = (allChats as any[]).find(
                      (c: any) => c.name?.toLowerCase() === fetchCmd.name.toLowerCase(),
                    );
                    if (found) {
                      const parts = [`Chat: ${found.name}`, `Mode: ${found.mode}`];
                      const recentMsgs = await chats.listMessagesPaginated(found.id, 20);
                      if (recentMsgs.length > 0) {
                        parts.push(`Recent Messages (${recentMsgs.length}):`);
                        for (const msg of recentMsgs) {
                          const role =
                            msg.role === "assistant" ? (msg.characterId ? "Character" : "Assistant") : "User";
                          parts.push(`  [${role}]: ${(msg.content as string).slice(0, 300)}`);
                        }
                      }
                      fetchedContent = parts.join("\n");
                    }
                  } else if (fetchCmd.fetchType === "preset") {
                    const allPresetsList = await presets.list();
                    const found = (allPresetsList as any[]).find(
                      (p: any) => p.name?.toLowerCase() === fetchCmd.name.toLowerCase(),
                    );
                    if (found) {
                      const sections = await presets.listSections(found.id);
                      const parts = [`Preset: ${found.name}`];
                      if (found.description) parts.push(`Description: ${found.description}`);
                      parts.push(`Sections (${sections.length}):`);
                      for (const sec of sections) {
                        parts.push(
                          `  [${sec.role}] ${sec.name ?? "Untitled"}: ${(sec.content as string).slice(0, 200)}`,
                        );
                      }
                      fetchedContent = parts.join("\n");
                    }
                  }

                  if (fetchedContent) {
                    // Persist to chatMeta.mariContext so it's available in subsequent messages.
                    // Re-fetch fresh metadata so concurrent writes (e.g. /game/start) aren't clobbered.
                    const freshChat = await chats.getById(input.chatId);
                    const currentMeta = freshChat
                      ? (parseExtra(freshChat.metadata) as Record<string, unknown>)
                      : (parseExtra(chat.metadata) as Record<string, unknown>);
                    const mariContext = (currentMeta.mariContext as Record<string, string>) ?? {};
                    mariContext[contextKey] = fetchedContent;
                    currentMeta.mariContext = mariContext;
                    await chats.updateMetadata(input.chatId, currentMeta);

                    reply.raw.write(
                      `data: ${JSON.stringify({
                        type: "assistant_action",
                        data: {
                          action: "data_fetched",
                          fetchType: fetchCmd.fetchType,
                          name: fetchCmd.name,
                        },
                      })}\n\n`,
                    );
                    logger.info(`[commands] Assistant fetched ${fetchCmd.fetchType}: "${fetchCmd.name}"`);
                  } else {
                    logger.warn(`[commands] Fetch: ${fetchCmd.fetchType} "${fetchCmd.name}" not found`);
                  }
                } catch (err) {
                  logger.error(err, "[commands] Fetch failed");
                }
              }
            } catch (cmdErr) {
              logger.error(cmdErr, `[commands] Error processing ${command.type} command`);
            }
          }
        } finally {
          trySendSseEvent(reply, {
            type: "assistant_commands_end",
            data: {},
          });
        }
      }

      // ── Post OOC messages to connected conversation (Roleplay → Conversation) ──
      if (collectedOocMessages.length > 0 && chat.connectedChatId && !abortController.signal.aborted) {
        try {
          for (const oocText of collectedOocMessages) {
            await chats.createMessage({
              chatId: chat.connectedChatId as string,
              role: "assistant",
              characterId: lastSavedMsg?.characterId ?? characterIds[0] ?? null,
              content: oocText,
            });
          }
          logger.info(
            `[generate] Posted ${collectedOocMessages.length} OOC message(s) to conversation ${chat.connectedChatId}`,
          );
          reply.raw.write(
            `data: ${JSON.stringify({ type: "ooc_posted", data: { chatId: chat.connectedChatId, count: collectedOocMessages.length } })}\n\n`,
          );
        } catch (oocErr) {
          logger.error(oocErr, "[generate] Failed to post OOC messages");
        }
      }

      // Wait for illustration to finish before closing the SSE stream
      if (pendingIllustration) {
        try {
          await pendingIllustration;
        } catch {
          /* errors already handled inside the promise */
        }
      }

      // Signal completion
      sendSseEvent(reply, { type: "done", data: "" });

      // ── Background: chunk & embed new messages for memory recall ──
      // Always chunk (so memories are available if the user enables recall later)
      {
        const charNameMap: Record<string, string> = {};
        for (const ci of charInfo) {
          charNameMap[ci.id] = ci.name;
        }
        chunkAndEmbedMessages(app.db, input.chatId, { userName: personaName, characterNames: charNameMap }).catch(
          (err) => logger.error(err, "[memory-recall] Background chunking failed"),
        );
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? (err as { cause?: unknown }).cause instanceof Error
            ? `${err.message}: ${(err as { cause?: Error }).cause!.message}`
            : err.message
          : "Generation failed";
      sendSseEvent(reply, { type: "error", data: message });
    } finally {
      req.raw.off("close", onClose);
      if (activeGenerations) activeGenerations.delete(input.chatId);
      reply.raw.end();
    }
  });

  // ── Active generation tracking for explicit abort ──
  const activeGenerations = new Map<string, { abortController: AbortController; backendUrl: string | null }>();

  // Expose the map so the route handler can register/unregister generations
  app.decorate("activeGenerations", activeGenerations);

  /**
   * POST /api/generate/abort
   * Explicitly abort an in-progress generation for a given chat.
   */
  app.post("/abort", async (req, reply) => {
    const body = req.body as { chatId?: string };
    const chatId = body?.chatId;
    if (!chatId) return reply.status(400).send({ error: "chatId is required" });

    const gen = activeGenerations.get(chatId);
    if (!gen) return reply.send({ aborted: false, reason: "No active generation for this chat" });

    logger.info("[abort] Explicit abort requested for chat: %s", chatId);
    gen.abortController.abort();

    // Send abort to backend (KoboldCPP etc.)
    if (gen.backendUrl) {
      const backendRoot = gen.backendUrl.replace(/\/v1\/?$/, "");
      const abortUrl = backendRoot + "/api/extra/abort";
      logger.info("[abort] Sending abort to backend: %s", abortUrl);
      try {
        await fetch(abortUrl, { method: "POST", signal: AbortSignal.timeout(5000) });
        logger.info("[abort] Backend abort sent successfully");
      } catch (err) {
        logger.warn(err, "[abort] Backend abort failed");
      }
    }

    activeGenerations.delete(chatId);
    return reply.send({ aborted: true });
  });

  await registerDryRunRoute(app);
  await registerRetryAgentsRoute(app);
}
