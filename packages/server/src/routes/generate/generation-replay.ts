export type GenerationReplayGuideSource = "narrator" | "guide" | "game_start";

export interface GenerationReplay {
  impersonate?: true;
  userMessage?: string | null;
  generationGuide?: string;
  generationGuideSource?: GenerationReplayGuideSource;
  impersonatePresetId?: string | null;
  impersonateConnectionId?: string | null;
  impersonateBlockAgents?: boolean;
  impersonatePromptTemplate?: string | null;
}

export interface GenerationReplayInput {
  userMessage?: string | null;
  impersonate?: boolean;
  generationGuide?: string | null;
  generationGuideSource?: GenerationReplayGuideSource | null;
  impersonatePresetId?: string | null;
  impersonateConnectionId?: string | null;
  impersonateBlockAgents?: boolean;
  impersonatePromptTemplate?: string | null;
}

const GUIDE_SOURCES = new Set<GenerationReplayGuideSource>(["narrator", "guide", "game_start"]);

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asGuideSource(value: unknown): GenerationReplayGuideSource | null {
  return typeof value === "string" && GUIDE_SOURCES.has(value as GenerationReplayGuideSource)
    ? (value as GenerationReplayGuideSource)
    : null;
}

export function buildGenerationReplay(input: GenerationReplayInput): GenerationReplay | null {
  const replay: GenerationReplay = {};
  const guide = asNonEmptyString(input.generationGuide);
  const guideSource = asGuideSource(input.generationGuideSource);

  if (guide && guideSource) {
    replay.generationGuide = guide;
    replay.generationGuideSource = guideSource;
  }

  if (input.impersonate === true) {
    replay.impersonate = true;
    replay.userMessage = asNonEmptyString(input.userMessage);

    const impersonatePresetId = asNonEmptyString(input.impersonatePresetId);
    if (impersonatePresetId) replay.impersonatePresetId = impersonatePresetId;

    const impersonateConnectionId = asNonEmptyString(input.impersonateConnectionId);
    if (impersonateConnectionId) replay.impersonateConnectionId = impersonateConnectionId;

    if (input.impersonateBlockAgents === true) replay.impersonateBlockAgents = true;

    const impersonatePromptTemplate = asNonEmptyString(input.impersonatePromptTemplate);
    if (impersonatePromptTemplate) replay.impersonatePromptTemplate = impersonatePromptTemplate;
  }

  return Object.keys(replay).length > 0 ? replay : null;
}

export function normalizeGenerationReplay(value: unknown): GenerationReplay | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  return buildGenerationReplay({
    userMessage: asNonEmptyString(raw.userMessage),
    impersonate: raw.impersonate === true,
    generationGuide: asNonEmptyString(raw.generationGuide),
    generationGuideSource: asGuideSource(raw.generationGuideSource),
    impersonatePresetId: asNonEmptyString(raw.impersonatePresetId),
    impersonateConnectionId: asNonEmptyString(raw.impersonateConnectionId),
    impersonateBlockAgents: raw.impersonateBlockAgents === true,
    impersonatePromptTemplate: asNonEmptyString(raw.impersonatePromptTemplate),
  });
}

export function applyGenerationReplayToRegenerateInput(
  input: GenerationReplayInput,
  replay: GenerationReplay | null,
): boolean {
  if (!replay) return false;

  let applied = false;

  if (replay.impersonate === true) {
    if (input.impersonate !== true) {
      input.impersonate = true;
      applied = true;
    }

    if (!asNonEmptyString(input.userMessage) && replay.userMessage) {
      input.userMessage = replay.userMessage;
      applied = true;
    }

    if (!asNonEmptyString(input.impersonatePresetId) && replay.impersonatePresetId) {
      input.impersonatePresetId = replay.impersonatePresetId;
      applied = true;
    }

    if (!asNonEmptyString(input.impersonateConnectionId) && replay.impersonateConnectionId) {
      input.impersonateConnectionId = replay.impersonateConnectionId;
      applied = true;
    }

    if (input.impersonateBlockAgents !== true && replay.impersonateBlockAgents === true) {
      input.impersonateBlockAgents = true;
      applied = true;
    }

    if (!asNonEmptyString(input.impersonatePromptTemplate) && replay.impersonatePromptTemplate) {
      input.impersonatePromptTemplate = replay.impersonatePromptTemplate;
      applied = true;
    }
  }

  if (!asNonEmptyString(input.generationGuide) && replay.generationGuide) {
    input.generationGuide = replay.generationGuide;
    input.generationGuideSource = replay.generationGuideSource ?? "guide";
    applied = true;
  }

  return applied;
}
