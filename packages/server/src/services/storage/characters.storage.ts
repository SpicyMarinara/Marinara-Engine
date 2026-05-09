// ──────────────────────────────────────────────
// Storage: Characters, Personas & Groups
// ──────────────────────────────────────────────
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { characters, characterCardVersions, personas, characterGroups, personaGroups } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";
import type { CharacterData } from "@marinara-engine/shared";
import { normalizeTimestampOverrides, type TimestampOverrides } from "../import/import-timestamps.js";

function resolveTimestamps(overrides?: TimestampOverrides | null) {
  const normalized = normalizeTimestampOverrides(overrides);
  const createdAt = normalized?.createdAt ?? now();
  return {
    createdAt,
    updatedAt: normalized?.updatedAt ?? createdAt,
  };
}

function parseCharacterData(data: string): CharacterData {
  return JSON.parse(data) as CharacterData;
}

function characterDataChanged(current: CharacterData, next: CharacterData) {
  return JSON.stringify(current) !== JSON.stringify(next);
}

export function createCharactersStorage(db: DB) {
  return {
    // ── Characters ──

    async list() {
      return db.select().from(characters).orderBy(desc(characters.updatedAt));
    },

    async getById(id: string) {
      const rows = await db.select().from(characters).where(eq(characters.id, id));
      return rows[0] ?? null;
    },

    async listVersions(characterId: string) {
      const rows = await db
        .select()
        .from(characterCardVersions)
        .where(eq(characterCardVersions.characterId, characterId))
        .orderBy(desc(characterCardVersions.createdAt));

      return rows.map((row) => ({
        ...row,
        data: parseCharacterData(row.data),
      }));
    },

    async getVersionById(characterId: string, versionId: string) {
      const rows = await db
        .select()
        .from(characterCardVersions)
        .where(and(eq(characterCardVersions.characterId, characterId), eq(characterCardVersions.id, versionId)));
      const row = rows[0];
      if (!row) return null;
      return {
        ...row,
        data: parseCharacterData(row.data),
      };
    },

    async createVersionSnapshot(
      characterId: string,
      options?: { source?: string; reason?: string; createdAt?: string | null },
    ) {
      const existing = await this.getById(characterId);
      if (!existing) return null;
      const currentData = parseCharacterData(existing.data);
      const timestamp = options?.createdAt ?? now();
      const id = newId();
      await db.insert(characterCardVersions).values({
        id,
        characterId,
        data: JSON.stringify(currentData),
        comment: existing.comment ?? "",
        avatarPath: existing.avatarPath ?? null,
        version: currentData.character_version ?? "",
        source: options?.source ?? "manual",
        reason: options?.reason ?? "",
        createdAt: timestamp,
      });
      return this.getVersionById(characterId, id);
    },

    async create(
      data: CharacterData,
      avatarPath?: string,
      timestampOverrides?: TimestampOverrides | null,
      comment?: string | null,
    ) {
      const id = newId();
      const timestamp = resolveTimestamps(timestampOverrides);
      await db.insert(characters).values({
        id,
        data: JSON.stringify(data),
        comment: comment ?? "",
        avatarPath: avatarPath ?? null,
        spriteFolderPath: null,
        createdAt: timestamp.createdAt,
        updatedAt: timestamp.updatedAt,
      });
      return this.getById(id);
    },

    async update(
      id: string,
      data: Partial<CharacterData>,
      avatarPath?: string,
      options?: {
        updatedAt?: string | null;
        comment?: string | null;
        versionSource?: string | null;
        versionReason?: string | null;
        skipVersionSnapshot?: boolean;
      },
    ) {
      const existing = await this.getById(id);
      if (!existing) return null;
      const currentData = parseCharacterData(existing.data);
      const merged = { ...currentData, ...data };
      const nextComment = options?.comment !== undefined ? (options.comment ?? "") : (existing.comment ?? "");
      const nextAvatarPath = avatarPath !== undefined ? avatarPath : existing.avatarPath;
      const shouldSnapshot =
        !options?.skipVersionSnapshot &&
        (characterDataChanged(currentData, merged) ||
          nextComment !== (existing.comment ?? "") ||
          nextAvatarPath !== existing.avatarPath);
      if (shouldSnapshot) {
        await this.createVersionSnapshot(id, {
          source: options?.versionSource ?? "manual",
          reason: options?.versionReason ?? "",
          createdAt: options?.updatedAt ?? null,
        });
      }
      const updatedAt = normalizeTimestampOverrides({
        createdAt: options?.updatedAt,
        updatedAt: options?.updatedAt,
      })?.updatedAt;
      await db
        .update(characters)
        .set({
          data: JSON.stringify(merged),
          ...(options?.comment !== undefined && { comment: nextComment }),
          ...(avatarPath !== undefined && { avatarPath }),
          updatedAt: updatedAt ?? now(),
        })
        .where(eq(characters.id, id));
      return this.getById(id);
    },

    async updateAvatar(id: string, avatarPath: string) {
      const existing = await this.getById(id);
      if (!existing) return null;
      if (existing.avatarPath !== avatarPath) {
        await this.createVersionSnapshot(id, { source: "manual", reason: "Avatar update" });
      }
      await db.update(characters).set({ avatarPath, updatedAt: now() }).where(eq(characters.id, id));
      return this.getById(id);
    },

    async restoreVersion(characterId: string, versionId: string) {
      const version = await this.getVersionById(characterId, versionId);
      if (!version) return null;
      const existing = await this.getById(characterId);
      if (!existing) return null;
      await db
        .update(characters)
        .set({
          data: JSON.stringify(version.data),
          comment: version.comment ?? "",
          avatarPath: version.avatarPath ?? null,
          updatedAt: now(),
        })
        .where(eq(characters.id, characterId));
      return this.getById(characterId);
    },

    async deleteVersion(characterId: string, versionId: string) {
      const version = await this.getVersionById(characterId, versionId);
      if (!version) return false;
      await db
        .delete(characterCardVersions)
        .where(and(eq(characterCardVersions.characterId, characterId), eq(characterCardVersions.id, versionId)));
      return true;
    },

    async remove(id: string) {
      await db.delete(characters).where(eq(characters.id, id));
    },

    async duplicateCharacter(id: string) {
      const source = await this.getById(id);
      if (!source) return null;
      const newCharId = newId();
      const timestamp = now();
      const sourceData = JSON.parse(source.data) as Record<string, unknown>;
      sourceData.name = `${sourceData.name || "Character"} (Copy)`;
      await db.insert(characters).values({
        id: newCharId,
        data: JSON.stringify(sourceData),
        comment: source.comment ?? "",
        avatarPath: source.avatarPath,
        spriteFolderPath: source.spriteFolderPath,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return this.getById(newCharId);
    },

    // ── Personas ──

    async listPersonas() {
      return db.select().from(personas).orderBy(desc(personas.updatedAt));
    },

    async getPersona(id: string) {
      const rows = await db.select().from(personas).where(eq(personas.id, id));
      return rows[0] ?? null;
    },

    async createPersona(
      name: string,
      description: string,
      avatarPath?: string,
      extra?: {
        comment?: string;
        personality?: string;
        scenario?: string;
        backstory?: string;
        appearance?: string;
        nameColor?: string;
        dialogueColor?: string;
        boxColor?: string;
        personaStats?: string;
        altDescriptions?: string;
        tags?: string;
        savedStatusOptions?: string;
      },
      timestampOverrides?: TimestampOverrides | null,
    ) {
      const id = newId();
      const timestamp = resolveTimestamps(timestampOverrides);
      await db.insert(personas).values({
        id,
        name,
        comment: extra?.comment ?? "",
        description,
        personality: extra?.personality ?? "",
        scenario: extra?.scenario ?? "",
        backstory: extra?.backstory ?? "",
        appearance: extra?.appearance ?? "",
        avatarPath: avatarPath ?? null,
        isActive: "false",
        nameColor: extra?.nameColor ?? "",
        dialogueColor: extra?.dialogueColor ?? "",
        boxColor: extra?.boxColor ?? "",
        personaStats: extra?.personaStats ?? "",
        altDescriptions: extra?.altDescriptions ?? "[]",
        tags: extra?.tags ?? "[]",
        savedStatusOptions: extra?.savedStatusOptions ?? "[]",
        createdAt: timestamp.createdAt,
        updatedAt: timestamp.updatedAt,
      });
      return this.getPersona(id);
    },

    async setActivePersona(id: string) {
      // Deactivate all
      await db.update(personas).set({ isActive: "false" });
      // Activate the one
      await db.update(personas).set({ isActive: "true", updatedAt: now() }).where(eq(personas.id, id));
    },

    async removePersona(id: string) {
      await db.delete(personas).where(eq(personas.id, id));
    },

    async duplicatePersona(id: string) {
      const source = await this.getPersona(id);
      if (!source) return null;
      const newPId = newId();
      const timestamp = now();
      await db.insert(personas).values({
        id: newPId,
        name: `${source.name || "Persona"} (Copy)`,
        comment: source.comment ?? "",
        description: source.description ?? "",
        personality: source.personality ?? "",
        scenario: source.scenario ?? "",
        backstory: source.backstory ?? "",
        appearance: source.appearance ?? "",
        avatarPath: source.avatarPath,
        isActive: "false",
        nameColor: source.nameColor ?? "",
        dialogueColor: source.dialogueColor ?? "",
        boxColor: source.boxColor ?? "",
        personaStats: source.personaStats ?? "",
        altDescriptions: source.altDescriptions ?? "[]",
        tags: source.tags ?? "[]",
        savedStatusOptions: source.savedStatusOptions ?? "[]",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return this.getPersona(newPId);
    },

    async updatePersona(
      id: string,
      updates: {
        name?: string;
        comment?: string;
        description?: string;
        personality?: string;
        scenario?: string;
        backstory?: string;
        appearance?: string;
        avatarPath?: string;
        nameColor?: string;
        dialogueColor?: string;
        boxColor?: string;
        personaStats?: string;
        altDescriptions?: string;
        tags?: string;
        savedStatusOptions?: string;
      },
    ) {
      const sets: Record<string, unknown> = { updatedAt: now() };
      if (updates.name !== undefined) sets.name = updates.name;
      if (updates.comment !== undefined) sets.comment = updates.comment;
      if (updates.description !== undefined) sets.description = updates.description;
      if (updates.personality !== undefined) sets.personality = updates.personality;
      if (updates.scenario !== undefined) sets.scenario = updates.scenario;
      if (updates.backstory !== undefined) sets.backstory = updates.backstory;
      if (updates.appearance !== undefined) sets.appearance = updates.appearance;
      if (updates.avatarPath !== undefined) sets.avatarPath = updates.avatarPath;
      if (updates.nameColor !== undefined) sets.nameColor = updates.nameColor;
      if (updates.dialogueColor !== undefined) sets.dialogueColor = updates.dialogueColor;
      if (updates.boxColor !== undefined) sets.boxColor = updates.boxColor;
      if (updates.personaStats !== undefined) sets.personaStats = updates.personaStats;
      if (updates.altDescriptions !== undefined) sets.altDescriptions = updates.altDescriptions;
      if (updates.tags !== undefined) sets.tags = updates.tags;
      if (updates.savedStatusOptions !== undefined) sets.savedStatusOptions = updates.savedStatusOptions;
      await db.update(personas).set(sets).where(eq(personas.id, id));
      return this.getPersona(id);
    },

    // ── Character Groups ──

    async listGroups() {
      return db.select().from(characterGroups).orderBy(desc(characterGroups.updatedAt));
    },

    async getGroupById(id: string) {
      const rows = await db.select().from(characterGroups).where(eq(characterGroups.id, id));
      return rows[0] ?? null;
    },

    async createGroup(name: string, description: string, characterIds: string[] = []) {
      const id = newId();
      const timestamp = now();
      await db.insert(characterGroups).values({
        id,
        name,
        description,
        characterIds: JSON.stringify(characterIds),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return this.getGroupById(id);
    },

    async updateGroup(
      id: string,
      updates: { name?: string; description?: string; characterIds?: string[]; avatarPath?: string },
    ) {
      const existing = await this.getGroupById(id);
      if (!existing) return null;
      await db
        .update(characterGroups)
        .set({
          ...(updates.name !== undefined && { name: updates.name }),
          ...(updates.description !== undefined && { description: updates.description }),
          ...(updates.characterIds !== undefined && { characterIds: JSON.stringify(updates.characterIds) }),
          ...(updates.avatarPath !== undefined && { avatarPath: updates.avatarPath }),
          updatedAt: now(),
        })
        .where(eq(characterGroups.id, id));
      return this.getGroupById(id);
    },

    async removeGroup(id: string) {
      await db.delete(characterGroups).where(eq(characterGroups.id, id));
    },

    // ── Persona Groups ──

    async listPersonaGroups() {
      return db.select().from(personaGroups).orderBy(desc(personaGroups.updatedAt));
    },

    async getPersonaGroupById(id: string) {
      const rows = await db.select().from(personaGroups).where(eq(personaGroups.id, id));
      return rows[0] ?? null;
    },

    async createPersonaGroup(name: string, description: string, personaIds: string[] = []) {
      const id = newId();
      const timestamp = now();
      await db.insert(personaGroups).values({
        id,
        name,
        description,
        personaIds: JSON.stringify(personaIds),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return this.getPersonaGroupById(id);
    },

    async updatePersonaGroup(id: string, updates: { name?: string; description?: string; personaIds?: string[] }) {
      const existing = await this.getPersonaGroupById(id);
      if (!existing) return null;
      await db
        .update(personaGroups)
        .set({
          ...(updates.name !== undefined && { name: updates.name }),
          ...(updates.description !== undefined && { description: updates.description }),
          ...(updates.personaIds !== undefined && { personaIds: JSON.stringify(updates.personaIds) }),
          updatedAt: now(),
        })
        .where(eq(personaGroups.id, id));
      return this.getPersonaGroupById(id);
    },

    async removePersonaGroup(id: string) {
      await db.delete(personaGroups).where(eq(personaGroups.id, id));
    },
  };
}
