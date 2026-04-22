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

function getBuiltinAgentType(agentConfigId: string): string | null {
  if (!agentConfigId.startsWith(BUILTIN_AGENT_ID_PREFIX)) return null;
  const agentType = agentConfigId.slice(BUILTIN_AGENT_ID_PREFIX.length).trim();
  return agentType.length > 0 ? agentType : null;
}

export function createAgentsStorage(db: DB) {
  async function getById(id: string) {
    const rows = await db.select().from(agentConfigs).where(eq(agentConfigs.id, id));
    return rows[0] ?? null;
  }

  async function getByType(type: string) {
    const rows = await db.select().from(agentConfigs).where(eq(agentConfigs.type, type));
    return rows[0] ?? null;
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
      return db.select().from(agentConfigs).orderBy(desc(agentConfigs.updatedAt));
    },

    async listEnabled() {
      const rows = await db
        .select()
        .from(agentConfigs)
        .where(eq(agentConfigs.enabled, "true"))
        .orderBy(desc(agentConfigs.updatedAt));
      return rows;
    },

    getById,

    getByType,

    async create(input: CreateAgentConfigInput) {
      const id = newId();
      const timestamp = now();
      await db.insert(agentConfigs).values({
        id,
        type: input.type,
        name: input.name,
        description: input.description ?? "",
        phase: input.phase,
        enabled: String(input.enabled ?? true),
        connectionId: input.connectionId ?? null,
        promptTemplate: input.promptTemplate ?? "",
        settings: JSON.stringify(input.settings ?? {}),
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
      if (data.settings !== undefined) updateFields.settings = JSON.stringify(data.settings);
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
