// ──────────────────────────────────────────────
// Storage: Chats
// ──────────────────────────────────────────────
import { eq, desc, and, lt, gt, inArray } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import {
  chats,
  messages,
  messageSwipes,
  gameStateSnapshots,
  chatImages,
  oocInfluences,
  conversationNotes,
  agentRuns,
  agentMemory,
  memoryChunks,
} from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "../../utils/data-dir.js";
import type { CreateChatInput, CreateMessageInput } from "@marinara-engine/shared";
import {
  latestTrustedTimestamp,
  normalizeTimestampOverrides,
  type TimestampOverrides,
} from "../import/import-timestamps.js";
import { scheduleNeedsRefresh, type CharacterSchedules, type WeekSchedule } from "../conversation/schedule.service.js";

const GALLERY_DIR = join(DATA_DIR, "gallery");

/** Total character budget for durable conversation notes per roleplay chat. Oldest pruned on insert. */
export const CONVERSATION_NOTES_BUDGET_CHARS = 4000;

export type MetadataPatch = Record<string, unknown>;
export type MetadataUpdater = (current: MetadataPatch) => MetadataPatch | Promise<MetadataPatch>;

const metadataPatchQueues = new Map<string, Promise<void>>();
const messageExtraPatchQueues = new Map<string, Promise<void>>();
const swipeExtraPatchQueues = new Map<string, Promise<void>>();

async function withPatchQueue<T>(
  queues: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const queued = previous.catch(() => undefined).then(operation);
  const queuedVoid = queued.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, queuedVoid);

  try {
    return await queued;
  } finally {
    if (queues.get(key) === queuedVoid) {
      queues.delete(key);
    }
  }
}

async function withMetadataPatchQueue<T>(chatId: string, operation: () => Promise<T>): Promise<T> {
  return withPatchQueue(metadataPatchQueues, chatId, operation);
}

function parseMetadata(raw: unknown): MetadataPatch {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as MetadataPatch) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? (raw as MetadataPatch) : {};
}

function readUnreadCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function readCharacterIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
}

function hasConversationSchedules(value: unknown): value is CharacterSchedules {
  return !!value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0;
}

function areConversationSchedulesEnabled(meta: MetadataPatch): boolean {
  if (typeof meta.conversationSchedulesEnabled === "boolean") return meta.conversationSchedulesEnabled;
  return hasConversationSchedules(meta.characterSchedules);
}

function parseCharacterIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  } catch {
    return [];
  }
}

function firstScheduleWeekStart(schedules: CharacterSchedules): string | undefined {
  return Object.values(schedules).find((schedule): schedule is WeekSchedule => !!schedule)?.weekStart;
}

function resolveTimestamps(overrides?: TimestampOverrides | null) {
  const normalized = normalizeTimestampOverrides(overrides);
  const createdAt = normalized?.createdAt ?? now();
  return {
    createdAt,
    updatedAt: normalized?.updatedAt ?? createdAt,
  };
}

/** Serialize optional JSON columns while preserving already-encoded metadata. */
function serializeJsonField(value: unknown, fallback: Record<string, unknown>) {
  if (value === undefined || value === null) return JSON.stringify(fallback);
  return typeof value === "string" ? value : JSON.stringify(value);
}

function parseMessageCursor(before?: string): { createdAt: string; rowid: number } | null {
  if (!before) return null;
  const separatorIndex = before.indexOf("|");
  if (separatorIndex <= 0 || separatorIndex === before.length - 1) return null;
  const rowid = Number(before.slice(separatorIndex + 1));
  if (!Number.isSafeInteger(rowid) || rowid < 1) return null;
  return {
    createdAt: before.slice(0, separatorIndex),
    rowid,
  };
}

async function invalidateMemoryChunksFrom(db: DB, chatId: string, createdAt: string) {
  await db.delete(memoryChunks).where(and(eq(memoryChunks.chatId, chatId), gt(memoryChunks.lastMessageAt, createdAt)));
  await db.delete(memoryChunks).where(and(eq(memoryChunks.chatId, chatId), eq(memoryChunks.lastMessageAt, createdAt)));
}

