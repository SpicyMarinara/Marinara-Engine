// ──────────────────────────────────────────────
// Game: Narration Area (VN-style segmented box)
// ──────────────────────────────────────────────
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type ReactNode,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import DOMPurify from "dompurify";
import {
  MessageCircle,
  RefreshCw,
  ScrollText,
  X,
  Package,
  Copy,
  Pencil,
  Check,
  Play,
  Pause,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  Loader2,
  Wand2,
  RotateCcw,
} from "lucide-react";
import { cn, copyToClipboard, getAvatarCropStyle, type AvatarCrop, type LegacyAvatarCrop } from "../../lib/utils";
import { findNamedMapValue } from "../../lib/game-character-name-match";
import type { GameSegmentEdit } from "../../lib/game-segment-edits";
import { parseGmTags, stripGmTagsKeepReadables } from "../../lib/game-tag-parser";
import { audioManager } from "../../lib/game-audio";
import {
  DIALOGUE_QUOTE_CAPTURE_GROUP_PATTERN_SOURCE,
  HTML_SAFE_DIALOGUE_QUOTE_PATTERN_SOURCE,
  stripSurroundingDialogueQuotes,
} from "../../lib/dialogue-quotes";
import type { SpriteInfo } from "../../hooks/use-characters";
import { useTranslate } from "../../hooks/use-translate";
import { useTTSConfig } from "../../hooks/use-tts";
import { useApplyRegex } from "../../hooks/use-apply-regex";
import { useGameAssetStore } from "../../stores/game-asset.store";
import { useGameModeStore } from "../../stores/game-mode.store";
import { useUIStore } from "../../stores/ui.store";
import { createMessageMacroResolver, findCharacterByName } from "../../lib/chat-macros";
import { animateTextHtml } from "./AnimatedText";
import { ttsService } from "../../lib/tts-service";
import { getOrCreateCachedTTSAudioBlob } from "../../lib/tts-audio-cache";
import { resolveTTSVoiceForSpeaker, splitTTSChunks, ttsConfigMatchesSpeaker } from "../../lib/tts-dialogue";
import type { PartyDialogueLine, Message, TTSConfig, GameNpc, SkillCheckResult } from "@marinara-engine/shared";
import type { CharacterMap, PersonaInfo } from "../chat/chat-area.types";

/** Build inline style for a color that may be a plain color or a CSS gradient. */
function nameColorStyle(color?: string): CSSProperties | undefined {
  if (!color) return undefined;
  if (color.includes("gradient(")) {
    return {
      backgroundImage: color,
      backgroundRepeat: "no-repeat",
      backgroundSize: "100% 100%",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
      color: "transparent",
      display: "inline-block",
    };
  }
  return { color };
}

function normalizeSpriteExpressionKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^full_/, "")
    .replace(/[_\s-]+/g, "_");
}

const GAME_TTS_EMOTIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "scared",
  "disgusted",
  "thinking",
  "laughing",
  "crying",
  "blushing",
  "smirk",
  "embarrassed",
  "determined",
  "confused",
  "sleepy",
] as const;

type GameTtsEmotion = (typeof GAME_TTS_EMOTIONS)[number];

const GAME_TTS_EMOTION_SET = new Set<string>(GAME_TTS_EMOTIONS);

const GAME_TTS_EMOTION_ALIASES: Record<string, GameTtsEmotion> = {
  afraid: "scared",
  anger: "angry",
  amused: "laughing",
  blush: "blushing",
  confused_look: "confused",
  confusion: "confused",
  cry: "crying",
  determined_look: "determined",
  disgust: "disgusted",
  drowsy: "sleepy",
  embarrassed_smile: "embarrassed",
  fear: "scared",
  fearful: "scared",
  flustered: "blushing",
  focused: "determined",
  grin: "happy",
  joyful: "happy",
  laugh: "laughing",
  nervous: "scared",
  pensive: "thinking",
  puzzled: "confused",
  sad_look: "sad",
  sadness: "sad",
  serious: "determined",
  shocked: "surprised",
  shy: "blushing",
  sleep: "sleepy",
  sleepy_eyes: "sleepy",
  smile: "happy",
  smirking: "smirk",
  sobbing: "crying",
  startled: "surprised",
  surprise: "surprised",
  think: "thinking",
  tired: "sleepy",
  worried: "scared",
};

function normalizeGameTtsEmotion(value?: string | null): GameTtsEmotion | null {
  const normalized = value ? normalizeSpriteExpressionKey(value) : "";
  if (!normalized) return null;
  if (GAME_TTS_EMOTION_SET.has(normalized)) return normalized as GameTtsEmotion;
  if (GAME_TTS_EMOTION_ALIASES[normalized]) return GAME_TTS_EMOTION_ALIASES[normalized];

  const parts = normalized.split("_").filter(Boolean);
  for (const part of parts) {
    if (GAME_TTS_EMOTION_SET.has(part)) return part as GameTtsEmotion;
    if (GAME_TTS_EMOTION_ALIASES[part]) return GAME_TTS_EMOTION_ALIASES[part];
  }

  return null;
}

function resolveGameSegmentTtsEmotion(segment: NarrationSegment): GameTtsEmotion {
  return normalizeGameTtsEmotion(segment.sprite) ?? (segment.partyType === "thought" ? "thinking" : "neutral");
}

const PARTY_TYPE_ICONS: Record<string, string> = {
  side: "💬",
  extra: "💬",
  thought: "💭",
  whisper: "🤫",
};

const GAME_DIALOGUE_AVATAR_CLASS =
  "h-[calc(4rem*var(--game-avatar-scale))] w-[calc(4rem*var(--game-avatar-scale))] max-h-[min(8.5rem,32vw)] max-w-[min(8.5rem,32vw)] rounded-xl border-2 border-white/15 shadow-xl sm:h-[calc(5rem*var(--game-avatar-scale))] sm:w-[calc(5rem*var(--game-avatar-scale))] sm:max-h-[min(9.5rem,26vw)] sm:max-w-[min(9.5rem,26vw)]";

type NarrationMessage = Pick<Message, "id" | "chatId" | "role" | "content" | "characterId" | "extra"> & {
  characterName?: string;
};

const APPROX_MESSAGE_TOKEN_OVERHEAD = 4;

function estimateTextTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const wordEstimate = trimmed.split(/\s+/).filter(Boolean).length * 1.3;
  const charEstimate = trimmed.length / 4;
  return Math.ceil(Math.max(wordEstimate, charEstimate));
}

function estimateMessageTokenCount(message: NarrationMessage): number {
  const stored = message.extra?.tokenCount;
  if (typeof stored === "number" && Number.isFinite(stored) && stored > 0) return stored;
  const textTokens = estimateTextTokenCount(message.content);
  return textTokens > 0 ? textTokens + APPROX_MESSAGE_TOKEN_OVERHEAD : 0;
}

function estimateSessionHistoryTokens(messages: NarrationMessage[]): number {
  let startIndex = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.extra?.isConversationStart) {
      startIndex = i;
      break;
    }
  }
  return messages.slice(startIndex).reduce((total, message) => total + estimateMessageTokenCount(message), 0);
}

