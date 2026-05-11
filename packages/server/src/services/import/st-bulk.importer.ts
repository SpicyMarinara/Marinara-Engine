// ──────────────────────────────────────────────
// Importer: SillyTavern Bulk Import (folder scan)
// ──────────────────────────────────────────────
import { readdir, readFile, stat, copyFile, mkdir } from "fs/promises";
import { join, extname, basename, relative } from "path";
import { existsSync, readdirSync } from "fs";
import { randomUUID } from "crypto";
import type { DB } from "../../db/connection.js";
import {
  getExistingCharacterTagKeys,
  importSTCharacter,
  type STCharacterTagImportMode,
} from "./st-character.importer.js";
import { importSTChat } from "./st-chat.importer.js";
import { importSTPreset } from "./st-prompt.importer.js";
import { importSTLorebook } from "./st-lorebook.importer.js";
import { characters as charactersTable, personas as personasTable } from "../../db/schema/index.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { DATA_DIR } from "../../utils/data-dir.js";
import { getFileTimestampOverrides, parseTrustedTimestamp } from "./import-timestamps.js";

const BG_DIR = join(DATA_DIR, "backgrounds");
const BG_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);

// ─── Helpers ───

const CHARA_KEYWORDS = new Set(["ccv3", "chara"]);

/** Read PNG tEXt/iTXt chunks with keyword "ccv3" or "chara" → base64 JSON. Prefers ccv3 (V3). */
function extractCharaFromPng(buf: Buffer): Record<string, unknown> | null {
  // PNG signature: 8 bytes
  if (buf.length < 8) return null;
  const found = new Map<string, Record<string, unknown>>();
  let offset = 8; // skip signature

  while (offset < buf.length - 8) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const payload = buf.subarray(offset + 8, offset + 8 + length);

    if (type === "tEXt") {
      const nullIdx = payload.indexOf(0);
      if (nullIdx >= 0) {
        const keyword = payload.subarray(0, nullIdx).toString("ascii");
        if (CHARA_KEYWORDS.has(keyword) && !found.has(keyword)) {
          const b64 = payload.subarray(nullIdx + 1).toString("ascii");
          try {
            const json = Buffer.from(b64, "base64").toString("utf-8");
            found.set(keyword, JSON.parse(json));
          } catch {
            /* skip malformed */
          }
        }
      }
    } else if (type === "iTXt") {
      const nullIdx = payload.indexOf(0);
      if (nullIdx >= 0) {
        const keyword = payload.subarray(0, nullIdx).toString("ascii");
        if (CHARA_KEYWORDS.has(keyword) && !found.has(keyword)) {
          const compressionFlag = payload[nullIdx + 1];
          const langEnd = payload.indexOf(0, nullIdx + 3);
          if (langEnd >= 0) {
            const transEnd = payload.indexOf(0, langEnd + 1);
            if (transEnd >= 0 && compressionFlag === 0) {
              const text = payload.subarray(transEnd + 1).toString("utf-8");
              try {
                found.set(keyword, JSON.parse(text));
              } catch {
                try {
                  const decoded = Buffer.from(text, "base64").toString("utf-8");
                  found.set(keyword, JSON.parse(decoded));
                } catch {
                  /* skip */
                }
              }
            }
          }
        }
      }
    }

    // Move past length(4) + type(4) + data(length) + crc(4)
    offset += 12 + length;
    if (type === "IEND") break;
  }

  return found.get("ccv3") ?? found.get("chara") ?? null;
}

/** Try multiple possible ST data folder layouts */
function resolveSTDataDir(rootPath: string): string | null {
  // 1. Check data/default-user (most common)
  const defaultUser = join(rootPath, "data", "default-user");
  if (existsSync(join(defaultUser, "characters"))) return defaultUser;

  // 2. Check ALL user profile folders under data/ (ST allows custom profile names)
  const dataParent = join(rootPath, "data");
  if (existsSync(dataParent)) {
    try {
      const entries = readdirSync(dataParent, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const candidate = join(dataParent, e.name);
        if (existsSync(join(candidate, "characters"))) return candidate;
      }
    } catch {
      // skip if unreadable
    }
  }

  // 3. Legacy / alternative layouts
  if (existsSync(join(rootPath, "public", "characters"))) return join(rootPath, "public");
  if (existsSync(join(rootPath, "characters"))) return rootPath;

  return null;
}

