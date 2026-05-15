import {
  PROVIDERS,
  generationParametersSchema,
  type GameState,
  type GenerationParameters,
} from "@marinara-engine/shared";
import { wrapContent } from "../../services/prompt/format-engine.js";

export type SimpleMessage = { role: "system" | "user" | "assistant"; content: string };
export type StoredGenerationParameters = Partial<GenerationParameters>;
export type PromptAttachment = {
  type?: string | null;
  url?: string | null;
  data?: string | null;
  filename?: string | null;
  name?: string | null;
  prompt?: string | null;
  galleryId?: string | null;
};

const TEXT_ATTACHMENT_CHAR_LIMIT = 60_000;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "csv",
  "json",
  "jsonl",
  "log",
  "markdown",
  "md",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function shouldAbortOnPassiveGenerationDisconnect(args: {
  chatMode: string;
  impersonate?: boolean;
}): boolean {
  return args.chatMode !== "conversation" || args.impersonate === true;
}

export function mergeCustomParameters(
  base: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  if (!next) return merged;
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    const current = merged[key];
    if (isPlainRecord(current) && isPlainRecord(value)) {
      merged[key] = mergeCustomParameters(current, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/** Find last message index matching a role (or predicate). Returns -1 if not found. */
export function findLastIndex(messages: SimpleMessage[], role: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === role) return i;
  }
  return -1;
}

/** Parse a JSON extra field safely. */
export function parseExtra(extra: unknown): Record<string, unknown> {
  if (!extra) return {};
  try {
    return typeof extra === "string" ? JSON.parse(extra) : (extra as Record<string, unknown>);
  } catch {
    return {};
  }
}

export function isMessageHiddenFromAI(message: { extra?: unknown }): boolean {
  return parseExtra(message.extra).hiddenFromAI === true;
}

export function shouldPreferLatestVisibleGameState(input: {
  attachments?: unknown[] | null;
  impersonate?: boolean;
  regenerateMessageId?: string | null;
  userMessage?: string | null;
}): boolean {
  if (input.impersonate === true || !!input.regenerateMessageId) return true;
  return !input.userMessage?.trim() && !(input.attachments?.length);
}

export function resolveVisibleGameStateAnchor(
  messages: Array<{ role?: unknown; id?: unknown; activeSwipeIndex?: unknown }>,
): { messageId: string; swipeIndex: number } | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== "assistant" || typeof message.id !== "string" || !message.id) continue;
    const swipeIndex =
      typeof message.activeSwipeIndex === "number" &&
      Number.isInteger(message.activeSwipeIndex) &&
      message.activeSwipeIndex >= 0
        ? message.activeSwipeIndex
        : 0;
    return { messageId: message.id, swipeIndex };
  }
  return null;
}

export function resolveRegenerationGameStateAnchor(
  messages: Array<{ role?: unknown; id?: unknown; activeSwipeIndex?: unknown }>,
  regenerateMessageId: string | null | undefined,
): { messageId: string; swipeIndex: number } | null {
  if (!regenerateMessageId) return resolveVisibleGameStateAnchor(messages);
  const targetIndex = messages.findIndex((message) => message.id === regenerateMessageId);
  if (targetIndex < 0) return resolveVisibleGameStateAnchor(messages);
  return resolveVisibleGameStateAnchor(messages.slice(0, targetIndex));
}

export function resolveRegenerationGameStateFallbackMessageIds(
  messages: Array<{ role?: unknown; id?: unknown }>,
  regenerateMessageId: string | null | undefined,
): string[] | null {
  if (!regenerateMessageId) return null;
  const targetIndex = messages.findIndex((message) => message.id === regenerateMessageId);
  const boundedMessages = targetIndex >= 0 ? messages.slice(0, targetIndex) : messages;
  const ids = new Set<string>([""]);
  for (const message of boundedMessages) {
    if (message.role === "assistant" && typeof message.id === "string") {
      ids.add(message.id);
    }
  }
  return Array.from(ids);
}

export function getAttachmentFilename(attachment: PromptAttachment): string {
  const rawName = attachment.filename ?? attachment.name;
  return typeof rawName === "string" && rawName.trim() ? rawName.trim() : "attachment";
}

export function extractImageAttachmentDataUrls(attachments: PromptAttachment[] | undefined): string[] {
  return (attachments ?? [])
    .filter((attachment) => typeof attachment.type === "string" && attachment.type.startsWith("image/"))
    .map((attachment) => attachment.data)
    .filter((data): data is string => typeof data === "string" && data.length > 0);
}

