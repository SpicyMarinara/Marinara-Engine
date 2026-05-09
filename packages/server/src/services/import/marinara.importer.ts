// ──────────────────────────────────────────────
// Import: Marinara Engine native format (.marinara.json)
// ──────────────────────────────────────────────
import type { DB } from "../../db/connection.js";
import { lorebookFilterModeSchema } from "@marinara-engine/shared";
import type { ExportEnvelope, ExportType, LorebookFilterMode, LorebookMatchingSource } from "@marinara-engine/shared";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { createLorebooksStorage } from "../storage/lorebooks.storage.js";
import { createPromptsStorage } from "../storage/prompts.storage.js";
import { normalizeTimestampOverrides, type TimestampOverrides } from "./import-timestamps.js";

function readTimestampOverrides(value: unknown): TimestampOverrides | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const metadata =
    record.metadata && typeof record.metadata === "object" ? (record.metadata as Record<string, unknown>) : undefined;
  const timestamps =
    record.timestamps && typeof record.timestamps === "object"
      ? (record.timestamps as Record<string, unknown>)
      : metadata?.timestamps && typeof metadata.timestamps === "object"
        ? (metadata.timestamps as Record<string, unknown>)
        : undefined;

  return normalizeTimestampOverrides({
    createdAt: timestamps?.createdAt ?? metadata?.createdAt ?? record.createdAt,
    updatedAt: timestamps?.updatedAt ?? metadata?.updatedAt ?? record.updatedAt,
  });
}

const VALID_MATCHING_SOURCES = new Set<LorebookMatchingSource>([
  "character_name",
  "character_description",
  "character_personality",
  "character_scenario",
  "character_tags",
  "persona_description",
  "persona_tags",
]);

function readMatchingSources(value: unknown): LorebookMatchingSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter((source): source is LorebookMatchingSource =>
    VALID_MATCHING_SOURCES.has(source as LorebookMatchingSource),
  );
}

function readFilterMode(value: unknown): LorebookFilterMode {
  const parsed = lorebookFilterModeSchema.safeParse(value);
  return parsed.success ? parsed.data : "any";
}

/**
 * Import a Marinara `.marinara.json` export envelope.
 * Dispatches to the correct handler based on the `type` field.
 */
export async function importMarinara(
  envelope: ExportEnvelope,
  db: DB,
): Promise<{ success: boolean; type: ExportType; id?: string; name?: string; error?: string }> {
  if (!envelope || typeof envelope !== "object" || !envelope.type || envelope.version !== 1) {
    return { success: false, type: "marinara_character" as ExportType, error: "Invalid Marinara export file" };
  }

  switch (envelope.type) {
    case "marinara_character":
      return importCharacter(envelope.data, db);
    case "marinara_persona":
      return importPersona(envelope.data, db);
    case "marinara_lorebook":
      return importLorebook(envelope.data, db);
    case "marinara_preset":
      return importPreset(envelope.data, db);
    default:
      return { success: false, type: envelope.type, error: `Unknown export type: ${envelope.type}` };
  }
}

// ── Character ────────────────────────────────