/** Create the chat storage facade used by routes and importers. */
export function createChatsStorage(db: DB) {
  async function collectFreshConversationSchedules(
    characterIds: string[],
    excludeChatId?: string,
  ): Promise<CharacterSchedules> {
    const wanted = new Set(characterIds);
    const sharedSchedules: CharacterSchedules = {};
    if (wanted.size === 0) return sharedSchedules;

    const allChats = await db.select().from(chats).orderBy(desc(chats.updatedAt));
    for (const chat of allChats) {
      if (chat.id === excludeChatId || chat.mode !== "conversation") continue;
      const meta = parseMetadata(chat.metadata);
      if (!areConversationSchedulesEnabled(meta) || !hasConversationSchedules(meta.characterSchedules)) continue;

      for (const [characterId, schedule] of Object.entries(meta.characterSchedules)) {
        if (!wanted.has(characterId) || sharedSchedules[characterId] || scheduleNeedsRefresh(schedule)) continue;
        sharedSchedules[characterId] = schedule;
      }

      if (Object.keys(sharedSchedules).length === wanted.size) break;
    }

    return sharedSchedules;
  }

  return {
    async list() {
      return db.select().from(chats).orderBy(desc(chats.updatedAt));
    },

    async getById(id: string) {
      const rows = await db.select().from(chats).where(eq(chats.id, id));
      return rows[0] ?? null;
    },

    async create(input: CreateChatInput, timestampOverrides?: TimestampOverrides | null) {
      const id = newId();
      const timestamp = resolveTimestamps(timestampOverrides);
      const inheritedSchedules =
        input.mode === "conversation" ? await collectFreshConversationSchedules(input.characterIds) : {};
      const metadata: MetadataPatch = {
        summary: null,
        tags: [],
        enableAgents: true,
        agentOverrides: {},
        activeAgentIds: [],
        activeToolIds: [],
      };
      if (hasConversationSchedules(inheritedSchedules)) {
        metadata.conversationSchedulesEnabled = true;
        metadata.characterSchedules = inheritedSchedules;
        const scheduleWeekStart = firstScheduleWeekStart(inheritedSchedules);
        if (scheduleWeekStart) metadata.scheduleWeekStart = scheduleWeekStart;
      }
      await db.insert(chats).values({
        id,
        name: input.name,
        mode: input.mode,
        characterIds: JSON.stringify(input.characterIds),
        groupId: input.groupId ?? null,
        personaId: input.personaId,
        promptPresetId: input.mode === "conversation" ? null : input.promptPresetId,
        connectionId: input.connectionId,
        metadata: JSON.stringify(metadata),
        createdAt: timestamp.createdAt,
        updatedAt: timestamp.updatedAt,
      });
      return this.getById(id);
    },

    async inheritFreshConversationSchedules(id: string) {
      const chat = await this.getById(id);
      if (!chat || chat.mode !== "conversation") return {};

      const meta = parseMetadata(chat.metadata);
      if (meta.conversationSchedulesEnabled === false) return {};

      const characterIds = parseCharacterIds(chat.characterIds);
      const currentSchedules = hasConversationSchedules(meta.characterSchedules) ? meta.characterSchedules : {};
      const missingOrStaleIds = characterIds.filter((characterId) => {
        const existing = currentSchedules[characterId];
        return !existing || scheduleNeedsRefresh(existing);
      });
      if (missingOrStaleIds.length === 0) return currentSchedules;

      const sharedSchedules = await collectFreshConversationSchedules(missingOrStaleIds, id);
      if (!hasConversationSchedules(sharedSchedules)) return currentSchedules;

      const nextSchedules: CharacterSchedules = { ...currentSchedules, ...sharedSchedules };
      const scheduleWeekStart = firstScheduleWeekStart(nextSchedules);
      await this.patchMetadata(id, {
        conversationSchedulesEnabled: true,
        characterSchedules: nextSchedules,
        ...(scheduleWeekStart ? { scheduleWeekStart } : {}),
      });

      return nextSchedules;
    },

    async update(
      id: string,
      data: Partial<CreateChatInput> & { folderId?: string | null; sortOrder?: number },
      opts?: { tx?: Pick<DB, "select" | "update"> },
    ) {
      const conn = opts?.tx ?? db;
      await conn
        .update(chats)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.mode !== undefined && { mode: data.mode }),
          ...(data.characterIds !== undefined && { characterIds: JSON.stringify(data.characterIds) }),
          ...(data.groupId !== undefined && { groupId: data.groupId }),
          ...(data.personaId !== undefined && { personaId: data.personaId }),
          ...(data.promptPresetId !== undefined && { promptPresetId: data.promptPresetId }),
          ...(data.connectionId !== undefined && { connectionId: data.connectionId }),
          ...(data.folderId !== undefined && { folderId: data.folderId }),
          ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
          updatedAt: now(),
        })
        .where(eq(chats.id, id));
      // Caller-level read; uses outer db so it reads committed state when no
      // tx is in flight, or the in-flight tx state when one is provided.
      const rows = await conn.select().from(chats).where(eq(chats.id, id));
      return rows[0] ?? null;
    },

    /**
     * Set the folder assignment for a chat, propagating to every branch that
     * shares its groupId. The sidebar collapses each group to a single visible
     * row whose folder is read from whichever branch is currently the
     * representative — so when one branch is created or deleted and the rep
     * shifts, every branch must already carry the same folderId or the whole
     * tree falls back to Uncategorized.
     *
     * Sibling branches are updated without bumping updatedAt so categorizing
     * a chat doesn't silently reorder its branch history.
     */
    async setFolderForChat(chatId: string, folderId: string | null, opts?: { tx?: Pick<DB, "select" | "update"> }) {
      const conn = opts?.tx ?? db;
      const rows = await conn.select().from(chats).where(eq(chats.id, chatId));
      const chat = rows[0];
      if (!chat) return null;
      if (chat.groupId) {
        await conn.update(chats).set({ folderId }).where(eq(chats.groupId, chat.groupId));
        await conn.update(chats).set({ updatedAt: now() }).where(eq(chats.id, chatId));
      } else {
        await conn.update(chats).set({ folderId, updatedAt: now() }).where(eq(chats.id, chatId));
      }
      const updated = await conn.select().from(chats).where(eq(chats.id, chatId));
      return updated[0] ?? null;
    },

    /** List all chats belonging to a group. */
    async listByGroup(groupId: string) {
      return db.select().from(chats).where(eq(chats.groupId, groupId)).orderBy(desc(chats.updatedAt));
    },

    async updateMetadata(id: string, metadata: Record<string, unknown>) {
      await db
        .update(chats)
        .set({ metadata: JSON.stringify(metadata), updatedAt: now() })
        .where(eq(chats.id, id));
      return this.getById(id);
    },

    async patchMetadata(
      id: string,
      patchOrUpdater: MetadataPatch | MetadataUpdater,
      opts: { touchUpdatedAt?: boolean } = {},
    ) {
      return withMetadataPatchQueue(id, async () => {
        const existing = await this.getById(id);
        if (!existing) return null;

        const current = parseMetadata(existing.metadata);
        const patch = typeof patchOrUpdater === "function" ? await patchOrUpdater({ ...current }) : patchOrUpdater;
        const merged = { ...current, ...patch };

        await db
          .update(chats)
          .set({
            metadata: JSON.stringify(merged),
            ...(opts.touchUpdatedAt !== false && { updatedAt: now() }),
          })
          .where(eq(chats.id, id));
        return this.getById(id);
      });
    },

    async markAutonomousUnread(id: string, input?: { characterId?: string | null; count?: number }) {
      const timestamp = now();
      return this.patchMetadata(id, (current) => {
        const increment = Math.max(1, Math.floor(input?.count ?? 1));
        const currentCount = readUnreadCount(current.autonomousUnreadCount);
        const characterIds = new Set(readCharacterIds(current.autonomousUnreadCharacterIds));
        if (input?.characterId) characterIds.add(input.characterId);

        return {
          ...current,
          autonomousUnreadCount: currentCount + increment,
          autonomousUnreadCharacterIds: Array.from(characterIds),
          autonomousUnreadAt: timestamp,
        };
      });
    },

    async clearAutonomousUnread(id: string) {
      return this.patchMetadata(
        id,
        (current) => {
          if (
            current.autonomousUnreadCount === undefined &&
            current.autonomousUnreadCharacterIds === undefined &&
            current.autonomousUnreadAt === undefined
          ) {
            return current;
          }

          return {
            autonomousUnreadCount: undefined,
            autonomousUnreadCharacterIds: undefined,
            autonomousUnreadAt: undefined,
          };
        },
        { touchUpdatedAt: false },
      );
    },

    async removeLorebookFromChatMetadata(lorebookId: string) {
      const allChats = await this.list();
      for (const chat of allChats) {
        const metadata = parseMetadata(chat.metadata);
        if (!Array.isArray(metadata.activeLorebookIds)) continue;

        const nextActiveLorebookIds = metadata.activeLorebookIds.filter((id) => id !== lorebookId);
        if (nextActiveLorebookIds.length === metadata.activeLorebookIds.length) continue;

        await this.patchMetadata(chat.id, (current) => {
          const currentLorebookIds = Array.isArray(current.activeLorebookIds) ? current.activeLorebookIds : [];
          return {
            activeLorebookIds: currentLorebookIds.filter((id) => id !== lorebookId),
          };
        });
      }
    },

    async remove(id: string) {
      // Clean up agent data referencing this chat
      await db.delete(agentRuns).where(eq(agentRuns.chatId, id));
      await db.delete(agentMemory).where(eq(agentMemory.chatId, id));

      // Clean up gallery images (DB records + files on disk)
      await db.delete(chatImages).where(eq(chatImages.chatId, id));
      const galleryDir = join(GALLERY_DIR, id);
      if (existsSync(galleryDir)) rmSync(galleryDir, { recursive: true, force: true });

      await db.delete(chats).where(eq(chats.id, id));
    },

    /** Delete all chats in a group (all branches). */
    async removeGroup(groupId: string) {
      // Find all chat IDs in this group, then clean up their data
      const groupChats = await db.select({ id: chats.id }).from(chats).where(eq(chats.groupId, groupId));
      for (const chat of groupChats) {
        await db.delete(agentRuns).where(eq(agentRuns.chatId, chat.id));
        await db.delete(agentMemory).where(eq(agentMemory.chatId, chat.id));
        await db.delete(chatImages).where(eq(chatImages.chatId, chat.id));
        const galleryDir = join(GALLERY_DIR, chat.id);
        if (existsSync(galleryDir)) rmSync(galleryDir, { recursive: true, force: true });
      }

      await db.delete(chats).where(eq(chats.groupId, groupId));
    },

    // ── Messages ──

    async countMessages(chatId: string): Promise<number> {
      const rows = await db.select({ id: messages.id }).from(messages).where(eq(messages.chatId, chatId));
      return rows.length;
    },

    async listMessages(chatId: string) {
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(messages.createdAt, messages.id);
      const decorated = rows.map((m, index) => ({ ...m, rowid: index + 1 }));
      const ids = decorated.map((m) => m.id);
      const swipes = ids.length
        ? await db
            .select({ messageId: messageSwipes.messageId })
            .from(messageSwipes)
            .where(inArray(messageSwipes.messageId, ids))
        : [];
      const countMap = new Map<string, number>();
      for (const swipe of swipes) {
        countMap.set(swipe.messageId, (countMap.get(swipe.messageId) ?? 0) + 1);
      }
      return decorated.map((m) => ({ ...m, swipeCount: countMap.get(m.id) ?? 0 }));
    },

    /** Paginated: returns the latest `limit` messages (optionally before a cursor). */
    async listMessagesPaginated(chatId: string, limit: number, before?: string) {
      const cursor = parseMessageCursor(before);
      const allRows = await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(messages.createdAt, messages.id);
      let candidates = allRows.map((m, index) => ({ ...m, rowid: index + 1 }));
      if (cursor) {
        candidates = candidates.filter(
          (m) => m.createdAt < cursor.createdAt || (m.createdAt === cursor.createdAt && m.rowid < cursor.rowid),
        );
      } else if (before) {
        candidates = candidates.filter((m) => m.createdAt < before);
      }
      const reversed = candidates.slice(-limit);
      const ids = reversed.map((m) => m.id);
      if (ids.length === 0) return reversed;
      const swipes = await db
        .select({ messageId: messageSwipes.messageId })
        .from(messageSwipes)
        .where(inArray(messageSwipes.messageId, ids));
      const countMap = new Map<string, number>();
      for (const swipe of swipes) {
        countMap.set(swipe.messageId, (countMap.get(swipe.messageId) ?? 0) + 1);
      }
      return reversed.map((m) => ({ ...m, swipeCount: countMap.get(m.id) ?? 0 }));
    },

    async getMessage(id: string) {
      const rows = await db.select().from(messages).where(eq(messages.id, id));
      return rows[0] ?? null;
    },

    async createMessage(input: CreateMessageInput, timestampOverrides?: TimestampOverrides | null) {
      const id = newId();
      const timestamp = resolveTimestamps(timestampOverrides).createdAt;
      await db.insert(messages).values({
        id,
        chatId: input.chatId,
        role: input.role,
        characterId: input.characterId,
        content: input.content,
        activeSwipeIndex: 0,
        extra: JSON.stringify({
          displayText: null,
          isGenerated: input.role !== "user",
          tokenCount: null,
          generationInfo: null,
        }),
        createdAt: timestamp,
      });
      // Create the initial swipe (index 0)
      await db.insert(messageSwipes).values({
        id: newId(),
        messageId: id,
        index: 0,
        content: input.content,
        extra: JSON.stringify({}),
        createdAt: timestamp,
      });
      // Update chat's updatedAt
      await db.update(chats).set({ updatedAt: timestamp }).where(eq(chats.id, input.chatId));
      return this.getMessage(id);
    },

    /**
     * Bulk-insert messages in a single transaction. Much faster than one-by-one
     * createMessage calls (especially on Windows/NTFS where each transaction fsync is expensive).
     *
     * Callers may pass `createdAt`, message `extra`, `activeSwipeIndex`,
     * and either the first swipe's `swipeExtra` or the full `swipes` list
     * when cloning/importing existing transcripts so attachments, persona
     * snapshots, hidden context flags, alternate swipes, and original
     * timestamps survive the copy.
     *
     * Does NOT return the created messages or update chat.updatedAt per message —
     * caller should update chat.updatedAt once after the batch.
     */
    async createMessagesBatch(
      chatId: string,
      inputs: Array<
        Omit<CreateMessageInput, "chatId"> & {
          createdAt?: string | null;
          extra?: unknown;
          activeSwipeIndex?: number;
          swipeExtra?: unknown;
          swipes?: Array<{
            index: number;
            content: string;
            extra?: unknown;
            createdAt?: string | null;
          }>;
        }
      >,
      timestampOverrides?: TimestampOverrides | null,
    ) {
      if (inputs.length === 0) return;
      const msgRows: (typeof messages.$inferInsert)[] = [];
      const swipeRows: (typeof messageSwipes.$inferInsert)[] = [];
      const batchTimestamps = resolveTimestamps(timestampOverrides);
      const baseTime = Date.parse(batchTimestamps.createdAt);
      const safeBaseTime = Number.isNaN(baseTime) ? Date.now() : baseTime;
      const createdTimestamps: string[] = [];

      for (let idx = 0; idx < inputs.length; idx++) {
        const input = inputs[idx]!;
        const id = newId();
        const explicitTimestamp = normalizeTimestampOverrides({
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        })?.createdAt;
        const timestamp = explicitTimestamp ?? new Date(safeBaseTime + idx).toISOString();
        createdTimestamps.push(timestamp);
        msgRows.push({
          id,
          chatId,
          role: input.role,
          characterId: input.characterId,
          content: input.content,
          activeSwipeIndex: input.activeSwipeIndex ?? 0,
          extra: serializeJsonField(input.extra, {
            displayText: null,
            isGenerated: input.role !== "user",
            tokenCount: null,
            generationInfo: null,
          }),
          createdAt: timestamp,
        });
        const inputSwipes = input.swipes?.length
          ? [...input.swipes].sort((a, b) => a.index - b.index)
          : [
              {
                index: 0,
                content: input.content,
                extra: input.swipeExtra,
                createdAt: timestamp,
              },
            ];
        for (const swipe of inputSwipes) {
          swipeRows.push({
            id: newId(),
            messageId: id,
            index: swipe.index,
            content: swipe.content,
            extra: serializeJsonField(swipe.extra, {}),
            createdAt: normalizeTimestampOverrides({ createdAt: swipe.createdAt })?.createdAt ?? timestamp,
          });
        }
      }

      const lastTimestamp = latestTrustedTimestamp(createdTimestamps) ?? batchTimestamps.updatedAt;

      // Batch in chunks of 500 to stay within SQLite variable limits.
      // Deliberately avoids db.transaction() — libSQL's stateful transaction
      // objects trigger a use-after-free / race on Windows when the loop is
      // large, causing an access-violation crash (see #73).
      const CHUNK = 500;
      for (let i = 0; i < msgRows.length; i += CHUNK) {
        await db.insert(messages).values(msgRows.slice(i, i + CHUNK));
      }
      for (let i = 0; i < swipeRows.length; i += CHUNK) {
        await db.insert(messageSwipes).values(swipeRows.slice(i, i + CHUNK));
      }
      await db.update(chats).set({ updatedAt: lastTimestamp }).where(eq(chats.id, chatId));
    },

    async updateMessageContent(id: string, content: string) {
      const existing = await this.getMessage(id);
      await db.update(messages).set({ content }).where(eq(messages.id, id));
      if (existing) {
        await invalidateMemoryChunksFrom(db, existing.chatId, existing.createdAt);
      }
      // Also sync the edit to the active swipe row so it persists across swipe switches
      const msg = await this.getMessage(id);
      if (msg) {
        const swipes = await this.getSwipes(id);
        const activeSwipe = swipes.find((s: any) => s.index === msg.activeSwipeIndex);
        if (activeSwipe) {
          await db.update(messageSwipes).set({ content }).where(eq(messageSwipes.id, activeSwipe.id));
        }
      }
      return msg;
    },

    /** Merge partial data into a message's extra JSON field. */
    async updateMessageExtra(id: string, partial: Record<string, unknown>) {
      return withPatchQueue(messageExtraPatchQueues, id, async () => {
        const msg = await this.getMessage(id);
        if (!msg) return null;
        const existing = typeof msg.extra === "string" ? JSON.parse(msg.extra) : (msg.extra ?? {});
        const merged = { ...existing, ...partial };
        await db
          .update(messages)
          .set({ extra: JSON.stringify(merged) })
          .where(eq(messages.id, id));
        return this.getMessage(id);
      });
    },

    /**
     * Bulk-set hiddenFromAI on many messages at once.
     * Reuses updateMessageExtra() for each message (read-parse-merge-write) and
     * syncs the flag to every swipe row so it survives setActiveSwipe() overwrites.
     * Returns the number of messages updated.
     */
    async bulkSetHiddenFromAI(chatId: string, messageIds: string[], hidden: boolean): Promise<number> {
      if (messageIds.length === 0) return 0;
      for (const id of messageIds) {
        await this.updateMessageExtra(id, { hiddenFromAI: hidden });
        // Mirror what the single-message /extra route does: propagate the flag
        // to all swipe rows so setActiveSwipe() cannot clobber it.
        const swipes = await this.getSwipes(id);
        for (const swipe of swipes) {
          await this.updateSwipeExtra(id, swipe.index, { hiddenFromAI: hidden });
        }
      }
      return messageIds.length;
    },

    /** Atomically append an attachment to a message's extra JSON field. */
    async appendMessageAttachment(id: string, attachment: Record<string, unknown>) {
      return withPatchQueue(messageExtraPatchQueues, id, async () => {
        const msg = await this.getMessage(id);
        if (!msg) return null;
        const existing = typeof msg.extra === "string" ? JSON.parse(msg.extra) : (msg.extra ?? {});
        const attachments = Array.isArray(existing.attachments) ? existing.attachments : [];
        const merged = { ...existing, attachments: [...attachments, attachment] };
        await db
          .update(messages)
          .set({ extra: JSON.stringify(merged) })
          .where(eq(messages.id, id));
        return this.getMessage(id);
      });
    },

    async removeMessage(id: string) {
      const existing = await this.getMessage(id);
      await db.delete(messages).where(eq(messages.id, id));
      if (existing) {
        await invalidateMemoryChunksFrom(db, existing.chatId, existing.createdAt);
      }
    },

    async removeMessages(ids: string[], chatId?: string) {
      if (ids.length === 0) return;
      const earliestByChat = new Map<string, string>();
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const condition = chatId
          ? and(inArray(messages.id, chunk), eq(messages.chatId, chatId))
          : inArray(messages.id, chunk);
        const existingRows = await db
          .select({ chatId: messages.chatId, createdAt: messages.createdAt })
          .from(messages)
          .where(condition);
        for (const row of existingRows) {
          const current = earliestByChat.get(row.chatId);
          if (!current || row.createdAt < current) earliestByChat.set(row.chatId, row.createdAt);
        }
        await db.delete(messages).where(condition);
      }
      for (const [affectedChatId, createdAt] of earliestByChat) {
        await invalidateMemoryChunksFrom(db, affectedChatId, createdAt);
      }
    },

    async getSwipes(messageId: string) {
      return db.select().from(messageSwipes).where(eq(messageSwipes.messageId, messageId)).orderBy(messageSwipes.index);
    },

    async addSwipe(messageId: string, content: string, silent?: boolean) {
      const existing = await this.getSwipes(messageId);
      const nextIndex = existing.length;

      // Backfill: save current message extra onto the currently-active swipe
      // so its thinking/generationInfo isn't lost when we switch away
      // (skip when silent — greeting swipes don't need backfill)
      const msg = silent ? null : await this.getMessage(messageId);
      if (msg) {
        const msgExtra = typeof msg.extra === "string" ? JSON.parse(msg.extra) : (msg.extra ?? {});
        const activeSwipe = existing.find((s: any) => s.index === msg.activeSwipeIndex);
        if (activeSwipe) {
          await db
            .update(messageSwipes)
            .set({ extra: JSON.stringify(msgExtra) })
            .where(eq(messageSwipes.id, activeSwipe.id));
        }
      }

      const id = newId();
      await db.insert(messageSwipes).values({
        id,
        messageId,
        index: nextIndex,
        content,
        extra: JSON.stringify({}),
        createdAt: now(),
      });

      // When silent, only insert the swipe row without switching the active index
      if (!silent) {
        // Set active swipe to the new one and reset message extra for the fresh swipe
        // (thinking/generationInfo will be populated by updateMessageExtra after generation)
        const clearedExtra = msg
          ? {
              ...(typeof msg.extra === "string" ? JSON.parse(msg.extra) : (msg.extra ?? {})),
              thinking: null,
              generationInfo: null,
              attachments: null,
              generationReplay: null,
            }
          : {};
        await db
          .update(messages)
          .set({ activeSwipeIndex: nextIndex, content, extra: JSON.stringify(clearedExtra) })
          .where(eq(messages.id, messageId));
        if (msg) {
          await invalidateMemoryChunksFrom(db, msg.chatId, msg.createdAt);
        }
      }
      return { id, index: nextIndex };
    },

    async setActiveSwipe(messageId: string, index: number) {
      const swipes = await this.getSwipes(messageId);
      const target = swipes.find((s: any) => s.index === index);
      if (!target) return null;

      // Before switching, save current message content and extra onto the outgoing swipe
      const msg = await this.getMessage(messageId);
      if (msg) {
        const msgExtra = typeof msg.extra === "string" ? JSON.parse(msg.extra) : (msg.extra ?? {});
        const outgoingSwipe = swipes.find((s: any) => s.index === msg.activeSwipeIndex);
        if (outgoingSwipe) {
          await db
            .update(messageSwipes)
            .set({ content: msg.content, extra: JSON.stringify(msgExtra) })
            .where(eq(messageSwipes.id, outgoingSwipe.id));
        }
      }

      // Sync the target swipe's extra onto the message
      const swipeExtra = typeof target.extra === "string" ? JSON.parse(target.extra) : (target.extra ?? {});
      await db
        .update(messages)
        .set({
          activeSwipeIndex: index,
          content: target.content,
          extra: JSON.stringify(swipeExtra),
        })
        .where(eq(messages.id, messageId));
      if (msg) {
        await invalidateMemoryChunksFrom(db, msg.chatId, msg.createdAt);
      }
      return this.getMessage(messageId);
    },

    async removeSwipe(messageId: string, index: number) {
      const msg = await this.getMessage(messageId);
      if (!msg) return null;

      const swipes = await this.getSwipes(messageId);
      const target = swipes.find((s: any) => s.index === index);
      if (!target || swipes.length <= 1) return null;

      const remaining = swipes.filter((s: any) => s.index !== index);
      const currentExtra = typeof msg.extra === "string" ? JSON.parse(msg.extra) : (msg.extra ?? {});

      const activeSwipeRemoved = msg.activeSwipeIndex === index;
      let nextActiveSwipeIndex = msg.activeSwipeIndex;
      let nextContent = msg.content;
      let nextExtra = currentExtra;

      if (msg.activeSwipeIndex > index) {
        nextActiveSwipeIndex = msg.activeSwipeIndex - 1;
      } else if (msg.activeSwipeIndex === index) {
        nextActiveSwipeIndex = Math.min(index, remaining.length - 1);
        const replacement = remaining[index] ?? remaining[remaining.length - 1];
        if (replacement) {
          nextContent = replacement.content;
          nextExtra = typeof replacement.extra === "string" ? JSON.parse(replacement.extra) : (replacement.extra ?? {});
        }
      }

      await db.delete(messageSwipes).where(eq(messageSwipes.id, target.id));
      await db
        .delete(gameStateSnapshots)
        .where(and(eq(gameStateSnapshots.messageId, messageId), eq(gameStateSnapshots.swipeIndex, index)));

      const swipesToShift = await db
        .select()
        .from(messageSwipes)
        .where(and(eq(messageSwipes.messageId, messageId), gt(messageSwipes.index, index)));
      for (const swipe of swipesToShift) {
        await db
          .update(messageSwipes)
          .set({ index: swipe.index - 1 })
          .where(eq(messageSwipes.id, swipe.id));
      }

      const snapshotsToShift = await db
        .select()
        .from(gameStateSnapshots)
        .where(and(eq(gameStateSnapshots.messageId, messageId), gt(gameStateSnapshots.swipeIndex, index)));
      for (const snapshot of snapshotsToShift) {
        await db
          .update(gameStateSnapshots)
          .set({ swipeIndex: snapshot.swipeIndex - 1 })
          .where(eq(gameStateSnapshots.id, snapshot.id));
      }

      await db
        .update(messages)
        .set({
          activeSwipeIndex: nextActiveSwipeIndex,
          content: nextContent,
          extra: JSON.stringify(nextExtra),
        })
        .where(eq(messages.id, messageId));
      if (activeSwipeRemoved) {
        await invalidateMemoryChunksFrom(db, msg.chatId, msg.createdAt);
      }

      return this.getMessage(messageId);
    },

    /** Merge partial data into a swipe's extra JSON field. */
    async updateSwipeExtra(messageId: string, swipeIndex: number, partial: Record<string, unknown>) {
      return withPatchQueue(swipeExtraPatchQueues, `${messageId}:${swipeIndex}`, async () => {
        const swipes = await this.getSwipes(messageId);
        const target = swipes.find((s: any) => s.index === swipeIndex);
        if (!target) return;
        const existing = typeof target.extra === "string" ? JSON.parse(target.extra) : (target.extra ?? {});
        const merged = { ...existing, ...partial };
        await db
          .update(messageSwipes)
          .set({ extra: JSON.stringify(merged) })
          .where(eq(messageSwipes.id, target.id));
      });
    },

    /** Atomically append an attachment to a swipe's extra JSON field. */
    async appendSwipeAttachment(messageId: string, swipeIndex: number, attachment: Record<string, unknown>) {
      return withPatchQueue(swipeExtraPatchQueues, `${messageId}:${swipeIndex}`, async () => {
        const swipes = await this.getSwipes(messageId);
        const target = swipes.find((s: any) => s.index === swipeIndex);
        if (!target) return;
        const existing = typeof target.extra === "string" ? JSON.parse(target.extra) : (target.extra ?? {});
        const attachments = Array.isArray(existing.attachments) ? existing.attachments : [];
        const merged = { ...existing, attachments: [...attachments, attachment] };
        await db
          .update(messageSwipes)
          .set({ extra: JSON.stringify(merged) })
          .where(eq(messageSwipes.id, target.id));
      });
    },

    // ── Chat Connections ──

    /** Bidirectionally link two chats. */
    async connectChats(chatIdA: string, chatIdB: string) {
      const timestamp = now();
      await db.update(chats).set({ connectedChatId: chatIdB, updatedAt: timestamp }).where(eq(chats.id, chatIdA));
      await db.update(chats).set({ connectedChatId: chatIdA, updatedAt: timestamp }).where(eq(chats.id, chatIdB));
    },

    /** Remove the bidirectional link for a chat (and its partner). */
    async disconnectChat(chatId: string) {
      const chat = await this.getById(chatId);
      if (!chat) return;
      const parsed = typeof chat.connectedChatId === "string" ? chat.connectedChatId : null;
      const timestamp = now();
      await db.update(chats).set({ connectedChatId: null, updatedAt: timestamp }).where(eq(chats.id, chatId));
      if (parsed) {
        await db.update(chats).set({ connectedChatId: null, updatedAt: timestamp }).where(eq(chats.id, parsed));
      }
    },

    // ── OOC Influences ──

    /** Create a queued influence from a conversation → its connected roleplay. */
    async createInfluence(sourceChatId: string, targetChatId: string, content: string, anchorMessageId?: string) {
      const id = newId();
      await db.insert(oocInfluences).values({
        id,
        sourceChatId,
        targetChatId,
        content,
        anchorMessageId: anchorMessageId ?? null,
        consumed: "false",
        createdAt: now(),
      });
      return id;
    },

    /** Get all unconsumed influences targeting a chat. */
    async listPendingInfluences(targetChatId: string) {
      return db
        .select()
        .from(oocInfluences)
        .where(and(eq(oocInfluences.targetChatId, targetChatId), eq(oocInfluences.consumed, "false")))
        .orderBy(oocInfluences.createdAt);
    },

    /** Mark an influence as consumed after it's been injected. */
    async markInfluenceConsumed(id: string) {
      await db.update(oocInfluences).set({ consumed: "true" }).where(eq(oocInfluences.id, id));
    },

    /** Delete all influences associated with a chat (as source or target). */
    async deleteInfluencesForChat(chatId: string) {
      await db.delete(oocInfluences).where(eq(oocInfluences.sourceChatId, chatId));
      await db.delete(oocInfluences).where(eq(oocInfluences.targetChatId, chatId));
    },

    // ── Conversation Notes ──

    /** Create a durable note from a conversation → its connected roleplay, then prune oldest past the char budget. */
    async createNote(sourceChatId: string, targetChatId: string, content: string, anchorMessageId?: string) {
      const id = newId();
      await db.insert(conversationNotes).values({
        id,
        sourceChatId,
        targetChatId,
        content,
        anchorMessageId: anchorMessageId ?? null,
        createdAt: now(),
      });

      const all = await db
        .select()
        .from(conversationNotes)
        .where(eq(conversationNotes.targetChatId, targetChatId))
        .orderBy(desc(conversationNotes.createdAt), desc(conversationNotes.id));

      const toDelete: string[] = [];
      let total = 0;
      for (let i = 0; i < all.length; i++) {
        total += all[i]!.content.length;
        // Always keep the newest note even if it alone exceeds the budget.
        if (i > 0 && total > CONVERSATION_NOTES_BUDGET_CHARS) {
          toDelete.push(all[i]!.id);
        }
      }
      if (toDelete.length > 0) {
        await db.delete(conversationNotes).where(inArray(conversationNotes.id, toDelete));
      }

      return id;
    },

    /** List all durable notes targeting a chat, oldest first (for stable prompt ordering).
     *  `id` secondary sort gives deterministic ordering when timestamps tie (e.g. multiple
     *  `<note>` tags emitted in a single character response within one millisecond). */
    async listNotes(targetChatId: string) {
      return db
        .select()
        .from(conversationNotes)
        .where(eq(conversationNotes.targetChatId, targetChatId))
        .orderBy(conversationNotes.createdAt, conversationNotes.id);
    },

    /** Delete a single note by id, scoped to its target chat. */
    async deleteNoteForChat(targetChatId: string, id: string) {
      await db
        .delete(conversationNotes)
        .where(and(eq(conversationNotes.targetChatId, targetChatId), eq(conversationNotes.id, id)));
    },

    /** Clear every note targeting a chat. */
    async clearNotes(targetChatId: string) {
      await db.delete(conversationNotes).where(eq(conversationNotes.targetChatId, targetChatId));
    },

    /** Delete all notes associated with a chat (as source or target). */
    async deleteNotesForChat(chatId: string) {
      await db.delete(conversationNotes).where(eq(conversationNotes.sourceChatId, chatId));
      await db.delete(conversationNotes).where(eq(conversationNotes.targetChatId, chatId));
    },
  };
}
