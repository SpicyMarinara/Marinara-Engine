// ──────────────────────────────────────────────
// File-Native Storage
// ──────────────────────────────────────────────
//
// Marinara v1.5.7+ stores user data as JSON table snapshots under
// DATA_DIR/storage. SQLite is only opened during one-time legacy import when a
// previous marinara-engine.db exists; the live runtime uses this in-memory
// file-native table store and persists dirty tables back to JSON.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "../lib/logger.js";
import { getFileStorageDir } from "../config/runtime-config.js";
import * as schema from "./schema/index.js";

type Row = Record<string, unknown>;
type Table = Record<string | symbol, unknown>;
type Column = {
  name: string;
  table: Table;
  primary?: boolean;
  hasDefault?: boolean;
  default?: unknown;
  notNull?: boolean;
};
type Projection = Record<string, unknown> | undefined;
type Condition = unknown;
type Ordering = unknown;

type ColumnMeta = {
  key: string;
  dbName: string;
  column: Column;
  primary: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
};

type TableMeta = {
  name: string;
  table: Table;
  columns: ColumnMeta[];
  byKey: Map<string, ColumnMeta>;
  byDbName: Map<string, ColumnMeta>;
  primaryKey: string | null;
};

type RowContext = {
  rows: Record<string, Row>;
  rowids: Record<string, number>;
  baseTable: string;
  joined: boolean;
};

type JoinSpec = {
  table: TableMeta;
  condition: Condition;
};

type LegacyReader = "libsql" | "node:sqlite";

type TableSnapshotManifest = {
  version: 2;
  savedAt: string;
  backend: "file-native";
  migratedFromSqlite?: {
    path?: string;
    paths?: string[];
    importedAt: string;
  };
  legacyRepair?: {
    paths: string[];
    repairedAt: string;
    tables: Record<string, number>;
    reader?: LegacyReader;
  };
  tables: Record<string, number>;
};

export type FileNativeStoreController = {
  flush: () => Promise<void>;
  close: () => Promise<void>;
  rootDir: string;
};

export type FileNativeDB = {
  select: (projection?: Projection) => SelectFromBuilder;
  insert: (table: Table) => InsertBuilder;
  update: (table: Table) => UpdateSetBuilder;
  delete: (table: Table) => DeleteBuilder;
  run: () => Promise<void>;
  all: <T = unknown>() => Promise<T[]>;
  _fileStore: FileNativeStoreController;
};

type SelectFromBuilder = {
  from: (table: Table) => SelectQueryBuilder;
};

type SelectQueryBuilder = PromiseLike<Row[]> & {
  innerJoin: (table: Table, condition: Condition) => SelectQueryBuilder;
  where: (condition: Condition) => SelectQueryBuilder;
  orderBy: (...orderings: Ordering[]) => SelectQueryBuilder;
  limit: (limit: number) => SelectQueryBuilder;
  offset: (offset: number) => SelectQueryBuilder;
  run: () => Promise<Row[]>;
};

type InsertBuilder = {
  values: (rows: Row | Row[]) => InsertValuesBuilder;
};

type UpdateSetBuilder = {
  set: (patch: Row) => UpdateWhereBuilder;
};

type UpdateWhereBuilder = Executable<void> & {
  where: (condition: Condition) => Executable<void>;
};

type DeleteBuilder = Executable<void> & {
  where: (condition: Condition) => Executable<void>;
};

type Executable<T> = PromiseLike<T> & {
  run: () => Promise<T>;
  catch: Promise<T>["catch"];
  finally: Promise<T>["finally"];
};

type InsertValuesBuilder = Executable<void> & {
  onConflictDoUpdate: (config: { target: unknown; set: Row }) => Executable<void>;
};

const STORAGE_VERSION = 2;
const SAVE_DEBOUNCE_MS = 750;
const SAFETY_SAVE_MS = 10_000;

export const FILE_BACKED_TABLES = [
  "chats",
  "messages",
  "message_swipes",
  "characters",
  "character_card_versions",
  "personas",
  "character_groups",
  "persona_groups",
  "lorebooks",
  "lorebook_folders",
  "lorebook_entries",
  "prompt_presets",
  "prompt_groups",
  "prompt_sections",
  "choice_blocks",
  "api_connections",
  "assets",
  "agent_configs",
  "agent_runs",
  "agent_memory",
  "custom_tools",
  "game_state_snapshots",
  "game_checkpoints",
  "regex_scripts",
  "chat_images",
  "character_images",
  "ooc_influences",
  "conversation_notes",
  "memory_chunks",
  "chat_folders",
  "custom_themes",
  "app_settings",
  "chat_presets",
  "prompt_overrides",
  "installed_extensions",
] as const;

type FileBackedTable = (typeof FILE_BACKED_TABLES)[number];

const FILE_BACKED_TABLE_SET = new Set<string>(FILE_BACKED_TABLES);
const TABLES_REVERSE = [...FILE_BACKED_TABLES].reverse();

