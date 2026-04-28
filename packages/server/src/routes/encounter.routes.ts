// ──────────────────────────────────────────────
// Routes: Combat Encounter (non-streaming JSON)
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createGameStateStorage } from "../services/storage/game-state.storage.js";
import { createLorebooksStorage } from "../services/storage/lorebooks.storage.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import type { ChatMessage } from "../services/llm/base-provider.js";
import type {
  EncounterInitRequest,
  EncounterActionRequest,
  EncounterSummaryRequest,
  NarrativeStyle,
  CombatPartyMember,
  CombatEnemy,
  CombatPlayerActions,
  EncounterLogEntry,
} from "@marinara-engine/shared";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Resolve a connection (handles "random" pool + baseUrl fallback). */
async function resolveConnection(
  connections: ReturnType<typeof createConnectionsStorage>,
  connId: string | null,
  chatConnectionId: string | null,
) {
  let id = connId ?? chatConnectionId;
  if (id === "random") {
    const pool = await connections.listRandomPool();
    if (!pool.length) throw new Error("No connections marked for the random pool");
    id = pool[Math.floor(Math.random() * pool.length)].id;
  }
  if (!id) throw new Error("No API connection configured");
  const conn = await connections.getWithKey(id);
  if (!conn) throw new Error("API connection not found");

  let baseUrl = conn.baseUrl;
  if (!baseUrl) {
    const { PROVIDERS } = await import("@marinara-engine/shared");
    const providerDef = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
    baseUrl = providerDef?.defaultBaseUrl ?? "";
  }
  // Claude (Subscription) uses the local Claude Agent SDK and has no HTTP
  // endpoint — return a sentinel so the gate passes. The provider ignores it.
  if (!baseUrl && conn.provider === "claude_subscription") baseUrl = "claude-agent-sdk://local";
  if (!baseUrl) throw new Error("No base URL configured for this connection");

  return { conn, baseUrl };
}

/** Extract reliable JSON from an LLM response that may include markdown fences. */
function parseJSON(raw: string): unknown {
  // Strip code fences (```json ... ``` or ``` ... ```)
  let cleaned = raw
    .trim()
    .replace(/^```(?:json|markdown)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "");
  // Find the first { and use balanced braces to find the matching }
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in AI response");
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.substring(start, i + 1));
    }
  }
  throw new Error("Unbalanced JSON in AI response");
}

/** Build character context from the chat's character IDs. */
async function buildCharacterContext(chars: ReturnType<typeof createCharactersStorage>, characterIds: string[]) {
  let ctx = "";
  for (const cid of characterIds) {
    const row = await chars.getById(cid);
    if (!row) continue;
    const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    ctx += `<character="${data.name}">\n`;
    if (data.description) ctx += `${data.description}\n`;
    if (data.personality) ctx += `${data.personality}\n`;
    ctx += `</character>\n\n`;
  }
  return ctx;
}

/** Build persona context. */
async function buildPersonaContext(chars: ReturnType<typeof createCharactersStorage>) {
  const allPersonas = await chars.listPersonas();
  const active = allPersonas.find((p) => p.isActive === "true");
  if (!active) return { personaName: "User", personaCtx: "No persona information available." };
  let ctx = `Name: ${active.name}\n`;
  if (active.description) ctx += `${active.description}\n`;
  if (active.personality) ctx += `${active.personality}\n`;
  if (active.backstory) ctx += `${active.backstory}\n`;
  if (active.appearance) ctx += `${active.appearance}\n`;
  return { personaName: active.name, personaCtx: ctx };
}

/** Get the latest game state context string for the chat. */
async function buildGameStateContext(
  gsStorage: ReturnType<typeof createGameStateStorage>,
  chatId: string,
  personaName: string,
) {
  const gs = await gsStorage.getLatest(chatId);
  if (!gs) return "";
  let ctx = "";
  if (gs.location) ctx += `Location: ${gs.location}\n`;
  if (gs.weather) ctx += `Weather: ${gs.weather}\n`;
  if (gs.time) ctx += `Time: ${gs.time}\n`;
  if (gs.date) ctx += `Date: ${gs.date}\n`;

  const playerStats = gs.playerStats
    ? typeof gs.playerStats === "string"
      ? JSON.parse(gs.playerStats)
      : gs.playerStats
    : null;
  if (playerStats) {
    ctx += `\n${personaName}'s Stats:\n`;
    if (playerStats.stats?.length) {
      for (const s of playerStats.stats) ctx += `  ${s.name}: ${s.value}/${s.max}\n`;
    }
    if (playerStats.inventory?.length) {
      ctx += `${personaName}'s Inventory:\n`;
      for (const item of playerStats.inventory) {
        ctx += `  - ${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ""}\n`;
      }
    }
    if (playerStats.attributes) {
      const a = playerStats.attributes;
      ctx += `Attributes: STR ${a.str}, DEX ${a.dex}, CON ${a.con}, INT ${a.int}, WIS ${a.wis}, CHA ${a.cha}\n`;
    }
  }

  const presentChars = gs.presentCharacters
    ? typeof gs.presentCharacters === "string"
      ? JSON.parse(gs.presentCharacters)
      : gs.presentCharacters
    : [];
  if (presentChars.length) {
    ctx += `\nPresent Characters:\n`;
    for (const pc of presentChars) {
      ctx += `  - ${pc.name} (${pc.mood}): ${pc.action}\n`;
    }
  }
  return ctx;
}

