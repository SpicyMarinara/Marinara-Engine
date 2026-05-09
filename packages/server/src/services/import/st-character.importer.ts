// ──────────────────────────────────────────────
// Importer: SillyTavern Character (JSON / V2 Card / CharX)
// ──────────────────────────────────────────────
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { importSTLorebook } from "./st-lorebook.importer.js";
import type { CharacterData } from "@marinara-engine/shared";
import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { DATA_DIR } from "../../utils/data-dir.js";
import AdmZip from "adm-zip";
import { normalizeTimestampOverrides, type TimestampOverrides } from "./import-timestamps.js";

const AVATAR_DIR = join(DATA_DIR, "avatars");
const IMPORT_METADATA_KEY = "importMetadata";

function ensureAvatarDir() {
  if (!existsSync(AVATAR_DIR)) {
    mkdirSync(AVATAR_DIR, { recursive: true });
  }
}

function countEmbeddedLorebookEntries(book: unknown): number {
  return getCharacterBookEntries(book).length;
}

/**
 * Import a SillyTavern character card (JSON format).
 * Handles V1, V2, Pygmalion, and RisuAI formats.
 * If _avatarDataUrl is present, saves the avatar image.
 */
export interface STCharacterImportPreview {
  success: boolean;
  name?: string;
  hasEmbeddedLorebook: boolean;
  embeddedLorebookEntries: number;
  error?: string;
}

export interface STCharacterImportOptions {
  timestampOverrides?: TimestampOverrides | null;
  importEmbeddedLorebook?: boolean;
}

