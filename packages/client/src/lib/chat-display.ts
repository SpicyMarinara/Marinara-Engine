import type { Chat } from "@marinara-engine/shared";

export type ChatDisplaySource = {
  name: string;
  metadata?: Chat["metadata"] | string | Record<string, unknown> | null;
};

export function parseChatMetadata(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, any>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
}

export function getChatDisplayName(chat: ChatDisplaySource | null | undefined): string {
  if (!chat) return "";
  const metadata = parseChatMetadata(chat.metadata);
  return typeof metadata.branchName === "string" && metadata.branchName.trim() ? metadata.branchName : chat.name;
}
