import type { Chat } from "@marinara-engine/shared";
import { parseChatMetadata } from "./chat-display";

type GameSessionChat = Pick<Chat, "id" | "mode" | "groupId" | "metadata" | "updatedAt" | "createdAt">;

function readSessionNumber(chat: GameSessionChat): number | null {
  const value = parseChatMetadata(chat.metadata).gameSessionNumber;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function compareGameSessions(a: GameSessionChat, b: GameSessionChat): number {
  const sessionA = readSessionNumber(a) ?? 0;
  const sessionB = readSessionNumber(b) ?? 0;
  if (sessionA !== sessionB) return sessionA - sessionB;

  const updatedA = readTimestamp(a.updatedAt);
  const updatedB = readTimestamp(b.updatedAt);
  if (updatedA !== updatedB) return updatedA - updatedB;

  return readTimestamp(a.createdAt) - readTimestamp(b.createdAt);
}

export function getCurrentGameGroupRepresentative<T extends GameSessionChat>(
  chat: T,
  chats: readonly T[] | null | undefined,
): T {
  if (chat.mode !== "game" || !chat.groupId || !chats?.length) return chat;

  const sessions = chats.filter((candidate) => candidate.mode === "game" && candidate.groupId === chat.groupId);
  if (sessions.length === 0) return chat;

  return sessions.reduce((latest, candidate) =>
    compareGameSessions(candidate, latest) > 0 ? candidate : latest,
  );
}

export function resolveCurrentGameSessionChatId(
  activeChat: GameSessionChat | null | undefined,
  chats: readonly GameSessionChat[] | null | undefined,
): string | null {
  if (!activeChat) return null;
  const current = getCurrentGameGroupRepresentative(activeChat, chats);
  return current.id !== activeChat.id ? current.id : null;
}
