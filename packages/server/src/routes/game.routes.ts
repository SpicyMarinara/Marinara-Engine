// ──────────────────────────────────────────────
// Routes: Game Mode
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { extname, join } from "path";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createGalleryStorage } from "../services/storage/gallery.storage.js";
import { createGameStateStorage } from "../services/storage/game-state.storage.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import { extractLeadingThinkingBlocks } from "../services/llm/inline-thinking.js";
import { fitMessagesToContext, type ChatMessage, type ChatOptions } from "../services/llm/base-provider.js";
import { isDiceNotation, rollDice } from "../services/game/dice.service.js";
import { validateTransition } from "../services/game/state-machine.service.js";
import {
  buildSetupPrompt,
  buildGmSystemPrompt,
  buildSessionConclusionPrompt,
  buildCampaignProgressionPrompt,
  buildPartyRecruitCardPrompt,
  type GmPromptContext,
} from "../services/game/gm-prompts.js";
import { buildPartySystemPrompt } from "../services/game/party-prompts.js";
import { listPartySprites } from "../services/game/sprite.service.js";
import {
  buildSceneAnalyzerSystemPrompt,
  buildSceneAnalyzerUserPrompt,
  type SceneAnalyzerContext,
} from "../services/sidecar/scene-analyzer.js";
import { postProcessSceneResult, type PostProcessContext } from "../services/sidecar/scene-postprocess.js";
import { buildRecapPrompt } from "../services/game/session.service.js";
import { buildMapGenerationPrompt } from "../services/game/map.service.js";
import {
  ensureGameMapId,
  getGameMapId,
  getGameMapsFromMeta,
  syncGameMapMetaPartyPosition,
  withActiveGameMapMeta,
} from "../services/game/map-position.service.js";
import { resolveCombatRound, type CombatantStats } from "../services/game/combat.service.js";
import { getElementPreset, listElementPresets } from "../services/game/element-reactions.service.js";
import { generateCombatLoot, generateLootTable } from "../services/game/loot.service.js";
import { advanceTime, formatGameTime, createInitialTime, type GameTime } from "../services/game/time.service.js";
import { generateWeather, inferBiome, shouldWeatherChange } from "../services/game/weather.service.js";
import { rollEncounter, rollEnemyCount } from "../services/game/encounter.service.js";
import { processReputationActions } from "../services/game/reputation.service.js";
import { createCheckpointService, type CheckpointTrigger } from "../services/game/checkpoint.service.js";
import { resolveSkillCheck, attributeModifier, getGoverningAttribute } from "../services/game/skill-check.service.js";
import { applyAllSegmentEdits, stripGmCommandTags } from "../services/game/segment-edits.js";
import { processLorebooks } from "../services/lorebook/index.js";
import {
  applyMoraleEvent,
  getMoraleTier,
  formatMoraleContext,
  type MoraleEvent,
} from "../services/game/morale.service.js";
import {
  createJournal,
  addLocationEntry,
  addCombatEntry,
  addEventEntry,
  addNoteEntry,
  addInventoryEntry,
  addNpcEntry,
  upsertQuest,
  buildStructuredRecap,
  type Journal,
} from "../services/game/journal.service.js";
import { dedupeSessionSummaryLists } from "../services/game/session-summary-normalization.js";
import { generationParametersSchema, scoreMusic, scoreAmbient } from "@marinara-engine/shared";
import { postToDiscordWebhook } from "../services/discord-webhook.js";
import { isDebugAgentsEnabled } from "../config/runtime-config.js";
import type {
  GameActiveState,
  GameSetupConfig,
  GameMap,
  GameNpc,
  GenerationParameters,
  SceneIllustrationRequest,
  QuestProgress,
  SessionSummary,
  PartyArc,
  HudWidget,
} from "@marinara-engine/shared";
import { getAssetManifest, GAME_ASSETS_DIR } from "../services/game/asset-manifest.service.js";
import {
  generateNpcPortrait,
  generateBackground,
  generateSceneIllustration,
  readAvatarBase64,
} from "../services/game/game-asset-generation.js";
import { saveImageToDisk } from "../services/image/image-generation.js";
import { createPromptOverridesStorage } from "../services/storage/prompt-overrides.storage.js";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Fuzzy-match an NPC name against the character-avatar map.
 * Tries, in order:
 *  1. Exact match  ("Arlecchino" → "Arlecchino")
 *  2. Character name contained in NPC name  ("The Knave (Arlecchino)" contains "Arlecchino")
 *  3. NPC name contained in character name  ("Dottore" inside "Il Dottore" — if char was stored with title)
 * Minimum 3-character overlap to avoid false positives.
 */
function findCharAvatarFuzzy(npcName: string, charAvatarByName: Map<string, string>): string | undefined {
  const npcLower = npcName.toLowerCase();

  // 1. Exact
  const exact = charAvatarByName.get(npcLower);
  if (exact) return exact;

  // 2. Any char name that is a substring of the NPC name
  for (const [charName, avatar] of charAvatarByName) {
    if (charName.length >= 3 && npcLower.includes(charName)) return avatar;
  }

  // 3. NPC name (or each word ≥ 3 chars) contained in a char name
  for (const [charName, avatar] of charAvatarByName) {
    if (npcLower.length >= 3 && charName.includes(npcLower)) return avatar;
    // Also try individual words (handles "Il Dottore" → word "Dottore" matches char "Dottore")
    const words = npcLower
      .replace(/[()]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    for (const word of words) {
      if (charName === word) return avatar;
    }
  }

  return undefined;
}

const ILLUSTRATION_COOLDOWN_TURNS = 2;
const GENERATED_ILLUSTRATION_EXTS = ["png", "jpg", "jpeg", "webp", "avif", "gif"] as const;

function currentGameSessionNumber(meta: Record<string, unknown>): number | null {
  return typeof meta.gameSessionNumber === "number" && Number.isFinite(meta.gameSessionNumber)
    ? meta.gameSessionNumber
    : null;
}

function isIllustrationAllowed(
  meta: Record<string, unknown>,
  turnNumber: number,
  sessionNumber?: number | null,
): boolean {
  const lastTurn = typeof meta.gameLastIllustrationTurn === "number" ? meta.gameLastIllustrationTurn : 0;
  const lastSession =
    typeof meta.gameLastIllustrationSessionNumber === "number" &&
    Number.isFinite(meta.gameLastIllustrationSessionNumber)
      ? meta.gameLastIllustrationSessionNumber
      : null;
  if (lastSession !== null && sessionNumber !== null && sessionNumber !== undefined && lastSession !== sessionNumber) {
    return true;
  }
  // Legacy metadata did not record the session. In multi-session games, assume
  // that old shape came from a carried previous session and let the new session
  // establish a fresh session-aware cooldown.
  if (lastSession === null && sessionNumber !== null && sessionNumber !== undefined && sessionNumber > 1) {
    return true;
  }
  // Older metadata stored only a turn number. If the current session turn count
  // restarted below it, the saved cooldown came from a previous session.
  if (lastSession === null && lastTurn > turnNumber) {
    return true;
  }
  return lastTurn <= 0 || turnNumber - lastTurn >= ILLUSTRATION_COOLDOWN_TURNS;
}

function extractCharacterAppearanceText(characterData: Record<string, unknown>): string {
  const extensions =
    characterData.extensions && typeof characterData.extensions === "object"
      ? (characterData.extensions as Record<string, unknown>)
      : null;
  const appearance =
    typeof extensions?.appearance === "string" && extensions.appearance.trim()
      ? extensions.appearance.trim()
      : typeof characterData.appearance === "string" && characterData.appearance.trim()
        ? characterData.appearance.trim()
        : "";
  const description = typeof characterData.description === "string" ? characterData.description.trim() : "";
  return [appearance, description].filter(Boolean).join("; ").slice(0, 500);
}

function collectIllustrationCharacterAssets(opts: {
  illustration: SceneIllustrationRequest;
  characterNames: string[];
  trackedNpcs: Array<Record<string, unknown>>;
  gameNpcs: GameNpc[];
  charAvatarByName: Map<string, string>;
  charDescriptionByName: Map<string, string>;
}): { referenceImages: string[]; characterDescriptions: string[] } {
  const npcAvatarByName = new Map<string, string>();
  const npcDescriptionByName = new Map<string, string>();
  for (const npc of opts.trackedNpcs) {
    const name = typeof npc.name === "string" ? npc.name : null;
    const avatarUrl = typeof npc.avatarUrl === "string" ? npc.avatarUrl : null;
    const description = typeof npc.description === "string" ? npc.description.trim() : "";
    if (name && avatarUrl) npcAvatarByName.set(name.toLowerCase(), avatarUrl);
    if (name && description) npcDescriptionByName.set(name.toLowerCase(), description);
  }
  for (const npc of opts.gameNpcs) {
    if (npc.name && npc.avatarUrl) npcAvatarByName.set(npc.name.toLowerCase(), npc.avatarUrl);
    if (npc.name && npc.description) npcDescriptionByName.set(npc.name.toLowerCase(), npc.description);
  }

  const requestedNames = (opts.illustration.characters?.length ? opts.illustration.characters : opts.characterNames)
    .map((name) => name.trim())
    .filter(Boolean);
  const uniqueNames = Array.from(new Set(requestedNames.map((name) => name.toLowerCase())))
    .map((lowerName) => requestedNames.find((name) => name.toLowerCase() === lowerName)!)
    .slice(0, 6);

  const references: string[] = [];
  const characterDescriptions: string[] = [];
  const seen = new Set<string>();
  const described = new Set<string>();
  for (const name of uniqueNames) {
    const avatarPath = findCharAvatarFuzzy(name, opts.charAvatarByName) ?? findCharAvatarFuzzy(name, npcAvatarByName);
    const base64 = avatarPath && !seen.has(avatarPath) ? readAvatarBase64(avatarPath) : undefined;
    if (avatarPath && base64 && references.length < 4) {
      seen.add(avatarPath);
      references.push(base64);
      continue;
    }

    const description =
      findCharAvatarFuzzy(name, opts.charDescriptionByName) ?? findCharAvatarFuzzy(name, npcDescriptionByName);
    const normalizedName = name.toLowerCase();
    if (description && !described.has(normalizedName)) {
      described.add(normalizedName);
      characterDescriptions.push(`${name}: ${description}`.slice(0, 300));
    }
  }
  return { referenceImages: references, characterDescriptions: characterDescriptions.slice(0, 5) };
}

function applyGeneratedIllustration(
  sceneResult: Record<string, unknown>,
  generatedTag: string,
  segment: number | undefined,
): void {
  sceneResult.generatedIllustration = { tag: generatedTag, ...(segment !== undefined ? { segment } : {}) };
  if (segment !== undefined && segment > 0) {
    const effects = Array.isArray(sceneResult.segmentEffects)
      ? (sceneResult.segmentEffects as Record<string, unknown>[])
      : [];
    sceneResult.segmentEffects = effects;
    let target = effects.find((effect) => effect.segment === segment);
    if (!target) {
      target = { segment };
      effects.push(target);
    }
    target.background = generatedTag;
  } else {
    sceneResult.background = generatedTag;
  }
}

function generatedBackgroundSlug(value: string): string {
  let slug = value
    .trim()
    .toLowerCase()
    .replace(/:/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefixPattern = /^(?:backgrounds|fantasy|modern|scifi|user|generated|illustrations|q-[a-z0-9]{6,})-+/;
  while (prefixPattern.test(slug)) {
    slug = slug.replace(prefixPattern, "");
  }
  return slug || "scene";
}

async function addGeneratedIllustrationToGallery(opts: {
  app: FastifyInstance;
  chatId: string;
  tag: string;
  illustration: SceneIllustrationRequest;
  model: string;
}): Promise<void> {
  const prefix = "backgrounds:illustrations:";
  if (!opts.tag.startsWith(prefix)) return;

  const slug = opts.tag.slice(prefix.length);
  if (!/^[a-z0-9-]+$/.test(slug)) return;

  const assetPath = GENERATED_ILLUSTRATION_EXTS.map((ext) =>
    join(GAME_ASSETS_DIR, "backgrounds", "illustrations", `${slug}.${ext}`),
  ).find((candidate) => existsSync(candidate));
  if (!assetPath) return;

  try {
    const ext = extname(assetPath).toLowerCase().replace(/^\./, "") || "png";
    const filePath = saveImageToDisk(opts.chatId, readFileSync(assetPath).toString("base64"), ext);
    const gallery = createGalleryStorage(opts.app.db);
    const prompt = [opts.illustration.reason, opts.illustration.prompt].filter(Boolean).join("\n\n");
    await gallery.create({
      chatId: opts.chatId,
      filePath,
      prompt,
      provider: "game_scene_illustration",
      model: opts.model || "unknown",
      width: 1024,
      height: 576,
    });
  } catch (err) {
    opts.app.log.warn({ err, chatId: opts.chatId, tag: opts.tag }, "Failed to add game illustration to gallery");
  }
}

// ──────────────────────────────────────────────
// Validation Schemas
// ──────────────────────────────────────────────

const gameSetupConfigSchema = z.object({
  genre: z.string().min(1).max(200),
  setting: z.string().min(1),
  tone: z.string().min(1).max(200),
  difficulty: z.string().min(1).max(100),
  playerGoals: z.string().max(2000).default(""),
  gmMode: z.enum(["standalone", "character"]),
  rating: z.enum(["sfw", "nsfw"]).default("sfw"),
  gmCharacterId: z.string().nullable().optional(),
  partyCharacterIds: z.array(z.string()),
  personaId: z.string().nullable().optional(),
  sceneConnectionId: z.string().optional(),
  enableSpriteGeneration: z.boolean().optional(),
  imageConnectionId: z.string().optional(),
  artStylePrompt: z.string().max(500).optional(),
  activeLorebookIds: z.array(z.string()).optional(),
  enableCustomWidgets: z.boolean().optional(),
  language: z.string().min(1).max(100).optional(),
  generationParameters: generationParametersSchema.partial().optional(),
});

const createGameSchema = z.object({
  name: z.string().min(1).max(200),
  setupConfig: gameSetupConfigSchema,
  connectionId: z.string().optional(),
  characterConnectionId: z.string().optional(),
  promptPresetId: z.string().optional(),
  chatId: z.string().optional(),
});

const setupSchema = z.object({
  chatId: z.string().min(1),
  connectionId: z.string().optional(),
  preferences: z.string().max(5000).default(""),
  streaming: z.boolean().optional().default(true),
});

const gameStartSchema = z.object({
  chatId: z.string().min(1),
  connectionId: z.string().optional(),
});

const startSessionSchema = z.object({
  gameId: z.string().min(1),
  connectionId: z.string().optional(),
});

const concludeSessionSchema = z.object({
  chatId: z.string().min(1),
  connectionId: z.string().optional(),
  nextSessionRequest: z.string().max(5000).optional().default(""),
  streaming: z.boolean().optional().default(true),
});

const regenerateSessionConclusionSchema = concludeSessionSchema.extend({
  sessionNumber: z.number().int().min(1),
});

const updateCampaignProgressionSchema = concludeSessionSchema.extend({
  sessionNumber: z.number().int().min(1),
});

const recruitPartyMemberSchema = z.object({
  chatId: z.string().min(1),
  characterName: z.string().min(1).max(200),
  connectionId: z.string().optional(),
});

const removePartyMemberSchema = z.object({
  chatId: z.string().min(1),
  characterName: z.string().min(1).max(200),
});

const diceRollSchema = z.object({
  chatId: z.string().min(1),
  notation: z.string().min(1).max(50).refine(isDiceNotation, "Invalid dice notation"),
  context: z.string().max(500).optional(),
});

const stateTransitionSchema = z.object({
  chatId: z.string().min(1),
  newState: z.enum(["exploration", "dialogue", "combat", "travel_rest"]),
});

const mapGenerateSchema = z.object({
  chatId: z.string().min(1),
  locationType: z.string().min(1).max(200),
  context: z.string().max(1000).default(""),
  connectionId: z.string().optional(),
});

const mapMoveSchema = z.object({
  chatId: z.string().min(1),
  position: z.union([z.object({ x: z.number().int(), y: z.number().int() }), z.string().min(1).max(200)]),
  mapId: z.string().min(1).max(200).optional().nullable(),
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Parse chat.metadata which may be a JSON string from the DB. */
function parseMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (err) {
      logger.warn(err, "[game.routes] Failed to parse chat metadata, returning empty object");
      return {};
    }
  }
  return (raw as Record<string, unknown>) ?? {};
}

function normalizeCharacterLookupName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CHARACTER_NAME_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "il",
  "la",
  "le",
  "el",
  "los",
  "las",
  "de",
  "del",
  "della",
  "da",
  "di",
  "du",
  "der",
  "van",
  "von",
]);

function getCharacterNameTokens(value: string): string[] {
  const normalized = normalizeCharacterLookupName(value);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .filter((token) => token.length > 2 || /\d/.test(token))
    .filter((token) => !CHARACTER_NAME_STOP_WORDS.has(token));
}

function characterNamesLikelyMatch(leftName: string, rightName: string): boolean {
  const leftNormalized = normalizeCharacterLookupName(leftName);
  const rightNormalized = normalizeCharacterLookupName(rightName);
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized === rightNormalized) return true;
  if (leftNormalized.length >= 3 && ` ${rightNormalized} `.includes(` ${leftNormalized} `)) return true;
  if (rightNormalized.length >= 3 && ` ${leftNormalized} `.includes(` ${rightNormalized} `)) return true;

  const leftTokens = getCharacterNameTokens(leftName);
  const rightTokens = getCharacterNameTokens(rightName);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const smaller = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const larger = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
  return smaller.every((token) => larger.includes(token));
}

function findExistingGameCharacterCardIndex(
  currentCards: Array<Record<string, unknown>>,
  characterName: string,
): number {
  const exactIndex = currentCards.findIndex(
    (card) => typeof card.name === "string" && card.name.toLowerCase() === characterName.toLowerCase(),
  );
  if (exactIndex >= 0) return exactIndex;

  const normalizedName = normalizeCharacterLookupName(characterName);
  const normalizedIndex = currentCards.findIndex(
    (card) => typeof card.name === "string" && normalizeCharacterLookupName(card.name) === normalizedName,
  );
  if (normalizedIndex >= 0) return normalizedIndex;

  const likelyMatches = currentCards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => typeof card.name === "string" && characterNamesLikelyMatch(card.name, characterName));
  return likelyMatches.length === 1 ? likelyMatches[0]!.index : -1;
}

function buildPartyNpcId(name: string): string {
  const slug = normalizeCharacterLookupName(name).replace(/\s+/g, "-");
  const encodedSlug = encodeURIComponent(name.trim().toLowerCase())
    .replace(/%/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `npc:${slug || encodedSlug || "unknown"}`;
}

function isPartyNpcId(id: string): boolean {
  return id.startsWith("npc:");
}

function getStoredPartyCharacterIds(
  meta: Record<string, unknown>,
  setupConfig: GameSetupConfig,
  chatCharacterIds: string[],
): string[] {
  if (Array.isArray(meta.gamePartyCharacterIds)) {
    return Array.from(
      new Set(
        (meta.gamePartyCharacterIds as unknown[]).filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        ),
      ),
    );
  }
  return Array.from(new Set([...(setupConfig.partyCharacterIds ?? []), ...chatCharacterIds]));
}

function findGameNpcByName(npcs: GameNpc[], requestedName: string): GameNpc | null {
  const requestedLookup = normalizeCharacterLookupName(requestedName);
  let matches = npcs.filter((npc) => npc.name.toLowerCase() === requestedName.toLowerCase());
  if (matches.length === 0) {
    matches = npcs.filter((npc) => normalizeCharacterLookupName(npc.name) === requestedLookup);
  }
  if (matches.length === 0 && requestedLookup.length >= 3) {
    matches = npcs.filter((npc) => {
      const lookup = normalizeCharacterLookupName(npc.name);
      return lookup.includes(requestedLookup) || (lookup.length >= 3 && requestedLookup.includes(lookup));
    });
  }
  return matches.length === 1 ? matches[0]! : null;
}

function buildNpcPartyCard(npc: Pick<GameNpc, "name" | "description" | "location" | "notes">): Record<string, unknown> {
  return buildFallbackGameCharacterCard(
    {
      description: npc.description || `${npc.name} joins the party.`,
      backstory: npc.notes?.length ? npc.notes.join("\n") : "",
      appearance: npc.location ? `Last known location: ${npc.location}` : "",
    },
    npc.name,
  );
}

function buildRecruitCharacterSourceCard(characterData: Record<string, any>): string {
  const lines = [`Name: ${String(characterData.name || "Unknown")}`];
  if (typeof characterData.personality === "string" && characterData.personality.trim()) {
    lines.push(`Personality: ${characterData.personality.trim()}`);
  }
  if (typeof characterData.description === "string" && characterData.description.trim()) {
    lines.push(`Description: ${characterData.description.trim()}`);
  }
  const backstory =
    typeof characterData.extensions?.backstory === "string" && characterData.extensions.backstory.trim()
      ? characterData.extensions.backstory.trim()
      : typeof characterData.backstory === "string" && characterData.backstory.trim()
        ? characterData.backstory.trim()
        : "";
  const appearance =
    typeof characterData.extensions?.appearance === "string" && characterData.extensions.appearance.trim()
      ? characterData.extensions.appearance.trim()
      : typeof characterData.appearance === "string" && characterData.appearance.trim()
        ? characterData.appearance.trim()
        : "";
  if (backstory) lines.push(`Backstory: ${backstory}`);
  if (appearance) lines.push(`Appearance: ${appearance}`);
  return lines.join("\n");
}

function buildNpcRecruitCharacterSourceCard(npc: Pick<GameNpc, "name" | "description" | "location" | "notes">): string {
  return buildRecruitCharacterSourceCard({
    name: npc.name,
    description: npc.description || `${npc.name} joins the party.`,
    backstory: npc.notes?.length ? npc.notes.join("\n") : "",
    appearance: npc.location ? `Last known location: ${npc.location}` : "",
  });
}

function extractRecruitCharacterRpgStats(characterData: Record<string, any>) {
  const rpgStats = characterData.extensions?.rpgStats;
  if (!rpgStats?.enabled || !Array.isArray(rpgStats.attributes) || !rpgStats.hp) return undefined;

  return {
    attributes: rpgStats.attributes
      .map((attribute: Record<string, unknown>) => ({
        name: typeof attribute.name === "string" ? attribute.name.trim() : "",
        value: Number(attribute.value) || 0,
      }))
      .filter((attribute: { name: string; value: number }) => attribute.name),
    hp: {
      value: Math.max(0, Number(rpgStats.hp.max) || 0),
      max: Math.max(1, Number(rpgStats.hp.max) || 1),
    },
  };
}

function normalizeGeneratedGameCharacterCard(raw: Record<string, unknown>, fallbackName: string) {
  const normalizeStringArray = (value: unknown) =>
    Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];

  const extraEntries =
    raw.extra && typeof raw.extra === "object" && !Array.isArray(raw.extra)
      ? Object.fromEntries(
          Object.entries(raw.extra as Record<string, unknown>)
            .map(([key, value]) => [key.trim(), String(value).trim()] as const)
            .filter(([key, value]) => key && value),
        )
      : {};

  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : fallbackName,
    shortDescription: typeof raw.shortDescription === "string" ? raw.shortDescription.trim() : "",
    class: typeof raw.class === "string" ? raw.class.trim() : "",
    abilities: normalizeStringArray(raw.abilities),
    strengths: normalizeStringArray(raw.strengths),
    weaknesses: normalizeStringArray(raw.weaknesses),
    extra: extraEntries,
  };
}