function formatTokenEstimate(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}m`;
  if (tokens >= 10_000) return `${Math.round(tokens / 1_000)}k`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return tokens.toLocaleString();
}

interface NarrationSegment {
  id: string;
  type: "narration" | "dialogue" | "readable" | "system";
  speaker?: string;
  sprite?: string;
  content: string;
  color?: string;
  sourceMessageId?: string | null;
  sourceSegmentIndex?: number | null;
  sourceRole?: Message["role"] | null;
  /** Party dialogue delivery subtype for visual styling */
  partyType?: "main" | "side" | "extra" | "action" | "thought" | "whisper";
  /** Whisper target character */
  whisperTarget?: string;
  /** Readable subtype (note or book) — only set when type === "readable" */
  readableType?: "note" | "book";
  /** Full readable content for overlay display — only set when type === "readable" */
  readableContent?: string;
}

function narrationSegmentAnchorKey(segment: NarrationSegment): string {
  if (segment.sourceMessageId && segment.sourceSegmentIndex != null) {
    return `${segment.sourceMessageId}:${segment.sourceSegmentIndex}`;
  }
  if (segment.sourceMessageId) return `${segment.sourceMessageId}:${segment.id}`;
  return segment.id;
}

type SpeakerAvatarInfo = {
  url: string;
  crop?: AvatarCrop | LegacyAvatarCrop | null;
  nameColor?: string;
  dialogueColor?: string;
};

type GameSegmentVoiceEntry =
  | { status: "loading"; speaker?: string; tone?: string; voice?: string; chunks: string[] }
  | { status: "ready"; speaker?: string; tone?: string; voice?: string; chunks: string[]; urls: string[] }
  | { status: "error"; speaker?: string; tone?: string; voice?: string; chunks: string[] };

interface GameSegmentVoiceRequest {
  speaker?: string;
  tone?: string;
  voice?: string;
  chunks: string[];
}

type GameSideLine = PartyDialogueLine & {
  voiceSourceMessageId?: string | null;
  voiceSourceSegmentIndex?: number | null;
  voiceSourceRole?: Message["role"] | null;
};

const EMPTY_GAME_SIDE_LINES: GameSideLine[] = [];
const MAX_SIDE_LINES_PER_SEGMENT = 4;

function distributeSideLinesAcrossSegments(map: Map<number, GameSideLine[]>, segmentCount: number) {
  if (segmentCount <= 0 || map.size === 0) return map;

  const distributed = new Map<number, GameSideLine[]>();
  let carry: GameSideLine[] = [];

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
    const current = map.get(segmentIndex) ?? EMPTY_GAME_SIDE_LINES;
    const combined = carry.length > 0 ? [...carry, ...current] : current;
    if (combined.length === 0) {
      carry = [];
      continue;
    }

    distributed.set(segmentIndex, combined.slice(0, MAX_SIDE_LINES_PER_SEGMENT));
    carry = combined.slice(MAX_SIDE_LINES_PER_SEGMENT);
  }

  if (carry.length > 0) {
    const lastSegmentIndex = segmentCount - 1;
    distributed.set(lastSegmentIndex, [...(distributed.get(lastSegmentIndex) ?? []), ...carry]);
  }

  return distributed;
}

function isCombatResultMessage(message: NarrationMessage): boolean {
  return message.role === "user" && /\[combat_result\]/i.test(message.content || "");
}

const SYNTHETIC_GAME_START_MESSAGE_RE = /^\s*\[start(?:\s+the)?\s+game\]\s*$/i;

function isSyntheticGameStartMessage(message: Pick<NarrationMessage, "role" | "content">): boolean {
  return message.role === "user" && SYNTHETIC_GAME_START_MESSAGE_RE.test(message.content || "");
}

interface GameVoiceAudioJob {
  cacheKey: string;
  textCacheKey: string;
  chunk: string;
  speaker?: string;
  tone?: string;
  voice?: string;
}

interface GameVoiceEntryPlan {
  key: string;
  audioJobs: GameVoiceAudioJob[];
  controller: AbortController;
}

const GAME_TTS_CHUNK_ATTEMPTS = 2;

interface GameNarrationProps {
  messages: NarrationMessage[];
  isStreaming: boolean;
  characterMap: CharacterMap;
  activeCharacterIds?: string[];
  personaInfo?: PersonaInfo;
  /** Map of lowercase character name → sprite images for expression resolution */
  spriteMap?: Map<string, SpriteInfo[]>;
  /** Additional lowercase speaker name → avatar entries, e.g. matched library cards outside the party. */
  speakerAvatarMap?: Map<string, SpeakerAvatarInfo>;
  onActiveSpeakerChange?: (speaker: { name: string; avatarUrl: string; expression?: string } | null) => void;
  /** Called when the user enters a new narration segment (for segment-tied effects). Index is 0-based. */
  onSegmentEnter?: (segmentIndex: number) => void;
  /** Render prop: shown inside the narration box once the player has read all segments */
  inputSlot?: ReactNode;
  /** When true, the latest user message is shown as an animated narration/dialogue segment before the AI turn */
  showUserMessages?: boolean;
  /** Party dialogue lines rendered as overlay boxes above the narration */
  partyDialogue?: PartyDialogueLine[];
  /** The player's message that prompted the current party chat (shown in logs) */
  partyChatInput?: string | null;
  /** Real database message ID for the current party-chat response (for edit persistence) */
  partyChatMessageId?: string | null;
  /** Whether a party turn is currently being generated */
  partyTurnPending?: boolean;
  /** Whether scene effects are still being prepared (gate narration display) */
  scenePreparing?: boolean;
  /** Whether scene analysis failed (show retry/skip UI) */
  sceneAnalysisFailed?: boolean;
  /** Retry scene analysis */
  onRetryScene?: () => void;
  /** Skip scene analysis and fall back to inline tags */
  onSkipScene?: () => void;
  /** Whether the GM generation call failed */
  generationFailed?: boolean;
  /** Retry the GM generation */
  onRetryGeneration?: () => void;
  /** Whether direction effects (cinematic overlays) are currently playing */
  directionsActive?: boolean;
  /** Whether a validated saved narration position exists for the current assistant message. */
  hasStoredNarrationPosition?: boolean;
  /** The saved narration segment index to restore to */
  restoredSegmentIndex?: number;
  /** Called when the active segment index changes (for persistence) */
  onSegmentChange?: (index: number) => void;
  /**
   * Called when narration is fully complete (all segments read, not streaming).
   * `messageId` identifies which assistant message the completion refers to so the
   * caller can guard against stale narrationDone leaking from the previous turn.
   */
  onNarrationComplete?: (complete: boolean, messageId: string | null) => void;
  /** Slot rendered above the narration box (used for mobile widget icons) */
  widgetSlot?: ReactNode;
  /** Slot rendered above the narration box for GM choice cards */
  choicesSlot?: ReactNode;
  /** Slot rendered above the narration box for dice roll results */
  diceResultSlot?: ReactNode;
  /** Slot rendered above the narration box for skill check results */
  skillCheckSlot?: ReactNode;
  /** Open the inventory panel */
  onOpenInventory?: () => void;
  /** Number of items in inventory (for badge) */
  inventoryCount?: number;
  /** Open the standard delete-message flow for a backing chat message. */
  onDeleteMessage?: (messageId: string) => void;
  /** Whether the global multi-delete bar is active. */
  multiSelectMode?: boolean;
  /** Chat message ids selected for global multi-delete. */
  selectedMessageIds?: Set<string>;
  /** Hide a single non-user segment from logs/history and future game generations. */
  onDeleteSegment?: (messageId: string, segmentIndex: number) => void;
  /** Edit the backing content of a user-authored message. */
  onEditMessage?: (messageId: string, newContent: string) => void;
  /** Called when user edits a narration/dialogue segment. */
  onEditSegment?: (messageId: string, segmentIndex: number, edit: GameSegmentEdit) => void;
  /** Map of "messageId:segmentIndex" → segment overlay edits */
  segmentEdits?: Map<string, GameSegmentEdit>;
  /** Set of deleted non-user segment keys in the form "messageId:segmentIndex" */
  segmentDeletes?: Set<string>;
  /** Whether asset generation (sprites/backgrounds) is in progress */
  assetsGenerating?: boolean;
  /** Called when the player reaches a readable segment (Note/Book). Content is passed for overlay display. */
  onReadable?: (readable: {
    type: "note" | "book";
    content: string;
    sourceMessageId?: string | null;
    sourceSegmentIndex?: number | null;
  }) => void;
  /** Upload or replace a tracked NPC portrait. */
  onNpcPortraitClick?: (npcName: string) => void;
  /** Generate or replace a tracked NPC portrait through the image provider. */
  onNpcPortraitGenerate?: (npcName: string) => void;
  npcPortraitGenerationEnabled?: boolean;
  generatingNpcPortraitNames?: Set<string>;
  /** Pause auto-play while a blocking game overlay is open. */
  autoPlayBlocked?: boolean;
  /** Pause voice-over while a blocking game overlay is open. Defaults to autoPlayBlocked. */
  voicePlaybackBlocked?: boolean;
  /** Effective game-mode TTS playback volume, 0–1. */
  gameVoiceVolume?: number;
  /**
   * Player hit the "Interrupt!" button. Soft-pauses narration: the parent
   * stops generation, records the interrupt anchor, and only truncates the
   * GM message when the player actually sends their next turn. `messageId`
   * + `truncatedContent` describe what truncation *would* be applied; the
   * parent stashes them until commit (send) or cancel (Resume).
   */
  onInterruptRequest?: (info: { messageId: string | null; truncatedContent: string | null }) => void;
  /** Player hit "Resume" — discard the pending interrupt and continue narration. */
  onInterruptCancel?: () => void;
  /**
   * True while the narration is paused for an interrupt — covers both the pre-confirm
   * modal phase and the post-confirm waiting-to-send phase. Drives auto-play snapshot
   * and hides Play/Next.
   */
  interruptPending?: boolean;
  /**
   * True only after the player has confirmed (Yes or Force Interrupt). Drives the
   * Resume button and the early reveal of the chat input. While the confirmation
   * modal is open this stays false so the input bar doesn't appear behind the modal.
   */
  interruptCommitted?: boolean;
  /**
   * Wheel-nav offset: 0 means show the latest assistant turn (default). >0 picks an
   * older assistant message for review (1 = previous turn, 2 = the one before, …).
   * While >0, narration is rendered instantly (no typewriter), auto-play is suppressed,
   * and the Next button label switches to "Return".
   */
  messageOffset?: number;
  /** Step ONE log entry forward (toward the present). Bound to Next / bg-click during review. */
  onStepForward?: () => void;
  /** Jump straight back to the present in one shot. Bound to the Return button during review. */
  onJumpToLatest?: () => void;
  /**
   * Token bumped from the parent (background-click handler) when wheel-nav is enabled
   * and the player clicks the bare scene background. GameNarration interprets it as
   * a Next press at offset 0, or as a Return press at offset > 0.
   */
  nextActionToken?: number;
  /**
   * Reports the wheel-nav clamp to the parent — equal to the number of past log
   * entries available to step into. When 0, wheel-up has no past to walk into.
   */
  onMaxNavOffsetChange?: (max: number) => void;
}

/** Regex matching explicit {effect:text} tags used by AnimatedText. */
const EFFECT_TAG_RE = /\{(shake|shout|whisper|glow|pulse|wave|flicker|drip|bounce|tremble|glitch|expand):([^}]+)\}/gi;

/** Count visible characters (effect tag syntax excluded). */
function effectDisplayLength(content: string): number {
  return content.replace(EFFECT_TAG_RE, "$2").length;
}

/**
 * Slice content by visible character count while keeping {effect:text} tags
 * intact around their visible portion. This prevents the typewriter from
 * splitting a tag mid-syntax (e.g. "{shak" appearing as raw text).
 */
function slicePreservingEffects(content: string, maxVisible: number): string {
  const re = new RegExp(EFFECT_TAG_RE.source, "gi");
  let result = "";
  let visible = 0;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(content)) !== null) {
    const plain = content.slice(lastIdx, m.index);
    const room = maxVisible - visible;
    if (room <= 0) break;

    if (plain.length <= room) {
      result += plain;
      visible += plain.length;
    } else {
      result += plain.slice(0, room);
      return result;
    }

    const inner = m[2];
    const room2 = maxVisible - visible;
    if (room2 <= 0) break;

    if (inner.length <= room2) {
      result += m[0]; // full tag
      visible += inner.length;
    } else {
      result += `{${m[1]}:${inner.slice(0, room2)}}`;
      return result;
    }

    lastIdx = m.index + m[0].length;
  }

  const tail = content.slice(lastIdx);
  const room = maxVisible - visible;
  if (room > 0) {
    result += tail.slice(0, room);
  }

  return result;
}

function getGameTranslationHtml(message: NarrationMessage, translatedText: string): string {
  const content =
    message.role === "assistant" || message.role === "narrator" || message.role === "system"
      ? stripGmTagsKeepReadables(translatedText)
      : translatedText.replace(/^\[(?:To the party|To the GM)]\s*/i, "");
  return animateTextHtml(formatNarration(content.trim(), false));
}

function hashVoiceKey(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function buildVoiceConfigSignature(config?: TTSConfig | null): string {
  if (!config) return "tts:none";
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
    config.dialogueOnly ? "dialogue" : "all-text",
    config.dialogueScope,
    config.dialogueCharacterName,
  ].join("|");
}

function buildVoiceLineTextCacheKey(
  config: TTSConfig,
  job: Omit<GameVoiceAudioJob, "cacheKey" | "textCacheKey">,
): string {
  const rawKey = [
    config.source,
    config.baseUrl,
    config.model,
    config.speed,
    config.elevenLabsStability,
    config.elevenLabsLanguageCode,
    job.voice ?? "",
    job.speaker ?? "",
    job.tone ?? "",
    job.chunk,
  ].join("\n");
  return `game-voice-line-v1:${rawKey.length}:${hashVoiceKey(rawKey)}`;
}

function buildVoiceLineSegmentCacheKey(segmentVoiceKey: string, jobIndex: number, textCacheKey: string): string {
  return `game-voice-line-v3:${segmentVoiceKey}:${jobIndex}:${hashVoiceKey(textCacheKey)}`;
}

function buildGameVoiceAudioJobs(
  key: string,
  requests: GameSegmentVoiceRequest[],
  config: TTSConfig,
): GameVoiceAudioJob[] {
  let voiceJobIndex = 0;
  return requests.flatMap((request) =>
    request.chunks.map((chunk) => {
      const jobIndex = voiceJobIndex;
      voiceJobIndex += 1;
      const job = {
        chunk,
        speaker: request.speaker,
        tone: request.tone,
        voice: request.voice,
      };
      const textCacheKey = buildVoiceLineTextCacheKey(config, job);
      return {
        ...job,
        cacheKey: buildVoiceLineSegmentCacheKey(key, jobIndex, textCacheKey),
        textCacheKey,
      };
    }),
  );
}

function waitForGameTTSRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("TTS request aborted", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("TTS request aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function generateGameVoiceJobBlob(job: GameVoiceAudioJob, controller: AbortController): Promise<Blob> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= GAME_TTS_CHUNK_ATTEMPTS; attempt += 1) {
    if (controller.signal.aborted) throw new DOMException("TTS request aborted", "AbortError");
    try {
      return await getOrCreateCachedTTSAudioBlob(
        job.cacheKey,
        () =>
          ttsService.generateAudio(job.chunk, {
            speaker: job.speaker,
            tone: job.tone,
            voice: job.voice,
            signal: controller.signal,
          }),
        [job.textCacheKey],
      );
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
      lastError = err;
      if (attempt < GAME_TTS_CHUNK_ATTEMPTS) {
        await waitForGameTTSRetry(350 * attempt, controller.signal);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("TTS request failed");
}

function findNpcVoiceHint(speaker: string | null | undefined, gameNpcs: GameNpc[]) {
  const speakerName = speaker?.trim();
  if (!speakerName) return null;
  const normalizedSpeaker = speakerName.toLowerCase();
  const npc = gameNpcs.find((candidate) => candidate.name.trim().toLowerCase() === normalizedSpeaker);
  if (!npc) return { name: speakerName };
  return { name: npc.name, description: npc.description, gender: npc.gender, pronouns: npc.pronouns, notes: npc.notes };
}

type GameSegmentVoiceOptions = {
  playerSpeakerNames?: ReadonlySet<string>;
};

function normalizeGameVoiceSpeakerName(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function getGameVoicePlayerSpeakerNames(personaName: string | undefined): Set<string> {
  const names = new Set(["you", "player", "player character", "playername", "player name", "protagonist", "pc"]);
  const normalizedPersonaName = normalizeGameVoiceSpeakerName(personaName);
  if (normalizedPersonaName) names.add(normalizedPersonaName);
  return names;
}

function isGameVoicePlayerSpeaker(
  speaker: string | null | undefined,
  playerSpeakerNames: ReadonlySet<string> | undefined,
): boolean {
  const normalizedSpeaker = normalizeGameVoiceSpeakerName(speaker);
  return Boolean(normalizedSpeaker && playerSpeakerNames?.has(normalizedSpeaker));
}

function isGameVoicePlayerTaggedNarration(
  content: string,
  playerSpeakerNames: ReadonlySet<string> | undefined,
): boolean {
  if (!playerSpeakerNames?.size) return false;
  const speakerMatch = content.match(/^\s*\[([^\]]+)\](?:\s*\[[^\]]+\])?/);
  if (!speakerMatch) return false;
  return isGameVoicePlayerSpeaker(speakerMatch[1], playerSpeakerNames);
}

function shouldSkipGameVoiceSegment(segment: NarrationSegment, options: GameSegmentVoiceOptions): boolean {
  if (segment.sourceRole === "user" || segment.sourceRole === "system") return true;
  if (segment.partyType === "thought") return true;
  if (isGameVoicePlayerSpeaker(segment.speaker, options.playerSpeakerNames)) return true;
  return segment.type === "narration" && isGameVoicePlayerTaggedNarration(segment.content, options.playerSpeakerNames);
}

function getGameSegmentVoiceRequest(
  segment: NarrationSegment,
  config: TTSConfig,
  gameNpcs: GameNpc[] = [],
  options: GameSegmentVoiceOptions = {},
): GameSegmentVoiceRequest | null {
  if (shouldSkipGameVoiceSegment(segment, options)) return null;
  if (segment.type !== "dialogue" && segment.type !== "narration") return null;

  if (segment.type === "dialogue") {
    if (!ttsConfigMatchesSpeaker(config, segment.speaker)) return null;
    const chunks = splitTTSChunks(segment.content);
    if (chunks.length === 0) return null;
    const tone = resolveGameSegmentTtsEmotion(segment);
    const voice = resolveTTSVoiceForSpeaker(
      config,
      segment.speaker,
      undefined,
      findNpcVoiceHint(segment.speaker, gameNpcs),
    );
    if (config.source === "elevenlabs" && !voice) return null;
    return {
      chunks,
      speaker: segment.speaker,
      tone,
      voice,
    };
  }

  if (config.dialogueOnly) return null;
  const chunks = splitTTSChunks(segment.content);
  if (chunks.length === 0) return null;
  const voice = config.voice;
  if (config.source === "elevenlabs" && !voice) return null;
  return { chunks, voice };
}

function getGameSegmentVoiceKeyForRequests(
  segment: NarrationSegment,
  configSignature: string,
  requests: GameSegmentVoiceRequest[],
): string | null {
  if (!segment.sourceMessageId || segment.sourceSegmentIndex == null || requests.length === 0) return null;
  return `${segment.sourceMessageId}:${segment.sourceSegmentIndex}:${hashVoiceKey(configSignature)}`;
}

function getGameSideLineVoiceKeyForRequests(
  segment: NarrationSegment,
  line: GameSideLine,
  sideIndex: number,
  configSignature: string,
  requests: GameSegmentVoiceRequest[],
): string | null {
  if (requests.length === 0) return null;
  const sourceMessageId = line.voiceSourceMessageId ?? segment.sourceMessageId;
  const sourceSegmentIndex = line.voiceSourceSegmentIndex ?? segment.sourceSegmentIndex;
  if (!sourceMessageId || sourceSegmentIndex == null) return null;

  const suffix = line.voiceSourceSegmentIndex == null ? `:side:${sideIndex}` : "";
  return `${sourceMessageId}:${sourceSegmentIndex}${suffix}:${hashVoiceKey(configSignature)}`;
}

function withSegmentSource(
  segment: NarrationSegment,
  sourceMessageId: string | null,
  sourceSegmentIndex: number | null,
  sourceRole: Message["role"] | null,
): NarrationSegment {
  return { ...segment, sourceMessageId, sourceSegmentIndex, sourceRole };
}

function isDeletedSegment(
  segmentDeletes: Set<string> | undefined,
  messageId: string | null | undefined,
  segmentIndex: number | null | undefined,
): boolean {
  return !!segmentDeletes && !!messageId && segmentIndex != null && segmentDeletes.has(`${messageId}:${segmentIndex}`);
}

function applySegmentEditOverlay(
  segment: NarrationSegment,
  edit: GameSegmentEdit | undefined,
  speakerColors: Map<string, string>,
): NarrationSegment {
  if (!edit) return segment;

  let next = segment;
  if (segment.type === "readable") {
    const nextReadableContent = edit.readableContent ?? edit.content;
    if (nextReadableContent !== undefined) {
      next = { ...next, content: nextReadableContent, readableContent: nextReadableContent };
    }
  } else if (edit.content !== undefined) {
    next = { ...next, content: edit.content };
  }

  if (edit.speaker && next.type === "dialogue") {
    next = {
      ...next,
      speaker: edit.speaker,
      color: findNamedMapValue(speakerColors, edit.speaker) ?? next.color,
    };
  }

  return next;
}

function formatSkillCheckLogContent(message: NarrationMessage): NarrationSegment[] {
  const skillChecks = parseGmTags(message.content || "").skillChecks;
  if (skillChecks.length === 0) return [];

  const formatResult = (result: SkillCheckResult): string => {
    const label = result.criticalSuccess
      ? "Critical success"
      : result.criticalFailure
        ? "Critical failure"
        : result.success
          ? "Success"
          : "Failure";
    const modifier = result.modifier === 0 ? "" : ` ${result.modifier > 0 ? "+" : ""}${result.modifier}`;
    const rollMode = result.rollMode !== "normal" ? ` (${result.rollMode})` : "";
    return `${result.skill} check (DC ${result.dc}): [${result.rolls.join(", ")}]${modifier}${rollMode} = ${result.total}. ${label}.`;
  };

  return skillChecks.map((skillCheck, index) => {
    const result = skillCheck.resolvedResult;
    if (!result) {
      return {
        id: `${message.id}-skill-check-log-${index}`,
        type: "system",
        content: `${skillCheck.skill} check (DC ${skillCheck.dc})`,
      };
    }

    return {
      id: `${message.id}-skill-check-log-${index}`,
      type: "system",
      content: formatResult(result),
    };
  });
}

export function GameNarration({
  messages,
  isStreaming,
  characterMap,
  activeCharacterIds,
  personaInfo,
  spriteMap,
  speakerAvatarMap,
  onActiveSpeakerChange,
  onSegmentEnter,
  inputSlot,
  showUserMessages,
  partyDialogue,
  partyChatInput,
  partyChatMessageId,
  partyTurnPending,
  scenePreparing,
  sceneAnalysisFailed,
  onRetryScene,
  onSkipScene,
  generationFailed,
  onRetryGeneration,
  directionsActive,
  hasStoredNarrationPosition,
  restoredSegmentIndex,
  onSegmentChange,
  onNarrationComplete,
  widgetSlot,
  choicesSlot,
  diceResultSlot,
  skillCheckSlot,
  onOpenInventory,
  inventoryCount,
  onDeleteMessage,
  multiSelectMode = false,
  selectedMessageIds,
  onDeleteSegment,
  onEditMessage,
  onEditSegment,
  segmentEdits,
  segmentDeletes,
  assetsGenerating,
  onReadable,
  onNpcPortraitClick,
  onNpcPortraitGenerate,
  npcPortraitGenerationEnabled = false,
  generatingNpcPortraitNames,
  autoPlayBlocked,
  voicePlaybackBlocked,
  gameVoiceVolume = 1,
  onInterruptRequest,
  onInterruptCancel,
  interruptPending,
  interruptCommitted,
  messageOffset = 0,
  onStepForward,
  onJumpToLatest,
  nextActionToken,
  onMaxNavOffsetChange,
}: GameNarrationProps) {
  const { translations, translating } = useTranslate();
  const { applyToAIOutput } = useApplyRegex();
  const [activeIndex, setActiveIndex] = useState(0);
  const [visibleChars, setVisibleChars] = useState(0);
  const [logsOpen, setLogsOpen] = useState(false);
  const messagesPerPage = useUIStore((s) => s.messagesPerPage);
  const gameDialogueDisplayMode = useUIStore((s) => s.gameDialogueDisplayMode);
  const useStackedLogDisplay = gameDialogueDisplayMode === "stacked";
  const showLogsButton = !useStackedLogDisplay;
  const [editingContent, setEditingContent] = useState<string | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [editingLogSeg, setEditingLogSeg] = useState<{
    messageId: string;
    segIndex: number;
    content: string;
    speaker?: string;
    segmentType?: NarrationSegment["type"];
    readableType?: "note" | "book";
  } | null>(null);
  const logEditTextareaRef = useRef<HTMLTextAreaElement>(null);
  const logEditDraftRef = useRef<{ content: string; speaker?: string }>({ content: "", speaker: undefined });
  const logScrolledRef = useRef(false);
  const logScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingLogScrollAnchorRef = useRef<{ key: string; offsetTop: number; scrollTop: number } | null>(null);
  const stackedLogRef = useRef<HTMLDivElement | null>(null);
  const [stackedLogPinned, setStackedLogPinned] = useState(true);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  const segmentSourceMessageIdsRef = useRef<Array<string | null>>([]);
  const { data: ttsConfig } = useTTSConfig();
  const [gameVoiceVersion, setGameVoiceVersion] = useState(0);
  const [gameVoicePlayingKey, setGameVoicePlayingKey] = useState<string | null>(null);
  const [gameVoicePausedKey, setGameVoicePausedKey] = useState<string | null>(null);
  const gameVoiceCacheRef = useRef<Map<string, GameSegmentVoiceEntry>>(new Map());
  const gameVoicePendingRef = useRef<Map<string, AbortController>>(new Map());
  const gameVoiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const gameVoiceSequenceRef = useRef(0);
  const gameVoiceGenerationTailRef = useRef<Promise<void>>(Promise.resolve());
  const lastAutoPlayedVoiceKeyRef = useRef<string | null>(null);
  const lastAutoPlayedSideVoiceGroupRef = useRef<string | null>(null);

  // Clear edit state when the active segment changes
  useEffect(() => {
    setEditingContent(null);
  }, [activeIndex]);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current != null) {
        window.clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    },
    [],
  );

  /** Internal ref tracking the typewriter position so the RAF loop can run without
   *  visibleChars in the effect deps (avoids effect restart per character). */
  const twRef = useRef({ pos: 0 });

  // Track previous active segment so we can detect in-place edits
  const prevActiveRef = useRef<{ index: number; content?: string }>({ index: 0 });

  const activeCharacterEntries = useMemo(() => {
    if (!activeCharacterIds) return Array.from(characterMap);
    const allowedIds = new Set(activeCharacterIds);
    return Array.from(characterMap).filter(([id]) => allowedIds.has(id));
  }, [activeCharacterIds, characterMap]);

  const speakerColors = useMemo(() => {
    const byName = new Map<string, string>();
    for (const [, c] of activeCharacterEntries) {
      const color = c.dialogueColor || c.nameColor;
      if (color) byName.set(c.name.toLowerCase(), color);
    }
    if (speakerAvatarMap) {
      for (const [name, info] of speakerAvatarMap) {
        const color = info.dialogueColor || info.nameColor;
        if (color) byName.set(name.toLowerCase(), color);
      }
    }
    if (personaInfo?.name && (personaInfo.dialogueColor || personaInfo.nameColor)) {
      byName.set(personaInfo.name.toLowerCase(), personaInfo.dialogueColor || personaInfo.nameColor || "");
    }
    return byName;
  }, [activeCharacterEntries, personaInfo, speakerAvatarMap]);

  /** Name-display colors (prefers nameColor which may be a gradient). */
  const speakerNameColors = useMemo(() => {
    const byName = new Map<string, string>();
    for (const [, c] of activeCharacterEntries) {
      const color = c.nameColor || c.dialogueColor;
      if (color) byName.set(c.name.toLowerCase(), color);
    }
    if (speakerAvatarMap) {
      for (const [name, info] of speakerAvatarMap) {
        const color = info.nameColor || info.dialogueColor;
        if (color) byName.set(name.toLowerCase(), color);
      }
    }
    if (personaInfo?.name && (personaInfo.nameColor || personaInfo.dialogueColor)) {
      byName.set(personaInfo.name.toLowerCase(), personaInfo.nameColor || personaInfo.dialogueColor || "");
    }
    return byName;
  }, [activeCharacterEntries, personaInfo, speakerAvatarMap]);

  const gameNpcs = useGameModeStore((s) => s.npcs);
  const sourceMessagesById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const messageDepthById = useMemo(() => {
    const byId = new Map<string, number>();
    for (let index = messages.length - 1, depth = 0; index >= 0; index--, depth++) {
      byId.set(messages[index]!.id, depth);
    }
    return byId;
  }, [messages]);

  const speakerAvatarInfos = useMemo(() => {
    const byName = new Map<string, SpeakerAvatarInfo>();
    const setAvatarInfo = (name: string, avatarInfo: SpeakerAvatarInfo) => {
      const key = name.toLowerCase();
      const existing = byName.get(key) ?? findNamedMapValue(byName, name);
      byName.set(key, {
        url: avatarInfo.url || existing?.url || "",
        crop: avatarInfo.crop ?? existing?.crop ?? null,
      });
    };
    for (const [, c] of activeCharacterEntries) {
      if (c.avatarUrl) setAvatarInfo(c.name, { url: c.avatarUrl, crop: c.avatarCrop });
    }
    if (personaInfo?.name && personaInfo.avatarUrl) {
      setAvatarInfo(personaInfo.name, { url: personaInfo.avatarUrl });
    }
    if (speakerAvatarMap) {
      for (const [name, avatarInfo] of speakerAvatarMap) {
        if (avatarInfo.url) setAvatarInfo(name, avatarInfo);
      }
    }
    // Include tracked game NPC avatars so dialogue boxes show their portrait
    for (const npc of gameNpcs) {
      if (npc.avatarUrl) {
        setAvatarInfo(npc.name, { url: npc.avatarUrl });
      }
    }
    return byName;
  }, [activeCharacterEntries, personaInfo, speakerAvatarMap, gameNpcs]);

  const uploadableNpcNames = useMemo(
    () => new Set(gameNpcs.map((npc) => npc.name.trim().toLowerCase()).filter(Boolean)),
    [gameNpcs],
  );

  const nonNpcSpeakerNames = useMemo(() => {
    const names = new Set(["you", "player", "narrator", "gm", "game master", "system", "assistant", "story"]);
    for (const [, character] of activeCharacterEntries) {
      if (character.name.trim()) names.add(character.name.trim().toLowerCase());
    }
    if (personaInfo?.name?.trim()) names.add(personaInfo.name.trim().toLowerCase());
    return names;
  }, [activeCharacterEntries, personaInfo]);

  const playerVoiceSpeakerNames = useMemo(() => getGameVoicePlayerSpeakerNames(personaInfo?.name), [personaInfo?.name]);

  const canUploadNpcPortrait = useCallback(
    (speaker?: string | null) => {
      const speakerName = speaker?.trim();
      const normalizedSpeaker = speakerName?.toLowerCase();
      if (!speakerName || !normalizedSpeaker || !onNpcPortraitClick) return false;
      if (uploadableNpcNames.has(normalizedSpeaker)) return true;
      if (nonNpcSpeakerNames.has(normalizedSpeaker)) return false;
      return (
        speakerName.length <= 48 &&
        /^\p{Lu}/u.test(speakerName) &&
        !/[<>{}"“”]/u.test(speakerName) &&
        !speakerName.includes("[") &&
        !speakerName.includes("]")
      );
    },
    [nonNpcSpeakerNames, onNpcPortraitClick, uploadableNpcNames],
  );

  const triggerNpcPortraitUpload = useCallback(
    (speaker?: string | null) => {
      if (!speaker || !onNpcPortraitClick) return;
      const speakerName = speaker.trim();
      const normalizedSpeaker = speakerName.toLowerCase();
      if (!uploadableNpcNames.has(normalizedSpeaker) && !/^\p{Lu}/u.test(speakerName)) return;
      onNpcPortraitClick(speaker);
    },
    [onNpcPortraitClick, uploadableNpcNames],
  );

  const canGenerateNpcPortrait = useCallback(
    (speaker?: string | null) => {
      return npcPortraitGenerationEnabled && !!onNpcPortraitGenerate && canUploadNpcPortrait(speaker);
    },
    [canUploadNpcPortrait, npcPortraitGenerationEnabled, onNpcPortraitGenerate],
  );

  const triggerNpcPortraitGenerate = useCallback(
    (speaker?: string | null) => {
      if (!speaker || !canGenerateNpcPortrait(speaker)) return;
      onNpcPortraitGenerate?.(speaker);
    },
    [canGenerateNpcPortrait, onNpcPortraitGenerate],
  );

  const isNpcPortraitGenerating = useCallback(
    (speaker?: string | null) => {
      const normalized = speaker?.trim().toLowerCase();
      return !!normalized && !!generatingNpcPortraitNames?.has(normalized);
    },
    [generatingNpcPortraitNames],
  );

  const latestAssistant = useMemo(() => {
    // Newest assistant/narrator turn (independent of wheel-nav offset). Used by the
    // present-mode renderer (offset 0) and by everything keyed off "the GM's most
    // recent turn" — segment edits, voice resolution, log builders, etc.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      if (msg.role === "assistant" || msg.role === "narrator") return msg;
    }
    return null;
  }, [messages]);

  // Wheel-nav builds a flat chronological list of log entries — one per visible
  // segment (parsed narration segments for assistant turns + a single player-dialogue
  // line per user turn). Wheel-up steps backward through this list, matching the
  // order the player sees in the Logs panel.
  type FlatLogEntry =
    | { kind: "assistant"; messageId: string; segmentIndex: number; segment: NarrationSegment; role: Message["role"] }
    | { kind: "user"; messageId: string; segment: NarrationSegment };

  const flatLogEntries = useMemo<FlatLogEntry[]>(() => {
    const out: FlatLogEntry[] = [];
    for (const msg of messages) {
      if (msg.role === "system") continue;
      if (msg.role === "user") {
        if (!msg.content?.trim()) continue;
        if (isSyntheticGameStartMessage(msg)) continue;
        const playerName = personaInfo?.name || "You";
        const color = personaInfo?.dialogueColor || personaInfo?.nameColor || "#a5b4fc";
        out.push({
          kind: "user",
          messageId: msg.id,
          segment: {
            id: `${msg.id}-player`,
            type: "dialogue",
            speaker: playerName,
            content: msg.content,
            color,
            sourceMessageId: msg.id,
            sourceSegmentIndex: 0,
            sourceRole: "user",
          },
        });
        continue;
      }
      if (msg.role !== "assistant" && msg.role !== "narrator") continue;
      const segs = parseNarrationSegments(msg, speakerColors);
      for (let si = 0; si < segs.length; si++) {
        const seg = segs[si]!;
        if (isDeletedSegment(segmentDeletes, msg.id, si)) continue;
        if (seg.partyType === "side" || seg.partyType === "extra") continue;
        out.push({ kind: "assistant", messageId: msg.id, segmentIndex: si, segment: seg, role: msg.role });
      }
    }
    return out;
  }, [messages, personaInfo, speakerColors, segmentDeletes]);

  // Past-review entry the player is currently looking at. Each wheel-up bumps
  // `messageOffset`; we step back that many entries from the most recent log entry.
  const pastReviewEntry = useMemo<FlatLogEntry | null>(() => {
    if (messageOffset <= 0) return null;
    const idx = flatLogEntries.length - 1 - messageOffset;
    if (idx < 0) return null;
    return flatLogEntries[idx] ?? null;
  }, [flatLogEntries, messageOffset]);

  // Notify parent of the clamp it should enforce on wheel-up. Length-1 because the
  // newest entry is "present" (offset 0) so it isn't reachable via wheel-up.
  useEffect(() => {
    onMaxNavOffsetChange?.(Math.max(0, flatLogEntries.length - 1));
  }, [flatLogEntries.length, onMaxNavOffsetChange]);

  const partyChatInputMessageId = useMemo(() => {
    if (!partyChatMessageId || !partyChatInput) return null;
    const partyMessageIndex = messages.findIndex((message) => message.id === partyChatMessageId);
    if (partyMessageIndex <= 0) return null;
    for (let index = partyMessageIndex - 1; index >= 0; index--) {
      const candidate = messages[index]!;
      if (candidate.role === "user") return candidate.id;
      if (candidate.role === "assistant" || candidate.role === "narrator") break;
    }
    return null;
  }, [messages, partyChatInput, partyChatMessageId]);

  // Find the most recent user message (for animated display)
  // Find the user message that prompted the current assistant response
  // (the last user message BEFORE the latest assistant message, not after it).
  const latestUserMessage = useMemo(() => {
    if (!showUserMessages || !latestAssistant) return null;
    // Find the latest assistant message index
    let assistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.id === latestAssistant.id) {
        assistantIdx = i;
        break;
      }
    }
    if (assistantIdx < 0) return null;
    // While a hidden combat-result handoff is waiting for the GM continuation,
    // keep showing the last GM narration rather than resurrecting the pre-combat
    // player action as the active VN segment.
    if (messages.slice(assistantIdx + 1).some(isCombatResultMessage)) return null;
    // Scan backwards from the assistant to find the preceding user message
    for (let i = assistantIdx - 1; i >= 0; i--) {
      const msg = messages[i]!;
      if (isCombatResultMessage(msg)) continue;
      if (isSyntheticGameStartMessage(msg)) continue;
      if (msg.role === "user") return msg;
      if (msg.role === "assistant" || msg.role === "narrator") break;
    }
    return null;
  }, [messages, showUserMessages, latestAssistant]);
  const macroCharacters = useMemo(() => Array.from(characterMap.values()), [characterMap]);
  const fallbackMacroCharacter = macroCharacters[0];
  const resolveMacroCharacter = useCallback(
    (speaker: string | null | undefined) => {
      const matched = findCharacterByName(macroCharacters, speaker);
      if (matched) return matched;
      if (speaker?.trim()) return { name: speaker.trim() };
      return fallbackMacroCharacter;
    },
    [fallbackMacroCharacter, macroCharacters],
  );

  const applyOutputRegexForSource = useCallback(
    (
      text: string,
      sourceMessageId: string | null | undefined,
      sourceRole: Message["role"] | null | undefined,
      resolveMacrosForText: (value: string) => string,
    ) => {
      if (sourceRole !== "assistant" && sourceRole !== "narrator") return text;
      return applyToAIOutput(text, {
        depth: sourceMessageId ? messageDepthById.get(sourceMessageId) : undefined,
        resolveMacros: resolveMacrosForText,
      });
    },
    [applyToAIOutput, messageDepthById],
  );

  const prepareSegmentText = useCallback(
    (
      text: string,
      speaker: string | null | undefined,
      sourceMessageId: string | null | undefined,
      sourceRole: Message["role"] | null | undefined,
    ) => {
      const macroContext = {
        userName: personaInfo?.name || "You",
        persona: personaInfo,
        primaryCharacter: resolveMacroCharacter(speaker),
        characters: macroCharacters,
      };
      const resolveMacrosForText = createMessageMacroResolver(macroContext);
      const regexApplied = applyOutputRegexForSource(text, sourceMessageId, sourceRole, resolveMacrosForText);
      return resolveMacrosForText(regexApplied);
    },
    [applyOutputRegexForSource, macroCharacters, personaInfo, resolveMacroCharacter],
  );

  const prepareDisplaySegment = useCallback(
    (segment: NarrationSegment): NarrationSegment => {
      const regexSourceRole = segment.type === "system" ? "system" : segment.sourceRole;
      const content = prepareSegmentText(segment.content, segment.speaker, segment.sourceMessageId, regexSourceRole);
      const readableContent =
        segment.readableContent == null
          ? segment.readableContent
          : prepareSegmentText(segment.readableContent, segment.speaker, segment.sourceMessageId, regexSourceRole);

      if (content === segment.content && readableContent === segment.readableContent) return segment;
      return { ...segment, content, readableContent };
    },
    [prepareSegmentText],
  );

  // segmentOriginalIndices[i] = the unfiltered parseNarrationSegments index for segments[i],
  // or -1 for non-editable entries (player messages).
  const segmentOriginalIndices = useRef<number[]>([]);
  // Edit info for each segment: messageId + index to store edits, or null if not editable.
  const segmentEditInfoRef = useRef<Array<{ messageId: string; segmentIndex: number } | null>>([]);
  /** Index in segments[] where party-chat entries begin (-1 = none). */
  const partySegStartRef = useRef<number>(-1);
  /** Maps each filtered party segment position to the raw partyDialogue cutoff before trailing side/extra lines. */
  const partyLogBaseCutoffRef = useRef<number[]>([]);
  /** Maps each filtered party segment position (0-based from pStart) to
   *  the number of unfiltered partyDialogue entries to show in logs.
   *  Accounts for side/extra lines that are skipped in the VN display. */
  const partyLogCutoffRef = useRef<number[]>([]);

  const segments = useMemo(() => {
    const result: NarrationSegment[] = [];
    const origIndices: number[] = [];
    const editInfos: Array<{ messageId: string; segmentIndex: number } | null> = [];
    const sourceMessageIds: Array<string | null> = [];

    // Wheel-nav review mode: render exactly the ONE log entry the player is at.
    // Each wheel-up steps back through the flat log (one per visible segment),
    // matching the order shown in the Logs panel. Read-only — no edit overlays.
    if (pastReviewEntry) {
      if (pastReviewEntry.kind === "user") {
        result.push(pastReviewEntry.segment);
        origIndices.push(-1);
        editInfos.push(null);
        sourceMessageIds.push(pastReviewEntry.messageId);
      } else {
        result.push(
          withSegmentSource(
            pastReviewEntry.segment,
            pastReviewEntry.messageId,
            pastReviewEntry.segmentIndex,
            pastReviewEntry.role,
          ),
        );
        origIndices.push(pastReviewEntry.segmentIndex);
        editInfos.push({ messageId: pastReviewEntry.messageId, segmentIndex: pastReviewEntry.segmentIndex });
        sourceMessageIds.push(pastReviewEntry.messageId);
      }
      segmentOriginalIndices.current = origIndices;
      segmentEditInfoRef.current = editInfos;
      segmentSourceMessageIdsRef.current = sourceMessageIds;
      partySegStartRef.current = -1;
      partyLogBaseCutoffRef.current = [];
      partyLogCutoffRef.current = [];
      return result.map(prepareDisplaySegment);
    }

    // Prepend the user's action as a player dialogue segment when we're streaming or just got a response
    if (latestUserMessage?.content && latestAssistant) {
      const playerName = personaInfo?.name || "You";
      const color = personaInfo?.dialogueColor || personaInfo?.nameColor || "#a5b4fc";
      result.push({
        id: `${latestUserMessage.id}-player`,
        type: "dialogue",
        speaker: playerName,
        content: latestUserMessage.content,
        color,
        sourceMessageId: latestUserMessage.id,
        sourceSegmentIndex: 0,
        sourceRole: latestUserMessage.role,
      });
      origIndices.push(-1); // user message — not editable
      editInfos.push(null);
      sourceMessageIds.push(latestUserMessage.id);
    }

    if (latestAssistant) {
      // parseNarrationSegments now returns ALL segments including inline party lines.
      // Filter out side/extra — they become overlay boxes via sideLineMap.
      const allSegs = parseNarrationSegments(latestAssistant, speakerColors);
      for (let si = 0; si < allSegs.length; si++) {
        const seg = allSegs[si]!;
        if (isDeletedSegment(segmentDeletes, latestAssistant.id, si)) continue;
        if (seg.partyType === "side" || seg.partyType === "extra") continue;
        result.push(withSegmentSource(seg, latestAssistant.id, si, latestAssistant.role));
        origIndices.push(si);
        editInfos.push({ messageId: latestAssistant.id, segmentIndex: si });
        sourceMessageIds.push(latestAssistant.id);
      }
    }

    // Append party dialogue lines from party-chat (separate call, still uses partyDialogue prop)
    let partyStart = -1;
    const logBaseCutoff: number[] = [];
    const logCutoff: number[] = [];
    if (partyDialogue?.length || partyChatInput) {
      partyStart = result.length;
      // Prepend the player's party-chat input as a dialogue segment
      if (partyChatInput) {
        const playerName = personaInfo?.name || "You";
        const color = personaInfo?.dialogueColor || personaInfo?.nameColor || "#a5b4fc";
        result.push({
          id: `party-chat-input-${result.length}`,
          type: "dialogue",
          speaker: playerName,
          content: partyChatInput,
          color,
          sourceMessageId: partyChatInputMessageId,
          sourceSegmentIndex: partyChatInputMessageId ? 0 : null,
          sourceRole: partyChatInputMessageId ? "user" : null,
        });
        origIndices.push(-1);
        editInfos.push(null); // player's own input — not editable
        sourceMessageIds.push(partyChatInputMessageId);
        // Player input maps to showing 0 partyDialogue entries in logs
        // (the log section builds its own player-input entry)
        logBaseCutoff.push(0);
        logCutoff.push(0);
      }
      // Track the party-relative edit index (0-based, excluding player input)
      let partyEditIdx = 0;
      let lastPartyCutoffIndex = -1;
      if (partyDialogue?.length) {
        for (let pdIdx = 0; pdIdx < partyDialogue.length; pdIdx++) {
          const line = partyDialogue[pdIdx]!;
          if (line.type === "side" || line.type === "extra") {
            if (lastPartyCutoffIndex >= 0) {
              logCutoff[lastPartyCutoffIndex] = pdIdx + 1;
            }
            continue;
          }
          const pcMsgId = partyChatMessageId ?? null;
          const currentPartySegmentIndex = partyEditIdx;
          const partySourceRole = pcMsgId ? (sourceMessagesById.get(pcMsgId)?.role ?? "assistant") : "assistant";
          // Remap action → plain narration
          if (line.type === "action") {
            partyEditIdx++;
            if (isDeletedSegment(segmentDeletes, pcMsgId, currentPartySegmentIndex)) continue;
            result.push({
              id: `party-action-${line.character}-${result.length}`,
              type: "narration",
              content: line.content,
              sourceMessageId: pcMsgId,
              sourceSegmentIndex: currentPartySegmentIndex,
              sourceRole: partySourceRole,
            });
            origIndices.push(-1);
            editInfos.push(pcMsgId ? { messageId: pcMsgId, segmentIndex: currentPartySegmentIndex } : null);
            sourceMessageIds.push(pcMsgId);
            logBaseCutoff.push(pdIdx + 1);
            logCutoff.push(pdIdx + 1);
            lastPartyCutoffIndex = logCutoff.length - 1;
            continue;
          }
          const color = findNamedMapValue(speakerColors, line.character);
          const isSpokenDialogue =
            line.type === "main" ||
            line.type === "whisper" ||
            line.type === "thought" ||
            line.type === "side" ||
            line.type === "extra";
          partyEditIdx++;
          if (isDeletedSegment(segmentDeletes, pcMsgId, currentPartySegmentIndex)) continue;
          result.push({
            id: `party-${line.type}-${line.character}-${result.length}`,
            type: isSpokenDialogue ? "dialogue" : "narration",
            speaker: line.character,
            sprite: line.expression,
            content: line.content,
            color,
            partyType: line.type,
            whisperTarget: line.target,
            sourceMessageId: pcMsgId,
            sourceSegmentIndex: currentPartySegmentIndex,
            sourceRole: partySourceRole,
          });
          origIndices.push(-1);
          editInfos.push(pcMsgId ? { messageId: pcMsgId, segmentIndex: currentPartySegmentIndex } : null);
          sourceMessageIds.push(pcMsgId);
          // After seeing this filtered segment, show partyDialogue entries 0..pdIdx in logs
          logBaseCutoff.push(pdIdx + 1);
          logCutoff.push(pdIdx + 1);
          lastPartyCutoffIndex = logCutoff.length - 1;
        }
      }
    }

    // Apply segment edit overlays from metadata using original unfiltered indices
    if (segmentEdits && latestAssistant) {
      for (let i = 0; i < result.length; i++) {
        const oi = origIndices[i];
        if (oi == null || oi < 0) continue;
        const edited = segmentEdits.get(`${latestAssistant.id}:${oi}`);
        if (edited) result[i] = applySegmentEditOverlay(result[i]!, edited, speakerColors);
      }
    }

    // Apply party segment edit overlays
    if (segmentEdits && partyChatMessageId) {
      for (let i = 0; i < result.length; i++) {
        const ei = editInfos[i];
        if (!ei || ei.messageId !== partyChatMessageId) continue;
        const edited = segmentEdits.get(`${partyChatMessageId}:${ei.segmentIndex}`);
        if (edited) result[i] = applySegmentEditOverlay(result[i]!, edited, speakerColors);
      }
    }

    // Apply display regex scripts and resolve macros on every segment's content
    // so downstream renderers (formatNarration / animateTextHtml) receive final text.
    for (let i = 0; i < result.length; i++) {
      result[i] = prepareDisplaySegment(result[i]!);
    }

    segmentOriginalIndices.current = origIndices;
    segmentEditInfoRef.current = editInfos;
    segmentSourceMessageIdsRef.current = sourceMessageIds;
    partySegStartRef.current = partyStart;
    partyLogBaseCutoffRef.current = logBaseCutoff;
    partyLogCutoffRef.current = logCutoff;
    return result;
  }, [
    latestAssistant,
    pastReviewEntry,
    speakerColors,
    latestUserMessage,
    personaInfo,
    partyDialogue,
    partyChatInput,
    partyChatInputMessageId,
    partyChatMessageId,
    prepareDisplaySegment,
    segmentEdits,
    segmentDeletes,
    sourceMessagesById,
  ]);

  // Clamp activeIndex when segments shrink (e.g. new party chat clears old dialogue)
  useEffect(() => {
    if (segments.length > 0 && activeIndex >= segments.length) {
      const clamped = segments.length - 1;
      setActiveIndex(clamped);
      setVisibleChars(effectDisplayLength(segments[clamped]!.content));
    }
  }, [segments, activeIndex]);

  // Map segment index → side/extra lines that should appear with it as overlay boxes.
  // Sources: inline GM party lines (from parseNarrationSegments) + party-chat side lines.
  const sideLineMap = useMemo(() => {
    const map = new Map<number, GameSideLine[]>();

    // 1. Collect inline side/extra from GM narration
    if (latestAssistant) {
      const allSegs = parseNarrationSegments(latestAssistant, speakerColors);
      let lastMainIdx = 0;
      let mainCursor = 0;

      for (let rawIndex = 0; rawIndex < allSegs.length; rawIndex++) {
        if (isDeletedSegment(segmentDeletes, latestAssistant.id, rawIndex)) continue;
        const edited = segmentEdits?.get(`${latestAssistant.id}:${rawIndex}`);
        const seg = applySegmentEditOverlay(allSegs[rawIndex]!, edited, speakerColors);
        if (seg.partyType === "side" || seg.partyType === "extra") {
          // Attach to the last non-side segment we've seen
          const arr = map.get(lastMainIdx) ?? [];
          arr.push({
            character: seg.speaker ?? "",
            type: seg.partyType,
            content: prepareSegmentText(seg.content, seg.speaker ?? null, latestAssistant.id, latestAssistant.role),
            expression: seg.sprite,
            target: seg.whisperTarget,
            voiceSourceMessageId: latestAssistant.id,
            voiceSourceSegmentIndex: rawIndex,
            voiceSourceRole: latestAssistant.role,
          });
          map.set(lastMainIdx, arr);
        } else {
          // Find this segment in the filtered `segments` array
          for (let i = mainCursor; i < segments.length; i++) {
            if (segments[i]!.id === seg.id) {
              lastMainIdx = i;
              mainCursor = i + 1;
              break;
            }
          }
        }
      }
    }

    // 2. Collect side/extra from party-chat (partyDialogue prop)
    if (partyDialogue?.length) {
      let lastPartySegIdx = segments.length - 1;
      let partySegCursor = 0;
      let partySegmentIndex = 0;

      for (const line of partyDialogue) {
        const edit = partyChatMessageId ? segmentEdits?.get(`${partyChatMessageId}:${partySegmentIndex}`) : undefined;
        const editedCharacter = edit?.speaker?.trim() || line.character;
        const editedContent = edit?.content ?? line.content;
        if (isDeletedSegment(segmentDeletes, partyChatMessageId, partySegmentIndex)) {
          partySegmentIndex += 1;
          continue;
        }
        if (line.type === "side" || line.type === "extra") {
          const sourceRole = partyChatMessageId
            ? (sourceMessagesById.get(partyChatMessageId)?.role ?? "assistant")
            : "assistant";
          const arr = map.get(lastPartySegIdx) ?? [];
          arr.push({
            ...line,
            character: editedCharacter,
            content: prepareSegmentText(editedContent, editedCharacter, partyChatMessageId, sourceRole),
            voiceSourceMessageId: partyChatMessageId,
            voiceSourceSegmentIndex: partySegmentIndex,
            voiceSourceRole: sourceRole,
          });
          map.set(lastPartySegIdx, arr);
          partySegmentIndex += 1;
        } else {
          for (let i = partySegCursor; i < segments.length; i++) {
            if (segments[i]!.id.startsWith(`party-${line.type}-${line.character}-`)) {
              lastPartySegIdx = i;
              partySegCursor = i + 1;
              break;
            }
          }
          partySegmentIndex += 1;
        }
      }
    }

    return distributeSideLinesAcrossSegments(map, segments.length);
  }, [
    latestAssistant,
    partyDialogue,
    partyChatMessageId,
    prepareSegmentText,
    segmentDeletes,
    segmentEdits,
    segments,
    speakerColors,
    sourceMessagesById,
  ]);

  const active = segments[activeIndex] ?? null;
  const activeSourceMessageId = active ? segmentSourceMessageIdsRef.current[activeIndex] : null;
  const activeSourceMessage = activeSourceMessageId ? (sourceMessagesById.get(activeSourceMessageId) ?? null) : null;
  const activeTranslatedText = activeSourceMessageId ? translations[activeSourceMessageId] : undefined;
  const activeIsTranslating = activeSourceMessageId ? !!translating[activeSourceMessageId] : false;
  const activeCopyKey = active ? `active:${active.id}` : null;
  const activeCopyText = active ? (active.readableContent ?? stripGmTagsKeepReadables(active.content)) : "";
  const gameVoiceEnabled = Boolean(ttsConfig?.enabled && ttsConfig.autoplayGame);
  const gameVoiceConfigSignature = useMemo(() => buildVoiceConfigSignature(ttsConfig), [ttsConfig]);
  const normalizedGameVoiceVolume = Math.max(0, Math.min(1, gameVoiceVolume));
  const gameVoicePlaybackBlocked = voicePlaybackBlocked ?? autoPlayBlocked;

  const stopGameVoicePlayback = useCallback(() => {
    gameVoiceSequenceRef.current += 1;
    if (gameVoiceAudioRef.current) {
      gameVoiceAudioRef.current.pause();
      gameVoiceAudioRef.current.onended = null;
      gameVoiceAudioRef.current.onerror = null;
      gameVoiceAudioRef.current = null;
    }
    setGameVoicePlayingKey(null);
    setGameVoicePausedKey(null);
  }, []);

  const playGameVoiceKeys = useCallback(
    (keys: string[]) => {
      const playableKeys = keys.filter((key) => {
        const entry = gameVoiceCacheRef.current.get(key);
        return entry?.status === "ready" && entry.urls.length > 0;
      });
      if (playableKeys.length === 0) return;

      stopGameVoicePlayback();
      const sequence = ++gameVoiceSequenceRef.current;
      let keyIndex = 0;
      let urlIndex = 0;

      const playNext = () => {
        if (gameVoiceSequenceRef.current !== sequence) return;
        const key = playableKeys[keyIndex];
        if (!key) {
          setGameVoicePlayingKey(null);
          setGameVoicePausedKey(null);
          gameVoiceAudioRef.current = null;
          return;
        }

        const entry = gameVoiceCacheRef.current.get(key);
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

        setGameVoicePlayingKey(key);
        setGameVoicePausedKey(null);
        const audio = new Audio(url);
        audio.volume = normalizedGameVoiceVolume;
        audio.muted = normalizedGameVoiceVolume <= 0;
        gameVoiceAudioRef.current = audio;
        audio.onended = () => {
          if (gameVoiceSequenceRef.current !== sequence || gameVoiceAudioRef.current !== audio) return;
          urlIndex += 1;
          playNext();
        };
        audio.onerror = () => {
          if (gameVoiceSequenceRef.current !== sequence || gameVoiceAudioRef.current !== audio) return;
          setGameVoicePlayingKey(null);
          setGameVoicePausedKey(null);
          gameVoiceAudioRef.current = null;
        };
        audio.play().catch(() => {
          if (gameVoiceSequenceRef.current !== sequence || gameVoiceAudioRef.current !== audio) return;
          setGameVoicePlayingKey(null);
          setGameVoicePausedKey(null);
          gameVoiceAudioRef.current = null;
        });
      };

      playNext();
    },
    [normalizedGameVoiceVolume, stopGameVoicePlayback],
  );

  const playGameVoiceKey = useCallback((key: string) => playGameVoiceKeys([key]), [playGameVoiceKeys]);

  const pauseGameVoicePlayback = useCallback(() => {
    if (!gameVoiceAudioRef.current || !gameVoicePlayingKey || gameVoicePausedKey === gameVoicePlayingKey) return;
    gameVoiceAudioRef.current.pause();
    setGameVoicePausedKey(gameVoicePlayingKey);
  }, [gameVoicePausedKey, gameVoicePlayingKey]);

  const resumeGameVoicePlayback = useCallback(() => {
    const audio = gameVoiceAudioRef.current;
    if (!audio || !gameVoicePlayingKey || gameVoicePausedKey !== gameVoicePlayingKey) return;
    setGameVoicePausedKey(null);
    void audio.play().catch(() => {
      if (gameVoiceAudioRef.current !== audio) return;
      setGameVoicePlayingKey(null);
      setGameVoicePausedKey(null);
      gameVoiceAudioRef.current = null;
    });
  }, [gameVoicePausedKey, gameVoicePlayingKey]);

  useEffect(() => {
    if (!gameVoiceAudioRef.current) return;
    gameVoiceAudioRef.current.volume = normalizedGameVoiceVolume;
    gameVoiceAudioRef.current.muted = normalizedGameVoiceVolume <= 0;
  }, [normalizedGameVoiceVolume]);

  const toggleGameVoiceKey = useCallback(
    (key: string) => {
      if (gameVoicePlayingKey === key) {
        if (gameVoicePausedKey === key) {
          resumeGameVoicePlayback();
        } else {
          pauseGameVoicePlayback();
        }
        return;
      }
      playGameVoiceKey(key);
    },
    [gameVoicePausedKey, gameVoicePlayingKey, pauseGameVoicePlayback, playGameVoiceKey, resumeGameVoicePlayback],
  );

  const restartGameVoiceKey = useCallback((key: string) => playGameVoiceKey(key), [playGameVoiceKey]);

  const getVoiceRequestsForSegment = useCallback(
    (segment: NarrationSegment): GameSegmentVoiceRequest[] => {
      if (!ttsConfig) return [];

      const requests: GameSegmentVoiceRequest[] = [];
      const baseRequest = getGameSegmentVoiceRequest(segment, ttsConfig, gameNpcs, {
        playerSpeakerNames: playerVoiceSpeakerNames,
      });
      if (baseRequest) requests.push(baseRequest);

      return requests;
    },
    [gameNpcs, playerVoiceSpeakerNames, ttsConfig],
  );

  const getVoiceRequestForSideLine = useCallback(
    (segment: NarrationSegment, line: GameSideLine, index: number): GameSegmentVoiceRequest[] => {
      if (!ttsConfig) return [];
      const sideSegment: NarrationSegment = {
        id: `${segment.id}-side-voice-${index}`,
        type: "dialogue",
        speaker: line.character,
        sprite: line.expression,
        content: line.content,
        partyType: line.type,
        whisperTarget: line.target,
        sourceMessageId: line.voiceSourceMessageId ?? segment.sourceMessageId,
        sourceSegmentIndex: line.voiceSourceSegmentIndex ?? segment.sourceSegmentIndex,
        sourceRole: line.voiceSourceRole ?? "assistant",
      };
      const request = getGameSegmentVoiceRequest(sideSegment, ttsConfig, gameNpcs, {
        playerSpeakerNames: playerVoiceSpeakerNames,
      });
      return request ? [request] : [];
    },
    [gameNpcs, playerVoiceSpeakerNames, ttsConfig],
  );

  const getVoiceKeyForSegment = useCallback(
    (segment: NarrationSegment) => {
      if (!ttsConfig) return null;
      return getGameSegmentVoiceKeyForRequests(segment, gameVoiceConfigSignature, getVoiceRequestsForSegment(segment));
    },
    [gameVoiceConfigSignature, getVoiceRequestsForSegment, ttsConfig],
  );

  const getVoiceKeyForSideLine = useCallback(
    (segment: NarrationSegment, line: GameSideLine, index: number) => {
      if (!ttsConfig) return null;
      const requests = getVoiceRequestForSideLine(segment, line, index);
      return getGameSideLineVoiceKeyForRequests(segment, line, index, gameVoiceConfigSignature, requests);
    },
    [gameVoiceConfigSignature, getVoiceRequestForSideLine, ttsConfig],
  );

  // When a segment's content changes in-place (user edited it), snap visibleChars
  // to the full display length so the typewriter doesn't re-type the edited text.
  useEffect(() => {
    if (!active) return;
    const prev = prevActiveRef.current;
    if (prev.index === activeIndex && prev.content !== undefined && prev.content !== active.content) {
      const dispLen = effectDisplayLength(active.content);
      setVisibleChars(dispLen);
      twRef.current.pos = dispLen;
    }
    prevActiveRef.current = { index: activeIndex, content: active.content };
  }, [active, activeIndex]);

  const activeDisplayLen = active ? effectDisplayLength(active.content) : 0;
  const doneTyping = !!active && visibleChars >= activeDisplayLen;
  const activeCanEditSegment = !!(
    doneTyping &&
    onEditSegment &&
    editingContent === null &&
    segmentEditInfoRef.current[activeIndex] != null
  );
  const narrationComplete =
    !isStreaming && !scenePreparing && segments.length > 0 && activeIndex === segments.length - 1 && doneTyping;
  const activeSegmentAnchor = active ? narrationSegmentAnchorKey(active) : null;
  const segmentAnchorSignature = useMemo(() => segments.map(narrationSegmentAnchorKey).join("|"), [segments]);
  const activeSegmentAnchorRef = useRef<{ key: string; index: number; sourceMessageId: string | null } | null>(null);

  useLayoutEffect(() => {
    const previous = activeSegmentAnchorRef.current;
    if (!previous || segments.length === 0) return;

    const matchingIndex = segments.findIndex((segment) => narrationSegmentAnchorKey(segment) === previous.key);
    if (matchingIndex >= 0 && matchingIndex !== activeIndex) {
      setActiveIndex(matchingIndex);
      return;
    }

    const sameSourceStillVisible =
      !!previous.sourceMessageId && segments.some((segment) => segment.sourceMessageId === previous.sourceMessageId);
    if (matchingIndex < 0 && sameSourceStillVisible) {
      const fallbackIndex = Math.min(previous.index, segments.length - 1);
      if (fallbackIndex !== activeIndex) setActiveIndex(fallbackIndex);
    }
    // This should only react to segment-list mutations. Active-index changes from
    // normal reading/navigation update the anchor in the next effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentAnchorSignature]);

  useLayoutEffect(() => {
    activeSegmentAnchorRef.current = activeSegmentAnchor
      ? {
          key: activeSegmentAnchor,
          index: activeIndex,
          sourceMessageId: active?.sourceMessageId ?? null,
        }
      : null;
  }, [active?.sourceMessageId, activeIndex, activeSegmentAnchor]);

  // Notify parent about narration completion state. While reviewing the past via
  // wheel-nav, the past message will look "complete" — but it's not the present, so
  // suppress the notification to keep the parent's narrationDone state honest.
  // Pass the active segment's source message ID so the parent can tell which message's
  // typewriter the completion refers to (otherwise stale "done" from the previous turn
  // can leak across to the new turn before this effect re-runs to push false).
  useEffect(() => {
    if (messageOffset > 0) return;
    onNarrationComplete?.(narrationComplete, activeSourceMessageId);
  }, [messageOffset, narrationComplete, activeSourceMessageId, onNarrationComplete]);

  // Build log entries from the LAST scene — includes party chat & player action.
  // Entries are stored chronologically (oldest first, newest last).
  // The modal auto-scrolls to the bottom so the user sees the most recent content.
  const logEntries = useMemo(() => {
    const entries: Array<{ messageId: string; segments: NarrationSegment[] }> = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;

      // Skip the party-chat message that's already rendered by the partyDialogue section
      // to avoid doubling it in the logs (the DB message + live partyDialogue state).
      // Also skip the user message immediately before it (the player's party-chat input).
      if (partyChatMessageId && msg.id === partyChatMessageId) continue;
      if (
        partyChatMessageId &&
        partyChatInput &&
        msg.role === "user" &&
        i + 1 < messages.length &&
        messages[i + 1]!.id === partyChatMessageId
      )
        continue;

      // Include user messages as player dialogue in logs
      if (showUserMessages && msg.role === "user" && msg.content.trim()) {
        if (isSyntheticGameStartMessage(msg)) continue;
        const playerName = personaInfo?.name || "You";
        const color = personaInfo?.dialogueColor || personaInfo?.nameColor || "#a5b4fc";
        entries.push({
          messageId: msg.id,
          segments: [
            {
              id: `${msg.id}-player-log`,
              type: "dialogue",
              speaker: playerName,
              content: msg.content,
              color,
              sourceMessageId: msg.id,
              sourceSegmentIndex: 0,
              sourceRole: msg.role,
            },
          ],
        });
        continue;
      }

      if (msg.role === "system" && msg.content.trim()) {
        entries.push({
          messageId: msg.id,
          segments: [
            {
              id: `${msg.id}-system-log`,
              type: "system",
              content: msg.content,
              sourceMessageId: msg.id,
              sourceSegmentIndex: 0,
              sourceRole: msg.role,
            },
          ],
        });
        continue;
      }

      if (msg.role !== "assistant" && msg.role !== "narrator") continue;

      if (latestAssistant && msg.id === latestAssistant.id) {
        // Current scene: include already-read segments + current active segment
        const allSegs = parseNarrationSegments(msg, speakerColors);
        const skillCheckSegs = formatSkillCheckLogContent(msg);
        // Apply segment edit overlays
        if (segmentEdits) {
          for (let si = 0; si < allSegs.length; si++) {
            const edited = segmentEdits.get(`${msg.id}:${si}`);
            if (edited) allSegs[si] = applySegmentEditOverlay(allSegs[si]!, edited, speakerColors);
          }
        }
        // Find the active segment by ID in the unfiltered list so side/extra offsets don't skew the slice
        const activeSeg = segments[activeIndex];
        const activeSegId = activeSeg?.id;
        let readUpTo = activeSeg?.sourceRole === "user" ? 0 : allSegs.length; // fallback: show all unless active is player action
        if (activeSegId) {
          const idx = allSegs.findIndex((s) => s.id === activeSegId);
          if (idx >= 0) {
            readUpTo = idx + 1;
            if (doneTyping) {
              while (readUpTo < allSegs.length && allSegs[readUpTo]!.partyType === "side") {
                readUpTo += 1;
              }
            }
          }
        }
        const currentSegs: NarrationSegment[] = [];
        for (const seg of skillCheckSegs) {
          currentSegs.push({ ...seg, sourceMessageId: msg.id, sourceRole: msg.role });
        }
        for (let si = 0; si < Math.min(readUpTo, allSegs.length); si++) {
          if (isDeletedSegment(segmentDeletes, msg.id, si)) continue;
          currentSegs.push(withSegmentSource(allSegs[si]!, msg.id, si, msg.role));
        }
        if (currentSegs.length > 0) entries.push({ messageId: msg.id, segments: currentSegs });
      } else {
        // Past scenes: include ALL segments (narration, dialogue, party chat)
        const segs = parseNarrationSegments(msg, speakerColors);
        const skillCheckSegs = formatSkillCheckLogContent(msg);
        // Apply segment edit overlays
        if (segmentEdits) {
          for (let si = 0; si < segs.length; si++) {
            const edited = segmentEdits.get(`${msg.id}:${si}`);
            if (edited) segs[si] = applySegmentEditOverlay(segs[si]!, edited, speakerColors);
          }
        }
        const visibleSegs: NarrationSegment[] = [];
        for (const seg of skillCheckSegs) {
          visibleSegs.push({ ...seg, sourceMessageId: msg.id, sourceRole: msg.role });
        }
        for (let si = 0; si < segs.length; si++) {
          if (isDeletedSegment(segmentDeletes, msg.id, si)) continue;
          visibleSegs.push(withSegmentSource(segs[si]!, msg.id, si, msg.role));
        }
        if (visibleSegs.length > 0) entries.push({ messageId: msg.id, segments: visibleSegs });
      }
    }

    // Append party dialogue lines (separate party-chat call) as their own entry at the end (newest)
    if (partyDialogue?.length || partyChatInput) {
      const partySegs: NarrationSegment[] = [];
      const partySourceRole = partyChatMessageId
        ? (sourceMessagesById.get(partyChatMessageId)?.role ?? "assistant")
        : "assistant";

      // Prepend the player's party-chat input
      if (partyChatInput) {
        const playerName = personaInfo?.name || "You";
        const color = personaInfo?.dialogueColor || personaInfo?.nameColor || "#a5b4fc";
        partySegs.push({
          id: "party-log-player-input",
          type: "dialogue" as const,
          speaker: playerName,
          content: partyChatInput,
          color,
          sourceMessageId: partyChatInputMessageId,
          sourceSegmentIndex: partyChatInputMessageId ? 0 : null,
          sourceRole: partyChatInputMessageId ? "user" : null,
        });
      }

      if (partyDialogue?.length) {
        let partySegmentIndex = 0;
        for (const [idx, line] of partyDialogue.entries()) {
          // Remap action → plain narration
          if (line.type === "action") {
            partySegs.push({
              id: `party-log-action-${line.character}-${idx}`,
              type: "narration" as const,
              content: line.content,
              sourceMessageId: partyChatMessageId,
              sourceSegmentIndex: partyChatMessageId ? partySegmentIndex : null,
              sourceRole: partySourceRole,
            });
            partySegmentIndex += 1;
            continue;
          }
          const color = findNamedMapValue(speakerColors, line.character);
          const isSpoken =
            line.type === "main" ||
            line.type === "whisper" ||
            line.type === "thought" ||
            line.type === "side" ||
            line.type === "extra";
          partySegs.push({
            id: `party-log-${line.type}-${line.character}-${idx}`,
            type: isSpoken ? ("dialogue" as const) : ("narration" as const),
            speaker: line.character,
            sprite: line.expression,
            content: line.content,
            color,
            partyType: line.type,
            whisperTarget: line.target,
            sourceMessageId: partyChatMessageId,
            sourceSegmentIndex: partyChatMessageId ? partySegmentIndex : null,
            sourceRole: partySourceRole,
          });
          partySegmentIndex += 1;
        }
      }

      if (segmentEdits && partyChatMessageId) {
        for (let si = 0; si < partySegs.length; si++) {
          const seg = partySegs[si]!;
          if (seg.sourceMessageId !== partyChatMessageId || seg.sourceSegmentIndex == null) continue;
          const edited = segmentEdits.get(`${partyChatMessageId}:${seg.sourceSegmentIndex}`);
          if (edited) partySegs[si] = applySegmentEditOverlay(seg, edited, speakerColors);
        }
      }

      // Only show party segments up to the currently viewed segment.
      // Uses a cutoff map computed in the segments memo to correctly handle
      // side/extra lines that are filtered from VN display but kept in logs.
      const pStart = partySegStartRef.current;
      const cutoffs = partyLogCutoffRef.current;
      let partyReadUpTo = partySegs.length;
      if (pStart >= 0) {
        if (activeIndex < pStart) {
          partyReadUpTo = 0; // haven't reached party segments yet
        } else {
          const offset = activeIndex - pStart; // 0-based position within party segments
          const baseCutoffs = partyLogBaseCutoffRef.current;
          // cutoffs[offset] = number of raw partyDialogue entries to include
          const cutoffSource = doneTyping ? cutoffs : baseCutoffs;
          const dialogueCutoff = offset < cutoffSource.length ? cutoffSource[offset]! : (partyDialogue?.length ?? 0);
          // partySegs = [playerInput?] + partyDialogue entries
          const inputOffset = partyChatInput ? 1 : 0;
          partyReadUpTo = Math.min(partySegs.length, inputOffset + dialogueCutoff);
        }
      }
      const visiblePartySegs = partySegs
        .slice(0, partyReadUpTo)
        .filter((seg) => !isDeletedSegment(segmentDeletes, seg.sourceMessageId, seg.sourceSegmentIndex));

      if (visiblePartySegs.length > 0) {
        const pcMsgId = partyChatMessageId ?? "party-chat";
        entries.push({ messageId: pcMsgId, segments: visiblePartySegs });
      }
    }

    return entries.map((entry) => ({
      ...entry,
      segments: entry.segments.map(prepareDisplaySegment),
    }));
  }, [
    messages,
    latestAssistant,
    speakerColors,
    activeIndex,
    segments,
    showUserMessages,
    personaInfo,
    partyChatInput,
    partyChatInputMessageId,
    partyChatMessageId,
    partyDialogue,
    prepareDisplaySegment,
    segmentEdits,
    segmentDeletes,
    sourceMessagesById,
    doneTyping,
  ]);
  const logPageSize = Math.max(1, messagesPerPage > 0 ? messagesPerPage : logEntries.length || 20);
  const [visibleLogCount, setVisibleLogCount] = useState(logPageSize);
  useEffect(() => {
    if (!logsOpen) return;
    setVisibleLogCount(logPageSize);
    logScrolledRef.current = false;
  }, [logPageSize, logsOpen]);
  const visibleLogEntries = useMemo(
    () => logEntries.slice(Math.max(0, logEntries.length - visibleLogCount)),
    [logEntries, visibleLogCount],
  );
  const hiddenLogCount = Math.max(0, logEntries.length - visibleLogEntries.length);
  const captureLogScrollAnchor = useCallback(() => {
    const container = logScrollContainerRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-log-anchor-key]"));
    const anchorRow = rows.find((row) => row.getBoundingClientRect().bottom >= containerTop + 8) ?? rows[0] ?? null;
    const key = anchorRow?.dataset.logAnchorKey;
    pendingLogScrollAnchorRef.current =
      anchorRow && key
        ? {
            key,
            offsetTop: anchorRow.getBoundingClientRect().top - containerTop,
            scrollTop: container.scrollTop,
          }
        : { key: "", offsetTop: 0, scrollTop: container.scrollTop };
  }, []);
  const sessionHistoryTokens = useMemo(() => estimateSessionHistoryTokens(messages), [messages]);
  const loadOlderLogs = useCallback(() => {
    setVisibleLogCount((current) => Math.min(logEntries.length, current + logPageSize));
  }, [logEntries.length, logPageSize]);
  const showAllLogs = useCallback(() => {
    setVisibleLogCount(logEntries.length);
  }, [logEntries.length]);

  useLayoutEffect(() => {
    if (!logsOpen) return;
    const anchor = pendingLogScrollAnchorRef.current;
    if (!anchor) return;
    pendingLogScrollAnchorRef.current = null;
    const container = logScrollContainerRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      const currentContainer = logScrollContainerRef.current;
      if (!currentContainer) return;
      const containerTop = currentContainer.getBoundingClientRect().top;
      const rows = Array.from(currentContainer.querySelectorAll<HTMLElement>("[data-log-anchor-key]"));
      const row = anchor.key ? rows.find((candidate) => candidate.dataset.logAnchorKey === anchor.key) : null;
      if (!row) {
        currentContainer.scrollTop = Math.min(anchor.scrollTop, currentContainer.scrollHeight);
        return;
      }
      currentContainer.scrollTop += row.getBoundingClientRect().top - containerTop - anchor.offsetTop;
    });
  }, [logsOpen, visibleLogEntries]);

  const stackedLogEntries = useMemo(() => {
    if (!useStackedLogDisplay) return [];

    const activeCompanionSideLines = active ? (sideLineMap.get(activeIndex) ?? EMPTY_GAME_SIDE_LINES) : [];
    const activeCompanionSignatures = new Set(
      activeCompanionSideLines.map((line) => `${line.type}|${line.character}|${line.target ?? ""}|${line.content}`),
    );
    const activeSourceMessageId = active?.sourceMessageId ?? null;

    return logEntries
      .map((entry) => ({
        ...entry,
        segments: entry.segments.filter((seg) => {
          if (seg.id === active?.id) return false;
          const sameSource =
            !activeSourceMessageId || !seg.sourceMessageId || seg.sourceMessageId === activeSourceMessageId;
          if (
            sameSource &&
            seg.partyType &&
            activeCompanionSignatures.has(
              `${seg.partyType}|${seg.speaker ?? ""}|${seg.whisperTarget ?? ""}|${seg.content}`,
            )
          ) {
            return false;
          }
          return true;
        }),
      }))
      .filter((entry) => entry.segments.length > 0);
  }, [active, activeIndex, logEntries, sideLineMap, useStackedLogDisplay]);
  const stackedLogFingerprint = useMemo(
    () =>
      stackedLogEntries.map((entry) => `${entry.messageId}:${entry.segments.map((seg) => seg.id).join(",")}`).join("|"),
    [stackedLogEntries],
  );

  useEffect(() => {
    if (!useStackedLogDisplay || !logsOpen) return;
    setLogsOpen(false);
    setEditingLogSeg(null);
    logScrolledRef.current = false;
  }, [logsOpen, useStackedLogDisplay]);

  useEffect(() => {
    if (useStackedLogDisplay) setStackedLogPinned(true);
  }, [useStackedLogDisplay]);

  useEffect(() => {
    if (!useStackedLogDisplay || !stackedLogPinned) return;
    const el = stackedLogRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [stackedLogFingerprint, stackedLogPinned, useStackedLogDisplay]);

  // Report active speaker to parent for sprite viewport
  // Guard against infinite re-render: skip callback if the resolved speaker hasn't changed,
  // even when dependency refs churn (e.g. unstable speakerAvatarInfos from store).
  const lastReportedSpeakerRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onActiveSpeakerChange) return;

    const next =
      !active || active.type !== "dialogue" || !active.speaker
        ? null
        : (() => {
            const avatar = findNamedMapValue(speakerAvatarInfos, active.speaker);
            return avatar ? { name: active.speaker, avatarUrl: avatar.url, expression: active.sprite } : null;
          })();

    // Composite key catches legitimate expression/avatar changes, not just name
    const nextKey = next ? `${next.name}|${next.expression ?? ""}|${next.avatarUrl ?? ""}` : null;
    if (nextKey === lastReportedSpeakerRef.current) return;
    lastReportedSpeakerRef.current = nextKey;
    onActiveSpeakerChange(next);
  }, [active, speakerAvatarInfos, onActiveSpeakerChange]);

  // How many segments are prepended before the actual GM narration segments
  const playerSegmentOffset = latestUserMessage?.content && latestAssistant ? 1 : 0;

  const restoredRef = useRef(false);
  const restoredChatIdRef = useRef<string | null>(null);
  const lastNarrationMsgIdRef = useRef<string | undefined>(undefined);
  const segmentChangeReady = useRef(false);
  const segmentEnterReady = useRef(false);
  const narrationMessageChanged = Boolean(latestAssistant?.id && latestAssistant.id !== lastNarrationMsgIdRef.current);
  const gameInstantTextReveal = useUIStore((s) => s.gameInstantTextReveal);
  const gameTextSpeed = useUIStore((s) => s.gameTextSpeed);
  const gameAutoPlayDelay = useUIStore((s) => s.gameAutoPlayDelay);
  const chatFontColor = useUIStore((s) => s.chatFontColor);
  const chatFontSize = useUIStore((s) => s.chatFontSize);
  const gameAvatarScale = useUIStore((s) => s.gameAvatarScale);
  const narrationFontStyle = useMemo<CSSProperties>(() => ({ fontSize: `${chatFontSize}px` }), [chatFontSize]);
  const narrationStyle = useMemo<CSSProperties>(
    () => (chatFontColor ? { ...narrationFontStyle, color: chatFontColor } : narrationFontStyle),
    [chatFontColor, narrationFontStyle],
  );
  const gameAvatarScaleStyle = useMemo<CSSProperties>(
    () => ({ "--game-avatar-scale": gameAvatarScale }) as CSSProperties,
    [gameAvatarScale],
  );
  const [autoPlay, setAutoPlay] = useState(false);

  const getSegmentStartVisibleChars = useCallback(
    (index: number) => {
      const segment = segments[index];
      if (!segment || !gameInstantTextReveal || directionsActive || scenePreparing) return 0;
      return effectDisplayLength(segment.content);
    },
    [segments, gameInstantTextReveal, directionsActive, scenePreparing],
  );

  useEffect(() => {
    // Only react to message ID changes (not content changes during streaming).
    // Ignore transient null states (e.g. during React Query refetch) — keep existing ref.
    if (!latestAssistant?.id) return;
    if (latestAssistant.id === lastNarrationMsgIdRef.current) return;

    // Don't reset narration while streaming — wait until the full message arrives.
    // This prevents the snap-back to segment 0 mid-stream.
    if (isStreaming) return;

    lastNarrationMsgIdRef.current = latestAssistant.id;

    const currentChatId = latestAssistant.chatId ?? null;
    const firstNarrationForChat = restoredChatIdRef.current !== currentChatId;
    const shouldRestorePosition = hasStoredNarrationPosition && firstNarrationForChat && segments.length > 0;
    if (shouldRestorePosition) {
      // Jump to saved segment index (or last segment if saved index exceeds current
      // segment count — party dialogue may not be restored yet).
      restoredRef.current = true;
      restoredChatIdRef.current = currentChatId;
      const targetIdx =
        restoredSegmentIndex != null && restoredSegmentIndex >= 0 && restoredSegmentIndex < segments.length
          ? restoredSegmentIndex
          : segments.length - 1;
      setActiveIndex(targetIdx);
      setVisibleChars(effectDisplayLength(segments[targetIdx]!.content));
      // Allow persistence and segment-enter AFTER the restore state settles
      requestAnimationFrame(() => {
        segmentChangeReady.current = true;
        segmentEnterReady.current = true;
      });
      return;
    }
    restoredChatIdRef.current = currentChatId;
    setActiveIndex(playerSegmentOffset);
    setVisibleChars(getSegmentStartVisibleChars(playerSegmentOffset));
    // Clear the restore flag once we've advanced to a new message so the
    // "segments grow after restore" effect below no longer snaps back to the
    // stale saved index when segments rebuild for the new scene.
    restoredRef.current = false;
    // For non-restore (new message), enable persistence and enter immediately
    segmentChangeReady.current = true;
    segmentEnterReady.current = true;
  }, [
    latestAssistant?.id,
    latestAssistant?.chatId,
    isStreaming,
    hasStoredNarrationPosition,
    restoredSegmentIndex,
    segments,
    playerSegmentOffset,
    getSegmentStartVisibleChars,
  ]);

  // When segments grow after restore (e.g. party dialogue restored asynchronously),
  // jump to the exact saved segment index if it's now in bounds.
  useEffect(() => {
    if (!restoredRef.current || !latestAssistant?.id) return;
    if (restoredSegmentIndex == null || restoredSegmentIndex < 0) return;
    if (restoredSegmentIndex >= segments.length) return; // still not enough segments
    if (activeIndex === restoredSegmentIndex) return; // already there
    setActiveIndex(restoredSegmentIndex);
    setVisibleChars(effectDisplayLength(segments[restoredSegmentIndex]!.content));
  }, [segments.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist segment index changes (skip until restore has settled or first message processed).
  // Suppress while reviewing the past via wheel-nav so the saved present-position isn't
  // clobbered by the activeIndex jumps we make on offset transitions.
  useEffect(() => {
    if (!segmentChangeReady.current) return;
    if (messageOffset > 0) return;
    onSegmentChange?.(activeIndex);
  }, [activeIndex, messageOffset, onSegmentChange]);

  // Notify parent before paint when the active segment changes so segment-tied
  // directions can pause the typewriter before its first visible character.
  useLayoutEffect(() => {
    if (!segmentEnterReady.current) return;
    if (!onSegmentEnter) return;
    const activeSegment = segments[activeIndex];
    if (!activeSegment) return;
    // Scene analysis keys segmentEffects to the assistant message's original
    // segment indices. Use the source segment index rather than the flattened
    // viewer position so later effects still line up after filtering or
    // injecting display-only segments.
    if (activeSegment.sourceMessageId !== latestAssistant?.id) return;
    if (activeSegment.sourceSegmentIndex == null || activeSegment.sourceSegmentIndex < 0) return;
    onSegmentEnter(activeSegment.sourceSegmentIndex);
  }, [activeIndex, latestAssistant?.id, onSegmentEnter, segments]);

  // Trigger readable overlay when the typewriter finishes a readable segment
  const readableFiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (narrationMessageChanged) return;
    if (scenePreparing) return;
    if (!active || active.type !== "readable" || !active.readableContent || !onReadable) return;
    if (readableFiredRef.current.has(active.id)) return;
    const dispLen = effectDisplayLength(active.content);
    if (visibleChars < dispLen) return;
    readableFiredRef.current.add(active.id);
    onReadable({
      type: active.readableType ?? "note",
      content: active.readableContent,
      sourceMessageId: active.sourceMessageId,
      sourceSegmentIndex: active.sourceSegmentIndex,
    });
  }, [active, narrationMessageChanged, scenePreparing, visibleChars, onReadable]);

  useEffect(() => {
    if (!ttsConfig || !gameVoiceEnabled || isStreaming || generationFailed) return;

    const plans: GameVoiceEntryPlan[] = [];
    const queuePlan = (key: string | null, requests: GameSegmentVoiceRequest[]) => {
      if (!key || gameVoiceCacheRef.current.has(key) || gameVoicePendingRef.current.has(key)) return;
      const audioJobs = buildGameVoiceAudioJobs(key, requests, ttsConfig);
      if (audioJobs.length === 0) return;

      const controller = new AbortController();
      gameVoicePendingRef.current.set(key, controller);
      gameVoiceCacheRef.current.set(key, {
        status: "loading",
        chunks: audioJobs.map((job) => job.chunk),
        speaker: audioJobs[0]?.speaker,
        tone: audioJobs[0]?.tone,
        voice: audioJobs[0]?.voice,
      });
      plans.push({ key, audioJobs, controller });
    };

    for (const [segmentIndex, segment] of segments.entries()) {
      const requests = getVoiceRequestsForSegment(segment);
      queuePlan(getGameSegmentVoiceKeyForRequests(segment, gameVoiceConfigSignature, requests), requests);

      const sideLines = sideLineMap.get(segmentIndex) ?? [];
      for (const [sideIndex, line] of sideLines.entries()) {
        const sideRequests = getVoiceRequestForSideLine(segment, line, sideIndex);
        queuePlan(
          getGameSideLineVoiceKeyForRequests(segment, line, sideIndex, gameVoiceConfigSignature, sideRequests),
          sideRequests,
        );
      }
    }

    if (plans.length === 0) return;
    setGameVoiceVersion((version) => version + 1);

    const runPlans = async () => {
      for (const plan of plans) {
        const { key, audioJobs, controller } = plan;
        if (controller.signal.aborted) continue;

        const blobs: Blob[] = [];
        let failed = false;
        for (const [jobIndex, job] of audioJobs.entries()) {
          if (controller.signal.aborted) break;
          try {
            const blob = await generateGameVoiceJobBlob(job, controller);
            blobs.push(blob);
          } catch (err) {
            if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) break;
            failed = true;
            console.warn(`[game-tts] Failed to generate voice line chunk ${jobIndex + 1}/${audioJobs.length}`, err);
            break;
          }
        }

        try {
          if (controller.signal.aborted) return;
          const urls = blobs.map((blob) => URL.createObjectURL(blob));
          if (!failed && urls.length === audioJobs.length) {
            gameVoiceCacheRef.current.set(key, {
              status: "ready",
              chunks: audioJobs.map((job) => job.chunk),
              speaker: audioJobs[0]?.speaker,
              tone: audioJobs[0]?.tone,
              voice: audioJobs[0]?.voice,
              urls,
            });
          } else {
            for (const url of urls) URL.revokeObjectURL(url);
            gameVoiceCacheRef.current.set(key, {
              status: "error",
              chunks: audioJobs.map((job) => job.chunk),
              speaker: audioJobs[0]?.speaker,
              tone: audioJobs[0]?.tone,
              voice: audioJobs[0]?.voice,
            });
          }
        } finally {
          gameVoicePendingRef.current.delete(key);
          if (!controller.signal.aborted) {
            setGameVoiceVersion((version) => version + 1);
          }
        }
      }
    };

    gameVoiceGenerationTailRef.current = gameVoiceGenerationTailRef.current.catch(() => undefined).then(runPlans);
    void gameVoiceGenerationTailRef.current;
  }, [
    gameNpcs,
    gameVoiceConfigSignature,
    gameVoiceEnabled,
    generationFailed,
    getVoiceRequestForSideLine,
    getVoiceRequestsForSegment,
    isStreaming,
    sideLineMap,
    segments,
    ttsConfig,
  ]);

  const activeVoiceKey = active ? getVoiceKeyForSegment(active) : null;
  const activeSideLines = useMemo(
    () => (active ? (sideLineMap.get(activeIndex) ?? EMPTY_GAME_SIDE_LINES) : EMPTY_GAME_SIDE_LINES),
    [active, activeIndex, sideLineMap],
  );
  const activeSideVoiceKeys = useMemo(() => {
    if (!active) return [];
    return activeSideLines
      .map((line, index) => getVoiceKeyForSideLine(active, line, index))
      .filter((key): key is string => Boolean(key));
  }, [active, activeSideLines, getVoiceKeyForSideLine]);
  const autoPlayVoiceBlocked = (() => {
    if (!gameVoiceEnabled || generationFailed) return false;

    if (activeVoiceKey) {
      const entry = gameVoiceCacheRef.current.get(activeVoiceKey);
      if (!entry || entry.status === "loading") return true;
      if (entry.status === "ready") {
        if (gameVoicePlayingKey === activeVoiceKey) return true;
        if (lastAutoPlayedVoiceKeyRef.current !== activeVoiceKey) return true;
      }
    }

    if (activeSideVoiceKeys.length > 0) {
      const groupKey = activeSideVoiceKeys.join("|");
      const entries = activeSideVoiceKeys.map((key) => gameVoiceCacheRef.current.get(key));
      if (entries.some((entry) => !entry || entry.status === "loading")) return true;
      if (activeSideVoiceKeys.includes(gameVoicePlayingKey ?? "")) return true;
      const hasPlayableSideVoice = entries.some((entry) => entry?.status === "ready");
      if (hasPlayableSideVoice && lastAutoPlayedSideVoiceGroupRef.current !== groupKey) return true;
    }

    return false;
  })();

  useEffect(() => {
    lastAutoPlayedVoiceKeyRef.current = null;
    lastAutoPlayedSideVoiceGroupRef.current = null;
    stopGameVoicePlayback();
  }, [activeIndex, activeVoiceKey, stopGameVoicePlayback]);

  useEffect(() => {
    if (gameVoiceEnabled && !isStreaming && !scenePreparing && !directionsActive && !gameVoicePlaybackBlocked) return;
    if (isStreaming || scenePreparing || directionsActive || gameVoicePlaybackBlocked) {
      lastAutoPlayedVoiceKeyRef.current = null;
      lastAutoPlayedSideVoiceGroupRef.current = null;
    }
    stopGameVoicePlayback();
  }, [
    directionsActive,
    gameVoiceEnabled,
    gameVoicePlaybackBlocked,
    isStreaming,
    scenePreparing,
    stopGameVoicePlayback,
  ]);

  useEffect(() => {
    if (!gameVoiceEnabled || !activeVoiceKey) return;
    if (isStreaming || scenePreparing || directionsActive || gameVoicePlaybackBlocked) return;
    if (lastAutoPlayedVoiceKeyRef.current === activeVoiceKey) return;
    const entry = gameVoiceCacheRef.current.get(activeVoiceKey);
    if (!entry || entry.status !== "ready") return;
    lastAutoPlayedVoiceKeyRef.current = activeVoiceKey;
    playGameVoiceKey(activeVoiceKey);
  }, [
    activeVoiceKey,
    directionsActive,
    gameVoiceEnabled,
    gameVoicePlaybackBlocked,
    gameVoiceVersion,
    isStreaming,
    playGameVoiceKey,
    scenePreparing,
  ]);

  useEffect(() => {
    if (!gameVoiceEnabled || activeSideVoiceKeys.length === 0) return;
    if (!doneTyping || isStreaming || scenePreparing || directionsActive || gameVoicePlaybackBlocked) return;

    const sideVoiceGroupKey = activeSideVoiceKeys.join("|");
    if (lastAutoPlayedSideVoiceGroupRef.current === sideVoiceGroupKey) return;

    if (activeVoiceKey) {
      const parentEntry = gameVoiceCacheRef.current.get(activeVoiceKey);
      if (!parentEntry || parentEntry.status === "loading") return;
      if (parentEntry.status === "ready") {
        if (lastAutoPlayedVoiceKeyRef.current !== activeVoiceKey) return;
        if (gameVoicePlayingKey === activeVoiceKey) return;
      }
    }

    const entries = activeSideVoiceKeys.map((key) => gameVoiceCacheRef.current.get(key));
    if (entries.some((entry) => !entry || entry.status === "loading")) return;

    const playableKeys = activeSideVoiceKeys.filter((key, index) => entries[index]?.status === "ready");
    lastAutoPlayedSideVoiceGroupRef.current = sideVoiceGroupKey;
    if (playableKeys.length > 0) playGameVoiceKeys(playableKeys);
  }, [
    activeVoiceKey,
    activeSideVoiceKeys,
    directionsActive,
    doneTyping,
    gameVoiceEnabled,
    gameVoicePlaybackBlocked,
    gameVoicePlayingKey,
    gameVoiceVersion,
    isStreaming,
    playGameVoiceKeys,
    scenePreparing,
  ]);

  useEffect(() => {
    const pendingRequests = gameVoicePendingRef.current;
    const cachedVoices = gameVoiceCacheRef.current;
    return () => {
      stopGameVoicePlayback();
      for (const controller of pendingRequests.values()) {
        controller.abort();
      }
      pendingRequests.clear();
      for (const entry of cachedVoices.values()) {
        if (entry.status === "ready") {
          for (const url of entry.urls) URL.revokeObjectURL(url);
        }
      }
      cachedVoices.clear();
    };
  }, [stopGameVoicePlayback]);

  useEffect(() => {
    if (!active) return;
    // Pause typewriter while direction effects (fades, flashes, etc.) are playing
    if (directionsActive || scenePreparing) return;
    const dispLen = effectDisplayLength(active.content);

    // Sync internal position with React state (handles restore / skip / segment change)
    const tw = twRef.current;
    tw.pos = visibleChars;

    if (tw.pos >= dispLen) return;
    if (gameInstantTextReveal || gameTextSpeed >= 100) {
      // Instant
      tw.pos = dispLen;
      setVisibleChars(dispLen);
      return;
    }
    // Speed 1 → ~18 cps, speed 50 → ~32 cps, speed 99 → ~333 cps (same curve as before).
    const msPerChar = Math.max(3, 60 - gameTextSpeed * 0.58);
    const cps = 1000 / msPerChar;

    // Fixed 30fps tick — one React render per tick, avoids overloading the
    // render pipeline and gives a consistently smooth typewriter cadence.
    const TICK_MS = 33; // ~30 fps
    const charsPerTick = Math.max(1, Math.round((cps * TICK_MS) / 1000));

    const interval = setInterval(() => {
      tw.pos = Math.min(dispLen, tw.pos + charsPerTick);
      setVisibleChars(tw.pos);
      if (tw.pos >= dispLen) clearInterval(interval);
    }, TICK_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, gameInstantTextReveal, gameTextSpeed, directionsActive, scenePreparing]); // visibleChars intentionally excluded — managed internally

  const assetManifest = useGameAssetStore((s) => s.manifest);

  const renderTranslationPanel = useCallback(
    (message: NarrationMessage | null, translatedText?: string, isTranslating = false, className?: string) => {
      if (!message || (!translatedText && !isTranslating)) return null;
      return (
        <div className={cn("rounded-xl border border-sky-400/15 bg-sky-500/8 px-3 py-2.5", className)}>
          <div className="mb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-sky-200/70">Translation</div>
          {translatedText ? (
            <div
              className="game-narration-prose text-sm leading-relaxed text-sky-50/85"
              dangerouslySetInnerHTML={{ __html: getGameTranslationHtml(message, translatedText) }}
            />
          ) : (
            <div className="text-xs text-sky-200/60">Translating...</div>
          )}
        </div>
      );
    },
    [],
  );

  const playClickSfx = useCallback(() => {
    audioManager.playSfx("sfx:ui:click", assetManifest?.assets ?? null);
  }, [assetManifest]);

  const commitLogEdit = useCallback(
    (options: {
      sourceMessageId: string | null;
      sourceSegmentIndex: number;
      canEditMessage: boolean;
      canEditSegment: boolean;
      fallbackSpeaker?: string | null;
    }) => {
      if (!editingLogSeg || !options.sourceMessageId) return;

      const content = logEditDraftRef.current.content.trim();
      if (!content) {
        setEditingLogSeg(null);
        return;
      }

      if (options.canEditMessage) {
        onEditMessage?.(options.sourceMessageId, content);
      } else if (options.canEditSegment) {
        if (editingLogSeg.segmentType === "readable") {
          onEditSegment?.(options.sourceMessageId, options.sourceSegmentIndex, {
            readableContent: content,
            readableType: editingLogSeg.readableType ?? "note",
          });
          setEditingLogSeg(null);
          return;
        }

        const speaker = logEditDraftRef.current.speaker?.trim() || options.fallbackSpeaker?.trim() || undefined;
        onEditSegment?.(
          options.sourceMessageId,
          options.sourceSegmentIndex,
          speaker ? { content, speaker } : { content },
        );
      }

      setEditingLogSeg(null);
    },
    [editingLogSeg, onEditMessage, onEditSegment],
  );

  const nextSegment = useCallback(() => {
    // While reviewing the past, Next / bg-click steps ONE log entry forward —
    // symmetric with wheel-down. The player walks back to the present a step
    // at a time instead of jumping all the way home.
    if (messageOffset > 0) {
      onStepForward?.();
      return;
    }
    if (!active) return;
    if (!doneTyping) {
      twRef.current.pos = activeDisplayLen; // sync so interval stops
      setVisibleChars(activeDisplayLen);
      playClickSfx();
      return;
    }
    if (activeIndex < segments.length - 1) {
      const nextIndex = activeIndex + 1;
      setActiveIndex(nextIndex);
      setVisibleChars(getSegmentStartVisibleChars(nextIndex));
      playClickSfx();
    }
  }, [
    active,
    activeDisplayLen,
    activeIndex,
    doneTyping,
    getSegmentStartVisibleChars,
    messageOffset,
    onStepForward,
    playClickSfx,
    segments.length,
  ]);

  // Background-click forwarding: parent bumps `nextActionToken` whenever the
  // player clicks the bare scene background (with wheel-nav enabled). We treat
  // it as a programmatic press of the Next button.
  const lastNextActionTokenRef = useRef(0);
  useEffect(() => {
    if (!nextActionToken) return;
    if (lastNextActionTokenRef.current === nextActionToken) return;
    lastNextActionTokenRef.current = nextActionToken;
    nextSegment();
  }, [nextActionToken, nextSegment]);

  // Wheel-nav offset transitions:
  //   • 0 → >0: save where the player was reading so Return can land them back there.
  //              Snap auto-play off and jump activeIndex to the last segment of the
  //              past turn (the "ending" of that turn) with visibleChars filled in.
  //   • >0 → >0 (different): re-snap to last segment of the newly-shown past turn.
  //   • >0 → 0: restore the saved activeIndex/visibleChars in the latest turn.
  const prevMessageOffsetRef = useRef(0);
  const savedPresentSegmentRef = useRef<{ index: number; visibleChars: number } | null>(null);
  useEffect(() => {
    const prev = prevMessageOffsetRef.current;
    const next = messageOffset;
    prevMessageOffsetRef.current = next;
    if (prev === next) return;

    if (prev === 0 && next > 0) {
      savedPresentSegmentRef.current = { index: activeIndex, visibleChars };
      setAutoPlay(false);
    }

    if (next > 0) {
      const lastIdx = Math.max(0, segments.length - 1);
      setActiveIndex(lastIdx);
      const seg = segments[lastIdx];
      const dispLen = seg ? effectDisplayLength(seg.content) : 0;
      setVisibleChars(dispLen);
      twRef.current.pos = dispLen;
      return;
    }

    if (prev > 0 && next === 0) {
      const saved = savedPresentSegmentRef.current;
      savedPresentSegmentRef.current = null;
      if (saved && saved.index < segments.length) {
        setActiveIndex(saved.index);
        setVisibleChars(saved.visibleChars);
        twRef.current.pos = saved.visibleChars;
      }
    }
    // Intentionally only react to messageOffset changes — segments/activeIndex
    // are read at transition time and we don't want to re-fire on each segment tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageOffset]);

  // Auto-advance to the next segment after a delay when auto-play is on
  useEffect(() => {
    if (!autoPlay) return;
    if (!active || !doneTyping) return;
    if (isStreaming || partyTurnPending || scenePreparing || directionsActive) return;
    if (autoPlayBlocked) return;
    if (autoPlayVoiceBlocked) return;
    if (editingContent !== null) return;
    if (activeIndex >= segments.length - 1) return; // reached input; stop
    const id = window.setTimeout(() => {
      const nextIndex = Math.min(activeIndex + 1, segments.length - 1);
      setActiveIndex(nextIndex);
      setVisibleChars(getSegmentStartVisibleChars(nextIndex));
      playClickSfx();
    }, gameAutoPlayDelay);
    return () => window.clearTimeout(id);
  }, [
    autoPlay,
    activeIndex,
    doneTyping,
    active,
    segments.length,
    gameAutoPlayDelay,
    isStreaming,
    partyTurnPending,
    scenePreparing,
    directionsActive,
    autoPlayBlocked,
    autoPlayVoiceBlocked,
    editingContent,
    getSegmentStartVisibleChars,
    playClickSfx,
  ]);

  const resolveExpressionAvatar = useCallback(
    (speaker?: string, expression?: string): SpeakerAvatarInfo | null => {
      if (!speaker || !expression || !spriteMap) return null;

      const sprites = findNamedMapValue(spriteMap, speaker);
      if (!sprites?.length) return null;

      const exprKey = normalizeSpriteExpressionKey(expression);
      const expressionSprites = sprites.filter((s) => !s.expression.toLowerCase().startsWith("full_"));
      if (!expressionSprites.length) return null;

      const exact = expressionSprites.find((s) => normalizeSpriteExpressionKey(s.expression) === exprKey);
      if (exact) return { url: exact.url };

      const partial = expressionSprites.find((s) => {
        const spriteKey = normalizeSpriteExpressionKey(s.expression);
        return spriteKey.includes(exprKey) || exprKey.includes(spriteKey);
      });
      if (partial) return { url: partial.url };

      return { url: expressionSprites[0]!.url };
    },
    [spriteMap],
  );

  const activeAvatar = useMemo<SpeakerAvatarInfo | null>(() => {
    if (!active || active.type !== "dialogue" || !active.speaker) return null;
    const expressionAvatar = resolveExpressionAvatar(active.speaker, active.sprite);
    if (expressionAvatar) return expressionAvatar;

    // Fall back to base avatar
    return findNamedMapValue(speakerAvatarInfos, active.speaker) ?? null;
  }, [active, resolveExpressionAvatar, speakerAvatarInfos]);

  const NARRATION_ACTION_BTN =
    "flex items-center gap-1.5 rounded-lg bg-[var(--muted)]/30 px-3 py-1.5 text-xs text-[var(--foreground)]/70 transition-colors hover:bg-[var(--muted)]/50 hover:text-[var(--foreground)] dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20 dark:hover:text-white";
  const NARRATION_META_BTN =
    "flex min-h-7 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-2.5 py-1 text-xs text-[var(--foreground)]/75 transition-colors hover:bg-[var(--muted)]/40 dark:border-white/10 dark:bg-white/5 dark:text-white/75 dark:hover:bg-white/10";

  const handleCopyMessage = useCallback(async (key: string, text: string) => {
    const didCopy = await copyToClipboard(text);
    if (!didCopy) return;
    setCopiedMessageKey(key);
    if (copyResetTimerRef.current != null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopiedMessageKey((current) => (current === key ? null : current));
      copyResetTimerRef.current = null;
    }, 1500);
  }, []);

  const handleInterrupt = useCallback(() => {
    // Request only — the parent opens the confirmation modal. We don't pause
    // here; the parent flips `interruptPending` once the player has confirmed
    // (Yes or Force Interrupt), and the effect below handles the pause then.
    let truncatedContent: string | null = null;
    let truncatedMessageId: string | null = null;
    if (latestAssistant) {
      const editInfo = segmentEditInfoRef.current[activeIndex];
      if (editInfo && editInfo.messageId === latestAssistant.id) {
        const allSegs = parseNarrationSegments(latestAssistant, speakerColors);
        if (editInfo.segmentIndex < allSegs.length - 1) {
          let cutIndex = editInfo.segmentIndex;
          while (cutIndex + 1 < allSegs.length) {
            const nextSegment = allSegs[cutIndex + 1];
            if (nextSegment?.partyType !== "side" && nextSegment?.partyType !== "extra") break;
            cutIndex += 1;
          }
          const next = truncateMessageContentAtSegment(latestAssistant.content || "", cutIndex);
          if (next && next !== latestAssistant.content) {
            truncatedContent = next;
            truncatedMessageId = latestAssistant.id;
          }
        }
      }
    }
    onInterruptRequest?.({ messageId: truncatedMessageId, truncatedContent });
  }, [activeIndex, latestAssistant, onInterruptRequest, speakerColors]);

  const handleResume = useCallback(() => {
    onInterruptCancel?.();
  }, [onInterruptCancel]);

  // Auto-play snapshot/restore: when `interruptPending` flips on we save the
  // current auto-play state and pause; when it flips off (Resume, send, modal
  // dismissed, new GM turn arrived, chat switched) we restore exactly what it
  // was. Also snaps the typewriter so the pause anchor lands at a clean
  // segment boundary.
  const autoPlayBeforeInterruptRef = useRef(false);
  const prevInterruptPendingRef = useRef(false);
  useEffect(() => {
    const wasPending = prevInterruptPendingRef.current;
    const isPending = !!interruptPending;
    prevInterruptPendingRef.current = isPending;
    if (!wasPending && isPending) {
      autoPlayBeforeInterruptRef.current = autoPlay;
      setAutoPlay(false);
      if (active) {
        const dispLen = effectDisplayLength(active.content);
        setVisibleChars(dispLen);
        twRef.current.pos = dispLen;
      }
    } else if (wasPending && !isPending) {
      if (autoPlayBeforeInterruptRef.current) {
        setAutoPlay(true);
      }
      autoPlayBeforeInterruptRef.current = false;
    }
  }, [active, autoPlay, interruptPending]);

  // Shared Next + auto-play control group used by dialogue, narration, and readable boxes.
  // The Interrupt button swaps to a yellow Resume button only AFTER the player
  // confirms in the modal (interruptCommitted). While the modal is still open we keep
  // the red button visible so it doesn't look like the interrupt already happened.
  // While reviewing the past (messageOffset > 0), interrupt controls are hidden and
  // the Next button is forced visible so the player can see and press "Return".
  const reviewingPast = messageOffset > 0;
  const showInterruptControls = !reviewingPast && !narrationComplete && !partyTurnPending && !!onInterruptRequest;
  const showNav = reviewingPast || (!narrationComplete && !isStreaming && !interruptPending);
  const navControls =
    !showInterruptControls && !showNav ? null : (
      <div className="flex h-8 items-stretch gap-1">
        {showInterruptControls && !interruptCommitted && (
          <button
            onClick={handleInterrupt}
            className="flex h-full w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 text-[var(--foreground)]/75 transition-colors hover:bg-[var(--muted)]/40 hover:text-[var(--foreground)] dark:border-white/10 dark:bg-white/5 dark:text-white/75 dark:hover:bg-white/10 dark:hover:text-white"
            title="Pause the GM so you can write back. Nothing is committed until you send."
            aria-label="Interrupt"
          >
            <Square size={11} fill="currentColor" />
          </button>
        )}
        {showInterruptControls && interruptCommitted && (
          <button
            onClick={handleResume}
            className="flex items-center gap-1 self-stretch rounded-lg border border-amber-400/40 bg-amber-400/15 px-2 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-400/25 hover:text-amber-50 sm:px-2.5 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-100 dark:hover:bg-amber-400/25"
            title="Resume narration — your interrupt has not been committed."
            aria-label="Resume"
          >
            <Play size={11} fill="currentColor" />
            <span className="hidden sm:inline">Resume</span>
          </button>
        )}
        {showNav && (
          <>
            {!reviewingPast && (
              <button
                onClick={() => setAutoPlay((v) => !v)}
                className={cn(
                  "flex items-center justify-center self-stretch rounded-lg border px-2 text-xs transition-colors",
                  autoPlay
                    ? "border-[var(--primary)]/40 bg-[var(--primary)]/20 text-[var(--primary)]"
                    : "border-[var(--border)] bg-[var(--muted)]/20 text-[var(--foreground)]/70 hover:bg-[var(--muted)]/40 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10",
                )}
                title={autoPlay ? "Pause auto-play" : "Auto-play segments"}
              >
                {autoPlay ? <Pause size={12} /> : <Play size={12} />}
              </button>
            )}
            {reviewingPast && onJumpToLatest && (
              <button
                onClick={onJumpToLatest}
                className="flex items-center gap-1 self-stretch rounded-lg border border-amber-400/40 bg-amber-400/15 px-2 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-400/25 hover:text-amber-50 sm:px-2.5 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-100 dark:hover:bg-amber-400/25"
                title="Jump back to the present"
                aria-label="Return to present"
              >
                <span className="hidden sm:inline">Return</span>
                <span className="sm:hidden">⤴</span>
              </button>
            )}
            <button
              onClick={nextSegment}
              className="flex items-center justify-center self-stretch rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 text-xs font-semibold text-[var(--foreground)]/75 transition-colors hover:bg-[var(--muted)]/40 dark:border-white/10 dark:bg-white/5 dark:text-white/75 dark:hover:bg-white/10"
            >
              {!doneTyping ? "Reveal" : "Next"}
            </button>
          </>
        )}
      </div>
    );

  const renderStackedLogSegment = (seg: NarrationSegment) => {
    const partyBadge =
      seg.partyType && seg.partyType !== "main" ? (
        <span
          className={cn(
            "ml-1.5 rounded-full px-1.5 py-0.5 text-[0.45rem] font-semibold uppercase tracking-wide",
            seg.partyType === "side" && "bg-sky-500/15 text-sky-200/70",
            seg.partyType === "extra" && "bg-sky-500/15 text-sky-200/70",
            seg.partyType === "thought" && "bg-purple-500/15 text-purple-200/70",
            seg.partyType === "whisper" && "bg-rose-500/15 text-rose-200/70",
          )}
        >
          {PARTY_TYPE_ICONS[seg.partyType] ?? ""} {seg.partyType}
          {seg.partyType === "whisper" && seg.whisperTarget && ` -> ${seg.whisperTarget}`}
        </span>
      ) : null;

    const voiceKey = getVoiceKeyForSegment(seg);
    const voiceEntry = voiceKey ? gameVoiceCacheRef.current.get(voiceKey) : undefined;
    const voicePaused = gameVoicePausedKey === voiceKey;
    const voiceActive = gameVoicePlayingKey === voiceKey;
    const voiceButton =
      voiceKey && voiceEntry && voiceEntry.status !== "error" ? (
        <span className="ml-1 inline-flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => toggleGameVoiceKey(voiceKey)}
            disabled={voiceEntry.status === "loading"}
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--foreground)]/45 transition-colors hover:bg-[var(--muted)]/40 hover:text-sky-200 disabled:cursor-wait disabled:opacity-60 dark:text-white/45 dark:hover:bg-white/10",
              voiceActive && "bg-sky-400/15 text-sky-200 dark:text-sky-200",
            )}
            title={
              voiceEntry.status === "loading"
                ? "Generating voice-over"
                : voiceActive
                  ? voicePaused
                    ? "Resume voice-over"
                    : "Pause voice-over"
                  : "Play voice-over"
            }
          >
            {voiceEntry.status === "loading" ? (
              <Loader2 size={11} className="animate-spin" />
            ) : voiceActive ? (
              voicePaused ? (
                <Play size={11} />
              ) : (
                <Pause size={11} />
              )
            ) : (
              <Volume2 size={11} />
            )}
          </button>
          {voiceActive && voiceEntry.status === "ready" && (
            <>
              <button
                type="button"
                onClick={() => restartGameVoiceKey(voiceKey)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-sky-200 transition-colors hover:bg-[var(--muted)]/40 dark:hover:bg-white/10"
                title="Restart voice-over"
              >
                <RotateCcw size={11} />
              </button>
              <button
                type="button"
                onClick={stopGameVoicePlayback}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-sky-200 transition-colors hover:bg-[var(--muted)]/40 dark:hover:bg-white/10"
                title="Stop voice-over"
              >
                <VolumeX size={11} />
              </button>
            </>
          )}
        </span>
      ) : null;

    if (seg.type === "dialogue") {
      const logAvatar = seg.speaker ? findNamedMapValue(speakerAvatarInfos, seg.speaker) : null;
      return (
        <div
          key={seg.id}
          className={cn(
            "flex gap-2 rounded-lg border px-2.5 py-2",
            seg.partyType === "thought"
              ? "border-purple-400/10 bg-purple-950/15"
              : seg.partyType === "whisper"
                ? "border-rose-400/10 bg-rose-950/15"
                : seg.partyType === "side" || seg.partyType === "extra"
                  ? "border-sky-400/10 bg-sky-950/15"
                  : "border-[var(--border)] bg-[var(--muted)]/20 dark:border-white/5 dark:bg-black/20",
          )}
        >
          {logAvatar ? (
            <CroppedAvatar
              src={logAvatar.url}
              alt={seg.speaker || ""}
              crop={logAvatar.crop}
              className="h-7 w-7 shrink-0 rounded-lg border border-[var(--border)] dark:border-white/10"
            />
          ) : (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--accent)] text-[0.5rem] font-bold dark:border-white/10">
              {(seg.speaker || "?")[0]}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center">
              <span
                className="min-w-0 truncate text-[0.6875rem] font-bold"
                style={
                  nameColorStyle(findNamedMapValue(speakerNameColors, seg.speaker ?? "") ?? seg.color) ?? {
                    color: "rgb(186 230 253)",
                  }
                }
              >
                {seg.speaker || "Dialogue"}
              </span>
              {partyBadge}
              {voiceButton}
            </div>
            <div
              className={cn(
                "mt-0.5 text-xs leading-relaxed text-[var(--foreground)]/80 dark:text-white/80",
                seg.partyType === "thought" ? "italic opacity-80" : "font-semibold",
              )}
              style={seg.color ? { ...narrationFontStyle, color: seg.color } : narrationFontStyle}
              dangerouslySetInnerHTML={{ __html: animateTextHtml(formatNarration(seg.content, false)) }}
            />
          </div>
        </div>
      );
    }

    if (seg.type === "system") {
      return (
        <div key={seg.id} className="rounded-lg border border-cyan-400/15 bg-cyan-950/15 px-2.5 py-2 text-cyan-50/80">
          <div className="mb-1 text-[0.6rem] font-semibold uppercase tracking-wide text-cyan-200/80">System</div>
          <div
            className="whitespace-pre-wrap break-words text-xs leading-relaxed"
            style={narrationFontStyle}
            dangerouslySetInnerHTML={{ __html: animateTextHtml(formatNarration(seg.content, false)) }}
          />
        </div>
      );
    }

    if (seg.type === "readable") {
      return (
        <div key={seg.id} className="rounded-lg border border-amber-400/15 bg-amber-950/15 px-2.5 py-2">
          <div className="mb-1 text-[0.6rem] font-semibold uppercase tracking-wide text-amber-300/80">
            {seg.readableType === "book" ? "Book" : "Note"}
          </div>
          <div
            className="text-xs italic leading-relaxed text-amber-200/70"
            style={narrationFontStyle}
            dangerouslySetInnerHTML={{
              __html: animateTextHtml(formatNarration(seg.readableContent ?? seg.content, false)),
            }}
          />
        </div>
      );
    }

    return (
      <div
        key={seg.id}
        className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-2.5 py-2 dark:border-white/5 dark:bg-black/20"
      >
        <div className="mb-1 flex items-center">
          <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--foreground)]/75 dark:text-white/80">
            Narration
          </span>
          {voiceButton}
        </div>
        <div
          className="text-xs leading-relaxed text-[var(--foreground)]/80 dark:text-white/80"
          style={narrationStyle}
          dangerouslySetInnerHTML={{ __html: animateTextHtml(formatNarration(seg.content, false)) }}
        />
      </div>
    );
  };

  return (
    <div className="relative flex min-h-0 flex-1 items-end px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-20 md:pt-24 sm:px-6 md:pb-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/15 to-transparent" />

      <div
        data-tour="game-dialogue"
        className="relative z-10 mx-auto flex max-h-[calc(100svh-7rem)] min-h-0 w-full max-w-4xl flex-col md:max-h-[calc(100svh-8rem)]"
      >
        {useStackedLogDisplay && stackedLogEntries.length > 0 && (
          <div
            className="mb-2 rounded-2xl border border-[var(--border)] bg-[var(--card)]/70 p-2 shadow-[0_16px_38px_rgba(0,0,0,0.35)] backdrop-blur-md dark:border-white/10 dark:bg-black/40"
            data-game-skip-bg-nav="true"
          >
            <div
              ref={stackedLogRef}
              className="flex max-h-[22svh] min-h-0 flex-col gap-1.5 overflow-y-auto pr-1 sm:max-h-[26svh] md:max-h-[32svh]"
              onScroll={(e) => {
                const el = e.currentTarget;
                setStackedLogPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
              }}
            >
              {stackedLogEntries.map((entry) => (
                <div key={entry.messageId} className="space-y-1.5">
                  {entry.segments.map((seg) => renderStackedLogSegment(seg))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Side remarks — small floating box shown with the dialogue they follow */}
        {activeSideLines.length > 0 && doneTyping && (
          <div className="relative z-20 mb-2 flex max-h-[min(16rem,38vh)] w-full flex-col space-y-1.5 overflow-x-hidden overflow-y-auto pr-1">
            {activeSideLines.map((line, i) => {
              const expressionAvatar =
                line.type === "side" || line.type === "extra"
                  ? resolveExpressionAvatar(line.character, line.expression)
                  : null;
              const charAvatar = expressionAvatar ?? findNamedMapValue(speakerAvatarInfos, line.character) ?? null;
              const charColor = findNamedMapValue(speakerColors, line.character);
              const charNameColor = findNamedMapValue(speakerNameColors, line.character);
              return (
                <div
                  key={`${line.character}-side-${i}`}
                  className="flex w-full justify-end animate-party-slide-in"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <PartyOverlayBox line={line} avatar={charAvatar} color={charColor} nameColor={charNameColor} />
                </div>
              );
            })}
          </div>
        )}

        {/* Party turn loading indicator — only show as banner when player input isn't the active VN segment */}
        {partyTurnPending && !scenePreparing && !active?.id?.startsWith("party-chat-input-") && (
          <div className="mb-2 flex items-center gap-1.5 rounded-xl border border-sky-500/15 bg-sky-500/5 px-3 py-1.5 backdrop-blur-md">
            <MessageCircle size={12} className="animate-pulse text-sky-300/70" />
            <span className="text-[0.6875rem] text-sky-200/60">The party is reacting...</span>
          </div>
        )}

        {/* Choice cards from GM — rendered above narration so they don't overlap */}
        {choicesSlot}

        {/* Widget slot — mobile widget icons sit above the narration box */}
        {widgetSlot}

        {/* Skill check result — shown above the narration box until dismissed */}
        {skillCheckSlot}

        {/* Dice roll result — shown closest to the narration box until dismissed */}
        {diceResultSlot}

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)]/90 p-3 backdrop-blur-md shadow-[0_16px_38px_rgba(0,0,0,0.45)] dark:border-white/15 dark:bg-black/50">
          {/* Scene preparation gate: wait for effects before showing narration */}
          {scenePreparing && (
            <div className="flex items-center gap-2 py-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--muted)]/40 border-t-[var(--foreground)]/70 dark:border-white/30 dark:border-t-white" />
              <span className="text-sm text-[var(--muted-foreground)] dark:text-white/70">
                {assetsGenerating ? "Generating sprites…" : "Preparing scene…"}
              </span>
            </div>
          )}

          {/* Scene analysis failed: show retry / skip inline only when no narration content available */}
          {sceneAnalysisFailed && !active && (
            <div className="flex flex-col items-center gap-2 py-3">
              <span className="text-sm text-red-300/80">Scene analysis failed</span>
              <div className="flex gap-2">
                {onRetryScene && (
                  <button onClick={onRetryScene} className={NARRATION_ACTION_BTN}>
                    <RefreshCw size={12} />
                    Retry
                  </button>
                )}
                {onSkipScene && (
                  <button onClick={onSkipScene} className={NARRATION_ACTION_BTN}>
                    Skip
                  </button>
                )}
              </div>
            </div>
          )}

          {/* GM generation failed — show inline retry */}
          {generationFailed && !isStreaming && !scenePreparing && !sceneAnalysisFailed && onRetryGeneration && (
            <div className="flex items-center gap-2 py-3">
              <span className="text-sm text-red-300/80">Generation failed</span>
              <button
                onClick={onRetryGeneration}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--muted)]/30 px-3 py-1.5 text-xs text-[var(--foreground)]/70 transition-colors hover:bg-[var(--muted)]/50 hover:text-[var(--foreground)] dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20 dark:hover:text-white"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          )}

          {!scenePreparing && !active && !isStreaming && !sceneAnalysisFailed && (
            <p className="text-sm text-[var(--muted-foreground)]">Send an action to begin the scene.</p>
          )}

          {!scenePreparing && active && active.type === "dialogue" && (
            <>
              {/* VN-style dialogue: avatar left, text right, name top-left */}
              {(() => {
                const activeCanUploadPortrait = canUploadNpcPortrait(active.speaker);
                const activeCanGeneratePortrait = canGenerateNpcPortrait(active.speaker);
                const activePortraitGenerating = isNpcPortraitGenerating(active.speaker);
                return (
                  <div className="flex min-w-0 gap-3 max-[420px]:gap-2" style={gameAvatarScaleStyle}>
                    {/* Left: Speaker avatar with reaction indicator */}
                    <div className="relative flex shrink-0 flex-col items-center gap-1">
                      {activeCanUploadPortrait ? (
                        <div className="group/avatar relative">
                          <button
                            type="button"
                            onClick={() => triggerNpcPortraitUpload(active.speaker)}
                            className="rounded-xl transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-white/30"
                            title="Upload or replace NPC portrait"
                          >
                            {activeAvatar ? (
                              <CroppedAvatar
                                src={activeAvatar.url}
                                alt={active.speaker || ""}
                                crop={activeAvatar.crop}
                                className={cn(GAME_DIALOGUE_AVATAR_CLASS, "transition-colors hover:border-white/30")}
                              />
                            ) : (
                              <img
                                src="/npc-silhouette.svg"
                                alt={active.speaker || "?"}
                                className={cn(
                                  GAME_DIALOGUE_AVATAR_CLASS,
                                  "object-cover transition-colors hover:border-white/30",
                                )}
                              />
                            )}
                          </button>
                          {activeCanGeneratePortrait && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                triggerNpcPortraitGenerate(active.speaker);
                              }}
                              disabled={activePortraitGenerating}
                              className="absolute right-0.5 top-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-[var(--primary)] opacity-0 shadow-lg ring-1 ring-white/15 transition-opacity hover:bg-black/85 disabled:cursor-wait group-hover/avatar:opacity-100 max-md:opacity-100"
                              title="Generate NPC portrait"
                            >
                              {activePortraitGenerating ? (
                                <Loader2 size="0.75rem" className="animate-spin" />
                              ) : (
                                <Wand2 size="0.75rem" />
                              )}
                            </button>
                          )}
                        </div>
                      ) : activeAvatar ? (
                        <CroppedAvatar
                          src={activeAvatar.url}
                          alt={active.speaker || ""}
                          crop={activeAvatar.crop}
                          className={GAME_DIALOGUE_AVATAR_CLASS}
                        />
                      ) : (
                        <img
                          src="/npc-silhouette.svg"
                          alt={active.speaker || "?"}
                          className={cn(GAME_DIALOGUE_AVATAR_CLASS, "object-cover")}
                        />
                      )}
                      <ExpressionReaction expression={active.sprite} />
                    </div>

                    {/* Right: Name + Dialogue text */}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="mb-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-sm font-bold"
                            style={
                              nameColorStyle(
                                findNamedMapValue(speakerNameColors, active.speaker ?? "") ?? active.color,
                              ) ?? { color: "rgb(186 230 253)" }
                            }
                          >
                            {active.speaker || "Dialogue"}
                          </span>
                          {active.partyType && active.partyType !== "main" && (
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[0.5rem] font-semibold uppercase tracking-wide",
                                active.partyType === "thought" && "bg-purple-500/15 text-purple-200/70",
                                active.partyType === "whisper" && "bg-rose-500/15 text-rose-200/70",
                              )}
                            >
                              {PARTY_TYPE_ICONS[active.partyType] ?? ""} {active.partyType}
                              {active.partyType === "whisper" && active.whisperTarget && ` → ${active.whisperTarget}`}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="relative">
                        <div
                          className={cn(
                            "game-narration-prose max-h-40 overflow-y-auto rounded-xl border px-3 py-2.5 sm:max-h-48",
                            active.partyType === "thought"
                              ? "border-purple-400/10 bg-purple-950/20"
                              : active.partyType === "whisper"
                                ? "border-rose-400/10 bg-rose-950/20"
                                : "border-[var(--border)] bg-[var(--muted)]/20 dark:border-white/10 dark:bg-black/35",
                          )}
                        >
                          {editingContent !== null ? (
                            <textarea
                              ref={editTextareaRef}
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="w-full resize-none bg-transparent text-sm leading-relaxed text-[var(--foreground)] outline-none"
                              style={narrationFontStyle}
                              rows={3}
                              autoFocus
                            />
                          ) : (
                            <div
                              className={cn(
                                "text-sm leading-relaxed",
                                active.partyType === "thought" ? "italic opacity-80" : "font-semibold",
                                doneTyping
                                  ? ""
                                  : "after:ml-0.5 after:inline-block after:h-4 after:w-[1px] after:animate-pulse after:bg-[var(--foreground)]/60 after:align-middle dark:after:bg-white/60",
                              )}
                              style={
                                active.color
                                  ? ({
                                      ...narrationFontStyle,
                                      color: active.color,
                                      "--speaker-color": active.color,
                                    } as CSSProperties)
                                  : narrationStyle
                              }
                              dangerouslySetInnerHTML={{
                                __html: animateTextHtml(
                                  formatNarration(slicePreservingEffects(active.content, visibleChars), false),
                                ),
                              }}
                            />
                          )}
                        </div>
                        {/* Edit button */}
                        {activeCanEditSegment && (
                          <button
                            type="button"
                            onClick={() => setEditingContent(active.content)}
                            className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--muted-foreground)]/40 transition-colors hover:bg-[var(--muted)]/30 hover:text-[var(--muted-foreground)] dark:text-white/20 dark:hover:bg-white/10 dark:hover:text-white/60"
                            title="Edit"
                          >
                            <Pencil size={11} />
                          </button>
                        )}
                        {editingContent !== null && (
                          <button
                            type="button"
                            onClick={() => {
                              if (editingContent.trim() && onEditSegment) {
                                const ei = segmentEditInfoRef.current[activeIndex];
                                if (ei)
                                  onEditSegment(ei.messageId, ei.segmentIndex, { content: editingContent.trim() });
                              }
                              setEditingContent(null);
                            }}
                            className="absolute right-1.5 top-1.5 rounded bg-emerald-500/20 p-1 text-emerald-300 transition-colors hover:bg-emerald-500/30"
                            title="Save"
                          >
                            <Check size={11} />
                          </button>
                        )}
                        {editingContent === null && activeCopyKey && (
                          <button
                            type="button"
                            onClick={() => {
                              void handleCopyMessage(activeCopyKey, activeCopyText);
                            }}
                            className={cn(
                              "absolute top-1.5 rounded p-1 text-[var(--muted-foreground)]/40 transition-colors hover:bg-[var(--muted)]/30 hover:text-[var(--muted-foreground)] dark:text-white/20 dark:hover:bg-white/10 dark:hover:text-white/60",
                              activeCanEditSegment ? "right-7" : "right-1.5",
                            )}
                            title="Copy"
                          >
                            {copiedMessageKey === activeCopyKey ? <Check size={11} /> : <Copy size={11} />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Inline party loading indicator — shown beneath the player's input dialogue */}
              {partyTurnPending && active.id?.startsWith("party-chat-input-") && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <MessageCircle size={12} className="animate-pulse text-sky-300/70" />
                  <span className="text-xs text-sky-200/60">The party is reacting...</span>
                </div>
              )}

              {doneTyping &&
                renderTranslationPanel(activeSourceMessage, activeTranslatedText, activeIsTranslating, "mt-2")}

              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {showLogsButton && (
                    <button
                      onClick={() => setLogsOpen(true)}
                      disabled={logEntries.length === 0}
                      className={cn(NARRATION_META_BTN, "disabled:opacity-40")}
                    >
                      <ScrollText size={12} />
                      <span className="hidden sm:inline">Logs</span>
                    </button>
                  )}
                  {onOpenInventory && (
                    <button onClick={onOpenInventory} className={cn("relative", NARRATION_META_BTN)}>
                      <Package size={12} />
                      <span className="hidden sm:inline">Inventory</span>
                      {(inventoryCount ?? 0) > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[0.55rem] font-bold text-black">
                          {inventoryCount}
                        </span>
                      )}
                    </button>
                  )}
                </div>
                {navControls}
              </div>
            </>
          )}

          {!scenePreparing && active && active.type === "narration" && (
            <>
              {/* Narration: centered, no avatar */}
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="rounded-full bg-[var(--muted)]/30 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--foreground)]/90 dark:bg-white/10 dark:text-white/90">
                  Narration
                </span>
              </div>

              <div className="relative game-narration-prose max-h-40 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2.5 sm:max-h-48 dark:border-white/10 dark:bg-black/35">
                {editingContent !== null ? (
                  <textarea
                    ref={editTextareaRef}
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    className="w-full resize-none bg-transparent text-sm leading-relaxed text-[var(--foreground)] outline-none"
                    style={narrationFontStyle}
                    rows={3}
                    autoFocus
                  />
                ) : (
                  <div
                    className={cn(
                      "text-sm leading-relaxed",
                      doneTyping
                        ? ""
                        : "after:ml-0.5 after:inline-block after:h-4 after:w-[1px] after:animate-pulse after:bg-[var(--foreground)]/60 after:align-middle dark:after:bg-white/60",
                    )}
                    style={narrationStyle}
                    dangerouslySetInnerHTML={{
                      __html: animateTextHtml(
                        formatNarration(slicePreservingEffects(active.content, visibleChars), false),
                      ),
                    }}
                  />
                )}
                {/* Edit button */}
                {activeCanEditSegment && (
                  <button
                    type="button"
                    onClick={() => setEditingContent(active.content)}
                    className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--muted-foreground)]/40 transition-colors hover:bg-[var(--muted)]/30 hover:text-[var(--muted-foreground)] dark:text-white/20 dark:hover:bg-white/10 dark:hover:text-white/60"
                    title="Edit"
                  >
                    <Pencil size={11} />
                  </button>
                )}
                {editingContent !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      if (editingContent.trim() && onEditSegment) {
                        const ei = segmentEditInfoRef.current[activeIndex];
                        if (ei) onEditSegment(ei.messageId, ei.segmentIndex, { content: editingContent.trim() });
                      }
                      setEditingContent(null);
                    }}
                    className="absolute right-1.5 top-1.5 rounded bg-emerald-500/20 p-1 text-emerald-300 transition-colors hover:bg-emerald-500/30"
                    title="Save"
                  >
                    <Check size={11} />
                  </button>
                )}
                {editingContent === null && activeCopyKey && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleCopyMessage(activeCopyKey, activeCopyText);
                    }}
                    className={cn(
                      "absolute top-1.5 rounded p-1 text-[var(--muted-foreground)]/40 transition-colors hover:bg-[var(--muted)]/30 hover:text-[var(--muted-foreground)] dark:text-white/20 dark:hover:bg-white/10 dark:hover:text-white/60",
                      activeCanEditSegment ? "right-7" : "right-1.5",
                    )}
                    title="Copy"
                  >
                    {copiedMessageKey === activeCopyKey ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                )}
              </div>

              {doneTyping &&
                renderTranslationPanel(activeSourceMessage, activeTranslatedText, activeIsTranslating, "mt-2")}

              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {showLogsButton && (
                    <button
                      onClick={() => setLogsOpen(true)}
                      disabled={logEntries.length === 0}
                      className={cn(NARRATION_META_BTN, "disabled:opacity-40")}
                    >
                      <ScrollText size={12} />
                      <span className="hidden sm:inline">Logs</span>
                    </button>
                  )}
                  {onOpenInventory && (
                    <button onClick={onOpenInventory} className={cn("relative", NARRATION_META_BTN)}>
                      <Package size={12} />
                      <span className="hidden sm:inline">Inventory</span>
                      {(inventoryCount ?? 0) > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[0.55rem] font-bold text-black">
                          {inventoryCount}
                        </span>
                      )}
                    </button>
                  )}
                </div>
                {navControls}
              </div>
            </>
          )}

          {/* Readable segment: note or book found in the narrative */}
          {!scenePreparing && active && active.type === "readable" && (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="rounded-full bg-[var(--muted)]/30 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--foreground)]/70 dark:bg-white/10 dark:text-white/70">
                  {active.readableType === "book" ? "Book" : "Note"}
                </span>
              </div>

              <div className="relative game-narration-prose max-h-40 overflow-y-auto rounded-xl border border-amber-400/20 bg-amber-950/20 px-3 py-2.5 sm:max-h-48">
                <div
                  className={cn(
                    "text-sm italic leading-relaxed text-amber-200/80",
                    doneTyping
                      ? ""
                      : "after:ml-0.5 after:inline-block after:h-4 after:w-[1px] after:animate-pulse after:bg-amber-200/60 after:align-middle",
                  )}
                  style={narrationFontStyle}
                  dangerouslySetInnerHTML={{
                    __html: animateTextHtml(
                      formatNarration(slicePreservingEffects(active.content, visibleChars), false),
                    ),
                  }}
                />
                {activeCopyKey && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleCopyMessage(activeCopyKey, activeCopyText);
                    }}
                    className="absolute right-1.5 top-1.5 rounded p-1 text-amber-200/45 transition-colors hover:bg-amber-100/10 hover:text-amber-100/70"
                    title="Copy"
                  >
                    {copiedMessageKey === activeCopyKey ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                )}
              </div>

              {doneTyping &&
                renderTranslationPanel(activeSourceMessage, activeTranslatedText, activeIsTranslating, "mt-2")}

              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {showLogsButton && (
                    <button
                      onClick={() => setLogsOpen(true)}
                      disabled={logEntries.length === 0}
                      className={cn(NARRATION_META_BTN, "disabled:opacity-40")}
                    >
                      <ScrollText size={12} />
                      <span className="hidden sm:inline">Logs</span>
                    </button>
                  )}
                </div>
                {navControls}
              </div>
            </>
          )}

          {/* Inline input — appears inside the narration box once all segments are read,
              or after the player has CONFIRMED an interrupt (not just opened the modal).
              Gating on `interruptCommitted` (not `interruptPending`) keeps the input bar
              from showing in the background while the confirmation modal is still open.
              While reviewing the past via wheel-nav, the input is hidden — the player is
              looking at history, not typing. */}
          {!scenePreparing &&
            !reviewingPast &&
            (narrationComplete || interruptCommitted) &&
            !isStreaming &&
            !partyTurnPending &&
            inputSlot && <div className="mt-2">{inputSlot}</div>}

          {/* Also show input when no narration at all (start of scene) */}
          {!scenePreparing && !active && !isStreaming && !sceneAnalysisFailed && inputSlot && (
            <div className="mt-2">
              {showLogsButton && logEntries.length > 0 && (
                <div className="mb-2">
                  <button
                    onClick={() => setLogsOpen(true)}
                    className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/75 transition-colors hover:bg-white/10"
                  >
                    <ScrollText size={12} />
                    <span className="hidden sm:inline">Logs</span>
                  </button>
                </div>
              )}
              {inputSlot}
            </div>
          )}

          {isStreaming && (
            <div className="mt-2 flex items-center gap-1 text-xs text-[var(--foreground)]/50">
              <span className="animate-pulse">●</span>
              <span>The Game Master is writing the next segment...</span>
            </div>
          )}
        </div>
      </div>

      {/* Logs modal */}
      {logsOpen && showLogsButton && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          data-game-skip-bg-nav="true"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setLogsOpen(false);
            setEditingLogSeg(null);
            logScrolledRef.current = false;
          }}
        >
          <div
            className="relative mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-white/15 bg-[var(--card)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white">Session Logs</h3>
                {logEntries.length > 0 && (
                  <p className="text-[0.65rem] text-white/45">
                    Showing {visibleLogEntries.length} of {logEntries.length}
                    {sessionHistoryTokens > 0 && (
                      <span title="Approximate tokens in the current session's loaded chat history.">
                        {" | ~"}
                        {formatTokenEstimate(sessionHistoryTokens)} tokens
                      </span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {hiddenLogCount > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={loadOlderLogs}
                      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[0.65rem] font-medium text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                      title="Load older logs"
                    >
                      Older ({hiddenLogCount})
                    </button>
                    <button
                      type="button"
                      onClick={showAllLogs}
                      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[0.65rem] font-medium text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                      title="Load the entire session log"
                    >
                      All
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    setLogsOpen(false);
                    setEditingLogSeg(null);
                    logScrolledRef.current = false;
                  }}
                  className="rounded-lg p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div
              className="flex-1 overflow-y-auto px-4 py-3 space-y-4"
              onScroll={(e) => {
                if (hiddenLogCount <= 0) return;
                if (e.currentTarget.scrollTop <= 8) loadOlderLogs();
              }}
              ref={(el) => {
                logScrollContainerRef.current = el;
                // Auto-scroll to bottom once so the user sees the most recent logs
                if (el && !logScrolledRef.current) {
                  logScrolledRef.current = true;
                  requestAnimationFrame(() => {
                    el.scrollTop = el.scrollHeight;
                  });
                }
              }}
            >
              {logEntries.length === 0 && (
                <p className="text-sm text-[var(--muted-foreground)]">No previous logs yet.</p>
              )}
              {hiddenLogCount > 0 && (
                <div className="flex justify-center pb-2">
                  <button
                    type="button"
                    onClick={() => {
                      logScrolledRef.current = true;
                      loadOlderLogs();
                    }}
                    className="rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-xs font-medium text-white/70 shadow-lg transition-colors hover:bg-white/10 hover:text-white"
                  >
                    Show more older logs ({hiddenLogCount})
                  </button>
                </div>
              )}
              {visibleLogEntries.map((entry) => {
                const sourceMessage = sourceMessagesById.get(entry.messageId) ?? null;
                const translatedEntryText = sourceMessage ? translations[entry.messageId] : undefined;
                const entryIsTranslating = sourceMessage ? !!translating[entry.messageId] : false;
                return (
                  <div key={entry.messageId} className="space-y-1.5">
                    {entry.segments.map((seg) => {
                      const sourceMessageId = seg.sourceMessageId ?? entry.messageId;
                      const hasSourceSegmentIndex = seg.sourceSegmentIndex != null;
                      const sourceSegmentIndex = seg.sourceSegmentIndex ?? 0;
                      const sourceRole =
                        seg.sourceRole ??
                        (sourceMessageId ? (sourceMessagesById.get(sourceMessageId)?.role ?? null) : null);
                      const isActiveSeg = active?.id === seg.id;
                      const liveSegmentIndex = segments.findIndex((s) => s.id === seg.id);
                      const canJumpToSeg =
                        !!latestAssistant &&
                        sourceMessageId === latestAssistant.id &&
                        liveSegmentIndex >= 0 &&
                        liveSegmentIndex !== activeIndex;
                      const performJump = () => {
                        setActiveIndex(liveSegmentIndex);
                        setVisibleChars(getSegmentStartVisibleChars(liveSegmentIndex));
                        setLogsOpen(false);
                        setEditingLogSeg(null);
                        logScrolledRef.current = false;
                        playClickSfx();
                      };
                      const isInteractiveTarget = (target: EventTarget | null) =>
                        target instanceof Element && !!target.closest("button, input, textarea, a");
                      const jumpRowProps = canJumpToSeg
                        ? {
                            role: "button" as const,
                            tabIndex: 0,
                            title: "Jump back to this segment",
                            onClick: (e: ReactMouseEvent<HTMLDivElement>) => {
                              if (isInteractiveTarget(e.target)) return;
                              performJump();
                            },
                            onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
                              if (e.key !== "Enter" && e.key !== " ") return;
                              if (isInteractiveTarget(e.target)) return;
                              e.preventDefault();
                              performJump();
                            },
                          }
                        : null;
                      const jumpRowClasses = canJumpToSeg
                        ? "cursor-pointer hover:ring-1 hover:ring-white/15 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
                        : "";
                      const canEditMessage = !!onEditMessage && !!sourceMessageId && sourceRole === "user";
                      const canEditSegment =
                        !!onEditSegment &&
                        !!sourceMessageId &&
                        hasSourceSegmentIndex &&
                        sourceRole !== "user" &&
                        sourceRole !== "system" &&
                        sourceMessageId !== "party-chat";
                      const canEdit = canEditMessage || canEditSegment;
                      const canDeleteMessage =
                        !!onDeleteMessage && !!sourceMessageId && (sourceRole === "user" || sourceRole === "system");
                      const canDeleteThisSegment =
                        !!onDeleteSegment &&
                        !!sourceMessageId &&
                        hasSourceSegmentIndex &&
                        sourceRole !== "user" &&
                        sourceRole !== "system" &&
                        sourceMessageId !== "party-chat";
                      const isEditingThis =
                        editingLogSeg?.messageId === sourceMessageId && editingLogSeg?.segIndex === sourceSegmentIndex;
                      const isSelectedForDeletion =
                        multiSelectMode && !!sourceMessageId && selectedMessageIds?.has(sourceMessageId) === true;
                      const showDeleteButton = canDeleteMessage || canDeleteThisSegment;
                      const copyKey =
                        sourceMessageId && hasSourceSegmentIndex
                          ? `log:${sourceMessageId}:${sourceSegmentIndex}`
                          : sourceMessageId
                            ? `log:${sourceMessageId}`
                            : null;
                      const logAnchorKey =
                        sourceMessageId && hasSourceSegmentIndex
                          ? `${sourceMessageId}:${sourceSegmentIndex}`
                          : `${entry.messageId}:${seg.id}`;
                      const copyText = seg.readableContent ?? stripGmTagsKeepReadables(seg.content);
                      const copyButton = copyKey ? (
                        <button
                          type="button"
                          onClick={() => {
                            void handleCopyMessage(copyKey, copyText);
                          }}
                          className="rounded p-1 text-white/45 opacity-100 transition-all hover:bg-white/10 hover:text-white/60 md:text-white/20 md:opacity-0 md:group-hover/logseg:opacity-100"
                          title="Copy"
                        >
                          {copiedMessageKey === copyKey ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                      ) : null;
                      const deleteButton = showDeleteButton ? (
                        <button
                          type="button"
                          onClick={() => {
                            captureLogScrollAnchor();
                            if (canDeleteMessage && sourceMessageId) {
                              onDeleteMessage?.(sourceMessageId);
                            } else if (canDeleteThisSegment && sourceMessageId) {
                              onDeleteSegment?.(sourceMessageId, sourceSegmentIndex);
                            }
                          }}
                          className="rounded p-1 text-white/45 opacity-100 transition-all hover:bg-red-500/20 hover:text-red-400 md:text-white/20 md:opacity-0 md:group-hover/logseg:opacity-100"
                          title={canDeleteThisSegment ? "Delete segment" : "Delete message"}
                        >
                          <Trash2 size={11} />
                        </button>
                      ) : null;
                      // Party-type badge for side/extra/thought/whisper
                      const partyBadge =
                        seg.partyType && seg.partyType !== "main" ? (
                          <span
                            className={cn(
                              "ml-1.5 rounded-full px-1.5 py-0.5 text-[0.45rem] font-semibold uppercase tracking-wide",
                              seg.partyType === "side" && "bg-sky-500/15 text-sky-200/70",
                              seg.partyType === "extra" && "bg-sky-500/15 text-sky-200/70",
                              seg.partyType === "thought" && "bg-purple-500/15 text-purple-200/70",
                              seg.partyType === "whisper" && "bg-rose-500/15 text-rose-200/70",
                            )}
                          >
                            {PARTY_TYPE_ICONS[seg.partyType] ?? ""} {seg.partyType}
                            {seg.partyType === "whisper" && seg.whisperTarget && ` → ${seg.whisperTarget}`}
                          </span>
                        ) : null;

                      const voiceKey = getVoiceKeyForSegment(seg);
                      const voiceEntry = voiceKey ? gameVoiceCacheRef.current.get(voiceKey) : undefined;
                      const voicePaused = gameVoicePausedKey === voiceKey;
                      const voiceActive = gameVoicePlayingKey === voiceKey;
                      const voiceButton =
                        voiceKey && voiceEntry && voiceEntry.status !== "error" ? (
                          <span className="ml-1 inline-flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => toggleGameVoiceKey(voiceKey)}
                              disabled={voiceEntry.status === "loading"}
                              className={cn(
                                "inline-flex h-5 w-5 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-sky-200 disabled:cursor-wait disabled:opacity-60",
                                voiceActive && "bg-sky-400/15 text-sky-200",
                              )}
                              title={
                                voiceEntry.status === "loading"
                                  ? "Generating voice-over"
                                  : voiceActive
                                    ? voicePaused
                                      ? "Resume voice-over"
                                      : "Pause voice-over"
                                    : "Play voice-over"
                              }
                            >
                              {voiceEntry.status === "loading" ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : voiceActive ? (
                                voicePaused ? (
                                  <Play size={11} />
                                ) : (
                                  <Pause size={11} />
                                )
                              ) : (
                                <Volume2 size={11} />
                              )}
                            </button>
                            {voiceActive && voiceEntry.status === "ready" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => restartGameVoiceKey(voiceKey)}
                                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-sky-200 transition-colors hover:bg-white/10"
                                  title="Restart voice-over"
                                >
                                  <RotateCcw size={11} />
                                </button>
                                <button
                                  type="button"
                                  onClick={stopGameVoicePlayback}
                                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-sky-200 transition-colors hover:bg-white/10"
                                  title="Stop voice-over"
                                >
                                  <VolumeX size={11} />
                                </button>
                              </>
                            )}
                          </span>
                        ) : null;

                      const editButtons = canEdit && (
                        <>
                          {!isEditingThis && (
                            <button
                              type="button"
                              onClick={() =>
                                sourceMessageId &&
                                (() => {
                                  const initialContent =
                                    seg.type === "readable" ? (seg.readableContent ?? seg.content) : seg.content;
                                  const initialSpeaker =
                                    canEditSegment && seg.type === "dialogue" ? (seg.speaker ?? "") : undefined;
                                  logEditDraftRef.current = {
                                    content: initialContent,
                                    speaker: initialSpeaker,
                                  };
                                  setEditingLogSeg({
                                    messageId: sourceMessageId,
                                    segIndex: sourceSegmentIndex,
                                    content: initialContent,
                                    speaker: initialSpeaker,
                                    segmentType: seg.type,
                                    readableType: seg.readableType,
                                  });
                                })()
                              }
                              className="rounded p-1 text-white/45 opacity-100 transition-all hover:bg-white/10 hover:text-white/60 md:text-white/20 md:opacity-0 md:group-hover/logseg:opacity-100"
                              title="Edit"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                          {isEditingThis && (
                            <button
                              type="button"
                              onClick={() =>
                                commitLogEdit({
                                  sourceMessageId,
                                  sourceSegmentIndex,
                                  canEditMessage,
                                  canEditSegment,
                                  fallbackSpeaker: seg.speaker,
                                })
                              }
                              className="rounded bg-emerald-500/20 p-1 text-emerald-300 transition-colors hover:bg-emerald-500/30"
                              title="Save"
                            >
                              <Check size={11} />
                            </button>
                          )}
                        </>
                      );

                      const actionButtons =
                        deleteButton || copyButton || editButtons ? (
                          <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5">
                            {deleteButton}
                            {copyButton}
                            {editButtons}
                          </div>
                        ) : null;

                      const editSpeakerInput =
                        isEditingThis && seg.type === "dialogue" && canEditSegment ? (
                          <input
                            key={`${sourceMessageId}:${sourceSegmentIndex}:speaker`}
                            className="mb-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-[0.7rem] font-semibold text-white/90 outline-none focus:border-white/30"
                            defaultValue={editingLogSeg?.speaker ?? ""}
                            placeholder="Speaker name"
                            onChange={(e) => {
                              logEditDraftRef.current = {
                                ...logEditDraftRef.current,
                                speaker: e.target.value,
                              };
                            }}
                          />
                        ) : null;

                      const editTextarea = isEditingThis && (
                        <textarea
                          key={`${sourceMessageId}:${sourceSegmentIndex}:content`}
                          ref={logEditTextareaRef}
                          className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-white/90 outline-none focus:border-white/30"
                          style={narrationFontStyle}
                          defaultValue={editingLogSeg.content}
                          rows={3}
                          autoFocus
                          onChange={(e) => {
                            logEditDraftRef.current = {
                              ...logEditDraftRef.current,
                              content: e.target.value,
                            };
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditingLogSeg(null);
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              commitLogEdit({
                                sourceMessageId,
                                sourceSegmentIndex,
                                canEditMessage,
                                canEditSegment,
                                fallbackSpeaker: seg.speaker,
                              });
                            }
                          }}
                        />
                      );

                      if (seg.type === "dialogue") {
                        const logAvatar = seg.speaker ? findNamedMapValue(speakerAvatarInfos, seg.speaker) : null;
                        const canUploadLogPortrait = canUploadNpcPortrait(seg.speaker);
                        const canGenerateLogPortrait = canGenerateNpcPortrait(seg.speaker);
                        const logPortraitGenerating = isNpcPortraitGenerating(seg.speaker);
                        return (
                          <div
                            key={seg.id}
                            {...(jumpRowProps ?? {})}
                            data-log-anchor-key={logAnchorKey}
                            className={cn(
                              "group/logseg relative flex gap-2 rounded-lg border px-3 py-2",
                              seg.partyType === "thought"
                                ? "border-purple-400/10 bg-purple-950/15"
                                : seg.partyType === "whisper"
                                  ? "border-rose-400/10 bg-rose-950/15"
                                  : seg.partyType === "side" || seg.partyType === "extra"
                                    ? "border-sky-400/10 bg-sky-950/15"
                                    : "border-white/5 bg-black/20",
                              isActiveSeg && "ring-1 ring-[var(--primary)]/40",
                              isSelectedForDeletion && "bg-[var(--destructive)]/10 ring-2 ring-[var(--destructive)]/55",
                              jumpRowClasses,
                            )}
                          >
                            {actionButtons}
                            {canUploadLogPortrait ? (
                              <div className="group/log-avatar relative shrink-0">
                                <button
                                  type="button"
                                  onClick={() => triggerNpcPortraitUpload(seg.speaker)}
                                  className="rounded-lg transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-white/20"
                                  title="Upload or replace NPC portrait"
                                >
                                  {logAvatar ? (
                                    <CroppedAvatar
                                      src={logAvatar.url}
                                      alt={seg.speaker || ""}
                                      crop={logAvatar.crop}
                                      className="h-8 w-8 rounded-lg border border-white/10 transition-colors hover:border-white/25"
                                    />
                                  ) : (
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[var(--accent)] text-[0.5rem] font-bold transition-colors hover:border-white/25">
                                      {(seg.speaker || "?")[0]}
                                    </div>
                                  )}
                                </button>
                                {canGenerateLogPortrait && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      triggerNpcPortraitGenerate(seg.speaker);
                                    }}
                                    disabled={logPortraitGenerating}
                                    className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/75 text-[var(--primary)] opacity-0 ring-1 ring-white/15 transition-opacity disabled:cursor-wait group-hover/log-avatar:opacity-100 max-md:opacity-100"
                                    title="Generate NPC portrait"
                                  >
                                    {logPortraitGenerating ? (
                                      <Loader2 size="0.6rem" className="animate-spin" />
                                    ) : (
                                      <Wand2 size="0.6rem" />
                                    )}
                                  </button>
                                )}
                              </div>
                            ) : logAvatar ? (
                              <CroppedAvatar
                                src={logAvatar.url}
                                alt={seg.speaker || ""}
                                crop={logAvatar.crop}
                                className="h-8 w-8 shrink-0 rounded-lg border border-white/10"
                              />
                            ) : (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[var(--accent)] text-[0.5rem] font-bold">
                                {(seg.speaker || "?")[0]}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center">
                                <span
                                  className="text-[0.6875rem] font-bold"
                                  style={
                                    nameColorStyle(
                                      findNamedMapValue(speakerNameColors, seg.speaker ?? "") ?? seg.color,
                                    ) ?? { color: "rgb(186 230 253)" }
                                  }
                                >
                                  {seg.speaker || "Dialogue"}
                                </span>
                                {partyBadge}
                                {voiceButton}
                              </div>
                              {isEditingThis ? (
                                <>
                                  {editSpeakerInput}
                                  {editTextarea}
                                </>
                              ) : (
                                <div
                                  className={cn(
                                    "mt-0.5 text-xs leading-relaxed text-white/80",
                                    seg.partyType === "thought" ? "italic opacity-80" : "font-semibold",
                                  )}
                                  style={seg.color ? { ...narrationFontStyle, color: seg.color } : narrationFontStyle}
                                  dangerouslySetInnerHTML={{
                                    __html: animateTextHtml(formatNarration(seg.content, false)),
                                  }}
                                />
                              )}
                            </div>
                          </div>
                        );
                      }
                      if (seg.type === "system") {
                        return (
                          <div
                            key={seg.id}
                            {...(jumpRowProps ?? {})}
                            data-log-anchor-key={logAnchorKey}
                            className={cn(
                              "group/logseg relative rounded-lg border border-cyan-400/15 bg-cyan-950/15 px-3 py-2",
                              isActiveSeg && "ring-1 ring-[var(--primary)]/40",
                              isSelectedForDeletion && "bg-[var(--destructive)]/10 ring-2 ring-[var(--destructive)]/55",
                              jumpRowClasses,
                            )}
                          >
                            {actionButtons}
                            <div className="mb-1 flex items-center">
                              <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-cyan-200/80">
                                System
                              </span>
                            </div>
                            <div
                              className="whitespace-pre-wrap break-words pr-6 text-xs leading-relaxed text-cyan-50/80"
                              style={narrationFontStyle}
                              dangerouslySetInnerHTML={{ __html: animateTextHtml(formatNarration(seg.content, false)) }}
                            />
                          </div>
                        );
                      }
                      if (seg.type === "readable") {
                        return (
                          <div
                            key={seg.id}
                            {...(jumpRowProps ?? {})}
                            data-log-anchor-key={logAnchorKey}
                            className={cn(
                              "group/logseg relative rounded-lg border border-amber-400/15 bg-amber-950/15 px-3 py-2",
                              isActiveSeg && "ring-1 ring-[var(--primary)]/40",
                              isSelectedForDeletion && "bg-[var(--destructive)]/10 ring-2 ring-[var(--destructive)]/55",
                              jumpRowClasses,
                            )}
                          >
                            {actionButtons}
                            <div className="mb-1 flex items-center">
                              <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-amber-300/80">
                                {seg.readableType === "book" ? "Book" : "Note"}
                              </span>
                            </div>
                            {isEditingThis ? (
                              editTextarea
                            ) : (
                              <div
                                className="text-xs italic leading-relaxed text-amber-200/70"
                                style={narrationFontStyle}
                                dangerouslySetInnerHTML={{
                                  __html: animateTextHtml(formatNarration(seg.readableContent ?? seg.content, false)),
                                }}
                              />
                            )}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={seg.id}
                          {...(jumpRowProps ?? {})}
                          data-log-anchor-key={logAnchorKey}
                          className={cn(
                            "group/logseg relative rounded-lg border border-white/5 bg-black/20 px-3 py-2",
                            isActiveSeg && "ring-1 ring-[var(--primary)]/40",
                            isSelectedForDeletion && "bg-[var(--destructive)]/10 ring-2 ring-[var(--destructive)]/55",
                            jumpRowClasses,
                          )}
                        >
                          {actionButtons}
                          <div className="mb-1 flex items-center">
                            <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-white/80">
                              Narration
                            </span>
                            {voiceButton}
                          </div>
                          {isEditingThis ? (
                            editTextarea
                          ) : (
                            <div
                              className="text-xs leading-relaxed text-white/80"
                              style={narrationStyle}
                              dangerouslySetInnerHTML={{ __html: animateTextHtml(formatNarration(seg.content, false)) }}
                            />
                          )}
                        </div>
                      );
                    })}
                    {renderTranslationPanel(sourceMessage, translatedEntryText, entryIsTranslating)}
                    <div className="border-b border-white/5" />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CroppedAvatar({
  src,
  alt,
  crop,
  className,
}: {
  src: string;
  alt: string;
  crop?: AvatarCrop | LegacyAvatarCrop | null;
  className?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <img src={src} alt={alt} className="h-full w-full object-cover" style={getAvatarCropStyle(crop)} />
    </div>
  );
}

function PartyOverlayBox({
  line,
  avatar,
  color,
  nameColor,
}: {
  line: PartyDialogueLine;
  avatar: SpeakerAvatarInfo | null;
  color?: string;
  nameColor?: string;
}) {
  const styleByType: Record<string, { border: string; bg: string; icon: string; labelColor: string }> = {
    side: { border: "border-white/15", bg: "bg-black/75", icon: "💬", labelColor: "text-white/85" },
    extra: { border: "border-white/15", bg: "bg-black/75", icon: "💬", labelColor: "text-white/85" },
    thought: { border: "border-purple-400/20", bg: "bg-purple-950/70", icon: "💭", labelColor: "text-purple-200/80" },
    whisper: { border: "border-rose-400/20", bg: "bg-rose-950/70", icon: "🤫", labelColor: "text-rose-200/80" },
  };
  const style = styleByType[line.type] ?? styleByType.side!;

  return (
    <div
      className={cn(
        "isolate flex w-fit min-w-0 max-w-full transform-gpu items-start gap-2 rounded-xl border bg-clip-padding px-3 py-2 sm:max-w-[75%]",
        (line.type === "side" || line.type === "extra") && "shadow-[0_16px_38px_rgba(0,0,0,0.45)]",
        style.border,
        style.bg,
      )}
    >
      {avatar ? (
        <CroppedAvatar
          src={avatar.url}
          alt={line.character}
          crop={avatar.crop}
          className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-white/15"
        />
      ) : (
        <img
          src="/npc-silhouette.svg"
          alt={line.character}
          className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-white/15 object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-[0.5625rem]">{style.icon}</span>
          <span
            className={cn("text-[0.6875rem] font-semibold", style.labelColor)}
            style={nameColorStyle(nameColor ?? color)}
          >
            {line.character}
          </span>
          {line.type === "whisper" && line.target && (
            <span className="text-[0.5625rem] text-white/40">→ {line.target}</span>
          )}
        </div>
        <div className="mt-0.5 min-w-0">
          <p
            className={cn(
              "text-xs leading-relaxed text-white/75 whitespace-normal break-words [overflow-wrap:anywhere]",
              line.type === "thought" && "italic opacity-80",
              line.type === "whisper" && "italic",
            )}
            style={(line.type === "side" || line.type === "extra") && color ? { color } : undefined}
            dangerouslySetInnerHTML={{
              __html: formatNarration(line.content, false),
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Anime-style expression reaction indicators ──

type ExpressionReactionEffect =
  | "pop"
  | "anger"
  | "sparkle"
  | "heart"
  | "tear"
  | "stress"
  | "thought"
  | "focus"
  | "sleep";

const EXPRESSION_REACTIONS: Record<string, { symbol: string; color: string; effect: ExpressionReactionEffect }> = {
  // Anger / frustration
  angry: { symbol: "❗", color: "text-red-400", effect: "anger" },
  furious: { symbol: "‼️", color: "text-red-500", effect: "anger" },
  annoyed: { symbol: "💢", color: "text-red-400", effect: "anger" },
  irritated: { symbol: "💢", color: "text-orange-400", effect: "anger" },

  // Confusion / surprise
  confused: { symbol: "❓", color: "text-yellow-300", effect: "pop" },
  surprised: { symbol: "❗", color: "text-yellow-300", effect: "pop" },
  shocked: { symbol: "‼️", color: "text-yellow-400", effect: "pop" },

  // Joy / amusement
  happy: { symbol: "✨", color: "text-amber-300", effect: "sparkle" },
  amused: { symbol: "✨", color: "text-amber-300", effect: "sparkle" },
  delighted: { symbol: "✨", color: "text-yellow-300", effect: "sparkle" },
  mischievous: { symbol: "😈", color: "text-purple-300", effect: "pop" },

  // Affection
  flirty: { symbol: "💗", color: "text-pink-400", effect: "heart" },
  tender: { symbol: "💕", color: "text-pink-300", effect: "heart" },
  loving: { symbol: "💕", color: "text-pink-300", effect: "heart" },

  // Sadness
  sad: { symbol: "💧", color: "text-blue-300", effect: "tear" },
  crying: { symbol: "💧", color: "text-blue-400", effect: "tear" },

  // Fear / worry
  scared: { symbol: "💦", color: "text-sky-300", effect: "stress" },
  worried: { symbol: "💦", color: "text-sky-300", effect: "stress" },
  nervous: { symbol: "💦", color: "text-sky-300", effect: "stress" },

  // Thinking
  thinking: { symbol: "💭", color: "text-white/70", effect: "thought" },

  // Smug / confident
  smirk: { symbol: "✧", color: "text-amber-300", effect: "sparkle" },
  smug: { symbol: "✧", color: "text-amber-400", effect: "sparkle" },
  determined: { symbol: "🔥", color: "text-orange-400", effect: "focus" },
  battle_stance: { symbol: "⚔️", color: "text-orange-300", effect: "focus" },

  // Cold / dismissive
  cold: { symbol: "❄️", color: "text-sky-300", effect: "sparkle" },
  disgusted: { symbol: "💢", color: "text-green-400", effect: "anger" },
  deadpan: { symbol: "…", color: "text-white/40", effect: "pop" },
  eye_roll: { symbol: "…", color: "text-white/40", effect: "pop" },
  bored: { symbol: "💤", color: "text-white/40", effect: "sleep" },
};

function ExpressionReaction({ expression }: { expression?: string }) {
  if (!expression) return null;
  const key = expression.toLowerCase().replace(/[_\s-]/g, "_");
  const reaction = EXPRESSION_REACTIONS[key];
  if (!reaction) return null;

  return (
    <div
      className={cn(
        "game-expression-reaction absolute -right-1 -top-1 sm:-right-2 sm:-top-2",
        `game-expression-reaction--${reaction.effect}`,
        reaction.color,
      )}
    >
      <span className="game-expression-reaction__halo" />
      <span className="game-expression-reaction__symbol">{reaction.symbol}</span>
      {reaction.effect === "thought" && (
        <>
          <span className="game-expression-reaction__bubble game-expression-reaction__bubble--one" />
          <span className="game-expression-reaction__bubble game-expression-reaction__bubble--two" />
        </>
      )}
      {reaction.effect === "tear" && <span className="game-expression-reaction__drop" />}
    </div>
  );
}

/** Split PascalCase/camelCase identifiers into space-separated words.
 *  "FatuiAgent" → "Fatui Agent", "darkKnight" → "dark Knight"
 *  Already-spaced names pass through unchanged. */
function humanizeName(name: string): string {
  if (name.includes(" ") || name.includes("_")) return name;
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

function normalizeInlineVnDialogueLines(source: string): string {
  return source
    .replace(
      /([^\n])\s+(\[[^\]]+\]\s*\[(?:main|side|extra|action|thought|whisper(?::[^\]]+)?)\]\s*(?:\[[^\]]+\])?\s*:)/gi,
      "$1\n$2",
    )
    .replace(
      /(\[[^\]]+\]\s*\[(?:main|side|extra|whisper(?::[^\]]+)?)\]\s*(?:\[[^\]]+\])?\s*:\s*(?:"[^"]*"|“[^”]*”|«[^»]*»))\s+(?=\S)/gi,
      "$1\n",
    );
}

type TruncationLine = {
  text: string;
  originalStart: number;
  originalEnd: number;
};

function findReadableBlockEnd(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTextIntoBoundedLines(text: string, originalStart: number): TruncationLine[] {
  const lines: TruncationLine[] = [];
  let lineStart = 0;

  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text[i] !== "\n") continue;
    const rawLine = text.slice(lineStart, i);
    const lineText = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    lines.push({
      text: lineText,
      originalStart: originalStart + lineStart,
      originalEnd: originalStart + lineStart + lineText.length,
    });
    lineStart = i + 1;
  }

  return lines;
}

function splitInlineVnDialogueLineMetadata(line: TruncationLine): TruncationLine[] {
  const headerRe = /\[[^\]]+\]\s*\[(?:main|side|extra|action|thought|whisper(?::[^\]]+)?)\]\s*(?:\[[^\]]+\])?\s*:/gi;
  const pieces: TruncationLine[] = [];
  let chunkStart = 0;
  let match: RegExpExecArray | null;

  while ((match = headerRe.exec(line.text))) {
    if (match.index > chunkStart && /\s/.test(line.text[match.index - 1] ?? "")) {
      pieces.push({
        text: line.text.slice(chunkStart, match.index),
        originalStart: line.originalStart + chunkStart,
        originalEnd: line.originalStart + match.index,
      });
      chunkStart = match.index;
    }
  }
  pieces.push({
    text: line.text.slice(chunkStart),
    originalStart: line.originalStart + chunkStart,
    originalEnd: line.originalEnd,
  });

  return pieces.flatMap((piece) => {
    const splitRe =
      /^(\s*\[[^\]]+\]\s*\[(?:main|side|extra|whisper(?::[^\]]+)?)\]\s*(?:\[[^\]]+\])?\s*:\s*(?:"[^"]*"|“[^”]*”|«[^»]*»))\s+(?=\S)/i;
    const split = splitRe.exec(piece.text);
    if (!split || split[1].length >= piece.text.length) return [piece];

    const splitAt = split[1].length;
    return [
      {
        text: piece.text.slice(0, splitAt),
        originalStart: piece.originalStart,
        originalEnd: piece.originalStart + splitAt,
      },
      {
        text: piece.text.slice(splitAt).trimStart(),
        originalStart: piece.originalStart + splitAt + (piece.text.slice(splitAt).match(/^\s*/)?.[0].length ?? 0),
        originalEnd: piece.originalEnd,
      },
    ];
  });
}

function buildTruncationLines(rawContent: string): TruncationLine[] {
  const chunks: TruncationLine[] = [];
  const readableTagRe = /\[(?:Note|Book):/gi;
  let cursor = 0;
  let placeholderIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = readableTagRe.exec(rawContent))) {
    const start = match.index;
    const end = findReadableBlockEnd(rawContent, start);
    if (end < 0) continue;

    if (start > cursor) {
      chunks.push(...splitTextIntoBoundedLines(rawContent.slice(cursor, start), cursor));
    }
    chunks.push({
      text: `__READABLE_${placeholderIndex}__`,
      originalStart: start,
      originalEnd: end + 1,
    });
    placeholderIndex += 1;
    cursor = end + 1;
    readableTagRe.lastIndex = cursor;
  }

  if (cursor < rawContent.length) {
    chunks.push(...splitTextIntoBoundedLines(rawContent.slice(cursor), cursor));
  }

  return chunks.flatMap((chunk) => {
    if (/^__READABLE_\d+__$/.test(chunk.text)) return [chunk];
    return splitInlineVnDialogueLineMetadata(chunk).map((line) => ({
      ...line,
      text: stripGmTagsKeepReadables(line.text),
    }));
  });
}

function parseNarrationSegments(message: NarrationMessage, speakerColors: Map<string, string>): NarrationSegment[] {
  // Use stripGmTagsKeepReadables so [Note:] and [Book:] stay inline for position-aware display.
  // Extract them first as placeholders so multi-line readables don't break line-based parsing.
  const withReadables = stripGmTagsKeepReadables(message.content || "");
  const readableContents: Array<{ type: "note" | "book"; content: string }> = [];
  let source = withReadables;
  // Replace [Note: ...] and [Book: ...] with placeholders (balanced bracket aware)
  for (const tag of ["[Note:", "[Book:"] as const) {
    const rType = tag === "[Note:" ? "note" : "book";
    let searchFrom = 0;
    while (true) {
      const idx = source.toLowerCase().indexOf(tag.toLowerCase(), searchFrom);
      if (idx === -1) break;
      let depth = 0;
      let end = -1;
      for (let i = idx; i < source.length; i++) {
        if (source[i] === "[") depth++;
        else if (source[i] === "]") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) {
        searchFrom = idx + 1;
        continue;
      }
      const inner = source.slice(idx + tag.length, end).trim();
      const placeholderIdx = readableContents.length;
      readableContents.push({ type: rType, content: inner });
      const placeholder = `__READABLE_${placeholderIdx}__`;
      source = source.slice(0, idx) + placeholder + source.slice(end + 1);
      searchFrom = idx + placeholder.length;
    }
  }

  const lines = normalizeInlineVnDialogueLines(source).split(/\r?\n/);
  const parsed: NarrationSegment[] = [];
  // Readable placeholder regex
  const readablePlaceholderRe = /^__READABLE_(\d+)__$/;
  // Legacy format (backward compat): Narration: text
  const narrationRegex = /^\s*Narration\s*:\s*(.+)$/i;
  // Legacy format (backward compat): Dialogue [Name] [expression]: "text"
  const legacyDialogueRegex = /^\s*Dialogue\s*\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;
  // New compact format: [Name] [expression]: "text" or [Name]: "text" or [Name]: text
  const compactDialogueRegex = /^\s*\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/;
  // Party dialogue lines — parsed inline as VN segments
  const partyLineRegex =
    /^\s*\[([^\]]+)\]\s*\[(main|side|extra|action|thought|whisper(?::([^\]]+))?)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;

  let fallbackText = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (fallbackText.trim()) {
        parsed.push({
          id: `${message.id}-fallback-${parsed.length}`,
          type: "narration",
          content: fallbackText.trim(),
        });
        fallbackText = "";
      }
      continue;
    }

    // Detect readable placeholders ([Note:] / [Book:] inline markers)
    const readableMatch = line.match(readablePlaceholderRe);
    if (readableMatch) {
      if (fallbackText.trim()) {
        parsed.push({
          id: `${message.id}-fallback-${parsed.length}`,
          type: "narration",
          content: fallbackText.trim(),
        });
        fallbackText = "";
      }
      const rIdx = parseInt(readableMatch[1]!, 10);
      const readable = readableContents[rIdx];
      if (readable) {
        parsed.push({
          id: `${message.id}-readable-${parsed.length}`,
          type: "readable",
          content: readable.type === "book" ? "You find a book..." : "You find a note...",
          readableType: readable.type,
          readableContent: readable.content,
        });
      }
      continue;
    }

    // Parse party dialogue lines inline as VN segments
    const partyMatch = line.match(partyLineRegex);
    if (partyMatch) {
      if (fallbackText.trim()) {
        parsed.push({
          id: `${message.id}-fallback-${parsed.length}`,
          type: "narration",
          content: fallbackText.trim(),
        });
        fallbackText = "";
      }
      const character = humanizeName(partyMatch[1]!.trim());
      let rawType = partyMatch[2]!.toLowerCase().replace(/:.*$/, "") as NarrationSegment["partyType"];
      const whisperTarget = partyMatch[3]?.trim() ? humanizeName(partyMatch[3].trim()) : undefined;
      const expression = partyMatch[4]?.trim() || undefined;
      let content = partyMatch[5]!.trim();

      // Normalize legacy `extra` → `side` so historical messages render with the single popup style.
      if (rawType === "extra") rawType = "side";

      // Strip surrounding dialogue quotes for spoken dialogue types
      if ((rawType === "main" || rawType === "side" || rawType === "whisper") && content.length >= 2) {
        content = stripSurroundingDialogueQuotes(content);
      }

      const color = findNamedMapValue(speakerColors, character);
      // Remap action → plain narration (no special styling)
      if (rawType === "action") {
        parsed.push({
          id: `${message.id}-party-action-${character}-${parsed.length}`,
          type: "narration",
          content,
        });
        continue;
      }
      const isSpoken = rawType === "main" || rawType === "whisper" || rawType === "thought" || rawType === "side";
      parsed.push({
        id: `${message.id}-party-${rawType}-${character}-${parsed.length}`,
        type: isSpoken ? "dialogue" : "narration",
        speaker: character,
        sprite: expression,
        content,
        color,
        partyType: rawType,
        whisperTarget,
      });
      continue;
    }

    const narrationMatch = line.match(narrationRegex);
    if (narrationMatch) {
      if (fallbackText.trim()) {
        parsed.push({
          id: `${message.id}-fallback-${parsed.length}`,
          type: "narration",
          content: fallbackText.trim(),
        });
        fallbackText = "";
      }
      parsed.push({
        id: `${message.id}-n-${parsed.length}`,
        type: "narration",
        content: narrationMatch[1]!.trim(),
      });
      continue;
    }

    const dialogueMatch = line.match(legacyDialogueRegex) || line.match(compactDialogueRegex);
    if (dialogueMatch) {
      if (fallbackText.trim()) {
        parsed.push({
          id: `${message.id}-fallback-${parsed.length}`,
          type: "narration",
          content: fallbackText.trim(),
        });
        fallbackText = "";
      }
      const speaker = humanizeName(dialogueMatch[1]!.trim());
      let content = dialogueMatch[3]!.trim();
      content = stripSurroundingDialogueQuotes(content);
      parsed.push({
        id: `${message.id}-d-${parsed.length}`,
        type: "dialogue",
        speaker,
        sprite: dialogueMatch[2]?.trim() || undefined,
        content,
        color: findNamedMapValue(speakerColors, speaker),
      });
      continue;
    }

    fallbackText += `${fallbackText ? "\n" : ""}${line}`;
  }

  if (fallbackText.trim()) {
    parsed.push({
      id: `${message.id}-fallback-${parsed.length}`,
      type: "narration",
      content: fallbackText.trim(),
    });
  }

  // If all segments are plain fallback narration (GM didn't use structured format),
  // try to extract inline dialogue like: "Hello," she said. / «Hmm,» he muttered.
  if (parsed.length > 0 && parsed.every((s) => s.type === "narration")) {
    const expanded = splitInlineDialogue(parsed, message.id, speakerColors);
    if (expanded.some((s) => s.type === "dialogue")) {
      return expanded;
    }
  }

  return parsed;
}

/**
 * Truncate an assistant message's raw content so that it ends just after the
 * Nth segment (inclusive) that `parseNarrationSegments` would emit. Used by
 * the Interrupt feature so the model on the next turn can't see narration
 * the player never read.
 *
 * The parser-facing text is normalized for segment detection, but the returned
 * string is always a byte-for-byte prefix of the original raw content.
 */
function truncateMessageContentAtSegment(rawContent: string, segmentIndexInclusive: number): string {
  if (segmentIndexInclusive < 0) return "";

  const lines = buildTruncationLines(rawContent || "");
  const readablePlaceholderRe = /^__READABLE_(\d+)__$/;
  const narrationRegex = /^\s*Narration\s*:\s*(.+)$/i;
  const legacyDialogueRegex = /^\s*Dialogue\s*\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;
  const compactDialogueRegex = /^\s*\[([^\]]+)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/;
  const partyLineRegex =
    /^\s*\[([^\]]+)\]\s*\[(main|side|extra|action|thought|whisper(?::([^\]]+))?)\]\s*(?:\[([^\]]+)\])?\s*:\s*(.+)$/i;

  const target = segmentIndexInclusive + 1;
  let segmentCount = 0;
  let pendingFallback = false;
  let lastIncludedLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (segmentCount >= target) break;
    const line = lines[i]!.text.trim();

    if (!line) {
      if (pendingFallback) {
        segmentCount++;
        pendingFallback = false;
      }
      continue;
    }

    const isSpecial =
      readablePlaceholderRe.test(line) ||
      partyLineRegex.test(line) ||
      narrationRegex.test(line) ||
      legacyDialogueRegex.test(line) ||
      compactDialogueRegex.test(line);

    if (isSpecial) {
      if (pendingFallback) {
        segmentCount++;
        pendingFallback = false;
        if (segmentCount >= target) break;
      }
      segmentCount++;
      lastIncludedLineIdx = i;
    } else {
      pendingFallback = true;
      lastIncludedLineIdx = i;
    }
  }

  if (lastIncludedLineIdx < 0) return rawContent;
  return rawContent.slice(0, lines[lastIncludedLineIdx]!.originalEnd);
}

/**
 * Fallback: split narration segments that contain inline quoted speech into
 * separate narration + dialogue segments. Handles patterns like:
 *   "Hello there," she said warmly.
 *   «Watch out!» Alaric warned.
 *   「小心！」 Alaric warned.
 */
function splitInlineDialogue(
  segments: NarrationSegment[],
  msgId: string,
  speakerColors: Map<string, string>,
): NarrationSegment[] {
  const result: NarrationSegment[] = [];
  // Match common dialogue quote pairs followed by optional comma/period and a speaker name.
  const inlineDialogueRe = new RegExp(
    `(?:^|(?<=\\s))(?:${DIALOGUE_QUOTE_CAPTURE_GROUP_PATTERN_SOURCE}|'([^']+)')[,.]?\\s+([A-Z][a-z]+(?:\\s[A-Z][a-z]+)?)\\s+(?:said|says|whispered|whispers|muttered|mutters|replied|replies|called|calls|shouted|shouts|asked|asks|warned|warns|growled|growls|hissed|hisses|exclaimed|exclaims|murmured|murmurs|sighed|sighs|snapped|snaps|barked|barks|declared|declares|continued|continues|added|adds|spoke|speaks|began|begins|remarked|remarks|chuckled|chuckles|laughed|laughs|cried|cries)\\b`,
    "gi",
  );

  for (const seg of segments) {
    if (seg.type !== "narration") {
      result.push(seg);
      continue;
    }

    const text = seg.content;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let didSplit = false;
    inlineDialogueRe.lastIndex = 0;

    while ((match = inlineDialogueRe.exec(text)) !== null) {
      didSplit = true;
      const before = text.slice(lastIndex, match.index).trim();
      if (before) {
        result.push({
          id: `${msgId}-fallback-split-${result.length}`,
          type: "narration",
          content: before,
        });
      }

      const speech = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? "";
      const speaker = match[7]!;
      result.push({
        id: `${msgId}-inline-d-${result.length}`,
        type: "dialogue",
        speaker,
        content: `"${speech}"`,
        color: findNamedMapValue(speakerColors, speaker),
      });
      lastIndex = match.index + match[0].length;
    }

    if (didSplit) {
      const after = text.slice(lastIndex).trim();
      if (after) {
        result.push({
          id: `${msgId}-fallback-split-${result.length}`,
          type: "narration",
          content: after,
        });
      }
    } else {
      result.push(seg);
    }
  }

  return result;
}

