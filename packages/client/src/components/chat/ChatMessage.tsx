// ──────────────────────────────────────────────
// Chat: Message — mode-aware rendering
// ──────────────────────────────────────────────
import { cn, copyToClipboard, getAvatarCropStyle } from "../../lib/utils";
import { applyInlineMarkdown, renderMarkdownBlocks, applyInlineMarkdownHTML } from "../../lib/markdown";
import {
  User,
  Bot,
  ChevronLeft,
  ChevronRight,
  Copy,
  RefreshCw,
  Trash2,
  GitBranch,
  Pencil,
  Check,
  X,
  Flag,
  Eye,
  Brain,
  Languages,
  Volume2,
  VolumeX,
  Loader2,
} from "lucide-react";
import type { Message } from "@marinara-engine/shared";
import { memo, useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { chatKeys } from "../../hooks/use-chats";
import { useShallow } from "zustand/react/shallow";
import { resolveMessageMacros } from "../../lib/chat-macros";
import { useApplyRegex } from "../../hooks/use-apply-regex";
import { useUIStore } from "../../stores/ui.store";
import { useChatStore } from "../../stores/chat.store";
import { useTranslate } from "../../hooks/use-translate";
import { api } from "../../lib/api-client";
import { ttsService } from "../../lib/tts-service";
import { useTTSConfig } from "../../hooks/use-tts";
import { DIALOGUE_QUOTE_PATTERN_SOURCE, HTML_SAFE_DIALOGUE_QUOTE_PATTERN_SOURCE } from "../../lib/dialogue-quotes";
import DOMPurify from "dompurify";
import type { CharacterMap, MessageSelectionToggle, PersonaInfo } from "./chat-area.types";

/** Isolated edit textarea — uncontrolled to avoid React re-renders on every keystroke. */
const EditTextarea = memo(function EditTextarea({
  initialContent,
  fontSize,
  onSave,
  onCancel,
}: {
  initialContent: string;
  fontSize: string | number | undefined;
  onSave: (content: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Find the nearest scrollable ancestor so we can freeze its scroll
    // position while we re-measure the textarea height.
    const scroller = el.closest("[data-chat-scroll]") as HTMLElement | null;
    const scrollTop = scroller?.scrollTop ?? 0;
    el.style.height = "0";
    el.style.height = el.scrollHeight + "px";
    if (scroller) scroller.scrollTop = scrollTop;
  }, []);

  useLayoutEffect(() => {
    if (ref.current) {
      autoResize();
      ref.current.focus({ preventScroll: true });
    }
  }, [autoResize]);

  const handleSave = useCallback(() => {
    if (ref.current) onSave(ref.current.value);
  }, [onSave]);

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={ref}
        defaultValue={initialContent.replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/[\u2018\u2019]/g, "'")}
        rows={1}
        onInput={autoResize}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
          if (e.key === "Escape") onCancel();
        }}
        className="w-full resize-none overflow-y-hidden rounded-lg bg-black/30 px-3 py-2 text-white outline-none ring-1 ring-white/20 focus:ring-blue-400/50"
        style={{ fontSize, lineHeight: 1.5 }}
      />
      <div className="flex items-center gap-1.5 justify-end">
        <button
          onClick={onCancel}
          className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white/70"
          title="Cancel (Esc)"
        >
          <X size="0.8125rem" />
        </button>
        <button
          onClick={handleSave}
          className="rounded-md p-1 text-emerald-400/70 hover:bg-emerald-400/10 hover:text-emerald-400"
          title="Save (Cmd+Enter)"
        >
          <Check size="0.8125rem" />
        </button>
      </div>
    </div>
  );
});

interface ChatMessageProps {
  message: Message & { swipes?: Array<{ id: string; content: string }> };
  isStreaming?: boolean;
  onDelete?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void;
  onSetActiveSwipe?: (messageId: string, index: number) => void;
  onToggleConversationStart?: (messageId: string, current: boolean) => void;
  onPeekPrompt?: () => void;
  onBranch?: (messageId: string) => void;
  isLastAssistantMessage?: boolean;
  characterMap?: CharacterMap;
  chatMode?: string;
  isGrouped?: boolean;
  personaInfo?: PersonaInfo;
  groupChatMode?: string;
  chatCharacterIds?: string[];
  /** Distance from the latest message (0 = newest). Used for depth-range regex filtering. */
  messageDepth?: number;
  /** 1-based ordinal position in the message list. Shown under avatar when actions visible. */
  messageIndex?: number;
  messageOrderIndex?: number;
  multiSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (toggle: MessageSelectionToggle) => void;
}

/** Regex to match a plain image URL as the entire content. */
const IMAGE_URL_RE = /^https?:\/\/\S+\.(?:gif|png|jpe?g|webp)(?:\?[^\s]*)?$/i;

/** Regex to match <speaker="name">dialogue</speaker> tags. */
const SPEAKER_TAG_RE = /<speaker="([^"]*)">([\s\S]*?)<\/speaker>/g;

/**
 * Process speaker tags into ReactNodes with per-character dialogue coloring.
 * Non-speaker text gets the default dialogueColor.
 */
function renderWithSpeakerTags(
  text: string,
  defaultDialogueColor: string | undefined,
  speakerColorMap: Map<string, string> | undefined,
  boldDialogue = true,
): ReactNode[] {
  const renderLine = (line: string, color = defaultDialogueColor) => highlightDialogue(line, color, boldDialogue);

  if (!speakerColorMap || !SPEAKER_TAG_RE.test(text)) {
    return renderLine(text, defaultDialogueColor);
  }
  SPEAKER_TAG_RE.lastIndex = 0;

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = SPEAKER_TAG_RE.exec(text)) !== null) {
    // Text before the speaker tag — use default color
    if (match.index > lastIndex) {
      nodes.push(...renderLine(text.slice(lastIndex, match.index), defaultDialogueColor));
    }
    const speakerName = match[1]!;
    const dialogue = match[2]!;
    const speakerColor = speakerColorMap.get(speakerName) ?? defaultDialogueColor;
    // Render the dialogue content (without the tags) using the speaker's color
    nodes.push(<span key={`s${key++}`}>{renderLine(dialogue, speakerColor)}</span>);
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last speaker tag
  if (lastIndex < text.length) {
    nodes.push(...renderLine(text.slice(lastIndex), defaultDialogueColor));
  }

  return nodes;
}

/**
 * Highlight quoted dialogue — text in supported dialogue quote pairs
 * like "", «», 「」, and 『』 gets bold + colored.
 *
 * Single quotes ('') are intentionally excluded because after curly-quote
 * normalization (' → ') they are indistinguishable from apostrophes,
 * causing false positives like "it's nice, isn't it" being partially bolded.
 *
 * Detects quote pairs on the RAW text first, then applies inline markdown
 * within each segment. This ensures that markdown syntax inside dialogue
 * (e.g. "A *long* day") doesn't split the quote across multiple nodes
 * and prevent dialogue bolding.
 *
 * Code spans (`…`), images (![…](…)), and links ([…](…)) are treated as
 * protected zones — quotes inside them are not matched as dialogue.
 */
