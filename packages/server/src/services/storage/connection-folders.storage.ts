// ──────────────────────────────────────────────
// Storage: API Connection Folders
// ──────────────────────────────────────────────
import { eq } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { apiConnectionFolders, apiConnections } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";

export function createConnectionFoldersStorage(db: DB) {
  return {
    async list() {
      return db.select().from(apiConnectionFolders).orderBy(apiConnectionFolders.sortOrder);
    },

    async getById(id: string) {
      const rows = await db.select().from(apiConnectionFolders).where(eq(apiConnectionFolders.id, id));
      return rows[0] ?? null;
    },

    async create(input: { name: string; color?: string }) {
      const id = newId();
      const timestamp = now();
      // Shift existing folders down and place new folder at the top.
      // Atomic so a partial failure can't leave the sort_order column in a
      // half-shifted state with no new folder.
      await db.transaction(async (tx) => {
        const existing = await tx.select().from(apiConnectionFolders);
        for (const f of existing) {
          await tx
            .update(apiConnectionFolders)
            .set({ sortOrder: f.sortOrder + 1 })
            .where(eq(apiConnectionFolders.id, f.id));
        }
        await tx.insert(apiConnectionFolders).values({
          id,
          name: input.name,
          color: input.color ?? "",
          sortOrder: 0,
          collapsed: "false",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      });
      return this.getById(id);
    },

    async update(id: string, data: Partial<{ name: string; color: string; sortOrder: number; collapsed: boolean }>) {
      await db
        .update(apiConnectionFolders)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.color !== undefined && { color: data.color }),
          ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
          ...(data.collapsed !== undefined && { collapsed: data.collapsed ? "true" : "false" }),
          updatedAt: now(),
        })
        .where(eq(apiConnectionFolders.id, id));
      return this.getById(id);
    },

    async remove(id: string) {
      // Unfile all connections in this folder (move back to root).
      await db.update(apiConnections).set({ folderId: null }).where(eq(apiConnections.folderId, id));
      await db.delete(apiConnectionFolders).where(eq(apiConnectionFolders.id, id));
    },

    async reorder(orderedIds: string[]) {
      // Atomic: same rationale as chat-folders reorder — a partial failure
      // would leave the folder list with mixed sort orders.
      const timestamp = now();
      await db.transaction(async (tx) => {
        for (let i = 0; i < orderedIds.length; i++) {
          await tx
            .update(apiConnectionFolders)
            .set({ sortOrder: i, updatedAt: timestamp })
            .where(eq(apiConnectionFolders.id, orderedIds[i]!));
        }
      });
    },

    async moveConnection(connectionId: string, folderId: string | null) {
      await db
        .update(apiConnections)
        .set({ folderId, updatedAt: now() })
        .where(eq(apiConnections.id, connectionId));
    },

    async reorderConnections(orderedIds: string[], folderId: string | null) {
      // Atomic: prevents a partial failure from leaving connections with a
      // mix of old and new sort_order / folder_id values within the same
      // logical operation.
      const timestamp = now();
      await db.transaction(async (tx) => {
        for (let i = 0; i < orderedIds.length; i++) {
          await tx
            .update(apiConnections)
            .set({ sortOrder: i + 1, folderId, updatedAt: timestamp })
            .where(eq(apiConnections.id, orderedIds[i]!));
        }
      });
    },
  };
}
