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
// - [selfie] or [selfie: context="description of the selfie"]
// - [memory: target="CharName", summary="description of the memory"]
// - [scene: scenario="...", background="...", plan="..."] (initiate a mini-roleplay scene)
// - [haptic: action="vibrate", intensity=0.5, duration=3] (haptic device feedback)
// - <influence>text</influence> (OOC influence for connected roleplay, one-shot)
// - <note>text</note> (durable note for connected roleplay, persists until cleared)
//
// Assistant commands (Professor Mari):
// - [create_persona: name="...", description="...", personality="...", appearance="..."]
// - [create_character: name="...", description="...", personality="...", first_message="...", scenario="...", backstory="...", appearance="...", mes_example="...", creator_notes="...", system_prompt="...", post_history_instructions="...", creator="...", character_version="...", tags="tag1, tag2", alternate_greetings="hello || hi", talkativeness=0.5, fav=true, world="...", depth_prompt="...", depth_prompt_depth=4, depth_prompt_role="system"]
// - [update_character: name="...", description="...", personality="...", first_message="...", scenario="...", backstory="...", appearance="...", mes_example="...", creator_notes="...", system_prompt="...", post_history_instructions="...", creator="...", character_version="...", tags="tag1, tag2", alternate_greetings="hello || hi", talkativeness=0.5, fav=true, world="...", depth_prompt="...", depth_prompt_depth=4, depth_prompt_role="system"]
// - [update_persona: name="...", description="...", personality="...", appearance="...", scenario="...", backstory="..."]
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

export interface HapticCommand {
  type: "haptic";
  /** Device action */
  action: "vibrate" | "oscillate" | "rotate" | "position" | "stop";
  /** Intensity / speed (0.0-1.0) */
  intensity?: number;
  /** Duration in seconds */
  duration?: number;
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
  | HapticCommand
  | AssistantCommand;

/** Regex patterns for each command type */
const SCHEDULE_UPDATE_RE = /\[schedule_update:\s*([^\]]+)\]/gi;
const CROSS_POST_RE = /\[cross_post:\s*target="([^"]+)"\]/gi;
const SELFIE_RE = /\[selfie(?::\s*context="([^"]*)")?\]/gi;
const MEMORY_RE = /\[memory:\s*target="([^"]+)"\s*,\s*summary="([^"]+)"\]/gi;
const SCENE_RE = /\[scene:\s*([^\]]+)\]/gi;
const HAPTIC_RE = /\[haptic:\s*([^\]]+)\]/gi;
const INFLUENCE_RE = /<influence>([\s\S]*?)<\/influence>/gi;
const NOTE_RE = /<note>([\s\S]*?)<\/note>/gi;

// Assistant command regexes
const CREATE_PERSONA_RE = /\[create_persona:\s*([^\]]+)\]/gi;
const CREATE_CHARACTER_RE = /\[create_character:\s*([^\]]+)\]/gi;
const UPDATE_CHARACTER_RE = /\[update_character:\s*([^\]]+)\]/gi;
const UPDATE_PERSONA_RE = /\[update_persona:\s*([^\]]+)\]/gi;
const CREATE_CHAT_RE = /\[create_chat:\s*([^\]]+)\]/gi;
const NAVIGATE_RE = /\[navigate:\s*([^\]]+)\]/gi;
const FETCH_RE = /\[fetch:\s*([^\]]+)\]/gi;

function parseQuotedParam(params: string, key: string, allowEmpty = false): string | undefined {
  const match = params.match(new RegExp(`${key}="([^"]*)"`));
  if (!match) return undefined;
  const value = match[1] ?? "";
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
    commands.push({ type: "selfie", context: match[1] || undefined });
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

  // Parse assistant commands (Professor Mari)
  for (const match of content.matchAll(CREATE_PERSONA_RE)) {
    const params = match[1]!;
    const cmd: CreatePersonaCommand = { type: "create_persona", name: "" };
    const nameMatch = params.match(/name="([^"]+)"/);
    if (nameMatch) cmd.name = nameMatch[1]!;
    const descMatch = params.match(/description="([^"]+)"/);
    if (descMatch) cmd.description = descMatch[1]!;
    const persMatch = params.match(/personality="([^"]+)"/);
    if (persMatch) cmd.personality = persMatch[1]!;
    const appMatch = params.match(/appearance="([^"]+)"/);
    if (appMatch) cmd.appearance = appMatch[1]!;
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
    const nameMatch = params.match(/name="([^"]+)"/);
    if (nameMatch) cmd.name = nameMatch[1]!;
    const descMatch = params.match(/description="([^"]*)"/);
    if (descMatch) cmd.description = descMatch[1]!;
    const persMatch = params.match(/personality="([^"]*)"/);
    if (persMatch) cmd.personality = persMatch[1]!;
    const appMatch = params.match(/appearance="([^"]*)"/);
    if (appMatch) cmd.appearance = appMatch[1]!;
    const scenarioMatch = params.match(/scenario="([^"]*)"/);
    if (scenarioMatch) cmd.scenario = scenarioMatch[1]!;
    const backstoryMatch = params.match(/backstory="([^"]*)"/);
    if (backstoryMatch) cmd.backstory = backstoryMatch[1]!;
    if (cmd.name) commands.push(cmd);
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
    .replace(INFLUENCE_RE, "")
    .replace(NOTE_RE, "")
    .replace(CREATE_PERSONA_RE, "")
    .replace(CREATE_CHARACTER_RE, "")
    .replace(UPDATE_CHARACTER_RE, "")
    .replace(UPDATE_PERSONA_RE, "")
    .replace(CREATE_CHAT_RE, "")
    .replace(NAVIGATE_RE, "")
    .replace(FETCH_RE, "")
    .replace(/\n{3,}/g, "\n\n") // collapse excessive newlines left by removals
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
