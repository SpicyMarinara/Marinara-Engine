// ──────────────────────────────────────────────
// Seed: Default OpenRouter Free Connection
// Creates a pre-configured OpenRouter free-tier connection for new users.
// ──────────────────────────────────────────────
import { logger } from "../lib/logger.js";
import type { DB } from "./connection.js";
import { apiConnections } from "./schema/connections.js";
import { eq } from "drizzle-orm";
import { DEFAULT_CONNECTION_ID } from "@marinara-engine/shared";

export async function seedDefaultConnection(db: DB) {
  // Check if it already exists
  const existing = await db.select().from(apiConnections).where(eq(apiConnections.id, DEFAULT_CONNECTION_ID));

  if (existing.length > 0) return;

  const anyExistingConnections = await db.select({ id: apiConnections.id }).from(apiConnections).limit(1);

  if (anyExistingConnections.length > 0) {
    logger.info("[seed] Skipped default connection seed because saved connections already exist");
    return;
  }

  logger.info("[seed] Skipped default OpenRouter Free connection seed because no bundled API key is provided");
}
