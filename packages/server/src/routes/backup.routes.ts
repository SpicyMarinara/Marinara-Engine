// ──────────────────────────────────────────────
// Routes: Backup
// ──────────────────────────────────────────────
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { basename, dirname, join, relative } from "path";
import { createReadStream, createWriteStream, existsSync, readdirSync, statSync } from "fs";
import type { WriteStream } from "fs";
import { cp, mkdir, copyFile, readFile, readdir, writeFile, stat, mkdtemp, rm, open } from "fs/promises";
import type { FileHandle } from "fs/promises";
import { tmpdir } from "os";
import { pipeline } from "stream/promises";
import { inflateRawSync } from "zlib";
import AdmZip from "adm-zip";
import { FILE_BACKED_TABLES } from "../db/file-backed-store.js";
import * as schema from "../db/schema/index.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createLorebooksStorage } from "../services/storage/lorebooks.storage.js";
import { createPromptsStorage } from "../services/storage/prompts.storage.js";
import { createAgentsStorage } from "../services/storage/agents.storage.js";
import { createThemesStorage } from "../services/storage/themes.storage.js";
import type { ExportEnvelope } from "@marinara-engine/shared";
import { getDataDir } from "../utils/data-dir.js";
import { getDatabaseFilePath, getFileStorageDir } from "../config/runtime-config.js";
import { normalizeTimestampOverrides } from "../services/import/import-timestamps.js";
import { flushDB } from "../db/connection.js";
import { requirePrivilegedAccess } from "../middleware/privileged-gate.js";
import { assertInsideDir } from "../utils/security.js";
import { logger } from "../lib/logger.js";

/** Directories inside DATA_DIR that should be included in every backup. */
const BACKUP_DIRS = ["storage", "avatars", "sprites", "backgrounds", "gallery", "fonts", "knowledge-sources"];
const PROFILE_ASSET_DIRS = BACKUP_DIRS.filter((dirName) => dirName !== "storage");
const PROFILE_IMPORT_BODY_LIMIT_BYTES = 256 * 1024 * 1024;
const PROFILE_IMPORT_ARCHIVE_LIMIT_BYTES = 1024 * 1024 * 1024;
const PROFILE_ARCHIVE_ENTRY_LIMIT_BYTES = 256 * 1024 * 1024;
const PROFILE_ARCHIVE_CENTRAL_DIRECTORY_LIMIT_BYTES = 64 * 1024 * 1024;
const PROFILE_ARCHIVE_TOTAL_UNCOMPRESSED_LIMIT_BYTES = 1024 * 1024 * 1024;
const PROFILE_EXPORT_JSON_TOO_LARGE_CODE = "PROFILE_EXPORT_JSON_TOO_LARGE";
const ZIP32_MAX_VALUE = 0xffffffff;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_EOCD_MIN_SIZE = 22;
const ZIP_EOCD_MAX_COMMENT_BYTES = 0xffff;
const ZIP_ENCRYPTED_FLAG = 0x0001;

type ExportFormat = "native" | "compatible" | "zip";
type ProfileTableSnapshots = Record<string, Array<Record<string, unknown>>>;
type ProfileFileAsset = { path: string; data?: string; size: number };
type ProfileStorageSnapshot = {
  version: 1;
  tables: ProfileTableSnapshots;
  files: ProfileFileAsset[];
};
type ProfileExportEnvelopeOptions = {
  includeFileStorage?: boolean;
  inlineFileData?: boolean;
  includeLegacyAvatarBase64?: boolean;
  inlineJsonBudget?: ProfileInlineJsonBudget;
};
type ProfileStorageSnapshotOptions = {
  inlineFileData?: boolean;
  inlineJsonBudget?: ProfileInlineJsonBudget;
};
type ProfileInlineJsonBudget = {
  limitBytes: number;
  estimatedBytes: number;
};
type ProfileAssetReader = (safePath: string) => Buffer | null | Promise<Buffer | null>;
type ProfileArchiveAssetIndex = Map<string, { entryName: string; expectedSize: number }>;
type ProfileImportWarning = { type: "missing_asset"; path: string; message: string };
type ProfileZipEntry = {
  entryName: string;
  isDirectory: boolean;
  header: {
    method: number;
    crc32: number;
    compressedSize: number;
    size: number;
    dataOffset: number;
  };
};
type ProfileZipArchive = {
  filePath: string;
  entries: ProfileZipEntry[];
  entriesByName: Map<string, ProfileZipEntry>;
};
type StoredZipEntrySource =
  | { entryName: string; data: Buffer; mtime?: Date }
  | { entryName: string; filePath: string; size: number; mtime?: Date };
type StoredZipEntryRecord = {
  entryName: string;
  crc32: number;
  size: number;
  localHeaderOffset: number;
  dosTime: number;
  dosDate: number;
};
type ProfileImportInput = {
  envelope: ExportEnvelope;
  readAsset?: ProfileAssetReader;
  warnings?: ProfileImportWarning[];
  cleanup?: () => Promise<void>;
};
type ProfileImportStats = {
  characters: number;
  personas: number;
  lorebooks: number;
  presets: number;
  agents: number;
  themes: number;
  chats?: number;
  messages?: number;
  connections?: number;
  files?: number;
  tables?: Record<string, number>;
};
type ProfileImportProgress = {
  phase: string;
  label: string;
  completedItems: number;
  totalItems: number;
  imported: ProfileImportStats;
};
type ProfileImportProgressReporter = (progress: ProfileImportProgress) => void;

class ProfileJsonTooLargeError extends Error {
  constructor(public estimatedBytes: number) {
    super("Profile export is too large for JSON");
  }
}

class ProfileArchiveTooLargeError extends Error {}

class ProfileImportRequestError extends Error {}

class ProfileImportArchiveTooLargeError extends ProfileImportRequestError {}

function sendProfileImportRequestError(reply: FastifyReply, err: ProfileImportRequestError) {
  const message = err.message || "Profile import file could not be read.";
  const statusCode = err instanceof ProfileImportArchiveTooLargeError ? 413 : 400;
  return reply.status(statusCode).send({ error: "Invalid profile export", message });
}

function resolveBackupDir(dataDir: string, dirName: string) {
  return dirName === "storage" ? getFileStorageDir() : join(dataDir, dirName);
}

function toSafeExportName(name: string, fallback: string) {
  const sanitized = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function stSelectiveLogic(value: unknown): number {
  return value === "or" ? 1 : value === "not" ? 2 : 0;
}

function stRole(value: unknown): number {
  return value === "user" ? 1 : value === "assistant" ? 2 : 0;
}

function buildCompatibleLorebookExport(lb: Record<string, any>) {
  const entries: Record<string, Record<string, unknown>> = {};
  (Array.isArray(lb.entries) ? lb.entries : []).forEach((entry: Record<string, unknown>, index: number) => {
    entries[String(index)] = {
      uid: index,
      key: asStringArray(entry.keys),
      keysecondary: asStringArray(entry.secondaryKeys),
      comment: String(entry.name ?? `Entry ${index + 1}`),
      content: String(entry.content ?? ""),
      disable: entry.enabled === false,
      constant: entry.constant === true,
      selective: entry.selective === true,
      selectiveLogic: stSelectiveLogic(entry.selectiveLogic),
      order: Number(entry.order ?? 100),
      position: Number(entry.position ?? 0),
      depth: Number(entry.depth ?? 4),
      probability: entry.probability ?? null,
      scanDepth: entry.scanDepth ?? null,
      matchWholeWords: entry.matchWholeWords === true,
      caseSensitive: entry.caseSensitive === true,
      role: stRole(entry.role),
      group: String(entry.group ?? ""),
      groupWeight: entry.groupWeight ?? null,
      sticky: entry.sticky ?? null,
      cooldown: entry.cooldown ?? null,
      delay: entry.delay ?? null,
    };
  });

  return {
    name: String(lb.name ?? "Lorebook"),
    characterId: lb.characterId ?? null,
    personaId: lb.personaId ?? null,
    chatId: lb.chatId ?? null,
    extensions: {
      marinara: {
        exportedAt: new Date().toISOString(),
        source: "Marinara Engine compatibility export",
      },
    },
    entries,
  };
}

async function buildCompatibleProfileZip(app: FastifyInstance) {
  const envelope = await buildProfileExportEnvelope(app, {
    includeFileStorage: false,
    includeLegacyAvatarBase64: false,
  });
  const data = envelope.data as Record<string, any>;
  const zip = new AdmZip();

  for (const [index, character] of (Array.isArray(data.characters) ? data.characters : []).entries()) {
    const charData = typeof character.data === "string" ? JSON.parse(character.data) : character.data;
    zip.addFile(
      `characters/${toSafeExportName(String(charData?.name ?? "character"), `character-${index + 1}`)}.json`,
      Buffer.from(JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: charData }, null, 2), "utf8"),
    );
  }

  for (const [index, persona] of (Array.isArray(data.personas) ? data.personas : []).entries()) {
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      avatarPath: _avatarPath,
      avatarBase64: _avatarBase64,
      isActive: _isActive,
      ...personaData
    } = persona as Record<string, unknown>;
    zip.addFile(
      `personas/${toSafeExportName(String(personaData.name ?? "persona"), `persona-${index + 1}`)}.json`,
      Buffer.from(JSON.stringify(personaData, null, 2), "utf8"),
    );
  }

  for (const [index, lorebook] of (Array.isArray(data.lorebooks) ? data.lorebooks : []).entries()) {
    zip.addFile(
      `lorebooks/${toSafeExportName(String(lorebook.name ?? "lorebook"), `lorebook-${index + 1}`)}.json`,
      Buffer.from(JSON.stringify(buildCompatibleLorebookExport(lorebook), null, 2), "utf8"),
    );
  }

  return zip;
}

