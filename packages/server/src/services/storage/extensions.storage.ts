// ──────────────────────────────────────────────
// Storage: Installed Extensions
// ──────────────────────────────────────────────
import { desc, eq } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { installedExtensions } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import type { CreateExtensionInput, InstalledExtension, UpdateExtensionInput } from "@marinara-engine/shared";

type ExtensionRow = typeof installedExtensions.$inferSelect;

function mapExtension(row: ExtensionRow): InstalledExtension {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    css: row.css ?? null,
    js: row.js ?? null,
    enabled: row.enabled === "true",
    installedAt: row.installedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createExtensionsStorage(db: DB) {
  // Lexical helper so create()/update() don't depend on `this` — keeps the
  // storage object safe to destructure or pass as a callback.
  const getById = async (id: string) => {
    const rows = await db.select().from(installedExtensions).where(eq(installedExtensions.id, id));
    const row = rows[0];
    return row ? mapExtension(row) : null;
  };

  return {
    async list() {
      const rows = await db.select().from(installedExtensions).orderBy(desc(installedExtensions.installedAt));
      return rows.map(mapExtension);
    },

    getById,

    async create(input: CreateExtensionInput) {
      const id = newId();
      const timestamp = now();
      await db.insert(installedExtensions).values({
        id,
        name: input.name,
        description: input.description ?? "",
        css: input.css ?? null,
        js: input.js ?? null,
        enabled: input.enabled === false ? "false" : "true",
        installedAt: input.installedAt ?? timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return getById(id);
    },

    async update(id: string, data: UpdateExtensionInput) {
      const updateFields: Partial<typeof installedExtensions.$inferInsert> = {
        updatedAt: now(),
      };
      if (data.name !== undefined) updateFields.name = data.name;
      if (data.description !== undefined) updateFields.description = data.description;
      if (data.css !== undefined) updateFields.css = data.css;
      if (data.js !== undefined) updateFields.js = data.js;
      if (data.enabled !== undefined) updateFields.enabled = data.enabled ? "true" : "false";
      await db.update(installedExtensions).set(updateFields).where(eq(installedExtensions.id, id));
      return getById(id);
    },

    async remove(id: string) {
      await db.delete(installedExtensions).where(eq(installedExtensions.id, id));
    },
  };
}
