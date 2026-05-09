import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { runMigrations } from "../src/db/migrate.js";
import type { DB } from "../src/db/connection.js";

test("startup migrations add lorebook folders schema to existing installs", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await db.run(
      sql.raw(`CREATE TABLE lorebooks (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'uncategorized',
        scan_depth INTEGER NOT NULL DEFAULT 2,
        token_budget INTEGER NOT NULL DEFAULT 2048,
        recursive_scanning TEXT NOT NULL DEFAULT 'false',
        character_id TEXT,
        persona_id TEXT,
        chat_id TEXT,
        enabled TEXT NOT NULL DEFAULT 'true',
        generated_by TEXT,
        source_agent_id TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
    );
    await db.run(
      sql.raw(`CREATE TABLE lorebook_entries (
        id TEXT PRIMARY KEY NOT NULL,
        lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        keys TEXT NOT NULL DEFAULT '[]',
        secondary_keys TEXT NOT NULL DEFAULT '[]',
        enabled TEXT NOT NULL DEFAULT 'true',
        constant TEXT NOT NULL DEFAULT 'false',
        selective TEXT NOT NULL DEFAULT 'false',
        selective_logic TEXT NOT NULL DEFAULT 'and',
        probability INTEGER,
        scan_depth INTEGER,
        match_whole_words TEXT NOT NULL DEFAULT 'false',
        case_sensitive TEXT NOT NULL DEFAULT 'false',
        use_regex TEXT NOT NULL DEFAULT 'false',
        position INTEGER NOT NULL DEFAULT 0,
        depth INTEGER NOT NULL DEFAULT 4,
        "order" INTEGER NOT NULL DEFAULT 100,
        role TEXT NOT NULL DEFAULT 'system',
        sticky INTEGER,
        cooldown INTEGER,
        delay INTEGER,
        "group" TEXT NOT NULL DEFAULT '',
        group_weight INTEGER,
        tag TEXT NOT NULL DEFAULT '',
        relationships TEXT NOT NULL DEFAULT '{}',
        dynamic_state TEXT NOT NULL DEFAULT '{}',
        activation_conditions TEXT NOT NULL DEFAULT '[]',
        schedule TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
    );
    await db.run(
      sql.raw(`INSERT INTO lorebooks (
        id, name, description, category, scan_depth, token_budget, recursive_scanning,
        character_id, persona_id, chat_id, enabled, generated_by, source_agent_id, tags, created_at, updated_at
      ) VALUES (
        'legacy-book', 'Legacy Lorebook', '', 'uncategorized', 2, 2048, 'false',
        'legacy-char', 'legacy-persona', NULL, 'true', NULL, NULL, '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      )`),
    );
    await db.run(
      sql.raw(`INSERT INTO lorebook_entries (
        id, lorebook_id, name, content, keys, secondary_keys, enabled, constant, selective, selective_logic,
        probability, scan_depth, match_whole_words, case_sensitive, use_regex, position, depth, "order", role,
        sticky, cooldown, delay, "group", group_weight, tag, relationships, dynamic_state, activation_conditions,
        schedule, created_at, updated_at
      ) VALUES (
        'legacy-entry', 'legacy-book', 'Legacy Entry', 'Survives migration', '[]', '[]', 'true', 'false',
        'false', 'and', NULL, NULL, 'false', 'false', 'false', 0, 4, 100, 'system',
        NULL, NULL, NULL, '', NULL, '', '{}', '{}', '[]',
        NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      )`),
    );

    await runMigrations(db);
    await runMigrations(db);

    const folderTables = await db.all<{ name: string }>(
      sql.raw(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lorebook_folders'`),
    );
    const entryColumns = await db.all<{ name: string }>(sql.raw("PRAGMA table_info(lorebook_entries)"));
    const preservedEntries = await db.all<{ id: string; folder_id: string | null }>(
      sql.raw(`SELECT id, folder_id FROM lorebook_entries WHERE id = 'legacy-entry'`),
    );

    assert.equal(folderTables.length, 1);
    assert.ok(entryColumns.some((column) => column.name === "folder_id"));
    const lorebookColumns = await db.all<{ name: string }>(sql.raw("PRAGMA table_info(lorebooks)"));
    const migratedBooks = await db.all<{ id: string; is_global: string }>(
      sql.raw(`SELECT id, is_global FROM lorebooks WHERE id = 'legacy-book'`),
    );
    const characterLinkTables = await db.all<{ name: string }>(
      sql.raw(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lorebook_character_links'`),
    );
    const personaLinkTables = await db.all<{ name: string }>(
      sql.raw(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lorebook_persona_links'`),
    );
    const characterLinks = await db.all<{ lorebook_id: string; character_id: string }>(
      sql.raw(`SELECT lorebook_id, character_id FROM lorebook_character_links WHERE lorebook_id = 'legacy-book'`),
    );
    const personaLinks = await db.all<{ lorebook_id: string; persona_id: string }>(
      sql.raw(`SELECT lorebook_id, persona_id FROM lorebook_persona_links WHERE lorebook_id = 'legacy-book'`),
    );
    assert.ok(lorebookColumns.some((column) => column.name === "is_global"));
    assert.deepEqual(migratedBooks, [{ id: "legacy-book", is_global: "false" }]);
    assert.equal(characterLinkTables.length, 1);
    assert.equal(personaLinkTables.length, 1);
    assert.deepEqual(characterLinks, [{ lorebook_id: "legacy-book", character_id: "legacy-char" }]);
    assert.deepEqual(personaLinks, [{ lorebook_id: "legacy-book", persona_id: "legacy-persona" }]);
    assert.deepEqual(preservedEntries, [{ id: "legacy-entry", folder_id: null }]);
  } finally {
    client.close();
  }
});
