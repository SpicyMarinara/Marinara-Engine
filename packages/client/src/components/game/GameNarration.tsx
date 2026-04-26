// ──────────────────────────────────────────────
// Game: Narration Area (VN-style segmented box)
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import DOMPurify from "dompurify";
import { MessageCircle, RefreshCw, ScrollText, X, Package, Pencil, Check, Play, Pause, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { findNamedMapValue } from "../../lib/game-character-name-match";
import type { GameSegmentEdit } from "../../lib/game-segment-edits";
import { stripGmTagsKeepReadables } from "../../lib/game-tag-parser";
import { audioManager } from "../../lib/game-audio";
import {
  DIALOGUE_QUOTE_CAPTURE_GROUP_PATTERN_SOURCE,
  HTML_SAFE_DIALOGUE_QUOTE_PATTERN_SOURCE,
  stripSurroundingDialogueQuotes,
} from "../../lib/dialogue-quotes";
import type { SpriteInfo } from "../../hooks/use-characters";
import { useTranslate } from "../../hooks/use-translate";
import { useGameAssetStore } from "../../stores/game-asset.store";
import { useGameModeStore } from "../../stores/game-mode.store";
import { useUIStore } from "../../stores/ui.store";
import { findCharacterByName, resolveMessageMacros } from "../../lib/chat-macros";
import { animateTextHtml } from "./AnimatedText";
import type { PartyDialogueLine, Message } from "@marinara-engine/shared";
import type { CharacterMap, PersonaInfo } from "../chat/chat-area.types";

/** Build inline style for a color that may be a plain color or a CSS gradient. */
function nameColorStyle(color?: string): React.CSSProperties | undefined {
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

const PARTY_TYPE_ICONS: Record<string, string> = {
  side: "💬",
  extra: "💬",
  thought: "💭",
  whisper: "🤫",
};

type NarrationMessage = Pick<Message, "id" | "chatId" | "role" | "content" | "characterId" | "extra"> & {
  characterName?: string;
};

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

interface GameNarrationProps {
  messages: NarrationMessage[];
  isStreaming: boolean;
  characterMap: CharacterMap;
  personaInfo?: PersonaInfo;
  /** Map of lowercase character name → sprite images for expression resolution */
  spriteMap?: Map<string, SpriteInfo[]>;
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
  /** Whether this is a restored session (skip typewriter, jump to saved segment) */
  isRestored?: boolean;
  /** Whether a locally saved narration position exists for this chat. */
  hasStoredNarrationPosition?: boolean;
  /** The saved narration segment index to restore to */
  restoredSegmentIndex?: number;
  /** Called when the active segment index changes (for persistence) */
  onSegmentChange?: (index: number) => void;
  /** Called when narration is fully complete (all segments read, not streaming) */
  onNarrationComplete?: (complete: boolean) => void;
  /** Slot rendered above the narration box (used for mobile widget icons) */
  widgetSlot?: ReactNode;
  /** Slot rendered above the narration box for GM choice cards */
  choicesSlot?: ReactNode;
  /** Open the inventory panel */
  onOpenInventory?: () => void;
  /** Number of items in inventory (for badge) */
  inventoryCount?: number;
  /** Open the standard delete-message flow for a backing chat message. */
  onDeleteMessage?: (messageId: string) => void;
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
  /** Pause auto-play while a blocking game overlay is open. */
  autoPlayBlocked?: boolean;
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

export function GameNarration({
  messages,
  isStreaming,
  characterMap,
  personaInfo,
  spriteMap,
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
  isRestored,
  hasStoredNarrationPosition,
  restoredSegmentIndex,
  onSegmentChange,
  onNarrationComplete,
  widgetSlot,
  choicesSlot,
  onOpenInventory,
  inventoryCount,
  onDeleteMessage,
  onDeleteSegment,
  onEditMessage,
  onEditSegment,
  segmentEdits,
  segmentDeletes,
  assetsGenerating,
  onReadable,
  onNpcPortraitClick,
  autoPlayBlocked,
}: GameNarrationProps) {
  const { translations, translating } = useTranslate();
  const [activeIndex, setActiveIndex] = useState(0);
  const [visibleChars, setVisibleChars] = useState(0);
  const [logsOpen, setLogsOpen] = useState(false);
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
  const logScrolledRef = useRef(false);
  const segmentSourceMessageIdsRef = useRef<Array<string | null>>([]);

  // Clear edit state when the active segment changes
  useEffect(() => {
    setEditingContent(null);
  }, [activeIndex]);

  /** Internal ref tracking the typewriter position so the RAF loop can run without
   *  visibleChars in the effect deps (avoids effect restart per character). */
  const twRef = useRef({ pos: 0 });

  // Track previous active segment so we can detect in-place edits
  const prevActiveRef = useRef<{ index: number; content?: string }>({ index: 0 });

  const speakerColors = useMemo(() => {
    const byName = new Map<string, string>();
    for (const [, c] of characterMap) {
      const color = c.dialogueColor || c.nameColor;
      if (color) byName.set(c.name.toLowerCase(), color);
    }
    if (personaInfo?.name && (personaInfo.dialogueColor || personaInfo.nameColor)) {
      byName.set(personaInfo.name.toLowerCase(), personaInfo.dialogueColor || personaInfo.nameColor || "");
    }
    return byName;
  }, [characterMap, personaInfo]);

  /** Name-display colors (prefers nameColor which may be a gradient). */
  const speakerNameColors = useMemo(() => {
    const byName = new Map<string, string>();
    for (const [, c] of characterMap) {
      const color = c.nameColor || c.dialogueColor;
      if (color) byName.set(c.name.toLowerCase(), color);
    }
    if (personaInfo?.name && (personaInfo.nameColor || personaInfo.dialogueColor)) {
      byName.set(personaInfo.name.toLowerCase(), personaInfo.nameColor || personaInfo.dialogueColor || "");
    }
    return byName;
  }, [characterMap, personaInfo]);

  const gameNpcs = useGameModeStore((s) => s.npcs);
  const sourceMessagesById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);

  const speakerAvatars = useMemo(() => {
    const byName = new Map<string, string>();
    for (const [, c] of characterMap) {
      if (c.avatarUrl) byName.set(c.name.toLowerCase(), c.avatarUrl);
    }
    if (personaInfo?.name && personaInfo.avatarUrl) {
      byName.set(personaInfo.name.toLowerCase(), personaInfo.avatarUrl);
    }
    // Include tracked game NPC avatars so dialogue boxes show their portrait
    for (const npc of gameNpcs) {
      if (npc.avatarUrl && !byName.has(npc.name.toLowerCase())) {
        byName.set(npc.name.toLowerCase(), npc.avatarUrl);
      }
    }
    return byName;
  }, [characterMap, personaInfo, gameNpcs]);

  const uploadableNpcNames = useMemo(
    () => new Set(gameNpcs.map((npc) => npc.name.trim().toLowerCase()).filter(Boolean)),
    [gameNpcs],
  );

  const canUploadNpcPortrait = useCallback(
    (speaker?: string | null) => {
      const normalizedSpeaker = speaker?.trim().toLowerCase();
      return !!normalizedSpeaker && !!onNpcPortraitClick && uploadableNpcNames.has(normalizedSpeaker);
    },
    [onNpcPortraitClick, uploadableNpcNames],
  );

  const triggerNpcPortraitUpload = useCallback(
    (speaker?: string | null) => {
      if (!speaker || !onNpcPortraitClick) return;
      const normalizedSpeaker = speaker.trim().toLowerCase();
      if (!uploadableNpcNames.has(normalizedSpeaker)) return;
      onNpcPortraitClick(speaker);
    },
    [onNpcPortraitClick, uploadableNpcNames],
  );

  const latestAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!;
      if (msg.role === "assistant" || msg.role === "narrator") {
        return msg;
      }
    }
    return null;
  }, [messages]);

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
    // Scan backwards from the assistant to find the preceding user message
    for (let i = assistantIdx - 1; i >= 0; i--) {
      const msg = messages[i]!;
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
              sourceRole: pcMsgId ? (sourceMessagesById.get(pcMsgId)?.role ?? "assistant") : null,
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
            sourceRole: pcMsgId ? (sourceMessagesById.get(pcMsgId)?.role ?? "assistant") : null,
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

    // Resolve display macros on every segment's content so downstream
    // renderers (formatNarration / animateTextHtml) receive final text.
    const userName = personaInfo?.name || "You";
    for (let i = 0; i < result.length; i++) {
      const seg = result[i]!;
      const content = resolveMessageMacros(seg.content, {
        userName,
        persona: personaInfo,
        primaryCharacter: resolveMacroCharacter(seg.speaker),
        characters: macroCharacters,
      });
      if (content !== seg.content) result[i] = { ...seg, content };
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
    speakerColors,
    latestUserMessage,
    personaInfo,
    partyDialogue,
    partyChatInput,
    partyChatInputMessageId,
    partyChatMessageId,
    macroCharacters,
    resolveMacroCharacter,
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
    const map = new Map<number, PartyDialogueLine[]>();

    const userName = personaInfo?.name || "You";
    const subMacros = (text: string, speaker: string | null): string =>
      resolveMessageMacros(text, {
        userName,
        persona: personaInfo,
        primaryCharacter: resolveMacroCharacter(speaker),
        characters: macroCharacters,
      });

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
            content: subMacros(seg.content, seg.speaker ?? null),
            expression: seg.sprite,
            target: seg.whisperTarget,
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
          const arr = map.get(lastPartySegIdx) ?? [];
          arr.push({
            ...line,
            character: editedCharacter,
            content: subMacros(editedContent, editedCharacter),
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

    return map;
  }, [
    latestAssistant,
    macroCharacters,
    partyDialogue,
    partyChatMessageId,
    personaInfo,
    resolveMacroCharacter,
    segmentDeletes,
    segmentEdits,
    segments,
    speakerColors,
  ]);

  const active = segments[activeIndex] ?? null;
  const activeSourceMessageId = active ? segmentSourceMessageIdsRef.current[activeIndex] : null;
  const activeSourceMessage = activeSourceMessageId ? (sourceMessagesById.get(activeSourceMessageId) ?? null) : null;
  const activeTranslatedText = activeSourceMessageId ? translations[activeSourceMessageId] : undefined;
  const activeIsTranslating = activeSourceMessageId ? !!translating[activeSourceMessageId] : false;

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
  const narrationComplete = !isStreaming && segments.length > 0 && activeIndex === segments.length - 1 && doneTyping;

  // Notify parent about narration completion state
  useEffect(() => {
    onNarrationComplete?.(narrationComplete);
  }, [narrationComplete, onNarrationComplete]);

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
        // Apply segment edit overlays
        if (segmentEdits) {
          for (let si = 0; si < allSegs.length; si++) {
            const edited = segmentEdits.get(`${msg.id}:${si}`);
            if (edited) allSegs[si] = applySegmentEditOverlay(allSegs[si]!, edited, speakerColors);
          }
        }
        // Find the active segment by ID in the unfiltered list so side/extra offsets don't skew the slice
        const activeSegId = segments[activeIndex]?.id;
        let readUpTo = allSegs.length; // fallback: show all
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
        for (let si = 0; si < Math.min(readUpTo, allSegs.length); si++) {
          if (isDeletedSegment(segmentDeletes, msg.id, si)) continue;
          currentSegs.push(withSegmentSource(allSegs[si]!, msg.id, si, msg.role));
        }
        if (currentSegs.length > 0) entries.push({ messageId: msg.id, segments: currentSegs });
      } else {
        // Past scenes: include ALL segments (narration, dialogue, party chat)
        const segs = parseNarrationSegments(msg, speakerColors);
        // Apply segment edit overlays
        if (segmentEdits) {
          for (let si = 0; si < segs.length; si++) {
            const edited = segmentEdits.get(`${msg.id}:${si}`);
            if (edited) segs[si] = applySegmentEditOverlay(segs[si]!, edited, speakerColors);
          }
        }
        const visibleSegs: NarrationSegment[] = [];
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
        : null;

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

    return entries;
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
    segmentEdits,
    segmentDeletes,
    sourceMessagesById,
    doneTyping,
  ]);

  // Report active speaker to parent for sprite viewport
  useEffect(() => {
    if (!onActiveSpeakerChange) return;
    if (!active || active.type !== "dialogue" || !active.speaker) {
      onActiveSpeakerChange(null);
      return;
    }
    const avatar = findNamedMapValue(speakerAvatars, active.speaker);
    if (avatar) {
      onActiveSpeakerChange({ name: active.speaker, avatarUrl: avatar, expression: active.sprite });
    } else {
      onActiveSpeakerChange(null);
    }
  }, [active, speakerAvatars, onActiveSpeakerChange]);

  // How many segments are prepended before the actual GM narration segments
  const playerSegmentOffset = latestUserMessage?.content && latestAssistant ? 1 : 0;

  const restoredRef = useRef(false);
  const lastNarrationMsgIdRef = useRef<string | undefined>(undefined);
  const segmentChangeReady = useRef(false);
  const segmentEnterReady = useRef(false);
  const narrationMessageChanged = Boolean(latestAssistant?.id && latestAssistant.id !== lastNarrationMsgIdRef.current);
  const gameInstantTextReveal = useUIStore((s) => s.gameInstantTextReveal);
  const gameTextSpeed = useUIStore((s) => s.gameTextSpeed);
  const gameAutoPlayDelay = useUIStore((s) => s.gameAutoPlayDelay);
  const chatFontColor = useUIStore((s) => s.chatFontColor);
  const narrationStyle = chatFontColor ? { color: chatFontColor } : undefined;
  const [autoPlay, setAutoPlay] = useState(false);

  const getSegmentStartVisibleChars = useCallback(
    (index: number) => {
      const segment = segments[index];
      if (!segment || !gameInstantTextReveal || directionsActive) return 0;
      return effectDisplayLength(segment.content);
    },
    [segments, gameInstantTextReveal, directionsActive],
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

    const shouldRestorePosition =
      (isRestored || hasStoredNarrationPosition) && !restoredRef.current && segments.length > 0;
    if (shouldRestorePosition) {
      // Jump to saved segment index (or last segment if saved index exceeds current
      // segment count — party dialogue may not be restored yet).
      restoredRef.current = true;
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
    isStreaming,
    isRestored,
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

  // Persist segment index changes (skip until restore has settled or first message processed)
  useEffect(() => {
    if (!segmentChangeReady.current) return;
    onSegmentChange?.(activeIndex);
  }, [activeIndex, onSegmentChange]);

  // Notify parent when the active segment changes so segment-tied effects can fire
  useEffect(() => {
    if (!segmentEnterReady.current) return;
    if (!onSegmentEnter) return;
    // Convert activeIndex to narration-only index (skip the prepended player segment)
    const narrationIndex = activeIndex - playerSegmentOffset;
    if (narrationIndex >= 0) {
      onSegmentEnter(narrationIndex);
    }
  }, [activeIndex, onSegmentEnter, playerSegmentOffset]);

  // Trigger readable overlay when the typewriter finishes a readable segment
  const readableFiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (narrationMessageChanged) return;
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
  }, [active, narrationMessageChanged, visibleChars, onReadable]);

  useEffect(() => {
    if (!active) return;
    // Pause typewriter while direction effects (fades, flashes, etc.) are playing
    if (directionsActive) return;
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
  }, [active, gameInstantTextReveal, gameTextSpeed, directionsActive]); // visibleChars intentionally excluded — managed internally

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

      const content = editingLogSeg.content.trim();
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

        const speaker = editingLogSeg.speaker?.trim() || options.fallbackSpeaker?.trim() || undefined;
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

  const nextSegment = () => {
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
  };

  // Auto-advance to the next segment after a delay when auto-play is on
  useEffect(() => {
    if (!autoPlay) return;
    if (!active || !doneTyping) return;
    if (isStreaming || partyTurnPending || scenePreparing || directionsActive) return;
    if (autoPlayBlocked) return;
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
    editingContent,
    getSegmentStartVisibleChars,
    playClickSfx,
  ]);

  const activeAvatar = useMemo(() => {
    if (!active || active.type !== "dialogue" || !active.speaker) return null;
    // Try to resolve a sprite image matching the expression (exclude full-body sprites for avatar)
    if (active.sprite && spriteMap) {
      const sprites = findNamedMapValue(spriteMap, active.speaker);
      if (sprites?.length) {
        const exprLower = active.sprite.toLowerCase();
        // Only consider expression sprites (not full-body) for the dialogue avatar
        const expressionSprites = sprites.filter((s) => !s.expression.toLowerCase().startsWith("full_"));
        if (expressionSprites.length) {
          const exact = expressionSprites.find((s) => s.expression.toLowerCase() === exprLower);
          if (exact) return exact.url;
          const partial = expressionSprites.find(
            (s) => s.expression.toLowerCase().includes(exprLower) || exprLower.includes(s.expression.toLowerCase()),
          );
          if (partial) return partial.url;
          // If no matching expression found, use the first available expression sprite
          return expressionSprites[0]!.url;
        }
      }
    }
    // Fall back to base avatar
    return findNamedMapValue(speakerAvatars, active.speaker) ?? null;
  }, [active, speakerAvatars, spriteMap]);

  // Side lines paired with the active segment
  const activeSideLines = sideLineMap.get(activeIndex) ?? [];

  // Shared Next + auto-play control group used by dialogue, narration, and readable boxes
  const navControls = (
    <div className="flex items-stretch gap-1">
      <button
        onClick={() => setAutoPlay((v) => !v)}
        className={cn(
          "flex items-center justify-center self-stretch rounded-lg border px-2 text-xs transition-colors",
          autoPlay
            ? "border-[var(--primary)]/40 bg-[var(--primary)]/20 text-white"
            : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10",
        )}
        title={autoPlay ? "Pause auto-play" : "Auto-play segments"}
      >
        {autoPlay ? <Pause size={12} /> : <Play size={12} />}
      </button>
      <button
        onClick={nextSegment}
        className="flex items-center justify-center self-stretch rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white/75 transition-colors hover:bg-white/10"
      >
        {!doneTyping ? "Reveal" : "Next"}
      </button>
    </div>
  );

  return (
    <div className="relative flex min-h-0 flex-1 items-end px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-20 md:pt-24 sm:px-6 md:pb-4">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/15 to-transparent" />

      <div data-tour="game-dialogue" className="relative z-10 mx-auto w-full max-w-4xl">
        {/* Side remarks — small floating box shown with the dialogue they follow */}
        {activeSideLines.length > 0 && doneTyping && (
          <div className="mb-2 flex w-full flex-col space-y-1.5">
            {activeSideLines.map((line, i) => {
              const charAvatar = findNamedMapValue(speakerAvatars, line.character) ?? null;
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

        <div className="rounded-2xl border border-white/15 bg-black/50 p-3 backdrop-blur-md shadow-[0_16px_38px_rgba(0,0,0,0.45)]">
          {/* Scene preparation gate: wait for effects before showing narration */}
          {scenePreparing && (
            <div className="flex items-center gap-2 py-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <span className="text-sm text-white/70">
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
                  <button
                    onClick={onRetryScene}
                    className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                  >
                    <RefreshCw size={12} />
                    Retry
                  </button>
                )}
                {onSkipScene && (
                  <button
                    onClick={onSkipScene}
                    className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/20 hover:text-white"
                  >
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
                className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/20 hover:text-white"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          )}

          {!scenePreparing && !active && !isStreaming && (
            <p className="text-sm text-[var(--muted-foreground)]">Send an action to begin the scene.</p>
          )}

          {!scenePreparing && active && active.type === "dialogue" && (
            <>
              {/* VN-style dialogue: avatar left, text right, name top-left */}
              {(() => {
                const activeCanUploadPortrait = canUploadNpcPortrait(active.speaker);
                return (
                  <div className="flex gap-3">
                    {/* Left: Speaker avatar with reaction indicator */}
                    <div className="relative flex shrink-0 flex-col items-center gap-1">
                      {activeCanUploadPortrait ? (
                        <button
                          type="button"
                          onClick={() => triggerNpcPortraitUpload(active.speaker)}
                          className="rounded-xl transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-white/30"
                          title="Upload or replace NPC portrait"
                        >
                          {activeAvatar ? (
                            <img
                              src={activeAvatar}
                              alt={active.speaker || ""}
                              className="h-16 w-16 rounded-xl border-2 border-white/15 object-cover shadow-xl transition-colors hover:border-white/30 sm:h-20 sm:w-20"
                            />
                          ) : (
                            <img
                              src="/npc-silhouette.svg"
                              alt={active.speaker || "?"}
                              className="h-16 w-16 rounded-xl border-2 border-white/15 object-cover shadow-xl transition-colors hover:border-white/30 sm:h-20 sm:w-20"
                            />
                          )}
                        </button>
                      ) : activeAvatar ? (
                        <img
                          src={activeAvatar}
                          alt={active.speaker || ""}
                          className="h-16 w-16 rounded-xl border-2 border-white/15 object-cover shadow-xl sm:h-20 sm:w-20"
                        />
                      ) : (
                        <img
                          src="/npc-silhouette.svg"
                          alt={active.speaker || "?"}
                          className="h-16 w-16 rounded-xl border-2 border-white/15 object-cover shadow-xl sm:h-20 sm:w-20"
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
                                : "border-white/10 bg-black/35",
                          )}
                        >
                          {editingContent !== null ? (
                            <textarea
                              ref={editTextareaRef}
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="w-full resize-none bg-transparent text-sm leading-relaxed text-white/90 outline-none"
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
                                  : "after:ml-0.5 after:inline-block after:h-4 after:w-[1px] after:animate-pulse after:bg-white/60 after:align-middle",
                              )}
                              style={
                                active.color
                                  ? ({ color: active.color, "--speaker-color": active.color } as React.CSSProperties)
                                  : undefined
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
                        {doneTyping &&
                          onEditSegment &&
                          editingContent === null &&
                          segmentEditInfoRef.current[activeIndex] != null && (
                            <button
                              onClick={() => setEditingContent(active.content)}
                              className="absolute right-1.5 top-1.5 rounded p-1 text-white/20 transition-colors hover:bg-white/10 hover:text-white/60"
                              title="Edit"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                        {editingContent !== null && (
                          <button
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
                  <button
                    onClick={() => setLogsOpen(true)}
                    disabled={logEntries.length === 0}
                    className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/75 transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    <ScrollText size={12} />
                    Logs
                  </button>
                  {onOpenInventory && (
                    <button
                      onClick={onOpenInventory}
                      className="relative flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/75 transition-colors hover:bg-white/10"
                    >
                      <Package size={12} />
                      Inventory
                      {(inventoryCount ?? 0) > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[0.55rem] font-bold text-black">
                          {inventoryCount}
                        </span>
                      )}
                    </button>
                  )}
                </div>
                {!narrationComplete && !isStreaming && !partyTurnPending && navControls}
              </div>
            </>
          )}

          {!scenePreparing && active && active.type === "narration" && (
            <>
              {/* Narration: centered, no avatar */}
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-white/90">
                  Narration
                </span>
              </div>

              <div className="relative game-narration-prose max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 sm:max-h-48">
                {editingContent !== null ? (
                  <textarea
                    ref={editTextareaRef}
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    className="w-full resize-none bg-transparent text-sm leading-relaxed text-white/90 outline-none"
                    rows={3}
                    autoFocus
                  />
                ) : (
                  <div
                    className={cn(
                      "text-sm leading-relaxed",
                      doneTyping
                        ? ""
                        : "after:ml-0.5 after:inline-block after:h-4 after:w-[1px] after:animate-pulse after:bg-white/60 after:align-middle",
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
                {doneTyping &&
                  onEditSegment &&
                  editingContent === null &&
                  segmentEditInfoRef.current[activeIndex] != null && (
                    <button
                      onClick={() => setEditingContent(active.content)}
                      className="absolute right-1.5 top-1.5 rounded p-1 text-white/20 transition-colors hover:bg-white/10 hover:text-white/60"
                      title="Edit"
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                {editingContent !== null && (
                  <button
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
              </div>

              {doneTyping &&
                renderTranslationPanel(activeSourceMessage, activeTranslatedText, activeIsTranslating, "mt-2")}

              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setLogsOpen(true)}
                    disabled={logEntries.length === 0}
                    className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/75 transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    <ScrollText size={12} />
                    Logs
                  </button>
                  {onOpenInventory && (
                    <button
                      onClick={onOpenInventory}
                      className="relative flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/75 transition-colors hover:bg-white/10"
                    >
                      <Package size={12} />
                      Inventory
                      {(inventoryCount ?? 0) > 0 && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[0.55rem] font-bold text-black">
                          {inventoryCount}
                        </span>
                      )}
                    </button>
                  )}
                </div>
                {!narrationComplete && !isStreaming && navControls}
              </div>
            </>
          )}

          {/* Readable segment: note or book found in the narrative */}
          {!scenePreparing && active && active.type === "readable" && (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-white/70">
                  {active.readableType === "book" ? "Book" : "Note"}
                </span>
              </div>

              <div className="game-narration-prose max-h-40 overflow-y-auto rounded-xl border border-amber-400/20 bg-amber-950/20 px-3 py-2.5 sm:max-h-48">
                <div
                  className={cn(
                    "text-sm italic leading-relaxed text-amber-200/80",
                    doneTyping
                      ? ""
                      : "after:ml-0.5 after:inline-block after:h-4 after:w-[1px] after:animate-pulse after:bg-amber-200/60 after:align-middle",
                  )}
                  dangerouslySetInnerHTML={{
                    __html: animateTextHtml(
                      formatNarration(slicePreservingEffects(active.content, visibleChars), false),
                    ),
                  }}
                />
              </div>

              {doneTyping &&
                renderTranslationPanel(activeSourceMessage, activeTranslatedText, activeIsTranslating, "mt-2")}

              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setLogsOpen(true)}
                    disabled={logEntries.length === 0}
                    className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/75 transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    <ScrollText size={12} />
                    Logs
                  </button>
                </div>
                {!narrationComplete && !isStreaming && navControls}
              </div>
            </>
          )}

          {/* Inline input — appears inside the narration box once all segments are read */}
          {!scenePreparing && narrationComplete && !isStreaming && !partyTurnPending && inputSlot && (
            <div className="mt-2">{inputSlot}</div>
          )}

          {/* Also show input when no narration at all (start of scene) */}
          {!scenePreparing && !active && !isStreaming && inputSlot && (
            <div className="mt-2">
              {logEntries.length > 0 && (
                <div className="mb-2">
                  <button
                    onClick={() => setLogsOpen(true)}
                    className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/75 transition-colors hover:bg-white/10"
                  >
                    <ScrollText size={12} />
                    Logs
                  </button>
                </div>
              )}
              {inputSlot}
            </div>
          )}

          {isStreaming && (
            <div className="mt-2 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
              <span className="animate-pulse">●</span>
              <span>The Game Master is writing the next segment...</span>
            </div>
          )}
        </div>
      </div>

      {/* Logs modal */}
      {logsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
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
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h3 className="text-sm font-semibold text-white">Session Logs</h3>
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
            <div
              className="flex-1 overflow-y-auto px-4 py-3 space-y-4"
              ref={(el) => {
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
              {logEntries.map((entry) => {
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
                      const handleSegRowClick = canJumpToSeg
                        ? (e: ReactMouseEvent<HTMLDivElement>) => {
                            const target = e.target as HTMLElement;
                            if (target.closest("button, input, textarea, a")) return;
                            setActiveIndex(liveSegmentIndex);
                            setVisibleChars(getSegmentStartVisibleChars(liveSegmentIndex));
                            setLogsOpen(false);
                            setEditingLogSeg(null);
                            logScrolledRef.current = false;
                          }
                        : undefined;
                      const jumpRowClasses = canJumpToSeg ? "cursor-pointer hover:ring-1 hover:ring-white/15" : "";
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
                      const showDeleteButton = canDeleteMessage || canDeleteThisSegment;
                      const deleteButton = showDeleteButton ? (
                        <button
                          onClick={() => {
                            if (canDeleteMessage && sourceMessageId) {
                              onDeleteMessage?.(sourceMessageId);
                            } else if (canDeleteThisSegment && sourceMessageId) {
                              onDeleteSegment?.(sourceMessageId, sourceSegmentIndex);
                            }
                          }}
                          className={cn(
                            "absolute top-1.5 rounded p-1 text-white/20 opacity-0 transition-all group-hover/logseg:opacity-100 hover:bg-red-500/20 hover:text-red-400",
                            canEdit ? "right-7" : "right-1.5",
                          )}
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

                      const editButtons = canEdit && (
                        <>
                          {!isEditingThis && (
                            <button
                              onClick={() =>
                                sourceMessageId &&
                                setEditingLogSeg({
                                  messageId: sourceMessageId,
                                  segIndex: sourceSegmentIndex,
                                  content: seg.type === "readable" ? (seg.readableContent ?? seg.content) : seg.content,
                                  speaker: canEditSegment && seg.type === "dialogue" ? (seg.speaker ?? "") : undefined,
                                  segmentType: seg.type,
                                  readableType: seg.readableType,
                                })
                              }
                              className="absolute right-1.5 top-1.5 rounded p-1 text-white/20 opacity-0 transition-all group-hover/logseg:opacity-100 hover:bg-white/10 hover:text-white/60"
                              title="Edit"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                          {isEditingThis && (
                            <button
                              onClick={() =>
                                commitLogEdit({
                                  sourceMessageId,
                                  sourceSegmentIndex,
                                  canEditMessage,
                                  canEditSegment,
                                  fallbackSpeaker: seg.speaker,
                                })
                              }
                              className="absolute right-1.5 top-1.5 z-10 rounded bg-emerald-500/20 p-1 text-emerald-300 transition-colors hover:bg-emerald-500/30"
                              title="Save"
                            >
                              <Check size={11} />
                            </button>
                          )}
                        </>
                      );

                      const editSpeakerInput =
                        isEditingThis && seg.type === "dialogue" && canEditSegment ? (
                          <input
                            className="mb-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-[0.7rem] font-semibold text-white/90 outline-none focus:border-white/30"
                            value={editingLogSeg?.speaker ?? ""}
                            placeholder="Speaker name"
                            onChange={(e) =>
                              setEditingLogSeg((current) =>
                                current ? { ...current, speaker: e.target.value } : current,
                              )
                            }
                          />
                        ) : null;

                      const editTextarea = isEditingThis && (
                        <textarea
                          ref={logEditTextareaRef}
                          className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-white/90 outline-none focus:border-white/30"
                          value={editingLogSeg.content}
                          rows={3}
                          autoFocus
                          onChange={(e) => setEditingLogSeg({ ...editingLogSeg, content: e.target.value })}
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
                        const logAvatar = seg.speaker ? findNamedMapValue(speakerAvatars, seg.speaker) : null;
                        const canUploadLogPortrait = canUploadNpcPortrait(seg.speaker);
                        return (
                          <div
                            key={seg.id}
                            onClick={handleSegRowClick}
                            title={canJumpToSeg ? "Jump back to this segment" : undefined}
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
                              jumpRowClasses,
                            )}
                          >
                            {deleteButton}
                            {editButtons}
                            {canUploadLogPortrait ? (
                              <button
                                type="button"
                                onClick={() => triggerNpcPortraitUpload(seg.speaker)}
                                className="shrink-0 rounded-lg transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-white/20"
                                title="Upload or replace NPC portrait"
                              >
                                {logAvatar ? (
                                  <img
                                    src={logAvatar}
                                    alt={seg.speaker || ""}
                                    className="h-8 w-8 rounded-lg border border-white/10 object-cover transition-colors hover:border-white/25"
                                  />
                                ) : (
                                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[var(--accent)] text-[0.5rem] font-bold transition-colors hover:border-white/25">
                                    {(seg.speaker || "?")[0]}
                                  </div>
                                )}
                              </button>
                            ) : logAvatar ? (
                              <img
                                src={logAvatar}
                                alt={seg.speaker || ""}
                                className="h-8 w-8 shrink-0 rounded-lg border border-white/10 object-cover"
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
                                  style={seg.color ? { color: seg.color } : undefined}
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
                            onClick={handleSegRowClick}
                            title={canJumpToSeg ? "Jump back to this segment" : undefined}
                            className={cn(
                              "group/logseg relative rounded-lg border border-cyan-400/15 bg-cyan-950/15 px-3 py-2",
                              isActiveSeg && "ring-1 ring-[var(--primary)]/40",
                              jumpRowClasses,
                            )}
                          >
                            {deleteButton}
                            <div className="mb-1 flex items-center">
                              <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-cyan-200/80">
                                System
                              </span>
                            </div>
                            <div
                              className="whitespace-pre-wrap break-words pr-6 text-xs leading-relaxed text-cyan-50/80"
                              dangerouslySetInnerHTML={{ __html: animateTextHtml(formatNarration(seg.content, false)) }}
                            />
                          </div>
                        );
                      }
                      if (seg.type === "readable") {
                        return (
                          <div
                            key={seg.id}
                            onClick={handleSegRowClick}
                            title={canJumpToSeg ? "Jump back to this segment" : undefined}
                            className={cn(
                              "group/logseg relative rounded-lg border border-amber-400/15 bg-amber-950/15 px-3 py-2",
                              isActiveSeg && "ring-1 ring-[var(--primary)]/40",
                              jumpRowClasses,
                            )}
                          >
                            {deleteButton}
                            {editButtons}
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
                          onClick={handleSegRowClick}
                          title={canJumpToSeg ? "Jump back to this segment" : undefined}
                          className={cn(
                            "group/logseg relative rounded-lg border border-white/5 bg-black/20 px-3 py-2",
                            isActiveSeg && "ring-1 ring-[var(--primary)]/40",
                            jumpRowClasses,
                          )}
                        >
                          {deleteButton}
                          {editButtons}
                          <div className="mb-1 flex items-center">
                            <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-white/80">
                              Narration
                            </span>
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

function PartyOverlayBox({
  line,
  avatar,
  color,
  nameColor,
}: {
  line: PartyDialogueLine;
  avatar: string | null;
  color?: string;
  nameColor?: string;
}) {
  const styleByType: Record<string, { border: string; bg: string; icon: string; labelColor: string }> = {
    side: { border: "border-sky-400/20", bg: "bg-sky-500/8", icon: "💬", labelColor: "text-sky-200/80" },
    extra: { border: "border-sky-400/20", bg: "bg-sky-500/8", icon: "💬", labelColor: "text-sky-200/80" },
    thought: { border: "border-purple-400/20", bg: "bg-purple-500/8", icon: "💭", labelColor: "text-purple-200/80" },
    whisper: { border: "border-rose-400/20", bg: "bg-rose-500/8", icon: "🤫", labelColor: "text-rose-200/80" },
  };
  const style = styleByType[line.type] ?? styleByType.side!;

  return (
    <div
      className={cn(
        "flex w-fit min-w-0 max-w-full items-start gap-2 rounded-xl border px-3 py-2 backdrop-blur-md sm:max-w-[75%]",
        style.border,
        style.bg,
      )}
    >
      {avatar ? (
        <img
          src={avatar}
          alt={line.character}
          className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-white/15 object-cover"
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
              __html: formatNarration(
                line.type === "side" || line.type === "extra" || line.type === "whisper"
                  ? `"${line.content}"`
                  : line.content,
                false,
              ),
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Anime-style expression reaction indicators ──

const EXPRESSION_REACTIONS: Record<string, { symbol: string; color: string; animation: string }> = {
  // Anger / frustration
  angry: { symbol: "❗", color: "text-red-400", animation: "animate-bounce" },
  furious: { symbol: "‼️", color: "text-red-500", animation: "animate-bounce" },
  annoyed: { symbol: "💢", color: "text-red-400", animation: "animate-pulse" },
  irritated: { symbol: "💢", color: "text-orange-400", animation: "animate-pulse" },

  // Confusion / surprise
  confused: { symbol: "❓", color: "text-yellow-300", animation: "animate-bounce" },
  surprised: { symbol: "❗", color: "text-yellow-300", animation: "animate-bounce" },
  shocked: { symbol: "‼️", color: "text-yellow-400", animation: "animate-bounce" },

  // Joy / amusement
  happy: { symbol: "✨", color: "text-amber-300", animation: "animate-pulse" },
  amused: { symbol: "✨", color: "text-amber-300", animation: "animate-pulse" },
  delighted: { symbol: "✨", color: "text-yellow-300", animation: "animate-pulse" },
  mischievous: { symbol: "😈", color: "text-purple-300", animation: "animate-bounce" },

  // Affection
  flirty: { symbol: "💗", color: "text-pink-400", animation: "animate-pulse" },
  tender: { symbol: "💕", color: "text-pink-300", animation: "animate-pulse" },
  loving: { symbol: "💕", color: "text-pink-300", animation: "animate-pulse" },

  // Sadness
  sad: { symbol: "💧", color: "text-blue-300", animation: "animate-pulse" },
  crying: { symbol: "💧", color: "text-blue-400", animation: "animate-bounce" },

  // Fear / worry
  scared: { symbol: "💦", color: "text-sky-300", animation: "animate-bounce" },
  worried: { symbol: "💦", color: "text-sky-300", animation: "animate-pulse" },
  nervous: { symbol: "💦", color: "text-sky-300", animation: "animate-pulse" },

  // Thinking
  thinking: { symbol: "💭", color: "text-white/50", animation: "animate-pulse" },

  // Smug / confident
  smirk: { symbol: "✧", color: "text-amber-300", animation: "animate-pulse" },
  smug: { symbol: "✧", color: "text-amber-400", animation: "animate-pulse" },
  determined: { symbol: "🔥", color: "text-orange-400", animation: "animate-pulse" },
  battle_stance: { symbol: "⚔️", color: "text-orange-300", animation: "animate-bounce" },

  // Cold / dismissive
  cold: { symbol: "❄️", color: "text-sky-300", animation: "animate-pulse" },
  disgusted: { symbol: "💢", color: "text-green-400", animation: "animate-pulse" },
  deadpan: { symbol: "…", color: "text-white/40", animation: "" },
  eye_roll: { symbol: "…", color: "text-white/40", animation: "" },
  bored: { symbol: "💤", color: "text-white/30", animation: "animate-pulse" },
};

function ExpressionReaction({ expression }: { expression?: string }) {
  if (!expression) return null;
  const key = expression.toLowerCase().replace(/[_\s-]/g, "_");
  const reaction = EXPRESSION_REACTIONS[key];
  if (!reaction) return null;

  return (
    <div
      className={cn(
        "absolute -right-1 -top-1 text-base drop-shadow-lg sm:-right-2 sm:-top-2 sm:text-lg",
        reaction.color,
        reaction.animation,
      )}
    >
      {reaction.symbol}
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

  const lines = source.split(/\r?\n/);
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

function formatNarration(content: string, boldDialogue = true): string {
  let html = content
    .replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/gs, "<em>$1</em>")
    .replace(/\n/g, "<br />")
    .replace(
      /\[dice:(\d+d\d+[+-]?\d*)\s*=\s*(\d+)\]/g,
      '<span class="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/60 font-mono">🎲 $1 → $2</span>',
    )
    .replace(
      /\[state:\s*(\w+)\]/g,
      '<span class="inline-flex items-center gap-1 rounded bg-sky-500/20 px-1.5 py-0.5 text-xs text-sky-300">⚡ $1</span>',
    );

  if (boldDialogue) {
    const narrationQuoteRe = new RegExp(`(?<![=\\w])(?:${HTML_SAFE_DIALOGUE_QUOTE_PATTERN_SOURCE})`, "g");
    html = html.replace(narrationQuoteRe, (match) => `<strong>${match}</strong>`);
  }

  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ["strong", "em", "br", "span"], ALLOWED_ATTR: ["class"] });
}
