// ──────────────────────────────────────────────
// Service: Character Commands
// ──────────────────────────────────────────────
// Parses hidden commands from character messages in Conversation mode.
// Commands are embedded by the LLM in the response and stripped before
// the message is shown to the user.
//
// Supported commands:
// - [schedule_update: status="online", activity="free time"]
// - [cross_post: target="group"] or [cross_post: target="CharName"]
// - [selfie], [selfie: context="description of the selfie"], [selfie: "description"], or [selfie: description]
// - [memory: target="CharName", summary="description of the memory"]
// - [scene: scenario="...", background="...", plan="..."] (initiate a mini-roleplay scene)
// - [spotify: title="Song title", artist="Artist"] (play a song on the user's active Spotify player)
// - [haptic: action="vibrate", intensity=0.5, duration=3] (haptic device feedback)
// - <influence>text</influence> (OOC influence for connected roleplay, one-shot)
// - <note>text</note> (durable note for connected roleplay, persists until cleared)
// - [dm: character="CharName", message="text"] (Roleplay-only: open a direct-message conversation)
//
// Assistant commands (Professor Mari):
// - [create_persona: name="...", description="...", personality="...", appearance="..."]
// - [create_character: name="...", description="...", personality="...", first_message="...", scenario="...", backstory="...", appearance="...", mes_example="...", creator_notes="...", system_prompt="...", post_history_instructions="...", creator="...", character_version="...", tags="tag1, tag2", alternate_greetings="hello || hi", talkativeness=0.5, fav=true, world="...", depth_prompt="...", depth_prompt_depth=4, depth_prompt_role="system"]
// - [update_character: name="...", description="...", personality="...", first_message="...", scenario="...", backstory="...", appearance="...", mes_example="...", creator_notes="...", system_prompt="...", post_history_instructions="...", creator="...", character_version="...", tags="tag1, tag2", alternate_greetings="hello || hi", talkativeness=0.5, fav=true, world="...", depth_prompt="...", depth_prompt_depth=4, depth_prompt_role="system"]
// - [update_persona: name="...", description="...", personality="...", appearance="...", scenario="...", backstory="..."]
// - <create_lorebook>{"name":"...","description":"...","category":"...","tags":["..."],"entries":[{"name":"...","content":"...","keys":["..."],"tag":"..."}]}</create_lorebook>
// - <update_lorebook>{"name":"Existing","description":"...","entries":[{"name":"Entry","content":"refined content","keys":["..."]}]}</update_lorebook>
// - [create_chat: character="...", mode="conversation|roleplay"]
// - [navigate: panel="...", tab="..."]
// - [fetch: type="character|persona|lorebook|chat|preset", name="..."]

import { stripConversationPromptTimestamps } from "./transcript-sanitize.js";

export interface ScheduleUpdateCommand {
  type: "schedule_update";
  status?: "online" | "idle" | "dnd" | "offline";
  activity?: string;
  duration?: string;
}

export interface CrossPostCommand {
  type: "cross_post";
  /** "group" to post in a group chat, or a character/chat name for DM */
  target: string;
}

export interface SelfieCommand {
  type: "selfie";
  /** Optional context hint from the character about the selfie */
  context?: string;
}

export interface MemoryCommand {
  type: "memory";
  /** Target character name */
  target: string;
  /** Short description of the memory */
  summary: string;
}

export interface SceneCommand {
  type: "scene";
  /** Description of the scene/scenario the character wants to play out */
  scenario: string;
  /** Optional background suggestion */
  background?: string;
  /** Optional plot plan / outline for how the scene unfolds */
  plan?: string;
}

export interface InfluenceCommand {
  type: "influence";
  /** The OOC influence text to inject into the connected roleplay */
  content: string;
}

export interface NoteCommand {
  type: "note";
  /** The durable note text to persist in the connected roleplay's prompt until cleared */
  content: string;
}

export interface DirectMessageCommand {
  type: "dm";
  /** Target character name or ID */
  character: string;
  /** Text the character sends in the generated conversation DM */
  message: string;
}

export interface HapticCommand {
  type: "haptic";
  /** Device action */
  action: "vibrate" | "oscillate" | "rotate" | "position" | "stop";
  /** Intensity / speed (0.0-1.0) */
  intensity?: number;
  /** Duration in seconds */
  duration?: number;
}

