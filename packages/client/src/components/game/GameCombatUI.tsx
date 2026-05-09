// ──────────────────────────────────────────────
// Game: Turn-Based Combat UI
//
// Classic JRPG/FF-style battle screen with:
// - Party members (left/bottom) vs. Enemies (right/top)
// - HP/MP bars with animated depletion
// - Turn order timeline
// - Action menu (Attack, Skill, Defend, Item, Flee)
// - Floating damage numbers
// - Status effect icons
// - Victory / defeat overlays
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { audioManager } from "../../lib/game-audio";
import { getOrCreateCachedTTSAudioBlob } from "../../lib/tts-audio-cache";
import { normalizeTTSCharacterName, resolveTTSVoiceForSpeaker, splitTTSChunks } from "../../lib/tts-dialogue";
import { ttsService } from "../../lib/tts-service";
import { useGameAssetStore } from "../../stores/game-asset.store";
import { useCombatRound } from "../../hooks/use-game";
import { useTTSConfig } from "../../hooks/use-tts";
import { AnimatedText } from "./AnimatedText";
import type {
  Combatant,
  CombatAttackResult,
  CombatRoundResult,
  CombatPlayerAction,
  CombatSummary,
  CombatDialogueCue,
  CombatItemEffect,
  CombatMechanic,
  PartyDialogueLine,
  TTSConfig,
} from "@marinara-engine/shared";
import {
  Heart,
  Droplets,
  Sword,
  Shield,
  Sparkles,
  Backpack,
  Wind,
  Skull,
  Zap,
  ChevronRight,
  Trophy,
  SkullIcon,
  ScrollText,
  X,
} from "lucide-react";

// `combatant.sprite` is populated either from a real avatar URL (player party,
// from the character sheet's `avatarUrl`) or from the encounter LLM, which is
// instructed to emit "emoji or brief visual description" (see
// `packages/server/src/routes/encounter.routes.ts`). Treat the field as a
// shape-tagged value so the renderer picks `<img>`, an emoji glyph, or the
// initials fallback instead of stuffing free text into `<img src>`.
type SpriteKind = { kind: "url"; value: string } | { kind: "emoji"; value: string } | { kind: "none" };

function resolveSpriteKind(sprite: string | null | undefined): SpriteKind {
  if (!sprite) return { kind: "none" };
  const trimmed = sprite.trim();
  if (!trimmed) return { kind: "none" };
  if (/^(https?:|\/|data:|blob:)/i.test(trimmed)) return { kind: "url", value: trimmed };
  // Emoji / single glyph: short strings (≤12 chars to allow ZWJ sequences and
  // skin-tone modifiers) that contain at least one Extended_Pictographic codepoint.
  if (trimmed.length <= 12 && /\p{Extended_Pictographic}/u.test(trimmed)) {
    return { kind: "emoji", value: trimmed };
  }
  return { kind: "none" };
}

// Mobile layout breakpoint. Uses Tailwind's `sm` boundary so the existing
// desktop classes (`sm:`, `md:`, `lg:`, `xl:`) continue to apply unchanged on
// the desktop branch and the mobile branch only renders below 640px.
function useIsCombatMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 639px)").matches : false,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

type MobileDrawerKind = null | "mechanics" | "cues" | "log" | "party";

// ── Types ──

type CombatPhase =
  | "intro"
  | "player-turn"
  | "skill-select"
  | "item-select"
  | "custom-action"
  | "target-select"
  | "resolving"
  | "animating"
  | "round-end"
  | "victory"
  | "defeat";

interface DamagePopup {
  id: string;
  targetId: string;
  amount: number;
  isCritical: boolean;
  isMiss: boolean;
  isHeal?: boolean;
  /** Elemental reaction label shown above the damage number */
  reactionLabel?: string;
}

interface CombatLogEntry {
  id: string;
  text: string;
  tone?: "system" | "action" | "status";
}

type CombatImpactTone = "hit" | "critical" | "miss" | "heal" | "reaction";

type CombatVoiceEntry =
  | { status: "loading"; urls?: undefined }
  | { status: "ready"; urls: string[] }
  | { status: "error"; urls?: undefined };

type CombatVoiceLine = PartyDialogueLine & {
  chunks: string[];
  voice?: string;
  voiceKey: string;
};

interface GameCombatUIProps {
  chatId: string;
  /** Player party combatants. */
  party: Combatant[];
  /** Enemy combatants. */
  enemies: Combatant[];
  /** Player inventory items available during combat. */
  inventoryItems?: Array<{ name: string; quantity: number; description?: string }>;
  /** Called when combat ends (victory, defeat, or flee). Receives a summary for GM narration. */
  onCombatEnd: (outcome: "victory" | "defeat" | "flee", summary: CombatSummary) => void;
  /** Called after a combat item successfully resolves so the used item can be consumed. */
  onInventoryItemUsed?: (itemName: string) => void | Promise<void>;
  /** Mirrors internal combatant HP/status changes back to the game surface. */
  onCombatantsChange?: (party: Combatant[], enemies: Combatant[]) => void;
  /** Opens the full inventory panel for inspection/management. */
  onOpenInventory?: () => void;
  /** Lets the GM adjudicate a freeform combat maneuver. */
  onCustomInstruction?: (instruction: string) => void;
  /** GM narration to display alongside combat. */
  narration?: string;
  /** GM-produced battle dialogue lines shown in the combat UI. */
  combatDialogue?: PartyDialogueLine[];
  /** GM-produced battle dialogue cues from the encounter blueprint. */
  combatDialogueCues?: CombatDialogueCue[];
  /** GM interpretation of the player's inventory for this encounter. */
  combatItemEffects?: CombatItemEffect[];
  /** GM-authored special encounter rules, usually for bosses. */
  combatMechanics?: CombatMechanic[];
  /** Speaker names eligible for combat voice-over. Unnamed enemies are intentionally omitted by the caller. */
  voicedCombatSpeakerNames?: string[];
  /** Effective game-mode TTS playback volume, 0–1. */
  gameVoiceVolume?: number;
  /** Optional controls rendered immediately above the bottom combat panel. */
  combatControlsSlot?: ReactNode;
  /** Suggested sprite focus for the full-body overlay. */
  onSpriteSuggestionChange?: (suggestion: { name: string; pose: string } | null) => void;
  /** Whether we're waiting for a GM response. */
  _isStreaming?: boolean;
}

// ── Constants ──

const ACTION_MENU = [
  { id: "attack", label: "Attack", icon: Sword, color: "text-red-400" },
  { id: "skill", label: "Skills", icon: Sparkles, color: "text-blue-400" },
  { id: "custom", label: "Special", icon: Zap, color: "text-violet-300" },
  { id: "defend", label: "Defend", icon: Shield, color: "text-amber-400" },
  { id: "item", label: "Items", icon: Backpack, color: "text-green-400" },
  { id: "flee", label: "Flee", icon: Wind, color: "text-gray-400" },
] as const;

const COMBAT_SFX = {
  start: "sfx:combat:sword-unsheathe",
  attack: "sfx:combat:sword-swing",
  criticalHit: "sfx:combat:sword-swing-2",
  miss: "sfx:combat:sword-swing-3",
  defend: "sfx:combat:chainmail",
  magic: "sfx:combat:magic-cast",
  hit: "sfx:combat:spell-hit",
  item: "sfx:ui:potion",
  menuSelect: "sfx:ui:menu-confirm",
  menuHover: "sfx:ui:menu-hover",
  victory: "sfx:ui:coin-pickup",
  defeat: "sfx:ui:menu-cancel",
} as const;

const DAMAGE_DISPLAY_MS = 1200;
const INTRO_DURATION_MS = 1500;

/** Element‐to‐color mapping for aura badges. */
const ELEMENT_AURA_COLORS: Record<string, string> = {
  fire: "#ff4500",
  pyro: "#ff4500",
  ice: "#00bfff",
  cryo: "#00bfff",
  lightning: "#8b5cf6",
  electro: "#9b59b6",
  hydro: "#4169e1",
  anemo: "#77dd77",
  wind: "#77dd77",
  geo: "#daa520",
  dendro: "#228b22",
  poison: "#9400d3",
  holy: "#fffacd",
  shadow: "#4a0080",
  physical: "#c0c0c0",
  quantum: "#6a0dad",
  imaginary: "#ffd700",
};

const STATUS_EFFECT_EMOJI_RULES: Array<{ pattern: RegExp; emoji: string }> = [
  { pattern: /bleed|hemorrhage/i, emoji: "🩸" },
  { pattern: /poison|venom|toxin/i, emoji: "☠️" },
  { pattern: /burn|ignite|scorch/i, emoji: "🔥" },
  { pattern: /bless|holy|radiant/i, emoji: "✨" },
  { pattern: /regen|recover|mend|heal/i, emoji: "💚" },
  { pattern: /shield|barrier|ward|guard|fortify/i, emoji: "🛡️" },
  { pattern: /haste|swift|quick/i, emoji: "💨" },
  { pattern: /slow|chill|freeze/i, emoji: "🧊" },
  { pattern: /stun|shock|paraly/i, emoji: "⚡" },
  { pattern: /curse|weaken|blind|fear/i, emoji: "💀" },
];

function getStatusEffectEmoji(effect: NonNullable<Combatant["statusEffects"]>[number]): string {
  for (const rule of STATUS_EFFECT_EMOJI_RULES) {
    if (rule.pattern.test(effect.name)) return rule.emoji;
  }

  if (effect.modifier > 0) {
    if (effect.stat === "attack") return "⚔️";
    if (effect.stat === "defense") return "🛡️";
    if (effect.stat === "speed") return "💨";
    return "💚";
  }

  if (effect.stat === "attack") return "⚔️";
  if (effect.stat === "defense") return "🪨";
  if (effect.stat === "speed") return "⚡";
  return "💥";
}