export async function importSTCharacter(raw: Record<string, unknown>, db: DB, options?: STCharacterImportOptions) {
  const storage = createCharactersStorage(db);
  const normalizedTimestamps = normalizeTimestampOverrides(options?.timestampOverrides);
  const shouldImportEmbeddedLorebook = options?.importEmbeddedLorebook ?? true;

  // Extract avatar data URL if present (from PNG import)
  const avatarDataUrl = raw._avatarDataUrl as string | null;
  delete raw._avatarDataUrl;

  // Extract browser source marker if present
  const botBrowserSource = raw._botBrowserSource as string | null;
  delete raw._botBrowserSource;

  const data = normalizeCharacterData(raw);
  const rawEmbeddedLorebook = extractRawCharacterBook(raw) ?? data.character_book;
  if (rawEmbeddedLorebook) {
    data.character_book = normalizeCharacterBook(rawEmbeddedLorebook);
  }

  // Tag with browser source if imported from browser
  if (botBrowserSource) {
    data.extensions.botBrowserSource = botBrowserSource;
  }

  const existingImportMetadata =
    data.extensions[IMPORT_METADATA_KEY] && typeof data.extensions[IMPORT_METADATA_KEY] === "object"
      ? (data.extensions[IMPORT_METADATA_KEY] as Record<string, unknown>)
      : {};
  const cardSpecMetadata = buildCardSpecMetadata(raw);
  const embeddedLorebookEntries = countEmbeddedLorebookEntries(data.character_book);
  const hasEmbeddedLorebook = embeddedLorebookEntries > 0;
  // Strip any `lorebookId` carried by the source card. That ID references
  // the exporter's database (e.g. a different Marinara instance), not
  // ours, so preserving it leaves an orphan pointer that makes "Edit
  // Linked Lorebook" open a 404 editor before the auto-import below has
  // a chance to set the real ID. The fresh value is written below at the
  // end of the auto-import branch when (and only when) we actually
  // created a lorebook in this DB.
  const carriedEmbeddedLorebook =
    typeof existingImportMetadata.embeddedLorebook === "object" && existingImportMetadata.embeddedLorebook
      ? (existingImportMetadata.embeddedLorebook as Record<string, unknown>)
      : {};
  const { lorebookId: _staleLorebookId, ...sanitizedEmbeddedLorebook } = carriedEmbeddedLorebook;
  void _staleLorebookId;
  data.extensions[IMPORT_METADATA_KEY] = {
    ...existingImportMetadata,
    ...(cardSpecMetadata ? { card: cardSpecMetadata } : {}),
    embeddedLorebook: {
      ...sanitizedEmbeddedLorebook,
      hasEmbeddedLorebook,
    },
  };

  // Save avatar image if provided
  let avatarPath: string | undefined;
  if (avatarDataUrl && avatarDataUrl.startsWith("data:image/")) {
    ensureAvatarDir();
    const ext = avatarDataUrl.match(/^data:image\/([\w+]+);/)?.[1]?.replace("+xml", "") ?? "png";
    const filename = `${randomUUID()}.${ext}`;
    const filePath = join(AVATAR_DIR, filename);

    // Strip data URL header → raw base64
    const base64 = avatarDataUrl.split(",")[1];
    if (base64) {
      await writeFile(filePath, Buffer.from(base64, "base64"));
      avatarPath = `/api/avatars/file/${filename}`;
    }
  }

  const character = await storage.create(data, avatarPath, normalizedTimestamps);
  const charId = (character as { id?: string } | null)?.id;

  // Extract character_book into a standalone lorebook linked to this character
  let lorebookResult: { lorebookId?: string; entriesImported?: number } | null = null;
  if (shouldImportEmbeddedLorebook && data.character_book && charId) {
    const bookRaw = rawEmbeddedLorebook as unknown as Record<string, unknown>;
    // ST character_book uses the same shape as World Info
    const wiData: Record<string, unknown> = {
      name: `${data.name}'s Lorebook`,
      entries: bookRaw.entries ?? {},
      description: bookRaw.description,
      scan_depth: bookRaw.scan_depth,
      scanDepth: bookRaw.scanDepth,
      token_budget: bookRaw.token_budget,
      tokenBudget: bookRaw.tokenBudget,
      recursive_scanning: bookRaw.recursive_scanning,
      recursiveScanning: bookRaw.recursiveScanning,
      max_recursion_depth: bookRaw.max_recursion_depth,
      maxRecursionDepth: bookRaw.maxRecursionDepth,
      extensions: bookRaw.extensions ?? {},
    };

    try {
      const result = await importSTLorebook(wiData, db, {
        characterId: charId,
        namePrefix: data.name,
        timestampOverrides: options?.timestampOverrides,
      });
      if (result && "lorebookId" in result) {
        lorebookResult = {
          lorebookId: result.lorebookId as string,
          entriesImported: result.entriesImported as number,
        };

        const updatedImportMetadata = {
          ...(data.extensions[IMPORT_METADATA_KEY] as Record<string, unknown>),
          embeddedLorebook: {
            ...(((data.extensions[IMPORT_METADATA_KEY] as Record<string, unknown>)?.embeddedLorebook as
              | Record<string, unknown>
              | undefined) ?? {}),
            hasEmbeddedLorebook: true,
            lorebookId: result.lorebookId as string,
          },
        };
        data.extensions[IMPORT_METADATA_KEY] = updatedImportMetadata;
        await storage.update(charId, { extensions: { ...data.extensions } }, undefined, {
          updatedAt: normalizedTimestamps?.updatedAt ?? normalizedTimestamps?.createdAt ?? null,
          skipVersionSnapshot: true,
        });
      }
    } catch (err) {
      logger.warn(err, "Lorebook extraction failed for character import");
      // Non-fatal — character was imported, just lorebook extraction failed
    }
  }

  return {
    success: true,
    characterId: charId,
    name: data.name,
    embeddedLorebook: {
      hasEmbeddedLorebook,
      entries: embeddedLorebookEntries,
      imported: !!lorebookResult,
      skipped: hasEmbeddedLorebook && !shouldImportEmbeddedLorebook,
    },
    ...(lorebookResult ? { lorebook: lorebookResult } : {}),
  };
}

export function inspectSTCharacter(raw: Record<string, unknown>): STCharacterImportPreview {
  try {
    const data = normalizeCharacterData(raw);
    const embeddedLorebookEntries = countEmbeddedLorebookEntries(data.character_book);
    return {
      success: true,
      name: data.name,
      hasEmbeddedLorebook: embeddedLorebookEntries > 0,
      embeddedLorebookEntries,
    };
  } catch (error) {
    return {
      success: false,
      hasEmbeddedLorebook: false,
      embeddedLorebookEntries: 0,
      error: error instanceof Error ? error.message : "Invalid character card",
    };
  }
}

