// ──────────────────────────────────────────────
// Storage: Custom Tools
// ──────────────────────────────────────────────
import { eq, desc } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { customTools } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import type { CreateCustomToolInput } from "@marinara-engine/shared";

export function createCustomToolsStorage(db: DB) {
  return {
    async list() {
      return db.select().from(customTools).orderBy(desc(customTools.updatedAt));
    },

    async listEnabled() {
      const rows = await db.select().from(customTools).orderBy(customTools.name);
      return rows.filter((r) => r.enabled === "true");
    },

    async getById(id: string) {
      const rows = await db.select().from(customTools).where(eq(customTools.id, id));
      return rows[0] ?? null;
    },

    async getByName(name: string) {
      const rows = await db.select().from(customTools).where(eq(customTools.name, name));
      return rows[0] ?? null;
    },

    async create(input: CreateCustomToolInput) {
      const id = newId();
      const timestamp = now();
      await db.insert(customTools).values({
        id,
        name: input.name,
        description: input.description ?? "",
        parametersSchema: JSON.stringify(input.parametersSchema ?? {}),
        executionType: input.executionType ?? "static",
        webhookUrl: input.webhookUrl ?? null,
        staticResult: input.staticResult ?? null,
        scriptBody: input.scriptBody ?? null,
        enabled: String(input.executionType === "script" ? false : (input.enabled ?? true)),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return this.getById(id);
    },

    async update(id: string, data: Partial<CreateCustomToolInput>) {
      const updateFields: Record<string, unknown> = { updatedAt: now() };
      if (data.name !== undefined) updateFields.name = data.name;
      if (data.description !== undefined) updateFields.description = data.description;
      if (data.parametersSchema !== undefined) updateFields.parametersSchema = JSON.stringify(data.parametersSchema);
      if (data.executionType !== undefined) {
        updateFields.executionType = data.executionType;
        if (data.executionType === "script" && data.enabled === undefined) updateFields.enabled = "false";
      }
      if (data.webhookUrl !== undefined) updateFields.webhookUrl = data.webhookUrl;
      if (data.staticResult !== undefined) updateFields.staticResult = data.staticResult;
      if (data.scriptBody !== undefined) updateFields.scriptBody = data.scriptBody;
      if (data.enabled !== undefined) updateFields.enabled = String(data.executionType === "script" ? false : data.enabled);
      await db.update(customTools).set(updateFields).where(eq(customTools.id, id));
      return this.getById(id);
    },

    async remove(id: string) {
      await db.delete(customTools).where(eq(customTools.id, id));
    },
  };
}
