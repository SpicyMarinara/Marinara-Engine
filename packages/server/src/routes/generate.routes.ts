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
import { processLorebooks } from "../services/lorebook/index.js";
import { injectAtDepth } from "../services/lorebook/prompt-injector.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { extractLeadingThinkingBlocks } from "../services/llm/inline-thinking.js";
import { assemblePrompt, type AssemblerInput } from "../services/prompt/index.js";
import { mergeAdjacentMessages } from "../services/prompt/merger.js";
import { wrapContent } from "../services/prompt/format-engine.js";
import {
  fitMessagesToContext,
  type BaseLLMProvider,
  type LLMToolDefinition,
  type ChatMessage,
  type LLMUsage,
} from "../services/llm/base-provider.js";
import { executeToolCalls } from "../services/tools/tool-executor.js";
import { createAgentPipeline, type ResolvedAgent, type AgentInjection } from "../services/agents/agent-pipeline.js";
import { DATA_DIR } from "../utils/data-dir.js";
import { executeAgent } from "../services/agents/agent-executor.js";
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
import { MARI_ASSISTANT_PROMPT } from "../db/seed-mari.js";
import { executeKnowledgeRetrieval } from "../services/agents/knowledge-retrieval.js";
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
  parseExtra,
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
import {
  buildGmSystemPrompt,
  buildGmFormatReminder,
  type GmPromptContext,
  type GameReadablePromptEntry,
} from "../services/game/gm-prompts.js";
import { syncGameMapPartyPosition } from "../services/game/map-position.service.js";
import { applyAllSegmentEdits, stripGmCommandTags } from "../services/game/segment-edits.js";
import { listPartySprites } from "../services/game/sprite.service.js";
import {
  generatePerceptionHints,
  formatPerceptionHints,
  type PerceptionContext,
} from "../services/game/perception.service.js";
import { getMoraleTier, formatMoraleContext } from "../services/game/morale.service.js";
import type { GameMap, GameNpc } from "@marinara-engine/shared";
import { sidecarModelService } from "../services/sidecar/sidecar-model.service.js";

