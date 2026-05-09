// ──────────────────────────────────────────────
// Game: Main Surface (rendered by ChatArea when mode === "game")
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { useGameModeStore } from "../../stores/game-mode.store";
import { useGameAssetStore } from "../../stores/game-asset.store";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { useGameStateStore } from "../../stores/game-state.store";
import {
  useSyncGameState,
  useCreateGame,
  useGameSetup,
  useStartGame,
  useRollDice,
  useSkillCheck,
  useMoveOnMap,
  useConcludeSession,
  useRegenerateSessionConclusion,
  useRegenerateSessionLorebook,
  useUpdateCampaignProgression,
  useStartSession,
  useGenerateMap,
  useAdvanceTime,
  useUpdateWeather,
  useRollEncounter,
  useUpdateReputation,
  useJournalEntry,
  useTransitionGameState,
  useRecruitPartyMember,
  useRemovePartyMember,
  gameKeys,
} from "../../hooks/use-game";
import {
  chatKeys,
  useCreateMessage,
  useDeleteChat,
  useUpdateChatMetadata,
  useUpdateMessage,
} from "../../hooks/use-chats";
import { useGenerate } from "../../hooks/use-generate";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { spriteKeys, type SpriteInfo } from "../../hooks/use-characters";
import { api, getJsonRepairRequest, type JsonRepairRequest } from "../../lib/api-client";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { cn } from "../../lib/utils";
import { audioManager } from "../../lib/game-audio";
import {
  parseGmTags,
  parseSegmentInventoryUpdates,
  stripGmTags,
  type CombatEncounterTag,
  type ElementAttackTag,
  type CombatStatusTag,
  type InventoryTag,
  type PartyChangeTag,
} from "../../lib/game-tag-parser";
import { resolveAssetTag } from "../../lib/asset-fuzzy-match";
import { resolveCombatFullBodyPose, resolveDialogueFullBodyPose } from "../../lib/game-full-body-pose";
import { characterNamesMatch, findNamedEntry } from "../../lib/game-character-name-match";
import { normalizeGameSegmentEdit, serializeGameSegmentEdit, type GameSegmentEdit } from "../../lib/game-segment-edits";
import { useSceneAnalysis } from "../../hooks/use-scene-analysis";
import { useSidecarStore } from "../../stores/sidecar.store";
import { parsePartyDialogue } from "../../lib/party-dialogue-parser";
import type {
  PartyDialogueLine,
  CombatSummary,
  GameMap,
  GameActiveState,
  CombatInitState,
  CombatPartyMember,
  CombatEnemy,
  CombatDialogueCue,
  CombatItemEffect,
  CombatMechanic,
  DiceRollResult,
  EncounterInitResponse,
  EncounterSettings,
} from "@marinara-engine/shared";
import type { SceneSegmentEffect } from "@marinara-engine/shared";
import { scoreMusic, scoreAmbient } from "@marinara-engine/shared";
import { GameNarration, formatNarration } from "./GameNarration";
import { GameInput } from "./GameInput";
import { GameMapPanel, MobileMapButton } from "./GameMap";
import { GamePartyBar } from "./GamePartyBar";
import { GameCharacterSheet } from "@/components/game/GameCharacterSheet";
import type { GameCharacterSheetGameCard } from "@/components/game/GameCharacterSheet";
import { GameSetupWizard } from "./GameSetupWizard";
import { GameDiceResult } from "./GameDiceResult";
import { GameSkillCheckResult } from "./GameSkillCheckResult";
import { GameElementReaction } from "./GameElementReaction";
import { GameTravelView } from "./GameTravelView";
import { GameSessionHistory, type CurrentSessionSecrets } from "./GameSessionHistory";
import { GameTransitionManager } from "./GameTransitionManager";
import { GameChoiceCards } from "./GameChoiceCards";
import { GameQteOverlay } from "./GameQteOverlay";
import { GameJournal } from "./GameJournal";
import { GameCombatUI } from "./GameCombatUI";
import { GameJsonRepairModal } from "./GameJsonRepairModal";
import {
  GameImagePromptReviewModal,
  type GameImagePromptOverride,
  type GameImagePromptReviewItem,
} from "./GameImagePromptReviewModal";
import { GameTutorial } from "./GameTutorial";
import { DirectionEngine } from "./DirectionEngine";
import { GameWidgetPanel, GameWidgetSessionPrepModal, MobileWidgetPanel } from "./GameWidgetPanel";
import { WeatherEffects } from "../chat/WeatherEffects";
import { GameInventory } from "./GameInventory";
import { GameReadableDisplay } from "./GameReadableDisplay";
import { ChatGalleryDrawer } from "../chat/ChatGalleryDrawer";
import type { ReadableTag } from "../../lib/game-tag-parser";
import type { DirectionCommand, GameNpc } from "@marinara-engine/shared";

type JournalReadable = ReadableTag & {
  sourceMessageId?: string | null;
  sourceSegmentIndex?: number | null;
};

type GameAssetGenerationPayload = {
  chatId: string;
  backgroundTag?: string;
  npcsNeedingAvatars?: Array<{ name: string; description: string }>;
  illustration?: import("@marinara-engine/shared").SceneIllustrationRequest;
  debugMode?: boolean;
  imageSizes?: {
    background?: { width: number; height: number };
    portrait?: { width: number; height: number };
    selfie?: { width: number; height: number };
  };
  promptOverrides?: GameImagePromptOverride[];
};

type GameAssetGenerationResult = {
  generatedBackground: string | null;
  generatedIllustration: { tag: string; segment?: number } | null;
  generatedNpcAvatars: Array<{ name: string; avatarUrl: string }>;
};

function getConfiguredGameAssetImageSizes(): NonNullable<GameAssetGenerationPayload["imageSizes"]> {
  const settings = useUIStore.getState();
  return {
    background: { width: settings.imageBackgroundWidth, height: settings.imageBackgroundHeight },
    portrait: { width: settings.imagePortraitWidth, height: settings.imagePortraitHeight },
    selfie: { width: settings.imageSelfieWidth, height: settings.imageSelfieHeight },
  };
}

const GAME_ASSET_GENERATION_TIMEOUT_MS = 240_000;
const GAME_ASSET_PREVIEW_TIMEOUT_MS = 180_000;
const GAME_ASSET_PROMPT_REVIEW_TIMEOUT_MS = 180_000;
const IMAGE_PROMPT_REVIEW_TIMED_OUT = Symbol("IMAGE_PROMPT_REVIEW_TIMED_OUT");

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms / 1000} seconds`);
    this.name = "TimeoutError";
  }
}

function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      controller.abort();
      onTimeout?.();
      reject(new TimeoutError(ms));
    }, ms);

    run(controller.signal)
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

type GameTimeMeta = {
  day?: number;
  hour?: number;
  minute?: number;
};

function normalizeGameDay(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(9999, Math.floor(parsed)));
}

function normalizeGameHour(value: unknown, fallback = 8): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(23, Math.floor(parsed)));
}

function normalizeGameMinute(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(59, Math.floor(parsed)));
}

function getGameTimeOfDayLabel(hour: number): string {
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 20) return "evening";
  if (hour >= 20) return "night";
  return "midnight";
}

function formatGameTimeForHud(time: Required<GameTimeMeta>): string {
  const h = String(time.hour).padStart(2, "0");
  const m = String(time.minute).padStart(2, "0");
  return `Day ${time.day}, ${h}:${m} (${getGameTimeOfDayLabel(time.hour)})`;
}

function parseGameDayFromTimeLabel(value?: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\bday\s+(\d{1,4})\b/i);
  if (!match) return null;
  return normalizeGameDay(match[1]);
}

function parseHourMinuteFromTimeLabel(value?: string | null): { hour: number; minute: number } | null {
  if (!value) return null;
  const match = value.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (!match) return null;
  return {
    hour: normalizeGameHour(match[1]),
    minute: normalizeGameMinute(match[2]),
  };
}

type SceneAssetPresentCharacter = {
  name?: string | null;
  appearance?: string | null;
  avatarPath?: string | null;
};

type SpeakingLibraryCharacter = {
  character: GameSurfaceProps["characters"][number];
  aliases: string[];
};

type GamePartyMemberInfo = {
  id: string;
  name: string;
  avatarUrl: string | null;
  avatarCrop?: { zoom: number; offsetX: number; offsetY: number } | null;
  nameColor?: string;
  dialogueColor?: string;
  canRemove?: boolean;
};

const NARRATION_NPC_SPEECH_VERB_PATTERN =
  "(?:said|says|whispered|whispers|muttered|mutters|replied|replies|called|calls|shouted|shouts|asked|asks|warned|warns|growled|growls|hissed|hisses|exclaimed|exclaims|murmured|murmurs|sighed|sighs|snapped|snaps|barked|barks|declared|declares|continued|continues|added|adds|spoke|speaks|began|begins|remarked|remarks|chuckled|chuckles|laughed|laughs|cried|cries)";

const GENERIC_NPC_NAME_LABELS = new Set([
  "soldier",
  "guard",
  "bandit",
  "thug",
  "villager",
  "merchant",
  "clerk",
  "waiter",
  "waitress",
  "servant",
  "attendant",
  "messenger",
  "driver",
  "worker",
  "crowd",
  "voice",
  "stranger",
  "man",
  "woman",
  "boy",
  "girl",
]);

const GENERIC_COMBAT_ENEMY_PATTERNS = [
  /^(?:enemy|foe|monster|creature|beast|minion|summon|shadow|construct|automaton|drone|specter|slime)(?:\s+\d+|\s+[ivx]+)?$/i,
  /^(?:guard|soldier|bandit|thug|raider|cultist|mercenary|assassin|archer|mage|warrior)(?:\s+\d+|\s+[ivx]+)?$/i,
  /^(?:hilichurl|mitachurl|samachurl|treasure hoarder|fatui agent|ruin guard|ruin hunter|ruin sentinel)(?:\s+\d+|\s+[ivx]+)?$/i,
];

const GAME_COMBAT_GENERATION_SETTINGS = {
  combatNarrative: {
    tense: "present",
    person: "third",
    narration: "omniscient",
    pov: "narrator",
  },
  summaryNarrative: {
    tense: "past",
    person: "third",
    narration: "omniscient",
    pov: "narrator",
  },
  historyDepth: 10,
} satisfies EncounterSettings;

type StoredNarrationProgress = {
  index: number;
  messageId: string | null;
};

function parseStoredNarrationProgress(raw: string | null): StoredNarrationProgress | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      index?: unknown;
      messageId?: unknown;
    };
    if (typeof parsed.index === "number" && Number.isFinite(parsed.index) && parsed.index >= 0) {
      return {
        index: parsed.index,
        messageId: typeof parsed.messageId === "string" ? parsed.messageId : null,
      };
    }
  } catch {
    const legacyIndex = Number(raw);
    if (Number.isFinite(legacyIndex) && legacyIndex >= 0) {
      return { index: legacyIndex, messageId: null };
    }
  }

  return null;
}

function normalizeSceneAssetName(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function isLikelyNamedCombatEnemy(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const normalized = normalizeSceneAssetName(trimmed)
    .replace(/\b(?:\d+|[ivx]+)\b/gi, "")
    .trim();
  if (!normalized || GENERIC_NPC_NAME_LABELS.has(normalized)) return false;
  return !GENERIC_COMBAT_ENEMY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function slugifyCombatantId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "unknown"
  );
}

function combatLevelFromHp(maxHp: number, fallbackLevel: number): number {
  if (!Number.isFinite(maxHp) || maxHp <= 0) return fallbackLevel;
  return Math.max(1, Math.round(maxHp / 20));
}

function combatStatusEffectsFromGenerated(
  statuses: CombatPartyMember["statuses"] | CombatEnemy["statuses"] | undefined,
): Combatant["statusEffects"] {
  if (!Array.isArray(statuses)) return undefined;
  const mapped = statuses
    .filter((status) => status?.name)
    .map((status) => ({
      name: status.name,
      modifier: typeof status.modifier === "number" ? status.modifier : 0,
      stat: status.stat ?? ("hp" as const),
      turnsLeft: Math.max(1, Number(status.duration) || 1),
    }));
  return mapped.length > 0 ? mapped : undefined;
}

function combatSkillsFromGeneratedAttacks(
  attacks: CombatPartyMember["attacks"] | CombatEnemy["attacks"] | undefined,
  level: number,
): Combatant["skills"] {
  if (!Array.isArray(attacks)) return undefined;
  const seen = new Set<string>();
  const skills: NonNullable<Combatant["skills"]> = [];
  for (const [index, attack] of attacks.entries()) {
    const name = typeof attack?.name === "string" ? attack.name.trim() : "";
    if (!name || /^(attack|basic attack|strike)$/i.test(name)) continue;
    const id = slugifyCombatantId(`${name}-${index}`);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    skills.push({
      id,
      name,
      type: "attack",
      mpCost: Math.max(4, Math.min(18, 5 + level)),
      power:
        typeof attack.power === "number" && Number.isFinite(attack.power)
          ? Math.max(0.5, Math.min(3, attack.power))
          : attack.type === "AoE"
            ? 1.15
            : 1.35,
      description: attack.description || (attack.type === "AoE" ? "Area combat ability" : "Combat ability"),
      cooldown: typeof attack.cooldown === "number" ? attack.cooldown : undefined,
      element: attack.element || undefined,
      statusEffect: attack.statusEffect || undefined,
    });
  }
  return skills.length > 0 ? skills : undefined;
}

/**
 * Runtime guard for a deserialized `Combatant`. Used when restoring combat state
 * from chat metadata, which is JSON-roundtripped and crosses version boundaries —
 * the TypeScript `as Combatant[]` cast is erased at runtime, so a stale snapshot
 * written by an older client version (missing a field added later, or with a
 * renamed field) would otherwise pass silently and crash downstream when render
 * code touches the missing property.
 *
 * Validates the required scalar fields only. Optional fields (mp, sprite, skills,
 * statusEffects, element, elementAura) are allowed to be absent.
 */
function isValidCombatant(value: unknown): value is Combatant {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.hp === "number" &&
    typeof v.maxHp === "number" &&
    typeof v.attack === "number" &&
    typeof v.defense === "number" &&
    typeof v.speed === "number" &&
    typeof v.level === "number" &&
    (v.side === "player" || v.side === "enemy")
  );
}

function generatedPartyMemberToCombatant(
  member: CombatPartyMember,
  index: number,
  partyMembers: GamePartyMemberInfo[],
  fallbackLevel: number,
): Combatant {
  const matchedPartyMember = findNamedEntry(partyMembers, member.name, (entry) => entry.name);
  const maxHp = Math.max(1, Number(member.maxHp) || Number(member.hp) || 1);
  const hp = Math.max(0, Math.min(maxHp, Number(member.hp) || maxHp));
  const level = combatLevelFromHp(maxHp, fallbackLevel);
  const element = member.attacks?.find((attack) => attack.element)?.element;
  return {
    id: matchedPartyMember?.id ?? `generated-party-${index}-${slugifyCombatantId(member.name)}`,
    name: member.name || `Ally ${index + 1}`,
    hp,
    maxHp,
    mp: 20 + level * 3,
    maxMp: 20 + level * 3,
    attack: 8 + level * 2,
    defense: 5 + level,
    speed: 6 + level,
    level,
    side: "player",
    sprite: matchedPartyMember?.avatarUrl ?? undefined,
    statusEffects: combatStatusEffectsFromGenerated(member.statuses),
    skills: combatSkillsFromGeneratedAttacks(member.attacks, level),
    element,
  };
}

function generatedEnemyToCombatant(enemy: CombatEnemy, index: number, fallbackLevel: number): Combatant {
  const maxHp = Math.max(1, Number(enemy.maxHp) || Number(enemy.hp) || 1);
  const hp = Math.max(0, Math.min(maxHp, Number(enemy.hp) || maxHp));
  const level = combatLevelFromHp(maxHp, fallbackLevel);
  const element = enemy.attacks?.find((attack) => attack.element)?.element;
  return {
    id: `generated-enemy-${index}-${slugifyCombatantId(enemy.name)}`,
    name: enemy.name || `Enemy ${index + 1}`,
    hp,
    maxHp,
    attack: 9 + level * 2,
    defense: 4 + level,
    speed: 5 + level,
    level,
    side: "enemy",
    sprite: enemy.sprite || undefined,
    statusEffects: combatStatusEffectsFromGenerated(enemy.statuses),
    skills: combatSkillsFromGeneratedAttacks(enemy.attacks, level),
    element,
  };
}

const TRAILING_NPC_REPUTATION_LABEL = /(devoted|allied|friendly|neutral|unfriendly|hostile|enemy)$/i;

function cleanGameNpcDisplayName(value: string): string {
  return value.replace(TRAILING_NPC_REPUTATION_LABEL, "").trim() || value;
}

function normalizeGameNpcJournalName(value: string): string {
  return normalizeSceneAssetName(cleanGameNpcDisplayName(value));
}

function pruneGameJournalNpc(rawJournal: unknown, npcName: string): unknown {
  if (!rawJournal || typeof rawJournal !== "object" || Array.isArray(rawJournal)) {
    return rawJournal;
  }

  const journal = rawJournal as Record<string, unknown>;
  const target = normalizeGameNpcJournalName(npcName);
  if (!target) return rawJournal;

  const npcLog = Array.isArray(journal.npcLog)
    ? journal.npcLog.filter((entry) => {
        if (!entry || typeof entry !== "object") return true;
        const name = (entry as { npcName?: unknown }).npcName;
        return typeof name !== "string" || normalizeGameNpcJournalName(name) !== target;
      })
    : journal.npcLog;

  const entries = Array.isArray(journal.entries)
    ? journal.entries.filter((entry) => {
        if (!entry || typeof entry !== "object") return true;
        const record = entry as { type?: unknown; title?: unknown };
        if (record.type !== "npc" || typeof record.title !== "string") return true;
        const title = record.title.replace(/^[^\p{L}\p{N}]+/u, "").trim();
        return normalizeGameNpcJournalName(title) !== target;
      })
    : journal.entries;

  return {
    ...journal,
    npcLog,
    entries,
  };
}

function normalizePartyLookupName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildPartyNpcId(name: string): string {
  const slug = normalizePartyLookupName(name).replace(/\s+/g, "-");
  const encodedSlug = encodeURIComponent(name.trim().toLowerCase())
    .replace(/%/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `npc:${slug || encodedSlug || "unknown"}`;
}

function buildPartyNpcLookup(npcs: GameNpc[], metadataNpcs: unknown): Map<string, GameNpc> {
  const lookup = new Map<string, GameNpc>();
  const add = (npc: GameNpc) => {
    if (!npc.name) return;
    lookup.set(buildPartyNpcId(npc.name), npc);
  };
  if (Array.isArray(metadataNpcs)) {
    for (const npc of metadataNpcs) {
      if (npc && typeof npc === "object" && typeof (npc as GameNpc).name === "string") {
        add(npc as GameNpc);
      }
    }
  }
  for (const npc of npcs) add(npc);
  return lookup;
}

function getActivePartyIds(chatMeta: Record<string, unknown>): string[] {
  if (Array.isArray(chatMeta.gamePartyCharacterIds)) {
    return (chatMeta.gamePartyCharacterIds as string[]).filter((id) => typeof id === "string" && id.trim().length > 0);
  }
  const config = chatMeta.gameSetupConfig as Record<string, unknown> | undefined;
  return Array.isArray(config?.partyCharacterIds)
    ? (config.partyCharacterIds as string[]).filter((id) => typeof id === "string" && id.trim().length > 0)
    : [];
}

function mergeUniqueIds(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().filter((id) => typeof id === "string" && id.trim().length > 0)));
}

function getChatCharacterIds(value: unknown): string[] {
  try {
    const rawIds = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  } catch {
    return [];
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractGameDialogueSpeakerNames(content: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /^\s*\[([^\]]+)]\s*\[(?:main|side|extra|action|thought|whisper(?::[^\]]+)?)\]/gim,
    /^\s*\[([^\]]+)]\s*(?:\[[^\]]+])?\s*:/gim,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1]?.trim();
      if (name && !name.includes(":")) names.add(name);
    }
  }

  return [...names];
}

function extractRecentGameDialogueSpeakerNames(messages: Message[], maxAssistantMessages = 30): string[] {
  const names = new Set<string>();
  let assistantMessagesSeen = 0;

  for (let i = messages.length - 1; i >= 0 && assistantMessagesSeen < maxAssistantMessages; i--) {
    const message = messages[i];
    if (!message || (message.role !== "assistant" && message.role !== "narrator")) continue;
    assistantMessagesSeen++;
    for (const name of extractGameDialogueSpeakerNames(message.content)) {
      names.add(name);
    }
  }

  return [...names];
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

function extractNarrationNpcCandidates(
  narration: string,
  excludedNames: string[],
): Array<{ name: string; description: string }> {
  const candidates = new Map<string, { name: string; description: string }>();
  const excluded = new Set(excludedNames.map(normalizeSceneAssetName));
  const addCandidate = (rawName: string) => {
    const name = rawName.trim();
    if (!name) return;

    const normalizedName = normalizeSceneAssetName(name);
    if (
      !normalizedName ||
      excluded.has(normalizedName) ||
      GENERIC_NPC_NAME_LABELS.has(normalizedName) ||
      candidates.has(normalizedName)
    ) {
      return;
    }

    candidates.set(normalizedName, {
      name,
      description: extractNarrationSnippetForName(narration, name),
    });
  };

  for (const speakerName of extractGameDialogueSpeakerNames(narration)) {
    addCandidate(speakerName);
  }

  const patterns = [
    /<speaker="([^"]+)">/gi,
    new RegExp(`(?:^|\\n)\\s*([A-Z][A-Za-z'’-]+(?:\\s+[A-Z][A-Za-z'’-]+)?)\\s*:\\s*["“«「]`, "gm"),
    new RegExp(
      `"[^"]+"[,.]?\\s+([A-Z][A-Za-z'’-]+(?:\\s+[A-Z][A-Za-z'’-]+)?)\\s+${NARRATION_NPC_SPEECH_VERB_PATTERN}\\b`,
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
      if (rawName) addCandidate(rawName);
    }
  }

  return [...candidates.values()];
}

function mergeSceneAssetNpcCandidates(
  trackedNpcs: GameNpc[],
  presentCharacters: SceneAssetPresentCharacter[],
  excludedNames: string[],
  currentLocation: string | null | undefined,
  narration: string,
): GameNpc[] {
  const excluded = new Set(excludedNames.map(normalizeSceneAssetName));
  const candidates = new Map<string, GameNpc>();

  for (const npc of trackedNpcs) {
    const normalizedName = normalizeSceneAssetName(npc.name);
    if (!normalizedName) continue;
    candidates.set(normalizedName, npc);
  }

  for (const presentCharacter of presentCharacters) {
    const name = typeof presentCharacter.name === "string" ? presentCharacter.name.trim() : "";
    if (!name) continue;

    const normalizedName = normalizeSceneAssetName(name);
    if (!normalizedName || excluded.has(normalizedName)) continue;

    const description = typeof presentCharacter.appearance === "string" ? presentCharacter.appearance.trim() : "";
    const avatarUrl =
      typeof presentCharacter.avatarPath === "string" && presentCharacter.avatarPath.trim()
        ? presentCharacter.avatarPath.trim()
        : null;
    const existing = candidates.get(normalizedName);

    if (!existing) continue;

    candidates.set(normalizedName, {
      ...existing,
      description: existing.description || description,
      location: existing.location || currentLocation || "",
      avatarUrl: existing.avatarUrl || avatarUrl,
      met: true,
    });
  }

  for (const candidate of extractNarrationNpcCandidates(narration, excludedNames)) {
    const normalizedName = normalizeSceneAssetName(candidate.name);
    if (!normalizedName) continue;

    const existing = candidates.get(normalizedName);
    if (!existing) continue;

    candidates.set(normalizedName, {
      ...existing,
      description: existing.description || candidate.description,
      met: true,
    });
  }

  return [...candidates.values()];
}

function buildNpcAvatarLookup(
  trackedNpcs: GameNpc[],
  presentCharacters: SceneAssetPresentCharacter[],
  metadataNpcs: unknown,
): Map<string, string> {
  const lookup = new Map<string, string>();
  const add = (name: unknown, avatarUrl: unknown) => {
    if (typeof name !== "string" || typeof avatarUrl !== "string") return;
    const normalizedName = normalizeSceneAssetName(name);
    const normalizedAvatarUrl = avatarUrl.trim();
    if (!normalizedName || !normalizedAvatarUrl) return;
    lookup.set(normalizedName, normalizedAvatarUrl);
  };

  for (const npc of trackedNpcs) add(npc.name, npc.avatarUrl);
  for (const presentCharacter of presentCharacters) add(presentCharacter.name, presentCharacter.avatarPath);
  if (Array.isArray(metadataNpcs)) {
    for (const npc of metadataNpcs) {
      if (!npc || typeof npc !== "object") continue;
      const record = npc as Record<string, unknown>;
      add(record.name, record.avatarUrl);
    }
  }

  return lookup;
}

const SpriteOverlay = lazy(async () => {
  const module = await import("../chat/SpriteOverlay");
  return { default: module.SpriteOverlay };
});

import { Modal } from "../ui/Modal";
import type {
  Chat,
  SessionSummary,
  Combatant,
  Message,
  GameCombatStateSnapshot,
} from "@marinara-engine/shared";
import type { CharacterMap, PersonaInfo } from "../chat/chat-area.types";

/** Typewriter component for the intro screen — reveals text character-by-character. */
function IntroTypewriter({ text, onComplete }: { text: string; onComplete?: () => void }) {
  const [visible, setVisible] = useState(0);
  const endRef = useRef<HTMLSpanElement>(null);
  const firedRef = useRef(false);
  useEffect(() => {
    if (visible >= text.length) {
      if (!firedRef.current) {
        firedRef.current = true;
        onComplete?.();
      }
      return;
    }
    const t = window.setTimeout(() => setVisible((v) => v + 1), 28);
    return () => window.clearTimeout(t);
  }, [visible, text.length, onComplete]);
  // Keep the reveal edge in view by scrolling the nearest scrollable ancestor.
  // A nested overflow-y-auto here blocks Android touch-scroll from reaching the
  // parent scroll container, so we don't create our own overflow on this div.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [visible]);
  return (
    <div>
      <p className="text-sm leading-relaxed text-[var(--foreground)]/70 dark:text-white/70 whitespace-pre-line">
        {text.slice(0, visible)}
        {visible < text.length && (
          <span className="animate-pulse text-[var(--foreground)]/40 dark:text-white/40">▌</span>
        )}
        <span ref={endRef} />
      </p>
    </div>
  );
}

function removeInventoryUnit<T extends { name: string; quantity: number }>(items: T[], itemName: string): T[] {
  const normalizedName = itemName.trim().toLowerCase();
  if (!normalizedName) return items;

  let removed = false;
  const updated: T[] = [];

  for (const item of items) {
    if (!removed && item.name.trim().toLowerCase() === normalizedName) {
      removed = true;
      const nextQuantity = item.quantity - 1;
      if (nextQuantity > 0) {
        updated.push({ ...item, quantity: nextQuantity });
      }
      continue;
    }
    updated.push(item);
  }

  return removed ? updated : items;
}

function addInventoryUnit<T extends { name: string; quantity: number }>(items: T[], itemName: string): T[] {
  const name = normalizeInventoryName(itemName);
  if (!name) return items;

  let addedToExisting = false;
  const updated = items.map((item) => {
    if (item.name.trim().toLowerCase() !== name.toLowerCase()) return item;
    addedToExisting = true;
    return { ...item, quantity: item.quantity + 1 };
  });

  return addedToExisting ? updated : [...updated, { name, quantity: 1 } as T];
}

function normalizeInventoryName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function getMissingBackgroundTag(
  backgroundTag: string | undefined | null,
  manifest: Record<string, { path: string }> | null,
): string | null {
  const cleaned = backgroundTag?.trim();
  if (!cleaned || cleaned === "black" || cleaned === "none") return null;
  const resolved = resolveAssetTag(cleaned, "backgrounds", manifest);
  return manifest?.[resolved] ? null : cleaned;
}

const DEFAULT_GAME_AUDIO_SETTINGS = {
  masterVolume: 50,
  musicVolume: 60,
  sfxVolume: 80,
  ttsVolume: 100,
  ambientVolume: 50,
  audioMuted: false,
};
const GAME_AUDIO_SETTINGS_STORAGE_KEY = "marinara-engine-game-audio";

type GameAudioSettings = typeof DEFAULT_GAME_AUDIO_SETTINGS;

function normalizeVolume(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : fallback;
}

function getEffectiveVolume(masterVolume: number, channelVolume: number): number {
  return (Math.max(0, Math.min(100, masterVolume)) / 100) * (Math.max(0, Math.min(100, channelVolume)) / 100);
}

function readPersistedGameAudioSettings(): GameAudioSettings {
  const defaults = {
    ...DEFAULT_GAME_AUDIO_SETTINGS,
    audioMuted:
      typeof window !== "undefined"
        ? localStorage.getItem("game-audio-muted") === "true"
        : DEFAULT_GAME_AUDIO_SETTINGS.audioMuted,
  };
  if (typeof window === "undefined") return defaults;

  try {
    const raw = localStorage.getItem(GAME_AUDIO_SETTINGS_STORAGE_KEY);
    if (!raw) return defaults;

    const parsed = JSON.parse(raw) as Partial<GameAudioSettings>;
    const masterVolume = normalizeVolume(parsed.masterVolume, defaults.masterVolume);
    const audioMuted = typeof parsed.audioMuted === "boolean" ? parsed.audioMuted : masterVolume === 0;

    return {
      masterVolume,
      musicVolume: normalizeVolume(parsed.musicVolume, defaults.musicVolume),
      sfxVolume: normalizeVolume(parsed.sfxVolume, defaults.sfxVolume),
      ttsVolume: normalizeVolume(parsed.ttsVolume, defaults.ttsVolume),
      ambientVolume: normalizeVolume(parsed.ambientVolume, defaults.ambientVolume),
      audioMuted: audioMuted || masterVolume === 0,
    };
  } catch {
    return defaults;
  }
}