function resolveAvatarWritePath(dataDir: string, avatarPath: unknown) {
  if (typeof avatarPath !== "string" || !avatarPath.trim()) return null;
  const filename = avatarPath.split("?")[0]?.split("/").filter(Boolean).pop();
  if (!filename) return null;
  return assertInsideDir(join(dataDir, "avatars"), join(dataDir, "avatars", filename));
}

function resolveProfileExportFilePath(dataDir: string, filePath: unknown) {
  if (typeof filePath !== "string" || !filePath.trim()) return null;
  const cleanPath = filePath.split("?")[0];
  if (!cleanPath) return null;
  try {
    return assertInsideDir(dataDir, join(dataDir, cleanPath));
  } catch {
    return null;
  }
}

function redactAgentSecrets(agent: any) {
  const SECRET_KEY_RE = /token|secret|password|api[_-]?key/i;

  const redactSettings = (settings: unknown): unknown => {
    if (Array.isArray(settings)) return settings.map(redactSettings);
    if (!settings || typeof settings !== "object") return settings;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings)) {
      if (SECRET_KEY_RE.test(key)) {
        out[key] = null;
      } else if (value && typeof value === "object") {
        out[key] = redactSettings(value);
      } else {
        out[key] = value;
      }
    }
    return out;
  };

  if (typeof agent.settings === "string") {
    try {
      return { ...agent, settings: redactSettings(JSON.parse(agent.settings)) };
    } catch {
      return { ...agent, settings: null };
    }
  }

  return { ...agent, settings: redactSettings(agent.settings) };
}

function symbolValue<T>(target: object, symbolName: string): T | undefined {
  const symbol = Object.getOwnPropertySymbols(target).find((entry) => String(entry) === symbolName);
  return symbol ? (target as Record<symbol, T>)[symbol] : undefined;
}

function isSchemaTable(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && symbolValue(value as object, "Symbol(drizzle:IsDrizzleTable)"));
}

function schemaTableName(table: Record<string, unknown>) {
  return symbolValue<string>(table, "Symbol(drizzle:Name)") ?? null;
}

const profileTableObjects = new Map<string, Record<string, unknown>>();
for (const candidate of Object.values(schema)) {
  if (!isSchemaTable(candidate)) continue;
  const tableName = schemaTableName(candidate);
  if (tableName && FILE_BACKED_TABLES.includes(tableName as (typeof FILE_BACKED_TABLES)[number])) {
    profileTableObjects.set(tableName, candidate);
  }
}

function sanitizeProfileTableRows(tableName: string, rows: Array<Record<string, unknown>>) {
  if (tableName === "api_connections") {
    return rows.map((row) => ({ ...row, apiKeyEncrypted: "" }));
  }
  if (tableName === "agent_configs") {
    return rows.map((row) => redactAgentSecrets(row));
  }
  return rows;
}

async function buildProfileTableSnapshot(app: FastifyInstance): Promise<ProfileTableSnapshots> {
  const tables: ProfileTableSnapshots = {};

  for (const tableName of FILE_BACKED_TABLES) {
    const table = profileTableObjects.get(tableName);
    if (!table) continue;
    const rows = (await app.db.select().from(table as any)) as Array<Record<string, unknown>>;
    tables[tableName] = sanitizeProfileTableRows(tableName, rows);
  }

  return tables;
}

function normalizeProfileAssetPath(pathValue: unknown) {
  if (typeof pathValue !== "string" || !pathValue.trim()) return null;
  if (pathValue.includes("\0")) return null;
  const parts = pathValue.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  if (!PROFILE_ASSET_DIRS.includes(parts[0]!)) return null;
  if (parts.some((part) => part === "." || part === ".." || part.includes(":"))) return null;
  return parts.join("/");
}

function profileArchiveSizeError(label: string, size: number, limit: number) {
  return `${label} is too large for profile ZIP import/export (${size} bytes, limit ${limit} bytes).`;
}

function getProfileAssetManifestSize(file: unknown, safePath: string) {
  const size = (file as { size?: unknown } | null)?.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new ProfileImportRequestError(`Profile archive asset ${safePath} has an invalid size manifest.`);
  }
  return size;
}

function assertProfileArchiveEntryLimit(label: string, size: number) {
  if (size > PROFILE_ARCHIVE_ENTRY_LIMIT_BYTES) {
    throw new ProfileImportRequestError(profileArchiveSizeError(label, size, PROFILE_ARCHIVE_ENTRY_LIMIT_BYTES));
  }
}

function assertProfileArchiveTotalLimit(total: number) {
  if (total > PROFILE_ARCHIVE_TOTAL_UNCOMPRESSED_LIMIT_BYTES) {
    throw new ProfileImportRequestError(
      profileArchiveSizeError("Profile archive restored assets", total, PROFILE_ARCHIVE_TOTAL_UNCOMPRESSED_LIMIT_BYTES),
    );
  }
}

function getZipEntryUncompressedSize(entry: ProfileZipEntry) {
  const size = entry.header.size;
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function getZipEntryCompressedSize(entry: ProfileZipEntry) {
  const size = entry.header.compressedSize;
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function estimateBase64Length(byteLength: number) {
  return Math.ceil(byteLength / 3) * 4;
}

function reserveInlineJsonBudget(budget: ProfileInlineJsonBudget | undefined, bytes: number) {
  if (!budget) return;
  budget.estimatedBytes += bytes;
  if (budget.estimatedBytes > budget.limitBytes) {
    throw new ProfileJsonTooLargeError(budget.estimatedBytes);
  }
}

async function readInlineBase64File(filePath: string, budget?: ProfileInlineJsonBudget) {
  const fileStat = await stat(filePath);
  reserveInlineJsonBudget(budget, estimateBase64Length(fileStat.size));
  const buffer = await readFile(filePath);
  return buffer.toString("base64");
}

async function collectProfileAssetFiles(
  dataDir: string,
  options: ProfileStorageSnapshotOptions = {},
): Promise<ProfileFileAsset[]> {
  const files: ProfileFileAsset[] = [];
  const inlineFileData = options.inlineFileData ?? true;

  for (const dirName of PROFILE_ASSET_DIRS) {
    const src = join(dataDir, dirName);
    if (!existsSync(src)) continue;
    const stack = [src];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const relPath = [dirName, relative(src, full)].filter(Boolean).join("/").split(/[\\/]/g).join("/");
        const safePath = normalizeProfileAssetPath(relPath);
        if (!safePath) continue;
        const fileStat = await stat(full);
        const asset: ProfileFileAsset = { path: safePath, size: fileStat.size };
        if (inlineFileData) {
          reserveInlineJsonBudget(options.inlineJsonBudget, estimateBase64Length(fileStat.size));
          const buffer = await readFile(full);
          asset.data = buffer.toString("base64");
        }
        files.push(asset);
      }
    }
  }

  return files;
}

async function buildProfileStorageSnapshot(
  app: FastifyInstance,
  options: ProfileStorageSnapshotOptions = {},
): Promise<ProfileStorageSnapshot> {
  return {
    version: 1,
    tables: await buildProfileTableSnapshot(app),
    files: await collectProfileAssetFiles(getDataDir(), options),
  };
}

function isProfileStorageSnapshot(value: unknown): value is ProfileStorageSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProfileStorageSnapshot>;
  return candidate.version === 1 && !!candidate.tables && typeof candidate.tables === "object";
}

function buildProfileImportStats(tableCounts: Record<string, number>, files: number) {
  return {
    characters: tableCounts.characters ?? 0,
    personas: tableCounts.personas ?? 0,
    lorebooks: tableCounts.lorebooks ?? 0,
    presets: tableCounts.prompt_presets ?? 0,
    agents: tableCounts.agent_configs ?? 0,
    themes: tableCounts.custom_themes ?? 0,
    chats: tableCounts.chats ?? 0,
    messages: tableCounts.messages ?? 0,
    connections: tableCounts.api_connections ?? 0,
    files,
    tables: tableCounts,
  };
}

function countProfileStorageSnapshotItems(snapshot: ProfileStorageSnapshot) {
  const tableRows = FILE_BACKED_TABLES.reduce((count, tableName) => {
    const rows = snapshot.tables[tableName];
    return count + (Array.isArray(rows) ? rows.length : 0);
  }, 0);
  return tableRows + (Array.isArray(snapshot.files) ? snapshot.files.length : 0);
}

function countLegacyProfileImportItems(data: Record<string, any>) {
  return ["characters", "personas", "lorebooks", "presets", "agents", "themes"].reduce((count, key) => {
    const value = data[key];
    return count + (Array.isArray(value) ? value.length : 0);
  }, 0);
}