function highlightDialogue(text: string, dialogueColor?: string, boldDialogue = true): ReactNode[] {
  // Step 1: Find protected zones where quotes should NOT trigger dialogue detection.
  // Code spans, images, and links may legitimately contain quotation marks.
  const protectedRanges: Array<[number, number]> = [];
  const protectedRe = /`[^`\n]+`|!?\[[^\]]*\]\([^)]+\)/g;
  let pm: RegExpExecArray | null;
  while ((pm = protectedRe.exec(text)) !== null) {
    protectedRanges.push([pm.index, pm.index + pm[0].length]);
  }
  const isProtected = (pos: number) => protectedRanges.some(([s, e]) => pos >= s && pos < e);

  // Step 2: Find quote pairs, skipping any that start inside a protected zone.
  const quoteRe = new RegExp(`(?:${DIALOGUE_QUOTE_PATTERN_SOURCE})`, "g");
  const quotePairs: Array<{ start: number; end: number }> = [];
  let qm: RegExpExecArray | null;
  while ((qm = quoteRe.exec(text)) !== null) {
    if (!isProtected(qm.index)) {
      quotePairs.push({ start: qm.index, end: qm.index + qm[0].length });
    }
  }

  // No dialogue quotes found — just apply markdown and return.
  if (quotePairs.length === 0) {
    return applyInlineMarkdown(text, "m");
  }

  // Step 3: Split text into quoted / non-quoted segments and render.
  const result: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const q of quotePairs) {
    // Non-quoted text before this pair — apply markdown only
    if (q.start > lastIndex) {
      result.push(...applyInlineMarkdown(text.slice(lastIndex, q.start), `m${key}`));
    }

    const raw = text.slice(q.start, q.end);
    const openQuote = raw[0];
    const closeQuote = raw[raw.length - 1];
    const inner = raw.slice(1, -1);
    const DialogueTag = boldDialogue ? "strong" : "span";

    // Apply markdown inside the quoted text, then wrap in a dialogue span/strong.
    const innerNodes = applyInlineMarkdown(inner, `mq${key}`);
    result.push(
      <DialogueTag
        key={`d${key++}`}
        style={dialogueColor ? { color: dialogueColor } : undefined}
        className={!dialogueColor ? "text-white" : undefined}
      >
        {openQuote}
        {innerNodes}
        {closeQuote}
      </DialogueTag>,
    );

    lastIndex = q.end;
  }

  // Remaining text after the last quote pair
  if (lastIndex < text.length) {
    result.push(...applyInlineMarkdown(text.slice(lastIndex), `mt${key}`));
  }

  return result;
}

/** Check whether text contains meaningful HTML tags. */
const HTML_TAG_RE =
  /<(?:div|span|style|table|p|br|img|a|ul|ol|li|h[1-6]|em|strong|b|i|pre|code|section|article|header|footer|nav|button|input|form|label|select|option|textarea|canvas|svg|video|audio|source|iframe|hr|blockquote|details|summary|figure|figcaption|main|aside|mark|small|sub|sup|del|ins|abbr|time|progress|meter|output|dialog|template|slot|ruby|rt|rp|bdi|bdo|wbr|area|map|track|embed|object|param|picture|portal|datalist|fieldset|legend|optgroup|caption|col|colgroup|thead|tbody|tfoot|th|td|dl|dt|dd|kbd|samp|var|cite|dfn|q|s|u|font|center)\b[^>]*>/i;

/**
 * Render message content, handling both plain text with dialogue highlighting
 * and HTML blocks that should be rendered as actual HTML.
 */
function renderContent(
  text: string,
  dialogueColor?: string,
  speakerColorMap?: Map<string, string>,
  boldDialogue = true,
): ReactNode {
  // Normalise curly quotes to straight so they display consistently
  const normalized = text.replace(/[“”„‟]/g, '"').replace(/[‘’]/g, "'");

  // Strip speaker tags before HTML detection (they aren't real HTML)
  const withoutSpeakerTags = normalized.replace(/<\/?speaker(?:="[^"]*")?>/g, "");

  if (!HTML_TAG_RE.test(withoutSpeakerTags)) {
    // renderWithHeadings handles headings, *** and --- horizontal rules,
    // and delegates the rest to speaker-tag / dialogue rendering.
    return renderMarkdownBlocks(normalized, (seg, _kp) =>
      renderWithSpeakerTags(seg, dialogueColor, speakerColorMap, boldDialogue),
    );
  }

  // For HTML content, replace speaker tags with color-annotated spans (preserves per-character colors)
  const stripped = speakerColorMap
    ? normalized.replace(SPEAKER_TAG_RE, (_, name, dialogue) => {
        const color = speakerColorMap.get(name as string);
        return color ? `<span data-spk="${color}">${dialogue as string}</span>` : (dialogue as string);
      })
    : normalized.replace(SPEAKER_TAG_RE, "$2");

  // Convert newlines to <br> with compact spacing for HTML content,
  // but preserve newlines inside <svg> and <style> blocks — injecting
  // <br> into SVG foreign content breaks the HTML parser's namespace
  // handling, and corrupts stylesheets.
  // Also skip newlines that sit between HTML tags (source formatting only).
  // First, protect newlines inside attribute values (e.g. multi-line style="")
  // by temporarily replacing them with a placeholder.
  const ATTR_NL_PLACEHOLDER = "\x00ATTRNL\x00";
  const attrProtected = stripped.replace(
    /(<[^>]*?)("[^"]*"|'[^']*')([^>]*>)/g,
    (_m, before: string, attr: string, after: string) => before + attr.replace(/\n/g, ATTR_NL_PLACEHOLDER) + after,
  );
  const withBreaks = attrProtected
    .replace(
      /(<svg[\s\S]*?<\/svg>)|(<style[\s\S]*?<\/style>)|(>\s*)\n(\s*<)|\n/gi,
      (_m, svgBlock, styleBlock, pre, post) =>
        svgBlock
          ? svgBlock
          : styleBlock
            ? styleBlock
            : pre
              ? `${pre}${post}`
              : '<br style="display:block;margin:0.2em 0">',
    )
    .replace(new RegExp(ATTR_NL_PLACEHOLDER, "g"), "\n");

  // Convert markdown images to <img> before sanitization so DOMPurify validates them.
  // Keep tags minimal (no class/loading) — styling is via .mari-message-content img in CSS
  // to avoid the dialogue-bolding regex mangling attribute quotes.
  const withImages = withBreaks.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
    (_m, alt: string, url: string) => `<img src="${url}" alt="${alt || "image"}">`,
  );

  // Content has HTML — sanitize and render it
  // DOMPurify disallows <animate> by default (conservative SVG list).
  // It's safe — only animates presentation attributes, no script execution.
  const clean = DOMPurify.sanitize(withImages, {
    ADD_TAGS: ["animate"],
    ADD_ATTR: ["style", "class"],
    ALLOW_DATA_ATTR: true,
  });

  // Apply dialogue bolding inside sanitised HTML with per-speaker color support.
  const withDialogue = (() => {
    // Sanitize a CSS color value — only allow safe color formats
    const safeColor = (c: string) =>
      /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d,.\s%]+\)|hsla?\([\d,.\s%]+\))$/.test(c) ? c : "inherit";
    // Helper: check if an offset is inside an HTML tag (attribute context)
    const insideTag = (text: string, offset: number) => {
      const before = text.slice(0, offset);
      return before.lastIndexOf("<") > before.lastIndexOf(">");
    };
    const dialogueTag = boldDialogue ? "strong" : "span";
    // Pass 1: color quotes inside speaker-annotated spans with their specific colors
    const afterSpeaker = clean.replace(
      /<span[^>]*\bdata-spk="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g,
      (_m: string, color: string, content: string) => {
        const validColor = safeColor(color);
        const speakerQuoteRe = new RegExp(`(?<![=\\w])(?:${HTML_SAFE_DIALOGUE_QUOTE_PATTERN_SOURCE})`, "g");
        return content.replace(speakerQuoteRe, (match: string, offset: number) => {
          if (insideTag(content, offset)) return match;
          return `<${dialogueTag} style="color:${validColor}">${match}</${dialogueTag}>`;
        });
      },
    );
    // Pass 2: color remaining quotes with default dialogue color, skipping already-wrapped text
    const remainingQuoteRe = new RegExp(`(?<![=\\w])(?:${HTML_SAFE_DIALOGUE_QUOTE_PATTERN_SOURCE})`, "g");
    return afterSpeaker.replace(remainingQuoteRe, (match, offset) => {
      if (insideTag(afterSpeaker, offset)) return match;
      const before = afterSpeaker.slice(0, offset);
      if (/<(?:strong|span)[^>]*>\s*$/.test(before.slice(Math.max(0, before.length - 300)))) return match;
      // Skip if inside a <font> tag (author-specified colors take priority)
      const lastFontOpen = before.lastIndexOf("<font ");
      if (lastFontOpen !== -1) {
        const lastFontClose = before.lastIndexOf("</font>");
        if (lastFontClose < lastFontOpen) return match;
      }
      const highlightColor = dialogueColor ?? "white";
      return `<${dialogueTag} style="color:${highlightColor}">${match}</${dialogueTag}>`;
    });
  })();

  // Convert *** and --- horizontal rules to <hr> tags in HTML path
  const withHr = withDialogue.replace(
    /(?:^|(?<=<br[^>]*>))\s*(?:\*{3,}|-{3,})\s*(?:$|(?=<br[^>]*>))/g,
    '<hr style="margin:0.75em 0;border:0;border-top:1px solid var(--border)">',
  );

  // Apply markdown-style bold/italic in HTML path
  const withMarkdown = applyInlineMarkdownHTML(withHr);

  return <div className="overflow-hidden" dangerouslySetInnerHTML={{ __html: withMarkdown }} />;
}

/** Build style object for name color (supports gradients). */
function nameColorStyle(color?: string): React.CSSProperties | undefined {
  if (!color) return undefined;
  if (color.startsWith("linear-gradient")) {
    return {
      background: color,
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

export const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming,
  onDelete,
  onRegenerate,
  onEdit,
  onSetActiveSwipe,
  onToggleConversationStart,
  onPeekPrompt,
  onBranch,
  isLastAssistantMessage,
  characterMap,
  chatMode,
  isGrouped,
  personaInfo,
  groupChatMode,
  chatCharacterIds,
  messageDepth,
  messageIndex,
  messageOrderIndex,
  multiSelectMode,
  isSelected,
  onToggleSelect,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isNarrator = message.role === "narrator";
  const isRoleplay = chatMode === "roleplay" || chatMode === "visual_novel";
  const {
    chatFontSize,
    chatFontColor,
    chatFontOpacity,
    roleplayAvatarStyle,
    textStrokeWidth,
    textStrokeColor,
    showModelName,
    showTokenUsage,
    showMessageNumbers,
    guideGenerations,
    boldDialogue,
  } = useUIStore(
    useShallow((s) => ({
      chatFontSize: s.chatFontSize,
      chatFontColor: s.chatFontColor,
      chatFontOpacity: s.chatFontOpacity,
      roleplayAvatarStyle: s.roleplayAvatarStyle,
      textStrokeWidth: s.textStrokeWidth,
      textStrokeColor: s.textStrokeColor,
      showModelName: s.showModelName,
      showTokenUsage: s.showTokenUsage,
      showMessageNumbers: s.showMessageNumbers,
      guideGenerations: s.guideGenerations,
      boldDialogue: s.boldDialogue ?? true,
    })),
  );
  const hasInput = useChatStore((s) => s.currentInput.trim().length > 0);
  const isGuided = guideGenerations && hasInput;
  const regenerateButtonTitle = isGuided ? "Regenerate (guided)" : "Regenerate";
  const regenerateGuidedClass = isGuided
    ? "text-[var(--primary)] bg-[var(--primary)]/15 ring-1 ring-[var(--primary)]/30 hover:text-[var(--primary)]"
    : undefined;

  // Build reusable text style objects (memoized to avoid unnecessary DOM updates)
  const textStrokeStyle = useMemo<React.CSSProperties>(
    () =>
      textStrokeWidth > 0
        ? { WebkitTextStroke: `${textStrokeWidth}px ${textStrokeColor}`, paintOrder: "stroke fill" }
        : {},
    [textStrokeWidth, textStrokeColor],
  );
  const messageTextStyle = useMemo<React.CSSProperties>(
    () => ({
      fontSize: chatFontSize,
      lineHeight: 1.5,
      ...(chatFontColor ? { color: chatFontColor } : {}),
      ...textStrokeStyle,
    }),
    [chatFontSize, chatFontColor, textStrokeStyle],
  );

  // Compute message bubble background with user-controlled opacity
  // Base colors match the original Tailwind dark-mode values: neutral-900/70 and neutral-900/60
  const { userBubbleBg, assistantBubbleBg } = useMemo(() => {
    const o = chatFontOpacity / 100;
    return {
      userBubbleBg: `rgba(23,23,23,${(0.7 * o).toFixed(3)})`,
      assistantBubbleBg: `rgba(23,23,23,${(0.6 * o).toFixed(3)})`,
    };
  }, [chatFontOpacity]);

  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [avatarLightbox, setAvatarLightbox] = useState<string | null>(null);
  const scrollRestoreRef = useRef<{ el: HTMLElement; top: number } | null>(null);
  const msgRef = useRef<HTMLDivElement>(null);

  // Translation
  const { translate, translations, translating } = useTranslate();
  const translatedText = translations[message.id];
  const isTranslating = !!translating[message.id];

  // TTS
  const { data: ttsConfig } = useTTSConfig();
  const ttsEnabled = ttsConfig?.enabled ?? false;
  const [ttsState, setTTSState] = useState(ttsService.getState());
  const [ttsActiveId, setTTSActiveId] = useState<string | null>(ttsService.getActiveId());
  useEffect(
    () =>
      ttsService.subscribe((state, id) => {
        setTTSState(state);
        setTTSActiveId(id);
      }),
    [],
  );
  const ttsBusy = ttsState === "loading" || ttsState === "playing";
  const isSpeakingThis = ttsActiveId === message.id;
  const isLoadingThis = isSpeakingThis && ttsState === "loading";

  const handleSpeak = useCallback(() => {
    // Read directly from the singleton so we never act on stale React state
    const liveState = ttsService.getState();
    const liveActiveId = ttsService.getActiveId();
    const liveBusy = liveState === "loading" || liveState === "playing";
    const liveIsThis = liveActiveId === message.id;
    if (liveBusy && !liveIsThis) return;
    if (liveIsThis) {
      ttsService.stop();
    } else {
      void ttsService.speak(message.content, message.id);
    }
  }, [message.content, message.id]);

  // Dismiss actions when tapping outside on mobile
  useEffect(() => {
    if (!showActions) return;
    const handleTouch = (e: TouchEvent) => {
      if (msgRef.current && !msgRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    document.addEventListener("touchstart", handleTouch);
    return () => document.removeEventListener("touchstart", handleTouch);
  }, [showActions]);

  const handleMobileTap = useCallback(
    (e: React.MouseEvent) => {
      // In multi-select mode, clicking toggles selection on any device
      if (multiSelectMode) {
        onToggleSelect?.({
          messageId: message.id,
          orderIndex: messageOrderIndex ?? 0,
          checked: !isSelected,
          shiftKey: e.shiftKey,
        });
        return;
      }
      // Only toggle on touch devices
      if (!matchMedia("(pointer: coarse)").matches) return;
      // Don't toggle when tapping buttons, links, or the edit textarea
      const target = e.target as HTMLElement;
      if (target.closest("button, a, textarea")) return;
      setShowActions((v) => !v);
    },
    [isSelected, message.id, messageOrderIndex, multiSelectMode, onToggleSelect],
  );

  // Parse message extra for conversation start flag
  const extra = useMemo(() => {
    if (!message.extra) return {};
    return typeof message.extra === "string" ? JSON.parse(message.extra) : message.extra;
  }, [message.extra]);
  const isConversationStart = !!extra.isConversationStart;
  const thinking = extra.thinking as string | undefined;

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

  // Model name display
  const _modelName = !isUser && showModelName ? (extra.generationInfo?.model ?? null) : null;
  const genInfo = !isUser && (showModelName || showTokenUsage) ? extra.generationInfo : null;
  const genLabel = useMemo(() => {
    if (!genInfo) return null;
    const parts: string[] = [];
    if (showModelName && genInfo.model) parts.push(genInfo.model);
    if (showTokenUsage) {
      if (genInfo.tokensPrompt != null || genInfo.tokensCompletion != null) {
        const p = genInfo.tokensPrompt != null ? genInfo.tokensPrompt : null;
        const c = genInfo.tokensCompletion ?? "?";
        parts.push(p != null ? `${p}→${c} tok` : `${c} tok`);
      }
      if ((genInfo.tokensCachedPrompt ?? 0) > 0) {
        parts.push(`cache hit ${genInfo.tokensCachedPrompt!.toLocaleString()}`);
      }
      if ((genInfo.tokensCacheWritePrompt ?? 0) > 0) {
        parts.push(`cache write ${genInfo.tokensCacheWritePrompt!.toLocaleString()}`);
      }
      if (genInfo.durationMs != null) parts.push(`${(genInfo.durationMs / 1000).toFixed(1)}s`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [genInfo, showModelName, showTokenUsage]);
  // useLayoutEffect runs after DOM mutation but before browser paint — prevents visible scroll jump
  useLayoutEffect(() => {
    // Restore scroll position saved before the state change
    if (scrollRestoreRef.current) {
      scrollRestoreRef.current.el.scrollTop = scrollRestoreRef.current.top;
      scrollRestoreRef.current = null;
    }
  }, [editing]);

  const startEditing = useCallback(() => {
    const sp = msgRef.current?.closest("[class*='overflow-y']") as HTMLElement | null;
    if (sp) scrollRestoreRef.current = { el: sp, top: sp.scrollTop };
    setEditing(true);
  }, []);

  const handleSaveEdit = useCallback(
    (content: string) => {
      if (content.trim() !== message.content) {
        onEdit?.(message.id, content.trim());
      }
      setEditing(false);
    },
    [message.content, message.id, onEdit],
  );

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  // Apply regex scripts to AI output (assistant/narrator roles)
  const { applyToAIOutput } = useApplyRegex();

  // Resolve character info
  const charInfo = message.characterId && characterMap ? characterMap.get(message.characterId) : null;
  const primaryCharInfo =
    charInfo ??
    (characterMap && chatCharacterIds
      ? (chatCharacterIds
          .map((id) => characterMap.get(id))
          .find((candidate): candidate is NonNullable<typeof candidate> => !!candidate) ?? null)
      : (characterMap?.values().next().value ?? null));

  // For user messages, prefer per-message persona snapshot (stored when message was sent)
  // to preserve the correct persona name/avatar even after switching personas.
  // Fall back to the current personaInfo prop for older messages without snapshots.
  const msgPersona = isUser && extra.personaSnapshot ? extra.personaSnapshot : null;
  const userName = msgPersona?.name ?? personaInfo?.name ?? "You";
  const charName = primaryCharInfo?.name ?? message.characterId ?? "Assistant";
  const personaDescription = msgPersona?.description ?? personaInfo?.description;
  const personaPersonality = msgPersona?.personality ?? personaInfo?.personality;
  const personaBackstory = msgPersona?.backstory ?? personaInfo?.backstory;
  const personaAppearance = msgPersona?.appearance ?? personaInfo?.appearance;
  const personaScenario = msgPersona?.scenario ?? personaInfo?.scenario;
  const macroCharacters = useMemo(() => {
    if (characterMap && chatCharacterIds?.length) {
      const candidates = chatCharacterIds
        .map((id) => characterMap.get(id))
        .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate);
      if (candidates.length > 0) return candidates;
    }
    return charName ? [{ name: charName }] : [];
  }, [charName, characterMap, chatCharacterIds]);

  const displayContent = useMemo(() => {
    const text = isUser || isSystem ? message.content : applyToAIOutput(message.content, messageDepth);
    return resolveMessageMacros(text, {
      userName,
      persona: {
        name: userName,
        description: personaDescription,
        personality: personaPersonality,
        backstory: personaBackstory,
        appearance: personaAppearance,
        scenario: personaScenario,
      },
      primaryCharacter: primaryCharInfo ?? { name: charName },
      characters: macroCharacters,
    });
  }, [
    applyToAIOutput,
    charName,
    isSystem,
    isUser,
    macroCharacters,
    message.content,
    messageDepth,
    personaAppearance,
    personaBackstory,
    personaDescription,
    personaPersonality,
    personaScenario,
    primaryCharInfo,
    userName,
  ]);

  const displayName = isUser ? userName : charName;
  const avatarUrl = isUser ? (msgPersona?.avatarUrl ?? personaInfo?.avatarUrl ?? null) : (charInfo?.avatarUrl ?? null);
  const avatarCropStyle = isUser ? {} : getAvatarCropStyle(charInfo?.avatarCrop);

  // Resolve colors: character colors for assistant, persona colors for user
  // Prefer per-message persona snapshot colors over current persona
  const msgColors = isUser
    ? msgPersona
      ? {
          nameColor: msgPersona.nameColor,
          dialogueColor: msgPersona.dialogueColor,
          boxColor: msgPersona.boxColor,
        }
      : personaInfo
    : charInfo;
  const dialogueColor = msgColors?.dialogueColor;
  const boxBgColor = msgColors?.boxColor;
  const msgNameColor = msgColors?.nameColor;
  const roleplayBubbleBg = boxBgColor ? boxBgColor : isUser ? userBubbleBg : assistantBubbleBg;

  // Build speaker → dialogueColor map for group chat speaker tag coloring
  const speakerColorMap = useMemo(() => {
    if (!characterMap || characterMap.size <= 1) return undefined;
    const map = new Map<string, string>();
    for (const [, info] of characterMap) {
      if (info.name && info.dialogueColor) {
        map.set(info.name, info.dialogueColor);
      }
    }
    return map.size > 0 ? map : undefined;
  }, [characterMap]);

  // Merged group chat: cycling avatars + cycling name color
  const isMergedGroup = groupChatMode === "merged" && !isUser && chatCharacterIds && chatCharacterIds.length > 1;
  const mergedAvatars = useMemo(() => {
    if (!isMergedGroup || !characterMap || !chatCharacterIds) return [];
    return chatCharacterIds
      .map((id) => {
        const info = characterMap.get(id);
        if (!info?.avatarUrl) return null;
        return { url: info.avatarUrl, crop: info.avatarCrop };
      })
      .filter(Boolean) as { url: string; crop?: { zoom: number; offsetX: number; offsetY: number } | null }[];
  }, [isMergedGroup, characterMap, chatCharacterIds]);
  const mergedNameColors = useMemo(() => {
    if (!isMergedGroup || !characterMap || !chatCharacterIds) return [];
    const fallbackPalette = ["#c084fc", "#f472b6", "#fb923c", "#4ade80", "#60a5fa", "#facc15"];
    return chatCharacterIds.map((id, i) => {
      const raw = characterMap.get(id)?.nameColor;
      return raw || fallbackPalette[i % fallbackPalette.length]!;
    });
  }, [isMergedGroup, characterMap, chatCharacterIds]);
  // Cycle index for merged group avatars/names — driven by a ref + RAF to avoid re-renders
  const cycleIndexRef = useRef(0);
  const cycleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mergedNameRef = useRef<HTMLSpanElement>(null);
  const mergedAvatarRefs = useRef<(HTMLImageElement | null)[]>([]);
  const mergedAvatarTailRefs = useRef<(HTMLImageElement | null)[]>([]);

  useEffect(() => {
    if (!isMergedGroup) return;
    const total = Math.max(mergedAvatars.length, mergedNameColors.length);
    if (total <= 1) return;
    cycleTimerRef.current = setInterval(() => {
      cycleIndexRef.current = (cycleIndexRef.current + 1) % total;
      const idx = cycleIndexRef.current;
      // Update avatar opacity via DOM directly (no re-render)
      mergedAvatarRefs.current.forEach((img, i) => {
        if (img) img.style.opacity = i === idx ? "1" : "0";
      });
      mergedAvatarTailRefs.current.forEach((img, i) => {
        if (img) img.style.opacity = i === idx ? "1" : "0";
      });
      // Update name color opacity via DOM directly
      const nameEl = mergedNameRef.current;
      if (nameEl) {
        const spans = nameEl.querySelectorAll<HTMLSpanElement>("[data-cycle-name]");
        spans.forEach((span, i) => {
          span.style.opacity = i === idx % mergedNameColors.length ? "1" : "0";
        });
      }
    }, 2000);
    return () => {
      if (cycleTimerRef.current) clearInterval(cycleTimerRef.current);
    };
  }, [isMergedGroup, mergedAvatars.length, mergedNameColors.length]);

  /** Build a stable style object for a given name color (gradient or plain). */
  function nameColorToStyle(c: string): React.CSSProperties {
    if (c.startsWith("linear-gradient")) {
      return {
        background: c,
        backgroundRepeat: "no-repeat",
        backgroundSize: "100% 100%",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
        color: "transparent",
        display: "inline-block",
      };
    }
    return { color: c, WebkitTextFillColor: c };
  }

  /** Render a stack of absolutely-positioned "Narrator" labels that crossfade via opacity. */
  const mergedNameElement =
    isMergedGroup && mergedNameColors.length > 0 ? (
      <span ref={mergedNameRef} className="relative inline-block">
        {/* Invisible sizer so the parent reserves the right width */}
        <span className="invisible">Narrator</span>
        {mergedNameColors.map((c, i) => (
          <span
            key={i}
            data-cycle-name
            className="absolute inset-0"
            style={{
              ...nameColorToStyle(c),
              opacity: i === 0 ? 1 : 0,
              transition: "opacity 1s ease",
            }}
          >
            Narrator
          </span>
        ))}
      </span>
    ) : null;

  // Render content with dialogue highlighting (or HTML rendering)
  const text = typeof displayContent === "string" ? displayContent : message.content;
  const isHtmlContent = HTML_TAG_RE.test(text);

  const renderedContent = useMemo(() => {
    return renderContent(text, dialogueColor, speakerColorMap, boldDialogue);
  }, [text, dialogueColor, speakerColorMap, boldDialogue]);

  const handleCopy = () => {
    copyToClipboard(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ─── Swipe navigation ───
  const swipeCount = message.swipeCount ?? 0;
  const hasSwipes = swipeCount > 1;

  const handleSwipePrev = useCallback(() => {
    if (message.activeSwipeIndex > 0) {
      onSetActiveSwipe?.(message.id, message.activeSwipeIndex - 1);
    }
  }, [message.id, message.activeSwipeIndex, onSetActiveSwipe]);

  const handleSwipeNext = useCallback(() => {
    if (message.activeSwipeIndex < swipeCount - 1) {
      onSetActiveSwipe?.(message.id, message.activeSwipeIndex + 1);
    }
  }, [message.id, message.activeSwipeIndex, swipeCount, onSetActiveSwipe]);

  const useCompactRectangleAvatar = isRoleplay && roleplayAvatarStyle === "rectangles";
  const compactAvatarFrameClass = useCompactRectangleAvatar ? "h-14 w-11 rounded-xl" : "h-10 w-10 rounded-full";
  const compactAvatarSpacerClass = useCompactRectangleAvatar ? "w-11" : "w-10";
  const showRoleplayAvatarPanel = isRoleplay && roleplayAvatarStyle === "panel" && !isGrouped;
  const roleplayAvatarPanelTail = showRoleplayAvatarPanel ? (
    isMergedGroup && mergedAvatars.length > 0 ? (
      <div className="rpg-avatar-panel-tail absolute inset-0 pointer-events-none overflow-hidden">
        {mergedAvatars.map((avatar, i) => (
          <img
            key={`tail-${avatar.url}`}
            ref={(el) => {
              mergedAvatarTailRefs.current[i] = el;
            }}
            src={avatar.url}
            alt=""
            aria-hidden="true"
            className="rpg-avatar-panel-tail-image absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-700"
            style={{ opacity: i === 0 ? 1 : 0, ...getAvatarCropStyle(avatar.crop) }}
          />
        ))}
      </div>
    ) : avatarUrl ? (
      <div className="rpg-avatar-panel-tail absolute inset-0 pointer-events-none overflow-hidden">
        <img
          src={avatarUrl}
          alt=""
          aria-hidden="true"
          className="rpg-avatar-panel-tail-image absolute inset-0 h-full w-full object-cover object-top"
          style={avatarCropStyle}
        />
      </div>
    ) : null
  ) : null;
  const roleplayBubbleContent = editing ? (
    <EditTextarea
      initialContent={message.content}
      fontSize={chatFontSize}
      onSave={handleSaveEdit}
      onCancel={handleCancelEdit}
    />
  ) : (
    <>
      <div className={cn("mari-message-content break-words", !isHtmlContent && "whitespace-pre-wrap")}>
        {isStreaming && !message.content ? (
          <div className="mari-message-typing flex items-center gap-1 py-0.5">
            <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400/60 [animation-delay:0ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400/60 [animation-delay:150ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400/60 [animation-delay:300ms]" />
          </div>
        ) : (
          <>
            {renderedContent}
            {isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-[0.125rem] animate-pulse rounded-full bg-blue-400" />
            )}
          </>
        )}
      </div>
      {(translatedText || isTranslating) && (
        <div className="mt-2 border-t border-white/10 pt-2">
          {isTranslating ? (
            <span className="text-[0.75rem] italic text-white/40">Translating…</span>
          ) : (
            <div className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-blue-200/70">
              {translatedText}
            </div>
          )}
        </div>
      )}
    </>
  );

  // ─── System messages (shared across modes) ───
  if (isSystem) {
    return (
      <div
        ref={msgRef}
        className={cn(
          "mari-system-message group flex justify-center py-2",
          multiSelectMode && isSelected && "rounded-lg bg-[var(--destructive)]/5 ring-2 ring-[var(--destructive)]/50",
        )}
        onClick={handleMobileTap}
      >
        <div className="relative">
          {!multiSelectMode && onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(message.id);
              }}
              className={cn(
                "absolute -right-1 -top-1 rounded-md p-1 text-white/20 opacity-0 transition-all hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100",
                showActions && "opacity-100",
              )}
              title="Delete"
            >
              <Trash2 size="0.75rem" />
            </button>
          )}
          <div className="mari-system-message-content rounded-full bg-[var(--secondary)] px-4 py-1.5 text-[0.6875rem] text-[var(--muted-foreground)]">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // Roleplay Mode — immersive narrative
  // ═══════════════════════════════════════════════
  if (isRoleplay) {
    // Narrator messages
    if (isNarrator) {
      return (
        <div
          ref={msgRef}
          className={cn(
            "mari-message mari-message-narrator rpg-narrator-msg group mb-4 px-2",
            multiSelectMode && isSelected && "rounded-lg bg-[var(--destructive)]/5 ring-2 ring-[var(--destructive)]/50",
          )}
          onClick={handleMobileTap}
        >
          <div className="flex gap-3">
            {multiSelectMode && (
              <div className="flex flex-shrink-0 items-start pt-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-label={isSelected ? "Deselect message" : "Select message"}
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded border-2 transition-colors",
                    isSelected
                      ? "border-[var(--destructive)] bg-[var(--destructive)]"
                      : "border-[var(--muted-foreground)]/40 bg-[var(--secondary)]",
                  )}
                >
                  {isSelected && <span className="text-xs font-bold text-white">✓</span>}
                </button>
              </div>
            )}
            <div className="mari-message-bubble relative flex-1 rounded-xl border border-amber-500/10 bg-black/40 px-5 py-4">
              {/* Delete button */}
              {!multiSelectMode && onDelete && (
                <button
                  onClick={() => onDelete(message.id)}
                  className={cn(
                    "absolute right-2 top-2 rounded-md p-1 text-white/20 opacity-0 transition-all hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100",
                    showActions && "opacity-100",
                  )}
                  title="Delete"
                >
                  <Trash2 size="0.75rem" />
                </button>
              )}
              <div className="mb-1 flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-widest text-amber-400/70">
                <span className="h-px flex-1 bg-amber-400/20" />
                Narrator
                <span className="h-px flex-1 bg-amber-400/20" />
              </div>
              <div className="mari-message-content whitespace-pre-wrap break-words italic" style={messageTextStyle}>
                {displayContent}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        <div
          ref={msgRef}
          className={cn(
            "mari-message group mb-4 flex gap-3 px-2",
            isUser ? "mari-message-user flex-row-reverse" : "mari-message-assistant",
            multiSelectMode && isSelected && "ring-2 ring-[var(--destructive)]/50 rounded-lg bg-[var(--destructive)]/5",
          )}
          data-message-id={message.id}
          data-message-role={message.role}
          onClick={handleMobileTap}
        >
          {/* Multi-select checkbox */}
          {multiSelectMode && (
            <div className="flex items-start pt-2 flex-shrink-0">
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
          {/* Avatar Column */}
          {!isGrouped && !showRoleplayAvatarPanel && (
            <div className="mari-message-avatar flex flex-col items-center flex-shrink-0 pt-1">
              {isMergedGroup && mergedAvatars.length > 0 ? (
                <div
                  className={cn(
                    "rpg-avatar-glow relative cursor-pointer overflow-hidden ring-2 ring-white/10",
                    compactAvatarFrameClass,
                  )}
                  onClick={() => {
                    const visible = mergedAvatars[cycleIndexRef.current];
                    if (visible) setAvatarLightbox(visible.url);
                  }}
                >
                  {mergedAvatars.map((avatar, i) => (
                    <img
                      key={avatar.url}
                      ref={(el) => {
                        mergedAvatarRefs.current[i] = el;
                      }}
                      src={avatar.url}
                      alt="Group"
                      className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
                      style={{ opacity: i === 0 ? 1 : 0, ...getAvatarCropStyle(avatar.crop) }}
                    />
                  ))}
                </div>
              ) : avatarUrl ? (
                <div className={cn(!isUser && "rpg-avatar-glow")}>
                  <div
                    className={cn("cursor-pointer overflow-hidden ring-2 ring-white/10", compactAvatarFrameClass)}
                    onClick={() => setAvatarLightbox(avatarUrl)}
                  >
                    <img
                      src={avatarUrl}
                      alt={displayName}
                      className="h-full w-full object-cover"
                      style={avatarCropStyle}
                    />
                  </div>
                </div>
              ) : (
                <div
                  className={cn(
                    "flex items-center justify-center ring-2 shadow-lg",
                    compactAvatarFrameClass,
                    isUser
                      ? "bg-gradient-to-br from-neutral-500 to-neutral-600 ring-white/15"
                      : "bg-gradient-to-br from-purple-500 to-pink-600 ring-purple-400/20",
                  )}
                >
                  {isUser ? (
                    <User size={useCompactRectangleAvatar ? "1.125rem" : "1rem"} className="text-white" />
                  ) : (
                    <Bot size={useCompactRectangleAvatar ? "1.125rem" : "1rem"} className="text-white" />
                  )}
                </div>
              )}
              {(showActions || showMessageNumbers) && messageIndex != null && (
                <span className="mt-1 text-[0.5625rem] font-medium text-[var(--muted-foreground)] select-none">
                  #{messageIndex}
                </span>
              )}
            </div>
          )}

          {/* Spacer if grouped (no avatar) */}
          {isGrouped && <div className={cn("flex-shrink-0", compactAvatarSpacerClass)} />}

          {/* Content */}
          <div
            className={cn(
              "mari-message-body flex min-w-0 max-w-[82%] flex-col gap-0.5",
              isUser && "items-end",
              editing && "w-[82%]",
            )}
          >
            {/* Name + time (only if not grouped) */}
            {!isGrouped && (
              <div className={cn("flex items-baseline gap-2 px-1", isUser && "flex-row-reverse")}>
                <span
                  className={cn(
                    "mari-message-name text-[0.75rem] font-bold tracking-tight",
                    !msgNameColor && !isMergedGroup && (isUser ? "text-neutral-300" : "rpg-char-name"),
                  )}
                  style={!isMergedGroup ? nameColorStyle(msgNameColor) : undefined}
                >
                  {isMergedGroup ? mergedNameElement : displayName}
                </span>
                <span className="text-[0.625rem] text-white/30">{formatTime(message.createdAt)}</span>
                {genLabel && (
                  <span className="text-[0.5625rem] text-white/25 italic truncate max-w-[15.625rem]" title={genLabel}>
                    {genLabel}
                  </span>
                )}
                {showRoleplayAvatarPanel && (showActions || showMessageNumbers) && messageIndex != null && (
                  <span className="text-[0.5625rem] font-medium text-white/25 select-none">#{messageIndex}</span>
                )}
              </div>
            )}

            {/* Conversation start marker */}
            {isConversationStart && (
              <div className="flex items-center gap-1.5 px-1 mb-1">
                <span className="h-px flex-1 bg-amber-400/30" />
                <span className="text-[0.5625rem] font-semibold uppercase tracking-widest text-amber-400/70">
                  New Start
                </span>
                <span className="h-px flex-1 bg-amber-400/30" />
              </div>
            )}

            {/* Message bubble */}
            <div
              className={cn(
                "mari-message-bubble relative overflow-hidden rounded-2xl shadow-lg shadow-black/20",
                isUser
                  ? "rounded-tr-sm text-neutral-100 ring-1 ring-white/10"
                  : "rounded-tl-sm text-white/90 ring-1 ring-white/8",
                isGrouped && (isUser ? "rounded-tr-2xl" : "rounded-tl-2xl"),
                isStreaming && "rpg-streaming",
                isConversationStart && "ring-amber-400/30",
                editing && "w-full",
              )}
              style={{
                ...messageTextStyle,
                backgroundColor: roleplayBubbleBg,
              }}
            >
              {showRoleplayAvatarPanel ? (
                <div className={cn("flex min-h-full items-stretch", isUser && "flex-row-reverse")}>
                  <div
                    className={cn(
                      "relative flex w-[4.75rem] shrink-0 items-start self-stretch overflow-hidden md:w-[5.25rem]",
                      isUser ? "border-l border-white/8" : "border-r border-white/8",
                    )}
                  >
                    <div className="rpg-avatar-panel-stack relative h-full max-h-44 w-full overflow-hidden">
                      {isMergedGroup && mergedAvatars.length > 0 ? (
                        <button
                          type="button"
                          className="rpg-avatar-panel-media rpg-avatar-panel absolute inset-0 block h-full w-full cursor-zoom-in overflow-hidden"
                          onClick={() => {
                            const visible = mergedAvatars[cycleIndexRef.current];
                            if (visible) setAvatarLightbox(visible.url);
                          }}
                          aria-label={`Open ${displayName} avatar`}
                        >
                          {mergedAvatars.map((avatar, i) => (
                            <img
                              key={avatar.url}
                              ref={(el) => {
                                mergedAvatarRefs.current[i] = el;
                              }}
                              src={avatar.url}
                              alt="Group"
                              className="absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-700"
                              style={{ opacity: i === 0 ? 1 : 0, ...getAvatarCropStyle(avatar.crop) }}
                            />
                          ))}
                        </button>
                      ) : avatarUrl ? (
                        <button
                          type="button"
                          className={cn(
                            "rpg-avatar-panel-media absolute inset-0 block h-full w-full cursor-zoom-in overflow-hidden",
                            !isUser && "rpg-avatar-panel",
                          )}
                          onClick={() => setAvatarLightbox(avatarUrl)}
                          aria-label={`Open ${displayName} avatar`}
                        >
                          <img
                            src={avatarUrl}
                            alt={displayName}
                            className="h-full w-full object-cover object-top"
                            style={avatarCropStyle}
                          />
                        </button>
                      ) : (
                        <div
                          className={cn(
                            "flex h-full w-full items-start justify-center pt-4",
                            isUser
                              ? "bg-gradient-to-b from-neutral-500/90 via-neutral-600/65 to-transparent"
                              : "bg-gradient-to-b from-purple-500/90 via-pink-600/65 to-transparent",
                          )}
                        >
                          {isUser ? (
                            <User size="1.25rem" className="text-white" />
                          ) : (
                            <Bot size="1.25rem" className="text-white" />
                          )}
                        </div>
                      )}
                      {roleplayAvatarPanelTail}
                      <div
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-[34%]"
                        style={{
                          background: `linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, ${roleplayBubbleBg} 100%)`,
                          opacity: 0.92,
                          maskImage:
                            "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.12) 22%, rgba(0, 0, 0, 0.66) 72%, rgba(0, 0, 0, 1) 100%)",
                          WebkitMaskImage:
                            "linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.12) 22%, rgba(0, 0, 0, 0.66) 72%, rgba(0, 0, 0, 1) 100%)",
                        }}
                      />
                      <div
                        className="pointer-events-none absolute inset-0"
                        style={{
                          background: `linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0) 74%, ${roleplayBubbleBg} 90%, ${roleplayBubbleBg} 100%)`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 px-3 py-3">{roleplayBubbleContent}</div>
                </div>
              ) : (
                <div className="px-4 py-3">{roleplayBubbleContent}</div>
              )}
            </div>

            {/* Image attachments (illustrations, selfies) */}
            {!editing && extra.attachments?.length > 0 && !IMAGE_URL_RE.test(message.content.trim()) && (
              <div className="mt-1.5 flex flex-col items-center gap-2 px-3 pb-2">
                {extra.attachments.map((att: any, i: number) =>
                  att.type === "image" || att.type?.startsWith("image/") ? (
                    <div key={i} className="group/att relative inline-block">
                      <button
                        type="button"
                        onClick={() => setAvatarLightbox(att.url || att.data)}
                        className="block"
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

            {/* Swipes */}
            {hasSwipes && (
              <div className="mari-message-swipes flex items-center gap-1.5 px-1 text-[0.625rem] text-white/40">
                <button
                  className="rounded-md p-0.5 transition-colors hover:bg-white/10 disabled:opacity-30"
                  onClick={handleSwipePrev}
                  disabled={message.activeSwipeIndex <= 0}
                >
                  <ChevronLeft size="0.75rem" />
                </button>
                <span className="tabular-nums">
                  {message.activeSwipeIndex + 1}/{swipeCount}
                </span>
                <button
                  className="rounded-md p-0.5 transition-colors hover:bg-white/10 disabled:opacity-30"
                  onClick={handleSwipeNext}
                  disabled={message.activeSwipeIndex >= swipeCount - 1}
                >
                  <ChevronRight size="0.75rem" />
                </button>
              </div>
            )}

            {/* Hover actions (tap to toggle on mobile) */}
            <div
              className={cn(
                "mari-message-actions flex items-center gap-0.5 px-1 opacity-0 transition-all group-hover:opacity-100",
                isUser && "flex-row-reverse",
                showActions && "opacity-100",
              )}
            >
              <ActionBtn icon={copied ? "\u2713" : <Copy size="0.6875rem" />} onClick={handleCopy} title="Copy" dark />
              <ActionBtn
                icon={<Languages size="0.6875rem" />}
                onClick={() => translate(message.id, message.content, message.chatId)}
                title={translatedText ? "Hide translation" : "Translate"}
                className={translatedText ? "text-blue-400/80 hover:text-blue-300" : undefined}
                dark
              />
              <ActionBtn icon={<Pencil size="0.6875rem" />} onClick={startEditing} title="Edit" dark />
              <ActionBtn
                icon={<RefreshCw size="0.6875rem" />}
                onClick={() => onRegenerate?.(message.id)}
                title={regenerateButtonTitle}
                className={regenerateGuidedClass}
                dark
              />
              <ActionBtn
                icon={<Flag size="0.6875rem" />}
                onClick={() => onToggleConversationStart?.(message.id, isConversationStart)}
                title={isConversationStart ? "Remove conversation start" : "Mark as new start"}
                className={isConversationStart ? "text-amber-400/80 hover:text-amber-300" : undefined}
                dark
              />
              {isLastAssistantMessage && !isUser && (
                <ActionBtn icon={<Eye size="0.6875rem" />} onClick={() => onPeekPrompt?.()} title="Peek prompt" dark />
              )}
              {thinking && !isUser && (
                <ActionBtn
                  icon={<Brain size="0.6875rem" />}
                  onClick={() => setShowThinking(true)}
                  title="View thoughts"
                  dark
                />
              )}
              {onBranch && (
                <ActionBtn
                  icon={<GitBranch size="0.6875rem" />}
                  onClick={() => onBranch(message.id)}
                  title="Branch from here"
                  dark
                />
              )}
              <ActionBtn
                icon={<Trash2 size="0.6875rem" />}
                onClick={() => onDelete?.(message.id)}
                title="Delete"
                className="hover:text-red-400"
                dark
              />
              {ttsEnabled && (
                <ActionBtn
                  icon={
                    isLoadingThis ? (
                      <Loader2 size="0.6875rem" className="animate-spin" />
                    ) : isSpeakingThis ? (
                      <VolumeX size="0.6875rem" />
                    ) : (
                      <Volume2 size="0.6875rem" />
                    )
                  }
                  onClick={handleSpeak}
                  title={isLoadingThis ? "Loading…" : isSpeakingThis ? "Stop speaking" : "Speak"}
                  className={isSpeakingThis ? "text-sky-400 hover:text-sky-300" : undefined}
                  disabled={ttsBusy && !isSpeakingThis}
                  dark
                />
              )}
            </div>
          </div>
        </div>

        {/* Thinking modal */}
        {showThinking && thinking && <ThinkingModal thinking={thinking} onClose={() => setShowThinking(false)} />}

        {/* Avatar lightbox */}
        {avatarLightbox && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
            onClick={() => setAvatarLightbox(null)}
          >
            <img
              src={avatarLightbox}
              alt={displayName}
              className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            />
            <button
              onClick={() => setAvatarLightbox(null)}
              className="absolute right-3 top-3 rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
            >
              <X size="1rem" />
            </button>
          </div>
        )}
      </>
    );
  }

  // ═══════════════════════════════════════════════
  // Conversation Mode — iMessage / texting style
  // ═══════════════════════════════════════════════
  return (
    <div
      ref={msgRef}
      className={cn(
        "mari-message group flex",
        isUser ? "mari-message-user justify-end" : "mari-message-assistant justify-start",
        isGrouped ? "mb-0.5" : "mb-3",
        multiSelectMode && isSelected && "bg-[var(--destructive)]/5",
      )}
      data-message-id={message.id}
      data-message-role={message.role}
      onClick={handleMobileTap}
    >
      <div
        className={cn("flex min-w-0 max-w-[72%] gap-2", isUser && "flex-row-reverse", editing && "w-[85%] max-w-[85%]")}
      >
        {/* Avatar — only show for first in group */}
        {(!isUser || avatarUrl) && (
          <div
            className={cn(
              "mari-message-avatar flex flex-col items-center flex-shrink-0 self-end",
              isGrouped && "invisible",
            )}
          >
            {isMergedGroup && mergedAvatars.length > 0 ? (
              <div
                className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full"
                onClick={() => {
                  const visible = mergedAvatars[cycleIndexRef.current];
                  if (visible) setAvatarLightbox(visible.url);
                }}
              >
                {mergedAvatars.map((avatar, i) => (
                  <img
                    key={avatar.url}
                    ref={(el) => {
                      mergedAvatarRefs.current[i] = el;
                    }}
                    src={avatar.url}
                    alt="Group"
                    className="absolute inset-0 h-8 w-8 object-cover transition-opacity duration-700"
                    style={{ opacity: i === 0 ? 1 : 0, ...getAvatarCropStyle(avatar.crop) }}
                  />
                ))}
              </div>
            ) : avatarUrl ? (
              <div
                className="h-8 w-8 cursor-pointer overflow-hidden rounded-full"
                onClick={() => setAvatarLightbox(avatarUrl)}
              >
                <img
                  src={avatarUrl}
                  alt={displayName}
                  loading="lazy"
                  className="h-full w-full object-cover"
                  style={avatarCropStyle}
                />
              </div>
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[0.6875rem] font-bold text-[var(--muted-foreground)]">
                {displayName[0]}
              </div>
            )}
            {(showActions || showMessageNumbers) && messageIndex != null && (
              <span className="mt-0.5 text-[0.5rem] font-medium text-[var(--muted-foreground)] select-none">
                #{messageIndex}
              </span>
            )}
          </div>
        )}

        <div
          className={cn(
            "mari-message-body flex flex-col gap-0.5",
            isUser ? "items-end" : "items-start",
            editing && "w-full",
          )}
        >
          {/* Name — only for first in group */}
          {!isGrouped && !isUser && (
            <span
              className={cn(
                "mari-message-name px-3 text-[0.6875rem] font-semibold",
                !msgNameColor && !isMergedGroup && "text-[var(--muted-foreground)]",
              )}
              style={!isMergedGroup ? nameColorStyle(msgNameColor) : undefined}
            >
              {isMergedGroup ? mergedNameElement : displayName}
            </span>
          )}

          {/* Conversation start marker */}
          {isConversationStart && (
            <div className="flex items-center gap-1.5 px-2 mb-0.5">
              <span className="h-px flex-1 bg-amber-500/30" />
              <span className="text-[0.5625rem] font-semibold uppercase tracking-widest text-amber-500/70">
                New Start
              </span>
              <span className="h-px flex-1 bg-amber-500/30" />
            </div>
          )}

          {/* Bubble */}
          <div
            className={cn(
              "mari-message-bubble texting-bubble relative px-3.5 py-2",
              isUser
                ? "texting-bubble-user rounded-2xl rounded-br-md"
                : "texting-bubble-other rounded-2xl rounded-bl-md",
              isGrouped && isUser && "rounded-br-2xl rounded-tr-md",
              isGrouped && !isUser && "rounded-bl-2xl rounded-tl-md",
              isStreaming && "ring-2 ring-[var(--primary)]/20",
              isConversationStart && "ring-1 ring-amber-500/30",
              editing && "w-full",
            )}
            style={{ ...messageTextStyle, ...(boxBgColor ? { backgroundColor: boxBgColor } : {}) }}
          >
            {editing ? (
              <EditTextarea
                initialContent={message.content}
                fontSize={chatFontSize}
                onSave={handleSaveEdit}
                onCancel={handleCancelEdit}
              />
            ) : (
              <>
                <div className={cn("mari-message-content break-words", !isHtmlContent && "whitespace-pre-wrap")}>
                  {isStreaming && !message.content ? (
                    <div className="mari-message-typing flex items-center gap-1 py-0.5">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--muted-foreground)]/60 [animation-delay:0ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--muted-foreground)]/60 [animation-delay:150ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--muted-foreground)]/60 [animation-delay:300ms]" />
                    </div>
                  ) : (
                    <>
                      {renderedContent}
                      {isStreaming && (
                        <span className="ml-0.5 inline-block h-4 w-[0.125rem] animate-pulse rounded-full bg-white/70" />
                      )}
                    </>
                  )}
                </div>
                {/* Translation */}
                {(translatedText || isTranslating) && (
                  <div className="mt-2 border-t border-[var(--border)] pt-2">
                    {isTranslating ? (
                      <span className="text-[0.75rem] italic text-[var(--muted-foreground)]">Translating…</span>
                    ) : (
                      <div className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
                        {translatedText}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Image attachments (illustrations, selfies) */}
          {!editing && extra.attachments?.length > 0 && !IMAGE_URL_RE.test(message.content.trim()) && (
            <div className="mt-1.5 flex flex-col items-center gap-2 px-3 pb-2">
              {extra.attachments.map((att: any, i: number) =>
                att.type === "image" || att.type?.startsWith("image/") ? (
                  <div key={i} className="group/att relative inline-block">
                    <button
                      type="button"
                      onClick={() => setAvatarLightbox(att.url || att.data)}
                      className="block"
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

          {/* Timestamp + model — only for last in a group or standalone */}
          {!isGrouped && (
            <div className={cn("mari-message-meta flex items-center gap-2 px-3", isUser && "flex-row-reverse")}>
              <span className="mari-message-timestamp text-[0.625rem] text-[var(--muted-foreground)]/50">
                {formatTime(message.createdAt)}
              </span>
              {genLabel && (
                <span
                  className="text-[0.5625rem] text-[var(--muted-foreground)]/40 italic truncate max-w-[15.625rem]"
                  title={genLabel}
                >
                  {genLabel}
                </span>
              )}
            </div>
          )}

          {/* Swipes */}
          {hasSwipes && (
            <div className="mari-message-swipes flex items-center gap-1.5 px-2 text-[0.625rem] text-[var(--muted-foreground)]">
              <button
                className="rounded p-0.5 transition-colors hover:bg-[var(--accent)] disabled:opacity-30"
                onClick={handleSwipePrev}
                disabled={message.activeSwipeIndex <= 0}
              >
                <ChevronLeft size="0.6875rem" />
              </button>
              <span className="tabular-nums">
                {message.activeSwipeIndex + 1}/{swipeCount}
              </span>
              <button
                className="rounded p-0.5 transition-colors hover:bg-[var(--accent)] disabled:opacity-30"
                onClick={handleSwipeNext}
                disabled={message.activeSwipeIndex >= swipeCount - 1}
              >
                <ChevronRight size="0.6875rem" />
              </button>
            </div>
          )}

          {/* Hover actions (tap to toggle on mobile) */}
          <div
            className={cn(
              "mari-message-actions flex items-center gap-0 px-1 opacity-0 transition-all group-hover:opacity-100",
              isUser && "flex-row-reverse",
              showActions && "opacity-100",
            )}
          >
            <ActionBtn icon={copied ? "✓" : <Copy size="0.625rem" />} onClick={handleCopy} title="Copy" />
            <ActionBtn
              icon={<Languages size="0.625rem" />}
              onClick={() => translate(message.id, message.content, message.chatId)}
              title={translatedText ? "Hide translation" : "Translate"}
              className={translatedText ? "text-blue-500" : undefined}
            />
            <ActionBtn icon={<Pencil size="0.625rem" />} onClick={startEditing} title="Edit" />
            <ActionBtn
              icon={<RefreshCw size="0.625rem" />}
              onClick={() => onRegenerate?.(message.id)}
              title={regenerateButtonTitle}
              className={regenerateGuidedClass}
            />
            <ActionBtn
              icon={<Flag size="0.625rem" />}
              onClick={() => onToggleConversationStart?.(message.id, isConversationStart)}
              title={isConversationStart ? "Remove conversation start" : "Mark as new start"}
              className={isConversationStart ? "text-amber-500" : undefined}
            />
            {isLastAssistantMessage && !isUser && (
              <ActionBtn icon={<Eye size="0.625rem" />} onClick={() => onPeekPrompt?.()} title="Peek prompt" />
            )}
            {thinking && !isUser && (
              <ActionBtn icon={<Brain size="0.625rem" />} onClick={() => setShowThinking(true)} title="View thoughts" />
            )}
            {onBranch && (
              <ActionBtn
                icon={<GitBranch size="0.625rem" />}
                onClick={() => onBranch(message.id)}
                title="Branch from here"
              />
            )}
            <ActionBtn
              icon={<Trash2 size="0.625rem" />}
              onClick={() => onDelete?.(message.id)}
              title="Delete"
              className="hover:text-[var(--destructive)]"
            />
            {ttsEnabled && (
              <ActionBtn
                icon={
                  isLoadingThis ? (
                    <Loader2 size="0.625rem" className="animate-spin" />
                  ) : isSpeakingThis ? (
                    <VolumeX size="0.625rem" />
                  ) : (
                    <Volume2 size="0.625rem" />
                  )
                }
                onClick={handleSpeak}
                title={isLoadingThis ? "Loading…" : isSpeakingThis ? "Stop speaking" : "Speak"}
                className={isSpeakingThis ? "text-sky-500" : undefined}
                disabled={ttsBusy && !isSpeakingThis}
              />
            )}
          </div>
        </div>
      </div>

      {/* Thinking modal */}
      {showThinking && thinking && <ThinkingModal thinking={thinking} onClose={() => setShowThinking(false)} />}

      {/* Avatar lightbox */}
      {avatarLightbox && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80"
          onClick={() => setAvatarLightbox(null)}
        >
          <img
            src={avatarLightbox}
            alt={displayName}
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          />
          <button
            onClick={() => setAvatarLightbox(null)}
            className="absolute right-3 top-3 rounded-lg bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
          >
            <X size="1rem" />
          </button>
        </div>
      )}
    </div>
  );
});

// ── Thinking modal ──
function ThinkingModal({ thinking, onClose }: { thinking: string; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm max-md:pt-[env(safe-area-inset-top)]"
      onClick={onClose}
    >
      <div
        className="relative mx-4 flex max-h-[70vh] w-full max-w-xl flex-col rounded-xl bg-[var(--card)] shadow-2xl ring-1 ring-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
            <Brain size="0.875rem" className="text-[var(--muted-foreground)]" />
            Model Thoughts
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
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
  );
}

// ── Action button ──
function ActionBtn({
  icon,
  onClick,
  title,
  className,
  dark,
  disabled,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  title: string;
  className?: string;
  dark?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "rounded-md p-1 transition-all active:scale-90 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-30",
        dark
          ? "text-white/40 hover:bg-white/10 hover:text-white/70"
          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
        className,
      )}
    >
      {icon}
    </button>
  );
}

function formatTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
