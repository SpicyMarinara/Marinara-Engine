import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import type { DB } from "../src/db/connection.js";
import { createCharactersStorage } from "../src/services/storage/characters.storage.js";
import { createLorebooksStorage } from "../src/services/storage/lorebooks.storage.js";
import { importSTCharacter } from "../src/services/import/st-character.importer.js";

async function createTestDb() {
  const root = mkdtempSync(join(tmpdir(), "marinara-st-character-import-"));
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

test("embedded SillyTavern character books preserve entry titles and settings", async () => {
  const { db, cleanup } = await createTestDb();

  try {
    const result = await importSTCharacter(
      {
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: {
          name: "Ari",
          description: "A test character",
          personality: "",
          scenario: "",
          first_mes: "Hello.",
          mes_example: "",
          creator_notes: "",
          system_prompt: "",
          post_history_instructions: "",
          tags: [],
          creator: "",
          character_version: "",
          alternate_greetings: [],
          extensions: {},
          character_book: {
            name: "Embedded Book",
            description: "Book description",
            scan_depth: 7,
            token_budget: 1234,
            recursive_scanning: true,
            max_recursion_depth: 5,
            entries: [
              {
                uid: 42,
                name: "The Rose Gate",
                comment: "",
                keys: ["rose"],
                secondary_keys: ["gate"],
                content: "The Rose Gate opens at dusk.",
                description: "A location entry",
                enabled: false,
                constant: true,
                selective: true,
                selectiveLogic: 1,
                probability: 65,
                scanDepth: 6,
                match_whole_words: true,
                case_sensitive: true,
                useRegex: true,
                position: 2,
                depth: 3,
                insertion_order: 9,
                role: 2,
                sticky: 4,
                cooldown: 5,
                delay: 6,
                ephemeral: 7,
                group: "locations",
                groupWeight: 8,
                preventRecursion: true,
                locked: true,
              },
            ],
          },
        },
      },
      db,
    );

    assert.equal(result.success, true);
    assert.equal(result.embeddedLorebook.imported, true);

    const storage = createLorebooksStorage(db);
    const lorebook = await storage.getById(result.lorebook?.lorebookId ?? "");
    assert.ok(lorebook);
    assert.equal(lorebook.characterId, result.characterId);
    assert.equal(lorebook.description, "Book description");
    assert.equal(lorebook.scanDepth, 7);
    assert.equal(lorebook.tokenBudget, 1234);
    assert.equal(lorebook.recursiveScanning, true);
    assert.equal(lorebook.maxRecursionDepth, 5);

    const entries = await storage.listEntries(lorebook.id as string);
    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.ok(entry);
    assert.equal(entry.name, "The Rose Gate");
    assert.deepEqual(entry.keys, ["rose"]);
    assert.deepEqual(entry.secondaryKeys, ["gate"]);
    assert.equal(entry.content, "The Rose Gate opens at dusk.");
    assert.equal(entry.description, "A location entry");
    assert.equal(entry.enabled, false);
    assert.equal(entry.constant, true);
    assert.equal(entry.selective, true);
    assert.equal(entry.selectiveLogic, "or");
    assert.equal(entry.probability, 65);
    assert.equal(entry.scanDepth, 6);
    assert.equal(entry.matchWholeWords, true);
    assert.equal(entry.caseSensitive, true);
    assert.equal(entry.useRegex, true);
    assert.equal(entry.position, 2);
    assert.equal(entry.depth, 3);
    assert.equal(entry.order, 9);
    assert.equal(entry.role, "assistant");
    assert.equal(entry.sticky, 4);
    assert.equal(entry.cooldown, 5);
    assert.equal(entry.delay, 6);
    assert.equal(entry.ephemeral, 7);
    assert.equal(entry.group, "locations");
    assert.equal(entry.groupWeight, 8);
    assert.equal(entry.preventRecursion, true);
    assert.equal(entry.locked, true);
  } finally {
    cleanup();
  }
});

test("embedded character books use name when comment is blank", async () => {
  const { db, cleanup } = await createTestDb();

  try {
    const result = await importSTCharacter(
      {
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: {
          name: "Lumen",
          description: "A test character",
          personality: "",
          scenario: "",
          first_mes: "Hello.",
          mes_example: "",
          creator_notes: "",
          system_prompt: "",
          post_history_instructions: "",
          tags: [],
          creator: "",
          character_version: "",
          alternate_greetings: [],
          extensions: {},
          character_book: {
            name: "Embedded Book",
            entries: [
              {
                name: "Celestials",
                comment: "",
                keys: ["celestial"],
                content: "Celestials are rare beings of pure energy.",
                extensions: {},
                enabled: true,
                case_sensitive: false,
                insertion_order: 0,
                priority: 0,
                selective: false,
                secondary_keys: [],
                constant: false,
                position: "after_char",
              },
            ],
          },
        },
      },
      db,
    );

    assert.equal(result.success, true);
    assert.equal(result.embeddedLorebook.imported, true);

    const storage = createLorebooksStorage(db);
    const entries = await storage.listEntries(result.lorebook?.lorebookId ?? "");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.name, "Celestials");

    const characterStorage = createCharactersStorage(db);
    const character = await characterStorage.getById(result.characterId ?? "");
    assert.ok(character);
    const charData = JSON.parse(character.data);
    assert.equal(charData.character_book.entries[0].name, "Celestials");
    assert.equal(charData.character_book.entries[0].comment, "Celestials");
  } finally {
    cleanup();
  }
});

test("V3 cards prefer wrapper character_book when data copy lost entry names", async () => {
  const { db, cleanup } = await createTestDb();

  try {
    const result = await importSTCharacter(
      {
        spec: "chara_card_v3",
        spec_version: "3.0",
        name: "Hero's party",
        character_book: {
          name: "The world of Lyozes",
          entries: [
            {
              entry_id: "1",
              keys: ["Celestials", "energy", "graveyard", "mana"],
              content: "Celestials are rare beings of pure energy.",
              extensions: {},
              enabled: true,
              case_sensitive: false,
              insertion_order: 0,
              name: "Celestials",
              priority: 0,
              comment: "",
              selective: false,
              secondary_keys: [],
              constant: false,
              position: "after_char",
            },
          ],
        },
        data: {
          name: "Hero's party",
          description: "A test character",
          personality: "",
          scenario: "",
          first_mes: "Hello.",
          mes_example: "",
          creator_notes: "",
          system_prompt: "",
          post_history_instructions: "",
          tags: [],
          creator: "",
          character_version: "",
          alternate_greetings: [],
          extensions: {},
          character_book: {
            name: "The world of Lyozes",
            entries: [
              {
                id: 0,
                keys: ["Celestials", "energy", "graveyard", "mana"],
                secondary_keys: [],
                comment: "",
                content: "Celestials are rare beings of pure energy.",
                constant: false,
                selective: false,
                insertion_order: 0,
                enabled: true,
                position: "after_char",
                extensions: {},
              },
            ],
          },
        },
      },
      db,
    );

    assert.equal(result.success, true);
    assert.equal(result.embeddedLorebook.imported, true);

    const lorebookStorage = createLorebooksStorage(db);
    const entries = await lorebookStorage.listEntries(result.lorebook?.lorebookId ?? "");
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.name, "Celestials");

    const characterStorage = createCharactersStorage(db);
    const character = await characterStorage.getById(result.characterId ?? "");
    assert.ok(character);
    const charData = JSON.parse(character.data);
    assert.equal(charData.character_book.entries[0].name, "Celestials");
    assert.equal(charData.character_book.entries[0].comment, "Celestials");
  } finally {
    cleanup();
  }
});