async function importProfileStorageSnapshot(
  app: FastifyInstance,
  snapshot: ProfileStorageSnapshot,
  onProgress?: ProfileImportProgressReporter,
  readAsset?: ProfileAssetReader,
) {
  const totalItems = Math.max(1, countProfileStorageSnapshotItems(snapshot));
  let completedItems = 0;
  const tableCounts: Record<string, number> = {};

  const emit = (phase: string, label: string, files = 0) => {
    onProgress?.({
      phase,
      label,
      completedItems,
      totalItems,
      imported: buildProfileImportStats(tableCounts, files),
    });
  };

  for (const tableName of FILE_BACKED_TABLES) {
    const table = profileTableObjects.get(tableName);
    const rows = snapshot.tables[tableName];
    if (!table || !Array.isArray(rows) || rows.length === 0) {
      tableCounts[tableName] = 0;
      continue;
    }

    emit("tables", `Importing ${tableName.replace(/_/g, " ")}`);
    const primaryKey = (table as Record<string, unknown>).id;
    for (const row of rows) {
      const cleanRow = { ...row };
      if (tableName === "api_connections") cleanRow.apiKeyEncrypted = "";
      const insert = app.db.insert(table as any).values(cleanRow as any) as any;
      if (primaryKey) {
        await insert.onConflictDoUpdate({ target: primaryKey, set: cleanRow });
      } else {
        await insert;
      }
      completedItems++;
      tableCounts[tableName] = (tableCounts[tableName] ?? 0) + 1;
      emit("tables", `Importing ${tableName.replace(/_/g, " ")}`);
    }
  }

  let files = 0;
  let restoredFileBytes = 0;
  if (Array.isArray(snapshot.files)) {
    for (const file of snapshot.files) {
      const safePath = normalizeProfileAssetPath(file?.path);
      if (!safePath) continue;
      const expectedSize = getProfileAssetManifestSize(file, safePath);
      assertProfileArchiveEntryLimit(safePath, expectedSize);
      const buffer =
        typeof file.data === "string" ? Buffer.from(file.data, "base64") : readAsset ? await readAsset(safePath) : null;
      if (!buffer) continue;
      restoredFileBytes += expectedSize;
      assertProfileArchiveTotalLimit(restoredFileBytes);
      if (buffer.length !== expectedSize) {
        throw new ProfileImportRequestError(`Profile asset ${safePath} does not match its manifest size.`);
      }
      const outputPath = assertInsideDir(getDataDir(), join(getDataDir(), ...safePath.split("/")));
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, buffer);
      files++;
      completedItems++;
      emit("files", `Restoring ${safePath}`, files);
    }
  }

  await flushDB();
  return buildProfileImportStats(tableCounts, files);
}

async function buildProfileExportEnvelope(
  app: FastifyInstance,
  options: ProfileExportEnvelopeOptions = {},
): Promise<ExportEnvelope> {
  const includeFileStorage = options.includeFileStorage ?? true;
  const inlineFileData = options.inlineFileData ?? true;
  const includeLegacyAvatarBase64 = options.includeLegacyAvatarBase64 ?? true;
  const inlineJsonBudget = options.inlineJsonBudget;
  const chars = createCharactersStorage(app.db);
  const lbs = createLorebooksStorage(app.db);
  const presets = createPromptsStorage(app.db);
  const agents = createAgentsStorage(app.db);
  const themes = createThemesStorage(app.db);
  const dataDir = getDataDir();

  const allChars = await chars.list();
  const characterExports = await Promise.all(
    allChars.map(async (c: any) => {
      let avatarBase64: string | null = null;
      const avatarPath = resolveProfileExportFilePath(dataDir, c.avatarPath);
      if (includeLegacyAvatarBase64 && avatarPath && existsSync(avatarPath)) {
        avatarBase64 = await readInlineBase64File(avatarPath, inlineJsonBudget);
      }
      return { ...c, avatarBase64 };
    }),
  );

  const allPersonaRows = await chars.listPersonas();
  const allPersonas = await Promise.all(
    (allPersonaRows as any[]).map(async (p: any) => {
      let avatarBase64: string | null = null;
      const avatarPath = resolveProfileExportFilePath(dataDir, p.avatarPath);
      if (includeLegacyAvatarBase64 && avatarPath && existsSync(avatarPath)) {
        avatarBase64 = await readInlineBase64File(avatarPath, inlineJsonBudget);
      }
      return { ...p, avatarBase64 };
    }),
  );

  const allLorebooks = await lbs.list();
  const lorebookExports = await Promise.all(
    (allLorebooks as any[]).map(async (lb: any) => {
      const folders = await lbs.listFolders(lb.id);
      const entries = await lbs.listEntries(lb.id);
      return { ...lb, folders, entries };
    }),
  );

  const allPresets = await presets.list();
  const presetExports = await Promise.all(
    (allPresets as any[]).map(async (p: any) => {
      const groups = await presets.listGroups(p.id);
      const sections = await presets.listSections(p.id);
      const choices = await presets.listChoiceBlocksForPreset(p.id);
      return { ...p, groups, sections, choices };
    }),
  );

  const allAgents = (await agents.list()).map(redactAgentSecrets);
  const allThemes = await themes.list();
  const data: Record<string, unknown> = {
    characters: characterExports,
    personas: allPersonas,
    lorebooks: lorebookExports,
    presets: presetExports,
    agents: allAgents,
    themes: allThemes,
  };
  if (includeFileStorage) {
    data.fileStorage = await buildProfileStorageSnapshot(app, { inlineFileData, inlineJsonBudget });
  }

  return {
    type: "marinara_profile",
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
}

function normalizeProfileArchiveEntryPath(entryName: string) {
  return entryName.replace(/\\/g, "/").replace(/^\/+/, "");
}

function profileArchiveBasePath(profileEntryName: string) {
  const normalized = normalizeProfileArchiveEntryPath(profileEntryName);
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : "";
}

function profileArchiveEntryPath(basePath: string, safePath: string) {
  return basePath ? `${basePath}/${safePath}` : safePath;
}

function getProfileStorageSnapshotFromEnvelope(envelope: ExportEnvelope) {
  const data = envelope.data as Record<string, unknown>;
  return isProfileStorageSnapshot(data.fileStorage) ? data.fileStorage : null;
}

async function collectProfileAssetZipSources(envelope: ExportEnvelope) {
  const snapshot = getProfileStorageSnapshotFromEnvelope(envelope);
  if (!snapshot || !Array.isArray(snapshot.files)) return [];

  const dataDir = getDataDir();
  const sources: StoredZipEntrySource[] = [];
  let totalUncompressedBytes = 0;
  const seenEntryNames = new Set<string>();

  for (const file of snapshot.files) {
    const safePath = normalizeProfileAssetPath(file.path);
    if (!safePath) continue;
    const inputPath = assertInsideDir(dataDir, join(dataDir, ...safePath.split("/")));
    if (!existsSync(inputPath)) continue;
    const fileStat = await stat(inputPath);
    if (!fileStat.isFile()) continue;
    if (fileStat.size !== file.size) {
      throw new Error(`Profile asset changed while exporting: ${safePath}`);
    }
    if (fileStat.size > PROFILE_ARCHIVE_ENTRY_LIMIT_BYTES) {
      throw new ProfileArchiveTooLargeError(
        profileArchiveSizeError(safePath, fileStat.size, PROFILE_ARCHIVE_ENTRY_LIMIT_BYTES),
      );
    }
    totalUncompressedBytes += fileStat.size;
    if (totalUncompressedBytes > PROFILE_ARCHIVE_TOTAL_UNCOMPRESSED_LIMIT_BYTES) {
      throw new ProfileArchiveTooLargeError(
        profileArchiveSizeError(
          "Profile ZIP assets",
          totalUncompressedBytes,
          PROFILE_ARCHIVE_TOTAL_UNCOMPRESSED_LIMIT_BYTES,
        ),
      );
    }
    if (seenEntryNames.has(safePath)) continue;
    seenEntryNames.add(safePath);
    sources.push({ entryName: safePath, filePath: inputPath, size: fileStat.size, mtime: fileStat.mtime });
  }

  return sources;
}

async function writeNativeProfileZip(app: FastifyInstance, outputPath: string) {
  const envelope = await buildProfileExportEnvelope(app, {
    inlineFileData: false,
    includeLegacyAvatarBase64: false,
  });
  const manifest = Buffer.from(JSON.stringify(envelope, null, 2), "utf8");
  if (manifest.length > PROFILE_IMPORT_BODY_LIMIT_BYTES) {
    throw new ProfileArchiveTooLargeError(
      profileArchiveSizeError("Profile ZIP manifest", manifest.length, PROFILE_IMPORT_BODY_LIMIT_BYTES),
    );
  }
  const assetSources = await collectProfileAssetZipSources(envelope);
  await writeStoredZipArchive(outputPath, [{ entryName: "marinara-profile.json", data: manifest }, ...assetSources]);
}

function cleanupTempDirAfterReply(reply: FastifyReply, dirPath: string) {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    void rm(dirPath, { recursive: true, force: true }).catch((err) => {
      logger.warn(err, "[backup] Failed to remove temporary profile ZIP");
    });
  };
  reply.raw.once("finish", cleanup);
  reply.raw.once("close", cleanup);
}

