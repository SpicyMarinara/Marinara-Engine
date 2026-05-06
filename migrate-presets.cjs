// ──────────────────────────────────────────────
// Migration: Add prompt_groups, choice_blocks tables
//            Add columns to prompt_presets & prompt_sections
// ──────────────────────────────────────────────
const { createClient } = require(
  require("path").join(__dirname, "packages", "server", "node_modules", "@libsql", "client"),
);
const path = require("path");

const DB_PATH = path.join(__dirname, "packages", "server", "data", "marinara-engine.db");

async function migrate() {
  const client = createClient({ url: `file:${DB_PATH}` });

  console.log("▸ Adding new columns to prompt_presets...");
  const presetCols = [
    ["group_order", "TEXT NOT NULL DEFAULT '[]'"],
    ["wrap_format", "TEXT NOT NULL DEFAULT 'xml'"],
    ["is_default", "TEXT NOT NULL DEFAULT 'false'"],
    ["author", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [col, def] of presetCols) {
    try {
      await client.execute(`ALTER TABLE prompt_presets ADD COLUMN ${col} ${def}`);
      console.log(`  ✓ prompt_presets.${col}`);
    } catch (e) {
      if (String(e).includes("duplicate column")) {
        console.log(`  – prompt_presets.${col} already exists`);
      } else {
        throw e;
      }
    }
  }

  console.log("▸ Adding new columns to prompt_sections...");
  const sectionCols = [
    ["group_id", "TEXT"],
    ["marker_config", "TEXT"],
  ];
  for (const [col, def] of sectionCols) {
    try {
      await client.execute(`ALTER TABLE prompt_sections ADD COLUMN ${col} ${def}`);
      console.log(`  ✓ prompt_sections.${col}`);
    } catch (e) {
      if (String(e).includes("duplicate column")) {
        console.log(`  – prompt_sections.${col} already exists`);
      } else {
        throw e;
      }
    }
  }

  console.log("▸ Creating prompt_groups table...");
  await client.execute(`
    CREATE TABLE IF NOT EXISTS prompt_groups (
      id TEXT PRIMARY KEY,
      preset_id TEXT NOT NULL REFERENCES prompt_presets(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      parent_group_id TEXT,
      "order" INTEGER NOT NULL DEFAULT 100,
      enabled TEXT NOT NULL DEFAULT 'true',
      created_at TEXT NOT NULL DEFAULT ''
    )
  `);
  console.log("  ✓ prompt_groups");

  console.log("▸ Creating choice_blocks table...");
  await client.execute(`
    CREATE TABLE IF NOT EXISTS choice_blocks (
      id TEXT PRIMARY KEY,
      section_id TEXT NOT NULL REFERENCES prompt_sections(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT ''
    )
  `);
  console.log("  ✓ choice_blocks");

  console.log("✅ Migration complete!");
  client.close();
}

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
