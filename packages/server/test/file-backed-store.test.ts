import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { characterCardVersions, characters, chats, lorebookFolders, lorebooks } from "../src/db/schema/index.js";
import { createFileNativeDB } from "../src/db/file-backed-store.js";
import { createChatsStorage } from "../src/services/storage/chats.storage.js";

async function writeLegacyDb(path: string, rows: Array<{ id: string; name: string; updatedAt: string }>) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE chats (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    mode TEXT NOT NULL,
    character_ids TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

    const insert = db.prepare(`INSERT INTO chats
      (id, name, mode, character_ids, metadata, created_at, updated_at)
      VALUES (?, ?, 'roleplay', '[]', '{}', ?, ?)`);
    for (const row of rows) {
      insert.run(row.id, row.name, row.updatedAt, row.updatedAt);
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

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function validChatRows(id = "recovered-chat") {
  const timestamp = "2026-05-11T00:00:00.000Z";
  return [
    {
      id,
      name: "Recovered Chat",
      mode: "roleplay",
      characterIds: "[]",
      groupId: null,
      personaId: null,
      promptPresetId: null,
      connectionId: null,
      metadata: "{}",
      connectedChatId: null,
      folderId: null,
      sortOrder: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

function writeFileStorageManifest(storageDir: string, tables: Record<string, number>) {
  writeFileSync(
    join(storageDir, "manifest.json"),
    JSON.stringify({
      version: 2,
      savedAt: "2026-05-11T00:00:00.000Z",
      backend: "file-native",
      tables,
    }),
  );
}

function assertRecoveredChatIds(ids: string[]) {
  assert.deepEqual(ids, ["recovered-chat"]);
}

async function loadChatIds(storageDir: string) {
  return withFileStorageDir(storageDir, async () => {
    const db = await createFileNativeDB([]);
    try {
      const rows = await db.select().from(chats);
      return rows.map((row) => row.id);
    } finally {
      await db._fileStore.close();
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
        throw err;
      }
      await delay(50 * (attempt + 1));
    }
  }
}

test("file-native self-heal preserves a valid backup when table primary has non-NUL corrupt JSON", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-file-table-backup-heal-"));
  try {
    const storageDir = join(root, "storage");
    const tablesDir = join(storageDir, "tables");
    const tablePath = join(tablesDir, "chats.json");
    const backupPath = `${tablePath}.bak`;
    const rows = validChatRows();
    mkdirSync(tablesDir, { recursive: true });
    writeFileStorageManifest(storageDir, { chats: rows.length });
    writeFileSync(tablePath, '{"id":');
    writeFileSync(backupPath, JSON.stringify(rows));

    assertRecoveredChatIds(await loadChatIds(storageDir));

    const healedRows = readJsonFile<Array<{ id: string }>>(tablePath);
    const backupRows = readJsonFile<Array<{ id: string }>>(backupPath);
    assert.deepEqual(
      healedRows.map((row) => row.id),
      ["recovered-chat"],
    );
    assert.deepEqual(
      backupRows.map((row) => row.id),
      ["recovered-chat"],
    );

    writeFileSync(tablePath, "[");
    assertRecoveredChatIds(await loadChatIds(storageDir));
  } finally {
    await removeTempDir(root);
  }
});

test("file-native self-heal preserves a valid backup when manifest primary has non-NUL corrupt JSON", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-file-manifest-backup-heal-"));
  try {
    const storageDir = join(root, "storage");
    const tablesDir = join(storageDir, "tables");
    const rows = validChatRows();
    mkdirSync(tablesDir, { recursive: true });
    writeFileSync(join(tablesDir, "chats.json"), JSON.stringify(rows));
    writeFileSync(join(storageDir, "manifest.json"), '{"version":');
    writeFileSync(
      join(storageDir, "manifest.json.bak"),
      JSON.stringify({
        version: 2,
        savedAt: "2026-05-11T00:00:00.000Z",
        backend: "file-native",
        tables: { chats: rows.length },
      }),
    );

    assertRecoveredChatIds(await loadChatIds(storageDir));

    const manifest = readJsonFile<{ tables: Record<string, number> }>(join(storageDir, "manifest.json"));
    const backupManifest = readJsonFile<{ tables: Record<string, number> }>(join(storageDir, "manifest.json.bak"));
    assert.equal(manifest.tables.chats, 1);
    assert.equal(backupManifest.tables.chats, 1);
  } finally {
    await removeTempDir(root);
  }
});

test("file-native subsequent save after self-heal refreshes .bak from the healed primary", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-file-post-heal-refresh-"));
  try {
    const storageDir = join(root, "storage");
    const tablesDir = join(storageDir, "tables");
    const tablePath = join(tablesDir, "chats.json");
    const backupPath = `${tablePath}.bak`;
    const rows = validChatRows();
    mkdirSync(tablesDir, { recursive: true });
    writeFileStorageManifest(storageDir, { chats: rows.length });
    writeFileSync(tablePath, '{"id":');
    writeFileSync(backupPath, JSON.stringify(rows));

    // First pass: self-heal recovers from .bak and preserves it.
    assertRecoveredChatIds(await loadChatIds(storageDir));

    // Wreck .bak with a sentinel to prove the next save actually refreshes it.
    writeFileSync(backupPath, "[]");

    // Second pass: ordinary mutation + close should refresh .bak from the
    // healed primary because the path is no longer flagged as recovered.
    await withFileStorageDir(storageDir, async () => {
      const db = await createFileNativeDB([]);
      try {
        await db.insert(chats).values(validChatRows("post-heal-chat")[0]!);
      } finally {
        await db._fileStore.close();
      }
    });

    const refreshedBackupRows = readJsonFile<Array<{ id: string }>>(backupPath);
    assert.deepEqual(
      refreshedBackupRows.map((row) => row.id),
      ["recovered-chat"],
      ".bak should be refreshed from the pre-save healed primary, not left at the sentinel",
    );

    const refreshedPrimaryRows = readJsonFile<Array<{ id: string }>>(tablePath);
    assert.deepEqual(
      refreshedPrimaryRows.map((row) => row.id).sort(),
      ["post-heal-chat", "recovered-chat"],
    );
  } finally {
    await removeTempDir(root);
  }
});

test("file-native self-heal keeps a valid backup when table primary is NUL-filled", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-file-nul-backup-heal-"));
  try {
    const storageDir = join(root, "storage");
    const tablesDir = join(storageDir, "tables");
    const tablePath = join(tablesDir, "chats.json");
    const backupPath = `${tablePath}.bak`;
    const rows = validChatRows();
    mkdirSync(tablesDir, { recursive: true });
    writeFileStorageManifest(storageDir, { chats: rows.length });
    writeFileSync(tablePath, Buffer.alloc(8));
    writeFileSync(backupPath, JSON.stringify(rows));

    assertRecoveredChatIds(await loadChatIds(storageDir));

    const healedRows = readJsonFile<Array<{ id: string }>>(tablePath);
    const backupRows = readJsonFile<Array<{ id: string }>>(backupPath);
    assert.deepEqual(
      healedRows.map((row) => row.id),
      ["recovered-chat"],
    );
    assert.deepEqual(
      backupRows.map((row) => row.id),
      ["recovered-chat"],
    );
  } finally {
    await removeTempDir(root);
  }
});

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

    await withEnv("MARINARA_DISABLE_LIBSQL_LEGACY_READER", "true", () =>
      withFileStorageDir(storageDir, async () => {
        const db = await createFileNativeDB([firstDb, secondDb]);
        try {
          const rows = await db.select().from(chats);
          assert.deepEqual(rows.map((row) => row.id).sort(), ["chat-default", "chat-regression"]);
        } finally {
          await db._fileStore.close();
        }
      }),
    );
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

test("file-native storage does not resurrect a deleted chat from the legacy import source", async () => {
  const root = mkdtempSync(join(tmpdir(), "marinara-file-delete-legacy-"));
  try {
    const storageDir = join(root, "storage");
    const legacyDb = join(root, "legacy.db");
    await writeLegacyDb(legacyDb, [
      { id: "keep-chat", name: "Keep Chat", updatedAt: "2026-05-02T00:00:00.000Z" },
      { id: "delete-chat", name: "Delete Chat", updatedAt: "2026-05-02T00:00:00.000Z" },
    ]);

    await withEnv("MARINARA_DISABLE_LIBSQL_LEGACY_READER", "true", () =>
      withFileStorageDir(storageDir, async () => {
        let db = await createFileNativeDB([legacyDb]);
        try {
          const storage = createChatsStorage(db);
          await storage.remove("delete-chat");
          const afterDelete = await db.select().from(chats);
          assert.deepEqual(
            afterDelete.map((row) => row.id).sort(),
            ["keep-chat"],
          );
        } finally {
          await db._fileStore.close();
        }

        db = await createFileNativeDB([legacyDb]);
        try {
          const afterRestart = await db.select().from(chats);
          assert.deepEqual(
            afterRestart.map((row) => row.id).sort(),
            ["keep-chat"],
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

    await withEnv("MARINARA_DISABLE_LIBSQL_LEGACY_READER", "true", () =>
      withFileStorageDir(storageDir, async () => {
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
      }),
    );

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

    await withEnv("MARINARA_DISABLE_LIBSQL_LEGACY_READER", "true", () =>
      withFileStorageDir(storageDir, async () => {
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
      }),
    );

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
