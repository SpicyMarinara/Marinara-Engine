// ──────────────────────────────────────────────
// Routes: Generation (SSE Streaming with Tool Use + Agent Pipeline)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { generateRequestSchema, BUILT_IN_TOOLS, BUILT_IN_AGENTS, findKnownModel } from "@marinara-engine/shared";
import type { AgentContext, AgentResult, AgentPhase, APIProvider, GameState } from "@marinara-engine/shared";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createPromptsStorage } from "../services/storage/prompts.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createAgentsStorage } from "../services/storage/agents.storage.js";
import { createGameStateStorage } from "../services/storage/game-state.storage.js";
import { createCustomToolsStorage } from "../services/storage/custom-tools.storage.js";
import { createLorebooksStorage } from "../services/storage/lorebooks.storage.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { assemblePrompt, type AssemblerInput } from "../services/prompt/index.js";
import { wrapContent } from "../services/prompt/format-engine.js";
import type { LLMToolDefinition, ChatMessage, LLMUsage } from "../services/llm/base-provider.js";
import { executeToolCalls } from "../services/tools/tool-executor.js";
import { createAgentPipeline, type ResolvedAgent } from "../services/agents/agent-pipeline.js";
import { executeAgent } from "../services/agents/agent-executor.js";
import { gameStateSnapshots as gameStateSnapshotsTable } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { PROVIDERS } from "@marinara-engine/shared";

// ── Helpers ──

type SimpleMessage = { role: "system" | "user" | "assistant"; content: string };

/** Find last message index matching a role (or predicate). Returns -1 if not found. */
function findLastIndex(messages: SimpleMessage[], role: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === role) return i;
  }
  return -1;
}

/** Parse a JSON extra field safely. */
function parseExtra(extra: unknown): Record<string, unknown> {
  if (!extra) return {};
  return typeof extra === "string" ? JSON.parse(extra) : (extra as Record<string, unknown>);
}

/** Resolve the base URL for a connection, falling back to the provider default. */
function resolveBaseUrl(connection: { baseUrl: string | null; provider: string }): string {
  if (connection.baseUrl) return connection.baseUrl;
  const providerDef = PROVIDERS[connection.provider as keyof typeof PROVIDERS];
  return providerDef?.defaultBaseUrl ?? "";
}

/**
 * Inject text into the `</output_format>` section if present,
 * otherwise append to the last user message (or last message overall).
 */
function injectIntoOutputFormatOrLastUser(messages: SimpleMessage[], block: string, opts?: { indent?: boolean }): void {
  const prefix = opts?.indent ? "    " : "";
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.content.includes("</output_format>")) {
      messages[i] = {
        ...msg,
        content: msg.content.replace("</output_format>", prefix + block + "\n</output_format>"),
      };
      return;
    }
  }
  // Fallback: append to last user message
  const lastIdx = Math.max(findLastIndex(messages, "user"), messages.length - 1);
  const target = messages[lastIdx]!;
  messages[lastIdx] = { ...target, content: target.content + "\n\n" + block };
}

/** Build wrapped field parts from a record of { fieldName: value }. */
function wrapFields(fields: Record<string, string | undefined | null>, format: "xml" | "markdown" | "none"): string[] {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value) parts.push(wrapContent(value, name, format, 2));
  }
  return parts;
}

/** Parse game state JSON fields from a DB row. */
function parseGameStateRow(row: Record<string, unknown>): GameState {
  return {
    id: row.id as string,
    chatId: row.chatId as string,
    messageId: row.messageId as string,
    swipeIndex: row.swipeIndex as number,
    date: row.date as string | null,
    time: row.time as string | null,
    location: row.location as string | null,
    weather: row.weather as string | null,
    temperature: row.temperature as string | null,
    presentCharacters: JSON.parse((row.presentCharacters as string) ?? "[]"),
    recentEvents: JSON.parse((row.recentEvents as string) ?? "[]"),
    playerStats: row.playerStats ? JSON.parse(row.playerStats as string) : null,
    personaStats: row.personaStats ? JSON.parse(row.personaStats as string) : null,
    createdAt: row.createdAt as string,
  };
}

