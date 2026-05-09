import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import type { DB } from "../src/db/connection.js";
import { lorebookCharacterLinks } from "../src/db/schema/index.js";
import { createLorebooksStorage } from "../src/services/storage/lorebooks.storage.js";

async function createTestDb() {
  const root = mkdtempSync(join(tmpdir(), "marinara-lorebooks-storage-"));
  const dbPath = join(root, "test.db").replace(/\\/g, "/");
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client) as unknown as DB;
  await runMigrations(db);
  return {
    client,
    db,
    cleanup() {
      client.close();
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // libSQL can briefly hold SQLite files open on Windows after close().
      }
    },
  };
}

test("link updates on a missing lorebook return null without creating orphan links", async () => {
  const { db, cleanup } = await createTestDb();

  try {
    const storage = createLorebooksStorage(db);
    const created = await storage.create({
      name: "Scoped lorebook",
      characterIds: ["character-a"],
    });
    assert.ok(created);

    await storage.remove(created.id);

    const updated = await storage.update(created.id, {
      characterIds: ["character-b"],
    });

    assert.equal(updated, null);
    const links = await db.select().from(lorebookCharacterLinks);
    assert.deepEqual(links, []);
  } finally {
    cleanup();
  }
});