async function listFiles(dir: string, ext?: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && (!ext || extname(e.name).toLowerCase() === ext))
    .map((e) => join(dir, e.name));
}

async function listFilesRecursive(dir: string, ext?: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...(await listFilesRecursive(full, ext)));
    } else if (!ext || extname(e.name).toLowerCase() === ext) {
      results.push(full);
    }
  }
  return results;
}

function makeScanItemId(category: string, dataDir: string, filePath: string) {
  return `${category}:${relative(dataDir, filePath).replace(/\\/g, "/")}`;
}

function isPlaceholderChatName(value: unknown) {
  if (typeof value !== "string") return true;
  const name = value.trim().toLowerCase();
  return !name || name === "unused" || name === "new chat";
}

function isConfidentBuiltinPreset(filePath: string) {
  const name = basename(filePath, extname(filePath)).trim().toLowerCase();
  return new Set([
    "default",
    "deterministic",
    "neutral",
    "universal-creative",
    "universal-light",
    "universal-super-creative",
  ]).has(name);
}

// ─── Scan ───

interface STBulkScanItemBase {
  id: string;
  path: string;
  name: string;
  modifiedAt: string | null;
}

export interface STBulkScanResult {
  success: boolean;
  error?: string;
  dataDir?: string;
  characters: Array<STBulkScanItemBase & { format: string }>;
  chats: Array<STBulkScanItemBase & { characterName: string; folderName: string; chatName: string }>;
  groupChats: Array<STBulkScanItemBase & { groupName: string; members: string[] }>;
  presets: Array<STBulkScanItemBase & { isBuiltin?: boolean }>;
  lorebooks: STBulkScanItemBase[];
  backgrounds: STBulkScanItemBase[];
  personas: Array<STBulkScanItemBase & { description: string }>;
}