async function sendNativeProfileZipExport(app: FastifyInstance, reply: FastifyReply) {
  const tempDir = await mkdtemp(join(tmpdir(), "marinara-profile-export-"));
  const archivePath = join(tempDir, "marinara-profile.zip");
  try {
    await writeNativeProfileZip(app, archivePath);
    const archiveStat = await stat(archivePath);
    cleanupTempDirAfterReply(reply, tempDir);
    return reply
      .header("Content-Disposition", `attachment; filename="marinara-profile.zip"`)
      .header("Content-Type", "application/zip")
      .header("Content-Length", archiveStat.size.toString())
      .send(createReadStream(archivePath));
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

function getProfileJsonExportLimitBytes() {
  const configured = Number(process.env.PROFILE_EXPORT_JSON_LIMIT_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : PROFILE_IMPORT_BODY_LIMIT_BYTES;
}

function estimateJsonStringLength(value: unknown, seen = new WeakSet<object>()): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === "string") return value.length + 2;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  if (typeof value !== "object") return 2;

  if (seen.has(value)) return 2;
  seen.add(value);

  if (Array.isArray(value)) {
    return 2 + value.reduce((total, item) => total + estimateJsonStringLength(item, seen) + 1, 0);
  }

  return (
    2 +
    Object.entries(value).reduce(
      (total, [key, item]) => total + key.length + 3 + estimateJsonStringLength(item, seen) + 1,
      0,
    )
  );
}

function isJsonStringSizeError(err: unknown) {
  return (
    err instanceof RangeError &&
    /invalid string length|cannot create a string longer than|failed to allocate string/i.test(err.message)
  );
}

function sendProfileJsonTooLarge(reply: FastifyReply, estimatedBytes: number, limitBytes: number) {
  return reply.status(413).send({
    error: "Profile export is too large for JSON",
    code: PROFILE_EXPORT_JSON_TOO_LARGE_CODE,
    message: "This profile is too large for the JSON profile exporter. Export it as a profile ZIP instead.",
    fallbackFormat: "zip",
    estimatedBytes,
    limitBytes,
  });
}

async function sendNativeProfileJsonExport(app: FastifyInstance, reply: FastifyReply) {
  const limitBytes = getProfileJsonExportLimitBytes();
  const inlineJsonBudget: ProfileInlineJsonBudget = { limitBytes, estimatedBytes: 0 };
  let envelope: ExportEnvelope;
  try {
    envelope = await buildProfileExportEnvelope(app, {
      inlineFileData: true,
      includeLegacyAvatarBase64: true,
      inlineJsonBudget,
    });
  } catch (err) {
    if (err instanceof ProfileJsonTooLargeError) {
      return sendProfileJsonTooLarge(reply, err.estimatedBytes, limitBytes);
    }
    if (isJsonStringSizeError(err)) {
      return sendProfileJsonTooLarge(reply, inlineJsonBudget.estimatedBytes, limitBytes);
    }
    throw err;
  }
  const estimatedBytes = Math.ceil(estimateJsonStringLength(envelope) * 1.05);

  if (estimatedBytes > limitBytes) {
    return sendProfileJsonTooLarge(reply, estimatedBytes, limitBytes);
  }

  let body: string;
  try {
    body = JSON.stringify(envelope);
  } catch (err) {
    if (isJsonStringSizeError(err)) {
      return sendProfileJsonTooLarge(reply, estimatedBytes, limitBytes);
    }
    throw err;
  }

  const bodyBytes = Buffer.byteLength(body);
  if (bodyBytes > limitBytes) {
    return sendProfileJsonTooLarge(reply, bodyBytes, limitBytes);
  }

  return reply
    .header("Content-Type", "application/json; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="marinara-profile.json"`)
    .header("Content-Length", bodyBytes.toString())
    .send(body);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32State(state: number, chunk: Buffer | Uint8Array) {
  let crc = state >>> 0;
  for (const byte of chunk) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return crc >>> 0;
}

function finishCrc32(state: number) {
  return (state ^ 0xffffffff) >>> 0;
}

function crc32Buffer(buffer: Buffer) {
  return finishCrc32(updateCrc32State(0xffffffff, buffer));
}

async function crc32File(filePath: string) {
  let state = 0xffffffff;
  for await (const chunk of createReadStream(filePath)) {
    state = updateCrc32State(state, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return finishCrc32(state);
}

function getZipDosTimeDate(mtime?: Date) {
  const date = mtime ?? new Date();
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const month = Math.min(12, Math.max(1, date.getMonth() + 1));
  const day = Math.min(31, Math.max(1, date.getDate()));
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

function normalizeStoredZipEntryName(entryName: string) {
  const normalized = normalizeProfileArchiveEntryPath(entryName);
  const parts = normalized.split("/").filter(Boolean);
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.endsWith("/") ||
    parts.length === 0 ||
    parts.some((part) => part === "." || part === ".." || part.includes(":"))
  ) {
    throw new Error(`Invalid profile ZIP entry name: ${entryName}`);
  }
  return parts.join("/");
}

function assertZip32Value(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > ZIP32_MAX_VALUE) {
    throw new Error(`Profile ZIP ${label} exceeds the ZIP32 size limit.`);
  }
}

async function waitForWritableDrain(stream: WriteStream) {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.off("drain", onDrain);
      stream.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
  });
}

async function writeZipBuffer(stream: WriteStream, buffer: Buffer) {
  if (!stream.write(buffer)) {
    await waitForWritableDrain(stream);
  }
}

function buildLocalFileHeader(record: StoredZipEntryRecord) {
  const filename = Buffer.from(record.entryName, "utf8");
  if (filename.length > 0xffff) throw new Error(`Profile ZIP entry name is too long: ${record.entryName}`);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(record.dosTime, 10);
  header.writeUInt16LE(record.dosDate, 12);
  header.writeUInt32LE(record.crc32, 14);
  header.writeUInt32LE(record.size, 18);
  header.writeUInt32LE(record.size, 22);
  header.writeUInt16LE(filename.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, filename]);
}

function buildCentralDirectoryHeader(record: StoredZipEntryRecord) {
  const filename = Buffer.from(record.entryName, "utf8");
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(record.dosTime, 12);
  header.writeUInt16LE(record.dosDate, 14);
  header.writeUInt32LE(record.crc32, 16);
  header.writeUInt32LE(record.size, 20);
  header.writeUInt32LE(record.size, 24);
  header.writeUInt16LE(filename.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(record.localHeaderOffset, 42);
  return Buffer.concat([header, filename]);
}

function buildEndOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number) {
  if (entryCount > 0xffff) throw new Error("Profile ZIP contains too many entries.");
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entryCount, 8);
  header.writeUInt16LE(entryCount, 10);
  header.writeUInt32LE(centralDirectorySize, 12);
  header.writeUInt32LE(centralDirectoryOffset, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

async function writeStoredZipFileEntry(
  stream: WriteStream,
  source: StoredZipEntrySource,
  position: number,
): Promise<{ record: StoredZipEntryRecord; position: number }> {
  const entryName = normalizeStoredZipEntryName(source.entryName);
  const { dosTime, dosDate } = getZipDosTimeDate(source.mtime);
  const size = "data" in source ? source.data.length : source.size;
  assertZip32Value(size, `${entryName} size`);
  assertZip32Value(position, `${entryName} offset`);

  const crc32 = "data" in source ? crc32Buffer(source.data) : await crc32File(source.filePath);
  const record: StoredZipEntryRecord = {
    entryName,
    crc32,
    size,
    localHeaderOffset: position,
    dosTime,
    dosDate,
  };
  const header = buildLocalFileHeader(record);
  await writeZipBuffer(stream, header);
  position += header.length;

  if ("data" in source) {
    await writeZipBuffer(stream, source.data);
    position += source.data.length;
  } else {
    let written = 0;
    for await (const chunk of createReadStream(source.filePath)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      await writeZipBuffer(stream, buffer);
      written += buffer.length;
      position += buffer.length;
    }
    if (written !== source.size) {
      throw new Error(`Profile ZIP source changed while exporting: ${entryName}`);
    }
  }

  return { record, position };
}

async function finishZipStream(stream: WriteStream) {
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      stream.off("finish", onFinish);
      reject(err);
    };
    const onFinish = () => {
      stream.off("error", onError);
      resolve();
    };
    stream.once("error", onError);
    stream.once("finish", onFinish);
    stream.end();
  });
}

async function writeStoredZipArchive(outputPath: string, sources: StoredZipEntrySource[]) {
  const stream = createWriteStream(outputPath);
  const records: StoredZipEntryRecord[] = [];
  let position = 0;

  try {
    for (const source of sources) {
      const result = await writeStoredZipFileEntry(stream, source, position);
      records.push(result.record);
      position = result.position;
    }

    const centralDirectoryOffset = position;
    assertZip32Value(centralDirectoryOffset, "central directory offset");
    for (const record of records) {
      const header = buildCentralDirectoryHeader(record);
      await writeZipBuffer(stream, header);
      position += header.length;
    }
    const centralDirectorySize = position - centralDirectoryOffset;
    assertZip32Value(centralDirectorySize, "central directory size");
    const end = buildEndOfCentralDirectory(records.length, centralDirectorySize, centralDirectoryOffset);
    await writeZipBuffer(stream, end);
    await finishZipStream(stream);
  } catch (err) {
    stream.destroy();
    throw err;
  }
}

async function readProfileZipBytes(handle: FileHandle, buffer: Buffer, position: number, label: string) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (bytesRead === 0) {
      throw new ProfileImportRequestError(`Profile archive ${label} ended unexpectedly.`);
    }
    offset += bytesRead;
  }
}

