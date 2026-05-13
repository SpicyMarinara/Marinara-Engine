import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { createFileNativeDB } from "../src/db/file-backed-store.js";
import { messages } from "../src/db/schema/index.js";
import { importRoutes } from "../src/routes/import.routes.js";
import { createChatsStorage } from "../src/services/storage/chats.storage.js";

const jsonl = [
  JSON.stringify({
    user_name: "User",
    character_name: "Princess Vivienne",
    create_date: "2026-05-13T12:00:00.000Z",
    chat_metadata: {},
  }),
  JSON.stringify({
    name: "User",
    is_user: true,
    is_system: false,
    mes: "Hello.",
    send_date: "2026-05-13T12:00:01.000Z",
  }),
  JSON.stringify({
    name: "Princess Vivienne",
    is_user: false,
    is_system: false,
    mes: "Welcome back.",
    send_date: "2026-05-13T12:00:02.000Z",
  }),
].join("\n");

function withFileStorageDir<T>(dir: string, fn: () => Promise<T>) {
  const previous = process.env.FILE_STORAGE_DIR;
  process.env.FILE_STORAGE_DIR = dir;
  return fn().finally(() => {
    if (previous === undefined) {
      delete process.env.FILE_STORAGE_DIR;
    } else {
      process.env.FILE_STORAGE_DIR = previous;
    }
  });
}

function multipartPayload(chatId: string, order: "file-first" | "field-first") {
  const boundary = `----st-chat-import-${order}`;
  const fieldPart = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="chatId"',
    "",
    chatId,
  ].join("\r\n");
  const filePart = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="Princess Vivienne.jsonl"',
    "Content-Type: application/jsonl",
    "",
    jsonl,
  ].join("\r\n");
  const parts = order === "file-first" ? [filePart, fieldPart] : [fieldPart, filePart];
  return {
    boundary,
    payload: Buffer.from(`${parts.join("\r\n")}\r\n--${boundary}--\r\n`, "utf8"),
  };
}

test("chat file import accepts JSONL branch uploads regardless of multipart field order", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-st-chat-import-route-"));
  try {
    await withFileStorageDir(join(root, "storage"), async () => {
      const db = await createFileNativeDB([]);
      const app = Fastify();
      try {
        await app.register(multipart);
        app.decorate("db", db);
        await app.register(importRoutes, { prefix: "/api/import" });

        const storage = createChatsStorage(db);
        const target = await storage.create({
          name: "Princess Vivienne",
          mode: "roleplay",
          characterIds: [],
          groupId: null,
          personaId: null,
          promptPresetId: null,
          connectionId: null,
        });
        assert.ok(target, "target chat should be created");

        for (const order of ["file-first", "field-first"] as const) {
          const body = multipartPayload(target.id, order);
          const response = await app.inject({
            method: "POST",
            url: "/api/import/st-chat-into-group",
            headers: {
              "content-type": `multipart/form-data; boundary=${body.boundary}`,
            },
            payload: body.payload,
          });
          const payload = JSON.parse(response.body) as {
            success?: boolean;
            chatId?: string;
            messagesImported?: number;
            error?: string;
          };

          assert.equal(response.statusCode, 200, `${order} upload should not fail with ${payload.error ?? "error"}`);
          assert.equal(payload.success, true);
          assert.equal(payload.messagesImported, 2);
          assert.ok(payload.chatId);

          const rows = await db.select().from(messages).where(eq(messages.chatId, payload.chatId));
          assert.deepEqual(
            rows.map((message) => message.content),
            ["Hello.", "Welcome back."],
          );
        }
      } finally {
        await app.close();
        await db._fileStore.close();
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
