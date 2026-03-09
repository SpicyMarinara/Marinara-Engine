// ──────────────────────────────────────────────
// Storage: Chat Gallery Images
// ──────────────────────────────────────────────
import { eq, desc } from "drizzle-orm";
import type { DB } from "../../db/connection.js";
import { chatImages } from "../../db/schema/index.js";
import { newId, now } from "../../utils/id-generator.js";

export interface CreateChatImageInput {
  chatId: string;
  filePath: string;
  prompt?: string;
  provider?: string;
  model?: string;
  width?: number;
  height?: number;
}

export function createGalleryStorage(db: DB) {
  return {
    async listByChatId(chatId: string) {
      return db.select().from(chatImages).where(eq(chatImages.chatId, chatId)).orderBy(desc(chatImages.createdAt));
    },

    async getById(id: string) {
      const rows = await db.select().from(chatImages).where(eq(chatImages.id, id));
      return rows[0] ?? null;
    },

    async create(input: CreateChatImageInput) {
      const id = newId();
      await db.insert(chatImages).values({
        id,
        chatId: input.chatId,
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
      await db.delete(chatImages).where(eq(chatImages.id, id));
    },

    async removeAllForChat(chatId: string) {
      await db.delete(chatImages).where(eq(chatImages.chatId, chatId));
    },
  };
}
