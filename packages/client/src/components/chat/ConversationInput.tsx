// ──────────────────────────────────────────────
// Chat: Conversation Input — Discord-style
// ──────────────────────────────────────────────
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  Send,
  Smile,
  StopCircle,
  X,
  Plus,
  ImagePlay,
  AtSign,
  Users,
  UserCheck,
  Languages,
  Loader2,
  FileText,
  RefreshCw,
  Bookmark,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { useGenerate } from "../../hooks/use-generate";
import { useApplyRegex } from "../../hooks/use-apply-regex";
import { useCreateMessage, useDeleteMessage, useUpdateMessageExtra, useChat, chatKeys } from "../../hooks/use-chats";
import { characterKeys, usePersonas, useUpdatePersona } from "../../hooks/use-characters";
import {
  matchSlashCommand,
  getSlashCompletions,
  type SlashCommand,
  type SlashCommandContext,
} from "../../lib/slash-commands";
import { createInputMacroResolverForChat, isPromptPreviewMacro } from "../../lib/chat-macros";
import { parseChatMetadata } from "../../lib/chat-display";
import { cn, getAvatarCropStyle, type AvatarCropValue } from "../../lib/utils";
import { translateDraftText } from "../../lib/draft-translation";
import { QuickConnectionSwitcher } from "./QuickConnectionSwitcher";
import { QuickPersonaSwitcher } from "./QuickPersonaSwitcher";
import { QuickSwitcherMobile } from "./QuickSwitcherMobile";
import { EmojiPicker } from "../ui/EmojiPicker";
import { GifPicker } from "../ui/GifPicker";
import { SpeechToTextButton } from "../ui/SpeechToTextButton";
import { MariThinkingIndicator } from "./MariThinkingIndicator";
import { MariCapabilityNotice } from "./MariCapabilityNotice";
import { SlashCommandFeedback } from "./SlashCommandFeedback";
import { QuickReplyMenu, type QuickReplyAction } from "./QuickReplyMenu";
import type { Message } from "@marinara-engine/shared";

interface Attachment {
  type: string;
  data: string;
  name: string;
}

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "csv",
  "json",
  "jsonl",
  "log",
  "markdown",
  "md",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

const SAVED_STATUS_LIMIT = 12;
const SAVED_STATUS_MAX_LENGTH = 120;

interface PersonaStatusRow {
  id: string;
  name?: string;
  isActive?: string | boolean;
  savedStatusOptions?: string | string[] | null;
}

function getFileExtension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function inferAttachmentType(file: File): string {
  if (file.type) return file.type;
  const extension = getFileExtension(file.name);
  if (extension === "json" || extension === "jsonl") return "application/json";
  if (extension === "csv") return "text/csv";
  if (extension === "md" || extension === "markdown") return "text/markdown";
  if (extension === "xml") return "application/xml";
  if (extension === "yaml" || extension === "yml") return "application/yaml";
  if (extension === "txt" || extension === "log") return "text/plain";
  return "application/octet-stream";
}

function isSupportedChatAttachment(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  if (file.type.startsWith("text/")) return true;
  const type = inferAttachmentType(file);
  if (
    type === "application/json" ||
    type === "application/xml" ||
    type === "application/yaml" ||
    type === "application/x-yaml"
  ) {
    return true;
  }
  return TEXT_ATTACHMENT_EXTENSIONS.has(getFileExtension(file.name));
}

function normalizeSavedStatus(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, SAVED_STATUS_MAX_LENGTH);
}

function parseSavedStatusOptions(value: PersonaStatusRow["savedStatusOptions"]): string[] {
  const raw = (() => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const byKey = new Map<string, string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const normalized = normalizeSavedStatus(item);
    if (!normalized) continue;
    byKey.set(normalized.toLowerCase(), normalized);
  }
  return [...byKey.values()].slice(0, SAVED_STATUS_LIMIT);
}

function resolveActivePersona(
  personas: PersonaStatusRow[] | undefined,
  chat: { personaId?: string | null; mode?: string } | undefined | null,
) {
  if (!personas) return undefined;
  const chatPersonaId = chat?.personaId ?? null;
  if (chatPersonaId) return personas.find((p) => p.id === chatPersonaId);
  if (chat?.mode === "game") return undefined;
  return personas.find((p) => p.isActive === "true" || p.isActive === true);
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/** Convert a GIF (or any image) blob to PNG via canvas, returning a new Blob + data URL */
async function convertToPng(blob: Blob): Promise<{ blob: Blob; dataUrl: string }> {
  const bitmap = await createImageBitmap(blob);

  let pngBlob: Blob;

  // Prefer OffscreenCanvas when available, fall back to regular <canvas> for broader support (e.g., Safari/iOS).
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context from OffscreenCanvas");
    }
    ctx.drawImage(bitmap, 0, 0);
    pngBlob = await canvas.convertToBlob({ type: "image/png" });
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context from HTMLCanvasElement");
    }
    ctx.drawImage(bitmap, 0, 0);
    pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blobResult) => {
        if (blobResult) {
          resolve(blobResult);
        } else {
          reject(new Error("Failed to convert canvas to PNG blob"));
        }
      }, "image/png");
    });
  }

  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(pngBlob);
  });
  return { blob: pngBlob, dataUrl };
}

interface ConversationInputProps {
  characterNames?: string[];
  groupResponseOrder?: string;
  chatCharacters?: Array<{
    id: string;
    name: string;
    avatarUrl: string | null;
    avatarCrop?: AvatarCropValue | null;
    conversationStatus?: "online" | "idle" | "dnd" | "offline";
    conversationActivity?: string;
  }>;
  onPeekPrompt?: () => void;
}

