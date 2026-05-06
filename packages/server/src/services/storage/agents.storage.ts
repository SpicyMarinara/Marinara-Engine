// ──────────────────────────────────────────────
// Storage: Agent Configs, Runs & Memory
// ──────────────────────────────────────────────
import { eq, and, desc } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { agentConfigs, agentRuns, agentMemory } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import {
  BUILT_IN_AGENTS,
  getDefaultBuiltInAgentSettings,
  type CreateAgentConfigInput,
  type AgentResult,
} from "@marinara-engine/shared";

const BUILTIN_AGENT_ID_PREFIX = "builtin:";
const BUILT_IN_AGENT_TYPES = new Set(BUILT_IN_AGENTS.map((agent) => agent.id));
type AgentRunRow = typeof agentRuns.$inferSelect;
type AgentConfigRow = typeof agentConfigs.$inferSelect;

function isBuiltInAgentType(type: string): boolean {
  return BUILT_IN_AGENT_TYPES.has(type);
}

function suffixFromId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 8) || Date.now().toString(36);
}

function getBuiltinAgentType(agentConfigId: string): string | null {
  if (!agentConfigId.startsWith(BUILTIN_AGENT_ID_PREFIX)) return null;
  const agentType = agentConfigId.slice(BUILTIN_AGENT_ID_PREFIX.length).trim();
  return agentType.length > 0 ? agentType : null;
}

function keepLatestConfigPerType<T extends { type: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const latestRows: T[] = [];
  for (const row of rows) {
    if (seen.has(row.type)) continue;
    seen.add(row.type);
    latestRows.push(row);
  }
  return latestRows;
}

