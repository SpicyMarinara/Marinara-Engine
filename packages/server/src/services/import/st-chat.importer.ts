// ──────────────────────────────────────────────
// Importer: SillyTavern Chat (JSONL)
// ──────────────────────────────────────────────
import type { DB } from "../../db/connection.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import type { ChatMode } from "@marinara-engine/shared";
import {
  latestTrustedTimestamp,
  normalizeTimestampOverrides,
  parseTrustedTimestamp,
  type TimestampOverrides,
} from "./import-timestamps.js";

interface STChatHeader {
  user_name?: string;
  character_name?: string;
  chat_metadata?: Record<string, unknown>;
}

interface STChatMessage {
  name: string;
  is_user: boolean;
  is_system?: boolean;
  send_date?: string;
  mes: string;
  extra?: {
    display_text?: string;
    type?: string;
  };
}

interface ParsedSTChatMessageInput {
  role: "system" | "user" | "assistant" | "narrator";
  characterId: string | null;
  content: string;
  parsedCreatedAt: string | null;
}

export interface ImportSTChatOptions {
  /** Link chat to this character ID */
  characterId?: string | null;
  /** Multi-character override; takes precedence over characterId when provided */
  characterIds?: string[];
  /** Override mode (defaults to roleplay) */
  mode?: ChatMode;
  /** Explicitly set the chat name instead of deriving from header */
  chatName?: string;
  /** Optional imported branch/file label for branch UIs */
  branchName?: string;
  /** For group chats: map of speaker name → characterId */
  speakerMap?: Record<string, string>;
  /** Group ID to associate this chat with (for grouping branches) */
  groupId?: string | null;
  /** Persona to attach to the imported chat */
  personaId?: string | null;
  /** Connection to attach to the imported chat */
  connectionId?: string | null;
  /** Prompt preset to attach to the imported chat */
  promptPresetId?: string | null;
  /** Source file timestamps to preserve when trustworthy */
  timestampOverrides?: TimestampOverrides | null;
}

function normalizeTranscriptTimestamps(
  inputs: ParsedSTChatMessageInput[],
  fallbackStart?: TimestampOverrides | null,
): Array<ParsedSTChatMessageInput & { createdAt: string }> {
  // ST exports may contain identical or even backward send_date values.
  // Marinara sorts messages by createdAt, so make the imported transcript
  // strictly monotonic while preserving the source file's line order.
  const fallback = normalizeTimestampOverrides(fallbackStart);
  const firstParsedIndex = inputs.findIndex((input) => input.parsedCreatedAt);
  const firstParsedMs =
    firstParsedIndex >= 0 ? Date.parse(inputs[firstParsedIndex]!.parsedCreatedAt as string) : Number.NaN;
  const fallbackMs = Date.parse(fallback?.createdAt ?? fallback?.updatedAt ?? "");
  const nowMs = Date.now();

  let lastMs: number | null = null;

  return inputs.map((input, index) => {
    const parsedMs = input.parsedCreatedAt ? Date.parse(input.parsedCreatedAt) : Number.NaN;
    let candidateMs: number;

    if (Number.isFinite(parsedMs)) {
      candidateMs = parsedMs;
    } else if (lastMs !== null) {
      candidateMs = lastMs + 1;
    } else if (Number.isFinite(firstParsedMs)) {
      candidateMs = firstParsedMs - (firstParsedIndex - index);
    } else if (Number.isFinite(fallbackMs)) {
      candidateMs = fallbackMs + index;
    } else {
      candidateMs = nowMs + index;
    }

    if (lastMs !== null && candidateMs <= lastMs) {
      candidateMs = lastMs + 1;
    }

    lastMs = candidateMs;

    return {
      ...input,
      createdAt: new Date(candidateMs).toISOString(),
    };
  });
}

/**
 * Import a SillyTavern JSONL chat file.
 *
 * Format: Line 0 = header JSON, lines 1+ = message JSON per line.
 */