/**
 * Import a CharX (.charx) file — RisuAI Character Card V3 zip format.
 * Extracts card.json and the main icon asset from the zip.
 */
export async function importCharX(buf: Buffer, db: DB, options?: STCharacterImportOptions) {
  const zip = new AdmZip(buf);

  // Extract card.json from root of the zip
  const cardJson = readCharXCardJson(zip);
  if (!cardJson) return { success: false, error: "Invalid .charx file: missing card.json at root." };

  // Resolve the main icon asset from the zip
  let avatarDataUrl: string | null = null;

  // The card.json is a CCv3 wrapper: { spec: "chara_card_v3", data: { ... } }
  const cardData = (cardJson.data ?? cardJson) as Record<string, unknown>;
  const assets = cardData.assets as Array<{ type: string; uri: string; name: string; ext: string }> | undefined;

  if (assets && Array.isArray(assets)) {
    // Find the main icon asset
    const mainIcon =
      assets.find((a) => a.type === "icon" && a.name === "main") ?? assets.find((a) => a.type === "icon");

    if (mainIcon && mainIcon.uri) {
      avatarDataUrl = resolveCharXAsset(zip, mainIcon.uri, mainIcon.ext);
    }
  }

  // If no icon found via assets, check for common fallback paths
  if (!avatarDataUrl) {
    for (const fallback of [
      "assets/icon/images/main.png",
      "assets/icon/images/main.webp",
      "assets/icon/images/main.jpg",
    ]) {
      const entry = zip.getEntry(fallback);
      if (entry) {
        const ext = fallback.split(".").pop() ?? "png";
        const mime = ext === "jpg" ? "jpeg" : ext;
        avatarDataUrl = `data:image/${mime};base64,${entry.getData().toString("base64")}`;
        break;
      }
    }
  }

  // Attach avatar and delegate to the standard importer
  if (avatarDataUrl) {
    cardJson._avatarDataUrl = avatarDataUrl;
  }

  return importSTCharacter(cardJson as Record<string, unknown>, db, options);
}

export function inspectCharX(buf: Buffer): STCharacterImportPreview {
  try {
    const zip = new AdmZip(buf);
    const cardJson = readCharXCardJson(zip);
    if (!cardJson) {
      return {
        success: false,
        hasEmbeddedLorebook: false,
        embeddedLorebookEntries: 0,
        error: "Invalid .charx file: missing card.json at root.",
      };
    }
    return inspectSTCharacter(cardJson);
  } catch (error) {
    return {
      success: false,
      hasEmbeddedLorebook: false,
      embeddedLorebookEntries: 0,
      error: error instanceof Error ? error.message : "Invalid .charx file",
    };
  }
}

function readCharXCardJson(zip: AdmZip): Record<string, unknown> | null {
  const cardEntry = zip.getEntry("card.json");
  if (!cardEntry) return null;
  return JSON.parse(cardEntry.getData().toString("utf-8")) as Record<string, unknown>;
}

function normalizeCharacterData(raw: Record<string, unknown>): CharacterData {
  // Detect format
  if ((raw.spec === "chara_card_v2" || raw.spec === "chara_card_v3") && raw.data) {
    // V2 / V3 format — extract from data wrapper
    return normalizeV2(raw.data as Record<string, unknown>);
  }
  if (raw.char_name || raw.name) {
    // V1 / Pygmalion format — convert to V2
    return convertV1toV2(raw);
  }
  if (raw.type === "character" && raw.data) {
    // RisuAI format
    return convertRisuToV2((raw.data as Record<string, unknown>) ?? {});
  }
  // Try treating the whole object as character data
  return normalizeV2(raw);
}

function extractRawCharacterBook(raw: Record<string, unknown>): unknown {
  if ((raw.spec === "chara_card_v2" || raw.spec === "chara_card_v3") && raw.data && typeof raw.data === "object") {
    return selectBestCharacterBook(raw.character_book, (raw.data as Record<string, unknown>).character_book);
  }
  if (raw.type === "character" && raw.data && typeof raw.data === "object") {
    return selectBestCharacterBook(raw.character_book, (raw.data as Record<string, unknown>).character_book);
  }
  return raw.character_book;
}

