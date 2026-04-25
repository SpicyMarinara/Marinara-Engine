// ──────────────────────────────────────────────
// Service: Memory Recall
// ──────────────────────────────────────────────
// Chunks conversation messages into groups, embeds them, and provides
// semantic recall: given a query, find the most relevant past
// conversation fragments from specified chats.
import { eq, desc, sql, and } from "drizzle-orm";
import type { DB } from "../db/connection.js";
import { messages, memoryChunks } from "../db/schema/index.js";
import { newId, now } from "../utils/id-generator.js";
import { localEmbed } from "./local-embedder.js";
import { logger } from "../lib/logger.js";
const isLite = process.env.MARINARA_LITE === "true" || process.env.MARINARA_LITE === "1";

/** How many messages per chunk. */
const CHUNK_SIZE = 5;

/** Minimum similarity score to include a memory in results. */
const SIMILARITY_THRESHOLD = 0.25;

/** Maximum number of recalled memories per generation. */
const DEFAULT_TOP_K = 8;

// ── Cosine similarity ──

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Public API ──

export interface RecalledMemory {
  chatId: string;
  content: string;
  similarity: number;
  firstMessageAt: string;
  lastMessageAt: string;
}

/**
 * Chunk any un-chunked messages for a given chat and embed them.
 * Should be called after generation completes (fire-and-forget).
 */
export async function chunkAndEmbedMessages(
  db: DB,
  chatId: string,
  /** Map from role → display name. Used to format "Name: content" lines. */
  nameMap: { userName: string; characterNames: Record<string, string> },
): Promise<void> {
  if (isLite) return;
  // Find the last chunk for this chat to know where to start
  const lastChunk = await db
    .select({ lastMessageAt: memoryChunks.lastMessageAt })
    .from(memoryChunks)
    .where(eq(memoryChunks.chatId, chatId))
    .orderBy(desc(memoryChunks.lastMessageAt))
    .limit(1);

  const after = lastChunk[0]?.lastMessageAt ?? null;

  // Get messages that haven't been chunked yet
  const conditions = [eq(messages.chatId, chatId)];
  if (after) {
    conditions.push(sql`${messages.createdAt} > ${after}`);
  }
  const unchunked = await db
    .select({
      id: messages.id,
      role: messages.role,
      characterId: messages.characterId,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(...conditions))
    .orderBy(messages.createdAt);

  if (unchunked.length < CHUNK_SIZE) return; // not enough to form a chunk yet

  // Group into chunks of CHUNK_SIZE
  const chunksToCreate: Array<{
    content: string;
    messageCount: number;
    firstMessageAt: string;
    lastMessageAt: string;
  }> = [];

  // Only chunk complete groups — leftover messages wait for next round
  const completeCount = Math.floor(unchunked.length / CHUNK_SIZE) * CHUNK_SIZE;
  for (let i = 0; i < completeCount; i += CHUNK_SIZE) {
    const group = unchunked.slice(i, i + CHUNK_SIZE);
    const lines = group.map((m) => {
      const name =
        m.role === "user"
          ? nameMap.userName
          : m.role === "narrator" || m.role === "system"
            ? "Narrator"
            : ((m.characterId && nameMap.characterNames[m.characterId]) ?? "Character");
      return `${name}: ${m.content}`;
    });
    chunksToCreate.push({
      content: lines.join("\n\n"),
      messageCount: group.length,
      firstMessageAt: group[0]!.createdAt,
      lastMessageAt: group[group.length - 1]!.createdAt,
    });
  }

  if (chunksToCreate.length === 0) return;

  // Embed all chunks using local model
  const texts = chunksToCreate.map((c) => c.content);
  const embeddings = (await localEmbed(texts)) ?? [];

  // Store chunks
  const timestamp = now();
  for (let i = 0; i < chunksToCreate.length; i++) {
    const chunk = chunksToCreate[i]!;
    await db.insert(memoryChunks).values({
      id: newId(),
      chatId,
      content: chunk.content,
      embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
      messageCount: chunk.messageCount,
      firstMessageAt: chunk.firstMessageAt,
      lastMessageAt: chunk.lastMessageAt,
      createdAt: timestamp,
    });
  }

  logger.debug("[memory-recall] Created %d chunk(s) for chat %s", chunksToCreate.length, chatId);
}

/**
 * Recall relevant conversation memories for a given query.
 * Searches only the specified chat IDs for relevant chunks.
 */
export async function recallMemories(
  db: DB,
  query: string,
  chatIds: string[],
  topK: number = DEFAULT_TOP_K,
): Promise<RecalledMemory[]> {
  if (isLite) return [];
  if (chatIds.length === 0) return [];

  // Embed the query using local model
  const queryEmbeddings = await localEmbed([query]);
  if (!queryEmbeddings || queryEmbeddings.length === 0) return [];
  const queryEmbedding = queryEmbeddings[0]!;
  if (queryEmbedding.length === 0) return [];

  const matchingChatIds = chatIds.slice(0, 50);

  // Load embedded chunks from matching chats (capped to prevent memory blowup)
  const MAX_CHUNKS = 500;
  const chunks = await db
    .select({
      id: memoryChunks.id,
      chatId: memoryChunks.chatId,
      content: memoryChunks.content,
      embedding: memoryChunks.embedding,
      firstMessageAt: memoryChunks.firstMessageAt,
      lastMessageAt: memoryChunks.lastMessageAt,
    })
    .from(memoryChunks)
    .where(
      sql`${memoryChunks.chatId} IN (${sql.join(
        matchingChatIds.map((id) => sql`${id}`),
        sql`, `,
      )}) AND ${memoryChunks.embedding} IS NOT NULL`,
    )
    .orderBy(sql`${memoryChunks.lastMessageAt} DESC`)
    .limit(MAX_CHUNKS);

  if (chunks.length === 0) return [];

  // Score each chunk by cosine similarity
  const scored = chunks
    .map((chunk) => {
      const embedding: number[] = JSON.parse(chunk.embedding!);
      return {
        chatId: chunk.chatId,
        content: chunk.content,
        similarity: cosineSimilarity(queryEmbedding, embedding),
        firstMessageAt: chunk.firstMessageAt,
        lastMessageAt: chunk.lastMessageAt,
      };
    })
    .filter((s) => s.similarity >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  return scored;
}
