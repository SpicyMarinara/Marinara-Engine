import type { AgentContext } from "@marinara-engine/shared";
import { createLorebooksStorage } from "../../services/storage/lorebooks.storage.js";

export interface LorebookKeeperSettings {
  targetLorebookId: string | null;
  readBehindMessages: number;
}

export interface ExistingLorebookEntrySummary {
  name: string;
  keys: string[];
  locked: boolean;
}

type LorebooksStore = ReturnType<typeof createLorebooksStorage>;

type LorebookKeeperMessage = {
  id: string;
  role: string;
  content: string;
  characterId?: string | null;
};

const MAX_READ_BEHIND_MESSAGES = 100;

function normalizeNonNegativeInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function isEnabledLorebook(value: unknown): boolean {
  return value === true || value === "true";
}

function getAssistantMessages<T extends { id: string; role: string }>(messages: T[]): T[] {
  return messages.filter((message) => message.role === "assistant");
}

function findMessageIndex<T extends { id: string }>(messages: T[], messageId: string | null): number {
  if (!messageId) return -1;
  return messages.findIndex((message) => message.id === messageId);
}

export function getLorebookKeeperSettings(chatMeta: Record<string, unknown>): LorebookKeeperSettings {
  const targetLorebookId =
    typeof chatMeta.lorebookKeeperTargetLorebookId === "string" && chatMeta.lorebookKeeperTargetLorebookId.trim()
      ? chatMeta.lorebookKeeperTargetLorebookId.trim()
      : null;

  return {
    targetLorebookId,
    readBehindMessages: normalizeNonNegativeInteger(
      chatMeta.lorebookKeeperReadBehindMessages,
      0,
      MAX_READ_BEHIND_MESSAGES,
    ),
  };
}

export async function resolveLorebookKeeperTarget(args: {
  lorebooksStore: LorebooksStore;
  chatId: string;
  characterIds: string[];
  activeLorebookIds: string[];
  preferredTargetLorebookId: string | null;
}): Promise<{
  writableLorebookIds: string[];
  targetLorebookId: string | null;
  targetLorebookName: string | null;
}> {
  const { lorebooksStore, chatId, characterIds, activeLorebookIds, preferredTargetLorebookId } = args;
  const allBooks = (await lorebooksStore.list()) as unknown as Array<{
    id: string;
    name?: string | null;
    enabled?: unknown;
    characterId?: string | null;
    chatId?: string | null;
  }>;

  const relevantBooks = allBooks.filter((book) => {
    if (preferredTargetLorebookId && book.id === preferredTargetLorebookId) return true;
    if (!isEnabledLorebook(book.enabled)) return false;
    if (activeLorebookIds.includes(book.id)) return true;
    if (book.characterId && characterIds.includes(book.characterId)) return true;
    if (book.chatId && book.chatId === chatId) return true;
    return false;
  });

  const uniqueBooks = [...new Map(relevantBooks.map((book) => [book.id, book])).values()];
  uniqueBooks.sort((left, right) => {
    const leftPreferred = preferredTargetLorebookId && left.id === preferredTargetLorebookId ? 0 : 1;
    const rightPreferred = preferredTargetLorebookId && right.id === preferredTargetLorebookId ? 0 : 1;
    if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;

    const leftChatScoped = left.chatId === chatId ? 0 : 1;
    const rightChatScoped = right.chatId === chatId ? 0 : 1;
    return leftChatScoped - rightChatScoped;
  });

  const writableLorebookIds = uniqueBooks.map((book) => book.id);
  const targetLorebookId =
    preferredTargetLorebookId && writableLorebookIds.includes(preferredTargetLorebookId)
      ? preferredTargetLorebookId
      : (writableLorebookIds[0] ?? null);
  const targetLorebookName = uniqueBooks.find((book) => book.id === targetLorebookId)?.name?.trim() ?? null;

  return { writableLorebookIds, targetLorebookId, targetLorebookName };
}

export async function loadLorebookKeeperExistingEntries(
  lorebooksStore: LorebooksStore,
  targetLorebookId: string | null,
): Promise<ExistingLorebookEntrySummary[]> {
  if (!targetLorebookId) return [];

  const entries = (await lorebooksStore.listEntries(targetLorebookId)) as Array<{
    name?: string | null;
    keys?: string[] | null;
    locked?: unknown;
  }>;

  return entries
    .filter((entry) => typeof entry.name === "string" && entry.name.trim().length > 0)
    .map((entry) => ({
      name: entry.name!.trim(),
      keys: Array.isArray(entry.keys) ? entry.keys.filter((key) => typeof key === "string") : [],
      locked: entry.locked === true || entry.locked === "true",
    }));
}