function applyGeneratedGameCharacterCards(
  currentCards: Array<Record<string, unknown>>,
  rawCards: unknown,
): { cards: Array<Record<string, unknown>>; updatedCount: number } {
  if (currentCards.length === 0 || !Array.isArray(rawCards)) {
    return { cards: currentCards, updatedCount: 0 };
  }

  const generatedCardsByName = new Map<string, Record<string, unknown>>();
  for (const card of rawCards) {
    if (!card || typeof card !== "object" || Array.isArray(card)) continue;
    const name = (card as Record<string, unknown>).name;
    if (typeof name !== "string" || !name.trim()) continue;
    generatedCardsByName.set(name.trim().toLowerCase(), card as Record<string, unknown>);
  }

  if (generatedCardsByName.size === 0) {
    return { cards: currentCards, updatedCount: 0 };
  }

  let updatedCount = 0;
  const cards = currentCards.map((existingCard) => {
    const existingName = typeof existingCard.name === "string" ? existingCard.name.trim() : "";
    if (!existingName) return existingCard;

    const generatedCard = generatedCardsByName.get(existingName.toLowerCase());
    if (!generatedCard) return existingCard;

    updatedCount += 1;
    const normalizedCard = normalizeGeneratedGameCharacterCard(generatedCard, existingName);
    return existingCard.rpgStats
      ? {
          ...normalizedCard,
          rpgStats: existingCard.rpgStats,
        }
      : normalizedCard;
  });

  return { cards, updatedCount };
}

function buildFallbackGameCharacterCard(characterData: Record<string, any>, characterName: string) {
  const description =
    typeof characterData.description === "string" && characterData.description.trim()
      ? characterData.description.trim()
      : typeof characterData.personality === "string" && characterData.personality.trim()
        ? characterData.personality.trim()
        : `${characterName} joins the party.`;
  const appearance =
    typeof characterData.extensions?.appearance === "string" && characterData.extensions.appearance.trim()
      ? characterData.extensions.appearance.trim()
      : typeof characterData.appearance === "string" && characterData.appearance.trim()
        ? characterData.appearance.trim()
        : "";
  const backstory =
    typeof characterData.extensions?.backstory === "string" && characterData.extensions.backstory.trim()
      ? characterData.extensions.backstory.trim()
      : typeof characterData.backstory === "string" && characterData.backstory.trim()
        ? characterData.backstory.trim()
        : "";

  return {
    name: characterName,
    shortDescription: description,
    class: "Companion",
    abilities: [],
    strengths: [],
    weaknesses: [],
    extra: Object.fromEntries(
      [
        ["appearance", appearance],
        ["backstory", backstory],
      ].filter((entry): entry is [string, string] => Boolean(entry[1])),
    ),
  };
}

function getDiscordWebhookUrl(meta: Record<string, unknown>): string {
  return typeof meta.discordWebhookUrl === "string" ? meta.discordWebhookUrl.trim() : "";
}

function mirrorGameMessageToDiscord(meta: Record<string, unknown>, content: string, username: string): void {
  const webhookUrl = getDiscordWebhookUrl(meta);
  if (!webhookUrl || !content.trim()) return;
  postToDiscordWebhook(webhookUrl, { content, username });
}

function normalizeSessionText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

type StoredChatRecord = Awaited<ReturnType<ReturnType<typeof createChatsStorage>["getById"]>>;

function normalizeSessionTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSessionText(item)).filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function normalizeSessionStatsSnapshot(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeMoraleValue(value: unknown, fallback = 50): number {
  const raw = typeof value === "string" && value.trim() ? Number(value.trim()) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function extractMoraleFromSessionSummary(summary: SessionSummary, fallback: number): number {
  const stats = summary.statsSnapshot;
  const party =
    stats.party && typeof stats.party === "object" && !Array.isArray(stats.party)
      ? (stats.party as Record<string, unknown>)
      : null;
  return normalizeMoraleValue(
    stats.partyMorale ?? stats.morale ?? stats.partyMoraleValue ?? party?.morale ?? party?.partyMorale,
    fallback,
  );
}

function syncMoraleWidgetValue(rawWidgets: unknown, morale: number): unknown {
  if (!Array.isArray(rawWidgets)) return rawWidgets;

  return rawWidgets.map((widget) => {
    if (!widget || typeof widget !== "object" || Array.isArray(widget)) return widget;
    const source = widget as HudWidget;
    const label = `${source.id ?? ""} ${source.label ?? ""}`.toLowerCase();
    if (!label.includes("morale")) return widget;
    if (!["progress_bar", "gauge", "relationship_meter"].includes(source.type)) return widget;
    return {
      ...source,
      config: {
        ...source.config,
        value: morale,
        max: typeof source.config?.max === "number" ? source.config.max : 100,
      },
    };
  });
}

function buildMoraleMetadataUpdates(meta: Record<string, unknown>, morale: number): Record<string, unknown> {
  const updates: Record<string, unknown> = { gameMorale: morale };
  const nextWidgetState = syncMoraleWidgetValue(meta.gameWidgetState, morale);
  if (nextWidgetState !== meta.gameWidgetState) updates.gameWidgetState = nextWidgetState;

  const blueprint = meta.gameBlueprint;
  if (blueprint && typeof blueprint === "object" && !Array.isArray(blueprint)) {
    const source = blueprint as Record<string, unknown>;
    const nextHudWidgets = syncMoraleWidgetValue(source.hudWidgets, morale);
    if (nextHudWidgets !== source.hudWidgets) {
      updates.gameBlueprint = { ...source, hudWidgets: nextHudWidgets };
    }
  }

  return updates;
}

function deriveResumePointFallback(summary: string): string {
  const paragraphs = summary
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return paragraphs[paragraphs.length - 1] ?? summary;
}

function normalizeStoredSessionSummaries(raw: unknown): SessionSummary[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((item, index) => {
    const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const summary = normalizeSessionText(source.summary, `Session ${index + 1} concluded.`);
    const dedupedFacts = dedupeSessionSummaryLists({
      keyDiscoveries: normalizeSessionTextList(source.keyDiscoveries),
      legacyRevelations: normalizeSessionTextList(source.revelations),
      characterMoments: normalizeSessionTextList(source.characterMoments),
      littleDetails: normalizeSessionTextList(source.littleDetails),
      npcUpdates: normalizeSessionTextList(source.npcUpdates),
    });
    return {
      sessionNumber: index + 1,
      summary,
      resumePoint: normalizeSessionText(source.resumePoint, deriveResumePointFallback(summary)),
      partyDynamics: normalizeSessionText(source.partyDynamics),
      partyState: normalizeSessionText(source.partyState),
      keyDiscoveries: dedupedFacts.keyDiscoveries,
      characterMoments: dedupedFacts.characterMoments,
      littleDetails: dedupedFacts.littleDetails,
      statsSnapshot: normalizeSessionStatsSnapshot(source.statsSnapshot),
      npcUpdates: dedupedFacts.npcUpdates,
      nextSessionRequest: normalizeSessionText(source.nextSessionRequest) || null,
      timestamp: normalizeSessionText(source.timestamp, new Date().toISOString()),
    };
  });
}

function normalizeSessionSummaryPayload(
  payload: Record<string, unknown>,
  sessionNumber: number,
  fallback: string,
): SessionSummary {
  const summary = normalizeSessionText(payload.summary, fallback);
  const dedupedFacts = dedupeSessionSummaryLists({
    keyDiscoveries: normalizeSessionTextList(payload.keyDiscoveries),
    legacyRevelations: normalizeSessionTextList(payload.revelations),
    characterMoments: normalizeSessionTextList(payload.characterMoments),
    littleDetails: normalizeSessionTextList(payload.littleDetails),
    npcUpdates: normalizeSessionTextList(payload.npcUpdates),
  });
  return {
    sessionNumber,
    summary,
    resumePoint: normalizeSessionText(payload.resumePoint, deriveResumePointFallback(summary)),
    partyDynamics: normalizeSessionText(payload.partyDynamics),
    partyState: normalizeSessionText(payload.partyState),
    keyDiscoveries: dedupedFacts.keyDiscoveries,
    characterMoments: dedupedFacts.characterMoments,
    littleDetails: dedupedFacts.littleDetails,
    statsSnapshot: normalizeSessionStatsSnapshot(payload.statsSnapshot),
    npcUpdates: dedupedFacts.npcUpdates,
    nextSessionRequest: normalizeSessionText(payload.nextSessionRequest) || null,
    timestamp: new Date().toISOString(),
  };
}

function normalizePartyArcPayload(raw: unknown): PartyArc[] {
  if (!Array.isArray(raw)) return [];

  const arcs: PartyArc[] = [];
  for (const item of raw) {
    const source = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const name = normalizeSessionText(source.name);
    const arc = normalizeSessionText(source.arc);
    const goal = normalizeSessionText(source.goal);
    if (!name || !arc) continue;

    const completed = typeof source.completed === "boolean" ? source.completed : false;
    const resolution = normalizeSessionText(source.resolution);

    const nextArc: PartyArc = {
      name,
      arc,
      goal,
      ...(completed ? { completed } : {}),
      ...(resolution ? { resolution } : {}),
    };
    arcs.push(nextArc);
  }

  return arcs;
}

type CampaignProgressionState = {
  storyArc: string | null;
  plotTwists: string[];
  partyArcs: PartyArc[];
};

function extractCampaignProgressionPayload(parsed: Record<string, unknown>): Record<string, unknown> {
  return parsed.campaignProgression &&
    typeof parsed.campaignProgression === "object" &&
    !Array.isArray(parsed.campaignProgression)
    ? (parsed.campaignProgression as Record<string, unknown>)
    : parsed;
}

function applyCampaignProgressionPayload(
  rawCampaignProgression: Record<string, unknown>,
  current: CampaignProgressionState,
): CampaignProgressionState {
  const nextStoryArc = normalizeSessionText(rawCampaignProgression.storyArc, current.storyArc || "");
  const nextPlotTwists = normalizeSessionTextList(rawCampaignProgression.plotTwists);
  const nextPartyArcs = normalizePartyArcPayload(rawCampaignProgression.partyArcs);

  return {
    storyArc: nextStoryArc || null,
    plotTwists: nextPlotTwists.length > 0 ? nextPlotTwists : current.plotTwists,
    partyArcs: nextPartyArcs.length > 0 ? nextPartyArcs : current.partyArcs,
  };
}

type ChatInventoryItem = { name: string; quantity: number };

function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeGameInventoryItems(raw: unknown): ChatInventoryItem[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const parsedQuantity =
      typeof source.quantity === "number" ? source.quantity : Number.parseInt(String(source.quantity ?? ""), 10);
    const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? Math.floor(parsedQuantity) : 1;
    return name ? [{ name, quantity }] : [];
  });
}

function inventoryFromPlayerStats(playerStats: Record<string, unknown> | null): ChatInventoryItem[] {
  if (!playerStats) return [];
  return normalizeGameInventoryItems(playerStats.inventory);
}

function mergeGameInventoryItems(...sources: ChatInventoryItem[][]): ChatInventoryItem[] {
  const merged = new Map<string, ChatInventoryItem>();
  for (const source of sources) {
    for (const item of source) {
      const key = item.name.toLowerCase();
      if (!merged.has(key)) {
        merged.set(key, { ...item });
      }
    }
  }
  return [...merged.values()];
}

async function resolveConnection(
  connections: ReturnType<typeof createConnectionsStorage>,
  connId: string | null | undefined,
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

  return { conn, baseUrl, defaultGenerationParameters: parseStoredGenerationParameters(conn.defaultParameters) };
}

type StoredGenerationParameters = Partial<GenerationParameters>;

function parseStoredGenerationParameters(raw: unknown): StoredGenerationParameters | null {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }

  const result = generationParametersSchema.partial().safeParse(parsed);
  return result.success ? result.data : null;
}

function mergeStoredGenerationParameters(...sources: Array<unknown>): StoredGenerationParameters | null {
  const merged: StoredGenerationParameters = {};
  for (const source of sources) {
    const parsed = parseStoredGenerationParameters(source);
    if (parsed) Object.assign(merged, parsed);
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

function resolveStoredGameGenerationParameters(
  meta: Record<string, unknown> | null | undefined,
  connectionDefaults: StoredGenerationParameters | null | undefined,
) {
  const setupConfig = (meta?.gameSetupConfig as Record<string, unknown> | null | undefined) ?? null;
  return mergeStoredGenerationParameters(connectionDefaults, setupConfig?.generationParameters, meta?.chatParameters);
}

function resolveGameReasoningEffort(
  model: string,
  reasoningEffort: GenerationParameters["reasoningEffort"] | ChatOptions["reasoningEffort"] | null | undefined,
): ChatOptions["reasoningEffort"] | undefined {
  if (!reasoningEffort) return undefined;
  if (reasoningEffort === "xhigh") return reasoningEffort;
  if (reasoningEffort !== "maximum") return reasoningEffort;

  const modelLower = model.toLowerCase();
  const supportsXhigh =
    modelLower.startsWith("gpt-5.5") ||
    modelLower.startsWith("gpt-5.4") ||
    /claude-opus-4-(?:[7-9]|\d{2,})/.test(modelLower);
  return supportsXhigh ? "xhigh" : "high";
}

/** Build model-aware generation options for game calls. */
function gameGenOptions(
  model: string,
  overrides: Partial<ChatOptions> = {},
  parameters: StoredGenerationParameters | null = null,
): ChatOptions {
  const m = model.toLowerCase();
  // Opus 4.7+ and GPT-5.4/5.5 accept the strongest reasoning tier ("xhigh").
  // Opus 4.7+ also forbids sampling parameters entirely; the Anthropic
  // provider strips them on the wire, but we omit them here so the
  // logged options match what is actually sent.
  const isOpus47Plus = /claude-opus-4-(?:[7-9]|\d{2,})/.test(m);
  const supportsXhigh = m.startsWith("gpt-5.5") || m.startsWith("gpt-5.4") || isOpus47Plus;
  const base: ChatOptions = {
    model,
    maxTokens: 8192,
    reasoningEffort: supportsXhigh ? "xhigh" : "high",
    // Required for the Anthropic provider to actually attach
    // thinking/output_config.effort to the request body.
    enableThinking: true,
    verbosity: "high",
  };
  if (!isOpus47Plus) {
    base.temperature = 1;
    base.topP = 1;
  }

  if (parameters) {
    if (typeof parameters.temperature === "number" && !isOpus47Plus) base.temperature = parameters.temperature;
    if (typeof parameters.maxTokens === "number") base.maxTokens = parameters.maxTokens;
    if (typeof parameters.maxContext === "number") base.maxContext = parameters.maxContext;
    if (typeof parameters.topP === "number" && !isOpus47Plus) base.topP = parameters.topP;
    if (typeof parameters.topK === "number") base.topK = parameters.topK;
    if (typeof parameters.frequencyPenalty === "number") base.frequencyPenalty = parameters.frequencyPenalty;
    if (typeof parameters.presencePenalty === "number") base.presencePenalty = parameters.presencePenalty;
    if (parameters.reasoningEffort !== undefined) {
      const resolvedReasoningEffort = resolveGameReasoningEffort(model, parameters.reasoningEffort);
      if (resolvedReasoningEffort) {
        base.reasoningEffort = resolvedReasoningEffort;
        base.enableThinking = true;
      } else {
        delete base.reasoningEffort;
        base.enableThinking = false;
      }
    }
    if (parameters.verbosity !== undefined) {
      if (parameters.verbosity) {
        base.verbosity = parameters.verbosity;
      } else {
        delete base.verbosity;
      }
    }
  }

  const merged: ChatOptions = { ...base, ...overrides };
  if (Object.prototype.hasOwnProperty.call(overrides, "reasoningEffort")) {
    const resolvedReasoningEffort = resolveGameReasoningEffort(model, overrides.reasoningEffort ?? null);
    if (resolvedReasoningEffort) {
      merged.reasoningEffort = resolvedReasoningEffort;
      if (!Object.prototype.hasOwnProperty.call(overrides, "enableThinking")) {
        merged.enableThinking = true;
      }
    } else {
      delete merged.reasoningEffort;
      if (!Object.prototype.hasOwnProperty.call(overrides, "enableThinking")) {
        merged.enableThinking = false;
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(overrides, "verbosity") && overrides.verbosity === undefined) {
    delete merged.verbosity;
  }
  return merged;
}

const SESSION_SUMMARY_CHARS_PER_TOKEN = 4;
const SESSION_SUMMARY_MIN_TRANSCRIPT_CHARS = 256;
const SESSION_CONCLUSION_MIN_OUTPUT_TOKENS = 8192;
const CAMPAIGN_PROGRESSION_MIN_OUTPUT_TOKENS = SESSION_CONCLUSION_MIN_OUTPUT_TOKENS;
const SESSION_SUMMARY_TRUNCATION_MARKER = "\n\n[Middle of session transcript truncated to fit context window]\n\n";

function truncateSessionTranscriptMiddle(content: string, targetTokens: number): string {
  const targetChars = Math.max(
    SESSION_SUMMARY_MIN_TRANSCRIPT_CHARS,
    Math.floor(targetTokens * SESSION_SUMMARY_CHARS_PER_TOKEN),
  );
  const chars = Array.from(content);
  if (chars.length <= targetChars) return content;

  if (targetChars <= SESSION_SUMMARY_TRUNCATION_MARKER.length + SESSION_SUMMARY_MIN_TRANSCRIPT_CHARS) {
    return chars.slice(0, targetChars).join("");
  }

  const availableChars = targetChars - SESSION_SUMMARY_TRUNCATION_MARKER.length;
  const headChars = Math.ceil(availableChars * 0.65);
  const tailChars = Math.floor(availableChars * 0.35);
  return chars.slice(0, headChars).join("") + SESSION_SUMMARY_TRUNCATION_MARKER + chars.slice(-tailChars).join("");
}

function buildSessionConclusionMessages(args: {
  sessionNumber: number;
  language?: string | null;
  journalRecap: string;
  transcriptText: string;
  transcriptMessageCount: number;
  transcriptTruncated: boolean;
  latestState: unknown;
  currentStoryArc: string | null;
  currentPlotTwists: string[];
  currentPartyArcs: PartyArc[];
  currentMorale: number;
  currentCards: Array<Record<string, unknown>>;
  nextSessionRequest?: string | null;
}): ChatMessage[] {
  const transcriptLabel = args.transcriptTruncated
    ? `Session transcript (${args.transcriptMessageCount} messages, middle truncated to fit the selected context window):`
    : `Session transcript (${args.transcriptMessageCount} messages):`;

  const userLines = [
    `Session ${args.sessionNumber} journal recap (covers the full session):`,
    args.journalRecap,
    "",
    transcriptLabel,
    args.transcriptText,
  ];

  if (args.latestState) {
    userLines.push("", "Current game state:", JSON.stringify(args.latestState, null, 2));
  }

  const nextSessionRequest = args.nextSessionRequest?.trim();
  if (nextSessionRequest) {
    userLines.push(
      "",
      "The player requested this to happen during the next session:",
      nextSessionRequest,
      "Use this as steering guidance for the updated story arc, unresolved hooks, and resume point. Honor it when it fits the campaign continuity; do not force contradictions.",
    );
  }

  userLines.push(
    "",
    "Current story arc:",
    args.currentStoryArc ?? "",
    "",
    "Current plot twists:",
    JSON.stringify(args.currentPlotTwists, null, 2),
    "",
    "Current party arcs:",
    JSON.stringify(args.currentPartyArcs, null, 2),
    "",
    "Current party morale:",
    `${args.currentMorale}/100 (${getMoraleTier(args.currentMorale)})`,
    "",
    "Current character cards:",
    JSON.stringify(args.currentCards, null, 2),
    "",
    "Update the full end-of-session continuity state in one pass.",
    args.transcriptTruncated
      ? "The transcript only trims the middle to fit the selected context window; the journal recap still covers the full session."
      : "The journal recap and transcript together cover the full session.",
  );

  return [
    {
      role: "system",
      content: buildSessionConclusionPrompt({
        language: args.language ?? null,
        includeCharacterCards: args.currentCards.length > 0,
      }),
    },
    { role: "user", content: userLines.join("\n") },
  ];
}

function fitSessionConclusionMessages(args: {
  sessionNumber: number;
  language?: string | null;
  journalRecap: string;
  transcriptText: string;
  transcriptMessageCount: number;
  latestState: unknown;
  currentStoryArc: string | null;
  currentPlotTwists: string[];
  currentPartyArcs: PartyArc[];
  currentMorale: number;
  currentCards: Array<Record<string, unknown>>;
  nextSessionRequest?: string | null;
  maxContext: number;
  maxTokens?: number;
}): { messages: ChatMessage[]; transcriptTruncated: boolean } {
  let transcriptText = args.transcriptText;
  let transcriptTruncated = false;
  let conclusionMessages = buildSessionConclusionMessages({
    sessionNumber: args.sessionNumber,
    language: args.language,
    journalRecap: args.journalRecap,
    transcriptText,
    transcriptMessageCount: args.transcriptMessageCount,
    transcriptTruncated,
    latestState: args.latestState,
    currentStoryArc: args.currentStoryArc,
    currentPlotTwists: args.currentPlotTwists,
    currentPartyArcs: args.currentPartyArcs,
    currentMorale: args.currentMorale,
    currentCards: args.currentCards,
    nextSessionRequest: args.nextSessionRequest,
  });
  let fit = fitMessagesToContext(conclusionMessages, { maxContext: args.maxContext, maxTokens: args.maxTokens });
  let guard = 0;

  while (fit.trimmed && guard < 8 && Array.from(transcriptText).length > SESSION_SUMMARY_MIN_TRANSCRIPT_CHARS) {
    guard += 1;
    transcriptTruncated = true;

    const currentTranscriptTokens = Math.ceil(Array.from(transcriptText).length / SESSION_SUMMARY_CHARS_PER_TOKEN);
    const overflowTokens = Math.max(1, fit.estimatedTokensBefore - (fit.inputBudget ?? fit.estimatedTokensBefore - 1));
    const targetTranscriptTokens = Math.max(
      Math.ceil(SESSION_SUMMARY_MIN_TRANSCRIPT_CHARS / SESSION_SUMMARY_CHARS_PER_TOKEN),
      currentTranscriptTokens - overflowTokens - 32,
    );
    const nextTranscriptText = truncateSessionTranscriptMiddle(transcriptText, targetTranscriptTokens);
    if (nextTranscriptText === transcriptText) break;

    transcriptText = nextTranscriptText;
    conclusionMessages = buildSessionConclusionMessages({
      sessionNumber: args.sessionNumber,
      language: args.language,
      journalRecap: args.journalRecap,
      transcriptText,
      transcriptMessageCount: args.transcriptMessageCount,
      transcriptTruncated,
      latestState: args.latestState,
      currentStoryArc: args.currentStoryArc,
      currentPlotTwists: args.currentPlotTwists,
      currentPartyArcs: args.currentPartyArcs,
      currentMorale: args.currentMorale,
      currentCards: args.currentCards,
      nextSessionRequest: args.nextSessionRequest,
    });
    fit = fitMessagesToContext(conclusionMessages, { maxContext: args.maxContext, maxTokens: args.maxTokens });
  }

  return {
    messages: fit.trimmed ? fit.messages : conclusionMessages,
    transcriptTruncated,
  };
}

function parseJSON(raw: string): unknown {
  // Sanitise control characters that LLMs sometimes emit inside JSON string
  // values (literal newlines, tabs, etc.) by replacing them with their
  // escaped equivalents.  We only touch chars inside *string* regions to
  // avoid corrupting the structural whitespace between keys/values.
  function sanitise(src: string): string {
    let out = "";
    let inStr = false;
    let esc = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i]!;
      if (esc) {
        out += ch;
        esc = false;
        continue;
      }
      if (ch === "\\" && inStr) {
        out += ch;
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        out += ch;
        continue;
      }
      if (inStr) {
        const code = ch.charCodeAt(0);
        if (code < 0x20) {
          // Replace control chars with their JSON escape
          if (ch === "\n") {
            out += "\\n";
          } else if (ch === "\r") {
            out += "\\r";
          } else if (ch === "\t") {
            out += "\\t";
          } else {
            out += "\\u" + code.toString(16).padStart(4, "0");
          }
          continue;
        }
      }
      out += ch;
    }
    return out;
  }

  // Try parsing the whole string first (most reliable)
  try {
    return JSON.parse(raw.trim());
  } catch {
    // Fall through to extraction
  }

  let cleaned = raw
    .trim()
    .replace(/^```(?:json|markdown)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "");

  // Try again after stripping code fences
  try {
    return JSON.parse(cleaned.trim());
  } catch {
    // Fall through to sanitisation
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  // Sanitise control characters inside string values and retry
  try {
    return JSON.parse(sanitise(cleaned));
  } catch {
    // Fall through — last resort
  }
  return JSON.parse(cleaned);
}

function parseStoredJson<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return raw as T;
}

function normalizeJournalMatch(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

type SceneAssetNpcCandidate = {
  name: string;
  description: string;
  avatarUrl?: string | null;
};

type SceneAssetNpcAvatarEntry = SceneAssetNpcCandidate & {
  avatarUrl: string;
};

const NARRATION_NPC_SPEECH_VERB_PATTERN =
  "(?:said|says|whispered|whispers|muttered|mutters|replied|replies|called|calls|shouted|shouts|asked|asks|warned|warns|growled|growls|hissed|hisses|exclaimed|exclaims|murmured|murmurs|sighed|sighs|snapped|snaps|barked|barks|declared|declares|continued|continues|added|adds|spoke|speaks|began|begins|remarked|remarks|chuckled|chuckles|laughed|laughs|cried|cries)";

function buildGameNpcId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || randomUUID();
}

function buildNpcAvatarUrl(chatId: string, name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug ? `/api/avatars/npc/${chatId}/${slug}.png` : null;
}

function hasReadableAvatar(avatarUrl: string | null | undefined): avatarUrl is string {
  return !!avatarUrl && !!readAvatarBase64(avatarUrl);
}

function addExistingNpcAvatar(avatarByName: Map<string, string>, name: unknown, avatarUrl: unknown): void {
  if (typeof name !== "string" || typeof avatarUrl !== "string") return;
  const normalizedName = normalizeJournalMatch(name);
  const normalizedAvatarUrl = avatarUrl.trim();
  if (!normalizedName || !normalizedAvatarUrl || !hasReadableAvatar(normalizedAvatarUrl)) return;
  avatarByName.set(normalizedName, normalizedAvatarUrl);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractNarrationSnippetForName(narration: string, name: string): string {
  const cleaned = narration
    .replace(/<[^>]+>/g, " ")
    .replace(/\[[^\]]+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return `${name} appears in the current scene.`;

  const nameRe = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
  const sentenceMatches = cleaned.match(/[^.!?\n]+[.!?]?/g) ?? [];
  for (const rawSentence of sentenceMatches) {
    const sentence = rawSentence.trim();
    if (sentence && nameRe.test(sentence)) {
      return sentence.slice(0, 280);
    }
  }

  const matchIndex = cleaned.search(nameRe);
  if (matchIndex === -1) return `${name} appears in the current scene.`;

  const start = Math.max(0, matchIndex - 100);
  const end = Math.min(cleaned.length, matchIndex + 220);
  return cleaned.slice(start, end).trim();
}

function extractNarrationNpcCandidates(narration: string, excludedNames: string[]): SceneAssetNpcCandidate[] {
  const candidates = new Map<string, SceneAssetNpcCandidate>();
  const excluded = new Set(excludedNames.map(normalizeJournalMatch));
  const patterns = [
    /<speaker="([^"]+)">/gi,
    new RegExp(`(?:^|\\n)\\s*([A-Z][A-Za-z'’-]+(?:\\s+[A-Z][A-Za-z'’-]+)?)\\s*:\\s*["“«「]`, "gm"),
    new RegExp(
      `\"[^\"]+\"[,.]?\\s+([A-Z][A-Za-z'’-]+(?:\\s+[A-Z][A-Za-z'’-]+)?)\\s+${NARRATION_NPC_SPEECH_VERB_PATTERN}\\b`,
      "gi",
    ),
    new RegExp(`\\b([A-Z][A-Za-z'’-]+(?:\\s+[A-Z][A-Za-z'’-]+)?)\\b\\s+${NARRATION_NPC_SPEECH_VERB_PATTERN}\\b`, "gi"),
    /\b(?:named|called)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)?)\b/gi,
    /\b([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)?),\s+(?:a|an|the)\b/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(narration)) !== null) {
      const rawName = match[1]?.trim();
      if (!rawName) continue;

      const normalizedName = normalizeJournalMatch(rawName);
      if (!normalizedName || excluded.has(normalizedName)) continue;
      if (candidates.has(normalizedName)) continue;

      candidates.set(normalizedName, {
        name: rawName,
        description: extractNarrationSnippetForName(narration, rawName),
      });
    }
  }

  return [...candidates.values()];
}

