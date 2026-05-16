import type {
  ChatSummaryEntry,
  ChatSummaryEntryKind,
  ChatSummaryEntryOrigin,
  ChatSummaryEntrySource,
} from "../types/chat.js";

const VALID_KINDS = new Set<ChatSummaryEntryKind>(["rolling"]);
const VALID_ORIGINS = new Set<ChatSummaryEntryOrigin>(["manual", "automated", "legacy"]);
const VALID_SOURCES = new Set<ChatSummaryEntrySource>(["last", "range", "agent"]);

export type ChatSummaryEntryInput = Partial<ChatSummaryEntry> & {
  content: string;
};

export interface ChatSummaryEntryNormalizeOptions {
  legacySummary?: string | null;
  createId?: () => string;
  now?: string;
}

function defaultNow() {
  return new Date().toISOString();
}

function fallbackId(prefix: string, seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIsoTimestamp(value: unknown, fallback: string) {
  const text = trimString(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : fallback;
}

function normalizePositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizeMessageIds(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const ids = Array.from(new Set(value.filter((id): id is string => typeof id === "string" && id.trim().length > 0)));
  return ids.length > 0 ? ids : undefined;
}

function sourceFromOrigin(origin: ChatSummaryEntryOrigin): ChatSummaryEntrySource {
  return origin === "automated" ? "agent" : "last";
}

/** Cheap token approximation for UI and metadata. */
export function estimateChatSummaryTokens(content: string): number {
  const normalized = content.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

/** Generate a concise default title from an entry's origin and source metadata. */
export function generateChatSummaryEntryTitle(entry: Pick<
  ChatSummaryEntry,
  "origin" | "sourceMode" | "messageCount" | "rangeStartIndex" | "rangeEndIndex"
>): string {
  if (entry.origin === "legacy") return "Legacy summary";
  if (entry.origin === "automated") return "Automated summary";
  if (entry.sourceMode === "range" && entry.rangeStartIndex && entry.rangeEndIndex) {
    return `Summary messages ${entry.rangeStartIndex}-${entry.rangeEndIndex}`;
  }
  if (entry.messageCount) return `Summary of ${entry.messageCount} messages`;
  return "Manual summary";
}

export function createLegacyChatSummaryEntry(
  summary: string | null | undefined,
  options: ChatSummaryEntryNormalizeOptions = {},
): ChatSummaryEntry | null {
  const content = trimString(summary);
  if (!content) return null;
  const now = options.now ?? defaultNow();
  const id = options.createId?.() ?? fallbackId("summary-legacy", content);
  return {
    id,
    kind: "rolling",
    origin: "legacy",
    title: "Legacy summary",
    content,
    enabled: true,
    sourceMode: "last",
    tokenEstimate: estimateChatSummaryTokens(content),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeChatSummaryEntry(
  raw: unknown,
  options: ChatSummaryEntryNormalizeOptions = {},
): ChatSummaryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const content = trimString(value.content);
  if (!content) return null;

  const now = options.now ?? defaultNow();
  const origin = VALID_ORIGINS.has(value.origin as ChatSummaryEntryOrigin)
    ? (value.origin as ChatSummaryEntryOrigin)
    : "legacy";
  const sourceMode = VALID_SOURCES.has(value.sourceMode as ChatSummaryEntrySource)
    ? (value.sourceMode as ChatSummaryEntrySource)
    : sourceFromOrigin(origin);
  const base: ChatSummaryEntry = {
    id: trimString(value.id) || options.createId?.() || fallbackId("summary", `${origin}:${content}:${now}`),
    kind: VALID_KINDS.has(value.kind as ChatSummaryEntryKind) ? (value.kind as ChatSummaryEntryKind) : "rolling",
    origin,
    title: trimString(value.title),
    content,
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    sourceMode,
    tokenEstimate:
      typeof value.tokenEstimate === "number" && Number.isFinite(value.tokenEstimate) && value.tokenEstimate >= 0
        ? Math.round(value.tokenEstimate)
        : estimateChatSummaryTokens(content),
    createdAt: normalizeIsoTimestamp(value.createdAt, now),
    updatedAt: normalizeIsoTimestamp(value.updatedAt, now),
  };

  const messageCount = normalizePositiveInteger(value.messageCount);
  if (messageCount !== undefined) base.messageCount = messageCount;
  const rangeStartIndex = normalizePositiveInteger(value.rangeStartIndex);
  if (rangeStartIndex !== undefined) base.rangeStartIndex = rangeStartIndex;
  const rangeEndIndex = normalizePositiveInteger(value.rangeEndIndex);
  if (rangeEndIndex !== undefined) base.rangeEndIndex = rangeEndIndex;
  const messageIds = normalizeMessageIds(value.messageIds);
  if (messageIds) base.messageIds = messageIds;
  if (typeof value.promptTemplateId === "string") {
    base.promptTemplateId = value.promptTemplateId.trim() || null;
  } else if (value.promptTemplateId === null) {
    base.promptTemplateId = null;
  }

  if (!base.title) base.title = generateChatSummaryEntryTitle(base);
  return base;
}

export function createChatSummaryEntry(
  input: ChatSummaryEntryInput,
  options: ChatSummaryEntryNormalizeOptions = {},
): ChatSummaryEntry {
  const entry = normalizeChatSummaryEntry(
    {
      ...input,
      id: input.id || options.createId?.(),
      createdAt: input.createdAt ?? options.now,
      updatedAt: input.updatedAt ?? options.now,
    },
    options,
  );
  if (!entry) {
    throw new Error("Chat summary entry content is required");
  }
  return entry;
}

export function sortChatSummaryEntries(entries: ChatSummaryEntry[]): ChatSummaryEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aRange = a.entry.rangeStartIndex ?? Number.MAX_SAFE_INTEGER;
      const bRange = b.entry.rangeStartIndex ?? Number.MAX_SAFE_INTEGER;
      if (aRange !== bRange) return aRange - bRange;
      const created = Date.parse(a.entry.createdAt) - Date.parse(b.entry.createdAt);
      if (created !== 0) return created;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

export function normalizeChatSummaryEntries(
  rawEntries: unknown,
  options: ChatSummaryEntryNormalizeOptions = {},
): ChatSummaryEntry[] {
  const seen = new Set<string>();
  const entries = (Array.isArray(rawEntries) ? rawEntries : [])
    .map((entry) => normalizeChatSummaryEntry(entry, options))
    .filter((entry): entry is ChatSummaryEntry => !!entry)
    .map((entry) => {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        return entry;
      }
      const replacementId = options.createId?.() ?? fallbackId("summary", `${entry.id}:${entry.content}:${seen.size}`);
      seen.add(replacementId);
      return { ...entry, id: replacementId };
    });

  if (entries.length === 0) {
    const legacy = createLegacyChatSummaryEntry(options.legacySummary, options);
    if (legacy) entries.push(legacy);
  }

  return sortChatSummaryEntries(entries);
}

export function compileChatSummaryEntries(entries: ChatSummaryEntry[]): string | null {
  const compiled = sortChatSummaryEntries(entries)
    .filter((entry) => entry.enabled)
    .map((entry) => entry.content.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return compiled || null;
}

export function appendChatSummaryEntryToMetadata(
  metadata: Record<string, unknown>,
  input: ChatSummaryEntryInput,
  options: ChatSummaryEntryNormalizeOptions = {},
): { entry: ChatSummaryEntry; entries: ChatSummaryEntry[]; summary: string | null } {
  const entries = normalizeChatSummaryEntries(metadata.summaryEntries, {
    ...options,
    legacySummary: typeof metadata.summary === "string" ? metadata.summary : null,
  });
  const entry = createChatSummaryEntry(input, options);
  const nextEntries = sortChatSummaryEntries([...entries, entry]);
  return {
    entry,
    entries: nextEntries,
    summary: compileChatSummaryEntries(nextEntries),
  };
}