function getCharacterBookEntries(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== "object") return [];
  const entries = (raw as Record<string, unknown>).entries;
  if (Array.isArray(entries)) return entries.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
  if (entries && typeof entries === "object") {
    return Object.values(entries).filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
  }
  return [];
}

function selectBestCharacterBook(...books: unknown[]): unknown {
  let best: unknown = null;
  let bestNamedEntries = -1;

  for (const book of books) {
    if (!book || typeof book !== "object") continue;
    const entries = getCharacterBookEntries(book);
    if (entries.length === 0) continue;
    const namedEntries = entries.filter((entry) => firstNonEmptyString(entry.comment, entry.name)).length;
    if (namedEntries > bestNamedEntries) {
      best = book;
      bestNamedEntries = namedEntries;
    }
  }

  return best;
}

function buildCardSpecMetadata(raw: Record<string, unknown>) {
  const spec = typeof raw.spec === "string" ? raw.spec : null;
  const specVersion = typeof raw.spec_version === "string" ? raw.spec_version : null;
  if (!spec && !specVersion) return null;

  return {
    ...(spec ? { spec } : {}),
    ...(specVersion ? { specVersion } : {}),
  };
}

/** Resolve an asset URI from a CharX zip to a data URL. */
function resolveCharXAsset(zip: AdmZip, uri: string, ext?: string): string | null {
  // Handle embeded:// URIs (note: spec uses "embeded" not "embedded")
  let zipPath: string | null = null;

  if (uri.startsWith("embeded://")) {
    zipPath = uri.slice("embeded://".length);
  } else if (uri.startsWith("embedded://")) {
    // Accept the common misspelling too
    zipPath = uri.slice("embedded://".length);
  } else if (uri.startsWith("data:image/")) {
    // Already a data URL
    return uri;
  } else if (!uri.includes("://") && uri !== "ccdefault:") {
    // Treat as a relative path within the zip
    zipPath = uri;
  }

  if (!zipPath) return null;

  const entry = zip.getEntry(zipPath);
  if (!entry) return null;

  const fileExt = ext ?? zipPath.split(".").pop() ?? "png";
  const mime = fileExt === "jpg" ? "jpeg" : fileExt;
  return `data:image/${mime};base64,${entry.getData().toString("base64")}`;
}

function normalizeV2(raw: Record<string, unknown>): CharacterData {
  return {
    name: String(raw.name ?? "Unknown"),
    description: String(raw.description ?? ""),
    personality: String(raw.personality ?? ""),
    scenario: String(raw.scenario ?? ""),
    first_mes: String(raw.first_mes ?? ""),
    mes_example: String(raw.mes_example ?? ""),
    creator_notes: String(raw.creator_notes ?? ""),
    system_prompt: String(raw.system_prompt ?? ""),
    post_history_instructions: String(raw.post_history_instructions ?? ""),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    creator: String(raw.creator ?? ""),
    character_version: String(raw.character_version ?? ""),
    alternate_greetings: Array.isArray(raw.alternate_greetings) ? raw.alternate_greetings.map(String) : [],
    extensions: {
      talkativeness: Number((raw.extensions as Record<string, unknown>)?.talkativeness ?? 0.5),
      fav: Boolean((raw.extensions as Record<string, unknown>)?.fav),
      world: String((raw.extensions as Record<string, unknown>)?.world ?? ""),
      depth_prompt: {
        prompt: String(
          ((raw.extensions as Record<string, unknown>)?.depth_prompt as Record<string, unknown>)?.prompt ?? "",
        ),
        depth: Number(
          ((raw.extensions as Record<string, unknown>)?.depth_prompt as Record<string, unknown>)?.depth ?? 4,
        ),
        role:
          (((raw.extensions as Record<string, unknown>)?.depth_prompt as Record<string, unknown>)?.role as
            | "system"
            | "user"
            | "assistant") ?? "system",
      },
      backstory: String((raw.extensions as Record<string, unknown>)?.backstory ?? ""),
      appearance: String((raw.extensions as Record<string, unknown>)?.appearance ?? ""),
    },
    character_book: normalizeCharacterBook(raw.character_book),
  };
}