const CASCADES: Array<{ parent: FileBackedTable; child: FileBackedTable; parentKey: string; childKey: string }> = [
  { parent: "chats", child: "messages", parentKey: "id", childKey: "chatId" },
  { parent: "chats", child: "agent_runs", parentKey: "id", childKey: "chatId" },
  { parent: "chats", child: "agent_memory", parentKey: "id", childKey: "chatId" },
  { parent: "chats", child: "chat_images", parentKey: "id", childKey: "chatId" },
  { parent: "chats", child: "memory_chunks", parentKey: "id", childKey: "chatId" },
  { parent: "chats", child: "game_state_snapshots", parentKey: "id", childKey: "chatId" },
  { parent: "chats", child: "game_checkpoints", parentKey: "id", childKey: "chatId" },
  { parent: "messages", child: "message_swipes", parentKey: "id", childKey: "messageId" },
  { parent: "characters", child: "character_card_versions", parentKey: "id", childKey: "characterId" },
  { parent: "characters", child: "character_images", parentKey: "id", childKey: "characterId" },
  { parent: "lorebooks", child: "lorebook_folders", parentKey: "id", childKey: "lorebookId" },
  { parent: "lorebooks", child: "lorebook_entries", parentKey: "id", childKey: "lorebookId" },
  { parent: "prompt_presets", child: "prompt_groups", parentKey: "id", childKey: "presetId" },
  { parent: "prompt_presets", child: "prompt_sections", parentKey: "id", childKey: "presetId" },
  { parent: "prompt_presets", child: "choice_blocks", parentKey: "id", childKey: "presetId" },
  { parent: "agent_configs", child: "agent_runs", parentKey: "id", childKey: "agentConfigId" },
  { parent: "agent_configs", child: "agent_memory", parentKey: "id", childKey: "agentConfigId" },
];

const tableMetasByObject = new WeakMap<object, TableMeta>();
const columnMetasByObject = new WeakMap<object, ColumnMeta>();
const tableMetasByName = new Map<string, TableMeta>();
let skipLibsqlLegacyReader = false;
let skipNodeSqliteLegacyReader = false;
let legacyReaderUsed: LegacyReader | null = null;

function symbolValue<T>(target: object, symbolName: string): T | undefined {
  const symbol = Object.getOwnPropertySymbols(target).find((entry) => String(entry) === symbolName);
  return symbol ? (target as Record<symbol, T>)[symbol] : undefined;
}

function isTable(value: unknown): value is Table {
  return Boolean(value && typeof value === "object" && symbolValue(value as object, "Symbol(drizzle:IsDrizzleTable)"));
}

function tableNameOf(table: Table): string {
  const name = symbolValue<string>(table, "Symbol(drizzle:Name)");
  if (!name) {
    throw new Error("[file-storage] Unknown table object");
  }
  return name;
}

function buildTableMetadata() {
  for (const candidate of Object.values(schema)) {
    if (!isTable(candidate)) continue;
    const table = candidate as Table;
    const name = tableNameOf(table);
    if (!FILE_BACKED_TABLE_SET.has(name)) continue;
    const columnsObject = symbolValue<Record<string, Column>>(table, "Symbol(drizzle:Columns)") ?? {};
    const columns: ColumnMeta[] = Object.entries(columnsObject).map(([key, column]) => ({
      key,
      dbName: column.name,
      column,
      primary: column.primary === true,
      hasDefault: column.hasDefault === true,
      defaultValue: column.default,
    }));
    const meta: TableMeta = {
      name,
      table,
      columns,
      byKey: new Map(columns.map((column) => [column.key, column])),
      byDbName: new Map(columns.map((column) => [column.dbName, column])),
      primaryKey: columns.find((column) => column.primary)?.key ?? null,
    };
    tableMetasByObject.set(table, meta);
    tableMetasByName.set(name, meta);
    for (const column of columns) {
      columnMetasByObject.set(column.column, column);
    }
  }

  const missing = FILE_BACKED_TABLES.filter((table) => !tableMetasByName.has(table));
  if (missing.length > 0) {
    throw new Error(`[file-storage] Missing schema metadata for: ${missing.join(", ")}`);
  }
}

buildTableMetadata();

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function flushFile(path: string) {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch {
    // Best effort only. Some mobile filesystems reject fsync for app data.
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function atomicWriteFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (existsSync(path)) {
      try {
        copyFileSync(path, `${path}.bak`);
      } catch {
        /* ignore */
      }
    }
    writeFileSync(tmpPath, content);
    flushFile(tmpPath);
    renameSync(tmpPath, path);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function parseJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    const backupPath = `${path}.bak`;
    if (existsSync(backupPath)) {
      logger.warn({ err }, `[file-storage] Failed to parse ${path}; trying ${backupPath}`);
      return JSON.parse(readFileSync(backupPath, "utf8")) as T;
    }
    throw err;
  }
}