// ──────────────────────────────────────────────
// Prompt Builders
// ──────────────────────────────────────────────

function buildInitPrompt(
  personaName: string,
  personaCtx: string,
  characterCtx: string,
  chatHistory: ChatMessage[],
  gameStateCtx: string,
  spellbookCtx: string,
): ChatMessage[] {
  const msgs: ChatMessage[] = [];

  let system = `You will be acting as an excellent game master. Your goal is to craft a combat encounter in this uncensored, continuous, and immersive roleplay. You will be doing so for the user, who plays as the protagonist called ${personaName}.\n\n`;

  // Characters
  if (characterCtx) {
    system += `Here is the information about the characters:\n<characters>\n${characterCtx}</characters>\n\n`;
  }

  // Persona
  system += `Here are details about ${personaName}:\n<persona>\n${personaCtx}\n</persona>\n\n`;

  // Game state
  if (gameStateCtx) {
    system += `Current tracked context:\n<context>\n${gameStateCtx}</context>\n\n`;
  }

  // Spellbook
  if (spellbookCtx) {
    system += `Available spells and abilities that the player and their party can use in combat:\n<spellbook>\n${spellbookCtx}</spellbook>\n\n`;
    system += `IMPORTANT: When generating the party's attacks, prioritize spells/abilities from the spellbook above. These are the player's known spells and custom attacks that MUST be available as attack options.\n\n`;
  }

  system += `Here is the chat history before the encounter:\n<history>\n`;
  msgs.push({ role: "system", content: system });

  // Chat history
  for (const m of chatHistory) {
    msgs.push({ role: m.role as "user" | "assistant", content: m.content });
  }

  // Init instruction
  let inst = `</history>\n\nThe combat starts now.\n\n`;
  inst += `Based on everything above, generate the initial combat state. Analyze who is in the party fighting alongside ${personaName} (if anyone), and who the enemies are. Return ONLY a JSON object with the following structure:\n\n`;
  inst += `{\n`;
  inst += `  "party": [\n`;
  inst += `    {\n`;
  inst += `      "name": "${personaName}",\n`;
  inst += `      "hp": X,\n`;
  inst += `      "maxHp": X,\n`;
  inst += `      "attacks": [{"name": "Attack", "type": "single-target|AoE|both"}],\n`;
  inst += `      "items": ["Item Name x3"],\n`;
  inst += `      "statuses": [],\n`;
  inst += `      "isPlayer": true\n`;
  inst += `    }\n`;
  inst += `  ],\n`;
  inst += `  "enemies": [\n`;
  inst += `    {\n`;
  inst += `      "name": "Enemy Name",\n`;
  inst += `      "hp": X,\n`;
  inst += `      "maxHp": X,\n`;
  inst += `      "attacks": [{"name": "Attack1", "type": "single-target|AoE|both"}],\n`;
  inst += `      "statuses": [],\n`;
  inst += `      "description": "Brief enemy description",\n`;
  inst += `      "sprite": "emoji or brief visual description"\n`;
  inst += `    }\n`;
  inst += `  ],\n`;
  inst += `  "environment": "Brief description of the combat environment",\n`;
  inst += `  "styleNotes": {\n`;
  inst += `    "environmentType": "forest|dungeon|desert|cave|city|ruins|snow|water|castle|wasteland|plains|mountains|swamp|volcanic|spaceship|mansion",\n`;
  inst += `    "atmosphere": "bright|dark|foggy|stormy|calm|eerie|chaotic|peaceful",\n`;
  inst += `    "timeOfDay": "dawn|day|dusk|night|twilight",\n`;
  inst += `    "weather": "clear|rainy|snowy|windy|stormy|overcast"\n`;
  inst += `  }\n`;
  inst += `}\n\n`;
  inst += `IMPORTANT NOTES:\n`;
  inst += `- attacks: each has "name" and "type" (single-target, AoE, or both)\n`;
  inst += `- items: include quantities "Item Name xN". If consumed to 0, remove.\n`;
  inst += `- statuses: format {"name":"Status","emoji":"💀","duration":X}\n`;
  inst += `- Use the player's stats/inventory from the context to populate their data.\n`;
  inst += `- Ensure HP values are realistic for the setting. Return ONLY the JSON.\n`;
  inst += `- Write ALL text values (environment, descriptions, attack names, item names, etc.) in the same language the chat history is written in.\n`;

  msgs.push({ role: "user", content: inst });
  return msgs;
}