/** Coerce an unknown value into a string array, handling single-string and missing cases. */
function normalizeStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") return [raw];
  return [];
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/**
 * Normalize a character_book from any format (ST World Info or V2 spec) into
 * the V2 CharacterBook shape with entries as an array of CharacterBookEntry objects.
 */
function normalizeCharacterBook(raw: unknown): CharacterData["character_book"] {
  if (!raw || typeof raw !== "object") return null;
  const book = raw as Record<string, unknown>;

  const entries = getCharacterBookEntries(book).map((e, i) => {
    const posRaw = e.position;
    let position: "before_char" | "after_char" = "before_char";
    if (typeof posRaw === "string") {
      position = posRaw === "after_char" ? "after_char" : "before_char";
    } else if (typeof posRaw === "number") {
      position = posRaw === 1 ? "after_char" : "before_char";
    }
    const title = firstNonEmptyString(e.comment, e.name) ?? `Entry ${i + 1}`;

    return {
      keys: normalizeStringArray(e.key ?? e.keys),
      secondary_keys: normalizeStringArray(e.keysecondary ?? e.secondary_keys),
      content: String(e.content ?? ""),
      extensions: (e.extensions ?? {}) as Record<string, unknown>,
      enabled: e.disable != null ? !e.disable : e.enabled != null ? Boolean(e.enabled) : true,
      insertion_order: (e.order ?? e.insertion_order ?? 100) as number,
      case_sensitive: Boolean(e.caseSensitive ?? e.case_sensitive ?? false),
      name: title,
      priority: (e.priority ?? 10) as number,
      id: (e.uid ?? e.id ?? i) as number,
      comment: title,
      selective: Boolean(e.selective ?? false),
      constant: Boolean(e.constant ?? false),
      position,
    };
  });

  return {
    name: String(book.name ?? ""),
    description: String(book.description ?? ""),
    scan_depth: Number(book.scan_depth ?? book.scanDepth ?? 2),
    token_budget: Number(book.token_budget ?? book.tokenBudget ?? 2048),
    recursive_scanning: Boolean(book.recursive_scanning ?? book.recursiveScanning ?? false),
    extensions: (book.extensions ?? {}) as Record<string, unknown>,
    entries,
  };
}

function convertV1toV2(raw: Record<string, unknown>): CharacterData {
  return normalizeV2({
    name: raw.char_name ?? raw.name ?? "Unknown",
    description: raw.char_persona ?? raw.description ?? "",
    personality: raw.personality ?? "",
    scenario: raw.world_scenario ?? raw.scenario ?? "",
    first_mes: raw.char_greeting ?? raw.first_mes ?? "",
    mes_example: raw.example_dialogue ?? raw.mes_example ?? "",
    // Preserve V2 fields when present instead of discarding them
    creator_notes: raw.creator_notes ?? "",
    system_prompt: raw.system_prompt ?? "",
    post_history_instructions: raw.post_history_instructions ?? "",
    tags: raw.tags ?? [],
    creator: raw.creator ?? "",
    character_version: raw.character_version ?? "",
    alternate_greetings: raw.alternate_greetings ?? [],
    extensions: raw.extensions ?? {},
    character_book: raw.character_book ?? null,
  });
}

function convertRisuToV2(raw: Record<string, unknown>): CharacterData {
  return normalizeV2({
    name: raw.name ?? "Unknown",
    description: raw.description ?? "",
    personality: raw.personality ?? "",
    scenario: raw.scenario ?? "",
    first_mes: raw.firstMessage ?? raw.first_mes ?? "",
    mes_example: raw.exampleMessage ?? raw.mes_example ?? "",
    system_prompt: raw.systemPrompt ?? "",
    creator_notes: raw.creatorNotes ?? "",
    post_history_instructions: "",
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    creator: String(raw.creator ?? ""),
    character_version: "",
    alternate_greetings: Array.isArray(raw.alternateGreetings) ? raw.alternateGreetings.map(String) : [],
    extensions: {},
    character_book: null,
  });
}