function tableFilePath(rootDir: string, table: string) {
  return join(rootDir, "tables", `${table}.json`);
}

function manifestPath(rootDir: string) {
  return join(rootDir, "manifest.json");
}

function fileStoreManifestExists(rootDir: string) {
  return existsSync(manifestPath(rootDir));
}

function tableSnapshotsExist(rootDir: string) {
  return existsSync(join(rootDir, "tables"));
}

function defaultForColumn(column: ColumnMeta) {
  if (column.hasDefault) return typeof column.defaultValue === "function" ? column.defaultValue() : column.defaultValue;
  return null;
}

function normalizeRow(meta: TableMeta, row: Row) {
  const normalized: Row = {};
  for (const column of meta.columns) {
    if (Object.prototype.hasOwnProperty.call(row, column.key)) {
      normalized[column.key] = row[column.key] ?? null;
    } else if (Object.prototype.hasOwnProperty.call(row, column.dbName)) {
      normalized[column.key] = row[column.dbName] ?? null;
    } else {
      normalized[column.key] = defaultForColumn(column);
    }
  }
  return normalized;
}

function prepareInsertRow(meta: TableMeta, row: Row) {
  const normalized = normalizeRow(meta, row);
  for (const key of Object.keys(row)) {
    if (!meta.byKey.has(key) && !meta.byDbName.has(key)) {
      normalized[key] = row[key];
    }
  }
  return normalized;
}

function normalizeConflictTargets(target: unknown) {
  const targets = Array.isArray(target) ? target : target ? [target] : [];
  return targets.map((entry) => getColumnMeta(entry)?.key).filter((entry): entry is string => Boolean(entry));
}

function findDuplicateIndex(meta: TableMeta, rows: Row[], row: Row, conflictColumns: string[]) {
  const columns = conflictColumns.length > 0 ? conflictColumns : meta.primaryKey ? [meta.primaryKey] : [];
  if (columns.length === 0) return -1;
  return rows.findIndex((existing) => columns.every((column) => existing[column] === row[column]));
}

