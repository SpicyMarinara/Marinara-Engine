import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import type { DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { apiConnections, chats, memoryChunks, messages, messageSwipes } from "../src/db/schema/index.js";
import { chatsRoutes } from "../src/routes/chats.routes.js";
import { chunkAndEmbedMessages, recallMemories } from "../src/services/memory-recall.js";
import { resolveMemoryRecallEmbeddingSource } from "../src/services/memory-recall-embedding.js";
import { createChatsStorage } from "../src/services/storage/chats.storage.js";

test("editing a message invalidates stale memory chunks and refresh rebuilds from current text", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    const now = "2026-05-05T00:00:00.000Z";
    await db.insert(chats).values({
      id: "chat-445",
      name: "Bug 445 repro",
      mode: "game",
      characterIds: "[]",
      metadata: "{}",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(messages).values({
      id: "message-445",
      chatId: "chat-445",
      role: "assistant",
      characterId: null,
      content: "The ancient tome says florblesnatch is the password.",
      activeSwipeIndex: 0,
      extra: "{}",
      createdAt: "2026-05-05T00:01:00.000Z",
    });
    for (let i = 2; i <= 5; i++) {
      await db.insert(messages).values({
        id: `message-445-${i}`,
        chatId: "chat-445",
        role: i % 2 === 0 ? "user" : "assistant",
        characterId: null,
        content: `Follow-up message ${i}`,
        activeSwipeIndex: 0,
        extra: "{}",
        createdAt: `2026-05-05T00:0${i}:00.000Z`,
      });
    }

    await db.insert(memoryChunks).values({
      id: "chunk-445",
      chatId: "chat-445",
      content: "GM: The ancient tome says florblesnatch is the password.",
      embedding: null,
      messageCount: 5,
      firstMessageAt: "2026-05-05T00:01:00.000Z",
      lastMessageAt: "2026-05-05T00:05:00.000Z",
      createdAt: "2026-05-05T00:06:00.000Z",
    });

    const storage = createChatsStorage(db);
    await storage.updateMessageContent("message-445", "The ancient tome says silverleaf is the password.");

    const chunksAfterEdit = await db.select().from(memoryChunks).where(eq(memoryChunks.chatId, "chat-445"));
    assert.equal(chunksAfterEdit.length, 0);

    const app = Fastify({ logger: false });
    app.decorate("db", db);
    try {
      await app.register(chatsRoutes, { prefix: "/api/chats" });
      await app.ready();

      const res = await app.inject({ method: "POST", url: "/api/chats/chat-445/memories/refresh" });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { rebuilt: 1 });
    } finally {
      await app.close();
    }

    const rebuiltChunks = await db.select().from(memoryChunks).where(eq(memoryChunks.chatId, "chat-445"));

    assert.equal(rebuiltChunks.length, 1);
    assert.ok(!rebuiltChunks[0]!.content.includes("florblesnatch"));
    assert.ok(rebuiltChunks[0]!.content.includes("silverleaf"));
  } finally {
    client.close();
  }
});

test("memory recall uses configured embedding source when local embeddings are unavailable", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    const now = "2026-05-05T01:00:00.000Z";
    await db.insert(chats).values({
      id: "chat-435",
      name: "Bug 435 repro",
      mode: "roleplay",
      characterIds: "[]",
      metadata: "{}",
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 1; i <= 5; i++) {
      await db.insert(messages).values({
        id: `message-435-${i}`,
        chatId: "chat-435",
        role: i % 2 === 0 ? "user" : "assistant",
        characterId: null,
        content: i === 5 ? "The orchard password is silverleaf." : `Memory fallback setup ${i}.`,
        activeSwipeIndex: 0,
        extra: "{}",
        createdAt: `2026-05-05T01:0${i}:00.000Z`,
      });
    }

    let fallbackCalls = 0;
    const fallbackSource = {
      label: "test embedding source",
      async embed(texts: string[]) {
        fallbackCalls += 1;
        return texts.map((text) => (text.includes("silverleaf") ? [1, 0, 0] : [0, 1, 0]));
      },
    };

    await chunkAndEmbedMessages(
      db,
      "chat-435",
      { userName: "User", characterNames: {} },
      {
        localEmbedder: async () => null,
        embeddingSource: fallbackSource,
      },
    );

    const chunks = await db.select().from(memoryChunks).where(eq(memoryChunks.chatId, "chat-435"));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]!.embedding, "[1,0,0]");

    const recalled = await recallMemories(db, "silverleaf", ["chat-435"], {
      topK: 1,
      localEmbedder: async () => null,
      embeddingSource: fallbackSource,
    });

    assert.equal(fallbackCalls, 2);
    assert.equal(recalled.length, 1);
    assert.ok(recalled[0]!.content.includes("silverleaf"));
  } finally {
    client.close();
  }
});

