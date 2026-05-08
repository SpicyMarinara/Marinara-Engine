import { PROVIDERS } from "@marinara-engine/shared";
import type { DB } from "../db/connection.js";
import { logger } from "../lib/logger.js";
import { isLocalEmbedderAvailable } from "./local-embedder.js";
import { createLLMProvider } from "./llm/provider-registry.js";
import type { MemoryRecallEmbeddingSource } from "./memory-recall.js";
import { createConnectionsStorage } from "./storage/connections.storage.js";

type ConnectionStorage = ReturnType<typeof createConnectionsStorage>;
type ConnectionWithKey = NonNullable<Awaited<ReturnType<ConnectionStorage["getWithKey"]>>>;

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function resolveBaseUrl(connection: { baseUrl: string | null; provider: string }): string {
  if (connection.baseUrl) return connection.baseUrl.replace(/\/+$/, "");
  if (connection.provider === "claude_subscription") return "claude-agent-sdk://local";
  const providerDef = PROVIDERS[connection.provider as keyof typeof PROVIDERS];
  return providerDef?.defaultBaseUrl ?? "";
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function resolveMemoryRecallEmbeddingSource(
  db: DB,
  options: {
    chatMetadata?: unknown;
    connectionId?: string | null;
    activeConnection?: ConnectionWithKey | null;
    activeBaseUrl?: string | null;
  },
): Promise<MemoryRecallEmbeddingSource | null> {
  const connections = createConnectionsStorage(db);
  const activeConnection =
    options.activeConnection ?? (options.connectionId ? await connections.getWithKey(options.connectionId) : null);
  if (!activeConnection) return null;

  const chatMeta = parseMetadata(options.chatMetadata);
  const embeddingConnId =
    nonEmptyString(chatMeta.embeddingConnectionId) ?? nonEmptyString(activeConnection.embeddingConnectionId);

  let embeddingConnection = activeConnection;
  let embeddingBaseUrl = options.activeBaseUrl ?? null;

  if (embeddingConnId) {
    const configuredConnection = await connections.getWithKey(embeddingConnId);
    if (configuredConnection) {
      embeddingConnection = configuredConnection;
      embeddingBaseUrl = resolveBaseUrl(configuredConnection);
    }
  }

  embeddingBaseUrl = nonEmptyString(embeddingConnection.embeddingBaseUrl) ?? embeddingBaseUrl ?? resolveBaseUrl(embeddingConnection);
  const embeddingModel = nonEmptyString(embeddingConnection.embeddingModel);

  if (!embeddingModel || !embeddingBaseUrl) return null;

  const provider = createLLMProvider(
    embeddingConnection.provider,
    embeddingBaseUrl,
    embeddingConnection.apiKey,
    embeddingConnection.maxContext,
    embeddingConnection.openrouterProvider,
    embeddingConnection.maxTokensOverride,
  );
  const label = `${embeddingConnection.name || embeddingConnection.provider} (${embeddingModel})`;

  return {
    label,
    async embed(texts: string[]) {
      try {
        return await provider.embed(texts, embeddingModel);
      } catch (err) {
        logger.warn(err, "[memory-recall] Configured embedding source %s failed", label);
        return null;
      }
    },
  };
}

export async function isMemoryRecallVectorizerAvailable(
  db: DB,
  options: {
    chatMetadata?: unknown;
    connectionId?: string | null;
    activeConnection?: ConnectionWithKey | null;
    activeBaseUrl?: string | null;
  },
): Promise<boolean> {
  if (isLocalEmbedderAvailable()) return true;
  return (await resolveMemoryRecallEmbeddingSource(db, options)) !== null;
}
