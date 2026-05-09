// ──────────────────────────────────────────────
// Routes: Backup
// ──────────────────────────────────────────────
import type { FastifyInstance, FastifyReply } from "fastify";
import { basename, join, relative } from "path";
import { existsSync, readdirSync, statSync } from "fs";
import { cp, mkdir, copyFile, readFile, writeFile } from "fs/promises";
import AdmZip from "adm-zip";
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
const PROFILE_IMPORT_BODY_LIMIT_BYTES = 256 * 1024 * 1024;

type ExportFormat = "native" | "compatible";

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
  const envelope = await buildProfileExportEnvelope(app);
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

async function buildProfileExportEnvelope(app: FastifyInstance): Promise<ExportEnvelope> {
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
      if (c.avatarPath && existsSync(join(dataDir, c.avatarPath))) {
        const buf = await readFile(join(dataDir, c.avatarPath));
        avatarBase64 = buf.toString("base64");
      }
      return { ...c, avatarBase64 };
    }),
  );

  const allPersonaRows = await chars.listPersonas();
  const allPersonas = await Promise.all(
    (allPersonaRows as any[]).map(async (p: any) => {
      let avatarBase64: string | null = null;
      if (p.avatarPath && existsSync(join(dataDir, p.avatarPath))) {
        const buf = await readFile(join(dataDir, p.avatarPath));
        avatarBase64 = buf.toString("base64");
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

  return {
    type: "marinara_profile",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      characters: characterExports,
      personas: allPersonas,
      lorebooks: lorebookExports,
      presets: presetExports,
      agents: allAgents,
      themes: allThemes,
    },
  };
}

function buildBackupRestoreNotes() {
  return [
    "Marinara Engine backup",
    "",
    "This archive contains a raw filesystem backup for manual recovery.",
    "",
    "For one-click import inside Marinara:",
    "1. Extract marinara-profile.json from this zip.",
    "2. Open Settings -> Import.",
    "3. Use Import Profile (JSON), not Import Marinara File (.marinara.json).",
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
      const profileEnvelope = await buildProfileExportEnvelope(app);
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
      const profileEnvelope = await buildProfileExportEnvelope(app);
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
  // Returns a portable JSON envelope with characters, personas, lorebooks,
  // presets (+ groups/sections/choices), agent configs, and synced custom themes.
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

      const envelope = await buildProfileExportEnvelope(app);

      return reply
        .header("Content-Disposition", `attachment; filename="marinara-profile.json"`)
        .header("Content-Type", "application/json")
        .send(envelope);
    } catch (err) {
      return sendBackupRouteError(reply, err, "Profile export");
    }
  });

  // ── Profile Import ──
  // Accepts a profile JSON envelope and creates all entities.
  app.post("/import-profile", { bodyLimit: PROFILE_IMPORT_BODY_LIMIT_BYTES }, async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Profile import" })) return;
    const envelope = req.body as ExportEnvelope;
    if (!envelope || envelope.type !== "marinara_profile" || envelope.version !== 1) {
      return reply.status(400).send({ error: "Invalid profile export" });
    }

    const data = envelope.data as Record<string, any>;
    const chars = createCharactersStorage(app.db);
    const lbs = createLorebooksStorage(app.db);
    const presets = createPromptsStorage(app.db);
    const agents = createAgentsStorage(app.db);
    const themes = createThemesStorage(app.db);

    const stats = { characters: 0, personas: 0, lorebooks: 0, presets: 0, agents: 0, themes: 0 };

    // Import characters
    if (Array.isArray(data.characters)) {
      for (const c of data.characters) {
        try {
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
      }
    }

    // Import personas
    if (Array.isArray(data.personas)) {
      for (const p of data.personas) {
        try {
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
      }
    }

    // Import lorebooks + entries
    if (Array.isArray(data.lorebooks)) {
      for (const lb of data.lorebooks) {
        try {
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
      }
    }

    // Import presets with full hierarchy (groups, sections, choice blocks)
    if (Array.isArray(data.presets)) {
      for (const p of data.presets) {
        try {
          const existing = await presets.getById(p.id);
          if (!existing) {
            const created = await presets.create(
              {
                name: `${p.name} (imported)`,
                description: p.description ?? "",
                parameters:
                  typeof p.parameters === "string" ? JSON.parse(p.parameters) : (p.parameters ?? p.generationParams),
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
      }
    }

    // Import agent configs
    if (Array.isArray(data.agents)) {
      for (const a of data.agents) {
        try {
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
      }
    }

    // Import synced custom themes
    let importedActiveThemeId: string | null = null;
    if (Array.isArray(data.themes)) {
      for (const theme of data.themes) {
        try {
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
      }
    }

    if (importedActiveThemeId) {
      try {
        await themes.setActive(importedActiveThemeId);
      } catch {
        /* skip */
      }
    }

    return { success: true, imported: stats };
  });
}
