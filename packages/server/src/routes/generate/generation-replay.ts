import { stripGenerationGuideInstruction, type GenerationGuideSource } from "@marinara-engine/shared";

export type GenerationReplayGuideSource = GenerationGuideSource;

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
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asTrimmedNonEmptyString(value: unknown): string | null {
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

    const impersonatePresetId = asTrimmedNonEmptyString(input.impersonatePresetId);
    if (impersonatePresetId) replay.impersonatePresetId = impersonatePresetId;

    const impersonateConnectionId = asTrimmedNonEmptyString(input.impersonateConnectionId);
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
    impersonatePresetId: asTrimmedNonEmptyString(raw.impersonatePresetId),
    impersonateConnectionId: asTrimmedNonEmptyString(raw.impersonateConnectionId),
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

    const currentUserMessage = asNonEmptyString(input.userMessage);
    const explicitGuide = asNonEmptyString(input.generationGuide);
    if (explicitGuide) {
      if (!currentUserMessage) {
        input.userMessage = stripGenerationGuideInstruction(explicitGuide);
      }
      input.generationGuide = null;
      input.generationGuideSource = null;
      applied = true;
    } else if (!currentUserMessage && replay.userMessage) {
      input.userMessage = replay.userMessage;
      applied = true;
    } else if (!currentUserMessage && replay.generationGuide) {
      input.userMessage = stripGenerationGuideInstruction(replay.generationGuide);
      applied = true;
    }

    if (!asTrimmedNonEmptyString(input.impersonatePresetId) && replay.impersonatePresetId) {
      input.impersonatePresetId = replay.impersonatePresetId;
      applied = true;
    }

    if (!asTrimmedNonEmptyString(input.impersonateConnectionId) && replay.impersonateConnectionId) {
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

  if (replay.impersonate !== true && !asNonEmptyString(input.generationGuide) && replay.generationGuide) {
    input.generationGuide = replay.generationGuide;
    input.generationGuideSource = replay.generationGuideSource ?? "guide";
    applied = true;
  }

  return applied;
}
