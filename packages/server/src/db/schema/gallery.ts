// ──────────────────────────────────────────────
// Schema: Chat Gallery Images
// ──────────────────────────────────────────────
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { chats } from "./chats.ts";
import { characters } from "./characters.ts";

export const chatImages = sqliteTable("chat_images", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  /** File path relative to data/gallery/ */
  filePath: text("file_path").notNull(),
  /** The prompt used to generate this image */
  prompt: text("prompt").notNull().default(""),
  /** Which provider/service generated this image */
  provider: text("provider").notNull().default(""),
  /** Which model/service was used */
  model: text("model").notNull().default(""),
  /** Image width in pixels */
  width: integer("width"),
  /** Image height in pixels */
  height: integer("height"),
  createdAt: text("created_at").notNull(),
});

export const characterImages = sqliteTable("character_images", {
  id: text("id").primaryKey(),
  characterId: text("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  /** File path relative to data/gallery/ */
  filePath: text("file_path").notNull(),
  /** Optional prompt or note associated with this image */
  prompt: text("prompt").notNull().default(""),
  /** Which provider/service generated this image */
  provider: text("provider").notNull().default(""),
  /** Which model/service was used */
  model: text("model").notNull().default(""),
  /** Image width in pixels */
  width: integer("width"),
  /** Image height in pixels */
  height: integer("height"),
  createdAt: text("created_at").notNull(),
});