function isReadableTextAttachment(attachment: PromptAttachment): boolean {
  const type = typeof attachment.type === "string" ? attachment.type.toLowerCase() : "";
  if (type.startsWith("text/")) return true;
  if (
    type === "application/json" ||
    type === "application/ld+json" ||
    type === "application/xml" ||
    type === "application/x-yaml" ||
    type === "application/yaml"
  ) {
    return true;
  }

  const name = getAttachmentFilename(attachment).toLowerCase();
  const extension = name.includes(".") ? name.split(".").pop() : "";
  return !!extension && TEXT_ATTACHMENT_EXTENSIONS.has(extension);
}

function decodeDataUrlText(dataUrl: string): string | null {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) return null;

  const meta = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  try {
    if (meta.includes(";base64")) {
      return Buffer.from(payload, "base64").toString("utf8");
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildReadableAttachmentBlocks(attachments: PromptAttachment[] | undefined): string[] {
  return (attachments ?? []).flatMap((attachment) => {
    if (!isReadableTextAttachment(attachment) || typeof attachment.data !== "string") return [];
    const decoded = decodeDataUrlText(attachment.data);
    if (!decoded?.trim()) return [];

    const filename = getAttachmentFilename(attachment);
    const type = typeof attachment.type === "string" && attachment.type.trim() ? attachment.type.trim() : "text/plain";
    const trimmed =
      decoded.length > TEXT_ATTACHMENT_CHAR_LIMIT
        ? `${decoded.slice(0, TEXT_ATTACHMENT_CHAR_LIMIT)}\n\n[Attachment truncated after ${TEXT_ATTACHMENT_CHAR_LIMIT} characters.]`
        : decoded;

    return [
      [
        `<attached_file name="${escapeXmlAttribute(filename)}" type="${escapeXmlAttribute(type)}">`,
        trimmed,
        `</attached_file>`,
      ].join("\n"),
    ];
  });
}

export function appendReadableAttachmentsToContent(
  content: string,
  attachments: PromptAttachment[] | undefined,
): string {
  const blocks = buildReadableAttachmentBlocks(attachments);
  if (blocks.length === 0) return content;
  return `${content}${content.trim() ? "\n\n" : ""}${blocks.join("\n\n")}`;
}

/** Resolve the base URL for a connection, falling back to the provider default. */
export function resolveBaseUrl(connection: { baseUrl: string | null; provider: string }): string {
  if (connection.baseUrl) return connection.baseUrl.replace(/\/+$/, "");
  // Subscription/login-backed providers own their endpoint internally, but
  // downstream callers gate on a non-empty baseUrl. Return a sentinel so the
  // gate passes; the provider ignores the value.
  if (connection.provider === "claude_subscription") return "claude-agent-sdk://local";
  if (connection.provider === "openai_chatgpt") return "openai-chatgpt://codex-auth";
  const providerDef = PROVIDERS[connection.provider as keyof typeof PROVIDERS];
  return providerDef?.defaultBaseUrl ?? "";
}

export function shouldEnableAgentsForGeneration({
  chatEnableAgents,
  chatMode,
  impersonate,
  impersonateBlockAgents,
}: {
  chatEnableAgents: boolean;
  chatMode: string;
  impersonate: boolean;
  impersonateBlockAgents: boolean;
}): boolean {
  return chatEnableAgents && chatMode !== "conversation" && !(impersonate && impersonateBlockAgents);
}

export function shouldInjectIdentityFallback({
  chatMode,
  presetId,
}: {
  chatMode: string;
  presetId: string | null | undefined;
}): boolean {
  return chatMode !== "game" && !presetId;
}

/** Parse connection/chat stored generation parameters without injecting schema defaults. */
export function parseStoredGenerationParameters(raw: unknown): StoredGenerationParameters | null {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const result = generationParametersSchema.partial().safeParse(parsed);
  if (result.success) return result.data;

  // Older installs or extension callers may leave one malformed field in an
  // otherwise useful parameter blob. Salvage valid scalar fields instead of
  // dropping the whole advanced-parameter fallback.
  const source = parsed as Record<string, unknown>;
  const out: StoredGenerationParameters = {};
  for (const key of [
    "temperature",
    "topP",
    "topK",
    "minP",
    "maxTokens",
    "maxContext",
    "frequencyPenalty",
    "presencePenalty",
  ] as const) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  if (
    source.reasoningEffort === null ||
    ["low", "medium", "high", "maximum"].includes(String(source.reasoningEffort))
  ) {
    out.reasoningEffort = source.reasoningEffort as StoredGenerationParameters["reasoningEffort"];
  }
  if (source.verbosity === null || ["low", "medium", "high"].includes(String(source.verbosity))) {
    out.verbosity = source.verbosity as StoredGenerationParameters["verbosity"];
  }
  if (typeof source.assistantPrefill === "string") out.assistantPrefill = source.assistantPrefill;
  if (isPlainRecord(source.customParameters)) {
    out.customParameters = source.customParameters;
  }
  for (const key of [
    "squashSystemMessages",
    "showThoughts",
    "useMaxContext",
    "strictRoleFormatting",
    "singleUserMessage",
  ] as const) {
    const value = source[key];
    if (typeof value === "boolean") out[key] = value;
  }
  if (Array.isArray(source.stopSequences) && source.stopSequences.every((item) => typeof item === "string")) {
    out.stopSequences = source.stopSequences;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Inject text into the `</output_format>` section if present,
 * otherwise append to the last user message (or last message overall).
 */
export function injectIntoOutputFormatOrLastUser(
  messages: SimpleMessage[],
  block: string,
  opts?: { indent?: boolean },
): void {
  const prefix = opts?.indent ? "    " : "";
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.content.includes("</output_format>")) {
      messages[i] = {
        ...msg,
        content: msg.content.replace("</output_format>", prefix + block + "\n</output_format>"),
      };
      return;
    }
  }

  const lastIdx = Math.max(findLastIndex(messages, "user"), messages.length - 1);
  const target = messages[lastIdx]!;
  messages[lastIdx] = { ...target, content: target.content + "\n\n" + block };
}

/** Build wrapped field parts from a record of { fieldName: value }. */
export function wrapFields(
  fields: Record<string, string | undefined | null>,
  format: "xml" | "markdown" | "none",
): string[] {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value) parts.push(wrapContent(value, name, format, 2));
  }
  return parts;
}