function hashCombatVoiceKey(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function buildCombatVoiceConfigSignature(config?: TTSConfig | null): string {
  if (!config) return "combat-tts:none";
  return [
    config.source,
    config.baseUrl,
    config.model,
    config.voice,
    config.voiceMode,
    JSON.stringify(config.voiceAssignments ?? []),
    config.npcDefaultVoicesEnabled ? "npc-defaults" : "npc-global",
    JSON.stringify(config.npcDefaultMaleVoices ?? []),
    JSON.stringify(config.npcDefaultFemaleVoices ?? []),
    config.speed,
    config.elevenLabsStability,
    config.elevenLabsLanguageCode,
  ].join("|");
}

function buildCombatVoiceLineKey(configSignature: string, line: PartyDialogueLine, voice?: string): string {
  return `combat-voice-v1:${hashCombatVoiceKey(
    [configSignature, line.character, line.type, line.expression ?? "", voice ?? "", line.content].join("\n"),
  )}`;
}

function isSpokenCombatDialogue(line: PartyDialogueLine): boolean {
  return line.type === "main" || line.type === "side" || line.type === "extra" || line.type === "whisper";
}

function isShoutedCombatDialogue(line: PartyDialogueLine): boolean {
  return /angry|furious|shout|roar|rage|battle|determined|panic|scared/i.test(line.expression ?? "");
}

function normalizeCombatCueName(value?: string): string {
  return (value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function combatCueToPartyLine(cue: CombatDialogueCue): PartyDialogueLine {
  return {
    character: cue.speaker,
    type: cue.type === "extra" ? "side" : cue.type,
    content: cue.content,
    expression: cue.expression,
    target: cue.target,
  };
}

function getCombatItemEffect(itemName: string, effects: CombatItemEffect[]): CombatItemEffect | undefined {
  const normalizedName = normalizeCombatCueName(itemName.replace(/\s+x\d+$/i, ""));
  return effects.find((effect) => normalizeCombatCueName(effect.name.replace(/\s+x\d+$/i, "")) === normalizedName);
}

function combatItemTargetsAllies(effect?: CombatItemEffect): boolean {
  return !effect || effect.target === "self" || effect.target === "ally" || effect.target === "any";
}

function combatItemTargetsEnemies(effect?: CombatItemEffect): boolean {
  return effect?.target === "enemy" || effect?.target === "any";
}

// ── Component ──

export function GameCombatUI({
  chatId,
  party: initialParty,
  enemies: initialEnemies,
  inventoryItems = [],
  onCombatEnd,
  onInventoryItemUsed,
  onCombatantsChange,
  onOpenInventory,
  onCustomInstruction,
  narration,
  combatDialogue = [],
  combatDialogueCues = [],
  combatItemEffects = [],
  combatMechanics = [],
  voicedCombatSpeakerNames = [],
  gameVoiceVolume = 1,
  combatControlsSlot,
  onSpriteSuggestionChange,
  _isStreaming,
}: GameCombatUIProps) {
  // Combat state
  const [phase, setPhase] = useState<CombatPhase>("intro");
  const [round, setRound] = useState(1);
  const [party, setParty] = useState<Combatant[]>(initialParty);
  const [enemies, setEnemies] = useState<Combatant[]>(initialEnemies);
  const [activePlayerIndex, setActivePlayerIndex] = useState(0);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedItemName, setSelectedItemName] = useState<string | null>(null);
  const [turnOrder, setTurnOrder] = useState<Array<{ id: string; name: string }>>([]);
  const [damagePopups, setDamagePopups] = useState<DamagePopup[]>([]);
  const [roundResult, setRoundResult] = useState<CombatRoundResult | null>(null);
  const [animatingActionIndex, setAnimatingActionIndex] = useState(-1);
  const [actionMenuIndex, setActionMenuIndex] = useState(0);
  const [customInstruction, setCustomInstruction] = useState("");
  const [customInstructionPending, setCustomInstructionPending] = useState(false);
  const [customInstructionSawStreaming, setCustomInstructionSawStreaming] = useState(false);
  const [combatLogEntries, setCombatLogEntries] = useState<CombatLogEntry[]>(() =>
    narration ? [{ id: "combat-start", text: narration, tone: "system" }] : [],
  );
  const [combatVoiceVersion, setCombatVoiceVersion] = useState(0);

  const combatRound = useCombatRound();
  const { data: ttsConfig } = useTTSConfig();
  const manifest = useGameAssetStore((s) => s.manifest);
  const assets = manifest?.assets ?? null;

  const popupCounter = useRef(0);
  const combatLogCounter = useRef(0);
  const combatLogEndRef = useRef<HTMLDivElement | null>(null);
  const introTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const combatVoiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const combatVoiceCacheRef = useRef<Map<string, CombatVoiceEntry>>(new Map());
  const combatVoicePendingRef = useRef<Map<string, AbortController>>(new Map());
  const combatVoiceSequenceRef = useRef(0);
  const lastAutoPlayedCombatVoiceGroupRef = useRef<string | null>(null);

  const appendCombatLog = useCallback((text: string, tone: CombatLogEntry["tone"] = "action") => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setCombatLogEntries((prev) =>
      [...prev, { id: `combat-log-${++combatLogCounter.current}`, text: trimmed, tone }].slice(-80),
    );
  }, []);

  useEffect(() => {
    if (combatLogEntries.length === 0 && narration) {
      setCombatLogEntries([{ id: "combat-start", text: narration, tone: "system" }]);
    }
  }, [combatLogEntries.length, narration]);

  useEffect(() => {
    combatLogEndRef.current?.scrollIntoView({ block: "end" });
  }, [combatLogEntries.length]);

  const visibleCombatDialogue = useMemo(() => {
    const combatants = [...party, ...enemies];
    const activeAction =
      phase === "animating" && roundResult && animatingActionIndex >= 0
        ? (roundResult.actions[animatingActionIndex] ?? null)
        : null;
    const attacker = activeAction ? combatants.find((combatant) => combatant.id === activeAction.attackerId) : null;
    const defender = activeAction ? combatants.find((combatant) => combatant.id === activeAction.defenderId) : null;

    const cueLines = combatDialogueCues
      .filter((cue) => {
        if (!cue.speaker?.trim() || !cue.content?.trim()) return false;
        const speakerKey = normalizeCombatCueName(cue.speaker);
        const speaker = combatants.find((combatant) => normalizeCombatCueName(combatant.name) === speakerKey);
        const hpPercent = speaker && speaker.maxHp > 0 ? (speaker.hp / speaker.maxHp) * 100 : 100;

        if (cue.trigger === "intro") return round === 1 && phase !== "intro";
        if (cue.trigger === "round") return (cue.round ?? round) === round && phase !== "intro";
        if (cue.trigger === "charge") {
          const every = Math.max(1, Math.floor(Number(cue.everyNRounds) || Number(cue.round) || 0));
          return phase !== "intro" && !!every && round % every === 0;
        }
        if (cue.trigger === "phase_75") return phase !== "intro" && hpPercent <= 75;
        if (cue.trigger === "phase_50") return phase !== "intro" && hpPercent <= 50;
        if (cue.trigger === "phase_25" || cue.trigger === "low_hp") return phase !== "intro" && hpPercent <= 25;
        if (cue.trigger === "attack")
          return phase === "animating" && normalizeCombatCueName(attacker?.name) === speakerKey;
        if (cue.trigger === "hit")
          return phase === "animating" && normalizeCombatCueName(defender?.name) === speakerKey;
        if (cue.trigger === "victory") return phase === "victory";
        if (cue.trigger === "defeat") return phase === "defeat";
        return false;
      })
      .map(combatCueToPartyLine);

    return [...combatDialogue, ...cueLines].filter((line) => line.content.trim() && line.type !== "action");
  }, [animatingActionIndex, combatDialogue, combatDialogueCues, enemies, party, phase, round, roundResult]);

  const voicedCombatSpeakerSet = useMemo(
    () => new Set(voicedCombatSpeakerNames.map(normalizeTTSCharacterName).filter(Boolean)),
    [voicedCombatSpeakerNames],
  );

  const combatVoiceConfigSignature = useMemo(() => buildCombatVoiceConfigSignature(ttsConfig), [ttsConfig]);
  const normalizedGameVoiceVolume = Math.max(0, Math.min(1, gameVoiceVolume));

  const combatVoiceLines = useMemo<CombatVoiceLine[]>(() => {
    if (!ttsConfig?.enabled || !ttsConfig.autoplayGame) return [];

    const lines: CombatVoiceLine[] = [];
    for (const line of visibleCombatDialogue) {
      if (!isSpokenCombatDialogue(line)) continue;
      if (!voicedCombatSpeakerSet.has(normalizeTTSCharacterName(line.character))) continue;

      const voice = resolveTTSVoiceForSpeaker(ttsConfig, line.character);
      if (ttsConfig.source === "elevenlabs" && !voice) continue;

      const chunks = splitTTSChunks(line.content);
      if (chunks.length === 0) continue;

      lines.push({
        ...line,
        chunks,
        voice: voice || undefined,
        voiceKey: buildCombatVoiceLineKey(combatVoiceConfigSignature, line, voice),
      });
    }

    return lines;
  }, [combatVoiceConfigSignature, ttsConfig, visibleCombatDialogue, voicedCombatSpeakerSet]);

  const stopCombatVoicePlayback = useCallback(() => {
    combatVoiceSequenceRef.current += 1;
    if (combatVoiceAudioRef.current) {
      combatVoiceAudioRef.current.pause();
      combatVoiceAudioRef.current.onended = null;
      combatVoiceAudioRef.current.onerror = null;
      combatVoiceAudioRef.current = null;
    }
  }, []);

  const playCombatVoiceKeys = useCallback(
    (keys: string[]) => {
      const playableKeys = keys.filter((key) => {
        const entry = combatVoiceCacheRef.current.get(key);
        return entry?.status === "ready" && entry.urls.length > 0;
      });
      if (playableKeys.length === 0) return;

      stopCombatVoicePlayback();
      const sequence = ++combatVoiceSequenceRef.current;
      let keyIndex = 0;
      let urlIndex = 0;

      const playNext = () => {
        if (combatVoiceSequenceRef.current !== sequence) return;
        const key = playableKeys[keyIndex];
        if (!key) {
          combatVoiceAudioRef.current = null;
          return;
        }

        const entry = combatVoiceCacheRef.current.get(key);
        if (!entry || entry.status !== "ready" || entry.urls.length === 0) {
          keyIndex += 1;
          urlIndex = 0;
          playNext();
          return;
        }

        const url = entry.urls[urlIndex];
        if (!url) {
          keyIndex += 1;
          urlIndex = 0;
          playNext();
          return;
        }

        const audio = new Audio(url);
        audio.volume = normalizedGameVoiceVolume;
        audio.muted = normalizedGameVoiceVolume <= 0;
        combatVoiceAudioRef.current = audio;
        audio.onended = () => {
          if (combatVoiceSequenceRef.current !== sequence || combatVoiceAudioRef.current !== audio) return;
          urlIndex += 1;
          playNext();
        };
        audio.onerror = () => {
          if (combatVoiceSequenceRef.current !== sequence || combatVoiceAudioRef.current !== audio) return;
          combatVoiceAudioRef.current = null;
        };
        audio.play().catch(() => {
          if (combatVoiceSequenceRef.current !== sequence || combatVoiceAudioRef.current !== audio) return;
          combatVoiceAudioRef.current = null;
        });
      };

      playNext();
    },
    [normalizedGameVoiceVolume, stopCombatVoicePlayback],
  );

  useEffect(() => {
    if (!combatVoiceAudioRef.current) return;
    combatVoiceAudioRef.current.volume = normalizedGameVoiceVolume;
    combatVoiceAudioRef.current.muted = normalizedGameVoiceVolume <= 0;
  }, [normalizedGameVoiceVolume]);

  useEffect(() => {
    if (!ttsConfig || combatVoiceLines.length === 0) return;

    for (const line of combatVoiceLines) {
      if (combatVoiceCacheRef.current.has(line.voiceKey) || combatVoicePendingRef.current.has(line.voiceKey)) continue;
      const controller = new AbortController();
      combatVoicePendingRef.current.set(line.voiceKey, controller);
      combatVoiceCacheRef.current.set(line.voiceKey, { status: "loading" });
      setCombatVoiceVersion((version) => version + 1);

      void (async () => {
        const blobs: Blob[] = [];
        let failed = false;
        for (const [chunkIndex, chunk] of line.chunks.entries()) {
          if (controller.signal.aborted) break;
          const chunkKey = `${line.voiceKey}:${chunkIndex}`;
          try {
            const blob = await getOrCreateCachedTTSAudioBlob(chunkKey, () =>
              ttsService.generateAudio(chunk, {
                speaker: line.character,
                tone: line.expression,
                voice: line.voice,
                signal: controller.signal,
              }),
            );
            blobs.push(blob);
          } catch (err) {
            if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) break;
            failed = true;
            console.warn(
              `[combat-tts] Failed to generate combat voice line chunk ${chunkIndex + 1}/${line.chunks.length}`,
              err,
            );
            break;
          }
        }

        try {
          if (controller.signal.aborted) return;
          const urls = blobs.map((blob) => URL.createObjectURL(blob));
          if (failed || urls.length !== line.chunks.length) {
            for (const url of urls) URL.revokeObjectURL(url);
          }
          combatVoiceCacheRef.current.set(
            line.voiceKey,
            !failed && urls.length === line.chunks.length ? { status: "ready", urls } : { status: "error" },
          );
        } finally {
          combatVoicePendingRef.current.delete(line.voiceKey);
          if (!controller.signal.aborted) {
            setCombatVoiceVersion((version) => version + 1);
          }
        }
      })();
    }
  }, [combatVoiceLines, ttsConfig]);

  useEffect(() => {
    const groupKey = combatVoiceLines.map((line) => line.voiceKey).join("|");
    if (!groupKey) {
      lastAutoPlayedCombatVoiceGroupRef.current = null;
      stopCombatVoicePlayback();
      return;
    }
    if (lastAutoPlayedCombatVoiceGroupRef.current === groupKey) return;

    const entries = combatVoiceLines.map((line) => combatVoiceCacheRef.current.get(line.voiceKey));
    if (entries.some((entry) => !entry || entry.status === "loading")) return;

    lastAutoPlayedCombatVoiceGroupRef.current = groupKey;
    playCombatVoiceKeys(
      combatVoiceLines.filter((line, index) => entries[index]?.status === "ready").map((line) => line.voiceKey),
    );
  }, [combatVoiceLines, combatVoiceVersion, playCombatVoiceKeys, stopCombatVoicePlayback]);

  useEffect(() => {
    const pending = combatVoicePendingRef.current;
    const cached = combatVoiceCacheRef.current;
    return () => {
      stopCombatVoicePlayback();
      for (const controller of pending.values()) {
        controller.abort();
      }
      pending.clear();
      for (const entry of cached.values()) {
        if (entry.status === "ready") {
          for (const url of entry.urls) URL.revokeObjectURL(url);
        }
      }
      cached.clear();
    };
  }, [stopCombatVoicePlayback]);

  useEffect(() => {
    setParty(initialParty);
  }, [initialParty]);

  useEffect(() => {
    setEnemies(initialEnemies);
  }, [initialEnemies]);

  // ── Intro phase ──
  useEffect(() => {
    introTimer.current = setTimeout(() => {
      setPhase("player-turn");
    }, INTRO_DURATION_MS);
    return () => clearTimeout(introTimer.current);
  }, []);

  // ── All combatants merged for server requests ──
  const allCombatants = useMemo(
    () => [
      ...party.map((c) => ({ ...c, side: "player" as const })),
      ...enemies.map((c) => ({ ...c, side: "enemy" as const })),
    ],
    [party, enemies],
  );

  // ── Build a post-combat summary for the GM ──
  const buildSummary = useCallback(
    (outcome: "victory" | "defeat" | "flee"): CombatSummary => {
      return {
        outcome,
        rounds: round,
        party: party.map((c) => ({
          name: c.name,
          hp: c.hp,
          maxHp: c.maxHp,
          ko: c.hp <= 0,
          statusEffects: (c.statusEffects ?? []).map((e) => e.name),
        })),
        enemies: enemies.map((c) => ({
          name: c.name,
          defeated: c.hp <= 0,
          hp: c.hp,
          maxHp: c.maxHp,
        })),
      };
    },
    [party, enemies, round],
  );

  // ── Active player ──
  const activePlayer = party[activePlayerIndex] ?? null;
  const selectedSkill = activePlayer?.skills?.find((skill) => skill.id === selectedSkillId) ?? null;
  const selectedItemEffect = selectedItemName ? getCombatItemEffect(selectedItemName, combatItemEffects) : undefined;
  const selectingAllyTarget =
    (selectedAction === "skill" && selectedSkill?.type === "heal") ||
    (selectedAction === "item" &&
      combatItemTargetsAllies(selectedItemEffect) &&
      !combatItemTargetsEnemies(selectedItemEffect));
  const selectingEnemyTarget =
    selectedAction === "attack" ||
    (selectedAction === "skill" && selectedSkill?.type !== "heal") ||
    (selectedAction === "item" && combatItemTargetsEnemies(selectedItemEffect));
  const activeCombatAction =
    phase === "animating" && roundResult && animatingActionIndex >= 0
      ? (roundResult.actions[animatingActionIndex] ?? null)
      : null;
  const activeImpactTone = activeCombatAction ? getCombatImpactTone(activeCombatAction) : null;

  const combatSpriteSuggestion = useMemo(() => {
    if (phase === "victory") {
      const celebrant = activePlayer ?? party.find((member) => member.hp > 0) ?? party[0] ?? null;
      return celebrant ? { name: celebrant.name, pose: "victory" } : null;
    }

    if (phase === "defeat") {
      const fallenMember = activePlayer ?? party[0] ?? null;
      return fallenMember ? { name: fallenMember.name, pose: "hurt" } : null;
    }

    if (phase === "animating" && roundResult && animatingActionIndex >= 0) {
      if (activeCombatAction) {
        const attacker = allCombatants.find((combatant) => combatant.id === activeCombatAction.attackerId) ?? null;
        const defender = allCombatants.find((combatant) => combatant.id === activeCombatAction.defenderId) ?? null;

        if (attacker?.side === "player") {
          return { name: attacker.name, pose: activeCombatAction.skillName ? "casting" : "attack" };
        }
        if (defender?.side === "player") {
          return { name: defender.name, pose: activeCombatAction.isHeal ? "casting" : "hurt" };
        }
      }
    }

    if (activePlayer) {
      if (phase === "resolving") {
        if (selectedAction === "defend") return { name: activePlayer.name, pose: "defend" };
        if (selectedAction === "item") return { name: activePlayer.name, pose: "casting" };
        if (selectedAction === "skill") return { name: activePlayer.name, pose: "casting" };
        if (selectedAction === "attack") return { name: activePlayer.name, pose: "attack" };
      }

      if (
        phase === "skill-select" ||
        phase === "item-select" ||
        phase === "custom-action" ||
        (phase === "target-select" && selectedAction === "skill")
      ) {
        return { name: activePlayer.name, pose: "casting" };
      }

      return { name: activePlayer.name, pose: "battle_stance" };
    }

    return null;
  }, [
    activeCombatAction,
    activePlayer,
    allCombatants,
    animatingActionIndex,
    party,
    phase,
    roundResult,
    selectedAction,
  ]);

  useEffect(() => {
    onSpriteSuggestionChange?.(combatSpriteSuggestion);
    return () => {
      onSpriteSuggestionChange?.(null);
    };
  }, [combatSpriteSuggestion, onSpriteSuggestionChange]);

  // ── Play SFX helper ──
  const playSfx = useCallback(
    (tag: string) => {
      audioManager.playSfx(tag, assets);
    },
    [assets],
  );

  useEffect(() => {
    if (phase !== "intro") return;
    playSfx(COMBAT_SFX.start);
  }, [phase, playSfx]);

  // ── Spawn damage popup ──
  const spawnDamage = useCallback(
    (
      targetId: string,
      amount: number,
      isCritical: boolean,
      isMiss: boolean,
      reactionLabel?: string,
      isHeal = false,
    ) => {
      const id = `dmg-${++popupCounter.current}`;
      const popup: DamagePopup = { id, targetId, amount, isCritical, isMiss, reactionLabel, isHeal };
      setDamagePopups((prev) => [...prev, popup]);
      setTimeout(() => {
        setDamagePopups((prev) => prev.filter((p) => p.id !== id));
      }, DAMAGE_DISPLAY_MS);
    },
    [],
  );

  // ── Update a combatant's HP during animation ──
  const updateCombatantHp = useCallback((id: string, newHp: number) => {
    setParty((prev) => prev.map((c) => (c.id === id ? { ...c, hp: Math.max(0, newHp) } : c)));
    setEnemies((prev) => prev.map((c) => (c.id === id ? { ...c, hp: Math.max(0, newHp) } : c)));
  }, []);

  // ── Apply round end — check victory/defeat ──
  const applyRoundEnd = useCallback(
    (updatedCombatants: Combatant[]) => {
      const updatedParty = party.map((p) => {
        const u = updatedCombatants.find((c) => c.id === p.id);
        return u
          ? {
              ...p,
              hp: u.hp,
              mp: u.mp ?? p.mp,
              maxMp: u.maxMp ?? p.maxMp,
              statusEffects: u.statusEffects,
              elementAura: u.elementAura,
              element: u.element,
            }
          : p;
      });
      const updatedEnemies = enemies.map((e) => {
        const u = updatedCombatants.find((c) => c.id === e.id);
        return u
          ? {
              ...e,
              hp: u.hp,
              mp: u.mp ?? e.mp,
              maxMp: u.maxMp ?? e.maxMp,
              statusEffects: u.statusEffects,
              elementAura: u.elementAura,
              element: u.element,
            }
          : e;
      });

      setParty(updatedParty);
      setEnemies(updatedEnemies);
      onCombatantsChange?.(updatedParty, updatedEnemies);
      setAnimatingActionIndex(-1);

      const partyAlive = updatedParty.some((c) => c.hp > 0);
      const enemiesAlive = updatedEnemies.some((c) => c.hp > 0);

      if (!enemiesAlive) {
        playSfx(COMBAT_SFX.victory);
        setPhase("victory");
        return;
      }

      if (!partyAlive) {
        playSfx(COMBAT_SFX.defeat);
        setPhase("defeat");
        return;
      }

      setRound((r) => r + 1);
      setPhase("player-turn");
      setSelectedAction(null);
      setSelectedSkillId(null);
      setSelectedItemName(null);
      setActivePlayerIndex(0);
    },
    [party, enemies, onCombatantsChange, playSfx],
  );

  // ── Animate round results one action at a time ──
  const animateRoundResults = useCallback(
    (result: CombatRoundResult, updatedCombatants: Combatant[]) => {
      setPhase("animating");
      let actionIdx = 0;
      const combatantsForLog = allCombatants;

      const playNextAction = () => {
        if (actionIdx >= result.actions.length) {
          for (const tick of result.statusTicks) {
            const combatant = combatantsForLog.find((c) => c.id === tick.id);
            appendCombatLog(
              tick.expired
                ? `${tick.effect} fades from ${combatant?.name ?? "a combatant"}.`
                : `${combatant?.name ?? "A combatant"} is affected by ${tick.effect}.`,
              "status",
            );
          }
          appendCombatLog(`Round ${result.round} ends.`, "system");
          applyRoundEnd(updatedCombatants);
          return;
        }

        const action = result.actions[actionIdx]!;
        setAnimatingActionIndex(actionIdx);
        appendCombatLog(formatCombatActionNarration(action, combatantsForLog), "action");

        if (action.isMiss) playSfx(COMBAT_SFX.miss);
        else if (action.isCritical) playSfx(COMBAT_SFX.criticalHit);
        else playSfx(COMBAT_SFX.hit);

        // Show reaction text if an elemental reaction triggered
        if (action.reaction) {
          spawnDamage(
            action.defenderId,
            action.finalDamage,
            action.isCritical,
            action.isMiss,
            action.reaction.reaction,
            action.isHeal ?? false,
          );
        } else {
          spawnDamage(
            action.defenderId,
            action.finalDamage,
            action.isCritical,
            action.isMiss,
            undefined,
            action.isHeal ?? false,
          );
        }

        if (!action.isMiss) updateCombatantHp(action.defenderId, action.remainingHp);

        actionIdx++;
        setTimeout(playNextAction, action.reaction ? 1200 : 800);
      };

      setTimeout(playNextAction, 400);
    },
    [allCombatants, appendCombatLog, playSfx, spawnDamage, applyRoundEnd, updateCombatantHp],
  );

  // ── Resolve a combat round on the server ──
  const resolveRound = useCallback(
    (playerAction: CombatPlayerAction, usedItemName?: string) => {
      setPhase("resolving");

      combatRound.mutate(
        {
          chatId,
          combatants: allCombatants
            .filter((c) => c.hp > 0)
            .map((c) => ({
              id: c.id,
              name: c.name,
              hp: c.hp,
              maxHp: c.maxHp,
              mp: c.mp,
              maxMp: c.maxMp,
              attack: c.attack,
              defense: c.defense,
              speed: c.speed,
              level: c.level,
              side: c.side,
              skills: c.skills,
              statusEffects: c.statusEffects,
              element: c.element,
              elementAura: c.elementAura,
            })),
          round,
          playerAction,
          mechanics: combatMechanics,
        },
        {
          onSuccess: (data) => {
            const result = data.result as CombatRoundResult;
            const updatedCombatants = data.combatants as Combatant[];
            if (usedItemName) {
              void onInventoryItemUsed?.(usedItemName);
            }
            setRoundResult(result);
            setTurnOrder(result.initiative.map((e) => ({ id: e.id, name: e.name })));
            animateRoundResults(result, updatedCombatants);
          },
          onError: () => setPhase("player-turn"),
        },
      );
    },
    [chatId, allCombatants, round, combatRound, combatMechanics, onInventoryItemUsed, animateRoundResults],
  );

  // ── Handle action selection ──
  const handleActionSelect = useCallback(
    (actionId: string) => {
      playSfx(COMBAT_SFX.menuSelect);

      if (actionId === "flee") {
        onCombatEnd("flee", buildSummary("flee"));
        return;
      }
      if (actionId === "defend") {
        setSelectedAction("defend");
        playSfx(COMBAT_SFX.defend);
        appendCombatLog(`${activePlayer?.name ?? "The party"} takes a defensive stance.`, "system");
        resolveRound({ type: "defend" });
        return;
      }
      if (actionId === "attack") {
        setSelectedAction("attack");
        setSelectedSkillId(null);
        setSelectedItemName(null);
        setPhase("target-select");
        return;
      }
      if (actionId === "skill") {
        setSelectedAction("skill");
        setSelectedSkillId(null);
        setSelectedItemName(null);
        setPhase("skill-select");
        return;
      }
      if (actionId === "item") {
        setSelectedAction("item");
        setSelectedSkillId(null);
        setSelectedItemName(null);
        setPhase("item-select");
        return;
      }
      if (actionId === "custom") {
        setSelectedAction("custom");
        setSelectedSkillId(null);
        setSelectedItemName(null);
        setPhase("custom-action");
        return;
      }
    },
    [activePlayer?.name, appendCombatLog, playSfx, onCombatEnd, resolveRound, buildSummary],
  );

  const submitCustomInstruction = useCallback(() => {
    const instruction = customInstruction.trim();
    if (!instruction || !onCustomInstruction) return;
    playSfx(COMBAT_SFX.menuSelect);
    setSelectedAction("custom");
    setCustomInstruction("");
    setCustomInstructionPending(true);
    setCustomInstructionSawStreaming(false);
    setPhase("resolving");
    onCustomInstruction(instruction);
  }, [customInstruction, onCustomInstruction, playSfx]);

  useEffect(() => {
    if (!customInstructionPending) return;
    if (_isStreaming) {
      setCustomInstructionSawStreaming(true);
      return;
    }
    if (!customInstructionSawStreaming) return;
    setCustomInstructionPending(false);
    setCustomInstructionSawStreaming(false);
    setSelectedAction(null);
    setSelectedItemName(null);
    setPhase("player-turn");
  }, [_isStreaming, customInstructionPending, customInstructionSawStreaming]);

  const handleItemSelect = useCallback(
    (itemName: string) => {
      const normalizedItemName = itemName.trim();
      if (!activePlayer || !normalizedItemName) return;
      playSfx(COMBAT_SFX.item);
      setSelectedAction("item");
      setSelectedSkillId(null);
      setSelectedItemName(normalizedItemName);
      const itemEffect = getCombatItemEffect(normalizedItemName, combatItemEffects);
      if (combatItemTargetsEnemies(itemEffect) || (itemEffect?.target === "ally" && party.length > 1)) {
        setPhase("target-select");
        return;
      }
      const targetId = itemEffect?.target === "ally" ? party.find((member) => member.hp > 0)?.id : activePlayer.id;
      resolveRound(
        { type: "item", itemId: normalizedItemName, targetId, itemEffect },
        itemEffect?.consumes === false ? undefined : normalizedItemName,
      );
    },
    [activePlayer, combatItemEffects, party, playSfx, resolveRound],
  );

  // ── Handle target selection ──
  const handleTargetSelect = useCallback(
    (targetId: string) => {
      playSfx(
        selectedAction === "skill" ? COMBAT_SFX.magic : selectedAction === "item" ? COMBAT_SFX.item : COMBAT_SFX.attack,
      );
      const action: CombatPlayerAction =
        selectedAction === "skill" && selectedSkillId
          ? { type: "skill", skillId: selectedSkillId, targetId }
          : selectedAction === "item" && selectedItemName
            ? {
                type: "item",
                itemId: selectedItemName,
                targetId,
                itemEffect: selectedItemEffect,
              }
            : { type: "attack", targetId };
      const usedItemName =
        selectedAction === "item" && selectedItemName && selectedItemEffect?.consumes !== false
          ? selectedItemName
          : undefined;
      resolveRound(action, usedItemName);
    },
    [selectedAction, selectedItemEffect, selectedItemName, selectedSkillId, playSfx, resolveRound],
  );

  // ── Keyboard navigation for action menu ──
  useEffect(() => {
    if (phase !== "player-turn") return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "w") {
        e.preventDefault();
        setActionMenuIndex((i) => (i - 1 + ACTION_MENU.length) % ACTION_MENU.length);
        playSfx(COMBAT_SFX.menuHover);
      } else if (e.key === "ArrowDown" || e.key === "s") {
        e.preventDefault();
        setActionMenuIndex((i) => (i + 1) % ACTION_MENU.length);
        playSfx(COMBAT_SFX.menuHover);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleActionSelect(ACTION_MENU[actionMenuIndex]!.id);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [phase, actionMenuIndex, handleActionSelect, playSfx]);

  // ── Mobile layout state ──
  // Mobile is treated as a separate render path below — `useIsCombatMobile()` toggles
  // between the existing desktop tree and a sticky-bottom-action-sheet layout. Drawers
  // (Mechanics / Cues / Log / Party) replace inline panels that don't fit on small screens.
  const isMobile = useIsCombatMobile();
  const [openDrawer, setOpenDrawer] = useState<MobileDrawerKind>(null);
  // Keyboard parity for tablets / external keyboards: Escape dismisses the drawer
  // (matches the existing close button + backdrop tap behavior).
  useEffect(() => {
    if (!openDrawer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDrawer]);

  // ── Render ──

  if (isMobile) {
    return (
      <div className="absolute inset-0 z-30 flex h-full flex-col overflow-hidden">
        {/* Impact flash overlay */}
        {activeImpactTone && activeImpactTone !== "miss" && (
          <div
            key={`${animatingActionIndex}-${activeImpactTone}-mobile`}
            className={cn(
              "pointer-events-none absolute inset-0 z-20",
              activeImpactTone === "critical" && "game-combat-impact-flash game-combat-impact-flash--critical",
              activeImpactTone === "reaction" && "game-combat-impact-flash game-combat-impact-flash--reaction",
              activeImpactTone === "hit" && "game-combat-impact-flash",
              activeImpactTone === "heal" && "game-combat-impact-flash game-combat-impact-flash--heal",
            )}
          />
        )}

        {/* Intro overlay */}
        {phase === "intro" && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 animate-in fade-in duration-300">
            <div className="flex flex-col items-center gap-3 px-6 text-center animate-in zoom-in-50 duration-500">
              <Sword className="h-9 w-9 text-red-400" />
              <AnimatedText html="BATTLE START" className="text-xl font-bold tracking-wide text-white" />
              <span className="text-xs text-white/60">{enemies.map((e) => e.name).join(", ")}</span>
            </div>
          </div>
        )}

        {/* Top: round counter + compact enemy strip */}
        <div className="relative z-10 shrink-0 border-b border-white/10 bg-black/70 px-2 py-2 backdrop-blur-md">
          <div className="flex items-stretch gap-2">
            <div className="flex shrink-0 flex-col items-center justify-center rounded border border-white/10 bg-white/5 px-2">
              <span className="text-[0.5rem] font-semibold uppercase tracking-wide text-white/40">Round</span>
              <span className="text-base font-bold leading-none tabular-nums text-white">{round}</span>
            </div>
            <div className="flex flex-1 gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {enemies.map((enemy) => (
                <MobileCombatantChip
                  key={enemy.id}
                  combatant={enemy}
                  side="enemy"
                  isTargetable={phase === "target-select" && selectingEnemyTarget}
                  isActive={turnOrder[0]?.id === enemy.id && phase === "animating"}
                  onSelect={() => handleTargetSelect(enemy.id)}
                  damagePopups={damagePopups.filter((p) => p.targetId === enemy.id)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Middle: scene area (animating narration, victory/defeat overlay, dialogue toast) */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {phase === "animating" && roundResult && animatingActionIndex >= 0 && (
            <div className="pointer-events-none absolute inset-x-2 top-2 z-10 rounded-lg border border-white/10 bg-black/75 px-3 py-2 backdrop-blur-md">
              <ActionNarration action={roundResult.actions[animatingActionIndex]!} allCombatants={allCombatants} />
            </div>
          )}
          {phase === "resolving" && (
            <div className="absolute inset-x-2 top-2 z-10 flex items-center gap-2 rounded-lg border border-white/10 bg-black/75 px-3 py-2 text-xs text-white/70 backdrop-blur-md">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {selectedAction === "custom"
                ? "The Game Master is adjudicating your maneuver..."
                : "Resolving actions..."}
            </div>
          )}
          {/* Latest dialogue cue floats as a toast */}
          {visibleCombatDialogue.length > 0 && phase !== "intro" && phase !== "victory" && phase !== "defeat" && (
            <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 max-h-[35%] space-y-1 overflow-hidden">
              {visibleCombatDialogue.slice(-2).map((line, index) => {
                const isEnemyLine = !voicedCombatSpeakerSet.has(normalizeTTSCharacterName(line.character));
                return (
                  <div
                    key={`mobile-cue-${line.character}-${line.type}-${index}-${line.content.slice(0, 16)}`}
                    className={cn(
                      "game-combat-action-bark mx-auto w-fit max-w-full rounded-xl border px-2.5 py-1.5 shadow-lg backdrop-blur-md animate-party-slide-in",
                      isEnemyLine
                        ? "border-red-300/20 bg-red-950/60 text-red-50/85"
                        : "border-sky-300/20 bg-sky-950/60 text-sky-50/90",
                    )}
                  >
                    <div className="flex items-center gap-1">
                      <span
                        className={cn(
                          "text-[0.6rem] font-bold",
                          isEnemyLine ? "text-red-200" : "text-sky-200",
                        )}
                      >
                        {line.character}
                      </span>
                    </div>
                    <p className="mt-0.5 break-words text-xs leading-snug [overflow-wrap:anywhere]">
                      {line.content}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          {/* Victory / defeat overlays — full-screen on mobile, not buried in the bottom sheet */}
          {phase === "victory" && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 px-6 text-center animate-in fade-in duration-500">
              <Trophy className="h-12 w-12 text-amber-400" />
              <AnimatedText html="{bounce:Victory!}" className="text-2xl font-bold text-amber-200" />
              <button
                onClick={() => onCombatEnd("victory", buildSummary("victory"))}
                className="rounded-lg bg-amber-500/20 px-6 py-2.5 text-sm font-semibold text-amber-200 ring-1 ring-amber-400/30 transition-colors hover:bg-amber-500/30"
              >
                Continue
              </button>
            </div>
          )}
          {phase === "defeat" && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 px-6 text-center animate-in fade-in duration-500">
              <SkullIcon className="h-12 w-12 text-red-400" />
              <AnimatedText html="{shake:Defeat...}" className="text-2xl font-bold text-red-200" />
              <AnimatedText html="{pulse:Your party has fallen.}" className="text-xs text-white/55" />
              <button
                onClick={() => onCombatEnd("defeat", buildSummary("defeat"))}
                className="rounded-lg bg-red-500/20 px-6 py-2.5 text-sm font-semibold text-red-200 ring-1 ring-red-400/30 transition-colors hover:bg-red-500/30"
              >
                Continue
              </button>
            </div>
          )}
        </div>

        {/* Bottom action sheet — sticky, always shows current player + active phase content */}
        <div className="relative z-30 shrink-0 border-t border-white/10 bg-gradient-to-t from-black/95 to-black/85 backdrop-blur-md">
          {/* Drawer toggle bar */}
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/5 px-1.5 py-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {combatControlsSlot && (
              <div className="flex shrink-0 items-center gap-1">{combatControlsSlot}</div>
            )}
            <button
              type="button"
              onClick={() => setOpenDrawer((d) => (d === "party" ? null : "party"))}
              className={cn(
                "shrink-0 rounded border px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-wide",
                openDrawer === "party"
                  ? "border-blue-400/40 bg-blue-500/15 text-blue-100"
                  : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10",
              )}
            >
              Party
            </button>
            {combatMechanics.length > 0 && (
              <button
                type="button"
                onClick={() => setOpenDrawer((d) => (d === "mechanics" ? null : "mechanics"))}
                className={cn(
                  "shrink-0 rounded border px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-wide",
                  openDrawer === "mechanics"
                    ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
                    : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10",
                )}
              >
                Mech · {combatMechanics.length}
              </button>
            )}
            {visibleCombatDialogue.length > 0 && (
              <button
                type="button"
                onClick={() => setOpenDrawer((d) => (d === "cues" ? null : "cues"))}
                className={cn(
                  "shrink-0 rounded border px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-wide",
                  openDrawer === "cues"
                    ? "border-sky-400/40 bg-sky-500/15 text-sky-100"
                    : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10",
                )}
              >
                Cues · {visibleCombatDialogue.length}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpenDrawer((d) => (d === "log" ? null : "log"))}
              className={cn(
                "shrink-0 rounded border px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-wide",
                openDrawer === "log"
                  ? "border-white/30 bg-white/15 text-white"
                  : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10",
              )}
            >
              Log
            </button>
            {turnOrder.length > 0 && (
              <span className="ml-auto shrink-0 truncate rounded bg-white/5 px-2 py-1 text-[0.55rem] font-semibold uppercase tracking-wide text-white/45">
                Next: {turnOrder[0]?.name ?? "—"}
              </span>
            )}
          </div>

          {/* Active player mini bar (shown when an action is required) */}
          {activePlayer &&
            (phase === "player-turn" ||
              phase === "skill-select" ||
              phase === "item-select" ||
              phase === "custom-action" ||
              phase === "target-select") && (
              <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-3 py-1.5">
                <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/40">
                  {(() => {
                    const spriteKind = resolveSpriteKind(activePlayer.sprite);
                    if (spriteKind.kind === "url") {
                      return (
                        <img
                          src={spriteKind.value}
                          alt={activePlayer.name}
                          className="h-full w-full object-cover"
                        />
                      );
                    }
                    if (spriteKind.kind === "emoji") {
                      return <span className="text-base leading-none">{spriteKind.value}</span>;
                    }
                    return <span className="text-[0.65rem] font-bold">{activePlayer.name.charAt(0).toUpperCase()}</span>;
                  })()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-white">{activePlayer.name}</div>
                  <div className="text-[0.55rem] tabular-nums text-white/45">
                    HP {activePlayer.hp}/{activePlayer.maxHp}
                    {activePlayer.maxMp ? ` · MP ${activePlayer.mp ?? 0}/${activePlayer.maxMp}` : ""}
                  </div>
                </div>
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-amber-200">
                  Your turn
                </span>
              </div>
            )}

          {/* Phase-specific content — bounded so the action sheet never grows past ~half the screen */}
          <div className="max-h-[42svh] overflow-y-auto">
            {phase === "player-turn" && activePlayer && (
              <div className="grid grid-cols-3 gap-1.5 p-2">
                {ACTION_MENU.map((action, i) => (
                  <button
                    key={action.id}
                    onClick={() => {
                      setActionMenuIndex(i);
                      handleActionSelect(action.id);
                    }}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[0.65rem] font-medium transition-all duration-150",
                      actionMenuIndex === i
                        ? "border-[var(--primary)]/50 bg-[var(--primary)]/20 text-white"
                        : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <action.icon size={16} className={action.color} />
                    {action.label}
                  </button>
                ))}
              </div>
            )}

            {phase === "skill-select" && activePlayer && (
              <div className="flex flex-col gap-2 p-2">
                <div className="flex items-center gap-2">
                  <Sparkles size={13} className="text-blue-400" />
                  <div className="text-[0.65rem] text-white/60">
                    Pick a skill, then a target. Greyed out = not enough MP.
                  </div>
                </div>
                {activePlayer.skills && activePlayer.skills.length > 0 ? (
                  <div className="grid grid-cols-1 gap-1.5">
                    {activePlayer.skills.map((skill) => {
                      const insufficientMp = (activePlayer.mp ?? 0) < skill.mpCost;
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          disabled={insufficientMp}
                          onClick={() => {
                            setSelectedSkillId(skill.id);
                            setSelectedItemName(null);
                            setPhase("target-select");
                          }}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-all",
                            insufficientMp
                              ? "cursor-not-allowed border-white/10 bg-white/5 text-white/30"
                              : "border-blue-400/20 bg-blue-500/10 text-white/85 hover:border-blue-400/40 hover:bg-blue-500/15",
                          )}
                        >
                          <span className="min-w-0 truncate font-semibold text-white/90">{skill.name}</span>
                          <span className="shrink-0 text-[0.6rem] tabular-nums text-white/45">
                            {skill.type === "heal" ? "Heal" : "Atk"} · {skill.mpCost} MP
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/45">
                    No combat skills are available for this combatant.
                  </div>
                )}
                <button
                  onClick={() => {
                    setPhase("player-turn");
                    setSelectedAction(null);
                    setSelectedSkillId(null);
                    setSelectedItemName(null);
                  }}
                  className="self-start rounded border border-white/15 px-2 py-0.5 text-[0.65rem] text-white/60 hover:bg-white/10 hover:text-white"
                >
                  Back
                </button>
              </div>
            )}

            {phase === "item-select" && activePlayer && (
              <div className="flex flex-col gap-2 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Backpack size={13} className="text-green-400" />
                    <span className="text-[0.65rem] text-white/60">Pick an item to use this turn.</span>
                  </div>
                  {onOpenInventory && (
                    <button
                      type="button"
                      onClick={onOpenInventory}
                      className="rounded border border-white/15 px-2 py-0.5 text-[0.6rem] text-white/60 hover:bg-white/10 hover:text-white"
                    >
                      Full inventory
                    </button>
                  )}
                </div>
                {inventoryItems.length > 0 ? (
                  <div className="grid grid-cols-1 gap-1.5">
                    {inventoryItems.map((item) => {
                      const itemEffect = getCombatItemEffect(item.name, combatItemEffects);
                      return (
                        <button
                          key={item.name}
                          type="button"
                          onClick={() => handleItemSelect(item.name)}
                          className="rounded-lg border border-green-400/20 bg-green-500/10 px-3 py-2 text-left text-xs text-white/85 transition-all hover:border-green-400/40 hover:bg-green-500/15"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate font-semibold text-white/90">{item.name}</span>
                            {item.quantity > 1 && (
                              <span className="shrink-0 rounded-full bg-white/10 px-1.5 text-[0.55rem] tabular-nums text-white/60">
                                x{item.quantity}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-[0.6rem] text-white/45">
                            {itemEffect?.description || item.description || "Use on the active party member."}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/45">
                    No items are available in your inventory.
                  </div>
                )}
                <button
                  onClick={() => {
                    setPhase("player-turn");
                    setSelectedAction(null);
                    setSelectedSkillId(null);
                    setSelectedItemName(null);
                  }}
                  className="self-start rounded border border-white/15 px-2 py-0.5 text-[0.65rem] text-white/60 hover:bg-white/10 hover:text-white"
                >
                  Back
                </button>
              </div>
            )}

            {phase === "custom-action" && activePlayer && (
              <div className="flex flex-col gap-2 p-2">
                <div className="flex items-center gap-2">
                  <Zap size={13} className="text-violet-300" />
                  <span className="text-[0.65rem] text-white/60">
                    Describe what you attempt; the GM resolves it.
                  </span>
                </div>
                <textarea
                  value={customInstruction}
                  onChange={(event) => setCustomInstruction(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setPhase("player-turn");
                      setSelectedAction(null);
                      setSelectedItemName(null);
                      setCustomInstruction("");
                    }
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      submitCustomInstruction();
                    }
                  }}
                  className="min-h-20 w-full resize-none rounded-lg border border-violet-300/20 bg-violet-500/10 px-2.5 py-2 text-sm leading-relaxed text-white/85 outline-none transition-colors placeholder:text-white/35 focus:border-violet-300/45"
                  placeholder="I kick sand into the Ruin Guard's cracked lens, trying to blind it for a round."
                  autoFocus
                />
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={submitCustomInstruction}
                    disabled={!customInstruction.trim() || !onCustomInstruction}
                    className="rounded-lg border border-violet-300/25 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-100 transition-colors hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Ask GM
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPhase("player-turn");
                      setSelectedAction(null);
                      setSelectedItemName(null);
                      setCustomInstruction("");
                    }}
                    className="rounded border border-white/15 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}

            {phase === "target-select" && (
              <div className="flex flex-col gap-2 px-3 py-2">
                <div className="flex items-start gap-2">
                  <Zap size={13} className="mt-0.5 shrink-0 text-amber-400" />
                  <AnimatedText
                    html={
                      selectedAction === "skill" && selectedSkill
                        ? `Tap a ${selectingAllyTarget ? "party member" : "target"} for ${selectedSkill.name}...`
                        : selectedAction === "item" && selectedItemName
                          ? `Tap a ${selectingAllyTarget ? "party member" : "target"} for ${selectedItemName}...`
                          : "Tap a target..."
                    }
                    className="min-w-0 break-words text-xs text-amber-200 [overflow-wrap:anywhere]"
                  />
                </div>
                {selectingAllyTarget && (
                  <div className="grid grid-cols-1 gap-1.5">
                    {party.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        disabled={member.hp <= 0}
                        onClick={() => handleTargetSelect(member.id)}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs",
                          member.hp <= 0
                            ? "cursor-not-allowed border-white/10 bg-white/5 text-white/30"
                            : "border-blue-400/30 bg-blue-500/10 text-white/85 hover:bg-blue-500/15",
                        )}
                      >
                        <span className="min-w-0 truncate font-semibold">{member.name}</span>
                        <span className="shrink-0 text-[0.6rem] tabular-nums text-white/55">
                          HP {member.hp}/{member.maxHp}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => {
                    setPhase(
                      selectedAction === "skill"
                        ? "skill-select"
                        : selectedAction === "item"
                          ? "item-select"
                          : "player-turn",
                    );
                    if (selectedAction !== "skill" && selectedAction !== "item") {
                      setSelectedAction(null);
                      setSelectedSkillId(null);
                      setSelectedItemName(null);
                    }
                  }}
                  className="self-start rounded border border-white/15 px-2 py-0.5 text-[0.65rem] text-white/60 hover:bg-white/10 hover:text-white"
                >
                  Back
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Slide-up drawer */}
        {openDrawer && (
          <div
            className="absolute inset-0 z-40 flex flex-col bg-black/55 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setOpenDrawer(null)}
          >
            <div className="mt-auto" />
            <div
              className="relative max-h-[60svh] min-h-[20svh] overflow-y-auto rounded-t-xl border-t border-white/10 bg-gradient-to-t from-black/95 to-black/90 px-3 py-3 animate-in slide-in-from-bottom-4 duration-200"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-white/65">
                  {openDrawer === "party" && "Party"}
                  {openDrawer === "mechanics" && "Boss Mechanics"}
                  {openDrawer === "cues" && "Dialogue"}
                  {openDrawer === "log" && "Combat Log"}
                </div>
                <button
                  type="button"
                  onClick={() => setOpenDrawer(null)}
                  className="rounded p-1 text-white/55 hover:bg-white/10 hover:text-white"
                  aria-label="Close drawer"
                >
                  <X size={14} />
                </button>
              </div>
              {openDrawer === "party" && (
                <div className="grid grid-cols-2 gap-2">
                  {party.map((member, i) => (
                    <CombatantCard
                      key={member.id}
                      combatant={member}
                      side="player"
                      isTargetable={phase === "target-select" && selectingAllyTarget}
                      isActive={
                        (phase === "player-turn" && i === activePlayerIndex) ||
                        (turnOrder[0]?.id === member.id && phase === "animating")
                      }
                      onSelect={
                        phase === "target-select" && selectingAllyTarget
                          ? () => {
                              handleTargetSelect(member.id);
                              setOpenDrawer(null);
                            }
                          : undefined
                      }
                      damagePopups={damagePopups.filter((p) => p.targetId === member.id)}
                    />
                  ))}
                </div>
              )}
              {openDrawer === "mechanics" && (
                <CombatMechanicsPanel mechanics={combatMechanics} round={round} />
              )}
              {openDrawer === "cues" && (
                <CombatDialoguePanel lines={visibleCombatDialogue} voiceableSpeakers={voicedCombatSpeakerSet} />
              )}
              {openDrawer === "log" && (
                <div className="space-y-1 pr-1">
                  {combatLogEntries.length === 0 ? (
                    <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[0.65rem] text-white/45">
                      No combat events recorded yet.
                    </div>
                  ) : (
                    combatLogEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className={cn(
                          "min-w-0 break-words rounded border px-2 py-1 text-xs leading-relaxed [overflow-wrap:anywhere]",
                          entry.tone === "system" && "border-white/5 bg-white/[0.03] text-white/55",
                          entry.tone === "status" && "border-amber-300/10 bg-amber-500/8 text-amber-100/75",
                          (!entry.tone || entry.tone === "action") && "border-white/5 bg-black/20 text-white/75",
                        )}
                      >
                        {entry.text}
                      </div>
                    ))
                  )}
                  <div ref={combatLogEndRef} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex min-h-0 flex-col overflow-hidden">
      {/* ── Battle scene ── */}
      <div
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-hidden",
          activeImpactTone === "critical" && "game-combat-scene--critical",
          activeImpactTone === "hit" && "game-combat-scene--hit",
          activeImpactTone === "reaction" && "game-combat-scene--reaction",
        )}
      >
        {activeImpactTone && activeImpactTone !== "miss" && (
          <div
            key={`${animatingActionIndex}-${activeImpactTone}`}
            className={cn(
              "pointer-events-none absolute inset-0 z-20",
              activeImpactTone === "critical" && "game-combat-impact-flash game-combat-impact-flash--critical",
              activeImpactTone === "reaction" && "game-combat-impact-flash game-combat-impact-flash--reaction",
              activeImpactTone === "hit" && "game-combat-impact-flash",
              activeImpactTone === "heal" && "game-combat-impact-flash game-combat-impact-flash--heal",
            )}
          />
        )}

        {/* Intro overlay */}
        {phase === "intro" && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 animate-in fade-in duration-300">
            <div className="flex flex-col items-center gap-3 animate-in zoom-in-50 duration-500">
              <Sword className="h-10 w-10 text-red-400" />
              <AnimatedText html="BATTLE START" className="text-xl font-bold tracking-wide text-white" />
              <span className="text-sm text-white/60">{enemies.map((e) => e.name).join(", ")}</span>
            </div>
          </div>
        )}

        {/* ── Enemy area (top section) ── */}
        <div className="relative flex min-h-0 flex-1 items-start justify-center gap-2 overflow-hidden px-3 pt-20 sm:px-6 sm:pt-20 md:pt-24 lg:gap-4 lg:pt-20 xl:gap-6 xl:pt-6">
          {enemies.map((enemy) => (
            <CombatantCard
              key={enemy.id}
              combatant={enemy}
              side="enemy"
              isTargetable={phase === "target-select" && selectingEnemyTarget}
              isActive={turnOrder[0]?.id === enemy.id && phase === "animating"}
              onSelect={() => handleTargetSelect(enemy.id)}
              damagePopups={damagePopups.filter((p) => p.targetId === enemy.id)}
            />
          ))}
        </div>

        {/* ── Party area (bottom section) ── */}
        <div className="relative flex shrink-0 items-end justify-center gap-2 overflow-hidden px-3 pb-3 sm:px-6 sm:pb-4 lg:gap-4 xl:gap-6">
          {party.map((member, i) => (
            <CombatantCard
              key={member.id}
              combatant={member}
              side="player"
              isTargetable={phase === "target-select" && selectingAllyTarget}
              isActive={
                (phase === "player-turn" && i === activePlayerIndex) ||
                (turnOrder[0]?.id === member.id && phase === "animating")
              }
              onSelect={
                phase === "target-select" && selectingAllyTarget ? () => handleTargetSelect(member.id) : undefined
              }
              damagePopups={damagePopups.filter((p) => p.targetId === member.id)}
            />
          ))}
        </div>
      </div>

      {visibleCombatDialogue.length > 0 && phase !== "intro" && (
        <CombatDialoguePanel lines={visibleCombatDialogue} voiceableSpeakers={voicedCombatSpeakerSet} />
      )}

      {combatMechanics.length > 0 && phase !== "intro" && (
        <CombatMechanicsPanel mechanics={combatMechanics} round={round} />
      )}

      {(combatControlsSlot || phase !== "intro") && (
        <div className="relative z-30 flex shrink-0 items-center justify-between gap-2 px-3 pb-1.5 sm:px-4 sm:pb-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">{combatControlsSlot}</div>
          {phase !== "intro" && (
            <div className="shrink-0 rounded-lg border border-white/10 bg-black/65 px-2.5 py-1 text-center shadow-lg backdrop-blur-md">
              <div className="text-[0.55rem] font-semibold uppercase tracking-widest text-white/40">Round</div>
              <div className="text-lg font-bold leading-none tabular-nums text-white">{round}</div>
            </div>
          )}
        </div>
      )}

      {turnOrder.length > 0 && phase !== "intro" && (
        <div className="relative z-30 shrink-0 border-y border-white/10 bg-black/60 px-3 py-1.5 backdrop-blur-md sm:px-4">
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="mr-1 shrink-0 text-[0.6rem] font-semibold uppercase tracking-widest text-white/50">
              Turn
            </span>
            {turnOrder.map((entry, i) => {
              const isParty = party.some((p) => p.id === entry.id);
              return (
                <div
                  key={`${entry.id}-${i}`}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-medium transition-all",
                    i === 0
                      ? "bg-amber-500/30 text-amber-200 ring-1 ring-amber-400/40"
                      : isParty
                        ? "bg-blue-500/15 text-blue-300/80"
                        : "bg-red-500/15 text-red-300/80",
                  )}
                >
                  <ChevronRight size={10} className={i === 0 ? "text-amber-400" : "opacity-0"} />
                  <span className="max-w-28 truncate sm:max-w-40">{entry.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Bottom panel: Action menu / Narration ── */}
      <div className="relative z-20 max-h-[52svh] shrink-0 overflow-y-auto border-t border-white/10 bg-gradient-to-t from-black/90 to-black/70 backdrop-blur-md sm:max-h-none">
        {/* Resolving / animating state */}
        {(phase === "resolving" || phase === "animating") && (
          <div className="flex flex-col gap-2 px-4 py-3">
            {phase === "resolving" && (
              <div className="flex items-center gap-2 text-sm text-white/60">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                {selectedAction === "custom"
                  ? "The Game Master is adjudicating your maneuver..."
                  : "Resolving actions..."}
              </div>
            )}
            {phase === "animating" && roundResult && animatingActionIndex >= 0 && (
              <ActionNarration action={roundResult.actions[animatingActionIndex]!} allCombatants={allCombatants} />
            )}
          </div>
        )}

        {/* Player turn: action menu */}
        {phase === "player-turn" && activePlayer && (
          <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-end sm:gap-4">
            {/* Active character indicator */}
            <div className="mb-1 flex items-center gap-2 sm:mb-0 sm:min-w-[140px]">
              <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-blue-500/20 text-blue-300 ring-1 ring-blue-400/40">
                {(() => {
                  const spriteKind = resolveSpriteKind(activePlayer.sprite);
                  if (spriteKind.kind === "url") {
                    return (
                      <img
                        src={spriteKind.value}
                        alt={activePlayer.name}
                        className="h-full w-full object-cover"
                      />
                    );
                  }
                  if (spriteKind.kind === "emoji") {
                    return <span className="text-lg leading-none">{spriteKind.value}</span>;
                  }
                  return <span className="text-xs font-bold">{activePlayer.name.charAt(0).toUpperCase()}</span>;
                })()}
              </div>
              <div>
                <div className="text-xs font-semibold text-white">{activePlayer.name}</div>
                <div className="text-[0.6rem] text-white/40">Choose action</div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-1.5">
              {ACTION_MENU.map((action, i) => (
                <button
                  key={action.id}
                  onClick={() => {
                    setActionMenuIndex(i);
                    handleActionSelect(action.id);
                  }}
                  onMouseEnter={() => {
                    setActionMenuIndex(i);
                    playSfx(COMBAT_SFX.menuHover);
                  }}
                  className={cn(
                    "group flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all duration-150",
                    actionMenuIndex === i
                      ? "border-[var(--primary)]/50 bg-[var(--primary)]/20 text-white shadow-[0_0_12px_rgba(var(--primary-rgb),0.15)]"
                      : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <action.icon size={14} className={action.color} />
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === "skill-select" && activePlayer && (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-blue-400" />
              <div>
                <div className="text-xs font-semibold text-white">{activePlayer.name}'s Skills</div>
                <div className="text-[0.65rem] text-white/45">Choose a combat ability, then pick a target.</div>
              </div>
            </div>

            {activePlayer.skills && activePlayer.skills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {activePlayer.skills.map((skill) => {
                  const insufficientMp = (activePlayer.mp ?? 0) < skill.mpCost;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      disabled={insufficientMp}
                      onClick={() => {
                        setSelectedSkillId(skill.id);
                        setSelectedItemName(null);
                        setPhase("target-select");
                      }}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-xs transition-all",
                        insufficientMp
                          ? "cursor-not-allowed border-white/10 bg-white/5 text-white/30"
                          : "border-blue-400/20 bg-blue-500/10 text-white/80 hover:border-blue-400/40 hover:bg-blue-500/15",
                      )}
                    >
                      <div className="font-semibold text-white/90">{skill.name}</div>
                      <div className="mt-0.5 text-[0.65rem] text-white/45">
                        {skill.type === "heal" ? "Restores HP" : "Special attack"} • {skill.mpCost} MP
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-white/45">No combat skills are available for this combatant.</div>
            )}

            <div>
              <button
                onClick={() => {
                  setPhase("player-turn");
                  setSelectedAction(null);
                  setSelectedSkillId(null);
                  setSelectedItemName(null);
                }}
                className="rounded border border-white/15 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {phase === "item-select" && activePlayer && (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Backpack size={14} className="text-green-400" />
                <div>
                  <div className="text-xs font-semibold text-white">{activePlayer.name}'s Items</div>
                  <div className="text-[0.65rem] text-white/45">Choose an item to use this turn.</div>
                </div>
              </div>
              {onOpenInventory && (
                <button
                  type="button"
                  onClick={onOpenInventory}
                  className="rounded border border-white/15 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                >
                  Open Inventory
                </button>
              )}
            </div>

            {inventoryItems.length > 0 ? (
              <div className="grid max-h-[24svh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:max-h-44 sm:grid-cols-2 lg:grid-cols-3">
                {inventoryItems.map((item) => {
                  const itemEffect = getCombatItemEffect(item.name, combatItemEffects);
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => handleItemSelect(item.name)}
                      className="rounded-lg border border-green-400/20 bg-green-500/10 px-3 py-2 text-left text-xs text-white/80 transition-all hover:border-green-400/40 hover:bg-green-500/15"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold text-white/90">{item.name}</span>
                        {item.quantity > 1 && (
                          <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[0.6rem] tabular-nums text-white/60">
                            x{item.quantity}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[0.65rem] text-white/45">
                        {itemEffect?.description || item.description || "Use on the active party member."}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs text-white/45">
                No items are available in your inventory.
              </div>
            )}

            <div>
              <button
                onClick={() => {
                  setPhase("player-turn");
                  setSelectedAction(null);
                  setSelectedSkillId(null);
                  setSelectedItemName(null);
                }}
                className="rounded border border-white/15 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {phase === "custom-action" && activePlayer && (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-violet-300" />
              <div>
                <div className="text-xs font-semibold text-white">{activePlayer.name}'s Special Maneuver</div>
                <div className="text-[0.65rem] text-white/45">
                  Describe what you attempt; the GM can apply statuses, elemental effects, or consequences.
                </div>
              </div>
            </div>

            <textarea
              value={customInstruction}
              onChange={(event) => setCustomInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setPhase("player-turn");
                  setSelectedAction(null);
                  setSelectedItemName(null);
                  setCustomInstruction("");
                }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submitCustomInstruction();
                }
              }}
              className="min-h-24 w-full resize-none rounded-lg border border-violet-300/20 bg-violet-500/10 px-3 py-2 text-sm leading-relaxed text-white/85 outline-none transition-colors placeholder:text-white/35 focus:border-violet-300/45"
              placeholder="Example: I kick sand into the Ruin Guard's cracked lens, trying to blind it for a round."
              autoFocus
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={submitCustomInstruction}
                disabled={!customInstruction.trim() || !onCustomInstruction}
                className="rounded-lg border border-violet-300/25 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-100 transition-colors hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Ask GM
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhase("player-turn");
                  setSelectedAction(null);
                  setSelectedItemName(null);
                  setCustomInstruction("");
                }}
                className="rounded border border-white/15 px-2 py-1.5 text-xs text-white/60 hover:bg-white/10 hover:text-white"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Target selection hint */}
        {phase === "target-select" && (
          <div className="flex flex-col items-start gap-2 px-4 py-3">
            <div className="flex items-center gap-2">
              <Zap size={14} className="shrink-0 text-amber-400" />
              <AnimatedText
                html={
                  selectedAction === "skill" && selectedSkill
                    ? `Select a ${selectingAllyTarget ? "party member" : "target"} for ${selectedSkill.name}...`
                    : selectedAction === "item" && selectedItemName
                      ? `Select a ${selectingAllyTarget ? "party member" : "target"} for ${selectedItemName}...`
                      : "Select a target..."
                }
                className="min-w-0 break-words text-sm text-amber-200 [overflow-wrap:anywhere]"
              />
            </div>
            <button
              onClick={() => {
                setPhase(
                  selectedAction === "skill"
                    ? "skill-select"
                    : selectedAction === "item"
                      ? "item-select"
                      : "player-turn",
                );
                if (selectedAction !== "skill" && selectedAction !== "item") {
                  setSelectedAction(null);
                  setSelectedSkillId(null);
                  setSelectedItemName(null);
                }
              }}
              className="rounded border border-white/15 px-2 py-0.5 text-xs text-white/60 hover:bg-white/10 hover:text-white"
            >
              Back
            </button>
          </div>
        )}

        {/* Victory overlay */}
        {phase === "victory" && (
          <div className="flex flex-col items-center gap-3 px-3 py-4 animate-in fade-in slide-in-from-bottom-4 duration-500 sm:px-4 sm:py-6">
            <Trophy className="h-8 w-8 text-amber-400" />
            <AnimatedText html="{bounce:Victory!}" className="text-lg font-bold text-amber-200" />
            <button
              onClick={() => onCombatEnd("victory", buildSummary("victory"))}
              className="mt-2 rounded-lg bg-amber-500/20 px-6 py-2 text-sm font-semibold text-amber-200 ring-1 ring-amber-400/30 transition-colors hover:bg-amber-500/30"
            >
              Continue
            </button>
          </div>
        )}

        {/* Defeat overlay */}
        {phase === "defeat" && (
          <div className="flex flex-col items-center gap-3 px-3 py-4 animate-in fade-in slide-in-from-bottom-4 duration-500 sm:px-4 sm:py-6">
            <SkullIcon className="h-8 w-8 text-red-400" />
            <AnimatedText html="{shake:Defeat...}" className="text-lg font-bold text-red-200" />
            <AnimatedText html="{pulse:Your party has fallen.}" className="text-xs text-white/50" />
            <button
              onClick={() => onCombatEnd("defeat", buildSummary("defeat"))}
              className="mt-2 rounded-lg bg-red-500/20 px-6 py-2 text-sm font-semibold text-red-200 ring-1 ring-red-400/30 transition-colors hover:bg-red-500/30"
            >
              Continue
            </button>
          </div>
        )}

        {/* Live combat log */}
        {combatLogEntries.length > 0 && phase !== "victory" && phase !== "defeat" && (
          <div className="border-t border-white/5 px-3 py-2 sm:px-4">
            <div className="mb-1 flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-wide text-white/40">
              <ScrollText size={11} />
              Combat Log
            </div>
            <div className="max-h-24 space-y-1 overflow-y-auto pr-1 sm:max-h-32">
              {combatLogEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    "min-w-0 break-words rounded border px-2 py-1 text-xs leading-relaxed [overflow-wrap:anywhere]",
                    entry.tone === "system" && "border-white/5 bg-white/[0.03] text-white/50",
                    entry.tone === "status" && "border-amber-300/10 bg-amber-500/8 text-amber-100/75",
                    (!entry.tone || entry.tone === "action") && "border-white/5 bg-black/20 text-white/70",
                  )}
                >
                  {entry.text}
                </div>
              ))}
              <div ref={combatLogEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function CombatDialoguePanel({
  lines,
  voiceableSpeakers,
}: {
  lines: PartyDialogueLine[];
  voiceableSpeakers: Set<string>;
}) {
  return (
    <div className="relative z-30 shrink-0 px-3 pb-1.5 sm:px-4 sm:pb-2">
      <div className="max-h-[18svh] space-y-1.5 overflow-y-auto pr-1 sm:max-h-28">
        {lines.map((line, index) => {
          const isEnemyLine = !voiceableSpeakers.has(normalizeTTSCharacterName(line.character));
          return (
            <div
              key={`${line.character}-${line.type}-${index}-${line.content}`}
              className={cn(
                "game-combat-action-bark mx-auto w-fit max-w-full rounded-xl border px-3 py-2 shadow-lg backdrop-blur-md animate-party-slide-in sm:max-w-[75%]",
                isEnemyLine
                  ? "border-red-300/20 bg-red-950/40 text-red-50/85"
                  : "border-sky-300/20 bg-sky-950/40 text-sky-50/90",
                isShoutedCombatDialogue(line) && "game-combat-action-bark--shout",
              )}
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className={cn("text-[0.6875rem] font-bold", isEnemyLine ? "text-red-200" : "text-sky-200")}>
                  {line.character}
                </span>
                {line.expression && (
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[0.55rem] font-semibold uppercase tracking-wide text-white/50">
                    {line.expression}
                  </span>
                )}
                {line.type === "whisper" && line.target && (
                  <span className="text-[0.5625rem] text-white/40">→ {line.target}</span>
                )}
              </div>
              <p
                className={cn(
                  "mt-0.5 min-w-0 whitespace-normal break-words text-xs leading-relaxed [overflow-wrap:anywhere]",
                  line.type === "thought" && "italic opacity-80",
                  line.type === "whisper" && "italic",
                )}
              >
                {line.content}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CombatMechanicsPanel({ mechanics, round }: { mechanics: CombatMechanic[]; round: number }) {
  const visibleMechanics = mechanics.filter((mechanic) => mechanic.name?.trim() && mechanic.description?.trim());
  if (visibleMechanics.length === 0) return null;

  return (
    <div className="relative z-30 shrink-0 px-3 pb-1.5 sm:px-4 sm:pb-2">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleMechanics.map((mechanic, index) => {
          const interval = Math.max(0, Math.floor(Number(mechanic.interval) || 0));
          const charging = mechanic.trigger === "round_interval" && interval > 0 && round % interval === 0;
          return (
            <div
              key={`${mechanic.name}-${index}`}
              className={cn(
                "min-w-[13rem] max-w-[18rem] rounded-lg border bg-black/55 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-md",
                charging ? "border-red-300/35 text-red-50" : "border-amber-300/15 text-amber-50/80",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-semibold">{mechanic.name}</span>
                {interval > 0 && (
                  <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[0.55rem] text-white/50">
                    every {interval}
                  </span>
                )}
              </div>
              <div className="mt-0.5 line-clamp-2 text-[0.65rem] leading-relaxed text-white/55">
                {charging && mechanic.counterplay ? mechanic.counterplay : mechanic.description}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Individual combatant card with HP bar, sprite, and status effects. */
function CombatantCard({
  combatant,
  side,
  isTargetable,
  isActive,
  onSelect,
  damagePopups,
}: {
  combatant: Combatant;
  side: "player" | "enemy";
  isTargetable: boolean;
  isActive: boolean;
  onSelect?: () => void;
  damagePopups: DamagePopup[];
}) {
  const hpPercent = combatant.maxHp > 0 ? (combatant.hp / combatant.maxHp) * 100 : 0;
  const mpPercent = combatant.maxMp && combatant.maxMp > 0 ? ((combatant.mp ?? 0) / combatant.maxMp) * 100 : null;
  const isKo = combatant.hp <= 0;

  const hpColor = hpPercent > 60 ? "bg-emerald-500" : hpPercent > 25 ? "bg-amber-500" : "bg-red-500";
  const hpGlow =
    hpPercent > 60 ? "shadow-emerald-500/30" : hpPercent > 25 ? "shadow-amber-500/30" : "shadow-red-500/30";
  const latestPopup = damagePopups[damagePopups.length - 1] ?? null;
  const impactTone = latestPopup
    ? latestPopup.isHeal
      ? "heal"
      : latestPopup.isMiss
        ? "miss"
        : latestPopup.reactionLabel
          ? "reaction"
          : latestPopup.isCritical
            ? "critical"
            : "hit"
    : null;

  return (
    <div className="relative flex flex-col items-center">
      {combatant.statusEffects && combatant.statusEffects.length > 0 && (
        <div className="pointer-events-none absolute -top-3 left-1/2 z-10 flex -translate-x-1/2 gap-1">
          {combatant.statusEffects.map((effect, i) => (
            <div
              key={`${effect.name}-${effect.turnsLeft}-${i}`}
              title={`${effect.name} (${effect.turnsLeft} turns)`}
              className={cn(
                "relative flex h-6 min-w-6 items-center justify-center rounded-full border px-1 text-[0.72rem] shadow-[0_4px_12px_rgba(0,0,0,0.35)] backdrop-blur-sm",
                effect.modifier > 0 ? "border-emerald-300/35 bg-emerald-500/20" : "border-rose-300/35 bg-rose-500/20",
              )}
            >
              <span aria-hidden="true">{getStatusEffectEmoji(effect)}</span>
              <span className="absolute -bottom-1 -right-1 rounded-full bg-black/80 px-1 text-[0.45rem] font-bold leading-none text-white/80">
                {effect.turnsLeft}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Damage popups */}
      {damagePopups.map((popup) => (
        <DamageNumber key={popup.id} popup={popup} />
      ))}

      {/* Combatant sprite / avatar area */}
      <button
        onClick={onSelect}
        disabled={!isTargetable || isKo}
        className={cn(
          "relative flex h-16 w-16 items-center justify-center rounded-xl border-2 transition-all duration-200 sm:h-20 sm:w-20 xl:h-24 xl:w-24",
          isKo && "grayscale opacity-40",
          isTargetable &&
            !isKo &&
            "cursor-pointer border-amber-400/60 hover:border-amber-400 hover:shadow-[0_0_20px_rgba(251,191,36,0.2)]",
          isActive && !isKo && "border-white/40 shadow-[0_0_16px_rgba(255,255,255,0.1)]",
          !isTargetable && !isActive && "border-white/10",
          side === "enemy" ? "bg-red-500/10" : "bg-blue-500/10",
          impactTone === "critical" && "game-combatant-impact--critical",
          impactTone === "hit" && "game-combatant-impact--hit",
          impactTone === "reaction" && "game-combatant-impact--reaction",
          impactTone === "heal" && "game-combatant-impact--heal",
          impactTone === "miss" && "game-combatant-impact--miss",
        )}
      >
        {/* Avatar: real image URL, LLM-suggested emoji, or initials placeholder. */}
        {(() => {
          const spriteKind = resolveSpriteKind(combatant.sprite);
          if (spriteKind.kind === "url") {
            return (
              <img
                src={spriteKind.value}
                alt={combatant.name}
                className="h-full w-full rounded-lg object-cover"
              />
            );
          }
          if (spriteKind.kind === "emoji") {
            return (
              <span className="text-2xl leading-none sm:text-3xl xl:text-4xl" aria-hidden="true">
                {spriteKind.value}
              </span>
            );
          }
          return (
            <span
              className={cn(
                "text-xl font-bold sm:text-2xl xl:text-3xl",
                side === "enemy" ? "text-red-300/60" : "text-blue-300/60",
              )}
            >
              {combatant.name.charAt(0).toUpperCase()}
            </span>
          );
        })()}

        {/* KO overlay */}
        {isKo && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
            <Skull className="h-6 w-6 text-red-400/80" />
          </div>
        )}

        {/* Targeting ring */}
        {isTargetable && !isKo && (
          <div className="absolute -inset-1 animate-pulse rounded-xl border-2 border-amber-400/40" />
        )}

        {/* Active turn indicator */}
        {isActive && !isKo && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
            <div className="h-1.5 w-6 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
          </div>
        )}
      </button>

      {/* Name + Level */}
      <div className="mt-1.5 flex max-w-24 items-center gap-1.5 xl:max-w-28">
        <span
          className={cn("truncate text-[0.68rem] font-semibold sm:text-xs", isKo ? "text-white/30" : "text-white/90")}
        >
          {combatant.name}
        </span>
        <span className="rounded-full bg-white/10 px-1.5 py-0 text-[0.55rem] tabular-nums text-white/40">
          Lv.{combatant.level}
        </span>
      </div>

      {/* HP bar */}
      <div className="mt-1 w-20 sm:w-24 xl:w-28">
        <div className="flex items-center gap-1">
          <Heart size={9} className={cn(isKo ? "text-white/20" : "text-red-400")} />
          <div className={cn("h-2 flex-1 overflow-hidden rounded-full bg-white/10", !isKo && `shadow-sm ${hpGlow}`)}>
            <div
              className={cn("h-full rounded-full transition-all duration-500 ease-out", hpColor)}
              style={{ width: `${hpPercent}%` }}
            />
          </div>
          <span className="min-w-[2.5rem] text-right text-[0.55rem] tabular-nums text-white/50">
            {combatant.hp}/{combatant.maxHp}
          </span>
        </div>

        {/* MP bar (if applicable) */}
        {mpPercent !== null && (
          <div className="mt-0.5 flex items-center gap-1">
            <Droplets size={9} className="text-blue-400" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${mpPercent}%` }}
              />
            </div>
            <span className="min-w-[2.5rem] text-right text-[0.55rem] tabular-nums text-white/40">
              {combatant.mp}/{combatant.maxMp}
            </span>
          </div>
        )}
      </div>

      {/* Element aura indicator */}
      {combatant.elementAura && (
        <div
          className="mt-0.5 rounded-full px-1.5 py-0 text-[0.5rem] font-bold uppercase tracking-wider"
          style={{
            backgroundColor: `${ELEMENT_AURA_COLORS[combatant.elementAura.element] ?? "#888"}20`,
            color: ELEMENT_AURA_COLORS[combatant.elementAura.element] ?? "#aaa",
          }}
          title={`${combatant.elementAura.element} aura (gauge: ${combatant.elementAura.gauge})`}
        >
          {combatant.elementAura.element}
        </div>
      )}
    </div>
  );
}

/**
 * Compact mobile-only combatant chip used in the top enemy strip on small viewports.
 * Single horizontal row: small avatar + name + HP bar. Designed for the mobile combat
 * layout where the full CombatantCard would push the bottom action sheet off-screen
 * once a couple of enemies are present.
 */
function MobileCombatantChip({
  combatant,
  side,
  isTargetable,
  isActive,
  onSelect,
  damagePopups,
}: {
  combatant: Combatant;
  side: "player" | "enemy";
  isTargetable: boolean;
  isActive: boolean;
  onSelect?: () => void;
  damagePopups: DamagePopup[];
}) {
  const hpPercent = combatant.maxHp > 0 ? (combatant.hp / combatant.maxHp) * 100 : 0;
  const isKo = combatant.hp <= 0;
  const hpColor = hpPercent > 60 ? "bg-emerald-500" : hpPercent > 25 ? "bg-amber-500" : "bg-red-500";
  const latestPopup = damagePopups[damagePopups.length - 1] ?? null;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!isTargetable || isKo}
      className={cn(
        "relative flex h-full min-w-[7rem] shrink-0 items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-all",
        side === "enemy" ? "bg-red-500/8" : "bg-blue-500/8",
        isTargetable && !isKo
          ? "cursor-pointer border-amber-400/55 hover:border-amber-300"
          : isActive && !isKo
            ? "border-white/35"
            : "border-white/10",
        isKo && "grayscale opacity-40",
      )}
    >
      <div
        className={cn(
          "relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md",
          side === "enemy" ? "bg-red-500/15 text-red-300/65" : "bg-blue-500/15 text-blue-300/65",
        )}
      >
        {(() => {
          const spriteKind = resolveSpriteKind(combatant.sprite);
          if (spriteKind.kind === "url") {
            return <img src={spriteKind.value} alt={combatant.name} className="h-full w-full object-cover" />;
          }
          if (spriteKind.kind === "emoji") {
            return (
              <span className="text-lg leading-none" aria-hidden="true">
                {spriteKind.value}
              </span>
            );
          }
          return <span className="text-sm font-bold">{combatant.name.charAt(0).toUpperCase()}</span>;
        })()}
        {isKo && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55">
            <Skull className="h-4 w-4 text-red-400/80" />
          </div>
        )}
        {latestPopup && (
          <div className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2">
            <DamageNumber popup={latestPopup} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1">
          <span
            className={cn(
              "min-w-0 truncate text-[0.65rem] font-semibold",
              isKo ? "text-white/30" : "text-white/90",
            )}
          >
            {combatant.name}
          </span>
          <span className="rounded bg-white/10 px-1 text-[0.5rem] tabular-nums text-white/45">
            Lv.{combatant.level}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1">
          <Heart size={8} className={cn(isKo ? "text-white/20" : "text-red-400")} />
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className={cn("h-full rounded-full transition-all duration-500 ease-out", hpColor)}
              style={{ width: `${hpPercent}%` }}
            />
          </div>
          <span className="shrink-0 text-[0.5rem] tabular-nums text-white/55">
            {combatant.hp}
          </span>
        </div>
        {combatant.statusEffects && combatant.statusEffects.length > 0 && (
          <div className="mt-0.5 flex gap-0.5 overflow-hidden">
            {combatant.statusEffects.slice(0, 4).map((effect, i) => (
              <span
                key={`${effect.name}-${i}`}
                title={`${effect.name} (${effect.turnsLeft} turns)`}
                className="text-[0.6rem]"
                aria-hidden="true"
              >
                {getStatusEffectEmoji(effect)}
              </span>
            ))}
          </div>
        )}
      </div>
      {isTargetable && !isKo && (
        <div className="pointer-events-none absolute -inset-0.5 animate-pulse rounded-lg border border-amber-400/60" />
      )}
      {isActive && !isKo && (
        <div className="pointer-events-none absolute -bottom-0.5 left-1/2 h-1 w-5 -translate-x-1/2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
      )}
    </button>
  );
}

/** Floating damage number animation. */
function DamageNumber({ popup }: { popup: DamagePopup }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute -top-4 left-1/2 z-50 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-300",
        "text-sm font-bold tabular-nums drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]",
        popup.isMiss
          ? "text-gray-400"
          : popup.reactionLabel
            ? "text-lg text-amber-200"
            : popup.isCritical
              ? "text-lg text-amber-300"
              : popup.isHeal
                ? "text-emerald-400"
                : "text-red-300",
      )}
      style={{
        animation: `combat-damage-float ${DAMAGE_DISPLAY_MS}ms ease-out forwards`,
      }}
    >
      {popup.reactionLabel && (
        <div className="mb-0.5 text-center text-[0.6rem] font-bold uppercase tracking-wider text-yellow-300/90 drop-shadow-[0_0_8px_rgba(253,224,71,0.5)]">
          {popup.reactionLabel}
        </div>
      )}
      {popup.isMiss ? "MISS" : popup.isCritical ? `${popup.amount}!` : popup.amount}
    </div>
  );
}

function formatCombatActionNarration(action: CombatAttackResult, allCombatants: Combatant[]): string {
  const attacker = allCombatants.find((c) => c.id === action.attackerId);
  const defender = allCombatants.find((c) => c.id === action.defenderId);
  const attackerName = attacker?.name ?? "???";
  const defenderName = defender?.name ?? "???";

  let text: string;
  if (action.isMiss) {
    text = action.skillName
      ? `${attackerName} uses ${action.skillName} on ${defenderName} — but it misses!`
      : `${attackerName} attacks ${defenderName} — but misses!`;
  } else if (action.isHeal) {
    text = action.skillName
      ? `${attackerName} uses ${action.skillName} on ${defenderName}, restoring ${action.finalDamage} HP.`
      : `${attackerName} restores ${action.finalDamage} HP to ${defenderName}.`;
  } else if (action.reaction) {
    text = action.skillName
      ? `${attackerName} uses ${action.skillName} and triggers ${action.reaction.reaction} on ${defenderName} for ${action.finalDamage} damage (${action.reaction.damageMultiplier}x)!`
      : `${attackerName} triggers ${action.reaction.reaction} on ${defenderName} for ${action.finalDamage} damage (${action.reaction.damageMultiplier}x)!`;
  } else if (action.isCritical) {
    text = action.skillName
      ? `${attackerName} lands a CRITICAL ${action.skillName} on ${defenderName} for ${action.finalDamage} damage!`
      : `${attackerName} lands a CRITICAL HIT on ${defenderName} for ${action.finalDamage} damage!`;
  } else if (action.skillName) {
    text = `${attackerName} uses ${action.skillName} on ${defenderName} for ${action.finalDamage} damage.`;
  } else {
    text = `${attackerName} strikes ${defenderName} for ${action.finalDamage} damage.`;
  }

  if (action.isKo) {
    text += ` ${defenderName} is defeated!`;
  }

  return text;
}

function getCombatImpactTone(action: CombatAttackResult): CombatImpactTone {
  if (action.isHeal) return "heal";
  if (action.isMiss) return "miss";
  if (action.reaction) return "reaction";
  if (action.isCritical || action.isKo) return "critical";
  return "hit";
}

/** Narration text for an individual combat action. */
function ActionNarration({ action, allCombatants }: { action: CombatAttackResult; allCombatants: Combatant[] }) {
  const text = formatCombatActionNarration(action, allCombatants);
  const tone = getCombatImpactTone(action);

  return (
    <div
      className={cn(
        "game-combat-action-bark flex min-w-0 max-w-full items-start gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg backdrop-blur-md",
        tone === "critical" && "game-combat-action-bark--shout border-red-300/30 bg-red-500/15",
        tone === "reaction" && "game-combat-action-bark--shout border-amber-200/30 bg-amber-500/15",
        tone === "heal" && "border-emerald-300/20 bg-emerald-500/10",
        tone === "miss" && "border-white/10 bg-white/5",
        tone === "hit" && "border-white/10 bg-black/30",
      )}
    >
      <Sword
        size={14}
        className={cn(
          "mt-0.5 shrink-0",
          tone === "critical" && "text-red-300",
          tone === "reaction" && "text-amber-200",
          tone === "heal" && "text-emerald-300",
          tone === "miss" && "text-white/40",
          tone === "hit" && "text-red-400",
        )}
      />
      <AnimatedText
        html={text}
        className={cn(
          "min-w-0 flex-1 break-words leading-relaxed text-white/80 [overflow-wrap:anywhere]",
          tone === "critical" && "font-bold text-red-50",
          tone === "reaction" && "font-bold text-amber-50",
          tone === "heal" && "text-emerald-50",
        )}
      />
    </div>
  );
}
