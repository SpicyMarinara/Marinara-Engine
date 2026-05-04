// ──────────────────────────────────────────────
// Storage: Chat Presets
// ──────────────────────────────────────────────
// CRUD for the saved chat-settings bundles applied to new chats.
// One preset per mode is marked active and used as the starting state.
import { eq, and, ne, asc } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { chats, chatPresets } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import {
  CHAT_PRESET_EXCLUDED_METADATA_KEYS,
  type ChatMode,
  type ChatPresetSettings,
  type CreateChatPresetInput,
  type UpdateChatPresetInput,
} from "@marinara-engine/shared";

const CHAT_MODES: ChatMode[] = ["conversation", "roleplay", "visual_novel"];
const EXCLUDED_METADATA_SET = new Set(CHAT_PRESET_EXCLUDED_METADATA_KEYS);
const SCENE_POINTER_METADATA_KEYS = new Set(["activeSceneChatId", "sceneBusyCharIds"]);

function isPresetExcludedMetadataKey(key: string) {
  return EXCLUDED_METADATA_SET.has(key) || SCENE_POINTER_METADATA_KEYS.has(key) || key.startsWith("scene");
}

interface ChatPresetRow {
  id: string;
  name: string;
  mode: string;
  isDefault: string;
  isActive: string;
  settings: string;
  createdAt: string;
  updatedAt: string;
}