export interface SpotifyCommand {
  type: "spotify";
  /** Exact song title to play */
  title: string;
  /** Artist name to disambiguate the track */
  artist: string;
}

// ── Assistant commands (Professor Mari) ──

export interface CreatePersonaCommand {
  type: "create_persona";
  name: string;
  description?: string;
  personality?: string;
  appearance?: string;
}

export interface CreateCharacterCommand {
  type: "create_character";
  name: string;
  description?: string;
  personality?: string;
  firstMessage?: string;
  scenario?: string;
  backstory?: string;
  appearance?: string;
  mesExample?: string;
  creatorNotes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  creator?: string;
  characterVersion?: string;
  tags?: string[];
  alternateGreetings?: string[];
  talkativeness?: number;
  fav?: boolean;
  world?: string;
  depthPrompt?: string;
  depthPromptDepth?: number;
  depthPromptRole?: "system" | "user" | "assistant";
}

export interface UpdateCharacterCommand {
  type: "update_character";
  name: string;
  description?: string;
  personality?: string;
  firstMessage?: string;
  scenario?: string;
  backstory?: string;
  appearance?: string;
  mesExample?: string;
  creatorNotes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  creator?: string;
  characterVersion?: string;
  tags?: string[];
  alternateGreetings?: string[];
  talkativeness?: number;
  fav?: boolean;
  world?: string;
  depthPrompt?: string;
  depthPromptDepth?: number;
  depthPromptRole?: "system" | "user" | "assistant";
}

export interface UpdatePersonaCommand {
  type: "update_persona";
  name: string;
  description?: string;
  personality?: string;
  appearance?: string;
  scenario?: string;
  backstory?: string;
}

export interface CreateLorebookEntryCommand {
  name: string;
  content?: string;
  description?: string;
  keys?: string[];
  secondaryKeys?: string[];
  tag?: string;
  constant?: boolean;
  selective?: boolean;
}

export interface UpdateLorebookEntryCommand extends CreateLorebookEntryCommand {
  /** Existing entry name to match when renaming or disambiguating. Defaults to name. */
  matchName?: string;
}

export interface CreateLorebookCommand {
  type: "create_lorebook";
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  entries?: CreateLorebookEntryCommand[];
}

export interface UpdateLorebookCommand {
  type: "update_lorebook";
  /** Existing lorebook name to update. */
  name: string;
  /** Optional new display name for the lorebook. */
  newName?: string;
  description?: string;
  category?: string;
  tags?: string[];
  entries?: UpdateLorebookEntryCommand[];
}

export interface CreateChatCommand {
  type: "create_chat";
  character: string;
  mode?: "conversation" | "roleplay";
}

export interface NavigateCommand {
  type: "navigate";
  panel: string;
  tab?: string;
}

export interface FetchCommand {
  type: "fetch";
  /** What kind of item to fetch */
  fetchType: "character" | "persona" | "lorebook" | "chat" | "preset";
  /** Name of the item to retrieve */
  name: string;
}

export type AssistantCommand =
  | CreatePersonaCommand
  | CreateCharacterCommand
  | UpdateCharacterCommand
  | UpdatePersonaCommand
  | CreateLorebookCommand
  | UpdateLorebookCommand
  | CreateChatCommand
  | NavigateCommand
  | FetchCommand;

export type CharacterCommand =
  | ScheduleUpdateCommand
  | CrossPostCommand
  | SelfieCommand
  | MemoryCommand
  | SceneCommand
  | InfluenceCommand
  | NoteCommand
  | DirectMessageCommand
  | HapticCommand
  | SpotifyCommand
  | AssistantCommand;

// Param block matcher: any char that isn't `"` or `]`, OR a complete
// double-quoted string (with `\"`-style escapes). Lets a `]` inside a
// quoted parameter value (e.g. `description="Status: [VIP]"`) sit inside
// the command instead of terminating it early. The inner alternative
// excludes `\\` so backslash is only consumed by the escape branch —
// otherwise an escape-heavy value can trigger catastrophic backtracking.
const QUOTED_PARAM_BLOCK = '(?:[^"\\]]|"(?:\\\\.|[^"\\\\])*")*';