function buildActionPrompt(
  personaName: string,
  personaCtx: string,
  characterCtx: string,
  chatHistory: ChatMessage[],
  action: string,
  combatStats: { party: CombatPartyMember[]; enemies: CombatEnemy[]; environment: string },
  playerActions: CombatPlayerActions | null,
  encounterLog: EncounterLogEntry[],
  narrative: NarrativeStyle,
  spellbookCtx: string,
): ChatMessage[] {
  const msgs: ChatMessage[] = [];

  let system = `You are the game master managing this combat encounter. You must not play as ${personaName} — only describe what happens as a result of their actions and control NPCs/enemies.\n\n`;
  if (characterCtx) {
    system += `<characters>\n${characterCtx}</characters>\n\n`;
  }
  system += `<persona>\n${personaCtx}\n</persona>\n\n`;
  if (spellbookCtx) {
    system += `Available spells and abilities:\n<spellbook>\n${spellbookCtx}</spellbook>\n\n`;
  }
  msgs.push({ role: "system", content: system });

  // Recent chat history for context (already sliced to historyDepth by caller)
  for (const m of chatHistory) {
    msgs.push({ role: m.role as "user" | "assistant", content: m.content });
  }

  // Previous combat actions
  if (encounterLog.length) {
    let log = "Previous Combat Actions:\n";
    for (const e of encounterLog) {
      log += `- ${e.action}\n`;
      if (e.result) log += `  ${e.result}\n`;
    }
    msgs.push({ role: "user", content: log });
  }

  // Current combat state + action + response format
  let state = `Current Combat State:\n`;
  state += `Environment: ${combatStats.environment || "Unknown location"}\n\n`;
  state += `Party Members:\n`;
  for (const m of combatStats.party) {
    state += `- ${m.name}${m.isPlayer ? " (Player)" : ""}: ${m.hp}/${m.maxHp} HP\n`;
    const attacks = m.isPlayer && playerActions?.attacks ? playerActions.attacks : m.attacks;
    const items = m.isPlayer && playerActions?.items ? playerActions.items : m.items;
    if (attacks?.length) state += `  Attacks: ${attacks.map((a) => (typeof a === "string" ? a : a.name)).join(", ")}\n`;
    if (items?.length) state += `  Items: ${items.join(", ")}\n`;
    if (m.statuses?.length) state += `  Status Effects: ${m.statuses.map((s) => `${s.emoji} ${s.name}`).join(", ")}\n`;
  }
  state += `\nEnemies:\n`;
  for (const e of combatStats.enemies) {
    state += `- ${e.name} (${e.sprite || ""}): ${e.hp}/${e.maxHp} HP\n`;
    if (e.description) state += `  ${e.description}\n`;
    if (e.attacks?.length) state += `  Attacks: ${e.attacks.map((a) => a.name).join(", ")}\n`;
    if (e.statuses?.length) state += `  Status Effects: ${e.statuses.map((s) => `${s.emoji} ${s.name}`).join(", ")}\n`;
  }

  state += `\n${personaName}'s Action: ${action}\n\n`;
  state += `Respond ONLY with a JSON object:\n`;
  state += `{\n`;
  state += `  "combatStats": {\n`;
  state += `    "party": [{"name":"Name","hp":X,"maxHp":X,"statuses":[],"isPlayer":true|false}],\n`;
  state += `    "enemies": [{"name":"Name","hp":X,"maxHp":X,"statuses":[]}]\n`;
  state += `  },\n`;
  state += `  "playerActions": {\n`;
  state += `    "attacks": [{"name":"Attack","type":"single-target|AoE|both"}],\n`;
  state += `    "items": ["Item Name x3"]\n`;
  state += `  },\n`;
  state += `  "enemyActions": [{"enemyName":"Name","action":"what they do","target":"target"}],\n`;
  state += `  "partyActions": [{"memberName":"Name","action":"what they do","target":"target"}],\n`;
  state += `  "narrative": "The roleplay description of what happens"\n`;
  state += `}\n\n`;
  state += `If all enemies defeated: add "combatEnd": true, "result": "victory".\n`;
  state += `If all party defeated: add "combatEnd": true, "result": "defeat".\n`;
  state += `If interrupted: add "combatEnd": true, "result": "interrupted".\n\n`;
  state += `Update items/attacks if consumed. Status durations decrease each turn (remove at 0).\n`;
  state += `Scale difficulty: powerful foes take multiple rounds, weak foes fall quickly.\n`;
  state += `Write the narrative in ${narrative.tense} tense ${narrative.person}-person ${narrative.narration} from ${narrative.pov}'s point of view.\n`;
  state += `Build novel prose, vary structures, avoid GPTisms and purple prose. No asterisks or em-dashes. Under 150 words. Do not play for ${personaName}.\n`;
  state += `Write in the same language the chat history is written in.\n`;

  msgs.push({ role: "user", content: state });
  return msgs;
}

