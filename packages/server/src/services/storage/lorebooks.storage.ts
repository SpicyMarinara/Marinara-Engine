// ──────────────────────────────────────────────
// Storage: Lorebooks
// ──────────────────────────────────────────────
import { eq, desc, and, like, inArray, asc } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { lorebooks, lorebookEntries, lorebookFolders } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import type {
  CreateLorebookInput,
  UpdateLorebookInput,
  CreateLorebookEntryInput,
  UpdateLorebookEntryInput,
  CreateLorebookFolderInput,
  UpdateLorebookFolderInput,
} from "@marinara-engine/shared";
import { normalizeTimestampOverrides, type TimestampOverrides } from "../import/import-timestamps.js";

function resolveTimestamps(overrides?: TimestampOverrides | null) {
  const normalized = normalizeTimestampOverrides(overrides);
  const createdAt = normalized?.createdAt ?? now();
  return {
    createdAt,
    updatedAt: normalized?.updatedAt ?? createdAt,
  };
}

/** Parse DB row booleans ("true"/"false") → real booleans and JSON strings → objects. */
function parseLorebookRow(row: Record<string, unknown>) {
  return {
    ...row,
    recursiveScanning: row.recursiveScanning === "true",
    maxRecursionDepth: typeof row.maxRecursionDepth === "number" ? row.maxRecursionDepth : 3,
    enabled: row.enabled === "true",
    generatedBy: row.generatedBy || null,
    sourceAgentId: row.sourceAgentId || null,
    characterId: row.characterId || null,
    personaId: row.personaId || null,
    chatId: row.chatId || null,
    tags: JSON.parse((row.tags as string) || "[]"),
  };
}

function parseEntryRow(row: Record<string, unknown>) {
  return {
    ...row,
    enabled: row.enabled === "true",
    constant: row.constant === "true",
    selective: row.selective === "true",
    matchWholeWords: row.matchWholeWords === "true",
    caseSensitive: row.caseSensitive === "true",
    useRegex: row.useRegex === "true",
    locked: row.locked === "true",
    preventRecursion: row.preventRecursion === "true",
    folderId: (row.folderId as string | null | undefined) ?? null,
    keys: JSON.parse((row.keys as string) || "[]"),
    secondaryKeys: JSON.parse((row.secondaryKeys as string) || "[]"),
    relationships: JSON.parse((row.relationships as string) || "{}"),
    dynamicState: JSON.parse((row.dynamicState as string) || "{}"),
    activationConditions: JSON.parse((row.activationConditions as string) || "[]"),
    schedule: row.schedule ? JSON.parse(row.schedule as string) : null,
    embedding: row.embedding ? JSON.parse(row.embedding as string) : null,
  };
}

function parseFolderRow(row: Record<string, unknown>) {
  return {
    ...row,
    enabled: row.enabled === "true",
    parentFolderId: (row.parentFolderId as string | null | undefined) ?? null,
  };
}

