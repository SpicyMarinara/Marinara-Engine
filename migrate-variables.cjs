// ──────────────────────────────────────────────
// Migration: Rework choice_blocks → preset variables
//   - Drop old choice_blocks (section-bound)
//   - Create new choice_blocks with preset_id, variable_name, question
// ──────────────────────────────────────────────
const { createClient } = require(
  require("path").join(__dirname, "packages", "server", "node_modules", "@libsql", "client"),
);
const path = require("path");

const DB_PATH = path.join(__dirname, "packages", "server", "data", "marinara-engine.db");

async function migrate() {
  const client = createClient({ url: `file:${DB_PATH}` });

  console.log("▸ Dropping old choice_blocks table...");
  try {
    await client.execute("DROP TABLE IF EXISTS choice_blocks");
    console.log("  ✓ Old table dropped");
  } catch (e) {
    console.log("  (table did not exist, skipping)");
  }

  console.log("▸ Creating new choice_blocks table...");
  await client.execute(`
    CREATE TABLE IF NOT EXISTS choice_blocks (
      id TEXT PRIMARY KEY NOT NULL,
      preset_id TEXT NOT NULL REFERENCES prompt_presets(id) ON DELETE CASCADE,
      variable_name TEXT NOT NULL,
      question TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )
  `);
  console.log("  ✓ New choice_blocks table created");

  console.log("\n✅ Migration complete! Preset variables are now preset-level with variable names.");
  client.close();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
