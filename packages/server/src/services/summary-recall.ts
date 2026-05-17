import { and, eq } from "drizzle-orm";
import { normalizeChatSummaryEntries, type ChatMetadata, type ChatSummaryEntry } from "@marinara-engine/shared";
import type { DB } from "../db/connection.js";
import { memoryChunks } from "../db/schema/index.js";
import { newId, now } from "../utils/id-generator.js";
import {
  embedMemoryRecallTexts,
  recallMemories,
  recallThresholdForStrictness,
  type MemoryRecallEmbeddingOptions,
  type RecalledMemory,
} from "./memory-recall.js";

const SUMMARY_SOURCE_KIND = "rolling_summary" as const;

function buildRollingSummaryRecallText(entry: ChatSummaryEntry): string {
  return [
    `Title: ${entry.title}`,
    `Origin: ${entry.origin}`,
    `Source: ${entry.sourceMode}`,
    `Summary:`,
    entry.content.trim(),
  ].join("\n");
}

function enabledSummaryEntries(metadata: Pick<ChatMetadata, "summary" | "summaryEntries">): ChatSummaryEntry[] {
  return normalizeChatSummaryEntries(metadata.summaryEntries, {
    legacySummary: typeof metadata.summary === "string" ? metadata.summary : null,
  }).filter((entry) => entry.enabled && entry.content.trim());
}

export async function deleteRollingSummaryRecallChunks(db: DB, chatId: string): Promise<void> {
  await db
    .delete(memoryChunks)
    .where(and(eq(memoryChunks.chatId, chatId), eq(memoryChunks.sourceKind, SUMMARY_SOURCE_KIND)));
}

export async function syncRollingSummaryRecallChunks(
  db: DB,
  chatId: string,
  metadata: Pick<ChatMetadata, "summary" | "summaryEntries">,
  embeddingOptions: MemoryRecallEmbeddingOptions = {},
): Promise<number> {
  const entries = enabledSummaryEntries(metadata);
  const activeIds = new Set(entries.map((entry) => entry.id));
  const existing = await db
    .select({
      id: memoryChunks.id,
      embedding: memoryChunks.embedding,
      sourceId: memoryChunks.sourceId,
      sourceUpdatedAt: memoryChunks.sourceUpdatedAt,
    })
    .from(memoryChunks)
    .where(and(eq(memoryChunks.chatId, chatId), eq(memoryChunks.sourceKind, SUMMARY_SOURCE_KIND)));

  for (const chunk of existing) {
    if (!chunk.sourceId || !activeIds.has(chunk.sourceId)) {
      await db.delete(memoryChunks).where(eq(memoryChunks.id, chunk.id));
    }
  }

  const existingBySourceId = new Map(
    existing
      .filter((chunk) => chunk.sourceId && activeIds.has(chunk.sourceId))
      .map((chunk) => [chunk.sourceId!, chunk]),
  );

  for (const entry of entries) {
    const current = existingBySourceId.get(entry.id);
    if (current?.sourceUpdatedAt === entry.updatedAt && current.embedding) continue;

    if (current) {
      await db.delete(memoryChunks).where(eq(memoryChunks.id, current.id));
    }

    const content = buildRollingSummaryRecallText(entry);
    const embeddings = await embedMemoryRecallTexts([content], embeddingOptions);
    const timestamp = now();
    await db.insert(memoryChunks).values({
      id: newId(),
      chatId,
      content,
      embedding: embeddings[0] ? JSON.stringify(embeddings[0]) : null,
      sourceKind: SUMMARY_SOURCE_KIND,
      sourceId: entry.id,
      sourceUpdatedAt: entry.updatedAt,
      messageCount: 0,
      firstMessageAt: entry.createdAt,
      lastMessageAt: entry.updatedAt,
      createdAt: timestamp,
    });
  }

  const synced = await db
    .select({ id: memoryChunks.id })
    .from(memoryChunks)
    .where(and(eq(memoryChunks.chatId, chatId), eq(memoryChunks.sourceKind, SUMMARY_SOURCE_KIND)));
  return synced.length;
}

export async function recallRollingSummaries(
  db: DB,
  chatId: string,
  query: string,
  options: MemoryRecallEmbeddingOptions & {
    topK?: number;
    strictness?: ChatMetadata["summaryRecallStrictness"];
  } = {},
): Promise<RecalledMemory[]> {
  return recallMemories(db, query, [chatId], {
    ...options,
    sourceKinds: [SUMMARY_SOURCE_KIND],
    topK: options.topK,
    threshold: recallThresholdForStrictness(options.strictness),
  });
}