export function ConversationInput({
  characterNames = [],
  groupResponseOrder,
  chatCharacters,
  onPeekPrompt,
}: ConversationInputProps) {
  const [hasInput, setHasInput] = useState(false);
  const [completions, setCompletions] = useState<SlashCommand[]>([]);
  const [selectedCompletion, setSelectedCompletion] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pendingAttachmentReadsByChat, setPendingAttachmentReadsByChat] = useState<Record<string, number>>({});
  const [isTranslatingDraft, setIsTranslatingDraft] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // @mention autocomplete
  const [_mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCompletions, setMentionCompletions] = useState<string[]>([]);
  const [selectedMention, setSelectedMention] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(0);
  const [charPickerOpen, setCharPickerOpen] = useState(false);
  const [charPickerPos, setCharPickerPos] = useState<{ left: number; top: number } | null>(null);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [statusMenuPos, setStatusMenuPos] = useState<{ left: number; top: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const gifButtonRef = useRef<HTMLButtonElement>(null);
  const statusButtonRef = useRef<HTMLButtonElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const charPickerBtnRef = useRef<HTMLButtonElement>(null);
  const charPickerMenuRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef<Attachment[]>([]);
  const pendingAttachmentDraftsRef = useRef<Map<string, Attachment[]>>(new Map());
  const activeChatId = useChatStore((s) => s.activeChatId);
  const { data: activeChat } = useChat(activeChatId);
  const chatName = activeChat?.name;
  const streamingChatId = useChatStore((s) => s.streamingChatId);
  const isStreamingGlobal = useChatStore((s) => s.isStreaming);
  const isStreaming = isStreamingGlobal && streamingChatId === activeChatId;
  const delayedCharacterInfo = useChatStore((s) => s.delayedCharacterInfo);
  // Show stop button only during actual generation, not during busy delay
  const isActuallyGenerating = isStreaming && !delayedCharacterInfo;
  const setInputDraft = useChatStore((s) => s.setInputDraft);
  const clearInputDraft = useChatStore((s) => s.clearInputDraft);
  const setCurrentInput = useChatStore((s) => s.setCurrentInput);
  const currentInput = useChatStore((s) => s.currentInput);
  const { generate } = useGenerate();
  const { applyToUserInput } = useApplyRegex();
  const enterToSend = useUIStore((s) => s.enterToSendConvo);
  const guideGenerations = useUIStore((s) => s.guideGenerations);
  const showQuickRepliesMenu = useUIStore((s) => s.showQuickRepliesMenu);
  const showQuickReplyPostOnly = useUIStore((s) => s.showQuickReplyPostOnly);
  const showQuickReplyGuide = useUIStore((s) => s.showQuickReplyGuide);
  const showQuickReplyImpersonate = useUIStore((s) => s.showQuickReplyImpersonate);
  const speechToTextEnabled = useUIStore((s) => s.speechToTextEnabled);
  const userActivity = useUIStore((s) => s.userActivity);
  const setUserActivity = useUIStore((s) => s.setUserActivity);
  const createMessage = useCreateMessage(activeChatId);
  const deleteMessage = useDeleteMessage(activeChatId);
  const updateMessageExtra = useUpdateMessageExtra(activeChatId);
  const { data: allPersonas } = usePersonas();
  const updatePersona = useUpdatePersona();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAttachmentReads = activeChatId ? (pendingAttachmentReadsByChat[activeChatId] ?? 0) : 0;
  const isReadingAttachments = pendingAttachmentReads > 0;
  const hasPendingAttachments = isReadingAttachments || attachments.length > 0;
  const requiresManualGuideTarget = groupResponseOrder === "manual" && characterNames.length > 1;

  // Read from the existing infinite-message cache so an empty Send can retry
  // after a failed generation without adding a second user message.
  const [, bumpMessagesTick] = useState(0);
  useEffect(() => {
    if (!activeChatId) return;
    const targetKey = JSON.stringify(chatKeys.messages(activeChatId));
    return qc.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && JSON.stringify(event.query.queryKey) === targetKey) {
        bumpMessagesTick((n) => n + 1);
      }
    });
  }, [activeChatId, qc]);
  const messagesData = qc.getQueryData<InfiniteData<Message[]>>(chatKeys.messages(activeChatId ?? ""));
  const lastMessageRole = useMemo(() => {
    const firstPage = messagesData?.pages?.[0];
    return firstPage?.[firstPage.length - 1]?.role ?? null;
  }, [messagesData]);
  const canRetry = !isStreaming && groupResponseOrder !== "manual" && lastMessageRole === "user";
  const canSubmit = hasInput || attachments.length > 0 || canRetry;
  const showRetrySendState = canRetry && !hasInput && attachments.length === 0;
  const sendButtonTitle = isActuallyGenerating ? "Stop generating" : showRetrySendState ? "Retry generation" : "Send";

  const syncInputState = useCallback(
    (value: string) => {
      setHasInput(value.trim().length > 0);
      setCurrentInput(value);
    },
    [setCurrentInput],
  );

  const replaceAttachments = useCallback((next: Attachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
  }, []);

  const updateAttachments = useCallback((updater: (current: Attachment[]) => Attachment[]) => {
    setAttachments((current) => {
      const next = updater(current);
      attachmentsRef.current = next;
      return next;
    });
  }, []);

  const adjustPendingAttachmentReads = useCallback((chatId: string, delta: number) => {
    setPendingAttachmentReadsByChat((current) => {
      const nextCount = Math.max(0, (current[chatId] ?? 0) + delta);
      const next = { ...current };
      if (nextCount === 0) {
        delete next[chatId];
      } else {
        next[chatId] = nextCount;
      }
      return next;
    });
  }, []);

  const appendAttachmentForChat = useCallback(
    (chatId: string, attachment: Attachment) => {
      if (useChatStore.getState().activeChatId === chatId) {
        updateAttachments((prev) => [...prev, attachment]);
        return;
      }
      const pendingAttachments = pendingAttachmentDraftsRef.current.get(chatId) ?? [];
      pendingAttachmentDraftsRef.current.set(chatId, [...pendingAttachments, attachment]);
    },
    [updateAttachments],
  );

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Restore draft
  const prevChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevChatIdRef.current !== activeChatId) {
      if (prevChatIdRef.current && textareaRef.current) {
        const prevText = textareaRef.current.value;
        if (prevText.trim()) {
          setInputDraft(prevChatIdRef.current, prevText);
        } else {
          clearInputDraft(prevChatIdRef.current);
        }
        const prevAttachments = attachmentsRef.current;
        if (prevAttachments.length > 0) {
          pendingAttachmentDraftsRef.current.set(prevChatIdRef.current, prevAttachments);
        } else {
          pendingAttachmentDraftsRef.current.delete(prevChatIdRef.current);
        }
      }
      prevChatIdRef.current = activeChatId;
      if (textareaRef.current) {
        const draft = activeChatId ? (useChatStore.getState().inputDrafts.get(activeChatId) ?? "") : "";
        textareaRef.current.value = draft;
        syncInputState(draft);
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
      }
      if (activeChatId) {
        const restoredAttachments = pendingAttachmentDraftsRef.current.get(activeChatId) ?? [];
        replaceAttachments(restoredAttachments);
        pendingAttachmentDraftsRef.current.delete(activeChatId);
      } else {
        replaceAttachments([]);
      }
    }
  }, [activeChatId, setInputDraft, clearInputDraft, syncInputState, replaceAttachments]);

  // Save draft on unmount
  useEffect(() => {
    const el = textareaRef.current;
    const chatId = activeChatId;
    return () => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      if (chatId && el) {
        const text = el.value;
        if (text.trim()) {
          useChatStore.getState().setInputDraft(chatId, text);
        } else {
          useChatStore.getState().clearInputDraft(chatId);
        }
      }
    };
  }, [activeChatId]);

  // Flush immediately when the page is being closed or discarded.
  useEffect(() => {
    const flushDraft = () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      const chatId = useChatStore.getState().activeChatId;
      const text = textareaRef.current?.value ?? "";
      if (!chatId) return;
      if (text.trim()) {
        useChatStore.getState().setInputDraft(chatId, text);
      } else {
        useChatStore.getState().clearInputDraft(chatId);
      }
    };
    window.addEventListener("pagehide", flushDraft);
    return () => window.removeEventListener("pagehide", flushDraft);
  }, []);

  const handleFileUpload = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    const originChatId = useChatStore.getState().activeChatId;
    if (!originChatId) return;

    const MAX_SIZE = 20 * 1024 * 1024;
    const acceptedFiles = Array.from(files).filter((file) => {
      if (file.size > MAX_SIZE) {
        toast.error(`${file.name} exceeds 20 MB limit`);
        return false;
      }
      if (!isSupportedChatAttachment(file)) {
        toast.error(
          `${file.name || "That file"} is not supported in chat. Attach images or text files like JSON, TXT, Markdown, or CSV.`,
        );
        return false;
      }
      return true;
    });

    if (acceptedFiles.length === 0) return;
    adjustPendingAttachmentReads(originChatId, acceptedFiles.length);

    for (const file of acceptedFiles) {
      const displayName = file.name || "pasted-file";
      // Convert GIFs to PNG (Gemini and some providers don't support image/gif)
      if (file.type === "image/gif") {
        try {
          const { dataUrl } = await convertToPng(file);
          appendAttachmentForChat(originChatId, {
            type: "image/png",
            data: dataUrl,
            name: displayName.replace(/\.gif$/i, ".png"),
          });
        } catch {
          toast.error(`Failed to convert ${displayName}`);
        } finally {
          adjustPendingAttachmentReads(originChatId, -1);
        }
        continue;
      }

      try {
        const data = await readFileAsDataUrl(file);
        appendAttachmentForChat(originChatId, { type: inferAttachmentType(file), data, name: displayName });
      } catch {
        toast.error(`Failed to read ${displayName}`);
      } finally {
        adjustPendingAttachmentReads(originChatId, -1);
      }
    }
  }, [adjustPendingAttachmentReads, appendAttachmentForChat]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || !activeChatId) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        handleFileUpload(files);
      }
    },
    [activeChatId, handleFileUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (!activeChatId) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        handleFileUpload(files);
      }
    },
    [activeChatId, handleFileUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  /** Extract @mentioned character names from a message string. */
  const extractMentions = useCallback(
    (text: string): string[] => {
      if (!characterNames.length) return [];
      const mentioned: string[] = [];
      // Sort names longest-first so "Mary Jane" matches before "Mary"
      const sorted = [...characterNames].sort((a, b) => b.length - a.length);
      for (const name of sorted) {
        // Match @Name (case-insensitive) — name may contain spaces
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`@${escaped}\\b`, "gi");
        if (re.test(text) && !mentioned.some((m) => m.toLowerCase() === name.toLowerCase())) {
          mentioned.push(name);
        }
      }
      return mentioned;
    },
    [characterNames],
  );

  /** Insert a mention completion into the textarea, replacing the @query. */
  const insertMention = useCallback(
    (name: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const before = el.value.slice(0, mentionStartPos);
      const after = el.value.slice(el.selectionStart);
      el.value = `${before}@${name} ${after}`;
      const cursorPos = before.length + name.length + 2; // +2 for @ and space
      el.selectionStart = el.selectionEnd = cursorPos;
      syncInputState(el.value);
      if (activeChatId) setInputDraft(activeChatId, el.value);
      setMentionQuery(null);
      setMentionCompletions([]);
      el.focus();
    },
    [activeChatId, mentionStartPos, setInputDraft, syncInputState],
  );

  const handleSend = useCallback(async () => {
    if (!activeChatId) return;
    if (isReadingAttachments) {
      toast.info("Still reading attached files. Send will be ready in a moment.");
      return;
    }
    const raw = textareaRef.current?.value.trim() ?? "";
    if (!raw && attachments.length === 0) {
      if (canRetry) {
        try {
          await generate({ chatId: activeChatId, connectionId: null });
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Generation failed";
          toast.error(msg);
        }
      }
      return;
    }

    if (isPromptPreviewMacro(raw)) {
      if (textareaRef.current) {
        textareaRef.current.value = "";
        textareaRef.current.style.height = "auto";
      }
      clearInputDraft(activeChatId);
      syncInputState("");
      replaceAttachments([]);
      onPeekPrompt?.();
      return;
    }

    // If already generating for this chat, just save the message without
    // triggering another generation — the in-progress generation will see
    // it (server re-reads messages after any busy delay).
    if (isStreaming) {
      const activeChatData = useChatStore.getState().activeChat;
      const cachedCharacters = qc.getQueryData<Array<{ id: string; data: unknown }>>(characterKeys.list());
      const cachedPersonas = qc.getQueryData<Array<Record<string, unknown>>>(characterKeys.personas);
      const resolveInputMacros = createInputMacroResolverForChat(activeChatData, cachedCharacters, cachedPersonas, raw);
      // First pass: resolve macros against raw input, so {{input}} uses the pre-translation text.
      let message = applyToUserInput(raw, { resolveMacros: resolveInputMacros });
      // Input translation for streaming path too
      const streamMeta = parseChatMetadata(activeChatData?.metadata);
      if (streamMeta.translateInput && message.trim()) {
        try {
          const { translateText } = await import("../../lib/translate-text");
          const translated = await translateText(message);
          if (translated.trim()) message = translated;
        } catch {
          toast.error("Failed to translate message — sending original");
        }
      }
      // Final pass: resolve macros introduced by translation while {{input}} still points to raw.
      message = resolveInputMacros(message);
      if (textareaRef.current) {
        textareaRef.current.value = "";
        textareaRef.current.style.height = "auto";
      }
      clearInputDraft(activeChatId);
      syncInputState("");
      const currentAttachments = attachments.map((a) => ({
        type: a.type,
        data: a.data,
        filename: a.name,
        name: a.name,
      }));
      replaceAttachments([]);
      const created = await createMessage.mutateAsync({
        role: "user",
        content: message,
        characterId: null,
      });
      if (currentAttachments.length) {
        await updateMessageExtra.mutateAsync({
          messageId: created.id,
          extra: { attachments: currentAttachments },
        });
      }
      return;
    }

    // Slash command check
    const matched = matchSlashCommand(raw);
    if (matched) {
      const slashCtx: SlashCommandContext = {
        chatId: activeChatId,
        generate,
        createMessage: (data) => createMessage.mutate(data),
        invalidate: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
        characterNames,
      };
      const submittedDraft = textareaRef.current?.value ?? "";
      const submittedHeight = textareaRef.current?.style.height ?? "auto";
      const submittedAttachments = attachments;
      const submittedCompletions = completions;
      const submittedMentionQuery = _mentionQuery;
      const submittedMentionCompletions = mentionCompletions;
      if (textareaRef.current) {
        textareaRef.current.value = "";
        textareaRef.current.style.height = "auto";
      }
      clearInputDraft(activeChatId);
      syncInputState("");
      replaceAttachments([]);
      setCompletions([]);
      setMentionQuery(null);
      setMentionCompletions([]);
      try {
        const result = await matched.command.execute(matched.args, slashCtx);
        if (result.feedback) {
          setFeedback(result.feedback);
        }
      } catch (error) {
        const activeChatIdAfterFailure = useChatStore.getState().activeChatId;
        const currentValue = textareaRef.current?.value ?? "";
        const canRestoreVisibleDraft = activeChatIdAfterFailure === activeChatId && currentValue.length === 0;
        if (canRestoreVisibleDraft && textareaRef.current) {
          textareaRef.current.value = submittedDraft;
          textareaRef.current.style.height = submittedHeight;
          syncInputState(submittedDraft);
          setCompletions(submittedCompletions);
          setMentionQuery(submittedMentionQuery);
          setMentionCompletions(submittedMentionCompletions);
        }
        if (submittedAttachments.length > 0) {
          if (activeChatIdAfterFailure === activeChatId) {
            updateAttachments((current) => (current.length === 0 ? submittedAttachments : current));
          } else {
            pendingAttachmentDraftsRef.current.set(activeChatId, submittedAttachments);
          }
        }
        if (submittedDraft && (canRestoreVisibleDraft || activeChatIdAfterFailure !== activeChatId)) {
          setInputDraft(activeChatId, submittedDraft);
        }
        const msg = error instanceof Error ? error.message : "Command failed";
        toast.error(msg);
      }
      return;
    }

    const activeChat = useChatStore.getState().activeChat;
    const cachedCharacters = qc.getQueryData<Array<{ id: string; data: unknown }>>(characterKeys.list());
    const cachedPersonas = qc.getQueryData<Array<Record<string, unknown>>>(characterKeys.personas);
    const resolveInputMacros = createInputMacroResolverForChat(activeChat, cachedCharacters, cachedPersonas, raw);
    // First pass: resolve macros against raw input, so {{input}} uses the pre-translation text.
    let message = applyToUserInput(raw, { resolveMacros: resolveInputMacros });

    // Input translation: translate user's message before sending
    const chatMeta = parseChatMetadata(activeChat?.metadata);
    if (chatMeta.translateInput && message.trim()) {
      try {
        const { translateText } = await import("../../lib/translate-text");
        const translated = await translateText(message);
        if (translated.trim()) message = translated;
      } catch {
        toast.error("Failed to translate message — sending original");
      }
    }

    // Final pass: resolve macros introduced by translation while {{input}} still points to raw.
    message = resolveInputMacros(message);

    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
    clearInputDraft(activeChatId);
    syncInputState("");

    const pendingAttachments = attachments.map((a) => ({ type: a.type, data: a.data, filename: a.name, name: a.name }));
    replaceAttachments([]);

    // Extract @mentions from the raw message (before regex transforms)
    const mentioned = extractMentions(raw);

    if (groupResponseOrder === "manual" && mentioned.length === 0) {
      const created = await createMessage.mutateAsync({
        role: "user",
        content: message,
        characterId: null,
      });
      if (pendingAttachments.length) {
        await updateMessageExtra.mutateAsync({
          messageId: created.id,
          extra: { attachments: pendingAttachments },
        });
      }
      return;
    }

    await generate({
      chatId: activeChatId,
      connectionId: null,
      userMessage: message,
      ...(pendingAttachments.length ? { attachments: pendingAttachments } : {}),
      ...(mentioned.length ? { mentionedCharacterNames: mentioned } : {}),
    });
  }, [
    activeChatId,
    attachments,
    canRetry,
    isReadingAttachments,
    isStreaming,
    generate,
    applyToUserInput,
    extractMentions,
    clearInputDraft,
    createMessage,
    updateMessageExtra,
    characterNames,
    completions,
    _mentionQuery,
    mentionCompletions,
    groupResponseOrder,
    qc,
    syncInputState,
    setInputDraft,
    replaceAttachments,
    updateAttachments,
    onPeekPrompt,
  ]);

  const runQuickSlashCommand = useCallback(
    async (commandLine: string, fallbackError: string) => {
      if (!activeChatId) return;
      const submittingChatId = activeChatId;
      const matched = matchSlashCommand(commandLine);
      if (!matched) return;
      const generationStatus: { succeeded?: boolean } = {};
      const slashCtx: SlashCommandContext = {
        chatId: submittingChatId,
        generate: async (params) => {
          const succeeded = await generate(params);
          if (succeeded !== undefined) generationStatus.succeeded = succeeded;
          return succeeded;
        },
        createMessage: (data) => createMessage.mutate(data),
        invalidate: () => qc.invalidateQueries({ queryKey: chatKeys.all }),
        characterNames,
      };

      const previousDraft = textareaRef.current?.value ?? "";
      const previousHeight = textareaRef.current?.style.height ?? "auto";
      const previousCompletions = completions;
      const previousMentionQuery = _mentionQuery;
      const previousMentionCompletions = mentionCompletions;
      const restoreSubmittedDraft = () => {
        const currentValue = textareaRef.current?.value ?? "";
        const canRestoreVisibleDraft =
          useChatStore.getState().activeChatId === submittingChatId && currentValue.length === 0;
        if (canRestoreVisibleDraft && textareaRef.current) {
          textareaRef.current.value = previousDraft;
          textareaRef.current.style.height = previousHeight;
          syncInputState(previousDraft);
          setCompletions(previousCompletions);
          setMentionQuery(previousMentionQuery);
          setMentionCompletions(previousMentionCompletions);
        }
        if (previousDraft && (canRestoreVisibleDraft || useChatStore.getState().activeChatId !== submittingChatId)) {
          setInputDraft(submittingChatId, previousDraft);
        }
      };
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
      if (textareaRef.current) {
        textareaRef.current.value = "";
        textareaRef.current.style.height = "auto";
      }
      clearInputDraft(submittingChatId);
      syncInputState("");
      setCompletions([]);
      setMentionQuery(null);
      setMentionCompletions([]);

      try {
        const result = await matched.command.execute(matched.args, slashCtx);
        if (result.feedback) {
          setFeedback(result.feedback);
        }
        if (generationStatus.succeeded === false) {
          restoreSubmittedDraft();
        }
      } catch (error) {
        restoreSubmittedDraft();
        const msg = error instanceof Error ? error.message : fallbackError;
        toast.error(msg);
      }
    },
    [
      activeChatId,
      characterNames,
      clearInputDraft,
      completions,
      _mentionQuery,
      mentionCompletions,
      createMessage,
      generate,
      qc,
      setInputDraft,
      syncInputState,
    ],
  );

  const handleImpersonateQuickButton = useCallback(async () => {
    if (!activeChatId || isStreaming) return;
    if (hasPendingAttachments) {
      toast.info("Clear or send attachments before using quick impersonate.");
      return;
    }
    const text = textareaRef.current?.value?.trim() ?? "";
    if (!text) return;
    await runQuickSlashCommand(`/impersonate ${text}`, "Impersonate failed");
  }, [activeChatId, isStreaming, hasPendingAttachments, runQuickSlashCommand]);

  const handlePostOnlyButton = useCallback(async () => {
    if (!activeChatId || isStreaming) return;
    const submittingChatId = activeChatId;
    if (isReadingAttachments) {
      toast.info("Still reading attached files. Post will be ready in a moment.");
      return;
    }
    const raw = textareaRef.current?.value.trim() ?? "";
    const hasText = raw.length > 0;
    const hasFiles = attachments.length > 0;
    if (!hasText && !hasFiles) return;

    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }

    const activeChatData = useChatStore.getState().activeChat;
    const cachedCharacters = qc.getQueryData<Array<{ id: string; data: unknown }>>(characterKeys.list());
    const cachedPersonas = qc.getQueryData<Array<Record<string, unknown>>>(characterKeys.personas);
    const resolveInputMacros = createInputMacroResolverForChat(activeChatData, cachedCharacters, cachedPersonas, raw);
    let message = applyToUserInput(raw, { resolveMacros: resolveInputMacros });

    const chatMeta = parseChatMetadata(activeChatData?.metadata);
    if (chatMeta.translateInput && message.trim()) {
      try {
        const { translateText } = await import("../../lib/translate-text");
        const translated = await translateText(message);
        if (translated.trim()) message = translated;
      } catch {
        toast.error("Failed to translate message; posting original");
      }
    }

    message = resolveInputMacros(message);
    const submittedDraft = raw;
    const submittedHeight = textareaRef.current?.style.height ?? "auto";
    const submittedAttachments = attachments;
    const submittedCompletions = completions;
    const submittedMentionQuery = _mentionQuery;
    const submittedMentionCompletions = mentionCompletions;
    const pendingAttachments = submittedAttachments.map((a) => ({
      type: a.type,
      data: a.data,
      filename: a.name,
      name: a.name,
    }));

    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
    clearInputDraft(submittingChatId);
    syncInputState("");
    replaceAttachments([]);
    setCompletions([]);
    setMentionQuery(null);
    setMentionCompletions([]);

    let createdMessageId: string | null = null;
    try {
      const created = await createMessage.mutateAsync({
        role: "user",
        content: message,
        characterId: null,
      });
      createdMessageId = created.id;
      if (pendingAttachments.length) {
        await updateMessageExtra.mutateAsync({
          messageId: created.id,
          extra: { attachments: pendingAttachments },
        });
      }
    } catch (error) {
      let rollbackFailed = false;
      if (createdMessageId) {
        try {
          await deleteMessage.mutateAsync(createdMessageId);
        } catch {
          rollbackFailed = true;
        }
      }
      const activeChatIdAfterFailure = useChatStore.getState().activeChatId;
      const currentValue = textareaRef.current?.value ?? "";
      const canRestoreVisibleDraft = activeChatIdAfterFailure === submittingChatId && currentValue.length === 0;
      if (canRestoreVisibleDraft && textareaRef.current) {
        textareaRef.current.value = submittedDraft;
        textareaRef.current.style.height = submittedHeight;
        syncInputState(submittedDraft);
        setCompletions(submittedCompletions);
        setMentionQuery(submittedMentionQuery);
        setMentionCompletions(submittedMentionCompletions);
      }
      if (submittedAttachments.length > 0) {
        if (activeChatIdAfterFailure === submittingChatId) {
          updateAttachments((current) => (current.length === 0 ? submittedAttachments : current));
        } else {
          pendingAttachmentDraftsRef.current.set(submittingChatId, submittedAttachments);
        }
      }
      if (submittedDraft && (canRestoreVisibleDraft || activeChatIdAfterFailure !== submittingChatId)) {
        setInputDraft(submittingChatId, submittedDraft);
      }
      const msg = error instanceof Error ? error.message : "Failed to post message";
      toast.error(
        rollbackFailed ? `${msg}; the partial message may need to be removed before retrying.` : msg,
      );
    }
  }, [
    activeChatId,
    isStreaming,
    isReadingAttachments,
    attachments,
    completions,
    _mentionQuery,
    mentionCompletions,
    applyToUserInput,
    qc,
    clearInputDraft,
    syncInputState,
    setInputDraft,
    replaceAttachments,
    updateAttachments,
    createMessage,
    deleteMessage,
    updateMessageExtra,
  ]);

  const handleGuidedGenerationButton = useCallback(async () => {
    if (!activeChatId || isStreaming) return;
    if (requiresManualGuideTarget) {
      toast.info("Choose a character from the reply picker to guide a specific reply.");
      return;
    }
    if (hasPendingAttachments) {
      toast.info("Clear or send attachments before using guided generation.");
      return;
    }
    const text = textareaRef.current?.value?.trim() ?? "";
    if (!text) return;
    await runQuickSlashCommand(`/narrator ${text}`, "Guided generation failed");
  }, [activeChatId, isStreaming, requiresManualGuideTarget, hasPendingAttachments, runQuickSlashCommand]);

  const quickReplyActions = useMemo<QuickReplyAction[]>(
    () => {
      const actions: QuickReplyAction[] = [];
      const getPostOnlyDisabledReason = () => {
        if (!activeChatId) return "Select or create a chat first.";
        if (isStreaming) return "Wait for the current stream to finish.";
        if (isReadingAttachments) return "Still reading attached files.";
        if (!hasInput && attachments.length === 0) return "Type a draft first.";
        return undefined;
      };
      const getGuideDisabledReason = () => {
        if (!activeChatId) return "Select or create a chat first.";
        if (isStreaming) return "Wait for the current stream to finish.";
        if (requiresManualGuideTarget) return "Choose a character from the reply picker.";
        if (hasPendingAttachments) return "Clear or post attachments first.";
        if (!hasInput) return "Type a direction first.";
        return undefined;
      };
      const getImpersonateDisabledReason = () => {
        if (!activeChatId) return "Select or create a chat first.";
        if (isStreaming) return "Wait for the current stream to finish.";
        if (hasPendingAttachments) return "Clear or post attachments first.";
        if (!hasInput) return "Type a direction first.";
        return undefined;
      };
      if (showQuickReplyPostOnly) {
        actions.push({
          id: "post-only",
          label: "Post only",
          description: "Add your message without a reply",
          icon: <FileText size="0.875rem" />,
          disabled: !activeChatId || isStreaming || isReadingAttachments || (!hasInput && attachments.length === 0),
          disabledReason: getPostOnlyDisabledReason(),
          onSelect: handlePostOnlyButton,
        });
      }
      if (showQuickReplyGuide) {
        actions.push({
          id: "guide-reply",
          label: "Guide reply",
          description: "Send as /narrator direction",
          icon: <WandSparkles size="0.875rem" />,
          disabled: !activeChatId || isStreaming || requiresManualGuideTarget || !hasInput || hasPendingAttachments,
          disabledReason: getGuideDisabledReason(),
          onSelect: handleGuidedGenerationButton,
        });
      }
      if (showQuickReplyImpersonate) {
        actions.push({
          id: "impersonate",
          label: "Impersonate",
          description: "Generate as your persona",
          icon: <UserCheck size="0.875rem" />,
          disabled: !activeChatId || isStreaming || !hasInput || hasPendingAttachments,
          disabledReason: getImpersonateDisabledReason(),
          onSelect: handleImpersonateQuickButton,
        });
      }
      return actions;
    },
    [
      activeChatId,
      isStreaming,
      isReadingAttachments,
      hasInput,
      attachments.length,
      hasPendingAttachments,
      requiresManualGuideTarget,
      showQuickReplyPostOnly,
      showQuickReplyGuide,
      showQuickReplyImpersonate,
      handlePostOnlyButton,
      handleGuidedGenerationButton,
      handleImpersonateQuickButton,
    ],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // @mention completions navigation
      if (mentionCompletions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedMention((p) => (p + 1) % mentionCompletions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedMention((p) => (p - 1 + mentionCompletions.length) % mentionCompletions.length);
          return;
        }
        if (e.key === "Tab" || e.key === "Enter") {
          e.preventDefault();
          const name = mentionCompletions[selectedMention];
          if (name) insertMention(name);
          return;
        }
        if (e.key === "Escape") {
          setMentionQuery(null);
          setMentionCompletions([]);
          return;
        }
      }

      // Slash completions navigation
      if (completions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedCompletion((p) => (p + 1) % completions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedCompletion((p) => (p - 1 + completions.length) % completions.length);
          return;
        }
        if (e.key === "Tab" || e.key === "Enter") {
          e.preventDefault();
          const cmd = completions[selectedCompletion];
          if (cmd && textareaRef.current) {
            textareaRef.current.value = `/${cmd.name} `;
            syncInputState(textareaRef.current.value);
            if (activeChatId) setInputDraft(activeChatId, textareaRef.current.value);
            setCompletions([]);
          }
          return;
        }
        if (e.key === "Escape") {
          setCompletions([]);
          return;
        }
      }

      const shouldSend = enterToSend ? e.key === "Enter" && !e.shiftKey : e.key === "Enter" && (e.metaKey || e.ctrlKey);
      if (shouldSend) {
        e.preventDefault();
        handleSend();
      }
    },
    [
      completions,
      activeChatId,
      selectedCompletion,
      mentionCompletions,
      selectedMention,
      insertMention,
      enterToSend,
      handleSend,
      setInputDraft,
      syncInputState,
    ],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Debounced resize to reduce layout reflows during fast typing
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = setTimeout(() => {
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }, 150);
    syncInputState(el.value);

    if (activeChatId) {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      const chatId = activeChatId;
      const draft = el.value;
      draftTimerRef.current = setTimeout(() => {
        if (draft.trim()) {
          setInputDraft(chatId, draft);
        } else {
          clearInputDraft(chatId);
        }
      }, 300);
    }

    // Slash completions
    if (el.value.startsWith("/")) {
      const results = getSlashCompletions(el.value);
      setCompletions(results);
      setSelectedCompletion(0);
    } else {
      setCompletions([]);
    }

    // @mention detection — look backwards from cursor for an @ trigger
    const cursor = el.selectionStart;
    const textBefore = el.value.slice(0, cursor);
    // Find the last @ that isn't preceded by a word character
    const atMatch = textBefore.match(/(?:^|[^a-zA-Z0-9])@([a-zA-Z0-9 ]*)$/);
    if (atMatch && characterNames.length > 0) {
      const query = atMatch[1]!.toLowerCase();
      const startPos = cursor - atMatch[1]!.length - 1; // position of the @
      const matches = characterNames.filter((n) => n.toLowerCase().startsWith(query));
      if (matches.length > 0) {
        setMentionQuery(query);
        setMentionCompletions(matches);
        setSelectedMention(0);
        setMentionStartPos(startPos);
      } else {
        setMentionQuery(null);
        setMentionCompletions([]);
      }
    } else {
      setMentionQuery(null);
      setMentionCompletions([]);
    }
  }, [activeChatId, characterNames, clearInputDraft, setInputDraft, syncInputState]);

  useEffect(() => {
    if (hasInput && feedback) setFeedback(null);
  }, [hasInput, feedback]);

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      if (!textareaRef.current) return;
      const el = textareaRef.current;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const value = el.value;
      el.value = value.slice(0, start) + emoji + value.slice(end);
      el.selectionStart = el.selectionEnd = start + emoji.length;
      syncInputState(el.value);
      if (activeChatId) setInputDraft(activeChatId, el.value);
      el.focus();
    },
    [activeChatId, setInputDraft, syncInputState],
  );

  const handleGifSelect = useCallback(
    async (gifUrl: string) => {
      if (!activeChatId) return;

      // Fetch the GIF and convert to PNG so all providers can handle it
      let gifAttachments: Array<{ type: string; data: string }> | undefined;
      try {
        const resp = await fetch(gifUrl);
        const blob = await resp.blob();
        const { dataUrl } = await convertToPng(blob);
        gifAttachments = [{ type: "image/png", data: dataUrl }];
      } catch {
        // If fetch fails (CORS etc.), send without attachment — still shows as image in chat
      }

      // If already streaming for this chat, just save the message
      if (isStreaming) {
        createMessage.mutate({ role: "user", content: gifUrl, characterId: null });
        return;
      }

      if (groupResponseOrder === "manual" && characterNames.length > 1) {
        createMessage.mutate({ role: "user", content: gifUrl, characterId: null });
        return;
      }

      await generate({
        chatId: activeChatId,
        connectionId: null,
        userMessage: gifUrl,
        ...(gifAttachments ? { attachments: gifAttachments } : {}),
      });
    },
    [activeChatId, isStreaming, groupResponseOrder, characterNames.length, generate, createMessage],
  );

  const handleCharacterResponse = useCallback(
    async (characterId: string) => {
      if (!activeChatId || isStreaming) return;
      setCharPickerOpen(false);
      setCharPickerPos(null);
      try {
        await generate(
          guideGenerations && hasInput
            ? {
                chatId: activeChatId,
                connectionId: null,
                forCharacterId: characterId,
                generationGuide: currentInput,
                generationGuideSource: "guide",
              }
            : { chatId: activeChatId, connectionId: null, forCharacterId: characterId },
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Generation failed";
        toast.error(msg);
      }
    },
    [activeChatId, isStreaming, generate, guideGenerations, hasInput, currentInput],
  );

  useEffect(() => {
    if (!charPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        charPickerMenuRef.current &&
        !charPickerMenuRef.current.contains(e.target as Node) &&
        charPickerBtnRef.current &&
        !charPickerBtnRef.current.contains(e.target as Node)
      ) {
        setCharPickerOpen(false);
        setCharPickerPos(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [charPickerOpen]);

  useEffect(() => {
    if (!statusMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        statusMenuRef.current &&
        !statusMenuRef.current.contains(target) &&
        statusButtonRef.current &&
        !statusButtonRef.current.contains(target)
      ) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [statusMenuOpen]);

  useEffect(() => {
    if (!charPickerOpen || !charPickerBtnRef.current) return;
    const rect = charPickerBtnRef.current.getBoundingClientRect();
    const inputBox = charPickerBtnRef.current.closest(".rounded-2xl") as HTMLElement | null;
    const anchorTop = inputBox ? inputBox.getBoundingClientRect().top : rect.top;
    requestAnimationFrame(() => {
      const menuEl = charPickerMenuRef.current;
      const menuHeight = menuEl?.offsetHeight || 300;
      const menuWidth = menuEl?.offsetWidth || 220;
      let left = rect.right - menuWidth;
      if (left < 8) left = 8;
      setCharPickerPos({ left, top: Math.max(8, anchorTop - menuHeight - 4) });
    });
  }, [charPickerOpen]);

  const showCharPicker = groupResponseOrder === "manual" && !!chatCharacters && chatCharacters.length > 1;
  const activePersona = resolveActivePersona(
    allPersonas as PersonaStatusRow[] | undefined,
    activeChat as { personaId?: string | null; mode?: string } | undefined,
  );
  const savedStatusOptions = parseSavedStatusOptions(activePersona?.savedStatusOptions);
  const normalizedUserActivity = normalizeSavedStatus(userActivity);
  const canSaveCurrentStatus =
    !!activePersona &&
    !!normalizedUserActivity &&
    !savedStatusOptions.some((option) => option.toLowerCase() === normalizedUserActivity.toLowerCase());
  const chatMetadata = activeChat?.metadata
    ? typeof activeChat.metadata === "string"
      ? (() => {
          try {
            return JSON.parse(activeChat.metadata) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : (activeChat.metadata as Record<string, unknown>)
    : {};
  const showDraftTranslateButton = chatMetadata.showInputTranslateButton === true;

  useEffect(() => {
    if (!statusMenuOpen || !statusButtonRef.current) return;
    const rect = statusButtonRef.current.getBoundingClientRect();
    const inputBox = statusButtonRef.current.closest(".rounded-2xl") as HTMLElement | null;
    const anchorTop = inputBox ? inputBox.getBoundingClientRect().top : rect.top;
    requestAnimationFrame(() => {
      const menuEl = statusMenuRef.current;
      const menuHeight = menuEl?.offsetHeight || 260;
      const menuWidth = menuEl?.offsetWidth || 260;
      let left = rect.right - menuWidth;
      if (left < 8) left = 8;
      setStatusMenuPos({ left, top: Math.max(8, anchorTop - menuHeight - 4) });
    });
  }, [statusMenuOpen, savedStatusOptions.length, canSaveCurrentStatus]);

  const handleTranslateDraft = useCallback(async () => {
    if (!activeChatId || isTranslatingDraft) return;
    const raw = textareaRef.current?.value ?? "";
    if (!raw.trim()) return;

    setIsTranslatingDraft(true);
    try {
      const translated = await translateDraftText(raw);
      if (!translated || !textareaRef.current) return;
      textareaRef.current.value = translated;
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
      syncInputState(translated);
      setInputDraft(activeChatId, translated);
      textareaRef.current.focus();
    } finally {
      setIsTranslatingDraft(false);
    }
  }, [activeChatId, isTranslatingDraft, setInputDraft, syncInputState]);

  const persistSavedStatusOptions = useCallback(
    async (nextOptions: string[]) => {
      if (!activePersona) {
        toast.info("Choose a persona before saving status options.");
        return;
      }
      await updatePersona.mutateAsync({
        id: activePersona.id,
        savedStatusOptions: JSON.stringify(nextOptions.slice(0, SAVED_STATUS_LIMIT)),
      });
    },
    [activePersona, updatePersona],
  );

  const handleSaveCurrentStatus = useCallback(async () => {
    if (!normalizedUserActivity || !activePersona) return;
    const nextOptions = [
      normalizedUserActivity,
      ...savedStatusOptions.filter((option) => option.toLowerCase() !== normalizedUserActivity.toLowerCase()),
    ];
    await persistSavedStatusOptions(nextOptions);
    toast.success("Saved status for this persona");
  }, [activePersona, normalizedUserActivity, persistSavedStatusOptions, savedStatusOptions]);

  const handleApplySavedStatus = useCallback(
    (status: string) => {
      setUserActivity(status);
      setStatusMenuOpen(false);
    },
    [setUserActivity],
  );

  const handleDeleteSavedStatus = useCallback(
    async (status: string) => {
      const nextOptions = savedStatusOptions.filter((option) => option.toLowerCase() !== status.toLowerCase());
      await persistSavedStatusOptions(nextOptions);
      toast.success("Removed saved status");
    },
    [persistSavedStatusOptions, savedStatusOptions],
  );

  const handleSpeechTranscript = useCallback(
    (transcript: string) => {
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const before = el.value.slice(0, start);
      const after = el.value.slice(end);
      const prefix = before && !/\s$/.test(before) ? " " : "";
      const suffix = after && !/^\s/.test(after) ? " " : "";
      const nextValue = `${before}${prefix}${transcript}${suffix}${after}`;
      const nextCursor = before.length + prefix.length + transcript.length;

      el.value = nextValue;
      el.setSelectionRange(nextCursor, nextCursor);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      syncInputState(nextValue);
      if (activeChatId) setInputDraft(activeChatId, nextValue);
      el.focus();
    },
    [activeChatId, setInputDraft, syncInputState],
  );

  const statusDotClass = (status?: string) =>
    status === "offline"
      ? "bg-gray-400"
      : status === "dnd"
        ? "bg-red-500"
        : status === "idle"
          ? "bg-yellow-500"
          : "bg-green-500";
  const statusLabel = (status?: string) =>
    status === "offline" ? "Offline" : status === "dnd" ? "Busy" : status === "idle" ? "Away" : null;

  return (
    <div className="relative px-3 pb-3">
      {/* Slash command autocomplete */}
      {completions.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 z-40 mb-1 max-h-[min(18rem,45dvh)] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg [-webkit-overflow-scrolling:touch]">
          {completions.map((cmd, i) => (
            <button
              key={cmd.name}
              onMouseDown={(e) => {
                e.preventDefault();
                if (textareaRef.current) {
                  textareaRef.current.value = `/${cmd.name} `;
                  syncInputState(textareaRef.current.value);
                  if (activeChatId) setInputDraft(activeChatId, textareaRef.current.value);
                  setCompletions([]);
                  textareaRef.current.focus();
                }
              }}
              className={cn(
                "flex w-full min-w-0 items-start gap-2 px-3 py-2.5 text-left text-sm transition-colors",
                i === selectedCompletion ? "bg-foreground/10 text-foreground" : "hover:bg-[var(--accent)]",
              )}
            >
              <span className="shrink-0 whitespace-nowrap font-mono text-xs">/{cmd.name}</span>
              {cmd.description && (
                <span className="min-w-0 flex-1 text-[0.6875rem] leading-snug text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
                  {cmd.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* @mention autocomplete */}
      {mentionCompletions.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
          {mentionCompletions.map((name, i) => (
            <button
              key={name}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(name);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                i === selectedMention ? "bg-foreground/10 text-foreground" : "hover:bg-[var(--accent)]",
              )}
            >
              <AtSign size="0.75rem" className="shrink-0 text-cyan-400" />
              <span className="font-medium">{name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Feedback toast */}
      {feedback && (
        <div className="absolute bottom-full left-3 right-3 z-50 mb-2">
          <SlashCommandFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
        </div>
      )}

      {/* Attachment preview */}
      {(attachments.length > 0 || isReadingAttachments) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((att, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs ring-1 ring-[var(--border)]"
            >
              {att.type.startsWith("image/") ? null : (
                <FileText size="0.875rem" className="shrink-0 text-[var(--muted-foreground)]" />
              )}
              <span className="max-w-[120px] truncate">{att.name}</span>
              <button
                onClick={() => updateAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                className="rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
              >
                <X size="0.625rem" />
              </button>
            </div>
          ))}
          {isReadingAttachments && (
            <div className="flex items-center gap-1.5 rounded-lg bg-[var(--secondary)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] ring-1 ring-[var(--border)]">
              <Loader2 size="0.875rem" className="animate-spin" />
              Reading file...
            </div>
          )}
        </div>
      )}

      {/* Mari capability + thinking indicators */}
      <MariCapabilityNotice />
      <MariThinkingIndicator />

      {/* Input bar */}
      <div
        ref={inputBarRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex items-center gap-1.5 rounded-2xl border-2 px-2.5 py-2.5 transition-all duration-200 sm:gap-2 sm:px-4 bg-[var(--card)] dark:bg-black/40",
          isDragging ? "border-blue-400/50 bg-blue-500/10 shadow-lg shadow-blue-500/10" : "border-[var(--border)]",
        )}
      >
        {/* Attach button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.txt,.md,.markdown,.json,.jsonl,.csv,.log,.xml,.yaml,.yml"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFileUpload(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg p-1.5 text-foreground/40 transition-all hover:bg-foreground/10 hover:text-foreground/70 active:scale-90"
          title="Attach file"
        >
          <Plus size="1rem" />
        </button>

        {/* Quick Switchers — desktop: inline, mobile: chevron */}
        <QuickConnectionSwitcher className="hidden sm:flex" />
        <QuickPersonaSwitcher className="hidden sm:flex" />
        <div className="sm:hidden">
          <QuickSwitcherMobile />
        </div>

        {/* Textarea */}

        <textarea
          ref={textareaRef}
          placeholder={
            groupResponseOrder === "manual"
              ? characterNames.length > 0
                ? `Message freely; @${characterNames[0]} to get a reply`
                : "Message freely..."
              : characterNames.length > 1 && chatName
                ? `Message ${chatName}, / for commands`
                : characterNames.length > 0
                  ? `Message @${characterNames[0]}, / for commands`
                  : "Message..."
          }
          rows={1}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="max-h-[12.5rem] min-w-0 flex-1 resize-none bg-transparent py-0 text-[1rem] leading-normal text-[var(--foreground)] outline-none placeholder:text-foreground/30"
        />

        {/* Right actions */}
        <div className="flex shrink-0 items-center gap-0.5">
          <div className="relative">
            <button
              ref={gifButtonRef}
              onClick={() => {
                setGifOpen((v) => !v);
                setEmojiOpen(false);
              }}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                gifOpen
                  ? "text-foreground bg-foreground/10"
                  : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground",
              )}
              title="GIF"
            >
              <ImagePlay size="1.25rem" />
            </button>
            <GifPicker
              open={gifOpen}
              onClose={() => setGifOpen(false)}
              onSelect={handleGifSelect}
              anchorRef={gifButtonRef}
              containerRef={inputBarRef}
            />
          </div>

          <div className="relative hidden sm:block">
            <button
              ref={emojiButtonRef}
              onClick={() => {
                setEmojiOpen((v) => !v);
                setGifOpen(false);
              }}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                emojiOpen
                  ? "text-foreground bg-foreground/10"
                  : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground",
              )}
              title="Emoji"
            >
              <Smile size="1.25rem" />
            </button>
            <EmojiPicker
              open={emojiOpen}
              onClose={() => setEmojiOpen(false)}
              onSelect={handleEmojiSelect}
              anchorRef={emojiButtonRef}
              containerRef={inputBarRef}
            />
          </div>

          {showCharPicker && (
            <button
              ref={charPickerBtnRef}
              onClick={() => setCharPickerOpen((v) => !v)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                guideGenerations && hasInput
                  ? "text-[var(--primary)] bg-[var(--primary)]/15 ring-1 ring-[var(--primary)]/30 hover:bg-[var(--primary)]/20"
                  : charPickerOpen
                    ? "text-foreground bg-foreground/10"
                    : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground",
              )}
              title={
                guideGenerations && hasInput ? "Trigger character response (guided)" : "Trigger character response"
              }
            >
              <Users size="1rem" />
            </button>
          )}

          {showDraftTranslateButton && (
            <button
              type="button"
              onClick={() => void handleTranslateDraft()}
              disabled={!activeChatId || !hasInput || isTranslatingDraft}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                hasInput && !isTranslatingDraft
                  ? "text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
                  : "text-foreground/25",
              )}
              title="Translate draft"
            >
              {isTranslatingDraft ? <Loader2 size="1rem" className="animate-spin" /> : <Languages size="1rem" />}
            </button>
          )}

          {speechToTextEnabled && (
            <SpeechToTextButton
              disabled={!activeChatId}
              onTranscript={handleSpeechTranscript}
              className="rounded-full"
              iconSize={16}
            />
          )}

          <button
            ref={statusButtonRef}
            type="button"
            onClick={() => setStatusMenuOpen((v) => !v)}
            disabled={!activePersona}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              statusMenuOpen
                ? "text-foreground bg-foreground/10"
                : activePersona
                  ? "text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
                  : "text-foreground/25",
            )}
            title={activePersona ? "Saved persona statuses" : "Choose a persona to save statuses"}
          >
            <Bookmark size="1rem" />
          </button>

          {showQuickRepliesMenu && quickReplyActions.length > 0 && (
            <QuickReplyMenu
              actions={quickReplyActions}
              disabled={!activeChatId || isReadingAttachments || (!hasInput && attachments.length === 0)}
            />
          )}

          <button
            onClick={isActuallyGenerating ? () => useChatStore.getState().stopGeneration() : handleSend}
            disabled={!isActuallyGenerating && (isReadingAttachments || !activeChatId || !canSubmit)}
            aria-label={sendButtonTitle}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200",
              isActuallyGenerating
                ? "text-foreground hover:opacity-80"
                : canSubmit && !isReadingAttachments
                  ? "text-foreground hover:text-foreground/80 active:scale-90"
                  : "text-foreground/20",
            )}
            title={sendButtonTitle}
          >
            {isActuallyGenerating ? (
              <StopCircle size="1rem" />
            ) : showRetrySendState ? (
              <RefreshCw size="0.9375rem" />
            ) : (
              <Send size="0.9375rem" />
            )}
          </button>
        </div>
      </div>
      {statusMenuOpen &&
        createPortal(
          <div
            ref={statusMenuRef}
            className="fixed z-[9999] flex max-h-[320px] min-w-[240px] max-w-[300px] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
            style={
              statusMenuPos ? { left: statusMenuPos.left, top: statusMenuPos.top } : { visibility: "hidden" as const }
            }
          >
            <div className="border-b border-[var(--border)] px-3 py-2">
              <div className="truncate text-xs font-semibold">Saved Statuses</div>
              <div className="truncate text-[0.625rem] text-[var(--muted-foreground)]">
                {activePersona?.name ?? "No persona selected"}
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto p-1">
              {canSaveCurrentStatus && (
                <button
                  type="button"
                  onClick={() => void handleSaveCurrentStatus()}
                  disabled={updatePersona.isPending}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--primary)] transition-colors hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  <Plus size="0.875rem" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">Save &quot;{normalizedUserActivity}&quot;</span>
                </button>
              )}
              {savedStatusOptions.length > 0 ? (
                savedStatusOptions.map((status) => (
                  <div key={status} className="group flex items-center gap-1 rounded-lg hover:bg-[var(--accent)]">
                    <button
                      type="button"
                      onClick={() => handleApplySavedStatus(status)}
                      className="min-w-0 flex-1 px-3 py-2 text-left text-xs"
                    >
                      <span className="block truncate">{status}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteSavedStatus(status)}
                      disabled={updatePersona.isPending}
                      className="mr-1 rounded-md p-1.5 text-[var(--muted-foreground)] opacity-70 transition-colors hover:text-[var(--destructive)] disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100"
                      title="Remove saved status"
                    >
                      <Trash2 size="0.75rem" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="px-3 py-4 text-center text-[0.6875rem] text-[var(--muted-foreground)]">
                  No saved statuses yet
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
      {showCharPicker &&
        charPickerOpen &&
        createPortal(
          <div
            ref={charPickerMenuRef}
            className="fixed z-[9999] flex max-h-[320px] min-w-[220px] max-w-[280px] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
            style={
              charPickerPos ? { left: charPickerPos.left, top: charPickerPos.top } : { visibility: "hidden" as const }
            }
          >
            <div className="flex items-center justify-center border-b border-[var(--border)] px-3 py-2 text-[0.6875rem] font-semibold">
              Trigger Response
            </div>
            <div className="overflow-y-auto p-1">
              {chatCharacters!.map((char) => (
                <button
                  key={char.id}
                  onClick={() => handleCharacterResponse(char.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-[var(--accent)]",
                    (char.conversationStatus === "dnd" || char.conversationStatus === "offline") && "opacity-60",
                  )}
                >
                  <div className="relative shrink-0">
                    {char.avatarUrl ? (
                      <span className="relative block h-7 w-7 overflow-hidden rounded-full">
                        <img
                          src={char.avatarUrl}
                          alt={char.name}
                          className="h-full w-full object-cover"
                          style={getAvatarCropStyle(char.avatarCrop)}
                        />
                      </span>
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--secondary)] text-[0.6875rem] font-semibold text-[var(--muted-foreground)]">
                        {(char.name || "?")[0].toUpperCase()}
                      </div>
                    )}
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[var(--card)]",
                        statusDotClass(char.conversationStatus),
                      )}
                    />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{char.name}</span>
                    {(char.conversationActivity || statusLabel(char.conversationStatus)) && (
                      <span className="block truncate text-[0.625rem] text-[var(--muted-foreground)]">
                        {char.conversationActivity || statusLabel(char.conversationStatus)}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
