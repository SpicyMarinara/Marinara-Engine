// ──────────────────────────────────────────────
// Storage: Character Gallery Images
// ──────────────────────────────────────────────
import { eq, desc } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { characterImages } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";

export interface CreateCharacterImageInput {
  characterId: string;
  filePath: string;
  prompt?: string;
  provider?: string;
  model?: string;
  width?: number;
  height?: number;
}

export function createCharacterGalleryStorage(db: DB) {
  return {
    async listByCharacterId(characterId: string) {
      return db
        .select()
        .from(characterImages)
        .where(eq(characterImages.characterId, characterId))
        .orderBy(desc(characterImages.createdAt));
    },

    async getById(id: string) {
      const rows = await db.select().from(characterImages).where(eq(characterImages.id, id));
      return rows[0] ?? null;
    },

    async create(input: CreateCharacterImageInput) {
      const id = newId();
      await db.insert(characterImages).values({
        id,
        characterId: input.characterId,
        filePath: input.filePath,
        prompt: input.prompt ?? "",
        provider: input.provider ?? "",
        model: input.model ?? "",
        width: input.width ?? null,
        height: input.height ?? null,
        createdAt: now(),
      });
      return this.getById(id);
    },

    async remove(id: string) {
      await db.delete(characterImages).where(eq(characterImages.id, id));
    },
  };
}