async function readProfileArchiveFileRange(filePath: string, position: number, length: number, label: string) {
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(length) || length < 0) {
    throw new ProfileImportRequestError(`Profile archive ${label} has an invalid offset.`);
  }
  if (length > PROFILE_ARCHIVE_ENTRY_LIMIT_BYTES) {
    throw new ProfileImportRequestError(profileArchiveSizeError(label, length, PROFILE_ARCHIVE_ENTRY_LIMIT_BYTES));
  }
  const buffer = Buffer.alloc(length);
  if (length === 0) return buffer;
  const handle = await open(filePath, "r");
  try {
    await readProfileZipBytes(handle, buffer, position, label);
    return buffer;
  } finally {
    await handle.close();
  }
}

function findEndOfCentralDirectory(buffer: Buffer) {
  for (let offset = buffer.length - ZIP_EOCD_MIN_SIZE; offset >= 0; offset--) {
    if (buffer.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + ZIP_EOCD_MIN_SIZE + commentLength === buffer.length) return offset;
  }
  return -1;
}

function readZip32Value(buffer: Buffer, offset: number, label: string) {
  const value = buffer.readUInt32LE(offset);
  if (value === ZIP32_MAX_VALUE) {
    throw new ProfileImportRequestError(`Profile archive ${label} uses unsupported ZIP64 metadata.`);
  }
  return value;
}

async function readProfileZipArchive(filePath: string): Promise<ProfileZipArchive> {
  const archiveStat = await stat(filePath);
  if (archiveStat.size > PROFILE_IMPORT_ARCHIVE_LIMIT_BYTES) {
    throw new ProfileImportArchiveTooLargeError(
      profileArchiveSizeError("Profile archive", archiveStat.size, PROFILE_IMPORT_ARCHIVE_LIMIT_BYTES),
    );
  }
  if (archiveStat.size < ZIP_EOCD_MIN_SIZE) {
    throw new ProfileImportRequestError("Profile archive is not a valid ZIP file.");
  }

  const handle = await open(filePath, "r");
  try {
    const eocdSearchLength = Math.min(archiveStat.size, ZIP_EOCD_MIN_SIZE + ZIP_EOCD_MAX_COMMENT_BYTES);
    const eocdSearch = Buffer.alloc(eocdSearchLength);
    await readProfileZipBytes(handle, eocdSearch, archiveStat.size - eocdSearchLength, "end record");

    const eocdOffset = findEndOfCentralDirectory(eocdSearch);
    if (eocdOffset < 0) {
      throw new ProfileImportRequestError("Profile archive is missing a ZIP end record.");
    }

    const diskNumber = eocdSearch.readUInt16LE(eocdOffset + 4);
    const centralDirectoryDisk = eocdSearch.readUInt16LE(eocdOffset + 6);
    const entriesOnDisk = eocdSearch.readUInt16LE(eocdOffset + 8);
    const totalEntries = eocdSearch.readUInt16LE(eocdOffset + 10);
    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
      throw new ProfileImportRequestError("Profile archive split ZIP files are not supported.");
    }
    if (totalEntries === 0xffff) {
      throw new ProfileImportRequestError("Profile archive uses unsupported ZIP64 metadata.");
    }

    const centralDirectorySize = readZip32Value(eocdSearch, eocdOffset + 12, "central directory size");
    const centralDirectoryOffset = readZip32Value(eocdSearch, eocdOffset + 16, "central directory offset");
    if (centralDirectorySize > PROFILE_ARCHIVE_CENTRAL_DIRECTORY_LIMIT_BYTES) {
      throw new ProfileImportRequestError(
        profileArchiveSizeError(
          "Profile archive central directory",
          centralDirectorySize,
          PROFILE_ARCHIVE_CENTRAL_DIRECTORY_LIMIT_BYTES,
        ),
      );
    }
    if (centralDirectoryOffset + centralDirectorySize > archiveStat.size) {
      throw new ProfileImportRequestError("Profile archive central directory is outside the ZIP file.");
    }

    const centralDirectory = Buffer.alloc(centralDirectorySize);
    await readProfileZipBytes(handle, centralDirectory, centralDirectoryOffset, "central directory");

    const entries: ProfileZipEntry[] = [];
    const entriesByName = new Map<string, ProfileZipEntry>();
    let offset = 0;
    for (let index = 0; index < totalEntries; index++) {
      if (
        offset + 46 > centralDirectory.length ||
        centralDirectory.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE
      ) {
        throw new ProfileImportRequestError("Profile archive central directory is damaged.");
      }

      const flags = centralDirectory.readUInt16LE(offset + 8);
      if ((flags & ZIP_ENCRYPTED_FLAG) !== 0) {
        throw new ProfileImportRequestError("Profile archive encrypted ZIP entries are not supported.");
      }
      const method = centralDirectory.readUInt16LE(offset + 10);
      const crc32 = centralDirectory.readUInt32LE(offset + 16);
      const compressedSize = readZip32Value(centralDirectory, offset + 20, "entry compressed size");
      const size = readZip32Value(centralDirectory, offset + 24, "entry size");
      const fileNameLength = centralDirectory.readUInt16LE(offset + 28);
      const extraLength = centralDirectory.readUInt16LE(offset + 30);
      const commentLength = centralDirectory.readUInt16LE(offset + 32);
      const localHeaderOffset = readZip32Value(centralDirectory, offset + 42, "entry offset");
      const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
      if (nextOffset > centralDirectory.length) {
        throw new ProfileImportRequestError("Profile archive central directory entry is damaged.");
      }

      if (localHeaderOffset + 30 > archiveStat.size) {
        throw new ProfileImportRequestError("Profile archive entry points outside the ZIP file.");
      }
      const localHeader = Buffer.alloc(30);
      await readProfileZipBytes(handle, localHeader, localHeaderOffset, "local file header");
      if (localHeader.readUInt32LE(0) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
        throw new ProfileImportRequestError("Profile archive local file header is damaged.");
      }
      const localFileNameLength = localHeader.readUInt16LE(26);
      const localExtraLength = localHeader.readUInt16LE(28);
      const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      if (dataOffset + compressedSize > archiveStat.size) {
        throw new ProfileImportRequestError("Profile archive entry data is outside the ZIP file.");
      }

      const entryName = centralDirectory.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
      const normalizedName = normalizeProfileArchiveEntryPath(entryName);
      const entry: ProfileZipEntry = {
        entryName: normalizedName,
        isDirectory: normalizedName.endsWith("/"),
        header: { method, crc32, compressedSize, size, dataOffset },
      };
      entries.push(entry);
      if (normalizedName && !entriesByName.has(normalizedName)) entriesByName.set(normalizedName, entry);
      offset = nextOffset;
    }

    if (offset !== centralDirectory.length) {
      throw new ProfileImportRequestError("Profile archive central directory has unexpected trailing data.");
    }

    return { filePath, entries, entriesByName };
  } finally {
    await handle.close();
  }
}

function getProfileZipEntry(zip: ProfileZipArchive, entryName: string) {
  return zip.entriesByName.get(normalizeProfileArchiveEntryPath(entryName));
}

async function readProfileEnvelopeFromArchive(zip: ProfileZipArchive) {
  const profileEntry =
    zip.entries.find((entry) => !entry.isDirectory && entry.entryName === "marinara-profile.json") ??
    zip.entries.find((entry) => !entry.isDirectory && entry.entryName.endsWith("/marinara-profile.json"));

  if (!profileEntry) {
    throw new ProfileImportRequestError("Profile archive is missing marinara-profile.json.");
  }

  try {
    const profileEntrySize = getZipEntryUncompressedSize(profileEntry);
    if (profileEntrySize === null || profileEntrySize > PROFILE_IMPORT_BODY_LIMIT_BYTES) {
      throw new ProfileImportRequestError(
        profileArchiveSizeError(
          "Profile archive marinara-profile.json",
          profileEntrySize ?? -1,
          PROFILE_IMPORT_BODY_LIMIT_BYTES,
        ),
      );
    }
    const profileBuffer = await readProfileArchiveEntryBuffer(zip, profileEntry, profileEntrySize);
    return {
      envelope: JSON.parse(profileBuffer.toString("utf8")) as ExportEnvelope,
      basePath: profileArchiveBasePath(profileEntry.entryName),
    };
  } catch (err) {
    if (err instanceof ProfileImportRequestError) throw err;
    throw new ProfileImportRequestError("Profile archive contains an unreadable marinara-profile.json.");
  }
}

