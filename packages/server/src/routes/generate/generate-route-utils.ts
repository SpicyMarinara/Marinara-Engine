import { PROVIDERS, type GameState } from "@marinara-engine/shared";
import { wrapContent } from "../../services/prompt/format-engine.js";

export type SimpleMessage = { role: "system" | "user" | "assistant"; content: string };

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

/** Resolve the base URL for a connection, falling back to the provider default. */
export function resolveBaseUrl(connection: { baseUrl: string | null; provider: string }): string {
  if (connection.baseUrl) return connection.baseUrl.replace(/\/+$/, "");
  // Claude (Subscription) routes through the local Claude Agent SDK and has no
  // HTTP endpoint — but downstream callers gate on a non-empty baseUrl. Return
  // a sentinel so the gate passes; the provider ignores the value.
  if (connection.provider === "claude_subscription") return "claude-agent-sdk://local";
  const providerDef = PROVIDERS[connection.provider as keyof typeof PROVIDERS];
  return providerDef?.defaultBaseUrl ?? "";
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