function buildSceneAssetNpcCandidates(
  trackedNpcsRaw: Array<Record<string, unknown>>,
  presentCharactersRaw: unknown,
  excludedNames: string[],
  narration: string,
): SceneAssetNpcCandidate[] {
  const excluded = new Set(excludedNames.map(normalizeJournalMatch));
  const candidates = new Map<string, SceneAssetNpcCandidate>();

  const upsertCandidate = (nameRaw: unknown, descriptionRaw: unknown, avatarUrlRaw: unknown) => {
    if (typeof nameRaw !== "string") return;

    const name = nameRaw.trim();
    if (!name) return;

    const normalizedName = normalizeJournalMatch(name);
    if (!normalizedName || excluded.has(normalizedName)) return;

    const description = typeof descriptionRaw === "string" ? descriptionRaw.trim() : "";
    const avatarUrl = typeof avatarUrlRaw === "string" && avatarUrlRaw.trim() ? avatarUrlRaw.trim() : null;
    const existing = candidates.get(normalizedName);

    if (existing) {
      if (!existing.description && description) existing.description = description;
      if (!existing.avatarUrl && avatarUrl) existing.avatarUrl = avatarUrl;
      return;
    }

    candidates.set(normalizedName, {
      name,
      description,
      avatarUrl,
    });
  };

  for (const npc of trackedNpcsRaw) {
    upsertCandidate(npc.name, npc.description, npc.avatarUrl);
  }

  const presentCharacters = parseStoredJson<Array<Record<string, unknown>>>(presentCharactersRaw) ?? [];
  for (const presentCharacter of presentCharacters) {
    upsertCandidate(presentCharacter.name, presentCharacter.appearance, presentCharacter.avatarPath);
  }

  for (const candidate of extractNarrationNpcCandidates(narration, excludedNames)) {
    upsertCandidate(candidate.name, candidate.description, candidate.avatarUrl);
  }

  return [...candidates.values()];
}

function upsertGameNpcAvatarEntries(currentNpcs: GameNpc[], avatarEntries: SceneAssetNpcAvatarEntry[]): GameNpc[] {
  if (avatarEntries.length === 0) return currentNpcs;

  const nextNpcs = [...currentNpcs];
  let changed = false;

  for (const entry of avatarEntries) {
    const normalizedName = normalizeJournalMatch(entry.name);
    if (!normalizedName) continue;

    const existingIndex = nextNpcs.findIndex((npc) => normalizeJournalMatch(npc.name) === normalizedName);
    if (existingIndex !== -1) {
      const existing = nextNpcs[existingIndex]!;
      let nextNpc = existing;

      if (!existing.avatarUrl) {
        nextNpc = { ...nextNpc, avatarUrl: entry.avatarUrl };
      }
      if (!nextNpc.description && entry.description) {
        nextNpc = { ...nextNpc, description: entry.description, descriptionSource: "narration" };
      }

      if (nextNpc !== existing) {
        nextNpcs[existingIndex] = nextNpc;
        changed = true;
      }
      continue;
    }

    nextNpcs.push({
      id: buildGameNpcId(entry.name),
      name: entry.name,
      emoji: "👤",
      description: entry.description,
      location: "",
      reputation: 0,
      met: false,
      notes: [],
      avatarUrl: entry.avatarUrl,
      descriptionSource: entry.description ? "narration" : undefined,
    });
    changed = true;
  }

  return changed ? nextNpcs : currentNpcs;
}

function locationMatches(candidate: string, aliases: string[]): boolean {
  const candidateKey = normalizeJournalMatch(candidate);
  if (!candidateKey) return false;

  return aliases.some((alias) => {
    const aliasKey = normalizeJournalMatch(alias);
    if (!aliasKey) return false;
    const shortest = Math.min(candidateKey.length, aliasKey.length);
    return (
      candidateKey === aliasKey ||
      (shortest >= 4 && (candidateKey.includes(aliasKey) || aliasKey.includes(candidateKey)))
    );
  });
}

function getCurrentMapLocation(map: GameMap | null): { name: string; description: string; aliases: string[] } | null {
  if (!map) return null;

  if (map.type === "node" && typeof map.partyPosition === "string") {
    const node = map.nodes?.find((entry) => entry.id === map.partyPosition);
    if (!node) {
      return {
        name: map.partyPosition,
        description: "",
        aliases: [map.partyPosition],
      };
    }
    return {
      name: node.label,
      description: node.description ?? "",
      aliases: [node.id, node.label],
    };
  }

  if (map.type === "grid" && typeof map.partyPosition === "object" && "x" in map.partyPosition) {
    const position = map.partyPosition;
    const cell = map.cells?.find((entry) => entry.x === position.x && entry.y === position.y);
    if (!cell) return null;
    return {
      name: cell.label,
      description: cell.description ?? "",
      aliases: [cell.label, `${cell.x},${cell.y}`, `${cell.x}:${cell.y}`],
    };
  }

  return null;
}

function collectDiscoveredMapLocations(map: GameMap | null): Array<{ name: string; description: string }> {
  if (!map) return [];

  if (map.type === "node") {
    return (map.nodes ?? [])
      .filter((node) => node.discovered)
      .map((node) => ({ name: node.label, description: node.description ?? "" }));
  }

  return (map.cells ?? [])
    .filter((cell) => cell.discovered)
    .map((cell) => ({ name: cell.label, description: cell.description ?? "" }));
}

function buildNpcMetInteraction(npc: GameNpc): string {
  const location = npc.location?.trim();
  return location && location.toLowerCase() !== "unknown" ? `Met at ${location}.` : "Met.";
}

function extractActiveQuests(playerStatsRaw: unknown): QuestProgress[] {
  const playerStats = parseStoredJson<Record<string, unknown>>(playerStatsRaw);
  if (!playerStats || !Array.isArray(playerStats.activeQuests)) return [];

  return playerStats.activeQuests.filter(
    (quest): quest is QuestProgress =>
      !!quest && typeof quest === "object" && typeof (quest as QuestProgress).name === "string",
  );
}

function extractPresentCharacterNames(presentCharactersRaw: unknown): string[] {
  const presentCharacters = parseStoredJson<Array<{ name?: string }>>(presentCharactersRaw);
  if (!Array.isArray(presentCharacters)) return [];
  return presentCharacters.map((entry) => entry?.name?.trim()).filter((name): name is string => !!name);
}

function markNpcsMetByNames(meta: Record<string, unknown>, names: string[]): Record<string, unknown> {
  if (names.length === 0) return meta;

  const knownNames = new Set(names.map((name) => normalizeJournalMatch(name)));
  const npcs = (meta.gameNpcs as GameNpc[]) ?? [];
  let changed = false;
  const updatedNpcs = npcs.map((npc) => {
    if (npc.met || !knownNames.has(normalizeJournalMatch(npc.name))) return npc;
    changed = true;
    return { ...npc, met: true };
  });

  return changed ? { ...meta, gameNpcs: updatedNpcs } : meta;
}

function markNpcsMetAtCurrentLocation(meta: Record<string, unknown>): Record<string, unknown> {
  const map = (meta.gameMap as GameMap) ?? null;
  const location = getCurrentMapLocation(map);
  if (!location) return meta;

  const npcs = (meta.gameNpcs as GameNpc[]) ?? [];
  let changed = false;
  const updatedNpcs = npcs.map((npc) => {
    if (npc.met || !locationMatches(npc.location, location.aliases)) return npc;
    changed = true;
    return { ...npc, met: true };
  });

  return changed ? { ...meta, gameNpcs: updatedNpcs } : meta;
}

function reconcileJournal(
  journal: Journal,
  meta: Record<string, unknown>,
  activeQuests: QuestProgress[],
  currentLocation?: string | null,
): Journal {
  let next = journal;

  const discoveredLocationKeys = new Set<string>();
  for (const map of getGameMapsFromMeta(meta)) {
    for (const location of collectDiscoveredMapLocations(map)) {
      const key = normalizeJournalMatch(location.name);
      if (key && discoveredLocationKeys.has(key)) continue;
      if (key) discoveredLocationKeys.add(key);
      next = addLocationEntry(next, location.name, location.description);
    }
  }

  if (discoveredLocationKeys.size === 0) {
    for (const location of collectDiscoveredMapLocations((meta.gameMap as GameMap) ?? null)) {
      next = addLocationEntry(next, location.name, location.description);
    }
  }

  const locationName = currentLocation?.trim();
  if (locationName) {
    next = addLocationEntry(next, locationName, `The party is at ${locationName}.`);
  }

  for (const npc of (meta.gameNpcs as GameNpc[]) ?? []) {
    if (!npc.met) continue;
    const interaction = buildNpcMetInteraction(npc);
    const hasInteraction = next.npcLog.some(
      (entry) => entry.npcName === npc.name && entry.interactions.includes(interaction),
    );
    if (!hasInteraction) {
      next = addNpcEntry(next, npc, interaction);
    }
  }

  for (const quest of activeQuests) {
    const objectiveRows = Array.isArray(quest.objectives)
      ? quest.objectives.filter((objective) => !!objective && typeof objective.text === "string")
      : [];
    const objectives = objectiveRows.map((objective) => `${objective.completed ? "[Done] " : ""}${objective.text}`);
    const currentObjective = objectiveRows.find((objective) => !objective.completed)?.text;
    next = upsertQuest(next, {
      id: quest.questEntryId || quest.name,
      name: quest.name,
      status: quest.completed ? "completed" : "active",
      description: currentObjective ?? (quest.completed ? `${quest.name} completed.` : `${quest.name} is in progress.`),
      objectives,
    });
  }

  return next;
}

// ──────────────────────────────────────────────
// Route Registration
// ──────────────────────────────────────────────