export async function scanSTFolder(rootPath: string): Promise<STBulkScanResult> {
  // Validate
  if (!existsSync(rootPath)) {
    return {
      success: false,
      error: "Folder does not exist",
      characters: [],
      chats: [],
      groupChats: [],
      presets: [],
      lorebooks: [],
      backgrounds: [],
      personas: [],
    };
  }

  const dataDir = resolveSTDataDir(rootPath);
  if (!dataDir) {
    return {
      success: false,
      error:
        "Could not find SillyTavern data directory. Make sure the path points to your SillyTavern installation folder.",
      characters: [],
      chats: [],
      groupChats: [],
      presets: [],
      lorebooks: [],
      backgrounds: [],
      personas: [],
    };
  }

  const characters: STBulkScanResult["characters"] = [];
  const chats: STBulkScanResult["chats"] = [];
  const groupChats: STBulkScanResult["groupChats"] = [];
  const presets: STBulkScanResult["presets"] = [];
  const lorebooks: STBulkScanResult["lorebooks"] = [];
  const backgrounds: STBulkScanResult["backgrounds"] = [];
  const personas: STBulkScanResult["personas"] = [];

  // 1. Characters — JSON and PNG files in characters/
  const charDir = join(dataDir, "characters");
  if (existsSync(charDir)) {
    const entries = await readdir(charDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = extname(e.name).toLowerCase();
      const fullPath = join(charDir, e.name);

      if (ext === ".json") {
        try {
          const raw = JSON.parse(await readFile(fullPath, "utf-8"));
          const name = raw?.data?.name ?? raw?.char_name ?? raw?.name ?? basename(e.name, ".json");
          const fileInfo = await stat(fullPath);
          characters.push({
            id: makeScanItemId("characters", dataDir, fullPath),
            path: fullPath,
            name: String(name),
            format: "json",
            modifiedAt: parseTrustedTimestamp(fileInfo.mtime),
          });
        } catch {
          // skip
        }
      } else if (ext === ".png") {
        try {
          const buf = await readFile(fullPath);
          const card = extractCharaFromPng(buf);
          if (card) {
            const d = card.data as Record<string, unknown> | undefined;
            const name = d?.name ?? card.char_name ?? card.name ?? basename(e.name, ".png");
            const fileInfo = await stat(fullPath);
            characters.push({
              id: makeScanItemId("characters", dataDir, fullPath),
              path: fullPath,
              name: String(name),
              format: "png",
              modifiedAt: parseTrustedTimestamp(fileInfo.mtime),
            });
          }
        } catch {
          // skip
        }
      }
    }
  }

  // 2. Chats — JSONL files in chats/<character_name>/ subfolders
  const chatsDir = join(dataDir, "chats");
  if (existsSync(chatsDir)) {
    const jsonlFiles = await listFilesRecursive(chatsDir, ".jsonl");
    for (const f of jsonlFiles) {
      try {
        const content = await readFile(f, "utf-8");
        const firstLine = content.split("\n")[0];
        if (firstLine) {
          const header = JSON.parse(firstLine);
          const fileBaseName = basename(f, ".jsonl");
          const folderName = basename(join(f, ".."));
          const charName = isPlaceholderChatName(header.character_name) ? folderName : String(header.character_name);
          const fileInfo = await stat(f);
          chats.push({
            id: makeScanItemId("chats", dataDir, f),
            path: f,
            name: fileBaseName,
            chatName: fileBaseName,
            characterName: String(charName),
            folderName,
            modifiedAt: parseTrustedTimestamp(fileInfo.mtime),
          });
        }
      } catch {
        // skip
      }
    }
  }

  // 3. Presets — JSON files in TextGen Settings/ and OpenAI Settings/
  for (const folder of ["TextGen Settings", "OpenAI Settings", "textgen settings", "openai settings"]) {
    const presetDir = join(dataDir, folder);
    const files = await listFiles(presetDir, ".json");
    for (const f of files) {
      try {
        const raw = JSON.parse(await readFile(f, "utf-8"));
        const name = raw.name ?? basename(f, ".json");
        const fileInfo = await stat(f);
        presets.push({
          id: makeScanItemId("presets", dataDir, f),
          path: f,
          name: String(name),
          modifiedAt: parseTrustedTimestamp(fileInfo.mtime),
          ...(isConfidentBuiltinPreset(f) ? { isBuiltin: true } : {}),
        });
      } catch {
        // skip
      }
    }
  }

  // 4. Lorebooks / World Info — JSON files in worlds/
  const worldsDir = join(dataDir, "worlds");
  if (existsSync(worldsDir)) {
    const files = await listFiles(worldsDir, ".json");
    for (const f of files) {
      try {
        const raw = JSON.parse(await readFile(f, "utf-8"));
        const name = raw.name ?? basename(f, ".json");
        const fileInfo = await stat(f);
        lorebooks.push({
          id: makeScanItemId("lorebooks", dataDir, f),
          path: f,
          name: String(name),
          modifiedAt: parseTrustedTimestamp(fileInfo.mtime),
        });
      } catch {
        // skip
      }
    }
  }

  // 5. Backgrounds — image files in backgrounds/
  for (const folder of ["backgrounds", "Backgrounds"]) {
    const bgDir = join(dataDir, folder);
    if (!existsSync(bgDir)) continue;
    const entries = await readdir(bgDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = extname(e.name).toLowerCase();
      if (BG_EXTS.has(ext)) {
        const fullPath = join(bgDir, e.name);
        const fileInfo = await stat(fullPath);
        backgrounds.push({
          id: makeScanItemId("backgrounds", dataDir, fullPath),
          path: fullPath,
          name: e.name,
          modifiedAt: parseTrustedTimestamp(fileInfo.mtime),
        });
      }
    }
    break; // only use the first matching folder
  }

  // 6. Group chats — groups/ (metadata) + group chats/ (JSONL files)
  const groupsDir = join(dataDir, "groups");
  const groupChatsDir = join(dataDir, "group chats");
  if (existsSync(groupsDir)) {
    // Build map: groupId → group metadata
    const groupMetaMap = new Map<string, { name: string; members: string[] }>();
    const groupFiles = await listFiles(groupsDir, ".json");
    for (const f of groupFiles) {
      try {
        const raw = JSON.parse(await readFile(f, "utf-8"));
        const gId = raw.id ?? basename(f, ".json");
        const gName = raw.name ?? "Unnamed Group";
        // Members can be an array of filenames (e.g. "char.png") or character names
        const members: string[] = (raw.members ?? []).map((m: string) => {
          // Strip file extensions to get character name
          return m.replace(/\.(png|json)$/i, "");
        });
        groupMetaMap.set(String(gId), { name: String(gName), members });
      } catch {
        // skip
      }
    }

    // Scan group chat JSONL files
    if (existsSync(groupChatsDir)) {
      const gcEntries = await readdir(groupChatsDir, { withFileTypes: true });
      for (const e of gcEntries) {
        if (!e.isDirectory()) continue;
        const groupId = e.name;
        const meta = groupMetaMap.get(groupId);
        if (!meta) continue;

        const gcFolder = join(groupChatsDir, groupId);
        const jsonlFiles = await listFiles(gcFolder, ".jsonl");
        for (const f of jsonlFiles) {
          const fileInfo = await stat(f);
          groupChats.push({
            id: makeScanItemId("groupChats", dataDir, f),
            path: f,
            name: meta.name,
            groupName: meta.name,
            members: meta.members,
            modifiedAt: parseTrustedTimestamp(fileInfo.mtime),
          });
        }
      }
    }

    // Also check for group chats stored directly as JSONL in a flat structure
    if (existsSync(groupChatsDir) && groupChats.length === 0) {
      const flatJsonl = await listFiles(groupChatsDir, ".jsonl");
      for (const f of flatJsonl) {
        try {
          const content = await readFile(f, "utf-8");
          const firstLine = content.split("\n")[0];
          if (firstLine) {
            const header = JSON.parse(firstLine);
            const chatId = header.chat_id ?? header.group_id;
            const meta = chatId ? groupMetaMap.get(String(chatId)) : null;
            const gName = meta?.name ?? "Group Chat";
            const members = meta?.members ?? [];
            const fileInfo = await stat(f);
            groupChats.push({
              id: makeScanItemId("groupChats", dataDir, f),
              path: f,
              name: gName,
              groupName: gName,
              members,
              modifiedAt: parseTrustedTimestamp(fileInfo.mtime),
            });
          }
        } catch {
          // skip
        }
      }
    }
  }

  // 7. User Personas — PNG/JPG files in User Avatars/
  // SillyTavern stores persona display names in power_user.personas
  // and descriptions in power_user.persona_descriptions within settings.json
  let stPersonaNames: Record<string, string> = {};
  let stPersonaDescs: Record<string, { description?: string } | string> = {};
  const settingsPath = join(dataDir, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      stPersonaNames = settings?.power_user?.personas ?? {};
      stPersonaDescs = settings?.power_user?.persona_descriptions ?? {};
    } catch {
      // skip – import avatars with filename-based names
    }
  }

  const PERSONA_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  for (const folder of ["User Avatars", "user avatars"]) {
    const avatarDir = join(dataDir, folder);
    if (!existsSync(avatarDir)) continue;
    const entries = await readdir(avatarDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = extname(e.name).toLowerCase();
      if (PERSONA_EXTS.has(ext)) {
        // Use display name from settings, fall back to filename without extension
        const fallbackName = basename(e.name, ext);
        const displayName = stPersonaNames[e.name] ?? fallbackName;
        // Get description from settings
        const descEntry = stPersonaDescs[e.name];
        const description = typeof descEntry === "string" ? descEntry : (descEntry?.description ?? "");
        const fullPath = join(avatarDir, e.name);
        const fileInfo = await stat(fullPath);
        personas.push({
          id: makeScanItemId("personas", dataDir, fullPath),
          path: fullPath,
          name: displayName,
          description,
          modifiedAt: parseTrustedTimestamp(fileInfo.mtime),
        });
      }
    }
    break;
  }

  return { success: true, dataDir, characters, chats, groupChats, presets, lorebooks, backgrounds, personas };
}