function buildSummaryPrompt(
  personaName: string,
  personaCtx: string,
  characterCtx: string,
  encounterLog: EncounterLogEntry[],
  result: string,
  narrative: NarrativeStyle,
): ChatMessage[] {
  const msgs: ChatMessage[] = [];

  let system = `You are summarizing a combat encounter that just concluded.\n\n`;
  if (characterCtx) {
    system += `<characters>\n${characterCtx}</characters>\n\n`;
  }
  system += `<persona>\n${personaCtx}\n</persona>\n\n`;
  msgs.push({ role: "system", content: system });

  let user = `Combat has ended with result: ${result}\n\nFull Combat Log:\n`;
  encounterLog.forEach((entry, i) => {
    user += `\nRound ${i + 1}:\n${entry.action}\n${entry.result}\n`;
  });
  user += `\n\nProvide a narrative summary of the entire fight.\n`;
  user += `Write in ${narrative.tense} tense ${narrative.person}-person ${narrative.narration} from ${narrative.pov}'s point of view.\n`;
  user += `Build novel prose, vary structures, avoid GPTisms and purple prose. Include dialogue from enemies/NPCs in direct quotes. Express ${personaName}'s actions using only indirect speech.\n`;
  user += `No asterisks, ellipses, or em-dashes. Explicit content allowed. Finish naturally.\n`;
  user += `Write in the same language the combat log is written in.\n`;

  msgs.push({ role: "user", content: user });
  return msgs;
}

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────