function rowToPreset(row: ChatPresetRow) {
  let settings: ChatPresetSettings = {};
  try {
    settings = row.settings ? (JSON.parse(row.settings) as ChatPresetSettings) : {};
  } catch {
    settings = {};
  }
  return {
    id: row.id,
    name: row.name,
    mode: row.mode as ChatMode,
    isDefault: row.isDefault === "true",
    isActive: row.isActive === "true",
    settings: sanitizePresetSettings(settings, row.mode as ChatMode),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Strip chat-specific keys from a metadata object before saving into a preset. */
export function sanitizePresetMetadata(metadata: Record<string, unknown> | undefined | null) {
  if (!metadata || typeof metadata !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isPresetExcludedMetadataKey(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Strip chat-specific keys from a settings object before saving into a preset. */
export function sanitizePresetSettings(
  input: ChatPresetSettings | undefined | null,
  mode?: ChatMode,
): ChatPresetSettings {
  if (!input) return {};
  const out: ChatPresetSettings = {};
  if ("connectionId" in input) out.connectionId = input.connectionId ?? null;
  if (mode !== "conversation" && "promptPresetId" in input) out.promptPresetId = input.promptPresetId ?? null;
  if (input.metadata) out.metadata = sanitizePresetMetadata(input.metadata as Record<string, unknown>);
  return out;
}

export function createChatPresetsStorage(db: DB) {
  const storage = {
    async list() {
      const rows = (await db
        .select()
        .from(chatPresets)
        .orderBy(asc(chatPresets.mode), asc(chatPresets.name))) as ChatPresetRow[];
      return rows.map(rowToPreset);
    },

    async listByMode(mode: ChatMode) {
      const rows = (await db
        .select()
        .from(chatPresets)
        .where(eq(chatPresets.mode, mode))
        .orderBy(asc(chatPresets.name))) as ChatPresetRow[];
      return rows.map(rowToPreset);
    },

    async getById(id: string) {
      const rows = (await db.select().from(chatPresets).where(eq(chatPresets.id, id))) as ChatPresetRow[];
      return rows[0] ? rowToPreset(rows[0]) : null;
    },

    async getActive(mode: ChatMode) {
      const rows = (await db
        .select()
        .from(chatPresets)
        .where(and(eq(chatPresets.mode, mode), eq(chatPresets.isActive, "true")))) as ChatPresetRow[];
      return rows[0] ? rowToPreset(rows[0]) : null;
    },

    async getDefault(mode: ChatMode) {
      const rows = (await db
        .select()
        .from(chatPresets)
        .where(and(eq(chatPresets.mode, mode), eq(chatPresets.isDefault, "true")))) as ChatPresetRow[];
      return rows[0] ? rowToPreset(rows[0]) : null;
    },

    async create(input: CreateChatPresetInput) {
      const id = newId();
      const ts = now();
      const cleaned = sanitizePresetSettings(input.settings as ChatPresetSettings, input.mode);
      await db.insert(chatPresets).values({
        id,
        name: input.name,
        mode: input.mode,
        isDefault: "false",
        isActive: "false",
        settings: JSON.stringify(cleaned),
        createdAt: ts,
        updatedAt: ts,
      });
      return storage.getById(id);
    },

    async update(id: string, data: UpdateChatPresetInput) {
      const existing = await storage.getById(id);
      if (!existing) return null;
      const patch: Record<string, unknown> = { updatedAt: now() };
      if (data.name !== undefined) patch.name = data.name;
      if (data.settings !== undefined) {
        // Default preset must always have empty settings — refuse to write into it.
        if (existing.isDefault) {
          patch.settings = JSON.stringify({});
        } else {
          patch.settings = JSON.stringify(sanitizePresetSettings(data.settings as ChatPresetSettings, existing.mode));
        }
      }
      await db.update(chatPresets).set(patch).where(eq(chatPresets.id, id));
      return storage.getById(id);
    },

    /** Replace the preset's settings with a sanitized snapshot (used by "Save" button). */
    async saveSettings(id: string, settings: ChatPresetSettings) {
      const existing = await storage.getById(id);
      if (!existing) return null;
      if (existing.isDefault) return existing; // never mutate the default preset's settings
      const cleaned = sanitizePresetSettings(settings, existing.mode);
      await db
        .update(chatPresets)
        .set({ settings: JSON.stringify(cleaned), updatedAt: now() })
        .where(eq(chatPresets.id, id));
      return storage.getById(id);
    },

    async remove(id: string) {
      const existing = await storage.getById(id);
      if (!existing) return false;
      if (existing.isDefault) return false; // refuse to delete the system default
      await db.delete(chatPresets).where(eq(chatPresets.id, id));
      // If we deleted the active preset, fall back to the default for that mode.
      if (existing.isActive) {
        const fallback = await storage.getDefault(existing.mode);
        if (fallback) await storage.setActive(fallback.id);
      }
      return true;
    },

    async setActive(id: string) {
      const target = await storage.getById(id);
      if (!target) return null;
      const ts = now();
      // Clear any other active flag for this mode, then set this one.
      await db
        .update(chatPresets)
        .set({ isActive: "false", updatedAt: ts })
        .where(and(eq(chatPresets.mode, target.mode), ne(chatPresets.id, id)));
      await db.update(chatPresets).set({ isActive: "true", updatedAt: ts }).where(eq(chatPresets.id, id));
      return storage.getById(id);
    },

    async duplicate(id: string, newName?: string) {
      const source = await storage.getById(id);
      if (!source) return null;
      const newPresetId = newId();
      const ts = now();
      await db.insert(chatPresets).values({
        id: newPresetId,
        name: newName ?? `${source.name} Copy`,
        mode: source.mode,
        isDefault: "false",
        isActive: "false",
        settings: JSON.stringify(sanitizePresetSettings(source.settings, source.mode)),
        createdAt: ts,
        updatedAt: ts,
      });
      return storage.getById(newPresetId);
    },

    /** Insert a preset from an imported envelope. Always created as inactive, non-default. */
    async importPreset(payload: { name: string; mode: ChatMode; settings: ChatPresetSettings }) {
      return storage.create({
        name: payload.name,
        mode: payload.mode,
        settings: sanitizePresetSettings(payload.settings, payload.mode),
      });
    },

    /**
     * Replace a chat's preset-controlled settings with those from a preset.
     *
     * Chat-specific keys (sprites, summary, tags, scene prompt, ephemeral
     * lorebook overrides, group scenario, etc.) are preserved from the
     * existing chat metadata. Everything else is reset to the preset's
     * snapshot, with system defaults filled in for keys the preset doesn't
     * specify. Selecting the Default preset therefore resets the chat's
     * preset-controlled settings to their system defaults.
     */
    async applyToChat(presetId: string, chatId: string) {
      const preset = await storage.getById(presetId);
      if (!preset) return null;
      const rows = await db.select().from(chats).where(eq(chats.id, chatId));
      const chatRow = rows[0];
      if (!chatRow) return null;

      const currentMetadata: Record<string, unknown> = (() => {
        try {
          return chatRow.metadata ? JSON.parse(chatRow.metadata) : {};
        } catch {
          return {};
        }
      })();

      // Preserve only chat-specific (non-preset) metadata keys.
      const preserved: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(currentMetadata)) {
        if (isPresetExcludedMetadataKey(key)) preserved[key] = value;
      }

      const baseDefaults: Record<string, unknown> = {
        summary: null,
        tags: [],
        enableAgents: true,
        agentOverrides: {},
        activeAgentIds: [],
        activeToolIds: [],
      };

      const presetMetadata = (preset.settings.metadata ?? {}) as Record<string, unknown>;

      const newMetadata: Record<string, unknown> = {
        ...baseDefaults,
        ...presetMetadata,
        ...preserved,
        appliedChatPresetId: preset.id,
      };

      const ts = now();
      await db
        .update(chats)
        .set({
          connectionId: preset.settings.connectionId ?? null,
          promptPresetId: chatRow.mode === "conversation" ? null : (preset.settings.promptPresetId ?? null),
          metadata: JSON.stringify(newMetadata),
          updatedAt: ts,
        })
        .where(eq(chats.id, chatId));

      const updatedRows = await db.select().from(chats).where(eq(chats.id, chatId));
      return updatedRows[0] ?? null;
    },

    /** Ensure a "Default" preset exists for every chat mode and exactly one preset is active per mode. */
    async ensureDefaults() {
      for (const mode of CHAT_MODES) {
        const existing = await storage.getDefault(mode);
        let defaultId = existing?.id ?? null;
        if (!defaultId) {
          const id = newId();
          const ts = now();
          await db.insert(chatPresets).values({
            id,
            name: "Default",
            mode,
            isDefault: "true",
            isActive: "false",
            settings: JSON.stringify({}),
            createdAt: ts,
            updatedAt: ts,
          });
          defaultId = id;
        }
        const active = await storage.getActive(mode);
        if (!active && defaultId) {
          await storage.setActive(defaultId);
        }
      }
    },
  };
  return storage;
}

export type ChatPresetsStorage = ReturnType<typeof createChatPresetsStorage>;
