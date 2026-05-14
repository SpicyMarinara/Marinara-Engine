// ──────────────────────────────────────────────
// Routes: Conversation Mode Services
// ──────────────────────────────────────────────
// Endpoints for schedule generation, status checking,
// autonomous message polling, and busy-delay responses.

import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { PROVIDERS } from "@marinara-engine/shared";
import type { CharacterData } from "@marinara-engine/shared";
import {
  generateCharacterSchedule,
  getCurrentStatus,
  scheduleNeedsRefresh,
  getMonday,
  getBusyDelay,
  type WeekSchedule,
  type CharacterSchedules,
} from "../services/conversation/schedule.service.js";
import {
  checkAutonomousMessaging,
  checkCharacterExchange,
  recordUserActivity,
  recordAssistantActivity,
  markGenerationInProgress,
  initializeActivityFromMessages,
} from "../services/conversation/autonomous.service.js";

function resolveBaseUrl(connection: { baseUrl: string | null; provider: string }): string {
  if (connection.baseUrl) return connection.baseUrl;
  // Login-backed providers own their endpoint internally; return sentinels so
  // downstream baseUrl gates pass.
  if (connection.provider === "claude_subscription") return "claude-agent-sdk://local";
  if (connection.provider === "openai_chatgpt") return "openai-chatgpt://codex-auth";
  const providerDef = PROVIDERS[connection.provider as keyof typeof PROVIDERS];
  return providerDef?.defaultBaseUrl ?? "";
}

function hasSchedules(value: unknown): value is CharacterSchedules {
  return !!value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0;
}

function areConversationSchedulesEnabled(meta: Record<string, unknown>): boolean {
  if (typeof meta.conversationSchedulesEnabled === "boolean") return meta.conversationSchedulesEnabled;
  return hasSchedules(meta.characterSchedules);
}

function getEnabledConversationSchedules(meta: Record<string, unknown>): CharacterSchedules {
  return areConversationSchedulesEnabled(meta) && hasSchedules(meta.characterSchedules) ? meta.characterSchedules : {};
}

type SummaryEntry = { summary: string; keyDetails: string[] };
type CharacterMemoryEntry = { from?: string; summary?: string; createdAt?: string };
type ConnectionsStorage = ReturnType<typeof createConnectionsStorage>;

const SCHEDULE_CONTINUITY_MAX_CHARS = 6000;

async function resolveConversationScheduleConnection(connections: ConnectionsStorage, chatConnectionId: string | null) {
  if (chatConnectionId === "random") {
    const pool = await connections.listRandomPool();
    if (!pool.length) {
      return { conn: null, error: "No connections marked for the random pool" };
    }
    return { conn: pool[Math.floor(Math.random() * pool.length)] ?? null, error: null };
  }

  const connId = chatConnectionId ?? (await connections.getDefault())?.id;
  if (!connId) {
    return { conn: null, error: "No connection configured" };
  }

  return { conn: await connections.getWithKey(connId), error: null };
}

function parseDateKeyMs(dateKey: string): number {
  const match = dateKey.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return 0;
  const [, day, month, year] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
}

function coerceSummaryEntry(value: unknown): SummaryEntry | null {
  if (typeof value === "string") {
    const summary = value.trim();
    return summary ? { summary, keyDetails: [] } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const keyDetails = Array.isArray(record.keyDetails)
    ? record.keyDetails.filter((detail): detail is string => typeof detail === "string" && detail.trim().length > 0)
    : [];
  return summary || keyDetails.length > 0 ? { summary, keyDetails } : null;
}

function getRecentSummaryEntries(raw: unknown, limit: number): Array<{ key: string; entry: SummaryEntry }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .map(([key, value]) => ({ key, entry: coerceSummaryEntry(value), time: parseDateKeyMs(key) }))
    .filter((item): item is { key: string; entry: SummaryEntry; time: number } => !!item.entry)
    .sort((a, b) => b.time - a.time)
    .slice(0, limit)
    .map(({ key, entry }) => ({ key, entry }));
}