async function readProfileArchiveEntryBuffer(zip: ProfileZipArchive, entry: ProfileZipEntry, expectedSize: number) {
  const compressedSize = getZipEntryCompressedSize(entry);
  const uncompressedSize = getZipEntryUncompressedSize(entry);
  if (compressedSize === null || uncompressedSize === null) {
    throw new ProfileImportRequestError(`Profile archive entry ${entry.entryName} has an invalid size header.`);
  }
  if (compressedSize > PROFILE_ARCHIVE_ENTRY_LIMIT_BYTES || uncompressedSize > PROFILE_ARCHIVE_ENTRY_LIMIT_BYTES) {
    throw new ProfileImportRequestError(
      profileArchiveSizeError(
        entry.entryName,
        Math.max(compressedSize, uncompressedSize),
        PROFILE_ARCHIVE_ENTRY_LIMIT_BYTES,
      ),
    );
  }
  if (uncompressedSize !== expectedSize) {
    throw new ProfileImportRequestError(`Profile archive entry ${entry.entryName} does not match its manifest size.`);
  }

  const compressed = await readProfileArchiveFileRange(
    zip.filePath,
    entry.header.dataOffset,
    compressedSize,
    entry.entryName,
  );
  let data: Buffer;
  if (entry.header.method === 0) {
    data = compressed;
  } else if (entry.header.method === 8) {
    try {
      data = inflateRawSync(compressed, { maxOutputLength: expectedSize });
    } catch {
      throw new ProfileImportRequestError(`Profile archive entry ${entry.entryName} could not be decompressed.`);
    }
  } else {
    throw new ProfileImportRequestError(`Profile archive entry ${entry.entryName} uses an unsupported ZIP method.`);
  }
  if (data.length !== expectedSize) {
    throw new ProfileImportRequestError(`Profile archive entry ${entry.entryName} does not match its manifest size.`);
  }
  if (crc32Buffer(data) !== entry.header.crc32) {
    throw new ProfileImportRequestError(`Profile archive entry ${entry.entryName} failed CRC check.`);
  }
  return data;
}

function validateProfileArchiveAssets(
  zip: ProfileZipArchive,
  basePath: string,
  envelope: ExportEnvelope,
  warnings: ProfileImportWarning[],
) {
  const snapshot = getProfileStorageSnapshotFromEnvelope(envelope);
  const assets: ProfileArchiveAssetIndex = new Map();
  if (!snapshot || !Array.isArray(snapshot.files)) return assets;

  let totalUncompressedBytes = 0;
  for (const file of snapshot.files) {
    if (typeof file?.data === "string") continue;
    const safePath = normalizeProfileAssetPath(file?.path);
    if (!safePath) continue;
    const entryName = profileArchiveEntryPath(basePath, safePath);
    const expectedSize = getProfileAssetManifestSize(file, safePath);
    assertProfileArchiveEntryLimit(safePath, expectedSize);
    const entry = getProfileZipEntry(zip, entryName);
    if (!entry || entry.isDirectory) {
      warnings.push({
        type: "missing_asset",
        path: safePath,
        message: `Profile archive is missing ${safePath}. Imported the rest of the profile without that asset.`,
      });
      continue;
    }
    const entrySize = getZipEntryUncompressedSize(entry);
    if (entrySize === null || entrySize !== expectedSize) {
      throw new ProfileImportRequestError(`Profile archive asset ${safePath} does not match its manifest size.`);
    }
    const compressedSize = getZipEntryCompressedSize(entry);
    if (compressedSize === null || compressedSize > PROFILE_ARCHIVE_ENTRY_LIMIT_BYTES) {
      throw new ProfileImportRequestError(
        profileArchiveSizeError(safePath, compressedSize ?? -1, PROFILE_ARCHIVE_ENTRY_LIMIT_BYTES),
      );
    }
    totalUncompressedBytes += expectedSize;
    assertProfileArchiveTotalLimit(totalUncompressedBytes);
    assets.set(safePath, { entryName, expectedSize });
  }
  return assets;
}

async function readProfileArchiveAsset(
  zip: ProfileZipArchive,
  archiveAssets: ProfileArchiveAssetIndex,
  safePath: string,
) {
  const normalized = normalizeProfileAssetPath(safePath);
  if (!normalized) return null;
  const asset = archiveAssets.get(normalized);
  if (!asset) return null;
  const entry = getProfileZipEntry(zip, asset.entryName);
  if (!entry || entry.isDirectory) return null;
  return readProfileArchiveEntryBuffer(zip, entry, asset.expectedSize);
}

async function readProfileImportRequest(req: FastifyRequest): Promise<ProfileImportInput> {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    return { envelope: req.body as ExportEnvelope };
  }

  const uploadDir = await mkdtemp(join(tmpdir(), "marinara-profile-import-"));
  const archivePath = join(uploadDir, "profile.zip");
  try {
    const file = await req.file({ limits: { fileSize: PROFILE_IMPORT_ARCHIVE_LIMIT_BYTES } });
    if (!file) throw new ProfileImportRequestError("No profile archive uploaded.");
    const fileStream = file.file as typeof file.file & { truncated?: boolean };
    await pipeline(fileStream, createWriteStream(archivePath));
    if (fileStream.truncated) {
      throw new ProfileImportArchiveTooLargeError(
        profileArchiveSizeError(
          "Profile archive",
          PROFILE_IMPORT_ARCHIVE_LIMIT_BYTES + 1,
          PROFILE_IMPORT_ARCHIVE_LIMIT_BYTES,
        ),
      );
    }
    const zip = await readProfileZipArchive(archivePath);
    const { envelope, basePath } = await readProfileEnvelopeFromArchive(zip);
    const warnings: ProfileImportWarning[] = [];
    const archiveAssets = validateProfileArchiveAssets(zip, basePath, envelope, warnings);
    return {
      envelope,
      readAsset: (safePath) => readProfileArchiveAsset(zip, archiveAssets, safePath),
      warnings,
      cleanup: () => rm(uploadDir, { recursive: true, force: true }),
    };
  } catch (err) {
    await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
      throw new ProfileImportArchiveTooLargeError(
        profileArchiveSizeError(
          "Profile archive",
          PROFILE_IMPORT_ARCHIVE_LIMIT_BYTES + 1,
          PROFILE_IMPORT_ARCHIVE_LIMIT_BYTES,
        ),
      );
    }
    if (err instanceof ProfileImportRequestError) throw err;
    throw new ProfileImportRequestError(getBackupErrorMessage(err, "Profile archive could not be read."));
  }
}

function buildBackupRestoreNotes() {
  return [
    "Marinara Engine backup",
    "",
    "This archive contains a raw filesystem backup for manual recovery.",
    "",
    "For one-click import inside Marinara:",
    "1. Open Settings -> Import.",
    "2. Use Import Profile and select the downloaded backup zip archive.",
    "3. If this backup has been extracted, marinara-profile.json restores data without asset files.",
    "",
    "The .marinara.json importer is for individual characters, personas, lorebooks, and presets.",
  ].join("\n");
}

function getBackupErrorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

function sendBackupRouteError(reply: FastifyReply, err: unknown, operation: string) {
  const message = getBackupErrorMessage(err, `${operation} failed. Check the server logs for details.`);
  const logError = err instanceof Error ? err : new Error(message);
  logger.error(logError, "[backup] %s failed", operation);
  return reply.status(500).send({
    error: `${operation} failed`,
    message,
  });
}