// ─── Bulk Import ───

export type STBulkImportSelection = boolean | string[];

export interface STBulkImportOptions {
  characters: STBulkImportSelection;
  chats: STBulkImportSelection;
  groupChats: STBulkImportSelection;
  presets: STBulkImportSelection;
  lorebooks: STBulkImportSelection;
  backgrounds: STBulkImportSelection;
  personas: STBulkImportSelection;
  characterTagImportMode?: STCharacterTagImportMode;
}

export interface STBulkImportResult {
  success: boolean;
  error?: string;
  imported: {
    characters: number;
    chats: number;
    groupChats: number;
    presets: number;
    lorebooks: number;
    backgrounds: number;
    personas: number;
  };
  errors: string[];
}

/** Progress event emitted during bulk import */
export interface ImportProgress {
  /** Which category is being imported */
  category: string;
  /** Name of the item currently being imported */
  item: string;
  /** Current index (1-based) within this category */
  current: number;
  /** Total items in this category */
  total: number;
  /** Cumulative counts so far */
  imported: STBulkImportResult["imported"];
}

function resolveSelectedItems<T extends { id: string }>(items: T[], selection: STBulkImportSelection | undefined) {
  if (selection === true) return items;
  if (selection === false || !Array.isArray(selection) || selection.length === 0) return [];
  const selectedIds = new Set(selection);
  return items.filter((item) => selectedIds.has(item.id));
}

