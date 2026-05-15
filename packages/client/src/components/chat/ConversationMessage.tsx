// ──────────────────────────────────────────────
// Chat: Discord-style conversation message
// ──────────────────────────────────────────────
import { useState, useCallback, useRef, useEffect, memo, useMemo, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Pencil,
  Trash2,
  Copy,
  RefreshCw,
  Eye,
  ScrollText,
  Brain,
  X,
  User,
  Languages,
} from "lucide-react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { Message, MessageExtra } from "@marinara-engine/shared";
import { useUIStore } from "../../stores/ui.store";
import { useChatStore } from "../../stores/chat.store";
import { cn, copyToClipboard, getAvatarCropStyle, parseAvatarCropJson } from "../../lib/utils";
import { applyInlineMarkdown, renderMarkdownBlocks } from "../../lib/markdown";
import { chatKeys } from "../../hooks/use-chats";
import { resolveMessageMacros } from "../../lib/chat-macros";
import { useTranslate } from "../../hooks/use-translate";
import { api } from "../../lib/api-client";
import type { CharacterMap, MessageSelectionToggle, PersonaInfo } from "./chat-area.types";
import { GenerationReplayDetailsModal, hasGenerationReplayDetails } from "./GenerationReplayDetailsModal";
import { ImagePromptPanel } from "./ImagePromptPanel";
import { SwipeJumpControl } from "./SwipeJumpControl";

/** Build style object for name color (supports gradients). */
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

/** Regex to detect a message that is just an image/GIF URL */
const IMAGE_URL_RE = /^https?:\/\/\S+\.(?:gif|png|jpe?g|webp)(?:\?[^\s]*)?$/i;

