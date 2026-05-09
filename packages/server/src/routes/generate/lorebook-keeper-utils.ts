import type { AgentContext } from "@marinara-engine/shared";
import { createLorebooksStorage } from "../../services/storage/lorebooks.storage.js";

export interface LorebookKeeperSettings {
  targetLorebookId: string | null;
  readBehindMessages: number;
}

export interface ExistingLorebookEntrySummary {
  id: string;
  name: string;
  content: string;
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
  personaId?: string | null;
  activeLorebookIds: string[];
  preferredTargetLorebookId: string | null;
}): Promise<{
  writableLorebookIds: string[];
  targetLorebookId: string | null;
  targetLorebookName: string | null;
}> {
  const { lorebooksStore, chatId, characterIds, personaId, activeLorebookIds, preferredTargetLorebookId } = args;
  const allBooks = (await lorebooksStore.list()) as unknown as Array<{
    id: string;
    name?: string | null;
    enabled?: unknown;
    characterId?: string | null;
    characterIds?: string[] | null;
    personaId?: string | null;
    personaIds?: string[] | null;
    chatId?: string | null;
  }>;

  const relevantBooks = allBooks.filter((book) => {
    if (preferredTargetLorebookId && book.id === preferredTargetLorebookId) return true;
    if (!isEnabledLorebook(book.enabled)) return false;
    if (activeLorebookIds.includes(book.id)) return true;
    if (book.characterIds?.some((characterId) => characterIds.includes(characterId))) return true;
    if (book.characterId && characterIds.includes(book.characterId)) return true;
    if (personaId && book.personaIds?.includes(personaId)) return true;
    if (book.personaId && book.personaId === personaId) return true;
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
    id?: string | null;
    name?: string | null;
    content?: string | null;
    keys?: string[] | null;
    locked?: unknown;
  }>;

  return entries
    .filter((entry) => typeof entry.name === "string" && entry.name.trim().length > 0)
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : "",
      name: entry.name!.trim(),
      content: typeof entry.content === "string" ? entry.content : "",
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

function normalizeKeeperFact(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .replace(/^(?:[-*]|\u2022)\s+/, "")
    .replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizeKeeperFactForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKeeperFacts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const facts: string[] = [];
  for (const entry of value) {
    const fact = normalizeKeeperFact(entry);
    if (!fact) continue;
    const comparable = normalizeKeeperFactForComparison(fact);
    if (seen.has(comparable)) continue;
    seen.add(comparable);
    facts.push(fact);
  }
  return facts;
}

function dedupeKeeperContentParagraphs(content: string): string {
  const paragraphs = content
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const paragraph of paragraphs) {
    const comparable = normalizeKeeperFactForComparison(paragraph);
    if (!comparable || seen.has(comparable)) continue;
    seen.add(comparable);
    deduped.push(paragraph);
  }

  return deduped.join("\n\n");
}

function mergeLorebookKeys(existingKeys: unknown, newKeys: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const add = (key: unknown) => {
    if (typeof key !== "string") return;
    const trimmed = key.trim();
    if (!trimmed) return;
    const comparable = trimmed.toLowerCase();
    if (seen.has(comparable)) return;
    seen.add(comparable);
    merged.push(trimmed);
  };

  if (Array.isArray(existingKeys)) {
    for (const key of existingKeys) add(key);
  }
  for (const key of newKeys) add(key);
  return merged;
}

export function mergeLorebookKeeperUpdateContent(args: {
  existingContent: unknown;
  replacementContent: unknown;
  newFacts: unknown;
}): string {
  const existing =
    typeof args.existingContent === "string" ? dedupeKeeperContentParagraphs(args.existingContent) : "";
  const replacement =
    typeof args.replacementContent === "string" ? dedupeKeeperContentParagraphs(args.replacementContent) : "";
  const facts = normalizeKeeperFacts(args.newFacts);

  if (facts.length === 0) {
    if (!existing) return replacement;
    if (!replacement) return existing;

    const existingComparable = normalizeKeeperFactForComparison(existing);
    const replacementComparable = normalizeKeeperFactForComparison(replacement);
    if (replacementComparable.includes(existingComparable)) return replacement;
    if (existingComparable.includes(replacementComparable)) return existing;

    return dedupeKeeperContentParagraphs(`${existing}\n\n${replacement}`);
  }

  const baseContent =
    existing && replacement ? dedupeKeeperContentParagraphs(`${existing}\n\n${replacement}`) : existing || replacement;
  const existingComparable = normalizeKeeperFactForComparison(baseContent);
  const novelFacts = facts.filter((fact) => {
    const comparable = normalizeKeeperFactForComparison(fact);
    return comparable.length > 0 && !existingComparable.includes(comparable);
  });

  if (novelFacts.length === 0) return baseContent;

  const addition = novelFacts.map((fact) => `- ${fact}`).join("\n");
  return baseContent ? `${baseContent}\n\n${addition}` : addition;
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
    content?: string | null;
    keys?: string[] | null;
    tag?: string | null;
    locked?: unknown;
  }>;
  const entryByName = new Map<string, (typeof existingEntries)[number]>();
  for (const entry of existingEntries) {
    const name = typeof entry.name === "string" ? entry.name.trim().toLowerCase() : "";
    if (name) entryByName.set(name, entry);
  }

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
      const mergedContent = mergeLorebookKeeperUpdateContent({
        existingContent: existing.content,
        replacementContent: content,
        newFacts: update.newFacts,
      });
      const mergedKeys = mergeLorebookKeys(existing.keys, keys);
      const mergedTag = tag || existing.tag || "";
      await lorebooksStore.updateEntry(existing.id, {
        content: mergedContent,
        keys: mergedKeys,
        tag: mergedTag,
      });
      entryByName.set(rawName.toLowerCase(), {
        ...existing,
        content: mergedContent,
        keys: mergedKeys,
        tag: mergedTag,
      });
      continue;
    }

    const createContent = mergeLorebookKeeperUpdateContent({
      existingContent: "",
      replacementContent: content,
      newFacts: update.newFacts,
    });
    const created = await lorebooksStore.createEntry({
      lorebookId: targetLorebookId,
      name: rawName,
      content: createContent,
      keys,
      tag,
      enabled: true,
    });
    if (created && typeof created === "object" && "id" in created) {
      const createdEntry = created as { id: string; name?: string | null; locked?: unknown };
      entryByName.set(rawName.toLowerCase(), {
        ...createdEntry,
        name: createdEntry.name ?? rawName,
        content: createContent,
        keys,
        tag,
      });
    }
  }

  return targetLorebookId;
}