async function importCharacter(data: unknown, db: DB) {
  const storage = createCharactersStorage(db);
  const d = data as { data?: Record<string, unknown>; spec?: string; spec_version?: string; metadata?: unknown };
  const charData = d?.data ? { ...(d.data as Record<string, unknown>) } : undefined;
  const metadata = d?.metadata && typeof d.metadata === "object" ? (d.metadata as Record<string, unknown>) : null;
  const comment = typeof metadata?.comment === "string" ? metadata.comment : undefined;
  if (!charData || typeof charData !== "object") {
    return { success: false, type: "marinara_character" as const, error: "Invalid character data" };
  }
  const extensions =
    charData.extensions && typeof charData.extensions === "object"
      ? ({ ...(charData.extensions as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const existingImportMetadata =
    extensions.importMetadata && typeof extensions.importMetadata === "object"
      ? ({ ...(extensions.importMetadata as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  // Drop any `lorebookId` carried over from the exporter's database. It
  // refers to a row in their lorebook table, not ours, so keeping it
  // leaves an orphan that makes the character editor's "Edit Linked
  // Lorebook" button open a 404 editor stuck on a permanent shimmer
  // (`isLoading || !lorebook`). The user can click "Import Embedded
  // Lorebook" post-import to create a real linked lorebook in this DB.
  const carriedEmbeddedLorebook =
    typeof existingImportMetadata.embeddedLorebook === "object" && existingImportMetadata.embeddedLorebook
      ? (existingImportMetadata.embeddedLorebook as Record<string, unknown>)
      : null;
  if (carriedEmbeddedLorebook && "lorebookId" in carriedEmbeddedLorebook) {
    const { lorebookId: _staleLorebookId, ...sanitized } = carriedEmbeddedLorebook;
    void _staleLorebookId;
    existingImportMetadata.embeddedLorebook = sanitized;
    extensions.importMetadata = existingImportMetadata;
    charData.extensions = extensions;
  }
  const cardSpecMetadata =
    typeof d?.spec === "string" || typeof d?.spec_version === "string"
      ? {
          ...(typeof d.spec === "string" ? { spec: d.spec } : {}),
          ...(typeof d.spec_version === "string" ? { specVersion: d.spec_version } : {}),
        }
      : null;

  if (cardSpecMetadata) {
    extensions.importMetadata = {
      ...existingImportMetadata,
      card: {
        ...(existingImportMetadata.card && typeof existingImportMetadata.card === "object"
          ? (existingImportMetadata.card as Record<string, unknown>)
          : {}),
        ...cardSpecMetadata,
      },
    };
    charData.extensions = extensions;
  }

  const result = await storage.create(charData as any, undefined, readTimestampOverrides(d), comment);
  return {
    success: true,
    type: "marinara_character" as const,
    id: result?.id,
    name: (charData as any).name ?? "Imported character",
  };
}

// ── Persona ──────────────────────────────────

async function importPersona(data: unknown, db: DB) {
  const storage = createCharactersStorage(db);
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object") {
    return { success: false, type: "marinara_persona" as const, error: "Invalid persona data" };
  }
  const result = await storage.createPersona(
    String(d.name ?? "Imported Persona"),
    String(d.description ?? ""),
    undefined,
    {
      personality: String(d.personality ?? ""),
      scenario: String(d.scenario ?? ""),
      backstory: String(d.backstory ?? ""),
      appearance: String(d.appearance ?? ""),
      nameColor: String(d.nameColor ?? ""),
      dialogueColor: String(d.dialogueColor ?? ""),
      boxColor: String(d.boxColor ?? ""),
    },
    readTimestampOverrides(d),
  );
  return {
    success: true,
    type: "marinara_persona" as const,
    id: result?.id,
    name: String(d.name ?? "Imported Persona"),
  };
}

// ── Lorebook ─────────────────────────────────

async function importLorebook(data: unknown, db: DB) {
  const storage = createLorebooksStorage(db);
  const d = data as {
    lorebook?: Record<string, unknown>;
    entries?: Record<string, unknown>[];
    folders?: Record<string, unknown>[];
  };
  if (!d?.lorebook) {
    return { success: false, type: "marinara_lorebook" as const, error: "Invalid lorebook data" };
  }
  const lb = d.lorebook;
  const newLb = (await storage.create(
    {
      name: String(lb.name ?? "Imported Lorebook"),
      description: String(lb.description ?? ""),
      category: (lb.category as any) ?? "uncategorized",
      scanDepth: Number(lb.scanDepth ?? 2),
      tokenBudget: Number(lb.tokenBudget ?? 2048),
      recursiveScanning: Boolean(lb.recursiveScanning),
      maxRecursionDepth: Number(lb.maxRecursionDepth ?? 3),
      characterId: typeof lb.characterId === "string" ? lb.characterId : null,
      characterIds: Array.isArray(lb.characterIds)
        ? lb.characterIds.filter((value): value is string => typeof value === "string")
        : typeof lb.characterId === "string"
          ? [lb.characterId]
          : [],
      personaId: typeof lb.personaId === "string" ? lb.personaId : null,
      personaIds: Array.isArray(lb.personaIds)
        ? lb.personaIds.filter((value): value is string => typeof value === "string")
        : typeof lb.personaId === "string"
          ? [lb.personaId]
          : [],
      chatId: typeof lb.chatId === "string" ? lb.chatId : null,
      isGlobal: lb.isGlobal === true || lb.isGlobal === "true",
      enabled: lb.enabled !== false,
      tags: Array.isArray(lb.tags) ? lb.tags.map(String) : [],
      generatedBy: "import",
      sourceAgentId: typeof lb.sourceAgentId === "string" ? lb.sourceAgentId : null,
    },
    readTimestampOverrides(lb),
  )) as Record<string, unknown> | null;

  // Re-create folders first so we can remap old folder IDs → new folder IDs
  // before mapping entries. Older exports without `folders` simply skip this
  // step and every entry lands at root.
  const folderIdRemap = new Map<string, string>();
  if (newLb && Array.isArray(d.folders) && d.folders.length > 0) {
    for (const f of d.folders) {
      const oldId = typeof f.id === "string" ? f.id : null;
      const created = (await storage.createFolder(newLb.id as string, {
        name: String(f.name ?? "Folder"),
        enabled: f.enabled !== false,
        parentFolderId: null, // v1 ignores nesting on import
        order: Number(f.order ?? 0),
      })) as Record<string, unknown> | null;
      if (oldId && created?.id) folderIdRemap.set(oldId, created.id as string);
    }
  }

  if (newLb && Array.isArray(d.entries) && d.entries.length > 0) {
    const entries = d.entries.map((e) => {
      const oldFolderId = typeof e.folderId === "string" ? e.folderId : null;
      const newFolderId = oldFolderId ? (folderIdRemap.get(oldFolderId) ?? null) : null;
      return {
        name: String(e.name ?? ""),
        content: String(e.content ?? ""),
        // CodeRabbit-flagged: description, ephemeral, locked, and preventRecursion
        // were absent from the previous map, so an exported lorebook would lose
        // these fields on re-import. Knowledge-router matching uses description,
        // ephemeral controls auto-disable countdown, locked protects entries
        // from the Lorebook Keeper agent, and preventRecursion gates recursive
        // scanning — all behaviors that should round-trip.
        description: String(e.description ?? ""),
        keys: Array.isArray(e.keys) ? e.keys.map(String) : [],
        secondaryKeys: Array.isArray(e.secondaryKeys) ? e.secondaryKeys.map(String) : [],
        enabled: e.enabled !== false,
        constant: Boolean(e.constant),
        selective: Boolean(e.selective),
        selectiveLogic: (e.selectiveLogic as any) ?? "and",
        probability: e.probability != null ? Number(e.probability) : null,
        scanDepth: e.scanDepth != null ? Number(e.scanDepth) : null,
        matchWholeWords: Boolean(e.matchWholeWords),
        caseSensitive: Boolean(e.caseSensitive),
        useRegex: Boolean(e.useRegex),
        characterFilterMode: readFilterMode(e.characterFilterMode),
        characterFilterIds: Array.isArray(e.characterFilterIds) ? e.characterFilterIds.map(String) : [],
        characterTagFilterMode: readFilterMode(e.characterTagFilterMode),
        characterTagFilters: Array.isArray(e.characterTagFilters) ? e.characterTagFilters.map(String) : [],
        generationTriggerFilterMode: readFilterMode(e.generationTriggerFilterMode),
        generationTriggerFilters: Array.isArray(e.generationTriggerFilters)
          ? e.generationTriggerFilters.map(String)
          : [],
        additionalMatchingSources: readMatchingSources(e.additionalMatchingSources),
        position: Number(e.position ?? 0),
        depth: Number(e.depth ?? 4),
        order: Number(e.order ?? 100),
        role: (e.role as any) ?? "system",
        sticky: e.sticky != null ? Number(e.sticky) : null,
        cooldown: e.cooldown != null ? Number(e.cooldown) : null,
        delay: e.delay != null ? Number(e.delay) : null,
        ephemeral: e.ephemeral != null ? Number(e.ephemeral) : null,
        group: String(e.group ?? ""),
        groupWeight: e.groupWeight != null ? Number(e.groupWeight) : null,
        folderId: newFolderId,
        locked: Boolean(e.locked),
        preventRecursion: Boolean(e.preventRecursion),
        tag: String(e.tag ?? ""),
        relationships: (e.relationships as any) ?? {},
        dynamicState: (e.dynamicState as any) ?? {},
        activationConditions: (e.activationConditions as any) ?? [],
        schedule: (e.schedule as any) ?? null,
      };
    });
    await storage.bulkCreateEntries(newLb.id as string, entries);
  }

  return {
    success: true,
    type: "marinara_lorebook" as const,
    id: newLb?.id as string,
    name: String(lb.name ?? "Imported Lorebook"),
  };
}

// ── Preset ───────────────────────────────────

async function importPreset(data: unknown, db: DB) {
  const storage = createPromptsStorage(db);
  const d = data as {
    preset?: Record<string, unknown>;
    sections?: Record<string, unknown>[];
    groups?: Record<string, unknown>[];
    choiceBlocks?: Record<string, unknown>[];
  };
  if (!d?.preset) {
    return { success: false, type: "marinara_preset" as const, error: "Invalid preset data" };
  }
  const p = d.preset;

  // Create the base preset
  const newPreset = await storage.create(
    {
      name: String(p.name ?? "Imported Preset"),
      description: String(p.description ?? ""),
      variableGroups: safeParseJson(p.variableGroups, []),
      variableValues: safeParseJson(p.variableValues, {}),
      parameters: safeParseJson(p.parameters, {}),
      wrapFormat: (p.wrapFormat as any) ?? "xml",
      author: String(p.author ?? ""),
    },
    readTimestampOverrides(p),
  );
  if (!newPreset) {
    return { success: false, type: "marinara_preset" as const, error: "Failed to create preset" };
  }

  // Re-create groups with old→new ID mapping
  const groupMap = new Map<string, string>();
  if (Array.isArray(d.groups)) {
    for (const g of d.groups) {
      const newGroup = await storage.createGroup({
        presetId: newPreset.id,
        name: String(g.name ?? ""),
        parentGroupId: null, // fixed below
        order: Number(g.order ?? 100),
        enabled: g.enabled === true || g.enabled === "true",
      });
      if (newGroup) groupMap.set(String(g.id), newGroup.id);
    }
    // Fix parent references
    for (const g of d.groups) {
      if (g.parentGroupId && groupMap.has(String(g.parentGroupId))) {
        const newGId = groupMap.get(String(g.id));
        if (newGId) {
          await storage.updateGroup(newGId, {
            parentGroupId: groupMap.get(String(g.parentGroupId))!,
          });
        }
      }
    }
  }

  // Re-create sections with old→new ID mapping
  const sectionMap = new Map<string, string>();
  if (Array.isArray(d.sections)) {
    for (const s of d.sections) {
      const groupId = s.groupId ? (groupMap.get(String(s.groupId)) ?? null) : null;
      const newSection = await storage.createSection({
        presetId: newPreset.id,
        identifier: String(s.identifier ?? ""),
        name: String(s.name ?? ""),
        content: String(s.content ?? ""),
        role: (s.role as any) ?? "system",
        enabled: s.enabled === true || s.enabled === "true",
        isMarker: s.isMarker === true || s.isMarker === "true",
        groupId,
        markerConfig: s.markerConfig ? safeParseJson(s.markerConfig, null) : null,
        injectionPosition: (s.injectionPosition as any) ?? "ordered",
        injectionDepth: Number(s.injectionDepth ?? 0),
        injectionOrder: Number(s.injectionOrder ?? 100),
        forbidOverrides: s.forbidOverrides === true || s.forbidOverrides === "true",
      });
      if (newSection) sectionMap.set(String(s.id), newSection.id);
    }
  }

  // Re-create choice blocks
  if (Array.isArray(d.choiceBlocks)) {
    for (const v of d.choiceBlocks) {
      await storage.createChoiceBlock({
        presetId: newPreset.id,
        variableName: String(v.variableName ?? ""),
        question: String(v.question ?? ""),
        options: safeParseJson(v.options, []),
        multiSelect: v.multiSelect === true || v.multiSelect === "true",
        separator: String(v.separator ?? ", "),
        randomPick: v.randomPick === true || v.randomPick === "true",
      });
    }
  }

  // Remap section/group order arrays
  const oldSectionOrder = safeParseJson(p.sectionOrder, []) as string[];
  const newSectionOrder = oldSectionOrder.map((sid) => sectionMap.get(sid)).filter(Boolean) as string[];
  const oldGroupOrder = safeParseJson(p.groupOrder, []) as string[];
  const newGroupOrder = oldGroupOrder.map((gid) => groupMap.get(gid)).filter(Boolean) as string[];
  await storage.update(newPreset.id, { sectionOrder: newSectionOrder, groupOrder: newGroupOrder });

  return {
    success: true,
    type: "marinara_preset" as const,
    id: newPreset.id,
    name: String(p.name ?? "Imported Preset"),
  };
}

/** Safely parse a value that may be a JSON string or already an object. */
function safeParseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}
