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
        NULL, NULL, NULL, 'true', NULL, NULL, '[]', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
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
    assert.deepEqual(preservedEntries, [{ id: "legacy-entry", folder_id: null }]);
  } finally {
    client.close();
  }
});

test("startup migrations add saved persona status options to existing installs", async () => {
  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await db.run(
      sql.raw(`CREATE TABLE personas (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        personality TEXT NOT NULL DEFAULT '',
        scenario TEXT NOT NULL DEFAULT '',
        backstory TEXT NOT NULL DEFAULT '',
        appearance TEXT NOT NULL DEFAULT '',
        avatar_path TEXT,
        is_active TEXT NOT NULL DEFAULT 'false',
        name_color TEXT NOT NULL DEFAULT '',
        dialogue_color TEXT NOT NULL DEFAULT '',
        box_color TEXT NOT NULL DEFAULT '',
        persona_stats TEXT NOT NULL DEFAULT '',
        alt_descriptions TEXT NOT NULL DEFAULT '[]',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
    );
    await db.run(
      sql.raw(`INSERT INTO personas (
        id, name, comment, description, personality, scenario, backstory, appearance,
        avatar_path, is_active, name_color, dialogue_color, box_color, persona_stats,
        alt_descriptions, tags, created_at, updated_at
      ) VALUES (
        'legacy-persona', 'Legacy Persona', '', '', '', '', '', '',
        NULL, 'true', '', '', '', '', '[]', '[]',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      )`),
    );

    await runMigrations(db);
    await runMigrations(db);

    const personaColumns = await db.all<{ name: string }>(sql.raw("PRAGMA table_info(personas)"));
    const preservedPersonas = await db.all<{ id: string; saved_status_options: string }>(
      sql.raw(`SELECT id, saved_status_options FROM personas WHERE id = 'legacy-persona'`),
    );

    assert.ok(personaColumns.some((column) => column.name === "saved_status_options"));
    assert.deepEqual(preservedPersonas, [{ id: "legacy-persona", saved_status_options: "[]" }]);
  } finally {
    client.close();
  }
});
