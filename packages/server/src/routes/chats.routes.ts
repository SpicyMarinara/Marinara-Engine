// ──────────────────────────────────────────────
// Routes: Chats
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";
import {
  LOCAL_SIDECAR_CONNECTION_ID,
  createChatSchema,
  createMessageSchema,
  getDefaultAgentPrompt,
  nameToXmlTag,
  summariesPatchSchema,
} from "@marinara-engine/shared";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createRegexScriptsStorage } from "../services/storage/regex-scripts.storage.js";
import { getLocalSidecarProvider, LOCAL_SIDECAR_MODEL } from "../services/llm/local-sidecar.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { wrapContent } from "../services/prompt/format-engine.js";
import { newId } from "../utils/id-generator.js";
import { characters } from "../db/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { existsSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "../utils/data-dir.js";
import { normalizeTimestampOverrides } from "../services/import/import-timestamps.js";

export async function chatsRoutes(app: FastifyInstance) {
  const storage = createChatsStorage(app.db);

  // List all chats
  app.get("/", async () => {
    return storage.list();
  });

  // List chats by group
  app.get<{ Params: { groupId: string } }>("/group/:groupId", async (req) => {
    return storage.listByGroup(req.params.groupId);
  });

  // Get single chat
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const chat = await storage.getById(req.params.id);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    return chat;
  });

  // Create chat
  app.post("/", async (req) => {
    const input = createChatSchema.parse(req.body);
    const body = req.body as Record<string, unknown>;
    const chat = await storage.create(
      input,
      normalizeTimestampOverrides({
        createdAt: body.createdAt,
        updatedAt: body.updatedAt,
      }),
    );
    if (!chat) return chat;

    // Pre-populate chat parameters from connection defaults if available
    if (input.connectionId && input.connectionId !== "random") {
      const connStorage = createConnectionsStorage(app.db);
      const conn = await connStorage.getById(input.connectionId);
      if (conn?.defaultParameters) {
        let connDefaults: unknown = null;
        try {
          connDefaults =
            typeof conn.defaultParameters === "string" ? JSON.parse(conn.defaultParameters) : conn.defaultParameters;
        } catch {
          /* malformed JSON — skip defaults */
        }
        if (connDefaults && typeof connDefaults === "object") {
          const existingMeta = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});
          await storage.updateMetadata(chat.id, { ...existingMeta, chatParameters: connDefaults });
          return storage.getById(chat.id);
        }
      }
    }

    return chat;
  });

  // Update chat
  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    const data = createChatSchema.partial().parse(req.body);
    return storage.update(req.params.id, data);
  });

  // Update chat metadata (partial merge)
  app.patch<{ Params: { id: string } }>("/:id/metadata", async (req, reply) => {
    const chat = await storage.getById(req.params.id);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const existing = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});
    const incoming = req.body as Record<string, unknown>;
    // Validate Discord webhook URL if provided
    if (typeof incoming.discordWebhookUrl === "string" && incoming.discordWebhookUrl.trim()) {
      const url = incoming.discordWebhookUrl.trim();
      if (!/^https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(url)) {
        return reply.status(400).send({ error: "Invalid Discord webhook URL" });
      }
      incoming.discordWebhookUrl = url;
    }
    const merged = { ...existing, ...incoming };
    return storage.updateMetadata(req.params.id, merged);
  });

  // Update chat summaries (entry-level merge for day/week summaries).
  // Dedicated from generic metadata PATCH so concurrent user edits don't overwrite
  // the entire daySummaries/weekSummaries maps — we re-read fresh metadata here and
  // merge per-entry so in-flight generation writes can't clobber user edits on other keys.
  app.patch<{ Params: { id: string } }>("/:id/summaries", async (req, reply) => {
    const parsed = summariesPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid summaries payload", issues: parsed.error.issues });
    }
    const fresh = await storage.getById(req.params.id);
    if (!fresh) return reply.status(404).send({ error: "Chat not found" });
    const existing = typeof fresh.metadata === "string" ? JSON.parse(fresh.metadata) : (fresh.metadata ?? {});
    const merged = {
      ...existing,
      daySummaries: { ...(existing.daySummaries ?? {}), ...(parsed.data.daySummaries ?? {}) },
      weekSummaries: { ...(existing.weekSummaries ?? {}), ...(parsed.data.weekSummaries ?? {}) },
    };
    return storage.updateMetadata(req.params.id, merged);
  });

  // ── Chat Connections (OOC ↔ Roleplay) ──

  // Connect two chats bidirectionally
  app.post<{ Params: { id: string } }>("/:id/connect", async (req, reply) => {
    const { targetChatId } = req.body as { targetChatId: string };
    if (!targetChatId || typeof targetChatId !== "string") {
      return reply.status(400).send({ error: "targetChatId is required" });
    }
    const chat = await storage.getById(req.params.id);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    const target = await storage.getById(targetChatId);
    if (!target) return reply.status(404).send({ error: "Target chat not found" });
    // Don't allow self-connection
    if (req.params.id === targetChatId) {
      return reply.status(400).send({ error: "Cannot connect a chat to itself" });
    }
    await storage.connectChats(req.params.id, targetChatId);
    return { connected: true, chatId: req.params.id, targetChatId };
  });

  // Disconnect a chat from its partner
  app.post<{ Params: { id: string } }>("/:id/disconnect", async (req, reply) => {
    const chat = await storage.getById(req.params.id);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    await storage.disconnectChat(req.params.id);
    await storage.deleteInfluencesForChat(req.params.id);
    return { disconnected: true };
  });

  // List pending OOC influences for a chat
  app.get<{ Params: { id: string } }>("/:id/influences", async (req) => {
    return storage.listPendingInfluences(req.params.id);
  });

  // Delete all chats in a group (all branches)
  app.delete<{ Params: { groupId: string } }>("/group/:groupId", async (req, reply) => {
    await storage.removeGroup(req.params.groupId);
    return reply.status(204).send();
  });

  // Delete chat
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    // If this is a scene chat, clean up the origin chat's scene pointer
    const chat = await storage.getById(req.params.id);
    if (chat) {
      const meta = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});
      const originId = meta.sceneOriginChatId;
      if (originId) {
        const origin = await storage.getById(originId);
        if (origin) {
          const originMeta =
            typeof origin.metadata === "string" ? JSON.parse(origin.metadata) : (origin.metadata ?? {});
          delete originMeta.activeSceneChatId;
          delete originMeta.sceneBusyCharIds;
          await storage.updateMetadata(originId, originMeta);
        }
      }
    }
    // Disconnect from partner chat before deleting
    await storage.disconnectChat(req.params.id);
    await storage.remove(req.params.id);
    return reply.status(204).send();
  });

  // ── Messages ──

  // List messages for a chat (supports pagination via ?limit=N&before=CURSOR)
  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>(
    "/:id/messages",
    async (req) => {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 0;
      if (limit > 0) {
        return storage.listMessagesPaginated(req.params.id, limit, req.query.before || undefined);
      }
      return storage.listMessages(req.params.id);
    },
  );

  // Total message count for a chat (lightweight, for absolute numbering)
  app.get<{ Params: { id: string } }>("/:id/message-count", async (req) => {
    return { count: await storage.countMessages(req.params.id) };
  });

  // Create message
  app.post<{ Params: { id: string } }>("/:id/messages", async (req) => {
    const input = createMessageSchema.parse({ ...(req.body as Record<string, unknown>), chatId: req.params.id });
    const body = req.body as Record<string, unknown>;
    return storage.createMessage(
      input,
      normalizeTimestampOverrides({
        createdAt: body.createdAt,
        updatedAt: body.updatedAt,
      }),
    );
  });

  // Delete message
  app.delete<{ Params: { chatId: string; messageId: string } }>("/:chatId/messages/:messageId", async (req, reply) => {
    await storage.removeMessage(req.params.messageId);
    return reply.status(204).send();
  });

  // Bulk delete messages
  app.post<{ Params: { chatId: string } }>("/:chatId/messages/bulk-delete", async (req, reply) => {
    const { messageIds } = req.body as { messageIds: string[] };
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return reply.status(400).send({ error: "messageIds array is required" });
    }
    await storage.removeMessages(messageIds, req.params.chatId);
    return reply.status(204).send();
  });

  // Edit message content
  app.patch<{ Params: { chatId: string; messageId: string } }>("/:chatId/messages/:messageId", async (req, reply) => {
    const { content } = req.body as { content: string };
    if (typeof content !== "string") return reply.status(400).send({ error: "content is required" });
    const updated = await storage.updateMessageContent(req.params.messageId, content);
    if (!updated) return reply.status(404).send({ error: "Message not found" });
    return updated;
  });

  // Update message extra (partial merge) — also syncs to the active swipe
  app.patch<{ Params: { chatId: string; messageId: string } }>(
    "/:chatId/messages/:messageId/extra",
    async (req, reply) => {
      const partial = req.body as Record<string, unknown>;
      const updated = await storage.updateMessageExtra(req.params.messageId, partial);
      if (!updated) return reply.status(404).send({ error: "Message not found" });
      // Keep swipe extra in sync so per-swipe data (like spriteExpressions) persists
      await storage.updateSwipeExtra(req.params.messageId, updated.activeSwipeIndex, partial);
      return updated;
    },
  );

  // Get latest game state for a chat (respects the active swipe of the last assistant message)
  app.get<{ Params: { id: string } }>("/:id/game-state", async (req, reply) => {
    const { createGameStateStorage } = await import("../services/storage/game-state.storage.js");
    const gameStateStore = createGameStateStorage(app.db);

    // Try to find the snapshot for the last assistant message's active swipe
    let row: Awaited<ReturnType<typeof gameStateStore.getLatest>> = null;
    const msgs = await storage.listMessages(req.params.id);
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]!.role === "assistant") {
        row = await gameStateStore.getByMessage(msgs[i]!.id, msgs[i]!.activeSwipeIndex);
        break;
      }
    }
    // Fall back to most recent snapshot if no swipe-specific one exists
    const usedFallback = !row;
    if (!row) row = await gameStateStore.getLatest(req.params.id);
    if (!row) return reply.send(null);
    const presentCharacters = JSON.parse((row.presentCharacters as string) ?? "[]") as Array<Record<string, unknown>>;
    const playerStats = row.playerStats ? JSON.parse(row.playerStats as string) : null;
    const personaStats = row.personaStats ? JSON.parse(row.personaStats as string) : null;

    // ── Enrich present characters with avatar paths ──
    // Match NPC names against the chat's known character cards, then fall back to stored NPC avatars on disk.
    const charsNeedingAvatar = presentCharacters.filter((c) => !c.avatarPath && c.name);
    if (charsNeedingAvatar.length > 0) {
      const chat = await storage.getById(req.params.id);
      const chatCharIds: string[] = (() => {
        try {
          return JSON.parse((chat?.characterIds as string) ?? "[]");
        } catch {
          return [];
        }
      })();
      // Build a name → avatarPath map from the chat's character records
      const nameToAvatar = new Map<string, string>();
      if (chatCharIds.length > 0) {
        const charRows = await app.db
          .select({ id: characters.id, data: characters.data, avatarPath: characters.avatarPath })
          .from(characters)
          .where(inArray(characters.id, chatCharIds));
        for (const cr of charRows) {
          try {
            const d = typeof cr.data === "string" ? JSON.parse(cr.data) : cr.data;
            if (d?.name && cr.avatarPath) nameToAvatar.set((d.name as string).toLowerCase(), cr.avatarPath as string);
          } catch {
            /* skip */
          }
        }
      }
      const NPC_AVATAR_DIR = join(DATA_DIR, "avatars", "npc");
      for (const char of charsNeedingAvatar) {
        const name = char.name as string;
        // 1. Try matching a known character card by name
        const knownAvatar = nameToAvatar.get(name.toLowerCase());
        if (knownAvatar) {
          char.avatarPath = knownAvatar;
          continue;
        }
        // 2. Try loading a stored NPC avatar from disk
        const safeName = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        if (safeName) {
          const npcPath = join(NPC_AVATAR_DIR, req.params.id, `${safeName}.png`);
          if (existsSync(npcPath)) char.avatarPath = `/api/avatars/npc/${req.params.id}/${safeName}.png`;
        }
      }
    }

    return {
      id: row.id,
      chatId: row.chatId,
      messageId: row.messageId,
      swipeIndex: row.swipeIndex,
      date: row.date,
      time: row.time,
      location: row.location,
      weather: row.weather,
      temperature: row.temperature,
      presentCharacters,
      recentEvents: JSON.parse((row.recentEvents as string) ?? "[]"),
      playerStats,
      personaStats,
      manualOverrides: row.manualOverrides ? JSON.parse(row.manualOverrides as string) : null,
      createdAt: row.createdAt,
    };
  });

  // Update game state fields for a chat
  app.patch<{ Params: { id: string } }>("/:id/game-state", async (req, reply) => {
    const { createGameStateStorage } = await import("../services/storage/game-state.storage.js");
    const gameStateStore = createGameStateStorage(app.db);
    const body = req.body as Record<string, unknown>;
    const manual = body.manual === true;
    // Explicit flag to wipe all manual overrides (e.g. from the Clear button)
    const clearOverrides = body.clearOverrides === true;
    const fields = body as Partial<{
      date: string;
      time: string;
      location: string;
      weather: string;
      temperature: string;
      presentCharacters: any[];
      playerStats: any;
      personaStats: any[];
    }>;
    // Target the same snapshot the GET endpoint returns — the one for the last
    // assistant message's active swipe — so edits persist to the row the user
    // actually sees. Falls back to updateLatest when no messages exist yet.
    let updated: Awaited<ReturnType<typeof gameStateStore.updateLatest>> = null;
    const msgs = await storage.listMessages(req.params.id);
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]!.role === "assistant") {
        const msg = msgs[i]!;
        updated = await gameStateStore.updateByMessage(msg.id, msg.activeSwipeIndex, req.params.id, fields, manual);
        break;
      }
    }
    if (!updated) {
      updated = await gameStateStore.updateLatest(req.params.id, fields, manual);
    }
    // Wipe all manual overrides when explicitly requested
    if (clearOverrides && updated) {
      const { eq } = await import("drizzle-orm");
      const { gameStateSnapshots } = await import("../db/schema/index.js");
      await app.db
        .update(gameStateSnapshots)
        .set({ manualOverrides: null })
        .where(eq(gameStateSnapshots.id, (updated as any).id));
      updated = { ...updated, manualOverrides: null };
    }
    // If no snapshot exists yet, create one so manual edits aren't lost
    if (!updated && manual) {
      const manualOverrides: Record<string, string> = {};
      const TRACKABLE = ["date", "time", "location", "weather", "temperature"] as const;
      for (const key of TRACKABLE) {
        if (fields[key] !== undefined) manualOverrides[key] = fields[key] as string;
      }
      await gameStateStore.create(
        {
          chatId: req.params.id,
          messageId: "",
          swipeIndex: 0,
          date: (fields.date as string) ?? null,
          time: (fields.time as string) ?? null,
          location: (fields.location as string) ?? null,
          weather: (fields.weather as string) ?? null,
          temperature: (fields.temperature as string) ?? null,
          presentCharacters: (fields.presentCharacters as any[]) ?? [],
          recentEvents: [],
          playerStats: (fields.playerStats as any) ?? null,
          personaStats: (fields.personaStats as any) ?? null,
        },
        Object.keys(manualOverrides).length > 0 ? manualOverrides : null,
      );
      updated = await gameStateStore.getLatest(req.params.id);
    }
    if (!updated) return reply.status(404).send({ error: "No game state found" });
    return updated;
  });

  // Delete all game state for a chat
  app.delete<{ Params: { id: string } }>("/:id/game-state", async (req, reply) => {
    const { createGameStateStorage } = await import("../services/storage/game-state.storage.js");
    const gameStateStore = createGameStateStorage(app.db);
    await gameStateStore.deleteForChat(req.params.id);
    return reply.status(204).send();
  });

  // Peek prompt — assemble the prompt for this chat as if generating right now
  app.post<{ Params: { id: string } }>("/:id/peek-prompt", async (req, reply) => {
    const chat = await storage.getById(req.params.id);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const chatMessages = await storage.listMessages(req.params.id);
    const chatMeta = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});

    // ── Primary: return the cached prompt from the last generation ──
    // This is an exact copy of what was actually sent to the model,
    // including all runtime injections (lorebooks, game state, scene context, etc.).
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const m = chatMessages[i]! as any;
      if (m.role === "assistant") {
        let extra = typeof m.extra === "string" ? JSON.parse(m.extra) : (m.extra ?? {});
        let cachedPrompt = extra.cachedPrompt as Array<{ role: string; content: string }> | undefined;
        let generationInfo = extra.generationInfo as Record<string, unknown> | undefined;

        // If message-level extra doesn't have it (swipe overwrite), check swipes
        if (!cachedPrompt && m.id) {
          const swipes = await storage.getSwipes(m.id);
          const activeSwipe = swipes.find((s: any) => s.index === m.activeSwipeIndex);
          if (activeSwipe) {
            const swExtra =
              typeof activeSwipe.extra === "string" ? JSON.parse(activeSwipe.extra) : (activeSwipe.extra ?? {});
            cachedPrompt = swExtra.cachedPrompt;
            if (swExtra.generationInfo) generationInfo = swExtra.generationInfo;
          }
          if (!cachedPrompt) {
            for (const sw of swipes) {
              const swExtra = typeof sw.extra === "string" ? JSON.parse(sw.extra) : (sw.extra ?? {});
              if (swExtra.cachedPrompt) {
                cachedPrompt = swExtra.cachedPrompt;
                if (swExtra.generationInfo) generationInfo = swExtra.generationInfo;
                break;
              }
            }
          }
        }

        if (cachedPrompt) {
          return { messages: cachedPrompt, parameters: null, generationInfo: generationInfo ?? null };
        }
        break;
      }
    }

    // ── Fallback: live assembly preview (no generation has happened yet) ──
    // This is a best-effort approximation; it won't include runtime-only
    // injections like lorebooks, game state, scene context, semantic memory, etc.
    const presetId = chat.promptPresetId ?? chatMeta.presetId;
    if (presetId) {
      try {
        const { createPromptsStorage } = await import("../services/storage/prompts.storage.js");
        const { createCharactersStorage } = await import("../services/storage/characters.storage.js");
        const { assemblePrompt } = await import("../services/prompt/index.js");
        const presetStore = createPromptsStorage(app.db);
        const charStore = createCharactersStorage(app.db);

        const preset = await presetStore.getById(presetId);
        if (preset) {
          // Apply conversation-start filter
          let filteredMessages = chatMessages;
          for (let i = chatMessages.length - 1; i >= 0; i--) {
            const extra =
              typeof chatMessages[i]!.extra === "string"
                ? JSON.parse(chatMessages[i]!.extra as string)
                : (chatMessages[i]!.extra ?? {});
            if (extra.isConversationStart) {
              filteredMessages = chatMessages.slice(i);
              break;
            }
          }

          // Apply context message limit
          const contextLimit = chatMeta.contextMessageLimit as number | null;
          if (contextLimit && contextLimit > 0 && filteredMessages.length > contextLimit) {
            filteredMessages = filteredMessages.slice(-contextLimit);
          }

          const mappedMessages = filteredMessages.map((m: any) => ({
            role: m.role === "narrator" ? "system" : m.role,
            content: m.content as string,
          }));

          // Strip trailing assistant messages — peek should show only what we SEND to the model
          while (mappedMessages.length > 0 && mappedMessages[mappedMessages.length - 1]!.role === "assistant") {
            mappedMessages.pop();
          }

          // ── Apply prompt-only regex scripts (mirrors generate.routes.ts) ──
          const regexStore = createRegexScriptsStorage(app.db);
          const allRegexScripts = await regexStore.list();
          const promptOnlyScripts = allRegexScripts.filter((s: any) => s.enabled === "true" && s.promptOnly === "true");
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

          const [sections, groups, choiceBlocks] = await Promise.all([
            presetStore.listSections(presetId),
            presetStore.listGroups(presetId),
            presetStore.listChoiceBlocksForPreset(presetId),
          ]);

          const characterIds: string[] = (() => {
            try {
              return JSON.parse(chat.characterIds as string);
            } catch {
              return [];
            }
          })();

          let personaName = "User";
          let personaDescription = "";
          let personaFields: Record<string, string> = {};
          const allPersonas = await charStore.listPersonas();
          const persona =
            (chat.personaId ? allPersonas.find((p: any) => p.id === chat.personaId) : null) ??
            allPersonas.find((p: any) => p.isActive === "true");
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

          const personaStats = (() => {
            if (!persona?.personaStats) return undefined;
            if (typeof persona.personaStats !== "string") return persona.personaStats;
            try {
              return JSON.parse(persona.personaStats as string);
            } catch {
              return undefined;
            }
          })();

          const chatChoices = (chatMeta.presetChoices ?? {}) as Record<string, string | string[]>;
          const assembled = await assemblePrompt({
            db: app.db,
            preset: preset as any,
            sections: sections as any,
            groups: groups as any,
            choiceBlocks: choiceBlocks as any,
            chatChoices,
            chatId: req.params.id,
            characterIds,
            personaName,
            personaDescription,
            personaFields,
            personaStats,
            chatMessages: mappedMessages,
            chatSummary: (chatMeta.summary as string) ?? null,
            enableAgents: chatMeta.enableAgents === true,
            activeAgentIds: Array.isArray(chatMeta.activeAgentIds) ? (chatMeta.activeAgentIds as string[]) : [],
            activeLorebookIds: Array.isArray(chatMeta.activeLorebookIds)
              ? (chatMeta.activeLorebookIds as string[])
              : [],
            groupScenarioOverrideText:
              typeof chatMeta.groupScenarioText === "string" && (chatMeta.groupScenarioText as string).trim()
                ? (chatMeta.groupScenarioText as string).trim()
                : null,
          });

          // ── Strip <speaker> tags from chat history to save tokens (roleplay only) ──
          const isGroupChat = characterIds.length > 1;
          const chatMode = (chat.mode as string) ?? "roleplay";
          if (isGroupChat && chatMode !== "conversation") {
            const speakerCloseRegex = /<\/speaker>/g;
            for (let i = 0; i < assembled.messages.length; i++) {
              const msg = assembled.messages[i]!;
              if (msg.role === "system") continue;
              if (msg.content.includes("<speaker=")) {
                let converted = msg.content;
                converted = converted.replace(/<speaker="[^"]*">/g, "");
                converted = converted.replace(speakerCloseRegex, "");
                converted = converted.replace(/^\s*\n/gm, "").trim();
                assembled.messages[i] = { ...msg, content: converted };
              }
            }
          }

          // ── Inject group chat speaker tag instructions ──
          const groupChatMode =
            chatMode === "conversation" ? "merged" : ((chatMeta.groupChatMode as string) ?? "merged");
          const groupSpeakerColors =
            chatMeta.groupSpeakerColors === true || (chatMode === "conversation" && isGroupChat);

          if (isGroupChat && groupChatMode === "merged" && groupSpeakerColors && chatMode !== "conversation") {
            // Fetch character names for the example
            const charNames: string[] = [];
            for (const cid of characterIds) {
              const charRow = await charStore.getById(cid);
              if (charRow) {
                const charData = JSON.parse(charRow.data as string);
                charNames.push(charData.name ?? "Unknown");
              }
            }
            const speakerInstruction = `- Since this is a group chat, wrap each character's dialogue in <speaker="name"> tags. Tags can appear inline with narration, they don't need to be on separate lines. Example: <speaker="${charNames[0] ?? "John"}">"Hello there,"</speaker> [action beat/dialogue tag].`;
            const wrapFmt = (preset as any).wrapFormat || "xml";
            const instructionBlock =
              wrapFmt === "markdown" ? `\n## Group Chat\n${speakerInstruction}` : speakerInstruction;

            // Inject into </output_format> if present, otherwise append to last user message
            let speakerInjected = false;
            for (let i = 0; i < assembled.messages.length; i++) {
              const msg = assembled.messages[i]!;
              if (msg.content.includes("</output_format>")) {
                assembled.messages[i] = {
                  ...msg,
                  content: msg.content.replace("</output_format>", "    " + instructionBlock + "\n</output_format>"),
                };
                speakerInjected = true;
                break;
              }
            }
            if (!speakerInjected) {
              let lastUserIdx = -1;
              for (let i = assembled.messages.length - 1; i >= 0; i--) {
                if (assembled.messages[i]!.role === "user") {
                  lastUserIdx = i;
                  break;
                }
              }
              const idx = lastUserIdx >= 0 ? lastUserIdx : assembled.messages.length - 1;
              const target = assembled.messages[idx]!;
              assembled.messages[idx] = { ...target, content: target.content + "\n\n" + instructionBlock };
            }
          }

          // ── Static injection: Immersive HTML agent ──
          const peekAgentIds = Array.isArray(chatMeta.activeAgentIds) ? (chatMeta.activeAgentIds as string[]) : [];
          if (
            chatMeta.enableAgents === true &&
            chatMode !== "conversation" &&
            peekAgentIds.length > 0 &&
            peekAgentIds.includes("html")
          ) {
            const { createAgentsStorage } = await import("../services/storage/agents.storage.js");
            const agentsStore = createAgentsStorage(app.db);
            const htmlCfg = await agentsStore.getByType("html");
            // Per-chat activeAgentIds overrides the global enabled flag (matches generation flow)
            const htmlPrompt = ((htmlCfg?.promptTemplate as string) || getDefaultAgentPrompt("html")).trim();
            if (htmlPrompt) {
              const wrapFmt = (preset as any).wrapFormat || "xml";
              const htmlBlock = wrapFmt === "markdown" ? `\n## Immersive HTML\n${htmlPrompt}` : htmlPrompt;
              let injected = false;
              for (let i = 0; i < assembled.messages.length; i++) {
                const msg = assembled.messages[i]!;
                if (msg.content.includes("</output_format>")) {
                  assembled.messages[i] = {
                    ...msg,
                    content: msg.content.replace("</output_format>", "    " + htmlBlock + "\n</output_format>"),
                  };
                  injected = true;
                  break;
                }
              }
              if (!injected) {
                let lastUserIdx = -1;
                for (let i = assembled.messages.length - 1; i >= 0; i--) {
                  if (assembled.messages[i]!.role === "user") {
                    lastUserIdx = i;
                    break;
                  }
                }
                const idx = lastUserIdx >= 0 ? lastUserIdx : assembled.messages.length - 1;
                const target = assembled.messages[idx]!;
                assembled.messages[idx] = {
                  ...target,
                  content:
                    target.content +
                    "\n\n" +
                    (wrapFmt === "xml" ? `<immersive_html>\n${htmlPrompt}\n</immersive_html>` : htmlBlock),
                };
              }
            }
          }

          // ── Fallback: inject character & persona info if the preset didn't include them ──
          const wrapFormat = ((preset as any).wrapFormat as "xml" | "markdown" | "none") || "xml";
          const allContent = assembled.messages.map((m) => m.content).join("\n");

          // Character info fallback
          for (const cid of characterIds) {
            const charRow = await charStore.getById(cid);
            if (!charRow) continue;
            const charData = JSON.parse(charRow.data as string);
            const charName = charData.name ?? "Unknown";
            const charDesc = charData.description ?? "";
            const xmlTag = nameToXmlTag(charName);
            const hasCharInfo =
              (charDesc && allContent.includes(charDesc.split("\n")[0]!.trim().slice(0, 80))) ||
              allContent.includes(`<${xmlTag}>`) ||
              allContent.includes(`<${charName}>`) ||
              new RegExp(`^#{1,6} ${charName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(allContent);
            if (!hasCharInfo && charDesc) {
              const hasGroupOverride =
                typeof chatMeta.groupScenarioText === "string" && (chatMeta.groupScenarioText as string).trim();
              const parts: string[] = [];
              if (charDesc) parts.push(wrapContent(charDesc, "description", wrapFormat, 2));
              if (charData.personality) parts.push(wrapContent(charData.personality, "personality", wrapFormat, 2));
              if (charData.scenario && !hasGroupOverride)
                parts.push(wrapContent(charData.scenario, "scenario", wrapFormat, 2));
              if (charData.extensions?.backstory)
                parts.push(wrapContent(charData.extensions.backstory, "backstory", wrapFormat, 2));
              if (charData.extensions?.appearance)
                parts.push(wrapContent(charData.extensions.appearance, "appearance", wrapFormat, 2));
              if (charData.system_prompt)
                parts.push(wrapContent(charData.system_prompt, "system_prompt", wrapFormat, 2));
              if (charData.mes_example)
                parts.push(wrapContent(charData.mes_example, "example_dialogue", wrapFormat, 2));
              if (charData.post_history_instructions)
                parts.push(wrapContent(charData.post_history_instructions, "post_history_instructions", wrapFormat, 2));
              if (parts.length > 0) {
                const block = wrapContent(parts.join("\n"), charName, wrapFormat, 1);
                const firstSysIdx = assembled.messages.findIndex((m) => m.role === "system");
                const insertAt = firstSysIdx >= 0 ? firstSysIdx + 1 : 0;
                assembled.messages.splice(insertAt, 0, { role: "system", content: block });
              }
            }
          }

          // Persona info fallback
          if (personaDescription) {
            const personaXmlTag = nameToXmlTag(personaName);
            const hasPersonaInfo =
              allContent.includes(personaDescription.split("\n")[0]!.trim().slice(0, 80)) ||
              allContent.includes(`<${personaXmlTag}>`) ||
              allContent.includes(`<${personaName}>`) ||
              new RegExp(`^#{1,6} ${personaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").test(allContent);
            if (!hasPersonaInfo) {
              const fieldParts: string[] = [];
              if (personaDescription) fieldParts.push(wrapContent(personaDescription, "description", wrapFormat, 2));
              if (personaFields.personality)
                fieldParts.push(wrapContent(personaFields.personality, "personality", wrapFormat, 2));
              if (personaFields.backstory)
                fieldParts.push(wrapContent(personaFields.backstory, "backstory", wrapFormat, 2));
              if (personaFields.appearance)
                fieldParts.push(wrapContent(personaFields.appearance, "appearance", wrapFormat, 2));
              if (personaFields.scenario)
                fieldParts.push(wrapContent(personaFields.scenario, "scenario", wrapFormat, 2));
              // Include enabled RPG attributes
              if (personaStats?.rpgStats?.enabled) {
                const rpg = personaStats.rpgStats as {
                  attributes: Array<{ name: string; value: number }>;
                  hp: { value: number; max: number };
                };
                const rpgLines = [`Max HP: ${rpg.hp.max}`];
                for (const attr of rpg.attributes) {
                  rpgLines.push(`${attr.name}: ${attr.value}`);
                }
                fieldParts.push(wrapContent(rpgLines.join("\n"), "rpg_attributes", wrapFormat, 2));
              }
              if (fieldParts.length > 0) {
                const block = wrapContent(fieldParts.join("\n"), personaName, wrapFormat, 1);
                const firstUserIdx = assembled.messages.findIndex((m) => m.role === "user" || m.role === "assistant");
                const insertAt = firstUserIdx >= 0 ? firstUserIdx : assembled.messages.length;
                assembled.messages.splice(insertAt, 0, { role: "system", content: block });
              }
            }
          }

          return { messages: assembled.messages, parameters: assembled.parameters, generationInfo: null };
        }
      } catch (e) {
        logger.error(e, "[peek-prompt] Assembler failed, falling through to cached/raw messages");
      }
    }

    // ── Last resort: return raw chat messages ──
    const mappedMessages = chatMessages.map((m: any) => ({
      role: m.role === "narrator" ? "system" : m.role,
      content: m.content as string,
    }));
    while (mappedMessages.length > 0 && mappedMessages[mappedMessages.length - 1]!.role === "assistant") {
      mappedMessages.pop();
    }

    return { messages: mappedMessages, parameters: null, generationInfo: null };
  });

  // ── Swipes ──

  // List swipes for a message
  app.get<{ Params: { chatId: string; messageId: string } }>("/:chatId/messages/:messageId/swipes", async (req) => {
    return storage.getSwipes(req.params.messageId);
  });

  // Add a swipe
  app.post<{ Params: { chatId: string; messageId: string } }>("/:chatId/messages/:messageId/swipes", async (req) => {
    const { content, silent } = req.body as { content: string; silent?: boolean };
    return storage.addSwipe(req.params.messageId, content, silent);
  });

  // Delete a swipe without deleting the parent message
  app.delete<{ Params: { chatId: string; messageId: string; index: string } }>(
    "/:chatId/messages/:messageId/swipes/:index",
    async (req, reply) => {
      const index = Number.parseInt(req.params.index, 10);
      if (!Number.isInteger(index) || index < 0) {
        return reply.status(400).send({ error: "Valid swipe index is required" });
      }

      const swipes = await storage.getSwipes(req.params.messageId);
      if (swipes.length <= 1) {
        return reply.status(400).send({ error: "Cannot delete the last remaining swipe" });
      }

      const target = swipes.find((swipe: any) => swipe.index === index);
      if (!target) {
        return reply.status(404).send({ error: "Swipe not found" });
      }

      const updated = await storage.removeSwipe(req.params.messageId, index);
      if (!updated) {
        return reply.status(404).send({ error: "Message not found" });
      }

      return updated;
    },
  );

  // Set active swipe
  app.put<{ Params: { chatId: string; messageId: string } }>(
    "/:chatId/messages/:messageId/active-swipe",
    async (req) => {
      const { index } = req.body as { index: number };
      return storage.setActiveSwipe(req.params.messageId, index);
    },
  );

  // ── Export ──

  // Export chat — supports JSONL (default, SillyTavern-compatible) and plain text
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>("/:id/export", async (req, reply) => {
    const chat = await storage.getById(req.params.id);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const msgs = await storage.listMessages(req.params.id);
    const format = (req.query.format ?? "jsonl").toLowerCase();

    // Parse characterIds to resolve character names
    const charIds: string[] = (() => {
      try {
        return JSON.parse(chat.characterIds as string);
      } catch {
        return [];
      }
    })();

    // Build a characterId → name map for all characters in this chat
    const charNameMap = new Map<string, string>();
    if (charIds.length > 0) {
      try {
        const rows = await app.db.select().from(characters).where(inArray(characters.id, charIds));
        for (const row of rows) {
          const data = JSON.parse(row.data);
          if (data?.name) charNameMap.set(row.id, data.name);
        }
      } catch {
        // fall through — use chat name as fallback
      }
    }
    const primaryCharName = (charIds[0] && charNameMap.get(charIds[0])) ?? chat.name;

    // Resolve display name for a message
    const getDisplayName = (msg: { role: string; characterId?: string | null }) => {
      if (msg.role === "user") return "User";
      if (msg.role === "system") return "System";
      if (msg.role === "narrator") return "Narrator";
      if (msg.characterId && charNameMap.has(msg.characterId)) return charNameMap.get(msg.characterId)!;
      return primaryCharName;
    };

    // ── Plain text format ──
    if (format === "text") {
      const header = `Chat: ${chat.name}\nDate: ${chat.createdAt}\n${"─".repeat(50)}\n`;
      const body = msgs
        .map((msg) => {
          const name = getDisplayName(msg);
          const ts = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : "";
          return `[${name}]${ts ? ` (${ts})` : ""}\n${msg.content}`;
        })
        .join("\n\n");

      return reply
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${encodeURIComponent(chat.name)}.txt"`)
        .send(header + body);
    }

    // ── JSONL format (default) ──
    const lines: string[] = [];

    lines.push(
      JSON.stringify({
        user_name: "User",
        character_name: primaryCharName,
        create_date: chat.createdAt,
        chat_metadata: {},
      }),
    );

    for (const msg of msgs) {
      lines.push(
        JSON.stringify({
          name: getDisplayName(msg),
          is_user: msg.role === "user",
          is_system: msg.role === "system" || msg.role === "narrator",
          mes: msg.content,
          send_date: msg.createdAt,
        }),
      );
    }

    return reply
      .header("Content-Type", "application/jsonl")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(chat.name)}.jsonl"`)
      .send(lines.join("\n"));
  });

  // ── Branch (duplicate) ──

  // Create a branch (copy) of an existing chat
  app.post<{ Params: { id: string } }>("/:id/branch", async (req, reply) => {
    const sourceChat = await storage.getById(req.params.id);
    if (!sourceChat) return reply.status(404).send({ error: "Chat not found" });

    const sourceMeta =
      typeof sourceChat.metadata === "string" ? JSON.parse(sourceChat.metadata) : (sourceChat.metadata ?? {});
    const isSceneChat = sourceMeta.sceneStatus === "active" || !!sourceMeta.sceneOriginChatId;
    if (isSceneChat) {
      return reply.status(400).send({ error: "Scene chats cannot be branched" });
    }

    const { upToMessageId } = (req.body ?? {}) as { upToMessageId?: string };

    // Ensure the source chat belongs to a group so branches are linked
    let groupId = sourceChat.groupId as string | null;
    if (!groupId) {
      groupId = newId();
      await storage.update(req.params.id, { groupId });
    }

    // Create a new chat as a branch
    const branchName = `${sourceChat.name} (branch)`;
    const newChat = await storage.create({
      name: branchName,
      mode: sourceChat.mode as "conversation" | "roleplay" | "visual_novel",
      characterIds: (() => {
        try {
          return JSON.parse(sourceChat.characterIds as string);
        } catch {
          return [];
        }
      })(),
      groupId,
      personaId: sourceChat.personaId,
      promptPresetId: sourceChat.promptPresetId,
      connectionId: sourceChat.connectionId,
    });

    if (!newChat) return reply.status(500).send({ error: "Failed to create branch" });

    // Copy metadata (preset, lorebooks, agents, persona settings, etc.) from source chat
    if (sourceChat.metadata) {
      // Preserve all settings but clear transient state like summaries
      const { summary, daySummaries, weekSummaries, ...settingsToKeep } = sourceMeta;
      await storage.updateMetadata(newChat.id, settingsToKeep);
    }

    // Copy messages from source chat, using the active swipe's content.
    // Preserve each message's original createdAt timestamp so ordering and
    // display times remain identical to the source chat.
    const msgs = await storage.listMessages(req.params.id);
    const sourceToBranchedMessageId = new Map<string, string>();

    for (const msg of msgs) {
      // Resolve the content from the active swipe (may differ from msg.content
      // if the user swiped to an alternative response)
      let content = msg.content;
      if (msg.activeSwipeIndex > 0) {
        const swipes = await storage.getSwipes(msg.id);
        const activeSwipe = swipes.find((s: { index: number }) => s.index === msg.activeSwipeIndex);
        if (activeSwipe) content = activeSwipe.content;
      }

      const created = await storage.createMessage(
        {
          chatId: newChat.id,
          role: msg.role as "user" | "assistant" | "system" | "narrator",
          characterId: msg.characterId,
          content,
        },
        { createdAt: msg.createdAt as string },
      );

      if (created) {
        sourceToBranchedMessageId.set(msg.id, created.id);

        // Preserve per-message metadata (displayText, generationInfo, etc.)
        try {
          const extraObj = typeof msg.extra === "string" ? JSON.parse(msg.extra) : (msg.extra ?? {});
          if (extraObj && typeof extraObj === "object") {
            await storage.updateMessageExtra(created.id, extraObj as Record<string, unknown>);
          }
        } catch {
          // Ignore malformed extra payloads rather than failing the branch.
        }
      }

      // Stop if we hit the specified message
      if (upToMessageId && msg.id === upToMessageId) break;
    }

    // Fix updatedAt: createMessage sets the chat's updatedAt to each message's
    // (preserved) timestamp, so after the loop the branched chat's updatedAt is
    // the last source message's original time. Reset it to now so the branch
    // appears at the top of the chat list as a freshly created chat.
    await storage.update(newChat.id, {});

    // Copy game-state snapshots from the source chat for every copied message.
    // Each snapshot is keyed by (chatId, messageId, swipeIndex), so we must re-associate
    // them to the new branch's message IDs. Copying all snapshots (not just the latest)
    // ensures that branching a branch at an earlier point finds the correct tracker state
    // for that specific message, not just the latest snapshot in the source chat.
    if (sourceToBranchedMessageId.size > 0) {
      const { createGameStateStorage } = await import("../services/storage/game-state.storage.js");
      const gameStateStore = createGameStateStorage(app.db);

      // Helper to create a snapshot re-keyed for the new branch.
      const copySnapshot = async (
        snapshot: NonNullable<Awaited<ReturnType<typeof gameStateStore.getByMessage>>>,
        targetMessageId: string,
        targetSwipeIndex: number,
      ) => {
        try {
          const overrides =
            snapshot.manualOverrides && typeof snapshot.manualOverrides === "string"
              ? (JSON.parse(snapshot.manualOverrides) as Record<string, string>)
              : null;
          await gameStateStore.create(
            {
              chatId: newChat.id,
              messageId: targetMessageId,
              swipeIndex: targetSwipeIndex,
              date: (snapshot.date as string) ?? null,
              time: (snapshot.time as string) ?? null,
              location: (snapshot.location as string) ?? null,
              weather: (snapshot.weather as string) ?? null,
              temperature: (snapshot.temperature as string) ?? null,
              presentCharacters:
                typeof snapshot.presentCharacters === "string"
                  ? JSON.parse(snapshot.presentCharacters)
                  : (snapshot.presentCharacters ?? []),
              recentEvents:
                typeof snapshot.recentEvents === "string"
                  ? JSON.parse(snapshot.recentEvents)
                  : (snapshot.recentEvents ?? []),
              playerStats:
                snapshot.playerStats == null
                  ? null
                  : typeof snapshot.playerStats === "string"
                    ? JSON.parse(snapshot.playerStats)
                    : snapshot.playerStats,
              personaStats:
                snapshot.personaStats == null
                  ? null
                  : typeof snapshot.personaStats === "string"
                    ? JSON.parse(snapshot.personaStats)
                    : snapshot.personaStats,
              committed: (snapshot.committed as any) === 1,
            } as any,
            overrides,
          );
        } catch {
          // Ignore individual snapshot copy failures; branching should still succeed.
        }
      };

      for (const [srcMsgId, branchedMsgId] of sourceToBranchedMessageId) {
        const srcMsg = msgs.find((m) => m.id === srcMsgId);
        if (!srcMsg) continue;

        const snapshot = await gameStateStore.getByMessage(srcMsgId, srcMsg.activeSwipeIndex);
        if (snapshot) {
          await copySnapshot(snapshot, branchedMsgId, 0);
        }
      }

      // Also copy the bootstrap snapshot (messageId: "") if one exists.
      // This is created when tracker state is set manually before any generation,
      // and is not tied to any specific message.
      const bootstrap = await gameStateStore.getByChatAndMessage(req.params.id, "", 0);
      if (bootstrap) {
        await copySnapshot(bootstrap, "", 0);
      }
    }

    // Return the fully-updated chat (including copied metadata)
    return storage.getById(newChat.id);
  });

  // ── Generate Summary ──
  // Calls the LLM to produce a rolling summary from the chat history,
  // saves it into chatMetadata.summary, and returns it.
  // Model resolution: chat-summary agent connection → default-for-agents → chat connection.
  app.post<{ Params: { id: string } }>("/:id/generate-summary", async (req, reply) => {
    const chat = await storage.getById(req.params.id);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const chatMeta = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});

    // Accept context size from request body, fall back to chat meta, then default 50
    const body = (req.body ?? {}) as Record<string, unknown>;
    const contextSize = Math.max(
      5,
      Math.min(200, Number(body.contextSize) || (chatMeta.summaryContextSize as number) || 50),
    );

    const chatConnId = chat.connectionId;

    const connections = createConnectionsStorage(app.db);

    // Model resolution chain:
    // 1. Chat Summary agent's own connection override
    // 2. Default-for-agents connection
    // 3. Chat's active connection
    const { createAgentsStorage } = await import("../services/storage/agents.storage.js");
    const agentsStore = createAgentsStorage(app.db);
    const summaryAgentCfg = await agentsStore.getByType("chat-summary");
    const defaultAgentConn = await connections.getDefaultForAgents();

    let resolvedConnId: string | null = summaryAgentCfg?.connectionId ?? defaultAgentConn?.id ?? null;

    // Fall back to the chat connection
    if (!resolvedConnId) {
      resolvedConnId = chatConnId ?? null;
    }

    if (!resolvedConnId) return reply.status(400).send({ error: "No API connection configured for this chat" });

    let provider = getLocalSidecarProvider();
    let model = LOCAL_SIDECAR_MODEL;

    if (resolvedConnId !== LOCAL_SIDECAR_CONNECTION_ID) {
      let id = resolvedConnId;
      if (id === "random") {
        const pool = await connections.listRandomPool();
        if (!pool.length) return reply.status(400).send({ error: "No connections in random pool" });
        id = pool[Math.floor(Math.random() * pool.length)]!.id;
      }
      const conn = await connections.getWithKey(id);
      if (!conn) return reply.status(400).send({ error: "API connection not found" });

      let baseUrl = conn.baseUrl;
      if (!baseUrl) {
        const { PROVIDERS } = await import("@marinara-engine/shared");
        const providerDef = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
        baseUrl = providerDef?.defaultBaseUrl ?? "";
      }
      if (!baseUrl) return reply.status(400).send({ error: "No base URL for this connection" });

      provider = createLLMProvider(
        conn.provider,
        baseUrl,
        conn.apiKey,
        conn.maxContext,
        conn.openrouterProvider,
        conn.maxTokensOverride,
      );
      model = conn.model;
    }

    // Build conversation context (use contextSize from popover)
    const allMessages = await storage.listMessages(req.params.id);
    const recentMessages = allMessages.slice(-contextSize);
    const chatLog = recentMessages.map((m: any) => `[${m.role}]: ${(m.content as string).slice(0, 2000)}`).join("\n\n");

    const previousSummary = chatMeta.summary ?? null;
    const summaryPrompt = getDefaultAgentPrompt("chat-summary");

    const messages: Array<{ role: "system" | "user"; content: string }> = [
      { role: "system", content: summaryPrompt },
      {
        role: "user",
        content:
          (previousSummary ? `Previous summary:\n${previousSummary}\n\n` : "") + `Recent conversation:\n${chatLog}`,
      },
    ];

    const result = await provider.chatComplete(messages, {
      model,
      temperature: 0.5,
      maxTokens: 2048,
    });

    if (!result.content) {
      return reply.status(500).send({ error: "No response from AI" });
    }

    // Parse JSON response
    let summaryText: string;
    try {
      const cleaned = result.content
        .trim()
        .replace(/```(?:json)?\s*/gi, "")
        .replace(/```/g, "");
      const first = cleaned.indexOf("{");
      const last = cleaned.lastIndexOf("}");
      const json = JSON.parse(cleaned.slice(first, last + 1));
      summaryText = json.summary ?? result.content;
    } catch {
      summaryText = result.content.trim();
    }

    // Append to existing summary (don't replace)
    const existing = ((chatMeta.summary as string) ?? "").trim();
    const combined = existing ? `${existing}\n\n${summaryText}` : summaryText;
    const merged = { ...chatMeta, summary: combined };
    await storage.updateMetadata(req.params.id, merged);

    return { summary: combined };
  });
}
