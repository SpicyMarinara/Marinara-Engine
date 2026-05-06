import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { messages } from "../src/db/schema/index.js";
import { createFileNativeDB } from "../src/db/file-backed-store.js";
import { importSTChat } from "../src/services/import/st-chat.importer.js";

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

test("SillyTavern chat import preserves source order when timestamps tie", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-st-chat-import-"));
  try {
    await withFileStorageDir(join(root, "storage"), async () => {
      const db = await createFileNativeDB([]);
      try {
        const imported = await importSTChat(
          [
            JSON.stringify({ user_name: "User", character_name: "Mari" }),
            JSON.stringify({
              name: "User",
              is_user: true,
              send_date: "2026-03-21T08:53:00.000Z",
              mes: "first",
            }),
            JSON.stringify({
              name: "Mari",
              is_user: false,
              send_date: "2026-03-21T08:53:00.000Z",
              mes: "second",
            }),
            JSON.stringify({
              name: "User",
              is_user: true,
              send_date: "2026-03-21T08:52:59.000Z",
              mes: "third",
            }),
          ].join("\n"),
          db,
        );

        assert.equal(imported.success, true);
        assert.ok("chatId" in imported);

        const rows = await db
          .select()
          .from(messages)
          .where(eq(messages.chatId, imported.chatId))
          .orderBy(messages.createdAt, messages.id);

        assert.deepEqual(
          rows.map((row) => row.content),
          ["first", "second", "third"],
        );

        const timestamps = rows.map((row) => new Date(row.createdAt).getTime());
        assert.ok(timestamps[0]! < timestamps[1]!);
        assert.ok(timestamps[1]! < timestamps[2]!);
      } finally {
        await db._fileStore.close();
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
