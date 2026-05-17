import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@marinara-engine/shared";
import type { DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import { chats } from "../src/db/schema/index.js";
import { chatsRoutes } from "../src/routes/chats.routes.js";

function parseMetadata(chat: { metadata: string | Record<string, unknown> }) {
  return typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : chat.metadata;
}

test("autonomous unread route stores, accumulates, de-dupes, and clears chat metadata", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;
  const app = Fastify({ logger: false });

  try {
    await runMigrations(db);
    await db.insert(chats).values({
      id: "chat-699",
      name: "Issue 699 unread state",
      mode: "conversation",
      characterIds: JSON.stringify(["char-a", "char-b"]),
      metadata: JSON.stringify({ autonomousMessages: true }),
      createdAt: "2026-05-12T16:00:00.000Z",
      updatedAt: "2026-05-12T16:00:00.000Z",
    });

    app.decorate("db", db);
    await app.register(chatsRoutes, { prefix: "/api/chats" });
    await app.ready();

    const firstMark = await app.inject({
      method: "POST",
      url: "/api/chats/chat-699/autonomous-unread",
      headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
      payload: { characterId: "char-a" },
    });
    assert.equal(firstMark.statusCode, 200, firstMark.body);
    const firstMeta = parseMetadata(firstMark.json());
    assert.equal(firstMeta.autonomousUnreadCount, 1);
    assert.deepEqual(firstMeta.autonomousUnreadCharacterIds, ["char-a"]);
    assert.equal(typeof firstMeta.autonomousUnreadAt, "string");

    const secondMark = await app.inject({
      method: "POST",
      url: "/api/chats/chat-699/autonomous-unread",
      headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
      payload: { characterId: "char-b", count: 2 },
    });
    assert.equal(secondMark.statusCode, 200, secondMark.body);
    const secondMeta = parseMetadata(secondMark.json());
    assert.equal(secondMeta.autonomousUnreadCount, 3);
    assert.deepEqual(secondMeta.autonomousUnreadCharacterIds.sort(), ["char-a", "char-b"]);
    assert.equal(secondMeta.autonomousMessages, true);

    const duplicateMark = await app.inject({
      method: "POST",
      url: "/api/chats/chat-699/autonomous-unread",
      headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
      payload: { characterId: "char-a" },
    });
    assert.equal(duplicateMark.statusCode, 200, duplicateMark.body);
    const duplicateMeta = parseMetadata(duplicateMark.json());
    assert.equal(duplicateMeta.autonomousUnreadCount, 4);
    assert.deepEqual(duplicateMeta.autonomousUnreadCharacterIds.sort(), ["char-a", "char-b"]);
    const updatedAtBeforeClear = duplicateMark.json().updatedAt;

    const clear = await app.inject({
      method: "DELETE",
      url: "/api/chats/chat-699/autonomous-unread",
      headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
    });
    assert.equal(clear.statusCode, 200, clear.body);
    const clearedMeta = parseMetadata(clear.json());
    assert.equal(clearedMeta.autonomousUnreadCount, undefined);
    assert.equal(clearedMeta.autonomousUnreadCharacterIds, undefined);
    assert.equal(clearedMeta.autonomousUnreadAt, undefined);
    assert.equal(clearedMeta.autonomousMessages, true);
    assert.equal(clear.json().updatedAt, updatedAtBeforeClear);
  } finally {
    await app.close();
    client.close();
  }
});