function sanitizeConnectedGameTranscript(content: string): string {
  return stripGmCommandTags(content)
    .replace(/^\[(?:To the party|To the GM)\]\s*/i, "")
    .trim();
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
  const filename = avatarPath.split("/").pop();
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

    // Resolve the chat
    const chat = await chats.getById(input.chatId);
    if (!chat) {
      return reply.status(404).send({ error: "Chat not found" });
    }

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

      // ── Conversation-start filter: find the latest "isConversationStart" marker ──
      let startIdx = 0;
      for (let i = allChatMessages.length - 1; i >= 0; i--) {
        const extra = parseExtra(allChatMessages[i]!.extra);
        if (extra.isConversationStart) {
          startIdx = i;
          break;
        }
      }
      let chatMessages = startIdx > 0 ? allChatMessages.slice(startIdx) : allChatMessages;
      let lorebookKeeperMessages = startIdx > 0 ? allChatMessages.slice(startIdx) : allChatMessages;
      let regenMsg;

      // ── Regeneration as swipe: exclude the target message from context ──
      if (input.regenerateMessageId) {
        regenMsg = chatMessages.find((m: any) => m.id === input.regenerateMessageId);
        if (!regenMsg) return reply.code(404).send({ error: "Regenerated message not found" });
        chatMessages = chatMessages.filter((m: any) => m.id !== input.regenerateMessageId);
        lorebookKeeperMessages = lorebookKeeperMessages.filter((m: any) => m.id !== input.regenerateMessageId);
      }

      // ── Context message limit (from chat metadata, off by default) ──
      const chatMeta = parseExtra(chat.metadata) as Record<string, unknown>;
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
        // For Google connections, carry stored Gemini parts (thought signatures) on assistant messages
        const geminiParts =
          isGoogleProvider && m.role === "assistant" && extra.geminiParts
            ? { providerMetadata: { geminiParts: extra.geminiParts } }
            : {};

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
          ...geminiParts,
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
      let personaName = "User";
      let personaDescription = "";
      let personaFields: { personality?: string; scenario?: string; backstory?: string; appearance?: string } = {};
      const allPersonas = await chars.listPersonas();
      const chatMode = (chat.mode as string) ?? "roleplay";

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
      const presetId = (chat.promptPresetId as string | null) ?? undefined;
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

      // ── Compute chat embedding for semantic lorebook matching (if any entries are vectorized) ──
      sendProgress("embedding");
      const _tEmbed = Date.now();
      let chatContextEmbedding: number[] | null = null;
      try {
        const activeEntries = await lorebooksStore.listActiveEntries({
          chatId: input.chatId,
          characterIds,
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
            characterIds,
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

          const presetMaxContext = assembled.parameters.useMaxContext
            ? knownModelContext
            : normalizeMaxContext(assembled.parameters.maxContext);
          effectiveMaxContext = minContextLimit(effectiveMaxContext, presetMaxContext);

          // Persist updated per-chat entry state overrides (ephemeral countdown)
          if (assembled.updatedEntryStateOverrides) {
            chatMeta.entryStateOverrides = assembled.updatedEntryStateOverrides;
            await chats.updateMetadata(input.chatId, chatMeta);
          }
        }
      }

      // ── Conversation mode: inject built-in DM-style system prompt when no preset ──
      let convoAwarenessBlock: string | null = null;
      if (!presetId && chatMode === "conversation") {
        // Gather character names and status for the prompt.
        // If schedules exist in chat metadata, derive status dynamically.
        const schedules: Record<string, import("../services/conversation/schedule.service.js").WeekSchedule> =
          (chatMeta.characterSchedules as any) ?? {};
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

        // ── Offline skip: if ALL characters are offline, don't generate ──
        // The user message is already saved. When the character comes back online,
        // the autonomous messaging system will trigger a catch-up generation.
        const allOffline = convoCharInfo.length > 0 && convoCharInfo.every((c) => c.status === "offline");
        if (allOffline && !input.regenerateMessageId && !input.impersonate) {
          reply.raw.write(`data: ${JSON.stringify({ type: "offline", characters: convoCharNames })}\n\n`);
          reply.raw.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          reply.raw.end();
          return;
        }

        // ── Typing delay: DND/idle characters don't respond instantly ──
        if (!input.regenerateMessageId && !input.impersonate) {
          const schedSvc = await import("../services/conversation/schedule.service.js");
          // Check if any characters were @mentioned
          const mentionedNames = new Set((input.mentionedCharacterNames ?? []).map((n: string) => n.toLowerCase()));
          const hasMentions = mentionedNames.size > 0;
          // Use the "worst" (longest-delay) status among all characters
          const worstStatus = convoCharInfo.reduce((worst, c) => {
            const rank = { online: 0, idle: 1, dnd: 2, offline: 3 } as Record<string, number>;
            return (rank[c.status] ?? 0) > (rank[worst] ?? 0) ? c.status : worst;
          }, "online");
          // If user @mentioned a character, use reduced mention delay instead.
          // Otherwise use the slowest configured delay among the responding characters.
          const delayMs = hasMentions
            ? schedSvc.getMentionDelay(worstStatus as "online" | "idle" | "dnd" | "offline")
            : convoCharInfo.reduce((maxDelay, character) => {
                const schedule = schedules[character.charId];
                return Math.max(
                  maxDelay,
                  schedSvc.getDirectMessageDelay(character.status as "online" | "idle" | "dnd" | "offline", schedule),
                );
              }, 0);
          if (delayMs > 0) {
            // Send "delayed" event first — client shows "will respond in a moment" / "when they're back"
            reply.raw.write(
              `data: ${JSON.stringify({ type: "delayed", characters: convoCharNames, status: worstStatus, delayMs })}\n\n`,
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
          reply.raw.write(`data: ${JSON.stringify({ type: "typing", characters: convoCharNames })}\n\n`);
        }

        // For regenerations, skip the delay but still send the typing indicator
        if (input.regenerateMessageId) {
          reply.raw.write(`data: ${JSON.stringify({ type: "typing", characters: convoCharNames })}\n\n`);
        }

        const isGroup = convoCharNames.length > 1;

        // Inject timestamps: today's messages get [HH:MM] per message,
        // older messages are grouped by date inside <date="DD.MM.YYYY"> blocks.
        const now = new Date();
        const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

        const isSameDay = (ts: Date) => `${ts.getFullYear()}-${ts.getMonth()}-${ts.getDate()}` === todayKey;

        const fmtDate = (ts: Date) =>
          `${String(ts.getDate()).padStart(2, "0")}.${String(ts.getMonth() + 1).padStart(2, "0")}.${ts.getFullYear()}`;
        const fmtTime = (ts: Date) =>
          `${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}`;

        // Strip leaked [HH:MM] or [DD.MM.YYYY] timestamps that models sometimes echo
        const stripLeakedTimestamps = (text: string) =>
          text
            .replace(/^(\s*\[\d{1,2}[:.]\d{2}\]\s*)+/gm, "")
            .replace(/^(\s*\[\d{1,2}\.\d{1,2}\.\d{4}\]\s*)+/gm, "")
            .trim();

        // Build character name lookup for past-day author attribution
        const charIdToName = new Map<string, string>();
        for (let ci = 0; ci < characterIds.length; ci++) {
          if (convoCharInfo[ci]) charIdToName.set(characterIds[ci]!, convoCharInfo[ci]!.name);
        }

        // Separate into past-day groups and today's messages, preserving order
        type BucketMsg = { role: string; content: string; author: string };
        type Bucket = { date: string; msgs: BucketMsg[] };
        const buckets: Array<Bucket | { role: string; content: string }> = [];
        let currentBucket: Bucket | null = null;

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
            buckets.push({ ...msg, content: `[${fmtTime(ts)}] ${stripLeakedTimestamps(msg.content)}` });
          } else {
            const dateKey = fmtDate(ts);
            if (currentBucket && currentBucket.date === dateKey) {
              currentBucket.msgs.push({ ...msg, content: stripLeakedTimestamps(msg.content), author });
            } else {
              if (currentBucket) buckets.push(currentBucket);
              currentBucket = {
                date: dateKey,
                msgs: [{ ...msg, content: stripLeakedTimestamps(msg.content), author }],
              };
            }
          }
        }
        if (currentBucket) buckets.push(currentBucket);

        // ── Auto-summarize all past days (any day before today) ──
        // Each summary includes a narrative recap and a list of key details the
        // characters must remember going forward (promises, plans, unresolved topics, etc.).
        type DaySummaryEntry = { summary: string; keyDetails: string[] };
        const rawDaySummaries: Record<string, string | DaySummaryEntry> =
          (chatMeta.daySummaries as Record<string, string | DaySummaryEntry>) ?? {};

        // Normalize legacy string-only summaries → { summary, keyDetails: [] }
        const daySummaries: Record<string, DaySummaryEntry> = {};
        for (const [k, v] of Object.entries(rawDaySummaries)) {
          if (typeof v === "string") {
            daySummaries[k] = { summary: v, keyDetails: [] };
          } else {
            daySummaries[k] = v;
          }
        }
        let summariesChanged = false;

        // Parse DD.MM.YYYY → Date for age comparison
        const parseDateKey = (d: string) => {
          const [dd, mm, yyyy] = d.split(".");
          return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
        };

        // Collect past-day buckets that haven't been summarized yet (anything before today)
        const bucketsToSummarize: Bucket[] = [];
        for (const b of buckets) {
          if (!("date" in b && "msgs" in b)) continue;
          const bucket = b as Bucket;
          const bucketDate = parseDateKey(bucket.date);
          // Skip today and already-summarized days
          if (isSameDay(bucketDate) || daySummaries[bucket.date]) continue;
          bucketsToSummarize.push(bucket);
        }

        // Summarize each unsummarized past day (in parallel for speed)
        // Wrapped with a 5-minute timeout so a slow provider can't block the main generation.
        const SUMMARY_TIMEOUT = 300_000;
        const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
          Promise.race([
            promise,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Summary timeout")), ms)),
          ]);

        // Keys newly produced in this generation — persisted via key-level merge so
        // concurrent user edits to other entries aren't clobbered when we write back.
        const newlyGeneratedDays: Record<string, DaySummaryEntry> = {};
        const newlyConsolidatedWeeks: Record<string, { summary: string; keyDetails: string[] }> = {};

        if (bucketsToSummarize.length > 0) {
          const summaryProvider = createLLMProvider(
            conn.provider,
            baseUrl,
            conn.apiKey,
            conn.maxContext,
            conn.openrouterProvider,
            conn.maxTokensOverride,
          );
          const summaryResults = await Promise.allSettled(
            bucketsToSummarize.map(async (bucket) => {
              const chatLog = bucket.msgs.map((m) => `${m.author}: ${m.content}`).join("\n");
              const result = await withTimeout(
                summaryProvider.chatComplete(
                  [
                    {
                      role: "system" as const,
                      content: [
                        `You are a conversation memory assistant. You will receive a full day's DM conversation from ${bucket.date}.`,
                        `Produce a JSON object with two fields:`,
                        ``,
                        `1. "summary" — A brief narrative paragraph (2-4 sentences, third person) covering what happened: topics discussed, key moments, emotional tone, and important exchanges.`,
                        ``,
                        `2. "keyDetails" — An array of short, specific strings listing things the characters MUST remember going forward. Include:`,
                        `   - Promises or commitments made ("Alice promised to call Bob tomorrow morning")`,
                        `   - Plans or appointments ("They agreed to watch a movie together on Friday")`,
                        `   - Unresolved questions or topics left hanging ("Bob asked about Alice's job interview — she said she'd tell him later")`,
                        `   - Emotional events that would affect future interactions ("Alice confided she's been feeling lonely lately")`,
                        `   - New information revealed ("Bob mentioned he has a sister named Clara")`,
                        `   - Requests or things someone said they'd do ("Alice said she'd send the recipe")`,
                        `   If nothing important needs to be carried forward, use an empty array.`,
                        ``,
                        `Respond with ONLY valid JSON. No markdown fences, no extra text.`,
                        `Example: { "summary": "Alice and Bob caught up after work...", "keyDetails": ["Alice promised to send Bob the recipe for pasta", "They planned to meet for coffee on Saturday"] }`,
                      ].join("\n"),
                    },
                    { role: "user" as const, content: chatLog },
                  ],
                  { model: conn.model, temperature: 0.3, maxTokens: 4096 },
                ),
                SUMMARY_TIMEOUT,
              );
              const raw = (result.content ?? "").trim();
              // Parse the JSON response
              try {
                let jsonStr = raw;
                const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
                if (fenceMatch) jsonStr = fenceMatch[1]!.trim();
                const parsed = JSON.parse(jsonStr);
                return {
                  date: bucket.date,
                  summary: (typeof parsed.summary === "string" ? parsed.summary : raw).trim(),
                  keyDetails: Array.isArray(parsed.keyDetails)
                    ? parsed.keyDetails.filter((d: unknown) => typeof d === "string" && d.trim())
                    : [],
                };
              } catch {
                // Fallback: treat the entire response as a plain summary
                return { date: bucket.date, summary: raw, keyDetails: [] as string[] };
              }
            }),
          );
          for (const r of summaryResults) {
            if (r.status === "fulfilled" && r.value.summary) {
              const entry = {
                summary: r.value.summary,
                keyDetails: r.value.keyDetails,
              };
              daySummaries[r.value.date] = entry;
              newlyGeneratedDays[r.value.date] = entry;
              summariesChanged = true;
            }
          }
          // Persist new summaries via key-level merge against fresh metadata, so a
          // concurrent user edit to a different day is not clobbered.
          if (summariesChanged) {
            const freshChat = await chats.getById(input.chatId);
            const freshMeta = freshChat
              ? typeof freshChat.metadata === "string"
                ? JSON.parse(freshChat.metadata)
                : (freshChat.metadata ?? {})
              : chatMeta;
            const updatedMeta = {
              ...freshMeta,
              daySummaries: { ...(freshMeta.daySummaries ?? {}), ...newlyGeneratedDays },
            };
            await chats.updateMetadata(input.chatId, updatedMeta);
          }
        }

        // ── Weekly consolidation: roll completed weeks into a single week summary ──
        // A week is Monday→Sunday. Once the entire week is in the past (today >= next Monday),
        // all individual day summaries from that week are merged into one week summary.
        type WeekSummaryEntry = { summary: string; keyDetails: string[] };
        const weekSummaries: Record<string, WeekSummaryEntry> =
          (chatMeta.weekSummaries as Record<string, WeekSummaryEntry>) ?? {};

        // Helper: get the Monday (start) of a date's ISO week
        const getWeekMonday = (d: Date) => {
          const day = d.getDay(); // 0=Sun,1=Mon,...
          const diff = day === 0 ? -6 : 1 - day; // shift to Monday
          const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
          return monday;
        };
        const fmtDateKey = (d: Date) =>
          `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

        // Group summarized days by their week-Monday key
        const daysByWeek = new Map<string, { dateKey: string; entry: DaySummaryEntry }[]>();
        for (const [dateKey, entry] of Object.entries(daySummaries)) {
          const d = parseDateKey(dateKey);
          const monday = getWeekMonday(d);
          const weekKey = fmtDateKey(monday);
          if (!daysByWeek.has(weekKey)) daysByWeek.set(weekKey, []);
          daysByWeek.get(weekKey)!.push({ dateKey, entry });
        }

        // Determine which weeks are complete (Sunday is in the past)
        const weeksToConsolidate: { weekKey: string; days: { dateKey: string; entry: DaySummaryEntry }[] }[] = [];
        for (const [weekKey, days] of daysByWeek) {
          if (weekSummaries[weekKey]) continue; // already consolidated
          const monday = parseDateKey(weekKey);
          const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
          if (now.getTime() >= nextMonday.getTime()) {
            // This week is fully in the past — consolidate
            weeksToConsolidate.push({ weekKey, days });
          }
        }

        let weekSummariesChanged = false;
        if (weeksToConsolidate.length > 0) {
          const weekProvider = createLLMProvider(
            conn.provider,
            baseUrl,
            conn.apiKey,
            conn.maxContext,
            conn.openrouterProvider,
            conn.maxTokensOverride,
          );
          const weekResults = await Promise.allSettled(
            weeksToConsolidate.map(async ({ weekKey, days }) => {
              // Sort days chronologically within the week
              days.sort((a, b) => parseDateKey(a.dateKey).getTime() - parseDateKey(b.dateKey).getTime());
              const monday = parseDateKey(weekKey);
              const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
              const rangeLabel = `${weekKey} – ${fmtDateKey(sunday)}`;

              // Build the input: each day's summary + key details
              const dayBlocks = days.map((d) => {
                let block = `[${d.dateKey}]\n${d.entry.summary}`;
                if (d.entry.keyDetails.length > 0) {
                  block += `\nKey details: ${d.entry.keyDetails.join("; ")}`;
                }
                return block;
              });

              const result = await withTimeout(
                weekProvider.chatComplete(
                  [
                    {
                      role: "system" as const,
                      content: [
                        `You are a conversation memory assistant. You will receive daily conversation summaries for the week of ${rangeLabel}.`,
                        `Produce a JSON object with two fields:`,
                        ``,
                        `1. "summary" — A cohesive narrative paragraph (3-6 sentences, third person) covering the week: major topics, relationship developments, emotional arc, and significant events. Weave the days together naturally — don't just list each day separately.`,
                        ``,
                        `2. "keyDetails" — A consolidated array of short, specific strings listing things the characters MUST still remember going forward. Review the daily key details and:`,
                        `   - KEEP details that are still relevant (upcoming plans, ongoing commitments, unresolved topics)`,
                        `   - MERGE duplicates or evolving items into their latest state`,
                        `   - DROP details that were already resolved during the week (e.g. "promised to send recipe" if it was sent later that week)`,
                        `   - ADD any overarching patterns or relationship developments worth remembering`,
                        ``,
                        `Respond with ONLY valid JSON. No markdown fences, no extra text.`,
                      ].join("\n"),
                    },
                    { role: "user" as const, content: dayBlocks.join("\n\n") },
                  ],
                  { model: conn.model, temperature: 0.3, maxTokens: 4096 },
                ),
                SUMMARY_TIMEOUT,
              );
              const raw = (result.content ?? "").trim();
              try {
                let jsonStr = raw;
                const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
                if (fenceMatch) jsonStr = fenceMatch[1]!.trim();
                const parsed = JSON.parse(jsonStr);
                return {
                  weekKey,
                  summary: (typeof parsed.summary === "string" ? parsed.summary : raw).trim(),
                  keyDetails: Array.isArray(parsed.keyDetails)
                    ? parsed.keyDetails.filter((d: unknown) => typeof d === "string" && d.trim())
                    : [],
                };
              } catch {
                return { weekKey, summary: raw, keyDetails: [] as string[] };
              }
            }),
          );
          for (const r of weekResults) {
            if (r.status === "fulfilled" && r.value.summary) {
              const entry = {
                summary: r.value.summary,
                keyDetails: r.value.keyDetails,
              };
              weekSummaries[r.value.weekKey] = entry;
              newlyConsolidatedWeeks[r.value.weekKey] = entry;
              weekSummariesChanged = true;
            }
          }
          if (weekSummariesChanged) {
            const freshChat = await chats.getById(input.chatId);
            const freshMeta = freshChat
              ? typeof freshChat.metadata === "string"
                ? JSON.parse(freshChat.metadata)
                : (freshChat.metadata ?? {})
              : chatMeta;
            const updatedMeta = {
              ...freshMeta,
              daySummaries: { ...(freshMeta.daySummaries ?? {}), ...newlyGeneratedDays },
              weekSummaries: { ...(freshMeta.weekSummaries ?? {}), ...newlyConsolidatedWeeks },
            };
            await chats.updateMetadata(input.chatId, updatedMeta);
          }
        }

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

        // Flatten: consolidated weeks → single <summary week="..."> block,
        // non-consolidated summarized days → <summary date="..."> block,
        // today → individual timestamped messages
        const weekBlocksEmitted = new Set<string>();
        finalMessages = buckets.flatMap((b) => {
          if ("date" in b && "msgs" in b) {
            const bucket = b as Bucket;
            const weekKey = dayToWeek.get(bucket.date);

            // Day belongs to a consolidated week → emit one week summary block (first occurrence)
            if (weekKey && weekSummaries[weekKey]) {
              if (weekBlocksEmitted.has(weekKey)) return []; // already emitted for this week
              weekBlocksEmitted.add(weekKey);
              const wEntry = weekSummaries[weekKey]!;
              const monday = parseDateKey(weekKey);
              const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
              // Key details are surfaced separately via <important_memories> in the system prompt.
              return [
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
                {
                  role: "system" as const,
                  content: `<summary date="${bucket.date}">\n${entry.summary}\n</summary>`,
                },
              ];
            }
            // Unsummarized day (today) — keep each message as its own turn
            return bucket.msgs.map((m, idx) => {
              let content = `${m.author}: ${m.content}`;
              if (idx === 0) content = `<date="${bucket.date}">\n${content}`;
              if (idx === bucket.msgs.length - 1) content = `${content}\n</date>`;
              return { role: m.role as "user" | "assistant" | "system", content };
            });
          }
          return [b as { role: "system" | "user" | "assistant"; content: string }];
        });

        // Build the system prompt
        // Use custom system prompt if set, otherwise the built-in default
        const customPrompt =
          typeof chatMeta.customSystemPrompt === "string" && chatMeta.customSystemPrompt.trim()
            ? (chatMeta.customSystemPrompt as string)
            : null;

        let conversationSystemPrompt: string;
        // Resolve group mode early — conversations always use merged
        const earlyGroupMode =
          chatMode === "conversation" ? "merged" : ((chatMeta.groupChatMode as string) ?? "merged");
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
            `Reminder: these are optional hidden commands you may use if you wish to. The user won't see the commands themselves; they are silently processed by the system. Only use them when they genuinely fit the conversation:`,
            ``,
            `1. SCHEDULE UPDATE — Change your own status/activity. Use this when the user asks you to stop what you're doing, or when you decide to change your plans.`,
            `   Format: [schedule_update: status="online", activity="free time"]`,
            `   Valid statuses: online, idle, dnd, offline`,
            `   Optional duration: [schedule_update: status="dnd", activity="studying", duration="2h"]`,
            `   Example: If someone asks you to quit working and hang out, you can respond with your message AND include [schedule_update: status="online", activity="hanging out with ${personaName}"]`,
            ``,
          ];

          if (crossPostTargets.length > 0) {
            commandLines.push(
              `2. CROSS-POST — Redirect your message to a different chat. Use this when the user suggests you say something in another chat, or when it makes sense to message someone else.`,
              `   Format: [cross_post: target="chat name"]`,
              `   Available targets: ${crossPostTargets.map((t) => `"${t}"`).join(", ")}`,
              `   Your message will be posted in the target chat instead. Include the command anywhere in your message.`,
              `   Example: "${personaName}" says "maybe ask about that in the group chat?" → You respond: [cross_post: target="${crossPostTargets[0] ?? "group chat"}"] hey guys, does anyone know about...`,
              ``,
            );
          }

          if (hasImageGen) {
            commandLines.push(
              `${crossPostTargets.length > 0 ? "3" : "2"}. SELFIE — Send a photo of yourself. Use this when the user asks for a selfie, photo, or pic, or when you want to share what you look like right now.`,
              `   Format: [selfie] or [selfie: context="description of what the selfie shows"]`,
              `   The system will generate an image based on your appearance and the context. You can add a caption alongside the command.`,
              `   Example: "here u go 😊 [selfie: context="smiling at the camera, sitting at a cafe"]"`,
              ``,
            );
          }

          // Memory command — only available when there are valid targets (characters in shared group chats)
          if (memoryTargetNames.length > 0) {
            const memoryNum = 1 + 1 + (crossPostTargets.length > 0 ? 1 : 0) + (hasImageGen ? 1 : 0);
            commandLines.push(
              `${memoryNum}. MEMORY — Create a memory that another character will remember. Use this when something notable happens between you and another character that they would naturally remember (e.g., shared a meal, had an argument, made plans). Don't overuse this — only for genuinely memorable moments.`,
              `   Format: [memory: target="character name", summary="brief description of what happened"]`,
              `   Available targets: ${memoryTargetNames.map((n) => `"${n}"`).join(", ")}`,
              `   Example: [memory: target="${memoryTargetNames[0]}", summary="watched a movie together and argued about the ending"]`,
              `   The target character will naturally recall this memory in future conversations. Memories last for the day.`,
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
              `${sceneNum}. SCENE — Initiate a mini-roleplay scene branching from this conversation. The system will plan and create a complete immersive scene for you.`,
              `   Format: [scene: scenario="brief description of what happens in this scene"]`,
              `   Optional background: [scene: scenario="having dinner at an Italian restaurant", background="restaurant"]`,
              `   The scenario is a brief description of the scene setup. The system will handle all other details (first message, system prompt, writing style, etc.) automatically.`,
              `   Example: You agree to go stargazing → include [scene: scenario="lying on a blanket in the park, looking at the stars together"]`,
              `   WHEN TO USE: You SHOULD proactively trigger a scene whenever the conversation naturally leads to an activity, outing, or situation that would be more immersive as a scene. Examples:`,
              `   - {{user}} says "I'm coming over" or "Let's go to the park" → trigger a scene for arriving/being at that location.`,
              `   - You invite {{user}} somewhere and they accept → trigger a scene for that activity.`,
              `   - A plan is made (date, trip, hangout, confrontation) and the moment arrives → trigger a scene.`,
              `   - Any significant in-person interaction that would benefit from immersive narration (cooking together, exploring, training, etc.).`,
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
                `${hapticNum}. HAPTIC — Control the user's connected intimate device(s) (${deviceNames}). Use this during physical/intimate/sensual moments to provide haptic feedback that matches the narrative. Vary intensity based on the scene.`,
                `   Format: [haptic: action="vibrate", intensity=0.5, duration=3]`,
                `   Actions: vibrate, oscillate, rotate, position, stop`,
                `   intensity: 0.0 (off) to 1.0 (max). duration: seconds (0 = until next command).`,
                `   You can include multiple [haptic] commands in one message for patterns (e.g., escalating: 0.2 → 0.5 → 0.8).`,
                `   Use [haptic: action="stop"] to stop all output.`,
                `   Example: *trails a finger slowly down your arm* [haptic: action="vibrate", intensity=0.3, duration=2]`,
                ``,
              );
            }
          }

          commandLines.push(
            `IMPORTANT: Commands are stripped from your message before the user sees it. The rest of your message is shown normally. You can include multiple commands in one message, but you do not need to use any of them unless it makes sense in context.`,
            `</commands>`,
          );

          conversationCommandsReminder = commandLines.join("\n");
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

        const contextBlock = [
          `<context>`,
          `Your current status: ${statusLine}.`,
          `${personaName}'s status: ${userStatusLabel}.`,
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
            activeLorebookIds: chatActiveLorebookIds,
            chatEmbedding: chatContextEmbedding,
            entryStateOverrides:
              (chatMeta.entryStateOverrides as Record<string, { ephemeral?: number | null; enabled?: boolean }>) ??
              undefined,
          });

          // Persist updated per-chat entry state overrides (ephemeral countdown)
          if (lorebookResult.updatedEntryStateOverrides) {
            chatMeta.entryStateOverrides = lorebookResult.updatedEntryStateOverrides;
            await chats.updateMetadata(input.chatId, chatMeta);
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
            finalMessages = injectAtDepth(finalMessages, lorebookResult.depthEntries);
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
          activeLorebookIds: chatActiveLorebookIds,
          chatEmbedding: chatContextEmbedding,
          entryStateOverrides:
            (chatMeta.entryStateOverrides as Record<string, { ephemeral?: number | null; enabled?: boolean }>) ??
            undefined,
        });

        if (lorebookResult.updatedEntryStateOverrides) {
          chatMeta.entryStateOverrides = lorebookResult.updatedEntryStateOverrides;
          await chats.updateMetadata(input.chatId, chatMeta);
        }
        const loreContent = [lorebookResult.worldInfoBefore, lorebookResult.worldInfoAfter]
          .filter(Boolean)
          .join("\n");
        if (loreContent) {
          const loreBlock = `<lore>\n${loreContent}\n</lore>`;
          const firstUserIdx = finalMessages.findIndex((m) => m.role === "user" || m.role === "assistant");
          const insertAt = firstUserIdx >= 0 ? firstUserIdx : finalMessages.length;
          finalMessages.splice(insertAt, 0, { role: "system" as const, content: loreBlock });
        }
        if (lorebookResult.depthEntries.length > 0) {
          finalMessages = injectAtDepth(finalMessages, lorebookResult.depthEntries);
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
          const influenceLines = pendingInfluences.map((inf: any) => `- ${inf.content}`);
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

          // Mark influences as consumed
          for (const inf of pendingInfluences) {
            await chats.markInfluenceConsumed(inf.id);
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

      // ── Per-chat parameter overrides (from Chat Settings → Advanced Parameters) ──
      const chatParams = chatMeta.chatParameters as Record<string, unknown> | undefined;

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

      if (chatParams) {
        if (typeof chatParams.temperature === "number") temperature = chatParams.temperature;
        if (typeof chatParams.maxTokens === "number") maxTokens = chatParams.maxTokens;
        topP = normalizeChatTopP(chatParams.topP) ?? topP;
        if (typeof chatParams.topK === "number") topK = chatParams.topK;
        if (typeof chatParams.frequencyPenalty === "number") frequencyPenalty = chatParams.frequencyPenalty;
        if (typeof chatParams.presencePenalty === "number") presencePenalty = chatParams.presencePenalty;
        if (chatParams.reasoningEffort !== undefined)
          reasoningEffort = chatParams.reasoningEffort as typeof reasoningEffort;
        if (chatParams.verbosity !== undefined) verbosity = chatParams.verbosity as typeof verbosity;
      }

      // Resolve "maximum" reasoning effort to the highest level for the current model.
      // GPT-5.4 and Claude Opus 4.7+ support "xhigh" — all others get "high".
      let resolvedEffort: "low" | "medium" | "high" | "xhigh" | null =
        reasoningEffort !== "maximum" ? reasoningEffort : null;
      if (reasoningEffort === "maximum") {
        const modelLower = (conn.model ?? "").toLowerCase();
        const supportsXhigh = modelLower.startsWith("gpt-5.4") || /claude-opus-4-(?:[7-9]|\d{2,})/.test(modelLower);
        resolvedEffort = supportsXhigh ? "xhigh" : "high";
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
      agentProviderCache.set(LOCAL_SIDECAR_CONNECTION_ID, {
        provider: getLocalSidecarProvider(),
        model: LOCAL_SIDECAR_MODEL,
      });

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
        const effectiveConnectionId = cfg.connectionId ?? defaultAgentConn?.id ?? null;
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
        for (const ci of charInfo) {
          // Check if this character already appears by description snippet, XML tag, or markdown heading
          const xmlTag = nameToXmlTag(ci.name);
          const hasCharInfo =
            (ci.description && allContent.includes(ci.description.split("\n")[0]!.trim().slice(0, 80))) ||
            allContent.includes(`<${xmlTag}>`) ||
            allContent.includes(`<${ci.name}>`) ||
            new RegExp(`^#{1,6} ${ci.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(allContent);
          if (!hasCharInfo && ci.description) {
            const fieldParts = wrapFields(
              {
                description: ci.description,
                personality: ci.personality,
                scenario: ci.scenario,
                backstory: ci.backstory,
                appearance: ci.appearance,
                system_prompt: ci.systemPrompt,
                example_dialogue: ci.mesExample,
                post_history_instructions: ci.postHistoryInstructions,
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
                description: personaDescription,
                personality: personaFields.personality,
                backstory: personaFields.backstory,
                appearance: personaFields.appearance,
                scenario: personaFields.scenario,
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
        const setupConfig = chatMeta.gameSetupConfig as Record<string, unknown> | null;
        const gameActiveState = (chatMeta.gameActiveState as string) || "exploration";
        const sessionNumber = (chatMeta.gameSessionNumber as number) || 1;
        const storyArc = (chatMeta.gameStoryArc as string) || null;
        const plotTwists = (chatMeta.gamePlotTwists as string[]) || null;
        const gameMap = (chatMeta.gameMap as import("@marinara-engine/shared").GameMap) || null;
        const gameNpcs = (chatMeta.gameNpcs as import("@marinara-engine/shared").GameNpc[]) || [];
        const sessionSummaries =
          (chatMeta.gamePreviousSessionSummaries as import("@marinara-engine/shared").SessionSummary[]) || [];
        const gameJournal = (chatMeta.gameJournal as Journal | null) ?? createJournal();
        const knownReadables: GameReadablePromptEntry[] = gameJournal.entries
          .filter((entry) => entry.type === "note")
          .slice(-8)
          .map((entry) => ({
            title: typeof entry.title === "string" ? entry.title : "Note",
            content: typeof entry.content === "string" ? entry.content : "",
          }))
          .filter((entry) => entry.content.trim().length > 0);
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
        const partyCharIds = (chatMeta.gamePartyCharacterIds as string[]) || characterIds;
        const partyNames: string[] = [];
        const partyCards: Array<{ name: string; card: string }> = [];
        const partyIdNamePairs: Array<{ id: string; name: string }> = [];
        // Load game character cards for appending game-specific info
        const gameCharCards = (chatMeta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];
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
          await chats.updateMetadata(input.chatId, chatMeta);
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
          readables: knownReadables.length > 0 ? knownReadables : undefined,
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
          hudWidgets: (chatMeta.gameWidgetState as any[]) ?? (chatMeta.gameBlueprint as any)?.hudWidgets ?? undefined,
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
            activeLorebookIds: chatActiveLorebookIds,
            chatEmbedding: chatContextEmbedding,
            entryStateOverrides:
              (chatMeta.entryStateOverrides as Record<string, { ephemeral?: number | null; enabled?: boolean }>) ??
              undefined,
          });

          if (lorebookResult.updatedEntryStateOverrides) {
            chatMeta.entryStateOverrides = lorebookResult.updatedEntryStateOverrides;
            await chats.updateMetadata(input.chatId, chatMeta);
          }
          const loreContent = [lorebookResult.worldInfoBefore, lorebookResult.worldInfoAfter]
            .filter(Boolean)
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
            finalMessages = injectAtDepth(finalMessages, lorebookResult.depthEntries);
          }
        }

        // LOG_LEVEL=debug: log game-mode prompt details
        if (isDebug) {
          app.log.debug(
            "[debug/game] GM prompt length: %d chars, messages: %d",
            finalMessages[0]?.content.length ?? 0,
            finalMessages.length,
          );
          app.log.debug(
            "[debug/game] GM context: storyArc=%s, map=%s, npcs=%d, widgets=%s, hasSceneModel=%s, state=%s",
            !!gmCtx.storyArc,
            !!gmCtx.map,
            gmCtx.npcs.length,
            !!gmCtx.hudWidgets?.length,
            gmCtx.hasSceneModel,
            gmCtx.gameActiveState,
          );
          for (const msg of finalMessages) {
            app.log.debug("[debug/game] [%s] %s", msg.role.toUpperCase(), msg.content);
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
        const formatReminder = buildGmFormatReminder({
          hasSceneModel,
          hudWidgets: gmCtx.hudWidgets,
          turnNumber: gameTurnNumber,
          gameActiveState: gameActiveState as import("@marinara-engine/shared").GameActiveState,
          sessionNumber,
          gameTime,
          partyNames: gmCtx.partyNames,
          playerName: gmCtx.playerName,
          characterSprites: gmCtx.characterSprites,
          language: gmCtx.language,
          addressMode,
          playerInventory: (() => {
            try {
              const inv = (chatMeta.gameInventory as Array<{ name: string; quantity: number }>) ?? [];
              return inv.length > 0 ? inv : undefined;
            } catch {
              return undefined;
            }
          })(),
        });
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
            // Scope recall: current chat only, plus other conversation-mode chats
            // sharing the same characters (for group conversation chats).
            const recallChatIds = [input.chatId];
            if (chatMode === "conversation" && characterIds.length > 1) {
              const allChats = await app.db
                .select({ id: chatsTable.id, characterIds: chatsTable.characterIds, mode: chatsTable.mode })
                .from(chatsTable);
              const charSet = new Set(characterIds);
              for (const c of allChats) {
                if (c.id === input.chatId || c.mode !== "conversation") continue;
                try {
                  const ids: string[] = JSON.parse(c.characterIds);
                  if (ids.some((id) => charSet.has(id))) recallChatIds.push(c.id);
                } catch {
                  /* skip */
                }
              }
            }
            const recalled = await recallMemories(app.db, lastUserMsg.content, recallChatIds);
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
      // Conversation mode always uses merged — individual mode is not supported there
      const groupChatMode = chatMode === "conversation" ? "merged" : ((chatMeta.groupChatMode as string) ?? "merged");
      // Auto-enable speaker colors for conversation mode groups (system prompt already requests tags)
      const groupSpeakerColors = chatMeta.groupSpeakerColors === true || (chatMode === "conversation" && isGroupChat);
      const groupResponseOrder = (chatMeta.groupResponseOrder as string) ?? "sequential";

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

      // Create the pipeline (exclude editor — it runs last, after all other agents)
      const editorAgent = resolvedAgents.find((a) => a.type === "editor");
      const lorebookKeeperAgent = resolvedAgents.find((a) => a.type === "lorebook-keeper") ?? null;
      let pipelineAgents = resolvedAgents.filter((a) => a.type !== "editor" && a.type !== "lorebook-keeper");

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
      const enableTools = inputBody.enableTools === true || chatMeta.enableTools === true;
      let toolDefs: LLMToolDefinition[] | undefined;
      const customToolDefs: Array<{
        name: string;
        executionType: string;
        webhookUrl: string | null;
        staticResult: string | null;
        scriptBody: string | null;
      }> = [];

      if (enableTools) {
        // Per-chat tool selection (empty = all tools)
        const chatActiveToolIds: string[] = Array.isArray(chatMeta.activeToolIds)
          ? (chatMeta.activeToolIds as string[])
          : [];
        const hasToolFilter = chatActiveToolIds.length > 0;
        const registeredToolSources = new Map<string, "built-in" | "custom">();

        // Built-in tools
        const builtInFiltered = hasToolFilter
          ? BUILT_IN_TOOLS.filter((t) => chatActiveToolIds.includes(t.name))
          : BUILT_IN_TOOLS;
        toolDefs = [];
        for (const t of builtInFiltered) {
          const existingSource = registeredToolSources.get(t.name);
          if (existingSource) {
            throw new Error(`Duplicate tool name "${t.name}" from built-in tool collides with existing ${existingSource} tool`);
          }
          registeredToolSources.set(t.name, "built-in");
          toolDefs.push({
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
        const customFiltered = hasToolFilter
          ? enabledCustomTools.filter((ct: any) => chatActiveToolIds.includes(ct.name))
          : enabledCustomTools;
        for (const ct of customFiltered) {
          const existingSource = registeredToolSources.get(ct.name);
          if (existingSource) {
            throw new Error(`Duplicate tool name "${ct.name}" from custom tool collides with existing ${existingSource} tool`);
          }
          registeredToolSources.set(ct.name, "custom");

          try {
            const schema =
              typeof ct.parametersSchema === "string"
                ? JSON.parse(ct.parametersSchema)
                : ct.parametersSchema;
            if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
              throw new Error("parametersSchema must be a JSON object");
            }

            customToolDefs.push({
              name: ct.name,
              executionType: ct.executionType,
              webhookUrl: ct.webhookUrl,
              staticResult: ct.staticResult,
              scriptBody: ct.scriptBody,
            });

            toolDefs.push({
              type: "function" as const,
              function: {
                name: ct.name,
                description: ct.description,
                parameters: schema as Record<string, unknown>,
              },
            });
          } catch {
            registeredToolSources.delete(ct.name);
            console.warn(`[tools] Skipping custom tool "${ct.name}" with invalid parameter schema`);
          }
        }
      }

      // ── Spotify Token Refresh (Early) ──
      const resolvedToolNames = new Set((toolDefs ?? []).map((td) => td.function.name));
      const spotifyAgent =
        resolvedAgents.find((a) => a.type === "spotify") ??
        enabledConfigs.find((cfg: any) => cfg.type === "spotify") ??
        ((enableTools && !enabledConfigs.some((cfg: any) => cfg.type === "spotify"))
          ? (await agentsStore.list()).find((cfg: any) => cfg.type === "spotify")
          : null);
      let spotifyAccessToken: string | null = null;
      let spotifyExpiresAt = 0;
      if (spotifyAgent) {
        const sSettings =
          typeof spotifyAgent.settings === "string" ? JSON.parse(spotifyAgent.settings) : spotifyAgent.settings || {};
        spotifyAccessToken = (sSettings.spotifyAccessToken as string) || null;
        const spotifyRefreshToken = (sSettings.spotifyRefreshToken as string) || null;
        const spotifyClientId = (sSettings.spotifyClientId as string) || null;
        spotifyExpiresAt = (sSettings.spotifyExpiresAt as number) ?? 0;

        if (
          spotifyRefreshToken &&
          spotifyClientId &&
          (!spotifyAccessToken ||
            (spotifyExpiresAt > 0 && Date.now() > spotifyExpiresAt - 60_000)) // Refresh if missing or 1 min before expiry
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
              // Persist refreshed tokens in background (don't await)
              agentsStore
                .update(spotifyAgent.id, {
                  settings: {
                    ...sSettings,
                    spotifyAccessToken: tokens.access_token,
                    spotifyRefreshToken: tokens.refresh_token ?? spotifyRefreshToken,
                    spotifyExpiresAt: refreshedExpiresAt,
                  },
                })
                .catch(() => {});
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

      // ── Resolve tool context for all agents ──
      // This enables built-in and custom tools for any agent in the pipeline.
      for (const agent of resolvedAgents) {
        if (agent.toolContext) continue;

        const agentSettings = typeof agent.settings === "string" ? JSON.parse(agent.settings) : agent.settings || {};
        const agentEnabledNames =
          (agentSettings?.enabledTools as string[]) || (DEFAULT_AGENT_TOOLS[agent.type] as string[]) || [];
        if (agentEnabledNames.length === 0) continue;

        const agentTools = (toolDefs ?? []).filter((td) => agentEnabledNames.includes(td.function.name));
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
              customTools: customToolDefs,
              spotify: spotifyCreds,
              searchLorebook: searchLorebookForTools,
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
      const SEPARATE_INJECTION_AGENTS = new Set(["knowledge-retrieval"]);
      const EXCLUDED_FROM_PIPELINE = new Set(["html", "knowledge-retrieval"]);
      const hasPreGenAgents = resolvedAgents.some(
        (a) => a.phase === "pre_generation" && !EXCLUDED_FROM_PIPELINE.has(a.type),
      );

      // ── Run pre-gen agents and knowledge retrieval in parallel when possible ──
      const shouldRunKR = !!(
        knowledgeRetrievalAgent &&
        agentContext.memory._knowledgeRetrievalMaterial &&
        !input.regenerateMessageId
      );
      const shouldRunPreGen = hasPreGenAgents && !input.regenerateMessageId;

      if (shouldRunPreGen || shouldRunKR) {
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
        const krPromise = shouldRunKR
          ? (async () => {
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
              const _tKR = Date.now();
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
            })()
          : Promise.resolve(null);

        // Run both in parallel
        const [preGenResult, krResult] = await Promise.all([preGenPromise, krPromise]);
        contextInjections = preGenResult;

        // ── Failure gate: only block generation if a critical pre-gen agent failed ──
        // The secret-plot-driver shapes narrative direction — generating without
        // it would produce incoherent output. Other agents are enhancement-only.
        const preGenResults = pipeline.results.filter((r) => r.agentType !== "knowledge-retrieval");
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
            const krWrapped =
              wrapFormat === "markdown"
                ? `\n\n## Knowledge Retrieval\n${krText}`
                : `\n\n<knowledge_retrieval>\n${krText}\n</knowledge_retrieval>`;
            const lastUserIdx = findLastIndex(finalMessages, "user");
            if (lastUserIdx >= 0) {
              const target = finalMessages[lastUserIdx]!;
              finalMessages[lastUserIdx] = { ...target, content: target.content + krWrapped };
            } else {
              const last = finalMessages[finalMessages.length - 1]!;
              finalMessages[finalMessages.length - 1] = { ...last, content: last.content + krWrapped };
            }
            contextInjections.push({ agentType: "knowledge-retrieval", text: krText });
          }
        }
      } else if (hasPreGenAgents && input.regenerateMessageId) {
        // Regeneration — try to reuse cached context injections from the original generation
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
        } else {
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
              (r) => r.agentType !== "knowledge-retrieval" && r.agentType !== "secret-plot-driver",
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

        if (contextInjections.length > 0) {
          const wrapped = formatAgentInjections(contextInjections, wrapFormat);
          finalMessages = injectAtDepth(finalMessages, [{ content: wrapped, role: "system", depth: 0 }]);
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
        const rawImpersonationDirection = input.userMessage?.trim() ?? "";
        const legacyDirectionMatch = rawImpersonationDirection.match(
          /^\[Impersonation instruction — write \{\{user\}\}'s next response, steering it toward the following:\s*([\s\S]+?)\]$/,
        );
        const impersonationDirection = legacyDirectionMatch
          ? legacyDirectionMatch[1]!.trim()
          : rawImpersonationDirection;
        const impersonateInstruction = [
          `<instruction>`,
          `You are now writing as ${personaName}, the user's character.`,
          `Study ${personaName}'s previous messages in the conversation and replicate their voice, mannerisms, speech patterns, and style as closely as possible.`,
          personaDescription ? `Character description: ${personaDescription}` : "",
          impersonationDirection ? `Additional direction for this reply: ${impersonationDirection}` : "",
          `Write a single in-character response from ${personaName}'s perspective. Do NOT break character or add meta-commentary. Respond exactly as ${personaName} would.`,
          `</instruction>`,
        ]
          .filter(Boolean)
          .join("\n");
        finalMessages.push({ role: "user", content: impersonateInstruction });
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

      // Helper: write text content progressively as small SSE token chunks
      const writeContentChunked = (text: string) => {
        const CHUNK_SIZE = 6;
        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
          const chunk = text.slice(i, i + CHUNK_SIZE);
          fullResponse += chunk;
          trySendSseEvent(reply, { type: "token", data: chunk });
        }
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
              : [...characterIds] // smart: placeholder, same as sequential for now
        : [characterIds[0] ?? null];

      /** Generate a single response for a given character and save it. */
      const generateForCharacter = async (
        targetCharId: string | null,
        messagesForGen: Array<{
          role: "system" | "user" | "assistant";
          content: string;
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
        // Convert mid-prompt system messages to user role.
        // The assembler enforces SYSTEM → user/assistant alternation, but
        // post-assembler injections (agents, lorebook depth, author notes,
        // OOC influences) insert system messages that break this pattern.
        // Preserve only the leading system block; everything else becomes user.
        let pastLeadingSystem = false;
        messagesForGen = messagesForGen.map((m) => {
          if (!pastLeadingSystem) {
            if (m.role !== "system") pastLeadingSystem = true;
            return m;
          }
          if (m.role === "system") return { ...m, role: "user" as const };
          return m;
        });

        // Merge adjacent same-role messages (especially system) before sending to provider
        messagesForGen = mergeAdjacentMessages(messagesForGen as any) as typeof messagesForGen;

        // Collapse 3+ consecutive blank lines in all messages to save tokens
        for (const m of messagesForGen) {
          m.content = m.content.replace(/\n([ \t]*\n){2,}/g, "\n\n");
        }

        const toProviderMessages = (
          promptMessages: Array<{
            role: "system" | "user" | "assistant";
            content: string;
            images?: string[];
            providerMetadata?: Record<string, unknown>;
          }>,
        ): ChatMessage[] =>
          promptMessages.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.images?.length ? { images: message.images } : {}),
            ...(message.providerMetadata ? { providerMetadata: message.providerMetadata } : {}),
          }));

        let finalPromptSent: ChatMessage[] = [];
        let effectiveMaxTokensForSend = maxTokens;
        const fitPromptForSend = (candidateMessages: ChatMessage[]): ChatMessage[] => {
          const fit = fitMessagesToContext(
            candidateMessages,
            { maxContext: effectiveMaxContext, maxTokens },
            connectionMaxContext,
          );
          finalPromptSent = fit.messages;
          effectiveMaxTokensForSend = fit.maxTokens ?? maxTokens;
          return fit.messages;
        };

        const initialProviderMessages = fitPromptForSend(toProviderMessages(messagesForGen));

        // Reset per-character accumulators
        fullResponse = "";
        fullThinking = "";
        let geminiResponseParts: unknown[] | null = null;

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
          // ── LOG_LEVEL=debug: log full prompt to server console ──
          if (isDebug) {
            const effModel = conn.model.toLowerCase();
            const tempSuppressed =
              (conn.provider === "openai" || conn.provider === "openrouter") &&
              (/^(o1|o3|o4)/.test(effModel) || (effModel.startsWith("gpt-5") && !!resolvedEffort));
            const effTemp = tempSuppressed ? "N/A" : temperature;
            const effTopP = tempSuppressed ? "N/A" : topP;

            app.log.debug(
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
              app.log.debug("  [%s] %s", m.role.toUpperCase(), m.content);
            }
          }

          if (enableTools && provider.chatComplete) {
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
                  reasoningEffort: resolvedEffort ?? undefined,
                  verbosity: verbosity ?? undefined,
                  onThinking,
                  onToken: input.streaming ? onToken : undefined,
                  signal: abortController.signal,
                  encryptedReasoningItems: encryptedReasoningCache.get(input.chatId),
                  onEncryptedReasoning: (items) => encryptedReasoningCache.set(input.chatId, items),
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
              });

              const permittedToolCalls = result.toolCalls.filter((call) => resolvedToolNames.has(call.function.name));
              const deniedToolResults = result.toolCalls
                .filter((call) => !resolvedToolNames.has(call.function.name))
                .map((call) => ({
                  toolCallId: call.id,
                  name: call.function.name,
                  result: JSON.stringify({
                    error: `Tool not allowed in this context: ${call.function.name}`,
                    allowed: Array.from(resolvedToolNames),
                  }),
                  success: false,
                }));

              const executedToolResults = await executeToolCalls(permittedToolCalls, {
                customTools: customToolDefs,
                spotify: spotifyCreds,
                searchLorebook: searchLorebookForTools,
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
                  reasoningEffort: resolvedEffort ?? undefined,
                  verbosity: verbosity ?? undefined,
                  onThinking,
                  onToken: input.streaming ? onToken : undefined,
                  signal: abortController.signal,
                  encryptedReasoningItems: encryptedReasoningCache.get(input.chatId),
                  onEncryptedReasoning: (items) => encryptedReasoningCache.set(input.chatId, items),
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
              reasoningEffort: resolvedEffort ?? undefined,
              verbosity: verbosity ?? undefined,
              openrouterProvider: conn.openrouterProvider ?? undefined,
              onThinking,
              onResponseParts: (parts) => {
                geminiResponseParts = parts;
              },
              signal: abortController.signal,
              encryptedReasoningItems: encryptedReasoningCache.get(input.chatId),
              onEncryptedReasoning: (items) => encryptedReasoningCache.set(input.chatId, items),
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

          // ── LOG_LEVEL=debug: log full response + usage to server console ──
          if (isDebug) {
            app.log.debug("[debug] LLM response (%d chars, %dms):\n%s", fullResponse.length, durationMs, fullResponse);
            if (fullThinking) {
              app.log.debug("[debug] Thinking tokens (%d chars):\n%s", fullThinking.length, fullThinking);
            }
            if (usage) {
              app.log.debug(
                "[debug] Token usage — prompt: %s  completion: %s  total: %s  cached: %s  cacheWrite: %s  finish: %s",
                usage.promptTokens ?? "N/A",
                usage.completionTokens ?? "N/A",
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

          // Guard: don't save empty responses — the model returned nothing useful
          if (!fullResponse.trim() && !input.impersonate) {
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
                tokensPrompt: usage?.promptTokens ?? null,
                tokensCompletion: usage?.completionTokens ?? null,
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
      const generationGuideInstruction = normalizedGenerationGuide ? `Take the following into special consideration for your next message: ${normalizedGenerationGuide}` : null;

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
          const charInstruction = `Respond ONLY as ${charName}.`;
          const messagesWithInstruction = [...runningMessages];
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
          const charInstruction = `Respond ONLY as ${targetCharName}.`;
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
              const syncedGameMap = syncGameMapPartyPosition(existingGameMap, newLocation);
              if (syncedGameMap && syncedGameMap !== existingGameMap) {
                chatMeta.gameMap = syncedGameMap;
                await chats.updateMetadata(input.chatId, chatMeta);
                sendSseEvent(reply, { type: "game_map_update", data: syncedGameMap });
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
              for (const char of chars) {
                if (char.avatarPath) continue; // already set
                const name = (char.name as string) ?? "";
                // Try matching against the chat's character cards (case-insensitive)
                const matched = charInfo.find((c) => c.name.toLowerCase() === name.toLowerCase());
                if (matched?.avatarPath) {
                  char.avatarPath = matched.avatarPath;
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
                            width: 512,
                            height: 512,
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
                const existingMeta = parseExtra(chat.metadata);
                const existing = ((existingMeta.summary as string) ?? "").trim();
                const combined = existing ? `${existing}\n\n${newText}` : newText;
                const merged = { ...existingMeta, summary: combined };
                await chats.updateMetadata(input.chatId, merged);
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
            const aspectRatio = ((illData.aspectRatio as string) ?? "portrait").trim();
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

                    // Use selfie resolution from chat metadata if set, otherwise fall back to aspect ratio defaults
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

        // ── Consistency Editor: runs after ALL other agents ──
        if (editorAgent && messageId && !abortController.signal.aborted) {
          try {
            // Collect all successful agent outputs as a summary for the editor
            const agentSummary: Record<string, unknown> = {};
            for (const result of postResults) {
              if (result.success && result.data) {
                agentSummary[result.agentType ?? result.type] = result.data;
              }
            }

            // Build editor context with agent results injected into memory
            const editorContext: AgentContext = {
              ...agentContext,
              mainResponse: combinedResponse,
              memory: { ...agentContext.memory, _agentResults: agentSummary },
            };

            const editorResult = await executeAgent(
              editorAgent,
              editorContext,
              editorAgent.provider,
              editorAgent.model,
            );
            sendAgentEvent(editorResult);

            // Persist the editor run
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

            // Apply text rewrite if the editor made changes
            if (editorResult.success && editorResult.type === "text_rewrite" && editorResult.data) {
              const edData = editorResult.data as Record<string, unknown>;
              const editedText = (edData.editedText as string) ?? "";
              const changes = (edData.changes as Array<{ description: string }>) ?? [];
              if (editedText && changes.length > 0) {
                // Update the saved message in DB
                await chats.updateMessageContent(messageId, editedText);
                // Tell the client to replace the displayed text
                reply.raw.write(`data: ${JSON.stringify({ type: "text_rewrite", data: { editedText, changes } })}\n\n`);
              }
            }
          } catch {
            // Non-critical — don't fail generation if editor errors
          }
        }
      }

      // ────────────────────────────────────────
      // Character Command Execution (Conversation mode)
      // ────────────────────────────────────────
      if (collectedCommands.length > 0 && !abortController.signal.aborted) {
        trySendSseEvent(reply, {
          type: "assistant_commands_start",
          data: { count: collectedCommands.length },
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
                const schedules: Record<string, any> = freshMeta.characterSchedules ?? {};
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
                  const promptResult = await promptBuilder.chatComplete(
                    [
                      {
                        role: "system",
                        content: [
                          `You are an image prompt generator. Create a concise, detailed image generation prompt for a selfie photo.`,
                          `The character's appearance: ${appearance}`,
                          `Character name: ${charName}`,
                          ``,
                          `Generate a prompt that describes a selfie photo of this character. Include:`,
                          `- Physical appearance details (face, hair, eyes, skin)`,
                          `- What they're wearing`,
                          `- Expression and pose (selfie angle)`,
                          `- Setting/background from context`,
                          `- Lighting and mood`,
                          ``,
                          `Infer the appropriate art style from the character. For example, anime/game characters should use anime/illustration style, realistic characters should use photorealistic style. Match the style to the character's origin.`,
                          ...(selfieTags.length > 0
                            ? [``, `Always include these tags/modifiers in the prompt: ${selfieTags.join(", ")}`]
                            : []),
                          `Output ONLY the prompt text, nothing else.`,
                        ].join("\n"),
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

                    // Parse selfie resolution from chat metadata (default 512×768 portrait)
                    const selfieRes = (chatMeta.selfieResolution as string) ?? "512x768";
                    const [selfieW, selfieH] = selfieRes.split("x").map(Number) as [number, number];

                    const serviceHint = imgConnFull.imageService || "";
                    const imageResult = await generateImage(imgModel, imgBaseUrl, imgApiKey, serviceHint || imgSource, {
                      prompt: imagePrompt,
                      model: imgModel,
                      width: selfieW || 512,
                      height: selfieH || 768,
                      comfyWorkflow: imgConnFull.comfyuiWorkflow || undefined,
                    });

                    // Save to disk and DB
                    const filePath = saveImageToDisk(input.chatId, imageResult.base64, imageResult.ext);
                    const galleryEntry = await galleryStore.create({
                      chatId: input.chatId,
                      filePath,
                      prompt: imagePrompt,
                      provider: imgConnFull.provider ?? "image_generation",
                      model: imgModel || "unknown",
                      width: selfieW || 512,
                      height: selfieH || 768,
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
                await chats.createInfluence(input.chatId, connectedId, infCmd.content, messageId);
                logger.info(
                  `[commands] OOC influence queued for connected chat ${connectedId}: "${infCmd.content.slice(0, 80)}..."`,
                );
              } else {
                logger.warn("[commands] Influence command used but no connected chat");
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
                  logger.warn(`[commands] Haptic command [${hapCmd.action}] skipped — Intiface Central not connected`);
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
                  await chars.update(targetChar.id, updates);
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
                    logger.info(`[commands] Assistant created ${mode} chat with "${targetData.name}" (${newChat.id})`);
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
                  const found = allPersonasList.find((p: any) => p.name?.toLowerCase() === fetchCmd.name.toLowerCase());
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
                        const role = msg.role === "assistant" ? (msg.characterId ? "Character" : "Assistant") : "User";
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
                      parts.push(`  [${sec.role}] ${sec.name ?? "Untitled"}: ${(sec.content as string).slice(0, 200)}`);
                    }
                    fetchedContent = parts.join("\n");
                  }
                }

                if (fetchedContent) {
                  // Persist to chatMeta.mariContext so it's available in subsequent messages
                  const currentMeta = parseExtra(chat.metadata) as Record<string, unknown>;
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

  await registerRetryAgentsRoute(app);
}