export async function encounterRoutes(app: FastifyInstance) {
  const chats = createChatsStorage(app.db);
  const connections = createConnectionsStorage(app.db);
  const chars = createCharactersStorage(app.db);
  const gsStorage = createGameStateStorage(app.db);
  const lbStorage = createLorebooksStorage(app.db);

  /** Load spellbook entries and format them as context text. */
  async function loadSpellbookContext(spellbookId: string | null | undefined): Promise<string> {
    if (!spellbookId) return "";
    const entries = await lbStorage.listEntriesByLorebooks([spellbookId]);
    if (!entries.length) return "";
    let ctx = "";
    for (const entry of entries) {
      if (!entry.enabled) continue;
      const e = entry as Record<string, unknown>;
      ctx += `<spell name="${e.name}">\n${e.content}\n</spell>\n`;
    }
    return ctx;
  }

  // ───────────────────────── INIT ─────────────────────────
  app.post<{ Body: EncounterInitRequest }>("/init", async (req, reply) => {
    const { chatId, connectionId, settings, spellbookId } = req.body;

    if (!chatId || !settings) {
      return reply.status(400).send({ error: "Missing required fields: chatId, settings" });
    }

    try {
      const chat = await chats.getById(chatId);
      if (!chat) return reply.status(404).send({ error: "Chat not found" });

      const { conn, baseUrl } = await resolveConnection(connections, connectionId, chat.connectionId);
      const provider = createLLMProvider(conn.provider, baseUrl, conn.apiKey, conn.maxContext, conn.openrouterProvider, conn.maxTokensOverride);

      const characterIds: string[] = JSON.parse(chat.characterIds as string);
      const characterCtx = await buildCharacterContext(chars, characterIds);
      const { personaName, personaCtx } = await buildPersonaContext(chars);
      const gameStateCtx = await buildGameStateContext(gsStorage, chatId, personaName);
      const spellbookCtx = await loadSpellbookContext(spellbookId);

      // Get recent chat messages for history
      const chatMessages = await chats.listMessages(chatId);
      const depth = settings.historyDepth || 8;
      const recentMsgs: ChatMessage[] = chatMessages.slice(-depth).map((m: any) => ({
        role: (m.role === "narrator" ? "system" : m.role) as "user" | "assistant" | "system",
        content: m.content as string,
      }));

      const prompt = buildInitPrompt(personaName, personaCtx, characterCtx, recentMsgs, gameStateCtx, spellbookCtx);

      const result = await provider.chatComplete(prompt, {
        model: conn.model,
        temperature: 0.8,
        maxTokens: 8192,
      });

      if (!result.content) {
        return reply.status(502).send({ error: "No response from AI" });
      }

      let combatState: Record<string, unknown>;
      try {
        combatState = parseJSON(result.content) as Record<string, unknown>;
      } catch {
        return reply.status(502).send({ error: "AI returned invalid JSON" });
      }

      if (!combatState?.party || !combatState?.enemies) {
        return reply.status(502).send({ error: "Invalid combat data returned by AI" });
      }

      return { combatState };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: `Encounter init failed: ${message}` });
    }
  });

  // ───────────────────────── ACTION ─────────────────────────
  app.post<{ Body: EncounterActionRequest }>("/action", async (req, reply) => {
    const { chatId, connectionId, action, combatStats, playerActions, encounterLog, settings, spellbookId } = req.body;

    if (!chatId || !action || !combatStats || !settings) {
      return reply.status(400).send({ error: "Missing required fields: chatId, action, combatStats, settings" });
    }

    try {
      const chat = await chats.getById(chatId);
      if (!chat) return reply.status(404).send({ error: "Chat not found" });

      const { conn, baseUrl } = await resolveConnection(connections, connectionId, chat.connectionId);
      const provider = createLLMProvider(conn.provider, baseUrl, conn.apiKey, conn.maxContext, conn.openrouterProvider, conn.maxTokensOverride);

      const characterIds: string[] = JSON.parse(chat.characterIds as string);
      const characterCtx = await buildCharacterContext(chars, characterIds);
      const { personaName, personaCtx } = await buildPersonaContext(chars);
      const spellbookCtx = await loadSpellbookContext(spellbookId);

      const chatMessages = await chats.listMessages(chatId);
      const depth = settings.historyDepth || 8;
      const recentMsgs: ChatMessage[] = chatMessages.slice(-depth).map((m: any) => ({
        role: (m.role === "narrator" ? "system" : m.role) as "user" | "assistant" | "system",
        content: m.content as string,
      }));

      const prompt = buildActionPrompt(
        personaName,
        personaCtx,
        characterCtx,
        recentMsgs,
        action,
        combatStats,
        playerActions,
        encounterLog ?? [],
        settings.combatNarrative,
        spellbookCtx,
      );

      const result = await provider.chatComplete(prompt, {
        model: conn.model,
        temperature: 0.8,
        maxTokens: 8192,
      });

      if (!result.content) {
        return reply.status(502).send({ error: "No response from AI" });
      }

      let actionResult: Record<string, unknown>;
      try {
        actionResult = parseJSON(result.content) as Record<string, unknown>;
      } catch {
        return reply.status(502).send({ error: "AI returned invalid JSON for action result" });
      }

      if (!actionResult?.combatStats) {
        return reply.status(502).send({ error: "Invalid action result returned by AI" });
      }

      // Validate that party/enemies are actual arrays — AI may return null, a string, or omit them
      const cs = actionResult.combatStats as Record<string, unknown>;
      if (!Array.isArray(cs.party)) cs.party = combatStats.party;
      if (!Array.isArray(cs.enemies)) cs.enemies = combatStats.enemies;

      // Sanitize playerActions — AI may return attacks/items as strings or omit them
      if (actionResult.playerActions && typeof actionResult.playerActions === "object") {
        const pa = actionResult.playerActions as Record<string, unknown>;
        if (!Array.isArray(pa.attacks)) pa.attacks = playerActions?.attacks ?? [];
        if (!Array.isArray(pa.items)) pa.items = playerActions?.items ?? [];
      }

      // Ensure enemyActions / partyActions are arrays
      if (!Array.isArray(actionResult.enemyActions)) actionResult.enemyActions = [];
      if (!Array.isArray(actionResult.partyActions)) actionResult.partyActions = [];

      // Ensure narrative is a string
      if (typeof actionResult.narrative !== "string") actionResult.narrative = "";

      return { result: actionResult };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: `Encounter action failed: ${message}` });
    }
  });

  // ───────────────────────── SUMMARY ─────────────────────────
  app.post<{ Body: EncounterSummaryRequest }>("/summary", async (req, reply) => {
    const { chatId, connectionId, encounterLog, result: combatResult, settings } = req.body;

    const validResults = ["victory", "defeat", "fled", "interrupted"];
    if (!chatId || !encounterLog?.length || !combatResult || !settings) {
      return reply.status(400).send({ error: "Missing required fields: chatId, encounterLog, result, settings" });
    }
    if (!validResults.includes(combatResult)) {
      return reply.status(400).send({ error: `Invalid result. Must be one of: ${validResults.join(", ")}` });
    }

    try {
      const chat = await chats.getById(chatId);
      if (!chat) return reply.status(404).send({ error: "Chat not found" });

      const { conn, baseUrl } = await resolveConnection(connections, connectionId, chat.connectionId);
      const provider = createLLMProvider(conn.provider, baseUrl, conn.apiKey, conn.maxContext, conn.openrouterProvider, conn.maxTokensOverride);

      const characterIds: string[] = JSON.parse(chat.characterIds as string);
      const characterCtx = await buildCharacterContext(chars, characterIds);
      const { personaName, personaCtx } = await buildPersonaContext(chars);

      const prompt = buildSummaryPrompt(
        personaName,
        personaCtx,
        characterCtx,
        encounterLog,
        combatResult,
        settings.summaryNarrative,
      );

      const result = await provider.chatComplete(prompt, {
        model: conn.model,
        temperature: 0.9,
        maxTokens: 8192,
      });

      if (!result.content) {
        return reply.status(502).send({ error: "No response from AI for summary" });
      }

      const summary = result.content.replace(/\[FIGHT CONCLUDED\]\s*/i, "").trim();

      // Save the summary as a narrator message (not attributed to a specific character)
      const msg = await chats.createMessage({
        chatId,
        role: "assistant",
        characterId: null,
        content: summary,
      });

      return { summary, messageId: msg?.id ?? "" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: `Encounter summary failed: ${message}` });
    }
  });
}