export function createLorebooksStorage(db: DB) {
  return {
    // ── Lorebooks ──

    async list() {
      const rows = await db.select().from(lorebooks).orderBy(desc(lorebooks.updatedAt));
      return rows.map((r) => parseLorebookRow(r as Record<string, unknown>));
    },

    async listByCategory(category: string) {
      const rows = await db
        .select()
        .from(lorebooks)
        .where(eq(lorebooks.category, category))
        .orderBy(desc(lorebooks.updatedAt));
      return rows.map((r) => parseLorebookRow(r as Record<string, unknown>));
    },

    async listByCharacter(characterId: string) {
      const rows = await db
        .select()
        .from(lorebooks)
        .where(eq(lorebooks.characterId, characterId))
        .orderBy(desc(lorebooks.updatedAt));
      return rows.map((r) => parseLorebookRow(r as Record<string, unknown>));
    },

    async listByPersona(personaId: string) {
      const rows = await db
        .select()
        .from(lorebooks)
        .where(eq(lorebooks.personaId, personaId))
        .orderBy(desc(lorebooks.updatedAt));
      return rows.map((r) => parseLorebookRow(r as Record<string, unknown>));
    },

    async listByChat(chatId: string) {
      const rows = await db
        .select()
        .from(lorebooks)
        .where(eq(lorebooks.chatId, chatId))
        .orderBy(desc(lorebooks.updatedAt));
      return rows.map((r) => parseLorebookRow(r as Record<string, unknown>));
    },

    async getById(id: string) {
      const rows = await db.select().from(lorebooks).where(eq(lorebooks.id, id));
      const row = rows[0];
      return row ? parseLorebookRow(row as Record<string, unknown>) : null;
    },

    async create(input: CreateLorebookInput, timestampOverrides?: TimestampOverrides | null) {
      const id = newId();
      const timestamp = resolveTimestamps(timestampOverrides);
      await db.insert(lorebooks).values({
        id,
        name: input.name,
        description: input.description ?? "",
        category: input.category ?? "uncategorized",
        scanDepth: input.scanDepth ?? 2,
        tokenBudget: input.tokenBudget ?? 2048,
        recursiveScanning: String(input.recursiveScanning ?? false),
        maxRecursionDepth: input.maxRecursionDepth ?? 3,
        characterId: input.characterId ?? null,
        personaId: input.personaId ?? null,
        chatId: input.chatId ?? null,
        enabled: String(input.enabled ?? true),
        tags: input.tags ? JSON.stringify(input.tags) : "[]",
        generatedBy: input.generatedBy ?? null,
        sourceAgentId: input.sourceAgentId ?? null,
        createdAt: timestamp.createdAt,
        updatedAt: timestamp.updatedAt,
      });
      return this.getById(id);
    },

    async update(id: string, input: UpdateLorebookInput) {
      const updates: Record<string, unknown> = { updatedAt: now() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.category !== undefined) updates.category = input.category;
      if (input.scanDepth !== undefined) updates.scanDepth = input.scanDepth;
      if (input.tokenBudget !== undefined) updates.tokenBudget = input.tokenBudget;
      if (input.recursiveScanning !== undefined) updates.recursiveScanning = String(input.recursiveScanning);
      if (input.maxRecursionDepth !== undefined) updates.maxRecursionDepth = input.maxRecursionDepth;
      if (input.characterId !== undefined) updates.characterId = input.characterId;
      if (input.personaId !== undefined) updates.personaId = input.personaId;
      if (input.chatId !== undefined) updates.chatId = input.chatId;
      if (input.enabled !== undefined) updates.enabled = String(input.enabled);
      if (input.tags !== undefined) updates.tags = JSON.stringify(input.tags);
      if (input.generatedBy !== undefined) updates.generatedBy = input.generatedBy;
      if (input.sourceAgentId !== undefined) updates.sourceAgentId = input.sourceAgentId;

      await db.update(lorebooks).set(updates).where(eq(lorebooks.id, id));
      return this.getById(id);
    },

    async remove(id: string) {
      await db.delete(lorebooks).where(eq(lorebooks.id, id));
    },

    // ── Entries ──

    async listEntries(lorebookId: string) {
      const rows = await db
        .select()
        .from(lorebookEntries)
        .where(eq(lorebookEntries.lorebookId, lorebookId))
        .orderBy(lorebookEntries.order);
      return rows.map((r) => parseEntryRow(r as Record<string, unknown>));
    },

    /** Get all entries across multiple lorebooks (for prompt injection). */
    async listEntriesByLorebooks(lorebookIds: string[]) {
      if (lorebookIds.length === 0) return [];
      const rows = await db
        .select()
        .from(lorebookEntries)
        .where(inArray(lorebookEntries.lorebookId, lorebookIds))
        .orderBy(lorebookEntries.order);
      return rows.map((r) => parseEntryRow(r as Record<string, unknown>));
    },

    /**
     * Get all enabled entries from lorebooks that are relevant for a given context.
     * A lorebook is relevant if it's enabled AND one of:
     *  - Its ID is in `activeLorebookIds` (user explicitly added it to this chat)
     *  - Its `characterId` matches one of the chat's active characters
     *  - Its `personaId` matches the chat's active persona
     *  - Its `chatId` matches the current chat
     * When no filters are provided, returns entries from ALL enabled lorebooks (legacy behavior).
     *
     * Folder gate: an entry whose `folderId` points at a disabled folder is
     * excluded here, regardless of the entry's own `enabled` flag. The entry's
     * own flag is preserved in the database — re-enabling the folder restores
     * each entry's previous individual setting. Entries with a NULL `folderId`
     * (root-level entries) are unaffected.
     */
    async listActiveEntries(filters?: {
      activeLorebookIds?: string[];
      characterIds?: string[];
      personaId?: string | null;
      chatId?: string;
    }) {
      const enabledBooks = await db.select().from(lorebooks).where(eq(lorebooks.enabled, "true"));

      let relevantBooks = enabledBooks;
      if (filters) {
        relevantBooks = enabledBooks.filter((b) => {
          // Explicitly added to this chat
          if (filters.activeLorebookIds?.includes(b.id)) return true;
          // Belongs to one of the active characters
          if (b.characterId && filters.characterIds?.includes(b.characterId)) return true;
          // Belongs to the active persona
          if (b.personaId && b.personaId === filters.personaId) return true;
          // Belongs to this chat
          if (b.chatId && b.chatId === filters.chatId) return true;
          return false;
        });
      }

      const bookIds = relevantBooks.map((b) => b.id);
      if (bookIds.length === 0) return [];

      // Build the disabled-folder ID set for the relevant lorebooks. Done as
      // an in-memory filter (rather than a SQL anti-join) because folder
      // counts per book are small and this keeps the existing query shape.
      const disabledFolderRows = await db
        .select({ id: lorebookFolders.id })
        .from(lorebookFolders)
        .where(and(inArray(lorebookFolders.lorebookId, bookIds), eq(lorebookFolders.enabled, "false")));
      const disabledFolderIds = new Set(disabledFolderRows.map((r) => r.id));

      const rows = await db
        .select()
        .from(lorebookEntries)
        .where(and(inArray(lorebookEntries.lorebookId, bookIds), eq(lorebookEntries.enabled, "true")))
        .orderBy(lorebookEntries.order);
      const parsed = rows.map((r) => parseEntryRow(r as Record<string, unknown>));
      if (disabledFolderIds.size === 0) return parsed;
      return parsed.filter((e) => !e.folderId || !disabledFolderIds.has(e.folderId as string));
    },

    async getEntry(id: string) {
      const rows = await db.select().from(lorebookEntries).where(eq(lorebookEntries.id, id));
      const row = rows[0];
      return row ? parseEntryRow(row as Record<string, unknown>) : null;
    },

    async createEntry(input: CreateLorebookEntryInput) {
      const id = newId();
      const timestamp = now();
      await db.insert(lorebookEntries).values({
        id,
        lorebookId: input.lorebookId,
        folderId: input.folderId ?? null,
        name: input.name,
        content: input.content ?? "",
        description: input.description ?? "",
        keys: JSON.stringify(input.keys ?? []),
        secondaryKeys: JSON.stringify(input.secondaryKeys ?? []),
        enabled: String(input.enabled ?? true),
        constant: String(input.constant ?? false),
        selective: String(input.selective ?? false),
        selectiveLogic: input.selectiveLogic ?? "and",
        probability: input.probability ?? null,
        scanDepth: input.scanDepth ?? null,
        matchWholeWords: String(input.matchWholeWords ?? false),
        caseSensitive: String(input.caseSensitive ?? false),
        useRegex: String(input.useRegex ?? false),
        position: input.position ?? 0,
        depth: input.depth ?? 0,
        order: input.order ?? 100,
        role: input.role ?? "system",
        sticky: input.sticky ?? null,
        cooldown: input.cooldown ?? null,
        delay: input.delay ?? null,
        ephemeral: input.ephemeral ?? null,
        group: input.group ?? "",
        groupWeight: input.groupWeight ?? null,
        tag: input.tag ?? "",
        relationships: JSON.stringify(input.relationships ?? {}),
        dynamicState: JSON.stringify(input.dynamicState ?? {}),
        activationConditions: JSON.stringify(input.activationConditions ?? []),
        schedule: input.schedule ? JSON.stringify(input.schedule) : null,
        locked: String(input.locked ?? false),
        preventRecursion: String(input.preventRecursion ?? false),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return this.getEntry(id);
    },

    async updateEntry(id: string, input: UpdateLorebookEntryInput) {
      const updates: Record<string, unknown> = { updatedAt: now() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.content !== undefined) updates.content = input.content;
      if (input.description !== undefined) updates.description = input.description;
      if (input.folderId !== undefined) updates.folderId = input.folderId;
      if (input.keys !== undefined) updates.keys = JSON.stringify(input.keys);
      if (input.secondaryKeys !== undefined) updates.secondaryKeys = JSON.stringify(input.secondaryKeys);
      if (input.enabled !== undefined) updates.enabled = String(input.enabled);
      if (input.constant !== undefined) updates.constant = String(input.constant);
      if (input.selective !== undefined) updates.selective = String(input.selective);
      if (input.selectiveLogic !== undefined) updates.selectiveLogic = input.selectiveLogic;
      if (input.probability !== undefined) updates.probability = input.probability;
      if (input.scanDepth !== undefined) updates.scanDepth = input.scanDepth;
      if (input.matchWholeWords !== undefined) updates.matchWholeWords = String(input.matchWholeWords);
      if (input.caseSensitive !== undefined) updates.caseSensitive = String(input.caseSensitive);
      if (input.useRegex !== undefined) updates.useRegex = String(input.useRegex);
      if (input.position !== undefined) updates.position = input.position;
      if (input.depth !== undefined) updates.depth = input.depth;
      if (input.order !== undefined) updates.order = input.order;
      if (input.role !== undefined) updates.role = input.role;
      if (input.sticky !== undefined) updates.sticky = input.sticky;
      if (input.cooldown !== undefined) updates.cooldown = input.cooldown;
      if (input.delay !== undefined) updates.delay = input.delay;
      if (input.ephemeral !== undefined) updates.ephemeral = input.ephemeral;
      if (input.group !== undefined) updates.group = input.group;
      if (input.groupWeight !== undefined) updates.groupWeight = input.groupWeight;
      if (input.tag !== undefined) updates.tag = input.tag;
      if (input.relationships !== undefined) updates.relationships = JSON.stringify(input.relationships);
      if (input.dynamicState !== undefined) updates.dynamicState = JSON.stringify(input.dynamicState);
      if (input.activationConditions !== undefined)
        updates.activationConditions = JSON.stringify(input.activationConditions);
      if (input.schedule !== undefined) updates.schedule = input.schedule ? JSON.stringify(input.schedule) : null;
      if (input.locked !== undefined) updates.locked = String(input.locked);
      if (input.preventRecursion !== undefined) updates.preventRecursion = String(input.preventRecursion);

      await db.update(lorebookEntries).set(updates).where(eq(lorebookEntries.id, id));
      return this.getEntry(id);
    },

    /** Update just the embedding vector for an entry. */
    async updateEntryEmbedding(id: string, embedding: number[] | null) {
      await db
        .update(lorebookEntries)
        .set({ embedding: embedding ? JSON.stringify(embedding) : null, updatedAt: now() })
        .where(eq(lorebookEntries.id, id));
    },

    /** Bulk create entries (for imports and AI generation). */
    async bulkCreateEntries(lorebookId: string, entries: Omit<CreateLorebookEntryInput, "lorebookId">[]) {
      const results = [];
      for (const entry of entries) {
        const result = await this.createEntry({ ...entry, lorebookId });
        results.push(result);
      }
      return results;
    },

    /**
     * Reorder entries inside a single container.
     *
     * `folderId` (undefined = legacy, null = root, string = inside that
     * folder) scopes the reorder so that dragging within one container does
     * not renumber entries in another. When `folderId` is undefined we keep
     * the legacy behavior of renumbering every entry in the lorebook.
     *
     * Renumbering uses (index + 1) * 10 within the container, so each
     * container's order space starts back at 10 — that's intentional and
     * matches the user-facing "each folder is its own container" semantic
     * (a folder at the top can hold high-Order entries without affecting
     * root entries below it).
     */
    async reorderEntries(lorebookId: string, entryIds: string[], folderId?: string | null) {
      const allEntries = (await this.listEntries(lorebookId)) as unknown as Array<Record<string, unknown>>;

      const inScope =
        folderId === undefined
          ? allEntries
          : allEntries.filter((row) => {
              const rowFolder = (row.folderId as string | null | undefined) ?? null;
              return rowFolder === folderId;
            });

      const scopeEntries = inScope.map((row) => ({
        id: String(row.id),
        order: typeof row.order === "number" ? row.order : Number(row.order ?? 0),
      }));
      const orderById = new Map(scopeEntries.map((entry) => [entry.id, entry.order]));
      const scopeIds = new Set(scopeEntries.map((entry) => entry.id));
      const orderedIds = entryIds.filter((id, index, ids) => scopeIds.has(id) && ids.indexOf(id) === index);
      const missingIds = scopeEntries
        .map((entry) => entry.id)
        .filter((id) => !orderedIds.includes(id))
        .sort((leftId, rightId) => (orderById.get(leftId) ?? 0) - (orderById.get(rightId) ?? 0));
      const nextIds = [...orderedIds, ...missingIds];
      const timestamp = now();

      for (const [index, id] of nextIds.entries()) {
        await db
          .update(lorebookEntries)
          .set({ order: (index + 1) * 10, updatedAt: timestamp })
          .where(and(eq(lorebookEntries.id, id), eq(lorebookEntries.lorebookId, lorebookId)));
      }

      return this.listEntries(lorebookId);
    },

    async removeEntry(id: string) {
      await db.delete(lorebookEntries).where(eq(lorebookEntries.id, id));
    },

    // ── Folders ──

    async listFolders(lorebookId: string) {
      const rows = await db
        .select()
        .from(lorebookFolders)
        .where(eq(lorebookFolders.lorebookId, lorebookId))
        .orderBy(asc(lorebookFolders.order));
      return rows.map((r) => parseFolderRow(r as Record<string, unknown>));
    },

    async getFolder(folderId: string) {
      const rows = await db.select().from(lorebookFolders).where(eq(lorebookFolders.id, folderId));
      const row = rows[0];
      return row ? parseFolderRow(row as Record<string, unknown>) : null;
    },

    async createFolder(lorebookId: string, input: CreateLorebookFolderInput) {
      const id = newId();
      const timestamp = now();
      // If the caller didn't pass an explicit order, append after existing folders
      // so the new one shows up at the bottom of the folder block by default.
      let order = input.order ?? 0;
      if (input.order === undefined || input.order === 0) {
        const existing = await db
          .select({ order: lorebookFolders.order })
          .from(lorebookFolders)
          .where(eq(lorebookFolders.lorebookId, lorebookId));
        if (existing.length > 0) {
          order = Math.max(...existing.map((r) => r.order ?? 0)) + 10;
        } else {
          order = 10;
        }
      }
      await db.insert(lorebookFolders).values({
        id,
        lorebookId,
        name: input.name,
        enabled: String(input.enabled ?? true),
        // v1 ignores any non-null parentFolderId — caller is the route layer.
        parentFolderId: input.parentFolderId ?? null,
        order,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return this.getFolder(id);
    },

    async updateFolder(folderId: string, input: UpdateLorebookFolderInput) {
      const updates: Record<string, unknown> = { updatedAt: now() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.enabled !== undefined) updates.enabled = String(input.enabled);
      if (input.parentFolderId !== undefined) updates.parentFolderId = input.parentFolderId;
      if (input.order !== undefined) updates.order = input.order;
      await db.update(lorebookFolders).set(updates).where(eq(lorebookFolders.id, folderId));
      return this.getFolder(folderId);
    },

    /**
     * Remove a folder. Entries inside the folder are NOT deleted — their
     * `folderId` is reset to NULL (root level) so the user doesn't lose
     * data when they remove a folder by accident.
     */
    async removeFolder(folderId: string) {
      const folder = (await this.getFolder(folderId)) as Record<string, unknown> | null;
      if (!folder) return;
      const lorebookId = folder.lorebookId as string;
      await db
        .update(lorebookEntries)
        .set({ folderId: null, updatedAt: now() })
        .where(and(eq(lorebookEntries.lorebookId, lorebookId), eq(lorebookEntries.folderId, folderId)));
      await db.delete(lorebookFolders).where(eq(lorebookFolders.id, folderId));
    },

    /** Renumber folders within a lorebook to match `folderIds` left-to-right. */
    async reorderFolders(lorebookId: string, folderIds: string[]) {
      const existing = (await this.listFolders(lorebookId)) as unknown as Array<{ id: string; order: number }>;
      const orderById = new Map(existing.map((f) => [f.id, f.order]));
      const existingIds = new Set(existing.map((f) => f.id));
      const orderedIds = folderIds.filter((id, index, ids) => existingIds.has(id) && ids.indexOf(id) === index);
      const missingIds = existing
        .map((f) => f.id)
        .filter((id) => !orderedIds.includes(id))
        .sort((a, b) => (orderById.get(a) ?? 0) - (orderById.get(b) ?? 0));
      const nextIds = [...orderedIds, ...missingIds];
      const timestamp = now();
      for (const [index, id] of nextIds.entries()) {
        await db
          .update(lorebookFolders)
          .set({ order: (index + 1) * 10, updatedAt: timestamp })
          .where(and(eq(lorebookFolders.id, id), eq(lorebookFolders.lorebookId, lorebookId)));
      }
      return this.listFolders(lorebookId);
    },

    // ── Search ──

    /** Search entries by keyword match in name/content/keys. */
    async searchEntries(query: string) {
      const pattern = `%${query}%`;
      const rows = await db
        .select()
        .from(lorebookEntries)
        .where(like(lorebookEntries.name, pattern))
        .orderBy(lorebookEntries.order);
      return rows.map((r) => parseEntryRow(r as Record<string, unknown>));
    },
  };
}