function getNextInventoryItemName(items: Array<{ name: string }>): string {
  const baseName = "New item";
  const existingNames = new Set(items.map((item) => normalizeInventoryName(item.name).toLowerCase()));
  if (!existingNames.has(baseName.toLowerCase())) {
    return baseName;
  }

  let suffix = 2;
  while (existingNames.has(`${baseName} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read the selected image."));
    };
    reader.onerror = () => reject(new Error("Failed to read the selected image."));
    reader.readAsDataURL(file);
  });
}

type CombatStatusEffectLike = NonNullable<Combatant["statusEffects"]>[number];

type CombatStatusTemplate = {
  aliases: string[];
  name: string;
  stat: CombatStatusEffectLike["stat"];
  modifier: number;
  turnsLeft: number;
};

const COMBAT_STATUS_TEMPLATES: CombatStatusTemplate[] = [
  { aliases: ["bleed", "bleeding", "hemorrhage"], name: "Bleed", stat: "hp", modifier: -6, turnsLeft: 3 },
  { aliases: ["poison", "poisoned", "venom", "toxin"], name: "Poison", stat: "hp", modifier: -8, turnsLeft: 3 },
  { aliases: ["burn", "burning", "ignite", "scorch"], name: "Burn", stat: "hp", modifier: -7, turnsLeft: 3 },
  { aliases: ["blessing", "blessed", "bless"], name: "Blessing", stat: "attack", modifier: 4, turnsLeft: 3 },
  { aliases: ["regen", "regeneration", "regenerate"], name: "Regeneration", stat: "hp", modifier: 6, turnsLeft: 3 },
  { aliases: ["shield", "barrier", "ward", "guard"], name: "Barrier", stat: "defense", modifier: 4, turnsLeft: 2 },
  { aliases: ["haste", "quick", "swift"], name: "Haste", stat: "speed", modifier: 4, turnsLeft: 2 },
  { aliases: ["slow", "slowed", "chill", "chilled"], name: "Slow", stat: "speed", modifier: -4, turnsLeft: 2 },
  { aliases: ["stun", "stunned", "paralyze", "paralyzed"], name: "Stunned", stat: "speed", modifier: -6, turnsLeft: 1 },
  { aliases: ["weaken", "weakened", "curse", "cursed"], name: "Weakened", stat: "attack", modifier: -4, turnsLeft: 2 },
];

const COMBAT_STATUS_PARTY_TARGETS = new Set([
  "party",
  "all party",
  "whole party",
  "all allies",
  "allied party",
  "all players",
  "players",
  "all party members",
]);

const COMBAT_STATUS_ENEMY_TARGETS = new Set([
  "enemy",
  "enemies",
  "all enemies",
  "all foes",
  "foes",
  "monsters",
  "all monsters",
]);

function normalizeCombatStatusKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleizeCombatStatusName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function findCombatStatusTemplate(effectName: string): CombatStatusTemplate | null {
  const normalized = normalizeCombatStatusKey(effectName);
  return (
    COMBAT_STATUS_TEMPLATES.find((template) =>
      template.aliases.some((alias) => normalizeCombatStatusKey(alias) === normalized),
    ) ?? null
  );
}

function inferCombatStatusFallback(effectName: string): Omit<CombatStatusEffectLike, "name"> {
  const normalized = normalizeCombatStatusKey(effectName);

  if (/(bleed|poison|venom|burn|toxin|curse|corrode|rot|decay)/.test(normalized)) {
    return { stat: "hp", modifier: -5, turnsLeft: 3 };
  }
  if (/(regen|recovery|recover|mend|heal|restoration)/.test(normalized)) {
    return { stat: "hp", modifier: 5, turnsLeft: 3 };
  }
  if (/(bless|fury|rage|focus|strength|empower)/.test(normalized)) {
    return { stat: "attack", modifier: 4, turnsLeft: 3 };
  }
  if (/(shield|barrier|ward|guard|protect|fortify|stone)/.test(normalized)) {
    return { stat: "defense", modifier: 4, turnsLeft: 2 };
  }
  if (/(haste|quick|swift|accelerat)/.test(normalized)) {
    return { stat: "speed", modifier: 4, turnsLeft: 2 };
  }
  if (/(slow|freeze|stun|chill|paraly)/.test(normalized)) {
    return { stat: "speed", modifier: -4, turnsLeft: 2 };
  }
  if (/(weak|blind|fear|hex)/.test(normalized)) {
    return { stat: "attack", modifier: -4, turnsLeft: 2 };
  }

  return { stat: "hp", modifier: -4, turnsLeft: 2 };
}

function buildCombatStatusEffect(tag: CombatStatusTag): CombatStatusEffectLike {
  const template = findCombatStatusTemplate(tag.effect);
  const fallback = template
    ? { stat: template.stat, modifier: template.modifier, turnsLeft: template.turnsLeft }
    : inferCombatStatusFallback(tag.effect);

  return {
    name: template?.name ?? (titleizeCombatStatusName(tag.effect) || "Status"),
    stat: tag.stat ?? fallback.stat,
    modifier: tag.modifier ?? fallback.modifier,
    turnsLeft: Math.max(1, Math.trunc(tag.turns ?? fallback.turnsLeft)),
  };
}

function matchesCombatStatusTarget(target: string, combatant: Combatant): boolean {
  const normalizedTarget = normalizeCombatStatusKey(target);
  const normalizedName = normalizeCombatStatusKey(combatant.name);
  const normalizedId = normalizeCombatStatusKey(combatant.id);

  return (
    normalizedName === normalizedTarget ||
    normalizedId === normalizedTarget ||
    normalizedName.includes(normalizedTarget) ||
    normalizedTarget.includes(normalizedName)
  );
}

function upsertCombatStatusEffect(
  effects: CombatStatusEffectLike[] | undefined,
  nextEffect: CombatStatusEffectLike,
): CombatStatusEffectLike[] {
  const existingEffects = effects ?? [];
  const normalizedNextName = normalizeCombatStatusKey(nextEffect.name);
  const existingIndex = existingEffects.findIndex(
    (effect) => normalizeCombatStatusKey(effect.name) === normalizedNextName,
  );

  if (existingIndex === -1) {
    return [...existingEffects, nextEffect];
  }

  return existingEffects.map((effect, index) => {
    if (index !== existingIndex) return effect;
    return {
      ...effect,
      ...nextEffect,
      turnsLeft: Math.max(effect.turnsLeft, nextEffect.turnsLeft),
    };
  });
}

function applyCombatStatusTagsToCombatants(
  party: Combatant[],
  enemies: Combatant[],
  tags: CombatStatusTag[],
): { party: Combatant[]; enemies: Combatant[]; appliedCount: number } {
  let nextParty = party;
  let nextEnemies = enemies;
  let appliedCount = 0;

  for (const tag of tags) {
    const normalizedTarget = normalizeCombatStatusKey(tag.target);
    const applyToParty = COMBAT_STATUS_PARTY_TARGETS.has(normalizedTarget);
    const applyToEnemies = COMBAT_STATUS_ENEMY_TARGETS.has(normalizedTarget);
    const effect = buildCombatStatusEffect(tag);

    if (applyToParty) {
      nextParty = nextParty.map((combatant) => ({
        ...combatant,
        statusEffects: upsertCombatStatusEffect(combatant.statusEffects, effect),
      }));
      appliedCount += nextParty.length;
      continue;
    }

    if (applyToEnemies) {
      nextEnemies = nextEnemies.map((combatant) => ({
        ...combatant,
        statusEffects: upsertCombatStatusEffect(combatant.statusEffects, effect),
      }));
      appliedCount += nextEnemies.length;
      continue;
    }

    let matched = false;
    nextParty = nextParty.map((combatant) => {
      if (!matchesCombatStatusTarget(tag.target, combatant)) return combatant;
      matched = true;
      return {
        ...combatant,
        statusEffects: upsertCombatStatusEffect(combatant.statusEffects, effect),
      };
    });
    nextEnemies = nextEnemies.map((combatant) => {
      if (!matchesCombatStatusTarget(tag.target, combatant)) return combatant;
      matched = true;
      return {
        ...combatant,
        statusEffects: upsertCombatStatusEffect(combatant.statusEffects, effect),
      };
    });
    if (matched) appliedCount += 1;
  }

  return { party: nextParty, enemies: nextEnemies, appliedCount };
}

function normalizeCombatElement(value: string): string {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    fire: "pyro",
    flame: "pyro",
    ice: "cryo",
    frost: "cryo",
    lightning: "electro",
    thunder: "electro",
    water: "hydro",
    wind: "anemo",
    earth: "geo",
    stone: "geo",
    nature: "dendro",
    plant: "dendro",
  };
  return aliases[normalized] ?? normalized;
}

function applyElementAttackTagsToCombatants(
  party: Combatant[],
  enemies: Combatant[],
  tags: ElementAttackTag[],
): { party: Combatant[]; enemies: Combatant[]; appliedCount: number } {
  let appliedCount = 0;
  const applyTag = (combatant: Combatant, tag: ElementAttackTag): Combatant => ({
    ...combatant,
    elementAura: {
      element: normalizeCombatElement(tag.element),
      gauge: 1,
      sourceId: `gm:${normalizeCombatStatusKey(tag.target)}:${normalizeCombatElement(tag.element)}`,
    },
  });

  const nextParty = party.map((combatant) => {
    const tag = tags.find((candidate) => matchesCombatStatusTarget(candidate.target, combatant));
    if (!tag) return combatant;
    appliedCount += 1;
    return applyTag(combatant, tag);
  });

  const nextEnemies = enemies.map((combatant) => {
    const tag = tags.find((candidate) => matchesCombatStatusTarget(candidate.target, combatant));
    if (!tag) return combatant;
    appliedCount += 1;
    return applyTag(combatant, tag);
  });

  return { party: nextParty, enemies: nextEnemies, appliedCount };
}

function renameInventoryItem<T extends { name: string; quantity: number }>(
  items: T[],
  currentName: string,
  nextName: string,
): { items: T[]; resolvedName: string } | null {
  const normalizedCurrentName = normalizeInventoryName(currentName).toLowerCase();
  const cleanedNextName = normalizeInventoryName(nextName);
  if (!normalizedCurrentName || !cleanedNextName) return null;

  const sourceIndex = items.findIndex(
    (item) => normalizeInventoryName(item.name).toLowerCase() === normalizedCurrentName,
  );
  if (sourceIndex === -1) return null;

  const sourceItem = items[sourceIndex]!;
  if (normalizeInventoryName(sourceItem.name) === cleanedNextName) {
    return { items, resolvedName: sourceItem.name };
  }

  const normalizedNextName = cleanedNextName.toLowerCase();
  const mergeIndex = items.findIndex(
    (item, index) => index !== sourceIndex && normalizeInventoryName(item.name).toLowerCase() === normalizedNextName,
  );

  if (mergeIndex === -1) {
    return {
      items: items.map((item, index) => (index === sourceIndex ? { ...item, name: cleanedNextName } : item)),
      resolvedName: cleanedNextName,
    };
  }

  const mergeTarget = items[mergeIndex]!;
  const mergeTargetRecord = mergeTarget as T & Record<string, unknown>;
  const sourceRecord = sourceItem as T & Record<string, unknown>;
  const sourceDescription = typeof sourceRecord.description === "string" ? sourceRecord.description.trim() : "";
  const targetDescription =
    typeof mergeTargetRecord.description === "string" ? mergeTargetRecord.description.trim() : "";
  const sourceLocation = typeof sourceRecord.location === "string" ? sourceRecord.location.trim() : "";
  const targetLocation = typeof mergeTargetRecord.location === "string" ? mergeTargetRecord.location.trim() : "";
  const mergedItem = {
    ...mergeTarget,
    quantity: mergeTarget.quantity + sourceItem.quantity,
    ...(!targetDescription && sourceDescription ? { description: sourceDescription } : {}),
    ...(!targetLocation && sourceLocation ? { location: sourceLocation } : {}),
  } as T;

  return {
    items: items.flatMap((item, index) => {
      if (index === sourceIndex) return [];
      if (index === mergeIndex) return [mergedItem as T];
      return [item];
    }),
    resolvedName: normalizeInventoryName(mergeTarget.name) || cleanedNextName,
  };
}

import {
  AlertTriangle,
  BookOpen,
  HelpCircle,
  History,
  Image,
  Loader2,
  MoreHorizontal,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Settings2,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

interface GameVolumeMixerProps {
  audioMuted: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ttsVolume: number;
  ambientVolume: number;
  onMasterVolumeChange: (value: number) => void;
  onMusicVolumeChange: (value: number) => void;
  onSfxVolumeChange: (value: number) => void;
  onTtsVolumeChange: (value: number) => void;
  onAmbientVolumeChange: (value: number) => void;
  onToggleMute: () => void;
  className?: string;
}

function GameVolumeMixer({
  audioMuted,
  masterVolume,
  musicVolume,
  sfxVolume,
  ttsVolume,
  ambientVolume,
  onMasterVolumeChange,
  onMusicVolumeChange,
  onSfxVolumeChange,
  onTtsVolumeChange,
  onAmbientVolumeChange,
  onToggleMute,
  className,
}: GameVolumeMixerProps) {
  const rows = [
    { id: "master", label: "Master", value: masterVolume, onChange: onMasterVolumeChange },
    { id: "music", label: "Music", value: musicVolume, onChange: onMusicVolumeChange },
    { id: "sfx", label: "Sound Effects", value: sfxVolume, onChange: onSfxVolumeChange },
    { id: "tts", label: "TTS", value: ttsVolume, onChange: onTtsVolumeChange },
    { id: "ambient", label: "Ambient", value: ambientVolume, onChange: onAmbientVolumeChange },
  ];

  return (
    <div
      className={cn(
        "w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/15 bg-black/85 p-3 shadow-xl backdrop-blur-md",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-white/10 pb-2">
        <span className="text-[0.6875rem] font-semibold uppercase text-white/60">Volume</span>
        <button
          onClick={onToggleMute}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
            audioMuted
              ? "bg-red-500/30 text-red-300 hover:bg-red-500/50"
              : "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white",
          )}
          title={audioMuted ? "Unmute" : "Mute"}
          aria-label={audioMuted ? "Unmute" : "Mute"}
        >
          {audioMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
        </button>
      </div>

      <div className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <label key={row.id} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2">
            <span className="truncate text-[0.6875rem] text-white/70">{row.label}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={row.value}
              onChange={(e) => row.onChange(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer accent-[var(--primary)]"
            />
            <span className="text-right text-[0.6875rem] tabular-nums text-white/55">{row.value}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Randomly sample up to `max` items from an array (Fisher-Yates shuffle). */
function sampleTags(tags: string[], max: number): string[] {
  if (tags.length <= max) return tags;
  const shuffled = [...tags];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled.slice(0, max);
}

function backgroundOptionKey(tag: string): string {
  let slug = tag
    .trim()
    .toLowerCase()
    .replace(/:/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefixPattern = /^(?:backgrounds|fantasy|modern|scifi|user|generated|illustrations|q-[a-z0-9]{6,})-+/;
  while (prefixPattern.test(slug)) {
    slug = slug.replace(prefixPattern, "");
  }
  return slug || tag.trim().toLowerCase();
}

function getSceneBackgroundTags(assetKeys: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of assetKeys) {
    if (!key.startsWith("backgrounds:") || key.startsWith("backgrounds:illustrations:")) continue;
    const dedupeKey = backgroundOptionKey(key);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(key);
  }
  return result;
}

const RECENT_MUSIC_HISTORY_LIMIT = 8;
const GAME_START_GENERATION_GUIDE =
  "Begin the game now with the first visible GM VN narration/dialogue segment. This is an invisible startup trigger, not a player action. Do not mention a start command.";
const SYNTHETIC_GAME_START_MESSAGE_RE = /^\s*\[start(?:\s+the)?\s+game\]\s*$/i;

function normalizeRecentMusicHistory(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string" && tag.length > 0) : [];
}

function appendRecentMusic(history: string[], tag: string | null | undefined): string[] {
  if (!tag) return history.slice(0, RECENT_MUSIC_HISTORY_LIMIT);
  return [tag, ...history.filter((entry) => entry !== tag)].slice(0, RECENT_MUSIC_HISTORY_LIMIT);
}

function formatCombatLogContent(message: Message): string {
  const content = message.content.trim();
  if (!content) return "";
  if (message.role === "user" && SYNTHETIC_GAME_START_MESSAGE_RE.test(content)) return "";
  if (message.role === "assistant" || message.role === "narrator") {
    return parseGmTags(content).cleanContent || content;
  }
  return content.replace(/^\[(?:To the party|To the GM)]\s*/i, "").trim();
}

function buildSegmentEditMap(chatMeta: Record<string, unknown>): Map<string, GameSegmentEdit> {
  const map = new Map<string, GameSegmentEdit>();
  for (const [key, value] of Object.entries(chatMeta)) {
    if (!key.startsWith("segmentEdit:")) continue;
    const edit = normalizeGameSegmentEdit(value);
    if (edit) {
      map.set(key.slice("segmentEdit:".length), edit);
    }
  }
  return map;
}

function buildSegmentDeleteSet(chatMeta: Record<string, unknown>): Set<string> {
  const deleted = new Set<string>();
  for (const [key, value] of Object.entries(chatMeta)) {
    if (key.startsWith("segmentDelete:") && (value === true || value === "true")) {
      deleted.add(key.slice("segmentDelete:".length));
    }
  }
  return deleted;
}

function slugifyGameMapId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getGameMapId(map: GameMap | null | undefined, fallbackIndex = 0): string | null {
  if (!map) return null;
  const explicit = map.id?.trim();
  if (explicit) return explicit;
  return slugifyGameMapId(map.name || "") || `map-${fallbackIndex + 1}`;
}

interface GameSurfaceProps {
  activeChatId: string;
  chat: Chat;
  chatMeta: Record<string, unknown>;
  messages: Message[];
  isStreaming: boolean;
  isMessagesLoading: boolean;
  characterMap: CharacterMap;
  characters: Array<{
    id: string;
    name: string;
    comment?: string | null;
    avatarUrl?: string;
    description?: string;
    personality?: string;
    backstory?: string;
    appearance?: string;
    tags?: string[];
    avatarCrop?: { zoom: number; offsetX: number; offsetY: number } | null;
    nameColor?: string;
    dialogueColor?: string;
  }>;
  personaInfo?: PersonaInfo;
  chatBackground?: string | null;
  onOpenSettings: () => void;
  onDeleteMessage: (messageId: string) => void;
}

export function GameSurface({
  activeChatId,
  chat,
  chatMeta,
  messages,
  isStreaming,
  characterMap,
  characters,
  personaInfo,
  chatBackground: _chatBackground,
  onOpenSettings,
  onDeleteMessage,
  isMessagesLoading,
}: GameSurfaceProps) {
  // Sync game metadata → store
  useSyncGameState(activeChatId, chatMeta);

  const {
    gameState,
    currentMap,
    maps,
    activeMapId,
    sessionNumber,
    isSetupActive,
    diceRollResult,
    npcs,
    hudWidgets,
    blueprint,
    characterSheetOpen,
    characterSheetCharId,
  } = useGameModeStore(
    useShallow((s) => ({
      gameState: s.gameState,
      currentMap: s.currentMap,
      maps: s.maps,
      activeMapId: s.activeMapId,
      sessionNumber: s.sessionNumber,
      isSetupActive: s.isSetupActive,
      diceRollResult: s.diceRollResult,
      npcs: s.npcs,
      hudWidgets: s.hudWidgets,
      blueprint: s.blueprint,
      characterSheetOpen: s.characterSheetOpen,
      characterSheetCharId: s.characterSheetCharId,
    })),
  );

  const closeCharacterSheet = useGameModeStore((s) => s.closeCharacterSheet);
  const applyWidgetUpdate = useGameModeStore((s) => s.applyWidgetUpdate);
  const setDiceRollResult = useGameModeStore((s) => s.setDiceRollResult);
  const weatherEffectsEnabled = useUIStore((s) => s.weatherEffects);
  const gameTutorialDisabled = useUIStore((s) => s.gameTutorialDisabled);
  const setGameTutorialDisabled = useUIStore((s) => s.setGameTutorialDisabled);
  const gameAvatarScale = useUIStore((s) => s.gameAvatarScale);
  const gameMiddleMouseNav = useUIStore((s) => s.gameMiddleMouseNav);
  const messagesPerPage = useUIStore((s) => s.messagesPerPage);
  const gameSnapshot = useGameStateStore((s) => (s.current?.chatId === activeChatId ? s.current : null));
  const chatCharacterIds = useMemo(() => getChatCharacterIds(chat.characterIds), [chat.characterIds]);

  const sceneWrapCharacterNames = useMemo(() => {
    const partyIds = mergeUniqueIds(getActivePartyIds(chatMeta), chatCharacterIds);
    const npcByPartyId = buildPartyNpcLookup(npcs, chatMeta.gameNpcs);
    const names = partyIds
      .map(
        (id) =>
          characters.find((character) => character.id === id)?.name ??
          characterMap.get(id)?.name ??
          npcByPartyId.get(id)?.name ??
          null,
      )
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map((name) => name.trim());

    if (personaInfo?.name?.trim()) {
      names.unshift(personaInfo.name.trim());
    } else {
      names.unshift("Player");
    }

    return [...new Set(names)].slice(0, 100);
  }, [characterMap, characters, chatCharacterIds, chatMeta, npcs, personaInfo?.name]);

  /** Build weather string from chatMeta.gameWeather if available. */
  const metaWeather = (chatMeta.gameWeather as { type?: string; temperature?: number } | undefined)?.type ?? null;
  const gameTimeMeta = chatMeta.gameTime as GameTimeMeta | undefined;
  const currentGameDay = useMemo(
    () => normalizeGameDay(gameTimeMeta?.day ?? parseGameDayFromTimeLabel(gameSnapshot?.time) ?? 1),
    [gameSnapshot?.time, gameTimeMeta?.day],
  );
  const metaTime = useMemo(() => {
    const gt = gameTimeMeta;
    if (!gt || gt.hour == null) return null;
    return formatGameTimeForHud({
      day: normalizeGameDay(gt.day),
      hour: normalizeGameHour(gt.hour),
      minute: normalizeGameMinute(gt.minute),
    });
  }, [gameTimeMeta]);

  // ── Fetch game state on mount (WeatherEffects needs weather/time from the DB) ──
  useEffect(() => {
    const existing = useGameStateStore.getState().current;
    if (existing?.chatId === activeChatId) return;
    api
      .get<import("@marinara-engine/shared").GameState | null>(`/chats/${activeChatId}/game-state`)
      .then((gs) => {
        if (gs) {
          useGameStateStore.getState().setGameState(gs);
        }
      })
      .catch(() => {});
  }, [activeChatId]);

  // ── Patch game state snapshot with chatMeta weather/time when the snapshot is missing them ──
  // This handles: (a) server snapshot has no weather/time, (b) chatMeta loaded after the fetch,
  // (c) no server snapshot at all (creates a minimal one from chatMeta).
  useEffect(() => {
    if (!metaWeather && !metaTime) return;
    const current = useGameStateStore.getState().current;

    if (current?.chatId === activeChatId) {
      // Snapshot exists — enrich missing fields
      if ((!current.weather && metaWeather) || (!current.time && metaTime)) {
        useGameStateStore.getState().setGameState({
          ...current,
          ...(!current.weather && metaWeather ? { weather: metaWeather } : {}),
          ...(!current.time && metaTime ? { time: metaTime } : {}),
        });
      }
    } else {
      // No snapshot at all — create minimal from chatMeta so WeatherEffects renders
      useGameStateStore.getState().setGameState({
        id: "",
        chatId: activeChatId,
        messageId: "",
        swipeIndex: 0,
        date: null,
        time: metaTime,
        location: null,
        weather: metaWeather,
        temperature: null,
        presentCharacters: [],
        recentEvents: [],
        playerStats: null,
        personaStats: null,
        createdAt: "",
      });
    }
  }, [activeChatId, metaWeather, metaTime]);

  // ── Client-side backup: ensure location is added to journal when game state reports one ──
  const lastJournaledLocationRef = useRef<string | null>(null);
  useEffect(() => {
    const loc = gameSnapshot?.location;
    if (!loc || loc === lastJournaledLocationRef.current) return;
    lastJournaledLocationRef.current = loc;
    // Fire-and-forget: addLocationEntry on the server dedupes, so this is safe to call redundantly
    api
      .post("/game/journal/entry", {
        chatId: activeChatId,
        type: "location",
        data: { location: loc, description: `The party is at ${loc}.` },
      })
      .catch(() => {});
  }, [activeChatId, gameSnapshot?.location]);

  // Asset store
  const queryClient = useQueryClient();
  const assetManifest = useGameAssetStore((s) => s.manifest);
  const currentBackground = useGameAssetStore((s) => s.currentBackground);
  const audioMuted = useGameAssetStore((s) => s.audioMuted);
  const fetchManifest = useGameAssetStore((s) => s.fetchManifest);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [combatLogsOpen, setCombatLogsOpen] = useState(false);
  const combatLogScrolledRef = useRef(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [mobileRetryMenuOpen, setMobileRetryMenuOpen] = useState(false);
  const [confirmEndSessionOpen, setConfirmEndSessionOpen] = useState(false);
  const [nextSessionRequest, setNextSessionRequest] = useState("");
  const [jsonRepairRequest, setJsonRepairRequest] = useState<JsonRepairRequest | null>(null);
  const [prepareSessionWidgetsOpen, setPrepareSessionWidgetsOpen] = useState(false);
  const [savingSessionSummary, setSavingSessionSummary] = useState<number | null>(null);
  const [savingCurrentSessionSecrets, setSavingCurrentSessionSecrets] = useState(false);
  const [activeChoices, setActiveChoices] = useState<string[] | null>(null);
  const [activeQte, setActiveQte] = useState<{ actions: string[]; timer: number } | null>(null);
  const [queuedQte, setQueuedQte] = useState<{ qte: { actions: string[]; timer: number }; messageId: string } | null>(
    null,
  );
  const [combatParty, setCombatParty] = useState<Combatant[] | null>(null);
  const [combatEnemies, setCombatEnemies] = useState<Combatant[] | null>(null);
  const [pendingEncounter, setPendingEncounter] = useState<CombatEncounterTag | null>(null);
  const [queuedEncounter, setQueuedEncounter] = useState<{ encounter: CombatEncounterTag; messageId: string } | null>(
    null,
  );
  const [queuedCombatGeneration, setQueuedCombatGeneration] = useState<{ messageId: string } | null>(null);
  const [combatGenerationPending, setCombatGenerationPending] = useState(false);
  const [combatItemEffects, setCombatItemEffects] = useState<CombatItemEffect[]>([]);
  const [combatMechanics, setCombatMechanics] = useState<CombatMechanic[]>([]);
  const [combatDialogueCues, setCombatDialogueCues] = useState<CombatDialogueCue[]>([]);
  const [queuedCombatStatuses, setQueuedCombatStatuses] = useState<{
    statuses: CombatStatusTag[];
    messageId: string;
  } | null>(null);
  const [pendingSkillCheck, setPendingSkillCheck] = useState<import("@marinara-engine/shared").SkillCheckResult | null>(
    null,
  );
  const [pendingReaction, setPendingReaction] = useState<{
    reaction: string;
    description: string;
    damageMultiplier: number;
    attackerName: string;
    defenderName: string;
    element?: string;
  } | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState<{ name: string; avatarUrl: string; expression?: string } | null>(
    null,
  );
  const [combatSpriteSuggestion, setCombatSpriteSuggestion] = useState<{ name: string; pose: string } | null>(null);
  const [combatStartMessageId, setCombatStartMessageId] = useState<string | null>(null);
  const [activeDirections, setActiveDirections] = useState<DirectionCommand[]>([]);
  const [partyDialogue, setPartyDialogue] = useState<PartyDialogueLine[]>([]);
  // Populated only from legacy `[party-chat]` history messages so existing saves
  // still render party overlay boxes. Never set by a new-turn pipeline — the GM
  // now voices party members inline via the `[Name] [main] ...` format.
  const [partyChatMessageId, setPartyChatMessageId] = useState<string | null>(null);
  // The active assistant message ID whose typewriter is currently complete, or null if
  // either no message is finished typing or it's the *previous* turn's completion.
  // We track the message ID rather than a boolean so a stale completion from the
  // previous turn cannot unlock interactions on the new turn — the derived
  // `narrationDone` flag below recomputes each render against the latest assistant
  // message, so encounter gates, choice rendering, map movement, inventory, etc. all
  // get the same scope-correct view of completion.
  const [narrationDoneMsgId, setNarrationDoneMsgId] = useState<string | null>(null);
  const handleNarrationComplete = useCallback((complete: boolean, messageId: string | null) => {
    setNarrationDoneMsgId(complete ? messageId : null);
  }, []);
  const [directionsPlaying, setDirectionsPlaying] = useState(false);
  const [pendingSegmentEffects, setPendingSegmentEffects] = useState<SceneSegmentEffect[]>([]);
  const [pendingInventorySegmentUpdates, setPendingInventorySegmentUpdates] = useState<
    Array<{ segment: number; update: InventoryTag }>
  >([]);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<Array<{ name: string; quantity: number }>>(() => {
    return (chatMeta.gameInventory as Array<{ name: string; quantity: number }>) ?? [];
  });
  const [inventoryNotifications, setInventoryNotifications] = useState<string[]>([]);
  const [removingPartyMemberId, setRemovingPartyMemberId] = useState<string | null>(null);
  const [pendingMapMove, setPendingMapMove] = useState<{
    position: { x: number; y: number } | string;
    label: string;
  } | null>(null);
  const [viewedMapId, setViewedMapId] = useState<string | null>(null);
  const [startGameRequested, setStartGameRequested] = useState(false);
  const [startSessionRequested, setStartSessionRequested] = useState(false);
  const [activeReadable, setActiveReadable] = useState<JournalReadable | null>(null);
  const readableQueueRef = useRef<JournalReadable[]>([]);
  const recentMusicHistoryRef = useRef<string[]>(normalizeRecentMusicHistory(chatMeta.gameRecentMusic));
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startGameGuardRef = useRef(false);
  const startSessionGuardRef = useRef(false);
  const processedPartyChangeCommandsRef = useRef<Set<string>>(new Set());
  const appliedCombatStatusMessageIdsRef = useRef<Set<string>>(new Set());
  const appliedCombatElementMessageIdsRef = useRef<Set<string>>(new Set());
  const recruitPartyMember = useRecruitPartyMember();
  const removePartyMember = useRemovePartyMember();
  const availableMaps = useMemo(() => (maps.length > 0 ? maps : currentMap ? [currentMap] : []), [currentMap, maps]);
  const viewedMap = useMemo(() => {
    const findById = (mapId: string | null | undefined) =>
      mapId ? (availableMaps.find((map, index) => getGameMapId(map, index) === mapId) ?? null) : null;
    return findById(viewedMapId) ?? findById(activeMapId) ?? currentMap ?? availableMaps[0] ?? null;
  }, [activeMapId, availableMaps, currentMap, viewedMapId]);
  const effectiveViewedMapId = useMemo(() => {
    if (!viewedMap) return null;
    const index = availableMaps.findIndex((map) => map === viewedMap || getGameMapId(map) === getGameMapId(viewedMap));
    return getGameMapId(viewedMap, index >= 0 ? index : 0);
  }, [availableMaps, viewedMap]);
  const viewedMapIsActive = !effectiveViewedMapId || !activeMapId || effectiveViewedMapId === activeMapId;
  const handleViewedMapChange = useCallback(
    (mapId: string) => setViewedMapId(mapId === activeMapId ? null : mapId),
    [activeMapId],
  );

  useEffect(() => {
    processedPartyChangeCommandsRef.current.clear();
    appliedCombatStatusMessageIdsRef.current.clear();
    appliedCombatElementMessageIdsRef.current.clear();
    setQueuedCombatStatuses(null);
    setQueuedCombatGeneration(null);
    setCombatGenerationPending(false);
    setCombatItemEffects([]);
    setCombatMechanics([]);
    setCombatDialogueCues([]);
  }, [activeChatId]);

  const handlePartyChangeCommands = useCallback(
    (messageId: string, changes: PartyChangeTag[]) => {
      if (!activeChatId || changes.length === 0) return;
      for (const partyChange of changes) {
        const characterName = partyChange.characterName.trim();
        if (!characterName) continue;
        const commandKey = `${messageId}:${partyChange.change}:${characterName.toLowerCase()}`;
        if (processedPartyChangeCommandsRef.current.has(commandKey)) continue;
        processedPartyChangeCommandsRef.current.add(commandKey);
        const mutation = partyChange.change === "add" ? recruitPartyMember : removePartyMember;
        mutation.mutate(
          { chatId: activeChatId, characterName },
          {
            onError: () => {
              processedPartyChangeCommandsRef.current.delete(commandKey);
            },
          },
        );
      }
    },
    [activeChatId, recruitPartyMember, removePartyMember],
  );

  const upsertReadableJournalEntry = useCallback(
    (readable: JournalReadable) => {
      if (!activeChatId) return;

      api
        .post("/game/journal/entry", {
          chatId: activeChatId,
          type: "note",
          data: {
            title: readable.type === "book" ? "Book" : "Note",
            content: readable.content,
            readableType: readable.type,
            sourceMessageId: readable.sourceMessageId,
            sourceSegmentIndex: readable.sourceSegmentIndex,
          },
        })
        .catch(() => {});
    },
    [activeChatId],
  );

  // Handle readable segments from GameNarration: queue them and show one at a time
  const handleReadable = useCallback(
    (readable: JournalReadable) => {
      upsertReadableJournalEntry(readable);

      if (activeReadable) {
        // Another readable is already open — queue this one
        readableQueueRef.current.push(readable);
      } else {
        setActiveReadable(readable);
      }
    },
    [activeReadable, upsertReadableJournalEntry],
  );

  // Derive segment edit overlays from chatMeta, with local state for optimistic updates
  const [segmentEdits, setSegmentEdits] = useState(() => buildSegmentEditMap(chatMeta));
  const [segmentDeletes, setSegmentDeletes] = useState(() => buildSegmentDeleteSet(chatMeta));
  // Re-sync from chatMeta when it changes (e.g. page refresh loads new metadata)
  useEffect(() => {
    setSegmentEdits(buildSegmentEditMap(chatMeta));
    setSegmentDeletes(buildSegmentDeleteSet(chatMeta));
  }, [chatMeta]);

  const appliedSegmentsRef = useRef<Set<number>>(new Set());
  const appliedInventorySegmentsRef = useRef<Set<number>>(new Set());
  const introPlayedRef = useRef(false);
  const [introCinematicActive, setIntroCinematicActive] = useState(false);
  const [introTypewriterDone, setIntroTypewriterDone] = useState(false);
  const [sceneAnalysisFailed, setSceneAnalysisFailed] = useState(false);
  const [sceneStuckVisible, setSceneStuckVisible] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(false);
  const [pendingAssetGeneration, setPendingAssetGeneration] = useState<GameAssetGenerationPayload | null>(null);
  const [assetGenerationFailed, setAssetGenerationFailed] = useState(false);
  const [imagePromptReviewItems, setImagePromptReviewItems] = useState<GameImagePromptReviewItem[]>([]);
  const [imagePromptReviewSubmitting, setImagePromptReviewSubmitting] = useState(false);
  const imagePromptReviewResolveRef = useRef<((overrides: GameImagePromptOverride[] | null) => void) | null>(null);
  const [volumePopoverOpen, setVolumePopoverOpen] = useState(false);
  const [retryMenuOpen, setRetryMenuOpen] = useState(false);
  const [persistedGameAudioSettings] = useState(readPersistedGameAudioSettings);
  const [masterVolume, setMasterVolume] = useState(persistedGameAudioSettings.masterVolume);
  const [musicVolume, setMusicVolume] = useState(persistedGameAudioSettings.musicVolume);
  const [sfxVolume, setSfxVolume] = useState(persistedGameAudioSettings.sfxVolume);
  const [ttsVolume, setTtsVolume] = useState(persistedGameAudioSettings.ttsVolume);
  const [ambientVolume, setAmbientVolume] = useState(persistedGameAudioSettings.ambientVolume);
  const [audioSettingsHydrated, setAudioSettingsHydrated] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [compactHudWidgets, setCompactHudWidgets] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  const tutorialAutoTriggeredRef = useRef(false);
  const volumePopoverRef = useRef<HTMLDivElement>(null);
  const mobileVolumePopoverRef = useRef<HTMLDivElement>(null);
  const retryMenuRef = useRef<HTMLDivElement>(null);
  const hudSurfaceRef = useRef<HTMLDivElement>(null);
  const compactHudWidgetsRef = useRef(compactHudWidgets);
  const compactHudReleaseWidthRef = useRef<number | null>(null);
  const lastProcessedMsgRef = useRef<string | null>(null);
  const weatherMsgRef = useRef<string | null>(null);
  const sceneAnalysisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAssetGenerationKeyRef = useRef<string | null>(null);
  const introPresentationStorageKey = `game-intro-presented:${activeChatId}`;
  const assistantTurnCount = useMemo(
    () => messages.filter((m) => (m.role === "assistant" || m.role === "narrator") && !!m.content.trim()).length,
    [messages],
  );
  const [introPresented, setIntroPresented] = useState(false);
  const npcPortraitUploadInputRef = useRef<HTMLInputElement>(null);
  const [pendingNpcPortraitUploadName, setPendingNpcPortraitUploadName] = useState<string | null>(null);

  const narrationAutoPlayBlocked =
    !!activeReadable ||
    !!activeQte ||
    historyOpen ||
    journalOpen ||
    galleryOpen ||
    combatLogsOpen ||
    inventoryOpen ||
    tutorialOpen ||
    confirmEndSessionOpen ||
    mobileActionsOpen;
  const effectiveGameVoiceVolume = audioMuted || masterVolume === 0 ? 0 : getEffectiveVolume(masterVolume, ttsVolume);

  useEffect(() => {
    let persisted = false;
    try {
      persisted = localStorage.getItem(introPresentationStorageKey) === "1";
    } catch {
      persisted = false;
    }
    setIntroPresented(persisted || assistantTurnCount > 1);
  }, [introPresentationStorageKey, assistantTurnCount]);

  useEffect(() => {
    useGameAssetStore
      .getState()
      .setAudioMuted(persistedGameAudioSettings.audioMuted || persistedGameAudioSettings.masterVolume === 0);
    setAudioSettingsHydrated(true);
  }, [persistedGameAudioSettings]);

  // Clear stale party dialogue when switching chats (M7)
  const prevActiveChatRef = useRef(activeChatId);
  useEffect(() => {
    if (prevActiveChatRef.current === activeChatId) return; // skip initial mount
    prevActiveChatRef.current = activeChatId;
    recentMusicHistoryRef.current = normalizeRecentMusicHistory(chatMeta.gameRecentMusic);
    setPartyDialogue([]);
    setPartyChatMessageId(null);
    setQueuedQte(null);
    setQueuedEncounter(null);
    setQueuedCombatGeneration(null);
    setCombatGenerationPending(false);
    setCombatItemEffects([]);
    setCombatMechanics([]);
    setCombatDialogueCues([]);
    setPendingEncounter(null);
    setCombatParty(null);
    setCombatEnemies(null);
    setCombatSpriteSuggestion(null);
    setNarrationDoneMsgId(null);
    lastProcessedMsgRef.current = null;
    // Reset inventory/readables for the new chat
    setInventoryItems((chatMeta.gameInventory as Array<{ name: string; quantity: number }>) ?? []);
    setInventoryNotifications([]);
    setPendingInventorySegmentUpdates([]);
    setActiveReadable(null);
    readableQueueRef.current = [];
    appliedInventorySegmentsRef.current = new Set();
    // Allow the auto-tutorial to re-evaluate for the new chat (guard still gates on disabled flag)
    tutorialAutoTriggeredRef.current = false;
  }, [activeChatId, chatMeta.gameInventory, chatMeta.gameRecentMusic]);

  const handleActiveSpeakerChange = useCallback(
    (speaker: { name: string; avatarUrl: string; expression?: string } | null) => {
      setActiveSpeaker(speaker);
    },
    [],
  );

  const applyInventoryUpdates = useCallback(
    (updates: InventoryTag[]) => {
      if (updates.length === 0) return;

      const notifications: string[] = [];
      setInventoryItems((prev) => {
        let updated = prev;
        const currentGameState = useGameStateStore.getState().current;
        const currentPlayerStats = currentGameState?.chatId === activeChatId ? currentGameState.playerStats : null;
        let nextPlayerStats = currentPlayerStats;

        for (const invUpdate of updates) {
          for (const itemName of invUpdate.items) {
            const normalizedItemName = normalizeInventoryName(itemName);
            if (!normalizedItemName) continue;

            let applied = false;
            if (invUpdate.action === "add") {
              updated = addInventoryUnit(updated, normalizedItemName);
              if (nextPlayerStats) {
                nextPlayerStats = {
                  ...nextPlayerStats,
                  inventory: addInventoryUnit(nextPlayerStats.inventory, normalizedItemName),
                };
              }
              notifications.push(`You gained ${normalizedItemName}!`);
              applied = true;
            } else {
              const nextInventory = removeInventoryUnit(updated, normalizedItemName);
              if (nextInventory !== updated) {
                updated = nextInventory;
                notifications.push(`You lost ${normalizedItemName}!`);
                applied = true;
              }
              if (nextPlayerStats) {
                const nextDetailedInventory = removeInventoryUnit(nextPlayerStats.inventory, normalizedItemName);
                if (nextDetailedInventory !== nextPlayerStats.inventory) {
                  nextPlayerStats = { ...nextPlayerStats, inventory: nextDetailedInventory };
                  applied = true;
                }
              }
            }

            if (!applied) continue;

            api
              .post("/game/journal/entry", {
                chatId: activeChatId,
                type: "item",
                data: {
                  item: normalizedItemName,
                  action: invUpdate.action === "add" ? "acquired" : "lost",
                  quantity: 1,
                },
              })
              .catch(() => {});
          }
        }

        api.patch(`/chats/${activeChatId}/metadata`, { gameInventory: updated }).catch(() => {});
        if (currentGameState?.chatId === activeChatId && currentPlayerStats && nextPlayerStats !== currentPlayerStats) {
          const syncedGameState = { ...currentGameState, playerStats: nextPlayerStats };
          useGameStateStore.getState().setGameState(syncedGameState);
          api.patch(`/chats/${activeChatId}/game-state`, { playerStats: nextPlayerStats }).catch(() => {});
        }
        return updated;
      });

      if (notifications.length > 0) {
        setInventoryNotifications(notifications);
        if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
        notificationTimerRef.current = setTimeout(() => setInventoryNotifications([]), 4000);
      }
    },
    [activeChatId],
  );

  const playDirections = useCallback((directions: DirectionCommand[]) => {
    if (directions.length === 0) return;
    setDirectionsPlaying(true);
    setActiveDirections([]);
    window.setTimeout(() => setActiveDirections(directions), 0);
  }, []);

  // Apply segment-tied effects when the user progresses to a new segment
  const handleSegmentEnter = useCallback(
    (segmentIndex: number) => {
      const sceneEffectsApplied = appliedSegmentsRef.current.has(segmentIndex);
      const inventoryApplied = appliedInventorySegmentsRef.current.has(segmentIndex);
      const effects = sceneEffectsApplied ? [] : pendingSegmentEffects.filter((e) => e.segment === segmentIndex);
      const inventoryUpdates = (inventoryApplied ? [] : pendingInventorySegmentUpdates)
        .filter((entry) => entry.segment === segmentIndex)
        .map((entry) => entry.update);
      if (effects.length === 0 && inventoryUpdates.length === 0) return;

      const assetMap = assetManifest?.assets ?? null;
      if (effects.length > 0) {
        appliedSegmentsRef.current.add(segmentIndex);
        for (const fx of effects) {
          if (fx.background) {
            const resolved = resolveAssetTag(fx.background, "backgrounds", assetMap);
            useGameAssetStore.getState().setCurrentBackground(resolved);
          }
          if (fx.music) {
            const resolved = resolveAssetTag(fx.music, "music", assetMap);
            audioManager.playMusic(resolved, assetMap);
            useGameAssetStore.getState().setCurrentMusic(resolved);
          }
          if (fx.sfx?.length) {
            for (const sfx of fx.sfx) {
              const resolved = resolveAssetTag(sfx, "sfx", assetMap);
              audioManager.playSfx(resolved, assetMap);
            }
          }
          if (fx.ambient) {
            const resolved = resolveAssetTag(fx.ambient, "ambient", assetMap);
            audioManager.playAmbient(resolved, assetMap);
            useGameAssetStore.getState().setCurrentAmbient(resolved);
          }
          if (fx.directions?.length) {
            playDirections(fx.directions);
          }
          // Widget updates handled by GM model via inline [widget:] tags
        }
      }

      if (inventoryUpdates.length > 0) {
        appliedInventorySegmentsRef.current.add(segmentIndex);
        applyInventoryUpdates(inventoryUpdates);
      }
    },
    [pendingSegmentEffects, pendingInventorySegmentUpdates, assetManifest, applyInventoryUpdates, playDirections],
  );

  // Fetch asset manifest on mount
  useEffect(() => {
    fetchManifest();
  }, [fetchManifest]);

  // Clean up audio + reset playback state when SWITCHING chats.
  // On unmount, only dispose audio (stop sounds) but keep store state intact so that
  // same-chat remount (e.g. returning from persona editor) can read it immediately
  // without waiting for the scene restore effect.
  const prevChatIdRef = useRef(activeChatId);
  useEffect(() => {
    if (prevChatIdRef.current !== activeChatId) {
      audioManager.dispose();
      useGameAssetStore.getState().resetPlaybackState();
      prevChatIdRef.current = activeChatId;
    }
    return () => {
      audioManager.dispose();
    };
  }, [activeChatId]);

  // Reconnect audio and background on mount if the store was disposed
  // (e.g. user left to home and returned to the same game).
  // Only reconnect for restored sessions — new games should not replay stale store state.
  useEffect(() => {
    if (!assetManifest || !isRestoredRef.current) return;
    const { currentMusic, currentAmbient, currentBackground: storeBg } = useGameAssetStore.getState();
    const assetMap = assetManifest.assets ?? null;
    // Restore background from metadata if the store was reset
    if (!storeBg) {
      const savedBg = chatMeta.gameSceneBackground as string | undefined;
      if (savedBg) {
        useGameAssetStore.getState().setCurrentBackground(savedBg);
      }
    }
    if (currentMusic && !audioManager.getState().musicTag) {
      audioManager.playMusic(currentMusic, assetMap);
    }
    if (currentAmbient && !audioManager.getState().ambientTag) {
      audioManager.playAmbient(currentAmbient, assetMap);
    }
  }, [assetManifest, chatMeta.gameSceneBackground]);

  const gameCharacterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of chatCharacterIds) {
      if (characterMap.has(id)) ids.add(id);
    }

    const config = chatMeta.gameSetupConfig as Record<string, unknown> | undefined;
    const gmCharacterId = typeof config?.gmCharacterId === "string" ? config.gmCharacterId : null;
    if (gmCharacterId && characterMap.has(gmCharacterId)) ids.add(gmCharacterId);

    for (const id of getActivePartyIds(chatMeta)) {
      if (characterMap.has(id)) ids.add(id);
    }

    return [...ids];
  }, [characterMap, chatCharacterIds, chatMeta]);

  // Fetch sprites for active game characters only. The full library is deliberately
  // not used here because a same-named character card can masquerade as the player.
  const characterIds = gameCharacterIds;

  // Also resolve persona sprite ID for expression lookup
  const personaSpriteId = useMemo(() => {
    const config = chatMeta.gameSetupConfig as Record<string, unknown> | undefined;
    return (config?.personaId as string | undefined) ?? null;
  }, [chatMeta.gameSetupConfig]);

  const spriteQueries = useQueries({
    queries: characterIds.map((id) => ({
      queryKey: spriteKeys.list(id),
      queryFn: () => api.get<SpriteInfo[]>(`/sprites/${id}`),
      enabled: !!id,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const recentSpriteSpeakerNames = useMemo(() => extractRecentGameDialogueSpeakerNames(messages), [messages]);

  useEffect(() => {
    const avatarPatches: Array<{ name: string; avatarUrl: string }> = [];
    for (const npc of npcs) {
      if (!npc.name) continue;
      const libraryCharacter = findNamedEntry(characters, npc.name, (character) => character.name);
      if (libraryCharacter?.avatarUrl && libraryCharacter.avatarUrl !== npc.avatarUrl) {
        avatarPatches.push({ name: npc.name, avatarUrl: libraryCharacter.avatarUrl });
      }
    }
    if (avatarPatches.length > 0) {
      useGameModeStore.getState().patchNpcAvatars(avatarPatches);
    }
  }, [characters, npcs]);

  const speakingLibraryCharacters = useMemo(() => {
    const speakerNames = new Set<string>();
    if (activeSpeaker?.name) speakerNames.add(activeSpeaker.name);
    for (const name of recentSpriteSpeakerNames) {
      speakerNames.add(name);
    }
    for (const line of partyDialogue) {
      if (line.character.trim()) speakerNames.add(line.character.trim());
    }

    const inGameCharacterIds = new Set(characterIds);
    const matched = new Map<string, SpeakingLibraryCharacter>();
    const playerSpeakerName = personaInfo?.name ? normalizeSceneAssetName(personaInfo.name) : "";
    for (const speakerName of speakerNames) {
      if (playerSpeakerName && normalizeSceneAssetName(speakerName) === playerSpeakerName) continue;
      const character = findNamedEntry(characters, speakerName, (entry) => entry.name);
      if (!character || inGameCharacterIds.has(character.id) || character.id === personaSpriteId) continue;
      const existing = matched.get(character.id);
      if (existing) {
        if (!existing.aliases.some((alias) => characterNamesMatch(alias, speakerName))) {
          existing.aliases.push(speakerName);
        }
        continue;
      }
      matched.set(character.id, { character, aliases: [speakerName] });
    }
    return [...matched.values()];
  }, [
    activeSpeaker?.name,
    characterIds,
    characters,
    partyDialogue,
    personaInfo?.name,
    personaSpriteId,
    recentSpriteSpeakerNames,
  ]);

  const librarySpriteQueries = useQueries({
    queries: speakingLibraryCharacters.map((entry) => ({
      queryKey: spriteKeys.list(entry.character.id),
      queryFn: () => api.get<SpriteInfo[]>(`/sprites/${entry.character.id}`),
      enabled: !!entry.character.id,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const personaSpriteQuery = useQuery({
    queryKey: spriteKeys.list(personaSpriteId ?? ""),
    queryFn: () => api.get<SpriteInfo[]>(`/sprites/${personaSpriteId}`),
    enabled: !!personaSpriteId,
    staleTime: 5 * 60 * 1000,
  });

  // Map: lowercase character name → SpriteInfo[]
  const spriteMap = useMemo(() => {
    const map = new Map<string, SpriteInfo[]>();
    characterIds.forEach((id, i) => {
      const data = spriteQueries[i]?.data;
      const charInfo = characterMap.get(id);
      if (data?.length && charInfo) {
        map.set(charInfo.name.toLowerCase(), data);
      }
    });
    speakingLibraryCharacters.forEach((entry, i) => {
      const data = librarySpriteQueries[i]?.data;
      if (data?.length) {
        map.set(entry.character.name.toLowerCase(), data);
        for (const alias of entry.aliases) {
          map.set(alias.toLowerCase(), data);
        }
      }
    });
    // Add persona sprites if available
    if (personaInfo?.name && personaSpriteQuery.data?.length) {
      map.set(personaInfo.name.toLowerCase(), personaSpriteQuery.data);
    }
    return map;
  }, [
    characterIds,
    characterMap,
    librarySpriteQueries,
    personaInfo,
    speakingLibraryCharacters,
    personaSpriteQuery.data,
    spriteQueries,
  ]);

  const librarySpeakerAvatars = useMemo(() => {
    const map = new Map<
      string,
      {
        url: string;
        crop?: { zoom: number; offsetX: number; offsetY: number } | null;
        nameColor?: string;
        dialogueColor?: string;
      }
    >();
    for (const entry of speakingLibraryCharacters) {
      const fromMap = characterMap.get(entry.character.id);
      const avatarInfo = {
        url: entry.character.avatarUrl ?? "",
        crop: entry.character.avatarCrop,
        nameColor: entry.character.nameColor ?? fromMap?.nameColor,
        dialogueColor: entry.character.dialogueColor ?? fromMap?.dialogueColor,
      };
      map.set(entry.character.name.toLowerCase(), avatarInfo);
      for (const alias of entry.aliases) {
        map.set(alias.toLowerCase(), avatarInfo);
      }
    }
    return map;
  }, [characterMap, speakingLibraryCharacters]);

  const fullBodyTarget = useMemo(() => {
    if (gameState === "combat" && combatSpriteSuggestion) {
      return { mode: "combat" as const, name: combatSpriteSuggestion.name, token: combatSpriteSuggestion.pose };
    }
    if (activeSpeaker) {
      return { mode: "dialogue" as const, name: activeSpeaker.name, token: activeSpeaker.expression ?? null };
    }
    return null;
  }, [activeSpeaker, combatSpriteSuggestion, gameState]);

  const activeFullBodySprite = useMemo(() => {
    if (!fullBodyTarget) return null;
    const activeCharacterEntries = characterIds.flatMap((id) => {
      const character = characterMap.get(id);
      return character ? ([[id, character]] as Array<[string, NonNullable<ReturnType<typeof characterMap.get>>]>) : [];
    });
    const entry = findNamedEntry(activeCharacterEntries, fullBodyTarget.name, ([, character]) => character.name);
    const libraryEntry = entry
      ? null
      : findNamedEntry(speakingLibraryCharacters, fullBodyTarget.name, (candidate) =>
          [candidate.character.name, ...candidate.aliases].join(" "),
        );
    const characterId = entry?.[0] ?? libraryEntry?.character.id;
    if (!characterId) return null;

    const characterIndex = entry ? characterIds.indexOf(entry[0]) : -1;
    const libraryIndex = libraryEntry
      ? speakingLibraryCharacters.findIndex((candidate) => candidate.character.id === libraryEntry.character.id)
      : -1;
    const sprites = entry ? spriteQueries[characterIndex]?.data : librarySpriteQueries[libraryIndex]?.data;
    const pose =
      fullBodyTarget.mode === "combat"
        ? resolveCombatFullBodyPose(fullBodyTarget.token, sprites)
        : resolveDialogueFullBodyPose(fullBodyTarget.token, sprites);
    if (!pose) return null;

    return {
      characterId,
      pose,
    };
  }, [characterIds, characterMap, fullBodyTarget, librarySpriteQueries, speakingLibraryCharacters, spriteQueries]);

  // Build sprite expression map for the full-body SpriteOverlay.
  const gameSpriteExpressions = useMemo(
    () => (activeFullBodySprite ? { [activeFullBodySprite.characterId]: activeFullBodySprite.pose } : undefined),
    [activeFullBodySprite],
  );

  // Only show the currently focused sprite (dialogue speaker or combat actor).
  const activeSpriteIds = useMemo(
    () => (activeFullBodySprite ? [activeFullBodySprite.characterId] : []),
    [activeFullBodySprite],
  );

  // Keep previous sprite IDs around during fade-out so the component stays mounted
  const prevSpriteIdsRef = useRef<string[]>([]);
  const spriteVisible = activeSpriteIds.length > 0;
  const displaySpriteIds = spriteVisible ? activeSpriteIds : prevSpriteIdsRef.current;
  useEffect(() => {
    if (spriteVisible) prevSpriteIdsRef.current = activeSpriteIds;
  }, [spriteVisible, activeSpriteIds]);

  // New game mechanics hooks
  const _advanceTime = useAdvanceTime();
  const updateWeather = useUpdateWeather();
  const _rollEncounter = useRollEncounter();
  const _updateReputation = useUpdateReputation();
  const _journalEntry = useJournalEntry();
  const transitionGameState = useTransitionGameState();
  const sceneAnalysis = useSceneAnalysis();
  const sidecarConfig = useSidecarStore((s) => s.config);
  const sidecarReady = useSidecarStore((s) => s.inferenceReady);
  const sidecarStatus = useSidecarStore((s) => s.status);
  const sidecarStartupError = useSidecarStore((s) => s.startupError);
  const sidecarFailedRuntimeVariant = useSidecarStore((s) => s.failedRuntimeVariant);
  const openSidecarModal = useSidecarStore((s) => s.setShowDownloadModal);
  const refreshSidecarStatus = useSidecarStore((s) => s.fetchStatus);

  // Process GM tags from the latest assistant message
  const latestAssistantMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === "assistant" || messages[i]!.role === "narrator") return messages[i];
    }
    return null;
  }, [messages]);

  // Keep latest assistant message in a ref so the Zustand subscription can read it
  const latestAssistantMsgRef = useRef(latestAssistantMsg);
  latestAssistantMsgRef.current = latestAssistantMsg;

  // Derived per-render: completion is only "done" for the *current* assistant message.
  // A stale completion ID from the previous turn falls through to false because
  // `latestAssistantMsg.id` has already advanced. The `typeof === "string"` guards
  // also defeat the undefined-vs-undefined edge case where both sides could otherwise
  // compare equal (Message.id is typed as optional) and silently unlock UI gates.
  const narrationDone =
    typeof narrationDoneMsgId === "string" &&
    typeof latestAssistantMsg?.id === "string" &&
    narrationDoneMsgId === latestAssistantMsg.id;

  const latestNarrationText = useMemo(
    () => (latestAssistantMsg?.content ? parseGmTags(latestAssistantMsg.content).cleanContent.trim() : ""),
    [latestAssistantMsg?.content],
  );

  // The GM prose that triggered combat, used as the opening combat-log entry so the
  // player can read what set up the fight without having to open the Logs modal.
  const combatStartNarration = useMemo(() => {
    if (!combatStartMessageId) return null;
    const triggerMsg = messages.find((m) => m.id === combatStartMessageId);
    if (!triggerMsg?.content) return null;
    const cleaned = stripGmTags(triggerMsg.content).trim();
    return cleaned.length > 0 ? cleaned : null;
  }, [combatStartMessageId, messages]);

  const combatLogEntries = useMemo(
    () =>
      messages
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: formatCombatLogContent(message),
        }))
        .filter((entry) => entry.content.length > 0),
    [messages],
  );
  const combatLogPageSize = Math.max(1, messagesPerPage > 0 ? messagesPerPage : combatLogEntries.length || 20);
  const [combatLogVisibleCount, setCombatLogVisibleCount] = useState(combatLogPageSize);
  useEffect(() => {
    if (!combatLogsOpen) return;
    setCombatLogVisibleCount(combatLogPageSize);
    combatLogScrolledRef.current = false;
  }, [combatLogPageSize, combatLogsOpen]);
  const visibleCombatLogEntries = useMemo(
    () => combatLogEntries.slice(Math.max(0, combatLogEntries.length - combatLogVisibleCount)),
    [combatLogEntries, combatLogVisibleCount],
  );
  const hiddenCombatLogCount = Math.max(0, combatLogEntries.length - visibleCombatLogEntries.length);

  const sceneAssetNpcs = useMemo(
    () =>
      mergeSceneAssetNpcCandidates(
        npcs,
        (gameSnapshot?.presentCharacters as SceneAssetPresentCharacter[] | undefined) ?? [],
        sceneWrapCharacterNames,
        gameSnapshot?.location ?? null,
        latestNarrationText,
      ),
    [gameSnapshot?.location, gameSnapshot?.presentCharacters, latestNarrationText, npcs, sceneWrapCharacterNames],
  );

  const npcAvatarLookup = useMemo(
    () =>
      buildNpcAvatarLookup(
        npcs,
        (gameSnapshot?.presentCharacters as SceneAssetPresentCharacter[] | undefined) ?? [],
        chatMeta.gameNpcs,
      ),
    [chatMeta.gameNpcs, gameSnapshot?.presentCharacters, npcs],
  );

  const npcsNeedingAvatars = useMemo(() => {
    const npcsNeedingAvatars = sceneAssetNpcs
      .filter(
        (npc) =>
          !npc.avatarUrl && !npcAvatarLookup.has(normalizeSceneAssetName(npc.name)) && npc.description && npc.name,
      )
      .map((npc) => ({ name: npc.name, description: npc.description }))
      .slice(0, 10);

    return npcsNeedingAvatars;
  }, [npcAvatarLookup, sceneAssetNpcs]);

  const missingSceneAssetGeneration = useMemo(() => {
    if (!activeChatId) return null;

    const unresolvedBackground = getMissingBackgroundTag(
      currentBackground || (chatMeta.gameSceneBackground as string | undefined),
      assetManifest?.assets ?? null,
    );

    if (!unresolvedBackground && npcsNeedingAvatars.length === 0) return null;

    return {
      chatId: activeChatId,
      backgroundTag: unresolvedBackground ?? undefined,
      npcsNeedingAvatars: npcsNeedingAvatars.length > 0 ? npcsNeedingAvatars : undefined,
    };
  }, [activeChatId, assetManifest, chatMeta.gameSceneBackground, currentBackground, npcsNeedingAvatars]);

  const retryableAssetGeneration = pendingAssetGeneration ?? missingSceneAssetGeneration;

  useEffect(() => {
    autoAssetGenerationKeyRef.current = null;
  }, [activeChatId]);

  const canRetryTurn = !!latestAssistantMsg?.id && !isStreaming;
  const canRetryScene = !!latestAssistantMsg?.content && !isStreaming && !sceneAnalysis.isPending;
  const canRetryAssets = !!retryableAssetGeneration && (assetGenerationFailed || !pendingAssetGeneration);

  const hasCombatResultAfterMessage = useCallback(
    (messageId: string) => {
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex < 0) return false;
      for (let i = messageIndex + 1; i < messages.length; i++) {
        const msg = messages[i]!;
        if (msg.role === "user" && msg.content.includes("[combat_result]")) {
          return true;
        }
      }
      return false;
    },
    [messages],
  );

  const hasQteResponseAfterMessage = useCallback(
    (messageId: string) => {
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex < 0) return false;
      for (let i = messageIndex + 1; i < messages.length; i++) {
        const msg = messages[i]!;
        if (msg.role === "user" && (msg.content.includes("[qte_result:") || msg.content.includes("[qte_bonus:"))) {
          return true;
        }
      }
      return false;
    },
    [messages],
  );

  // ── Scene preparation gating ──
  // Track which message has had its scene effects prepared so narration
  // isn't displayed until backgrounds/music/etc. are ready.
  const sceneReadyMsgIdRef = useRef<string | undefined>(undefined);
  const applySceneResultRef = useRef<((result: import("@marinara-engine/shared").SceneAnalysis) => void | Promise<void>) | null>(
    null,
  );
  const [sceneReadyTick, setSceneReadyTick] = useState(0);
  void sceneReadyTick; // used only to trigger re-renders

  // On first render, mark existing messages as scene-ready (avoid false loading).
  // Only pre-seed sceneReadyMsgIdRef (narration gating) and weatherMsgRef.
  // NEVER pre-seed lastProcessedMsgRef here — let the processing effect decide.
  const isRestoredRef = useRef(false);

  // ── Restore scene assets (background/music/ambient) from chat metadata on page load ──
  const sceneRestoredRef = useRef(false);
  const partyDialogueRestoredRef = useRef(false);

  if (sceneReadyMsgIdRef.current === undefined && !isMessagesLoading) {
    if (latestAssistantMsg && !isStreaming) {
      // Returning to an existing game — mark scene as ready and skip weather/intro
      isRestoredRef.current = true;
      sceneReadyMsgIdRef.current = latestAssistantMsg.id;
      weatherMsgRef.current = latestAssistantMsg.id;
    } else {
      sceneReadyMsgIdRef.current = "__none__";
      weatherMsgRef.current = null;
    }
  }

  useEffect(() => {
    if (sceneRestoredRef.current || isMessagesLoading || !latestAssistantMsg?.content) return;
    // Wait for asset manifest before restoring audio (avoids invalid URI errors)
    if (!assetManifest) return;
    sceneRestoredRef.current = true;

    const savedBg = chatMeta.gameSceneBackground as string | undefined;
    const savedMusic = chatMeta.gameSceneMusic as string | undefined;
    const savedAmbient = chatMeta.gameSceneAmbient as string | undefined;
    const assetMap = assetManifest.assets ?? null;
    recentMusicHistoryRef.current = appendRecentMusic(
      normalizeRecentMusicHistory(chatMeta.gameRecentMusic),
      savedMusic,
    );

    // Always overwrite from chatMeta (source of truth on mount) — handles both
    // same-chat remount (store may already match) and different-chat mount.
    useGameAssetStore.getState().setCurrentBackground(savedBg ?? null);

    if (savedMusic) {
      useGameAssetStore.getState().setCurrentMusic(savedMusic);
      // Play music — may be blocked by autoplay, audioManager queues retry on gesture
      if (audioManager.getState().musicTag !== savedMusic) {
        audioManager.playMusic(savedMusic, assetMap);
      }
    } else {
      useGameAssetStore.getState().setCurrentMusic(null);
    }

    if (savedAmbient) {
      useGameAssetStore.getState().setCurrentAmbient(savedAmbient);
      if (audioManager.getState().ambientTag !== savedAmbient) {
        audioManager.playAmbient(savedAmbient, assetMap);
      }
    } else {
      useGameAssetStore.getState().setCurrentAmbient(null);
    }

    // Re-extract interactive tags (choices, QTE, encounters) from the latest message
    // so they survive unmount/remount and page refresh.
    if (isRestoredRef.current) {
      const tags = parseGmTags(latestAssistantMsg.content);
      if (tags.choices) setActiveChoices(tags.choices);
      if (tags.qte && !hasQteResponseAfterMessage(latestAssistantMsg.id)) {
        setQueuedQte({ qte: tags.qte, messageId: latestAssistantMsg.id });
      }
      if (tags.combatEncounter && !hasCombatResultAfterMessage(latestAssistantMsg.id)) {
        setQueuedEncounter({ encounter: tags.combatEncounter, messageId: latestAssistantMsg.id });
      } else if (tags.stateChange === "combat" && !hasCombatResultAfterMessage(latestAssistantMsg.id)) {
        setQueuedCombatGeneration({ messageId: latestAssistantMsg.id });
      }
      lastProcessedMsgRef.current = latestAssistantMsg.id;
      // Clear restored flag so subsequent new messages are processed normally
      // by processScene (which skips when isRestoredRef.current is true).
      isRestoredRef.current = false;
    }
  }, [
    isMessagesLoading,
    latestAssistantMsg?.content,
    latestAssistantMsg?.id,
    assetManifest,
    chatMeta.gameSceneBackground,
    chatMeta.gameSceneMusic,
    chatMeta.gameRecentMusic,
    chatMeta.gameSceneAmbient,
    hasQteResponseAfterMessage,
    hasCombatResultAfterMessage,
    handlePartyChangeCommands,
  ]);

  // ── Restore party dialogue from the last [party-chat] message on page load ──
  useEffect(() => {
    if (partyDialogueRestoredRef.current || isMessagesLoading) return;
    partyDialogueRestoredRef.current = true;
    // Find the last assistant message that contains [party-chat] content
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      if ((msg.role === "assistant" || msg.role === "narrator") && msg.content.startsWith("[party-chat]")) {
        const raw = msg.content.replace(/^\[party-chat\]\n?/, "");
        const lines = parsePartyDialogue(raw);
        if (lines.length > 0) {
          setPartyDialogue(lines);
          setPartyChatMessageId(msg.id);
        }
        break;
      }
    }
  }, [isMessagesLoading, messages]);

  // ── Persist scene assets to chat metadata (debounced) ──
  const scenePersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Subscribe to asset store changes and persist to chat metadata
    const unsub = useGameAssetStore.subscribe((state, prev) => {
      if (!sceneRestoredRef.current) return;
      if (
        state.currentBackground === prev.currentBackground &&
        state.currentMusic === prev.currentMusic &&
        state.currentAmbient === prev.currentAmbient
      )
        return;
      if (scenePersistTimer.current) clearTimeout(scenePersistTimer.current);
      scenePersistTimer.current = setTimeout(() => {
        const patch: Record<string, unknown> = {
          gameSceneBackground: state.currentBackground,
          gameSceneMusic: state.currentMusic,
          gameSceneAmbient: state.currentAmbient,
        };
        if (state.currentMusic !== prev.currentMusic) {
          recentMusicHistoryRef.current = appendRecentMusic(recentMusicHistoryRef.current, state.currentMusic);
          patch.gameRecentMusic = recentMusicHistoryRef.current;
        }
        api.patch(`/chats/${activeChatId}/metadata`, patch).catch(() => {});
      }, 1500);
    });
    return () => {
      unsub();
      // Flush any pending scene persist immediately on unmount
      if (scenePersistTimer.current) {
        clearTimeout(scenePersistTimer.current);
        const { currentBackground, currentMusic, currentAmbient } = useGameAssetStore.getState();
        api
          .patch(`/chats/${activeChatId}/metadata`, {
            gameSceneBackground: currentBackground,
            gameSceneMusic: currentMusic,
            gameSceneAmbient: currentAmbient,
            gameRecentMusic: recentMusicHistoryRef.current,
          })
          .catch(() => {});
      }
    };
  }, [activeChatId]);

  // ── Restore in-progress combat state from chat metadata on page load ──
  // Without this, refreshing during a fight drops the user back into prose narration even
  // though gameActiveState is still "combat", because the live party/enemy snapshot only
  // lived in component-local React state.
  // Scoped per-chat so switching to another chat in the same mounted GameSurface still
  // gets a chance to restore that chat's snapshot — a single boolean would permanently
  // skip restore after the first chat opened.
  const combatRestoredChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (isMessagesLoading) return;
    if (combatRestoredChatIdRef.current === activeChatId) return;
    const snapshot = chatMeta.gameCombatState as GameCombatStateSnapshot | null | undefined;
    combatRestoredChatIdRef.current = activeChatId;
    if (!snapshot || !snapshot.party?.length || !snapshot.enemies?.length) return;
    if (chatMeta.gameActiveState !== "combat") {
      // Stale snapshot — combat ended but the metadata write didn't land. Clear it.
      api.patch(`/chats/${activeChatId}/metadata`, { gameCombatState: null }).catch(() => {});
      return;
    }
    // Runtime validation: the snapshot is JSON-deserialized from chat metadata that
    // may have been written by an older client whose `Combatant` schema differed.
    // The TypeScript `as Combatant[]` cast is erased at runtime, so without this
    // guard a stale snapshot with missing required fields would be accepted and
    // crash later in the render path. On invalid data, drop the snapshot entirely.
    const rawParty = Array.isArray(snapshot.party) ? snapshot.party : [];
    const rawEnemies = Array.isArray(snapshot.enemies) ? snapshot.enemies : [];
    if (!rawParty.every(isValidCombatant) || !rawEnemies.every(isValidCombatant)) {
      console.warn(
        "[game-surface] Discarding combat snapshot — failed Combatant schema validation. " +
          "Likely written by an older client version.",
      );
      api.patch(`/chats/${activeChatId}/metadata`, { gameCombatState: null }).catch(() => {});
      return;
    }
    setCombatParty(rawParty);
    setCombatEnemies(rawEnemies);
    setCombatItemEffects(Array.isArray(snapshot.itemEffects) ? snapshot.itemEffects : []);
    setCombatMechanics(Array.isArray(snapshot.mechanics) ? snapshot.mechanics : []);
    setCombatDialogueCues(Array.isArray(snapshot.dialogueCues) ? snapshot.dialogueCues : []);
    if (snapshot.startMessageId) setCombatStartMessageId(snapshot.startMessageId);
    useGameModeStore.getState().setGameState("combat");
  }, [activeChatId, chatMeta.gameCombatState, chatMeta.gameActiveState, isMessagesLoading]);

  // ── Persist live combat snapshot to chat metadata (debounced) ──
  // Mirrors the scene-asset persistence above but only fires while combat is active.
  // The snapshot doesn't include per-round transient state (animations, log entries) —
  // those reset on restore and combat resumes from the start of the round.
  const combatPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest snapshot stored in a ref so the cleanup path can flush it synchronously
  // when the effect re-runs (chat switch / unmount) — without this, a refresh inside
  // the 800 ms debounce window would silently drop the most recent state.
  const combatPendingSnapshotRef = useRef<{ chatId: string; snapshot: GameCombatStateSnapshot } | null>(null);
  // Shared helper used by combat-end + return-to-pre-combat-turn so both paths reliably
  // wipe the persisted snapshot, even if the exploration-state PATCH is still in flight
  // when the user refreshes.
  const clearCombatSnapshot = useCallback(
    (chatId: string | null) => {
      if (!chatId) return;
      if (combatPersistTimer.current) {
        clearTimeout(combatPersistTimer.current);
        combatPersistTimer.current = null;
      }
      combatPendingSnapshotRef.current = null;
      api.patch(`/chats/${chatId}/metadata`, { gameCombatState: null }).catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if (combatRestoredChatIdRef.current !== activeChatId) return;
    if (!combatParty || !combatEnemies || gameState !== "combat") return;
    if (combatPersistTimer.current) clearTimeout(combatPersistTimer.current);
    const snapshot: GameCombatStateSnapshot = {
      party: combatParty,
      enemies: combatEnemies,
      itemEffects: combatItemEffects,
      mechanics: combatMechanics,
      dialogueCues: combatDialogueCues,
      startMessageId: combatStartMessageId,
    };
    combatPendingSnapshotRef.current = { chatId: activeChatId, snapshot };
    combatPersistTimer.current = setTimeout(() => {
      // Log on failure: this is the active-gameplay persist path, NOT the unmount
      // keepalive flush below or the lifecycle wipes in `clearCombatSnapshot`. A
      // silent failure here means the user keeps fighting believing state is saved,
      // then loses progress on refresh — the operator needs to see this in console.
      api
        .patch(`/chats/${activeChatId}/metadata`, { gameCombatState: snapshot })
        .catch((err) => console.error("[game-surface] combat snapshot persist failed", err));
      combatPendingSnapshotRef.current = null;
      combatPersistTimer.current = null;
    }, 800);
    return () => {
      if (combatPersistTimer.current) {
        clearTimeout(combatPersistTimer.current);
        combatPersistTimer.current = null;
      }
      // Flush the latest pending snapshot synchronously so an unmount or chat switch
      // during the 800 ms debounce window doesn't lose the most recent combat state.
      // `keepalive` lets the request survive a hard refresh / tab close — without it,
      // browsers will cancel an in-flight PATCH the moment the page begins unloading,
      // which is exactly the scenario this feature is meant to protect.
      const pending = combatPendingSnapshotRef.current;
      if (pending) {
        api
          .patch(`/chats/${pending.chatId}/metadata`, { gameCombatState: pending.snapshot }, { keepalive: true })
          .catch(() => {});
        combatPendingSnapshotRef.current = null;
      }
    };
  }, [
    activeChatId,
    combatParty,
    combatEnemies,
    combatItemEffects,
    combatMechanics,
    combatDialogueCues,
    combatStartMessageId,
    gameState,
  ]);

  // ── Self-heal stale "user" persona name in restored combat state ──
  // Snapshots written before the encounter prompt was taught about chat-scoped personas
  // have the player combatant's name baked in as the literal fallback string "user" /
  // "User" (because `buildPersonaContext` returned that). Once persona resolution is
  // fixed, fresh snapshots are correct, but in-flight battles loaded from old metadata
  // keep showing the wrong name until corrected. Detect that signature and rename the
  // combatant in place — the existing persist effect then writes the corrected snapshot
  // back, so this only runs once per stale battle.
  useEffect(() => {
    if (!combatParty || !personaInfo?.name) return;
    let changed = false;
    const corrected = combatParty.map((combatant) => {
      if (
        combatant.side === "player" &&
        combatant.id.startsWith("generated-party-") &&
        /^user$/i.test(combatant.name)
      ) {
        changed = true;
        return {
          ...combatant,
          name: personaInfo.name,
          sprite: combatant.sprite ?? personaInfo.avatarUrl ?? combatant.sprite,
        };
      }
      return combatant;
    });
    if (changed) setCombatParty(corrected);
  }, [combatParty, personaInfo?.name, personaInfo?.avatarUrl]);

  // ── Persist narration segment index (localStorage for instant reads + server for durability) ──
  const segmentStorageKey = `narration-idx:${activeChatId}`;
  const segmentPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const narrationProgressMessageId = latestAssistantMsg?.id ?? null;
  const handleSegmentChange = useCallback(
    (index: number) => {
      try {
        localStorage.setItem(
          segmentStorageKey,
          JSON.stringify({ index, messageId: narrationProgressMessageId } satisfies StoredNarrationProgress),
        );
      } catch {
        /* storage unavailable */
      }
      if (segmentPersistTimer.current) clearTimeout(segmentPersistTimer.current);
      segmentPersistTimer.current = setTimeout(() => {
        api
          .patch(`/chats/${activeChatId}/metadata`, {
            gameNarrationIndex: index,
            gameNarrationMessageId: narrationProgressMessageId,
          })
          .catch(() => {});
      }, 500);
    },
    [activeChatId, narrationProgressMessageId, segmentStorageKey],
  );
  useEffect(() => {
    return () => {
      // Flush any pending segment index persist immediately on unmount
      if (segmentPersistTimer.current) {
        clearTimeout(segmentPersistTimer.current);
        try {
          const saved = parseStoredNarrationProgress(localStorage.getItem(segmentStorageKey));
          if (saved) {
            api
              .patch(`/chats/${activeChatId}/metadata`, {
                gameNarrationIndex: saved.index,
                gameNarrationMessageId: saved.messageId,
              })
              .catch(() => {});
          }
        } catch {
          /* */
        }
      }
    };
  }, [activeChatId, segmentStorageKey]);

  // Read the saved narration index for restore — prefer localStorage (fast, survives
  // browser restarts) for instant restore, fall back to server metadata.
  const restoredNarrationState = useMemo(() => {
    const currentMessageId = latestAssistantMsg?.id ?? null;
    try {
      const saved = parseStoredNarrationProgress(localStorage.getItem(segmentStorageKey));
      if (saved && saved.messageId && currentMessageId && saved.messageId === currentMessageId) {
        return { index: saved.index, hasStoredPosition: true };
      }
    } catch {
      /* storage unavailable */
    }
    // Fall back to server-persisted metadata (survives browser restarts)
    const serverIdx = chatMeta.gameNarrationIndex;
    const serverMessageId =
      typeof chatMeta.gameNarrationMessageId === "string" ? chatMeta.gameNarrationMessageId : null;
    if (
      currentMessageId &&
      serverMessageId === currentMessageId &&
      typeof serverIdx === "number" &&
      Number.isFinite(serverIdx) &&
      serverIdx >= 0
    ) {
      return { index: serverIdx, hasStoredPosition: true };
    }
    return { index: 0, hasStoredPosition: false };
  }, [segmentStorageKey, latestAssistantMsg?.id, chatMeta.gameNarrationIndex, chatMeta.gameNarrationMessageId]);

  const restoredSegmentIndex = restoredNarrationState.index;

  // Check if async scene preparation exists (sidecar or connection-based scene model)
  const hasAsyncScenePrep = useMemo(() => {
    const useSidecar = sidecarConfig.useForGameScene && sidecarReady;
    const setupCfg = chatMeta.gameSetupConfig as Record<string, unknown> | null;
    const sceneConnId = (chatMeta.gameSceneConnectionId as string) || (setupCfg?.sceneConnectionId as string) || null;
    return useSidecar || !!sceneConnId;
  }, [sidecarConfig.useForGameScene, sidecarReady, chatMeta.gameSetupConfig, chatMeta.gameSceneConnectionId]);

  // True when latest message needs scene effects that haven't been applied yet
  const scenePreparing =
    hasAsyncScenePrep &&
    !isStreaming &&
    latestAssistantMsg != null &&
    sceneReadyMsgIdRef.current !== latestAssistantMsg.id &&
    !sceneAnalysisFailed;

  // Show retry/skip buttons only after being stuck for 15 seconds (avoid showing during normal processing)
  const sceneProcessed = latestAssistantMsg == null || sceneReadyMsgIdRef.current === latestAssistantMsg?.id;
  useEffect(() => {
    // Reset whenever scene processing completes or streaming starts
    if (sceneProcessed || isStreaming) {
      setSceneStuckVisible(false);
      return;
    }
    // Only start timer when content is present and streaming is done
    if (!latestAssistantMsg?.content) return;
    const timer = setTimeout(() => setSceneStuckVisible(true), 15_000);
    return () => clearTimeout(timer);
  }, [sceneProcessed, isStreaming, latestAssistantMsg?.content]);

  useEffect(() => {
    if (!latestAssistantMsg?.content || isStreaming) return;
    if (weatherMsgRef.current === latestAssistantMsg.id) return;
    weatherMsgRef.current = latestAssistantMsg.id;
    // Map game state to weather action for probabilistic change
    const action = gameState === "travel_rest" ? "travel" : gameState === "exploration" ? "explore" : "turn";
    updateWeather.mutate({ chatId: activeChatId, action, location: gameSnapshot?.location ?? "" });
  }, [
    latestAssistantMsg?.content,
    latestAssistantMsg?.id,
    isStreaming,
    activeChatId,
    updateWeather,
    gameState,
    gameSnapshot?.location,
  ]);

  // ── Scene processing: fires once when streaming ends for a new message ──
  // Uses a Zustand subscription to detect isStreaming going false, which is
  // immune to React effect timing / dependency issues.
  const processSceneRef = useRef<(() => void) | null>(null);

  // Keep the processing function fresh on every render so it captures current closure values
  processSceneRef.current = () => {
    // Read from ref, NOT closure — the Zustand subscription fires before React re-renders
    const msg = latestAssistantMsgRef.current;
    if (!msg?.content) {
      console.warn("[scene-process] No message content yet, skipping");
      return;
    }
    if (lastProcessedMsgRef.current === msg.id) return;
    if (isRestoredRef.current) {
      lastProcessedMsgRef.current = msg.id;
      return;
    }

    // Read asset manifest from store directly (not from dependency)
    const manifest = useGameAssetStore.getState().manifest;
    const assets = manifest?.assets ?? null;

    console.warn("[scene-process] FIRING for message:", msg.id, "| assets:", !!assets);
    lastProcessedMsgRef.current = msg.id;
    setNarrationDoneMsgId(null);
    setSceneAnalysisFailed(false);
    setPartyDialogue([]);
    setPartyChatMessageId(null);
    setQueuedQte(null);
    setQueuedEncounter(null);
    setQueuedCombatGeneration(null);
    setCombatItemEffects([]);
    setCombatMechanics([]);
    setCombatDialogueCues([]);
    setPendingSegmentEffects([]);
    setPendingInventorySegmentUpdates([]);
    appliedSegmentsRef.current = new Set();
    // Cancel any pending segment persist timer to prevent it from overwriting our reset
    if (segmentPersistTimer.current) {
      clearTimeout(segmentPersistTimer.current);
      segmentPersistTimer.current = null;
    }
    // Reset persisted narration progress for the new message so reloads cannot
    // inherit the previous turn's saved segment index.
    try {
      localStorage.setItem(
        segmentStorageKey,
        JSON.stringify({ index: 0, messageId: msg.id } satisfies StoredNarrationProgress),
      );
    } catch {
      /* ignore */
    }
    api
      .patch(`/chats/${activeChatId}/metadata`, { gameNarrationIndex: 0, gameNarrationMessageId: msg.id })
      .catch(() => {});

    const tags = parseGmTags(msg.content);
    const sceneAnalysisState: GameActiveState =
      tags.combatEncounter || tags.stateChange === "combat"
        ? "combat"
        : tags.stateChange === "exploration" || tags.stateChange === "dialogue" || tags.stateChange === "travel_rest"
          ? tags.stateChange
          : gameState;
    const useSidecar = sidecarConfig.useForGameScene && sidecarReady;
    const setupConfig = chatMeta.gameSetupConfig as Record<string, unknown> | null;
    const sceneConnId =
      (chatMeta.gameSceneConnectionId as string) || (setupConfig?.sceneConnectionId as string) || null;

    // Inline directions can come from the GM model; sidecar scene analysis can
    // also return cinematic directions for the fully generated turn.
    if (tags.directions.length > 0) {
      playDirections(tags.directions);
    }

    // Combat starts are declared by the GM with [state: combat]. Legacy
    // [combat: ...] payloads still seed directly for old saves/presets; new
    // turns call the combat JSON generator after the narrated turn is read.
    if (tags.combatEncounter) {
      setQueuedEncounter({ encounter: tags.combatEncounter, messageId: msg.id });
    } else if (tags.stateChange === "combat") {
      setQueuedCombatGeneration({ messageId: msg.id });
    }

    // Skill checks from GM — prefer inline resolved results, otherwise resolve server-side
    if (tags.skillChecks.length > 0) {
      const sc = tags.skillChecks[0]!;
      if (sc.resolvedResult) {
        setPendingSkillCheck(sc.resolvedResult);
      } else {
        skillCheck.mutate(
          {
            chatId: activeChatId,
            skill: sc.skill,
            dc: sc.dc,
            advantage: sc.advantage,
            disadvantage: sc.disadvantage,
            preRolledD20: sc.preRolledD20,
          },
          {
            onSuccess: (res) => setPendingSkillCheck(res.result),
          },
        );
      }
    }

    // Element attacks — show reaction popup for first element_attack tag
    if (tags.elementAttacks.length > 0) {
      const ea = tags.elementAttacks[0]!;
      setPendingReaction({
        reaction: `${ea.element.charAt(0).toUpperCase() + ea.element.slice(1)} Strike`,
        description: `An elemental ${ea.element} attack strikes ${ea.target}!`,
        damageMultiplier: 1,
        attackerName: "Player",
        defenderName: ea.target,
        element: ea.element,
      });
      const canApplyToActiveCombat = gameState === "combat" && !!combatParty && !!combatEnemies;
      if (canApplyToActiveCombat && !appliedCombatElementMessageIdsRef.current.has(msg.id)) {
        const applied = applyElementAttackTagsToCombatants(combatParty, combatEnemies, tags.elementAttacks);
        if (applied.appliedCount > 0) {
          setCombatParty(applied.party);
          setCombatEnemies(applied.enemies);
        }
        appliedCombatElementMessageIdsRef.current.add(msg.id);
      }
    }

    if (tags.combatStatuses.length > 0) {
      const canApplyToActiveCombat = gameState === "combat" && !!combatParty && !!combatEnemies;
      if (canApplyToActiveCombat) {
        if (!appliedCombatStatusMessageIdsRef.current.has(msg.id)) {
          const applied = applyCombatStatusTagsToCombatants(combatParty, combatEnemies, tags.combatStatuses);
          if (applied.appliedCount > 0) {
            setCombatParty(applied.party);
            setCombatEnemies(applied.enemies);
          }
          appliedCombatStatusMessageIdsRef.current.add(msg.id);
        }
      } else if (tags.combatEncounter || tags.stateChange === "combat" || gameState === "combat") {
        setQueuedCombatStatuses({ statuses: tags.combatStatuses, messageId: msg.id });
      }
    }

    // QTE tags always from the main model
    if (tags.qte && !hasQteResponseAfterMessage(msg.id)) {
      setQueuedQte({ qte: tags.qte, messageId: msg.id });
    }

    // Choice tags always from the main model (must be set before scene branching
    // so they appear regardless of sidecar / connection / inline path)
    if (tags.choices) {
      setActiveChoices(tags.choices);
    }

    // Scene wrap-up: handle bg, music, sfx, ambient, widgets, state changes
    // Widget updates always come from the GM model (not sidecar), apply them immediately
    for (const wu of tags.widgetUpdates) {
      applyWidgetUpdate(wu);
    }

    // State change tags always come from the GM model — transition via server so
    // the new state is validated, persisted to chatMeta (survives refetch/refresh),
    // and triggers side effects (combat checkpoint, OOC influence).
    if (tags.stateChange) {
      const next = sceneAnalysisState;
      const deferCombatTransition = next === "combat";
      if (deferCombatTransition) {
        // Combat starts after the narrated turn is fully read; either the
        // legacy queued encounter or the generated combat JSON effect performs
        // the transition when it can mount a ready combat UI.
      } else {
        // Optimistic local update so the map icon flips immediately
        useGameModeStore.getState().setGameState(next);
        transitionGameState.mutate({ chatId: activeChatId, newState: next });
      }
    }

    // NPC reputation actions from inline [reputation:] tags
    if (tags.reputationActions.length > 0) {
      const repActions = tags.reputationActions.map((ra) => ({
        npcId: ra.npcName,
        action: ra.action,
      }));
      _updateReputation.mutate({ chatId: activeChatId, actions: repActions });
    }

    // Inventory updates — apply when the relevant segment is reached, not at turn start.
    if (tags.inventoryUpdates.length > 0) {
      const timedInventoryUpdates = parseSegmentInventoryUpdates(msg.content);
      if (timedInventoryUpdates.length > 0) {
        setPendingInventorySegmentUpdates(timedInventoryUpdates);
      } else if (!tags.cleanContent.trim()) {
        applyInventoryUpdates(tags.inventoryUpdates);
      } else {
        setPendingInventorySegmentUpdates(tags.inventoryUpdates.map((update) => ({ segment: 0, update })));
      }
    }

    if (tags.partyChanges.length > 0) {
      handlePartyChangeCommands(msg.id, tags.partyChanges);
    }

    console.warn("[scene-wrapup] path:", useSidecar ? "sidecar" : sceneConnId ? "connection" : "inline-only");

    // Only send assets the LLM actually picks from: backgrounds (capped 50) and SFX (capped 50).
    // Music and ambient are handled by deterministic server-side scoring — not sent.
    const assetKeys = Object.keys(assets ?? {});
    const bgTags = sampleTags(getSceneBackgroundTags(assetKeys), 50);
    const sfxTags = sampleTags(
      assetKeys.filter((k) => k.startsWith("sfx:")),
      50,
    );
    const sceneContext = {
      currentState: sceneAnalysisState,
      availableBackgrounds: bgTags,
      availableSfx: sfxTags,
      activeWidgets: hudWidgets,
      trackedNpcs: npcs,
      characterNames: sceneWrapCharacterNames,
      currentBackground: currentBackground,
      currentMusic: useGameAssetStore.getState().currentMusic,
      recentMusic: recentMusicHistoryRef.current,
      currentAmbient: useGameAssetStore.getState().currentAmbient,
      currentWeather: gameSnapshot?.weather ?? null,
      currentTimeOfDay: gameSnapshot?.time ?? null,
      canGenerateBackgrounds: !!chatMeta.enableSpriteGeneration && !!chatMeta.gameImageConnectionId,
      canGenerateIllustrations: !!chatMeta.enableSpriteGeneration && !!chatMeta.gameImageConnectionId,
      artStylePrompt:
        ((chatMeta.gameSetupConfig as Record<string, unknown> | undefined)?.artStylePrompt as string | undefined) ??
        null,
    };

    // Clear any previous scene analysis timeout
    if (sceneAnalysisTimeoutRef.current) {
      clearTimeout(sceneAnalysisTimeoutRef.current);
      sceneAnalysisTimeoutRef.current = null;
    }

    const onComplete = () => {
      if (sceneAnalysisTimeoutRef.current) {
        clearTimeout(sceneAnalysisTimeoutRef.current);
        sceneAnalysisTimeoutRef.current = null;
      }
    };

    if (useSidecar) {
      sceneAnalysis.mutate(
        {
          narration: tags.cleanContent,
          context: sceneContext,
        },
        {
          onSuccess: (r) => {
            onComplete();
            applySceneResult(r, msg);
          },
          onError: () => {
            onComplete();
            setSceneAnalysisFailed(true);
            applyInlineTags(tags, assets, msg);
            if (sceneReadyMsgIdRef.current !== msg.id) {
              sceneReadyMsgIdRef.current = msg.id;
              setSceneReadyTick((t) => t + 1);
            }
          },
        },
      );
    } else if (sceneConnId) {
      sceneAnalysis.mutate(
        {
          chatId: activeChatId,
          connectionId: sceneConnId || undefined,
          narration: tags.cleanContent,
          context: sceneContext,
        },
        {
          onSuccess: (r) => {
            onComplete();
            applySceneResult(r, msg);
          },
          onError: (err) => {
            onComplete();
            console.warn("[scene-wrapup] scene-wrap failed:", err);
            setSceneAnalysisFailed(true);
            applyInlineTags(tags, assets, msg);
            if (sceneReadyMsgIdRef.current !== msg.id) {
              sceneReadyMsgIdRef.current = msg.id;
              setSceneReadyTick((t) => t + 1);
            }
          },
        },
      );
    } else {
      // No scene model at all: parse inline tags from the main model
      applyInlineTags(tags, assets, msg);
      return;
    }

    // Safety timeout: if neither onSuccess nor onError fires within 120s, auto-fail.
    // Generous because scene-wrap may still generate a background image inline.
    sceneAnalysisTimeoutRef.current = setTimeout(() => {
      sceneAnalysisTimeoutRef.current = null;
      if (sceneReadyMsgIdRef.current !== msg.id) {
        console.warn("[scene-wrapup] Scene analysis timed out after 120s, falling back to inline tags");
        setSceneAnalysisFailed(true);
        applyInlineTags(tags, assets, msg);
        if (sceneReadyMsgIdRef.current !== msg.id) {
          sceneReadyMsgIdRef.current = msg.id;
          setSceneReadyTick((t) => t + 1);
        }
      }
    }, 120_000);
  };

  function applyInlineTags(gmTags: ReturnType<typeof parseGmTags>, assetMap: any, msg: { id: string }) {
    const sceneAnalysisState: GameActiveState =
      gmTags.combatEncounter || gmTags.stateChange === "combat"
        ? "combat"
        : gmTags.stateChange === "exploration" ||
            gmTags.stateChange === "dialogue" ||
            gmTags.stateChange === "travel_rest"
          ? gmTags.stateChange
          : gameState;
    // Music is handled by the rule engine, not the GM's inline [music:] tag
    const musicTags = Object.keys(assetMap ?? {}).filter((k) => k.startsWith("music:"));
    const scoredMusic = scoreMusic({
      state: sceneAnalysisState,
      weather: gameSnapshot?.weather ?? null,
      timeOfDay: gameSnapshot?.time ?? null,
      musicIntensity:
        sceneAnalysisState === "combat" ? "intense" : sceneAnalysisState === "travel_rest" ? "calm" : null,
      currentMusic: useGameAssetStore.getState().currentMusic,
      recentMusic: recentMusicHistoryRef.current,
      availableMusic: musicTags,
    });
    if (scoredMusic) {
      audioManager.playMusic(scoredMusic, assetMap);
      useGameAssetStore.getState().setCurrentMusic(scoredMusic);
    }
    for (const sfx of gmTags.sfx) {
      const resolved = resolveAssetTag(sfx, "sfx", assetMap);
      audioManager.playSfx(resolved, assetMap);
    }
    // Ambient is handled by the rule engine, not the GM's inline [ambient:] tag
    const ambientTags = Object.keys(assetMap ?? {}).filter((k) => k.startsWith("ambient:"));
    const scoredAmbient = scoreAmbient({
      state: sceneAnalysisState,
      weather: gameSnapshot?.weather ?? null,
      timeOfDay: gameSnapshot?.time ?? null,
      currentAmbient: useGameAssetStore.getState().currentAmbient,
      availableAmbient: ambientTags,
      background: useGameAssetStore.getState().currentBackground,
    });
    if (scoredAmbient) {
      audioManager.playAmbient(scoredAmbient, assetMap);
      useGameAssetStore.getState().setCurrentAmbient(scoredAmbient);
    }
    if (gmTags.background) {
      const resolved = resolveAssetTag(gmTags.background, "backgrounds", assetMap);
      useGameAssetStore.getState().setCurrentBackground(resolved);
    } else if (!useGameAssetStore.getState().currentBackground) {
      const bgKeys = Object.keys(assetMap ?? {}).filter((k) => k.startsWith("backgrounds:"));
      if (bgKeys.length > 0) {
        const pick = bgKeys.find((k) => /town|village|forest|field|default|start/i.test(k)) ?? bgKeys[0]!;
        useGameAssetStore.getState().setCurrentBackground(pick);
      }
    }
    // Scene effects are applied — ungate narration
    sceneReadyMsgIdRef.current = msg.id;
    setSceneReadyTick((t) => t + 1);
  }

  const installGeneratedIllustration = useCallback(
    async (illustration: { tag: string; segment?: number }) => {
      void queryClient.invalidateQueries({ queryKey: ["gallery", activeChatId] });
      await fetchManifest();
      if (illustration.segment !== undefined && illustration.segment > 0) {
        setPendingSegmentEffects((previous) => {
          const existingIndex = previous.findIndex((effect) => effect.segment === illustration.segment);
          if (existingIndex >= 0) {
            return previous.map((effect, index) =>
              index === existingIndex ? { ...effect, background: illustration.tag } : effect,
            );
          }
          return [...previous, { segment: illustration.segment!, background: illustration.tag }];
        });
        return;
      }
      useGameAssetStore.getState().setCurrentBackground(illustration.tag);
    },
    [activeChatId, fetchManifest, queryClient],
  );

  const openImagePromptReview = useCallback((items: GameImagePromptReviewItem[]) => {
    return new Promise<GameImagePromptOverride[] | null>((resolve) => {
      imagePromptReviewResolveRef.current = resolve;
      setImagePromptReviewSubmitting(false);
      setImagePromptReviewItems(items);
    });
  }, []);

  const closeImagePromptReview = useCallback((overrides: GameImagePromptOverride[] | null) => {
    const resolve = imagePromptReviewResolveRef.current;
    imagePromptReviewResolveRef.current = null;
    setImagePromptReviewSubmitting(false);
    setImagePromptReviewItems([]);
    resolve?.(overrides);
  }, []);

  const imagePromptReviewModal = (
    <GameImagePromptReviewModal
      open={imagePromptReviewItems.length > 0}
      items={imagePromptReviewItems}
      isSubmitting={imagePromptReviewSubmitting}
      onCancel={() => closeImagePromptReview(null)}
      onConfirm={(overrides) => closeImagePromptReview(overrides)}
    />
  );

  const runGameAssetGeneration = useCallback(
    async (assetPayload: GameAssetGenerationPayload): Promise<GameAssetGenerationResult | null> => {
      const payload: GameAssetGenerationPayload = {
        ...assetPayload,
        debugMode: useUIStore.getState().debugMode,
        imageSizes: getConfiguredGameAssetImageSizes(),
      };

      if (useUIStore.getState().reviewImagePromptsBeforeSend) {
        let preview: { items: GameImagePromptReviewItem[] } | undefined;
        try {
          preview = await withTimeout(
            (signal) => api.post<{ items: GameImagePromptReviewItem[] }>("/game/generate-assets/preview", payload, { signal }),
            GAME_ASSET_PREVIEW_TIMEOUT_MS,
            () => {
              toast.error("Image prompt preview timed out. Continuing with the default prompts.");
            },
          );
        } catch (error) {
          if (isTimeoutError(error)) {
            preview = { items: [] };
          } else {
            throw error;
          }
        }

        if (preview.items.length > 0) {
          let overrides: GameImagePromptOverride[] | null | typeof IMAGE_PROMPT_REVIEW_TIMED_OUT | undefined;
          try {
            overrides = await withTimeout(
              () => openImagePromptReview(preview.items),
              GAME_ASSET_PROMPT_REVIEW_TIMEOUT_MS,
              () => {
                closeImagePromptReview(null);
                toast.error("Image prompt review timed out. Continuing with the default prompts.");
              },
            );
          } catch (error) {
            if (isTimeoutError(error)) {
              overrides = IMAGE_PROMPT_REVIEW_TIMED_OUT;
            } else {
              throw error;
            }
          }

          if (overrides === null || overrides === undefined) return null;
          if (overrides !== IMAGE_PROMPT_REVIEW_TIMED_OUT) {
            setImagePromptReviewSubmitting(true);
            payload.promptOverrides = overrides;
          }
        }
      }

      return await withTimeout(
        (signal) => api.post<GameAssetGenerationResult>("/game/generate-assets", payload, { signal }),
        GAME_ASSET_GENERATION_TIMEOUT_MS,
        () => {
          toast.error("Image generation timed out. The scene will continue without generated assets.");
        },
      );
    },
    [closeImagePromptReview, openImagePromptReview],
  );

  const applyGeneratedAssets = useCallback(
    async (res: GameAssetGenerationResult) => {
      if (res.generatedBackground) {
        await fetchManifest();
        useGameAssetStore.getState().setCurrentBackground(res.generatedBackground!);
      }
      if (res.generatedIllustration) {
        await installGeneratedIllustration(res.generatedIllustration);
      }
      if (res.generatedNpcAvatars?.length) {
        useGameModeStore.getState().patchNpcAvatars(res.generatedNpcAvatars);
      }
    },
    [fetchManifest, installGeneratedIllustration],
  );

  async function applySceneResult(result: import("@marinara-engine/shared").SceneAnalysis, msg: { id: string }) {
    console.log("[scene-analysis] Result from model:", JSON.stringify(result, null, 2));
    setSceneAnalysisFailed(false);
    // NOTE: Game state transitions are owned exclusively by the GM model via [state: ...] tags.
    // The scene model no longer emits stateChange to avoid conflicting state flips.

    // Eagerly patch the game state snapshot so WeatherEffects renders immediately.
    // The mutations below also persist to DB, but may race with snapshot creation.
    // If no snapshot exists yet (first turn), create a minimal one.
    const currentGS = useGameStateStore.getState().current;
    if (result.weather || result.timeOfDay) {
      const base = currentGS ?? {
        id: "",
        chatId: activeChatId,
        messageId: "",
        swipeIndex: 0,
        date: null,
        time: null,
        location: null,
        weather: null,
        temperature: null,
        presentCharacters: [],
        recentEvents: [],
        playerStats: null,
        personaStats: null,
        createdAt: "",
      };
      useGameStateStore.getState().setGameState({
        ...base,
        ...(result.weather ? { weather: result.weather } : {}),
        ...(result.timeOfDay ? { time: result.timeOfDay } : {}),
      });
    }

    if (result.weather) {
      updateWeather.mutate({
        chatId: activeChatId,
        action: "set",
        type: result.weather,
        location: gameSnapshot?.location ?? "",
      });
    }
    if (result.timeOfDay) {
      _advanceTime.mutate({ chatId: activeChatId, action: result.timeOfDay });
    }
    if (result.reputationChanges?.length) {
      const repActions = result.reputationChanges.map((rc) => ({
        npcId: rc.npcName,
        action: rc.action,
      }));
      _updateReputation.mutate({ chatId: activeChatId, actions: repActions });
    }
    const assetMap = useGameAssetStore.getState().manifest?.assets ?? null;
    if (result.background) {
      const resolved = resolveAssetTag(result.background, "backgrounds", assetMap);
      useGameAssetStore.getState().setCurrentBackground(resolved);
    } else if (!useGameAssetStore.getState().currentBackground) {
      const bgKeys = Object.keys(assetMap ?? {}).filter((k) => k.startsWith("backgrounds:"));
      if (bgKeys.length > 0) {
        const pick = bgKeys.find((k) => /town|village|forest|field|default|start/i.test(k)) ?? bgKeys[0]!;
        useGameAssetStore.getState().setCurrentBackground(pick);
      }
    }
    if (result.music) {
      const resolved = resolveAssetTag(result.music, "music", assetMap);
      audioManager.playMusic(resolved, assetMap);
      useGameAssetStore.getState().setCurrentMusic(resolved);
    }
    if (result.ambient) {
      const resolved = resolveAssetTag(result.ambient, "ambient", assetMap);
      audioManager.playAmbient(resolved, assetMap);
      useGameAssetStore.getState().setCurrentAmbient(resolved);
    }
    if (result.directions?.length) {
      playDirections(result.directions);
    }

    if (result.segmentEffects?.length) {
      setPendingSegmentEffects(result.segmentEffects);
      appliedSegmentsRef.current = new Set();
      const seg0 = result.segmentEffects.filter((e) => e.segment === 0);
      if (seg0.length > 0) {
        appliedSegmentsRef.current.add(0);
        for (const fx of seg0) {
          if (fx.background) {
            const resolved = resolveAssetTag(fx.background, "backgrounds", assetMap);
            useGameAssetStore.getState().setCurrentBackground(resolved);
          }
          if (fx.music) {
            const resolved = resolveAssetTag(fx.music, "music", assetMap);
            audioManager.playMusic(resolved, assetMap);
            useGameAssetStore.getState().setCurrentMusic(resolved);
          }
          if (fx.sfx?.length)
            for (const s of fx.sfx) audioManager.playSfx(resolveAssetTag(s, "sfx", assetMap), assetMap);
          if (fx.ambient) {
            const resolved = resolveAssetTag(fx.ambient, "ambient", assetMap);
            audioManager.playAmbient(resolved, assetMap);
            useGameAssetStore.getState().setCurrentAmbient(resolved);
          }
          if (fx.directions?.length) {
            playDirections(fx.directions);
          }
        }
      }
    }

    const hasGeneratedBg =
      result.segmentEffects?.some((fx) => fx.background?.startsWith("backgrounds:generated:")) ||
      result.background?.startsWith("backgrounds:generated:");
    if (hasGeneratedBg) {
      await fetchManifest();
    }
    if (result.generatedIllustration) {
      await installGeneratedIllustration(result.generatedIllustration);
    }
    if (result.generatedNpcAvatars?.length) {
      useGameModeStore.getState().patchNpcAvatars(result.generatedNpcAvatars);
    }

    const manifest = useGameAssetStore.getState().manifest;
    if (manifest) {
      const allBgTags = [
        result.background,
        ...(result.segmentEffects?.map((fx) => fx.background).filter(Boolean) ?? []),
      ].filter((t): t is string => !!t && t !== "black" && t !== "none");

      const generatedIllustrationTag = result.generatedIllustration?.tag;
      const unresolvedBg = allBgTags.find((t) => {
        if (t === generatedIllustrationTag || manifest.assets[t]) return false;
        const resolved = resolveAssetTag(t, "backgrounds", manifest.assets);
        return !manifest.assets[resolved];
      });
      // Pre-cache portraits for any tracked named NPC with a description, even if not
      // met yet — by the time the party encounters them their avatar is ready, and the
      // /generate-assets schema already caps this at 10 per turn so cost stays bounded.
      const pendingIllustration = result.generatedIllustration ? null : result.illustration;
      if (unresolvedBg || pendingIllustration || npcsNeedingAvatars.length > 0) {
        const assetPayload = {
          chatId: activeChatId,
          backgroundTag: unresolvedBg || undefined,
          illustration: pendingIllustration ?? undefined,
          npcsNeedingAvatars: npcsNeedingAvatars.length > 0 ? npcsNeedingAvatars : undefined,
          debugMode: useUIStore.getState().debugMode,
        };
        setPendingAssetGeneration(assetPayload);
        setAssetGenerationFailed(false);
        runGameAssetGeneration(assetPayload)
          .then(async (res) => {
            if (res) {
              await applyGeneratedAssets(res);
              setPendingAssetGeneration(null);
            } else {
              setPendingAssetGeneration(null);
            }
            // Ungate narration after assets are installed
            sceneReadyMsgIdRef.current = msg.id;
            setSceneReadyTick((t) => t + 1);
          })
          .catch(() => {
            setAssetGenerationFailed(true);
            // Keep pendingAssetGeneration so retry UI/button remain visible
            sceneReadyMsgIdRef.current = msg.id;
            setSceneReadyTick((t) => t + 1);
          });
        // Don't fall through — narration stays gated until assets finish
        return;
      }
    }

    // Scene effects are applied — ungate narration (no pending assets)
    sceneReadyMsgIdRef.current = msg.id;
    setSceneReadyTick((t) => t + 1);
  }

  // Keep ref up-to-date so retry button can call it
  applySceneResultRef.current = (r) => applySceneResult(r, latestAssistantMsg!);

  /** Retry scene analysis: re-run the full processing pipeline for the current message. */
  const retrySceneAnalysis = useCallback(() => {
    const msg = latestAssistantMsgRef.current;
    if (!msg?.content) return;
    // Allow processScene to run for this message again
    lastProcessedMsgRef.current = null;
    processSceneRef.current?.();
  }, []);

  /** Skip scene analysis and fall back to inline GM tags only. */
  const skipSceneAnalysis = useCallback(() => {
    const msg = latestAssistantMsgRef.current;
    if (!msg?.content) return;
    const manifest = useGameAssetStore.getState().manifest;
    const tags = parseGmTags(msg.content);
    setSceneAnalysisFailed(false);
    applyInlineTags(tags, manifest?.assets ?? null, msg);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Retry failed image/NPC avatar generation. */
  const requestAssetGeneration = useCallback(
    async (assetPayload: GameAssetGenerationPayload, options?: { showSuccessToast?: boolean }) => {
      setPendingAssetGeneration(assetPayload);
      setAssetGenerationFailed(false);

      try {
        const res = await runGameAssetGeneration(assetPayload);

        setPendingAssetGeneration(null);
        if (!res) return null;
        await applyGeneratedAssets(res);
        if (
          options?.showSuccessToast &&
          (res.generatedBackground || res.generatedIllustration || res.generatedNpcAvatars?.length)
        ) {
          toast.success("Missing assets regenerated.", { duration: 1800 });
        }

        return res;
      } catch {
        setAssetGenerationFailed(true);
        return null;
      }
    },
    [applyGeneratedAssets, runGameAssetGeneration],
  );

  const retryAssetGeneration = useCallback(
    (options?: { showSuccessToast?: boolean }) => {
      const assetPayload = pendingAssetGeneration ?? missingSceneAssetGeneration;
      if (!assetPayload) return;
      void requestAssetGeneration(assetPayload, options);
    },
    [pendingAssetGeneration, missingSceneAssetGeneration, requestAssetGeneration],
  );

  useEffect(() => {
    if (!assetManifest) return;
    const sessionStatus = chatMeta.gameSessionStatus as string;
    if (sessionStatus !== "ready" && sessionStatus !== "active") return;
    if (isStreaming || scenePreparing || pendingAssetGeneration) return;

    if (!missingSceneAssetGeneration) {
      autoAssetGenerationKeyRef.current = null;
      return;
    }

    const payloadKey = JSON.stringify(missingSceneAssetGeneration);
    if (autoAssetGenerationKeyRef.current === payloadKey) return;

    autoAssetGenerationKeyRef.current = payloadKey;
    void requestAssetGeneration(missingSceneAssetGeneration);
  }, [
    assetManifest,
    chatMeta.gameSessionStatus,
    isStreaming,
    missingSceneAssetGeneration,
    pendingAssetGeneration,
    requestAssetGeneration,
    scenePreparing,
  ]);

  // Listen for generation-complete DOM event dispatched by use-generate.ts.
  // This is more reliable than Zustand subscriptions which suffer from
  // subscribeWithSelector middleware timing issues + React 19 batching.
  useEffect(() => {
    const handler = (e: Event) => {
      const chatId = (e as CustomEvent).detail?.chatId;
      if (chatId !== activeChatId) return;
      console.warn("[scene-process] generation-complete event received for chat:", chatId);
      // Wait one animation frame so React commits the new messages → ref is fresh
      requestAnimationFrame(() => {
        const tryProcess = (attempt: number) => {
          const msg = latestAssistantMsgRef.current;
          if (msg?.content && lastProcessedMsgRef.current !== msg.id) {
            processSceneRef.current?.();
          } else if (attempt < 10) {
            setTimeout(() => tryProcess(attempt + 1), 200);
          } else {
            console.warn("[scene-process] Gave up waiting for message after generation-complete");
          }
        };
        tryProcess(0);
      });
    };
    window.addEventListener("marinara:generation-complete", handler);
    return () => window.removeEventListener("marinara:generation-complete", handler);
  }, [activeChatId]);

  // Handle assistant/narrator messages that arrive by refetch instead of live streaming,
  // such as session-start recaps and session-conclude summary messages.
  useEffect(() => {
    if (isMessagesLoading || isStreaming) return;
    if (!latestAssistantMsg?.content) return;
    if (lastProcessedMsgRef.current === latestAssistantMsg.id) return;
    processSceneRef.current?.();
  }, [isMessagesLoading, isStreaming, latestAssistantMsg?.content, latestAssistantMsg?.id]);

  // Listen for generation-error event to show retry button.
  useEffect(() => {
    const handler = (e: Event) => {
      const chatId = (e as CustomEvent).detail?.chatId;
      if (chatId !== activeChatId) return;
      setGenerationFailed(true);
    };
    window.addEventListener("marinara:generation-error", handler);
    return () => window.removeEventListener("marinara:generation-error", handler);
  }, [activeChatId]);

  // Clear generationFailed when a new generation starts (streaming begins).
  useEffect(() => {
    if (isStreaming) setGenerationFailed(false);
  }, [isStreaming]);

  // Play blueprint intro sequence only on first-ever load (not on re-navigation)
  useEffect(() => {
    if (introPlayedRef.current || !blueprint?.introSequence?.length) return;
    if (!latestAssistantMsg?.content) return;
    // Skip intro if this is a restored session (user returning to an existing game)
    if (isRestoredRef.current) {
      introPlayedRef.current = true;
      return;
    }
    introPlayedRef.current = true;
    setIntroCinematicActive(true);
    setDirectionsPlaying(true);
    setActiveDirections(blueprint.introSequence);
  }, [blueprint, latestAssistantMsg?.content]);

  // Sync mute state
  useEffect(() => {
    if (!audioSettingsHydrated) return;
    audioManager.setMuted(audioMuted || masterVolume === 0);
  }, [audioMuted, audioSettingsHydrated, masterVolume]);

  useEffect(() => {
    if (!audioSettingsHydrated) return;

    audioManager.setVolumes(
      getEffectiveVolume(masterVolume, musicVolume),
      getEffectiveVolume(masterVolume, sfxVolume),
      getEffectiveVolume(masterVolume, ambientVolume),
    );

    try {
      localStorage.setItem(
        GAME_AUDIO_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          masterVolume,
          musicVolume,
          sfxVolume,
          ttsVolume,
          ambientVolume,
          audioMuted: audioMuted || masterVolume === 0,
        }),
      );
    } catch {
      // Ignore storage failures and keep the in-memory setting.
    }
  }, [ambientVolume, audioMuted, audioSettingsHydrated, masterVolume, musicVolume, sfxVolume, ttsVolume]);

  // Message sending via generate hook
  const { generate, retryAgents } = useGenerate();

  const retryGeneration = useCallback(() => {
    setGenerationFailed(false);
    generate({ chatId: activeChatId, connectionId: null });
  }, [activeChatId, generate]);

  const generateInitialGameTurn = useCallback(() => {
    generate({
      chatId: activeChatId,
      connectionId: null,
      generationGuide: GAME_START_GENERATION_GUIDE,
    });
  }, [activeChatId, generate]);

  const handleRetryTurn = useCallback(async () => {
    const msg = latestAssistantMsgRef.current;
    if (!msg?.id || isStreaming) return;

    setRetryMenuOpen(false);
    setGenerationFailed(false);
    setSceneAnalysisFailed(false);
    setAssetGenerationFailed(false);
    setPendingAssetGeneration(null);
    setActiveChoices(null);
    setActiveQte(null);
    setQueuedQte(null);
    setPendingEncounter(null);
    setQueuedEncounter(null);
    setQueuedCombatGeneration(null);
    setCombatGenerationPending(false);
    setCombatItemEffects([]);
    setCombatMechanics([]);
    setCombatDialogueCues([]);
    setActiveReadable(null);
    readableQueueRef.current = [];
    setPendingSegmentEffects([]);
    setPendingInventorySegmentUpdates([]);
    appliedSegmentsRef.current = new Set();
    appliedInventorySegmentsRef.current = new Set();
    setNarrationDoneMsgId(null);
    sceneReadyMsgIdRef.current = "__retry_turn__";
    setSceneReadyTick((tick) => tick + 1);
    lastProcessedMsgRef.current = null;

    try {
      const receivedContent = await generate({
        chatId: activeChatId,
        connectionId: null,
        regenerateMessageId: msg.id,
      });
      if (receivedContent) {
        toast.success("Turn regenerated.", { duration: 1800 });
      }
    } catch {
      /* generate handles its own error toast */
    }
  }, [activeChatId, generate, isStreaming]);

  const sendMessage = useCallback(
    (message: string, attachments?: Array<{ type: string; data: string }>) => {
      if ((chatMeta.gameSessionStatus as string) === "concluded") return;
      generate({
        chatId: activeChatId,
        connectionId: null,
        userMessage: message,
        ...(attachments?.length ? { attachments } : {}),
      });
    },
    [activeChatId, chatMeta.gameSessionStatus, generate],
  );

  // Game mutations
  const createGame = useCreateGame();
  const gameSetup = useGameSetup();
  const startGame = useStartGame();
  const rollDice = useRollDice();
  const skillCheck = useSkillCheck();
  const moveOnMap = useMoveOnMap();
  const concludeSession = useConcludeSession();
  const regenerateSessionConclusion = useRegenerateSessionConclusion();
  const regenerateSessionLorebook = useRegenerateSessionLorebook();
  const updateCampaignProgression = useUpdateCampaignProgression();
  const startSession = useStartSession();
  const generateMap = useGenerateMap();
  const deleteChat = useDeleteChat();
  const updateChatMetadata = useUpdateChatMetadata();
  const updateSessionHistoryMetadata = useUpdateChatMetadata();
  const updateMessage = useUpdateMessage(activeChatId);
  const startSessionLocked = startSession.isPending || startSessionRequested;
  const maxInventorySlots = 20;
  const gameId = (chatMeta.gameId as string) || null;

  const handleJsonRepairError = useCallback((error: unknown) => {
    const request = getJsonRepairRequest(error);
    if (!request) return false;
    setJsonRepairRequest(request);
    return true;
  }, []);

  const handleGameDayChange = useCallback(
    async (day: number) => {
      if (!activeChatId) return;

      const snapshot = useGameStateStore.getState().current;
      const parsedSnapshotTime = parseHourMinuteFromTimeLabel(snapshot?.chatId === activeChatId ? snapshot.time : null);
      const nextTime = {
        day: normalizeGameDay(day),
        hour: normalizeGameHour(gameTimeMeta?.hour, parsedSnapshotTime?.hour ?? 8),
        minute: normalizeGameMinute(gameTimeMeta?.minute, parsedSnapshotTime?.minute ?? 0),
      };
      const formattedTime = formatGameTimeForHud(nextTime);

      try {
        await updateChatMetadata.mutateAsync({
          id: activeChatId,
          gameTime: nextTime,
        });

        if (snapshot?.chatId === activeChatId) {
          useGameStateStore.getState().setGameState({
            ...snapshot,
            time: formattedTime,
          });
        }
        api.patch(`/chats/${activeChatId}/game-state`, { time: formattedTime }).catch(() => {});
        toast.success(`Set game day to ${nextTime.day}.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update game day.");
      }
    },
    [activeChatId, gameTimeMeta?.hour, gameTimeMeta?.minute, updateChatMetadata],
  );

  const handleJsonRepairApplied = useCallback(
    (result: unknown, request: JsonRepairRequest) => {
      const response = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
      const responseChat =
        response.sessionChat && typeof response.sessionChat === "object" ? (response.sessionChat as Chat) : null;
      const responseGameId = typeof response.gameId === "string" ? response.gameId : gameId;
      const bodyChatId =
        request.applyBody && typeof request.applyBody.chatId === "string" ? request.applyBody.chatId : activeChatId;
      const targetChatId = responseChat?.id ?? bodyChatId;

      if (responseChat) {
        queryClient.setQueryData(chatKeys.detail(responseChat.id), responseChat);
        if (useChatStore.getState().activeChatId === responseChat.id) {
          useChatStore.getState().setActiveChat(responseChat);
        }
      }
      if (targetChatId) {
        queryClient.invalidateQueries({ queryKey: chatKeys.detail(targetChatId) });
        queryClient.invalidateQueries({ queryKey: chatKeys.messages(targetChatId) });
      }
      queryClient.invalidateQueries({ queryKey: chatKeys.list() });
      if (responseGameId) {
        queryClient.invalidateQueries({ queryKey: gameKeys.sessions(responseGameId) });
      }

      if (request.kind === "game_setup") {
        useGameModeStore.getState().setSetupActive(false);
      }
      if (request.kind === "session_conclusion") {
        setConfirmEndSessionOpen(false);
      }
      setJsonRepairRequest(null);
    },
    [activeChatId, gameId, queryClient],
  );

  const handleNpcPortraitClick = useCallback(
    (npcName: string) => {
      if (!activeChatId) return;

      const normalizedName = npcName.trim().toLowerCase();
      if (!normalizedName) return;

      const targetNpc = useGameModeStore
        .getState()
        .npcs.find((npc) => npc.name.trim().toLowerCase() === normalizedName);
      if (!targetNpc) return;

      setPendingNpcPortraitUploadName(targetNpc.name);
      npcPortraitUploadInputRef.current?.click();
    },
    [activeChatId],
  );

  const handleNpcPortraitUpload = useCallback(
    async (npcName: string, file: File) => {
      if (!activeChatId) return;

      const normalizedName = npcName.trim().toLowerCase();
      if (!normalizedName) return;

      const targetNpc = useGameModeStore
        .getState()
        .npcs.find((npc) => npc.name.trim().toLowerCase() === normalizedName);
      if (!targetNpc) return;

      try {
        const avatar = await readFileAsDataUrl(file);
        const response = await api.post<{ avatarPath: string }>(`/avatars/npc/${activeChatId}`, {
          name: targetNpc.name,
          avatar,
        });

        const nextNpcs = useGameModeStore
          .getState()
          .npcs.map((npc) =>
            npc.name.trim().toLowerCase() === normalizedName ? { ...npc, avatarUrl: response.avatarPath } : npc,
          );

        await updateChatMetadata.mutateAsync({
          id: activeChatId,
          gameNpcs: nextNpcs,
        });

        useGameModeStore.getState().patchNpcAvatars([{ name: targetNpc.name, avatarUrl: response.avatarPath }]);
        toast.success(`${targetNpc.name} portrait updated.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Failed to update ${npcName} portrait.`);
      }
    },
    [activeChatId, updateChatMetadata],
  );

  const handleRemoveNpcFromJournal = useCallback(
    async (npcName: string) => {
      if (!activeChatId) return;

      const target = normalizeGameNpcJournalName(npcName);
      if (!target) return;

      const currentNpcs = useGameModeStore.getState().npcs;
      const nextNpcs = currentNpcs.filter((npc) => normalizeGameNpcJournalName(npc.name) !== target);
      const prunedJournal = pruneGameJournalNpc(chatMeta.gameJournal, npcName);

      try {
        await updateChatMetadata.mutateAsync({
          id: activeChatId,
          gameNpcs: nextNpcs,
          gameJournal: prunedJournal,
        });
        useGameModeStore.getState().setNpcs(nextNpcs);
        toast.success(`${cleanGameNpcDisplayName(npcName)} removed from the NPC journal.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Failed to remove ${npcName} from the NPC journal.`);
        throw error;
      }
    },
    [activeChatId, chatMeta.gameJournal, updateChatMetadata],
  );

  const handleAddInventoryItem = useCallback(async () => {
    if (!activeChatId) return null;
    if (inventoryItems.length >= maxInventorySlots) {
      toast.error("Inventory is full.");
      return null;
    }

    const addedItemName = getNextInventoryItemName(inventoryItems);
    const updatedInventory = [...inventoryItems, { name: addedItemName, quantity: 1 }];

    const currentGameState = useGameStateStore.getState().current;
    const currentPlayerStats = currentGameState?.chatId === activeChatId ? currentGameState.playerStats : null;
    const nextPlayerStats = currentPlayerStats
      ? {
          ...currentPlayerStats,
          inventory: [
            ...currentPlayerStats.inventory,
            { name: addedItemName, description: "", quantity: 1, location: "on_person" },
          ],
        }
      : null;
    const shouldPatchGameState =
      Boolean(currentGameState?.chatId === activeChatId) && Boolean(currentPlayerStats) && Boolean(nextPlayerStats);
    let patchedGameState = false;

    try {
      if (shouldPatchGameState && nextPlayerStats) {
        await api.patch(`/chats/${activeChatId}/game-state`, { playerStats: nextPlayerStats });
        patchedGameState = true;
      }

      await updateChatMetadata.mutateAsync({
        id: activeChatId,
        gameInventory: updatedInventory,
      });

      setInventoryItems(updatedInventory);
      if (shouldPatchGameState && currentGameState && nextPlayerStats) {
        useGameStateStore.getState().setGameState({
          ...currentGameState,
          playerStats: nextPlayerStats,
        });
      }

      toast.success(`Added ${addedItemName} to inventory.`);
      return addedItemName;
    } catch (error) {
      if (patchedGameState) {
        api.patch(`/chats/${activeChatId}/game-state`, { playerStats: currentPlayerStats }).catch(() => {});
      }
      const message = error instanceof Error ? error.message : `Failed to add ${addedItemName} to inventory.`;
      toast.error(message);
      return null;
    }
  }, [activeChatId, inventoryItems, maxInventorySlots, updateChatMetadata]);

  const handleRemoveInventoryItem = useCallback(
    async (itemName: string) => {
      if (!activeChatId) return;

      const updatedInventory = removeInventoryUnit(inventoryItems, itemName);
      if (updatedInventory === inventoryItems) {
        toast.error(`${itemName} is no longer in your inventory.`);
        return;
      }

      const currentGameState = useGameStateStore.getState().current;
      const currentPlayerStats = currentGameState?.chatId === activeChatId ? currentGameState.playerStats : null;
      const nextPlayerStats = currentPlayerStats
        ? (() => {
            const updatedDetailedInventory = removeInventoryUnit(currentPlayerStats.inventory, itemName);
            return updatedDetailedInventory === currentPlayerStats.inventory
              ? currentPlayerStats
              : { ...currentPlayerStats, inventory: updatedDetailedInventory };
          })()
        : null;
      const shouldPatchGameState =
        Boolean(currentGameState?.chatId === activeChatId) &&
        Boolean(currentPlayerStats) &&
        nextPlayerStats !== currentPlayerStats;
      let patchedGameState = false;

      try {
        if (shouldPatchGameState && nextPlayerStats) {
          await api.patch(`/chats/${activeChatId}/game-state`, { playerStats: nextPlayerStats });
          patchedGameState = true;
        }

        await updateChatMetadata.mutateAsync({
          id: activeChatId,
          gameInventory: updatedInventory,
        });

        setInventoryItems(updatedInventory);
        if (shouldPatchGameState && currentGameState && nextPlayerStats) {
          useGameStateStore.getState().setGameState({
            ...currentGameState,
            playerStats: nextPlayerStats,
          });
        }

        setInventoryNotifications([`You removed ${itemName}.`]);
        if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
        notificationTimerRef.current = setTimeout(() => setInventoryNotifications([]), 4000);
        toast.success(`Removed ${itemName} from inventory.`);
      } catch (error) {
        if (patchedGameState) {
          api.patch(`/chats/${activeChatId}/game-state`, { playerStats: currentPlayerStats }).catch(() => {});
        }
        const message = error instanceof Error ? error.message : `Failed to remove ${itemName} from inventory.`;
        toast.error(message);
      }
    },
    [activeChatId, inventoryItems, updateChatMetadata],
  );

  const handleUseCombatInventoryItem = useCallback(
    async (itemName: string) => {
      if (!activeChatId) return;

      const normalizedItemName = normalizeInventoryName(itemName);
      const updatedInventory = removeInventoryUnit(inventoryItems, normalizedItemName);
      if (updatedInventory === inventoryItems) {
        toast.error(`${normalizedItemName || itemName} is no longer in your inventory.`);
        return;
      }

      const currentGameState = useGameStateStore.getState().current;
      const currentPlayerStats = currentGameState?.chatId === activeChatId ? currentGameState.playerStats : null;
      const nextPlayerStats = currentPlayerStats
        ? (() => {
            const updatedDetailedInventory = removeInventoryUnit(currentPlayerStats.inventory, normalizedItemName);
            return updatedDetailedInventory === currentPlayerStats.inventory
              ? currentPlayerStats
              : { ...currentPlayerStats, inventory: updatedDetailedInventory };
          })()
        : null;
      const shouldPatchGameState =
        Boolean(currentGameState?.chatId === activeChatId) &&
        Boolean(currentPlayerStats) &&
        nextPlayerStats !== currentPlayerStats;
      let patchedGameState = false;

      try {
        if (shouldPatchGameState && nextPlayerStats) {
          await api.patch(`/chats/${activeChatId}/game-state`, { playerStats: nextPlayerStats });
          patchedGameState = true;
        }

        await updateChatMetadata.mutateAsync({
          id: activeChatId,
          gameInventory: updatedInventory,
        });

        setInventoryItems(updatedInventory);
        if (shouldPatchGameState && currentGameState && nextPlayerStats) {
          useGameStateStore.getState().setGameState({
            ...currentGameState,
            playerStats: nextPlayerStats,
          });
        }

        api
          .post("/game/journal/entry", {
            chatId: activeChatId,
            type: "item",
            data: { item: normalizedItemName, action: "used", quantity: 1 },
          })
          .catch(() => {});

        setInventoryNotifications([`You used ${normalizedItemName}.`]);
        if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
        notificationTimerRef.current = setTimeout(() => setInventoryNotifications([]), 4000);
        toast.success(`Used ${normalizedItemName}.`);
      } catch (error) {
        if (patchedGameState) {
          api.patch(`/chats/${activeChatId}/game-state`, { playerStats: currentPlayerStats }).catch(() => {});
        }
        const message = error instanceof Error ? error.message : `Failed to use ${normalizedItemName}.`;
        toast.error(message);
      }
    },
    [activeChatId, inventoryItems, updateChatMetadata],
  );

  const handleRenameInventoryItem = useCallback(
    async (currentName: string, nextName: string) => {
      if (!activeChatId) return null;

      const renamedInventory = renameInventoryItem(inventoryItems, currentName, nextName);
      if (!renamedInventory) {
        toast.error(`${currentName} is no longer in your inventory.`);
        return null;
      }

      const { items: updatedInventory, resolvedName } = renamedInventory;
      if (updatedInventory === inventoryItems) {
        return resolvedName;
      }

      const currentGameState = useGameStateStore.getState().current;
      const currentPlayerStats = currentGameState?.chatId === activeChatId ? currentGameState.playerStats : null;
      const nextPlayerStats = currentPlayerStats
        ? (() => {
            const renamedDetailedInventory = renameInventoryItem(currentPlayerStats.inventory, currentName, nextName);
            return renamedDetailedInventory
              ? { ...currentPlayerStats, inventory: renamedDetailedInventory.items }
              : currentPlayerStats;
          })()
        : null;
      const shouldPatchGameState =
        Boolean(currentGameState?.chatId === activeChatId) &&
        Boolean(currentPlayerStats) &&
        nextPlayerStats !== currentPlayerStats;
      let patchedGameState = false;

      try {
        if (shouldPatchGameState && nextPlayerStats) {
          await api.patch(`/chats/${activeChatId}/game-state`, { playerStats: nextPlayerStats });
          patchedGameState = true;
        }

        await updateChatMetadata.mutateAsync({
          id: activeChatId,
          gameInventory: updatedInventory,
        });

        setInventoryItems(updatedInventory);
        if (shouldPatchGameState && currentGameState && nextPlayerStats) {
          useGameStateStore.getState().setGameState({
            ...currentGameState,
            playerStats: nextPlayerStats,
          });
        }

        toast.success(`Renamed ${currentName} to ${resolvedName}.`);
        return resolvedName;
      } catch (error) {
        if (patchedGameState) {
          api.patch(`/chats/${activeChatId}/game-state`, { playerStats: currentPlayerStats }).catch(() => {});
        }
        const message = error instanceof Error ? error.message : `Failed to rename ${currentName} to ${resolvedName}.`;
        toast.error(message);
        return null;
      }
    },
    [activeChatId, inventoryItems, updateChatMetadata],
  );

  const handleEditSegment = useCallback(
    (messageId: string, segmentIndex: number, edit: GameSegmentEdit) => {
      if (!messageId) return;
      const payload = serializeGameSegmentEdit(edit);
      if (!payload) return;
      const key = `segmentEdit:${messageId}:${segmentIndex}`;
      setSegmentEdits((prev) => {
        const next = new Map(prev);
        next.set(`${messageId}:${segmentIndex}`, payload);
        return next;
      });
      api.patch(`/chats/${activeChatId}/metadata`, { [key]: payload }).catch(() => {});

      if (payload.readableContent) {
        upsertReadableJournalEntry({
          type: payload.readableType ?? "note",
          content: payload.readableContent,
          sourceMessageId: messageId,
          sourceSegmentIndex: segmentIndex,
        });
      }
    },
    [activeChatId, upsertReadableJournalEntry],
  );

  const handleDeleteSegment = useCallback(
    (messageId: string, segmentIndex: number) => {
      if (!messageId) return;
      const key = `segmentDelete:${messageId}:${segmentIndex}`;
      setSegmentDeletes((prev) => {
        const next = new Set(prev);
        next.add(`${messageId}:${segmentIndex}`);
        return next;
      });
      api.patch(`/chats/${activeChatId}/metadata`, { [key]: true }).catch(() => {});
    },
    [activeChatId],
  );

  const handleEditMessage = useCallback(
    (messageId: string, content: string) => {
      updateMessage.mutate({ messageId, content });
    },
    [updateMessage],
  );

  const [gameInputFocusToken, setGameInputFocusToken] = useState(0);

  // Wheel-nav state. `messageOffset` is how many assistant turns back the player is
  // currently reviewing (0 = present). `nextActionToken` is bumped each time a
  // background click should fire the Next/Return action inside GameNarration.
  const [messageOffset, setMessageOffset] = useState(0);
  const [nextActionToken, setNextActionToken] = useState(0);
  // Reset offset on chat switch so we never review the wrong chat's history.
  useEffect(() => {
    setMessageOffset(0);
    setNextActionToken(0);
  }, [activeChatId]);

  // The actual wheel-nav clamp comes from GameNarration — it knows how many flat
  // log entries exist. Until it reports, we conservatively cap at 0 (wheel-up no-op).
  const [wheelNavMaxOffset, setWheelNavMaxOffset] = useState(0);
  const handleMaxNavOffsetChange = useCallback((max: number) => setWheelNavMaxOffset(max), []);

  // Click / Next while reviewing past: step ONE entry forward. Symmetric with
  // wheel-down. The dedicated Return button (rendered separately) jumps home in one shot.
  const handleStepForward = useCallback(() => {
    setMessageOffset((curr) => Math.max(0, curr - 1));
  }, []);
  const handleReturnToLatest = useCallback(() => {
    setMessageOffset(0);
  }, []);

  // Document-level wheel + click listener for game-mode wheel navigation.
  // Window-level wheel + click listener for game-mode wheel navigation. Capture phase
  // so nothing can stopPropagation us out of the loop. We skip events that originate
  // inside any interactive UI element or overlay panel — buttons, links, inputs, ARIA
  // roles, and any container marked `[data-game-skip-bg-nav="true"]`. Everything else
  // (the chat card body, sprites, the bg image, empty space) navs.
  const lastWheelAtRef = useRef(0);
  useEffect(() => {
    if (!gameMiddleMouseNav) return;
    const max = wheelNavMaxOffset;

    const SKIP_SELECTOR = [
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "label",
      '[role="button"]',
      '[role="link"]',
      '[role="dialog"]',
      '[role="menu"]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[role="tablist"]',
      '[role="slider"]',
      '[role="checkbox"]',
      '[role="switch"]',
      '[role="combobox"]',
      '[role="listbox"]',
      '[role="option"]',
      "[data-radix-popper-content-wrapper]",
      '[data-game-skip-bg-nav="true"]',
    ].join(",");
    const inSkipUi = (target: EventTarget | null): Element | null => {
      if (!(target instanceof Element)) return null;
      return target.closest(SKIP_SELECTOR);
    };

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      if (inSkipUi(event.target)) return;
      const now = Date.now();
      // Throttle ~60ms so a single physical scroll-tick doesn't fire many times on touchpads.
      if (now - lastWheelAtRef.current < 60) return;
      lastWheelAtRef.current = now;
      if (event.deltaY < 0) {
        setMessageOffset((curr) => Math.min(curr + 1, max));
      } else {
        setMessageOffset((curr) => (curr > 0 ? curr - 1 : 0));
      }
    };

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (inSkipUi(event.target)) return;
      setNextActionToken((t) => t + 1);
    };

    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("click", onClick, { capture: true });
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
      window.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
    };
  }, [gameMiddleMouseNav, wheelNavMaxOffset]);

  // Two-stage interrupt:
  //   1. Player clicks Interrupt → narration pauses (modal pre-empts further reading)
  //      and we stash a *candidate* with the truncation we'd apply on commit.
  //   2. Modal confirms via Yes ("risky") or Force Interrupt ("force"). On commit
  //      we move the candidate into `pendingInterrupt` with a mode tag. Risky mode
  //      tells the GM (system message) about the interrupt; force mode does not.
  // Nothing is mutated server-side until the player presses Send.
  const [interruptCandidate, setInterruptCandidate] = useState<{
    chatId: string | null;
    messageId: string | null;
    truncatedContent: string | null;
  } | null>(null);
  const [interruptModalOpen, setInterruptModalOpen] = useState(false);
  const [pendingInterrupt, setPendingInterrupt] = useState<{
    chatId: string | null;
    messageId: string | null;
    truncatedContent: string | null;
    mode: "risky" | "force";
  } | null>(null);

  const createMessage = useCreateMessage(activeChatId);

  const handleInterruptRequest = useCallback(
    ({ messageId, truncatedContent }: { messageId: string | null; truncatedContent: string | null }) => {
      setInterruptCandidate({ chatId: activeChatId, messageId, truncatedContent });
      setInterruptModalOpen(true);
    },
    [activeChatId],
  );

  const handleInterruptCancel = useCallback(() => {
    setPendingInterrupt(null);
    setInterruptCandidate(null);
    setInterruptModalOpen(false);
  }, []);

  const closeInterruptModal = useCallback(() => {
    // Player declined ("No"): clear candidate so narration can resume.
    setInterruptModalOpen(false);
    setInterruptCandidate(null);
  }, []);

  const confirmInterrupt = useCallback(
    (mode: "risky" | "force") => {
      if (!interruptCandidate) {
        setInterruptModalOpen(false);
        return;
      }
      useChatStore.getState().stopGeneration();
      setPendingInterrupt({ ...interruptCandidate, mode });
      setInterruptModalOpen(false);
      setInterruptCandidate(null);
      setGameInputFocusToken((t) => t + 1);
    },
    [interruptCandidate],
  );

  // If the assistant message changes (new GM turn arrived) or the player switches chats,
  // any pending anchor is stale — drop it.
  const pendingInterruptMessageId = pendingInterrupt?.messageId ?? null;
  const pendingInterruptChatId = pendingInterrupt?.chatId ?? null;
  useEffect(() => {
    if (!pendingInterrupt) return;
    if (pendingInterruptChatId !== activeChatId) {
      setPendingInterrupt(null);
      return;
    }
    const latestAssistantId = latestAssistantMsg?.id ?? null;
    if (pendingInterruptMessageId && latestAssistantId && pendingInterruptMessageId !== latestAssistantId) {
      setPendingInterrupt(null);
      return;
    }
    if (pendingInterruptMessageId) {
      const stillExists = messages.some((m) => m.id === pendingInterruptMessageId);
      if (!stillExists) setPendingInterrupt(null);
    }
  }, [
    activeChatId,
    latestAssistantMsg?.id,
    messages,
    pendingInterrupt,
    pendingInterruptChatId,
    pendingInterruptMessageId,
  ]);

  // Same staleness rules apply to the unconfirmed candidate.
  useEffect(() => {
    if (!interruptCandidate) return;
    if (interruptCandidate.chatId !== activeChatId) {
      setInterruptCandidate(null);
      setInterruptModalOpen(false);
      return;
    }
    const latestAssistantId = latestAssistantMsg?.id ?? null;
    if (interruptCandidate.messageId && latestAssistantId && interruptCandidate.messageId !== latestAssistantId) {
      setInterruptCandidate(null);
      setInterruptModalOpen(false);
    }
  }, [activeChatId, interruptCandidate, latestAssistantMsg?.id]);

  // The narration pauses while the modal is open (pre-confirm) OR while a
  // pending interrupt is in flight (post-confirm, awaiting send/Resume).
  // `interruptCommitted` is the post-confirm subset — it gates the Resume button
  // and the early input reveal so neither shows behind the confirmation modal.
  const interruptPending =
    (interruptModalOpen || !!pendingInterrupt) && (pendingInterrupt?.chatId ?? activeChatId) === activeChatId;
  const interruptCommitted = !!pendingInterrupt && pendingInterrupt.chatId === activeChatId;
  const pendingInterruptMode = pendingInterrupt?.mode ?? null;

  // Party members from setup config
  const partyMembers = useMemo(() => {
    const config = chatMeta.gameSetupConfig as Record<string, unknown> | undefined;
    const ids = mergeUniqueIds(getActivePartyIds(chatMeta), chatCharacterIds);
    const npcByPartyId = buildPartyNpcLookup(npcs, chatMeta.gameNpcs);
    const baseMembers = ids
      .map((id) => {
        const c = characters.find((ch) => ch.id === id);
        if (c) {
          const fromMap = characterMap.get(c.id);
          return {
            id: c.id,
            name: c.name,
            avatarUrl: c.avatarUrl ?? null,
            avatarCrop: c.avatarCrop ?? fromMap?.avatarCrop ?? null,
            nameColor: fromMap?.nameColor,
            dialogueColor: fromMap?.dialogueColor,
            canRemove: true,
          };
        }

        const npc = npcByPartyId.get(id);
        if (!npc) return null;
        return {
          id,
          name: npc.name,
          avatarUrl: npc.avatarUrl ?? null,
          canRemove: true,
        };
      })
      .filter(Boolean) as GamePartyMemberInfo[];

    if (personaInfo?.name) {
      const configPersonaId = (config?.personaId as string | undefined) ?? null;
      const personaId = configPersonaId ? `persona:${configPersonaId}` : "persona:active";
      if (!baseMembers.some((m) => m.id === personaId)) {
        baseMembers.unshift({
          id: personaId,
          name: personaInfo.name,
          avatarUrl: personaInfo.avatarUrl ?? null,
          nameColor: personaInfo.nameColor,
          dialogueColor: personaInfo.dialogueColor,
          canRemove: false,
        });
      }
    } else {
      // No persona selected — add a default "Player" entry
      if (!baseMembers.some((m) => m.id === "persona:default")) {
        baseMembers.unshift({
          id: "persona:default",
          name: "Player",
          avatarUrl: null,
          canRemove: false,
        });
      }
    }

    return baseMembers;
  }, [chatCharacterIds, chatMeta, characters, characterMap, npcs, personaInfo]);

  // Auto-open the in-game tutorial on the user's first game.
  // Guard: only when setup is complete, party is loaded, and the user
  // hasn't permanently disabled it. Fires once per chat mount.
  useEffect(() => {
    if (tutorialAutoTriggeredRef.current) return;
    if (gameTutorialDisabled) return;
    if (isSetupActive) return;
    if (partyMembers.length === 0) return;
    tutorialAutoTriggeredRef.current = true;
    // Small delay so the UI has time to mount/layout before the tooltip measures rects
    const t = window.setTimeout(() => setTutorialOpen(true), 600);
    return () => window.clearTimeout(t);
  }, [gameTutorialDisabled, isSetupActive, partyMembers.length]);

  const handleCloseTutorial = useCallback(() => {
    setTutorialOpen(false);
    // Mark as dismissed so it doesn't auto-open for future games.
    // The (?) help button will still re-open it on demand.
    setGameTutorialDisabled(true);
  }, [setGameTutorialDisabled]);

  const handleRemovePartyMemberFromBar = useCallback(
    async (member: { id: string; name: string; canRemove?: boolean }) => {
      if (!activeChatId || !member.canRemove) return;
      const confirmed = await showConfirmDialog({
        title: "Remove party member?",
        message: `Remove ${member.name} from the active party? Their game character card will be kept in case they rejoin later.`,
        confirmLabel: "Remove",
        cancelLabel: "Keep",
        tone: "destructive",
      });
      if (!confirmed) return;

      setRemovingPartyMemberId(member.id);
      try {
        await removePartyMember.mutateAsync({ chatId: activeChatId, characterName: member.name });
      } finally {
        setRemovingPartyMemberId(null);
      }
    },
    [activeChatId, removePartyMember],
  );

  const combatUiActive = gameState === "combat" && !!combatParty && !!combatEnemies;
  const topOverlayOffsetClass = "top-3";

  const combatDialogueLines = useMemo(() => {
    if (!combatUiActive || !latestAssistantMsg?.content || isStreaming) return [];
    if (latestAssistantMsg.id === combatStartMessageId) return [];
    const tags = parseGmTags(latestAssistantMsg.content);
    if (!/^\s*\[[^\]]+]\s*\[/m.test(tags.cleanContent)) return [];
    return parsePartyDialogue(tags.cleanContent).filter((line) => line.type !== "action" && line.content.trim());
  }, [combatStartMessageId, combatUiActive, isStreaming, latestAssistantMsg?.content, latestAssistantMsg?.id]);

  const voicedCombatSpeakerNames = useMemo(() => {
    if (!combatParty || !combatEnemies) return [];
    return [
      ...combatParty.map((member) => member.name),
      ...combatEnemies.filter((enemy) => isLikelyNamedCombatEnemy(enemy.name)).map((enemy) => enemy.name),
    ];
  }, [combatEnemies, combatParty]);

  const hydrateGeneratedCombatState = useCallback(
    (combatState: CombatInitState): { party: Combatant[]; enemies: Combatant[] } | null => {
      const fallbackLevel = sessionNumber ?? 5;
      const partyCombatants = Array.isArray(combatState.party)
        ? combatState.party.map((member, index) =>
            generatedPartyMemberToCombatant(member, index, partyMembers, fallbackLevel),
          )
        : [];
      const enemyCombatants = Array.isArray(combatState.enemies)
        ? combatState.enemies.map((enemy, index) => generatedEnemyToCombatant(enemy, index, fallbackLevel))
        : [];

      if (partyCombatants.length === 0 || enemyCombatants.length === 0) return null;
      return { party: partyCombatants, enemies: enemyCombatants };
    },
    [partyMembers, sessionNumber],
  );

  useEffect(() => {
    if (!queuedCombatStatuses || gameState !== "combat" || !combatParty || !combatEnemies) return;

    if (appliedCombatStatusMessageIdsRef.current.has(queuedCombatStatuses.messageId)) {
      setQueuedCombatStatuses(null);
      return;
    }

    const applied = applyCombatStatusTagsToCombatants(combatParty, combatEnemies, queuedCombatStatuses.statuses);
    if (applied.appliedCount > 0) {
      setCombatParty(applied.party);
      setCombatEnemies(applied.enemies);
    }
    appliedCombatStatusMessageIdsRef.current.add(queuedCombatStatuses.messageId);
    setQueuedCombatStatuses(null);
  }, [queuedCombatStatuses, gameState, combatParty, combatEnemies]);

  useEffect(() => {
    if (!queuedEncounter || !latestAssistantMsg?.id) return;
    if (queuedEncounter.messageId !== latestAssistantMsg.id) return;
    if (pendingEncounter || combatUiActive) return;
    if (isStreaming || scenePreparing || pendingAssetGeneration || directionsPlaying) return;
    if (latestNarrationText && !narrationDone) return;

    useGameModeStore.getState().setGameState("combat");
    transitionGameState.mutate({ chatId: activeChatId, newState: "combat" });
    setCombatStartMessageId(queuedEncounter.messageId);
    setPendingEncounter(queuedEncounter.encounter);
    setQueuedEncounter(null);
  }, [
    activeChatId,
    queuedEncounter,
    latestAssistantMsg?.id,
    pendingEncounter,
    combatUiActive,
    isStreaming,
    scenePreparing,
    pendingAssetGeneration,
    directionsPlaying,
    latestNarrationText,
    narrationDone,
    transitionGameState,
  ]);

  useEffect(() => {
    if (!queuedCombatGeneration || !latestAssistantMsg?.id) return;
    if (queuedCombatGeneration.messageId !== latestAssistantMsg.id) return;
    if (pendingEncounter || combatUiActive || combatGenerationPending) return;
    if (isStreaming || scenePreparing || pendingAssetGeneration || directionsPlaying) return;
    if (latestNarrationText && !narrationDone) return;

    setCombatGenerationPending(true);
    api
      .post<EncounterInitResponse>("/encounter/init", {
        chatId: activeChatId,
        connectionId: null,
        settings: GAME_COMBAT_GENERATION_SETTINGS,
        spellbookId: null,
      })
      .then(async (response) => {
        const combatants = hydrateGeneratedCombatState(response.combatState);
        if (!combatants) {
          throw new Error("Combat generator returned an empty party or enemy list.");
        }

        const visuals = response.combatState.visuals;

        // ── Generate enemy portraits before combat starts ──
        // The encounter LLM emits `enemy.sprite` as an emoji or short visual
        // description, never a URL. To get a real portrait, feed each unique
        // enemy through the same `npcsNeedingAvatars` pipeline NPCs use, then
        // overwrite the hydrated combatant.sprite with the resulting URL.
        // Block here so combat starts with portraits already populated; on
        // any failure the emoji-fallback renderer in GameCombatUI takes over
        // and we proceed without retrying.
        if (chatMeta.enableSpriteGeneration && combatants.enemies.length > 0) {
          // Build two lookups for the LLM's portrait prompts:
          //   - by lowercased name (handles reordering, the schema's documented contract)
          //   - by index (recovers the prompt when the LLM emits subtly different names
          //     but keeps the array aligned with `enemies[]`, which is the common case)
          // Try name first, then index — neither alone covers both failure modes.
          const enemyPromptByName = new Map<string, string>();
          const enemyPromptByIndex = new Map<number, string>();
          (visuals?.enemyImagePrompts ?? []).forEach((ep, idx) => {
            if (!ep?.prompt) return;
            enemyPromptByIndex.set(idx, ep.prompt);
            if (ep.name) enemyPromptByName.set(ep.name.toLowerCase(), ep.prompt);
          });

          // Dedupe by enemy name (case-insensitive) so e.g. three "Goblin"s share one portrait.
          const seen = new Set<string>();
          const npcsNeedingAvatars: Array<{ name: string; description: string }> = [];
          combatants.enemies.forEach((enemy, index) => {
            const name = enemy.name?.trim();
            if (!name) return;
            const dedupeKey = name.toLowerCase();
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            const rawEnemy = response.combatState.enemies?.[index];
            const description = (
              enemyPromptByName.get(dedupeKey) ||
              enemyPromptByIndex.get(index) ||
              rawEnemy?.description ||
              name
            ).slice(0, 1000);
            npcsNeedingAvatars.push({ name, description });
          });

          if (npcsNeedingAvatars.length > 0) {
            try {
              const assetResult = await runGameAssetGeneration({
                chatId: activeChatId,
                npcsNeedingAvatars: npcsNeedingAvatars.slice(0, 10),
                debugMode: useUIStore.getState().debugMode,
              });
              // Match case-insensitively so the assignment stays consistent
              // with the case-insensitive dedupe above — defends against
              // casing drift between the request name and what the server
              // echoes back.
              const avatarByName = new Map<string, string>();
              for (const generated of assetResult?.generatedNpcAvatars ?? []) {
                if (generated.name && generated.avatarUrl) {
                  avatarByName.set(generated.name.trim().toLowerCase(), generated.avatarUrl);
                }
              }
              for (const enemy of combatants.enemies) {
                const key = enemy.name?.trim().toLowerCase();
                const url = key ? avatarByName.get(key) : undefined;
                if (url) enemy.sprite = url;
              }
            } catch (err) {
              console.warn("[game-combat] enemy avatar generation failed; falling back to emoji", err);
            }
          }
        }

        const shouldGenerateBossVisuals = !!visuals?.isBossFight && !!chatMeta.enableSpriteGeneration;
        if (shouldGenerateBossVisuals && (visuals.backgroundPrompt || visuals.illustrationPrompt)) {
          const illustrationPrompt = visuals.illustrationPrompt?.trim() || "";
          const assetPayload = {
            chatId: activeChatId,
            backgroundTag: visuals.backgroundPrompt?.trim()
              ? `boss fight: ${visuals.backgroundPrompt.trim()}`
              : undefined,
            illustration:
              illustrationPrompt.length >= 40
                ? {
                    prompt: illustrationPrompt,
                    reason: "Boss fight splash illustration",
                    slug: visuals.slug || "boss-fight",
                    characters: [
                      ...combatants.party.map((member) => member.name),
                      ...combatants.enemies.map((enemy) => enemy.name),
                    ].slice(0, 6),
                  }
                : undefined,
            debugMode: useUIStore.getState().debugMode,
          };
          void requestAssetGeneration(assetPayload);
        }

        setCombatParty(combatants.party);
        setCombatEnemies(combatants.enemies);
        setCombatItemEffects(Array.isArray(response.combatState.itemEffects) ? response.combatState.itemEffects : []);
        setCombatMechanics(Array.isArray(response.combatState.mechanics) ? response.combatState.mechanics : []);
        setCombatDialogueCues(
          Array.isArray(response.combatState.dialogueCues) ? response.combatState.dialogueCues : [],
        );
        setCombatStartMessageId(queuedCombatGeneration.messageId);
        setQueuedCombatGeneration(null);
        useGameModeStore.getState().setGameState("combat");
        transitionGameState.mutate({ chatId: activeChatId, newState: "combat" });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Combat generation failed.";
        console.warn("[game-combat] Failed to generate combat state", err);
        toast.error(message);
        setQueuedCombatGeneration(null);
      })
      .finally(() => setCombatGenerationPending(false));
  }, [
    activeChatId,
    combatGenerationPending,
    combatUiActive,
    directionsPlaying,
    chatMeta.enableSpriteGeneration,
    hydrateGeneratedCombatState,
    isStreaming,
    latestAssistantMsg?.id,
    latestNarrationText,
    narrationDone,
    pendingAssetGeneration,
    pendingEncounter,
    queuedCombatGeneration,
    requestAssetGeneration,
    runGameAssetGeneration,
    scenePreparing,
    transitionGameState,
  ]);

  useEffect(() => {
    if (!queuedQte || !latestAssistantMsg?.id) return;
    if (queuedQte.messageId !== latestAssistantMsg.id) return;
    if (activeQte) return;
    if (isStreaming || scenePreparing || pendingAssetGeneration || directionsPlaying) return;
    if (latestNarrationText && !narrationDone) return;

    setActiveQte(queuedQte.qte);
    setQueuedQte(null);
  }, [
    queuedQte,
    latestAssistantMsg?.id,
    activeQte,
    isStreaming,
    scenePreparing,
    pendingAssetGeneration,
    directionsPlaying,
    latestNarrationText,
    narrationDone,
  ]);

  // Build combat combatant arrays when a pending encounter arrives
  useEffect(() => {
    if (!pendingEncounter) return;
    const enc = pendingEncounter;
    setPendingEncounter(null);

    type CombatStatLike = { name: string; value: number; max?: number };
    type StoredGameCard = {
      name?: unknown;
      abilities?: unknown;
      rpgStats?: {
        attributes?: Array<{ name?: unknown; value?: unknown }>;
        hp?: { value?: unknown; max?: unknown };
      } | null;
    };

    const normalizeKey = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const skillIdFromName = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const aliasMatches = (value: string, aliases: string[]) => aliases.some((alias) => value === normalizeKey(alias));
    const findStat = (stats: CombatStatLike[], aliases: string[]) =>
      stats.find((stat) => aliasMatches(normalizeKey(stat.name), aliases));
    const readNumeric = (value: unknown) => {
      const numericValue = Number(value);
      return Number.isFinite(numericValue) ? numericValue : null;
    };
    const inferSkillType = (value: string): NonNullable<Combatant["skills"]>[number]["type"] =>
      /(heal|cure|mend|recovery|recover|restore|regeneration|regen|revive|blessing|prayer)/i.test(value)
        ? "heal"
        : "attack";
    const buildCombatSkills = (value: unknown): Combatant["skills"] => {
      if (!Array.isArray(value)) return undefined;

      const seenIds = new Set<string>();
      const skills = value
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((name) => {
          const id = skillIdFromName(name);
          if (!id || seenIds.has(id)) return null;
          seenIds.add(id);

          const type = inferSkillType(name);
          return {
            id,
            name,
            type,
            mpCost: type === "heal" ? 10 : 8,
            power: type === "heal" ? 1.15 : 1.35,
            description: `${name} (${type === "heal" ? "healing" : "combat"} ability)`,
          };
        })
        .filter((skill): skill is Exclude<typeof skill, null> => !!skill);

      return skills.length > 0 ? skills : undefined;
    };

    const gameCardByName = new Map<string, StoredGameCard>();
    const gameCharacterCards = Array.isArray(chatMeta.gameCharacterCards)
      ? (chatMeta.gameCharacterCards as Array<Record<string, unknown>>)
      : [];
    for (const card of gameCharacterCards as StoredGameCard[]) {
      if (typeof card?.name === "string" && card.name.trim()) {
        gameCardByName.set(card.name.trim().toLowerCase(), card);
      }
    }

    const playerBarStats = [
      ...((gameSnapshot?.playerStats?.stats ?? []) as CombatStatLike[]),
      ...((gameSnapshot?.personaStats ?? []) as CombatStatLike[]),
    ];
    const playerAttributes = {
      str: readNumeric(gameSnapshot?.playerStats?.attributes?.str) ?? null,
      dex: readNumeric(gameSnapshot?.playerStats?.attributes?.dex) ?? null,
      con: readNumeric(gameSnapshot?.playerStats?.attributes?.con) ?? null,
      int: readNumeric(gameSnapshot?.playerStats?.attributes?.int) ?? null,
      wis: readNumeric(gameSnapshot?.playerStats?.attributes?.wis) ?? null,
      cha: readNumeric(gameSnapshot?.playerStats?.attributes?.cha) ?? null,
    };

    const enemyCombatants: Combatant[] = enc.enemies.map((e, i) => ({
      id: `enemy-${i}-${e.name.toLowerCase().replace(/\s+/g, "-")}`,
      name: e.name,
      hp: e.hp,
      maxHp: e.hp,
      attack: e.attack,
      defense: e.defense,
      speed: e.speed,
      level: e.level,
      side: "enemy" as const,
      element: e.element,
    }));
    setCombatEnemies(enemyCombatants);

    const playerMembers = partyMembers.filter((member) => member.id.startsWith("persona:"));
    const npcByPartyId = buildPartyNpcLookup(npcs, chatMeta.gameNpcs);
    const resolveAllyMember = (allyName: string): GamePartyMemberInfo | null => {
      const partyMember = findNamedEntry(partyMembers, allyName, (member) => member.name);
      if (partyMember) return partyMember;

      const libraryCharacter = findNamedEntry(characters, allyName, (character) => character.name);
      if (libraryCharacter) {
        const fromMap = characterMap.get(libraryCharacter.id);
        return {
          id: libraryCharacter.id,
          name: libraryCharacter.name,
          avatarUrl: libraryCharacter.avatarUrl ?? null,
          avatarCrop: libraryCharacter.avatarCrop ?? fromMap?.avatarCrop ?? null,
          nameColor: fromMap?.nameColor,
          dialogueColor: fromMap?.dialogueColor,
          canRemove: false,
        };
      }

      const trackedNpc = findNamedEntry(Array.from(npcByPartyId.values()), allyName, (npc) => npc.name);
      if (trackedNpc) {
        return {
          id: buildPartyNpcId(trackedNpc.name),
          name: trackedNpc.name,
          avatarUrl: trackedNpc.avatarUrl ?? null,
          canRemove: false,
        };
      }

      const presentCharacter = gameSnapshot?.presentCharacters?.find((candidate) =>
        candidate.name ? characterNamesMatch(candidate.name, allyName) : false,
      );
      const presentName = presentCharacter?.name?.trim() || allyName.trim();
      return presentName
        ? {
            id: presentCharacter?.characterId ?? buildPartyNpcId(presentName),
            name: presentName,
            avatarUrl: null,
            canRemove: false,
          }
        : null;
    };

    const combatMembers: GamePartyMemberInfo[] =
      enc.allies === null
        ? playerMembers
        : Array.isArray(enc.allies)
          ? [
              ...playerMembers,
              ...enc.allies
                .map(resolveAllyMember)
                .filter((member): member is GamePartyMemberInfo => !!member && !member.id.startsWith("persona:")),
            ]
          : partyMembers;
    const uniqueCombatMembers = Array.from(
      new Map(
        combatMembers.filter((member) => !!member.id && !!member.name).map((member) => [member.id, member]),
      ).values(),
    );

    const partyCombatants: Combatant[] = uniqueCombatMembers
      .filter((m) => !!m.id && !!m.name)
      .map((m) => {
        const isPlayerMember = m.id.startsWith("persona:");
        const snap = isPlayerMember
          ? null
          : gameSnapshot?.presentCharacters?.find(
              (pc) => pc.characterId === m.id || pc.name?.toLowerCase() === m.name.toLowerCase(),
            );
        const stats = (isPlayerMember ? playerBarStats : (snap?.stats ?? [])) as CombatStatLike[];
        const gameCard = gameCardByName.get(m.name.toLowerCase());
        const cardRpgStats = gameCard?.rpgStats ?? null;
        const cardAttributes = new Map(
          Array.isArray(cardRpgStats?.attributes)
            ? cardRpgStats.attributes
                .map((attribute) => {
                  const name = typeof attribute?.name === "string" ? normalizeKey(attribute.name) : "";
                  const value = readNumeric(attribute?.value);
                  return name && value != null ? ([name, value] as const) : null;
                })
                .filter((entry): entry is readonly [string, number] => !!entry)
            : [],
        );
        const hpStat = findStat(stats, ["hp", "health", "hit points"]);
        const mpStat = findStat(stats, ["mp", "mana", "magic points", "energy"]);
        const levelStat = findStat(stats, ["level", "lvl"]);
        const pLevel = levelStat?.value ?? sessionNumber ?? 5;
        const hpFromCard = readNumeric(cardRpgStats?.hp?.value) ?? readNumeric(cardRpgStats?.hp?.max);
        const maxHpFromCard = readNumeric(cardRpgStats?.hp?.max) ?? hpFromCard;
        const attributeValue = (...aliases: string[]) => {
          for (const alias of aliases) {
            const normalizedAlias = normalizeKey(alias);
            if (cardAttributes.has(normalizedAlias)) return cardAttributes.get(normalizedAlias) ?? null;
            if (isPlayerMember && normalizedAlias in playerAttributes) {
              return playerAttributes[normalizedAlias as keyof typeof playerAttributes];
            }
          }
          return null;
        };
        const attackStat = findStat(stats, ["attack", "atk", "power", "strength"]);
        const defenseStat = findStat(stats, ["defense", "def", "armor", "guard"]);
        const speedStat = findStat(stats, ["speed", "spd", "agility", "dexterity"]);
        const intelligenceValue = attributeValue("int", "intelligence", "wis", "wisdom");
        const derivedAttack = attributeValue("attack", "atk", "str", "strength") ?? 8 + pLevel * 2;
        const derivedDefense = attributeValue("defense", "def", "con", "constitution") ?? 5 + pLevel;
        const derivedSpeed = attributeValue("speed", "spd", "dex", "dexterity", "agility") ?? 5 + pLevel;
        const derivedMaxHp = maxHpFromCard ?? 50 + pLevel * 10;
        const derivedHp = hpFromCard ?? derivedMaxHp;
        const derivedMaxMp = intelligenceValue != null ? 12 + intelligenceValue * 2 : 20 + pLevel * 3;
        const derivedMp = derivedMaxMp;

        return {
          id: m.id,
          name: m.name,
          hp: hpStat?.value ?? derivedHp,
          maxHp: hpStat?.max ?? hpStat?.value ?? derivedMaxHp,
          mp: mpStat?.value ?? derivedMp,
          maxMp: mpStat?.max ?? mpStat?.value ?? derivedMaxMp,
          attack: attackStat?.value ?? derivedAttack,
          defense: defenseStat?.value ?? derivedDefense,
          speed: speedStat?.value ?? derivedSpeed,
          level: pLevel,
          side: "player" as const,
          sprite: m.avatarUrl ?? undefined,
          skills: buildCombatSkills(gameCard?.abilities),
        };
      });

    if (partyCombatants.length === 0) {
      // partyMembers always includes at least a persona fallback, so this is defense-in-depth
      // for a future refactor. If we ever land here, abort cleanly and roll back to exploration
      // so the player isn't stranded in combat state with no UI.
      console.warn("[game] Combat aborted: party is empty or malformed.", { partyMembers, allies: enc.allies });
      setCombatEnemies(null);
      useGameModeStore.getState().setGameState("exploration");
      if (activeChatId) {
        transitionGameState.mutate({ chatId: activeChatId, newState: "exploration" });
      }
      return;
    }

    setCombatParty(partyCombatants);
  }, [
    pendingEncounter,
    partyMembers,
    gameSnapshot,
    activeChatId,
    chatMeta.gameCharacterCards,
    chatMeta.gameNpcs,
    characters,
    characterMap,
    npcs,
    transitionGameState,
    sessionNumber,
  ]);

  const partyCards = useMemo(() => {
    const cards: Record<
      string,
      {
        title: string;
        subtitle?: string;
        mood?: string;
        status?: string;
        level?: number;
        avatarUrl?: string | null;
        avatarCrop?: { zoom: number; offsetX: number; offsetY: number } | null;
        stats?: Array<{ name: string; value: number; max?: number; color?: string }>;
        inventory?: Array<{ name: string; quantity?: number; location?: string }>;
        customFields?: Record<string, string>;
        gameCard?: {
          shortDescription: string;
          class: string;
          abilities: string[];
          strengths: string[];
          weaknesses: string[];
          extra: Record<string, string>;
          rpgStats?: {
            attributes: Array<{ name: string; value: number }>;
            hp: { value: number; max: number };
          };
        };
      }
    > = {};

    // Game character cards from setup, matched leniently so aliases still reuse saved sheets.
    const gameCharCards = Array.isArray(chatMeta.gameCharacterCards)
      ? (chatMeta.gameCharacterCards as Array<Record<string, unknown>>)
      : [];
    const findGameCard = (name: string) =>
      findNamedEntry(gameCharCards, name, (card) => (typeof card.name === "string" ? card.name : null));

    // Build base cards from character data — name and avatar only.
    // Subtitle, status, stats, etc. come exclusively from the game snapshot.
    const config = chatMeta.gameSetupConfig as Record<string, unknown> | undefined;
    const partyIds = mergeUniqueIds(getActivePartyIds(chatMeta), chatCharacterIds);
    const npcByPartyId = buildPartyNpcLookup(npcs, chatMeta.gameNpcs);
    for (const charId of partyIds) {
      const c = characters.find((ch) => ch.id === charId);
      const npc = c ? null : npcByPartyId.get(charId);
      const name = c?.name ?? npc?.name ?? "";
      if (!name) continue;
      const gc = findGameCard(name);
      cards[charId] = {
        title: name,
        subtitle: npc?.location || undefined,
        status: npc?.description || undefined,
        avatarUrl: c?.avatarUrl ?? npc?.avatarUrl ?? null,
        avatarCrop: c?.avatarCrop ?? null,
        level: sessionNumber,
        gameCard: gc
          ? {
              shortDescription: (gc.shortDescription as string) || "",
              class: (gc.class as string) || "",
              abilities: (gc.abilities as string[]) || [],
              strengths: (gc.strengths as string[]) || [],
              weaknesses: (gc.weaknesses as string[]) || [],
              extra: (gc.extra as Record<string, string>) || {},
              rpgStats: gc.rpgStats as
                | { attributes: Array<{ name: string; value: number }>; hp: { value: number; max: number } }
                | undefined,
            }
          : undefined,
      };
    }

    // Overlay game-state data from snapshot (stats, mood, etc.)
    const presentCharacters = gameSnapshot?.presentCharacters ?? [];
    for (const pc of presentCharacters) {
      const existing = cards[pc.characterId];
      cards[pc.characterId] = {
        ...existing,
        title: pc.name || existing?.title || "Unknown",
        subtitle: pc.outfit || pc.appearance || existing?.subtitle || undefined,
        mood: pc.mood || existing?.mood || undefined,
        status: pc.thoughts || existing?.status || undefined,
        avatarUrl: pc.avatarPath || existing?.avatarUrl || null,
        stats:
          (pc.stats ?? []).length > 0
            ? (pc.stats ?? []).map((s) => ({ name: s.name, value: s.value, max: s.max, color: s.color }))
            : existing?.stats,
        customFields: pc.customFields || existing?.customFields,
        gameCard: existing?.gameCard,
      };
    }

    // Player persona card
    if (personaInfo?.name) {
      const configPersonaId = (config?.personaId as string | undefined) ?? null;
      const personaId = configPersonaId ? `persona:${configPersonaId}` : "persona:active";
      const gc = findGameCard(personaInfo.name);
      cards[personaId] = {
        title: personaInfo.name,
        subtitle: "Player Character",
        avatarUrl: personaInfo.avatarUrl ?? null,
        level: sessionNumber,
        status: gameSnapshot?.playerStats?.status || undefined,
        stats: [
          ...(gameSnapshot?.personaStats ?? []).map((s) => ({
            name: s.name,
            value: s.value,
            max: s.max,
            color: s.color,
          })),
          ...(gameSnapshot?.playerStats?.stats ?? []).map((s) => ({
            name: s.name,
            value: s.value,
            max: s.max,
            color: s.color,
          })),
        ],
        inventory: (gameSnapshot?.playerStats?.inventory ?? []).map((item) => ({
          name: item.name,
          quantity: item.quantity,
          location: item.location,
        })),
        gameCard: gc
          ? {
              shortDescription: (gc.shortDescription as string) || "",
              class: (gc.class as string) || "",
              abilities: (gc.abilities as string[]) || [],
              strengths: (gc.strengths as string[]) || [],
              weaknesses: (gc.weaknesses as string[]) || [],
              extra: (gc.extra as Record<string, string>) || {},
              rpgStats: gc.rpgStats as
                | { attributes: Array<{ name: string; value: number }>; hp: { value: number; max: number } }
                | undefined,
            }
          : undefined,
      };
    } else {
      // No persona selected — default player card
      cards["persona:default"] = {
        title: "Player",
        subtitle: "Player Character",
        avatarUrl: null,
        level: sessionNumber,
        status: gameSnapshot?.playerStats?.status || undefined,
        stats: [
          ...(gameSnapshot?.personaStats ?? []).map((s) => ({
            name: s.name,
            value: s.value,
            max: s.max,
            color: s.color,
          })),
          ...(gameSnapshot?.playerStats?.stats ?? []).map((s) => ({
            name: s.name,
            value: s.value,
            max: s.max,
            color: s.color,
          })),
        ],
        inventory: (gameSnapshot?.playerStats?.inventory ?? []).map((item) => ({
          name: item.name,
          quantity: item.quantity,
          location: item.location,
        })),
      };
    }

    return cards;
  }, [chatCharacterIds, chatMeta, gameSnapshot, personaInfo, characters, npcs, sessionNumber]);

  const handleSaveCharacterSheet = useCallback(
    async (cardTitle: string, gameCard: GameCharacterSheetGameCard | undefined) => {
      if (!activeChatId) return;

      const normalizedTitle = cardTitle.trim();
      if (!normalizedTitle) return;

      const currentCards = Array.isArray(chatMeta.gameCharacterCards)
        ? (chatMeta.gameCharacterCards as Array<Record<string, unknown>>)
        : [];
      const currentIndex = currentCards.findIndex(
        (entry) => typeof entry.name === "string" && entry.name.toLowerCase() === normalizedTitle.toLowerCase(),
      );

      const sanitizedGameCard = gameCard
        ? {
            name: normalizedTitle,
            shortDescription: gameCard.shortDescription.trim(),
            class: gameCard.class.trim(),
            abilities: gameCard.abilities.map((value: string) => value.trim()).filter(Boolean),
            strengths: gameCard.strengths.map((value: string) => value.trim()).filter(Boolean),
            weaknesses: gameCard.weaknesses.map((value: string) => value.trim()).filter(Boolean),
            extra: Object.fromEntries(
              Object.entries(gameCard.extra as Record<string, string>)
                .map(([key, value]) => [key.trim(), String(value).trim()] as const)
                .filter(([key, value]) => key && value),
            ),
            ...(gameCard.rpgStats
              ? {
                  rpgStats: {
                    attributes: gameCard.rpgStats.attributes
                      .map((attr: { name: string; value: number }) => ({
                        name: attr.name.trim(),
                        value: Number(attr.value) || 0,
                      }))
                      .filter((attr: { name: string; value: number }) => attr.name),
                    hp: {
                      value: Math.max(0, Number(gameCard.rpgStats.hp.value) || 0),
                      max: Math.max(1, Number(gameCard.rpgStats.hp.max) || 1),
                    },
                  },
                }
              : {}),
          }
        : null;

      const updatedCards = [...currentCards];
      if (sanitizedGameCard) {
        if (currentIndex >= 0) {
          updatedCards[currentIndex] = sanitizedGameCard;
        } else {
          updatedCards.push(sanitizedGameCard);
        }
      } else if (currentIndex >= 0) {
        updatedCards.splice(currentIndex, 1);
      } else {
        return;
      }

      try {
        await updateChatMetadata.mutateAsync({ id: activeChatId, gameCharacterCards: updatedCards });
        toast.success(`${normalizedTitle} sheet updated.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save character sheet.");
        throw error;
      }
    },
    [activeChatId, chatMeta.gameCharacterCards, updateChatMetadata],
  );

  // Map narration messages with character names
  const narrationMessages = useMemo(
    () =>
      messages.map((m) => ({
        ...m,
        characterName: m.characterId ? characterMap.get(m.characterId)?.name : undefined,
      })),
    [messages, characterMap],
  );

  const sessionStatus = (chatMeta.gameSessionStatus as string) || "active";
  const sessionInteractive = sessionStatus !== "concluded";
  const handleCombatCustomInstruction = useCallback(
    (instruction: string) => {
      const cleanInstruction = instruction.trim();
      if (!cleanInstruction) return;
      if (!sessionInteractive || isStreaming) {
        toast.error("Wait for the current GM response before attempting a special maneuver.");
        return;
      }

      const formatCombatant = (combatant: Combatant) => {
        const effects =
          combatant.statusEffects && combatant.statusEffects.length > 0
            ? `, effects: ${combatant.statusEffects.map((effect) => effect.name).join(", ")}`
            : "";
        const aura = combatant.elementAura ? `, aura: ${combatant.elementAura.element}` : "";
        return `${combatant.name} ${combatant.hp}/${combatant.maxHp} HP${effects}${aura}`;
      };
      const partySnapshot = combatParty?.map(formatCombatant).join("; ") || "unknown";
      const enemySnapshot = combatEnemies?.map(formatCombatant).join("; ") || "unknown";

      sendMessage(
        [
          `I attempt a special combat maneuver: ${cleanInstruction}`,
          ``,
          `GM combat adjudication: Resolve this in your GM role using the current fiction and tactical state. If the maneuver creates a real combat condition, emit [status: target="Exact Name" effect="Effect Name" turns=1-3 stat="hp|attack|defense|speed" modifier="+/-N"]. If it applies an element, emit [element_attack: element="pyro|hydro|cryo|electro|anemo|geo|dendro|physical" target="Exact Name"]. Keep [state: combat] unless this action truly ends the fight.`,
          ``,
          `Current combat snapshot: Party: ${partySnapshot}. Enemies: ${enemySnapshot}.`,
        ].join("\n"),
      );
    },
    [combatEnemies, combatParty, isStreaming, sendMessage, sessionInteractive],
  );
  const sessionSummaries = Array.isArray(chatMeta.gamePreviousSessionSummaries)
    ? (chatMeta.gamePreviousSessionSummaries as SessionSummary[])
    : [];
  const displaySessionNumber =
    sessionStatus === "concluded" ? Math.max(sessionSummaries.length, 1) : sessionSummaries.length + 1;
  const currentSessionSecrets = useMemo<CurrentSessionSecrets>(
    () => ({
      worldOverview: (chatMeta.gameWorldOverview as string) || "",
      storyArc: (chatMeta.gameStoryArc as string) || "",
      plotTwists: Array.isArray(chatMeta.gamePlotTwists) ? (chatMeta.gamePlotTwists as string[]) : [],
      partyArcs: Array.isArray(chatMeta.gamePartyArcs)
        ? (chatMeta.gamePartyArcs as CurrentSessionSecrets["partyArcs"])
        : [],
      npcs: Array.isArray(chatMeta.gameNpcs) ? (chatMeta.gameNpcs as GameNpc[]) : [],
      characterCards: Array.isArray(chatMeta.gameCharacterCards)
        ? (chatMeta.gameCharacterCards as Array<Record<string, unknown>>)
        : [],
    }),
    [
      chatMeta.gameCharacterCards,
      chatMeta.gameNpcs,
      chatMeta.gamePartyArcs,
      chatMeta.gamePlotTwists,
      chatMeta.gameStoryArc,
      chatMeta.gameWorldOverview,
    ],
  );

  const handleSaveSessionDetails = useCallback(
    async (sessionNumber: number, nextSummary: SessionSummary) => {
      if (!activeChatId) return;

      const trimmedSummary = nextSummary.summary.trim();
      if (!trimmedSummary) {
        const error = new Error("Session summary cannot be empty.");
        toast.error(error.message);
        throw error;
      }

      const rawSummaries = Array.isArray(chatMeta.gamePreviousSessionSummaries)
        ? (chatMeta.gamePreviousSessionSummaries as unknown[])
        : [];
      const targetIndex = sessionNumber - 1;
      if (targetIndex < 0 || targetIndex >= rawSummaries.length) {
        const error = new Error("Session summary not found.");
        toast.error(error.message);
        throw error;
      }

      const updatedSummaries = rawSummaries.map((entry, index) => {
        if (index !== targetIndex) return entry;

        const currentEntry = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
        const currentRecord = currentEntry as Record<string, unknown>;

        return {
          ...currentRecord,
          ...nextSummary,
          sessionNumber,
          summary: trimmedSummary,
          timestamp:
            typeof nextSummary.timestamp === "string" && nextSummary.timestamp.trim()
              ? nextSummary.timestamp
              : typeof currentRecord.timestamp === "string" && currentRecord.timestamp.trim()
                ? currentRecord.timestamp
                : new Date().toISOString(),
        };
      });

      setSavingSessionSummary(sessionNumber);
      try {
        await updateSessionHistoryMetadata.mutateAsync({
          id: activeChatId,
          gamePreviousSessionSummaries: updatedSummaries,
        });
        toast.success(`Session ${sessionNumber} details updated.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update session details.";
        toast.error(message);
        throw error instanceof Error ? error : new Error(message);
      } finally {
        setSavingSessionSummary(null);
      }
    },
    [activeChatId, chatMeta.gamePreviousSessionSummaries, updateSessionHistoryMetadata],
  );

  const handleSaveCurrentSessionSecrets = useCallback(
    async (nextSecrets: CurrentSessionSecrets) => {
      if (!activeChatId) return;

      setSavingCurrentSessionSecrets(true);
      try {
        await updateChatMetadata.mutateAsync({
          id: activeChatId,
          gameWorldOverview: nextSecrets.worldOverview,
          gameStoryArc: nextSecrets.storyArc,
          gamePlotTwists: nextSecrets.plotTwists,
          gamePartyArcs: nextSecrets.partyArcs,
          gameNpcs: nextSecrets.npcs,
          gameCharacterCards: nextSecrets.characterCards,
        });
        useGameModeStore.getState().setNpcs(nextSecrets.npcs);
        toast.success("Current session spoilers updated.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update current session spoilers.";
        toast.error(message);
        throw error instanceof Error ? error : new Error(message);
      } finally {
        setSavingCurrentSessionSecrets(false);
      }
    },
    [activeChatId, updateChatMetadata],
  );

  const handleRegenerateSessionConclusion = useCallback(
    async (sessionNumber: number) => {
      if (!activeChatId) return;
      try {
        await regenerateSessionConclusion.mutateAsync({ chatId: activeChatId, sessionNumber });
      } catch (error) {
        if (handleJsonRepairError(error)) return;
        throw error;
      }
    },
    [activeChatId, handleJsonRepairError, regenerateSessionConclusion],
  );

  const handleRegenerateSessionLorebook = useCallback(
    async (sessionNumber: number) => {
      if (!activeChatId) return;
      await regenerateSessionLorebook.mutateAsync({ chatId: activeChatId, sessionNumber });
    },
    [activeChatId, regenerateSessionLorebook],
  );

  const handleUpdateCampaignProgression = useCallback(
    async (sessionNumber: number) => {
      if (!activeChatId) return;
      try {
        await updateCampaignProgression.mutateAsync({ chatId: activeChatId, sessionNumber });
      } catch (error) {
        if (handleJsonRepairError(error)) return;
        throw error;
      }
    },
    [activeChatId, handleJsonRepairError, updateCampaignProgression],
  );

  const handleRollDice = useCallback(
    async (notation: string): Promise<DiceRollResult | null> => {
      try {
        const response = await rollDice.mutateAsync({ chatId: activeChatId, notation });
        return response.result;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to roll dice.");
        return null;
      }
    },
    [activeChatId, rollDice],
  );

  const handleDismissDice = useCallback(() => {
    setDiceRollResult(null);
  }, [setDiceRollResult]);

  const handleChoiceSelect = useCallback(
    (choice: string) => {
      if (!sessionInteractive) return;
      setActiveChoices(null);
      sendMessage(choice);
    },
    [sendMessage, sessionInteractive],
  );

  const handleGenerateMap = useCallback(() => {
    if (isStreaming || !sessionInteractive) return;
    const locationType = gameSnapshot?.location?.trim() || "current location";
    const context = [
      `Location: ${gameSnapshot?.location ?? "Unknown"}`,
      gameSnapshot?.time ? `Time: ${gameSnapshot.time}` : null,
      gameSnapshot?.weather ? `Weather: ${gameSnapshot.weather}` : null,
      latestNarrationText ? `Scene: ${latestNarrationText}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    generateMap.mutate({
      chatId: activeChatId,
      locationType,
      context: context || locationType,
    });
    setViewedMapId(null);
  }, [
    activeChatId,
    gameSnapshot?.location,
    gameSnapshot?.time,
    gameSnapshot?.weather,
    generateMap,
    isStreaming,
    latestNarrationText,
    sessionInteractive,
  ]);

  const isSameMapPosition = useCallback(
    (left: { x: number; y: number } | string | null | undefined, right: { x: number; y: number } | string) => {
      if (!left) return false;
      if (typeof left === "string" || typeof right === "string") {
        return typeof left === "string" && typeof right === "string" && left === right;
      }
      return left.x === right.x && left.y === right.y;
    },
    [],
  );

  const describeMapPosition = useCallback(
    (position: { x: number; y: number } | string) => {
      if (typeof position === "string") {
        return currentMap?.nodes?.find((node) => node.id === position)?.label ?? position;
      }
      return (
        currentMap?.cells?.find((cell) => cell.x === position.x && cell.y === position.y)?.label ??
        `(${position.x}, ${position.y})`
      );
    },
    [currentMap],
  );

  const handleMapMove = useCallback(
    (position: { x: number; y: number } | string) => {
      if (!viewedMapIsActive) {
        setPendingMapMove(null);
        return;
      }
      if (!sessionInteractive) {
        setPendingMapMove(null);
        return;
      }
      if (isSameMapPosition(currentMap?.partyPosition, position)) {
        setPendingMapMove(null);
        return;
      }
      setPendingMapMove({ position, label: describeMapPosition(position) });
    },
    [currentMap?.partyPosition, describeMapPosition, isSameMapPosition, sessionInteractive, viewedMapIsActive],
  );

  const handleSendGameTurn = useCallback(
    async (
      message: string,
      attachments?: Array<{ type: string; data: string }>,
      options?: { commitPendingMove?: boolean },
    ) => {
      if (!sessionInteractive) return;
      // Commit a pending interrupt: persist the truncated GM message before generating
      // so the server-side prompt build doesn't see segments the player never read. We
      // await so the PATCH (and the optional risky-mode system message) land before
      // /generate reads from the DB.
      const activeInterrupt = pendingInterrupt && pendingInterrupt.chatId === activeChatId ? pendingInterrupt : null;
      if (activeInterrupt && activeInterrupt.messageId && activeInterrupt.truncatedContent !== null) {
        try {
          await updateMessage.mutateAsync({
            messageId: activeInterrupt.messageId,
            content: activeInterrupt.truncatedContent,
          });
        } catch {
          toast.error("Failed to commit the interrupt. Please try again.");
          return;
        }
      }
      // Risky mode tells the GM about the interrupt via a one-line system message.
      // Force mode skips this on purpose — the GM only sees a shorter prior turn and
      // the player's new input, so it has no idea anything was cut.
      if (activeInterrupt && activeInterrupt.mode === "risky") {
        try {
          await createMessage.mutateAsync({
            role: "system",
            content:
              "[Interrupt] The player attempts to interrupt the Game Master mid-action. Their following turn cuts in before the GM's planned events could occur. Treat their interjection as an in-fiction interruption — the situation may resist them, and the attempt can fail depending on context. If the player includes a dice roll, let the result determine whether the interruption succeeds or how it lands.",
          });
        } catch {
          toast.error("Failed to mark the risky interrupt. Please try again.");
          return;
        }
      }
      setPendingInterrupt(null);
      if (options?.commitPendingMove && pendingMapMove) {
        moveOnMap.mutate({ chatId: activeChatId, position: pendingMapMove.position, mapId: activeMapId });
      }
      setActiveChoices(null);
      sendMessage(message, attachments);
      if (options?.commitPendingMove && pendingMapMove) {
        setPendingMapMove(null);
      }
    },
    [
      activeChatId,
      activeMapId,
      createMessage,
      moveOnMap,
      pendingInterrupt,
      pendingMapMove,
      sendMessage,
      sessionInteractive,
      updateMessage,
    ],
  );

  useEffect(() => {
    setPendingMapMove(null);
    setViewedMapId(null);
    setCombatStartMessageId(null);
    setQueuedCombatGeneration(null);
    setCombatGenerationPending(false);
    setCombatItemEffects([]);
    setCombatMechanics([]);
    setCombatDialogueCues([]);
  }, [activeChatId]);

  useEffect(() => {
    if (!viewedMapId) return;
    const exists = availableMaps.some((map, index) => getGameMapId(map, index) === viewedMapId);
    if (!exists) setViewedMapId(null);
  }, [availableMaps, viewedMapId]);

  useEffect(() => {
    if (sessionInteractive) return;
    setPendingMapMove(null);
    setActiveChoices(null);
    setActiveQte(null);
    setQueuedQte(null);
  }, [sessionInteractive]);

  useEffect(() => {
    if (sessionStatus !== "concluded") return;
    setConfirmEndSessionOpen(false);
    setNextSessionRequest("");
  }, [sessionStatus]);

  useEffect(() => {
    if (!pendingMapMove) return;
    if (isSameMapPosition(currentMap?.partyPosition, pendingMapMove.position)) {
      setPendingMapMove(null);
    }
  }, [currentMap?.partyPosition, isSameMapPosition, pendingMapMove]);

  const handleConcludeSession = useCallback(() => {
    if (concludeSession.isPending) return;
    const trimmedRequest = nextSessionRequest.trim();
    concludeSession.mutate(
      { chatId: activeChatId, ...(trimmedRequest ? { nextSessionRequest: trimmedRequest } : {}) },
      { onError: handleJsonRepairError },
    );
  }, [activeChatId, concludeSession, handleJsonRepairError, nextSessionRequest]);

  const handleRequestEndSession = useCallback(() => {
    if (concludeSession.isPending) return;
    setNextSessionRequest("");
    setConfirmEndSessionOpen(true);
  }, [concludeSession.isPending]);

  const handleConfirmEndSession = useCallback(() => {
    if (concludeSession.isPending) return;
    handleConcludeSession();
  }, [concludeSession.isPending, handleConcludeSession]);

  const handleCloseEndSessionDialog = useCallback(() => {
    if (concludeSession.isPending) return;
    setConfirmEndSessionOpen(false);
  }, [concludeSession.isPending]);

  const handleStartNewSessionNow = useCallback(() => {
    if (!gameId || startSessionLocked || startSessionGuardRef.current) return;
    startSessionGuardRef.current = true;
    setStartSessionRequested(true);
    startSession.mutate(
      { gameId },
      {
        onSettled: () => {
          startSessionGuardRef.current = false;
          setStartSessionRequested(false);
        },
      },
    );
  }, [gameId, startSession, startSessionLocked]);

  const handleStartNewSession = useCallback(() => {
    if (!gameId || startSessionLocked || startSessionGuardRef.current) return;
    if (sessionStatus === "concluded" && hudWidgets.length > 0) {
      setPrepareSessionWidgetsOpen(true);
      return;
    }
    handleStartNewSessionNow();
  }, [gameId, handleStartNewSessionNow, hudWidgets.length, sessionStatus, startSessionLocked]);

  useEffect(() => {
    if (sessionStatus !== "concluded") {
      setPrepareSessionWidgetsOpen(false);
    }
  }, [sessionStatus]);

  const handleQteSelect = useCallback(
    (action: string, timeRemaining: number) => {
      if (!sessionInteractive) return;
      setActiveQte(null);
      const bonus = Math.min(5, Math.ceil(timeRemaining));
      sendMessage(`*${action}* [qte_result: status="success" modifier="+${bonus}"]`);
    },
    [sendMessage, sessionInteractive],
  );

  const handleQteTimeout = useCallback(() => {
    if (!sessionInteractive) return;
    setActiveQte(null);
    sendMessage('*hesitates too long* [qte_result: status="fail" modifier="-5"]');
  }, [sendMessage, sessionInteractive]);

  const handleReturnToPreCombatTurn = useCallback(() => {
    if (!latestAssistantMsg?.id) return;
    const confirmed = window.confirm(
      "Exit combat and remove the GM turn that started this encounter? This returns you to the previous player turn.",
    );
    if (!confirmed) return;

    setCombatParty(null);
    setCombatEnemies(null);
    setPendingEncounter(null);
    setQueuedEncounter(null);
    setQueuedCombatGeneration(null);
    setCombatGenerationPending(false);
    setCombatItemEffects([]);
    setCombatMechanics([]);
    setCombatDialogueCues([]);
    setQueuedCombatStatuses(null);
    setCombatStartMessageId(null);
    appliedCombatStatusMessageIdsRef.current.clear();
    appliedCombatElementMessageIdsRef.current.clear();
    useGameModeStore.getState().setGameState("exploration");
    if (activeChatId) {
      transitionGameState.mutate({ chatId: activeChatId, newState: "exploration" });
      clearCombatSnapshot(activeChatId);
    }
    onDeleteMessage(latestAssistantMsg.id);
  }, [activeChatId, clearCombatSnapshot, latestAssistantMsg?.id, onDeleteMessage, transitionGameState]);

  const handleCombatantsChange = useCallback((nextParty: Combatant[], nextEnemies: Combatant[]) => {
    setCombatParty(nextParty);
    setCombatEnemies(nextEnemies);
  }, []);

  // Combat end handler — clear combat state and notify GM
  const handleCombatEnd = useCallback(
    (outcome: "victory" | "defeat" | "flee", summary: CombatSummary) => {
      setCombatParty(null);
      setCombatEnemies(null);
      setQueuedCombatGeneration(null);
      setCombatGenerationPending(false);
      setCombatItemEffects([]);
      setCombatMechanics([]);
      setCombatDialogueCues([]);
      setQueuedCombatStatuses(null);
      setCombatStartMessageId(null);
      appliedCombatStatusMessageIdsRef.current.clear();
      appliedCombatElementMessageIdsRef.current.clear();

      // Flip the server-side + local game state back to exploration immediately.
      // (The [state: exploration] tag in the user message below is a hint for the GM's
      // next turn, but doesn't itself flip the authoritative state.)
      useGameModeStore.getState().setGameState("exploration");
      if (activeChatId) {
        transitionGameState.mutate({ chatId: activeChatId, newState: "exploration" });
        // Clear the persisted combat snapshot so a future page refresh doesn't try to
        // re-enter the fight that just ended.
        clearCombatSnapshot(activeChatId);
      }

      // Build a compact, model-friendly recap so the GM can narrate the aftermath.
      const defeatedEnemies = summary.enemies.filter((e) => e.defeated).map((e) => e.name);
      const survivingEnemies = summary.enemies.filter((e) => !e.defeated);
      const partyStatus = summary.party.map((p) => {
        const hpPct = p.maxHp > 0 ? Math.round((p.hp / p.maxHp) * 100) : 0;
        const effects = p.statusEffects.length > 0 ? ` [${p.statusEffects.join(", ")}]` : "";
        const ko = p.ko ? " KO" : "";
        return `${p.name}: ${p.hp}/${p.maxHp} HP (${hpPct}%)${effects}${ko}`;
      });
      const lootText =
        summary.loot && summary.loot.length > 0
          ? summary.loot.map((l) => (l.quantity && l.quantity > 1 ? `${l.name} ×${l.quantity}` : l.name)).join(", ")
          : "";

      // Flee on round 1 means no round actually resolved — phrase it accordingly.
      const roundsPhrase =
        outcome === "flee" && summary.rounds <= 1
          ? "before combat began"
          : `after ${summary.rounds} round${summary.rounds === 1 ? "" : "s"}`;

      const recapLines: string[] = [];
      recapLines.push(`OUTCOME: ${outcome.toUpperCase()} (${roundsPhrase})`);
      if (defeatedEnemies.length > 0) recapLines.push(`Defeated: ${defeatedEnemies.join(", ")}`);
      if (survivingEnemies.length > 0) {
        recapLines.push(`Survived: ${survivingEnemies.map((e) => `${e.name} (${e.hp}/${e.maxHp} HP)`).join(", ")}`);
      }
      recapLines.push(`Party: ${partyStatus.join("; ")}`);
      if (lootText) recapLines.push(`Loot: ${lootText}`);
      else
        recapLines.push(
          'Rewards: If a reward is narratively appropriate, decide it now and add it with [inventory: action="add" item="..."].',
        );

      const recap = recapLines.join("\n");
      let prefix: string;
      if (outcome === "victory") prefix = "*The battle is won.*";
      else if (outcome === "defeat") prefix = "*The party has been defeated...*";
      else prefix = "*The party flees from battle!*";

      // Wrap the recap in a clearly-labelled block so the GM treats it as canonical combat
      // context (the core prompt rule teaches how to narrate it). The block is stripped from
      // the user-visible bubble by stripGmTags / stripGmTagsKeepReadables, leaving only the
      // cosmetic italic prefix. State is flipped above via transitionGameState so no
      // [state:] tag is needed here.
      sendMessage(`${prefix}\n\n[combat_result]\n${recap}\n[/combat_result]`);

      // Journal: record combat outcome. The server's addCombatEntry only persists
      // (description, outcome) into JournalEntry.content, so fold the structured recap
      // into the description itself to preserve rounds / party status for players.
      const journalDescLines: string[] = [];
      if (outcome === "victory") journalDescLines.push(`Victory (${roundsPhrase})`);
      else if (outcome === "defeat") journalDescLines.push(`The party was defeated (${roundsPhrase})`);
      else journalDescLines.push(`The party fled from battle (${roundsPhrase})`);
      if (defeatedEnemies.length > 0) journalDescLines.push(`Defeated: ${defeatedEnemies.join(", ")}`);
      journalDescLines.push(`Party status: ${partyStatus.join("; ")}`);
      if (lootText) journalDescLines.push(`Loot: ${lootText}`);

      api
        .post("/game/journal/entry", {
          chatId: activeChatId,
          type: "combat",
          data: {
            description: journalDescLines.join(" — "),
            outcome: outcome === "flee" ? "fled" : outcome,
          },
        })
        .catch(() => {});
    },
    [sendMessage, activeChatId, clearCombatSnapshot, transitionGameState],
  );

  // Toggle audio mute
  const handleToggleMute = useCallback(() => {
    useGameAssetStore.getState().setAudioMuted(!audioMuted);
  }, [audioMuted]);

  // Handle master volume change from slider (0–100)
  const handleMasterVolumeChange = useCallback(
    (value: number) => {
      const nextValue = normalizeVolume(value, masterVolume);
      setMasterVolume(nextValue);
      if (nextValue === 0 && !audioMuted) {
        useGameAssetStore.getState().setAudioMuted(true);
      } else if (nextValue > 0 && audioMuted) {
        useGameAssetStore.getState().setAudioMuted(false);
      }
    },
    [audioMuted, masterVolume],
  );

  const handleChannelVolumeChange = useCallback((setter: (value: number) => void, value: number) => {
    setter(normalizeVolume(value, 0));
  }, []);

  // Apply saved volume on mount so audioManager matches the persisted level
  useEffect(() => {
    audioManager.setVolumes(
      getEffectiveVolume(masterVolume, musicVolume),
      getEffectiveVolume(masterVolume, sfxVolume),
      getEffectiveVolume(masterVolume, ambientVolume),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close volume popover on outside click
  useEffect(() => {
    if (!volumePopoverOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inDesktopPopover = volumePopoverRef.current?.contains(target) ?? false;
      const inMobilePopover = mobileVolumePopoverRef.current?.contains(target) ?? false;
      if (!inDesktopPopover && !inMobilePopover) {
        setVolumePopoverOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [volumePopoverOpen]);

  useEffect(() => {
    if (!retryMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (retryMenuRef.current && !retryMenuRef.current.contains(e.target as Node)) {
        setRetryMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [retryMenuOpen]);

  // Retry scene analysis for the latest message
  const handleRetryScene = useCallback(() => {
    if (!latestAssistantMsg?.content) return;
    setRetryMenuOpen(false);
    const onSuccess = applySceneResultRef.current;
    if (!onSuccess) return;

    // Reset segment state so fresh effects can apply
    setPendingSegmentEffects([]);
    setPendingInventorySegmentUpdates([]);
    appliedSegmentsRef.current = new Set();
    appliedInventorySegmentsRef.current = new Set();
    appliedInventorySegmentsRef.current = new Set();

    const tags = parseGmTags(latestAssistantMsg.content);
    const assets = assetManifest?.assets ?? null;
    const assetKeys = Object.keys(assets ?? {});
    const bgTags = sampleTags(getSceneBackgroundTags(assetKeys), 50);
    const sfxTags = sampleTags(
      assetKeys.filter((k) => k.startsWith("sfx:")),
      50,
    );
    const setupConfig = chatMeta.gameSetupConfig as Record<string, unknown> | null;
    const sceneConnId =
      (chatMeta.gameSceneConnectionId as string) || (setupConfig?.sceneConnectionId as string) || null;

    const context = {
      currentState: gameState,
      availableBackgrounds: bgTags,
      availableSfx: sfxTags,
      activeWidgets: hudWidgets,
      trackedNpcs: npcs,
      characterNames: sceneWrapCharacterNames,
      currentBackground: currentBackground,
      currentMusic: useGameAssetStore.getState().currentMusic,
      recentMusic: recentMusicHistoryRef.current,
      currentAmbient: useGameAssetStore.getState().currentAmbient,
      currentWeather: gameSnapshot?.weather ?? null,
      currentTimeOfDay: gameSnapshot?.time ?? null,
      canGenerateBackgrounds: !!chatMeta.enableSpriteGeneration && !!chatMeta.gameImageConnectionId,
      canGenerateIllustrations: !!chatMeta.enableSpriteGeneration && !!chatMeta.gameImageConnectionId,
      artStylePrompt: (setupConfig?.artStylePrompt as string | undefined) ?? null,
    };

    if (sceneConnId) {
      sceneAnalysis.mutate(
        { chatId: activeChatId, connectionId: sceneConnId, narration: tags.cleanContent, context },
        {
          onSuccess: (result) => {
            onSuccess(result);
            toast.success("Scene analysis retried.", { duration: 1800 });
          },
          onError: (err) => console.error("[retry-scene] Failed:", err),
        },
      );
    } else {
      sceneAnalysis.mutate(
        { narration: tags.cleanContent, context },
        {
          onSuccess: (result) => {
            onSuccess(result);
            toast.success("Scene analysis retried.", { duration: 1800 });
          },
          onError: (err) => console.error("[retry-scene] Failed:", err),
        },
      );
    }
  }, [
    latestAssistantMsg,
    assetManifest,
    gameState,
    hudWidgets,
    npcs,
    currentBackground,
    gameSnapshot,
    chatMeta,
    activeChatId,
    sceneAnalysis,
    sceneWrapCharacterNames,
  ]);

  // Remap legacy hud_bottom widgets to left/right (hud_bottom was removed)
  const normalizedWidgets = useMemo(() => {
    let leftCount = 0;
    return hudWidgets.map((w) => {
      if ((w.position as string) === "hud_bottom") {
        const side = leftCount % 2 === 0 ? "hud_left" : "hud_right";
        leftCount++;
        return { ...w, position: side } as typeof w;
      }
      return w;
    });
  }, [hudWidgets]);

  useEffect(() => {
    if (combatUiActive || normalizedWidgets.length === 0) {
      compactHudWidgetsRef.current = false;
      compactHudReleaseWidthRef.current = null;
      setCompactHudWidgets(false);
      return;
    }

    const setCompactLayout = (nextCompact: boolean) => {
      if (compactHudWidgetsRef.current === nextCompact) return;
      compactHudWidgetsRef.current = nextCompact;
      setCompactHudWidgets(nextCompact);
    };

    const updateWidgetLayout = () => {
      const surface = hudSurfaceRef.current;
      if (!surface) return;

      const surfaceRect = surface.getBoundingClientRect();
      const dialogue = surface.querySelector<HTMLElement>('[data-tour="game-dialogue"]');
      const dialogueRect = dialogue?.getBoundingClientRect();
      const leftRail = surface.querySelector<HTMLElement>('[data-game-widget-rail="left"]');
      const rightRail = surface.querySelector<HTMLElement>('[data-game-widget-rail="right"]');
      const buffer = 8;
      const currentCompact = compactHudWidgetsRef.current;

      const measuredOverlap =
        !!dialogueRect &&
        ((leftRail && leftRail.getBoundingClientRect().right > dialogueRect.left - buffer) ||
          (rightRail && rightRail.getBoundingClientRect().left < dialogueRect.right + buffer));

      const estimatedDialogueWidth = dialogueRect?.width ?? Math.min(surfaceRect.width - 48, 896);
      const widgetRailWidth = 176;
      const sideInsets = 24;
      const estimatedOverlap = surfaceRect.width < estimatedDialogueWidth + widgetRailWidth * 2 + sideInsets + buffer;
      const measuredOverlapWidth = measuredOverlap ? Math.ceil(surfaceRect.width + 80) : null;
      if (measuredOverlapWidth) {
        compactHudReleaseWidthRef.current = Math.max(compactHudReleaseWidthRef.current ?? 0, measuredOverlapWidth);
      }

      const heldByPreviousOverlap =
        currentCompact &&
        compactHudReleaseWidthRef.current != null &&
        surfaceRect.width < compactHudReleaseWidthRef.current;
      if (!measuredOverlap && !heldByPreviousOverlap && !estimatedOverlap) {
        compactHudReleaseWidthRef.current = null;
      }

      const nextCompact = surfaceRect.width < 768 || estimatedOverlap || measuredOverlap || heldByPreviousOverlap;

      setCompactLayout(nextCompact);
    };

    let frame: number | null = null;
    const scheduleWidgetLayoutUpdate = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updateWidgetLayout();
      });
    };

    scheduleWidgetLayoutUpdate();
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleWidgetLayoutUpdate) : null;
    const surface = hudSurfaceRef.current;
    if (resizeObserver && surface instanceof Element) {
      resizeObserver.observe(surface);
      const dialogue = surface.querySelector<HTMLElement>('[data-tour="game-dialogue"]');
      if (dialogue instanceof Element) resizeObserver.observe(dialogue);
    }
    window.addEventListener("resize", scheduleWidgetLayoutUpdate);

    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleWidgetLayoutUpdate);
    };
  }, [combatUiActive, normalizedWidgets.length]);

  // Resolve background image URL — supports exact tag match, partial/fuzzy match, and "black" override
  const resolvedBackground = useMemo(() => {
    if (currentBackground && assetManifest?.assets) {
      // Special value: "black" means no background (e.g. character waking up)
      if (currentBackground === "black" || currentBackground === "none") {
        return "black";
      }
      // 1. Exact tag match
      let entry = assetManifest.assets[currentBackground];
      // 2. Fuzzy match: try to find a tag that ends with or contains the given value
      if (!entry) {
        const lowerTag = currentBackground.toLowerCase();
        const keys = Object.keys(assetManifest.assets);
        // Try suffix match first (e.g. "forest-night" matches "backgrounds:fantasy:forest-night")
        const suffixMatch = keys.find((k) => k.toLowerCase().endsWith(`:${lowerTag}`) || k.toLowerCase() === lowerTag);
        if (suffixMatch) entry = assetManifest.assets[suffixMatch];
        // Try contains match (e.g. "forest" matches "backgrounds:fantasy:forest-night")
        if (!entry) {
          const containsMatch = keys.find((k) => k.startsWith("backgrounds:") && k.toLowerCase().includes(lowerTag));
          if (containsMatch) entry = assetManifest.assets[containsMatch];
        }
      }
      if (entry) {
        if (entry.path.startsWith("__user_bg__/")) {
          const filename = entry.path.replace("__user_bg__/", "");
          return `/api/backgrounds/file/${encodeURIComponent(filename)}`;
        }
        return `/api/game-assets/file/${entry.path}`;
      }
      console.warn("[bg-resolve] No asset match for background tag:", currentBackground);
    }
    // In game mode, do NOT fall back to the roleplay chat background — use black instead
    return undefined;
  }, [currentBackground, assetManifest]);

  // ONLY gate on the first turn — once any assistant content has been received,
  // the game is in-progress and the "adventure begins" screen should never reappear.
  const hasEverHadContent = useMemo(
    () => messages.some((m) => (m.role === "assistant" || m.role === "narrator") && m.content),
    [messages],
  );

  useEffect(() => {
    if (!startGameRequested) return;
    if (sessionStatus !== "active" || !hasEverHadContent) return;
    startGameGuardRef.current = false;
    setStartGameRequested(false);
  }, [hasEverHadContent, sessionStatus, startGameRequested]);

  // Does this chat need initial game creation?
  const needsCreation = !chatMeta.gameId;

  // While messages are still loading for an existing active game, show a loading
  // indicator instead of flashing the setup/start screens.
  if (isMessagesLoading && !needsCreation && sessionStatus !== "setup" && !isSetupActive) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--background)] dark:bg-black/80">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--muted)]/40 border-t-[var(--foreground)]/70 dark:border-white/20 dark:border-t-white/70" />
      </div>
    );
  }

  // Setup wizard — show when explicitly active, when game needs creation, or when status is still "setup" (e.g. previous setup failed)
  if (isSetupActive || needsCreation || sessionStatus === "setup") {
    return (
      <>
        <GameSetupWizard
          onComplete={(config, preferences, conns, wizardGameName) => {
            if (needsCreation) {
              // Create game structure first, then run setup
              createGame.mutate(
                {
                  name: wizardGameName || chat?.name || "New Game",
                  setupConfig: config,
                  chatId: activeChatId,
                  connectionId: conns.gmConnectionId,
                },
                {
                  onSuccess: (res) => {
                    gameSetup.mutate(
                      {
                        chatId: res.sessionChat.id,
                        connectionId: conns.gmConnectionId,
                        preferences,
                      },
                      { onError: handleJsonRepairError },
                    );
                  },
                },
              );
            } else {
              gameSetup.mutate(
                { chatId: activeChatId, connectionId: conns.gmConnectionId, preferences },
                { onError: handleJsonRepairError },
              );
            }
          }}
          onCancel={() => {
            if (needsCreation || sessionStatus === "setup") {
              // Delete the broken/empty game chat
              useChatStore.getState().setActiveChatId(null);
              deleteChat.mutate(activeChatId);
            }
            useGameModeStore.getState().setSetupActive(false);
          }}
          isLoading={createGame.isPending || gameSetup.isPending}
          characters={characters}
        />
        <GameJsonRepairModal
          request={jsonRepairRequest}
          onClose={() => setJsonRepairRequest(null)}
          onApplied={handleJsonRepairApplied}
        />
      </>
    );
  }

  // World is built but the game hasn't started yet -- show "Start Game" screen.
  // Keep it visible until: (1) assistant content exists, (2) streaming is done,
  // (3) scene preparation (sidecar / connection scene model) has finished,
  // (4) any in-flight image / NPC portrait generation has completed.
  // Once ALL conditions are met for the first time the screen never returns.
  // sceneProcessed is computed above (near scenePreparing).
  const firstTurnFullyReady = hasEverHadContent && !isStreaming && sceneProcessed && !pendingAssetGeneration;
  const sidecarStartupFailed = sidecarConfig.useForGameScene && sidecarStatus === "server_error" && !sidecarReady;
  // Don't auto-dismiss: wait for user to click Continue after typewriter finishes.

  const awaitingFirstTurn = sessionStatus === "active" && !introPresented;
  if (
    (sessionStatus === "ready" && !introPresented) ||
    startGame.isPending ||
    startGameRequested ||
    awaitingFirstTurn
  ) {
    const worldOverview = (chatMeta.gameWorldOverview as string) || null;
    const setupConfig = chatMeta.gameSetupConfig as Record<string, unknown> | undefined;
    // Phase: "idle" = show Start button over overview, "intro" = typewriter reveal after clicking Start
    const introPhase = startGame.isPending || startGameRequested || awaitingFirstTurn ? "intro" : "idle";
    const SURFACE_BTN =
      "flex items-center gap-2 rounded-lg bg-[var(--muted)]/30 px-4 py-2 text-xs text-[var(--foreground)]/70 transition-colors hover:bg-[var(--muted)]/50 hover:text-[var(--foreground)] dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20 dark:hover:text-white";
    return (
      <>
        <div className="flex h-full items-center justify-center overflow-hidden bg-[var(--background)] dark:bg-black/80 p-6">
          <div className="flex max-h-full max-w-lg flex-col items-center gap-6 text-center">
            {/* Genre / Setting tag */}
            {setupConfig && (
              <div className="flex flex-shrink-0 flex-wrap items-center justify-center gap-2 text-xs text-[var(--muted-foreground)] dark:text-white/40">
                <span>{setupConfig.genre as string}</span>
                <span className="text-[var(--muted-foreground)]/50 dark:text-white/20">|</span>
                <span>{setupConfig.setting as string}</span>
                <span className="text-[var(--muted-foreground)]/50 dark:text-white/20">|</span>
                <span>{setupConfig.tone as string}</span>
              </div>
            )}

            {/* World overview — only revealed via typewriter after pressing Start Game */}
            {worldOverview && introPhase === "intro" && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <IntroTypewriter text={worldOverview} onComplete={() => setIntroTypewriterDone(true)} />
              </div>
            )}

            {/* Start button or generating indicator */}
            <div className="flex-shrink-0">
              {introPhase === "intro" ? (
                <div className="flex flex-col items-center gap-3">
                  {firstTurnFullyReady && introTypewriterDone ? (
                    <button
                      onClick={() => {
                        setIntroPresented(true);
                        try {
                          localStorage.setItem(introPresentationStorageKey, "1");
                        } catch {
                          /* storage unavailable */
                        }
                        setIntroTypewriterDone(false);
                        // Retry any autoplay-blocked audio now that we have a user gesture
                        audioManager.retryPending();
                      }}
                      className="group flex items-center gap-2 rounded-xl bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-white transition-all hover:scale-105 hover:shadow-lg hover:shadow-[var(--primary)]/30"
                    >
                      Continue
                    </button>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 text-sm text-[var(--muted-foreground)] dark:text-white/60">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--muted)]/40 border-t-[var(--foreground)]/70 dark:border-white/20 dark:border-t-white/70" />
                        <span>
                          {hasEverHadContent && !sceneProcessed
                            ? "Preparing the scene..."
                            : hasEverHadContent && pendingAssetGeneration
                              ? "Generating images..."
                              : hasEverHadContent && isStreaming
                                ? "The GM is narrating..."
                                : "The adventure begins..."}
                        </span>
                      </div>
                      {/* Retry only when scene analysis actually failed */}
                      {hasEverHadContent && !isStreaming && sceneAnalysisFailed && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => retrySceneAnalysis()} className={SURFACE_BTN}>
                            <RefreshCw size={14} />
                            Retry Scene Analysis
                          </button>
                          <button onClick={() => skipSceneAnalysis()} className={SURFACE_BTN}>
                            Skip
                          </button>
                        </div>
                      )}
                      {/* Show skip only after stuck timeout — scene processing hung, not failed */}
                      {hasEverHadContent &&
                        !isStreaming &&
                        !sceneProcessed &&
                        sceneStuckVisible &&
                        !sceneAnalysisFailed && (
                          <button onClick={() => skipSceneAnalysis()} className={cn("mt-1", SURFACE_BTN)}>
                            Skip
                          </button>
                        )}
                    </>
                  )}
                  {/* Show retry when generation stopped but no content arrived. */}
                  {!isStreaming && !latestAssistantMsg?.content && !startGame.isPending && (
                    <button onClick={generateInitialGameTurn} className={SURFACE_BTN}>
                      <RefreshCw size={14} />
                      Retry
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (startGame.isPending || startGameRequested || startGameGuardRef.current) return;
                    startGameGuardRef.current = true;
                    setStartGameRequested(true);
                    console.log("[GameSurface] Start Game clicked, chatId:", activeChatId);
                    startGame.mutate(
                      { chatId: activeChatId },
                      {
                        onSuccess: (res) => {
                          console.log("[GameSurface] startGame succeeded:", res);
                          generateInitialGameTurn();
                          console.log("[GameSurface] initial game turn generation requested");
                        },
                        onError: (err) => {
                          startGameGuardRef.current = false;
                          setStartGameRequested(false);
                          console.error("[GameSurface] startGame failed:", err);
                        },
                      },
                    );
                  }}
                  disabled={startGame.isPending || startGameRequested}
                  className="group flex items-center gap-2 rounded-xl bg-[var(--primary)] px-6 py-3 text-sm font-semibold text-white transition-all hover:scale-105 hover:shadow-lg hover:shadow-[var(--primary)]/30 disabled:opacity-50 disabled:hover:scale-100"
                >
                  <Play size={18} className="transition-transform group-hover:scale-110" />
                  Start Game
                </button>
              )}
            </div>
          </div>
        </div>
        {imagePromptReviewModal}
      </>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden bg-black">
      <GameTransitionManager gameState={gameState} location={gameSnapshot?.location ?? null}>
        <DirectionEngine
          directions={activeDirections}
          backgroundUrl={resolvedBackground ?? undefined}
          onPlayingChange={(playing) => {
            setDirectionsPlaying(playing);
            // When intro cinematic finishes, clear the flag
            if (!playing && introCinematicActive) setIntroCinematicActive(false);
          }}
        >
          {/* Full-body VN sprite — active speaker only */}
          <div
            className="transition-opacity duration-700 ease-in-out"
            style={{ opacity: spriteVisible ? 1 : 0, pointerEvents: spriteVisible ? "auto" : "none" }}
          >
            {displaySpriteIds.length > 0 && (
              <Suspense fallback={null}>
                <SpriteOverlay
                  characterIds={displaySpriteIds}
                  messages={narrationMessages}
                  side={displaySpriteIds.length === 1 ? "center" : "right"}
                  spriteExpressions={gameSpriteExpressions}
                  fullBodyOnly
                  spriteScale={gameAvatarScale}
                />
              </Suspense>
            )}
          </div>

          <div className="relative flex min-w-0 h-full flex-col overflow-hidden">
            {/* Fade in all UI chrome after intro cinematic finishes */}
            <div
              className={`absolute inset-0 z-10 flex flex-col transition-opacity duration-1000 ease-out ${
                introCinematicActive ? "pointer-events-none opacity-0" : "opacity-100"
              }`}
            >
              {/* Top-right action controls */}
              <div
                data-tour="game-controls"
                className={cn("pointer-events-none absolute right-3 z-30", topOverlayOffsetClass)}
              >
                {/* Desktop controls */}
                <div className="pointer-events-auto hidden items-center gap-1.5 md:flex">
                  <button
                    onClick={() => setTutorialOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                    title="Game Mode Tutorial"
                  >
                    <HelpCircle size={14} />
                  </button>
                  <button
                    onClick={() => setHistoryOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                    title="History"
                  >
                    <History size={14} />
                  </button>
                  {sessionStatus !== "concluded" ? (
                    <button
                      onClick={handleRequestEndSession}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                      title="End Session"
                    >
                      <Square size={13} />
                    </button>
                  ) : (
                    <button
                      onClick={handleStartNewSession}
                      disabled={startSessionLocked}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-300/25 bg-emerald-500/20 text-emerald-200 backdrop-blur-md transition-colors hover:bg-emerald-500/35 disabled:opacity-50 disabled:hover:bg-emerald-500/20"
                      title={startSessionLocked ? "Generating next session" : "New Session"}
                    >
                      {startSessionLocked ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                    </button>
                  )}
                  <button
                    onClick={() => setJournalOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                    title="Journal"
                  >
                    <BookOpen size={14} />
                  </button>
                  <div className="relative" ref={volumePopoverRef}>
                    <button
                      onClick={() => setVolumePopoverOpen((v) => !v)}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                      title="Volume"
                    >
                      {audioMuted || masterVolume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                    </button>
                    {volumePopoverOpen && (
                      <GameVolumeMixer
                        className="absolute right-0 top-11 z-50"
                        audioMuted={audioMuted || masterVolume === 0}
                        masterVolume={masterVolume}
                        musicVolume={musicVolume}
                        sfxVolume={sfxVolume}
                        ttsVolume={ttsVolume}
                        ambientVolume={ambientVolume}
                        onMasterVolumeChange={handleMasterVolumeChange}
                        onMusicVolumeChange={(value) => handleChannelVolumeChange(setMusicVolume, value)}
                        onSfxVolumeChange={(value) => handleChannelVolumeChange(setSfxVolume, value)}
                        onTtsVolumeChange={(value) => handleChannelVolumeChange(setTtsVolume, value)}
                        onAmbientVolumeChange={(value) => handleChannelVolumeChange(setAmbientVolume, value)}
                        onToggleMute={handleToggleMute}
                      />
                    )}
                  </div>
                  <button
                    onClick={() => setGalleryOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                    title="Gallery"
                  >
                    <Image size={14} />
                  </button>
                  <div className="relative" ref={retryMenuRef}>
                    <button
                      onClick={() => setRetryMenuOpen((open) => !open)}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                      title="Retry..."
                      aria-label="Retry..."
                    >
                      <RotateCcw size={14} className={sceneAnalysis.isPending ? "animate-spin" : ""} />
                    </button>
                    {retryMenuOpen && (
                      <div className="absolute right-0 top-11 z-50 flex w-56 flex-col gap-1 rounded-xl border border-white/15 bg-black/80 p-1.5 shadow-xl backdrop-blur-md">
                        <button
                          onClick={() => {
                            void handleRetryTurn();
                          }}
                          disabled={!canRetryTurn}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
                        >
                          <RotateCcw size={13} />
                          <span>Retry Turn</span>
                        </button>
                        <button
                          onClick={handleRetryScene}
                          disabled={!canRetryScene}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
                        >
                          <RefreshCw size={13} className={sceneAnalysis.isPending ? "animate-spin" : ""} />
                          <span>Retry Scene Analysis</span>
                        </button>
                        <button
                          onClick={() => {
                            setRetryMenuOpen(false);
                            retryAssetGeneration({ showSuccessToast: true });
                          }}
                          disabled={!canRetryAssets}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
                        >
                          <Image size={13} />
                          <span>Retry Assets Image Generation</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={onOpenSettings}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/80 backdrop-blur-md transition-colors hover:bg-black/60 hover:text-white"
                    title="Chat Settings"
                  >
                    <Settings2 size={14} />
                  </button>
                </div>

                {/* Mobile controls */}
                <div className="pointer-events-auto md:hidden">
                  <div className="relative">
                    <button
                      onClick={() => {
                        setMobileActionsOpen((open) => {
                          const nextOpen = !open;
                          if (!nextOpen) setVolumePopoverOpen(false);
                          return nextOpen;
                        });
                        setMobileRetryMenuOpen(false);
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/85 backdrop-blur-md transition-colors hover:bg-black/65 hover:text-white"
                      title="Game actions"
                    >
                      <MoreHorizontal size={15} />
                    </button>

                    {mobileActionsOpen && (
                      <div className="absolute right-0 top-11 flex w-9 flex-col items-center gap-1 rounded-xl border border-white/15 bg-black/70 p-0.5 backdrop-blur-xl shadow-lg">
                        <button
                          onClick={() => {
                            setTutorialOpen(true);
                            setMobileActionsOpen(false);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/85 transition-colors hover:bg-white/10 hover:text-white"
                          title="Game Mode Tutorial"
                        >
                          <HelpCircle size={14} />
                        </button>
                        <button
                          onClick={() => {
                            setHistoryOpen(true);
                            setMobileActionsOpen(false);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                          title="History"
                        >
                          <History size={14} />
                        </button>
                        {sessionStatus !== "concluded" ? (
                          <button
                            onClick={() => {
                              handleRequestEndSession();
                              setMobileActionsOpen(false);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10"
                            title="End Session"
                          >
                            <Square size={13} />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              handleStartNewSession();
                              setMobileActionsOpen(false);
                            }}
                            disabled={startSessionLocked}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 disabled:hover:bg-transparent"
                            title={startSessionLocked ? "Generating next session" : "New Session"}
                          >
                            {startSessionLocked ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setJournalOpen(true);
                            setMobileActionsOpen(false);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                          title="Journal"
                        >
                          <BookOpen size={14} />
                        </button>
                        <div className="relative" ref={mobileVolumePopoverRef}>
                          <button
                            onClick={() => {
                              setVolumePopoverOpen((open) => !open);
                              setMobileRetryMenuOpen(false);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                            title="Volume"
                          >
                            {audioMuted || masterVolume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                          </button>
                          {volumePopoverOpen && (
                            <GameVolumeMixer
                              className="absolute right-10 top-0 z-50 max-w-[calc(100vw-4.5rem)]"
                              audioMuted={audioMuted || masterVolume === 0}
                              masterVolume={masterVolume}
                              musicVolume={musicVolume}
                              sfxVolume={sfxVolume}
                              ttsVolume={ttsVolume}
                              ambientVolume={ambientVolume}
                              onMasterVolumeChange={handleMasterVolumeChange}
                              onMusicVolumeChange={(value) => handleChannelVolumeChange(setMusicVolume, value)}
                              onSfxVolumeChange={(value) => handleChannelVolumeChange(setSfxVolume, value)}
                              onTtsVolumeChange={(value) => handleChannelVolumeChange(setTtsVolume, value)}
                              onAmbientVolumeChange={(value) => handleChannelVolumeChange(setAmbientVolume, value)}
                              onToggleMute={handleToggleMute}
                            />
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setGalleryOpen(true);
                            setMobileActionsOpen(false);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                          title="Gallery"
                        >
                          <Image size={14} />
                        </button>
                        <div className="relative">
                          <button
                            onClick={() => setMobileRetryMenuOpen((v) => !v)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                            title="Retry"
                            aria-label="Retry"
                          >
                            <RotateCcw size={14} className={sceneAnalysis.isPending ? "animate-spin" : ""} />
                          </button>
                          {mobileRetryMenuOpen && (
                            <div className="absolute right-10 top-0 z-50 flex w-56 max-w-[calc(100vw-4rem)] flex-col gap-1 rounded-xl border border-white/15 bg-black/85 p-1.5 shadow-xl backdrop-blur-xl">
                              <button
                                onClick={() => {
                                  setMobileRetryMenuOpen(false);
                                  setMobileActionsOpen(false);
                                  void handleRetryTurn();
                                }}
                                disabled={!canRetryTurn}
                                className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
                              >
                                <RotateCcw size={13} />
                                <span>Retry Turn</span>
                              </button>
                              <button
                                onClick={() => {
                                  handleRetryScene();
                                  setMobileRetryMenuOpen(false);
                                  setMobileActionsOpen(false);
                                }}
                                disabled={!canRetryScene}
                                className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
                              >
                                <RefreshCw size={13} className={sceneAnalysis.isPending ? "animate-spin" : ""} />
                                <span>Retry Scene Analysis</span>
                              </button>
                              <button
                                onClick={() => {
                                  setMobileRetryMenuOpen(false);
                                  setMobileActionsOpen(false);
                                  retryAssetGeneration({ showSuccessToast: true });
                                }}
                                disabled={!canRetryAssets}
                                className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
                              >
                                <Image size={13} />
                                <span>Retry Assets Image Generation</span>
                              </button>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            onOpenSettings();
                            setMobileActionsOpen(false);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                          title="Chat Settings"
                        >
                          <Settings2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {pendingReaction && (
                <GameElementReaction reaction={pendingReaction} onDismiss={() => setPendingReaction(null)} />
              )}

              {/* Main content area */}
              <div ref={hudSurfaceRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {/* Top-left: Map + Party portraits side by side */}
                <div
                  className={cn(
                    "pointer-events-auto absolute left-3 z-20 flex items-start gap-2",
                    topOverlayOffsetClass,
                  )}
                >
                  {/* Mobile: map icon button that opens modal */}
                  <div data-tour="game-map" className="md:hidden">
                    <MobileMapButton
                      map={viewedMap}
                      maps={availableMaps}
                      activeMapId={activeMapId}
                      viewedMapId={effectiveViewedMapId}
                      onViewedMapChange={handleViewedMapChange}
                      onMove={handleMapMove}
                      selectedPosition={viewedMapIsActive ? (pendingMapMove?.position ?? null) : null}
                      onGenerateMap={handleGenerateMap}
                      generateMapDisabled={isStreaming || !sessionInteractive}
                      disabled={isStreaming || !narrationDone || !sessionInteractive}
                      gameState={gameState}
                      timeOfDay={gameSnapshot?.time ?? metaTime ?? null}
                      day={currentGameDay}
                      onDayChange={handleGameDayChange}
                    />
                  </div>
                  {/* Desktop: inline minimap */}
                  <div className="hidden md:block">
                    <GameMapPanel
                      map={viewedMap}
                      maps={availableMaps}
                      activeMapId={activeMapId}
                      viewedMapId={effectiveViewedMapId}
                      onViewedMapChange={handleViewedMapChange}
                      onMove={handleMapMove}
                      selectedPosition={viewedMapIsActive ? (pendingMapMove?.position ?? null) : null}
                      onGenerateMap={handleGenerateMap}
                      generateMapDisabled={isStreaming || !sessionInteractive}
                      disabled={isStreaming || !narrationDone || !sessionInteractive}
                      gameState={gameState}
                      timeOfDay={gameSnapshot?.time ?? metaTime ?? null}
                      day={currentGameDay}
                      onDayChange={handleGameDayChange}
                      chatId={activeChatId}
                      constraintsRef={hudSurfaceRef}
                    />
                  </div>

                  {/* Party portraits — right of map */}
                  {partyMembers.length > 0 && (
                    <div data-tour="game-party">
                      <GamePartyBar
                        partyMembers={partyMembers}
                        partyCards={partyCards}
                        onRemovePartyMember={handleRemovePartyMemberFromBar}
                        removingPartyMemberId={removingPartyMemberId}
                      />
                    </div>
                  )}
                </div>

                {/* Dynamic weather effects from tracked game state */}
                {weatherEffectsEnabled && (gameSnapshot?.weather || gameSnapshot?.time) && (
                  <div className="pointer-events-none absolute inset-0 z-[1]">
                    <WeatherEffects weather={gameSnapshot?.weather ?? null} timeOfDay={gameSnapshot?.time ?? null} />
                  </div>
                )}

                {sidecarStartupFailed && (
                  <div className="pointer-events-auto absolute top-4 left-1/2 z-30 w-[min(92vw,42rem)] -translate-x-1/2">
                    <div className="rounded-xl border border-amber-500/20 bg-black/80 px-4 py-3 shadow-lg backdrop-blur-sm">
                      <div className="flex items-start gap-3">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-amber-200">Local scene helper failed to start</div>
                          <div className="mt-1 text-[0.6875rem] leading-relaxed text-white/70">
                            Marinara will keep the game running without the local sidecar for now.
                            {sidecarFailedRuntimeVariant &&
                              ` Runtime: ${sidecarFailedRuntimeVariant.replace(/-/g, " ")}.`}
                            {sidecarStartupError ? ` ${sidecarStartupError}.` : ""}
                          </div>
                          <div className="mt-1 text-[0.6875rem] leading-relaxed text-white/55">
                            Open Local AI Model to retry startup, switch models, or disable local scene analysis
                            temporarily.
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            void refreshSidecarStatus();
                            openSidecarModal(true);
                          }}
                          className="rounded-lg bg-white/10 px-3 py-1.5 text-[0.6875rem] font-medium text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                        >
                          Open Local AI Model
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Image generation failed — retry banner */}
                {assetGenerationFailed && pendingAssetGeneration && (
                  <div className="pointer-events-auto absolute bottom-32 left-1/2 z-30 -translate-x-1/2">
                    <div className="flex items-center gap-3 rounded-xl bg-black/80 px-4 py-2.5 shadow-lg backdrop-blur-sm">
                      <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                      <span className="text-xs text-white/70">Image generation failed</span>
                      <button
                        onClick={() => retryAssetGeneration()}
                        className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                      >
                        <RefreshCw size={12} />
                        Retry
                      </button>
                      <button
                        onClick={() => {
                          setAssetGenerationFailed(false);
                          setPendingAssetGeneration(null);
                        }}
                        className="text-white/40 transition-colors hover:text-white/70"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Scene analysis failed — retry banner (only when narration is still blocked) */}
                {sceneAnalysisFailed && introPresented && (
                  <div className="pointer-events-auto absolute bottom-32 left-1/2 z-30 -translate-x-1/2">
                    <div className="flex items-center gap-3 rounded-xl bg-black/80 px-4 py-2.5 shadow-lg backdrop-blur-sm">
                      <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                      <span className="text-xs text-white/70">Scene analysis failed</span>
                      <button
                        onClick={() => retrySceneAnalysis()}
                        className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/80 transition-colors hover:bg-white/20 hover:text-white"
                      >
                        <RefreshCw size={12} />
                        Retry
                      </button>
                      <button
                        onClick={() => setSceneAnalysisFailed(false)}
                        className="text-white/40 transition-colors hover:text-white/70"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {/* Game content — Combat UI / TravelView / Narration */}
                {(() => {
                  // Mobile widget slot — rendered inside GameNarration to sit above the narration box
                  const mobileWidgetSlot =
                    !combatUiActive && hudWidgets.length > 0 ? (
                      <div
                        className={cn(
                          "pointer-events-auto mb-2 flex items-end justify-between",
                          !compactHudWidgets && "md:hidden",
                        )}
                      >
                        <MobileWidgetPanel widgets={normalizedWidgets} position="hud_left" chatId={activeChatId} />
                        <MobileWidgetPanel widgets={normalizedWidgets} position="hud_right" chatId={activeChatId} />
                      </div>
                    ) : undefined;

                  // Choice cards slot — rendered inside GameNarration above the narration box
                  const choicesSlot =
                    activeChoices && narrationDone ? (
                      <div className="pointer-events-auto mb-2 flex justify-center">
                        <GameChoiceCards
                          choices={activeChoices}
                          onSelect={handleChoiceSelect}
                          disabled={isStreaming || !sessionInteractive}
                        />
                      </div>
                    ) : undefined;

                  const skillCheckSlot = pendingSkillCheck ? (
                    <GameSkillCheckResult result={pendingSkillCheck} onDismiss={() => setPendingSkillCheck(null)} />
                  ) : undefined;

                  const diceResultSlot = diceRollResult ? (
                    <GameDiceResult result={diceRollResult} onDismiss={handleDismissDice} />
                  ) : undefined;

                  if (combatUiActive) {
                    const combatControlsSlot = (
                      <>
                        <button
                          type="button"
                          onClick={() => setCombatLogsOpen(true)}
                          className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/65 px-3 py-1.5 text-xs font-semibold text-white/80 shadow-lg backdrop-blur-md transition-colors hover:bg-black/80 hover:text-white"
                          title="Open combat logs"
                        >
                          <ScrollText size={13} />
                          Logs
                        </button>
                        <button
                          type="button"
                          onClick={handleReturnToPreCombatTurn}
                          disabled={!latestAssistantMsg?.id}
                          className="flex items-center gap-1.5 rounded-lg border border-amber-300/25 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-100 shadow-lg backdrop-blur-md transition-colors hover:bg-amber-500/30 disabled:opacity-50"
                          title="Exit combat and remove the turn that started it"
                        >
                          <RotateCcw size={13} />
                          Previous Turn
                        </button>
                      </>
                    );

                    return (
                      <div className="relative h-full min-h-0">
                        <GameCombatUI
                          chatId={activeChatId}
                          party={combatParty}
                          enemies={combatEnemies}
                          inventoryItems={inventoryItems}
                          onCombatEnd={handleCombatEnd}
                          onInventoryItemUsed={handleUseCombatInventoryItem}
                          onCombatantsChange={handleCombatantsChange}
                          onOpenInventory={() => setInventoryOpen(true)}
                          onCustomInstruction={handleCombatCustomInstruction}
                          onSpriteSuggestionChange={setCombatSpriteSuggestion}
                          _isStreaming={isStreaming}
                          narration={combatStartNarration ?? "Combat starts!"}
                          combatDialogue={combatDialogueLines}
                          combatDialogueCues={combatDialogueCues}
                          combatItemEffects={combatItemEffects}
                          combatMechanics={combatMechanics}
                          voicedCombatSpeakerNames={voicedCombatSpeakerNames}
                          gameVoiceVolume={effectiveGameVoiceVolume}
                          combatControlsSlot={combatControlsSlot}
                        />
                      </div>
                    );
                  }
                  if (gameState === "travel_rest") {
                    return (
                      <GameTravelView>
                        <GameNarration
                          messages={narrationMessages}
                          isStreaming={isStreaming}
                          characterMap={characterMap}
                          activeCharacterIds={characterIds}
                          personaInfo={personaInfo}
                          spriteMap={spriteMap}
                          speakerAvatarMap={librarySpeakerAvatars}
                          onActiveSpeakerChange={handleActiveSpeakerChange}
                          onSegmentEnter={handleSegmentEnter}
                          showUserMessages
                          partyDialogue={partyDialogue}
                          partyChatMessageId={partyChatMessageId}
                          scenePreparing={scenePreparing}
                          assetsGenerating={!!pendingAssetGeneration}
                          sceneAnalysisFailed={sceneAnalysisFailed}
                          onRetryScene={retrySceneAnalysis}
                          onSkipScene={skipSceneAnalysis}
                          generationFailed={generationFailed}
                          onRetryGeneration={retryGeneration}
                          hasStoredNarrationPosition={restoredNarrationState.hasStoredPosition}
                          restoredSegmentIndex={restoredSegmentIndex}
                          onSegmentChange={handleSegmentChange}
                          onNarrationComplete={handleNarrationComplete}
                          onReadable={handleReadable}
                          onNpcPortraitClick={handleNpcPortraitClick}
                          autoPlayBlocked={narrationAutoPlayBlocked}
                          gameVoiceVolume={effectiveGameVoiceVolume}
                          directionsActive={directionsPlaying}
                          widgetSlot={mobileWidgetSlot}
                          choicesSlot={choicesSlot}
                          diceResultSlot={diceResultSlot}
                          skillCheckSlot={skillCheckSlot}
                          onOpenInventory={() => setInventoryOpen(true)}
                          inventoryCount={inventoryItems.length}
                          onDeleteMessage={onDeleteMessage}
                          onDeleteSegment={handleDeleteSegment}
                          onEditMessage={handleEditMessage}
                          segmentEdits={segmentEdits}
                          segmentDeletes={segmentDeletes}
                          onEditSegment={handleEditSegment}
                          onInterruptRequest={handleInterruptRequest}
                          onInterruptCancel={handleInterruptCancel}
                          interruptPending={interruptPending}
                          interruptCommitted={interruptCommitted}
                          messageOffset={messageOffset}
                          onStepForward={handleStepForward}
                          onJumpToLatest={handleReturnToLatest}
                          nextActionToken={nextActionToken}
                          onMaxNavOffsetChange={handleMaxNavOffsetChange}
                          inputSlot={
                            <GameInput
                              onSend={handleSendGameTurn}
                              onRollDice={handleRollDice}
                              hasPartyMembers={partyMembers.length > 0}
                              pendingMoveLabel={pendingMapMove?.label ?? null}
                              onClearPendingMove={() => setPendingMapMove(null)}
                              disabled={isStreaming || !sessionInteractive}
                              isStreaming={isStreaming}
                              inline
                              draftKey={activeChatId}
                              focusToken={gameInputFocusToken}
                              interruptMode={pendingInterruptMode}
                            />
                          }
                        />
                      </GameTravelView>
                    );
                  }
                  return (
                    <GameNarration
                      messages={narrationMessages}
                      isStreaming={isStreaming}
                      characterMap={characterMap}
                      activeCharacterIds={characterIds}
                      personaInfo={personaInfo}
                      spriteMap={spriteMap}
                      speakerAvatarMap={librarySpeakerAvatars}
                      onActiveSpeakerChange={handleActiveSpeakerChange}
                      onSegmentEnter={handleSegmentEnter}
                      showUserMessages
                      partyDialogue={partyDialogue}
                      partyChatMessageId={partyChatMessageId}
                      scenePreparing={scenePreparing}
                      assetsGenerating={!!pendingAssetGeneration}
                      sceneAnalysisFailed={sceneAnalysisFailed}
                      onRetryScene={retrySceneAnalysis}
                      onSkipScene={skipSceneAnalysis}
                      generationFailed={generationFailed}
                      onRetryGeneration={retryGeneration}
                      hasStoredNarrationPosition={restoredNarrationState.hasStoredPosition}
                      restoredSegmentIndex={restoredSegmentIndex}
                      onSegmentChange={handleSegmentChange}
                      onNarrationComplete={handleNarrationComplete}
                      onReadable={handleReadable}
                      onNpcPortraitClick={handleNpcPortraitClick}
                      autoPlayBlocked={narrationAutoPlayBlocked}
                      gameVoiceVolume={effectiveGameVoiceVolume}
                      directionsActive={directionsPlaying}
                      widgetSlot={mobileWidgetSlot}
                      choicesSlot={choicesSlot}
                      diceResultSlot={diceResultSlot}
                      skillCheckSlot={skillCheckSlot}
                      onOpenInventory={() => setInventoryOpen(true)}
                      inventoryCount={inventoryItems.length}
                      onDeleteMessage={onDeleteMessage}
                      onDeleteSegment={handleDeleteSegment}
                      onEditMessage={handleEditMessage}
                      segmentEdits={segmentEdits}
                      segmentDeletes={segmentDeletes}
                      onEditSegment={handleEditSegment}
                      onInterruptRequest={handleInterruptRequest}
                      onInterruptCancel={handleInterruptCancel}
                      interruptPending={interruptPending}
                      interruptCommitted={interruptCommitted}
                      messageOffset={messageOffset}
                      onStepForward={handleStepForward}
                      onJumpToLatest={handleReturnToLatest}
                      nextActionToken={nextActionToken}
                      onMaxNavOffsetChange={handleMaxNavOffsetChange}
                      inputSlot={
                        <GameInput
                          onSend={handleSendGameTurn}
                          onRollDice={handleRollDice}
                          hasPartyMembers={partyMembers.length > 0}
                          pendingMoveLabel={pendingMapMove?.label ?? null}
                          onClearPendingMove={() => setPendingMapMove(null)}
                          disabled={isStreaming || !sessionInteractive}
                          isStreaming={isStreaming}
                          inline
                          draftKey={activeChatId}
                          focusToken={gameInputFocusToken}
                          interruptMode={pendingInterruptMode}
                        />
                      }
                    />
                  );
                })()}

                {/* QTE overlay — absolute, centered */}
                {activeQte && sessionInteractive && (
                  <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center">
                    <GameQteOverlay
                      actions={activeQte.actions.map((a) => ({ label: a }))}
                      timerSeconds={activeQte.timer}
                      onSelect={handleQteSelect}
                      onTimeout={handleQteTimeout}
                    />
                  </div>
                )}

                {/* Session history panel (full overlay) */}
                {historyOpen && (
                  <GameSessionHistory
                    summaries={sessionSummaries}
                    currentSessionNumber={displaySessionNumber}
                    currentSessionDate={
                      (chatMeta.gameCurrentSessionStartedAt as string | undefined) || chat.createdAt || chat.updatedAt
                    }
                    currentSecrets={currentSessionSecrets}
                    savingSessionNumber={savingSessionSummary}
                    savingCurrentSecrets={savingCurrentSessionSecrets}
                    regeneratingSessionNumber={
                      regenerateSessionConclusion.isPending
                        ? (regenerateSessionConclusion.variables?.sessionNumber ?? null)
                        : null
                    }
                    lorebookKeeperEnabled={chatMeta.gameLorebookKeeperEnabled === true}
                    lorebookKeeperLastRun={
                      chatMeta.gameLorebookKeeperLastRun &&
                      typeof chatMeta.gameLorebookKeeperLastRun === "object" &&
                      !Array.isArray(chatMeta.gameLorebookKeeperLastRun)
                        ? (chatMeta.gameLorebookKeeperLastRun as {
                            sessionNumber: number;
                            status: "running" | "success" | "failed";
                            updatedAt: string;
                            entryCount?: number;
                            error?: string;
                          })
                        : null
                    }
                    regeneratingLorebookSessionNumber={
                      regenerateSessionLorebook.isPending
                        ? (regenerateSessionLorebook.variables?.sessionNumber ?? null)
                        : null
                    }
                    updatingPlotArcsSessionNumber={
                      updateCampaignProgression.isPending
                        ? (updateCampaignProgression.variables?.sessionNumber ?? null)
                        : null
                    }
                    onSaveCurrentSecrets={handleSaveCurrentSessionSecrets}
                    onSaveSession={handleSaveSessionDetails}
                    onRegenerateSession={handleRegenerateSessionConclusion}
                    onRegenerateLorebook={handleRegenerateSessionLorebook}
                    onUpdatePlotArcs={handleUpdateCampaignProgression}
                    onClose={() => setHistoryOpen(false)}
                  />
                )}

                {combatLogsOpen && (
                  <div
                    className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
                    onClick={() => setCombatLogsOpen(false)}
                  >
                    <div
                      className="flex max-h-[82vh] w-full max-w-2xl flex-col rounded-xl border border-white/15 bg-[var(--card)] shadow-2xl"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ScrollText size={16} className="text-[var(--muted-foreground)]" />
                          <span className="text-sm font-semibold text-[var(--foreground)]">Combat Logs</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCombatLogsOpen(false)}
                          className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                          title="Close logs"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div
                        className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
                        ref={(el) => {
                          if (el && !combatLogScrolledRef.current) {
                            combatLogScrolledRef.current = true;
                            requestAnimationFrame(() => {
                              el.scrollTop = el.scrollHeight;
                            });
                          }
                        }}
                      >
                        {combatLogEntries.length === 0 ? (
                          <p className="text-sm text-[var(--muted-foreground)]">No logs yet.</p>
                        ) : (
                          <>
                            {hiddenCombatLogCount > 0 && (
                              <div className="flex justify-center pb-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    combatLogScrolledRef.current = true;
                                    setCombatLogVisibleCount((current) =>
                                      Math.min(combatLogEntries.length, current + combatLogPageSize),
                                    );
                                  }}
                                  className="rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-xs font-medium text-white/70 shadow-lg transition-colors hover:bg-white/10 hover:text-white"
                                >
                                  Show more older logs ({hiddenCombatLogCount})
                                </button>
                              </div>
                            )}
                            {visibleCombatLogEntries.map((entry) => {
                              const label =
                                entry.role === "user"
                                  ? personaInfo?.name || "You"
                                  : entry.role === "assistant" || entry.role === "narrator"
                                    ? "GM"
                                    : "System";
                              return (
                                <div key={entry.id} className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                                  <div className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-white/45">
                                    {label}
                                  </div>
                                  <div
                                    className="whitespace-pre-wrap break-words text-xs leading-relaxed text-white/80"
                                    dangerouslySetInnerHTML={{ __html: formatNarration(entry.content, false) }}
                                  />
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Journal overlay — positioned on the outer column so it covers state indicator + content */}
              {journalOpen && (
                <GameJournal
                  chatId={activeChatId}
                  npcs={npcs}
                  onClose={() => setJournalOpen(false)}
                  onNpcPortraitClick={handleNpcPortraitClick}
                  onNpcRemove={handleRemoveNpcFromJournal}
                />
              )}

              <input
                ref={npcPortraitUploadInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const targetName = pendingNpcPortraitUploadName;
                  const file = e.target.files?.[0];
                  setPendingNpcPortraitUploadName(null);
                  e.target.value = "";
                  if (file && targetName) {
                    void handleNpcPortraitUpload(targetName, file);
                  }
                }}
              />

              {/* Gallery drawer */}
              <ChatGalleryDrawer
                chat={chat}
                open={galleryOpen}
                onClose={() => setGalleryOpen(false)}
                onIllustrate={() => retryAgents(activeChatId, ["illustrator"])}
              />

              {/* Inventory overlay */}
              <GameInventory
                items={inventoryItems}
                open={inventoryOpen}
                onClose={() => setInventoryOpen(false)}
                onAddItem={handleAddInventoryItem}
                onRenameItem={handleRenameInventoryItem}
                onRemoveItem={handleRemoveInventoryItem}
                canInteract={sessionInteractive && narrationDone && !isStreaming}
                onUseItem={(itemName) => {
                  setInventoryOpen(false);
                  sendMessage(`I use my ${itemName}.`);
                }}
              />

              {/* Readable document display (Notes / Books) */}
              {activeReadable && (
                <GameReadableDisplay
                  type={activeReadable.type}
                  content={activeReadable.content}
                  onClose={() => {
                    const next = readableQueueRef.current.shift();
                    setActiveReadable(next ?? null);
                  }}
                />
              )}

              {/* First-game spotlight tutorial (auto-opens once; (?) button re-opens) */}
              <GameTutorial open={tutorialOpen} onClose={handleCloseTutorial} />

              {/* Inventory notifications */}
              {inventoryNotifications.length > 0 && (
                <div className="pointer-events-none absolute left-1/2 top-20 z-40 -translate-x-1/2 flex flex-col gap-1">
                  {inventoryNotifications.map((n, i) => (
                    <div
                      key={i}
                      className={cn(
                        "animate-in fade-in-0 slide-in-from-bottom-2 rounded-lg border px-4 py-2 text-sm font-semibold shadow-lg backdrop-blur-sm",
                        n.startsWith("You gained")
                          ? "border-emerald-400/30 bg-emerald-900/80 text-emerald-200"
                          : "border-red-400/30 bg-red-900/80 text-red-200",
                      )}
                    >
                      {n}
                    </div>
                  ))}
                </div>
              )}

              {/* HUD Widgets - Left & Right, tops aligned */}
              {!combatUiActive && hudWidgets.length > 0 && !compactHudWidgets && (
                <>
                  {/* Desktop: full widget cards */}
                  <div className="pointer-events-none absolute inset-x-3 bottom-24 z-30 hidden items-end justify-between md:flex">
                    <div className="w-44" data-game-widget-rail="left">
                      <GameWidgetPanel
                        widgets={normalizedWidgets}
                        position="hud_left"
                        chatId={activeChatId}
                        constraintsRef={hudSurfaceRef}
                      />
                    </div>
                    <div className="w-44" data-game-widget-rail="right">
                      <GameWidgetPanel
                        widgets={normalizedWidgets}
                        position="hud_right"
                        chatId={activeChatId}
                        constraintsRef={hudSurfaceRef}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </DirectionEngine>

        {/* Right: Party rail spans full game height */}
        {/* REMOVED: Old sidebar replaced by compact GamePartyBar in map area */}
      </GameTransitionManager>

      {/* Character sheet modal */}
      {characterSheetOpen && characterSheetCharId && partyCards[characterSheetCharId] && (
        <GameCharacterSheet
          card={partyCards[characterSheetCharId]}
          onClose={closeCharacterSheet}
          onSave={(gameCard: GameCharacterSheetGameCard | undefined) =>
            handleSaveCharacterSheet(partyCards[characterSheetCharId].title, gameCard)
          }
        />
      )}

      {imagePromptReviewModal}

      <Modal open={interruptModalOpen} onClose={closeInterruptModal} title="Attempt to Interrupt?" width="max-w-md">
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/15">
              <AlertTriangle size="1.125rem" className="text-red-300" />
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">
              Interruption attempts can go badly depending on the situation. Force Interrupt cuts in cleanly without
              telling the GM it was an interrupt — Yes attempts an in-fiction interruption that the GM may resist.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={closeInterruptModal}
              className="rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              No
            </button>
            <button
              onClick={() => confirmInterrupt("force")}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 transition-colors"
              style={{
                color: "#20C20E",
                backgroundColor: "rgba(32, 194, 14, 0.12)",
                borderColor: "rgba(32, 194, 14, 0.35)",
                boxShadow: "0 0 0 1px rgba(32, 194, 14, 0.35) inset",
              }}
              title="Cut in without telling the GM it was an interrupt"
            >
              Force Interrupt
            </button>
            <button
              onClick={() => confirmInterrupt("risky")}
              className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-200 ring-1 ring-red-500/40 transition-colors hover:bg-red-500/30"
              title="Attempt an in-fiction interruption — outcomes can fail"
            >
              Yes
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={confirmEndSessionOpen}
        onClose={handleCloseEndSessionDialog}
        title={concludeSession.isPending ? "Ending Session" : "End Session"}
        width="max-w-md"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--destructive)]/10">
              <AlertTriangle size="1.125rem" className="text-[var(--destructive)]" />
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">
              {concludeSession.isPending
                ? "Ending this session and generating its summary. Please wait here until the process finishes."
                : "Are you sure you want to end this session? You can start a new session afterwards, but this one will be marked as concluded."}
            </p>
          </div>

          {concludeSession.isError && !concludeSession.isPending && (
            <p className="rounded-lg border border-[var(--destructive)]/25 bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
              {concludeSession.error.message || "Failed to end the session. You can try again."}
            </p>
          )}

          {!concludeSession.isPending && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-[var(--foreground)]">
                What do you want to happen in the next session (optional)?
              </span>
              <textarea
                value={nextSessionRequest}
                onChange={(event) => setNextSessionRequest(event.target.value)}
                rows={4}
                maxLength={5000}
                placeholder="Leave empty to let the GM steer naturally."
                className="resize-none rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]/70 focus:border-[var(--primary)]"
              />
            </label>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleCloseEndSessionDialog}
              disabled={concludeSession.isPending}
              className="rounded-lg bg-[var(--secondary)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmEndSession}
              disabled={concludeSession.isPending}
              className="rounded-lg bg-[var(--destructive)]/15 px-3 py-1.5 text-xs font-medium text-[var(--destructive)] ring-1 ring-[var(--destructive)]/25 transition-colors hover:bg-[var(--destructive)]/25 disabled:opacity-50"
            >
              {concludeSession.isPending ? "Ending Session..." : "End Session"}
            </button>
          </div>
        </div>
      </Modal>

      <GameWidgetSessionPrepModal
        open={prepareSessionWidgetsOpen}
        widgets={normalizedWidgets}
        chatId={activeChatId}
        onClose={() => setPrepareSessionWidgetsOpen(false)}
        onStartSession={handleStartNewSessionNow}
        isStartingSession={startSessionLocked}
      />

      <GameJsonRepairModal
        request={jsonRepairRequest}
        onClose={() => setJsonRepairRequest(null)}
        onApplied={handleJsonRepairApplied}
      />
    </div>
  );
}