function legacyRowTimestamp(row: Row) {
  for (const key of ["updatedAt", "updated_at", "createdAt", "created_at"]) {
    const value = row[key];
    if (typeof value !== "string") continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function chooseLegacyRow(existing: Row | undefined, candidate: Row) {
  if (!existing) return candidate;
  return legacyRowTimestamp(candidate) >= legacyRowTimestamp(existing) ? candidate : existing;
}

function cloneRow(row: Row) {
  return { ...row };
}

function getMeta(table: Table | string) {
  const meta = typeof table === "string" ? tableMetasByName.get(table) : tableMetasByObject.get(table);
  if (!meta) {
    throw new Error(`[file-storage] Unsupported table: ${typeof table === "string" ? table : tableNameOf(table)}`);
  }
  return meta;
}

function getColumnMeta(column: unknown): ColumnMeta | null {
  if (!column || typeof column !== "object") return null;
  const direct = columnMetasByObject.get(column);
  if (direct) return direct;
  const candidate = column as Partial<Column>;
  if (!candidate.table || !candidate.name) return null;
  const tableMeta = tableMetasByObject.get(candidate.table);
  return tableMeta?.byDbName.get(candidate.name) ?? null;
}

function isColumn(value: unknown): value is Column {
  return Boolean(getColumnMeta(value));
}

function isSql(value: unknown): value is { queryChunks: unknown[] } {
  return Boolean(
    value && typeof value === "object" && Array.isArray((value as { queryChunks?: unknown[] }).queryChunks),
  );
}

function isAliasedSql(value: unknown): value is { sql: { queryChunks: unknown[] }; fieldAlias: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    isSql((value as { sql?: unknown }).sql) &&
    typeof (value as { fieldAlias?: unknown }).fieldAlias === "string",
  );
}

function stringChunkText(chunk: unknown) {
  if (!chunk || typeof chunk !== "object" || !Array.isArray((chunk as { value?: unknown }).value)) return null;
  return (chunk as { value: unknown[] }).value.map((part) => String(part)).join("");
}

function isParam(value: unknown): value is { value: unknown } {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value"));
}

function compactChunks(sqlValue: { queryChunks: unknown[] }) {
  return sqlValue.queryChunks.filter((chunk) => {
    const text = stringChunkText(chunk);
    return text === null || text.trim().length > 0;
  });
}

function unwrapParenthesizedChunks(chunks: unknown[]) {
  let unwrapped = chunks;
  while (unwrapped.length >= 3) {
    const first = stringChunkText(unwrapped[0])?.trim();
    const last = stringChunkText(unwrapped[unwrapped.length - 1])?.trim();
    if (first !== "(" || last !== ")") break;
    unwrapped = unwrapped.slice(1, -1);
  }
  return unwrapped;
}

function valueForColumn(ctx: RowContext, column: Column) {
  const meta = getColumnMeta(column);
  if (!meta) return undefined;
  const tableName = tableNameOf(column.table);
  return ctx.rows[tableName]?.[meta.key];
}

function rowidForColumnPath(ctx: RowContext, path: string) {
  const [tableName, columnName] = path.split(".");
  if (columnName !== "rowid" || !tableName) return undefined;
  return ctx.rowids[tableName];
}

function resolveValue(value: unknown, ctx: RowContext): unknown {
  if (isColumn(value)) return valueForColumn(ctx, value);
  if (isParam(value)) return value.value;
  if (Array.isArray(value)) return value.map((entry) => resolveValue(entry, ctx));
  if (isAliasedSql(value)) return resolveValue(value.sql, ctx);
  if (isSql(value)) {
    const chunks = compactChunks(value);
    if (chunks.length === 1) {
      const text = stringChunkText(chunks[0])?.trim();
      if (text) return rowidForColumnPath(ctx, text);
    }
    if (chunks.length === 3) {
      const operator = stringChunkText(chunks[1])?.trim();
      if (operator === "-") {
        return Number(resolveValue(chunks[0], ctx)) - Number(resolveValue(chunks[2], ctx));
      }
      if (operator === "+") {
        return Number(resolveValue(chunks[0], ctx)) + Number(resolveValue(chunks[2], ctx));
      }
    }
  }
  return value;
}

function compareValues(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function matchesLike(value: unknown, pattern: unknown) {
  const escaped = String(pattern ?? "")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(String(value ?? ""));
}

function evaluateSqlCondition(sqlValue: { queryChunks: unknown[] }, ctx: RowContext): boolean {
  const chunks = unwrapParenthesizedChunks(compactChunks(sqlValue));
  if (chunks.length === 1 && isSql(chunks[0])) {
    return evaluateSqlCondition(chunks[0], ctx);
  }

  const logicalSeparator = chunks.find((chunk) => {
    const text = stringChunkText(chunk)?.trim().toLowerCase();
    return text === "and" || text === "or";
  });
  const logicalOp = stringChunkText(logicalSeparator)?.trim().toLowerCase();
  if (logicalOp === "and" || logicalOp === "or") {
    const parts = chunks.filter((chunk) => isSql(chunk)) as Array<{ queryChunks: unknown[] }>;
    return logicalOp === "and"
      ? parts.every((part) => evaluateSqlCondition(part, ctx))
      : parts.some((part) => evaluateSqlCondition(part, ctx));
  }

  const opIndex = chunks.findIndex((chunk) => {
    const text = stringChunkText(chunk)?.trim().toLowerCase();
    return ["=", "<>", "!=", "<", ">", "<=", ">=", "in", "like"].includes(text ?? "");
  });
  if (opIndex !== -1) {
    const operator = stringChunkText(chunks[opIndex])!.trim().toLowerCase();
    const left = resolveValue(chunks[opIndex - 1], ctx);
    const right = resolveValue(chunks[opIndex + 1], ctx);

    if (operator === "=") return left === right;
    if (operator === "<>" || operator === "!=") {
      if (right === null || right === undefined) return left !== null && left !== undefined;
      return left !== right;
    }
    if (operator === "<") return compareValues(left, right) < 0;
    if (operator === ">") return compareValues(left, right) > 0;
    if (operator === "<=") return compareValues(left, right) <= 0;
    if (operator === ">=") return compareValues(left, right) >= 0;
    if (operator === "in") return Array.isArray(right) && right.includes(left);
    if (operator === "like") return matchesLike(left, right);
  }

  const nullCheck = chunks.find((chunk) => {
    const text = stringChunkText(chunk)?.trim().toLowerCase();
    return text === "is null" || text === "is not null";
  });
  const nullOp = stringChunkText(nullCheck)?.trim().toLowerCase();
  if (nullOp === "is null" || nullOp === "is not null") {
    const left = resolveValue(chunks[chunks.indexOf(nullCheck) - 1], ctx);
    return nullOp === "is null" ? left === null || left === undefined : left !== null && left !== undefined;
  }

  return Boolean(resolveValue(sqlValue, ctx));
}

function evaluateCondition(condition: Condition, ctx: RowContext): boolean {
  if (!condition) return true;
  if (isSql(condition)) return evaluateSqlCondition(condition, ctx);
  return Boolean(condition);
}

function orderSpec(ordering: Ordering, ctx: RowContext): { value: unknown; direction: "asc" | "desc" } {
  if (isColumn(ordering)) {
    return { value: resolveValue(ordering, ctx), direction: "asc" };
  }
  if (isSql(ordering)) {
    const chunks = compactChunks(ordering);
    const directionChunk = chunks.find((chunk) => {
      const text = stringChunkText(chunk)?.trim().toLowerCase();
      return text === "asc" || text === "desc";
    });
    const direction = stringChunkText(directionChunk)?.trim().toLowerCase() === "desc" ? "desc" : "asc";
    const valueChunk = chunks.find((chunk) => chunk !== directionChunk && isColumn(chunk));
    if (valueChunk) return { value: resolveValue(valueChunk, ctx), direction };
    const rawPath = chunks
      .map((chunk) => stringChunkText(chunk) ?? "")
      .join("")
      .replace(/\s+(asc|desc)$/i, "")
      .trim();
    return { value: rowidForColumnPath(ctx, rawPath), direction };
  }
  return { value: ordering, direction: "asc" };
}

function projectRow(ctx: RowContext, projection: Projection) {
  if (!projection) {
    if (ctx.joined) {
      return Object.fromEntries(Object.entries(ctx.rows).map(([table, row]) => [table, cloneRow(row)]));
    }
    return cloneRow(ctx.rows[ctx.baseTable] ?? {});
  }

  const output: Row = {};
  for (const [key, value] of Object.entries(projection)) {
    output[key] = resolveValue(value, ctx);
  }
  return output;
}

function executable<T>(operation: () => T | Promise<T>): Executable<T> {
  let promise: Promise<T> | null = null;
  const getPromise = () => {
    promise ??= Promise.resolve().then(operation);
    return promise;
  };
  return {
    run: getPromise,
    then: (onfulfilled, onrejected) => getPromise().then(onfulfilled, onrejected),
    catch: (onrejected) => getPromise().catch(onrejected),
    finally: (onfinally) => getPromise().finally(onfinally),
  };
}

async function readLegacyRowsWithLibsql(dbPath: string, table: string) {
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url: `file:${dbPath}` });
  try {
    const exists = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      args: [table],
    });
    if (!exists.rows.length) return [];

    const result = await client.execute(`SELECT * FROM ${quoteIdentifier(table)}`);
    return result.rows.map((row) => ({ ...row }) as Row);
  } finally {
    client.close();
  }
}

