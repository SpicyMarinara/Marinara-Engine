import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { chats, lorebookEntries, lorebooks, messages } from "../src/db/schema/index.js";
import { lorebooksRoutes } from "../src/routes/lorebooks.routes.js";

function lorebookEntry(id: string, keyword: string, name: string, content: string) {
  return {
    id,
    lorebookId: "book-637",
    folderId: null,
    name,
    content,
    description: "",
    keys: JSON.stringify([keyword]),
    secondaryKeys: "[]",
    enabled: "true",
    constant: "false",
    selective: "false",
    selectiveLogic: "and" as const,
    probability: null,
    scanDepth: null,
    matchWholeWords: "false",
    caseSensitive: "false",
    useRegex: "false",
    characterFilterMode: "any" as const,
    characterFilterIds: "[]",
    characterTagFilterMode: "any" as const,
    characterTagFilters: "[]",
    generationTriggerFilterMode: "any" as const,
    generationTriggerFilters: "[]",
    additionalMatchingSources: "[]",
    position: 0,
    depth: 4,
    order: 100,
    role: "system" as const,
    sticky: null,
    cooldown: null,
    delay: null,
    ephemeral: null,
    group: "",
    groupWeight: null,
    locked: "false",
    tag: "",
    relationships: "{}",
    dynamicState: "{}",
    activationConditions: "[]",
    schedule: null,
    preventRecursion: "false",
    excludeFromVectorization: "false",
    embedding: null,
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
  };
}

test("active lorebook scan shows the last generation context instead of the next-turn preview", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    await db.insert(chats).values({
      id: "chat-637",
      name: "Bug 637 repro",
      mode: "roleplay",
      characterIds: "[]",
      metadata: "{}",
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    await db.insert(messages).values([
      {
        id: "message-637-user",
        chatId: "chat-637",
        role: "user",
        characterId: null,
        content: "Please remember the past-key for this turn.",
        activeSwipeIndex: 0,
        extra: "{}",
        createdAt: "2026-05-10T00:01:00.000Z",
      },
      {
        id: "message-637-assistant",
        chatId: "chat-637",
        role: "assistant",
        characterId: null,
        content: "The reply introduces future-key, which belongs to the next turn.",
        activeSwipeIndex: 0,
        extra: "{}",
        createdAt: "2026-05-10T00:02:00.000Z",
      },
    ]);
    await db.insert(lorebooks).values({
      id: "book-637",
      name: "World Info",
      description: "",
      category: "world",
      scanDepth: 2,
      tokenBudget: 2048,
      recursiveScanning: "false",
      maxRecursionDepth: 3,
      characterId: null,
      personaId: null,
      chatId: null,
      isGlobal: "true",
      enabled: "true",
      tags: "[]",
      generatedBy: null,
      sourceAgentId: null,
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    await db
      .insert(lorebookEntries)
      .values([
        lorebookEntry("entry-637-past", "past-key", "Past Entry", "Used by the last generation."),
        lorebookEntry("entry-637-future", "future-key", "Future Entry", "Should wait for the next generation."),
      ]);

    const app = Fastify({ logger: false });
    app.decorate("db", db);
    try {
      await app.register(lorebooksRoutes, { prefix: "/api/lorebooks" });
      await app.ready();

      const res = await app.inject({ method: "GET", url: "/api/lorebooks/scan/chat-637" });
      assert.equal(res.statusCode, 200);
      const payload = res.json<{ entries: Array<{ id: string }> }>();
      assert.deepEqual(
        payload.entries.map((entry) => entry.id),
        ["entry-637-past"],
      );
    } finally {
      await app.close();
    }
  } finally {
    client.close();
  }
});
