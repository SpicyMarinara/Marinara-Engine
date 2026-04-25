// ──────────────────────────────────────────────
// Seed: Default OpenRouter Free Connection
// Creates a pre-configured OpenRouter free-tier connection for new users.
// ──────────────────────────────────────────────
import { logger } from "../lib/logger.js";
import type { DB } from "./connection.js";
import { apiConnections } from "./schema/connections.js";
import { eq } from "drizzle-orm";
import { DEFAULT_CONNECTION_ID } from "@marinara-engine/shared";
import { encryptApiKey } from "../utils/crypto.js";

const CONNECTION_NAME = "OpenRouter Free";
const PROVIDER = "openrouter" as const;
const BASE_URL = "https://openrouter.ai/api/v1";
const MODEL = "openrouter/free";
const API_KEY = "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";

const now = () => new Date().toISOString();

export async function seedDefaultConnection(db: DB) {
  // Check if it already exists
  const existing = await db.select().from(apiConnections).where(eq(apiConnections.id, DEFAULT_CONNECTION_ID));

  if (existing.length > 0) return;

  const anyExistingConnections = await db.select({ id: apiConnections.id }).from(apiConnections).limit(1);

  if (anyExistingConnections.length > 0) {
    logger.info("[seed] Skipped default connection seed because saved connections already exist");
    return;
  }

  await db.insert(apiConnections).values({
    id: DEFAULT_CONNECTION_ID,
    name: CONNECTION_NAME,
    provider: PROVIDER,
    baseUrl: BASE_URL,
    model: MODEL,
    apiKeyEncrypted: encryptApiKey(API_KEY),
    maxContext: 128000,
    isDefault: "true",
    useForRandom: "false",
    enableCaching: "false",
    embeddingModel: null,
    createdAt: now(),
    updatedAt: now(),
  });

  logger.info("[seed] Created default connection: OpenRouter Free");
}