function parseRunData(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function serializeRunWithConfig(row: { agent_runs: AgentRunRow; agent_configs: AgentConfigRow }) {
  return {
    id: row.agent_runs.id,
    agentConfigId: row.agent_runs.agentConfigId,
    agentType: row.agent_configs.type,
    agentName: row.agent_configs.name,
    chatId: row.agent_runs.chatId,
    messageId: row.agent_runs.messageId,
    resultType: row.agent_runs.resultType,
    resultData: parseRunData(row.agent_runs.resultData),
    tokensUsed: row.agent_runs.tokensUsed,
    durationMs: row.agent_runs.durationMs,
    success: row.agent_runs.success === "true",
    error: row.agent_runs.error,
    createdAt: row.agent_runs.createdAt,
  };
}

export function createAgentsStorage(db: DB) {
  async function getById(id: string) {
    const rows = await db.select().from(agentConfigs).where(eq(agentConfigs.id, id));
    return rows[0] ?? null;
  }

  async function getByType(type: string) {
    const rows = await db
      .select()
      .from(agentConfigs)
      .where(eq(agentConfigs.type, type))
      .orderBy(desc(agentConfigs.updatedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getUniqueCustomType(requestedType: string, id: string) {
    const baseType = requestedType.trim() || `custom-${suffixFromId(id)}`;
    if (!(await getByType(baseType))) return baseType;

    const suffix = suffixFromId(id);
    let candidate = `${baseType}-${suffix}`;
    let attempt = 2;
    while (await getByType(candidate)) {
      candidate = `${baseType}-${suffix}-${attempt}`;
      attempt++;
    }
    return candidate;
  }

  async function listLatest() {
    const rows = await db.select().from(agentConfigs).orderBy(desc(agentConfigs.updatedAt));
    return keepLatestConfigPerType(rows);
  }

  async function ensureBuiltinConfig(type: string) {
    const builtIn = BUILT_IN_AGENTS.find((agent) => agent.id === type);
    if (!builtIn) return null;

    const existing = await getByType(type);
    if (existing) return existing;

    const id = `${BUILTIN_AGENT_ID_PREFIX}${type}`;
    const timestamp = now();

    try {
      await db.insert(agentConfigs).values({
        id,
        type: builtIn.id,
        name: builtIn.name,
        description: builtIn.description,
        phase: builtIn.phase,
        enabled: String(builtIn.enabledByDefault),
        connectionId: null,
        promptTemplate: "",
        settings: JSON.stringify(getDefaultBuiltInAgentSettings(builtIn.id)),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } catch {
      // Another request may have materialized the row first.
    }

    return (await getById(id)) ?? getByType(type);
  }

  async function resolveAgentConfigId(agentConfigId: string) {
    const builtinType = getBuiltinAgentType(agentConfigId);
    if (!builtinType) return agentConfigId;
    const config = await ensureBuiltinConfig(builtinType);
    return config?.id ?? agentConfigId;
  }

  return {
    // ── Config CRUD ──

    async list() {
      return listLatest();
    },

    async listEnabled() {
      const rows = await listLatest();
      return rows.filter((row) => row.enabled === "true");
    },

    getById,

    getByType,

    async create(input: CreateAgentConfigInput) {
      const builtInType = isBuiltInAgentType(input.type);
      if (builtInType) {
        const existing = await getByType(input.type);
        if (existing) {
          return this.update(existing.id, input);
        }
      }

      const id = newId();
      const timestamp = now();
      const type = builtInType ? input.type : await getUniqueCustomType(input.type, id);
      const settings = { ...(input.settings ?? {}) };
      if (input.resultType) settings.resultType = input.resultType;
      await db.insert(agentConfigs).values({
        id,
        type,
        name: input.name,
        description: input.description ?? "",
        phase: input.phase,
        enabled: String(input.enabled ?? true),
        connectionId: input.connectionId ?? null,
        promptTemplate: input.promptTemplate ?? "",
        settings: JSON.stringify(settings),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return this.getById(id);
    },

    async update(id: string, data: Partial<CreateAgentConfigInput>) {
      const updateFields: Record<string, unknown> = { updatedAt: now() };
      if (data.name !== undefined) updateFields.name = data.name;
      if (data.description !== undefined) updateFields.description = data.description;
      if (data.phase !== undefined) updateFields.phase = data.phase;
      if (data.enabled !== undefined) updateFields.enabled = String(data.enabled);
      if (data.connectionId !== undefined) updateFields.connectionId = data.connectionId;
      if (data.promptTemplate !== undefined) updateFields.promptTemplate = data.promptTemplate;
      if (data.settings !== undefined || data.resultType !== undefined) {
        if (data.settings !== undefined) {
          const settings = { ...data.settings };
          if (data.resultType !== undefined) settings.resultType = data.resultType;
          updateFields.settings = JSON.stringify(settings);
        } else {
          const current = await getById(id);
          const currentSettings = current?.settings ? JSON.parse(current.settings as string) : {};
          updateFields.settings = JSON.stringify({ ...currentSettings, resultType: data.resultType });
        }
      }
      await db.update(agentConfigs).set(updateFields).where(eq(agentConfigs.id, id));
      return this.getById(id);
    },

    async remove(id: string) {
      await db.delete(agentRuns).where(eq(agentRuns.agentConfigId, id));
      await db.delete(agentMemory).where(eq(agentMemory.agentConfigId, id));
      await db.delete(agentConfigs).where(eq(agentConfigs.id, id));
    },

    // ── Agent Runs ──

    async saveRun(input: { agentConfigId: string; chatId: string; messageId: string; result: AgentResult }) {
      const agentConfigId = await resolveAgentConfigId(input.agentConfigId);
      const id = newId();
      await db.insert(agentRuns).values({
        id,
        agentConfigId,
        chatId: input.chatId,
        messageId: input.messageId,
        resultType: input.result.type,
        resultData: JSON.stringify(input.result.data),
        tokensUsed: input.result.tokensUsed,
        durationMs: input.result.durationMs,
        success: String(input.result.success),
        error: input.result.error,
        createdAt: now(),
      });
      return id;
    },

    /** Get the most recent successful run of an agent type in a given chat. */
    async getLastSuccessfulRunByType(agentType: string, chatId: string) {
      const rows = await db
        .select()
        .from(agentRuns)
        .innerJoin(agentConfigs, eq(agentRuns.agentConfigId, agentConfigs.id))
        .where(and(eq(agentConfigs.type, agentType), eq(agentRuns.chatId, chatId), eq(agentRuns.success, "true")))
        .orderBy(desc(agentRuns.createdAt))
        .limit(1);
      return rows[0]?.agent_runs ?? null;
    },

    /** Get the most recent run of an agent type in a given chat, regardless of success. */
    async getLastRunByType(agentType: string, chatId: string) {
      const rows = await db
        .select()
        .from(agentRuns)
        .innerJoin(agentConfigs, eq(agentRuns.agentConfigId, agentConfigs.id))
        .where(and(eq(agentConfigs.type, agentType), eq(agentRuns.chatId, chatId)))
        .orderBy(desc(agentRuns.createdAt))
        .limit(1);
      return rows[0]?.agent_runs ?? null;
    },

    /** Get all echo chamber messages for a chat, ordered by creation time. */
    async getEchoMessages(chatId: string) {
      const rows = await db
        .select({ resultData: agentRuns.resultData, createdAt: agentRuns.createdAt })
        .from(agentRuns)
        .where(
          and(eq(agentRuns.chatId, chatId), eq(agentRuns.resultType, "echo_message"), eq(agentRuns.success, "true")),
        )
        .orderBy(agentRuns.createdAt);

      const messages: Array<{ characterName: string; reaction: string; timestamp: number }> = [];
      for (const row of rows) {
        try {
          const data = JSON.parse(row.resultData);
          const reactions = data?.reactions ?? [];
          const ts = new Date(row.createdAt).getTime();
          for (const r of reactions) {
            if (r.characterName && r.reaction) {
              messages.push({ characterName: r.characterName, reaction: r.reaction, timestamp: ts });
            }
          }
        } catch {
          /* skip malformed entries */
        }
      }
      return messages;
    },

    /** Get recent custom-agent runs for a chat, newest first. */
    async listCustomRunsForChat(chatId: string, limit = 50) {
      const normalizedLimit = Math.max(1, Math.min(limit, 200));
      const rows = await db
        .select()
        .from(agentRuns)
        .innerJoin(agentConfigs, eq(agentRuns.agentConfigId, agentConfigs.id))
        .where(and(eq(agentRuns.chatId, chatId), eq(agentRuns.success, "true")))
        .orderBy(desc(agentRuns.createdAt))
        .limit(200);

      return rows
        .filter((row) => !isBuiltInAgentType(row.agent_configs.type))
        .slice(0, normalizedLimit)
        .map((row) => serializeRunWithConfig(row));
    },

    async getRunWithConfig(id: string) {
      const rows = await db
        .select()
        .from(agentRuns)
        .innerJoin(agentConfigs, eq(agentRuns.agentConfigId, agentConfigs.id))
        .where(eq(agentRuns.id, id))
        .limit(1);
      const row = rows[0];
      return row ? serializeRunWithConfig(row) : null;
    },

    async updateRunResultData(id: string, resultData: unknown) {
      await db
        .update(agentRuns)
        .set({ resultData: JSON.stringify(resultData) })
        .where(eq(agentRuns.id, id));
      return this.getRunWithConfig(id);
    },

    // ── Agent Memory (persistent KV per agent per chat) ──

    async getMemory(agentConfigId: string, chatId: string): Promise<Record<string, unknown>> {
      const resolvedAgentConfigId = await resolveAgentConfigId(agentConfigId);
      const rows = await db
        .select()
        .from(agentMemory)
        .where(and(eq(agentMemory.agentConfigId, resolvedAgentConfigId), eq(agentMemory.chatId, chatId)));
      const mem: Record<string, unknown> = {};
      for (const row of rows) {
        try {
          mem[row.key] = JSON.parse(row.value);
        } catch {
          mem[row.key] = row.value;
        }
      }
      return mem;
    },

    async setMemory(agentConfigId: string, chatId: string, key: string, value: unknown) {
      const resolvedAgentConfigId = await resolveAgentConfigId(agentConfigId);
      const stringValue = typeof value === "string" ? value : JSON.stringify(value);
      const existing = await db
        .select()
        .from(agentMemory)
        .where(
          and(
            eq(agentMemory.agentConfigId, resolvedAgentConfigId),
            eq(agentMemory.chatId, chatId),
            eq(agentMemory.key, key),
          ),
        );

      if (existing.length > 0) {
        await db
          .update(agentMemory)
          .set({ value: stringValue, updatedAt: now() })
          .where(eq(agentMemory.id, existing[0]!.id));
      } else {
        await db.insert(agentMemory).values({
          id: newId(),
          agentConfigId: resolvedAgentConfigId,
          chatId,
          key,
          value: stringValue,
          updatedAt: now(),
        });
      }
    },

    async setMemories(agentConfigId: string, chatId: string, values: Record<string, unknown>) {
      const resolvedAgentConfigId = await resolveAgentConfigId(agentConfigId);
      const entries = Object.entries(values)
        .filter((entry): entry is [string, unknown] => entry[1] !== undefined)
        .map(([key, value]) => ({
          key,
          value: typeof value === "string" ? value : JSON.stringify(value),
        }));
      if (entries.length === 0) return;

      await db.transaction(async (tx) => {
        const existingRows = await tx
          .select()
          .from(agentMemory)
          .where(and(eq(agentMemory.agentConfigId, resolvedAgentConfigId), eq(agentMemory.chatId, chatId)));
        const existingByKey = new Map(existingRows.map((row) => [row.key, row]));
        const timestamp = now();
        const inserts: (typeof agentMemory.$inferInsert)[] = [];

        for (const entry of entries) {
          const existing = existingByKey.get(entry.key);
          if (existing) {
            await tx
              .update(agentMemory)
              .set({ value: entry.value, updatedAt: timestamp })
              .where(eq(agentMemory.id, existing.id));
          } else {
            inserts.push({
              id: newId(),
              agentConfigId: resolvedAgentConfigId,
              chatId,
              key: entry.key,
              value: entry.value,
              updatedAt: timestamp,
            });
          }
        }

        if (inserts.length > 0) {
          await tx.insert(agentMemory).values(inserts);
        }
      });
    },

    /** Delete echo chamber message runs for a specific chat. */
    async clearEchoMessages(chatId: string) {
      await db.delete(agentRuns).where(and(eq(agentRuns.chatId, chatId), eq(agentRuns.resultType, "echo_message")));
    },

    /** Delete all agent runs for a specific chat. */
    async clearRunsForChat(chatId: string) {
      await db.delete(agentRuns).where(eq(agentRuns.chatId, chatId));
    },

    /** Delete all agent memory entries for a specific chat. */
    async clearMemoryForChat(chatId: string) {
      await db.delete(agentMemory).where(eq(agentMemory.chatId, chatId));
    },

    /** Delete a specific memory key for an agent in a chat. */
    async deleteMemoryKey(agentConfigId: string, chatId: string, key: string) {
      const resolvedAgentConfigId = await resolveAgentConfigId(agentConfigId);
      await db
        .delete(agentMemory)
        .where(
          and(
            eq(agentMemory.agentConfigId, resolvedAgentConfigId),
            eq(agentMemory.chatId, chatId),
            eq(agentMemory.key, key),
          ),
        );
    },

    /** Delete all memory for a specific agent in a specific chat. */
    async clearMemoryForAgentInChat(agentConfigId: string, chatId: string) {
      const resolvedAgentConfigId = await resolveAgentConfigId(agentConfigId);
      await db
        .delete(agentMemory)
        .where(and(eq(agentMemory.agentConfigId, resolvedAgentConfigId), eq(agentMemory.chatId, chatId)));
    },
  };
}