test("memory recall embedding connection does not inherit the active connection embedding model", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    const now = "2026-05-05T02:00:00.000Z";
    await db.insert(apiConnections).values([
      {
        id: "active-connection",
        name: "Active generation",
        provider: "custom",
        baseUrl: "http://active.example",
        apiKeyEncrypted: "",
        model: "chat-model",
        maxContext: 128000,
        isDefault: "false",
        useForRandom: "false",
        enableCaching: "false",
        defaultForAgents: "false",
        embeddingModel: "active-embedding-model",
        embeddingBaseUrl: "",
        embeddingConnectionId: "embedding-connection",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "embedding-connection",
        name: "Dedicated embeddings",
        provider: "custom",
        baseUrl: "http://embedding.example",
        apiKeyEncrypted: "",
        model: "chat-model",
        maxContext: 128000,
        isDefault: "false",
        useForRandom: "false",
        enableCaching: "false",
        defaultForAgents: "false",
        embeddingModel: "",
        embeddingBaseUrl: "",
        embeddingConnectionId: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const source = await resolveMemoryRecallEmbeddingSource(db, { connectionId: "active-connection" });

    assert.equal(source, null);
  } finally {
    client.close();
  }
});

test("rerolling a message invalidates stale memory chunks and refresh rebuilds from the active swipe", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    const now = "2026-05-08T00:00:00.000Z";
    await db.insert(chats).values({
      id: "chat-548",
      name: "Bug 548 repro",
      mode: "roleplay",
      characterIds: "[]",
      metadata: "{}",
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 1; i <= 4; i++) {
      await db.insert(messages).values({
        id: `message-548-${i}`,
        chatId: "chat-548",
        role: i % 2 === 0 ? "assistant" : "user",
        characterId: null,
        content: `Setup message ${i}`,
        activeSwipeIndex: 0,
        extra: "{}",
        createdAt: `2026-05-08T00:0${i}:00.000Z`,
      });
    }

    await db.insert(messages).values({
      id: "message-548-reroll",
      chatId: "chat-548",
      role: "assistant",
      characterId: null,
      content: "The discarded response says the vault code is onion.",
      activeSwipeIndex: 0,
      extra: "{}",
      createdAt: "2026-05-08T00:05:00.000Z",
    });
    await db.insert(messageSwipes).values({
      id: "swipe-548-reroll-0",
      messageId: "message-548-reroll",
      index: 0,
      content: "The discarded response says the vault code is onion.",
      extra: "{}",
      createdAt: "2026-05-08T00:05:00.000Z",
    });

    await db.insert(memoryChunks).values({
      id: "chunk-548",
      chatId: "chat-548",
      content: "Assistant: The discarded response says the vault code is onion.",
      embedding: null,
      messageCount: 5,
      firstMessageAt: "2026-05-08T00:01:00.000Z",
      lastMessageAt: "2026-05-08T00:05:00.000Z",
      createdAt: "2026-05-08T00:06:00.000Z",
    });

    const storage = createChatsStorage(db);
    await storage.addSwipe("message-548-reroll", "The selected response says the vault code is basil.");

    const chunksAfterReroll = await db.select().from(memoryChunks).where(eq(memoryChunks.chatId, "chat-548"));
    assert.equal(chunksAfterReroll.length, 0);

    const app = Fastify({ logger: false });
    app.decorate("db", db);
    try {
      await app.register(chatsRoutes, { prefix: "/api/chats" });
      await app.ready();

      const res = await app.inject({ method: "POST", url: "/api/chats/chat-548/memories/refresh" });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { rebuilt: 1 });
    } finally {
      await app.close();
    }

    const rebuiltChunks = await db.select().from(memoryChunks).where(eq(memoryChunks.chatId, "chat-548"));

    assert.equal(rebuiltChunks.length, 1);
    assert.ok(!rebuiltChunks[0]!.content.includes("onion"));
    assert.ok(rebuiltChunks[0]!.content.includes("basil"));
  } finally {
    client.close();
  }
});
