// ──────────────────────────────────────────────
// Lightweight Schema Migrations
// ──────────────────────────────────────────────
// Creates tables if missing, then adds missing columns.
// Each migration is idempotent — safe to run on every startup.
import { sql } from "drizzle-orm";
import type { DB } from "./connection.js";

// ── Table creation (CREATE IF NOT EXISTS) ──
// These match the Drizzle schema definitions exactly.
const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    mode TEXT NOT NULL,
    character_ids TEXT NOT NULL DEFAULT '[]',
    group_id TEXT,
    persona_id TEXT,
    prompt_preset_id TEXT,
    connection_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY NOT NULL,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    character_id TEXT,
    content TEXT NOT NULL DEFAULT '',
    active_swipe_index INTEGER NOT NULL DEFAULT 0,
    extra TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS message_swipes (
    id TEXT PRIMARY KEY NOT NULL,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    "index" INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    extra TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY NOT NULL,
    data TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    avatar_path TEXT,
    sprite_folder_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS personas (
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
  )`,
  `CREATE TABLE IF NOT EXISTS character_groups (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    avatar_path TEXT,
    character_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS persona_groups (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    persona_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lorebooks (
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
  )`,
  `CREATE TABLE IF NOT EXISTS lorebook_folders (
    id TEXT PRIMARY KEY NOT NULL,
    lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    enabled TEXT NOT NULL DEFAULT 'true',
    parent_folder_id TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lorebook_entries (
    id TEXT PRIMARY KEY NOT NULL,
    lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
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
  )`,
  `CREATE TABLE IF NOT EXISTS prompt_presets (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    section_order TEXT NOT NULL DEFAULT '[]',
    group_order TEXT NOT NULL DEFAULT '[]',
    variable_groups TEXT NOT NULL DEFAULT '[]',
    variable_values TEXT NOT NULL DEFAULT '{}',
    parameters TEXT NOT NULL DEFAULT '{}',
    wrap_format TEXT NOT NULL DEFAULT 'xml',
    default_choices TEXT NOT NULL DEFAULT '{}',
    is_default TEXT NOT NULL DEFAULT 'false',
    author TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prompt_groups (
    id TEXT PRIMARY KEY NOT NULL,
    preset_id TEXT NOT NULL REFERENCES prompt_presets(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    parent_group_id TEXT,
    "order" INTEGER NOT NULL DEFAULT 100,
    enabled TEXT NOT NULL DEFAULT 'true',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prompt_sections (
    id TEXT PRIMARY KEY NOT NULL,
    preset_id TEXT NOT NULL REFERENCES prompt_presets(id) ON DELETE CASCADE,
    identifier TEXT NOT NULL,
    name TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'system',
    enabled TEXT NOT NULL DEFAULT 'true',
    is_marker TEXT NOT NULL DEFAULT 'false',
    group_id TEXT,
    marker_config TEXT,
    injection_position TEXT NOT NULL DEFAULT 'ordered',
    injection_depth INTEGER NOT NULL DEFAULT 0,
    injection_order INTEGER NOT NULL DEFAULT 100,
    wrap_in_xml TEXT NOT NULL DEFAULT 'false',
    xml_tag_name TEXT NOT NULL DEFAULT '',
    forbid_overrides TEXT NOT NULL DEFAULT 'false'
  )`,
  `CREATE TABLE IF NOT EXISTS choice_blocks (
    id TEXT PRIMARY KEY NOT NULL,
    preset_id TEXT NOT NULL REFERENCES prompt_presets(id) ON DELETE CASCADE,
    variable_name TEXT NOT NULL,
    question TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '[]',
    multi_select TEXT NOT NULL DEFAULT 'false',
    separator TEXT NOT NULL DEFAULT ', ',
    random_pick TEXT NOT NULL DEFAULT 'false',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS api_connections (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    base_url TEXT NOT NULL DEFAULT '',
    api_key_encrypted TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    max_context INTEGER NOT NULL DEFAULT 128000,
    is_default TEXT NOT NULL DEFAULT 'false',
    use_for_random TEXT NOT NULL DEFAULT 'false',
    enable_caching TEXT NOT NULL DEFAULT 'false',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    character_id TEXT,
    expression TEXT,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agent_configs (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    phase TEXT NOT NULL,
    enabled TEXT NOT NULL DEFAULT 'true',
    connection_id TEXT,
    prompt_template TEXT NOT NULL DEFAULT '',
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY NOT NULL,
    agent_config_id TEXT NOT NULL REFERENCES agent_configs(id),
    chat_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    result_type TEXT NOT NULL,
    result_data TEXT NOT NULL DEFAULT '{}',
    tokens_used INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    success TEXT NOT NULL DEFAULT 'true',
    error TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agent_memory (
    id TEXT PRIMARY KEY NOT NULL,
    agent_config_id TEXT NOT NULL REFERENCES agent_configs(id),
    chat_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS custom_tools (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    parameters_schema TEXT NOT NULL DEFAULT '{}',
    execution_type TEXT NOT NULL DEFAULT 'static',
    webhook_url TEXT,
    static_result TEXT,
    script_body TEXT,
    enabled TEXT NOT NULL DEFAULT 'true',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS game_state_snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    chat_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    swipe_index INTEGER NOT NULL DEFAULT 0,
    date TEXT,
    time TEXT,
    location TEXT,
    weather TEXT,
    temperature TEXT,
    present_characters TEXT NOT NULL DEFAULT '[]',
    recent_events TEXT NOT NULL DEFAULT '[]',
    player_stats TEXT,
    persona_stats TEXT,
    committed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS game_checkpoints (
    id TEXT PRIMARY KEY NOT NULL,
    chat_id TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    label TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    location TEXT,
    game_state TEXT,
    weather TEXT,
    time_of_day TEXT,
    turn_number INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS regex_scripts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    enabled TEXT NOT NULL DEFAULT 'true',
    find_regex TEXT NOT NULL,
    replace_string TEXT NOT NULL DEFAULT '',
    trim_strings TEXT NOT NULL DEFAULT '[]',
    placement TEXT NOT NULL DEFAULT '["ai_output"]',
    flags TEXT NOT NULL DEFAULT 'gi',
    prompt_only TEXT NOT NULL DEFAULT 'false',
    "order" INTEGER NOT NULL DEFAULT 0,
    min_depth INTEGER,
    max_depth INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_images (
    id TEXT PRIMARY KEY NOT NULL,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS character_images (
    id TEXT PRIMARY KEY NOT NULL,
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ooc_influences (
    id TEXT PRIMARY KEY NOT NULL,
    source_chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    target_chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    anchor_message_id TEXT,
    consumed TEXT NOT NULL DEFAULT 'false',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversation_notes (
    id TEXT PRIMARY KEY NOT NULL,
    source_chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    target_chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    anchor_message_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memory_chunks (
    id TEXT PRIMARY KEY NOT NULL,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding TEXT,
    message_count INTEGER NOT NULL,
    first_message_at TEXT NOT NULL,
    last_message_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_folders (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    mode TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    collapsed TEXT NOT NULL DEFAULT 'false',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS custom_themes (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    css TEXT NOT NULL DEFAULT '',
    installed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_active TEXT NOT NULL DEFAULT 'false'
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_presets (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    mode TEXT NOT NULL,
    is_default TEXT NOT NULL DEFAULT 'false',
    is_active TEXT NOT NULL DEFAULT 'false',
    settings TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prompt_overrides (
    key TEXT PRIMARY KEY NOT NULL,
    template TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    updated_at TEXT NOT NULL
  )`,
];

// ── Column migrations (ALTER TABLE for schema evolution) ──
interface ColumnMigration {
  table: string;
  column: string;
  definition: string;
}

const COLUMN_MIGRATIONS: ColumnMigration[] = [
  {
    table: "api_connections",
    column: "enable_caching",
    definition: "TEXT NOT NULL DEFAULT 'false'",
  },
  {
    table: "game_state_snapshots",
    column: "committed",
    definition: "INTEGER NOT NULL DEFAULT 0",
  },
  {
    table: "personas",
    column: "persona_stats",
    definition: "TEXT NOT NULL DEFAULT ''",
  },
  {
    table: "game_state_snapshots",
    column: "persona_stats",
    definition: "TEXT",
  },
  {
    table: "game_state_snapshots",
    column: "manual_overrides",
    definition: "TEXT",
  },
  {
    table: "lorebooks",
    column: "max_recursion_depth",
    definition: "INTEGER NOT NULL DEFAULT 3",
  },
  {
    table: "lorebooks",
    column: "persona_id",
    definition: "TEXT",
  },
  {
    table: "lorebook_entries",
    column: "prevent_recursion",
    definition: "TEXT NOT NULL DEFAULT 'false'",
  },
  {
    table: "personas",
    column: "alt_descriptions",
    definition: "TEXT NOT NULL DEFAULT '[]'",
  },
  {
    table: "lorebook_entries",
    column: "embedding",
    definition: "TEXT",
  },
  {
    table: "api_connections",
    column: "embedding_model",
    definition: "TEXT",
  },
  {
    table: "chats",
    column: "connected_chat_id",
    definition: "TEXT",
  },
  {
    table: "api_connections",
    column: "embedding_connection_id",
    definition: "TEXT",
  },
  {
    table: "personas",
    column: "comment",
    definition: "TEXT NOT NULL DEFAULT ''",
  },
  {
    table: "lorebook_entries",
    column: "locked",
    definition: "TEXT NOT NULL DEFAULT 'false'",
  },
  {
    table: "lorebook_entries",
    column: "ephemeral",
    definition: "INTEGER",
  },
  {
    table: "api_connections",
    column: "default_for_agents",
    definition: "TEXT NOT NULL DEFAULT 'false'",
  },
  {
    table: "chats",
    column: "folder_id",
    definition: "TEXT",
  },
  {
    table: "chats",
    column: "sort_order",
    definition: "INTEGER NOT NULL DEFAULT 0",
  },
  {
    table: "api_connections",
    column: "openrouter_provider",
    definition: "TEXT",
  },
  {
    table: "api_connections",
    column: "image_generation_source",
    definition: "TEXT",
  },
  {
    table: "api_connections",
    column: "comfyui_workflow",
    definition: "TEXT",
  },
  {
    table: "api_connections",
    column: "image_service",
    definition: "TEXT",
  },
  {
    table: "api_connections",
    column: "embedding_base_url",
    definition: "TEXT",
  },
  {
    table: "characters",
    column: "comment",
    definition: "TEXT NOT NULL DEFAULT ''",
  },
  {
    table: "personas",
    column: "tags",
    definition: "TEXT NOT NULL DEFAULT '[]'",
  },
  {
    table: "lorebooks",
    column: "tags",
    definition: "TEXT NOT NULL DEFAULT '[]'",
  },
  {
    table: "api_connections",
    column: "default_parameters",
    definition: "TEXT",
  },
  {
    table: "api_connections",
    column: "max_tokens_override",
    definition: "INTEGER",
  },
  {
    table: "lorebook_entries",
    column: "description",
    definition: "TEXT NOT NULL DEFAULT ''",
  },
  {
    // Folder grouping. Nullable — entries with a NULL folder_id live at the
    // lorebook root level. Not enforced as a foreign key in SQLite so folder
    // deletion can simply set this back to NULL without cascade hassle.
    table: "lorebook_entries",
    column: "folder_id",
    definition: "TEXT",
  },
];

export async function runMigrations(db: DB) {
  // 1. Create all tables if they don't exist
  for (const stmt of CREATE_TABLES) {
    await db.run(sql.raw(stmt));
  }

  // 2. Add missing columns to existing tables
  for (const migration of COLUMN_MIGRATIONS) {
    const tableInfo = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${migration.table})`));
    const hasColumn = tableInfo.some((col) => col.name === migration.column);
    if (!hasColumn) {
      await db.run(sql.raw(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.definition}`));
    }
  }

  // 3. Create indexes if they don't exist
  await db.run(
    sql.raw(`CREATE INDEX IF NOT EXISTS idx_game_state_chat_id ON game_state_snapshots(chat_id, created_at DESC)`),
  );
  await db.run(
    sql.raw(`CREATE INDEX IF NOT EXISTS idx_game_state_message ON game_state_snapshots(message_id, swipe_index)`),
  );
  await db.run(
    sql.raw(`CREATE INDEX IF NOT EXISTS idx_game_checkpoints_chat ON game_checkpoints(chat_id, created_at DESC)`),
  );
  await db.run(
    sql.raw(`CREATE INDEX IF NOT EXISTS idx_ooc_influences_target ON ooc_influences(target_chat_id, consumed)`),
  );
  await db.run(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS idx_conversation_notes_target ON conversation_notes(target_chat_id, created_at)`,
    ),
  );
  await db.run(
    sql.raw(`CREATE INDEX IF NOT EXISTS idx_memory_chunks_chat ON memory_chunks(chat_id, last_message_at DESC)`),
  );
  await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_custom_themes_active ON custom_themes(is_active)`));
  await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS idx_chat_presets_mode_active ON chat_presets(mode, is_active)`));
}
