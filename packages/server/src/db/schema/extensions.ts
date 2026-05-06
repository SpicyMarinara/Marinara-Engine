// ──────────────────────────────────────────────
// Schema: Installed Extensions
// ──────────────────────────────────────────────
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const installedExtensions = sqliteTable("installed_extensions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  css: text("css"),
  js: text("js"),
  enabled: text("enabled").notNull().default("true"),
  installedAt: text("installed_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