function commandBadge(className: string, label: string, detail?: string): string {
  return `<span class="inline-flex max-w-full flex-wrap items-center gap-1 rounded px-1.5 py-0.5 text-xs ${className}">${label}${
    detail ? ` <span class="opacity-75">${detail}</span>` : ""
  }</span>`;
}

function parseCommandAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(source)) !== null) {
    attrs[match[1]!] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function formatSignedNumber(value: string): string {
  const numeric = Number(value.trim());
  if (!Number.isFinite(numeric)) return value.trim();
  return numeric > 0 ? `+${numeric}` : String(numeric);
}

export function formatNarration(content: string, boldDialogue = true): string {
  let html = content
    .replace(/\[combat_result]\s*([\s\S]*?)\s*\[\/combat_result]/gi, (_match, recap: string) => {
      const cleaned = recap.trim();
      return `${commandBadge("bg-red-500/15 text-red-200 ring-1 ring-red-400/20", "⚔ Combat Result")}${
        cleaned ? `\n${cleaned}` : ""
      }`;
    })
    .replace(
      /\[dice:\s*((?:\d+)?d\d+(?:[+-]\d+)?)\s*=\s*(-?\d+)(?:\s*\([^\]]+\))?\]/gi,
      (_match, notation: string, total: string) =>
        commandBadge("bg-white/10 text-white/60 font-mono", "🎲", `${notation} → ${total}`),
    )
    .replace(/\[qte_bonus:\s*(-?\d+)\]/gi, (_match, bonus: string) =>
      commandBadge("bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20", "⏱ QTE Bonus", formatSignedNumber(bonus)),
    )
    .replace(/\[qte_result:\s*([^\]]+)\]/gi, (_match, rawAttrs: string) => {
      const attrs = parseCommandAttributes(rawAttrs);
      const status = attrs.status === "fail" ? "Fail" : attrs.status === "success" ? "Success" : "Result";
      const modifier = attrs.modifier ? formatSignedNumber(attrs.modifier) : "";
      return commandBadge("bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20", `⏱ QTE ${status}`, modifier);
    })
    .replace(/\[skill_check:\s*([^\]]+)\]/gi, (_match, rawAttrs: string) => {
      const attrs = parseCommandAttributes(rawAttrs);
      const skill = attrs.skill || "Skill";
      const dc = attrs.dc ? `DC ${attrs.dc}` : "";
      const total = attrs.total ? `total ${attrs.total}` : "";
      const result = attrs.result ? attrs.result.replace(/_/g, " ") : "";
      return commandBadge(
        "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/20",
        "🎯 Skill Check",
        [skill, dc, total, result].filter(Boolean).join(" · "),
      );
    })
    .replace(/\[combat:\s*([^\]]+)\]/gi, (_match, rawAttrs: string) => {
      const attrs = parseCommandAttributes(rawAttrs);
      return commandBadge(
        "bg-red-500/15 text-red-200 ring-1 ring-red-400/20",
        "⚔ Combat",
        attrs.enemies || rawAttrs.trim(),
      );
    })
    .replace(/\[status:\s*([^\]]+)\]/gi, (_match, rawAttrs: string) => {
      const attrs = parseCommandAttributes(rawAttrs);
      const modifier = attrs.modifier ? `${attrs.stat || "modifier"} ${formatSignedNumber(attrs.modifier)}` : "";
      const turns = attrs.turns || attrs.duration ? `${attrs.turns || attrs.duration} turns` : "";
      return commandBadge(
        "bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/20",
        "✦ Status",
        [attrs.effect || attrs.name || "Effect", attrs.target ? `on ${attrs.target}` : "", turns, modifier]
          .filter(Boolean)
          .join(" · "),
      );
    })
    .replace(/\[element_attack:\s*([^\]]+)\]/gi, (_match, rawAttrs: string) => {
      const attrs = parseCommandAttributes(rawAttrs);
      return commandBadge(
        "bg-orange-500/15 text-orange-200 ring-1 ring-orange-400/20",
        "✦ Element",
        [attrs.element, attrs.target ? `on ${attrs.target}` : ""].filter(Boolean).join(" · ") || rawAttrs.trim(),
      );
    })
    .replace(/\[qte:\s*([^\]]+)\]/gi, (_match, body: string) =>
      commandBadge("bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20", "⏱ QTE", body.trim()),
    )
    .replace(/\[choices:\s*([^\]]+)\]/gi, (_match, body: string) =>
      commandBadge("bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/20", "☑ Choices", body.trim()),
    )
    .replace(/\[inventory:\s*([^\]]+)\]/gi, (_match, rawAttrs: string) => {
      const attrs = parseCommandAttributes(rawAttrs);
      return commandBadge(
        "bg-lime-500/15 text-lime-200 ring-1 ring-lime-400/20",
        "🎒 Inventory",
        [attrs.action, attrs.item].filter(Boolean).join(": "),
      );
    })
    .replace(/\[map_update:\s*([^\]]+)\]/gi, (_match, rawAttrs: string) => {
      const attrs = parseCommandAttributes(rawAttrs);
      return commandBadge(
        "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/20",
        "🗺 Map",
        attrs.new_location || rawAttrs.trim(),
      );
    })
    .replace(/\[reputation:\s*([^\]]+)\]/gi, (_match, rawAttrs: string) => {
      const attrs = parseCommandAttributes(rawAttrs);
      return commandBadge(
        "bg-fuchsia-500/15 text-fuchsia-200 ring-1 ring-fuchsia-400/20",
        "◆ Reputation",
        [attrs.npc, attrs.action].filter(Boolean).join(": "),
      );
    })
    .replace(/\[party_change:\s*([^\]]+)\]/gi, (_match, rawAttrs: string) => {
      const attrs = parseCommandAttributes(rawAttrs);
      return commandBadge(
        "bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/20",
        "👥 Party",
        [attrs.change, attrs.character].filter(Boolean).join(": "),
      );
    })
    .replace(/\[party_add:\s*([^\]]+)\]/gi, (_match, rawAttrs: string) => {
      const attrs = parseCommandAttributes(rawAttrs);
      return commandBadge(
        "bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/20",
        "👥 Party",
        attrs.character || rawAttrs.trim(),
      );
    })
    .replace(/\[session_end:\s*([^\]]+)\]/gi, (_match, rawAttrs: string) => {
      const attrs = parseCommandAttributes(rawAttrs);
      return commandBadge("bg-violet-500/15 text-violet-200 ring-1 ring-violet-400/20", "🏁 Session End", attrs.reason);
    })
    .replace(/\[(music|sfx|bg|ambient):\s*([^\]]+)\]/gi, (_match, kind: string, body: string) =>
      commandBadge("bg-slate-500/15 text-slate-200 ring-1 ring-slate-400/20", kind.toUpperCase(), body.trim()),
    )
    .replace(/\[direction:\s*([^\]]+)\]/gi, (_match, body: string) =>
      commandBadge("bg-zinc-500/15 text-zinc-200 ring-1 ring-zinc-400/20", "Direction", body.trim()),
    )
    .replace(/\[widget:\s*([^\]]+)\]/gi, (_match, body: string) =>
      commandBadge("bg-teal-500/15 text-teal-200 ring-1 ring-teal-400/20", "Widget", body.trim()),
    )
    .replace(/\[dialogue:\s*([^\]]+)\]/gi, (_match, rawAttrs: string) => {
      const attrs = parseCommandAttributes(rawAttrs);
      return commandBadge(
        "bg-blue-500/15 text-blue-200 ring-1 ring-blue-400/20",
        "Dialogue",
        attrs.npc || rawAttrs.trim(),
      );
    })
    .replace(/\[state:\s*(\w+)\]/gi, (_match, state: string) =>
      commandBadge("bg-sky-500/20 text-sky-300", "⚡ State", state),
    )
    .replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/gs, "<em>$1</em>")
    .replace(/\n/g, "<br />");

  if (boldDialogue) {
    const narrationQuoteRe = new RegExp(`(?<![=\\w])(?:${HTML_SAFE_DIALOGUE_QUOTE_PATTERN_SOURCE})`, "g");
    html = html.replace(narrationQuoteRe, (match) => `<strong>${match}</strong>`);
  }

  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ["strong", "em", "br", "span"], ALLOWED_ATTR: ["class"] });
}