async function readLegacyRowsWithNodeSqlite(dbPath: string, table: string) {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const exists = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!exists) return [];

    return database.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as Row[];
  } finally {
    database.close();
  }
}

async function readLegacyRows(dbPath: string, table: string) {
  if (!skipLibsqlLegacyReader && process.env.MARINARA_DISABLE_LIBSQL_LEGACY_READER !== "true") {
    try {
      const rows = await readLegacyRowsWithLibsql(dbPath, table);
      legacyReaderUsed = "libsql";
      return rows;
    } catch (libsqlErr) {
      skipLibsqlLegacyReader = true;
      logger.warn({ err: libsqlErr }, "[file-storage] libSQL unavailable for legacy import; falling back");
    }
  }

  if (!skipNodeSqliteLegacyReader) {
    try {
      const rows = await readLegacyRowsWithNodeSqlite(dbPath, table);
      legacyReaderUsed = "node:sqlite";
      return rows;
    } catch (nodeSqliteErr) {
      skipNodeSqliteLegacyReader = true;
      logger.warn(
        { err: nodeSqliteErr },
        "[file-storage] node:sqlite unavailable for legacy import; skipping legacy DB",
      );
    }
  }

  return [];
}

class FileTableStore {
  private tables = new Map<string, Row[]>();
  private dirtyTables = new Set<string>();
  private dirty = false;
  private saving = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private safetyTimer: NodeJS.Timeout | null = null;
  private beforeExitHandler: (() => void) | null = null;
  private migratedFromSqlite: TableSnapshotManifest["migratedFromSqlite"];
  private legacyRepair: TableSnapshotManifest["legacyRepair"];
  private loadedManifest: TableSnapshotManifest | null = null;

  constructor(
    private readonly rootDir: string,
    private readonly legacyDbPaths: string[],
  ) {
    for (const table of FILE_BACKED_TABLES) {
      this.tables.set(table, []);
    }
  }

  async initialize() {
    mkdirSync(this.rootDir, { recursive: true });

    if (fileStoreManifestExists(this.rootDir)) {
      this.loadFileSnapshots();
      await this.repairLegacyImportIfNeeded();
    } else if (this.legacyDbPaths.some((path) => existsSync(path))) {
      const imported = await this.importLegacySqlite(this.legacyDbPaths);
      if (imported) {
        await this.flush(true);
      } else if (tableSnapshotsExist(this.rootDir)) {
        this.loadFileSnapshots();
      }
    } else if (tableSnapshotsExist(this.rootDir)) {
      this.loadFileSnapshots();
    }

    this.installAutosave();
    logger.info(`[file-storage] Using file-native storage at ${this.rootDir}`);
  }

  rows(table: Table | string) {
    return this.tables.get(getMeta(table).name) ?? [];
  }

  select(projection?: Projection): SelectFromBuilder {
    return {
      from: (table) => new SelectQuery(this, getMeta(table), projection),
    };
  }