export async function runSTBulkImport(
  rootPath: string,
  options: STBulkImportOptions,
  db: DB,
  onProgress?: (progress: ImportProgress) => void,
): Promise<STBulkImportResult> {
  const scanResult = await scanSTFolder(rootPath);
  if (!scanResult.success || !scanResult.dataDir) {
    return {
      success: false,
      error: scanResult.error ?? "Scan failed",
      imported: { characters: 0, chats: 0, groupChats: 0, presets: 0, lorebooks: 0, backgrounds: 0, personas: 0 },
      errors: [],
    };
  }

  const imported = { characters: 0, chats: 0, groupChats: 0, presets: 0, lorebooks: 0, backgrounds: 0, personas: 0 };
  const errors: string[] = [];
  const selectedCharacters = resolveSelectedItems(scanResult.characters, options.characters);
  const selectedChats = resolveSelectedItems(scanResult.chats, options.chats);
  const selectedGroupChats = resolveSelectedItems(scanResult.groupChats, options.groupChats);
  const selectedPresets = resolveSelectedItems(scanResult.presets, options.presets);
  const selectedLorebooks = resolveSelectedItems(scanResult.lorebooks, options.lorebooks);
  const selectedBackgrounds = resolveSelectedItems(scanResult.backgrounds, options.backgrounds);
  const selectedPersonas = resolveSelectedItems(scanResult.personas, options.personas);
  const tagImportMode = options.characterTagImportMode ?? "all";
  const existingTagKeys =
    tagImportMode === "existing" && selectedCharacters.length > 0
      ? await getExistingCharacterTagKeys(db)
      : undefined;

  // Import characters
  if (selectedCharacters.length > 0) {
    const total = selectedCharacters.length;
    let idx = 0;
    for (const ch of selectedCharacters) {
      idx++;
      onProgress?.({ category: "Characters", item: ch.name, current: idx, total, imported });
      try {
        const fileInfo = await stat(ch.path);
        const timestampOverrides = getFileTimestampOverrides(fileInfo);
        if (ch.format === "png") {
          const buf = await readFile(ch.path);
          const card = extractCharaFromPng(buf);
          if (card) {
            // Attach avatar as data URL
            const b64 = buf.toString("base64");
            const dataUrl = `data:image/png;base64,${b64}`;
            (card as Record<string, unknown>)._avatarDataUrl = dataUrl;
            await importSTCharacter(card as Record<string, unknown>, db, {
              timestampOverrides,
              tagImportMode,
              existingTagKeys,
            });
            imported.characters++;
          }
        } else {
          const raw = JSON.parse(await readFile(ch.path, "utf-8"));
          await importSTCharacter(raw, db, { timestampOverrides, tagImportMode, existingTagKeys });
          imported.characters++;
        }
      } catch (err) {
        errors.push(`Character "${ch.name}": ${(err as Error).message}`);
      }
    }
  }

  // Build a name → characterId map for linking chats to characters
  // We look at ALL characters in DB (including ones just imported)
  const charNameToId = new Map<string, string>();
  try {
    const allChars = await db.select().from(charactersTable);
    for (const ch of allChars) {
      try {
        const data = JSON.parse(ch.data);
        const name = (data?.name ?? "").toLowerCase().trim();
        if (name) charNameToId.set(name, ch.id);
      } catch {
        // skip
      }
    }
  } catch {
    // DB read failed, continue without linking
  }

  // Also index by character card filename.
  // Use ALL scanned characters, not just selectedCharacters, so chats can still
  // link to already-existing characters even when they were not re-imported now.
  for (const ch of scanResult.characters) {
    const displayNameKey = ch.name.toLowerCase().trim();
    const filenameKey = basename(ch.path, extname(ch.path)).toLowerCase().trim();

    const charId = charNameToId.get(displayNameKey) ?? charNameToId.get(filenameKey) ?? null;

    if (charId) {
      if (displayNameKey && !charNameToId.has(displayNameKey)) {
        charNameToId.set(displayNameKey, charId);
      }
      if (filenameKey && !charNameToId.has(filenameKey)) {
        charNameToId.set(filenameKey, charId);
      }
    }
  }

  // Import chats (with character linking)
  // Group chats by character, but preserve each imported file's name as a branch label.
  if (selectedChats.length > 0) {
    const charGroupIds = new Map<string, string>();
    const total = selectedChats.length;
    let idx = 0;

    for (const ct of selectedChats) {
      idx++;
      onProgress?.({ category: "Chats", item: ct.characterName, current: idx, total, imported });

      try {
        const content = await readFile(ct.path, "utf-8");
        const fileInfo = await stat(ct.path);

        const normalizedCharacterName = ct.characterName.toLowerCase().trim();
        const normalizedFolderName = ct.folderName.toLowerCase().trim();

        // Prefer folder name first because ST chat folders usually track the
        // character card filename more reliably than character_name headers.
        const charId = charNameToId.get(normalizedFolderName) ?? charNameToId.get(normalizedCharacterName) ?? null;

        const groupKey = normalizedFolderName || normalizedCharacterName;
        let groupId = charGroupIds.get(groupKey);
        if (!groupId) {
          groupId = randomUUID();
          charGroupIds.set(groupKey, groupId);
        }

        await importSTChat(content, db, {
          characterId: charId,
          chatName: ct.characterName,
          branchName: ct.chatName ?? basename(ct.path, ".jsonl"),
          groupId,
          timestampOverrides: getFileTimestampOverrides(fileInfo),
        });

        imported.chats++;
      } catch (err) {
        errors.push(`Chat "${ct.characterName}": ${(err as Error).message}`);
      }
    }
  }

  // Import group chats
  if (selectedGroupChats.length > 0) {
    const gcGroupIds = new Map<string, string>();
    const total = selectedGroupChats.length;
    let idx = 0;
    for (const gc of selectedGroupChats) {
      idx++;
      onProgress?.({ category: "Group Chats", item: gc.groupName, current: idx, total, imported });
      try {
        const content = await readFile(gc.path, "utf-8");
        const fileInfo = await stat(gc.path);
        // Build speaker→characterId map from member names
        const speakerMap: Record<string, string> = {};
        for (const memberName of gc.members) {
          const cid = charNameToId.get(memberName.toLowerCase().trim());
          if (cid) speakerMap[memberName] = cid;
        }
        const groupKey = gc.groupName.toLowerCase().trim();
        if (!gcGroupIds.has(groupKey)) {
          gcGroupIds.set(groupKey, randomUUID());
        }
        await importSTChat(content, db, {
          chatName: gc.groupName,
          speakerMap,
          mode: "roleplay",
          groupId: gcGroupIds.get(groupKey)!,
          timestampOverrides: getFileTimestampOverrides(fileInfo),
        });
        imported.groupChats++;
      } catch (err) {
        errors.push(`Group chat "${gc.groupName}": ${(err as Error).message}`);
      }
    }
  }

  // Import presets
  if (selectedPresets.length > 0) {
    const total = selectedPresets.length;
    let idx = 0;
    for (const pr of selectedPresets) {
      idx++;
      onProgress?.({ category: "Presets", item: pr.name, current: idx, total, imported });
      try {
        const raw = JSON.parse(await readFile(pr.path, "utf-8"));
        const fileInfo = await stat(pr.path);
        await importSTPreset(raw, db, pr.name, { timestampOverrides: getFileTimestampOverrides(fileInfo) });
        imported.presets++;
      } catch (err) {
        errors.push(`Preset "${pr.name}": ${(err as Error).message}`);
      }
    }
  }

  // Import lorebooks
  if (selectedLorebooks.length > 0) {
    const total = selectedLorebooks.length;
    let idx = 0;
    for (const lb of selectedLorebooks) {
      idx++;
      onProgress?.({ category: "Lorebooks", item: lb.name, current: idx, total, imported });
      try {
        const raw = JSON.parse(await readFile(lb.path, "utf-8"));
        const fileInfo = await stat(lb.path);
        await importSTLorebook(raw, db, {
          fallbackName: lb.name,
          timestampOverrides: getFileTimestampOverrides(fileInfo),
        });
        imported.lorebooks++;
      } catch (err) {
        errors.push(`Lorebook "${lb.name}": ${(err as Error).message}`);
      }
    }
  }

  // Import backgrounds
  if (selectedBackgrounds.length > 0) {
    // Ensure our backgrounds directory exists
    if (!existsSync(BG_DIR)) {
      await mkdir(BG_DIR, { recursive: true });
    }
    const total = selectedBackgrounds.length;
    let idx = 0;
    for (const bg of selectedBackgrounds) {
      idx++;
      onProgress?.({ category: "Backgrounds", item: bg.name, current: idx, total, imported });
      try {
        const ext = extname(bg.name).toLowerCase();
        const destName = `${randomUUID()}${ext}`;
        await copyFile(bg.path, join(BG_DIR, destName));
        imported.backgrounds++;
      } catch (err) {
        errors.push(`Background "${bg.name}": ${(err as Error).message}`);
      }
    }
  }

  // Import personas
  if (selectedPersonas.length > 0) {
    const storage = createCharactersStorage(db);
    const AVATAR_DIR = join(DATA_DIR, "avatars");
    if (!existsSync(AVATAR_DIR)) {
      await mkdir(AVATAR_DIR, { recursive: true });
    }
    const total = selectedPersonas.length;
    let idx = 0;
    for (const p of selectedPersonas) {
      idx++;
      onProgress?.({ category: "Personas", item: p.name, current: idx, total, imported });
      try {
        // Copy avatar image
        const ext = extname(p.path).toLowerCase();
        const destName = `${randomUUID()}${ext}`;
        await copyFile(p.path, join(AVATAR_DIR, destName));
        const avatarPath = `/api/avatars/file/${destName}`;
        const fileInfo = await stat(p.path);
        await storage.createPersona(p.name, p.description, avatarPath, undefined, getFileTimestampOverrides(fileInfo));
        imported.personas++;
      } catch (err) {
        errors.push(`Persona "${p.name}": ${(err as Error).message}`);
      }
    }
  }

  return { success: true, imported, errors };
}