function limitText(value: string, maxChars: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1).trim()}…` : trimmed;
}

function formatSummaryEntry(label: string, entry: SummaryEntry): string[] {
  const lines = [`- ${label}: ${limitText(entry.summary, 700)}`];
  if (entry.keyDetails.length > 0) {
    lines.push(
      `  Key details: ${entry.keyDetails
        .slice(0, 8)
        .map((detail) => limitText(detail, 180))
        .join("; ")}`,
    );
  }
  return lines;
}

function summarizePreviousSchedule(schedule: WeekSchedule): string[] {
  return Object.entries(schedule.days)
    .slice(0, 7)
    .map(([day, blocks]) => {
      const activities = blocks
        .slice(0, 8)
        .map((block) => `${block.time} ${block.activity} (${block.status})`)
        .join("; ");
      return `- ${day}: ${activities}`;
    });
}

function buildScheduleContinuityContext(args: {
  meta: Record<string, unknown>;
  charData: CharacterData;
  existingSchedule: WeekSchedule;
}): string {
  const { meta, charData, existingSchedule } = args;
  const sections: string[] = [];

  sections.push(`<previous_schedule weekStart="${existingSchedule.weekStart}">`);
  sections.push(...summarizePreviousSchedule(existingSchedule));
  sections.push(`</previous_schedule>`);

  const weekSummaries = getRecentSummaryEntries(meta.weekSummaries, 2);
  if (weekSummaries.length > 0) {
    sections.push(``, `<recent_week_summaries>`);
    for (const { key, entry } of weekSummaries) {
      sections.push(...formatSummaryEntry(`Week of ${key}`, entry));
    }
    sections.push(`</recent_week_summaries>`);
  }

  const daySummaries = getRecentSummaryEntries(meta.daySummaries, 7);
  if (daySummaries.length > 0) {
    sections.push(``, `<recent_day_summaries>`);
    for (const { key, entry } of daySummaries) {
      sections.push(...formatSummaryEntry(key, entry));
    }
    sections.push(`</recent_day_summaries>`);
  }

  const rollingSummary = typeof meta.summary === "string" ? meta.summary.trim() : "";
  if (rollingSummary) {
    sections.push(``, `<rolling_chat_summary>`, limitText(rollingSummary, 1200), `</rolling_chat_summary>`);
  }

  const memories: CharacterMemoryEntry[] = Array.isArray(charData.extensions?.characterMemories)
    ? (charData.extensions.characterMemories as CharacterMemoryEntry[])
    : [];
  const previousScheduleStartMs = new Date(existingSchedule.weekStart).getTime();
  const recentMemories = memories
    .filter((memory) => typeof memory.summary === "string" && memory.summary.trim())
    .filter((memory) => {
      if (!Number.isFinite(previousScheduleStartMs) || !memory.createdAt) return true;
      const memoryTime = new Date(memory.createdAt).getTime();
      return !Number.isFinite(memoryTime) || memoryTime >= previousScheduleStartMs;
    })
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 8);
  if (recentMemories.length > 0) {
    sections.push(``, `<recent_character_memories>`);
    for (const memory of recentMemories) {
      const date = memory.createdAt ? memory.createdAt.slice(0, 10) : "unknown date";
      const from = memory.from ? ` from ${memory.from}` : "";
      sections.push(`- ${date}${from}: ${limitText(memory.summary ?? "", 350)}`);
    }
    sections.push(`</recent_character_memories>`);
  }

  return sections.join("\n").slice(0, SCHEDULE_CONTINUITY_MAX_CHARS);
}

export async function conversationRoutes(app: FastifyInstance) {
  const chats = createChatsStorage(app.db);
  const chars = createCharactersStorage(app.db);
  const connections = createConnectionsStorage(app.db);

  // ─────────────────────────────────────────────
  // POST /schedule/generate — Generate or refresh weekly schedules
  // ─────────────────────────────────────────────
  app.post<{
    Body: {
      chatId: string;
      forceRefresh?: boolean;
      characterIds?: string[];
      scheduleGenerationPreferences?: string;
    };
  }>("/schedule/generate", async (req, reply) => {
    const { chatId, forceRefresh } = req.body;
    // Runtime guard: TypeScript's Body type is compile-time only. If a client sends a non-string,
    // .trim() would throw and surface as a 500. Reject explicitly with 400 instead.
    const rawPrefs: unknown = req.body.scheduleGenerationPreferences;
    if (rawPrefs != null && typeof rawPrefs !== "string") {
      return reply.status(400).send({ error: "scheduleGenerationPreferences must be a string" });
    }
    const userSchedulePreferences = typeof rawPrefs === "string" ? rawPrefs.trim() : "";

    const chat = await chats.getById(chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });
    if (chat.mode !== "conversation") return reply.status(400).send({ error: "Not a conversation chat" });

    // Resolve connection (need decrypted API key; "random" is a sentinel, not a persisted connection id)
    const { conn, error: connectionError } = await resolveConversationScheduleConnection(connections, chat.connectionId);
    if (!conn) return reply.status(400).send({ error: connectionError ?? "No connection configured" });
    const baseUrl = resolveBaseUrl(conn);
    if (!baseUrl) return reply.status(400).send({ error: "No base URL" });

    const meta = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});
    const existingSchedules: CharacterSchedules = hasSchedules(meta.characterSchedules) ? meta.characterSchedules : {};
    // Prefer client-supplied characterIds (avoids race condition with DB persistence)
    const characterIds: string[] =
      Array.isArray(req.body.characterIds) && req.body.characterIds.length > 0
        ? req.body.characterIds
        : typeof chat.characterIds === "string"
          ? JSON.parse(chat.characterIds)
          : chat.characterIds;

    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );
    const model = conn.model ?? "";
    const mondayStr = getMonday().toISOString();

    const preserveTimingSettings = (schedule: WeekSchedule, existing?: WeekSchedule): WeekSchedule => {
      if (!existing) {
        return schedule;
      }
      const merged: WeekSchedule = {
        ...schedule,
        inactivityThresholdMinutes: existing.inactivityThresholdMinutes,
      };
      if (typeof existing.idleResponseDelayMinutes === "number") {
        merged.idleResponseDelayMinutes = existing.idleResponseDelayMinutes;
      }
      if (typeof existing.dndResponseDelayMinutes === "number") {
        merged.dndResponseDelayMinutes = existing.dndResponseDelayMinutes;
      }
      return merged;
    };

    const newSchedules: CharacterSchedules = { ...existingSchedules };
    const results: Record<string, { status: string; schedule?: WeekSchedule }> = {};

    // Pre-fetch schedules from other conversation chats so we can reuse them
    // instead of generating from scratch. This makes schedules shared across chats.
    let otherChatSchedules: Map<string, WeekSchedule> | null = null;
    const getOtherChatSchedules = async (): Promise<Map<string, WeekSchedule>> => {
      if (otherChatSchedules) return otherChatSchedules;
      otherChatSchedules = new Map();
      const allChats = await chats.list();
      for (const c of allChats) {
        if (c.id === chatId || c.mode !== "conversation") continue;
        const m = typeof c.metadata === "string" ? JSON.parse(c.metadata as string) : (c.metadata ?? {});
        if (!areConversationSchedulesEnabled(m)) continue;
        const scheds: CharacterSchedules = getEnabledConversationSchedules(m);
        for (const [cid, sched] of Object.entries(scheds)) {
          if (sched && !otherChatSchedules.has(cid) && !scheduleNeedsRefresh(sched)) {
            otherChatSchedules.set(cid, sched);
          }
        }
      }
      return otherChatSchedules;
    };

    for (const charId of characterIds) {
      // Check if schedule exists and is fresh
      const existing = existingSchedules[charId];
      if (existing && !forceRefresh && !scheduleNeedsRefresh(existing)) {
        results[charId] = { status: "fresh" };
        continue;
      }

      // Check if this character has a fresh schedule in another chat
      if (!forceRefresh) {
        const shared = (await getOtherChatSchedules()).get(charId);
        if (shared) {
          const mergedShared = preserveTimingSettings(shared, existing);
          newSchedules[charId] = mergedShared;
          // Update character's conversationStatus to match
          const charRow = await chars.getById(charId);
          if (charRow) {
            const charData = JSON.parse(charRow.data as string) as CharacterData;
            const { status } = getCurrentStatus(mergedShared);
            const extensions = { ...(charData.extensions ?? {}), conversationStatus: status };
            await chars.update(charId, { extensions } as Partial<CharacterData>, undefined, {
              skipVersionSnapshot: true,
            });
          }
          results[charId] = { status: "shared", schedule: mergedShared };
          continue;
        }
      }

      // Load character data
      const charRow = await chars.getById(charId);
      if (!charRow) {
        results[charId] = { status: "not_found" };
        continue;
      }
      const charData = JSON.parse(charRow.data as string) as CharacterData;

      // Skip built-in assistants — they don't need generated schedules
      if (charData.extensions?.isBuiltInAssistant) {
        results[charId] = { status: "skipped_assistant" };
        continue;
      }

      try {
        logger.info("[schedule] Generating schedule for %s (%s)...", charData.name, charId);
        const recentContinuityContext = existing
          ? buildScheduleContinuityContext({ meta, charData, existingSchedule: existing })
          : undefined;
        const { schedule } = await generateCharacterSchedule(
          provider,
          model,
          charData.name,
          charData.description ?? "",
          charData.personality ?? "",
          userSchedulePreferences,
          recentContinuityContext,
        );
        logger.info("[schedule] Generated schedule for %s, days: %s", charData.name, Object.keys(schedule.days ?? {}));

        const fullSchedule = preserveTimingSettings(
          {
            ...schedule,
            weekStart: mondayStr,
          },
          existing,
        );
        newSchedules[charId] = fullSchedule;

        // Update character's conversationStatus to match current schedule
        const { status } = getCurrentStatus(fullSchedule);
        const extensions = { ...(charData.extensions ?? {}), conversationStatus: status };
        await chars.update(charId, { extensions } as Partial<CharacterData>, undefined, {
          skipVersionSnapshot: true,
        });

        results[charId] = { status: "generated", schedule: fullSchedule };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Schedule generation failed";
        logger.error(err instanceof Error ? err : undefined, "[schedule] ERROR for %s: %s", charData.name, msg);
        results[charId] = { status: `error: ${msg}` };
      }
    }

    // Only save if we actually have schedules to persist (avoids overwriting real data with empty object)
    if (Object.keys(newSchedules).length > 0) {
      // Re-read metadata fresh to avoid overwriting changes made by concurrent requests
      const freshChat = await chats.getById(chatId);
      const freshMeta =
        typeof freshChat?.metadata === "string" ? JSON.parse(freshChat.metadata) : (freshChat?.metadata ?? {});
      await chats.updateMetadata(chatId, {
        ...freshMeta,
        conversationSchedulesEnabled: true,
        characterSchedules: newSchedules,
        scheduleWeekStart: mondayStr,
      });

      // Sync newly generated schedules to other conversation chats that use the same characters
      const generatedCharIds = Object.entries(results)
        .filter(([, r]) => r.status === "generated")
        .map(([id]) => id);
      if (generatedCharIds.length > 0) {
        const allChats = await chats.list();
        for (const c of allChats) {
          if (c.id === chatId || c.mode !== "conversation") continue;
          const cCharIds: string[] =
            typeof c.characterIds === "string" ? JSON.parse(c.characterIds as string) : (c.characterIds as string[]);
          const overlap = generatedCharIds.filter((id) => cCharIds.includes(id));
          if (overlap.length === 0) continue;
          const cMeta = typeof c.metadata === "string" ? JSON.parse(c.metadata as string) : (c.metadata ?? {});
          if (!areConversationSchedulesEnabled(cMeta)) continue;
          const cSchedules: CharacterSchedules = hasSchedules(cMeta.characterSchedules) ? cMeta.characterSchedules : {};
          let changed = false;
          for (const cid of overlap) {
            cSchedules[cid] = preserveTimingSettings(newSchedules[cid]!, cSchedules[cid]);
            changed = true;
          }
          if (changed) {
            await chats.updateMetadata(c.id, {
              ...cMeta,
              conversationSchedulesEnabled: true,
              characterSchedules: cSchedules,
              scheduleWeekStart: mondayStr,
            });
          }
        }
      }
    }

    return reply.send({ results, schedules: newSchedules });
  });

  // ─────────────────────────────────────────────
  // GET /status/:chatId — Get current status for all characters in a chat
  // ─────────────────────────────────────────────
  app.get<{
    Params: { chatId: string };
  }>("/status/:chatId", async (req, reply) => {
    const chat = await chats.getById(req.params.chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const schedules: CharacterSchedules = await chats.inheritFreshConversationSchedules(req.params.chatId);
    const characterIds: string[] =
      typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : chat.characterIds;

    const now = new Date();
    const statuses: Record<string, { status: string; activity: string; schedule?: WeekSchedule }> = {};

    for (const charId of characterIds) {
      const schedule = schedules[charId];
      if (!schedule) {
        const charRow = await chars.getById(charId);
        if (charRow) {
          const charData = JSON.parse(charRow.data as string) as CharacterData;
          const currentExtensions = (charData.extensions as Record<string, unknown> | undefined) ?? {};
          if (currentExtensions.conversationStatus !== "online" || currentExtensions.conversationActivity != null) {
            const extensions: Record<string, unknown> = {
              ...currentExtensions,
              conversationStatus: "online",
            };
            delete extensions.conversationActivity;
            await chars.update(charId, { extensions } as Partial<CharacterData>, undefined, {
              skipVersionSnapshot: true,
            });
          }
        }
        statuses[charId] = { status: "online", activity: "unknown (no schedule)" };
        continue;
      }
      const { status, activity } = getCurrentStatus(schedule, now);

      // Sync the character's conversationStatus in the database
      const charRow = await chars.getById(charId);
      if (charRow) {
        const charData = JSON.parse(charRow.data as string) as CharacterData;
        if (
          charData.extensions?.conversationStatus !== status ||
          charData.extensions?.conversationActivity !== activity
        ) {
          const extensions = {
            ...(charData.extensions ?? {}),
            conversationStatus: status,
            conversationActivity: activity,
          };
          await chars.update(charId, { extensions } as Partial<CharacterData>, undefined, {
            skipVersionSnapshot: true,
          });
        }
      }

      statuses[charId] = { status, activity, schedule };
    }

    return reply.send({ statuses, needsRefresh: Object.values(schedules).some((s) => scheduleNeedsRefresh(s)) });
  });

  // ─────────────────────────────────────────────
  // POST /activity/user — Record user activity (called on message send)
  // ─────────────────────────────────────────────
  app.post<{
    Body: { chatId: string; preserveGenerationInProgress?: boolean };
  }>("/activity/user", async (req, reply) => {
    recordUserActivity(req.body.chatId, {
      preserveGenerationInProgress: req.body.preserveGenerationInProgress === true,
    });
    return reply.send({ ok: true });
  });

  // ─────────────────────────────────────────────
  // POST /activity/assistant — Record assistant activity
  // ─────────────────────────────────────────────
  app.post<{
    Body: { chatId: string; characterId?: string };
  }>("/activity/assistant", async (req, reply) => {
    recordAssistantActivity(req.body.chatId, req.body.characterId);
    return reply.send({ ok: true });
  });

  // ─────────────────────────────────────────────
  // POST /autonomous/check — Check if autonomous message should trigger
  // ─────────────────────────────────────────────
  app.post<{
    Body: { chatId: string };
  }>("/autonomous/check", async (req, reply) => {
    const { chatId } = req.body;
    const chat = await chats.getById(chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const meta = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});

    // Check if autonomous messages are enabled
    if (!meta.autonomousMessages) {
      return reply.send({ shouldTrigger: false, characterIds: [], reason: "disabled", inactivityMs: 0 });
    }

    const schedules: CharacterSchedules = await chats.inheritFreshConversationSchedules(chatId);
    const characterIds: string[] =
      typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : chat.characterIds;
    const isGroup = characterIds.length > 1;

    // Update each character's conversationStatus to match current schedule
    for (const cid of characterIds) {
      const schedule = schedules[cid];
      if (!schedule) continue;
      const { status } = getCurrentStatus(schedule);
      const charRow = await chars.getById(cid);
      if (!charRow) continue;
      const charData = JSON.parse(charRow.data as string);
      const currentStatus = charData.extensions?.conversationStatus;
      if (currentStatus !== status) {
        const extensions = { ...(charData.extensions ?? {}), conversationStatus: status };
        await chars.update(cid, { extensions } as any, undefined, { skipVersionSnapshot: true });
      }
    }

    // Initialize activity state from DB if not already in memory (handles server restart / fresh load)
    const messages = await chats.listMessages(chatId);
    initializeActivityFromMessages(
      chatId,
      messages as Array<{ role: string; createdAt?: string; characterId?: string | null }>,
    );

    // Filter out characters busy in an active scene
    const sceneBusyCharIds: string[] = meta.sceneBusyCharIds ?? [];
    const filteredSchedules = { ...schedules };
    for (const busyId of sceneBusyCharIds) {
      delete filteredSchedules[busyId];
    }

    // Also skip autonomous check entirely if this chat IS an active scene
    if (meta.sceneStatus === "active") {
      return reply.send({ shouldTrigger: false, characterIds: [], reason: "scene_active", inactivityMs: 0 });
    }

    const result = checkAutonomousMessaging(chatId, filteredSchedules, isGroup);

    if (result.shouldTrigger) {
      markGenerationInProgress(chatId);
      return reply.send(result);
    }

    // ── Offline catch-up: if any character is now online and last messages are from user ──
    // This catches the case where user sent messages while character was offline.
    // Now that they're online, trigger a catch-up generation.
    const onlineCharIds = characterIds.filter((cid) => {
      const schedule = schedules[cid];
      if (!schedule) return true; // No schedule = assume online
      const { status } = getCurrentStatus(schedule);
      return status !== "offline";
    });

    if (onlineCharIds.length > 0 && messages.length > 0) {
      // Check if the last message (or consecutive last messages) are all from the user
      const last = messages[messages.length - 1]!;
      if (last.role === "user") {
        // Character is online but hasn't responded — trigger catch-up
        markGenerationInProgress(chatId);
        return reply.send({
          shouldTrigger: true,
          characterIds: onlineCharIds.slice(0, 1), // Pick first online character
          reason: "user_inactivity",
          inactivityMs: 0,
        });
      }
    }

    return reply.send(result);
  });

  // ─────────────────────────────────────────────
  // POST /busy-delay — Calculate response delay based on character status
  // ─────────────────────────────────────────────
  app.post<{
    Body: { chatId: string; characterId: string };
  }>("/busy-delay", async (req, reply) => {
    const { chatId, characterId } = req.body;
    const chat = await chats.getById(chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const schedules: CharacterSchedules = await chats.inheritFreshConversationSchedules(chatId);
    const schedule = schedules[characterId];

    if (!schedule) {
      return reply.send({ delayMs: 0, status: "online", activity: "unknown" });
    }

    const { status, activity } = getCurrentStatus(schedule);
    const delayMs = getBusyDelay(status, schedule);

    return reply.send({ delayMs, status, activity });
  });

  // ─────────────────────────────────────────────
  // POST /autonomous/exchange — Check if another character wants to reply in a group chat
  // ─────────────────────────────────────────────
  app.post<{
    Body: { chatId: string; lastSpeakerCharId: string };
  }>("/autonomous/exchange", async (req, reply) => {
    const { chatId, lastSpeakerCharId } = req.body;
    const chat = await chats.getById(chatId);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const meta = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});
    const characterIds: string[] =
      typeof chat.characterIds === "string" ? JSON.parse(chat.characterIds) : chat.characterIds;

    // Only relevant for group chats
    if (characterIds.length < 2) {
      return reply.send({ shouldTrigger: false, characterIds: [], reason: "not_group", inactivityMs: 0 });
    }

    // Respect the characterExchanges toggle
    if (!meta.characterExchanges) {
      return reply.send({ shouldTrigger: false, characterIds: [], reason: "exchanges_disabled", inactivityMs: 0 });
    }

    const schedules: CharacterSchedules = await chats.inheritFreshConversationSchedules(chatId);
    const messages = await chats.listMessages(chatId);
    initializeActivityFromMessages(
      chatId,
      messages as Array<{ role: string; createdAt?: string; characterId?: string | null }>,
    );

    const result = checkCharacterExchange(chatId, lastSpeakerCharId, schedules);
    if (result.shouldTrigger) {
      markGenerationInProgress(chatId);
    }
    return reply.send(result);
  });
}