  insert(table: Table): InsertBuilder {
    const meta = getMeta(table);
    return {
      values: (rows) => {
        const runInsert = (onConflict?: { target: unknown; set: Row }) =>
          executable(async () => {
            const conflictColumns = normalizeConflictTargets(onConflict?.target);
            const inputRows = Array.isArray(rows) ? rows : [rows];
            const target = this.rows(meta.name);
            for (const input of inputRows) {
              const row = prepareInsertRow(meta, input);
              const duplicateIndex = findDuplicateIndex(meta, target, row, conflictColumns);
              if (duplicateIndex !== -1) {
                if (!onConflict) {
                  const conflictKey = conflictColumns[0] ?? meta.primaryKey ?? "unknown";
                  throw new Error(
                    `[file-storage] Duplicate primary key for ${meta.name}.${conflictKey}: ${row[conflictKey]}`,
                  );
                }
                const existing = target[duplicateIndex]!;
                const ctx = this.contextForRow(meta, existing, duplicateIndex);
                for (const [key, value] of Object.entries(onConflict.set)) {
                  const column = meta.byKey.get(key) ?? meta.byDbName.get(key);
                  existing[column?.key ?? key] = resolveValue(value, ctx);
                }
              } else {
                target.push(row);
              }
            }
            this.markDirty(meta.name);
          });
        const builder = runInsert() as InsertValuesBuilder;
        builder.onConflictDoUpdate = (config) => runInsert(config);
        return builder;
      },
    };
  }

  update(table: Table): UpdateSetBuilder {
    const meta = getMeta(table);
    return {
      set: (patch) => {
        const runUpdate = (condition?: Condition) =>
          executable(async () => {
            const target = this.rows(meta.name);
            let changed = false;
            target.forEach((row, index) => {
              const ctx = this.contextForRow(meta, row, index);
              if (!evaluateCondition(condition, ctx)) return;
              for (const [key, value] of Object.entries(patch)) {
                const column = meta.byKey.get(key) ?? meta.byDbName.get(key);
                row[column?.key ?? key] = resolveValue(value, ctx);
              }
              changed = true;
            });
            if (changed) this.markDirty(meta.name);
          });
        const builder = runUpdate() as UpdateWhereBuilder;
        builder.where = (condition) => runUpdate(condition);
        return builder;
      },
    };
  }

  delete(table: Table): DeleteBuilder {
    const meta = getMeta(table);
    const runDelete = (condition?: Condition) =>
      executable(async () => {
        this.deleteWhere(meta, condition);
      });
    const builder = runDelete() as DeleteBuilder;
    builder.where = (condition) => runDelete(condition);
    return builder;
  }

  async all<T = unknown>() {
    return [] as T[];
  }

  async run() {
    // Raw SQL is intentionally unsupported by the file-native runtime. The app
    // keeps this no-op for legacy migrations in opt-in SQLite mode only.
  }

  async flush(force = false) {
    if (this.saving) {
      this.dirty = true;
      return;
    }
    if (!force && !this.dirty && this.dirtyTables.size === 0) return;
    this.saving = true;
    this.dirty = false;
    try {
      this.saveFileSnapshots();
      this.dirtyTables.clear();
    } catch (err) {
      this.dirty = true;
      logger.error({ err }, "[file-storage] Failed to persist file-native storage");
    } finally {
      this.saving = false;
    }
  }

