// ──────────────────────────────────────────────
// Routes: Admin (clear data, maintenance)
// ──────────────────────────────────────────────
import type { FastifyInstance, FastifyReply } from "fastify";
import { ne } from "drizzle-orm";
import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { PROFESSOR_MARI_ID } from "@marinara-engine/shared";
import { DATA_DIR } from "../utils/data-dir.js";
import * as schema from "../db/schema/index.js";
import { requirePrivilegedAccess } from "../middleware/privileged-gate.js";

type ExpungeScope =
  | "chats"
  | "characters"
  | "personas"
  | "lorebooks"
  | "presets"
  | "connections"
  | "automation"
  | "media";

const ALL_EXPUNGE_SCOPES: ExpungeScope[] = [
  "chats",
  "characters",
  "personas",
  "lorebooks",
  "presets",
  "connections",
  "automation",
  "media",
];

function clearDirectory(dirPath: string) {
  if (!existsSync(dirPath)) return 0;
  const files = readdirSync(dirPath);
  let count = 0;
  for (const f of files) {
    const full = join(dirPath, f);
    try {
      rmSync(full, { recursive: true, force: true });
      count++;
    } catch {
      // skip
    }
  }
  return count;
}

function isValidScope(scope: unknown): scope is ExpungeScope {
  return typeof scope === "string" && ALL_EXPUNGE_SCOPES.includes(scope as ExpungeScope);
}

export async function adminRoutes(app: FastifyInstance) {
  const runExpunge = async (requestedScopes: ExpungeScope[], reply: FastifyReply) => {
    if (requestedScopes.length === 0) {
      return reply.status(400).send({ error: "At least one valid scope is required" });
    }

    const db = app.db;
    const tablesCleared: Record<string, number> = {};
    const filesDeleted: Record<string, number> = {};

    const runDelete = async (name: string, task: () => Promise<unknown>) => {
      try {
        const result = await task();
        tablesCleared[name] = (tablesCleared[name] ?? 0) + ((result as { changes?: number } | undefined)?.changes ?? 0);
      } catch {
        tablesCleared[name] = tablesCleared[name] ?? 0;
      }
    };

    if (requestedScopes.includes("chats")) {
      await runDelete("message_swipes", () => db.delete(schema.messageSwipes).run());
      await runDelete("ooc_influences", () => db.delete(schema.oocInfluences).run());
      await runDelete("memory_chunks", () => db.delete(schema.memoryChunks).run());
      await runDelete("messages", () => db.delete(schema.messages).run());
      await runDelete("agent_runs", () => db.delete(schema.agentRuns).run());
      await runDelete("agent_memory", () => db.delete(schema.agentMemory).run());
      await runDelete("game_state_snapshots", () => db.delete(schema.gameStateSnapshots).run());
      await runDelete("chat_images", () => db.delete(schema.chatImages).run());
      await runDelete("chat_folders", () => db.delete(schema.chatFolders).run());
      await runDelete("chats", () => db.delete(schema.chats).run());
      filesDeleted.gallery = clearDirectory(join(DATA_DIR, "gallery"));
    }

    if (requestedScopes.includes("characters")) {
      await runDelete("character_groups", () => db.delete(schema.characterGroups).run());
      await runDelete("characters", () =>
        db.delete(schema.characters).where(ne(schema.characters.id, PROFESSOR_MARI_ID)).run(),
      );
    }

    if (requestedScopes.includes("personas")) {
      await runDelete("persona_groups", () => db.delete(schema.personaGroups).run());
      await runDelete("personas", () => db.delete(schema.personas).run());
    }

    if (requestedScopes.includes("lorebooks")) {
      await runDelete("lorebook_entries", () => db.delete(schema.lorebookEntries).run());
      await runDelete("lorebooks", () => db.delete(schema.lorebooks).run());
    }

    if (requestedScopes.includes("presets")) {
      await runDelete("prompt_sections", () => db.delete(schema.promptSections).run());
      await runDelete("prompt_groups", () => db.delete(schema.promptGroups).run());
      await runDelete("choice_blocks", () => db.delete(schema.choiceBlocks).run());
      await runDelete("prompt_presets", () => db.delete(schema.promptPresets).run());
    }

    if (requestedScopes.includes("connections")) {
      await runDelete("api_connections", () => db.delete(schema.apiConnections).run());
    }

    if (requestedScopes.includes("automation")) {
      await runDelete("agent_runs", () => db.delete(schema.agentRuns).run());
      await runDelete("agent_memory", () => db.delete(schema.agentMemory).run());
      await runDelete("agent_configs", () => db.delete(schema.agentConfigs).run());
      await runDelete("custom_tools", () => db.delete(schema.customTools).run());
      await runDelete("regex_scripts", () => db.delete(schema.regexScripts).run());
      await runDelete("custom_themes", () => db.delete(schema.customThemes).run());
      await runDelete("game_state_snapshots", () => db.delete(schema.gameStateSnapshots).run());
    }

    if (requestedScopes.includes("media")) {
      await runDelete("assets", () => db.delete(schema.assets).run());
      await runDelete("chat_images", () => db.delete(schema.chatImages).run());
      filesDeleted.backgrounds = clearDirectory(join(DATA_DIR, "backgrounds"));
      filesDeleted.avatars = clearDirectory(join(DATA_DIR, "avatars"));
      filesDeleted.sprites = clearDirectory(join(DATA_DIR, "sprites"));
      filesDeleted.gallery = clearDirectory(join(DATA_DIR, "gallery"));
      filesDeleted.fonts = clearDirectory(join(DATA_DIR, "fonts"));
      filesDeleted.knowledgeSources = clearDirectory(join(DATA_DIR, "knowledge-sources"));
    }

    return {
      success: true,
      scopesCleared: requestedScopes,
      tablesCleared,
      filesDeleted,
      preserved: {
        characters: [PROFESSOR_MARI_ID],
      },
    };
  };

  app.post<{ Body: { confirm: boolean; scopes?: ExpungeScope[] } }>("/expunge", async (req, reply) => {
    const { confirm, scopes } = req.body as { confirm?: boolean; scopes?: unknown[] };
    if (!confirm) {
      return reply.status(400).send({ error: "Must send { confirm: true } to proceed" });
    }
    if (!requirePrivilegedAccess(req, reply, { feature: "Admin data expunge" })) return;

    const requestedScopes = Array.isArray(scopes) ? scopes.filter(isValidScope) : [];
    return runExpunge(requestedScopes, reply);
  });

  // Clear all data — compatibility wrapper around scoped expunge.
  app.post<{ Body: { confirm: boolean } }>("/clear-all", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Admin data clearing" })) return;
    const { confirm } = req.body as { confirm?: boolean };
    if (!confirm) {
      return reply.status(400).send({ error: "Must send { confirm: true } to proceed" });
    }
    return runExpunge(ALL_EXPUNGE_SCOPES, reply);
  });
}
