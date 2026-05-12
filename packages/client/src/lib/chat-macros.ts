import { resolveMacros, type MacroContext } from "@marinara-engine/shared";

export interface MacroCharacterData {
  id?: string;
  name: string;
  description?: string;
  personality?: string;
  backstory?: string;
  appearance?: string;
  scenario?: string;
  example?: string;
}

export interface MacroPersonaData {
  personaId?: string;
  name: string;
  description?: string;
  personality?: string;
  backstory?: string;
  appearance?: string;
  scenario?: string;
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function appendActiveAltDescriptions(description: string, altDescriptions: unknown): string {
  try {
    const parsed =
      typeof altDescriptions === "string"
        ? altDescriptions.trim()
          ? (JSON.parse(altDescriptions) as Array<{ active?: boolean; content?: string }>)
          : []
        : Array.isArray(altDescriptions)
          ? (altDescriptions as Array<{ active?: boolean; content?: string }>)
          : [];
    const activeDescriptions = parsed
      .filter((item) => item?.active && typeof item.content === "string" && item.content.trim().length > 0)
      .map((item) => item.content!.trim());
    if (activeDescriptions.length === 0) return description;
    return [description, ...activeDescriptions].filter((part) => part.trim().length > 0).join("\n");
  } catch {
    return description;
  }
}

export function getChatCharacterIds(chat: { characterIds?: unknown } | null | undefined): string[] {
  if (!chat) return [];

  const raw = chat.characterIds;
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === "string" && value.length > 0);
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

export function parseCharacterMacroData(
  raw: { id?: string; data: unknown } | null | undefined,
): MacroCharacterData | null {
  if (!raw) return null;

  try {
    const parsed = typeof raw.data === "string" ? JSON.parse(raw.data) : raw.data;
    const data = getRecord(parsed);
    if (!data) return { id: raw.id, name: "Unknown" };
    const extensions = getRecord(data.extensions);
    return {
      id: raw.id,
      name: getString(data.name) || "Unknown",
      description: appendActiveAltDescriptions(
        getString(data.description),
        extensions?.altDescriptions ?? extensions?.descriptionExtensions,
      ),
      personality: getString(data.personality),
      backstory: getString(extensions?.backstory),
      appearance: getString(extensions?.appearance),
      scenario: getString(data.scenario),
      example: getString(data.mes_example),
    };
  } catch {
    return { id: raw.id, name: "Unknown" };
  }
}

export function parsePersonaMacroData(raw: Record<string, unknown> | null | undefined): MacroPersonaData | null {
  if (!raw) return null;

  return {
    personaId: getString(raw.id),
    name: getString(raw.name) || "User",
    description: appendActiveAltDescriptions(getString(raw.description), raw.altDescriptions),
    personality: getString(raw.personality),
    backstory: getString(raw.backstory),
    appearance: getString(raw.appearance),
    scenario: getString(raw.scenario),
  };
}

export function selectChatCharacters(
  chat: { characterIds?: unknown } | null | undefined,
  characters: Array<{ id: string; data: unknown }> | undefined,
): MacroCharacterData[] {
  const chatCharacterIds = getChatCharacterIds(chat);
  if (chatCharacterIds.length === 0 || !characters?.length) return [];

  const byId = new Map<string, MacroCharacterData>();
  for (const character of characters) {
    const parsed = parseCharacterMacroData(character);
    if (parsed) byId.set(character.id, parsed);
  }

  return chatCharacterIds.map((id) => byId.get(id)).filter((value): value is MacroCharacterData => !!value);
}

export function selectActivePersona(
  chat: { personaId?: string | null; mode?: string | null } | null | undefined,
  personas: Array<Record<string, unknown>> | undefined,
): MacroPersonaData | undefined {
  if (!personas?.length) return undefined;

  const chatPersonaId = typeof chat?.personaId === "string" ? chat.personaId : null;
  const allowGlobalFallback = chat?.mode !== "game";
  const selectedPersona =
    (chatPersonaId ? personas.find((persona) => getString(persona.id) === chatPersonaId) : null) ??
    (allowGlobalFallback ? personas.find((persona) => persona.isActive === true || persona.isActive === "true") : null);

  return parsePersonaMacroData(selectedPersona ?? null) ?? undefined;
}

export function findCharacterByName(
  characters: Iterable<MacroCharacterData>,
  name: string | null | undefined,
): MacroCharacterData | undefined {
  if (!name) return undefined;
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;

  for (const character of characters) {
    if (character.name.trim().toLowerCase() === needle) {
      return character;
    }
  }

  return undefined;
}

export function buildMessageMacroContext({
  persona,
  primaryCharacter,
  characters = [],
  userName,
  variables = {},
  lastInput,
}: {
  persona?: MacroPersonaData | null;
  primaryCharacter?: MacroCharacterData | null;
  characters?: MacroCharacterData[];
  userName?: string;
  variables?: Record<string, string>;
  lastInput?: string;
}): MacroContext {
  const fallbackCharacter = primaryCharacter ?? characters[0] ?? null;

  return {
    user: userName ?? persona?.name ?? "User",
    char: fallbackCharacter?.name ?? "Character",
    characters: characters.map((character) => character.name).filter((name) => name.trim().length > 0),
    variables,
    lastInput,
    characterFields: fallbackCharacter
      ? {
          description: fallbackCharacter.description ?? "",
          personality: fallbackCharacter.personality ?? "",
          backstory: fallbackCharacter.backstory ?? "",
          appearance: fallbackCharacter.appearance ?? "",
          scenario: fallbackCharacter.scenario ?? "",
          example: fallbackCharacter.example ?? "",
        }
      : undefined,
    personaFields: persona
      ? {
          description: persona.description ?? "",
          personality: persona.personality ?? "",
          backstory: persona.backstory ?? "",
          appearance: persona.appearance ?? "",
          scenario: persona.scenario ?? "",
        }
      : undefined,
  };
}

export function resolveMessageMacros(
  template: string,
  context: Parameters<typeof buildMessageMacroContext>[0],
): string {
  return createMessageMacroResolver(context)(template);
}

export function createMessageMacroResolver(context: Parameters<typeof buildMessageMacroContext>[0]) {
  const macroContext = buildMessageMacroContext(context);
  return (template: string) => resolveMacros(template, macroContext, { trimResult: false });
}

export function isPromptPreviewMacro(input: string): boolean {
  return /^\{\{\s*(?:prompt|prompt_preview|preview_prompt)\s*\}\}$/i.test(input.trim());
}

export function resolveInputMacrosForChat(
  template: string,
  chat: { characterIds?: unknown; personaId?: string | null; mode?: string | null } | null | undefined,
  characters: Array<{ id: string; data: unknown }> | undefined,
  personas: Array<Record<string, unknown>> | undefined,
  lastInput?: string,
): string {
  return createInputMacroResolverForChat(chat, characters, personas, lastInput)(template);
}

export function createInputMacroResolverForChat(
  chat: { characterIds?: unknown; personaId?: string | null; mode?: string | null } | null | undefined,
  characters: Array<{ id: string; data: unknown }> | undefined,
  personas: Array<Record<string, unknown>> | undefined,
  lastInput?: string,
) {
  const chatCharacters = selectChatCharacters(chat, characters);
  const activePersona = selectActivePersona(chat, personas);
  return createMessageMacroResolver({
    persona: activePersona,
    primaryCharacter: chatCharacters[0] ?? null,
    characters: chatCharacters,
    lastInput,
  });
}