  async close() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.safetyTimer) {
      clearInterval(this.safetyTimer);
      this.safetyTimer = null;
    }
    if (this.beforeExitHandler) {
      process.off("beforeExit", this.beforeExitHandler);
      this.beforeExitHandler = null;
    }
    await this.flush(true);
  }

  contextForRow(meta: TableMeta, row: Row, index: number): RowContext {
    return {
      rows: { [meta.name]: row },
      rowids: { [meta.name]: index + 1 },
      baseTable: meta.name,
      joined: false,
    };
  }

  markDirty(table: string) {
    this.dirty = true;
    this.dirtyTables.add(table);
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
    this.debounceTimer.unref?.();
  }

  private deleteWhere(meta: TableMeta, condition?: Condition) {
    const target = this.rows(meta.name);
    const kept: Row[] = [];
    const deleted: Row[] = [];
    target.forEach((row, index) => {
      if (evaluateCondition(condition, this.contextForRow(meta, row, index))) {
        deleted.push(row);
      } else {
        kept.push(row);
      }
    });
    if (deleted.length === 0) return;
    this.tables.set(meta.name, kept);
    this.markDirty(meta.name);
    this.applyCascades(meta.name as FileBackedTable, deleted);
  }

  private applyCascades(parentTable: FileBackedTable, deletedRows: Row[]) {
    for (const cascade of CASCADES.filter((entry) => entry.parent === parentTable)) {
      const childMeta = getMeta(cascade.child);
      const deletedValues = new Set(deletedRows.map((row) => row[cascade.parentKey]));
      this.deleteWhere(childMeta, {
        queryChunks: [
          childMeta.byKey.get(cascade.childKey)?.column,
          { value: [" in "] },
          Array.from(deletedValues).map((value) => ({ value })),
        ],
      });
    }
  }

  private loadFileSnapshots() {
    this.loadedManifest = parseJsonFile<TableSnapshotManifest | null>(manifestPath(this.rootDir), null);
    this.migratedFromSqlite = this.loadedManifest?.migratedFromSqlite;
    this.legacyRepair = this.loadedManifest?.legacyRepair;

    const counts: Record<string, number> = {};
    for (const table of FILE_BACKED_TABLES) {
      const meta = getMeta(table);
      const rows = parseJsonFile<Row[]>(tableFilePath(this.rootDir, table), []);
      const normalized = (Array.isArray(rows) ? rows : []).map((row) => normalizeRow(meta, row));
      this.tables.set(table, normalized);
      counts[table] = normalized.length;
    }
    logger.info({ tables: counts }, `[file-storage] Loaded file-native data from ${this.rootDir}`);
  }

  private async readMergedLegacyRows(dbPaths: string[], table: string) {
    const meta = getMeta(table);
    const byPrimaryKey = new Map<string, Row>();
    const rowsWithoutPrimaryKey: Row[] = [];

    for (const dbPath of dbPaths) {
      if (!existsSync(dbPath)) continue;
      const rows = await readLegacyRows(dbPath, table);
      for (const row of rows) {
        const normalized = normalizeRow(meta, row);
        const primaryValue = meta.primaryKey ? normalized[meta.primaryKey] : null;
        if (primaryValue === null || primaryValue === undefined || primaryValue === "") {
          rowsWithoutPrimaryKey.push(normalized);
          continue;
        }
        const key = String(primaryValue);
        byPrimaryKey.set(key, chooseLegacyRow(byPrimaryKey.get(key), normalized));
      }
    }

    return [...byPrimaryKey.values(), ...rowsWithoutPrimaryKey];
  }

  private async importLegacySqlite(dbPaths: string[]) {
    const existingPaths = [...new Set(dbPaths.filter((path) => existsSync(path)))];
    if (existingPaths.length === 0) return false;

    const counts: Record<string, number> = {};
    let totalRows = 0;
    for (const table of FILE_BACKED_TABLES) {
      const rows = await this.readMergedLegacyRows(existingPaths, table);
      this.tables.set(table, rows);
      counts[table] = rows.length;
      totalRows += rows.length;
    }

    if (totalRows === 0) return false;

    this.migratedFromSqlite = {
      path: existingPaths[0],
      paths: existingPaths,
      importedAt: new Date().toISOString(),
    };
    for (const table of FILE_BACKED_TABLES) this.dirtyTables.add(table);
    this.dirty = true;
    logger.info(
      { sources: existingPaths, rows: totalRows, tables: counts },
      "[file-storage] Imported existing SQLite data into file-native storage",
    );
    return true;
  }

  private async repairLegacyImportIfNeeded() {
    const existingPaths = [...new Set(this.legacyDbPaths.filter((path) => existsSync(path)))];
    if (existingPaths.length === 0) return;
    if (this.isLegacyRepairComplete()) return;

    legacyReaderUsed = null;
    const repairedCounts: Record<string, number> = {};
    let repairedRows = 0;

    for (const table of FILE_BACKED_TABLES) {
      const meta = getMeta(table);
      const legacyRows = await this.readMergedLegacyRows(existingPaths, table);
      if (legacyRows.length === 0) continue;

      const currentRows = this.rows(table);
      const merged = new Map<string, Row>();
      const passthroughRows: Row[] = [];

      for (const row of currentRows) {
        const primaryValue = meta.primaryKey ? row[meta.primaryKey] : null;
        if (primaryValue === null || primaryValue === undefined || primaryValue === "") {
          passthroughRows.push(row);
        } else {
          merged.set(String(primaryValue), row);
        }
      }

      let tableRepairs = 0;
      for (const row of legacyRows) {
        const primaryValue = meta.primaryKey ? row[meta.primaryKey] : null;
        if (primaryValue === null || primaryValue === undefined || primaryValue === "") continue;
        const key = String(primaryValue);
        if (merged.has(key)) continue;
        merged.set(key, row);
        tableRepairs += 1;
      }

      if (tableRepairs > 0) {
        this.tables.set(table, [...merged.values(), ...passthroughRows]);
        this.dirtyTables.add(table);
        repairedCounts[table] = tableRepairs;
        repairedRows += tableRepairs;
      }
    }

    if (repairedRows === 0) {
      if (!legacyReaderUsed) {
        logger.warn(
          { sources: existingPaths },
          "[file-storage] Legacy SQLite data could not be read; will retry repair on next startup",
        );
        return;
      }
      this.legacyRepair = {
        paths: existingPaths,
        repairedAt: new Date().toISOString(),
        tables: {},
        reader: legacyReaderUsed,
      };
    } else {
      this.legacyRepair = {
        paths: existingPaths,
        repairedAt: new Date().toISOString(),
        tables: repairedCounts,
        reader: legacyReaderUsed ?? undefined,
      };
      this.dirty = true;
      logger.info(
        { sources: existingPaths, rows: repairedRows, tables: repairedCounts },
        "[file-storage] Repaired file-native storage from legacy SQLite data",
      );
    }

    await this.flush(true);
  }

  private isLegacyRepairComplete() {
    if (!this.legacyRepair) return false;
    if (this.legacyRepair.reader) return true;
    return Object.values(this.legacyRepair.tables ?? {}).some((count) => count > 0);
  }

  private saveFileSnapshots() {
    mkdirSync(join(this.rootDir, "tables"), { recursive: true });
    const tables: Record<string, number> = {};

    for (const table of FILE_BACKED_TABLES) {
      const rows = this.rows(table);
      tables[table] = rows.length;
      if (this.dirtyTables.has(table) || !existsSync(tableFilePath(this.rootDir, table))) {
        atomicWriteFile(tableFilePath(this.rootDir, table), JSON.stringify(rows));
      }
    }

    const manifest: TableSnapshotManifest = {
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      backend: "file-native",
      ...(this.migratedFromSqlite && { migratedFromSqlite: this.migratedFromSqlite }),
      ...(this.legacyRepair && { legacyRepair: this.legacyRepair }),
      tables,
    };
    atomicWriteFile(manifestPath(this.rootDir), JSON.stringify(manifest, null, 2));
  }

  private installAutosave() {
    this.safetyTimer = setInterval(() => {
      void this.flush();
    }, SAFETY_SAVE_MS);
    this.safetyTimer.unref();

    this.beforeExitHandler = () => {
      void this.flush();
    };
    process.on("beforeExit", this.beforeExitHandler);
  }
}