function trackerCharacterKey(character: Record<string, unknown>) {
  const id = typeof character.characterId === "string" ? character.characterId.trim().toLowerCase() : "";
  const name = typeof character.name === "string" ? character.name.trim().toLowerCase() : "";
  return id || name || null;
}

export function preserveTrackerCharacterUiFields(
  nextCharacters: Array<Record<string, unknown>>,
  previousCharacters: Array<Record<string, unknown>>,
): void {
  const previousByKey = new Map<string, Record<string, unknown>>();
  for (const character of previousCharacters) {
    const key = trackerCharacterKey(character);
    if (key) previousByKey.set(key, character);
  }

  for (const character of nextCharacters) {
    const key = trackerCharacterKey(character);
    const previous = key ? previousByKey.get(key) : null;
    const previousPortraitFocusX = previous?.portraitFocusX;
    const previousPortraitFocusY = previous?.portraitFocusY;
    if (
      typeof character.portraitFocusX !== "number" &&
      typeof previousPortraitFocusX === "number" &&
      Number.isFinite(previousPortraitFocusX)
    ) {
      character.portraitFocusX = previousPortraitFocusX;
    }
    if (
      typeof character.portraitFocusY !== "number" &&
      typeof previousPortraitFocusY === "number" &&
      Number.isFinite(previousPortraitFocusY)
    ) {
      character.portraitFocusY = previousPortraitFocusY;
    }
  }
}

/** Parse game state JSON fields from a DB row. */
export function parseGameStateRow(row: Record<string, unknown>): GameState {
  return {
    id: row.id as string,
    chatId: row.chatId as string,
    messageId: row.messageId as string,
    swipeIndex: row.swipeIndex as number,
    date: row.date as string | null,
    time: row.time as string | null,
    location: row.location as string | null,
    weather: row.weather as string | null,
    temperature: row.temperature as string | null,
    presentCharacters: JSON.parse((row.presentCharacters as string) ?? "[]"),
    recentEvents: JSON.parse((row.recentEvents as string) ?? "[]"),
    playerStats: row.playerStats ? JSON.parse(row.playerStats as string) : null,
    personaStats: row.personaStats ? JSON.parse(row.personaStats as string) : null,
    createdAt: row.createdAt as string,
  };
}