/** Highlight @mentions in a list of ReactNodes. Scans string nodes for @CharacterName and wraps matches in a styled span. */
function highlightMentions(nodes: ReactNode[], names: string[], keyPrefix: string): ReactNode[] {
  if (names.length === 0) return nodes;
  // Sort longest-first so "Mary Jane" matches before "Mary"
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(@(?:${sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))(\\b|(?=[^\\w])|$)`,
    "gi",
  );
  let key = 0;
  return nodes.flatMap((node) => {
    if (typeof node !== "string") return [node];
    const parts: ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(node)) !== null) {
      if (m.index > lastIdx) parts.push(node.slice(lastIdx, m.index));
      parts.push(
        <span
          key={`${keyPrefix}at${key++}`}
          className="mention-highlight rounded-[3px] bg-[var(--primary)]/15 px-px text-[var(--primary)] font-medium hover:bg-[var(--primary)]/25 cursor-default"
        >
          {m[1]}
        </span>,
      );
      lastIdx = m.index + m[1]!.length;
      // Don't consume the boundary character
      pattern.lastIndex = lastIdx;
    }
    if (lastIdx < node.length) parts.push(node.slice(lastIdx));
    return parts.length > 0 ? parts : [node];
  });
}

/** Renders message content, showing image URLs as inline images */
function MessageContent({
  content,
  mentionNames,
  onImageOpen,
}: {
  content: string;
  mentionNames?: string[];
  onImageOpen: (url: string) => void;
}) {
  if (IMAGE_URL_RE.test(content.trim())) {
    const url = content.trim();
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onImageOpen(url);
        }}
        className="block cursor-zoom-in rounded-lg text-left"
        title="Open image"
      >
        <img src={url} alt="GIF" className="max-h-48 max-w-full sm:max-w-xs rounded-lg" loading="lazy" />
      </button>
    );
  }

  // Collapse runs of 3+ blank lines into a double newline (preserve paragraph breaks)
  const compacted = content.replace(/\n{3,}/g, "\n\n");

  // Use shared block-level renderer with mention support
  const renderInline = mentionNames?.length
    ? (text: string, kp: string) => highlightMentions(applyInlineMarkdown(text, kp), mentionNames, kp)
    : applyInlineMarkdown;

  return <>{renderMarkdownBlocks(compacted, renderInline)}</>;
}

/** Parse <speaker="Name">text</speaker> tags into segments */
interface SpeakerSegment {
  speaker: string | null; // null = narration / non-attributed text
  text: string;
}
function parseSpeakerTags(content: string, knownNames: Set<string>): SpeakerSegment[] | null {
  const regex = /<speaker="([^"]*)">([\s\S]*?)<\/speaker>/g;
  let match: RegExpExecArray | null;
  const segments: SpeakerSegment[] = [];
  let lastIndex = 0;
  let foundTag = false;
  while ((match = regex.exec(content)) !== null) {
    foundTag = true;
    const speakerName = match[1]!.trim();
    const knownSpeaker = knownNames.has(speakerName.toLowerCase());
    // Text before this tag
    if (match.index > lastIndex) {
      const before = content.slice(lastIndex, match.index).trim();
      if (before) segments.push({ speaker: null, text: before });
    }
    segments.push({ speaker: knownSpeaker ? speakerName : null, text: match[2]!.trim() });
    lastIndex = regex.lastIndex;
  }
  // Trailing text
  if (lastIndex < content.length) {
    const after = content.slice(lastIndex).trim();
    if (after) segments.push({ speaker: null, text: after });
  }
  return foundTag ? segments : null;
}

/** Parse "Name: text" format into segments. Requires known character names to avoid false positives. */
function parseNamePrefixFormat(content: string, knownNames: Set<string>): SpeakerSegment[] | null {
  if (!knownNames.size) return null;
  const lines = content.split("\n");
  const segments: SpeakerSegment[] = [];
  let currentSpeaker: string | null = null;
  let currentLines: string[] = [];
  let found = false;

  for (const line of lines) {
    // Check if the line starts with "KnownName: "
    const colonIdx = line.indexOf(": ");
    if (colonIdx > 0) {
      const potentialName = line.slice(0, colonIdx).trim();
      if (knownNames.has(potentialName.toLowerCase())) {
        // Save previous segment
        if (currentLines.length > 0) {
          segments.push({ speaker: currentSpeaker, text: currentLines.join("\n") });
        }
        currentSpeaker = potentialName;
        currentLines = [line.slice(colonIdx + 2)];
        found = true;
        continue;
      }
    }
    // Continuation line for the current speaker
    currentLines.push(line);
  }
  if (currentLines.length > 0) {
    segments.push({ speaker: currentSpeaker, text: currentLines.join("\n") });
  }
  if (!found) return null;
  // Filter out empty segments
  return segments.filter((s) => s.text.trim());
}

/** Group consecutive same-speaker segments so the header only shows once. */
interface GroupedSegment {
  speaker: string | null;
  lines: string[]; // each segment's text joined
}
function groupConsecutiveSegments(segments: SpeakerSegment[]): GroupedSegment[] {
  const groups: GroupedSegment[] = [];
  for (const seg of segments) {
    const last = groups[groups.length - 1];
    const trimmed = seg.text.replace(/^\n+|\n+$/g, "");
    if (last && last.speaker && seg.speaker && last.speaker.toLowerCase() === seg.speaker.toLowerCase()) {
      last.lines.push(trimmed);
    } else {
      groups.push({ speaker: seg.speaker, lines: [trimmed] });
    }
  }
  return groups;
}

interface MessageData {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system" | "narrator";
  characterId: string | null;
  content: string;
  activeSwipeIndex: number;
  swipeCount?: number;
  extra: {
    displayText: string | null;
    isGenerated: boolean;
    tokenCount: number | null;
    generationInfo: {
      model?: string;
      tokensIn?: number;
      tokensOut?: number;
      duration?: number;
    } | null;
    isConversationStart?: boolean;
    thinking?: string | null;
    generationReplay?: MessageExtra["generationReplay"];
    attachments?: Array<{ type: string; url: string; filename?: string; prompt?: string; galleryId?: string }>;
  };
  createdAt: string;
}

interface ConversationMessageProps {
  message: MessageData;
  isStreaming?: boolean;
  isGrouped?: boolean;
  hideActions?: boolean;
  noHoverGroup?: boolean;
  forceShowActions?: boolean;
  onDelete?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void;
  onSetActiveSwipe?: (messageId: string, index: number) => void;
  onPeekPrompt?: () => void;
  isLastAssistantMessage?: boolean;
  characterMap?: CharacterMap;
  personaInfo?: PersonaInfo;
  /** Override the edit button click (used by SplitMessageGroup) */
  onEditClick?: () => void;
  /** Character IDs that actually belong to this chat. Speaker-name rendering is scoped to these IDs. */
  chatCharacterIds?: string[];
  /** 1-based ordinal position in the message list. Shown under avatar when actions or message numbers are visible. */
  messageIndex?: number;
  messageOrderIndex?: number;
  multiSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (toggle: MessageSelectionToggle) => void;
}

export const ConversationMessage = memo(function ConversationMessage({
  message,
  isStreaming,
  isGrouped,
  hideActions,
  noHoverGroup,
  forceShowActions,
  onDelete,
  onRegenerate,
  onEdit,
  onSetActiveSwipe,
  onPeekPrompt,
  isLastAssistantMessage,
  characterMap,
  personaInfo,
  onEditClick,
  chatCharacterIds,
  messageIndex,
  messageOrderIndex,
  multiSelectMode,
  isSelected,
  onToggleSelect,
}: ConversationMessageProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [showGenerationReplay, setShowGenerationReplay] = useState(false);
  const [imageLightbox, setImageLightbox] = useState<{ url: string; prompt?: string | null } | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const hasInput = useChatStore((s) => s.currentInput.trim().length > 0);
  const guideGenerations = useUIStore((s) => s.guideGenerations);
  const chatFontSize = useUIStore((s) => s.chatFontSize);
  const showMessageNumbers = useUIStore((s) => s.showMessageNumbers);
  const messageTextStyle = useMemo<CSSProperties>(() => ({ fontSize: `${chatFontSize}px` }), [chatFontSize]);
  const isGuided = guideGenerations && hasInput;
  const regenerateButtonTitle = isGuided ? "Regenerate (guided)" : "Regenerate";
  const regenerateGuidedClass = isGuided
    ? "text-[var(--primary)] bg-[var(--primary)]/15 ring-1 ring-[var(--primary)]/30 hover:text-[var(--primary)] hover:bg-[var(--primary)]/20"
    : undefined;

  // Translation
  const { translate, translations, translating } = useTranslate();
  const translatedText = translations[message.id];
  const isTranslating = !!translating[message.id];

  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  // Parse extra early so we can access persona snapshot
  const extra = useMemo(() => {
    if (!message.extra) return {} as Record<string, any>;
    return typeof message.extra === "string" ? JSON.parse(message.extra) : message.extra;
  }, [message.extra]);
  const generationReplay = hasGenerationReplayDetails(extra.generationReplay) ? extra.generationReplay : null;
  // canRegenerate lets assistant messages retry; isUser messages need generationReplay
  // metadata from hasGenerationReplayDetails, such as /impersonate.
  const canRegenerate = !isUser || generationReplay !== null;

  useEffect(() => {
    if (!generationReplay) setShowGenerationReplay(false);
  }, [generationReplay]);

  const scopedCharacterMap = useMemo(() => {
    if (!characterMap) return null;
    if (!chatCharacterIds) return characterMap;
    const allowedIds = new Set(chatCharacterIds);
    return new Map(Array.from(characterMap).filter(([id]) => allowedIds.has(id)));
  }, [characterMap, chatCharacterIds]);

  // Character info
  const charInfo = message.characterId && scopedCharacterMap ? scopedCharacterMap.get(message.characterId) : null;
  const primaryCharInfo =
    charInfo ??
    (scopedCharacterMap
      ? (Array.from(scopedCharacterMap.values()).find(
          (candidate): candidate is NonNullable<typeof candidate> => !!candidate,
        ) ?? null)
      : null);

  // For user messages, prefer per-message persona snapshot (stored when message was sent)
  // to preserve the correct persona name/avatar even after switching personas.
  // Fall back to the current personaInfo prop for older messages without snapshots.
  const msgPersona = isUser && extra.personaSnapshot ? extra.personaSnapshot : null;
  const avatarUrl = isUser ? (msgPersona?.avatarUrl ?? personaInfo?.avatarUrl ?? null) : (charInfo?.avatarUrl ?? null);
  const personaAvatarCrop = isUser
    ? (parseAvatarCropJson(msgPersona?.avatarCrop) ?? personaInfo?.avatarCrop ?? null)
    : null;
  const avatarCropStyle = isUser ? getAvatarCropStyle(personaAvatarCrop) : getAvatarCropStyle(charInfo?.avatarCrop);
  const displayName = isUser
    ? (msgPersona?.name ?? personaInfo?.name ?? "You")
    : (primaryCharInfo?.name ?? "Assistant");
  const nameColor = isUser ? (msgPersona?.nameColor ?? personaInfo?.nameColor) : charInfo?.nameColor;
  const renderedContent = useMemo(
    () =>
      resolveMessageMacros(message.content, {
        userName: msgPersona?.name ?? personaInfo?.name ?? "You",
        persona: {
          name: msgPersona?.name ?? personaInfo?.name ?? "You",
          description: msgPersona?.description ?? personaInfo?.description,
          personality: msgPersona?.personality ?? personaInfo?.personality,
          backstory: msgPersona?.backstory ?? personaInfo?.backstory,
          appearance: msgPersona?.appearance ?? personaInfo?.appearance,
          scenario: msgPersona?.scenario ?? personaInfo?.scenario,
        },
        primaryCharacter: primaryCharInfo ?? { name: displayName },
        characters: scopedCharacterMap
          ? Array.from(scopedCharacterMap.values())
          : displayName
            ? [{ name: displayName }]
            : [],
      }),
    [
      displayName,
      message.content,
      msgPersona?.appearance,
      msgPersona?.backstory,
      msgPersona?.description,
      msgPersona?.name,
      msgPersona?.personality,
      msgPersona?.scenario,
      personaInfo?.appearance,
      personaInfo?.backstory,
      personaInfo?.description,
      personaInfo?.name,
      personaInfo?.personality,
      personaInfo?.scenario,
      primaryCharInfo,
      scopedCharacterMap,
    ],
  );

  // Remove an attachment from this message (keeps it in gallery)
  const qc = useQueryClient();
  const handleRemoveAttachment = useCallback(
    async (index: number) => {
      const current = (extra.attachments as any[]) ?? [];
      const updated = current.filter((_: any, i: number) => i !== index);
      // Optimistic: update the infinite query cache immediately so the image disappears
      const msgKey = chatKeys.messages(message.chatId);
      qc.setQueryData<InfiniteData<Message[]>>(msgKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) =>
            page.map((m) => {
              if (m.id !== message.id) return m;
              const ex = typeof m.extra === "string" ? JSON.parse(m.extra) : (m.extra ?? {});
              return { ...m, extra: { ...ex, attachments: updated } } as Message;
            }),
          ),
        };
      });
      await api.patch(`/chats/${message.chatId}/messages/${message.id}/extra`, { attachments: updated });
      qc.invalidateQueries({ queryKey: msgKey });
    },
    [extra.attachments, message.chatId, message.id, qc],
  );

  // Build name→character lookup for speaker tag resolution.
  // When multiple characters share the same name, prefer the one assigned to this message.
  const charByName = useMemo(() => {
    if (!scopedCharacterMap) return null;
    const map = new Map<string, NonNullable<ReturnType<CharacterMap["get"]>>>();
    for (const [id, v] of scopedCharacterMap) {
      if (v) {
        const key = v.name.toLowerCase();
        // If the message's own characterId matches this entry, always prefer it
        if (id === message.characterId) {
          map.set(key, v);
        } else if (!map.has(key)) {
          map.set(key, v);
        }
      }
    }
    return map;
  }, [scopedCharacterMap, message.characterId]);

  // Collect character names for @mention highlighting
  const mentionNames = useMemo(() => {
    if (!scopedCharacterMap) return [] as string[];
    const names: string[] = [];
    for (const [, v] of scopedCharacterMap) {
      if (v?.name) names.push(v.name);
    }
    return names;
  }, [scopedCharacterMap]);

  // Parse speaker tags or Name: text format for group merged-mode messages
  const groupedSegments = useMemo(() => {
    if (isUser || !renderedContent) return null;
    const knownNames = charByName ? new Set(charByName.keys()) : new Set<string>();
    // Try <speaker> tags first (backward compat)
    const speakerSegs = parseSpeakerTags(renderedContent, knownNames);
    if (speakerSegs) return groupConsecutiveSegments(speakerSegs);
    // Try Name: text format
    const nameSegs = parseNamePrefixFormat(renderedContent, knownNames);
    if (nameSegs) return groupConsecutiveSegments(nameSegs);
    return null;
  }, [isUser, renderedContent, charByName]);

  // Staggered reveal for multi-speaker grouped messages.
  // On first render (history load), show all segments immediately.
  // When content changes (new message arrival), reveal one by one.
  const segmentCount = groupedSegments?.length ?? 0;
  const prevContentRef = useRef(renderedContent);
  const initialRenderRef = useRef(true);
  const [visibleSegments, setVisibleSegments] = useState(segmentCount);

  useEffect(() => {
    // On initial mount, show everything (history messages)
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      setVisibleSegments(segmentCount);
      prevContentRef.current = renderedContent;
      return;
    }
    // Content changed — new message or regeneration
    if (renderedContent !== prevContentRef.current && segmentCount > 1) {
      prevContentRef.current = renderedContent;
      setVisibleSegments(1);
      let count = 1;
      const reveal = () => {
        count++;
        setVisibleSegments(count);
      };
      const timers: ReturnType<typeof setTimeout>[] = [];
      for (let i = 1; i < segmentCount; i++) {
        timers.push(setTimeout(reveal, i * 1500));
      }
      return () => timers.forEach(clearTimeout);
    }
    // Segment count changed without content change (shouldn't happen, but be safe)
    setVisibleSegments(segmentCount);
    prevContentRef.current = renderedContent;
  }, [renderedContent, segmentCount]);

  const thinking = extra?.thinking;
  const swipeCount = message.swipeCount ?? 0;
  const hasSwipes = swipeCount > 1;

  // Actions
  const handleCopy = useCallback(() => {
    copyToClipboard(renderedContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [renderedContent]);

  const startEditing = useCallback(() => {
    setEditing(true);
    setEditValue(message.content);
    requestAnimationFrame(() => {
      const el = editRef.current;
      if (el) {
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
        el.focus();
      }
    });
  }, [message.content]);

  useEffect(() => {
    if (!onEdit) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: string }>).detail;
      if (detail?.messageId !== message.id) return;
      if (onEditClick) onEditClick();
      else startEditing();
    };
    window.addEventListener("marinara:start-edit-message", handler);
    return () => window.removeEventListener("marinara:start-edit-message", handler);
  }, [message.id, onEdit, onEditClick, startEditing]);

  const editValueRef = useRef(editValue);
  editValueRef.current = editValue;

  const handleSaveEdit = useCallback(() => {
    const val = editValueRef.current.trim();
    if (val !== message.content) {
      onEdit?.(message.id, val);
    }
    setEditing(false);
  }, [message.content, message.id, onEdit]);

  // System messages — minimal display
  if (isSystem) {
    return (
      <div
        className={cn(
          "group flex justify-center py-1",
          multiSelectMode && isSelected && "rounded-lg bg-[var(--destructive)]/10",
        )}
        onClick={(e) => {
          if (multiSelectMode) {
            onToggleSelect?.({
              messageId: message.id,
              orderIndex: messageOrderIndex ?? 0,
              checked: !isSelected,
              shiftKey: e.shiftKey,
            });
          } else {
            setShowActions((v) => !v);
          }
        }}
      >
        <div className="relative">
          {!multiSelectMode && onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(message.id);
              }}
              className={cn(
                "absolute -right-1 -top-1 rounded-md p-1 text-[var(--muted-foreground)]/30 opacity-0 transition-all hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100",
                showActions && "opacity-100",
              )}
              title="Delete"
            >
              <Trash2 size="0.75rem" />
            </button>
          )}
          <span className="rounded-full bg-[var(--secondary)] px-3 py-1 text-[0.6875rem] text-[var(--muted-foreground)]">
            {message.content}
          </span>
        </div>
      </div>
    );
  }

  // ── Render: grouped multi-speaker message (merged group chat) ──
  if (groupedSegments && !editing && !isUser) {
    return (
      <div
        className={cn(
          "relative px-4 py-0.5 transition-colors hover:bg-[var(--secondary)]/30",
          !noHoverGroup && "group",
          isGrouped ? "mt-0" : "mt-3",
          isStreaming && "bg-[var(--secondary)]/20",
          multiSelectMode && isSelected && "bg-[var(--destructive)]/10",
        )}
        onClick={(e) => {
          if (multiSelectMode) {
            onToggleSelect?.({
              messageId: message.id,
              orderIndex: messageOrderIndex ?? 0,
              checked: !isSelected,
              shiftKey: e.shiftKey,
            });
          } else {
            setShowActions((v) => !v);
          }
        }}
      >
        {/* Multi-select checkbox */}
        {multiSelectMode && (
          <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10">
            <button
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              aria-label={isSelected ? "Deselect message" : "Select message"}
              className={cn(
                "h-5 w-5 rounded border-2 flex items-center justify-center transition-colors cursor-pointer",
                isSelected
                  ? "border-[var(--destructive)] bg-[var(--destructive)]"
                  : "border-[var(--muted-foreground)]/40 bg-[var(--secondary)]",
              )}
            >
              {isSelected && <span className="text-white text-xs font-bold">✓</span>}
            </button>
          </div>
        )}
        {/* Render each grouped speaker as a mini-message row (staggered reveal) */}
        {groupedSegments.slice(0, visibleSegments).map((grp, i) => {
          const segChar = grp.speaker && charByName ? charByName.get(grp.speaker.toLowerCase()) : null;
          const segAvatar = segChar?.avatarUrl ?? null;
          const segAvatarCropStyle = getAvatarCropStyle(segChar?.avatarCrop);
          const segName = segChar?.name ?? grp.speaker ?? "";
          const segColor = segChar?.nameColor;
          const isFirst = i === 0;
          const combinedText = grp.lines.join("\n");

          if (!grp.speaker) {
            // Non-attributed narration text — render as indented italic
            return (
              <div
                key={i}
                className="pl-14 py-0.5 text-[0.875rem] leading-relaxed break-words whitespace-pre-wrap text-[var(--muted-foreground)] italic animate-[fadeSlideIn_0.4s_ease-out]"
                style={messageTextStyle}
              >
                {mentionNames.length
                  ? highlightMentions(applyInlineMarkdown(combinedText, `ns${i}`), mentionNames, `ns${i}`)
                  : applyInlineMarkdown(combinedText, `ns${i}`)}
              </div>
            );
          }

          return (
            <div key={i} className={cn("animate-[fadeSlideIn_0.4s_ease-out]", i > 0 && "mt-3")}>
              {/* First row: Avatar + Name + first paragraph */}
              {(() => {
                // Split into paragraphs (on blank lines) for Discord-style compact display
                const paragraphs = combinedText
                  .split(/\n{2,}/)
                  .map((p) => p.trim())
                  .filter(Boolean);
                if (paragraphs.length === 0) return null;
                return (
                  <>
                    <div className="flex gap-4">
                      {/* Avatar */}
                      <div className="w-10 flex-shrink-0">
                        <div className="relative h-10 w-10 overflow-hidden rounded-full bg-[var(--accent)]">
                          {segAvatar ? (
                            <img
                              src={segAvatar}
                              alt={segName}
                              loading="lazy"
                              className="h-full w-full object-cover"
                              style={segAvatarCropStyle}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm font-bold text-[var(--muted-foreground)]">
                              {segName[0]?.toUpperCase()}
                            </div>
                          )}
                        </div>
                        {isFirst && (showActions || forceShowActions || showMessageNumbers) && messageIndex != null && (
                          <span className="mt-0.5 block text-center text-[0.5rem] font-medium text-[var(--muted-foreground)] select-none">
                            #{messageIndex}
                          </span>
                        )}
                      </div>
                      {/* Name + first paragraph */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span
                            className="text-[0.9375rem] font-semibold leading-tight hover:underline cursor-default"
                            style={nameColorStyle(segColor)}
                          >
                            {segName}
                          </span>
                          {isFirst && (
                            <span className="text-[0.6875rem] text-[var(--muted-foreground)]/60">
                              {formatTimestamp(message.createdAt)}
                            </span>
                          )}
                        </div>
                        <div
                          className="text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap"
                          style={messageTextStyle}
                        >
                          {mentionNames.length
                            ? highlightMentions(
                                applyInlineMarkdown(paragraphs[0]!, `gs${i}_0`),
                                mentionNames,
                                `gs${i}_0`,
                              )
                            : applyInlineMarkdown(paragraphs[0]!, `gs${i}_0`)}
                        </div>
                      </div>
                    </div>
                    {/* Subsequent paragraphs — indented to align with text (no avatar/name) */}
                    {paragraphs.slice(1).map((para, pi) => (
                      <div
                        key={pi}
                        className="pl-14 mt-0.5 text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap"
                        style={messageTextStyle}
                      >
                        {mentionNames.length
                          ? highlightMentions(
                              applyInlineMarkdown(para, `gs${i}_${pi + 1}`),
                              mentionNames,
                              `gs${i}_${pi + 1}`,
                            )
                          : applyInlineMarkdown(para, `gs${i}_${pi + 1}`)}
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          );
        })}

        {/* Streaming cursor */}
        {isStreaming && (
          <span className="ml-14 inline-block h-4 w-[0.125rem] animate-pulse rounded-full bg-[var(--foreground)]/50" />
        )}

        {/* Image attachments (selfies, illustrations) */}
        {extra.attachments && extra.attachments.length > 0 && !IMAGE_URL_RE.test(renderedContent.trim()) && (
          <div className="ml-14 mt-1.5 flex flex-col items-start gap-2">
            {extra.attachments.map((att: any, i: number) =>
              att.type === "image" || att.type?.startsWith("image/") ? (
                <div key={i} className="group/att relative inline-block">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setImageLightbox({ url: att.url || att.data, prompt: att.prompt });
                    }}
                    className="block cursor-zoom-in rounded-lg text-left"
                    title="Open image"
                  >
                    <img
                      src={att.url || att.data}
                      alt={att.filename || att.name || "image"}
                      className="max-h-80 max-w-full rounded-lg"
                      loading="lazy"
                    />
                  </button>
                  <button
                    onClick={() => handleRemoveAttachment(i)}
                    title="Remove from message"
                    className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white/80 transition-opacity hover:bg-black/80 hover:text-white sm:opacity-0 sm:group-hover/att:opacity-100"
                  >
                    <X size="0.875rem" />
                  </button>
                </div>
              ) : null,
            )}
          </div>
        )}

        {!hideActions && hasSwipes && (
          <SwipeJumpControl
            messageId={message.id}
            activeSwipeIndex={message.activeSwipeIndex}
            swipeCount={swipeCount}
            onSetActiveSwipe={(index) => onSetActiveSwipe?.(message.id, index)}
            className="ml-14 mt-2 px-1 text-[0.6875rem] text-[var(--muted-foreground)]"
            buttonClassName="rounded p-0.5 transition-colors hover:bg-[var(--accent)] disabled:opacity-30"
            inputClassName="h-[1.5rem] w-[3rem] text-[0.6875rem]"
          />
        )}

        {/* Hover action bar */}
        <div
          className={cn(
            "absolute -top-3 right-4 flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--card)]/90 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-all dark:border-white/20 dark:bg-black/40",
            "opacity-0 group-hover:opacity-100",
            (showActions || forceShowActions) && "opacity-100",
          )}
        >
          <MsgAction icon={copied ? "✓" : <Copy size="0.75rem" />} onClick={handleCopy} title="Copy" />
          <MsgAction
            icon={<Languages size="0.75rem" />}
            onClick={() => translate(message.id, message.content, message.chatId)}
            title={translatedText ? "Hide translation" : "Translate"}
            className={translatedText ? "text-blue-400" : undefined}
          />
          <MsgAction icon={<Pencil size="0.75rem" />} onClick={onEditClick ?? startEditing} title="Edit" />
          <MsgAction
            icon={<RefreshCw size="0.75rem" />}
            onClick={() => onRegenerate?.(message.id)}
            title={regenerateButtonTitle}
            className={regenerateGuidedClass}
          />
          {isLastAssistantMessage && (
            <MsgAction icon={<Eye size="0.75rem" />} onClick={() => onPeekPrompt?.()} title="Peek prompt" />
          )}
          {generationReplay && (
            <MsgAction
              icon={<ScrollText size="0.75rem" />}
              onClick={() => setShowGenerationReplay(true)}
              title="Stored guidance"
            />
          )}
          {thinking && (
            <MsgAction icon={<Brain size="0.75rem" />} onClick={() => setShowThinking(true)} title="View thoughts" />
          )}
          <MsgAction
            icon={<Trash2 size="0.75rem" />}
            onClick={() => onDelete?.(message.id)}
            title="Delete"
            className="hover:text-[var(--destructive)]"
          />
        </div>

        {/* Thinking modal */}
        {showThinking &&
          thinking &&
          createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
              onClick={() => setShowThinking(false)}
            >
              <div
                className="relative mx-4 flex max-h-[70vh] w-full max-w-xl flex-col rounded-xl bg-[var(--card)] shadow-2xl ring-1 ring-[var(--border)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Brain size="0.875rem" className="text-[var(--muted-foreground)]" />
                    Model Thoughts
                  </div>
                  <button
                    onClick={() => setShowThinking(false)}
                    className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
                  >
                    <X size="0.875rem" />
                  </button>
                </div>
                <div className="overflow-y-auto px-4 py-3">
                  <pre className="whitespace-pre-wrap break-words text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
                    {thinking}
                  </pre>
                </div>
              </div>
            </div>,
            document.body,
          )}
        {generationReplay && (
          <GenerationReplayDetailsModal
            open={showGenerationReplay}
            replay={generationReplay}
            onClose={() => setShowGenerationReplay(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mari-message relative flex gap-4 px-4 py-0.5 transition-colors hover:bg-[var(--secondary)]/30",
        isUser ? "mari-message-user" : "mari-message-assistant",
        !noHoverGroup && "group",
        isGrouped ? "mt-0" : "mt-4",
        isStreaming && "bg-[var(--secondary)]/20",
        multiSelectMode && isSelected && "bg-[var(--destructive)]/10",
      )}
      data-message-id={message.id}
      data-message-role={message.role}
      onClick={(e) => {
        if (multiSelectMode) {
          onToggleSelect?.({
            messageId: message.id,
            orderIndex: messageOrderIndex ?? 0,
            checked: !isSelected,
            shiftKey: e.shiftKey,
          });
        } else {
          setShowActions((v) => !v);
        }
      }}
    >
      {/* Multi-select checkbox */}
      {multiSelectMode && (
        <div className="flex items-center flex-shrink-0">
          <div
            className={cn(
              "h-5 w-5 rounded border-2 flex items-center justify-center transition-colors cursor-pointer",
              isSelected
                ? "border-[var(--destructive)] bg-[var(--destructive)]"
                : "border-[var(--muted-foreground)]/40 bg-[var(--secondary)]",
            )}
          >
            {isSelected && <span className="text-white text-xs font-bold">✓</span>}
          </div>
        </div>
      )}

      {/* Avatar column — fixed 40px width */}
      <div className="mari-message-avatar w-10 flex-shrink-0">
        {!isGrouped && (
          <>
            <div className="relative h-10 w-10 overflow-hidden rounded-full bg-[var(--accent)]">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  loading="lazy"
                  className="h-full w-full object-cover"
                  style={avatarCropStyle}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-bold text-[var(--muted-foreground)]">
                  {isUser ? <User size="1.125rem" /> : displayName[0]?.toUpperCase()}
                </div>
              )}
            </div>
            {(showActions || forceShowActions || showMessageNumbers) && messageIndex != null && (
              <span className="mt-0.5 block text-center text-[0.5rem] font-medium text-[var(--muted-foreground)] select-none">
                #{messageIndex}
              </span>
            )}
          </>
        )}
      </div>

      {/* Message content column */}
      <div className="mari-message-body min-w-0 flex-1">
        {/* Header — name + timestamp (only for first in group) */}
        {!isGrouped && (
          <div className="mari-message-meta flex items-baseline gap-2 mb-0.5">
            <span
              className="mari-message-name text-[0.9375rem] font-semibold leading-tight hover:underline cursor-default"
              style={nameColorStyle(nameColor)}
            >
              {displayName}
            </span>
            <span className="mari-message-timestamp text-[0.6875rem] text-[var(--muted-foreground)]/60">
              {formatTimestamp(message.createdAt)}
            </span>
          </div>
        )}

        {/* Message body */}
        {editing ? (
          <div className="space-y-2">
            <textarea
              ref={editRef}
              value={editValue}
              onChange={(e) => {
                setEditValue(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
              }}
              className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2.5 text-[0.9375rem] leading-relaxed outline-none"
              rows={1}
              style={{ overflow: "auto", ...messageTextStyle }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
            />
            <div className="flex items-center gap-2 text-[0.6875rem] text-[var(--muted-foreground)]">
              <button
                onClick={() => setEditing(false)}
                className="text-foreground/70 hover:underline hover:text-foreground"
              >
                cancel
              </button>
              <span>·</span>
              <button onClick={handleSaveEdit} className="text-foreground/70 hover:underline hover:text-foreground">
                save
              </button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "mari-message-content text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap",
              isStreaming && !renderedContent && "py-1",
            )}
            style={messageTextStyle}
          >
            {isStreaming && !renderedContent ? (
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--muted-foreground)]/60 [animation-delay:0ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--muted-foreground)]/60 [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--muted-foreground)]/60 [animation-delay:300ms]" />
              </div>
            ) : (
              <>
                <MessageContent
                  content={renderedContent}
                  mentionNames={mentionNames}
                  onImageOpen={(url) => setImageLightbox({ url })}
                />
                {isStreaming && (
                  <span className="ml-0.5 inline-block h-4 w-[0.125rem] animate-pulse rounded-full bg-[var(--foreground)]/50" />
                )}
              </>
            )}
          </div>
        )}

        {/* Translation */}
        {(translatedText || isTranslating) && (
          <div className="mt-1.5 border-t border-[var(--border)] pt-1.5">
            {isTranslating ? (
              <span className="text-[0.75rem] italic text-[var(--muted-foreground)]">Translating…</span>
            ) : (
              <div className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
                {translatedText}
              </div>
            )}
          </div>
        )}

        {/* Image attachments (selfies, illustrations) — skip when content is already an image URL */}
        {extra.attachments && extra.attachments.length > 0 && !IMAGE_URL_RE.test(renderedContent.trim()) && (
          <div className="mt-1.5 flex flex-col items-center gap-2">
            {extra.attachments.map((att: any, i: number) =>
              att.type === "image" || att.type?.startsWith("image/") ? (
                <div key={i} className="group/att relative inline-block">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setImageLightbox({ url: att.url || att.data, prompt: att.prompt });
                    }}
                    className="block cursor-zoom-in rounded-lg text-left"
                    title="Open image"
                  >
                    <img
                      src={att.url || att.data}
                      alt={att.filename || att.name || "image"}
                      className="max-h-80 max-w-full rounded-lg"
                      loading="lazy"
                    />
                  </button>
                  <button
                    onClick={() => handleRemoveAttachment(i)}
                    title="Remove from message"
                    className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white/80 transition-opacity hover:bg-black/80 hover:text-white sm:opacity-0 sm:group-hover/att:opacity-100"
                  >
                    <X size="0.875rem" />
                  </button>
                </div>
              ) : null,
            )}
          </div>
        )}

        {!hideActions && hasSwipes && (
          <SwipeJumpControl
            messageId={message.id}
            activeSwipeIndex={message.activeSwipeIndex}
            swipeCount={swipeCount}
            onSetActiveSwipe={(index) => onSetActiveSwipe?.(message.id, index)}
            className="mt-1.5 text-[0.6875rem] text-[var(--muted-foreground)]"
            buttonClassName="rounded p-0.5 transition-colors hover:bg-[var(--accent)] disabled:opacity-30"
            inputClassName="h-[1.5rem] w-[3rem] text-[0.6875rem]"
          />
        )}
      </div>

      {/* Hover action bar — Discord-style floating pill */}
      {!hideActions && (
        <div
          className={cn(
            "mari-message-actions absolute -top-3 right-4 flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--card)]/90 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-all dark:border-white/20 dark:bg-black/40",
            "opacity-0 group-hover:opacity-100",
            (showActions || forceShowActions) && "opacity-100",
          )}
        >
          <MsgAction icon={copied ? "✓" : <Copy size="0.75rem" />} onClick={handleCopy} title="Copy" />
          <MsgAction
            icon={<Languages size="0.75rem" />}
            onClick={() => translate(message.id, renderedContent, message.chatId)}
            title={translatedText ? "Hide translation" : "Translate"}
            className={translatedText ? "text-blue-400" : undefined}
          />
          <MsgAction icon={<Pencil size="0.75rem" />} onClick={onEditClick ?? startEditing} title="Edit" />
          {canRegenerate && (
            <MsgAction
              icon={<RefreshCw size="0.75rem" />}
              onClick={() => onRegenerate?.(message.id)}
              title={regenerateButtonTitle}
              className={regenerateGuidedClass}
            />
          )}
          {isLastAssistantMessage && !isUser && (
            <MsgAction icon={<Eye size="0.75rem" />} onClick={() => onPeekPrompt?.()} title="Peek prompt" />
          )}
          {generationReplay && (
            <MsgAction
              icon={<ScrollText size="0.75rem" />}
              onClick={() => setShowGenerationReplay(true)}
              title="Stored guidance"
            />
          )}
          {thinking && !isUser && (
            <MsgAction icon={<Brain size="0.75rem" />} onClick={() => setShowThinking(true)} title="View thoughts" />
          )}
          <MsgAction
            icon={<Trash2 size="0.75rem" />}
            onClick={() => onDelete?.(message.id)}
            title="Delete"
            className="hover:text-[var(--destructive)]"
          />
        </div>
      )}

      {/* Thinking modal */}
      {showThinking &&
        thinking &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
            onClick={() => setShowThinking(false)}
          >
            <div
              className="relative mx-4 flex max-h-[70vh] w-full max-w-xl flex-col rounded-xl bg-[var(--card)] shadow-2xl ring-1 ring-[var(--border)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Brain size="0.875rem" className="text-[var(--muted-foreground)]" />
                  Model Thoughts
                </div>
                <button
                  onClick={() => setShowThinking(false)}
                  className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
                >
                  <X size="0.875rem" />
                </button>
              </div>
              <div className="overflow-y-auto px-4 py-3">
                <pre className="whitespace-pre-wrap break-words text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
                  {thinking}
                </pre>
              </div>
            </div>
            </div>,
            document.body,
          )}
      {generationReplay && (
        <GenerationReplayDetailsModal
          open={showGenerationReplay}
          replay={generationReplay}
          onClose={() => setShowGenerationReplay(false)}
        />
      )}

      {imageLightbox &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
            onClick={() => setImageLightbox(null)}
          >
            <div
              className="flex max-h-[90vh] w-[min(90vw,64rem)] max-w-[90vw] flex-col items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={imageLightbox.url}
                alt="Expanded image"
                className={
                  imageLightbox.prompt?.trim()
                    ? "max-h-[calc(90vh-9rem)] max-w-full rounded-lg object-contain shadow-2xl"
                    : "max-h-[90vh] max-w-full rounded-lg object-contain shadow-2xl"
                }
              />
              <ImagePromptPanel prompt={imageLightbox.prompt} className="w-full max-w-3xl" />
            </div>
            <button
              onClick={() => setImageLightbox(null)}
              className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white/80 transition-colors hover:bg-black/70 hover:text-white"
              aria-label="Close image"
            >
              <X size="1.125rem" />
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
});

// ── Tiny action button ──
function MsgAction({
  icon,
  onClick,
  title,
  className,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  title: string;
  className?: string;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className={cn(
        "rounded p-1 text-foreground/70 transition-colors hover:bg-foreground/20 hover:text-foreground",
        className,
      )}
    >
      {icon}
    </button>
  );
}

// ── Timestamp formatting ──

/** Full timestamp: "Today at 3:42 PM", "Yesterday at 10:15 AM", "03/15/2026" */
function formatTimestamp(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);

    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    if (diffDays === 0 && date.getDate() === now.getDate()) {
      return `Today at ${time}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (diffDays <= 1 && date.getDate() === yesterday.getDate()) {
      return `Yesterday at ${time}`;
    }
    return `${date.toLocaleDateString()} ${time}`;
  } catch {
    return "";
  }
}