export function getLorebookKeeperAutomaticTarget<T extends { id: string; role: string }>(
  messages: T[],
  readBehindMessages: number,
): T | null {
  if (readBehindMessages <= 0) return null;
  const assistants = getAssistantMessages(messages);
  return assistants[assistants.length - readBehindMessages] ?? null;
}

export function getLorebookKeeperAutomaticPendingCount<T extends { id: string; role: string }>(
  messages: T[],
  readBehindMessages: number,
  lastProcessedMessageId: string | null,
): number {
  const assistants = getAssistantMessages(messages);
  const targetIndex = readBehindMessages <= 0 ? assistants.length : assistants.length - readBehindMessages;
  if (targetIndex < 0) return 0;

  const lastProcessedIndex = findMessageIndex(assistants, lastProcessedMessageId);
  if (lastProcessedIndex >= 0) {
    return Math.max(targetIndex - lastProcessedIndex, 0);
  }
  return targetIndex + 1;
}

export function getLorebookKeeperBackfillTargets<T extends { id: string; role: string }>(
  messages: T[],
  readBehindMessages: number,
  lastProcessedMessageId: string | null,
): T[] {
  const assistants = getAssistantMessages(messages);
  const eligibleCount = Math.max(assistants.length - Math.max(readBehindMessages, 0), 0);
  const eligibleAssistants = assistants.slice(0, eligibleCount);
  const lastProcessedIndex = findMessageIndex(eligibleAssistants, lastProcessedMessageId);
  return lastProcessedIndex >= 0 ? eligibleAssistants.slice(lastProcessedIndex + 1) : eligibleAssistants;
}

export function buildHistoricalLorebookKeeperContext<T extends LorebookKeeperMessage>(
  baseContext: AgentContext,
  messages: T[],
  targetMessageId: string,
): AgentContext | null {
  const targetIndex = messages.findIndex((message) => message.id === targetMessageId);
  if (targetIndex < 0) return null;

  const targetMessage = messages[targetIndex]!;
  return {
    ...baseContext,
    recentMessages: messages.slice(0, targetIndex).map((message) => ({
      role: message.role,
      content: message.content,
      characterId: message.characterId ?? undefined,
    })),
    mainResponse: targetMessage.content,
  };
}

export async function persistLorebookKeeperUpdates(args: {
  lorebooksStore: LorebooksStore;
  chatId: string;
  chatName: string | null | undefined;
  preferredTargetLorebookId: string | null;
  writableLorebookIds: string[] | null;
  updates: Array<Record<string, unknown>>;
}): Promise<string | null> {
  const { lorebooksStore, chatId, chatName, preferredTargetLorebookId, writableLorebookIds, updates } = args;

  let targetLorebookId = preferredTargetLorebookId ?? writableLorebookIds?.[0] ?? null;
  if (!targetLorebookId) {
    const created = await lorebooksStore.create({
      name: `Auto-generated (${chatName || chatId})`,
      description: "Automatically created by the Lorebook Keeper agent",
      category: "uncategorized",
      chatId,
      enabled: true,
      generatedBy: "agent",
      sourceAgentId: "lorebook-keeper",
    });
    targetLorebookId = (created as { id?: string } | null)?.id ?? null;
  }

  if (!targetLorebookId) return null;

  const existingEntries = (await lorebooksStore.listEntries(targetLorebookId)) as unknown as Array<{
    id: string;
    name?: string | null;
    locked?: unknown;
  }>;
  const entryByName = new Map(existingEntries.map((entry) => [entry.name?.toLowerCase(), entry]));

  for (const update of updates) {
    const rawName = typeof update.entryName === "string" ? update.entryName.trim() : "";
    if (!rawName) continue;

    const content = typeof update.content === "string" ? update.content : "";
    const keys = Array.isArray(update.keys) ? update.keys.filter((key): key is string => typeof key === "string") : [];
    const tag = typeof update.tag === "string" ? update.tag : "";
    const existing = entryByName.get(rawName.toLowerCase());

    if (existing && (existing.locked === true || existing.locked === "true")) {
      continue;
    }

    if (existing) {
      await lorebooksStore.updateEntry(existing.id, { content, keys, tag });
      entryByName.set(rawName.toLowerCase(), existing);
      continue;
    }

    const created = await lorebooksStore.createEntry({
      lorebookId: targetLorebookId,
      name: rawName,
      content,
      keys,
      tag,
      enabled: true,
    });
    if (created && typeof created === "object" && "id" in created) {
      entryByName.set(rawName.toLowerCase(), created as { id: string; name?: string | null; locked?: unknown });
    }
  }

  return targetLorebookId;
}