export async function gameRoutes(app: FastifyInstance) {
  const buildHydratedGameMeta = async (
    chatId: string,
    baseMeta: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const gameStateStore = createGameStateStorage(app.db);
    const latestState = await gameStateStore.getLatest(chatId);

    let hydratedMeta = baseMeta;
    const presentCharacterNames = extractPresentCharacterNames(latestState?.presentCharacters);
    if (presentCharacterNames.length > 0) {
      hydratedMeta = markNpcsMetByNames(hydratedMeta, presentCharacterNames);
    }

    const activeQuests = extractActiveQuests(latestState?.playerStats);
    const currentLocation = typeof latestState?.location === "string" ? latestState.location : null;
    hydratedMeta = syncGameMapMetaPartyPosition(hydratedMeta, currentLocation);
    const currentJournal = (hydratedMeta.gameJournal as Journal) ?? createJournal();
    return {
      ...hydratedMeta,
      gameJournal: reconcileJournal(currentJournal, hydratedMeta, activeQuests, currentLocation),
    };
  };

  // ── POST /game/create ──
  app.post("/create", async (req) => {
    logger.info("[game/create] Received request");
    const { name, setupConfig, connectionId, characterConnectionId, promptPresetId, chatId } = createGameSchema.parse(
      req.body,
    );
    const chats = createChatsStorage(app.db);
    let defaultGenerationParameters: StoredGenerationParameters | null = null;
    if (connectionId && connectionId !== "random") {
      const connStorage = createConnectionsStorage(app.db);
      const conn = await connStorage.getById(connectionId);
      defaultGenerationParameters = parseStoredGenerationParameters(conn?.defaultParameters);
    }

    const gameId = randomUUID();

    // Reuse an existing chat if one was already created (e.g. from sidebar)
    let sessionChat: Awaited<ReturnType<typeof chats.getById>>;
    if (chatId) {
      sessionChat = await chats.getById(chatId);
      if (!sessionChat) throw new Error("Chat not found");
      // Update the chat to have game-mode fields
      // Use only the persona explicitly selected in the wizard (null = no persona)
      await chats.update(chatId, {
        name: name || sessionChat.name || "New Game",
        characterIds: setupConfig.partyCharacterIds,
        groupId: gameId,
        connectionId: connectionId || sessionChat.connectionId,
        personaId: setupConfig.personaId ?? null,
      });
      sessionChat = await chats.getById(chatId);
    } else {
      sessionChat = await chats.create({
        name: name || "New Game",
        mode: "game",
        characterIds: setupConfig.partyCharacterIds,
        groupId: gameId,
        personaId: setupConfig.personaId || null,
        promptPresetId: promptPresetId || null,
        connectionId: connectionId || null,
      });
    }
    if (!sessionChat) throw new Error("Failed to create game session chat");

    const sessionMeta = parseMeta(sessionChat.metadata);
    const gameChatParameters = mergeStoredGenerationParameters(
      defaultGenerationParameters,
      sessionMeta.chatParameters,
      setupConfig.generationParameters,
    );
    await chats.updateMetadata(sessionChat.id, {
      ...sessionMeta,
      gameId,
      gameSessionNumber: 1,
      gameSessionStatus: "setup",
      gameCurrentSessionStartedAt: new Date().toISOString(),
      gameActiveState: "exploration",
      gameGmMode: setupConfig.gmMode,
      gameGmCharacterId: setupConfig.gmCharacterId || null,
      gamePartyCharacterIds: setupConfig.partyCharacterIds,
      gamePartyChatId: null,
      gameMap: null,
      gameMaps: [],
      activeGameMapId: null,
      gamePreviousSessionSummaries: [],
      gameStoryArc: null,
      gamePlotTwists: [],
      gameDialogueChatId: null,
      gameCombatChatId: null,
      gameSetupConfig: setupConfig,
      gameCharacterConnectionId: null,
      gameSceneConnectionId: setupConfig.sceneConnectionId || null,
      gameNpcs: [],
      enableAgents: true,
      enableSpriteGeneration: setupConfig.enableSpriteGeneration || false,
      gameImageConnectionId: setupConfig.imageConnectionId || null,
      activeLorebookIds: setupConfig.activeLorebookIds || [],
      enableCustomWidgets: setupConfig.enableCustomWidgets !== false,
      ...(gameChatParameters ? { chatParameters: gameChatParameters } : {}),
    });

    const updatedSession = await chats.getById(sessionChat.id);

    return { sessionChat: updatedSession, gameId };
  });

  // ── POST /game/setup ──
  app.post("/setup", async (req, reply) => {
    logger.info("[game/setup] Received request");
    const { chatId, connectionId, preferences, streaming } = setupSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);
    const characters = createCharactersStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    if (!setupConfig) throw new Error("No setup config found");

    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      connectionId,
      chat.connectionId,
    );
    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );
    const setupGenerationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);

    let gmCharacterCard: string | null = null;
    if (setupConfig.gmMode === "character" && setupConfig.gmCharacterId) {
      const gmChar = await characters.getById(setupConfig.gmCharacterId);
      if (gmChar) {
        const data = typeof gmChar.data === "string" ? JSON.parse(gmChar.data) : gmChar.data;
        const parts = [`Name: ${data.name}`];
        if (data.personality) parts.push(`Personality: ${data.personality}`);
        if (data.description) parts.push(`Description: ${data.description}`);
        const gmBackstory = data.extensions?.backstory || data.backstory;
        const gmAppearance = data.extensions?.appearance || data.appearance;
        if (gmBackstory) parts.push(`Backstory: ${gmBackstory}`);
        if (gmAppearance) parts.push(`Appearance: ${gmAppearance}`);
        gmCharacterCard = parts.join("\n");
      }
    }

    // Load persona info so the GM can tailor the experience
    let personaCard: string | null = null;
    if (chat.personaId || setupConfig.personaId) {
      const persona = await characters.getPersona(chat.personaId || setupConfig.personaId!);
      if (persona) {
        const parts = [`Name: ${persona.name}`];
        if (persona.description) parts.push(`Description: ${persona.description}`);
        if (persona.personality) parts.push(`Personality: ${persona.personality}`);
        if (persona.backstory) parts.push(`Backstory: ${persona.backstory}`);
        if (persona.appearance) parts.push(`Appearance: ${persona.appearance}`);
        personaCard = parts.join("\n");
      }
    }

    // Load party character cards for context (full detail)
    const partyCards: string[] = [];
    const partyRpgStats: Record<
      string,
      { enabled: boolean; attributes: Array<{ name: string; value: number }>; hp: { value: number; max: number } }
    > = {};
    for (const pcId of setupConfig.partyCharacterIds) {
      const pc = await characters.getById(pcId);
      if (pc) {
        const data = typeof pc.data === "string" ? JSON.parse(pc.data) : pc.data;
        const parts = [data.name];
        if (data.personality) parts.push(`Personality: ${data.personality}`);
        if (data.description) parts.push(`Description: ${data.description}`);
        const pcBackstory = data.extensions?.backstory || data.backstory;
        const pcAppearance = data.extensions?.appearance || data.appearance;
        if (pcBackstory) parts.push(`Backstory: ${pcBackstory}`);
        if (pcAppearance) parts.push(`Appearance: ${pcAppearance}`);
        partyCards.push(`- ${parts.join("\n  ")}`);
        // Collect RPG stats for character cards
        if (data.extensions?.rpgStats?.enabled) {
          partyRpgStats[data.name] = data.extensions.rpgStats;
        }
      }
    }

    // Also collect persona RPG stats
    let personaRpgStats: {
      enabled: boolean;
      attributes: Array<{ name: string; value: number }>;
      hp: { value: number; max: number };
    } | null = null;
    let personaName: string | null = null;
    if (chat.personaId || setupConfig.personaId) {
      const persona = await characters.getPersona(chat.personaId || setupConfig.personaId!);
      if (persona) {
        personaName = persona.name;
        try {
          const statsData = persona.personaStats ? JSON.parse(persona.personaStats) : null;
          if (statsData?.rpgStats?.enabled) {
            personaRpgStats = statsData.rpgStats;
          }
        } catch {
          /* skip */
        }
      }
    }

    let setupLorebookContext: string | undefined;
    if ((setupConfig.activeLorebookIds?.length ?? 0) > 0) {
      const lorebookResult = await processLorebooks(app.db, [], null, {
        characterIds: setupConfig.partyCharacterIds,
        personaId: setupConfig.personaId ?? null,
        activeLorebookIds: setupConfig.activeLorebookIds,
      });
      const combinedLore = [
        lorebookResult.worldInfoBefore,
        ...lorebookResult.depthEntries.map((entry) => entry.content),
        lorebookResult.worldInfoAfter,
      ]
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n\n");
      if (combinedLore) {
        setupLorebookContext = combinedLore;
        logger.info(
          "[game/setup] Injecting %d constant lorebook entries into world generation",
          lorebookResult.totalEntries,
        );
      }
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildSetupPrompt({
          rating: setupConfig.rating ?? "sfw",
          personaCard: personaCard || null,
          partyCards: partyCards.length > 0 ? partyCards : undefined,
          gmCharacterCard: gmCharacterCard || null,
          enableCustomWidgets: setupConfig.enableCustomWidgets,
          lorebookContext: setupLorebookContext,
          language: setupConfig.language,
        }),
      },
      {
        role: "user",
        content: [
          `Genre: ${setupConfig.genre}`,
          `Setting: ${setupConfig.setting}`,
          `Tone: ${setupConfig.tone}`,
          `Difficulty: ${setupConfig.difficulty}`,
          `Player goals: ${setupConfig.playerGoals}`,
          preferences?.trim() ? `Additional preferences: ${preferences}` : "",
          ``,
          `REMEMBER: Output ONLY the requested JSON object with the exact keys from the template. No discussion, no markdown, no extra text.`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ];

    logger.debug("[game/setup] === PROMPT BEING SENT ===");
    for (const msg of messages) {
      logger.debug("[game/setup] [%s] (%d chars):\n%s", msg.role, msg.content.length, msg.content);
    }
    logger.debug("[game/setup] === END PROMPT ===");

    const setupOptions = gameGenOptions(
      conn.model,
      {
        maxTokens: setupGenerationParameters?.maxTokens ?? 16384,
        stream: streaming,
        ...(streaming
          ? {
              onToken: (() => {
                const setupStartTime = Date.now();
                let sawFirstToken = false;
                return (chunk: string) => {
                  if (!chunk || sawFirstToken) return;
                  sawFirstToken = true;
                  logger.debug("[game/setup] First streamed token received after %d ms", Date.now() - setupStartTime);
                };
              })(),
            }
          : {}),
      },
      setupGenerationParameters,
    );
    logger.debug(
      "[game/setup] Sending to provider=%s model=%s baseUrl=%s options=%s",
      conn.provider,
      conn.model,
      baseUrl,
      JSON.stringify(setupOptions),
    );

    const result = await provider.chatComplete(messages, setupOptions);
    const setupExtraction = extractLeadingThinkingBlocks(result.content ?? "");
    const responseText = setupExtraction.content;

    logger.debug("[game/setup] Response length: %d chars", responseText.length);
    logger.debug("[game/setup] Full response:\n%s", responseText);
    if (setupExtraction.thinking) {
      logger.debug(
        "[game/setup] Thinking tokens (%d chars):\n%s",
        setupExtraction.thinking.length,
        setupExtraction.thinking,
      );
    }

    let setupData: Record<string, unknown> = {};
    let parseError: string | null = null;
    try {
      setupData = parseJSON(responseText) as Record<string, unknown>;
      logger.info("[game/setup] Parsed JSON keys: %s", Object.keys(setupData));
    } catch (e) {
      logger.error(e, "[game/setup] JSON parse failed");
      parseError = "Model did not return valid JSON. The setup response could not be parsed.";
    }

    // Validate required fields
    if (!parseError) {
      const missing: string[] = [];
      if (!setupData.storyArc) missing.push("storyArc");
      if (!setupData.worldOverview) missing.push("worldOverview");
      if (!Array.isArray(setupData.plotTwists) || setupData.plotTwists.length === 0) missing.push("plotTwists");
      if (!Array.isArray(setupData.startingNpcs) || setupData.startingNpcs.length === 0) missing.push("startingNpcs");
      if (missing.length > 0) {
        logger.warn("[game/setup] Validation failed — missing: %s", missing);
        parseError = `Setup generation incomplete — missing: ${missing.join(", ")}. Try again or use a different model.`;
      }
    }

    if (parseError) {
      logger.error("[game/setup] Returning 422: %s", parseError);
      reply.code(422).send({ error: parseError, rawResponse: responseText.slice(0, 500) });
      return;
    }

    logger.info("[game/setup] Validation passed, transitioning to ready");

    const updates: Record<string, unknown> = { ...meta, gameSessionStatus: "ready" };
    if (setupData.worldOverview) updates.gameWorldOverview = setupData.worldOverview as string;
    if (setupData.storyArc) updates.gameStoryArc = setupData.storyArc as string;
    if (setupData.plotTwists) updates.gamePlotTwists = setupData.plotTwists as string[];

    // Persist LLM-generated art style into the setup config for consistent image generation
    if (setupData.artStylePrompt && typeof setupData.artStylePrompt === "string") {
      const cfgCopy = {
        ...(updates.gameSetupConfig as Record<string, unknown>),
        artStylePrompt: setupData.artStylePrompt,
      };
      updates.gameSetupConfig = cfgCopy;
    }
    if (setupData.startingMap) {
      // Convert regions-based format from the LLM into proper GameMap node graph
      const raw = setupData.startingMap as Record<string, unknown>;
      const regions = (raw.regions as Array<Record<string, unknown>>) ?? [];
      if (regions.length > 0) {
        // Lay out nodes in a circle for visual clarity
        const nodes = regions.map((r, i) => {
          const angle = (2 * Math.PI * i) / regions.length - Math.PI / 2;
          const radius = 35;
          return {
            id: (r.id as string) || `region_${i + 1}`,
            emoji:
              r.type === "town"
                ? "🏘️"
                : r.type === "wilderness"
                  ? "🌲"
                  : r.type === "dungeon"
                    ? "🏰"
                    : r.type === "building"
                      ? "🏛️"
                      : r.type === "camp"
                        ? "⛺"
                        : "📍",
            label: (r.name as string) || `Region ${i + 1}`,
            x: Math.round(50 + radius * Math.cos(angle)),
            y: Math.round(50 + radius * Math.sin(angle)),
            discovered: (r.discovered as boolean) ?? i === 0,
            description: (r.description as string) || undefined,
          };
        });
        // Build edges from connectedTo arrays
        const edgeSet = new Set<string>();
        const edges: Array<{ from: string; to: string }> = [];
        for (const r of regions) {
          const id = (r.id as string) || "";
          const connected = (r.connectedTo as string[]) ?? [];
          for (const target of connected) {
            const key = [id, target].sort().join("→");
            if (!edgeSet.has(key)) {
              edgeSet.add(key);
              edges.push({ from: id, to: target });
            }
          }
        }
        const map: GameMap = {
          type: "node",
          name: (raw.name as string) || "Starting Area",
          description: (raw.description as string) || "",
          nodes,
          edges,
          partyPosition: nodes[0]?.id || "region_1",
        };
        updates.gameMap = map;
      } else {
        // Already in correct format or unrecognized — save as-is
        updates.gameMap = raw as unknown as GameMap;
      }
    }
    if (updates.gameMap) {
      Object.assign(updates, withActiveGameMapMeta(updates, updates.gameMap as GameMap));
    }
    if (setupData.startingNpcs) {
      // Build name→avatarPath lookup from the character library so NPCs
      // that match an existing character card reuse its avatar automatically.
      const charStore = createCharactersStorage(app.db);
      const allChars = await charStore.list();
      const charAvatarByName = new Map<string, string>();
      for (const ch of allChars) {
        try {
          const parsed = JSON.parse(ch.data) as { name?: string };
          if (parsed.name && ch.avatarPath) {
            charAvatarByName.set(parsed.name.toLowerCase(), ch.avatarPath);
          }
        } catch {
          /* skip unparseable */
        }
      }

      const npcs = (setupData.startingNpcs as Array<Record<string, unknown>>).map((n, i) => {
        const name = (n.name as string) || `NPC ${i + 1}`;
        return {
          id: randomUUID(),
          name,
          emoji: (n.emoji as string) || "🧑",
          description: (n.description as string) || "",
          descriptionSource: n.description ? "model" : undefined,
          gender: typeof n.gender === "string" ? n.gender : null,
          pronouns: typeof n.pronouns === "string" ? n.pronouns : null,
          location: (n.location as string) || "Unknown",
          reputation: (n.reputation as number) || 0,
          met: false,
          notes: [] as string[],
          avatarUrl: charAvatarByName.get(name.toLowerCase()) ?? undefined,
        };
      });
      updates.gameNpcs = npcs;
    }

    // Persist party arcs (personal side-quests for each party member)
    if (setupData.partyArcs && Array.isArray(setupData.partyArcs)) {
      const arcs = (setupData.partyArcs as Array<Record<string, unknown>>)
        .map((a) => ({
          name: (a.name as string) || "",
          arc: (a.arc as string) || "",
          goal: (a.goal as string) || "",
        }))
        .filter((a) => a.name && a.arc);
      if (arcs.length > 0) updates.gamePartyArcs = arcs;
    }

    // Persist character cards (LLM-generated game info + RPG stats from char/persona data)
    if (setupData.characterCards && Array.isArray(setupData.characterCards)) {
      const cards = (setupData.characterCards as Array<Record<string, unknown>>)
        .map((c) => {
          const name = (c.name as string) || "";
          const normalizedCard = normalizeGeneratedGameCharacterCard(c, name);
          // Merge in RPG stats from the character/persona card if enabled
          const charStats = partyRpgStats[name] ?? null;
          const isPersona = personaName && name.toLowerCase() === personaName.toLowerCase();
          const rpg = isPersona ? personaRpgStats : charStats;
          return {
            ...normalizedCard,
            // Stats from character/persona cards (if RPG stats were enabled)
            rpgStats: rpg
              ? {
                  attributes: rpg.attributes,
                  hp: { value: rpg.hp.max, max: rpg.hp.max },
                }
              : undefined,
          };
        })
        .filter((c) => c.name);
      if (cards.length > 0) updates.gameCharacterCards = cards;
    }

    // Persist game blueprint (HUD widgets, intro sequence, visual theme)
    if (setupData.blueprint) {
      const blueprintSchema = z.object({
        hudWidgets: z
          .array(
            z.object({
              id: z.string(),
              type: z.enum([
                "progress_bar",
                "gauge",
                "relationship_meter",
                "counter",
                "stat_block",
                "list",
                "inventory_grid",
                "timer",
              ]),
              label: z.string(),
              icon: z.string().optional(),
              position: z.enum(["hud_left", "hud_right"]),
              accent: z.string().optional(),
              config: z.record(z.unknown()),
            }),
          )
          .default([]),
        introSequence: z
          .array(
            z.object({
              effect: z.string(),
              duration: z.number().optional(),
              intensity: z.number().min(0).max(1).optional(),
              target: z.enum(["background", "content", "all"]).optional(),
              params: z.record(z.string()).optional(),
            }),
          )
          .default([]),
        visualTheme: z
          .object({
            palette: z.string(),
            uiStyle: z.string(),
            moodDefault: z.string(),
          })
          .optional(),
      });
      const parsed = blueprintSchema.safeParse(setupData.blueprint);
      if (parsed.success) {
        // Normalize stat_block configs: the LLM may emit { key, value } or flat objects
        for (const w of parsed.data.hudWidgets) {
          if (w.type === "stat_block" && w.config.stats) {
            const raw = w.config.stats;
            if (Array.isArray(raw)) {
              // Normalize { key, value } → { name, value }
              w.config.stats = raw.map((s: Record<string, unknown>) => ({
                name: String((s as Record<string, unknown>).name ?? (s as Record<string, unknown>).key ?? ""),
                value: (s as Record<string, unknown>).value ?? 0,
              }));
            } else if (typeof raw === "object" && raw !== null) {
              // Flat object like { strength: 15, dexterity: 20 } → array
              w.config.stats = Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({
                name: k,
                value: v ?? 0,
              }));
            }
          }
        }
        updates.gameBlueprint = parsed.data;
      }
    }

    const hydratedUpdates = await buildHydratedGameMeta(chatId, updates);
    await chats.updateMetadata(chatId, hydratedUpdates);

    reply.send({
      setup: setupData,
      worldOverview: (setupData.worldOverview as string) || null,
    });
  });

  // ── POST /game/start ── (transitions game from "ready" to "active")
  // The client sends [Start the game] through the regular generate pipeline,
  // which already builds the full GM system prompt with all world context,
  // streams the response, and triggers scene analysis on the client side.
  app.post("/start", async (req) => {
    logger.info("[game/start] Transitioning to active");
    const { chatId } = gameStartSchema.parse(req.body);
    const chats = createChatsStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    if (meta.gameSessionStatus !== "ready") {
      throw new Error(`Cannot start game: status is "${meta.gameSessionStatus}", expected "ready"`);
    }

    await chats.updateMetadata(chatId, { ...meta, gameSessionStatus: "active" });

    return { status: "active" };
  });

  const pendingSessionStarts = new Map<
    string,
    Promise<{ sessionChat: StoredChatRecord; sessionNumber: number; recap: string }>
  >();

  // ── POST /game/session/start ──
  app.post("/session/start", async (req) => {
    const { gameId, connectionId } = startSessionSchema.parse(req.body);
    const existingStart = pendingSessionStarts.get(gameId);
    if (existingStart) {
      return existingStart;
    }

    const startSessionRequest = (async () => {
      const chats = createChatsStorage(app.db);
      const connections = createConnectionsStorage(app.db);

      const sessions = await chats.listByGroup(gameId);
      const gameSessions = sessions
        .filter((c) => (c.mode as string) === "game")
        .sort((a, b) => {
          const ma = parseMeta(a.metadata);
          const mb = parseMeta(b.metadata);
          return ((ma.gameSessionNumber as number) || 0) - ((mb.gameSessionNumber as number) || 0);
        });

      const latestSession = gameSessions[gameSessions.length - 1];
      if (!latestSession) throw new Error("No previous session found for this game");

      const prevMeta = parseMeta(latestSession.metadata);
      const baseSessionName = latestSession.name.replace(/ — Session \d+$/, "");
      const latestStatus = (prevMeta.gameSessionStatus as string) || "active";
      const summaries = normalizeStoredSessionSummaries(prevMeta.gamePreviousSessionSummaries);
      const currentSessionNumber = latestStatus === "concluded" ? Math.max(summaries.length, 1) : summaries.length + 1;
      const expectedLatestSessionName = `${baseSessionName} — Session ${currentSessionNumber}`;

      if (
        currentSessionNumber !== ((prevMeta.gameSessionNumber as number) || 0) ||
        summaries.length !== (((prevMeta.gamePreviousSessionSummaries as SessionSummary[]) || []).length ?? 0)
      ) {
        await chats.updateMetadata(latestSession.id, {
          ...prevMeta,
          gameSessionNumber: currentSessionNumber,
          gamePreviousSessionSummaries: summaries,
        });
      }

      if (latestSession.name !== expectedLatestSessionName) {
        await chats.update(latestSession.id, { name: expectedLatestSessionName });
      }

      if (latestStatus === "ready" || latestStatus === "active") {
        const existingChat = await chats.getById(latestSession.id);
        if (!existingChat) throw new Error("Existing session not found");
        return { sessionChat: existingChat, sessionNumber: currentSessionNumber, recap: "" };
      }

      const sessionNumber = summaries.length + 1;
      const latestSessionMessages = await chats.listMessages(latestSession.id);
      let latestSessionEndingBeat: string | null = null;
      for (let i = latestSessionMessages.length - 1; i >= 0; i--) {
        const message = latestSessionMessages[i]!;
        if (typeof message.content !== "string" || !message.content.trim()) continue;
        if (message.role === "assistant") {
          latestSessionEndingBeat = message.content;
          break;
        }
        if (
          latestSessionEndingBeat == null &&
          message.role === "narrator" &&
          !/^\*\*Session \d+ Concluded\*\*/.test(message.content.trim())
        ) {
          latestSessionEndingBeat = message.content;
        }
      }

      const newChat = await chats.create({
        name: `${baseSessionName} — Session ${sessionNumber}`,
        mode: "game",
        characterIds: (prevMeta.gamePartyCharacterIds as string[]) || [],
        groupId: gameId,
        personaId: latestSession.personaId,
        promptPresetId: latestSession.promptPresetId,
        connectionId: connectionId || latestSession.connectionId,
      });
      if (!newChat) throw new Error("Failed to create new session chat");

      const stateStore = createGameStateStorage(app.db);
      const previousState = await stateStore.getLatest(latestSession.id);
      const previousPresentCharacters = parseJsonField<any[]>(previousState?.presentCharacters, []);
      const previousRecentEvents = parseJsonField<string[]>(previousState?.recentEvents, []);
      const previousPlayerStats = parseJsonField<Record<string, unknown> | null>(previousState?.playerStats, null);
      const previousPersonaStats = parseJsonField<any[] | null>(previousState?.personaStats, null);
      const carriedInventory = mergeGameInventoryItems(
        normalizeGameInventoryItems(prevMeta.gameInventory),
        inventoryFromPlayerStats(previousPlayerStats),
      );
      const {
        gameLastIllustrationTurn: _previousIllustrationTurn,
        gameLastIllustrationSessionNumber: _previousIllustrationSessionNumber,
        gameLastIllustrationTag: _previousIllustrationTag,
        ...carryMeta
      } = prevMeta;

      const newMeta = parseMeta(newChat.metadata);
      const updatedNewMeta = {
        ...newMeta,
        ...carryMeta,
        gameId,
        gameSessionNumber: sessionNumber,
        gameSessionStatus: "ready",
        gameCurrentSessionStartedAt: new Date().toISOString(),
        gameActiveState: "exploration",
        gamePartyChatId: null,
        gamePreviousSessionSummaries: summaries,
        gameDialogueChatId: null,
        gameCombatChatId: null,
        enableAgents: true,
        ...(carriedInventory.length > 0 ? { gameInventory: carriedInventory } : {}),
      };
      await chats.updateMetadata(newChat.id, updatedNewMeta);

      let recapMessageId = "";
      let recapText = "";
      let recapThinking = "";
      if (summaries.length > 0) {
        try {
          const { conn, baseUrl } = await resolveConnection(connections, connectionId, newChat.connectionId);
          const provider = createLLMProvider(
            conn.provider,
            baseUrl,
            conn.apiKey!,
            conn.maxContext,
            conn.openrouterProvider,
            conn.maxTokensOverride,
          );

          const recapMessages: ChatMessage[] = [
            { role: "system", content: buildRecapPrompt(summaries, latestSessionEndingBeat) },
            { role: "user", content: "Generate the session recap." },
          ];

          const result = await provider.chatComplete(
            recapMessages,
            gameGenOptions(conn.model, {
              temperature: 0.7,
            }),
          );
          const recapExtraction = extractLeadingThinkingBlocks(result.content ?? "");
          recapText = recapExtraction.content;
          recapThinking = recapExtraction.thinking;
          if (recapThinking) {
            logger.debug("[game/session/start] Recap thinking (%d chars):\n%s", recapThinking.length, recapThinking);
          }
        } catch {
          recapText = `Session ${sessionNumber} begins. The adventure continues...`;
          recapThinking = "";
        }

        if (recapText) {
          try {
            const recapMsg = await chats.createMessage({
              chatId: newChat.id,
              role: "narrator",
              characterId: null,
              content: recapText,
            });
            recapMessageId = recapMsg?.id ?? "";
            if (recapMsg?.id && recapThinking) {
              await chats.updateMessageExtra(recapMsg.id, { thinking: recapThinking });
            }
            mirrorGameMessageToDiscord(updatedNewMeta, recapText, "Narrator");
          } catch (err) {
            logger.warn(err, "[game/session/start] Failed to persist recap message");
          }
        }
      }

      let carriedStateSnapshotId = "";
      if (previousState) {
        try {
          carriedStateSnapshotId = await stateStore.create({
            chatId: newChat.id,
            messageId: recapMessageId,
            swipeIndex: 0,
            date: previousState.date,
            time: previousState.time,
            location: previousState.location,
            weather: previousState.weather,
            temperature: previousState.temperature,
            presentCharacters: previousPresentCharacters,
            recentEvents: previousRecentEvents,
            playerStats: previousPlayerStats as any,
            personaStats: previousPersonaStats as any,
            committed: true,
          });
        } catch (err) {
          logger.warn(err, "[game/session/start] Failed to carry forward previous game state");
        }
      }

      // Auto-checkpoint at session start
      try {
        if (carriedStateSnapshotId) {
          const cpSvc = createCheckpointService(app.db);
          await cpSvc.create({
            chatId: newChat.id,
            snapshotId: carriedStateSnapshotId,
            messageId: recapMessageId,
            label: `Session ${sessionNumber} Start`,
            triggerType: "session_start",
            location: previousState?.location,
            gameState: "exploration",
            weather: previousState?.weather,
            timeOfDay: previousState?.time,
          });
        }
      } catch {
        /* non-fatal */
      }

      const updatedChat = await chats.getById(newChat.id);
      if (!updatedChat) throw new Error("Failed to reload new session chat");

      return { sessionChat: updatedChat, sessionNumber, recap: recapText };
    })();

    pendingSessionStarts.set(gameId, startSessionRequest);

    try {
      return await startSessionRequest;
    } finally {
      if (pendingSessionStarts.get(gameId) === startSessionRequest) {
        pendingSessionStarts.delete(gameId);
      }
    }
  });

  // ── POST /game/session/conclude ──
  app.post("/session/conclude", async (req) => {
    const { chatId, connectionId, streaming, nextSessionRequest } = concludeSessionSchema.parse(req.body);
    const trimmedNextSessionRequest = nextSessionRequest.trim();
    logger.info("[game/session/conclude] Starting manual conclude for chat %s", chatId);
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    const prevSummaries = normalizeStoredSessionSummaries(meta.gamePreviousSessionSummaries);
    const sessionNumber = prevSummaries.length + 1;

    const messages = await chats.listMessages(chatId);
    const relevantMessages = messages.filter((message) => message.role !== "system");
    const transcriptText = relevantMessages.map((message) => `[${message.role}] ${message.content}`).join("\n\n");
    const journalRecap = buildStructuredRecap((meta.gameJournal as Journal | null) ?? createJournal(), sessionNumber);

    const gameStates = createGameStateStorage(app.db);
    const latestState = await gameStates.getLatest(chatId);

    let updatedStoryArc = (meta.gameStoryArc as string) || null;
    let updatedPlotTwists = Array.isArray(meta.gamePlotTwists) ? (meta.gamePlotTwists as string[]) : [];
    let updatedPartyArcs = Array.isArray(meta.gamePartyArcs) ? normalizePartyArcPayload(meta.gamePartyArcs) : [];
    let updatedMorale = normalizeMoraleValue(meta.gameMorale, 50);
    const currentCards = (meta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];
    let updatedCards = currentCards;

    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      connectionId,
      chat.connectionId,
    );
    const conclusionGenerationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);
    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );

    const conclusionOptions = gameGenOptions(
      conn.model,
      {
        maxTokens: Math.max(SESSION_CONCLUSION_MIN_OUTPUT_TOKENS, conclusionGenerationParameters?.maxTokens ?? 0),
        temperature: 0.45,
        stream: streaming,
        ...(streaming ? { onToken: () => {} } : {}),
      },
      conclusionGenerationParameters,
    );
    const { messages: conclusionMessages, transcriptTruncated } = fitSessionConclusionMessages({
      sessionNumber,
      language: setupConfig?.language ?? null,
      journalRecap,
      transcriptText,
      transcriptMessageCount: relevantMessages.length,
      latestState,
      currentStoryArc: updatedStoryArc,
      currentPlotTwists: updatedPlotTwists,
      currentPartyArcs: updatedPartyArcs,
      currentMorale: updatedMorale,
      currentCards,
      nextSessionRequest: trimmedNextSessionRequest || null,
      maxContext: conn.maxContext,
      maxTokens: conclusionOptions.maxTokens,
    });
    if (transcriptTruncated) {
      logger.info(
        "[game/session/conclude] Transcript exceeded context for chat %s; trimmed only the middle of the transcript to fit.",
        chatId,
      );
    }

    const result = await provider.chatComplete(conclusionMessages, conclusionOptions);
    logger.info("[game/session/conclude] Conclusion generation completed for chat %s", chatId);
    const conclusionExtraction = extractLeadingThinkingBlocks(result.content ?? "");
    if (conclusionExtraction.thinking) {
      logger.debug(
        "[game/session/conclude] Thinking tokens (%d chars):\n%s",
        conclusionExtraction.thinking.length,
        conclusionExtraction.thinking,
      );
    }

    let summary = normalizeSessionSummaryPayload({}, sessionNumber, "Session concluded.");
    try {
      const parsedConclusion = parseJSON(conclusionExtraction.content) as Record<string, unknown>;
      const rawSummary =
        parsedConclusion.summary &&
        typeof parsedConclusion.summary === "object" &&
        !Array.isArray(parsedConclusion.summary)
          ? (parsedConclusion.summary as Record<string, unknown>)
          : typeof parsedConclusion.summary === "string"
            ? ({ summary: parsedConclusion.summary } as Record<string, unknown>)
            : parsedConclusion;
      summary = normalizeSessionSummaryPayload(rawSummary, sessionNumber, "Session concluded.");
      summary = { ...summary, nextSessionRequest: trimmedNextSessionRequest || null };
      updatedMorale = extractMoraleFromSessionSummary(summary, updatedMorale);
      summary = { ...summary, statsSnapshot: { ...summary.statsSnapshot, partyMorale: updatedMorale } };

      const updatedCampaignProgression = applyCampaignProgressionPayload(
        extractCampaignProgressionPayload(parsedConclusion),
        {
          storyArc: updatedStoryArc,
          plotTwists: updatedPlotTwists,
          partyArcs: updatedPartyArcs,
        },
      );

      updatedStoryArc = updatedCampaignProgression.storyArc;
      updatedPlotTwists = updatedCampaignProgression.plotTwists;
      updatedPartyArcs = updatedCampaignProgression.partyArcs;

      if (currentCards.length > 0) {
        const appliedCards = applyGeneratedGameCharacterCards(currentCards, parsedConclusion.characterCards);
        updatedCards = appliedCards.cards;
        if (appliedCards.updatedCount > 0) {
          logger.info(
            `[session/conclude] Updated ${appliedCards.updatedCount} character cards after session ${sessionNumber}`,
          );
        }
      }
    } catch (err) {
      logger.warn(err, "[session/conclude] Combined session conclusion parsing failed (non-fatal)");
    }

    if (trimmedNextSessionRequest && !summary.nextSessionRequest) {
      summary = { ...summary, nextSessionRequest: trimmedNextSessionRequest };
    }

    await chats.updateMetadata(chatId, {
      ...meta,
      gameSessionNumber: sessionNumber,
      gameSessionStatus: "concluded",
      gameStoryArc: updatedStoryArc,
      gamePlotTwists: updatedPlotTwists,
      gamePartyArcs: updatedPartyArcs,
      gamePreviousSessionSummaries: [...prevSummaries, summary],
      gameCharacterCards: updatedCards,
      ...buildMoraleMetadataUpdates(meta, updatedMorale),
    });

    const sessionSummaryMsg = await chats.createMessage({
      chatId,
      role: "narrator",
      characterId: null,
      content: `**Session ${sessionNumber} Concluded**\n\n${summary.summary}\n\n*Party Dynamics:* ${summary.partyDynamics}`,
    });
    if (sessionSummaryMsg?.id && conclusionExtraction.thinking) {
      await chats.updateMessageExtra(sessionSummaryMsg.id, { thinking: conclusionExtraction.thinking });
    }
    mirrorGameMessageToDiscord(
      meta,
      `**Session ${sessionNumber} Concluded**\n\n${summary.summary}\n\n*Party Dynamics:* ${summary.partyDynamics}`,
      "Narrator",
    );

    // Push an OOC influence to the connected conversation if linked
    if (chat.connectedChatId) {
      await chats.createInfluence(
        chatId,
        chat.connectedChatId as string,
        `Game session ${sessionNumber} just concluded. Summary: ${summary.summary}${
          summary.keyDiscoveries.length ? ` Key discoveries: ${summary.keyDiscoveries.join(", ")}` : ""
        }`,
      );
    }

    // Auto-checkpoint at session end
    try {
      if (latestState) {
        const cpSvc = createCheckpointService(app.db);
        await cpSvc.create({
          chatId,
          snapshotId: latestState.id,
          messageId: latestState.messageId,
          label: `Session ${sessionNumber} End`,
          triggerType: "session_end",
          location: latestState.location,
          gameState: (meta.gameActiveState as string) ?? "exploration",
          weather: latestState.weather,
          timeOfDay: latestState.time,
        });
      }
    } catch {
      /* non-fatal */
    }

    logger.info("[game/session/conclude] Session %d concluded for chat %s", sessionNumber, chatId);
    return { summary };
  });

  // ── POST /game/session/regenerate-conclusion ──
  app.post("/session/regenerate-conclusion", async (req) => {
    const { chatId, connectionId, sessionNumber, streaming } = regenerateSessionConclusionSchema.parse(req.body);
    console.log("[game/session/regenerate-conclusion] Regenerating session %s for chat %s", sessionNumber, chatId);
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    const prevSummaries = normalizeStoredSessionSummaries(meta.gamePreviousSessionSummaries);
    const targetIndex = sessionNumber - 1;
    if (targetIndex < 0 || targetIndex >= prevSummaries.length) {
      throw new Error("Session summary not found");
    }
    const existingNextSessionRequest = prevSummaries[targetIndex]?.nextSessionRequest?.trim() || null;

    const messages = await chats.listMessages(chatId);
    const conclusionHeader = `**Session ${sessionNumber} Concluded**`;
    const relevantMessages = messages.filter(
      (message) =>
        message.role !== "system" &&
        !(message.content.trim().startsWith("**Session ") && message.content.includes(" Concluded**")),
    );
    const transcriptText = relevantMessages.map((message) => `[${message.role}] ${message.content}`).join("\n\n");
    const journalRecap = buildStructuredRecap((meta.gameJournal as Journal | null) ?? createJournal(), sessionNumber);

    const gameStates = createGameStateStorage(app.db);
    const latestState = await gameStates.getLatest(chatId);

    const currentStoryArc = (meta.gameStoryArc as string) || null;
    const currentPlotTwists = Array.isArray(meta.gamePlotTwists) ? (meta.gamePlotTwists as string[]) : [];
    const currentPartyArcs = Array.isArray(meta.gamePartyArcs) ? normalizePartyArcPayload(meta.gamePartyArcs) : [];
    const currentMorale = normalizeMoraleValue(meta.gameMorale, 50);
    const currentCards = (meta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];

    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      connectionId,
      chat.connectionId,
    );
    const conclusionGenerationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);
    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );
    const conclusionOptions = gameGenOptions(
      conn.model,
      {
        maxTokens: Math.max(SESSION_CONCLUSION_MIN_OUTPUT_TOKENS, conclusionGenerationParameters?.maxTokens ?? 0),
        temperature: 0.45,
        stream: streaming,
        ...(streaming ? { onToken: () => {} } : {}),
      },
      conclusionGenerationParameters,
    );
    const { messages: conclusionMessages, transcriptTruncated } = fitSessionConclusionMessages({
      sessionNumber,
      language: setupConfig?.language ?? null,
      journalRecap,
      transcriptText,
      transcriptMessageCount: relevantMessages.length,
      latestState,
      currentStoryArc,
      currentPlotTwists,
      currentPartyArcs,
      currentMorale,
      currentCards,
      nextSessionRequest: existingNextSessionRequest,
      maxContext: conn.maxContext,
      maxTokens: conclusionOptions.maxTokens,
    });
    if (transcriptTruncated) {
      console.log(
        "[game/session/regenerate-conclusion] Transcript exceeded context for chat %s; trimmed only the middle of the transcript to fit.",
        chatId,
      );
    }

    const result = await provider.chatComplete(conclusionMessages, conclusionOptions);
    const conclusionExtraction = extractLeadingThinkingBlocks(result.content ?? "");
    let summary: SessionSummary;
    let updatedStoryArc = currentStoryArc;
    let updatedPlotTwists = currentPlotTwists;
    let updatedPartyArcs = currentPartyArcs;
    let updatedMorale = currentMorale;
    let updatedCards = currentCards;
    try {
      const parsedConclusion = parseJSON(conclusionExtraction.content) as Record<string, unknown>;
      const rawSummary =
        parsedConclusion.summary &&
        typeof parsedConclusion.summary === "object" &&
        !Array.isArray(parsedConclusion.summary)
          ? (parsedConclusion.summary as Record<string, unknown>)
          : typeof parsedConclusion.summary === "string"
            ? ({ summary: parsedConclusion.summary } as Record<string, unknown>)
            : parsedConclusion;
      summary = normalizeSessionSummaryPayload(rawSummary, sessionNumber, "Session concluded.");
      summary = { ...summary, nextSessionRequest: existingNextSessionRequest };
      updatedMorale = extractMoraleFromSessionSummary(summary, updatedMorale);
      summary = { ...summary, statsSnapshot: { ...summary.statsSnapshot, partyMorale: updatedMorale } };
      const updatedCampaignProgression = applyCampaignProgressionPayload(
        extractCampaignProgressionPayload(parsedConclusion),
        {
          storyArc: currentStoryArc,
          plotTwists: currentPlotTwists,
          partyArcs: currentPartyArcs,
        },
      );
      updatedStoryArc = updatedCampaignProgression.storyArc;
      updatedPlotTwists = updatedCampaignProgression.plotTwists;
      updatedPartyArcs = updatedCampaignProgression.partyArcs;
      const appliedCards = applyGeneratedGameCharacterCards(currentCards, parsedConclusion.characterCards);
      updatedCards = appliedCards.cards;
      if (appliedCards.updatedCount > 0) {
        console.log(
          `[session/regenerate-conclusion] Updated ${appliedCards.updatedCount} character cards for session ${sessionNumber}`,
        );
      }
    } catch (err) {
      console.warn("[session/regenerate-conclusion] Session conclusion parsing failed:", err);
      throw new Error("The regenerated conclusion was not valid JSON. Please try again.");
    }

    const nextSummaries = prevSummaries.map((existingSummary, index) =>
      index === targetIndex ? summary : existingSummary,
    );
    await chats.updateMetadata(chatId, {
      ...meta,
      gameStoryArc: updatedStoryArc,
      gamePlotTwists: updatedPlotTwists,
      gamePartyArcs: updatedPartyArcs,
      gamePreviousSessionSummaries: nextSummaries,
      gameCharacterCards: updatedCards,
      ...buildMoraleMetadataUpdates(meta, updatedMorale),
    });

    const nextContent = `**Session ${sessionNumber} Concluded**\n\n${summary.summary}\n\n*Party Dynamics:* ${summary.partyDynamics}`;
    const existingConclusionMessage = [...messages]
      .reverse()
      .find((message) => message.role === "narrator" && message.content.trim().startsWith(conclusionHeader));
    if (existingConclusionMessage) {
      await chats.updateMessageContent(existingConclusionMessage.id, nextContent);
      if (conclusionExtraction.thinking) {
        await chats.updateMessageExtra(existingConclusionMessage.id, { thinking: conclusionExtraction.thinking });
      }
    }

    return { summary };
  });

  // ── POST /game/session/update-campaign-progression ──
  app.post("/session/update-campaign-progression", async (req) => {
    const { chatId, connectionId, sessionNumber, streaming } = updateCampaignProgressionSchema.parse(req.body);
    console.log(
      "[game/session/update-campaign-progression] Updating campaign progression from session %s for chat %s",
      sessionNumber,
      chatId,
    );
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    const currentChat = await chats.getById(chatId);
    if (!currentChat) throw new Error("Chat not found");
    if ((currentChat.mode as string) !== "game")
      throw new Error("Campaign progression can only be updated in game mode");

    const currentMeta = parseMeta(currentChat.metadata);
    const gameId = (currentMeta.gameId as string) || currentChat.groupId || currentChat.id;
    const sessions = await chats.listByGroup(gameId);
    const gameSessions = sessions
      .filter((session) => (session.mode as string) === "game")
      .sort((a, b) => {
        const aMeta = parseMeta(a.metadata);
        const bMeta = parseMeta(b.metadata);
        return ((aMeta.gameSessionNumber as number) || 0) - ((bMeta.gameSessionNumber as number) || 0);
      });
    const targetSession =
      gameSessions.find(
        (session) => ((parseMeta(session.metadata).gameSessionNumber as number) || 0) === sessionNumber,
      ) ?? (sessionNumber === ((currentMeta.gameSessionNumber as number) || 0) ? currentChat : null);
    if (!targetSession) throw new Error("Session not found");

    const targetMeta = parseMeta(targetSession.metadata);
    const setupConfig =
      (currentMeta.gameSetupConfig as GameSetupConfig | null) ?? (targetMeta.gameSetupConfig as GameSetupConfig | null);
    const targetMessages = await chats.listMessages(targetSession.id);
    const relevantMessages = targetMessages.filter(
      (message) =>
        message.role !== "system" &&
        !(message.content.trim().startsWith("**Session ") && message.content.includes(" Concluded**")),
    );
    const transcriptText = relevantMessages.map((message) => `[${message.role}] ${message.content}`).join("\n\n");
    if (!transcriptText.trim()) throw new Error("Selected session has no transcript to analyze");

    const gameStates = createGameStateStorage(app.db);
    const latestState = await gameStates.getLatest(targetSession.id);
    const journalRecap = buildStructuredRecap(
      (targetMeta.gameJournal as Journal | null) ?? createJournal(),
      sessionNumber,
    );
    const currentProgression: CampaignProgressionState = {
      storyArc: (currentMeta.gameStoryArc as string) || null,
      plotTwists: Array.isArray(currentMeta.gamePlotTwists) ? (currentMeta.gamePlotTwists as string[]) : [],
      partyArcs: Array.isArray(currentMeta.gamePartyArcs) ? normalizePartyArcPayload(currentMeta.gamePartyArcs) : [],
    };

    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      connectionId,
      currentChat.connectionId,
    );
    const progressionGenerationParameters = resolveStoredGameGenerationParameters(
      currentMeta,
      defaultGenerationParameters,
    );
    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );
    const progressionOptions = gameGenOptions(
      conn.model,
      {
        maxTokens: Math.max(CAMPAIGN_PROGRESSION_MIN_OUTPUT_TOKENS, progressionGenerationParameters?.maxTokens ?? 0),
        temperature: 0.35,
        stream: streaming,
        ...(streaming ? { onToken: () => {} } : {}),
      },
      progressionGenerationParameters,
    );
    const userLines = [
      `Session ${sessionNumber} journal recap:`,
      journalRecap,
      "",
      `Session ${sessionNumber} transcript (${relevantMessages.length} messages):`,
      transcriptText,
      "",
      "Current story arc:",
      currentProgression.storyArc ?? "",
      "",
      "Current plot twists:",
      JSON.stringify(currentProgression.plotTwists, null, 2),
      "",
      "Current party arcs:",
      JSON.stringify(currentProgression.partyArcs, null, 2),
    ];
    if (latestState) {
      userLines.push("", "Latest state from the selected session:", JSON.stringify(latestState, null, 2));
    }
    userLines.push(
      "",
      "Update only the campaign progression fields based on this completed session. Return full updated values.",
    );

    const progressionMessages: ChatMessage[] = [
      { role: "system", content: buildCampaignProgressionPrompt(setupConfig?.language ?? null) },
      { role: "user", content: userLines.join("\n") },
    ];
    const fit = fitMessagesToContext(progressionMessages, {
      maxContext: conn.maxContext,
      maxTokens: progressionOptions.maxTokens,
    });
    if (fit.trimmed) {
      console.log(
        "[game/session/update-campaign-progression] Context trimmed while updating session %s for chat %s",
        sessionNumber,
        chatId,
      );
    }

    const result = await provider.chatComplete(fit.trimmed ? fit.messages : progressionMessages, progressionOptions);
    const rawProgressionContent = result.content ?? "";
    const extraction = extractLeadingThinkingBlocks(rawProgressionContent);
    console.log(
      "[game/session/update-campaign-progression] Response length=%d chars, extracted=%d chars, maxTokens=%d",
      rawProgressionContent.length,
      extraction.content.length,
      progressionOptions.maxTokens ?? 0,
    );
    let updatedProgression: CampaignProgressionState;
    try {
      const parsedProgression = parseJSON(extraction.content) as Record<string, unknown>;
      updatedProgression = applyCampaignProgressionPayload(parsedProgression, currentProgression);
    } catch (err) {
      console.warn("[game/session/update-campaign-progression] Campaign progression parsing failed:", err);
      console.warn("[game/session/update-campaign-progression] Invalid JSON tail: %s", extraction.content.slice(-800));
      throw new Error("The campaign progression update was not valid JSON. Please try again.");
    }

    await chats.updateMetadata(currentChat.id, {
      ...currentMeta,
      gameStoryArc: updatedProgression.storyArc,
      gamePlotTwists: updatedProgression.plotTwists,
      gamePartyArcs: updatedProgression.partyArcs,
    });

    if (targetSession.id !== currentChat.id) {
      await chats.updateMetadata(targetSession.id, {
        ...targetMeta,
        gameStoryArc: updatedProgression.storyArc,
        gamePlotTwists: updatedProgression.plotTwists,
        gamePartyArcs: updatedProgression.partyArcs,
      });
    }

    const sessionChat = await chats.getById(currentChat.id);
    if (!sessionChat) throw new Error("Failed to reload game session");

    return {
      sessionChat,
      gameId,
      campaignProgression: updatedProgression,
    };
  });

  // ── POST /game/party/recruit ──
  // Adds a library character or tracked NPC to the active game party.
  app.post("/party/recruit", async (req) => {
    const input = recruitPartyMemberSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chars = createCharactersStorage(app.db);
    const connections = createConnectionsStorage(app.db);
    const stateStore = createGameStateStorage(app.db);

    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");
    if ((chat.mode as string) !== "game") throw new Error("Party recruitment is only available in game mode");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    if (!setupConfig) throw new Error("No game setup config found");

    const requestedName = input.characterName.trim();
    const requestedLookup = normalizeCharacterLookupName(requestedName);
    const allCharacters = await chars.list();
    const parsedCharacters = allCharacters.flatMap((row) => {
      try {
        const data = (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as Record<string, any>;
        const name = typeof data.name === "string" ? data.name.trim() : "";
        if (!name) return [];
        return [{ row, data, name, lookup: normalizeCharacterLookupName(name) }];
      } catch {
        return [];
      }
    });

    let matches = parsedCharacters.filter((candidate) => candidate.name.toLowerCase() === requestedName.toLowerCase());
    if (matches.length === 0) {
      matches = parsedCharacters.filter((candidate) => candidate.lookup === requestedLookup);
    }
    if (matches.length === 0 && requestedLookup.length >= 3) {
      matches = parsedCharacters.filter(
        (candidate) =>
          candidate.lookup.includes(requestedLookup) ||
          (candidate.lookup.length >= 3 && requestedLookup.includes(candidate.lookup)),
      );
    }
    if (matches.length > 1) {
      throw new Error(`Character "${requestedName}" is ambiguous. Use the exact character name.`);
    }

    const gameNpcs = (meta.gameNpcs as GameNpc[]) ?? [];
    const npcRecruit = matches.length === 0 ? findGameNpcByName(gameNpcs, requestedName) : null;
    if (matches.length === 0 && !npcRecruit) {
      throw new Error(`Character or tracked NPC "${requestedName}" was not found`);
    }

    const recruit = matches[0] ?? null;
    const characterById = new Map(parsedCharacters.map((candidate) => [candidate.row.id, candidate.name] as const));
    let chatCharacterIds: string[] = [];
    try {
      chatCharacterIds =
        typeof chat.characterIds === "string"
          ? ((JSON.parse(chat.characterIds) as string[]) ?? [])
          : ((chat.characterIds as string[]) ?? []);
    } catch {
      chatCharacterIds = [];
    }

    const currentPartyIds = getStoredPartyCharacterIds(meta, setupConfig, chatCharacterIds);
    const currentCards = (meta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];
    const recruitId = recruit ? recruit.row.id : buildPartyNpcId(npcRecruit!.name);
    const recruitName = recruit ? recruit.name : npcRecruit!.name;
    const existingCardIndex = findExistingGameCharacterCardIndex(currentCards, recruitName);
    const alreadyInParty = currentPartyIds.includes(recruitId);
    if (alreadyInParty && existingCardIndex >= 0) {
      return {
        sessionChat: chat,
        added: false,
        characterName: recruitName,
        cardCreated: false,
      };
    }

    const fallbackCard = recruit
      ? buildFallbackGameCharacterCard(recruit.data, recruit.name)
      : buildNpcPartyCard(npcRecruit!);
    const recruitRpgStats = recruit ? extractRecruitCharacterRpgStats(recruit.data) : undefined;
    const recruitSourceCard = recruit
      ? buildRecruitCharacterSourceCard(recruit.data)
      : buildNpcRecruitCharacterSourceCard(npcRecruit!);
    let nextCard: Record<string, unknown> = {
      ...fallbackCard,
      ...(recruitRpgStats ? { rpgStats: recruitRpgStats } : {}),
    };

    if (existingCardIndex >= 0) {
      nextCard = currentCards[existingCardIndex]!;
    }

    if (existingCardIndex < 0) {
      try {
        const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
          connections,
          input.connectionId,
          chat.connectionId,
        );
        const provider = createLLMProvider(
          conn.provider,
          baseUrl,
          conn.apiKey!,
          conn.maxContext,
          conn.openrouterProvider,
        );
        const generationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);
        const latestState = await stateStore.getLatest(input.chatId);
        const recentMessages = await chats.listMessages(input.chatId);
        const recentTranscript = recentMessages
          .filter((message) => message.role !== "system")
          .slice(-12)
          .map((message) => {
            const cleaned = stripGmCommandTags(message.content ?? "");
            return cleaned ? `[${message.role}] ${cleaned}` : null;
          })
          .filter((entry): entry is string => Boolean(entry))
          .join("\n\n");
        const currentState = latestState
          ? JSON.stringify(
              {
                date: latestState.date,
                time: latestState.time,
                location: latestState.location,
                weather: latestState.weather,
                presentCharacters: latestState.presentCharacters
                  ? typeof latestState.presentCharacters === "string"
                    ? JSON.parse(latestState.presentCharacters)
                    : latestState.presentCharacters
                  : [],
              },
              null,
              2,
            )
          : null;
        const currentPartyNames = currentPartyIds
          .map((id) => {
            const characterName = characterById.get(id);
            if (characterName) return characterName;
            if (!isPartyNpcId(id)) return null;
            const npc = gameNpcs.find((candidate) => buildPartyNpcId(candidate.name) === id);
            if (npc?.name) return npc.name;
            const card = currentCards.find((candidate) => {
              const cardName = typeof candidate.name === "string" ? candidate.name.trim() : "";
              return cardName && buildPartyNpcId(cardName) === id;
            });
            return typeof card?.name === "string" ? card.name.trim() : null;
          })
          .filter((name): name is string => Boolean(name));
        const prompt = buildPartyRecruitCardPrompt({
          targetCharacterName: recruitName,
          targetCharacterCard: recruitSourceCard,
          currentPartyNames,
          currentPartyCards: currentCards.length > 0 ? JSON.stringify(currentCards, null, 2) : null,
          worldOverview: (meta.gameWorldOverview as string) || null,
          storyArc: (meta.gameStoryArc as string) || null,
          plotTwists: (meta.gamePlotTwists as string[]) || null,
          currentState,
          recentTranscript,
          language: setupConfig.language ?? null,
        });

        const result = await provider.chatComplete(
          [
            { role: "system", content: prompt },
            { role: "user", content: `Create the recruited companion card for ${recruitName} now.` },
          ],
          gameGenOptions(conn.model, { temperature: 0.6, maxTokens: 1200 }, generationParameters),
        );
        const recruitExtraction = extractLeadingThinkingBlocks(result.content ?? "");
        const cardContent = recruitExtraction.content;
        if (recruitExtraction.thinking) {
          logger.debug(
            "[game/party/recruit] Thinking tokens (%d chars):\n%s",
            recruitExtraction.thinking.length,
            recruitExtraction.thinking,
          );
        }
        const parsed = parseJSON(cardContent);
        const rawCard =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object"
              ? (parsed[0] as Record<string, unknown>)
              : null;
        if (rawCard) {
          nextCard = {
            ...normalizeGeneratedGameCharacterCard(rawCard, recruitName),
            ...(recruitRpgStats ? { rpgStats: recruitRpgStats } : {}),
          };
        }
      } catch (error) {
        logger.warn(error, "[game/party/recruit] Failed to generate recruit card, using fallback");
      }
    }

    const updatedPartyIds = alreadyInParty ? currentPartyIds : [...currentPartyIds, recruitId];
    const updatedCards = [...currentCards];
    if (existingCardIndex >= 0) {
      updatedCards[existingCardIndex] = nextCard;
    } else {
      updatedCards.push(nextCard);
    }

    const updatedSetupConfig: GameSetupConfig = {
      ...setupConfig,
      partyCharacterIds: updatedPartyIds,
    };

    const updatedChatCharacterIds = updatedPartyIds.filter((id) => !isPartyNpcId(id));
    await chats.update(chat.id, { characterIds: updatedChatCharacterIds });
    const updatedSession = await chats.updateMetadata(chat.id, {
      ...meta,
      gameSetupConfig: updatedSetupConfig,
      gamePartyCharacterIds: updatedPartyIds,
      gameCharacterCards: updatedCards,
    });
    if (!updatedSession) throw new Error("Failed to update game session");

    return {
      sessionChat: updatedSession,
      added: !alreadyInParty,
      characterName: recruitName,
      cardCreated: existingCardIndex < 0,
    };
  });

  // ── POST /game/party/remove ──
  // Removes a character from this game party only. Library characters are never deleted or mutated here.
  app.post("/party/remove", async (req) => {
    const input = removePartyMemberSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chars = createCharactersStorage(app.db);

    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");
    if ((chat.mode as string) !== "game") throw new Error("Party removal is only available in game mode");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    if (!setupConfig) throw new Error("No game setup config found");

    let chatCharacterIds: string[] = [];
    try {
      chatCharacterIds =
        typeof chat.characterIds === "string"
          ? ((JSON.parse(chat.characterIds) as string[]) ?? [])
          : ((chat.characterIds as string[]) ?? []);
    } catch {
      chatCharacterIds = [];
    }

    const currentPartyIds = getStoredPartyCharacterIds(meta, setupConfig, chatCharacterIds);
    if (currentPartyIds.length === 0) {
      throw new Error("There are no party members to remove");
    }

    const allCharacters = await chars.list();
    const charactersById = new Map(
      allCharacters.flatMap((row) => {
        try {
          const data = (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as Record<string, any>;
          const name = typeof data.name === "string" ? data.name.trim() : "";
          return name ? [[row.id, { row, name, lookup: normalizeCharacterLookupName(name) }] as const] : [];
        } catch {
          return [];
        }
      }),
    );

    const requestedName = input.characterName.trim();
    const requestedLookup = normalizeCharacterLookupName(requestedName);
    const gameNpcs = (meta.gameNpcs as GameNpc[]) ?? [];
    const currentCards = (meta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];
    const currentParty = currentPartyIds.flatMap((id) => {
      const character = charactersById.get(id);
      return character ? [{ id, ...character }] : [];
    });
    for (const id of currentPartyIds) {
      if (!isPartyNpcId(id)) continue;
      const npc = gameNpcs.find((candidate) => buildPartyNpcId(candidate.name) === id);
      const card = currentCards.find((candidate) => {
        const cardName = typeof candidate.name === "string" ? candidate.name.trim() : "";
        return cardName && buildPartyNpcId(cardName) === id;
      });
      const name = npc?.name ?? (typeof card?.name === "string" ? card.name.trim() : "");
      if (!name) continue;
      currentParty.push({ id, row: null as never, name, lookup: normalizeCharacterLookupName(name) });
    }

    let matches = currentParty.filter((candidate) => candidate.name.toLowerCase() === requestedName.toLowerCase());
    if (matches.length === 0) {
      matches = currentParty.filter((candidate) => candidate.lookup === requestedLookup);
    }
    if (matches.length === 0 && requestedLookup.length >= 3) {
      matches = currentParty.filter(
        (candidate) =>
          candidate.lookup.includes(requestedLookup) ||
          (candidate.lookup.length >= 3 && requestedLookup.includes(candidate.lookup)),
      );
    }
    if (matches.length === 0) {
      throw new Error(`Character "${requestedName}" is not currently in the party`);
    }
    if (matches.length > 1) {
      throw new Error(`Character "${requestedName}" is ambiguous. Use the exact character name.`);
    }

    const removed = matches[0]!;
    const updatedPartyIds = currentPartyIds.filter((id) => id !== removed.id);
    const updatedSetupConfig: GameSetupConfig = {
      ...setupConfig,
      partyCharacterIds: updatedPartyIds,
    };
    const updatedChatCharacterIds = updatedPartyIds.filter((id) => !isPartyNpcId(id));
    await chats.update(chat.id, { characterIds: updatedChatCharacterIds });
    const updatedSession = await chats.updateMetadata(chat.id, {
      ...meta,
      gameSetupConfig: updatedSetupConfig,
      gamePartyCharacterIds: updatedPartyIds,
      gameCharacterCards: currentCards,
    });
    if (!updatedSession) throw new Error("Failed to update game session");

    return {
      sessionChat: updatedSession,
      removed: true,
      characterName: removed.name,
    };
  });

  // ── POST /game/dice/roll ──
  app.post("/dice/roll", async (req) => {
    const { notation } = diceRollSchema.parse(req.body);
    const result = rollDice(notation);
    return { result };
  });

  // ── POST /game/skill-check ──
  // Resolve a d20 skill check using player stats.
  const skillCheckSchema = z.object({
    chatId: z.string().min(1),
    skill: z.string().min(1).max(100),
    dc: z.number().int().min(1).max(40),
    advantage: z.boolean().optional(),
    disadvantage: z.boolean().optional(),
  });

  app.post("/skill-check", async (req) => {
    const input = skillCheckSchema.parse(req.body);
    const stateStore = createGameStateStorage(app.db);

    const snapshot = await stateStore.getLatest(input.chatId);
    const playerStats = snapshot?.playerStats ? JSON.parse(snapshot.playerStats as string) : null;

    // Look up skill modifier
    const skillMod = playerStats?.skills?.[input.skill] ?? playerStats?.skills?.[input.skill.toLowerCase()] ?? 0;

    // Look up governing attribute modifier
    let attrMod = 0;
    if (playerStats?.attributes) {
      const attr = getGoverningAttribute(input.skill);
      const score = playerStats.attributes[attr] ?? 10;
      attrMod = attributeModifier(score);
    }

    const result = resolveSkillCheck({
      skill: input.skill,
      dc: input.dc,
      skillModifier: skillMod,
      attributeModifier: attrMod,
      advantage: input.advantage,
      disadvantage: input.disadvantage,
    });

    return { result };
  });

  // ── POST /game/morale ──
  // Apply a morale event and return updated state.
  const moraleSchema = z.object({
    chatId: z.string().min(1),
    event: z.string().min(1).max(50),
  });

  app.post("/morale", async (req) => {
    const input = moraleSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const currentMorale = (meta.gameMorale as number) ?? 50;
    const result = applyMoraleEvent(currentMorale, input.event as MoraleEvent);

    await chats.updateMetadata(input.chatId, { ...meta, ...buildMoraleMetadataUpdates(meta, result.value) });

    return { morale: result };
  });

  // ── POST /game/state/transition ──
  app.post("/state/transition", async (req) => {
    const { chatId, newState } = stateTransitionSchema.parse(req.body);
    const chats = createChatsStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const currentState = (meta.gameActiveState as GameActiveState) || "exploration";
    const validatedState = validateTransition(currentState, newState);

    await chats.updateMetadata(chatId, { ...meta, gameActiveState: validatedState });

    // Push OOC influence for combat transitions (exciting events)
    if (validatedState === "combat" && chat.connectedChatId) {
      await chats.createInfluence(
        chatId,
        chat.connectedChatId as string,
        `The game just entered combat! The party is now in a fight.`,
      );
    }

    // Auto-checkpoint on combat transitions
    const enteringCombat = validatedState === "combat";
    const leavingCombat = currentState === "combat" && validatedState !== "combat";
    if (enteringCombat || leavingCombat) {
      try {
        const stateStore = createGameStateStorage(app.db);
        const snap = await stateStore.getLatest(chatId);
        if (snap) {
          const cpSvc = createCheckpointService(app.db);
          await cpSvc.create({
            chatId,
            snapshotId: snap.id,
            messageId: snap.messageId,
            label: validatedState === "combat" ? "Combat Started" : "Combat Ended",
            triggerType: validatedState === "combat" ? "combat_start" : "combat_end",
            location: snap.location,
            gameState: validatedState,
            weather: snap.weather,
            timeOfDay: snap.time,
          });
        }
      } catch {
        /* non-fatal */
      }
    }

    return { previousState: currentState, newState: validatedState };
  });

  // ── POST /game/map/generate ──
  app.post("/map/generate", async (req) => {
    const { chatId, locationType, context, connectionId } = mapGenerateSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const { conn, baseUrl } = await resolveConnection(connections, connectionId, chat.connectionId);
    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );

    const messages: ChatMessage[] = [
      { role: "system", content: buildMapGenerationPrompt(locationType, context) },
      { role: "user", content: "Generate the map." },
    ];

    const result = await provider.chatComplete(
      messages,
      gameGenOptions(conn.model, {
        temperature: 0.6,
      }),
    );
    const mapExtraction = extractLeadingThinkingBlocks(result.content ?? "");
    const mapContent = mapExtraction.content;
    if (mapExtraction.thinking) {
      logger.debug(
        "[game/map/generate] Thinking tokens (%d chars):\n%s",
        mapExtraction.thinking.length,
        mapExtraction.thinking,
      );
    }

    let map: GameMap;
    try {
      map = parseJSON(mapContent) as GameMap;
    } catch {
      throw new Error("Failed to parse map from AI response");
    }

    const meta = parseMeta(chat.metadata);
    const existingMaps = getGameMapsFromMeta(meta);
    const mapWithId = ensureGameMapId(map, existingMaps);
    const mapMeta = withActiveGameMapMeta({ ...meta, gameMaps: existingMaps }, mapWithId);
    const hydratedMeta = await buildHydratedGameMeta(chatId, mapMeta);
    await chats.updateMetadata(chatId, hydratedMeta);

    return {
      map: (hydratedMeta.gameMap as GameMap) ?? mapWithId,
      maps: getGameMapsFromMeta(hydratedMeta),
      activeGameMapId: (hydratedMeta.activeGameMapId as string | null) ?? getGameMapId(hydratedMeta.gameMap as GameMap),
    };
  });

  // ── POST /game/map/move ──
  app.post("/map/move", async (req) => {
    const { chatId, position, mapId } = mapMoveSchema.parse(req.body);
    const chats = createChatsStorage(app.db);

    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const maps = getGameMapsFromMeta(meta);
    const targetMapId = mapId ?? (meta.activeGameMapId as string | null) ?? getGameMapId(meta.gameMap as GameMap);
    const map =
      maps.find((entry, index) => getGameMapId(entry, index) === targetMapId) ?? (meta.gameMap as GameMap | null);
    if (!map) throw new Error("No map exists for this game");

    const updatedMap = { ...map, partyPosition: position };

    if (map.type === "grid" && typeof position === "object" && "x" in position) {
      const cells = [...(map.cells || [])];
      const cellIdx = cells.findIndex((c) => c.x === position.x && c.y === position.y);
      if (cellIdx !== -1) {
        cells[cellIdx] = { ...cells[cellIdx]!, discovered: true };
        updatedMap.cells = cells;
      }
    } else if (map.type === "node" && typeof position === "string") {
      const nodes = [...(map.nodes || [])];
      const nodeIdx = nodes.findIndex((n) => n.id === position);
      if (nodeIdx !== -1) {
        nodes[nodeIdx] = { ...nodes[nodeIdx]!, discovered: true };
        updatedMap.nodes = nodes;
      }
    }

    const nextMeta = markNpcsMetAtCurrentLocation(withActiveGameMapMeta(meta, updatedMap));
    const hydratedMeta = await buildHydratedGameMeta(chatId, nextMeta);
    await chats.updateMetadata(chatId, hydratedMeta);

    return {
      map: (hydratedMeta.gameMap as GameMap) ?? updatedMap,
      maps: getGameMapsFromMeta(hydratedMeta),
      activeGameMapId: (hydratedMeta.activeGameMapId as string | null) ?? getGameMapId(hydratedMeta.gameMap as GameMap),
    };
  });

  // ── GET /game/:gameId/sessions ──
  app.get<{ Params: { gameId: string } }>("/:gameId/sessions", async (req) => {
    const chats = createChatsStorage(app.db);
    const sessions = await chats.listByGroup(req.params.gameId);
    return sessions
      .filter((c) => (c.mode as string) === "game")
      .sort((a, b) => {
        const ma = parseMeta(a.metadata);
        const mb = parseMeta(b.metadata);
        return ((ma.gameSessionNumber as number) || 0) - ((mb.gameSessionNumber as number) || 0);
      });
  });

  // ── POST /game/combat/round ──
  app.post("/combat/round", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      combatants: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          hp: z.number(),
          maxHp: z.number(),
          mp: z.number().optional(),
          maxMp: z.number().optional(),
          attack: z.number(),
          defense: z.number(),
          speed: z.number(),
          level: z.number(),
          side: z.enum(["player", "enemy"]).optional(),
          skills: z
            .array(
              z.object({
                id: z.string(),
                name: z.string(),
                type: z.enum(["attack", "heal", "buff", "debuff"]),
                mpCost: z.number(),
                power: z.number(),
                description: z.string().optional(),
                cooldown: z.number().optional(),
                element: z.string().optional(),
                statusEffect: z.string().optional(),
              }),
            )
            .optional(),
          statusEffects: z
            .array(
              z.object({
                name: z.string(),
                modifier: z.number(),
                stat: z.enum(["attack", "defense", "speed", "hp"]),
                turnsLeft: z.number(),
              }),
            )
            .optional(),
          element: z.string().optional(),
          elementAura: z
            .object({
              element: z.string(),
              gauge: z.number(),
              sourceId: z.string(),
            })
            .nullable()
            .optional(),
        }),
      ),
      round: z.number().int().min(1),
      playerAction: z
        .object({
          type: z.enum(["attack", "skill", "defend", "item", "flee"]),
          targetId: z.string().optional(),
          skillId: z.string().optional(),
          itemId: z.string().optional(),
          itemEffect: z
            .object({
              name: z.string(),
              target: z.enum(["self", "ally", "enemy", "any"]),
              type: z.enum(["heal", "damage", "buff", "debuff", "status", "utility"]),
              description: z.string(),
              power: z.number().optional(),
              element: z.string().optional(),
              status: z
                .object({
                  name: z.string(),
                  emoji: z.string(),
                  duration: z.number(),
                  modifier: z.number().optional(),
                  stat: z.enum(["attack", "defense", "speed", "hp"]).optional(),
                })
                .optional(),
              consumes: z.boolean().optional(),
            })
            .optional(),
        })
        .optional(),
      mechanics: z
        .array(
          z.object({
            name: z.string(),
            description: z.string(),
            ownerName: z.string().optional(),
            trigger: z.enum(["round_interval", "hp_threshold", "on_hit", "on_attack", "passive"]),
            interval: z.number().optional(),
            hpThreshold: z.number().optional(),
            counterplay: z.string().optional(),
            effectType: z
              .enum(["damage_all", "damage_one", "buff_self", "debuff_party", "status_party", "status_enemy"])
              .optional(),
            power: z.number().optional(),
            element: z.string().optional(),
            status: z
              .object({
                name: z.string(),
                emoji: z.string(),
                duration: z.number(),
                modifier: z.number().optional(),
                stat: z.enum(["attack", "defense", "speed", "hp"]).optional(),
              })
              .optional(),
          }),
        )
        .optional(),
    });
    const { chatId, combatants, round, playerAction, mechanics } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const difficulty = ((meta.gameSetupConfig as Record<string, unknown>)?.difficulty as string) ?? "normal";
    const elementPreset = ((meta.gameSetupConfig as Record<string, unknown>)?.elementPreset as string) ?? "default";
    const result = resolveCombatRound(
      combatants as (CombatantStats & { side?: "player" | "enemy" })[],
      round,
      difficulty,
      elementPreset,
      playerAction,
      mechanics,
    );

    return { result, combatants };
  });

  // ── GET /game/elements/presets ──
  app.get("/elements/presets", async () => {
    const names = listElementPresets();
    const presets = names.map((name) => {
      const p = getElementPreset(name);
      return { id: name, name: p.name, elements: p.elements };
    });
    return { presets };
  });

  // ── GET /game/elements/preset/:name ──
  app.get("/elements/preset/:name", async (req) => {
    const { name } = req.params as { name: string };
    const preset = getElementPreset(name);
    return {
      id: name,
      name: preset.name,
      elements: preset.elements,
      reactionCount: preset.reactions.length,
      reactions: preset.reactions.map((r) => ({
        trigger: r.trigger,
        appliedWith: r.appliedWith,
        reaction: r.reaction,
        damageMultiplier: r.damageMultiplier,
        description: r.description,
      })),
    };
  });

  // ── POST /game/combat/loot ──
  app.post("/combat/loot", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      enemyCount: z.number().int().min(1).max(20),
    });
    const { chatId, enemyCount } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const difficulty = ((meta.gameSetupConfig as Record<string, unknown>)?.difficulty as string) ?? "normal";
    const drops = generateCombatLoot(enemyCount, difficulty);
    return { drops };
  });

  // ── POST /game/loot/generate ──
  app.post("/loot/generate", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      count: z.number().int().min(1).max(20).default(3),
    });
    const { chatId, count } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const difficulty = ((meta.gameSetupConfig as Record<string, unknown>)?.difficulty as string) ?? "normal";
    const drops = generateLootTable(count, difficulty);
    return { drops };
  });

  // ── POST /game/time/advance ──
  app.post("/time/advance", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      action: z.string().min(1).max(50),
    });
    const { chatId, action } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const currentTime = (meta.gameTime as GameTime) ?? createInitialTime();

    // Scene analyzer sends a time-of-day label (dawn, morning, etc.) — set directly
    const TOD_HOURS: Record<string, number> = {
      dawn: 6,
      morning: 8,
      noon: 12,
      afternoon: 14,
      evening: 18,
      night: 21,
      midnight: 0,
    };
    let newTime: GameTime;
    if (TOD_HOURS[action] != null) {
      newTime = { ...currentTime, hour: TOD_HOURS[action]!, minute: 0 };
      // If the target hour is behind current, advance to next day
      if (newTime.hour <= currentTime.hour) {
        newTime.day = currentTime.day + 1;
      }
    } else {
      newTime = advanceTime(currentTime, action);
    }

    await chats.updateMetadata(chatId, { ...meta, gameTime: newTime });

    // Also update the game state snapshot so WeatherEffects picks it up
    const gameStateStore = createGameStateStorage(app.db);
    await gameStateStore.updateLatest(chatId, {
      time: formatGameTime(newTime),
    });

    return { time: newTime, formatted: formatGameTime(newTime) };
  });

  // ── POST /game/weather/update ──
  app.post("/weather/update", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      action: z.string().min(1).max(50),
      location: z.string().max(500).default(""),
      season: z.enum(["spring", "summer", "autumn", "winter"]).default("summer"),
      type: z.string().max(100).optional(),
    });
    const { chatId, action, location, season, type } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);

    // "set" action from scene analyzer — apply the exact weather type
    if (action === "set" && type) {
      const biome = inferBiome(location);
      const weather = generateWeather(biome, season);
      // Override the randomly generated type with the scene analyzer's value
      weather.type = type as any;
      weather.description = `The weather is ${type}.`;

      await chats.updateMetadata(chatId, { ...meta, gameWeather: weather });
      const gameStateStore = createGameStateStorage(app.db);
      await gameStateStore.updateLatest(chatId, {
        weather: weather.type,
        temperature: `${weather.temperature}°C`,
      });
      return { changed: true, weather };
    }

    if (!shouldWeatherChange(action)) {
      return { changed: false, weather: meta.gameWeather ?? null };
    }

    const biome = inferBiome(location);
    const weather = generateWeather(biome, season);

    await chats.updateMetadata(chatId, { ...meta, gameWeather: weather });

    // Also update the game state snapshot so WeatherEffects picks it up
    const gameStateStore = createGameStateStorage(app.db);
    await gameStateStore.updateLatest(chatId, {
      weather: weather.type,
      temperature: `${weather.temperature}°C`,
    });

    return { changed: true, weather };
  });

  // ── POST /game/encounter/roll ──
  app.post("/encounter/roll", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      action: z.string().min(1).max(50),
      location: z.string().max(500).default(""),
    });
    const { chatId, action, location } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const difficulty = ((meta.gameSetupConfig as Record<string, unknown>)?.difficulty as string) ?? "normal";
    const encounter = rollEncounter(action, difficulty, location);

    let enemyCount = 0;
    if (encounter.triggered && encounter.type === "combat") {
      const partySize = ((meta.gamePartyCharacterIds as string[]) ?? []).length + 1; // +1 for player
      enemyCount = rollEnemyCount(partySize, difficulty);
    }

    return { encounter, enemyCount };
  });

  // ── POST /game/reputation/update ──
  app.post("/reputation/update", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      actions: z.array(
        z.object({
          npcId: z.string(),
          action: z.string().min(1).max(50),
          modifier: z.number().optional(),
        }),
      ),
    });
    const { chatId, actions } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const currentNpcs = (meta.gameNpcs as GameNpc[]) ?? [];
    const { npcs: updatedNpcs, changes, milestones } = processReputationActions(currentNpcs, actions);

    const hydratedMeta = await buildHydratedGameMeta(chatId, { ...meta, gameNpcs: updatedNpcs });
    await chats.updateMetadata(chatId, hydratedMeta);

    return { npcs: (hydratedMeta.gameNpcs as GameNpc[]) ?? updatedNpcs, changes, milestones };
  });

  // ── POST /game/journal/entry ──
  app.post("/journal/entry", async (req) => {
    const schema = z.object({
      chatId: z.string().min(1),
      type: z.enum(["location", "npc", "combat", "quest", "item", "event", "note"]),
      data: z.record(z.unknown()),
    });
    const { chatId, type, data } = schema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    let journal = (meta.gameJournal as Journal) ?? createJournal();

    switch (type) {
      case "location":
        journal = addLocationEntry(journal, data.location as string, data.description as string);
        break;
      case "npc":
        journal = addNpcEntry(journal, data.npc as GameNpc, data.interaction as string);
        break;
      case "combat":
        journal = addCombatEntry(journal, data.description as string, data.outcome as "victory" | "defeat" | "fled");
        break;
      case "quest":
        journal = upsertQuest(journal, data.quest as Parameters<typeof upsertQuest>[1]);
        break;
      case "item":
        journal = addInventoryEntry(
          journal,
          data.item as string,
          data.action as "acquired" | "used" | "lost",
          data.quantity as number,
        );
        break;
      case "event":
        journal = addEventEntry(journal, data.title as string, data.content as string);
        break;
      case "note":
        journal = addNoteEntry(journal, data.title as string, data.content as string, {
          readableType: data.readableType === "book" || data.readableType === "note" ? data.readableType : undefined,
          sourceMessageId: typeof data.sourceMessageId === "string" ? data.sourceMessageId : undefined,
          sourceSegmentIndex: typeof data.sourceSegmentIndex === "number" ? data.sourceSegmentIndex : undefined,
        });
        break;
    }

    await chats.updateMetadata(chatId, { ...meta, gameJournal: journal });

    return { journal };
  });

  // ── GET /game/:chatId/journal ──
  app.get<{ Params: { chatId: string } }>("/:chatId/journal", async (req) => {
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(req.params.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const hydratedMeta = await buildHydratedGameMeta(req.params.chatId, meta);
    const originalJournal = (meta.gameJournal as Journal) ?? createJournal();
    const journal = (hydratedMeta.gameJournal as Journal) ?? createJournal();
    if (JSON.stringify(journal) !== JSON.stringify(originalJournal)) {
      await chats.updateMetadata(req.params.chatId, hydratedMeta);
    }
    const sessionNumber = (meta.gameSessionNumber as number) ?? 1;
    const playerNotes = (meta.gamePlayerNotes as string) ?? "";

    return { journal, recap: buildStructuredRecap(journal, sessionNumber), playerNotes };
  });

  // ── PUT /game/:chatId/notes ──
  app.put<{ Params: { chatId: string } }>("/:chatId/notes", async (req) => {
    const { notes } = z.object({ notes: z.string().max(10000) }).parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(req.params.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    await chats.updateMetadata(req.params.chatId, { ...meta, gamePlayerNotes: notes });

    return { ok: true };
  });

  // ── PUT /game/:chatId/widgets ──
  app.put<{ Params: { chatId: string } }>("/:chatId/widgets", async (req) => {
    const { widgets } = z.object({ widgets: z.array(z.record(z.unknown())) }).parse(req.body);
    const chats = createChatsStorage(app.db);
    const chat = await chats.getById(req.params.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    await chats.updateMetadata(req.params.chatId, { ...meta, gameWidgetState: widgets });

    return { ok: true };
  });

  // ── POST /game/party-turn ──
  // Generates the party's response to the latest GM narration.
  // Uses the character connection (or falls back to GM connection).
  // Returns parsed PartyDialogueLine[] and the raw response text.
  const partyTurnSchema = z.object({
    chatId: z.string().min(1),
    /** The GM narration the party is reacting to. */
    narration: z.string().min(1).max(50000),
    /** Optional player action text that preceded the GM narration. */
    playerAction: z.string().max(5000).optional(),
    /** Override connection (falls back to character connection → GM connection). */
    connectionId: z.string().optional(),
    debugMode: z.boolean().optional().default(false),
  });

  app.post("/party-turn", async (req) => {
    const input = partyTurnSchema.parse(req.body);
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);
    const chars = createCharactersStorage(app.db);

    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const setupConfig = meta.gameSetupConfig as GameSetupConfig | null;
    if (!setupConfig) throw new Error("No game setup config found");

    const gameActiveState = (meta.gameActiveState as string) || "exploration";
    let chatCharacterIds: string[] = [];
    try {
      chatCharacterIds =
        typeof chat.characterIds === "string"
          ? ((JSON.parse(chat.characterIds) as string[]) ?? [])
          : ((chat.characterIds as string[]) ?? []);
    } catch {
      chatCharacterIds = [];
    }
    const partyCharIds = getStoredPartyCharacterIds(meta, setupConfig, chatCharacterIds);

    // Resolve connection: explicit override → GM connection
    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      input.connectionId,
      chat.connectionId,
    );
    const gameGenerationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);

    // Build party character cards
    const partyCards: Array<{ name: string; card: string }> = [];
    const partyIdNamePairs: Array<{ id: string; name: string }> = [];
    const gameNpcs = (meta.gameNpcs as GameNpc[]) ?? [];
    const gameCharCards = (meta.gameCharacterCards as Array<Record<string, unknown>>) ?? [];
    const gameCardByName = new Map<string, Record<string, unknown>>();
    for (const gc of gameCharCards) {
      if (typeof gc.name === "string" && gc.name.trim()) {
        gameCardByName.set(gc.name.toLowerCase(), gc);
      }
    }
    for (const charId of partyCharIds) {
      try {
        const charRow = await chars.getById(charId);
        if (!charRow) continue;
        const charData = typeof charRow.data === "string" ? JSON.parse(charRow.data) : charRow.data;
        const card = [
          `Name: ${charData.name}`,
          charData.personality ? `Personality: ${charData.personality}` : null,
          charData.description ? `Description: ${charData.description}` : null,
          charData.extensions?.backstory || charData.backstory
            ? `Backstory: ${charData.extensions?.backstory || charData.backstory}`
            : null,
          charData.extensions?.appearance || charData.appearance
            ? `Appearance: ${charData.extensions?.appearance || charData.appearance}`
            : null,
        ];

        const gameCard = gameCardByName.get(String(charData.name || "").toLowerCase());
        if (gameCard) {
          if (typeof gameCard.class === "string" && gameCard.class.trim()) {
            card.push(`Class: ${gameCard.class}`);
          }
          if (Array.isArray(gameCard.abilities) && gameCard.abilities.length > 0) {
            card.push(`Abilities: ${gameCard.abilities.join(", ")}`);
          }
          if (Array.isArray(gameCard.strengths) && gameCard.strengths.length > 0) {
            card.push(`Strengths: ${gameCard.strengths.join(", ")}`);
          }
          if (Array.isArray(gameCard.weaknesses) && gameCard.weaknesses.length > 0) {
            card.push(`Weaknesses: ${gameCard.weaknesses.join(", ")}`);
          }
          const extra = gameCard.extra as Record<string, unknown> | undefined;
          if (extra) {
            for (const [key, value] of Object.entries(extra)) {
              if (value === null || value === undefined || value === "") continue;
              card.push(`${key}: ${String(value)}`);
            }
          }
        }

        const resolvedCard = card.filter(Boolean).join("\n");
        partyCards.push({ name: charData.name, card: resolvedCard });
        partyIdNamePairs.push({ id: charId, name: charData.name });
      } catch {
        /* skip unresolvable characters */
      }
    }

    for (const npcId of partyCharIds) {
      if (!isPartyNpcId(npcId)) continue;
      const npc = gameNpcs.find((candidate) => buildPartyNpcId(candidate.name) === npcId);
      if (!npc) continue;
      const card = [
        `Name: ${npc.name}`,
        "Source: Tracked NPC companion, not a character-library card",
        npc.description ? `Description: ${npc.description}` : null,
        npc.location ? `Last Known Location: ${npc.location}` : null,
        npc.notes?.length ? `Notes: ${npc.notes.join("; ")}` : null,
      ];

      const gameCard = gameCardByName.get(npc.name.toLowerCase());
      if (gameCard) {
        if (typeof gameCard.class === "string" && gameCard.class.trim()) {
          card.push(`Class: ${gameCard.class}`);
        }
        if (Array.isArray(gameCard.abilities) && gameCard.abilities.length > 0) {
          card.push(`Abilities: ${gameCard.abilities.join(", ")}`);
        }
        if (Array.isArray(gameCard.strengths) && gameCard.strengths.length > 0) {
          card.push(`Strengths: ${gameCard.strengths.join(", ")}`);
        }
        if (Array.isArray(gameCard.weaknesses) && gameCard.weaknesses.length > 0) {
          card.push(`Weaknesses: ${gameCard.weaknesses.join(", ")}`);
        }
        const extra = gameCard.extra as Record<string, unknown> | undefined;
        if (extra) {
          for (const [key, value] of Object.entries(extra)) {
            if (value === null || value === undefined || value === "") continue;
            card.push(`${key}: ${String(value)}`);
          }
        }
      }

      partyCards.push({ name: npc.name, card: card.filter(Boolean).join("\n") });
      partyIdNamePairs.push({ id: npcId, name: npc.name });
    }

    if (partyCards.length === 0) {
      return { raw: "" };
    }

    // Resolve player name
    let playerName = "Player";
    if (setupConfig.personaId) {
      try {
        const persona = await chars.getPersona(setupConfig.personaId);
        if (persona) {
          playerName = persona.name || "Player";
        }
      } catch {
        /* ignore */
      }
    }

    let systemPrompt = buildPartySystemPrompt({
      partyCards,
      playerName,
      gameActiveState,
      partyArcs: (meta.gamePartyArcs as PartyArc[]) || undefined,
      characterSprites: listPartySprites(partyIdNamePairs),
    });

    const gameExtraPrompt = ((meta.gameExtraPrompt as string) || "").replace(/<\/?special_instructions>/gi, "");
    if (gameExtraPrompt) {
      systemPrompt += `\n\n<special_instructions>\n${gameExtraPrompt}\n</special_instructions>`;
    }

    // Build user prompt with context
    const userPrompt = [
      `<gm_narration>`,
      input.narration,
      `</gm_narration>`,
      input.playerAction ? `\n<player_action>\n${input.playerAction}\n</player_action>` : "",
      `\nNow write the party's reactions using the [Name] [type] [expression]: format.`,
    ]
      .filter(Boolean)
      .join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );
    const result = await provider.chatComplete(
      messages,
      gameGenOptions(
        conn.model ?? "",
        {
          maxTokens: 8192,
        },
        gameGenerationParameters,
      ),
    );
    const partyTurnExtraction = extractLeadingThinkingBlocks(result.content || "");
    const raw = partyTurnExtraction.content;
    if (partyTurnExtraction.thinking) {
      logger.debug(
        "[game/party-turn] Thinking tokens (%d chars):\n%s",
        partyTurnExtraction.thinking.length,
        partyTurnExtraction.thinking,
      );
    }
    const debugLogsEnabled = input.debugMode || isDebugAgentsEnabled();
    if (debugLogsEnabled) {
      logger.debug("[party-turn/raw] chatId=%s model=%s chars=%d\n%s", input.chatId, conn.model ?? "", raw.length, raw);
    }

    // Extract and apply reputation tags from party response
    const repRegex = /\[reputation:\s*npc="([^"]+)"\s*action="([^"]+)"\]/gi;
    let repMatch: RegExpExecArray | null;
    const repActions: Array<{ npcId: string; action: string }> = [];
    while ((repMatch = repRegex.exec(raw)) !== null) {
      repActions.push({ npcId: repMatch[1]!.trim(), action: repMatch[2]!.trim() });
    }
    if (repActions.length > 0) {
      try {
        const currentNpcs = (meta.gameNpcs as GameNpc[]) ?? [];
        const { npcs: updatedNpcs } = processReputationActions(currentNpcs, repActions);
        // Re-read metadata to avoid clobbering concurrent scene asset updates
        const freshChat = await chats.getById(input.chatId);
        const freshMeta = freshChat ? parseMeta(freshChat.metadata) : meta;
        await chats.updateMetadata(input.chatId, { ...freshMeta, gameNpcs: updatedNpcs });
        logger.info(`[party-turn] Applied ${repActions.length} reputation change(s)`);
      } catch (err) {
        logger.warn(err, "[party-turn] Failed to apply reputation");
      }
    }

    // Strip reputation tags from the displayed content
    const cleanRaw = raw.replace(/\[reputation:\s*npc="[^"]+"\s*action="[^"]+"\]/gi, "").trim();

    // Save party response as a message in the game chat
    const partyMsg = await chats.createMessage({
      chatId: input.chatId,
      role: "assistant",
      characterId: null,
      content: `[party-turn]\n${cleanRaw}`,
    });
    if (partyMsg?.id && partyTurnExtraction.thinking) {
      await chats.updateMessageExtra(partyMsg.id, { thinking: partyTurnExtraction.thinking });
    }
    mirrorGameMessageToDiscord(meta, cleanRaw, "Party");

    return { raw: cleanRaw };
  });

  // ── POST /game/scene-wrap ──
  // Scene wrap-up using a regular LLM connection (fallback when sidecar isn't available).
  // Uses the same prompt as the sidecar scene analyzer but via API.
  const sceneWrapSchema = z.object({
    chatId: z.string().min(1),
    narration: z.string().min(1).max(50000),
    playerAction: z.string().max(5000).optional(),
    streaming: z.boolean().optional().default(true),
    context: z.object({
      currentState: z.string(),
      availableBackgrounds: z.array(z.string()).max(2000),
      availableSfx: z.array(z.string()).max(2000),
      activeWidgets: z.array(z.unknown()).max(100),
      trackedNpcs: z.array(z.unknown()).max(200),
      characterNames: z.array(z.string().max(200)).max(100),
      currentBackground: z.string().nullable(),
      currentMusic: z.string().nullable(),
      recentMusic: z.array(z.string().max(500)).max(20).optional().default([]),
      currentAmbient: z.string().nullable().optional().default(null),
      currentWeather: z.string().nullable(),
      currentTimeOfDay: z.string().nullable(),
      canGenerateBackgrounds: z.boolean().optional(),
      canGenerateIllustrations: z.boolean().optional(),
      artStylePrompt: z.string().nullable().optional(),
    }),
    /** Override connection (falls back to scene connection → GM connection). */
    connectionId: z.string().optional(),
    debugMode: z.boolean().optional().default(false),
  });

  app.post("/scene-wrap", async (req) => {
    const input = sceneWrapSchema.parse(req.body);
    const requestDebug = input.debugMode === true;
    const debugLogsEnabled = requestDebug || isDebugAgentsEnabled() || logger.isLevelEnabled("debug");
    const debugLog = (message: string, ...args: any[]) => {
      if (requestDebug) {
        console.log(message, ...args);
      } else {
        logger.debug(message, ...args);
      }
    };
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const sceneConnId = (meta.gameSceneConnectionId as string) || null;
    const { conn, baseUrl, defaultGenerationParameters } = await resolveConnection(
      connections,
      input.connectionId ?? sceneConnId,
      chat.connectionId,
    );
    const gameGenerationParameters = resolveStoredGameGenerationParameters(meta, defaultGenerationParameters);
    const enableGen = !!meta.enableSpriteGeneration;
    const imgConnId = (meta.gameImageConnectionId as string) || null;
    const setupCfgForScene = meta.gameSetupConfig as Record<string, unknown> | null;
    const artStyleForScene = (setupCfgForScene?.artStylePrompt as string) || "";

    // Compute approximate turn number: count user messages + 1 (current turn)
    const allMsgs = await chats.listMessages(input.chatId);
    const approxTurnNumber = Math.max(1, allMsgs.filter((m) => m.role === "user").length + 1);
    const sessionNumber = currentGameSessionNumber(meta);
    const sceneCtx = {
      ...(input.context as unknown as SceneAnalyzerContext),
      turnNumber: approxTurnNumber,
      canGenerateBackgrounds: enableGen && !!imgConnId,
      canGenerateIllustrations:
        enableGen && !!imgConnId && isIllustrationAllowed(meta, approxTurnNumber, sessionNumber),
      artStylePrompt: artStyleForScene || null,
    };

    const systemPrompt = buildSceneAnalyzerSystemPrompt(sceneCtx);
    const userPrompt = buildSceneAnalyzerUserPrompt(input.narration, input.playerAction, sceneCtx);

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    if (debugLogsEnabled) {
      debugLog(
        "[debug/game/scene-analysis:connection] request chatId=%s model=%s narrationChars=%d playerActionChars=%d state=%s bgOptions=%d sfxOptions=%d widgets=%d npcs=%d streaming=%s generateBackgrounds=%s generateIllustration=%s",
        input.chatId,
        conn.model ?? "",
        input.narration.length,
        input.playerAction?.length ?? 0,
        input.context.currentState,
        input.context.availableBackgrounds.length,
        input.context.availableSfx.length,
        input.context.activeWidgets.length,
        input.context.trackedNpcs.length,
        input.streaming,
        !!sceneCtx.canGenerateBackgrounds,
        !!sceneCtx.canGenerateIllustrations,
      );
      debugLog("[debug/game/scene-analysis:connection] system prompt:\n%s", systemPrompt);
      debugLog("[debug/game/scene-analysis:connection] user prompt:\n%s", userPrompt);
    }

    const provider = createLLMProvider(
      conn.provider,
      baseUrl,
      conn.apiKey!,
      conn.maxContext,
      conn.openrouterProvider,
      conn.maxTokensOverride,
    );
    logger.debug(
      "[game/scene-wrap] chatId=%s, model=%s, narration=%d chars, streaming=%s",
      input.chatId,
      conn.model,
      input.narration.length,
      input.streaming,
    );
    // Scene-wrap returns a single JSON payload to the caller, so the primary
    // request should stay on the buffered completion path regardless of the
    // UI's live-streaming toggle. Some GPT-5.5/OpenAI-compatible stacks return
    // empty content when `chatComplete()` is asked to stream this JSON route.
    const sceneWrapOptions = gameGenOptions(
      conn.model ?? "",
      {
        stream: false,
        responseFormat: { type: "json_object" },
      },
      gameGenerationParameters,
    );
    const result = await provider.chatComplete(messages, sceneWrapOptions);

    let sceneWrapExtraction = extractLeadingThinkingBlocks(result.content || "");
    let raw = sceneWrapExtraction.content;
    // Some provider/model combos can still return empty content on the buffered
    // path. Retry once via streamed collection using the same JSON mode.
    if (!raw.trim()) {
      logger.warn("[game/scene-wrap] Empty buffered response, retrying with streamed JSON collection");
      let streamed = "";
      for await (const chunk of provider.chat(messages, { ...sceneWrapOptions, stream: true })) {
        streamed += chunk;
      }
      sceneWrapExtraction = extractLeadingThinkingBlocks(streamed);
      raw = sceneWrapExtraction.content;
    }
    if (debugLogsEnabled) {
      debugLog(
        "[debug/game/scene-analysis:connection] raw response chatId=%s model=%s chars=%d\n%s",
        input.chatId,
        conn.model ?? "",
        raw.length,
        raw,
      );
    }
    logger.debug("[game/scene-wrap] Response (%d chars): %s", raw.length, raw);
    if (sceneWrapExtraction.thinking) {
      logger.debug(
        "[game/scene-wrap] Thinking tokens (%d chars):\n%s",
        sceneWrapExtraction.thinking.length,
        sceneWrapExtraction.thinking,
      );
    }

    try {
      const rawParsed = parseJSON(raw);
      logger.debug("[game/scene-wrap] Parsed keys: %s", Object.keys(rawParsed as Record<string, unknown>).join(", "));

      // Post-process: fuzzy-match prose → real tags and normalize direction payloads.
      const ppCtx: PostProcessContext = {
        availableBackgrounds: input.context.availableBackgrounds,
        availableSfx: input.context.availableSfx,
        canGenerateBackgrounds: !!sceneCtx.canGenerateBackgrounds,
        validWidgetIds: new Set(
          input.context.activeWidgets
            .map((widget) =>
              widget && typeof widget === "object" && !Array.isArray(widget) ? (widget as { id?: unknown }).id : null,
            )
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
        characterNames: input.context.characterNames ?? [],
      };
      const parsed = postProcessSceneResult(rawParsed as import("@marinara-engine/shared").SceneAnalysis, ppCtx);

      // ── Dynamic music & ambient scoring ──
      // Replace LLM outputs with deterministic rule-based picks.
      // Read available tags from server-side manifest instead of client payload.
      const assetManifest = getAssetManifest();
      const allAssetKeys = Object.keys(assetManifest.assets ?? {});
      const serverMusicTags = allAssetKeys.filter((k) => k.startsWith("music:"));
      const serverAmbientTags = allAssetKeys.filter((k) => k.startsWith("ambient:"));

      const scoredMusic = scoreMusic({
        state: (input.context.currentState as GameActiveState) ?? "exploration",
        weather: parsed.weather ?? input.context.currentWeather,
        timeOfDay: parsed.timeOfDay ?? input.context.currentTimeOfDay,
        currentMusic: input.context.currentMusic,
        recentMusic: input.context.recentMusic,
        availableMusic: serverMusicTags,
      });
      if (scoredMusic) {
        parsed.music = scoredMusic;
      } else if (parsed.music) {
        parsed.music = null;
      }

      const scoredAmbient = scoreAmbient({
        state: (input.context.currentState as GameActiveState) ?? "exploration",
        weather: parsed.weather ?? input.context.currentWeather,
        timeOfDay: parsed.timeOfDay ?? input.context.currentTimeOfDay,
        currentAmbient: input.context.currentAmbient ?? null,
        availableAmbient: serverAmbientTags,
        background: parsed.background ?? input.context.currentBackground,
      });
      if (scoredAmbient) {
        parsed.ambient = scoredAmbient;
      } else if (parsed.ambient) {
        parsed.ambient = null;
      }

      if (!sceneCtx.canGenerateIllustrations) {
        (parsed as unknown as Record<string, unknown>).illustration = null;
      }

      // ── Scene asset preparation ──
      // When sprite generation is enabled, scene-wrap may resolve cheap local
      // assets such as character-library portraits.
      //
      // Keep image generation out of /scene-wrap. This route is the scene-analysis
      // response path; if an image provider stalls here, the client can hit its
      // scene-analysis timeout even though the analyzer already returned valid JSON.
      // Missing/generated assets are handled by the follow-up /game/generate-assets
      // request, which reports asset failures separately.
      const generateSceneWrapAssetsInline = false;
      if (!enableGen) {
        logger.debug("[game/scene-wrap] asset-gen skipped: enableSpriteGeneration=false");
      } else if (!imgConnId) {
        logger.debug("[game/scene-wrap] asset-gen skipped: no gameImageConnectionId configured");
      }

      if (enableGen && imgConnId && parsed && typeof parsed === "object") {
        const sceneResult = parsed as unknown as Record<string, unknown>;

        try {
          const imgConn = await connections.getWithKey(imgConnId);
          if (imgConn) {
            const imgModel = imgConn.model || "";
            const imgBaseUrl = imgConn.baseUrl || "https://image.pollinations.ai";
            const imgApiKey = imgConn.apiKey || "";
            const imgSource = (imgConn as any).imageGenerationSource || imgModel;
            const imgServiceHint = imgConn.imageService || imgSource;
            const imgComfyWorkflow = imgConn.comfyuiWorkflow || undefined;

            const setupCfg = meta.gameSetupConfig as Record<string, unknown> | null;
            const genre = (setupCfg?.genre as string) || "";
            const setting = (setupCfg?.setting as string) || "";
            const artStyle = (setupCfg?.artStylePrompt as string) || "";

            const charStore = createCharactersStorage(app.db);
            const allChars = await charStore.list();
            const charAvatarByName = new Map<string, string>();
            const charDescriptionByName = new Map<string, string>();
            for (const ch of allChars) {
              try {
                const parsed = JSON.parse(ch.data) as Record<string, unknown> & { name?: string };
                if (parsed.name && ch.avatarPath) {
                  charAvatarByName.set(parsed.name.toLowerCase(), ch.avatarPath);
                }
                const appearanceText = extractCharacterAppearanceText(parsed);
                if (parsed.name && appearanceText) {
                  charDescriptionByName.set(parsed.name.toLowerCase(), appearanceText);
                }
              } catch {
                /* skip */
              }
            }

            const illustration = sceneResult.illustration as SceneIllustrationRequest | null | undefined;
            if (illustration && sceneCtx.canGenerateIllustrations && generateSceneWrapAssetsInline) {
              const illustrationAssets = collectIllustrationCharacterAssets({
                illustration,
                characterNames: input.context.characterNames ?? [],
                trackedNpcs: (input.context.trackedNpcs ?? []) as Array<Record<string, unknown>>,
                gameNpcs: (meta.gameNpcs as GameNpc[]) ?? [],
                charAvatarByName,
                charDescriptionByName,
              });
              const generatedTag = await generateSceneIllustration({
                chatId: input.chatId,
                prompt: illustration.prompt,
                reason: illustration.reason,
                characters: illustration.characters,
                characterDescriptions: illustrationAssets.characterDescriptions,
                slug: illustration.slug,
                genre,
                setting,
                artStyle,
                referenceImages: illustrationAssets.referenceImages,
                imgSource,
                imgModel,
                imgBaseUrl,
                imgApiKey,
                imgService: imgServiceHint,
                imgComfyWorkflow,
                debugLog: debugLogsEnabled ? debugLog : undefined,
                promptOverridesStorage: createPromptOverridesStorage(app.db),
              });
              if (generatedTag) {
                await addGeneratedIllustrationToGallery({
                  app,
                  chatId: input.chatId,
                  tag: generatedTag,
                  illustration,
                  model: imgModel,
                });
                applyGeneratedIllustration(sceneResult, generatedTag, illustration.segment);
                sceneResult.illustration = null;
                try {
                  const latestChat = await chats.getById(input.chatId);
                  if (latestChat) {
                    const latestMeta = parseMeta(latestChat.metadata);
                    await chats.updateMetadata(input.chatId, {
                      ...latestMeta,
                      gameLastIllustrationTurn: approxTurnNumber,
                      gameLastIllustrationSessionNumber: sessionNumber,
                      gameLastIllustrationTag: generatedTag,
                    });
                  }
                } catch {
                  /* non-fatal */
                }
              }
            } else if (illustration && sceneCtx.canGenerateIllustrations) {
              logger.debug("[game/scene-wrap] illustration generation deferred to /game/generate-assets");
            }

            // ── Background generation ──
            // Check if the scene analysis picked a bg tag that doesn't exist
            const chosenBg = (sceneResult.background as string) ?? null;
            if (chosenBg && chosenBg !== "black" && chosenBg !== "none") {
              const manifest = getAssetManifest();
              const tagExists =
                !!manifest.assets[chosenBg] ||
                Object.keys(manifest.assets).some(
                  (k) => k.startsWith("backgrounds:") && k.toLowerCase().includes(chosenBg.toLowerCase()),
                );

              if (tagExists) {
                logger.debug(`[game/scene-wrap] bg "${chosenBg}" already in manifest, skipping generation`);
              } else {
                logger.debug(`[game/scene-wrap] bg "${chosenBg}" not in manifest; generation will be deferred`);
              }

              if (!tagExists && generateSceneWrapAssetsInline) {
                // The scene model wanted a bg that doesn't exist — generate one
                const slug = generatedBackgroundSlug(chosenBg);

                const generatedTag = await generateBackground({
                  chatId: input.chatId,
                  locationSlug: slug,
                  sceneDescription: chosenBg.replace(/:/g, " ").replace(/-/g, " "),
                  genre,
                  setting,
                  artStyle,
                  imgSource,
                  imgModel,
                  imgBaseUrl,
                  imgApiKey,
                  imgService: imgServiceHint,
                  debugLog: debugLogsEnabled ? debugLog : undefined,
                  promptOverridesStorage: createPromptOverridesStorage(app.db),
                });

                if (generatedTag) {
                  // Rewrite the scene result to use the generated tag
                  sceneResult.background = generatedTag;
                  // Also patch segmentEffects
                  if (Array.isArray(sceneResult.segmentEffects)) {
                    for (const fx of sceneResult.segmentEffects as Record<string, unknown>[]) {
                      if (fx.background === chosenBg) {
                        fx.background = generatedTag;
                      }
                    }
                  }
                }
              } else if (!tagExists) {
                logger.debug('[game/scene-wrap] bg "%s" generation deferred to /game/generate-assets', chosenBg);
              }
            }

            // Also check segmentEffects for additional bg tags
            if (Array.isArray(sceneResult.segmentEffects) && generateSceneWrapAssetsInline) {
              const manifest = getAssetManifest();
              for (const fx of sceneResult.segmentEffects as Record<string, unknown>[]) {
                const segBg = fx.background as string | null;
                if (!segBg || segBg === "black" || segBg === "none") continue;
                if (manifest.assets[segBg]) continue;
                const segTagExists = Object.keys(manifest.assets).some(
                  (k) => k.startsWith("backgrounds:") && k.toLowerCase().includes(segBg.toLowerCase()),
                );
                if (segTagExists) continue;

                const slug = generatedBackgroundSlug(segBg);

                const generatedTag = await generateBackground({
                  chatId: input.chatId,
                  locationSlug: slug,
                  sceneDescription: segBg.replace(/:/g, " ").replace(/-/g, " "),
                  genre,
                  setting,
                  artStyle,
                  imgSource,
                  imgModel,
                  imgBaseUrl,
                  imgApiKey,
                  imgService: imgServiceHint,
                  debugLog: debugLogsEnabled ? debugLog : undefined,
                  promptOverridesStorage: createPromptOverridesStorage(app.db),
                });

                if (generatedTag) {
                  fx.background = generatedTag;
                }
              }
            }

            // ── NPC portrait generation ──
            // First, try to resolve avatars from the character library (cheap, in-memory).
            // Actual image generation for NPCs missing portraits is deferred to the client's
            // follow-up POST /game/generate-assets so it doesn't block scene-wrap — which
            // would otherwise keep the "Preparing the scene…" spinner waiting (or hit the
            // client-side safety timeout and let the user play before assets are ready).
            const stateStore = createGameStateStorage(app.db);
            const latestState = await stateStore.getLatest(input.chatId);
            const npcs = buildSceneAssetNpcCandidates(
              (input.context.trackedNpcs ?? []) as Array<Record<string, unknown>>,
              latestState?.presentCharacters,
              input.context.characterNames ?? [],
              input.narration,
            );
            const libResolvedNpcs: Array<{ name: string; description: string; avatarUrl: string }> = [];
            for (const npc of npcs) {
              if (!npc.name) continue;
              const libAvatar = findCharAvatarFuzzy(npc.name, charAvatarByName);
              if (libAvatar && npc.avatarUrl !== libAvatar) {
                npc.avatarUrl = libAvatar;
                libResolvedNpcs.push({ name: npc.name, description: npc.description, avatarUrl: libAvatar });
              }
            }

            // Persist any library-resolved avatars to chat metadata (no image gen involved)
            if (libResolvedNpcs.length > 0) {
              const chatsStore = createChatsStorage(app.db);
              const latestChat = await chatsStore.getById(input.chatId);
              if (latestChat) {
                const latestMeta = parseMeta(latestChat.metadata);
                const currentNpcs = (latestMeta.gameNpcs as GameNpc[]) ?? [];
                const nextNpcs = upsertGameNpcAvatarEntries(currentNpcs, libResolvedNpcs);
                if (nextNpcs !== currentNpcs) {
                  await chatsStore.updateMetadata(input.chatId, { ...latestMeta, gameNpcs: nextNpcs });
                }
              }
              (sceneResult as Record<string, unknown>).generatedNpcAvatars = libResolvedNpcs.map(
                ({ name, avatarUrl }) => ({ name, avatarUrl }),
              );
            }

            // Count NPCs that still need a portrait so logs make it clear what
            // the client's follow-up /generate-assets call will (or won't) do.
            const unresolvedNpcCount = npcs.filter((n) => !n.avatarUrl && n.name).length;
            logger.debug(
              `[game/scene-wrap] asset-gen summary: bg=${chosenBg ?? "none"}, npcs(library-resolved)=${libResolvedNpcs.length}, npcs(deferred to /generate-assets)=${unresolvedNpcCount}`,
            );
          }
        } catch (genErr) {
          logger.warn(genErr, "[game/scene-wrap] Asset generation error (non-fatal)");
        }
      }

      // Persist the resolved background to metadata so it survives refresh
      if (parsed.background) {
        try {
          const freshChat = await chats.getById(input.chatId);
          if (freshChat) {
            const freshMeta = parseMeta(freshChat.metadata);
            await chats.updateMetadata(input.chatId, { ...freshMeta, gameSceneBackground: parsed.background });
          }
        } catch {
          /* non-fatal */
        }
      }

      if (debugLogsEnabled) {
        debugLog("[debug/game/scene-analysis:connection] final result:\n%s", JSON.stringify(parsed, null, 2));
      }

      return { result: parsed };
    } catch (err) {
      logger.warn(err, "[game/scene-wrap] Failed to parse LLM response as JSON: %s", raw.slice(0, 200));
      return { result: null, raw };
    }
  });

  // ── POST /game/generate-assets ──
  // Fire-and-forget asset generation for the sidecar path.
  // The client calls this after receiving a scene result with unresolvable tags.
  const generateAssetsSchema = z.object({
    chatId: z.string().min(1),
    /** Background tag that didn't resolve (the scene model suggested it). */
    backgroundTag: z.string().max(500).optional(),
    /** NPCs needing portraits: [{ name, description }] */
    npcsNeedingAvatars: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          description: z.string().min(1).max(1000),
        }),
      )
      .max(10)
      .optional(),
    illustration: z
      .object({
        segment: z.number().int().min(0).max(500).optional(),
        prompt: z.string().min(40).max(1200),
        characters: z.array(z.string().min(1).max(200)).max(6).optional(),
        reason: z.string().max(300).optional(),
        slug: z.string().max(80).optional(),
      })
      .optional(),
    debugMode: z.boolean().optional().default(false),
  });

  app.post("/generate-assets", async (req) => {
    const input = generateAssetsSchema.parse(req.body);
    const requestDebug = input.debugMode === true;
    const debugLogsEnabled = requestDebug || isDebugAgentsEnabled() || logger.isLevelEnabled("debug");
    const debugLog = (message: string, ...args: any[]) => {
      if (requestDebug) {
        console.log(message, ...args);
      } else {
        logger.debug(message, ...args);
      }
    };
    const chats = createChatsStorage(app.db);
    const connections = createConnectionsStorage(app.db);

    console.log(
      "[game/generate-assets] request: chatId=%s bg=%s npcs=%s",
      input.chatId,
      input.backgroundTag ?? "none",
      input.npcsNeedingAvatars?.length ?? 0,
    );
    if (debugLogsEnabled) {
      debugLog(
        "[debug/game/generate-assets] request payload:\n%s",
        JSON.stringify(
          {
            chatId: input.chatId,
            backgroundTag: input.backgroundTag ?? null,
            npcsNeedingAvatars: input.npcsNeedingAvatars ?? [],
            illustration: input.illustration ?? null,
          },
          null,
          2,
        ),
      );
    }

    const chat = await chats.getById(input.chatId);
    if (!chat) throw new Error("Chat not found");

    const meta = parseMeta(chat.metadata);
    const enableGen = !!meta.enableSpriteGeneration;
    const imgConnId = (meta.gameImageConnectionId as string) || null;

    if (!enableGen || !imgConnId) {
      console.log(
        "[game/generate-assets] skipped: enableSpriteGeneration=%s imageConnectionConfigured=%s",
        enableGen,
        !!imgConnId,
      );
      return { generatedBackground: null, generatedIllustration: null, generatedNpcAvatars: [] };
    }

    const imgConn = await connections.getWithKey(imgConnId);
    if (!imgConn) {
      console.log("[game/generate-assets] skipped: image connection %s not found", imgConnId);
      return { generatedBackground: null, generatedIllustration: null, generatedNpcAvatars: [] };
    }

    const imgModel = imgConn.model || "";
    const imgBaseUrl = imgConn.baseUrl || "https://image.pollinations.ai";
    const imgApiKey = imgConn.apiKey || "";
    const imgSource = (imgConn as any).imageGenerationSource || imgModel;
    const imgComfyWorkflow = imgConn.comfyuiWorkflow || undefined;
    const imgServiceHint = imgConn.imageService || imgSource;

    const setupCfg = meta.gameSetupConfig as Record<string, unknown> | null;
    const genre = (setupCfg?.genre as string) || "";
    const setting = (setupCfg?.setting as string) || "";
    const artStyle = (setupCfg?.artStylePrompt as string) || "";

    let generatedBackground: string | null = null;
    let generatedIllustration: { tag: string; segment?: number } | null = null;
    const generatedNpcAvatars: Array<{ name: string; avatarUrl: string }> = [];

    // ── Generate background ──
    if (input.backgroundTag) {
      const slug = generatedBackgroundSlug(input.backgroundTag);

      const tag = await generateBackground({
        chatId: input.chatId,
        locationSlug: slug,
        sceneDescription: input.backgroundTag.replace(/:/g, " ").replace(/-/g, " "),
        genre,
        setting,
        artStyle,
        imgSource,
        imgModel,
        imgBaseUrl,
        imgApiKey,
        imgService: imgServiceHint,
        imgComfyWorkflow,
        debugLog: debugLogsEnabled ? debugLog : undefined,
        promptOverridesStorage: createPromptOverridesStorage(app.db),
      });
      generatedBackground = tag;
    }

    // ── Generate rare VN illustration ──
    if (input.illustration) {
      const allMsgs = await chats.listMessages(input.chatId);
      const approxTurnNumber = Math.max(1, allMsgs.filter((message) => message.role === "user").length + 1);
      const sessionNumber = currentGameSessionNumber(meta);
      if (!isIllustrationAllowed(meta, approxTurnNumber, sessionNumber)) {
        console.log("[game/generate-assets] illustration skipped: cooldown active");
      } else {
        const charStore = createCharactersStorage(app.db);
        const allChars = await charStore.list();
        const charAvatarByName = new Map<string, string>();
        const charDescriptionByName = new Map<string, string>();
        for (const ch of allChars) {
          try {
            const parsed = JSON.parse(ch.data) as Record<string, unknown> & { name?: string };
            if (parsed.name && ch.avatarPath) {
              charAvatarByName.set(parsed.name.toLowerCase(), ch.avatarPath);
            }
            const appearanceText = extractCharacterAppearanceText(parsed);
            if (parsed.name && appearanceText) {
              charDescriptionByName.set(parsed.name.toLowerCase(), appearanceText);
            }
          } catch {
            /* skip */
          }
        }

        const illustration = input.illustration as SceneIllustrationRequest;
        const illustrationAssets = collectIllustrationCharacterAssets({
          illustration,
          characterNames: illustration.characters ?? [],
          trackedNpcs: [],
          gameNpcs: (meta.gameNpcs as GameNpc[]) ?? [],
          charAvatarByName,
          charDescriptionByName,
        });
        const tag = await generateSceneIllustration({
          chatId: input.chatId,
          prompt: illustration.prompt,
          reason: illustration.reason,
          characters: illustration.characters,
          characterDescriptions: illustrationAssets.characterDescriptions,
          slug: illustration.slug,
          genre,
          setting,
          artStyle,
          referenceImages: illustrationAssets.referenceImages,
          imgSource,
          imgModel,
          imgBaseUrl,
          imgApiKey,
          imgService: imgServiceHint,
          imgComfyWorkflow,
          debugLog: debugLogsEnabled ? debugLog : undefined,
          promptOverridesStorage: createPromptOverridesStorage(app.db),
        });

        if (tag) {
          await addGeneratedIllustrationToGallery({
            app,
            chatId: input.chatId,
            tag,
            illustration,
            model: imgModel,
          });
          generatedIllustration = {
            tag,
            ...(illustration.segment !== undefined ? { segment: illustration.segment } : {}),
          };
          const latestChat = await chats.getById(input.chatId);
          if (latestChat) {
            const latestMeta = parseMeta(latestChat.metadata);
            await chats.updateMetadata(input.chatId, {
              ...latestMeta,
              gameLastIllustrationTurn: approxTurnNumber,
              gameLastIllustrationSessionNumber: sessionNumber,
              gameLastIllustrationTag: tag,
            });
          }
        }
      }
    }

    // ── Generate NPC avatars ──
    if (input.npcsNeedingAvatars?.length) {
      const latestChat = await chats.getById(input.chatId);
      const latestMeta = latestChat ? parseMeta(latestChat.metadata) : meta;
      const currentNpcs = (latestMeta.gameNpcs as GameNpc[]) ?? [];
      const existingNpcAvatarByName = new Map<string, string>();
      for (const currentNpc of currentNpcs) {
        addExistingNpcAvatar(existingNpcAvatarByName, currentNpc.name, currentNpc.avatarUrl);
      }

      const latestState = await createGameStateStorage(app.db).getLatest(input.chatId);
      const presentCharacters = parseStoredJson<Array<Record<string, unknown>>>(latestState?.presentCharacters) ?? [];
      for (const presentCharacter of presentCharacters) {
        addExistingNpcAvatar(existingNpcAvatarByName, presentCharacter.name, presentCharacter.avatarPath);
      }

      for (const npc of input.npcsNeedingAvatars) {
        const generatedAvatarUrl = buildNpcAvatarUrl(input.chatId, npc.name);
        addExistingNpcAvatar(existingNpcAvatarByName, npc.name, generatedAvatarUrl);
      }

      // Check character library first — reuse existing avatars
      const charStore = createCharactersStorage(app.db);
      const allChars = await charStore.list();
      const charAvatarByName = new Map<string, string>();
      for (const ch of allChars) {
        try {
          const parsed = JSON.parse(ch.data) as { name?: string };
          if (parsed.name && ch.avatarPath) {
            charAvatarByName.set(parsed.name.toLowerCase(), ch.avatarPath);
          }
        } catch {
          /* skip */
        }
      }

      for (const npc of input.npcsNeedingAvatars) {
        const existingAvatarUrl = existingNpcAvatarByName.get(normalizeJournalMatch(npc.name));
        if (existingAvatarUrl) {
          console.log('[game/generate-assets] NPC avatar exists, skipping generation: "%s"', npc.name);
          generatedNpcAvatars.push({ name: npc.name, avatarUrl: existingAvatarUrl });
          continue;
        }

        const libAvatar = findCharAvatarFuzzy(npc.name, charAvatarByName);
        if (libAvatar) {
          generatedNpcAvatars.push({ name: npc.name, avatarUrl: libAvatar });
          continue;
        }
        const avatarUrl = await generateNpcPortrait({
          chatId: input.chatId,
          npcName: npc.name,
          appearance: npc.description,
          artStyle,
          imgSource,
          imgModel,
          imgBaseUrl,
          imgApiKey,
          imgService: imgServiceHint,
          imgComfyWorkflow,
          debugLog: debugLogsEnabled ? debugLog : undefined,
          promptOverridesStorage: createPromptOverridesStorage(app.db),
        });
        if (avatarUrl) {
          generatedNpcAvatars.push({ name: npc.name, avatarUrl });
        }
      }

      // Persist avatar URLs to NPC list in metadata
      if (generatedNpcAvatars.length > 0) {
        if (latestChat) {
          const avatarEntries: SceneAssetNpcAvatarEntry[] = generatedNpcAvatars.map((generatedAvatar) => ({
            ...generatedAvatar,
            description:
              input.npcsNeedingAvatars?.find(
                (npc) => normalizeJournalMatch(npc.name) === normalizeJournalMatch(generatedAvatar.name),
              )?.description ?? "",
          }));
          const nextNpcs = upsertGameNpcAvatarEntries(currentNpcs, avatarEntries);
          if (nextNpcs !== currentNpcs) {
            await chats.updateMetadata(input.chatId, { ...latestMeta, gameNpcs: nextNpcs });
          }
        }
      }
    }

    console.log(
      "[game/generate-assets] result: bg=%s illustration=%s npcs=%s",
      generatedBackground ?? "none",
      generatedIllustration?.tag ?? "none",
      generatedNpcAvatars.length,
    );
    if (debugLogsEnabled) {
      debugLog(
        "[debug/game/generate-assets] result payload:\n%s",
        JSON.stringify({ generatedBackground, generatedIllustration, generatedNpcAvatars }, null, 2),
      );
    }

    return { generatedBackground, generatedIllustration, generatedNpcAvatars };
  });

  // ── POST /game/checkpoint ──
  // Create a checkpoint (manual or auto-triggered).
  const checkpointCreateSchema = z.object({
    chatId: z.string().min(1),
    label: z.string().min(1).max(200),
    triggerType: z.enum([
      "manual",
      "session_start",
      "session_end",
      "combat_start",
      "combat_end",
      "location_change",
      "auto_interval",
    ]),
  });

  app.post("/checkpoint", async (req) => {
    const input = checkpointCreateSchema.parse(req.body);
    const checkpoints = createCheckpointService(app.db);
    const stateStore = createGameStateStorage(app.db);

    const snapshot = await stateStore.getLatest(input.chatId);
    if (!snapshot) throw new Error("No game state snapshot to checkpoint");

    const id = await checkpoints.create({
      chatId: input.chatId,
      snapshotId: snapshot.id,
      messageId: snapshot.messageId,
      label: input.label,
      triggerType: input.triggerType as CheckpointTrigger,
      location: snapshot.location,
      gameState: null, // filled by caller if needed
      weather: snapshot.weather,
      timeOfDay: snapshot.time,
      turnNumber: null,
    });

    return { id };
  });

  // ── GET /game/:chatId/checkpoints ──
  // List all checkpoints for a chat.
  app.get("/:chatId/checkpoints", async (req) => {
    const { chatId } = req.params as { chatId: string };
    const checkpoints = createCheckpointService(app.db);
    return checkpoints.listForChat(chatId);
  });

  // ── DELETE /game/checkpoint/:id ──
  // Delete a specific checkpoint.
  app.delete("/checkpoint/:id", async (req) => {
    const { id } = req.params as { id: string };
    const checkpoints = createCheckpointService(app.db);
    await checkpoints.deleteById(id);
    return { ok: true };
  });

  // ── POST /game/checkpoint/load ──
  // Restore game state from a checkpoint.
  // Creates a system message marking the restore point and copies the
  // checkpoint's snapshot data as the new "latest" game state.
  const checkpointLoadSchema = z.object({
    chatId: z.string().min(1),
    checkpointId: z.string().min(1),
  });

  app.post("/checkpoint/load", async (req) => {
    const input = checkpointLoadSchema.parse(req.body);
    const checkpointSvc = createCheckpointService(app.db);
    const stateStore = createGameStateStorage(app.db);
    const chats = createChatsStorage(app.db);

    const cp = await checkpointSvc.getById(input.checkpointId);
    if (!cp) throw new Error("Checkpoint not found");
    if (cp.chatId !== input.chatId) throw new Error("Checkpoint does not belong to this chat");

    // Fetch the original snapshot
    const snapshot = await stateStore.getByMessage(cp.messageId, 0);
    if (!snapshot) throw new Error("Checkpoint snapshot no longer exists");

    // Create a system message to mark the restore point
    const restoreMsg = await chats.createMessage({
      chatId: input.chatId,
      role: "system",
      characterId: null,
      content: `[Checkpoint restored: ${cp.label}]`,
    });
    if (!restoreMsg) throw new Error("Failed to create restore message");

    // Clone the snapshot state onto the new message
    await stateStore.create({
      chatId: input.chatId,
      messageId: restoreMsg.id,
      swipeIndex: 0,
      date: snapshot.date,
      time: snapshot.time,
      location: snapshot.location,
      weather: snapshot.weather,
      temperature: snapshot.temperature,
      presentCharacters: JSON.parse((snapshot.presentCharacters as string) ?? "[]"),
      recentEvents: JSON.parse((snapshot.recentEvents as string) ?? "[]"),
      playerStats: snapshot.playerStats ? JSON.parse(snapshot.playerStats as string) : null,
      personaStats: snapshot.personaStats ? JSON.parse(snapshot.personaStats as string) : null,
      committed: true,
    });

    // Restore chat metadata fields from checkpoint
    const chat = await chats.getById(input.chatId);
    if (chat) {
      const meta = parseMeta(chat.metadata);
      if (cp.gameState) meta.gameActiveState = cp.gameState as GameActiveState;
      await chats.updateMetadata(input.chatId, meta);
    }

    return { ok: true, messageId: restoreMsg.id };
  });
}
