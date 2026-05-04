import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { characterCardVersions, characters, chats, lorebookFolders, lorebooks } from "../src/db/schema/index.js";
import { createFileNativeDB } from "../src/db/file-backed-store.js";

async function writeLegacyDb(path: string, rows: Array<{ id: string; name: string; updatedAt: string }>) {
  const db = createClient({ url: `file:${path}` });
  try {
    await db.execute(`CREATE TABLE chats (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    mode TEXT NOT NULL,
    character_ids TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

    for (const row of rows) {
      await db.execute({
        sql: `INSERT INTO chats
          (id, name, mode, character_ids, metadata, created_at, updated_at)
          VALUES (?, ?, 'roleplay', '[]', '{}', ?, ?)`,
        args: [row.id, row.name, row.updatedAt, row.updatedAt],
      });
    }
  } finally {
    db.close();
  }
}

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

function withEnv<T>(name: string, value: string, fn: () => Promise<T>) {
  const previous = process.env[name];
  process.env[name] = value;
  return fn().finally(() => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  });
}

async function removeTempDir(path: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(code ?? "")) {
        throw err;
      }
      if (attempt === 7) {
        return;
      }
      await delay(50 * (attempt + 1));
    }
  }
}

test("file-native import merges chats from every known legacy database source", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-file-import-"));
  try {
    const storageDir = join(root, "storage");
    const firstDb = join(root, "first.db");
    const secondDb = join(root, "second.db");
    await writeLegacyDb(firstDb, [
      { id: "chat-default", name: "Default DB Chat", updatedAt: "2026-05-01T00:00:00.000Z" },
    ]);
    await writeLegacyDb(secondDb, [
      { id: "chat-regression", name: "Regression DB Chat", updatedAt: "2026-05-02T00:00:00.000Z" },
    ]);

    await withFileStorageDir(storageDir, async () => {
      const db = await createFileNativeDB([firstDb, secondDb]);
      try {
        const rows = await db.select().from(chats);
        assert.deepEqual(rows.map((row) => row.id).sort(), ["chat-default", "chat-regression"]);
      } finally {
        await db._fileStore.close();
      }
    });
  } finally {
    await removeTempDir(root);
  }
});

test("file-native import falls back to node:sqlite when libSQL is unavailable", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-file-node-sqlite-import-"));
  try {
    const storageDir = join(root, "storage");
    const legacyDb = join(root, "legacy.db");
    await writeLegacyDb(legacyDb, [
      { id: "node-sqlite-chat", name: "Fallback Chat", updatedAt: "2026-05-02T00:00:00.000Z" },
    ]);

    await withEnv("MARINARA_DISABLE_LIBSQL_LEGACY_READER", "true", () =>
      withFileStorageDir(storageDir, async () => {
        const db = await createFileNativeDB([legacyDb]);
        try {
          const rows = await db.select().from(chats);
          assert.deepEqual(
            rows.map((row) => row.id),
            ["node-sqlite-chat"],
          );
        } finally {
          await db._fileStore.close();
        }
      }),
    );
  } finally {
    await removeTempDir(root);
  }
});

test("file-native storage repairs existing snapshots that missed legacy chats", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-file-repair-"));
  try {
    const storageDir = join(root, "storage");
    const tablesDir = join(storageDir, "tables");
    const legacyDb = join(root, "legacy.db");
    mkdirSync(tablesDir, { recursive: true });
    writeFileSync(
      join(storageDir, "manifest.json"),
      JSON.stringify({
        version: 2,
        savedAt: "2026-05-03T00:00:00.000Z",
        backend: "file-native",
        migratedFromSqlite: {
          path: legacyDb,
          importedAt: "2026-05-03T00:00:00.000Z",
        },
        tables: { chats: 0 },
      }),
    );
    writeFileSync(join(tablesDir, "chats.json"), "[]");
    await writeLegacyDb(legacyDb, [
      { id: "recovered-chat", name: "Recovered Chat", updatedAt: "2026-05-03T00:00:00.000Z" },
    ]);

    await withFileStorageDir(storageDir, async () => {
      const db = await createFileNativeDB([legacyDb]);
      try {
        const rows = await db.select().from(chats);
        assert.equal(
          rows.some((row) => row.id === "recovered-chat"),
          true,
        );
      } finally {
        await db._fileStore.close();
      }
    });

    const manifest = JSON.parse(readFileSync(join(storageDir, "manifest.json"), "utf8"));
    assert.equal(manifest.legacyRepair.tables.chats, 1);
  } finally {
    await removeTempDir(root);
  }
});

test("file-native storage retries old empty repair markers from unavailable readers", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-file-stale-repair-"));
  try {
    const storageDir = join(root, "storage");
    const tablesDir = join(storageDir, "tables");
    const legacyDb = join(root, "legacy.db");
    mkdirSync(tablesDir, { recursive: true });
    writeFileSync(
      join(storageDir, "manifest.json"),
      JSON.stringify({
        version: 2,
        savedAt: "2026-05-03T00:00:00.000Z",
        backend: "file-native",
        migratedFromSqlite: {
          path: legacyDb,
          importedAt: "2026-05-03T00:00:00.000Z",
        },
        legacyRepair: {
          paths: [legacyDb],
          repairedAt: "2026-05-03T00:00:00.000Z",
          tables: {},
        },
        tables: { chats: 0 },
      }),
    );
    writeFileSync(join(tablesDir, "chats.json"), "[]");
    await writeLegacyDb(legacyDb, [
      { id: "retry-recovered-chat", name: "Retry Recovered Chat", updatedAt: "2026-05-03T00:00:00.000Z" },
    ]);

    await withFileStorageDir(storageDir, async () => {
      const db = await createFileNativeDB([legacyDb]);
      try {
        const rows = await db.select().from(chats);
        assert.equal(
          rows.some((row) => row.id === "retry-recovered-chat"),
          true,
        );
      } finally {
        await db._fileStore.close();
      }
    });

    const manifest = JSON.parse(readFileSync(join(storageDir, "manifest.json"), "utf8"));
    assert.equal(manifest.legacyRepair.tables.chats, 1);
  } finally {
    await removeTempDir(root);
  }
});

test("file-native storage supports lorebook folders", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-file-folders-"));
  try {
    const storageDir = join(root, "storage");
    const timestamp = "2026-05-04T00:00:00.000Z";

    await withFileStorageDir(storageDir, async () => {
      const db = await createFileNativeDB([]);
      try {
        await db.insert(lorebooks).values({
          id: "book-1",
          name: "Book",
          description: "",
          category: "uncategorized",
          scanDepth: 2,
          tokenBudget: 2048,
          recursiveScanning: "false",
          maxRecursionDepth: 3,
          characterId: null,
          personaId: null,
          chatId: null,
          enabled: "true",
          tags: "[]",
          generatedBy: null,
          sourceAgentId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await db.insert(lorebookFolders).values({
          id: "folder-1",
          lorebookId: "book-1",
          name: "Session Notes",
          enabled: "true",
          parentFolderId: null,
          order: 10,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        const folders = await db.select().from(lorebookFolders);
        assert.equal(folders.length, 1);
        assert.equal(folders[0]?.id, "folder-1");

        await db.delete(lorebooks).where(eq(lorebooks.id, "book-1"));
        const remainingFolders = await db.select().from(lorebookFolders);
        assert.equal(remainingFolders.length, 0);
      } finally {
        await db._fileStore.close();
      }
    });

    const folderRows = JSON.parse(readFileSync(join(storageDir, "tables", "lorebook_folders.json"), "utf8"));
    assert.deepEqual(folderRows, []);
  } finally {
    await removeTempDir(root);
  }
});

test("file-native storage deletes only the requested character card version", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-file-version-delete-"));
  try {
    const storageDir = join(root, "storage");
    const timestamp = "2026-05-04T00:00:00.000Z";

    await withFileStorageDir(storageDir, async () => {
      const db = await createFileNativeDB([]);
      try {
        await db.insert(characters).values({
          id: "character-1",
          data: "{}",
          comment: "",
          avatarPath: null,
          spriteFolderPath: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        for (const versionId of ["version-1", "version-2", "version-3"]) {
          await db.insert(characterCardVersions).values({
            id: versionId,
            characterId: "character-1",
            data: "{}",
            comment: "",
            avatarPath: null,
            version: versionId,
            source: "manual",
            reason: "",
            createdAt: timestamp,
          });
        }

        await db
          .delete(characterCardVersions)
          .where(and(eq(characterCardVersions.characterId, "character-1"), eq(characterCardVersions.id, "version-2")));

        const remaining = await db.select().from(characterCardVersions).orderBy(characterCardVersions.id);
        assert.deepEqual(
          remaining.map((row) => row.id),
          ["version-1", "version-3"],
        );
      } finally {
        await db._fileStore.close();
      }
    });
  } finally {
    await removeTempDir(root);
  }
});
