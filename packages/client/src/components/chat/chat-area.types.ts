import type { Message } from "@marinara-engine/shared";

export type CharacterMap = Map<
  string,
  {
    name: string;
    avatarUrl: string | null;
    nameColor?: string;
    dialogueColor?: string;
    boxColor?: string;
    avatarCrop?: { zoom: number; offsetX: number; offsetY: number } | null;
    conversationStatus?: "online" | "idle" | "dnd" | "offline";
    conversationActivity?: string;
  }
>;

export type PersonaInfo = {
  name: string;
  avatarUrl?: string;
  nameColor?: string;
  dialogueColor?: string;
  boxColor?: string;
};

export type PeekPromptData = {
  messages: Array<{ role: string; content: string }>;
  parameters: unknown;
  generationInfo?: {
    model?: string;
    provider?: string;
    temperature?: number | null;
    maxTokens?: number | null;
    showThoughts?: boolean | null;
    reasoningEffort?: string | null;
    verbosity?: string | null;
    tokensPrompt?: number | null;
    tokensCompletion?: number | null;
    tokensCachedPrompt?: number | null;
    tokensCacheWritePrompt?: number | null;
    durationMs?: number | null;
    finishReason?: string | null;
  } | null;
  agentNote?: string;
};

export type MessageWithSwipes = Message & {
  swipes?: Array<{ id: string; content: string }>;
};

export type MessageSelectionToggle = {
  messageId: string;
  orderIndex: number;
  checked: boolean;
  shiftKey: boolean;
};