export async function backupRoutes(app: FastifyInstance) {
  // Create a full backup folder
  app.post("/", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Backup creation" })) return;
    try {
      await flushDB();
      const dataDir = getDataDir();
      const dbPath = getDatabaseFilePath();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
      const backupName = `marinara-backup-${timestamp}`;
      const backupsRoot = join(dataDir, "backups");
      const backupDir = join(backupsRoot, backupName);

      await mkdir(backupDir, { recursive: true });
      const profileEnvelope = await buildProfileExportEnvelope(app, {
        inlineFileData: false,
        includeLegacyAvatarBase64: false,
      });
      await writeFile(join(backupDir, "marinara-profile.json"), JSON.stringify(profileEnvelope, null, 2), "utf8");
      await writeFile(join(backupDir, "RESTORE.txt"), buildBackupRestoreNotes(), "utf8");

      // 1. Copy the database file (respects DATABASE_URL)
      if (dbPath && existsSync(dbPath)) {
        const dbName = basename(dbPath);
        await copyFile(dbPath, join(backupDir, dbName));
        // Also copy WAL/SHM if they exist (for a complete backup)
        for (const ext of ["-wal", "-shm"]) {
          const walSrc = dbPath + ext;
          if (existsSync(walSrc)) {
            await copyFile(walSrc, join(backupDir, dbName + ext));
          }
        }
      }

      // 2. Copy data directories
      for (const dirName of BACKUP_DIRS) {
        const src = resolveBackupDir(dataDir, dirName);
        if (existsSync(src)) {
          await cp(src, join(backupDir, dirName), { recursive: true });
        }
      }

      return reply.send({
        success: true,
        backupName,
      });
    } catch (err) {
      return sendBackupRouteError(reply, err, "Backup creation");
    }
  });

  // Download a full backup as a single zip — client-side saves to a
  // user-chosen location via the browser's Save dialog / File System Access
  // API. Preferred on Android where the on-disk data folder isn't reachable.
  app.post("/download", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Backup download" })) return;
    try {
      await flushDB();
      const dataDir = getDataDir();
      const dbPath = getDatabaseFilePath();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
      const backupName = `marinara-backup-${timestamp}`;

      const zip = new AdmZip();
      const profileEnvelope = await buildProfileExportEnvelope(app, {
        inlineFileData: false,
        includeLegacyAvatarBase64: false,
      });
      zip.addFile(`${backupName}/marinara-profile.json`, Buffer.from(JSON.stringify(profileEnvelope, null, 2), "utf8"));
      zip.addFile(`${backupName}/RESTORE.txt`, Buffer.from(buildBackupRestoreNotes(), "utf8"));

      // 1. Add the database file (and WAL/SHM if present)
      if (dbPath && existsSync(dbPath)) {
        const dbName = basename(dbPath);
        zip.addFile(`${backupName}/${dbName}`, await readFile(dbPath));
        for (const ext of ["-wal", "-shm"]) {
          const walSrc = dbPath + ext;
          if (existsSync(walSrc)) {
            zip.addFile(`${backupName}/${dbName}${ext}`, await readFile(walSrc));
          }
        }
      }

      // 2. Recursively add each data directory under backupName/<dir>/...
      for (const dirName of BACKUP_DIRS) {
        const src = resolveBackupDir(dataDir, dirName);
        if (!existsSync(src)) continue;
        const stack: string[] = [src];
        while (stack.length > 0) {
          const current = stack.pop()!;
          for (const entry of readdirSync(current)) {
            const full = join(current, entry);
            const st = statSync(full);
            if (st.isDirectory()) {
              stack.push(full);
            } else if (st.isFile()) {
              const rel = [dirName, relative(src, full)].filter(Boolean).join("/").split(/[\\/]/g).join("/");
              zip.addFile(`${backupName}/${rel}`, await readFile(full));
            }
          }
        }
      }

      const buf = zip.toBuffer();
      return reply
        .header("Content-Type", "application/zip")
        .header("Content-Disposition", `attachment; filename="${backupName}.zip"`)
        .header("Content-Length", buf.length.toString())
        .send(buf);
    } catch (err) {
      return sendBackupRouteError(reply, err, "Backup download");
    }
  });

  // List existing backups
  app.get("/", async () => {
    const backupsRoot = join(getDataDir(), "backups");
    if (!existsSync(backupsRoot)) return [];

    return readdirSync(backupsRoot)
      .filter((name) => {
        const p = join(backupsRoot, name);
        return statSync(p).isDirectory() && name.startsWith("marinara-backup-");
      })
      .map((name) => {
        const p = join(backupsRoot, name);
        const st = statSync(p);
        return { name, createdAt: st.birthtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  // Delete a backup
  app.delete<{ Params: { name: string } }>("/:name", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Backup deletion" })) return;
    const { name } = req.params;
    // Sanitize: only allow backup folder names
    if (!/^marinara-backup-[\w-]+$/.test(name)) {
      return reply.status(400).send({ error: "Invalid backup name" });
    }
    const backupsRoot = join(getDataDir(), "backups");
    const backupDir = join(backupsRoot, name);

    if (!existsSync(backupDir)) {
      return reply.status(404).send({ error: "Backup not found" });
    }

    // Remove recursively
    const { rm } = await import("fs/promises");
    await rm(backupDir, { recursive: true, force: true });

    return { success: true };
  });

  // ── Profile Export ──
  // Native keeps the original profile JSON shape; ZIP is offered when JSON gets too large.
  app.get<{ Querystring: { format?: ExportFormat } }>("/export-profile", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Profile export" })) return;

    try {
      if (req.query.format === "compatible") {
        const zip = await buildCompatibleProfileZip(app);
        const buffer = zip.toBuffer();
        return reply
          .header("Content-Type", "application/zip")
          .header("Content-Disposition", `attachment; filename="marinara-compatible-export.zip"`)
          .header("Content-Length", buffer.length.toString())
          .send(buffer);
      }

      if (req.query.format === "zip") {
        return await sendNativeProfileZipExport(app, reply);
      }

      return await sendNativeProfileJsonExport(app, reply);
    } catch (err) {
      if (err instanceof ProfileArchiveTooLargeError) {
        return reply.status(413).send({
          error: "Profile ZIP export is too large",
          message: err.message,
        });
      }
      return sendBackupRouteError(reply, err, "Profile export");
    }
  });

  // ── Profile Import ──
  // Accepts a profile JSON envelope or profile ZIP archive and creates all entities.
  app.post("/import-profile", { bodyLimit: PROFILE_IMPORT_BODY_LIMIT_BYTES }, async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Profile import" })) return;

    const wantsProgressStream = String(req.headers.accept ?? "").includes("text/event-stream");
    let importInput: ProfileImportInput;
    try {
      importInput = await readProfileImportRequest(req);
    } catch (err) {
      if (err instanceof ProfileImportRequestError) {
        return sendProfileImportRequestError(reply, err);
      }
      const message = err instanceof Error ? err.message : "Profile import file could not be read.";
      return reply.status(400).send({ error: "Invalid profile export", message });
    }

    try {
      const envelope = importInput.envelope;
      if (!envelope || envelope.type !== "marinara_profile" || envelope.version !== 1) {
        return reply.status(400).send({ error: "Invalid profile export" });
      }

      const data = envelope.data as Record<string, any>;
      const warnings = importInput.warnings ?? [];
      const totalItems = isProfileStorageSnapshot(data.fileStorage)
        ? Math.max(1, countProfileStorageSnapshotItems(data.fileStorage))
        : Math.max(1, countLegacyProfileImportItems(data));
      const sendEvent = (event: { type: string; data?: unknown; [key: string]: unknown }) => {
        if (wantsProgressStream && !reply.raw.destroyed) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      };
      const sendProgress = (progress: ProfileImportProgress) => {
        sendEvent({ type: "progress", data: progress });
      };

      if (wantsProgressStream) {
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        sendEvent({
          type: "started",
          data: {
            label: "Profile import started",
            totalItems,
          },
        });
      }

      try {
        if (isProfileStorageSnapshot(data.fileStorage)) {
          const imported = await importProfileStorageSnapshot(
            app,
            data.fileStorage,
            wantsProgressStream ? sendProgress : undefined,
            importInput.readAsset,
          );
          const payload = { success: true, imported, warnings };
          if (wantsProgressStream) {
            sendEvent({ type: "done", data: payload });
            reply.raw.end();
            return;
          }
          return payload;
        }

        const chars = createCharactersStorage(app.db);
        const lbs = createLorebooksStorage(app.db);
        const presets = createPromptsStorage(app.db);
        const agents = createAgentsStorage(app.db);
        const themes = createThemesStorage(app.db);

        const stats = { characters: 0, personas: 0, lorebooks: 0, presets: 0, agents: 0, themes: 0 };
        let completedItems = 0;
        const emitLegacyProgress = (phase: string, label: string) => {
          if (!wantsProgressStream) return;
          sendProgress({
            phase,
            label,
            completedItems,
            totalItems,
            imported: { ...stats },
          });
        };

        // Import characters
        if (Array.isArray(data.characters)) {
          for (const c of data.characters) {
            try {
              emitLegacyProgress("characters", "Importing characters");
              const charData = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
              const result = await chars.create(
                charData,
                c.avatarPath ?? undefined,
                normalizeTimestampOverrides({ createdAt: c.createdAt, updatedAt: c.updatedAt }),
                typeof c.comment === "string" ? c.comment : undefined,
              );
              // Restore avatar from base64 if provided
              if (c.avatarBase64 && result?.avatarPath) {
                const dataDir = getDataDir();
                const avatarDir = join(dataDir, "avatars");
                await mkdir(avatarDir, { recursive: true });
                const { writeFile } = await import("fs/promises");
                const avatarFile = resolveAvatarWritePath(dataDir, result.avatarPath);
                if (avatarFile) {
                  await writeFile(avatarFile, Buffer.from(c.avatarBase64, "base64"));
                }
              }
              stats.characters++;
            } catch {
              /* skip failed entries */
            }
            completedItems++;
            emitLegacyProgress("characters", "Importing characters");
          }
        }

        // Import personas
        if (Array.isArray(data.personas)) {
          for (const p of data.personas) {
            try {
              emitLegacyProgress("personas", "Importing personas");
              // Restore persona avatar from base64 if provided
              let personaAvatarPath: string | undefined;
              if (p.avatarBase64) {
                const dataDir = getDataDir();
                const avatarDir = join(dataDir, "avatars");
                await mkdir(avatarDir, { recursive: true });
                const ext = ".png";
                const avatarName = `persona-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
                personaAvatarPath = `avatars/${avatarName}`;
                const { writeFile } = await import("fs/promises");
                await writeFile(join(dataDir, personaAvatarPath), Buffer.from(p.avatarBase64, "base64"));
              }
              await chars.createPersona(
                p.name,
                p.description ?? "",
                personaAvatarPath,
                {
                  comment: p.comment,
                  personality: p.personality,
                  backstory: p.backstory,
                  appearance: p.appearance,
                  scenario: p.scenario,
                  nameColor: p.nameColor,
                  dialogueColor: p.dialogueColor,
                  boxColor: p.boxColor,
                  trackerCardColors:
                    typeof p.trackerCardColors === "string"
                      ? p.trackerCardColors
                      : JSON.stringify(p.trackerCardColors ?? { mode: "chat" }),
                  personaStats: p.personaStats,
                  altDescriptions:
                    typeof p.altDescriptions === "string" ? p.altDescriptions : JSON.stringify(p.altDescriptions ?? []),
                },
                normalizeTimestampOverrides({ createdAt: p.createdAt, updatedAt: p.updatedAt }),
              );
              stats.personas++;
            } catch {
              /* skip */
            }
            completedItems++;
            emitLegacyProgress("personas", "Importing personas");
          }
        }

        // Import lorebooks + entries
        if (Array.isArray(data.lorebooks)) {
          for (const lb of data.lorebooks) {
            try {
              emitLegacyProgress("lorebooks", "Importing lorebooks");
              const created = await lbs.create(
                {
                  name: lb.name,
                  description: lb.description ?? "",
                  category: lb.category ?? "uncategorized",
                  scanDepth: lb.scanDepth,
                  tokenBudget: lb.tokenBudget,
                  recursiveScanning: lb.recursiveScanning,
                  maxRecursionDepth: lb.maxRecursionDepth,
                  enabled: lb.enabled ?? true,
                  characterId: lb.characterId ?? null,
                  characterIds: Array.isArray(lb.characterIds)
                    ? lb.characterIds.filter((value: unknown): value is string => typeof value === "string")
                    : typeof lb.characterId === "string"
                      ? [lb.characterId]
                      : [],
                  personaId: lb.personaId ?? null,
                  personaIds: Array.isArray(lb.personaIds)
                    ? lb.personaIds.filter((value: unknown): value is string => typeof value === "string")
                    : typeof lb.personaId === "string"
                      ? [lb.personaId]
                      : [],
                  chatId: lb.chatId ?? null,
                  isGlobal: lb.isGlobal ?? false,
                  tags: Array.isArray(lb.tags) ? lb.tags : [],
                  generatedBy: lb.generatedBy ?? null,
                  sourceAgentId: lb.sourceAgentId ?? null,
                },
                normalizeTimestampOverrides({ createdAt: lb.createdAt, updatedAt: lb.updatedAt }),
              );
              const folderIdMap = new Map<string, string>();
              if (created && Array.isArray(lb.folders)) {
                for (const folder of lb.folders) {
                  const oldId = typeof folder.id === "string" ? folder.id : null;
                  const createdFolder = (await lbs.createFolder((created as any).id, {
                    name: folder.name ?? "Folder",
                    enabled: folder.enabled === "true" || folder.enabled === true,
                    parentFolderId: null,
                    order: folder.order ?? 0,
                  })) as { id?: string } | null;
                  if (oldId && createdFolder?.id) folderIdMap.set(oldId, createdFolder.id);
                }
              }
              if (created && Array.isArray(lb.entries)) {
                for (const entry of lb.entries) {
                  const folderId =
                    typeof entry.folderId === "string" && folderIdMap.has(entry.folderId)
                      ? folderIdMap.get(entry.folderId)
                      : null;
                  await lbs.createEntry({ ...entry, lorebookId: (created as any).id, folderId });
                }
              }
              stats.lorebooks++;
            } catch {
              /* skip */
            }
            completedItems++;
            emitLegacyProgress("lorebooks", "Importing lorebooks");
          }
        }

        // Import presets with full hierarchy (groups, sections, choice blocks)
        if (Array.isArray(data.presets)) {
          for (const p of data.presets) {
            try {
              emitLegacyProgress("presets", "Importing presets");
              const existing = await presets.getById(p.id);
              if (!existing) {
                const created = await presets.create(
                  {
                    name: `${p.name} (imported)`,
                    description: p.description ?? "",
                    parameters:
                      typeof p.parameters === "string"
                        ? JSON.parse(p.parameters)
                        : (p.parameters ?? p.generationParams),
                    variableGroups:
                      typeof p.variableGroups === "string" ? JSON.parse(p.variableGroups) : (p.variableGroups ?? []),
                    variableValues:
                      typeof p.variableValues === "string" ? JSON.parse(p.variableValues) : (p.variableValues ?? {}),
                  },
                  normalizeTimestampOverrides({ createdAt: p.createdAt, updatedAt: p.updatedAt }),
                );
                if (created) {
                  const newPresetId = (created as any).id;
                  // Map old group IDs → new group IDs for section groupId references
                  const groupIdMap = new Map<string, string>();

                  // Import groups — two passes to handle parent→child ordering
                  if (Array.isArray(p.groups)) {
                    // Pass 1: create all groups without parent references
                    for (const g of p.groups) {
                      try {
                        const newGroup = await presets.createGroup({
                          presetId: newPresetId,
                          name: g.name,
                          parentGroupId: null,
                          order: g.order ?? 100,
                          enabled: g.enabled === "true" || g.enabled === true,
                        });
                        if (newGroup) groupIdMap.set(g.id, (newGroup as any).id);
                      } catch {
                        /* skip individual group */
                      }
                    }
                    // Pass 2: fix parent references using the fully-populated map
                    for (const g of p.groups) {
                      if (g.parentGroupId && groupIdMap.has(g.id) && groupIdMap.has(g.parentGroupId)) {
                        try {
                          await presets.updateGroup(groupIdMap.get(g.id)!, {
                            parentGroupId: groupIdMap.get(g.parentGroupId)!,
                          });
                        } catch {
                          /* skip */
                        }
                      }
                    }
                  }

                  // Import sections
                  if (Array.isArray(p.sections)) {
                    for (const s of p.sections) {
                      try {
                        await presets.createSection({
                          presetId: newPresetId,
                          identifier: s.identifier,
                          name: s.name,
                          content: s.content ?? "",
                          role: s.role ?? "system",
                          enabled: s.enabled === "true" || s.enabled === true,
                          isMarker: s.isMarker === "true" || s.isMarker === true,
                          groupId: s.groupId ? (groupIdMap.get(s.groupId) ?? null) : null,
                          markerConfig:
                            typeof s.markerConfig === "string" ? JSON.parse(s.markerConfig) : (s.markerConfig ?? null),
                          injectionPosition: s.injectionPosition ?? "ordered",
                          injectionDepth: s.injectionDepth ?? 0,
                          injectionOrder: s.injectionOrder ?? 100,
                          forbidOverrides: s.forbidOverrides === "true" || s.forbidOverrides === true,
                        });
                      } catch {
                        /* skip individual section */
                      }
                    }
                  }

                  // Import choice blocks
                  if (Array.isArray(p.choices)) {
                    for (const cb of p.choices) {
                      try {
                        await presets.createChoiceBlock({
                          presetId: newPresetId,
                          variableName: cb.variableName,
                          question: cb.question,
                          options: typeof cb.options === "string" ? JSON.parse(cb.options) : (cb.options ?? []),
                          multiSelect: cb.multiSelect === "true" || cb.multiSelect === true,
                          separator: cb.separator ?? ", ",
                          randomPick: cb.randomPick === "true" || cb.randomPick === true,
                        });
                      } catch {
                        /* skip individual choice block */
                      }
                    }
                  }

                  stats.presets++;
                }
              }
            } catch {
              /* skip */
            }
            completedItems++;
            emitLegacyProgress("presets", "Importing presets");
          }
        }

        // Import agent configs
        if (Array.isArray(data.agents)) {
          for (const a of data.agents) {
            try {
              emitLegacyProgress("agents", "Importing agents");
              // Only import if this agent type doesn't already exist
              const existing = await agents.getByType(a.type);
              if (!existing) {
                await agents.create({
                  type: a.type,
                  name: a.name,
                  description: a.description ?? "",
                  phase: a.phase,
                  enabled: a.enabled === "true" || a.enabled === true,
                  connectionId: a.connectionId ?? null,
                  promptTemplate: a.promptTemplate ?? "",
                  settings: typeof a.settings === "string" ? JSON.parse(a.settings) : (a.settings ?? {}),
                });
                stats.agents++;
              }
            } catch {
              /* skip */
            }
            completedItems++;
            emitLegacyProgress("agents", "Importing agents");
          }
        }

        // Import synced custom themes
        let importedActiveThemeId: string | null = null;
        if (Array.isArray(data.themes)) {
          for (const theme of data.themes) {
            try {
              emitLegacyProgress("themes", "Importing themes");
              const duplicate = await themes.findDuplicate(theme.name ?? "", theme.css ?? "");
              const syncedTheme =
                duplicate ??
                (await themes.create({
                  name: theme.name ?? "Imported Theme",
                  css: theme.css ?? "",
                  installedAt: theme.installedAt,
                }));

              if (!duplicate && syncedTheme) {
                stats.themes++;
              }

              if (syncedTheme && (theme.isActive === true || theme.isActive === "true")) {
                importedActiveThemeId = syncedTheme.id;
              }
            } catch {
              /* skip */
            }
            completedItems++;
            emitLegacyProgress("themes", "Importing themes");
          }
        }

        if (importedActiveThemeId) {
          try {
            await themes.setActive(importedActiveThemeId);
          } catch {
            /* skip */
          }
        }

        const payload = { success: true, imported: stats, warnings };
        if (wantsProgressStream) {
          sendEvent({ type: "done", data: payload });
          reply.raw.end();
          return;
        }
        return payload;
      } catch (err) {
        if (wantsProgressStream) {
          const message = getBackupErrorMessage(err, "Profile import failed. Check the server logs for details.");
          if (!(err instanceof ProfileImportRequestError)) {
            const logError = err instanceof Error ? err : new Error(message);
            logger.error(logError, "[backup] Profile import failed");
          }
          sendEvent({
            type: "error",
            data: {
              error: err instanceof ProfileImportRequestError ? "Invalid profile export" : "Profile import failed",
              message,
            },
          });
          reply.raw.end();
          return;
        }
        if (err instanceof ProfileImportRequestError) {
          return sendProfileImportRequestError(reply, err);
        }
        return sendBackupRouteError(reply, err, "Profile import");
      }
    } finally {
      await importInput.cleanup?.();
    }
  });
}