export async function generateRoutes(app: FastifyInstance) {
  const chats = createChatsStorage(app.db);
  const connections = createConnectionsStorage(app.db);
  const presets = createPromptsStorage(app.db);
  const chars = createCharactersStorage(app.db);
  const agentsStore = createAgentsStorage(app.db);
  const gameStateStore = createGameStateStorage(app.db);
  const customToolsStore = createCustomToolsStorage(app.db);
  const lorebooksStore = createLorebooksStorage(app.db);

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

    // Save user message (if provided)
    if (input.userMessage) {
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

      await chats.createMessage({
        chatId: input.chatId,
        role: "user",
        characterId: null,
        content: input.userMessage,
      });
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
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

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

      // ── Regeneration as swipe: exclude the target message from context ──
      if (input.regenerateMessageId) {
        chatMessages = chatMessages.filter((m: any) => m.id !== input.regenerateMessageId);
      }

      // ── Context message limit (from chat metadata, off by default) ──
      const chatMeta = parseExtra(chat.metadata) as Record<string, unknown>;
      const contextMessageLimit = chatMeta.contextMessageLimit as number | null;
      if (contextMessageLimit && contextMessageLimit > 0 && chatMessages.length > contextMessageLimit) {
        chatMessages = chatMessages.slice(-contextMessageLimit);
      }

      const mappedMessages = chatMessages.map((m: any) => ({
        role: m.role === "narrator" ? ("system" as const) : (m.role as "user" | "assistant" | "system"),
        content: m.content as string,
      }));

      const characterIds: string[] = JSON.parse(chat.characterIds as string);

      // Resolve persona — prefer per-chat personaId, fall back to globally active persona
      let personaName = "User";
      let personaDescription = "";
      let personaFields: { personality?: string; scenario?: string; backstory?: string; appearance?: string } = {};
      const allPersonas = await chars.listPersonas();
      const persona =
        (chat.personaId ? allPersonas.find((p: any) => p.id === chat.personaId) : null) ??
        allPersonas.find((p: any) => p.isActive === "true");
      if (persona) {
        personaName = persona.name;
        personaDescription = persona.description;
        personaFields = {
          personality: persona.personality ?? "",
          scenario: persona.scenario ?? "",
          backstory: persona.backstory ?? "",
          appearance: persona.appearance ?? "",
        };
      }

      // ── Assembler path: use preset if the chat has one ──
      const presetId = (chat.promptPresetId as string | null) ?? undefined;
      const chatChoices = (chatMeta.presetChoices ?? {}) as Record<string, string | string[]>;

      let finalMessages = mappedMessages;
      let temperature = 1;
      let maxTokens = 4096;
      let showThoughts = false;
      let reasoningEffort: "low" | "medium" | "high" | "maximum" | null = null;
      let verbosity: "low" | "medium" | "high" | null = null;
      let wrapFormat: "xml" | "markdown" | "none" = "xml";

      // Determine whether agents are enabled for this chat (needed by assembler + agent pipeline)
      const chatEnableAgents = chatMeta.enableAgents === true;

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
            chatMessages: mappedMessages,
            chatSummary: (chatMeta.summary as string) ?? null,
            enableAgents: chatEnableAgents,
          };

          const assembled = await assemblePrompt(assemblerInput);
          finalMessages = assembled.messages;
          temperature = assembled.parameters.temperature;
          maxTokens = assembled.parameters.maxTokens;
          showThoughts = assembled.parameters.showThoughts ?? true;
          reasoningEffort = assembled.parameters.reasoningEffort ?? null;
          verbosity = assembled.parameters.verbosity ?? null;

          // Auto-resolve max context from model's known context window
          if (assembled.parameters.useMaxContext) {
            const knownModel = findKnownModel(conn.provider as APIProvider, conn.model);
            if (knownModel) {
              if (knownModel.maxOutput) maxTokens = knownModel.maxOutput;
            }
          }
        }
      }

      // Resolve "maximum" reasoning effort to the highest level for the current model
      let resolvedEffort: "low" | "medium" | "high" | "xhigh" | null =
        reasoningEffort !== "maximum" ? reasoningEffort : null;
      if (reasoningEffort === "maximum") {
        const model = (conn.model ?? "").toLowerCase();
        // Some OpenAI models (GPT-5.4, o3, o4-mini) support "xhigh" as the top tier
        if (model.includes("gpt-5.4") || model.includes("o3") || model.includes("o4")) {
          resolvedEffort = "xhigh";
        } else {
          resolvedEffort = "high";
        }
      }

      // Create provider
      const provider = createLLMProvider(conn.provider, baseUrl, conn.apiKey);

      // ────────────────────────────────────────
      // Agent Pipeline: resolve enabled agents
      // ────────────────────────────────────────
      const enabledConfigs = chatEnableAgents ? await agentsStore.listEnabled() : [];

      // Also include built-in agents that are enabled by default but have no DB row yet.
      // We must check ALL configs (not just enabled) so that explicitly-disabled
      // built-ins are not re-added as defaults.
      const allConfigs = chatEnableAgents ? await agentsStore.list() : [];
      const allConfigTypes = new Set(allConfigs.map((c: any) => c.type));
      const defaultEnabledBuiltIns = chatEnableAgents
        ? BUILT_IN_AGENTS.filter((a) => a.enabledByDefault && !allConfigTypes.has(a.id))
        : [];

      // Build ResolvedAgent array — each agent gets its own provider/model or falls back to chat connection
      const resolvedAgents: ResolvedAgent[] = [];

      for (const cfg of enabledConfigs) {
        // Chat Summary agent is manual-only — skip it in the generation pipeline
        if (cfg.type === "chat-summary") continue;
        const settings = cfg.settings ? JSON.parse(cfg.settings as string) : {};
        let agentProvider = provider;
        let agentModel = conn.model;

        // Per-agent connection override
        if (cfg.connectionId) {
          const agentConn = await connections.getWithKey(cfg.connectionId);
          if (agentConn) {
            const agentBaseUrl = resolveBaseUrl(agentConn);
            if (agentBaseUrl) {
              agentProvider = createLLMProvider(agentConn.provider, agentBaseUrl, agentConn.apiKey);
              agentModel = agentConn.model;
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

      // Built-in agents with no DB row → use defaults
      for (const builtIn of defaultEnabledBuiltIns) {
        resolvedAgents.push({
          id: `builtin:${builtIn.id}`,
          type: builtIn.id,
          name: builtIn.name,
          phase: builtIn.phase,
          promptTemplate: "",
          connectionId: null,
          settings: {},
          provider,
          model: conn.model,
        });
      }

      // Resolve character info (used for agent context AND prompt fallback)
      const charInfo: Array<{
        id: string;
        name: string;
        description: string;
        personality: string;
        scenario: string;
        systemPrompt: string;
      }> = [];
      for (const cid of characterIds) {
        const charRow = await chars.getById(cid);
        if (charRow) {
          const charData = JSON.parse(charRow.data as string);
          charInfo.push({
            id: cid,
            name: charData.name ?? "Unknown",
            description: charData.description ?? "",
            personality: charData.personality ?? "",
            scenario: charData.scenario ?? "",
            systemPrompt: charData.system_prompt ?? "",
          });
        }
      }

      // ── Fallback: inject character & persona info if the preset didn't include them ──
      const allContent = finalMessages.map((m) => m.content).join("\n");
      for (const ci of charInfo) {
        // Check if this character already appears by description snippet OR by name tag
        const hasCharInfo =
          (ci.description && allContent.includes(ci.description.slice(0, 80))) ||
          allContent.includes(`<${ci.name}>`) ||
          allContent.includes(`## ${ci.name}`);
        if (!hasCharInfo && ci.description) {
          const fieldParts = wrapFields(
            {
              description: ci.description,
              personality: ci.personality,
              scenario: ci.scenario,
              system_prompt: ci.systemPrompt,
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
        const hasPersonaInfo =
          allContent.includes(personaDescription.slice(0, 80)) ||
          allContent.includes(`<${personaName}>`) ||
          allContent.includes(`## ${personaName}`);
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
          if (fieldParts.length > 0) {
            const block = wrapContent(fieldParts.join("\n"), personaName, wrapFormat, 1);
            const firstUserIdx = finalMessages.findIndex((m) => m.role === "user" || m.role === "assistant");
            const insertAt = firstUserIdx >= 0 ? firstUserIdx : finalMessages.length;
            finalMessages.splice(insertAt, 0, { role: "system", content: block });
          }
        }
      }

      // ── Group chat processing ──
      const isGroupChat = characterIds.length > 1;
      const groupChatMode = (chatMeta.groupChatMode as string) ?? "merged";
      const groupSpeakerColors = chatMeta.groupSpeakerColors === true;
      const groupResponseOrder = (chatMeta.groupResponseOrder as string) ?? "sequential";

      if (isGroupChat) {
        // Strip <speaker="...">...</speaker> tags from history to save tokens.
        // These are only for client-side coloring and shouldn't be sent to the model.
        const speakerTagRegex = /<speaker="[^"]*">([\s\S]*?)<\/speaker>/g;
        for (let i = 0; i < finalMessages.length; i++) {
          const msg = finalMessages[i]!;
          if (speakerTagRegex.test(msg.content)) {
            finalMessages[i] = { ...msg, content: msg.content.replace(speakerTagRegex, "$1") };
          }
          speakerTagRegex.lastIndex = 0; // reset regex state
        }

        // Inject group chat instructions at the end of the last user message
        const groupInstructions: string[] = [];

        if (groupChatMode === "merged" && groupSpeakerColors) {
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
      // Only use "committed" game state — locked in when the user sent their
      // last message. Uncommitted snapshots (from previous swipes/regens) are
      // never used, so swipes always generate from a clean baseline.
      const latestGameState = await gameStateStore.getLatestCommitted(input.chatId);
      const gameState = latestGameState ? parseGameStateRow(latestGameState as Record<string, unknown>) : null;

      // Build base agent context (without mainResponse — that comes after generation)
      // Use the maximum contextSize requested by any enabled agent (default 20)
      const agentContextSize =
        resolvedAgents.length > 0
          ? Math.max(...resolvedAgents.map((a) => (a.settings.contextSize as number) || 20))
          : 20;
      const recentMsgs = chatMessages.slice(-agentContextSize).map((m: any) => ({
        role: m.role as string,
        content: m.content as string,
        characterId: m.characterId ?? undefined,
      }));

      const agentContext: AgentContext = {
        chatId: input.chatId,
        chatMode: (chatMeta.mode as string) ?? "roleplay",
        recentMessages: recentMsgs,
        mainResponse: null,
        gameState,
        characters: charInfo,
        persona:
          personaName !== "User"
            ? {
                name: personaName,
                description: personaDescription,
                ...(persona?.personaStats
                  ? {
                      personaStats:
                        typeof persona.personaStats === "string"
                          ? JSON.parse(persona.personaStats)
                          : persona.personaStats,
                    }
                  : {}),
              }
            : null,
        memory: {},
        activatedLorebookEntries: null,
        writableLorebookIds: null,
      };

      // If the expression agent is enabled, load available sprite expressions per character
      if (resolvedAgents.some((a) => a.type === "expression")) {
        try {
          const { readdirSync, existsSync: existsSyncFs } = await import("fs");
          const { join: joinPath, extname: extnameFs } = await import("path");
          const spritesRoot = joinPath(process.cwd(), "data", "sprites");
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
          const bgDir = join(process.cwd(), "data", "backgrounds");
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

      // If the chat-summary agent is enabled, provide the previous summary
      if (resolvedAgents.some((a) => a.type === "chat-summary") && chatMeta.summary) {
        agentContext.memory._previousSummary = chatMeta.summary;
      }

      // SSE helper for sending agent events
      const sendAgentEvent = (result: AgentResult) => {
        const ev = {
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
        };
        reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      };

      // Create the pipeline (exclude editor — it runs last, after all other agents)
      const editorAgent = resolvedAgents.find((a) => a.type === "editor");
      const pipelineAgents = editorAgent ? resolvedAgents.filter((a) => a.type !== "editor") : resolvedAgents;
      const pipeline = createAgentPipeline(pipelineAgents, agentContext, sendAgentEvent);

      // ────────────────────────────────────────
      // Phase 1: Pre-generation agents
      // ────────────────────────────────────────
      // Only run pre-gen agents on fresh generations (user sent a new message),
      // NOT on regenerations/swipes — EXCEPT for context-injection agents (like
      // prose-guardian) which improve writing quality and should run every time.
      // On regens, reuse cached injections from the first generation to save tokens.
      // Post-gen agents still run after every response.
      let contextInjections: string[] = [];
      // Static-injection agents don't need LLM calls — they inject prompt text directly
      const STATIC_INJECTION_AGENTS = new Set(["html"]);
      const hasPreGenAgents = resolvedAgents.some(
        (a) => a.phase === "pre_generation" && !STATIC_INJECTION_AGENTS.has(a.type),
      );
      if (hasPreGenAgents) {
        if (!input.regenerateMessageId) {
          // Fresh generation — run all pre-gen agents (excluding static-injection ones)
          reply.raw.write(`data: ${JSON.stringify({ type: "agent_start", data: { phase: "pre_generation" } })}\n\n`);
          contextInjections = await pipeline.preGenerate((t) => !STATIC_INJECTION_AGENTS.has(t));
        } else {
          // Regeneration — try to reuse cached context injections from the original generation
          const regenMsg = await chats.getMessage(input.regenerateMessageId);
          const regenExtra = parseExtra(regenMsg?.extra);
          const cached = regenExtra.contextInjections as string[] | undefined;

          if (cached && cached.length > 0) {
            // Reuse cached injections — no LLM call needed
            contextInjections = cached;
            // Send a synthetic agent_result so the UI still shows it
            for (const text of cached) {
              reply.raw.write(
                `data: ${JSON.stringify({
                  type: "agent_result",
                  data: {
                    agentType: "prose-guardian",
                    agentName: "Prose Guardian",
                    resultType: "context_injection",
                    data: { text },
                    success: true,
                    error: null,
                    durationMs: 0,
                    cached: true,
                  },
                })}\n\n`,
              );
            }
          } else {
            // No cache — run context-injection agents (prose-guardian, director)
            const CONTEXT_INJECTION_AGENTS = new Set(["prose-guardian", "director"]);
            const hasContextInjectionAgents = resolvedAgents.some(
              (a) => a.phase === "pre_generation" && CONTEXT_INJECTION_AGENTS.has(a.type),
            );
            if (hasContextInjectionAgents) {
              reply.raw.write(
                `data: ${JSON.stringify({ type: "agent_start", data: { phase: "pre_generation" } })}\n\n`,
              );
              contextInjections = await pipeline.preGenerate((agentType) => CONTEXT_INJECTION_AGENTS.has(agentType));
            }
          }
        }

        // Inject agent context into the last user message (wrapped in preset format)
        if (contextInjections.length > 0) {
          const injectionBlock = contextInjections.join("\n\n");
          const wrapped =
            wrapFormat === "markdown"
              ? `\n\n## Prose Guardian\n${injectionBlock}`
              : `\n\n<prose_guardian>\n${injectionBlock}\n</prose_guardian>`;

          // Append to the last user message
          const lastUserIdx = findLastIndex(finalMessages, "user");
          if (lastUserIdx >= 0) {
            const target = finalMessages[lastUserIdx]!;
            finalMessages[lastUserIdx] = { ...target, content: target.content + wrapped };
          } else {
            // No user message — append to the very last message
            const last = finalMessages[finalMessages.length - 1]!;
            finalMessages[finalMessages.length - 1] = { ...last, content: last.content + wrapped };
          }
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
        }
      }

      // Check if tool-use is requested (from chat metadata or input).
      // Tools are also enabled when agents are active — agents work separately
      // and may depend on tools (dice rolls, game state, expressions) even if
      // the user has toggled off the main "tools" setting in chat.
      const inputBody = req.body as Record<string, unknown>;
      const enableTools =
        inputBody.enableTools === true ||
        chatMeta.enableTools === true ||
        (chatEnableAgents && resolvedAgents.length > 0);

      // Build OpenAI-compatible tool definitions from built-in + custom tools
      let toolDefs: LLMToolDefinition[] | undefined;
      let customToolDefs: Array<{
        name: string;
        executionType: string;
        webhookUrl: string | null;
        staticResult: string | null;
        scriptBody: string | null;
      }> = [];
      if (enableTools) {
        // Built-in tools
        toolDefs = BUILT_IN_TOOLS.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters as unknown as Record<string, unknown>,
          },
        }));
        // Custom tools from DB
        const enabledCustomTools = await customToolsStore.listEnabled();
        for (const ct of enabledCustomTools) {
          const schema =
            typeof ct.parametersSchema === "string" ? JSON.parse(ct.parametersSchema) : ct.parametersSchema;
          toolDefs.push({
            type: "function" as const,
            function: {
              name: ct.name,
              description: ct.description,
              parameters: schema as Record<string, unknown>,
            },
          });
          customToolDefs.push({
            name: ct.name,
            executionType: ct.executionType,
            webhookUrl: ct.webhookUrl,
            staticResult: ct.staticResult,
            scriptBody: ct.scriptBody,
          });
        }
      }

      let fullResponse = "";
      let fullThinking = "";
      let allResponses: string[] = [];

      // Callback for collecting thinking/reasoning from the model
      const onThinking = showThoughts
        ? (chunk: string) => {
            fullThinking += chunk;
            reply.raw.write(`data: ${JSON.stringify({ type: "thinking", data: chunk })}\n\n`);
          }
        : undefined;

      // Helper: write text content progressively as small SSE token chunks
      const writeContentChunked = (text: string) => {
        const CHUNK_SIZE = 6;
        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
          const chunk = text.slice(i, i + CHUNK_SIZE);
          fullResponse += chunk;
          reply.raw.write(`data: ${JSON.stringify({ type: "token", data: chunk })}\n\n`);
        }
      };

      // ── Determine characters to generate for ──
      // Individual group mode: each character responds separately
      // Merged/single: one generation for the first (or merged) character
      const useIndividualLoop = isGroupChat && groupChatMode === "individual" && !input.regenerateMessageId; // regeneration always targets one message

      // For smart ordering, an agent would decide who responds.
      // For now, smart falls back to all characters (can be upgraded to an agent later).
      const respondingCharIds = useIndividualLoop
        ? groupResponseOrder === "sequential"
          ? [...characterIds]
          : [...characterIds] // smart: placeholder, same as sequential for now
        : [characterIds[0] ?? null];

      /** Generate a single response for a given character and save it. */
      const generateForCharacter = async (
        targetCharId: string | null,
        messagesForGen: Array<{ role: "system" | "user" | "assistant"; content: string }>,
      ) => {
        // Reset per-character accumulators
        fullResponse = "";
        fullThinking = "";

        // Track timing and usage
        const genStartTime = Date.now();
        let usage: LLMUsage | undefined;
        let finishReason: string | undefined;

        // Emit debug prompt if requested (only for first character to avoid spam)
        if (input.debugMode && targetCharId === respondingCharIds[0]) {
          const debugPayload = {
            messages: messagesForGen,
            parameters: {
              model: conn.model,
              provider: conn.provider,
              temperature,
              maxTokens,
              showThoughts,
              reasoningEffort: resolvedEffort ?? reasoningEffort,
              enableCaching: conn.enableCaching === "true",
              enableTools,
              agentCount: resolvedAgents.length,
            },
          };
          reply.raw.write(`data: ${JSON.stringify({ type: "debug_prompt", data: debugPayload })}\n\n`);
          console.log("\n[Debug] Prompt sent to model (%d messages):", messagesForGen.length);
          console.log(
            "  Model: %s (%s)  Temp: %s  MaxTokens: %s  Thinking: %s  Effort: %s",
            conn.model,
            conn.provider,
            temperature,
            maxTokens,
            showThoughts,
            resolvedEffort ?? "none",
          );
          for (const m of messagesForGen) {
            const preview = m.content.length > 200 ? m.content.slice(0, 200) + "..." : m.content;
            console.log("  [%s] %s", m.role.toUpperCase(), preview);
          }
        }

        if (enableTools && provider.chatComplete) {
          const MAX_TOOL_ROUNDS = 5;
          let loopMessages: ChatMessage[] = messagesForGen.map((m) => ({
            role: m.role as "system" | "user" | "assistant",
            content: m.content,
          }));

          // Extract Spotify credentials from the Spotify agent settings (if configured)
          const spotifyAgent = resolvedAgents.find((a) => a.type === "spotify");
          const spotifyAccessToken = (spotifyAgent?.settings?.spotifyAccessToken as string) || null;
          const spotifyCreds = spotifyAccessToken ? { accessToken: spotifyAccessToken } : undefined;

          // Stream tokens in real-time via onToken callback
          const onToken = (chunk: string) => {
            fullResponse += chunk;
            reply.raw.write(`data: ${JSON.stringify({ type: "token", data: chunk })}\n\n`);
          };

          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const result = await provider.chatComplete(loopMessages, {
              model: conn.model,
              temperature,
              maxTokens,
              tools: toolDefs,
              enableCaching: conn.enableCaching === "true",
              enableThinking: showThoughts,
              reasoningEffort: resolvedEffort ?? undefined,
              verbosity: verbosity ?? undefined,
              onThinking,
              onToken,
            });

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
              }
            }
            finishReason = result.finishReason;

            if (!result.toolCalls.length) break;

            loopMessages.push({
              role: "assistant",
              content: result.content ?? "",
              tool_calls: result.toolCalls,
            });

            const toolResults = await executeToolCalls(result.toolCalls, {
              customTools: customToolDefs,
              spotify: spotifyCreds,
              searchLorebook: async (query: string, category?: string | null) => {
                const entries = await lorebooksStore.listActiveEntries();
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
              },
            });

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
              const finalResult = await provider.chatComplete(loopMessages, {
                model: conn.model,
                temperature,
                maxTokens,
                enableCaching: conn.enableCaching === "true",
                enableThinking: showThoughts,
                reasoningEffort: resolvedEffort ?? undefined,
                verbosity: verbosity ?? undefined,
                onThinking,
                onToken,
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
                }
              }
              finishReason = finalResult.finishReason;
            }
          }
        } else {
          const gen = provider.chat(messagesForGen, {
            model: conn.model,
            temperature,
            maxTokens,
            stream: true,
            enableCaching: conn.enableCaching === "true",
            enableThinking: showThoughts,
            reasoningEffort: resolvedEffort ?? undefined,
            verbosity: verbosity ?? undefined,
            onThinking,
          });
          let result = await gen.next();
          while (!result.done) {
            fullResponse += result.value;
            reply.raw.write(`data: ${JSON.stringify({ type: "token", data: result.value })}\n\n`);
            result = await gen.next();
          }
          // Generator return value contains usage
          if (result.value) usage = result.value;
        }

        const durationMs = Date.now() - genStartTime;

        // Send usage to client for debug display
        if (input.debugMode && (usage || durationMs)) {
          reply.raw.write(
            `data: ${JSON.stringify({
              type: "debug_usage",
              data: {
                tokensPrompt: usage?.promptTokens ?? null,
                tokensCompletion: usage?.completionTokens ?? null,
                tokensTotal: usage?.totalTokens ?? null,
                durationMs,
                finishReason: finishReason ?? null,
              },
            })}\n\n`,
          );
        }

        // Save assistant message
        let savedMsg: any;
        if (input.regenerateMessageId) {
          savedMsg = await chats.addSwipe(input.regenerateMessageId, fullResponse);
          savedMsg = await chats.getMessage(input.regenerateMessageId);
        } else {
          savedMsg = await chats.createMessage({
            chatId: input.chatId,
            role: "assistant",
            characterId: targetCharId,
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
              tokensPrompt: usage?.promptTokens ?? null,
              tokensCompletion: usage?.completionTokens ?? null,
              durationMs,
              finishReason: finishReason ?? null,
            },
          };
          if (fullThinking) extraUpdate.thinking = fullThinking;
          else extraUpdate.thinking = null;
          // Cache context injections (prose-guardian etc.) on the message so regens can reuse them
          if (!input.regenerateMessageId && contextInjections.length > 0) {
            extraUpdate.contextInjections = contextInjections;
          }
          // Cache the final prompt (what was actually sent to the model) for Peek Prompt
          extraUpdate.cachedPrompt = messagesForGen.map((m) => ({ role: m.role, content: m.content }));
          await chats.updateMessageExtra(savedMsg.id, extraUpdate);
          // Also persist on the active swipe so switching swipes preserves per-swipe extras
          const refreshedMsg = await chats.getMessage(savedMsg.id);
          if (refreshedMsg) {
            await chats.updateSwipeExtra(savedMsg.id, refreshedMsg.activeSwipeIndex, extraUpdate);
          }
        }

        return { savedMsg, response: fullResponse };
      };

      // ── Run generation ──
      let lastSavedMsg: any = null;

      if (useIndividualLoop) {
        // Individual group mode: generate one response per character
        let runningMessages = [...finalMessages];

        for (let ci = 0; ci < respondingCharIds.length; ci++) {
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

          const { savedMsg, response } = await generateForCharacter(charId, messagesWithInstruction);
          lastSavedMsg = savedMsg;
          allResponses.push(response);

          // Add this character's response to the running context for the next character
          runningMessages.push({ role: "assistant", content: response });
        }
      } else {
        // Single/merged: one generation
        const targetCharId = characterIds[0] ?? null;
        const { savedMsg } = await generateForCharacter(targetCharId, finalMessages);
        lastSavedMsg = savedMsg;
        allResponses.push(fullResponse);
      }

      // ────────────────────────────────────────
      // Phase 2+3: Post-processing & parallel agents
      // ────────────────────────────────────────
      const hasPostAgents = resolvedAgents.some((a) => a.phase === "post_processing" || a.phase === "parallel");
      const combinedResponse = allResponses.join("\n\n");
      if (hasPostAgents && combinedResponse) {
        reply.raw.write(`data: ${JSON.stringify({ type: "agent_start", data: { phase: "post_generation" } })}\n\n`);

        let postResults = await pipeline.postGenerate(combinedResponse);

        // ── Auto-retry failed agents once ──
        const failedResults = postResults.filter((r) => !r.success);
        if (failedResults.length > 0) {
          const retryResults: AgentResult[] = [];
          for (const failed of failedResults) {
            const agentCfg = pipelineAgents.find((a) => a.type === failed.agentType);
            if (!agentCfg) continue;
            try {
              const retryCtx: AgentContext = { ...agentContext, mainResponse: combinedResponse };
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
          const stillFailed = retryResults.filter((r) => !r.success);
          if (stillFailed.length > 0) {
            reply.raw.write(
              `data: ${JSON.stringify({
                type: "agents_retry_failed",
                data: stillFailed.map((r) => ({ agentType: r.agentType, error: r.error })),
              })}\n\n`,
            );
          }
        }

        // Persist agent runs to DB + handle game state updates
        const messageId = (lastSavedMsg as any)?.id ?? "";
        for (const result of postResults) {
          try {
            await agentsStore.saveRun({
              agentConfigId: result.agentId,
              chatId: input.chatId,
              messageId,
              result,
            });
          } catch {
            // Non-critical — don't fail the whole generation
          }

          // Persist game state snapshots from world-state agent
          if (result.success && result.type === "game_state_update" && result.data && typeof result.data === "object") {
            try {
              const gs = result.data as Record<string, unknown>;
              // Determine swipe index: for regens use current active swipe, otherwise 0
              let gsSwipeIndex = 0;
              if (input.regenerateMessageId && messageId) {
                const refreshed = await chats.getMessage(messageId);
                if (refreshed) gsSwipeIndex = refreshed.activeSwipeIndex ?? 0;
              }
              await gameStateStore.create({
                chatId: input.chatId,
                messageId,
                swipeIndex: gsSwipeIndex,
                date: (gs.date as string) ?? null,
                time: (gs.time as string) ?? null,
                location: (gs.location as string) ?? null,
                weather: (gs.weather as string) ?? null,
                temperature: (gs.temperature as string) ?? null,
                presentCharacters: (gs.presentCharacters as any[]) ?? [],
                recentEvents: (gs.recentEvents as string[]) ?? [],
                playerStats: (gs.playerStats as any) ?? null,
                personaStats: (gs.personaStats as any[]) ?? null,
              });
              // Send game state to client so HUD updates live
              reply.raw.write(`data: ${JSON.stringify({ type: "game_state", data: gs })}\n\n`);
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
              if (chars.length > 0) {
                await gameStateStore.updateLatest(input.chatId, { presentCharacters: chars });
                // Merge into the game_state SSE event for the HUD
                reply.raw.write(
                  `data: ${JSON.stringify({ type: "game_state_patch", data: { presentCharacters: chars } })}\n\n`,
                );
              }
            } catch {
              // Non-critical
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
              if (bars.length > 0) {
                const latest = await gameStateStore.getLatest(input.chatId);
                if (latest) {
                  await app.db
                    .update(gameStateSnapshotsTable)
                    .set({ personaStats: JSON.stringify(bars) })
                    .where(eq(gameStateSnapshotsTable.id, latest.id));
                }
                reply.raw.write(
                  `data: ${JSON.stringify({ type: "game_state_patch", data: { personaStats: bars } })}\n\n`,
                );
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
        }

        // ── Consistency Editor: runs after ALL other agents ──
        if (editorAgent && messageId) {
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

      // Signal completion
      reply.raw.write(`data: ${JSON.stringify({ type: "done", data: "" })}\n\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      reply.raw.write(`data: ${JSON.stringify({ type: "error", data: message })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });

  // ──────────────────────────────────────────────
  // POST /retry-agents — Re-run failed agents manually
  // ──────────────────────────────────────────────
  app.post<{
    Body: { chatId: string; agentTypes: string[] };
  }>("/retry-agents", async (request, reply) => {
    const { chatId, agentTypes } = request.body;
    if (!chatId || !agentTypes?.length) {
      return reply.status(400).send({ error: "chatId and agentTypes are required" });
    }

    // SSE setup
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    try {
      const chats = createChatsStorage(app.db);
      const conns = createConnectionsStorage(app.db);
      const chars = createCharactersStorage(app.db);
      const agentsStore = createAgentsStorage(app.db);
      const gameStateStore = createGameStateStorage(app.db);

      const chat = await chats.getById(chatId);
      if (!chat) throw new Error("Chat not found");

      const chatMeta = parseExtra(chat.metadata);

      // Get the last assistant message for context
      const recentMessages = await chats.listMessages(chatId);
      const lastAssistant = recentMessages.find((m: any) => m.role === "assistant");
      const mainResponse = lastAssistant?.content ?? "";

      // Resolve agents
      const configs = await agentsStore.list();
      const enabledConfigs = configs.filter((c: any) => c.enabled === "true" && agentTypes.includes(c.type));

      // Resolve connection
      const connId = chat.connectionId;
      const conn = connId ? await conns.getWithKey(connId) : null;
      if (!conn) throw new Error("No connection configured");

      const baseUrl = resolveBaseUrl(conn);
      if (!baseUrl) throw new Error("Cannot resolve provider URL");
      const provider = createLLMProvider(conn.provider, baseUrl, conn.apiKey);

      // Resolve character info
      const characterIds: string[] =
        typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : (chat.characterIds ?? []);
      const charInfo: Array<{ id: string; name: string; description: string }> = [];
      for (const cid of characterIds) {
        const charRow = await chars.getById(cid);
        if (charRow) {
          const charData = JSON.parse(charRow.data as string);
          charInfo.push({
            id: cid,
            name: charData.name ?? "Unknown",
            description: charData.description ?? "",
          });
        }
      }

      // Build agent context
      const agentContext: AgentContext = {
        chatId,
        chatMode: (chat as any).mode ?? "conversation",
        recentMessages: recentMessages.map((m: any) => ({
          role: m.role,
          content: m.content,
          characterId: m.characterId ?? undefined,
        })),
        mainResponse,
        gameState: null,
        characters: charInfo,
        persona: { name: "User", description: "" },
        activatedLorebookEntries: null,
        writableLorebookIds: null,
        memory: {},
      };

      // Load game state
      const latestGS = await gameStateStore.getLatestCommitted(chatId);
      if (latestGS) {
        agentContext.gameState = parseGameStateRow(latestGS as Record<string, unknown>);
      }

      reply.raw.write(`data: ${JSON.stringify({ type: "agent_start", data: { phase: "retry" } })}\n\n`);

      // Resolve and execute each agent
      const results: AgentResult[] = [];
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

        const resolved: ResolvedAgent = {
          id: cfg.id,
          type: cfg.type,
          name: cfg.name,
          phase: cfg.phase as string,
          promptTemplate: cfg.promptTemplate as string,
          connectionId: cfg.connectionId as string | null,
          settings: typeof cfg.settings === "string" ? JSON.parse(cfg.settings) : (cfg.settings ?? {}),
          provider: agentProvider,
          model: agentModel,
        };

        try {
          const result = await executeAgent(resolved, agentContext, agentProvider, agentModel);
          // Send result to client
          const ev = {
            type: "agent_result",
            data: {
              agentType: result.agentType,
              agentName: cfg.name,
              resultType: result.type,
              data: result.data,
              success: result.success,
              error: result.error,
              durationMs: result.durationMs,
            },
          };
          reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
          results.push(result);

          // Persist run
          try {
            const messageId = lastAssistant?.id ?? "";
            await agentsStore.saveRun({
              agentConfigId: result.agentId,
              chatId,
              messageId,
              result,
            });
          } catch {
            /* Non-critical */
          }
        } catch (agentErr) {
          const errMsg = agentErr instanceof Error ? agentErr.message : "Agent execution failed";
          const ev = {
            type: "agent_result",
            data: {
              agentType: cfg.type,
              agentName: cfg.name,
              resultType: "error",
              data: null,
              success: false,
              error: errMsg,
              durationMs: 0,
            },
          };
          reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
      }

      // Handle game state updates from retry results
      for (const result of results) {
        if (result.success && result.type === "game_state_update" && result.data && typeof result.data === "object") {
          try {
            const gs = result.data as Record<string, unknown>;
            reply.raw.write(`data: ${JSON.stringify({ type: "game_state", data: gs })}\n\n`);
          } catch {
            /* Non-critical */
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
            const chars = (ctData.presentCharacters as any[]) ?? [];
            if (chars.length > 0) {
              reply.raw.write(
                `data: ${JSON.stringify({ type: "game_state_patch", data: { presentCharacters: chars } })}\n\n`,
              );
            }
          } catch {
            /* Non-critical */
          }
        }
      }

      reply.raw.write(`data: ${JSON.stringify({ type: "done", data: "" })}\n\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Agent retry failed";
      reply.raw.write(`data: ${JSON.stringify({ type: "error", data: message })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });
}
