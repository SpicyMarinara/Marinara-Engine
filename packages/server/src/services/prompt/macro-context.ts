// ──────────────────────────────────────────────
// Prompt Macro Context Helpers
// ──────────────────────────────────────────────
// Shared helpers for routes that assemble prompts outside the preset
// assembler. Keeps card macros and depth prompts consistent everywhere.
// ──────────────────────────────────────────────

import {
  resolveMacros,
  type CharacterData,
  type MacroContext,
  type ResolveMacroOptions,
} from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { createCharactersStorage } from "../storage/characters.storage.js";
import { getCharacterDescriptionWithExtensions } from "./character-description-extensions.js";

type PersonaFields = NonNullable<MacroContext["personaFields"]>;

export interface BuildPromptMacroContextInput {
  db: DB;
  characterIds: string[];
  personaName: string;
  personaDescription?: string;
  personaFields?: PersonaFields;
  variables?: Record<string, string>;
  groupScenarioOverrideText?: string | null;
  lastInput?: string;
  chatId?: string;
  model?: string;
}

export interface CharacterMacroData {
  names: string[];
  profiles: NonNullable<MacroContext["characterProfiles"]>;
  primaryFields?: NonNullable<MacroContext["characterFields"]>;
}

export interface MacroResolutionTransaction {
  content: string;
  commit: () => void;
  rollback: () => void;
}

export function resolveMacrosWithVariableSnapshot(
  template: string,
  macroCtx: MacroContext,
  options?: ResolveMacroOptions,
): MacroResolutionTransaction {
  const before = { ...macroCtx.variables };
  const content = resolveMacros(template, macroCtx, options);
  let settled = false;

  const rollback = () => {
    if (settled) return;
    macroCtx.variables = before;
    settled = true;
  };

  const commit = () => {
    settled = true;
  };

  return { content, commit, rollback };
}

export type PromptDepthEntry = {
  content: string;
  role: "system" | "user" | "assistant";
  depth: number;
};

function parseCharacterData(raw: unknown): CharacterData | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as CharacterData;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as CharacterData;
  return null;
}

export async function resolveCharacterMacroData(db: DB, characterIds: string[]): Promise<CharacterMacroData> {
  if (characterIds.length === 0) return { names: [], profiles: [] };

  const chars = createCharactersStorage(db);
  const names: string[] = [];
  const profiles: CharacterMacroData["profiles"] = [];
  let primaryFields: CharacterMacroData["primaryFields"] | undefined;

  for (const id of characterIds) {
    const row = await chars.getById(id);
    const data = parseCharacterData(row?.data);
    if (!data) continue;

    if (data.name) names.push(data.name);

    const description = getCharacterDescriptionWithExtensions(data);
    const profile = {
      name: data.name ?? "Character",
      description,
      personality: data.personality ?? "",
      backstory: data.extensions?.backstory ?? "",
      appearance: data.extensions?.appearance ?? "",
      scenario: data.scenario ?? "",
      example: data.mes_example ?? "",
    };

    profiles.push(profile);

    if (!primaryFields) {
      primaryFields = {
        description: profile.description,
        personality: profile.personality,
        backstory: profile.backstory,
        appearance: profile.appearance,
        scenario: profile.scenario,
        example: profile.example,
      };
    }
  }

  return { names, profiles, primaryFields };
}

export async function buildPromptMacroContext(input: BuildPromptMacroContextInput): Promise<MacroContext> {
  const characterMacroData = await resolveCharacterMacroData(input.db, input.characterIds);
  const variables = input.variables ?? {};

  return {
    user: input.personaName || "User",
    char: characterMacroData.names[0] || "Character",
    characters: characterMacroData.names,
    characterProfiles: characterMacroData.profiles,
    variables,
    lastInput: input.lastInput,
    chatId: input.chatId,
    model: input.model,
    characterFields: {
      ...(characterMacroData.primaryFields ?? {}),
      ...(input.groupScenarioOverrideText ? { scenario: input.groupScenarioOverrideText } : {}),
    },
    personaFields: {
      description: input.personaDescription ?? "",
      ...(input.personaFields ?? {}),
    },
  };
}

function normalizeDepthPrompt(
  value: unknown,
): { prompt: string; depth: number; role: PromptDepthEntry["role"] } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) return null;

  const rawDepth = Number(raw.depth ?? 4);
  const depth = Number.isFinite(rawDepth) ? Math.max(0, Math.floor(rawDepth)) : 4;
  const role = raw.role === "user" || raw.role === "assistant" || raw.role === "system" ? raw.role : "system";

  return { prompt, depth, role };
}

export async function collectCharacterDepthPromptEntries(
  db: DB,
  characterIds: string[],
  macroCtx: MacroContext,
): Promise<PromptDepthEntry[]> {
  if (characterIds.length === 0) return [];

  const chars = createCharactersStorage(db);
  const entries: PromptDepthEntry[] = [];

  for (const id of characterIds) {
    const row = await chars.getById(id);
    const data = parseCharacterData(row?.data);
    const depthPrompt = normalizeDepthPrompt(data?.extensions?.depth_prompt);
    if (!depthPrompt) continue;

    const content = resolveMacros(depthPrompt.prompt, {
      ...macroCtx,
      char: data?.name ?? macroCtx.char,
      characterFields: {
        description: data ? getCharacterDescriptionWithExtensions(data) : "",
        personality: data?.personality ?? "",
        backstory: data?.extensions?.backstory ?? "",
        appearance: data?.extensions?.appearance ?? "",
        scenario: data?.scenario ?? "",
        example: data?.mes_example ?? "",
      },
    });

    if (content.trim()) {
      entries.push({ content, role: depthPrompt.role, depth: depthPrompt.depth });
    }
  }

  return entries;
}
