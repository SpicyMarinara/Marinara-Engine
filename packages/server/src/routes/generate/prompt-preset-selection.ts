export type PromptPresetCandidateSource = "impersonate" | "request" | "connection" | "chat";

export interface PromptPresetCandidate {
  id: string;
  source: PromptPresetCandidateSource;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string") {
      const trimmed = id.trim();
      return trimmed ? trimmed : null;
    }
  }
  return null;
}

function pushUnique(
  candidates: PromptPresetCandidate[],
  seen: Set<string>,
  id: string | null,
  source: PromptPresetCandidateSource,
) {
  if (!id || seen.has(id)) return;
  candidates.push({ id, source });
  seen.add(id);
}

export function supportsConnectionPromptPresetOverride(chatMode: unknown): boolean {
  return chatMode === "roleplay" || chatMode === "visual_novel";
}

export function buildGenerationPromptPresetCandidates(args: {
  chatMode: unknown;
  chatPromptPresetId?: unknown;
  connectionPromptPresetId?: unknown;
  impersonate?: boolean;
  impersonatePromptPresetId?: unknown;
  requestPromptPresetId?: unknown;
}): PromptPresetCandidate[] {
  if (args.chatMode === "conversation") return [];

  const candidates: PromptPresetCandidate[] = [];
  const seen = new Set<string>();

  if (args.impersonate) {
    pushUnique(candidates, seen, asNonEmptyString(args.impersonatePromptPresetId), "impersonate");
  }
  pushUnique(candidates, seen, asNonEmptyString(args.requestPromptPresetId), "request");

  if (supportsConnectionPromptPresetOverride(args.chatMode)) {
    pushUnique(candidates, seen, asNonEmptyString(args.connectionPromptPresetId), "connection");
  }

  pushUnique(candidates, seen, asNonEmptyString(args.chatPromptPresetId), "chat");
  return candidates;
}