export async function importSTChat(jsonlContent: string, db: DB, opts?: ImportSTChatOptions) {
  const storage = createChatsStorage(db);
  const lines = jsonlContent.split("\n").filter((l) => l.trim());

  if (lines.length < 2) {
    return { error: "Invalid JSONL: too few lines" };
  }

  // Parse header
  const header = JSON.parse(lines[0]!) as STChatHeader;
  const characterName = header.character_name ?? "Unknown";
  const userName = header.user_name ?? "User";

  // Build characterIds array. Caller-supplied list wins so an import-into-group
  // can fully inherit the existing chat's roster instead of being limited to a
  // single matched character.
  const characterIds: string[] = [];
  if (opts?.characterIds?.length) {
    for (const cid of opts.characterIds) {
      if (cid && !characterIds.includes(cid)) characterIds.push(cid);
    }
  } else if (opts?.characterId) {
    characterIds.push(opts.characterId);
  }
  // For group chats, collect all unique character IDs from speakerMap
  if (opts?.speakerMap) {
    for (const cid of Object.values(opts.speakerMap)) {
      if (cid && !characterIds.includes(cid)) characterIds.push(cid);
    }
  }

  const messageTimestamps: string[] = [];
  const parsedMsgInputs: ParsedSTChatMessageInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const stMsg = JSON.parse(lines[i]!) as STChatMessage;

      // Skip pure system messages (but keep user messages flagged as system — ST does this for RP intros)
      if (stMsg.is_system && !stMsg.is_user) continue;

      const role = stMsg.is_user ? "user" : "assistant";
      const content = stMsg.extra?.display_text ?? stMsg.mes;

      // Resolve character ID for this message
      let messageCharacterId: string | null = null;
      if (!stMsg.is_user) {
        if (opts?.speakerMap && stMsg.name) {
          // Group chat: look up speaker
          messageCharacterId = opts.speakerMap[stMsg.name] ?? opts?.characterId ?? null;
        } else {
          messageCharacterId = opts?.characterId ?? null;
        }
      }

      const createdAt = parseTrustedTimestamp(stMsg.send_date);

      parsedMsgInputs.push({
        role,
        characterId: messageCharacterId,
        content,
        parsedCreatedAt: createdAt,
      });
    } catch {
      // Skip malformed lines
    }
  }

  const msgInputs = normalizeTranscriptTimestamps(parsedMsgInputs, opts?.timestampOverrides).map(
    ({ parsedCreatedAt, ...input }) => {
      messageTimestamps.push(input.createdAt);
      return input;
    },
  );

  const latestMessageTimestamp = latestTrustedTimestamp(messageTimestamps);
  const chatTimestamps = normalizeTimestampOverrides({
    createdAt: opts?.timestampOverrides?.createdAt ?? latestMessageTimestamp ?? null,
    updatedAt:
      latestMessageTimestamp ?? opts?.timestampOverrides?.updatedAt ?? opts?.timestampOverrides?.createdAt ?? null,
  });

  const chat = await storage.create(
    {
      name: opts?.chatName ?? `${characterName} (imported)`,
      mode: (opts?.mode ?? "roleplay") as ChatMode,
      characterIds,
      groupId: opts?.groupId ?? null,
      personaId: opts?.personaId ?? null,
      promptPresetId: opts?.promptPresetId ?? null,
      connectionId: opts?.connectionId ?? null,
    },
    chatTimestamps,
  );

  if (!chat) return { error: "Failed to create chat" };

  // Preserve an imported branch/file label separately from the main thread/chat name.
  if (opts?.branchName) {
    const existingMetadata = typeof chat.metadata === "string" ? JSON.parse(chat.metadata) : (chat.metadata ?? {});
    await storage.updateMetadata(chat.id, {
      ...existingMetadata,
      branchName: opts.branchName,
    });
  }

  await storage.createMessagesBatch(chat.id, msgInputs, chatTimestamps);

  return {
    success: true,
    chatId: chat.id,
    characterName,
    userName,
    messagesImported: msgInputs.length,
  };
}