/** Regex patterns for each command type */
const SCHEDULE_UPDATE_RE = new RegExp(`\\[schedule_update:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const CROSS_POST_RE = /\[cross_post:\s*target="([^"]+)"\]/gi;
const SELFIE_RE = /\[selfie(?::\s*(?:context="([^"]*)"|"([^"]*)"|([^\]\r\n"]+)))?\]/gi;
const MEMORY_RE = /\[memory:\s*target="([^"]+)"\s*,\s*summary="([^"]+)"\]/gi;
const SCENE_RE = new RegExp(`\\[scene:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const HAPTIC_RE = new RegExp(`\\[haptic:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const SPOTIFY_RE = new RegExp(`\\[spotify:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const DIRECT_MESSAGE_RE = new RegExp(`\\[dm:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const INFLUENCE_RE = /<influence>([\s\S]*?)<\/influence>/gi;
const NOTE_RE = /<note>([\s\S]*?)<\/note>/gi;

// Assistant command regexes
const CREATE_PERSONA_RE = new RegExp(`\\[create_persona:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const CREATE_CHARACTER_RE = new RegExp(`\\[create_character:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const UPDATE_CHARACTER_RE = new RegExp(`\\[update_character:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const UPDATE_PERSONA_RE = new RegExp(`\\[update_persona:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const CREATE_LOREBOOK_RE = new RegExp(`\\[create_lorebook:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const CREATE_LOREBOOK_BLOCK_RE = /<create_lorebook>([\s\S]*?)<\/create_lorebook>/gi;
const UPDATE_LOREBOOK_BLOCK_RE = /<update_lorebook>([\s\S]*?)<\/update_lorebook>/gi;
const CREATE_CHAT_RE = new RegExp(`\\[create_chat:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const NAVIGATE_RE = new RegExp(`\\[navigate:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");
const FETCH_RE = new RegExp(`\\[fetch:\\s*(${QUOTED_PARAM_BLOCK})\\]`, "gi");

function decodeQuotedParamValue(value: string): string {
  return value.replace(/\\(["\\nrt])/g, (_match, escaped: string) => {
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return escaped;
    }
  });
}

const QUOTE_PAIRS: Record<string, string> = {
  '"': '"',
  "\u201c": "\u201d",
  "\u201d": "\u201d",
  "\u2018": "\u2019",
  "\u2019": "\u2019",
};

function parseQuotedParam(params: string, key: string, allowEmpty = false): string | undefined {
  const match = params.match(new RegExp(`${key}\\s*=\\s*(["\u201c\u201d\u2018\u2019])`));
  if (!match || match.index === undefined) return undefined;

  const openingQuote = match[1] ?? '"';
  const closingQuote = QUOTE_PAIRS[openingQuote] ?? openingQuote;
  let rawValue = "";
  let index = match.index + match[0].length;

  while (index < params.length) {
    const char = params[index] ?? "";
    const nextChar = params[index + 1];

    if (char === "\\" && nextChar !== undefined) {
      rawValue += char + nextChar;
      index += 2;
      continue;
    }

    const remainder = params.slice(index + 1).trimStart();
    if (
      char === closingQuote &&
      (remainder.length === 0 || remainder.startsWith(",") || /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(remainder))
    ) {
      break;
    }

    rawValue += char;
    index += 1;
  }

  if (index >= params.length) return undefined;

  const value = decodeQuotedParamValue(rawValue);
  if (!allowEmpty && value.length === 0) return undefined;
  return value;
}

function parseStringList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (value.trim().length === 0) return [];
  const delimiter = value.includes("||") ? "||" : ",";
  return value
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBooleanParam(params: string, key: string): boolean | undefined {
  const match = params.match(new RegExp(`${key}=(true|false)`, "i"));
  if (!match) return undefined;
  return match[1]?.toLowerCase() === "true";
}

function parseUnknownStringList(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const values = raw.map((value) => String(value).trim()).filter(Boolean);
    return values.length ? values : undefined;
  }
  if (typeof raw !== "string") return undefined;
  const values = parseStringList(raw);
  return values && values.length ? values : undefined;
}

function parseLorebookEntriesParam(raw: string): CreateLorebookEntryCommand[] | undefined {
  const entries = raw
    .split(/\s*\|\|\s*/)
    .map((chunk): CreateLorebookEntryCommand | null => {
      const [name, keys, content, description] = chunk.split(/\s*\|\s*/);
      const entryName = name?.trim();
      if (!entryName) return null;
      return {
        name: entryName,
        keys: parseUnknownStringList(keys),
        content: content?.trim() || "",
        description: description?.trim() || undefined,
      } satisfies CreateLorebookEntryCommand;
    })
    .filter((entry): entry is CreateLorebookEntryCommand => entry !== null);
  return entries.length ? entries : undefined;
}

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseLorebookBlock(raw: string): CreateLorebookCommand | null {
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) return null;

    const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const entries = rawEntries
      .map((entry): CreateLorebookEntryCommand | null => {
        if (!entry || typeof entry !== "object") return null;
        const data = entry as Record<string, unknown>;
        const entryName = typeof data.name === "string" ? data.name.trim() : "";
        if (!entryName) return null;
        return {
          name: entryName,
          content: typeof data.content === "string" ? data.content : "",
          description: typeof data.description === "string" ? data.description : undefined,
          keys: parseUnknownStringList(data.keys),
          secondaryKeys: parseUnknownStringList(data.secondaryKeys),
          tag: typeof data.tag === "string" ? data.tag : undefined,
          constant: typeof data.constant === "boolean" ? data.constant : undefined,
          selective: typeof data.selective === "boolean" ? data.selective : undefined,
        } satisfies CreateLorebookEntryCommand;
      })
      .filter((entry): entry is CreateLorebookEntryCommand => entry !== null);

    return {
      type: "create_lorebook",
      name,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      category: typeof parsed.category === "string" ? parsed.category : undefined,
      tags: parseUnknownStringList(parsed.tags),
      entries: entries.length ? entries : undefined,
    };
  } catch {
    return null;
  }
}

function parseUpdateLorebookBlock(raw: string): UpdateLorebookCommand | null {
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as Record<string, unknown>;
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    if (!name) return null;

    const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const entries = rawEntries
      .map((entry): UpdateLorebookEntryCommand | null => {
        if (!entry || typeof entry !== "object") return null;
        const data = entry as Record<string, unknown>;
        const entryName = typeof data.name === "string" ? data.name.trim() : "";
        if (!entryName) return null;
        return {
          name: entryName,
          matchName: typeof data.matchName === "string" ? data.matchName.trim() : undefined,
          content: typeof data.content === "string" ? data.content : undefined,
          description: typeof data.description === "string" ? data.description : undefined,
          keys: parseUnknownStringList(data.keys),
          secondaryKeys: parseUnknownStringList(data.secondaryKeys),
          tag: typeof data.tag === "string" ? data.tag : undefined,
          constant: typeof data.constant === "boolean" ? data.constant : undefined,
          selective: typeof data.selective === "boolean" ? data.selective : undefined,
        } satisfies UpdateLorebookEntryCommand;
      })
      .filter((entry): entry is UpdateLorebookEntryCommand => entry !== null);

    return {
      type: "update_lorebook",
      name,
      newName: typeof parsed.newName === "string" ? parsed.newName.trim() : undefined,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      category: typeof parsed.category === "string" ? parsed.category : undefined,
      tags: parseUnknownStringList(parsed.tags),
      entries: entries.length ? entries : undefined,
    };
  } catch {
    return null;
  }
}

function parseNumberParam(params: string, key: string): number | undefined {
  const match = params.match(new RegExp(`${key}=(-?[0-9]+(?:\.[0-9]+)?)`, "i"));
  if (!match) return undefined;
  const value = Number.parseFloat(match[1] ?? "");
  return Number.isFinite(value) ? value : undefined;
}

function applyCommonCharacterFields(
  cmd: CreateCharacterCommand | UpdateCharacterCommand,
  params: string,
  options: { allowEmptyStrings: boolean },
) {
  const readText = (key: string) => parseQuotedParam(params, key, options.allowEmptyStrings);
  const assignText = <K extends keyof CreateCharacterCommand & keyof UpdateCharacterCommand>(
    key: K,
    paramName: string,
  ) => {
    const value = readText(paramName);
    if (value !== undefined) {
      cmd[key] = value as CreateCharacterCommand[K] & UpdateCharacterCommand[K];
    }
  };

  assignText("description", "description");
  assignText("personality", "personality");
  assignText("firstMessage", "first_message");
  assignText("scenario", "scenario");
  assignText("backstory", "backstory");
  assignText("appearance", "appearance");
  assignText("mesExample", "mes_example");
  assignText("creatorNotes", "creator_notes");
  assignText("systemPrompt", "system_prompt");
  assignText("postHistoryInstructions", "post_history_instructions");
  assignText("creator", "creator");
  assignText("characterVersion", "character_version");
  assignText("world", "world");
  assignText("depthPrompt", "depth_prompt");

  const tags = parseStringList(readText("tags"));
  if (tags !== undefined) cmd.tags = tags;

  const alternateGreetings = parseStringList(readText("alternate_greetings"));
  if (alternateGreetings !== undefined) cmd.alternateGreetings = alternateGreetings;

  const talkativeness = parseNumberParam(params, "talkativeness");
  if (talkativeness !== undefined) {
    cmd.talkativeness = Math.max(0, Math.min(1, talkativeness));
  }

  const fav = parseBooleanParam(params, "fav");
  if (fav !== undefined) cmd.fav = fav;

  const depthPromptDepth = parseNumberParam(params, "depth_prompt_depth");
  if (depthPromptDepth !== undefined) {
    cmd.depthPromptDepth = Math.max(0, Math.floor(depthPromptDepth));
  }

  const depthPromptRole = readText("depth_prompt_role");
  if (depthPromptRole === "system" || depthPromptRole === "user" || depthPromptRole === "assistant") {
    cmd.depthPromptRole = depthPromptRole;
  }
}
/**
 * Parse all character commands from a message and return the cleaned message
 * with commands stripped out.
 */
export function parseCharacterCommands(content: string): {
  cleanContent: string;
  commands: CharacterCommand[];
} {
  const commands: CharacterCommand[] = [];

  // Parse schedule_update commands
  for (const match of content.matchAll(SCHEDULE_UPDATE_RE)) {
    const params = match[1]!;
    const cmd: ScheduleUpdateCommand = { type: "schedule_update" };

    const statusMatch = params.match(/status="([^"]+)"/);
    if (statusMatch) {
      const s = statusMatch[1]!.toLowerCase();
      if (["online", "idle", "dnd", "offline"].includes(s)) {
        cmd.status = s as ScheduleUpdateCommand["status"];
      }
    }

    const activityMatch = params.match(/activity="([^"]+)"/);
    if (activityMatch) cmd.activity = activityMatch[1]!;

    const durationMatch = params.match(/duration="([^"]+)"/);
    if (durationMatch) cmd.duration = durationMatch[1]!;

    commands.push(cmd);
  }

  // Parse cross_post commands
  for (const match of content.matchAll(CROSS_POST_RE)) {
    commands.push({ type: "cross_post", target: match[1]! });
  }

  // Parse selfie commands
  for (const match of content.matchAll(SELFIE_RE)) {
    const context = (match[1] ?? match[2] ?? match[3])?.trim();
    commands.push({ type: "selfie", context: context || undefined });
  }

  // Parse memory commands
  for (const match of content.matchAll(MEMORY_RE)) {
    commands.push({ type: "memory", target: match[1]!, summary: match[2]! });
  }

  // Parse scene commands
  for (const match of content.matchAll(SCENE_RE)) {
    const params = match[1]!;
    const cmd: SceneCommand = { type: "scene", scenario: "" };

    const scenarioMatch = params.match(/scenario="([^"]+)"/);
    if (scenarioMatch) cmd.scenario = scenarioMatch[1]!;

    const bgMatch = params.match(/background="([^"]+)"/);
    if (bgMatch) cmd.background = bgMatch[1]!;

    const planMatch = params.match(/plan="([^"]+)"/);
    if (planMatch) cmd.plan = planMatch[1]!;

    // Only add if we got a scenario
    if (cmd.scenario) commands.push(cmd);
  }

  // Parse influence commands (<influence>text</influence>)
  for (const match of content.matchAll(INFLUENCE_RE)) {
    const text = stripConversationPromptTimestamps(match[1]!.trim());
    if (text) commands.push({ type: "influence", content: text });
  }

  // Parse note commands (<note>text</note>)
  for (const match of content.matchAll(NOTE_RE)) {
    const text = stripConversationPromptTimestamps(match[1]!.trim());
    if (text) commands.push({ type: "note", content: text });
  }

  // Parse haptic commands
  for (const match of content.matchAll(HAPTIC_RE)) {
    const params = match[1]!;
    const cmd: HapticCommand = { type: "haptic", action: "vibrate" };
    const actionMatch = params.match(/action="([^"]+)"/);
    if (actionMatch) {
      const a = actionMatch[1]!.toLowerCase();
      if (["vibrate", "oscillate", "rotate", "position", "stop"].includes(a)) {
        cmd.action = a as HapticCommand["action"];
      }
    }
    const intensityMatch = params.match(/intensity=([0-9.]+)/);
    if (intensityMatch) {
      const v = parseFloat(intensityMatch[1]!);
      if (Number.isFinite(v)) cmd.intensity = Math.max(0, Math.min(1, v));
    }
    const durationMatch = params.match(/duration=([0-9.]+)/);
    if (durationMatch) {
      const v = parseFloat(durationMatch[1]!);
      if (Number.isFinite(v)) cmd.duration = Math.max(0, v);
    }
    commands.push(cmd);
  }

  // Parse Spotify song commands
  for (const match of content.matchAll(SPOTIFY_RE)) {
    const params = match[1]!;
    const title = parseQuotedParam(params, "title");
    const artist = parseQuotedParam(params, "artist");
    if (title && artist) {
      commands.push({ type: "spotify", title, artist });
    }
  }

  // Parse assistant commands (Professor Mari)
  for (const match of content.matchAll(CREATE_PERSONA_RE)) {
    const params = match[1]!;
    const cmd: CreatePersonaCommand = { type: "create_persona", name: "" };
    const name = parseQuotedParam(params, "name");
    if (name) cmd.name = name;
    const description = parseQuotedParam(params, "description");
    if (description) cmd.description = description;
    const personality = parseQuotedParam(params, "personality");
    if (personality) cmd.personality = personality;
    const appearance = parseQuotedParam(params, "appearance");
    if (appearance) cmd.appearance = appearance;
    if (cmd.name) commands.push(cmd);
  }

  for (const match of content.matchAll(CREATE_CHARACTER_RE)) {
    const params = match[1]!;
    const cmd: CreateCharacterCommand = { type: "create_character", name: "" };
    const name = parseQuotedParam(params, "name");
    if (name) cmd.name = name;
    applyCommonCharacterFields(cmd, params, { allowEmptyStrings: false });
    if (cmd.name) commands.push(cmd);
  }

  for (const match of content.matchAll(UPDATE_CHARACTER_RE)) {
    const params = match[1]!;
    const cmd: UpdateCharacterCommand = { type: "update_character", name: "" };
    const name = parseQuotedParam(params, "name");
    if (name) cmd.name = name;
    applyCommonCharacterFields(cmd, params, { allowEmptyStrings: true });
    if (cmd.name) commands.push(cmd);
  }

  for (const match of content.matchAll(UPDATE_PERSONA_RE)) {
    const params = match[1]!;
    const cmd: UpdatePersonaCommand = { type: "update_persona", name: "" };
    const name = parseQuotedParam(params, "name");
    if (name) cmd.name = name;
    const description = parseQuotedParam(params, "description", true);
    if (description !== undefined) cmd.description = description;
    const personality = parseQuotedParam(params, "personality", true);
    if (personality !== undefined) cmd.personality = personality;
    const appearance = parseQuotedParam(params, "appearance", true);
    if (appearance !== undefined) cmd.appearance = appearance;
    const scenario = parseQuotedParam(params, "scenario", true);
    if (scenario !== undefined) cmd.scenario = scenario;
    const backstory = parseQuotedParam(params, "backstory", true);
    if (backstory !== undefined) cmd.backstory = backstory;
    if (cmd.name) commands.push(cmd);
  }

  for (const match of content.matchAll(CREATE_LOREBOOK_BLOCK_RE)) {
    const cmd = parseLorebookBlock(match[1] ?? "");
    if (cmd) commands.push(cmd);
  }

  for (const match of content.matchAll(UPDATE_LOREBOOK_BLOCK_RE)) {
    const cmd = parseUpdateLorebookBlock(match[1] ?? "");
    if (cmd) commands.push(cmd);
  }

  for (const match of content.matchAll(CREATE_LOREBOOK_RE)) {
    const params = match[1]!;
    const name = parseQuotedParam(params, "name");
    if (!name) continue;
    const entriesParam = parseQuotedParam(params, "entries");
    commands.push({
      type: "create_lorebook",
      name,
      description: parseQuotedParam(params, "description"),
      category: parseQuotedParam(params, "category"),
      tags: parseStringList(parseQuotedParam(params, "tags")),
      entries: entriesParam ? parseLorebookEntriesParam(entriesParam) : undefined,
    });
  }

  for (const match of content.matchAll(CREATE_CHAT_RE)) {
    const params = match[1]!;
    const cmd: CreateChatCommand = { type: "create_chat", character: "" };
    const charMatch = params.match(/character="([^"]+)"/);
    if (charMatch) cmd.character = charMatch[1]!;
    const modeMatch = params.match(/mode="([^"]+)"/);
    if (modeMatch && (modeMatch[1] === "conversation" || modeMatch[1] === "roleplay")) {
      cmd.mode = modeMatch[1];
    }
    if (cmd.character) commands.push(cmd);
  }

  for (const match of content.matchAll(NAVIGATE_RE)) {
    const params = match[1]!;
    const cmd: NavigateCommand = { type: "navigate", panel: "" };
    const panelMatch = params.match(/panel="([^"]+)"/);
    if (panelMatch) cmd.panel = panelMatch[1]!;
    const tabMatch = params.match(/tab="([^"]+)"/);
    if (tabMatch) cmd.tab = tabMatch[1]!;
    if (cmd.panel) commands.push(cmd);
  }

  for (const match of content.matchAll(FETCH_RE)) {
    const params = match[1]!;
    const cmd: FetchCommand = { type: "fetch", fetchType: "character", name: "" };
    const typeMatch = params.match(/type="([^"]+)"/);
    if (typeMatch) {
      const t = typeMatch[1]!.toLowerCase();
      if (["character", "persona", "lorebook", "chat", "preset"].includes(t)) {
        cmd.fetchType = t as FetchCommand["fetchType"];
      }
    }
    const nameMatch = params.match(/name="([^"]+)"/);
    if (nameMatch) cmd.name = nameMatch[1]!;
    if (cmd.name) commands.push(cmd);
  }

  // Strip all commands from the visible content
  let cleanContent = content
    .replace(SCHEDULE_UPDATE_RE, "")
    .replace(CROSS_POST_RE, "")
    .replace(SELFIE_RE, "")
    .replace(MEMORY_RE, "")
    .replace(SCENE_RE, "")
    .replace(HAPTIC_RE, "")
    .replace(SPOTIFY_RE, "")
    .replace(INFLUENCE_RE, "")
    .replace(NOTE_RE, "")
    .replace(CREATE_PERSONA_RE, "")
    .replace(CREATE_CHARACTER_RE, "")
    .replace(UPDATE_CHARACTER_RE, "")
    .replace(UPDATE_PERSONA_RE, "")
    .replace(CREATE_LOREBOOK_BLOCK_RE, "")
    .replace(UPDATE_LOREBOOK_BLOCK_RE, "")
    .replace(CREATE_LOREBOOK_RE, "")
    .replace(CREATE_CHAT_RE, "")
    .replace(NAVIGATE_RE, "")
    .replace(FETCH_RE, "")
    .replace(/\n{3,}/g, "\n\n") // collapse excessive newlines left by removals
    .trim();

  return { cleanContent, commands };
}

/** Parse Roleplay-only direct-message commands without enabling the wider Conversation command set. */
export function parseDirectMessageCommands(content: string): {
  cleanContent: string;
  commands: DirectMessageCommand[];
} {
  const commands: DirectMessageCommand[] = [];

  for (const match of content.matchAll(DIRECT_MESSAGE_RE)) {
    const params = match[1]!;
    const character = parseQuotedParam(params, "character");
    const message = parseQuotedParam(params, "message");
    const cleanMessage = message ? stripConversationPromptTimestamps(message.trim()) : "";
    if (character && cleanMessage) {
      commands.push({ type: "dm", character, message: cleanMessage });
    }
  }

  const cleanContent = content
    .replace(DIRECT_MESSAGE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanContent, commands };
}

/**
 * Parse a duration string like "2h", "30m", "1h30m" into minutes.
 * Returns null if unparseable.
 */
export function parseDuration(duration: string): number | null {
  const hourMatch = duration.match(/(\d+)\s*h/i);
  const minMatch = duration.match(/(\d+)\s*m/i);

  let total = 0;
  if (hourMatch) total += parseInt(hourMatch[1]!) * 60;
  if (minMatch) total += parseInt(minMatch[1]!);

  return total > 0 ? total : null;
}