class SelectQuery implements SelectQueryBuilder {
  private joins: JoinSpec[] = [];
  private condition: Condition;
  private orderings: Ordering[] = [];
  private rowLimit: number | null = null;
  private rowOffset = 0;

  constructor(
    private readonly store: FileTableStore,
    private readonly fromMeta: TableMeta,
    private readonly projection?: Projection,
  ) {}

  innerJoin(table: Table, condition: Condition) {
    this.joins.push({ table: getMeta(table), condition });
    return this;
  }

  where(condition: Condition) {
    this.condition = condition;
    return this;
  }

  orderBy(...orderings: Ordering[]) {
    this.orderings = orderings;
    return this;
  }

  limit(limit: number) {
    this.rowLimit = limit;
    return this;
  }

  offset(offset: number) {
    this.rowOffset = offset;
    return this;
  }

  async run() {
    let contexts = this.store
      .rows(this.fromMeta.name)
      .map((row, index) => this.store.contextForRow(this.fromMeta, row, index));

    for (const join of this.joins) {
      const joinedContexts: RowContext[] = [];
      const joinRows = this.store.rows(join.table.name);
      for (const ctx of contexts) {
        joinRows.forEach((row, index) => {
          const candidate: RowContext = {
            rows: { ...ctx.rows, [join.table.name]: row },
            rowids: { ...ctx.rowids, [join.table.name]: index + 1 },
            baseTable: ctx.baseTable,
            joined: true,
          };
          if (evaluateCondition(join.condition, candidate)) {
            joinedContexts.push(candidate);
          }
        });
      }
      contexts = joinedContexts;
    }

    contexts = contexts.filter((ctx) => evaluateCondition(this.condition, ctx));

    if (this.orderings.length > 0) {
      contexts = [...contexts].sort((left, right) => {
        for (const ordering of this.orderings) {
          const leftSpec = orderSpec(ordering, left);
          const rightSpec = orderSpec(ordering, right);
          const comparison = compareValues(leftSpec.value, rightSpec.value);
          if (comparison !== 0) return leftSpec.direction === "desc" ? -comparison : comparison;
        }
        return 0;
      });
    }

    if (this.rowOffset > 0) contexts = contexts.slice(this.rowOffset);
    if (this.rowLimit !== null) contexts = contexts.slice(0, this.rowLimit);
    return contexts.map((ctx) => projectRow(ctx, this.projection));
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export async function createFileNativeDB(legacyDbPaths: string[] = []): Promise<FileNativeDB> {
  const rootDir = getFileStorageDir();
  const store = new FileTableStore(rootDir, legacyDbPaths);
  await store.initialize();

  const controller: FileNativeStoreController = {
    rootDir,
    flush: () => store.flush(true),
    close: () => store.close(),
  };

  return {
    select: (projection) => store.select(projection),
    insert: (table) => store.insert(table),
    update: (table) => store.update(table),
    delete: (table) => store.delete(table),
    run: () => store.run(),
    all: <T = unknown>() => store.all<T>(),
    _fileStore: controller,
  };
}
